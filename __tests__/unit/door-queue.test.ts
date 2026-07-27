import { describe, it, expect } from "vitest";

/**
 * Unit tests for the offline door reducer.
 *
 * This is the code path that runs when the venue wifi drops and there is a
 * queue outside, so the properties are asserted directly rather than left to
 * a manual test on the night.
 */

import {
  EMPTY_DOOR_STATE,
  applyManifest,
  clearSynced,
  pendingCount,
  recordOfflineScan,
  type DoorOfflineState,
} from "@/features/tickets/door-queue";

const HASH_A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const HASH_B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const HASH_UNKNOWN = "cccccccccccccccccccccccc";
const NOW = "2026-09-12T20:00:00.000Z";

function stateWith(manifest: string[]): DoorOfflineState {
  return applyManifest(EMPTY_DOOR_STATE, manifest);
}

describe("offline scanning", () => {
  it("admits a ticket present on the manifest", () => {
    const outcome = recordOfflineScan(stateWith([HASH_A]), {
      ticketId: "TICKET0000000001",
      ticketHash: HASH_A,
      scannedAt: NOW,
    });

    expect(outcome.result).toBe("admitted-offline");
    expect(pendingCount(outcome.state)).toBe(1);
    expect(outcome.state.queue[0]).toEqual({ ticketId: "TICKET0000000001", scannedAt: NOW });
  });

  it("refuses a ticket absent from the manifest rather than waving it through", () => {
    const outcome = recordOfflineScan(stateWith([HASH_A]), {
      ticketId: "TICKET0000000002",
      ticketHash: HASH_UNKNOWN,
      scannedAt: NOW,
    });

    expect(outcome.result).toBe("not-on-manifest");
    expect(pendingCount(outcome.state)).toBe(0);
  });

  it("admits the same ticket only once while offline", () => {
    const first = recordOfflineScan(stateWith([HASH_A]), {
      ticketId: "TICKET0000000001",
      ticketHash: HASH_A,
      scannedAt: NOW,
    });
    const second = recordOfflineScan(first.state, {
      ticketId: "TICKET0000000001",
      ticketHash: HASH_A,
      scannedAt: "2026-09-12T21:00:00.000Z",
    });

    expect(second.result).toBe("already-redeemed-offline");
    // Reports the original admission time, not the re-scan.
    if (second.result === "already-redeemed-offline") expect(second.scannedAt).toBe(NOW);
    expect(pendingCount(second.state)).toBe(1);
  });

  it("keeps separate tickets independent", () => {
    const first = recordOfflineScan(stateWith([HASH_A, HASH_B]), {
      ticketId: "TICKET0000000001",
      ticketHash: HASH_A,
      scannedAt: NOW,
    });
    const second = recordOfflineScan(first.state, {
      ticketId: "TICKET0000000002",
      ticketHash: HASH_B,
      scannedAt: NOW,
    });

    expect(second.result).toBe("admitted-offline");
    expect(pendingCount(second.state)).toBe(2);
  });

  it("does not mutate the state it was given", () => {
    const initial = stateWith([HASH_A]);
    recordOfflineScan(initial, {
      ticketId: "TICKET0000000001",
      ticketHash: HASH_A,
      scannedAt: NOW,
    });
    expect(pendingCount(initial)).toBe(0);
    expect(initial.admitted).toHaveLength(0);
  });
});

describe("syncing", () => {
  it("clears only the entries the server accepted", () => {
    let state = stateWith([HASH_A, HASH_B]);
    state = recordOfflineScan(state, {
      ticketId: "TICKET0000000001",
      ticketHash: HASH_A,
      scannedAt: NOW,
    }).state;
    state = recordOfflineScan(state, {
      ticketId: "TICKET0000000002",
      ticketHash: HASH_B,
      scannedAt: NOW,
    }).state;

    const synced = clearSynced(state, ["TICKET0000000001"]);
    expect(pendingCount(synced)).toBe(1);
    expect(synced.queue[0].ticketId).toBe("TICKET0000000002");
  });

  it("is a no-op when nothing matches", () => {
    const state = recordOfflineScan(stateWith([HASH_A]), {
      ticketId: "TICKET0000000001",
      ticketHash: HASH_A,
      scannedAt: NOW,
    }).state;

    expect(pendingCount(clearSynced(state, ["TICKET0000009999"]))).toBe(1);
  });
});

describe("manifest refresh", () => {
  it("remembers offline admissions even if the new manifest drops them", () => {
    const admitted = recordOfflineScan(stateWith([HASH_A]), {
      ticketId: "TICKET0000000001",
      ticketHash: HASH_A,
      scannedAt: NOW,
    }).state;

    // The refreshed manifest no longer lists that ticket — but the person is
    // already inside, so a re-scan must not admit them a second time.
    const refreshed = applyManifest(admitted, [HASH_B]);
    expect(refreshed.admitted).toContain(HASH_A);
    expect(pendingCount(refreshed)).toBe(1);

    const rescan = recordOfflineScan(refreshed, {
      ticketId: "TICKET0000000001",
      ticketHash: HASH_A,
      scannedAt: NOW,
    });
    expect(rescan.result).toBe("not-on-manifest");
  });

  it("picks up newly issued tickets", () => {
    const refreshed = applyManifest(stateWith([HASH_A]), [HASH_A, HASH_B]);
    const outcome = recordOfflineScan(refreshed, {
      ticketId: "TICKET0000000002",
      ticketHash: HASH_B,
      scannedAt: NOW,
    });
    expect(outcome.result).toBe("admitted-offline");
  });
});
