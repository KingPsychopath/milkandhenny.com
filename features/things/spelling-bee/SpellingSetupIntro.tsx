import { SpellingModeNav } from "./SpellingModeNav";

export function SpellingSetupIntro({ mode }: { mode: "aloud" | "together" }) {
  return (
    <section className="mx-auto w-full max-w-lg pt-7">
      <p className="font-mono text-micro uppercase tracking-[0.2em] text-white/45">
        spelling bee · {mode === "aloud" ? "say it aloud" : "type together"}
      </p>
      <h1 className="mt-3 font-serif text-6xl font-semibold leading-none tracking-tight">Spelling Bee.</h1>
      <p className="mt-5 min-h-14 max-w-md font-serif text-lg leading-relaxed text-white/65">
        {mode === "aloud"
          ? "Hear the word, spell it aloud, then tilt or let a judge decide."
          : "Share this screen. Players listen, type privately, then reveal together."}
      </p>
      <SpellingModeNav mode={mode} />
    </section>
  );
}
