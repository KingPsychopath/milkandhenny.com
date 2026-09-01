// Route modules are part of the server graph. Keep the browser-only queue behind a UI boundary so
// the route loader remains server-safe while event handlers still use the durable client queue.
export {
  ATTENDEE_CLAIMS_EVENT,
  attendeeClaimResultFromEvent,
  submitAttendeeClaim,
} from "../attendee-claims.client";
