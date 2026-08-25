import { FormEvent, useCallback, useEffect, useState } from "react";

import { AppSelect } from "@/components/AppSelect";

type AuthFetch = (input: string, init?: RequestInit) => Promise<Response>;
type Recipient = {
  id: string;
  emailHint: string;
  categories: string[];
  eventSlugs: string[];
  cadence: "immediate" | "digest";
  digestHour?: number;
  quietHours: { start?: number; end?: number };
  criticalOverride: boolean;
  fallback: boolean;
  status: string;
};
type Delivery = {
  id: string;
  recipientHint: string;
  subjectHint: string;
  kind: string;
  status: string;
  attempts: number;
  lastError?: string;
  createdAt: string;
};

const CATEGORIES = [
  "all",
  "refund-failed",
  "refund-review",
  "access-email-failed",
  "email-delivery-failed",
  "capacity-invariant",
  "identity-conflict",
  "transfer-conflict",
] as const;

export function AlertSettings({
  authFetch,
  onError,
  onStatus,
  ensureStepUpToken,
  withStepUpHeaders,
}: {
  authFetch: AuthFetch;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
  ensureStepUpToken: () => Promise<{ ok: true; token: string } | { ok: false }>;
  withStepUpHeaders: (token: string, headers?: Record<string, string>) => Record<string, string>;
}) {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [email, setEmail] = useState("");
  const [categories, setCategories] = useState<string[]>(["all"]);
  const [eventSlugs, setEventSlugs] = useState("");
  const [cadence, setCadence] = useState<Recipient["cadence"]>("immediate");
  const [digestHour, setDigestHour] = useState(9);
  const [quietStart, setQuietStart] = useState(22);
  const [quietEnd, setQuietEnd] = useState(7);
  const [criticalOverride, setCriticalOverride] = useState(true);
  const [fallback, setFallback] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await authFetch("/api/admin/operations/alerts");
    const body = (await response.json().catch(() => ({}))) as {
      recipients?: Recipient[];
      deliveries?: Delivery[];
      error?: string;
    };
    if (!response.ok) throw new Error(body.error ?? "Alert settings could not be loaded");
    setRecipients(body.recipients ?? []);
    setDeliveries(body.deliveries ?? []);
  }, [authFetch]);

  useEffect(() => {
    void load().catch((error) =>
      onError(error instanceof Error ? error.message : "Alert settings could not be loaded"),
    );
  }, [load, onError]);

  function toggleCategory(category: string) {
    setCategories((current) =>
      current.includes(category)
        ? current.filter((value) => value !== category)
        : [...current, category],
    );
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const step = await ensureStepUpToken();
      if (!step.ok) return;
      const response = await authFetch("/api/admin/operations/alerts", {
        method: "POST",
        headers: withStepUpHeaders(step.token, { "content-type": "application/json" }),
        body: JSON.stringify({
          email,
          categories,
          eventSlugs: eventSlugs
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          cadence,
          digestHour,
          quietHours: { start: quietStart, end: quietEnd },
          criticalOverride,
          fallback,
          reason,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Alert recipient could not be saved");
      onStatus("Alert recipient saved.");
      setEmail("");
      setReason("");
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Alert recipient could not be saved");
    } finally {
      setBusy(false);
    }
  }

  async function test(recipientId: string) {
    setBusy(true);
    try {
      const response = await authFetch("/api/admin/operations/alerts", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recipientId }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        queued?: boolean;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "Test alert could not be sent");
      onStatus(body.queued ? "Test alert queued." : "Test alert failed; review delivery history.");
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Test alert could not be sent");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(recipient: Recipient) {
    const changeReason = window.prompt(`Why are you removing ${recipient.emailHint}?`)?.trim();
    if (!changeReason) return;
    setBusy(true);
    try {
      const step = await ensureStepUpToken();
      if (!step.ok) return;
      const response = await authFetch("/api/admin/operations/alerts", {
        method: "DELETE",
        headers: withStepUpHeaders(step.token, { "content-type": "application/json" }),
        body: JSON.stringify({ id: recipient.id, reason: changeReason }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Alert recipient could not be removed");
      onStatus("Alert recipient removed.");
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Alert recipient could not be removed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border-t theme-border pt-8" aria-labelledby="alert-settings-heading">
      <p className="font-mono text-micro uppercase tracking-widest theme-muted">notifications</p>
      <h3 id="alert-settings-heading" className="mt-2 font-serif text-2xl">
        Alerts and digests
      </h3>
      <p className="mt-3 max-w-2xl font-mono text-xs leading-relaxed theme-muted">
        Recipients must already own the verified mailbox. Alert emails contain minimal detail and
        link back to the authorised inbox. Times are UTC.
      </p>
      <form onSubmit={(event) => void save(event)} className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="font-mono text-xs">
          verified email
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-2 min-h-11 w-full border theme-border bg-background px-3"
          />
        </label>
        <label className="font-mono text-xs">
          event slugs (optional, comma separated)
          <input
            value={eventSlugs}
            onChange={(event) => setEventSlugs(event.target.value)}
            className="mt-2 min-h-11 w-full border theme-border bg-background px-3"
          />
        </label>
        <fieldset className="sm:col-span-2">
          <legend className="font-mono text-xs">categories</legend>
          <div className="mt-2 flex flex-wrap gap-3">
            {CATEGORIES.map((category) => (
              <label key={category} className="flex min-h-11 items-center gap-2 font-mono text-xs">
                <input
                  type="checkbox"
                  checked={categories.includes(category)}
                  onChange={() => toggleCategory(category)}
                />
                {category}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="font-mono text-xs">
          cadence
          <AppSelect
            value={cadence}
            onValueChange={(value) => setCadence(value as Recipient["cadence"])}
            options={[
              { value: "immediate", label: "immediate" },
              { value: "digest", label: "daily digest" },
            ]}
            variant="field"
            ariaLabel="Cadence"
            className="mt-2"
          />
        </label>
        <label className="font-mono text-xs">
          digest hour
          <input
            type="number"
            min={0}
            max={23}
            value={digestHour}
            disabled={cadence !== "digest"}
            onChange={(event) => setDigestHour(Number(event.target.value))}
            className="mt-2 min-h-11 w-full border theme-border bg-background px-3 disabled:opacity-50"
          />
        </label>
        <label className="font-mono text-xs">
          quiet from
          <input
            type="number"
            min={0}
            max={23}
            value={quietStart}
            onChange={(event) => setQuietStart(Number(event.target.value))}
            className="mt-2 min-h-11 w-full border theme-border bg-background px-3"
          />
        </label>
        <label className="font-mono text-xs">
          quiet until
          <input
            type="number"
            min={0}
            max={23}
            value={quietEnd}
            onChange={(event) => setQuietEnd(Number(event.target.value))}
            className="mt-2 min-h-11 w-full border theme-border bg-background px-3"
          />
        </label>
        <label className="flex min-h-11 items-center gap-2 font-mono text-xs">
          <input
            type="checkbox"
            checked={criticalOverride}
            onChange={(event) => setCriticalOverride(event.target.checked)}
          />
          allow critical alerts during quiet hours
        </label>
        <label className="flex min-h-11 items-center gap-2 font-mono text-xs">
          <input
            type="checkbox"
            checked={fallback}
            onChange={(event) => setFallback(event.target.checked)}
          />
          fallback recipient
        </label>
        <label className="font-mono text-xs sm:col-span-2">
          reason
          <input
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="mt-2 min-h-11 w-full border theme-border bg-background px-3"
          />
        </label>
        <button
          disabled={busy || categories.length === 0}
          className="min-h-11 border border-foreground px-4 font-mono text-xs hover:opacity-70 disabled:opacity-50"
        >
          save recipient
        </button>
      </form>
      <ul className="mt-6 divide-y border-y theme-border">
        {recipients.map((recipient) => (
          <li key={recipient.id} className="flex flex-wrap items-center gap-3 py-4">
            <div className="min-w-0 flex-1">
              <p className="font-serif">{recipient.emailHint}</p>
              <p className="mt-1 font-mono text-micro theme-muted">
                {recipient.cadence} · {recipient.categories.join(", ")} · {recipient.status}
              </p>
            </div>
            {recipient.status === "active" ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void test(recipient.id)}
                  className="min-h-11 font-mono text-xs underline hover:opacity-70 disabled:opacity-50"
                >
                  test
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void revoke(recipient)}
                  className="min-h-11 font-mono text-xs underline hover:opacity-70 disabled:opacity-50"
                >
                  remove
                </button>
              </>
            ) : null}
          </li>
        ))}
      </ul>
      <details className="mt-6 border-y theme-border py-4">
        <summary className="cursor-pointer font-mono text-xs">
          delivery history and failures
        </summary>
        <ul className="mt-3 divide-y theme-border">
          {deliveries.map((delivery) => (
            <li key={delivery.id} className="py-3 font-mono text-micro">
              <span>
                {delivery.status} · {delivery.recipientHint} · {delivery.subjectHint}
              </span>
              {delivery.lastError ? (
                <p className="mt-1 text-balance theme-muted">{delivery.lastError}</p>
              ) : null}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
