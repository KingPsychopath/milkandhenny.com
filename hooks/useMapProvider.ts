"use client";

import { useCallback, useState } from "react";

import { getStored, setStored } from "@/lib/client/storage";
import { isMapProvider, nativeMapProvider, type MapProvider } from "@/features/events/maps";

/**
 * Which map app this guest wants addresses to open in.
 *
 * `chosen` is deliberately separate from `provider`: the default is the
 * device's native app and is usable immediately, so nothing has to be asked
 * before the address works. `chosen` only records whether they have ever said
 * otherwise, which is what lets the one-time prompt appear once and never
 * again.
 *
 * Read lazily inside `useState` rather than in an effect, so the first client
 * render already has the stored answer and the prompt cannot flash for
 * somebody who settled this weeks ago. Callers must still gate rendering on
 * mount — see `useHasMounted` — because the server has neither storage nor a
 * user-agent.
 */
export function useMapProvider() {
  const [chosen, setChosen] = useState<MapProvider | null>(() => {
    const stored = getStored("mapProvider");
    return isMapProvider(stored) ? stored : null;
  });

  const choose = useCallback((provider: MapProvider) => {
    setStored("mapProvider", provider);
    setChosen(provider);
  }, []);

  const native = nativeMapProvider(
    typeof navigator === "undefined" ? undefined : navigator.userAgent,
  );

  return { provider: chosen ?? native, native, hasChosen: chosen !== null, choose };
}
