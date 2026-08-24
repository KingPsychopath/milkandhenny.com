import { Link } from "@tanstack/react-router";

import { AppImage } from "@/components/AppImage";
import { imagePlaceholderStyle } from "@/features/media/image";
import type { PublicPitchDeck } from "../types";

const PREVIEW_LIMIT = 4;

export function PitchShowcase({
  pitches,
  title = "Unpopular opinions & conspiracies",
}: {
  pitches: PublicPitchDeck[];
  title?: string;
}) {
  const preview = pitches.slice(0, PREVIEW_LIMIT);

  return (
    <section
      aria-labelledby="pitch-showcase-title"
      className="event-pitch-showcase border-y theme-border py-6"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-micro uppercase tracking-[0.16em] theme-muted">
            from the pitch wall
          </p>
          <h3 id="pitch-showcase-title" className="mt-2 font-serif text-2xl text-foreground">
            {title}
          </h3>
          <p className="mt-2 max-w-lg font-serif text-base leading-relaxed theme-subtle">
            A few pitches from people who want to make the room believe them, and people who already
            have.
          </p>
        </div>
        <Link
          to="/things/pitches"
          className="shrink-0 font-mono text-xs text-foreground underline underline-offset-4 hover:opacity-60"
        >
          see the whole wall →
        </Link>
      </div>

      {preview.length > 0 ? (
        <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-6">
          {preview.map((pitch) => (
            <Link
              key={pitch.id}
              to="/things/pitches/$deckId"
              params={{ deckId: pitch.id }}
              search={{ edition: undefined }}
              className="group block min-w-0 border-b theme-border pb-3 hover:opacity-70"
            >
              <div
                className="media-image-placeholder aspect-video overflow-hidden bg-surface"
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
                    sizes="(min-width: 672px) 304px, calc((100vw - 4rem) / 2)"
                    className="app-image-hover-scale h-full w-full object-contain group-hover:scale-[1.02]"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center px-4 text-center">
                    <span className="font-serif text-lg leading-tight theme-subtle">
                      {pitch.title}
                    </span>
                  </div>
                )}
              </div>
              <h4 className="mt-3 truncate font-serif text-lg text-foreground">{pitch.title}</h4>
              <p className="mt-1 font-mono text-micro theme-muted">{pitch.ownerName}</p>
            </Link>
          ))}
        </div>
      ) : (
        <p className="mt-6 border-t theme-border pt-5 font-serif text-base theme-subtle">
          The wall is waiting for its first case.
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-baseline justify-between gap-3 border-t theme-border pt-5">
        <p className="font-serif text-base theme-subtle">Have a theory of your own?</p>
        <Link
          to="/things/pitches/new"
          className="font-mono text-xs text-foreground underline underline-offset-4 hover:opacity-60"
        >
          make your own pitch →
        </Link>
      </div>
    </section>
  );
}
