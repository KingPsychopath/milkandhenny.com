import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { listPitchCredentials } from "../browser-store.client";
import { listPublishedPitchesFn } from "../pitches.functions";
import type { PitchOwnerCredential, PublicPitchDeck } from "../types";
import { PitchRecovery } from "./PitchRecovery";

export function PitchGallery({ initialPitches }: { initialPitches: PublicPitchDeck[] }) {
  const [query, setQuery] = useState("");
  const [pitches, setPitches] = useState(initialPitches);
  const [mine, setMine] = useState<PitchOwnerCredential[]>([]);

  useEffect(() => {
    void listPitchCredentials()
      .then((credentials) =>
        setMine(credentials.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))),
      )
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void listPublishedPitchesFn({ data: { search: query } })
        .then((result) => setPitches(result.pitches))
        .catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  return (
    <main id="main" className="min-h-screen bg-background">
      <header className="mx-auto max-w-5xl px-6 pb-12 pt-16">
        <Link to="/things" className="font-mono text-xs theme-muted hover:opacity-60">
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
          <Link
            to="/things/pitches/new"
            className="inline-flex min-h-12 items-center justify-center bg-foreground px-7 font-mono text-sm text-background hover:opacity-80"
          >
            start a pitch →
          </Link>
          <Link
            to="/things/pitches/present"
            className="inline-flex min-h-12 items-center justify-center border-b theme-border-strong px-4 font-mono text-sm text-foreground hover:opacity-60"
          >
            present on a screen
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 pb-24">
        {mine.length > 0 ? (
          <div className="mb-14 border-y theme-border py-7">
            <p className="font-mono text-micro uppercase tracking-[0.16em] theme-muted">
              on this device
            </p>
            <div className="mt-4 flex flex-wrap gap-x-7 gap-y-3">
              {mine.map((deck) => (
                <Link
                  key={deck.deckId}
                  to="/things/pitches/$deckId/edit"
                  params={{ deckId: deck.deckId }}
                  className="font-serif text-xl text-foreground underline decoration-border underline-offset-4 hover:opacity-60"
                >
                  {deck.title}
                </Link>
              ))}
            </div>
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
              className="mt-2 block min-h-10 w-full border-b theme-border-strong bg-transparent text-foreground outline-none sm:w-72"
              type="search"
            />
          </label>
        </div>

        {pitches.length > 0 ? (
          <div className="mt-8 columns-1 gap-6 sm:columns-2 lg:columns-3">
            {pitches.map((pitch) => (
              <Link
                key={pitch.id}
                to="/things/pitches/$deckId"
                params={{ deckId: pitch.id }}
                className="group mb-6 block break-inside-avoid border-b theme-border pb-5"
              >
                <div className="relative aspect-square overflow-hidden bg-surface p-4">
                  {pitch.thumbnailUrl ? (
                    <img
                      src={pitch.thumbnailUrl}
                      alt=""
                      className="h-full w-full object-contain transition-transform duration-500 group-hover:scale-[1.02]"
                    />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-5 px-6 text-center">
                      <img
                        src="/icon-192.png"
                        alt=""
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
        ) : (
          <p className="py-20 text-center font-serif text-2xl theme-muted">
            {query ? "No pitches match that search." : "The first pitch gets the whole wall."}
          </p>
        )}

        <div className="mx-auto mt-12 max-w-xl">
          <PitchRecovery />
        </div>
      </section>
    </main>
  );
}
