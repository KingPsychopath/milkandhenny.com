const WORDS_PER_MINUTE = 230;

function estimateReadingTime(markdown: string): number {
  const words = markdown.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

export { estimateReadingTime, WORDS_PER_MINUTE };
