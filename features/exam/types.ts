export type ExamAnswers = Record<string, string[]>;

export type ExamUnlockResult = { ok: true; answers: ExamAnswers } | { ok: false; error: string };
