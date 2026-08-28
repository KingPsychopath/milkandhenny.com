import { useState } from "react";

import { BrowserProfileHint } from "@/components/BrowserProfileHint";
import { EmailAddressNotice } from "@/components/EmailAddressNotice";
import { useBrowserProfileForm } from "@/lib/client/browser-profile";
import type { PitchCreatorIdentity, PitchOwnerDeckState } from "../types";

function purgeDate(value?: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleDateString();
}

/**
 * Shown when the server no longer has an editable copy of this pitch. Each state
 * gets the recovery it actually needs: Trash can be undone in place, a purged
 * pitch is rebuilt from this device, and an unreachable server is worth asking
 * again rather than declaring anything lost.
 */
export function PitchServerRestore({
  state,
  purgeAfter,
  creatorIdentity,
  restoring,
  error,
  canRebuild,
  mediaClipCount,
  onRestoreFromTrash,
  onRestoreToNewPitch,
  onRecheck,
}: {
  state: PitchOwnerDeckState | "unknown";
  purgeAfter?: string;
  creatorIdentity: PitchCreatorIdentity | null;
  restoring: boolean;
  error: string;
  canRebuild: boolean;
  mediaClipCount: number;
  onRestoreFromTrash: () => void;
  onRestoreToNewPitch: (input: { ownerName: string; ownerEmail: string }) => void;
  onRecheck: () => void;
}) {
  const { name, email, setName, setEmail, remember } = useBrowserProfileForm();
  const [formOpen, setFormOpen] = useState(false);

  if (state === "active") return null;

  const ownerName = creatorIdentity?.name ?? name;
  const ownerEmail = creatorIdentity?.email ?? email;
  const deleteOn = purgeDate(purgeAfter);

  return (
    <div
      className="border-b border-[var(--things-amber)] bg-[var(--selection-bg)] px-4 py-2 text-center font-mono text-xs text-[var(--selection-fg)]"
      role="status"
    >
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
        {state === "trashed" ? (
          <>
            <span>
              This pitch is in the Trash, so nothing you type here is reaching the server.
              {deleteOn ? ` The server copy is deleted for good after ${deleteOn}.` : ""}
            </span>
            <button
              type="button"
              disabled={restoring}
              onClick={onRestoreFromTrash}
              className="min-h-11 underline decoration-current underline-offset-4 hover:opacity-60 disabled:opacity-40"
            >
              {restoring ? "restoring…" : "restore this pitch"}
            </button>
          </>
        ) : state === "gone" ? (
          <>
            <span>
              The server copy of this pitch is gone. Your working copy is safe on this device and
              can be rebuilt as a new pitch.
              {mediaClipCount > 0
                ? ` ${mediaClipCount} video or sound clip${mediaClipCount === 1 ? "" : "s"} cannot come back — those lived only on the server.`
                : ""}
            </span>
            {canRebuild && !formOpen ? (
              <button
                type="button"
                onClick={() => setFormOpen(true)}
                className="min-h-11 underline decoration-current underline-offset-4 hover:opacity-60"
              >
                rebuild on the server
              </button>
            ) : null}
          </>
        ) : (
          <>
            <span>
              We could not check the server copy of this pitch. Your working copy is safe on this
              device.
            </span>
            <button
              type="button"
              disabled={restoring}
              onClick={onRecheck}
              className="min-h-11 underline decoration-current underline-offset-4 hover:opacity-60 disabled:opacity-40"
            >
              {restoring ? "checking…" : "check again"}
            </button>
          </>
        )}
      </div>

      {state === "gone" && canRebuild && formOpen ? (
        <form
          className="mx-auto mt-3 flex max-w-3xl flex-wrap items-end justify-center gap-x-4 gap-y-3 border-t border-current/30 pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!creatorIdentity) remember({ name: ownerName, email: ownerEmail });
            onRestoreToNewPitch({ ownerName, ownerEmail });
          }}
        >
          {creatorIdentity ? (
            <span>
              The new pitch is owned by your account ({creatorIdentity.email}), with the slides and
              images from this device.
            </span>
          ) : (
            <>
              <label className="text-left">
                <span className="block uppercase tracking-[0.14em]">your name</span>
                <input
                  value={name}
                  required
                  maxLength={80}
                  onChange={(event) => setName(event.target.value)}
                  className="mt-1 min-h-11 w-48 border-b border-current bg-transparent px-0 text-current outline-none"
                />
              </label>
              <div>
                <label className="text-left">
                  <span className="block uppercase tracking-[0.14em]">recovery email</span>
                  <input
                    value={email}
                    required
                    type="email"
                    autoComplete="email"
                    onChange={(event) => setEmail(event.target.value)}
                    className="mt-1 min-h-11 w-60 border-b border-current bg-transparent px-0 text-current outline-none"
                  />
                </label>
                <EmailAddressNotice email={email} onAcceptSuggestion={setEmail} />
              </div>
            </>
          )}
          <button
            type="submit"
            disabled={restoring}
            className="min-h-11 border border-current px-4 hover:opacity-60 disabled:opacity-40"
          >
            {restoring ? "rebuilding…" : "rebuild as a new pitch →"}
          </button>
          <button
            type="button"
            disabled={restoring}
            onClick={() => setFormOpen(false)}
            className="min-h-11 underline decoration-current underline-offset-4 hover:opacity-60 disabled:opacity-40"
          >
            cancel
          </button>
          {creatorIdentity ? null : (
            <div className="basis-full">
              <BrowserProfileHint />
            </div>
          )}
        </form>
      ) : null}

      {error ? (
        <p className="mt-2 font-semibold" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
