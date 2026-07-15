import { Link } from "@tanstack/react-router";

export function SpellingModeNav({ mode }: { mode: "aloud" | "together" }) {
  const itemClass = (active: boolean) =>
    `min-h-24 p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--things-amber)] ${active ? "bg-white/12 text-white" : "text-white/55 hover:bg-white/[0.06] hover:text-white"}`;

  return (
    <nav aria-label="Spelling Bee mode" className="mt-7 overflow-hidden rounded-3xl border border-white/15">
      <p className="border-b border-white/12 px-4 py-3 font-mono text-micro uppercase tracking-[0.18em] text-white/45">
        How are you playing?
      </p>
      <div className="grid grid-cols-2 divide-x divide-white/12">
        <Link to="/things/spelling-bee" aria-current={mode === "aloud" ? "page" : undefined} className={itemClass(mode === "aloud")}>
          <span className="block font-serif text-lg font-semibold leading-tight">Say it aloud</span>
          <span className="mt-2 block font-mono text-micro leading-relaxed text-white/45">one phone · offline</span>
        </Link>
        <Link to="/things/spelling-party" aria-current={mode === "together" ? "page" : undefined} className={itemClass(mode === "together")}>
          <span className="block font-serif text-lg font-semibold leading-tight">Type together</span>
          <span className="mt-2 block font-mono text-micro leading-relaxed text-white/45">shared screen · live</span>
        </Link>
      </div>
    </nav>
  );
}
