"use client";

import type { ShareLink, ShareStateFilter } from "../types";

function isExpiredShare(link: ShareLink): boolean {
  return new Date(link.expiresAt).getTime() <= Date.now();
}

type WordShareSectionProps = {
  shares: ShareLink[];
  filteredShares: ShareLink[];
  shareStateFilter: ShareStateFilter;
  newShareExpiryDays: number;
  shareExpiryOptions: readonly number[];
  onShareStateFilterChange: (value: ShareStateFilter) => void;
  onNewShareExpiryDaysChange: (value: number) => void;
  onCreateShare: () => void;
  onCopyShareLink: (link: ShareLink) => void;
  onRotateShare: (link: ShareLink) => void;
  onExtendShare: (link: ShareLink) => void;
  onToggleSharePin: (link: ShareLink) => void;
  onRevokeShare: (link: ShareLink) => void;
};

export function WordShareSection({
  shares,
  filteredShares,
  shareStateFilter,
  newShareExpiryDays,
  shareExpiryOptions,
  onShareStateFilterChange,
  onNewShareExpiryDaysChange,
  onCreateShare,
  onCopyShareLink,
  onRotateShare,
  onExtendShare,
  onToggleSharePin,
  onRevokeShare,
}: WordShareSectionProps) {
  return (
    <div className="border theme-border rounded-md p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-mono text-xs theme-muted">share links</h2>
        <div className="flex items-center gap-2">
          <label className="font-mono text-micro theme-muted" htmlFor="share-expiry-days">
            expires
          </label>
          <select
            id="share-expiry-days"
            value={newShareExpiryDays}
            onChange={(event) => onNewShareExpiryDaysChange(Number(event.target.value))}
            className="font-mono text-xs bg-transparent border theme-border rounded px-2 py-1"
          >
            {shareExpiryOptions.map((days) => (
              <option key={days} value={days}>
                {days}d
              </option>
            ))}
          </select>
          <button type="button" onClick={onCreateShare} className="font-mono text-xs underline">
            create share link
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {(["all", "active", "expired", "revoked"] as const).map((state) => (
          <button
            key={state}
            type="button"
            onClick={() => onShareStateFilterChange(state)}
            className={`font-mono text-xs px-2 py-1 rounded border transition-colors ${
              shareStateFilter === state
                ? "border-[var(--foreground)] text-[var(--foreground)]"
                : "theme-border theme-muted hover:text-[var(--foreground)]"
            }`}
          >
            {state}
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {filteredShares.length === 0 ? (
          <p className="font-mono text-xs theme-muted">
            {shares.length === 0 ? "no share links" : "no links match this filter"}
          </p>
        ) : (
          filteredShares.map((link) => {
            const isExpired = isExpiredShare(link);
            const isRevoked = !!link.revokedAt;
            const canManagePin = !isExpired && !isRevoked;
            const statusLabel = isRevoked ? "revoked" : isExpired ? "expired" : "active";
            return (
              <div key={link.id} className="border theme-border rounded p-3">
                <p className="font-mono text-xs">{link.id}</p>
                <p className="font-mono text-micro theme-muted mt-1">
                  expires {new Date(link.expiresAt).toLocaleString()} · {statusLabel} ·{" "}
                  {link.pinRequired ? "pin on" : "pin off"}
                </p>
                <div className="mt-2 flex flex-wrap gap-3 font-mono text-xs">
                  {!isRevoked ? (
                    <button type="button" onClick={() => onCopyShareLink(link)} className="underline">
                      copy link
                    </button>
                  ) : null}
                  {!isRevoked ? (
                    <button type="button" onClick={() => onRotateShare(link)} className="underline">
                      reissue url
                    </button>
                  ) : null}
                  {!isRevoked ? (
                    <button type="button" onClick={() => onExtendShare(link)} className="underline">
                      extend
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onToggleSharePin(link)}
                    disabled={!canManagePin}
                    className="underline disabled:no-underline disabled:opacity-50"
                    title={canManagePin ? undefined : "PIN can only be changed while the link is active."}
                  >
                    {link.pinRequired ? "remove pin" : "require pin"}
                  </button>
                  {!isRevoked ? (
                    <button
                      type="button"
                      onClick={() => onRevokeShare(link)}
                      className="text-[var(--prose-hashtag)]"
                    >
                      revoke
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

