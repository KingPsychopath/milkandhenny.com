import { describe, expect, it, vi } from "vitest";

import {
  createReliableMultiplayerActionDispatcher,
  multiplayerActionFingerprint,
} from "../../features/things/shared/useReliableMultiplayerAction";

describe("reliable multiplayer actions", () => {
  it("uses a stable fingerprint for equivalent JSON actions", () => {
    expect(multiplayerActionFingerprint({ type: "round.start", options: { b: 2, a: 1 } })).toBe(
      multiplayerActionFingerprint({ options: { a: 1, b: 2 }, type: "round.start" }),
    );
  });

  it("coalesces duplicate taps while the first request is in flight", async () => {
    let finish: (value: string) => void = () => undefined;
    const dispatch = vi.fn(() => new Promise<string>((resolve) => void (finish = resolve)));
    const send = createReliableMultiplayerActionDispatcher(dispatch);

    const first = send({ type: "answer.reveal", index: 1 });
    const second = send({ index: 1, type: "answer.reveal" });
    expect(second).toBe(first);
    await Promise.resolve();
    expect(dispatch).toHaveBeenCalledTimes(1);

    finish("done");
    await expect(first).resolves.toBe("done");
  });

  it("reuses the action ID when the network outcome is uncertain", async () => {
    const actionIds: string[] = [];
    let attempts = 0;
    const send = createReliableMultiplayerActionDispatcher(
      async (_action: { type: string }, actionId) => {
        actionIds.push(actionId);
        attempts += 1;
        if (attempts === 1) throw new Error("response lost");
        return "accepted";
      },
    );
    send.synchronize(4);

    await expect(send({ type: "phase.advance" })).rejects.toThrow("response lost");
    await expect(send({ type: "phase.advance" })).resolves.toBe("accepted");
    expect(actionIds).toHaveLength(2);
    expect(actionIds[1]).toBe(actionIds[0]);
  });

  it("does not reuse an old action ID after authoritative room state advances", async () => {
    const actionIds: string[] = [];
    const send = createReliableMultiplayerActionDispatcher(
      async (_action: { type: string }, actionId) => {
        actionIds.push(actionId);
        throw new Error("response lost");
      },
    );
    send.synchronize(8);
    await expect(send({ type: "phase.advance" })).rejects.toThrow("response lost");
    send.synchronize(9);
    await expect(send({ type: "phase.advance" })).rejects.toThrow("response lost");

    expect(actionIds).toHaveLength(2);
    expect(actionIds[1]).not.toBe(actionIds[0]);
  });

  it("does not retain a late failure from an older room state", async () => {
    const actionIds: string[] = [];
    let rejectFirst: (error: Error) => void = () => undefined;
    const send = createReliableMultiplayerActionDispatcher(
      (_action: { type: string }, actionId) => {
        actionIds.push(actionId);
        return new Promise<string>((_resolve, reject) => void (rejectFirst = reject));
      },
    );
    send.synchronize(2);
    const first = send({ type: "phase.advance" });
    await Promise.resolve();
    send.synchronize(3);
    rejectFirst(new Error("late response loss"));
    await expect(first).rejects.toThrow("late response loss");

    const second = send({ type: "phase.advance" });
    await Promise.resolve();
    expect(actionIds).toHaveLength(2);
    expect(actionIds[1]).not.toBe(actionIds[0]);
    rejectFirst(new Error("finish test"));
    await expect(second).rejects.toThrow("finish test");
  });
});
