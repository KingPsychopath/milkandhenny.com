import { useState, useCallback, type FormEvent } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { unlockExamAnswersFn } from "@/features/exam/exam.functions";
import type { ExamAnswers } from "@/features/exam/types";
import { SITE_BRAND } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";

/* ------------------------------------------------------------------ */
/*  Data                                                               */
/* ------------------------------------------------------------------ */

const QUESTIONS = [
  {
    id: 1,
    section: "Pure Mathematics",
    marks: 12,
    parts: [
      { label: "(a)", marks: 2, text: "Find dy/dx." },
      { label: "(b)", marks: 4, text: "Find the coordinates of the two stationary points of C." },
      {
        label: "(c)",
        marks: 3,
        text: "Determine the nature of each stationary point using the second derivative.",
      },
      {
        label: "(d)",
        marks: 3,
        text: "Find the equation of the normal to the curve at the point where x = 0.",
      },
    ],
    preamble: "A curve C has the equation:\n\ny = 2x³ − 9x² + 12x − 4",
  },
  {
    id: 2,
    section: "Statistics",
    marks: 10,
    parts: [
      {
        label: "(a)",
        marks: 2,
        text: "State a suitable distribution to model the number of defective bolts in the sample, including any assumptions you make.",
      },
      { label: "(b)", marks: 2, text: "Find the probability that exactly 2 bolts are defective." },
      {
        label: "(c)",
        marks: 3,
        text: "Find the probability that fewer than 3 bolts are defective.",
      },
      {
        label: "(d)",
        marks: 3,
        text: "The inspector claims that the defect rate has increased. In a new sample of 20 bolts, 5 are found to be defective. Test, at the 5% significance level, whether there is evidence to support the inspector's claim. State your hypotheses clearly.",
      },
    ],
    preamble:
      "A factory produces bolts. From historical data, 8% of bolts are defective. A quality inspector selects a random sample of 20 bolts.",
  },
  {
    id: 3,
    section: "Mechanics",
    marks: 10,
    parts: [
      {
        label: "(a)",
        marks: 2,
        text: "Draw a clearly labelled force diagram showing all forces acting on P.",
      },
      {
        label: "(b)",
        marks: 5,
        text: "Show that the particle moves down the plane, and find the acceleration of P down the plane.",
      },
      {
        label: "(c)",
        marks: 3,
        text: "Find the speed of P after it has travelled 6 metres down the plane.",
      },
    ],
    preamble:
      "A particle P of mass 4 kg is held at rest on a rough inclined plane that makes an angle of 30° with the horizontal. The coefficient of friction between P and the plane is μ = 0.3. The particle is released from rest.\n\nTake g = 9.8 m s⁻².",
  },
] as const;

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export const Route = createFileRoute("/exam")({
  component: ExamPage,
  head: () =>
    buildSeoHead({
      title: `Exam — ${SITE_BRAND}`,
      description: "A private practice exam and answer key.",
      path: "/exam",
      robots: "noindex, nofollow",
    }),
});

