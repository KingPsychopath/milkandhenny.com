import { Link } from "@tanstack/react-router";

import { RevealLine, SceneNumber } from "./PitchNightTypography";

const FIREFLIES = Array.from({ length: 18 }, (_, index) => index);
const SLIDES = Array.from({ length: 6 }, (_, index) => index + 1);

export function PitchNightHero() {
  return (
    <section className="pitch-night-hero" data-hero>
      <div className="pitch-night-sky" aria-hidden="true">
        <div className="pitch-night-cloud pitch-night-cloud-far" data-cloud="far" />
        <div className="pitch-night-cloud pitch-night-cloud-near" data-cloud="near" />
        <div className="pitch-night-hill pitch-night-hill-back" />
        <div className="pitch-night-hill pitch-night-hill-front" />
        {FIREFLIES.map((firefly) => (
          <span key={firefly} className={`pitch-night-firefly firefly-${firefly + 1}`} />
        ))}
      </div>

      <div className="pitch-night-hero-inner">
        <div data-pitch-logo className="pitch-night-wordmark">
          <img src="/MAHtext.svg" alt="milk and henny" />
        </div>
        <p data-hero-kicker className="pitch-night-kicker">
          one long summer evening
        </p>
        <h1 className="pitch-night-hero-title">
          <span className="pitch-night-hero-line">
            <span data-hero-line>Bring the idea</span>
          </span>
          <span className="pitch-night-hero-line">
            <span data-hero-line>you almost talked</span>
          </span>
          <span className="pitch-night-hero-line">
            <span data-hero-line>yourself out of.</span>
          </span>
        </h1>
        <p className="pitch-night-hero-copy" data-soft-reveal>
          We’ll give it a projector. Then we’ll spell something impossible, play too seriously, eat
          well, and dance until the room forgets it had chairs.
        </p>
        <div data-hero-actions className="pitch-night-hero-actions">
          <Link to="/things/pitches/new" className="pitch-night-button pitch-night-button-light">
            make the six slides
          </Link>
          <a href="#the-night" className="pitch-night-text-link">
            come closer
            <span aria-hidden="true">↓</span>
          </a>
        </div>
        <p data-hero-whisper className="pitch-night-scroll-whisper">
          scroll slowly — the night is just waking up
        </p>
      </div>
    </section>
  );
}

export function PitchNightPrologue() {
  return (
    <section id="the-night" className="pitch-night-prologue" data-prologue>
      <div className="pitch-night-prologue-inner">
        <p className="pitch-night-kicker" data-soft-reveal>
          let’s do something for the plot
        </p>
        <h2 className="pitch-night-prologue-title">
          <RevealLine>Not for work.</RevealLine>
          <RevealLine>Not for content.</RevealLine>
          <RevealLine>Just because it might</RevealLine>
          <RevealLine>be a brilliant story.</RevealLine>
        </h2>
        <p className="pitch-night-prologue-copy" data-soft-reveal>
          Here’s the plan. You arrive. Somebody hands you food. Somebody else has a terrible idea.
          By the end of the night, you’re defending it to a room full of people you met an hour ago.
        </p>
      </div>
      <div className="pitch-night-paper-note pitch-night-paper-note-a" aria-hidden="true">
        bad ideas welcome
      </div>
      <div className="pitch-night-paper-note pitch-night-paper-note-b" aria-hidden="true">
        take the mic
      </div>
    </section>
  );
}

export function PitchScene() {
  return (
    <section className="pitch-night-pitch-scene" data-pitch-scene>
      <div className="pitch-night-pitch-sticky">
        <SceneNumber>01 · THE PITCH</SceneNumber>
        <div className="pitch-night-pitch-copy">
          <p className="pitch-night-pitch-quote" data-pitch-quote>
            {"I’m giving you six slides and a room full of strangers. What are you going to make us believe?"
              .split(" ")
              .map((word, index) => (
                <span key={`${word}-${index}`} data-quote-word>
                  {word}{" "}
                </span>
              ))}
          </p>
          <p className="pitch-night-body-copy" data-soft-reveal>
            A business. A conspiracy. A tiny revolution. The ranking system you’ve been carrying
            around in your head for years. If you care enough to put it on a slide, we care enough
            to listen.
          </p>
          <Link to="/things/pitches/new" className="pitch-night-text-link" data-soft-reveal>
            open the slide studio
            <span aria-hidden="true">↗</span>
          </Link>
        </div>
        <div className="pitch-night-slide-stack" data-slide-stack aria-hidden="true">
          {SLIDES.map((slide) => (
            <div
              key={slide}
              className={`pitch-night-slide-card pitch-night-slide-card-${slide}`}
              data-slide-card
            >
              <span>{String(slide).padStart(2, "0")}</span>
              {slide === 6 && <strong>convince us.</strong>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
