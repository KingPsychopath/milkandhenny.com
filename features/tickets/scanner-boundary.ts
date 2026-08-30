import { isValidTicketId, parseTicketQrPayload, type RedeemOutcome } from "./types";

/**
 * Keep the durable ticket id inside trusted workflows while exposing only the current credential to
 * scanner clients. The redemption engine has already verified that this scanned value is current.
 */
export function projectRedeemOutcomeForScanner(
  outcome: RedeemOutcome,
  scanned: string,
): RedeemOutcome {
  if (!("ticket" in outcome)) return outcome;
  const parsed = parseTicketQrPayload(scanned);
  const typed = scanned.trim().toUpperCase();
  const publicId = parsed?.ticketId ?? (isValidTicketId(typed) ? typed : null);
  if (!publicId) return outcome;
  return { ...outcome, ticket: { ...outcome.ticket, id: publicId } };
}
