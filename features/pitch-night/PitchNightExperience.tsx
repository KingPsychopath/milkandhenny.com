import { Link } from "@tanstack/react-router";
import { useRef } from "react";

import { PitchNightAmbience } from "./PitchNightAmbience";
import { PitchNightAudioProvider } from "./PitchNightAudio";
import { DjScene, Finale, GamesScene, SpellingScene, SupperScene } from "./PitchNightJourney";
import { PitchNightHero, PitchNightPrologue, PitchScene } from "./PitchNightOpening";
import { usePitchNightMotion } from "./usePitchNightMotion";
import "./PitchNightExperience.css";

export function PitchNightExperience({ ticketHref }: { ticketHref: string }) {
  return (
    <PitchNightAudioProvider>
      <PitchNightStory ticketHref={ticketHref} />
    </PitchNightAudioProvider>
  );
}

function PitchNightStory({ ticketHref }: { ticketHref: string }) {
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

      <nav className="pitch-night-nav" aria-label="After School Club">
        <Link to="/" className="pitch-night-nav-home">
          milk & henny
        </Link>
        <div className="pitch-night-nav-actions">
          <PitchNightAmbience />
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
      <div className="pitch-night-breath" data-breath aria-hidden="true">
        <span className="pitch-night-breath-horizon" />
        <span className="pitch-night-breath-pulse" data-breath-pulse />
        <p className="pitch-night-breath-kicker">one breath before the next thing</p>
        <div className="pitch-night-breath-words">
          <span data-breath-word>okay,</span>
          <span data-breath-word>breathe.</span>
          <span data-breath-word>now spell this.</span>
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
