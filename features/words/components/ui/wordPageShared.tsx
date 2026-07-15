const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "and",
  "or",
  "but",
  "is",
  "it",
  "its",
  "my",
  "i",
  "we",
  "so",
  "no",
  "do",
  "if",
  "by",
  "as",
  "up",
  "be",
  "am",
  "are",
  "was",
  "were",
  "not",
  "this",
  "that",
  "with",
  "from",
]);

function highlightWordTitle(title: string) {
  const words = title.split(/\s+/);
  if (words.length <= 2) return title;

  const count = Math.max(1, Math.round(words.length * 0.35));
  const scored = words.map((word, i) => {
    const clean = word.toLowerCase().replace(/[^a-z]/g, "");
    return { i, score: STOP_WORDS.has(clean) ? 0 : word.length };
  });

  const highlighted = new Set(
    [...scored]
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .slice(0, count)
      .map((s) => s.i),
  );

  const runs: { text: string; lit: boolean }[] = [];
  for (let i = 0; i < words.length; i++) {
    const lit = highlighted.has(i);
    const prev = runs[runs.length - 1];
    if (prev && prev.lit === lit) {
      prev.text += ` ${words[i]}`;
    } else {
      runs.push({ text: words[i], lit });
    }
  }

  return runs.map((run, i) => (
    <span key={`${run.text}-${i}`}>
      {i > 0 && " "}
      {run.lit ? <span className="highlight-selection">{run.text}</span> : run.text}
    </span>
  ));
}

function formatWordDate(dateStr: string): string {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? `${dateStr}T00:00:00` : dateStr;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export { highlightWordTitle, formatWordDate };