function ExamPage() {
  const [openQ, setOpenQ] = useState<number | null>(null);
  const [pinInput, setPinInput] = useState("");
  const [answers, setAnswers] = useState<ExamAnswers | null>(null);
  const [pinStatus, setPinStatus] = useState("");
  const [isUnlocking, setIsUnlocking] = useState(false);

  const toggle = useCallback((id: number) => setOpenQ((prev) => (prev === id ? null : id)), []);

  const handlePinSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!pinInput.trim() || isUnlocking) return;
      setIsUnlocking(true);
      setPinStatus("");
      try {
        const result = await unlockExamAnswersFn({ data: { pin: pinInput } });
        if (result.ok) {
          setAnswers(result.answers);
          setPinInput("");
        } else {
          setPinStatus(result.error);
          setPinInput("");
        }
      } catch {
        setPinStatus("The mark scheme could not be unlocked. Try again.");
      } finally {
        setIsUnlocking(false);
      }
    },
    [isUnlocking, pinInput],
  );

  const totalMarks = QUESTIONS.reduce((s, q) => s + q.marks, 0);

  return (
    <main className="min-h-screen py-12 px-6 bg-background text-foreground">
      <div className="mx-auto max-w-[720px]">
        {/* ── Header ── */}
        <header className="text-center mb-12">
          <Link
            to="/"
            className="inline-flex min-h-11 min-w-11 items-center justify-center font-mono text-xs tracking-tighter font-bold mb-6 transition-opacity duration-300 hover:opacity-60 theme-muted"
          >
            {SITE_BRAND}
          </Link>
          <p className="font-mono text-xs tracking-widest uppercase mb-4 theme-muted">
            Advanced Level Examination
          </p>
          <h1 className="font-serif text-3xl font-bold mb-2 text-[var(--prose-heading)]">
            Mathematics
          </h1>
          <p className="font-mono text-sm theme-subtle">
            Paper 1 — Pure, Statistics &amp; Mechanics
          </p>

          <div className="mt-6 mx-auto border-t border-b py-4 theme-border max-w-[400px]">
            <div className="flex justify-between font-mono text-xs theme-subtle">
              <span>Time allowed: 45 minutes</span>
              <span>Total: {totalMarks} marks</span>
            </div>
          </div>

          <div className="mt-6 text-left font-mono text-xs leading-relaxed theme-muted">
            <p className="mb-1">Instructions to candidates:</p>
            <ul className="list-disc pl-5 space-y-0.5">
              <li>Answer ALL questions.</li>
              <li>No calculator for Question 1 (Pure Mathematics).</li>
              <li>Calculator permitted for Questions 2 and 3.</li>
              <li>Show all working clearly.</li>
            </ul>
          </div>
        </header>

        {/* ── Questions ── */}
        <div className="space-y-4">
          {QUESTIONS.map((q) => {
            const isOpen = openQ === q.id;
            return (
              <section
                key={q.id}
                className="border rounded-md overflow-hidden transition-colors duration-300 theme-border"
              >
                {/* Envelope header */}
                <button
                  type="button"
                  id={`exam-q-${q.id}-btn`}
                  onClick={() => toggle(q.id)}
                  aria-expanded={isOpen}
                  aria-controls={`exam-q-${q.id}-body`}
                  className="w-full flex items-center justify-between px-5 py-4 text-left cursor-pointer transition-opacity duration-300 hover:opacity-80 bg-[var(--stone-100)]"
                >
                  <div className="flex items-baseline gap-3">
                    <span className="font-mono text-lg font-bold text-[var(--prose-heading)]">
                      {q.id}.
                    </span>
                    <span className="font-mono text-sm theme-subtle">{q.section}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs theme-muted">[{q.marks} marks]</span>
                    <span
                      className="font-mono text-sm transition-transform duration-300 inline-block theme-muted"
                      style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                    >
                      ▼
                    </span>
                  </div>
                </button>

                {/* Question body */}
                <div
                  id={`exam-q-${q.id}-body`}
                  role="region"
                  aria-labelledby={`exam-q-${q.id}-btn`}
                  aria-hidden={!isOpen}
                  className="transition-all duration-400 ease-in-out overflow-hidden"
                  style={{ maxHeight: isOpen ? 2000 : 0, opacity: isOpen ? 1 : 0 }}
                >
                  <div className="px-5 py-5 border-t theme-border">
                    {/* Preamble */}
                    <p className="font-serif text-base leading-relaxed mb-5 whitespace-pre-line text-[var(--prose-body)]">
                      {q.preamble}
                    </p>

                    {/* Parts */}
                    <div className="space-y-4">
                      {q.parts.map((part, i) => (
                        <div key={part.label} className="flex gap-3">
                          <span className="font-mono text-sm font-bold shrink-0 pt-0.5 text-[var(--prose-heading)]">
                            {part.label}
                          </span>
                          <div className="flex-1">
                            <p className="font-serif text-base leading-relaxed text-[var(--prose-body)]">
                              {part.text}
                            </p>
                            <p className="font-mono text-xs mt-1 text-right theme-muted">
                              [{part.marks} mark{part.marks > 1 ? "s" : ""}]
                            </p>

                            {/* Answer (if unlocked) */}
                            {answers?.[String(q.id)]?.[i] && (
                              <div className="mt-3 p-3 rounded border-l-2 font-mono text-xs leading-relaxed whitespace-pre-line bg-[var(--stone-100)] border-[var(--prose-hashtag)] text-[var(--prose-hashtag)]">
                                {answers[String(q.id)][i]}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            );
          })}
        </div>

        {/* ── Answer unlock ── */}
        <div className="mt-10 border-t pt-8 text-center theme-border">
          {answers ? (
            <p className="font-mono text-xs text-[var(--prose-hashtag)]">mark scheme unlocked</p>
          ) : (
            <form onSubmit={handlePinSubmit} className="inline-flex flex-col items-center gap-3">
              <label htmlFor="exam-pin" className="font-mono text-xs theme-muted">
                enter pin to reveal mark scheme
              </label>
              <div className="flex gap-2">
                <input
                  id="exam-pin"
                  name="exam-pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={64}
                  value={pinInput}
                  onChange={(e) => {
                    setPinInput(e.target.value);
                    setPinStatus("");
                  }}
                  placeholder="••••"
                  aria-invalid={Boolean(pinStatus)}
                  aria-describedby={pinStatus ? "exam-pin-status" : undefined}
                  className={`min-h-11 font-mono text-center text-base sm:text-sm w-28 px-3 py-2 rounded border outline-none transition-colors duration-300 bg-[var(--stone-100)] text-foreground ${
                    pinStatus ? "border-[var(--status-danger)]" : "theme-border-strong"
                  }`}
                />
                <button
                  type="submit"
                  disabled={isUnlocking || !pinInput.trim()}
                  className="min-h-11 font-mono text-xs px-4 py-2 rounded border cursor-pointer transition-opacity duration-300 hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-50 theme-border-strong bg-[var(--stone-100)] text-foreground"
                >
                  {isUnlocking ? "unlocking…" : "unlock"}
                </button>
              </div>
              <p
                id="exam-pin-status"
                role={pinStatus ? "alert" : "status"}
                aria-live="polite"
                className="min-h-4 font-mono text-xs text-[var(--status-danger)]"
              >
                {pinStatus}
              </p>
            </form>
          )}
        </div>

        {/* ── Footer ── */}
        <footer className="mt-12 text-center font-mono text-xs space-y-3 theme-muted">
          <p>end of questions</p>
          <div className="border-t theme-border pt-4">
            <Link
              to="/"
              className="inline-flex min-h-11 min-w-11 items-center justify-center hover:opacity-60 transition-opacity duration-300"
            >
              ← home
            </Link>
            <p className="mt-2 theme-faint">
              © {new Date().getFullYear()} {SITE_BRAND}
            </p>
          </div>
        </footer>
      </div>
    </main>
  );
}
