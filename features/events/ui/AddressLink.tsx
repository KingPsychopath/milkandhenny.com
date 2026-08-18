"use client";

import { useState } from "react";

import { useHasMounted } from "@/hooks/useHasMounted";
import { useMapProvider } from "@/hooks/useMapProvider";
import {
  MAP_PROVIDERS,
  MAP_PROVIDER_LABELS,
  mapSearchQuery,
  mapSearchUrl,
  type MapProvider,
} from "../maps";

/**
 * The venue address, as a link into the guest's own map app.
 *
 * Pre-mount the href is always the Google URL, because the server has no
 * user-agent and no storage: rendering the same thing on both sides keeps
 * hydration quiet, and the swap to Apple happens on the first client render.
 * The Google URL is a working web map, so a browser with JavaScript off still
 * lands somewhere useful rather than nowhere.
 *
 * The chooser appears once, and only after the address is already tappable —
 * being asked a settings question before you can find the door would be the
 * wrong order.
 */

const SSR_PROVIDER: MapProvider = "google";

export function AddressLink({
  address,
  venueName,
  className = "",
}: {
  address?: string;
  venueName?: string;
  className?: string;
}) {
  const mounted = useHasMounted();
  const { provider, hasChosen, choose } = useMapProvider();
  const [switching, setSwitching] = useState(false);

  const query = mapSearchQuery({ address, venueName });
  const label = address?.trim() || venueName?.trim();
  if (!query || !label) return null;

  const effective = mounted ? provider : SSR_PROVIDER;
  const showPrompt = mounted && !hasChosen;

  return (
    <span className={`block ${className}`}>
      <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <a
          href={mapSearchUrl(effective, query)}
          target="_blank"
          rel="noreferrer noopener"
          className="underline decoration-dotted underline-offset-2 hover:opacity-70 transition-opacity"
        >
          {label}
        </a>
        {mounted && !showPrompt && (
          <button
            type="button"
            onClick={() => setSwitching((open) => !open)}
            aria-expanded={switching}
            className="shrink-0 font-mono text-micro theme-faint hover:text-foreground transition-colors"
          >
            {MAP_PROVIDER_LABELS[effective].split(" ")[0].toLowerCase()} ↓
          </button>
        )}
      </span>

      {(showPrompt || switching) && (
        <span className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-micro theme-muted">
          <span>open addresses in</span>
          {MAP_PROVIDERS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                choose(option);
                setSwitching(false);
              }}
              aria-pressed={effective === option}
              className={`underline underline-offset-2 transition-opacity hover:opacity-70 ${
                effective === option ? "text-foreground" : ""
              }`}
            >
              {MAP_PROVIDER_LABELS[option]}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
