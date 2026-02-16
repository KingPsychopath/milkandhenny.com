import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Integration tests for addGuest and removeGuest (features/guests/store).
 *
 * Covers main guest add, plus-one add (and missing main guest), validation,
 * and remove for main guest, plus-one, and non-existent id.
 */

vi.mock("@/lib/platform/redis", () => ({
  getRedis: () => null,
}));

import {
  getGuests,
  setGuests,
  addGuest,
  removeGuest,
} from "@/features/guests/store";

describe("guests add/remove (in-memory fallback)", () => {
  beforeEach(async () => {
    await setGuests([]);
  });

  it("adds a main guest", async () => {
    const result = await addGuest({ name: "Alice" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Alice");
      expect(result.value.isPlusOne).toBe(false);
      expect(result.value.plusOneOf).toBeUndefined();
      expect(result.value.id).toMatch(/^alice-/);
    }

    const guests = await getGuests();
    expect(guests).toHaveLength(1);
    expect(guests[0].name).toBe("Alice");
  });

  it("adds a plus-one under an existing main guest", async () => {
    await addGuest({ name: "Alice" });
    const result = await addGuest({ name: "Bob", plusOneOf: "Alice" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Bob");
      expect(result.value.isPlusOne).toBe(true);
      expect(result.value.plusOneOf).toBe("Alice");
    }

    const guests = await getGuests();
    expect(guests).toHaveLength(1);
    expect(guests[0].name).toBe("Alice");
    expect(guests[0].plusOnes).toHaveLength(1);
    expect(guests[0].plusOnes[0].name).toBe("Bob");
  });

  it("returns 404 when adding plus-one with non-existent main guest name", async () => {
    const result = await addGuest({ name: "Bob", plusOneOf: "Nobody" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.error).toBe("Main guest not found");
    }
    const guests = await getGuests();
    expect(guests).toHaveLength(0);
  });

  it("returns 400 when name is empty or missing", async () => {
    expect((await addGuest({ name: "" })).ok).toBe(false);
    expect((await addGuest({ name: "   " })).ok).toBe(false);
    const bad = await addGuest({ name: "" });
    if (!bad.ok) expect(bad.status).toBe(400);
  });

  it("removes a main guest and leaves others", async () => {
    await addGuest({ name: "Alice" });
    await addGuest({ name: "Bob" });
    const guestsBefore = await getGuests();
    const aliceId = guestsBefore[0].id;

    const result = await removeGuest(aliceId);

    expect(result.ok).toBe(true);
    const guests = await getGuests();
    expect(guests).toHaveLength(1);
    expect(guests[0].name).toBe("Bob");
  });

  it("removes a plus-one without removing the main guest", async () => {
    await addGuest({ name: "Alice" });
    await addGuest({ name: "Bob", plusOneOf: "Alice" });
    const guestsBefore = await getGuests();
    const bobId = guestsBefore[0].plusOnes[0].id;

    const result = await removeGuest(bobId);

    expect(result.ok).toBe(true);
    const guests = await getGuests();
    expect(guests).toHaveLength(1);
    expect(guests[0].name).toBe("Alice");
    expect(guests[0].plusOnes).toHaveLength(0);
  });

  it("returns 400 when removeGuest is called with empty id", async () => {
    const result = await removeGuest("");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("removeGuest with non-existent id still returns ok and leaves list unchanged", async () => {
    await addGuest({ name: "Alice" });
    const result = await removeGuest("non-existent-99");

    expect(result.ok).toBe(true);
    const guests = await getGuests();
    expect(guests).toHaveLength(1);
    expect(guests[0].name).toBe("Alice");
  });
});
