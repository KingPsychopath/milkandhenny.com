import { describe, expect, it } from "vitest";
import {
  COLOURS,
  MAX_LEDGER_ENCOUNTERS,
  createEmptyLedger,
  createPairingResult,
  createPlayerId,
  encounterId,
  encounterResult,
  pairingCode,
  pairingPayload,
  pairingUrl,
  parseLedger,
  parsePairingCode,
  recordEncounter,
  type Colour,
  type IcebreakerPlayer,
} from "../../features/things/icebreaker/icebreaker-pairing";

const ruby = COLOURS[0];
const sapphire = COLOURS[1];

function player(id: string, colour: Colour = ruby): IcebreakerPlayer {
  return { id, colour };
}

function uniqueId(index: number) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let value = index;
  let suffix = "";
  for (let position = 0; position < 4; position += 1) {
    suffix = `${alphabet[value % alphabet.length]}${suffix}`;
    value = Math.floor(value / alphabet.length);
  }
  return `Z${suffix}`;
}

describe("icebreaker pairing codes", () => {
  it("should generate a stable short code, payload, and native-camera URL", () => {
    const rubyPlayer = player("ABCDE");
    expect(pairingCode(rubyPlayer)).toBe("R-ABCDE");
    expect(pairingPayload(rubyPlayer)).toBe("MH1-R-ABCDE");
    expect(pairingUrl("https://milkandhenny.com/", rubyPlayer)).toBe(
      "https://milkandhenny.com/things/icebreaker#pair=MH1-R-ABCDE",
    );
  });

  it("should parse manual, QR, hash, and full native-camera forms", () => {
    const expected = player("ABCDE");
    expect(parsePairingCode("r-abcde")).toEqual(expected);
    expect(parsePairingCode(" MH1-R-ABCDE ")).toEqual(expected);
    expect(parsePairingCode("#pair=MH1-R-ABCDE")).toEqual(expected);
    expect(parsePairingCode("https://milkandhenny.com/things/icebreaker#pair=MH1-R-ABCDE")).toEqual(
      expected,
    );
  });

  it("should reject malformed, query-only, unknown-colour, and oversized values", () => {
    expect(parsePairingCode("R-ABCD")).toBeNull();
    expect(parsePairingCode("X-ABCDE")).toBeNull();
    expect(
      parsePairingCode("https://milkandhenny.com/things/icebreaker?pair=MH1-R-ABCDE"),
    ).toBeNull();
    expect(parsePairingCode(`R-${"A".repeat(600)}`)).toBeNull();
  });

  it("should create random IDs that fit the pairing alphabet", () => {
    expect(createPlayerId()).toMatch(/^[A-Z2-9]{5}$/);
  });
});

describe("icebreaker result invariants", () => {
  it("should create the same blend and question regardless of scan order", () => {
    const first = player("ABCDE", ruby);
    const second = player("FGHJK", sapphire);
    const forward = createPairingResult(first, second);
    const reverse = createPairingResult(second, first);
    expect(forward.name).toBe("Cosmic");
    expect(reverse.name).toBe("Cosmic");
    expect(forward.question).toBe(reverse.question);
    expect(encounterId(first.id, second.id)).toBe(encounterId(second.id, first.id));
  });

  it("should turn equal colours into a match", () => {
    expect(createPairingResult(player("ABCDE"), player("FGHJK"))).toMatchObject({
      kind: "match",
      name: "Ruby crew",
    });
  });

  it("should give every different-colour combination a named blend", () => {
    for (const [firstIndex, firstColour] of COLOURS.entries()) {
      for (const [secondIndex, secondColour] of COLOURS.entries()) {
        if (secondIndex <= firstIndex) continue;
        const result = createPairingResult(
          player("ABCDE", firstColour),
          player("FGHJK", secondColour),
        );
        expect(result.kind).toBe("mix");
        expect(result.name).not.toContain(" mix");
      }
    }
  });
});

