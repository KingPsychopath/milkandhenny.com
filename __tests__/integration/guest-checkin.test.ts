import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Integration tests for the guest list KV operations.
 *
 * The check-in flow is the most-used feature at events — door staff
 * tap to check in guests and plus-ones in real-time. This tests the
 * full set → get → toggle → verify flow through the in-memory fallback.
 */

// Force in-memory fallback
vi.mock("@/lib/platform/redis", () => ({
  getRedis: () => null,
}));

import {
  getGuests,
  setGuests,
  updateGuestCheckIn,
} from "@/features/guests/store";
import type { Guest } from "@/features/guests/types";

function makeGuest(overrides: Partial<Guest> & { id: string; name: string }): Guest {
  return {
    status: "Approved",
    isPlusOne: false,
    checkedIn: false,
    plusOnes: [],
    ...overrides,
  };
}

describe("guest list KV operations (in-memory fallback)", () => {
  beforeEach(async () => {
    // Reset state between tests
    await setGuests([]);
  });

  it("stores and retrieves a guest list", async () => {
    const guests = [
      makeGuest({ id: "alice-0", name: "Alice" }),
      makeGuest({ id: "bob-1", name: "Bob" }),
    ];
    await setGuests(guests);

    const retrieved = await getGuests();
    expect(retrieved).toHaveLength(2);
    expect(retrieved[0].name).toBe("Alice");
    expect(retrieved[1].name).toBe("Bob");
  });

  it("returns empty array when no guests stored", async () => {
    const guests = await getGuests();
    expect(guests).toEqual([]);
  });

  it("checks in a main guest", async () => {
    await setGuests([
      makeGuest({ id: "alice-0", name: "Alice", checkedIn: false }),
    ]);

    await updateGuestCheckIn("alice-0", true);

    const guests = await getGuests();
    expect(guests[0].checkedIn).toBe(true);
    expect(guests[0].checkedInAt).toBeDefined();
  });

  it("checks out a previously checked-in guest", async () => {
    await setGuests([
      makeGuest({
        id: "alice-0",
        name: "Alice",
        checkedIn: true,
        checkedInAt: new Date().toISOString(),
      }),
    ]);

    await updateGuestCheckIn("alice-0", false);

    const guests = await getGuests();
    expect(guests[0].checkedIn).toBe(false);
    expect(guests[0].checkedInAt).toBeUndefined();
  });

  it("checks in a plus-one without affecting the host", async () => {
    await setGuests([
      makeGuest({
        id: "alice-0",
        name: "Alice",
        checkedIn: false,
        plusOnes: [
          makeGuest({
            id: "bob-1",
            name: "Bob",
            isPlusOne: true,
            plusOneOf: "Alice",
            checkedIn: false,
          }),
        ],
      }),
    ]);

    await updateGuestCheckIn("bob-1", true);

    const guests = await getGuests();
    // Host unchanged
    expect(guests[0].checkedIn).toBe(false);
    // Plus-one checked in
    expect(guests[0].plusOnes[0].checkedIn).toBe(true);
    expect(guests[0].plusOnes[0].checkedInAt).toBeDefined();
  });

  it("handles check-in for non-existent guest ID gracefully", async () => {
    await setGuests([
      makeGuest({ id: "alice-0", name: "Alice", checkedIn: false }),
    ]);

    // Should not throw — the ID just doesn't match anyone
    await updateGuestCheckIn("nonexistent-99", true);

    const guests = await getGuests();
    expect(guests[0].checkedIn).toBe(false); // unchanged
  });

  it("preserves other guests when one is checked in", async () => {
    await setGuests([
      makeGuest({ id: "alice-0", name: "Alice", checkedIn: false }),
      makeGuest({ id: "bob-1", name: "Bob", checkedIn: false }),
      makeGuest({ id: "charlie-2", name: "Charlie", checkedIn: true }),
    ]);

    await updateGuestCheckIn("bob-1", true);

    const guests = await getGuests();
    expect(guests[0].checkedIn).toBe(false); // Alice unchanged
    expect(guests[1].checkedIn).toBe(true); // Bob checked in
    expect(guests[2].checkedIn).toBe(true); // Charlie unchanged
  });
});
