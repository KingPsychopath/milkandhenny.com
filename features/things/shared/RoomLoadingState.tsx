import { GameNavigationLinks } from "./GameNavigationLinks";

export function RoomLoadingState({
  gamePath,
  message = "Connecting…",
}: {
  gamePath?: string;
  message?: string;
}) {
  return (
    <main
      id="main"
      className="grid min-h-svh place-items-center bg-background px-6 text-foreground"
    >
      <div className="w-full max-w-sm text-center">
        <h1 className="font-serif text-3xl" role="status">
          {message}
        </h1>
        <GameNavigationLinks gamePath={gamePath} />
      </div>
    </main>
  );
}
