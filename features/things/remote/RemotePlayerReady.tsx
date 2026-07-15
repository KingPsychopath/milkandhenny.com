import { Link } from "@tanstack/react-router";

export function RemotePlayerReady({
  gameName,
  deckName,
  detail,
  judgeConnected,
  onStart,
  onFullscreen,
}: {
  gameName: string;
  deckName: string;
  detail: string;
  judgeConnected: boolean;
  onStart: () => void;
  onFullscreen?: () => void;
}) {
  return (
    <div className="things-game things-game--night text-white">
      <header className="flex items-center justify-between p-5 font-mono text-xs text-white/55">
        <Link to="/things" className="inline-flex min-h-11 items-center">← leave</Link>
        <span aria-live="polite" className={judgeConnected ? "text-emerald-200" : "text-amber-200"}>
          {judgeConnected ? "● judge connected" : "judge reconnecting"}
        </span>
      </header>
      <main id="main" className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-6 pb-12 text-center">
        <p className="font-mono text-micro uppercase tracking-[0.2em] text-white/45">your phone runs {gameName}</p>
        <h1 className="mt-3 font-serif text-5xl font-semibold">Ready to play.</h1>
        <p className="mt-5 font-serif text-xl text-white/75">{deckName}</p>
        <p className="mx-auto mt-3 max-w-sm font-serif text-lg leading-relaxed text-white/55">{detail}</p>
        <p className="mx-auto mt-6 max-w-sm text-sm leading-relaxed text-white/45">Your game runs on this phone. If the connection drops, play continues and the judge reconnects automatically.</p>
        {onFullscreen ? <button type="button" onClick={onFullscreen} className="mt-6 min-h-11 font-mono text-xs text-white/60">use full screen</button> : null}
        <button type="button" onClick={onStart} className="mt-4 min-h-16 rounded-full bg-[var(--things-amber)] px-6 font-mono text-sm font-bold text-black">start on this phone</button>
      </main>
    </div>
  );
}
