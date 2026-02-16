"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { SITE_BRAND } from "@/lib/shared/config";

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
      { label: "(c)", marks: 3, text: "Determine the nature of each stationary point using the second derivative." },
      { label: "(d)", marks: 3, text: "Find the equation of the normal to the curve at the point where x = 0." },
    ],
    preamble: "A curve C has the equation:\n\ny = 2x³ − 9x² + 12x − 4",
    answers: [
      "(a) dy/dx = 6x² − 18x + 12",
      "(b) Set 6x² − 18x + 12 = 0 → x² − 3x + 2 = 0 → (x−1)(x−2) = 0\n    x = 1 → y = 2−9+12−4 = 1  ⇒  (1, 1)\n    x = 2 → y = 16−36+24−4 = 0  ⇒  (2, 0)",
      "(c) d²y/dx² = 12x − 18\n    At x = 1: 12(1)−18 = −6 < 0 → Maximum\n    At x = 2: 12(2)−18 = 6 > 0 → Minimum",
      "(d) At x = 0: y = −4, gradient = 12\n    Normal gradient = −1/12\n    Equation: y = −(1/12)x − 4",
    ],
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
      { label: "(c)", marks: 3, text: "Find the probability that fewer than 3 bolts are defective." },
      {
        label: "(d)",
        marks: 3,
        text: "The inspector claims that the defect rate has increased. In a new sample of 20 bolts, 5 are found to be defective. Test, at the 5% significance level, whether there is evidence to support the inspector's claim. State your hypotheses clearly.",
      },
    ],
    preamble:
      "A factory produces bolts. From historical data, 8% of bolts are defective. A quality inspector selects a random sample of 20 bolts.",
    answers: [
      "(a) X ~ B(20, 0.08)\n    Assumptions: independent trials, constant probability of defect.",
      "(b) P(X = 2) = C(20,2) × (0.08)² × (0.92)¹⁸ = 0.2711 (4 d.p.)",
      "(c) P(X < 3) = P(0) + P(1) + P(2)\n    = 0.1887 + 0.3282 + 0.2711 = 0.7880 (4 d.p.)",
      "(d) H₀: p = 0.08   H₁: p > 0.08 (one-tailed)\n    P(X ≥ 5) = 1 − P(X ≤ 4) = 1 − 0.9890 = 0.0110\n    0.0110 < 0.05 → Reject H₀\n    Sufficient evidence at 5% level to support the claim.",
    ],
  },
  {
    id: 3,
    section: "Mechanics",
    marks: 10,
    parts: [
      { label: "(a)", marks: 2, text: "Draw a clearly labelled force diagram showing all forces acting on P." },
      {
        label: "(b)",
        marks: 5,
        text: "Show that the particle moves down the plane, and find the acceleration of P down the plane.",
      },
      { label: "(c)", marks: 3, text: "Find the speed of P after it has travelled 6 metres down the plane." },
    ],
    preamble:
      "A particle P of mass 4 kg is held at rest on a rough inclined plane that makes an angle of 30° with the horizontal. The coefficient of friction between P and the plane is μ = 0.3. The particle is released from rest.\n\nTake g = 9.8 m s⁻².",
    answers: [
      "(a) Weight 4g (39.2 N) vertically downward\n    Normal reaction R perpendicular to plane\n    Friction F acting up the plane",
      "(b) Resolving ⊥ to plane: R = 4g cos 30° = 33.95 N\n    Friction: F = μR = 0.3 × 33.95 = 10.19 N\n    Resolving ∥ to plane: 4g sin 30° − F = 4a\n    19.6 − 10.19 = 4a → a = 2.35 m s⁻²\n    Component down plane (19.6 N) > Friction (10.19 N) ∴ particle moves.",
      "(c) v² = u² + 2as = 0 + 2(2.35)(6) = 28.2\n    v = √28.2 = 5.31 m s⁻¹",
    ],
  },
] as const;

