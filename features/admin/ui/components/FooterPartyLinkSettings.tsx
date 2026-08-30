"use client";

import { useEffect, useId, useMemo, useState } from "react";

import { AppSelect } from "@/components/AppSelect";
import { eventPath } from "@/features/events/routes";
import { isPubliclyVisible, type EventRecord } from "@/features/events/types";
import {
  getAdminSiteSettingsFn,
  updateAdminSiteSettingsFn,
} from "@/features/site/site-settings.functions";
import { AdminStatus } from "./AdminStatus";

const AUTOMATIC = "__automatic__";
const CUSTOM = "__custom__";
const PARTY_GAME_PATH = "/things/spelling-party";

export function FooterPartyLinkSettings({
  events,
  onError,
  onStatus,
}: {
  events: readonly EventRecord[];
  onError: (message: string) => void;
  onStatus: (message: string) => void;
}) {
  const selectId = useId();
  const [savedPath, setSavedPath] = useState<string | null | undefined>(undefined);
  const [draftPath, setDraftPath] = useState<string | null | undefined>(undefined);
  const [effectivePath, setEffectivePath] = useState("");
  const [saving, setSaving] = useState(false);

  const options = useMemo(
    () => [
      { value: AUTOMATIC, label: "automatic — latest active event" },
      { value: PARTY_GAME_PATH, label: "party game" },
      ...events.filter(isPubliclyVisible).map((event) => ({
        value: eventPath(event.slug),
        label: `event — ${event.title}`,
      })),
      { value: CUSTOM, label: "custom local route…" },
    ],
    [events],
  );

  useEffect(() => {
    let cancelled = false;
    void getAdminSiteSettingsFn()
      .then((result) => {
        if (cancelled) return;
        if (!result.authorised) {
          onError("Your admin session has expired");
          return;
        }
        setSavedPath(result.settings.footerPartyPath);
        setDraftPath(result.settings.footerPartyPath);
        setEffectivePath(result.settings.effectivePartyPath);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          onError(error instanceof Error ? error.message : "Failed to load footer party link");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [onError]);

  const selectedValue =
    draftPath === undefined
      ? AUTOMATIC
      : draftPath === null
        ? AUTOMATIC
        : options.some((option) => option.value === draftPath)
          ? draftPath
          : CUSTOM;
  const customPath = selectedValue === CUSTOM ? (draftPath ?? "") : "";
  const busy = saving || draftPath === undefined;
  const canSave = selectedValue !== CUSTOM || Boolean(customPath.trim());
  const dirty = draftPath !== savedPath;

  const save = async () => {
    if (!canSave || !dirty) return;
    setSaving(true);
    onError("");
    try {
      const result = await updateAdminSiteSettingsFn({
        data: {
          footerPartyPath:
            selectedValue === CUSTOM
              ? customPath
              : selectedValue === AUTOMATIC
                ? null
                : selectedValue,
        },
      });
      if (!result.authorised) {
        onError("Your admin session has expired");
        return;
      }
      if (!result.ok) {
        onError(result.error);
        return;
      }
      setSavedPath(result.settings.footerPartyPath);
      setDraftPath(result.settings.footerPartyPath);
      setEffectivePath(result.settings.effectivePartyPath);
      onStatus("Footer party link saved");
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to save footer party link");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-y theme-border py-5">
      <p className="font-mono text-micro theme-muted tracking-wide">footer party link</p>
      <p className="mt-1 max-w-xl font-mono text-micro theme-faint">
        Choose where “the party” in the public footer goes. Automatic mode follows the latest
        published or sold-out event, then falls back to the existing party page.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div>
          <label htmlFor={selectId} className="font-mono text-micro theme-muted tracking-wide">
            destination
          </label>
          <AppSelect
            id={selectId}
            name="footerPartyDestination"
            value={selectedValue}
            onValueChange={(value) => {
              if (value === AUTOMATIC) setDraftPath(null);
              else if (value === CUSTOM) setDraftPath(selectedValue === CUSTOM ? draftPath : "");
              else setDraftPath(value);
            }}
            options={options}
            variant="field"
            disabled={busy}
            className="mt-1"
          />
        </div>
        <button
          type="button"
          disabled={busy || !dirty || !canSave}
          onClick={() => void save()}
          className="min-h-12 rounded-lg bg-foreground px-5 font-mono text-sm text-background disabled:opacity-40"
        >
          {saving ? "saving…" : "save"}
        </button>
      </div>

      {selectedValue === CUSTOM ? (
        <label className="mt-3 block">
          <span className="font-mono text-micro theme-muted tracking-wide">local route</span>
          <input
            name="footerPartyPath"
            value={customPath}
            onChange={(event) => setDraftPath(event.target.value)}
            placeholder="/events/my-event"
            inputMode="url"
            spellCheck={false}
            className="mt-1 min-h-12 w-full rounded-lg border theme-border bg-transparent px-4 font-mono text-base text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]"
          />
          <span className="mt-1 block font-mono text-micro theme-faint">
            Must stay on this site and begin with /.
          </span>
        </label>
      ) : null}

      <p className="mt-3 font-mono text-micro theme-muted" aria-live="polite">
        <AdminStatus tone={effectivePath ? (dirty ? "attention" : "positive") : "attention"}>
          {effectivePath
            ? dirty
              ? "unsaved destination change"
              : "live destination"
            : "loading destination"}
        </AdminStatus>{" "}
        · currently opens <span className="text-foreground">{effectivePath || "loading…"}</span>
      </p>
    </div>
  );
}
