import { useCallback, useEffect, useState } from "react";
import { gameBrowserKey } from "../shared/multiplayer-keys";

const KEY = gameBrowserKey("twin", 1, "colour");

/**
 * Coloured symbols, on by default.
 *
 * Colour is the fastest way to make the hunt easier without making it shorter — it lets the eye reject
 * two thirds of a card before reading a single shape. It is never the answer, though: six hues across
 * thirty-one symbols means a colour narrows the search and nothing more, so nobody who cannot separate
 * two of them is worse off than a player who ignores colour entirely.
 *
 * Off is still worth having. The monochrome deck is harder, quieter, and closer to the rest of the
 * site — and once colour exists, someone will want it gone.
 *
 * Set on the document rather than threaded through every board, because it is a device preference and
 * every surface in the game would otherwise have to carry the same prop to the same place.
 */
export function useTwinPalette() {
  const [colour, setColour] = useState(true);

  useEffect(() => {
    try {
      setColour(localStorage.getItem(KEY) !== "off");
    } catch {
      // Storage refused; the coloured default stands for this session.
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.twinColour = colour ? "on" : "off";
    return () => {
      delete document.documentElement.dataset.twinColour;
    };
  }, [colour]);

  const toggle = useCallback(() => {
    setColour((current) => {
      const next = !current;
      try {
        localStorage.setItem(KEY, next ? "on" : "off");
      } catch {
        // Honoured for this session regardless.
      }
      return next;
    });
  }, []);

  return { colour, toggle };
}
