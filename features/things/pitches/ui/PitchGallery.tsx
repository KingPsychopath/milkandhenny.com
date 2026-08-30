import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AppImage } from "@/components/AppImage";
import { imagePlaceholderStyle } from "@/features/media/image";
import {
  forgetPitchCredential,
  listPitchCredentials,
  readLocalPitchDraft,
} from "../browser-store.client";
import { listPublishedPitchesFn, readOwnedPitchStatusFn } from "../pitches.functions";
import type {
  PersonalPitchSummary,
  PitchOperationalStatus,
  PitchOwnerCredential,
  PitchOwnerDeckState,
  PitchWallLoad,
} from "../types";
import { PitchDemoEntry } from "./PitchDemoEntry";
import { PitchRecovery } from "./PitchRecovery";

type DeviceDeck = PitchOwnerCredential & { state: PitchOwnerDeckState | "unknown" };

const DECK_STATE_LABEL: Record<DeviceDeck["state"], string> = {
  active: "offline copy",
  trashed: "in trash · can restore",
  gone: "local only",
  unknown: "not checked",
};

export function PitchGallery({
  initialWall,
  operationalStatus,
  personalPitches,
}: {
  initialWall: PitchWallLoad;
  operationalStatus: PitchOperationalStatus;
  personalPitches: PersonalPitchSummary[];
}) {
  const [query, setQuery] = useState("");
  const [pitches, setPitches] = useState(initialWall.pitches);
  const [loadError, setLoadError] = useState(initialWall.message ?? "");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [mine, setMine] = useState<DeviceDeck[]>([]);

  useEffect(() => {
    void listPitchCredentials()
      .then(async (credentials) => {
        const checked = await Promise.all(
          credentials.map(async (credential): Promise<DeviceDeck | null> => {
            const [status, local] = await Promise.all([
              readOwnedPitchStatusFn({
                data: { deckId: credential.deckId, ownerToken: credential.token },
              }).catch(() => null),
              readLocalPitchDraft(credential.deckId).catch(() => undefined),
            ]);
            // Only a definite "purged, and nothing here either" is worth forgetting
            // the editing key over. An unreachable server is not an answer.
            const state: DeviceDeck["state"] = status?.ok ? status.value.state : "unknown";
            if (state === "gone" && !local) {
              await forgetPitchCredential(credential.deckId).catch(() => undefined);
              return null;
            }
            return { ...credential, state };
          }),
        );
        setMine(
          checked
            .filter((credential): credential is DeviceDeck => Boolean(credential))
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
        );
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void listPublishedPitchesFn({ data: { search: query } })
        .then((result) => {
          if (result.wall.status !== "unavailable") setPitches(result.wall.pitches);
          setLoadError(result.wall.message ?? "");
        })
        .catch(() =>
          setLoadError("We could not refresh the wall. Your published pitches are still safe."),
        );
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, refreshVersion]);

  return (
    <main id="main" className="min-h-screen bg-background">
      <header className="mx-auto max-w-5xl px-6 pb-12 pt-16">
        <Link
          to="/things"
          className="inline-flex min-h-11 items-center px-2 font-mono text-xs theme-muted hover:opacity-60"
        >
          ← things
        </Link>
        <div className="mt-14 grid gap-8 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <p className="font-mono text-micro uppercase tracking-[0.2em] theme-muted">
              pitch night studio
            </p>
            <h1 className="mt-3 max-w-3xl font-serif text-5xl tracking-tight text-foreground sm:text-7xl">
              Make the room believe you.
            </h1>
            <p className="mt-5 max-w-xl font-serif text-lg leading-relaxed theme-muted">
              Six slides. Draw, type, paste pictures, and make the case for something gloriously
              unnecessary.
            </p>
          </div>
          <div className="grid min-w-56 gap-3">
            {operationalStatus.canWrite ? (
              <Link
                to="/things/pitches/new"
                className="inline-flex min-h-12 items-center justify-center bg-foreground px-7 font-mono text-sm text-background hover:opacity-80"
              >
                start a pitch →
              </Link>
            ) : (
              <div className="flex min-h-12 items-center justify-center border border-[var(--things-amber)] px-5 text-center font-mono text-xs text-foreground">
                new pitches are paused
              </div>
            )}
            <PitchDemoEntry />
            <Link
              to="/things/pitches/present"
              className="inline-flex min-h-12 items-center justify-center border-b theme-border-strong px-4 font-mono text-sm text-foreground hover:opacity-60"
            >
              present on a screen
            </Link>
          </div>
        </div>
      </header>

      {!operationalStatus.canWrite ? (
        <div
          className="border-y border-[var(--things-amber)] bg-[var(--selection-bg)] px-6 py-3 text-center font-mono text-xs text-[var(--selection-fg)]"
          role="status"
        >
          {operationalStatus.message}
        </div>
      ) : null}

      <section className="mx-auto max-w-5xl px-6 pb-24">
        {personalPitches.length > 0 ? (
          <div className="mb-8 border-y theme-border py-7">
            <p className="font-mono text-micro uppercase tracking-[0.16em] theme-muted">
              saved to your account
            </p>
            <div className="mt-4 flex flex-wrap gap-x-7 gap-y-3">
              {personalPitches.map((deck) => (
                <Link
                  key={deck.id}
                  to="/things/pitches/$deckId/edit"
                  params={{ deckId: deck.id }}
                  className="font-serif text-xl text-foreground underline decoration-border underline-offset-4 hover:opacity-60"
                >
                  {deck.title}
                </Link>
              ))}
            </div>
          </div>
        ) : null}

        {mine.length > 0 ? (
          <div className="mb-14 border-y theme-border py-7">
            <p className="font-mono text-micro uppercase tracking-[0.16em] theme-muted">
              on this device
            </p>
            <div className="mt-4 flex flex-wrap gap-x-7 gap-y-3">
              {mine.map((deck) => (
                <div key={deck.deckId}>
                  <Link
                    to="/things/pitches/$deckId/edit"
                    params={{ deckId: deck.deckId }}
                    className="font-serif text-xl text-foreground underline decoration-border underline-offset-4 hover:opacity-60"
                  >
                    {deck.title}
                  </Link>
                  <span className="ml-2 font-mono text-micro theme-muted">
                    {DECK_STATE_LABEL[deck.state]}
                  </span>
                </div>
              ))}
            </div>
            {mine.some((deck) => deck.state === "trashed") ? (
              <p className="mt-5 max-w-xl font-mono text-micro leading-relaxed theme-muted">
                “In trash” means the server still has the pitch, with its history, until it is
                deleted for good. Open it and restore it to carry on where you left off.
              </p>
            ) : null}
            {mine.some((deck) => deck.state === "gone") ? (
              <p className="mt-3 max-w-xl font-mono text-micro leading-relaxed theme-muted">
                “Local only” means the server copy is gone and nothing you type is being saved to
                it. Open it and rebuild it as a new pitch: the slides, drawings and images on this
                device come across. Video and sound cannot, because those lived only on the server.
              </p>
            ) : null}
            {mine.some((deck) => deck.state === "unknown") ? (
              <p className="mt-3 max-w-xl font-mono text-micro leading-relaxed theme-muted">
                “Not checked” means we could not reach the server for that pitch just now. The copy
                on this device is safe either way.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-col gap-5 border-b theme-border pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-micro uppercase tracking-[0.16em] theme-muted">
              sealed pitches
            </p>
            <h2 className="mt-2 font-serif text-3xl text-foreground">The wall</h2>
          </div>
          <label className="font-mono text-xs theme-muted">
            find a person or idea
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="mt-2 block min-h-11 w-full border-b theme-border-strong bg-transparent text-base text-foreground outline-none sm:w-72"
              type="search"
            />
          </label>
        </div>

        {loadError ? (
          <div
            className="my-10 border-y border-[var(--things-amber)] bg-[var(--selection-bg)] px-5 py-4 text-center"
            role="alert"
          >
            <p className="font-serif text-lg text-[var(--selection-fg)]">{loadError}</p>
            <button
              type="button"
              onClick={() => setRefreshVersion((current) => current + 1)}
              className="mt-3 min-h-11 border-b border-current px-3 font-mono text-xs text-[var(--selection-fg)] hover:opacity-60"
            >
              try again
            </button>
          </div>
        ) : null}

        {pitches.length > 0 ? (
          <div className="mt-8 columns-1 gap-6 sm:columns-2 lg:columns-3">
            {pitches.map((pitch) => (
              <Link
                key={pitch.id}
                to="/things/pitches/$deckId"
                params={{ deckId: pitch.id }}
                search={{ edition: undefined }}
                className="group mb-6 block break-inside-avoid border-b theme-border pb-5"
              >
                <div
                  className="media-image-placeholder relative aspect-square overflow-hidden bg-surface p-4"
                  style={imagePlaceholderStyle(pitch.thumbnail?.placeholder)}
                >
                  {pitch.thumbnail ? (
                    <AppImage
                      src={pitch.thumbnail.src}
                      srcSet={pitch.thumbnail.srcSet}
                      sources={pitch.thumbnail.sources}
                      alt=""
                      width={pitch.thumbnail.width}
                      height={pitch.thumbnail.height}
                      reveal
                      sizes="(min-width: 1024px) 30vw, (min-width: 640px) 45vw, calc(100vw - 3rem)"
                      className="app-image-hover-scale h-full w-full object-contain group-hover:scale-[1.02]"
                    />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-5 px-6 text-center">
                      <AppImage
                        src="/icon-192.png"
                        alt=""
                        width={192}
                        height={192}
                        className="h-16 w-16 rounded-2xl opacity-70"
                      />
                      <span className="font-serif text-2xl theme-subtle">{pitch.title}</span>
                    </div>
                  )}
                  <span className="absolute bottom-3 right-3 bg-background px-2 py-1 font-mono text-micro uppercase tracking-[0.12em] theme-muted">
                    sealed
                  </span>
                </div>
                <h3 className="mt-4 font-serif text-2xl text-foreground">{pitch.title}</h3>
                <p className="mt-1 font-mono text-xs theme-muted">
                  {pitch.ownerName} · {pitch.slideCount} slides
                </p>
              </Link>
            ))}
          </div>
        ) : !loadError ? (
          <p className="py-20 text-center font-serif text-2xl theme-muted">
            {query ? "No pitches match that search." : "The first pitch gets the whole wall."}
          </p>
        ) : null}

        {operationalStatus.canWrite ? (
          <div className="mx-auto mt-12 max-w-xl">
            <PitchRecovery />
          </div>
        ) : null}
      </section>
    </main>
  );
}
