import { useCallback, useEffect, useState } from "react";
import { liarsBrowserKeys } from "./liars-keys";

/**
 * Your own notebook, as opposed to "what you know" — which is the server's automatic record of
 * what your role learned and cannot be written in. This is where suspicions go: the things you
 * worked out rather than the things you were told.
 *
 * It never leaves the device. The server has no idea it exists, so nothing written here can leak
 * into anybody else's snapshot, and a note is not evidence of anything.
 */
export const LIARS_NOTE_LIMIT = 40;
export const LIARS_NOTE_LENGTH = 80;

export interface LiarsNote {
  id: string;
  round: number;
  text: string;
}

export function useLiarsNotes(roomId: string, gameNumber: number) {
  const key = `${liarsBrowserKeys.playerSession(roomId)}:notes:${gameNumber}`;
  const [notes, setNotes] = useState<LiarsNote[]>([]);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(key) ?? "[]") as LiarsNote[];
      setNotes(Array.isArray(stored) ? stored.slice(-LIARS_NOTE_LIMIT) : []);
    } catch {
      setNotes([]);
    }
  }, [key]);

  const persist = useCallback(
    (next: LiarsNote[]) => {
      setNotes(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Still held for this session.
      }
    },
    [key],
  );

  const add = useCallback(
    (text: string, round: number) => {
      const trimmed = text.trim().slice(0, LIARS_NOTE_LENGTH);
      if (!trimmed) return;
      persist(
        [...notes, { id: `${Date.now().toString(36)}`, round, text: trimmed }].slice(
          -LIARS_NOTE_LIMIT,
        ),
      );
    },
    [notes, persist],
  );

  const remove = useCallback(
    (id: string) => persist(notes.filter((note) => note.id !== id)),
    [notes, persist],
  );

  return { notes, add, remove, full: notes.length >= LIARS_NOTE_LIMIT };
}
