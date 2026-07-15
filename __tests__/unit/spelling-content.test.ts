import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatSpellingWords, parseSpellingWords } from "../../features/things/spelling-bee/customDecks";
import { SPELLING_DECKS } from "../../features/things/spelling-bee/decks";
import { partyAudioAssetKey, partyDeck } from "../../features/things/spelling-party/party-content.server";

describe("spelling content", () => {
  it("keeps every curated deck deep enough for repeat games with complete audio", () => {
    for (const summary of SPELLING_DECKS) {
      expect(summary.words).toHaveLength(24);
      const deck = partyDeck(summary.id)!;
      for (const word of deck.words) {
        expect(word.sentence).toBeTruthy();
        for (const kind of ["word", "definition", "sentence"] as const) {
          expect(existsSync(`assets/party-spelling-audio/${partyAudioAssetKey(word, kind)}`)).toBe(true);
        }
      }
    }
  });

  it("round-trips optional pronunciation and sentence fields without shifting columns", () => {
    const source = "quay | noun | a platform beside water | key | The boats waited beside the quay.\nrhythm | noun | a repeated pattern";
    const words = parseSpellingWords(source);
    const reparsed = parseSpellingWords(formatSpellingWords(words));
    expect(reparsed.map(({ id: _, ...word }) => word)).toEqual(words.map(({ id: _, ...word }) => word));
  });
});
