import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AppSelect } from "@/components/AppSelect";
import { listPitchCredentials } from "../browser-store.client";
import type { PitchOwnerCredential } from "../types";

export function PitchDeviceSwitcher({ deckId }: { deckId: string }) {
  const navigate = useNavigate();
  const [pitches, setPitches] = useState<PitchOwnerCredential[]>([]);

  useEffect(() => {
    void listPitchCredentials()
      .then((credentials) =>
        setPitches(credentials.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))),
      )
      .catch(() => undefined);
  }, [deckId]);

  if (pitches.length < 2) return null;

  return (
    <AppSelect
      value={deckId}
      ariaLabel="Switch pitch"
      title="Your pitches on this device"
      options={pitches.map((pitch) => ({ value: pitch.deckId, label: pitch.title }))}
      onValueChange={(nextDeckId) => {
        if (nextDeckId === deckId) return;
        void navigate({
          to: "/things/pitches/$deckId/edit",
          params: { deckId: nextDeckId },
        });
      }}
    />
  );
}
