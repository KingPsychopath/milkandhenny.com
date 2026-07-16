import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getStored, setStored } from "@/lib/client/storage";
import { getStorageKey } from "@/lib/shared/storage-keys";
import {
  parseLedger,
  recordEncounter,
  type EncounterOutcome,
  type IcebreakerLedger,
  type IcebreakerPlayer,
} from "./icebreaker-pairing";

function readLedger(player: IcebreakerPlayer) {
  return parseLedger(getStored("icebreakerLedger"), player);
}

export function useIcebreakerLedger(player: IcebreakerPlayer) {
  const [ledger, setLedger] = useState<IcebreakerLedger>(() => readLedger(player));
  const ledgerRef = useRef(ledger);

  const updateLedger = useCallback((next: IcebreakerLedger) => {
    ledgerRef.current = next;
    setLedger(next);
  }, []);

  useEffect(() => {
    updateLedger(readLedger(player));
  }, [player, updateLedger]);

  useEffect(() => {
    const storageKey = getStorageKey("icebreakerLedger");
    const handleStorage = (event: StorageEvent) => {
      if (event.key === storageKey) updateLedger(parseLedger(event.newValue, player));
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [player, updateLedger]);

  const addEncounter = useCallback(
    (partner: IcebreakerPlayer): EncounterOutcome => {
      const stored = getStored("icebreakerLedger");
      const latest = stored === null ? ledgerRef.current : parseLedger(stored, player);
      const outcome = recordEncounter(latest, player, partner, new Date().toISOString());
      if (outcome.status !== "self") {
        const persisted = setStored("icebreakerLedger", JSON.stringify(outcome.ledger));
        updateLedger(outcome.ledger);
        return { ...outcome, persisted };
      }
      return outcome;
    },
    [player, updateLedger],
  );

  return useMemo(() => ({ ledger, addEncounter }), [addEncounter, ledger]);
}
