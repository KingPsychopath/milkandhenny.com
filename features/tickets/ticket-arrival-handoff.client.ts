const ARRIVAL_HANDOFF_STORAGE_PREFIX = "mah:ticket-arrival-handoff:";

type ArrivalHandoffStorage = Pick<Storage, "getItem" | "setItem">;

export function ticketArrivalHandoffStorageKey(ticketReference: string) {
  return `${ARRIVAL_HANDOFF_STORAGE_PREFIX}${ticketReference}`;
}

export function wasTicketArrivalHandoffOffered(
  storage: ArrivalHandoffStorage,
  ticketReference: string,
) {
  try {
    return storage.getItem(ticketArrivalHandoffStorageKey(ticketReference)) === "1";
  } catch {
    return false;
  }
}

export function markTicketArrivalHandoffOffered(
  storage: ArrivalHandoffStorage,
  ticketReference: string,
) {
  try {
    storage.setItem(ticketArrivalHandoffStorageKey(ticketReference), "1");
  } catch {
    // The in-memory guard still prevents a loop when storage is unavailable.
  }
}

export function shouldOfferTicketArrivalHandoff({
  checkedInOnLoad,
  alreadyOffered,
  redeemedAt,
}: {
  checkedInOnLoad: boolean;
  alreadyOffered: boolean;
  redeemedAt?: string;
}) {
  return !checkedInOnLoad && !alreadyOffered && Boolean(redeemedAt);
}