const PIN = "2030";

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ExamPage() {
  const [openQ, setOpenQ] = useState<number | null>(null);
  const [pinInput, setPinInput] = useState("");
  const [showAnswers, setShowAnswers] = useState(false);
  const [pinError, setPinError] = useState(false);

  const toggle = useCallback((id: number) => setOpenQ((prev) => (prev === id ? null : id)), []);

  const handlePinSubmit = useCallback(() => {
    if (pinInput === PIN) {
      setShowAnswers(true);
      setPinError(false);
    } else {
      setPinError(true);
      setPinInput("");
    }
  }, [pinInput]);

  const totalMarks = QUESTIONS.reduce((s, q) => s + q.marks, 0);

  return (
    <main className="min-h-screen py-12 px-6 bg-background text-foreground">
      <div className="mx-auto max-w-[720px]">
        {/* ── Header ── */}
        <header className="text-center mb-12">
          <Link
            href="/"
            className="inline-block font-mono text-xs tracking-tighter font-bold mb-6 transition-opacity duration-300 hover:opacity-60 theme-muted"
          >
            {SITE_BRAND}
          </Link>
          <p className="font-mono text-xs tracking-widest uppercase mb-4 theme-muted">Advanced Level Examination</p>
          <h1 className="font-serif text-3xl font-bold mb-2 text-[var(--prose-heading)]">Mathematics</h1>
          <p className="font-mono text-sm theme-subtle">Paper 1 — Pure, Statistics &amp; Mechanics</p>

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
              <section key={q.id} className="border rounded-md overflow-hidden transition-colors duration-300 theme-border">
                {/* Envelope header */}
                <button
                  id={`exam-q-${q.id}-btn`}
                  onClick={() => toggle(q.id)}
                  aria-expanded={isOpen}
                  aria-controls={`exam-q-${q.id}-body`}
                  className="w-full flex items-center justify-between px-5 py-4 text-left cursor-pointer transition-opacity duration-300 hover:opacity-80 bg-[var(--stone-100)]"
                >
                  <div className="flex items-baseline gap-3">
                    <span className="font-mono text-lg font-bold text-[var(--prose-heading)]">{q.id}.</span>
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
                            <p className="font-serif text-base leading-relaxed text-[var(--prose-body)]">{part.text}</p>
                            <p className="font-mono text-xs mt-1 text-right theme-muted">
                              [{part.marks} mark{part.marks > 1 ? "s" : ""}]
                            </p>

                            {/* Answer (if unlocked) */}
                            {showAnswers && q.answers[i] && (
                              <div className="mt-3 p-3 rounded border-l-2 font-mono text-xs leading-relaxed whitespace-pre-line bg-[var(--stone-100)] border-[var(--prose-hashtag)] text-[var(--prose-hashtag)]">
                                {q.answers[i]}
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
          {showAnswers ? (
            <p className="font-mono text-xs text-[var(--prose-hashtag)]">mark scheme unlocked</p>
          ) : (
            <div className="inline-flex flex-col items-center gap-3">
              <p className="font-mono text-xs theme-muted">enter pin to reveal mark scheme</p>
              <div className="flex gap-2">
                <input
                  type="password"
                  maxLength={4}
                  value={pinInput}
                  onChange={(e) => {
                    setPinInput(e.target.value);
                    setPinError(false);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handlePinSubmit()}
                  placeholder="••••"
                  className={`font-mono text-center text-sm w-24 px-3 py-2 rounded border outline-none transition-colors duration-300 bg-[var(--stone-100)] text-foreground ${
                    pinError ? "border-red-500" : "theme-border-strong"
                  }`}
                />
                <button
                  onClick={handlePinSubmit}
                  className="font-mono text-xs px-4 py-2 rounded border cursor-pointer transition-opacity duration-300 hover:opacity-70 theme-border-strong bg-[var(--stone-100)] text-foreground"
                >
                  unlock
                </button>
              </div>
              {pinError && <p className="font-mono text-xs text-red-500">incorrect pin</p>}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <footer role="contentinfo" className="mt-12 text-center font-mono text-xs space-y-3 theme-muted">
          <p>end of questions</p>
          <div className="border-t theme-border pt-4">
            <Link href="/" className="hover:opacity-60 transition-opacity duration-300">
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
