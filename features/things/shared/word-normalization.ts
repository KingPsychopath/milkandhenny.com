/** Shared rules for game words. Feature decks still own which words suit their game. */
export const GAME_WORD_MAX_LENGTH = 32;

export function normaliseGameWord(raw: string) {
  return raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-GB")
    .replace(/[’']/g, "")
    .replace(/[^a-z-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, GAME_WORD_MAX_LENGTH);
}

export function gameWordIsUsable(raw: string) {
  const word = normaliseGameWord(raw);
  return word.length >= 2 && /[a-z]/.test(word);
}
