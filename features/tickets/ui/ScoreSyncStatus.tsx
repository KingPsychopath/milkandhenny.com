import { useEffect, useState } from "react";

import { EventScoringClientStore } from "@/features/event-scoring/client-sync-store";

export function ScoreSyncStatus({
  snapshot,
}: {
  snapshot: {
    eventSlug: string;
    participantId: string;
    balance: number;
    revision: number;
    synchronizedAt: string;
  };
}) {
  const [online, setOnline] = useState(true);
  const { eventSlug, participantId, balance, revision, synchronizedAt } = snapshot;
  useEffect(() => {
    setOnline(navigator.onLine);
    const store = new EventScoringClientStore();
    void store.saveSnapshot({ eventSlug, participantId, balance, revision, synchronizedAt });
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      store.close();
    };
  }, [eventSlug, participantId, balance, revision, synchronizedAt]);
  return <span>{online ? "synchronized" : "offline - showing last confirmed score"}</span>;
}
