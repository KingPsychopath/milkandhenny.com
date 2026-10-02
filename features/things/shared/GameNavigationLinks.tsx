import { Link } from "@tanstack/react-router";

export function GameNavigationLinks({ gamePath }: { gamePath?: string }) {
  return (
    <nav aria-label="Game navigation" className="mt-6 flex flex-wrap justify-center gap-3">
      {gamePath ? (
        <Link to={gamePath} replace className="mh-action mh-action--secondary">
          back to setup
        </Link>
      ) : null}
      <Link to="/things" className="mh-action mh-action--quiet">
        all games
      </Link>
    </nav>
  );
}
