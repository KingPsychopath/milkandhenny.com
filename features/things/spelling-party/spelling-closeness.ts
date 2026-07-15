export interface SpellingCloseness {
  distance: number;
  similarity: number;
  place: number;
}

function normalizeSpelling(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

export function spellingDistance(answer: string, target: string) {
  const left = Array.from(normalizeSpelling(answer));
  const right = Array.from(normalizeSpelling(target));
  const rows = Array.from({ length: left.length + 1 }, (_, row) => Array.from({ length: right.length + 1 }, (_, column) => row === 0 ? column : column === 0 ? row : 0));

  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      const substitution = left[row - 1] === right[column - 1] ? 0 : 1;
      rows[row][column] = Math.min(
        rows[row - 1][column] + 1,
        rows[row][column - 1] + 1,
        rows[row - 1][column - 1] + substitution,
      );
      if (row > 1 && column > 1 && left[row - 1] === right[column - 2] && left[row - 2] === right[column - 1]) {
        rows[row][column] = Math.min(rows[row][column], rows[row - 2][column - 2] + 1);
      }
    }
  }

  return rows[left.length][right.length];
}

export function rankSpellingAnswers<T extends { answer: string; name: string }>(answers: readonly T[], target: string): Array<T & SpellingCloseness> {
  const targetLength = Math.max(1, Array.from(normalizeSpelling(target)).length);
  const ranked = answers.map((answer) => {
    const distance = spellingDistance(answer.answer, target);
    const comparisonLength = Math.max(targetLength, Array.from(normalizeSpelling(answer.answer)).length, 1);
    return { ...answer, distance, similarity: Math.max(0, Math.round((1 - distance / comparisonLength) * 100)), place: 0 };
  }).sort((left, right) => {
    const leftBlank = normalizeSpelling(left.answer).length === 0;
    const rightBlank = normalizeSpelling(right.answer).length === 0;
    if (leftBlank !== rightBlank) return leftBlank ? 1 : -1;
    return left.distance - right.distance || left.name.localeCompare(right.name);
  });

  let place = 0;
  let previousKey = "";
  return ranked.map((answer) => {
    const key = normalizeSpelling(answer.answer) ? `distance:${answer.distance}` : "blank";
    if (key !== previousKey) {
      place += 1;
      previousKey = key;
    }
    return { ...answer, place };
  });
}
