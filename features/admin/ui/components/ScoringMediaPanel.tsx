import { useState } from "react";

import type { ScoringAction, ScoringData } from "./event-scoring-types";

export function ScoringMediaPanel({
  data,
  onAction,
}: {
  data: ScoringData;
  onAction: ScoringAction;
}) {
  const [storageRef, setStorageRef] = useState("");
  const [visibility, setVisibility] = useState<"event-album" | "admin-evidence" | "discard">(
    "event-album",
  );
  const [consentState, setConsentState] = useState<
    "not-requested" | "requested" | "obtained" | "declined"
  >("requested");
  return (
    <section aria-labelledby="scoring-media-heading" className="border-t theme-border pt-6">
      <h4 id="scoring-media-heading" className="font-serif text-xl">
        Activity photographs
      </h4>
      <p className="mt-2 font-mono text-xs theme-muted">
        A score commits before its optional photo. A failed media upload cannot remove or duplicate
        points.
      </p>
      {data.mediaDrop ? (
        <p className="mt-3 font-mono text-xs">
          Album expires {new Date(data.mediaDrop.expiresAt).toLocaleString()}.{" "}
          {data.mediaDrop.uploadPath && (
            <a
              href={data.mediaDrop.uploadPath}
              target="_blank"
              rel="noreferrer"
              className="underline hover:opacity-70"
            >
              upload through the event media pipeline
            </a>
          )}{" "}
          <a
            href={data.mediaDrop.albumPath}
            target="_blank"
            rel="noreferrer"
            className="ml-3 underline hover:opacity-70"
          >
            open album
          </a>
        </p>
      ) : (
        <p className="mt-3 font-mono text-xs theme-muted">
          Enable the event media drop to capture new files.
        </p>
      )}
      <form
        className="mt-4 grid gap-4 sm:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          void onAction({
            action: "link-media",
            storageRef,
            visibility,
            consentState,
            expiresAt: data.mediaDrop?.expiresAt,
          }).then((result) => {
            if (result) setStorageRef("");
          });
        }}
      >
        <label className="font-mono text-xs">
          existing stored media reference
          <input
            required
            value={storageRef}
            onChange={(event) => setStorageRef(event.target.value)}
            className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
          />
        </label>
        <label className="font-mono text-xs">
          visibility
          <select
            value={visibility}
            onChange={(event) => setVisibility(event.target.value as typeof visibility)}
            className="mt-2 min-h-11 w-full border theme-border bg-background px-3"
          >
            <option value="event-album">event album</option>
            <option value="admin-evidence">admin evidence</option>
            <option value="discard">discard</option>
          </select>
        </label>
        <label className="font-mono text-xs">
          consent
          <select
            value={consentState}
            onChange={(event) => setConsentState(event.target.value as typeof consentState)}
            className="mt-2 min-h-11 w-full border theme-border bg-background px-3"
          >
            <option value="not-requested">not requested</option>
            <option value="requested">requested</option>
            <option value="obtained">obtained</option>
            <option value="declined">declined</option>
          </select>
        </label>
        <button className="min-h-11 border border-foreground px-4 font-mono text-xs hover:opacity-70">
          attach existing photo
        </button>
      </form>
      <ul className="mt-5 divide-y theme-border border-y theme-border">
        {data.media
          .filter((item) => !item.deletedAt)
          .map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-3 py-3 font-mono text-xs">
              <span className="min-w-0 flex-1 truncate">{item.storageRef}</span>
              <span className="theme-muted">
                {item.visibility} · {item.consentState}
              </span>
              <button
                type="button"
                onClick={() => void onAction({ action: "delete-media", mediaId: item.id })}
                className="min-h-11 px-2 underline hover:opacity-70"
              >
                remove link
              </button>
            </li>
          ))}
      </ul>
    </section>
  );
}
