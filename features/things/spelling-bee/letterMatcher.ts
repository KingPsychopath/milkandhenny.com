export interface SpellingMatch {
  letters: string;
  matchedCount: number;
  complete: boolean;
  mismatchAt: number | null;
}

const LETTER_NAMES: Record<string, string> = {
  a: "A", ay: "A", bee: "B", be: "B", b: "B", cee: "C", see: "C", sea: "C", c: "C",
  dee: "D", d: "D", e: "E", ee: "E", eff: "F", f: "F", gee: "G", g: "G", aitch: "H", h: "H",
  i: "I", eye: "I", jay: "J", j: "J", kay: "K", k: "K", el: "L", ell: "L", l: "L", em: "M", m: "M",
  en: "N", n: "N", o: "O", oh: "O", pee: "P", p: "P", cue: "Q", queue: "Q", q: "Q", ar: "R", are: "R", r: "R",
  ess: "S", s: "S", tee: "T", tea: "T", t: "T", u: "U", you: "U", vee: "V", v: "V", doubleyou: "W", w: "W",
  ex: "X", x: "X", why: "Y", y: "Y", zee: "Z", zed: "Z", z: "Z",
};

function expectedLetters(target: string) {
  return target.toLocaleUpperCase().replace(/[^A-Z]/g, "");
}

export function matchSpellingTranscript(transcript: string, target: string): SpellingMatch {
  const expected = expectedLetters(target);
  const clean = transcript.toLocaleLowerCase().replace(/[^a-z\s-]/g, " ").replace(/double\s+u/g, "doubleyou");
  const tokens = clean.split(/[\s-]+/).filter(Boolean);
  const output: string[] = [];
  let doubleNext = false;
  for (const token of tokens) {
    if (token === "double") { doubleNext = true; continue; }
    let value = LETTER_NAMES[token];
    if (!value && /^[a-z]+$/.test(token)) {
      const upper = token.toLocaleUpperCase();
      if (expected.startsWith(upper) || upper === expected) value = upper;
    }
    if (!value) continue;
    output.push(value);
    if (doubleNext) { output.push(value); doubleNext = false; }
  }
  const letters = output.join("").slice(0, Math.max(expected.length + 2, 1));
  let matchedCount = 0;
  while (matchedCount < letters.length && letters[matchedCount] === expected[matchedCount]) matchedCount += 1;
  const mismatchAt = matchedCount < letters.length ? matchedCount : null;
  return { letters, matchedCount, complete: letters === expected && expected.length > 0, mismatchAt };
}
