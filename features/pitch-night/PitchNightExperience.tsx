import { Link } from "@tanstack/react-router";
import { useRef } from "react";

import { DjScene, Finale, GamesScene, SpellingScene, SupperScene } from "./PitchNightJourney";
import { PitchNightHero, PitchNightPrologue, PitchScene } from "./PitchNightOpening";
import { usePitchNightMotion } from "./usePitchNightMotion";
import "./PitchNightExperience.css";

export function PitchNightExperience({ ticketHref }: { ticketHref: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  usePitchNightMotion(rootRef, canvasRef);

  return (
    <main id="main" ref={rootRef} className="pitch-night">
      <canvas ref={canvasRef} className="pitch-night-canvas" aria-hidden="true" />
      <div className="pitch-night-grain" aria-hidden="true" />
      <div className="pitch-night-progress" aria-hidden="true">
        <span data-progress />
      </div>

      <nav className="pitch-night-nav" aria-label="Pitch Night">
        <Link to="/" className="pitch-night-nav-home">
          milk & henny
        </Link>
        <div className="pitch-night-nav-actions">
          <a href="#the-night" className="pitch-night-nav-story">
            the night
          </a>
          <a href={ticketHref} className="pitch-night-nav-ticket">
            get tickets
          </a>
        </div>
      </nav>

      <PitchNightHero />
      <PitchNightPrologue />
      <PitchScene />
      <div className="pitch-night-breath" aria-hidden="true">
        <div className="pitch-night-breath-track">
          okay, breathe · now spell this · okay, breathe · now spell this ·
        </div>
      </div>
      <SpellingScene />
      <GamesScene />
      <DjScene />
      <SupperScene />
      <Finale ticketHref={ticketHref} />
    </main>
  );
}
