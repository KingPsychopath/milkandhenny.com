import { describe, expect, it } from "vitest";

import { centreRealtimeChannel } from "../../features/things/centre/centre-keys";
import { drawCountryRealtimeChannel } from "../../features/things/draw-country/draw-country-keys";
import { familyFeudRealtimeChannel } from "../../features/things/family-feud/family-feud-keys";
import { hotAndColdRealtimeChannel } from "../../features/things/hot-and-cold/hot-and-cold-keys";
import { liarsRealtimeChannel } from "../../features/things/liars/liars-keys";
import { pairedGameRealtimeChannel } from "../../features/things/remote/remote-keys";
import { sameBrainRealtimeChannel } from "../../features/things/same-brain/same-brain-keys";
import { MULTIPLAYER_GAME_REGISTRY } from "../../features/things/shared/multiplayer-telemetry";
import { partyRealtimeChannel } from "../../features/things/spelling-party/party-keys";
import { twinRealtimeChannel } from "../../features/things/twin/twin-keys";

describe("multiplayer realtime channel registry", () => {
  it.each([
    ["remote", pairedGameRealtimeChannel],
    ["spelling-party", partyRealtimeChannel],
    ["draw-country", drawCountryRealtimeChannel],
    ["liars", liarsRealtimeChannel],
    ["same-brain", sameBrainRealtimeChannel],
    ["hot-and-cold", hotAndColdRealtimeChannel],
    ["twin", twinRealtimeChannel],
    ["centre", centreRealtimeChannel],
    ["family-feud", familyFeudRealtimeChannel],
  ] as const)("keeps %s publishers and sockets on the same version", (game, channelFor) => {
    expect(channelFor("ABC2345")).toBe(
      `things:${game}:${MULTIPLAYER_GAME_REGISTRY[game].channelVersion}:room:ABC2345:events`,
    );
  });
});
