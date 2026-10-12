"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppSelect } from "@/components/AppSelect";
import { adminSonderEventQuery } from "@/features/sonder/admin.queries";
function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}
import type { SonderMode } from "@/features/sonder/types";
import type { previewSonderTeamEmails } from "@/features/sonder/sonder.server";

type Preview = Awaited<ReturnType<typeof previewSonderTeamEmails>>;
export function SonderEventPanel({
  slug,
  authFetch,
  canManage,
  canEmail,
  onError,
  onStatus,
  reload,
}: {
  slug: string;
  authFetch: (url: string, init?: RequestInit) => Promise<Response>;
  canManage: boolean;
  canEmail: boolean;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
  reload: () => Promise<void>;
}) {
  const queryClient = useQueryClient(),
    result = useQuery(adminSonderEventQuery(slug));
  const [busy, setBusy] = useState(false),
    [hangoutId, setHangoutId] = useState(""),
    [bookingUrl, setBookingUrl] = useState(""),
    [mode, setMode] = useState<SonderMode | "">(""),
    [confirmed, setConfirmed] = useState(false),
    [teamCount, setTeamCount] = useState("2"),
    [preview, setPreview] = useState<Preview | null>(null);
  async function act(body: Record<string, unknown>) {
    setBusy(true);
    onError("");
    try {
      const response = await authFetch(`/api/admin/events/${encodeURIComponent(slug)}/sonder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data: {
        error?: string;
        preview?: Preview;
        sent?: { queued: number; skipped: number };
      } = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Sonder operation failed");
      setPreview(data.preview ?? null);
      onStatus(
        data.sent
          ? `${data.sent.queued} team emails queued${data.sent.skipped ? ` · ${data.sent.skipped} suppressed recipients skipped` : ""}`
          : body.action === "preview"
            ? "Team emails ready for review"
            : "Sonder event updated",
      );
      await queryClient.invalidateQueries({ queryKey: adminSonderEventQuery(slug).queryKey });
      await reload();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Sonder operation failed");
    } finally {
      setBusy(false);
    }
  }
  const view = result.data;
  if (result.isPending)
    return (
      <p className="font-mono text-xs" role="status">
        loading Sonder details…
      </p>
    );
  if (result.error)
    return (
      <p role="alert">
        Sonder details could not be loaded.{" "}
        <button
          type="button"
          className="mh-action mh-action--quiet"
          onClick={() => void result.refetch()}
        >
          try again
        </button>
      </p>
    );
  if (!view)
    return (
      <section className="space-y-4 font-mono text-xs">
        <h3 className="text-sm">Sonder for this occurrence</h3>
        <p>
          Other events keep Milk &amp; Henny ticketing. This occurrence must have no native ticket,
          checkout or waitlist history.
        </p>
        {canManage && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void act({ action: "configure", hangoutId, mode, bookingUrl });
            }}
          >
            <label className="block">
              hangout UUID
              <input
                required
                value={hangoutId}
                onChange={(e) => setHangoutId(e.target.value)}
                className="block w-full border theme-border bg-background px-3 py-2"
              />
            </label>
            <label className="block">
              public Sonder booking URL
              <input
                required
                type="url"
                value={bookingUrl}
                onChange={(e) => setBookingUrl(e.target.value)}
                className="block w-full border theme-border bg-background px-3 py-2"
              />
            </label>
            <AppSelect
              ariaLabel="Sonder mode"
              value={mode}
              options={[
                { value: "", label: "choose deployment mode" },
                { value: "test", label: "test" },
                { value: "live", label: "live" },
              ]}
              onValueChange={(value) => {
                if (value === "live" || value === "test") setMode(value);
              }}
            />
            <label className="flex gap-2 items-center min-h-11">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              Use Sonder for sales and admission for this occurrence.
            </label>
            <button className="mh-action mh-action--primary" disabled={busy || !confirmed || !mode}>
              save Sonder mapping
            </button>
          </form>
        )}
      </section>
    );
  return (
    <section className="mt-4 space-y-5 font-mono text-xs">
      <div>
        <h3 className="text-base">Sonder orders, teams &amp; colours</h3>
        <p className="mt-2 theme-muted">
          {view.mapping.mode} · Sonder handles sales, refunds and door scanning. Booking groups stay
          together.
        </p>
      </div>
      <p role="status">
        {view.mapping.cancelledAt
          ? "cancelled — all admissions inactive"
          : view.fresh
            ? "synced"
            : "needs sync"}{" "}
        · last full sync:{" "}
        {view.lastSyncAt ? new Date(view.lastSyncAt).toLocaleString("en-GB") : "never"}
        {view.lastError ? ` · ${view.lastError}` : ""}
      </p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Object.entries(view.counts).map(([label, count]) => (
          <div key={label}>
            <p className="theme-muted">{label.replace(/([A-Z])/g, " $1").toLowerCase()}</p>
            <p className="text-xl">{count}</p>
          </div>
        ))}
      </div>
      {!!view.delivery.length && (
        <p role="status">
          Team email delivery:{" "}
          {view.delivery.map((row) => `${row.count} ${row.status}`).join(" · ")}. Cancelled messages
          need a fresh preview.
        </p>
      )}
      {Object.entries(view.currencyTotals).map(([currency, total]) => (
        <p key={currency}>
          {formatMoney(total.grossMinor, currency)} gross ·{" "}
          {formatMoney(total.refundedMinor, currency)} refunded · settlement and fees are in
          Sonder/Stripe
        </p>
      ))}
      {canManage && (
        <div className="flex flex-wrap gap-3 items-center">
          <button
            type="button"
            className="mh-action mh-action--secondary"
            disabled={busy}
            onClick={() => void act({ action: "sync" })}
          >
            sync now
          </button>
          <AppSelect
            ariaLabel="Number of teams"
            value={teamCount}
            options={[2, 3, 4].map((n) => ({ value: String(n), label: `${n} teams` }))}
            onValueChange={setTeamCount}
          />
          <button
            type="button"
            className="mh-action mh-action--secondary"
            disabled={busy || !view.fresh || !!view.mapping.cancelledAt}
            onClick={() =>
              void act({
                action: "allocate",
                ...(view.orders.some((o) => o.teamId) ? {} : { teamCount: Number(teamCount) }),
              })
            }
          >
            allocate unassigned bookings
          </button>
        </div>
      )}
      <ul className="flex flex-wrap gap-4">
        {view.teams.map((team) => (
          <li key={team.id}>
            {team.name} · {team.colour_key} · {team.size} guests
          </li>
        ))}
      </ul>
      <p className="theme-muted">
        A booking group may make teams uneven. Allocation adds new groups without reshuffling people
        already assigned. Purchaser contacts are not individual guest identities.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <caption className="text-left mb-3">bookings</caption>
          <thead>
            <tr>
              {["purchaser", "tickets / checked in", "team", "review"].map((label) => (
                <th className="py-2" key={label}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.orders.map((order) => (
              <tr key={order.id} className="border-t theme-border">
                <td className="py-3 pr-4">
                  {order.purchaser.name ?? "Purchaser"}
                  <br />
                  <span className="theme-muted">{order.purchaser.email || "contact removed"}</span>
                  <br />
                  <span className="theme-muted">
                    {order.id.slice(-8)} · {order.ticketType}
                  </span>
                </td>
                <td>
                  {order.active} active / {order.checkedIn} checked in
                </td>
                <td>
                  {canManage ? (
                    <AppSelect
                      ariaLabel={`Team for booking ${order.id.slice(-8)}`}
                      value={order.teamId ?? ""}
                      options={[
                        { value: "", label: "unassigned", disabled: true },
                        ...view.teams.map((team) => ({ value: team.id, label: team.name })),
                      ]}
                      disabled={busy || !view.fresh || !!view.mapping.cancelledAt}
                      onValueChange={(teamId) =>
                        void act({ action: "assign", orderId: order.id, teamId })
                      }
                    />
                  ) : (
                    (view.teams.find((t) => t.id === order.teamId)?.name ?? "unassigned")
                  )}
                </td>
                <td>
                  {order.needsReview ? "needs review" : "—"}
                  {canManage && order.canReview && (
                    <button
                      type="button"
                      className="mh-action mh-action--quiet"
                      disabled={busy || !view.fresh}
                      onClick={() => {
                        if (
                          window.confirm(
                            "Accept this booking’s current Sonder status? This does not change Sonder or issue a ticket.",
                          )
                        )
                          void act({
                            action: "review",
                            orderId: order.id,
                            revision: order.revision,
                          });
                      }}
                    >
                      accept current state
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEmail && (
        <div className="border-t theme-border pt-4 space-y-3">
          <p>
            Team emails go to purchasers to share with their booking group. No admission QR is
            issued here.
          </p>
          <button
            type="button"
            className="mh-action mh-action--secondary"
            disabled={busy || !view.fresh || !!view.mapping.cancelledAt}
            onClick={() => void act({ action: "preview" })}
          >
            preview team emails
          </button>
          {!view.emailsEnabled && (
            <p className="theme-muted">Guest sends are disabled until live setup is verified.</p>
          )}
          {preview && (
            <div className="space-y-4">
              <p>
                {preview.recipients.length} booking recipients. Identical emails already queued or
                accepted are skipped.
              </p>
              {preview.recipients.map((item) => (
                <article key={item.orderId} className="border-t theme-border pt-3">
                  <h4>
                    {item.to} · {item.rendered.subject}
                  </h4>
                  <pre className="whitespace-pre-wrap font-mono text-xs mt-2">
                    {item.rendered.text}
                  </pre>
                </article>
              ))}
              <button
                type="button"
                className="mh-action mh-action--primary"
                disabled={busy || !view.emailsEnabled || !preview.recipients.length}
                onClick={() => {
                  if (
                    window.confirm(
                      `Queue these team emails to ${preview.recipients.length} purchasers?`,
                    )
                  )
                    void act({ action: "send", previewRevision: preview.revision });
                }}
              >
                queue reviewed team emails
              </button>
            </div>
          )}
        </div>
      )}
      <a className="mh-action mh-action--quiet" href={view.mapping.bookingUrl}>
        open Sonder booking page
      </a>
    </section>
  );
}
