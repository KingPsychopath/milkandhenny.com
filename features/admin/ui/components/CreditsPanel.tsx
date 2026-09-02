"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { AppSelect } from "@/components/AppSelect";
import { AdminLoadError, AdminLoading } from "./AdminLoadState";
import { AdminStatus } from "./AdminStatus";

type AuthFetch = (url: string, options?: RequestInit) => Promise<Response>;
type Campaign = {
  id: string;
  campaignKey: string;
  name: string;
  amountMinor: number;
  currency: string;
  claimExpiresAt: string;
  status: string;
  recipients: number;
  units: number;
  claimedRecipients: number;
  claimedUnits: number;
  redeemedUnits: number;
  revokedRecipients: number;
  redemptionEventSlug: string | null;
  redeemExpiresAt: string | null;
};
type Grant = {
  id: string;
  email: string;
  displayName: string | null;
  units: number;
  reservedUnits: number;
  redeemedUnits: number;
  remainingUnits: number;
  claimedAt: string | null;
  revokedAt: string | null;
};
type EventOption = { slug: string; title: string; startsAt: string };

function money(minor: number, currency: string) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}

export function CreditsPanel({
  authFetch,
  onError,
  onStatus,
}: {
  authFetch: AuthFetch;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
}) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [grantDraft, setGrantDraft] = useState({ email: "", displayName: "", units: "1" });
  const [redemptionDraft, setRedemptionDraft] = useState({ eventSlug: "", expiresAt: "" });
  const [draft, setDraft] = useState({
    campaignKey: "",
    name: "",
    reason: "",
    sourceEventSlug: "",
    ticketTypeId: "",
    amount: "5",
    claimExpiresAt: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authFetch("/api/admin/credits");
      const data = (await response.json()) as {
        campaigns?: Campaign[];
        events?: EventOption[];
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "Could not load credits");
      setCampaigns(data.campaigns || []);
      setEvents(data.events || []);
      setLoadError("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load credits";
      setLoadError(message);
      onError(message);
    } finally {
      setLoading(false);
    }
  }, [authFetch, onError]);

  useEffect(() => void load(), [load]);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await authFetch("/api/admin/credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create-from-tickets",
          ...draft,
          amountMinor: Math.round(Number(draft.amount) * 100),
          currency: "GBP",
          claimExpiresAt: new Date(draft.claimExpiresAt).toISOString(),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not create campaign");
      onStatus("Credit campaign created from the current valid tickets. Nothing was emailed.");
      setOpen(false);
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not create campaign");
    } finally {
      setBusy(false);
    }
  }

  async function toggleCampaign(campaignId: string) {
    if (expanded === campaignId) {
      setExpanded(null);
      return;
    }
    setBusy(true);
    try {
      const response = await authFetch(
        `/api/admin/credits?campaignId=${encodeURIComponent(campaignId)}`,
      );
      const data = (await response.json()) as { grants?: Grant[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Could not load recipients");
      setGrants(data.grants || []);
      const campaign = campaigns.find((item) => item.id === campaignId);
      setRedemptionDraft({
        eventSlug: campaign?.redemptionEventSlug ?? "",
        expiresAt: campaign?.redeemExpiresAt?.slice(0, 16) ?? "",
      });
      setExpanded(campaignId);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not load recipients");
    } finally {
      setBusy(false);
    }
  }

  async function saveRedemptionEvent(campaignId: string) {
    setBusy(true);
    try {
      const response = await authFetch("/api/admin/credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set-redemption-event",
          campaignId,
          eventSlug: redemptionDraft.eventSlug || null,
          redeemExpiresAt: redemptionDraft.expiresAt
            ? new Date(redemptionDraft.expiresAt).toISOString()
            : null,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not update redemption");
      onStatus(
        redemptionDraft.eventSlug
          ? "Credits will apply automatically to that event, one unit per admission ticket."
          : "Automatic redemption is paused until an event is selected.",
      );
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not update redemption");
    } finally {
      setBusy(false);
    }
  }

  async function updateGrant(action: "grant" | "revoke", campaignId: string, email?: string) {
    setBusy(true);
    try {
      const response = await authFetch("/api/admin/credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "grant"
            ? { action, campaignId, ...grantDraft, units: Number(grantDraft.units) }
            : { action, campaignId, email },
        ),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not update recipient");
      onStatus(action === "grant" ? "Credit recipient saved." : "Credit revoked.");
      setGrantDraft({ email: "", displayName: "", units: "1" });
      setExpanded(null);
      await toggleCampaign(campaignId);
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not update recipient");
    } finally {
      setBusy(false);
    }
  }

  async function copyClaimLink(campaignId: string, email: string) {
    setBusy(true);
    try {
      const response = await authFetch("/api/admin/credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "claim-link", campaignId, email }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!response.ok || !data.url) throw new Error(data.error || "Could not create claim link");
      await navigator.clipboard.writeText(data.url);
      onStatus("A fresh private claim link was copied. Any earlier unused link is now closed.");
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not copy claim link");
    } finally {
      setBusy(false);
    }
  }

  if (loading && campaigns.length === 0) return <AdminLoading label="Loading credit campaigns…" />;
  if (loadError && campaigns.length === 0)
    return <AdminLoadError message={loadError} retry={() => void load()} retrying={loading} />;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4 border-y theme-border py-5">
        <div>
          <p className="font-mono text-micro uppercase tracking-widest theme-muted">
            attendee credits
          </p>
          <h2 className="mt-2 font-serif text-3xl">Promises you can account for.</h2>
          <p className="mt-2 max-w-2xl font-mono text-xs leading-relaxed theme-muted">
            Issue one credit unit per eligible ticket. Claim links are private and one-use; creating
            a campaign never sends an email.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="mh-action mh-action--secondary"
        >
          {open ? "close" : "new campaign"}
        </button>
      </header>

      {open ? (
        <form onSubmit={create} className="grid gap-4 border-b theme-border pb-6 sm:grid-cols-2">
          {[
            ["campaignKey", "campaign key", "after-school-food-thanks"],
            ["name", "name", "Food-ticket thank you"],
            ["sourceEventSlug", "source event", "after-school-club-2026-09-01"],
            ["ticketTypeId", "eligible ticket type", "standard"],
            ["amount", "credit per ticket (£)", "5"],
          ].map(([key, label, placeholder]) => (
            <label key={key} className="font-mono text-xs theme-muted">
              {label}
              <input
                required
                value={draft[key as keyof typeof draft]}
                onChange={(event) => setDraft((value) => ({ ...value, [key]: event.target.value }))}
                placeholder={placeholder}
                className="mt-2 min-h-11 w-full rounded-md border theme-border bg-transparent px-3 text-foreground"
              />
            </label>
          ))}
          <label className="font-mono text-xs theme-muted">
            claim by
            <input
              required
              type="datetime-local"
              value={draft.claimExpiresAt}
              onChange={(event) =>
                setDraft((value) => ({ ...value, claimExpiresAt: event.target.value }))
              }
              className="mt-2 min-h-11 w-full rounded-md border theme-border bg-transparent px-3 text-foreground"
            />
          </label>
          <label className="font-mono text-xs theme-muted sm:col-span-2">
            reason / audit note
            <textarea
              value={draft.reason}
              onChange={(event) => setDraft((value) => ({ ...value, reason: event.target.value }))}
              className="mt-2 min-h-24 w-full rounded-md border theme-border bg-transparent p-3 text-foreground"
            />
          </label>
          <button disabled={busy} className="mh-action mh-action--primary sm:col-span-2 sm:w-fit">
            {busy ? "creating…" : "create without sending"}
          </button>
        </form>
      ) : null}

      <div className="border-t theme-border">
        {campaigns.length === 0 ? (
          <p className="py-8 font-mono text-xs theme-muted">No credit campaigns yet.</p>
        ) : (
          campaigns.map((campaign) => (
            <article key={campaign.id} className="border-b theme-border py-5">
              <button
                type="button"
                onClick={() => void toggleCampaign(campaign.id)}
                aria-expanded={expanded === campaign.id}
                className="grid min-h-11 w-full gap-4 text-left sm:grid-cols-[1fr_auto]"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="font-serif text-2xl">{campaign.name}</h3>
                    <AdminStatus tone={campaign.status === "active" ? "positive" : "neutral"}>
                      {campaign.status}
                    </AdminStatus>
                  </div>
                  <p className="mt-2 font-mono text-xs theme-muted">
                    {money(campaign.amountMinor, campaign.currency)} per ticket · {campaign.units}{" "}
                    units across {campaign.recipients} people
                  </p>
                  <p className="mt-1 font-mono text-xs theme-muted">
                    {campaign.claimedRecipients} claimed · {campaign.claimedUnits} units saved ·{" "}
                    {campaign.redeemedUnits} redeemed · {campaign.revokedRecipients} revoked
                  </p>
                </div>
                <div className="text-left font-mono text-xs sm:text-right">
                  <p className="theme-faint">maximum promise</p>
                  <p className="mt-1 text-lg">
                    {money(campaign.amountMinor * campaign.units, campaign.currency)}
                  </p>
                  <p className="mt-1 theme-muted">
                    claim by {new Date(campaign.claimExpiresAt).toLocaleDateString("en-GB")}
                  </p>
                  <p className="mt-2 underline underline-offset-4">
                    {expanded === campaign.id ? "close recipients" : "manage recipients"}
                  </p>
                </div>
              </button>
              {expanded === campaign.id ? (
                <div className="mt-5 border-t theme-border pt-5">
                  <section aria-labelledby={`redemption-${campaign.id}`}>
                    <h4 id={`redemption-${campaign.id}`} className="font-serif text-xl">
                      Where these credits work
                    </h4>
                    <p className="mt-2 max-w-2xl font-mono text-xs leading-relaxed theme-muted">
                      Select the next event when it exists. Checkout then applies at most one credit
                      unit to each admission ticket; no event selected means nothing is deducted.
                    </p>
                    <div className="admin-form-row mt-4 grid gap-3 sm:grid-cols-[1fr_15rem_auto] sm:items-end">
                      <label className="font-mono text-xs theme-muted">
                        eligible event
                        <AppSelect
                          value={redemptionDraft.eventSlug}
                          onValueChange={(eventSlug) =>
                            setRedemptionDraft((value) => ({ ...value, eventSlug }))
                          }
                          options={[
                            { value: "", label: "not selected — redemption paused" },
                            ...events.map((event) => ({ value: event.slug, label: event.title })),
                          ]}
                          ariaLabel="eligible redemption event"
                          variant="field"
                          className="mt-2"
                        />
                      </label>
                      <label className="font-mono text-xs theme-muted">
                        use by (optional)
                        <input
                          type="datetime-local"
                          value={redemptionDraft.expiresAt}
                          onChange={(event) =>
                            setRedemptionDraft((value) => ({
                              ...value,
                              expiresAt: event.target.value,
                            }))
                          }
                          className="mt-2 min-h-11 w-full rounded-md border theme-border bg-transparent px-3 text-foreground"
                        />
                      </label>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void saveRedemptionEvent(campaign.id)}
                        className="mh-action mh-action--primary"
                      >
                        save redemption
                      </button>
                    </div>
                  </section>
                  <div className="my-6 border-t theme-border" />
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void updateGrant("grant", campaign.id);
                    }}
                    className="grid gap-3 sm:grid-cols-[1fr_1fr_7rem_auto] sm:items-end"
                  >
                    <label className="font-mono text-xs theme-muted">
                      email
                      <input
                        type="email"
                        required
                        value={grantDraft.email}
                        onChange={(event) =>
                          setGrantDraft((value) => ({ ...value, email: event.target.value }))
                        }
                        className="mt-2 min-h-11 w-full rounded-md border theme-border bg-transparent px-3 text-foreground"
                      />
                    </label>
                    <label className="font-mono text-xs theme-muted">
                      name (optional)
                      <input
                        value={grantDraft.displayName}
                        onChange={(event) =>
                          setGrantDraft((value) => ({ ...value, displayName: event.target.value }))
                        }
                        className="mt-2 min-h-11 w-full rounded-md border theme-border bg-transparent px-3 text-foreground"
                      />
                    </label>
                    <label className="font-mono text-xs theme-muted">
                      units
                      <input
                        type="number"
                        min="1"
                        max="100"
                        required
                        value={grantDraft.units}
                        onChange={(event) =>
                          setGrantDraft((value) => ({ ...value, units: event.target.value }))
                        }
                        className="mt-2 min-h-11 w-full rounded-md border theme-border bg-transparent px-3 text-foreground"
                      />
                    </label>
                    <button disabled={busy} className="mh-action mh-action--secondary">
                      add / update
                    </button>
                  </form>
                  <div className="mt-4 divide-y theme-border-faint border-y theme-border">
                    {grants.map((grant) => (
                      <div
                        key={grant.id}
                        className="flex flex-wrap items-center justify-between gap-3 py-3 font-mono text-xs"
                      >
                        <div>
                          <p>{grant.displayName || grant.email}</p>
                          <p className="mt-1 theme-muted">
                            {grant.displayName ? `${grant.email} · ` : ""}
                            {grant.remainingUnits} remaining of {grant.units} ·{" "}
                            {grant.reservedUnits ? `${grant.reservedUnits} in checkout · ` : ""}
                            {grant.redeemedUnits ? `${grant.redeemedUnits} used · ` : ""}
                            {grant.revokedAt
                              ? "revoked"
                              : grant.claimedAt
                                ? "claimed"
                                : "not claimed"}
                          </p>
                        </div>
                        {!grant.revokedAt ? (
                          <div className="flex items-center gap-4">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void copyClaimLink(campaign.id, grant.email)}
                              className="min-h-11 underline underline-offset-4"
                            >
                              copy claim link
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void updateGrant("revoke", campaign.id, grant.email)}
                              className="min-h-11 underline underline-offset-4 theme-muted"
                            >
                              revoke
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </article>
          ))
        )}
      </div>
    </div>
  );
}
