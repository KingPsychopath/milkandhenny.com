import { describe, expect, it } from "vitest";

import {
  createTeam,
  setTeamMembership,
} from "@/features/event-scoring/store/participants-teams.server";
import { createStaffAccess } from "@/features/event-scoring/staff.server";

describe("event scoring team input validation", () => {
  it("rejects a team name that cannot be stored before querying the database", async () => {
    await expect(createTeam({ eventSlug: "event", name: "x".repeat(121) })).resolves.toEqual({
      ok: false,
      status: 400,
      error: "Use 120 characters or fewer for a team name",
    });
  });

  it("rejects an invalid membership start before querying the database", async () => {
    await expect(
      setTeamMembership({
        eventSlug: "event",
        teamId: "team_1",
        participantId: "participant_1",
        startsAt: "not-a-date",
      }),
    ).resolves.toEqual({
      ok: false,
      status: 400,
      error: "Team assignment start must be a valid time",
    });
  });

  it("rejects invalid and elapsed station expiry before creating bearer access", async () => {
    const station = (expiresAt: string) =>
      createStaffAccess({
        eventSlug: "event",
        label: "Front door",
        assignmentType: "station",
        preset: "door-scanner",
        expiresAt,
        actorId: "admin",
        reason: "event operations",
      });

    await expect(station("not-a-date")).rejects.toThrow(
      "Staff access expiry must be in the future",
    );
    await expect(station("2020-01-01T00:00:00.000Z")).rejects.toThrow(
      "Staff access expiry must be in the future",
    );
  });
});
