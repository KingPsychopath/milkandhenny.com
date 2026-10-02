import { Link } from "@tanstack/react-router";

export function RoomUnavailableState({
  gameName,
  gamePath,
  title = "This room has ended.",
  detail = "Start a new game or choose another one.",
}: {
  gameName: string;
  gamePath: string;
  title?: string;
  detail?: string;
}) {
  return (
    <main
      id="main"
      className="room-unavailable mx-auto flex min-h-svh w-full max-w-lg flex-col justify-center px-6 py-16 text-center"
    >
      <p className="font-mono text-micro uppercase tracking-[0.18em] theme-muted">room finished</p>
      <h1 className="mt-3 font-serif text-5xl font-semibold">{title}</h1>
      <p className="mt-5 font-serif text-lg leading-relaxed theme-subtle">{detail}</p>
      <Link
        to={gamePath}
        className="mt-9 inline-flex min-h-14 items-center justify-center rounded-full bg-[var(--foreground)] px-7 text-center font-mono text-sm font-bold text-[var(--background)] transition-opacity hover:opacity-85"
      >
        play {gameName} again
      </Link>
      <Link
        to="/things"
        className="mt-3 inline-flex min-h-12 items-center justify-center rounded-full border theme-border px-6 text-center font-mono text-xs transition-opacity hover:opacity-75"
      >
        choose another game
      </Link>
    </main>
  );
}