describe("icebreaker colour book", () => {
  it("should add one encounter and preserve the original colour", () => {
    const owner = player("ABCDE");
    const outcome = recordEncounter(
      createEmptyLedger(owner),
      owner,
      player("FGHJK", sapphire),
      "2026-07-16T12:00:00.000Z",
    );
    expect(outcome.status).toBe("new");
    expect(outcome.ledger.ownerColourCode).toBe("R");
    expect(outcome.ledger.encounters).toHaveLength(1);
    expect(encounterResult(outcome.encounter!)).toMatchObject({ kind: "mix", name: "Cosmic" });
  });

  it("should reject self-scans without changing the ledger", () => {
    const owner = player("ABCDE");
    const ledger = createEmptyLedger(owner);
    const outcome = recordEncounter(ledger, owner, owner, "2026-07-16T12:00:00.000Z");
    expect(outcome).toEqual({ encounter: null, ledger, status: "self" });
  });

  it("should reuse an existing encounter without adding a duplicate", () => {
    const owner = player("ABCDE");
    const partner = player("FGHJK", sapphire);
    const first = recordEncounter(
      createEmptyLedger(owner),
      owner,
      partner,
      "2026-07-16T12:00:00.000Z",
    );
    const repeated = recordEncounter(first.ledger, owner, partner, "2026-07-16T12:05:00.000Z");
    expect(repeated.status).toBe("repeat");
    expect(repeated.ledger.encounters).toHaveLength(1);
    expect(repeated.encounter?.firstMetAt).toBe("2026-07-16T12:00:00.000Z");
    expect(repeated.encounter?.lastMetAt).toBe("2026-07-16T12:05:00.000Z");
  });

  it("should keep the first result if a known device later claims another colour", () => {
    const owner = player("ABCDE");
    const first = recordEncounter(
      createEmptyLedger(owner),
      owner,
      player("FGHJK", sapphire),
      "2026-07-16T12:00:00.000Z",
    );
    const repeated = recordEncounter(
      first.ledger,
      owner,
      player("FGHJK", COLOURS[2]),
      "2026-07-16T12:05:00.000Z",
    );
    expect(repeated.encounter?.name).toBe("Cosmic");
    expect(repeated.encounter?.partnerColourCode).toBe("S");
  });

  it("should cap the ledger at the newest unique encounters", () => {
    const owner = player("ABCDE");
    let ledger = createEmptyLedger(owner);
    for (let index = 0; index < MAX_LEDGER_ENCOUNTERS + 3; index += 1) {
      ledger = recordEncounter(
        ledger,
        owner,
        player(uniqueId(index), sapphire),
        new Date(Date.UTC(2026, 6, 16, 12, index)).toISOString(),
      ).ledger;
    }
    expect(ledger.encounters).toHaveLength(MAX_LEDGER_ENCOUNTERS);
    expect(ledger.encounters[0]?.partnerId).toBe(uniqueId(MAX_LEDGER_ENCOUNTERS + 2));
    expect(ledger.encounters.some((entry) => entry.partnerId === uniqueId(0))).toBe(false);
  });

  it("should safely reset corrupt, foreign-owner, and changed-colour ledgers", () => {
    const owner = player("ABCDE");
    expect(parseLedger("not-json", owner)).toEqual(createEmptyLedger(owner));
    expect(
      parseLedger(
        JSON.stringify({
          ...createEmptyLedger(owner),
          ownerId: "FGHJK",
        }),
        owner,
      ),
    ).toEqual(createEmptyLedger(owner));
    expect(
      parseLedger(
        JSON.stringify({
          ...createEmptyLedger(owner),
          ownerColourCode: "S",
        }),
        owner,
      ),
    ).toEqual(createEmptyLedger(owner));
  });

  it("should remove malformed and duplicate entries while loading valid data", () => {
    const owner = player("ABCDE");
    const partner = player("FGHJK", sapphire);
    const valid = recordEncounter(
      createEmptyLedger(owner),
      owner,
      partner,
      "2026-07-16T12:00:00.000Z",
    ).encounter!;
    const parsed = parseLedger(
      JSON.stringify({
        ...createEmptyLedger(owner),
        encounters: [valid, valid, { partnerId: "bad" }, null],
      }),
      owner,
    );
    expect(parsed.encounters).toHaveLength(1);
    expect(parsed.encounters[0]?.partnerId).toBe(partner.id);
  });
});
