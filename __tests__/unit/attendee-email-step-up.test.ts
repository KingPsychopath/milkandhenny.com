import { expect, it } from "vitest";

import { attendeeEmailStepUpRequired } from "@/features/attendee-access/access.server";

it("requires recent existing-email authentication before adding a sign-in email", () => {
  const now = Date.parse("2026-08-25T21:00:00.000Z");

  expect(attendeeEmailStepUpRequired(undefined, now)).toBe(true);
  expect(attendeeEmailStepUpRequired("not-a-date", now)).toBe(true);
  expect(attendeeEmailStepUpRequired("2026-08-25T21:00:01.000Z", now)).toBe(true);
  expect(attendeeEmailStepUpRequired("2026-08-25T20:50:00.000Z", now)).toBe(false);
  expect(attendeeEmailStepUpRequired("2026-08-25T20:49:59.999Z", now)).toBe(true);
});
