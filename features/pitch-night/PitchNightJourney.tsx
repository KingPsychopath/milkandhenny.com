import { Link } from "@tanstack/react-router";
import type { CSSProperties } from "react";

import { PitchNightVinyl } from "./PitchNightVinyl";
import { RevealLine, SceneNumber } from "./PitchNightTypography";

const SPELLING_WORD = "RHYTHM";
const EQUALIZER = [42, 72, 56, 94, 64, 82, 48, 76, 38, 68, 52, 88];
const FINALE_DEBRIS = Array.from({ length: 9 }, (_, index) => index);

export function SpellingScene() {
  return (
    <section className="pitch-night-spelling-scene">
      <SceneNumber>02 · THE SPELLING BEE</SceneNumber>
      <div className="pitch-night-spelling-inner">
        <p className="pitch-night-conversation">
          <RevealLine>Then I’ll give you a word</RevealLine>
          <RevealLine>you absolutely know.</RevealLine>
        </p>
        <div className="pitch-night-spelling-word" data-spelling-word>
          <span className="sr-only">{SPELLING_WORD}</span>
          {SPELLING_WORD.split("").map((letter, index) => (
            <span key={`${letter}-${index}`} data-spelling-letter aria-hidden="true">
              {letter}
            </span>
          ))}
        </div>
        <p className="pitch-night-body-copy pitch-night-spelling-copy" data-soft-reveal>
          You’ll say it slowly. The room will go quiet. Suddenly every letter looks made up. We’ll
          be rooting for you anyway.
        </p>
      </div>
    </section>
  );
}

export function GamesScene() {
  return (
    <section className="pitch-night-games-scene" data-games-scene>
      <SceneNumber>03 · THE BOARD GAMES</SceneNumber>
      <div className="pitch-night-games-orbit" aria-hidden="true">
        <span
          className="pitch-night-token pitch-night-token-die pitch-night-token-one"
          data-game-token
        >
          <span className="pitch-night-die-face">
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
        </span>
        <span
          className="pitch-night-token pitch-night-token-star pitch-night-token-two"
          data-game-token
        >
          ★
        </span>
        <span
          className="pitch-night-token pitch-night-token-cards pitch-night-token-three"
          data-game-token
        >
          <i>♣</i>
          <i>♥</i>
          <i>♠</i>
        </span>
        <span className="pitch-night-meeple" data-game-token />
        <svg className="pitch-night-game-path" viewBox="0 0 800 500">
          <path d="M48 398C176 154 292 478 420 236S644 42 758 146" />
        </svg>
      </div>
      <div className="pitch-night-games-copy">
        <p className="pitch-night-conversation">
          <RevealLine>Pick a table.</RevealLine>
          <RevealLine>Someone is already</RevealLine>
          <RevealLine>explaining the rules.</RevealLine>
        </p>
        <p className="pitch-night-body-copy" data-soft-reveal>
          Bring the game you keep trying to get your friends to play. Or sit down and let a stranger
          teach you theirs. By round two, nobody is a stranger.
        </p>
        <p className="pitch-night-aside" data-soft-reveal>
          Winning is optional. Becoming unbearable about it is not.
        </p>
      </div>
    </section>
  );
}

export function DjScene() {
  return (
    <section className="pitch-night-dj-scene" data-dj-scene>
      <SceneNumber>04 · APARTMENT LIFE</SceneNumber>
      <PitchNightVinyl />
      <div className="pitch-night-dj-copy">
        <p className="pitch-night-conversation">
          <RevealLine>Eventually, sitting down</RevealLine>
          <RevealLine>starts to feel a bit silly.</RevealLine>
        </p>
        <p className="pitch-night-body-copy" data-soft-reveal>
          Apartment Life takes over. The music gets louder. If your plan was to stand at the edge
          and nod politely, I’m afraid that isn’t going to work.
        </p>
        <div className="pitch-night-equalizer" data-equalizer aria-hidden="true">
          {EQUALIZER.map((height, index) => (
            <span key={`${height}-${index}`} data-eq-bar style={{ height: `${height}%` }} />
          ))}
        </div>
        <p className="pitch-night-aside" data-soft-reveal>
          You better dance or else.
        </p>
      </div>
    </section>
  );
}

export function SupperScene() {
  const placeSettings = Array.from({ length: 5 }, (_, index) => index);
  const guests = Array.from({ length: 6 }, (_, index) => index);

  return (
    <section className="pitch-night-supper-scene" data-supper-scene>
      <div className="pitch-night-cabin" aria-hidden="true">
        <span className="pitch-night-cabin-beam pitch-night-cabin-beam-left" />
        <span className="pitch-night-cabin-beam pitch-night-cabin-beam-right" />
        <div className="pitch-night-cabin-window">
          <i className="pitch-night-cabin-moon" />
          <i className="pitch-night-cabin-ridge pitch-night-cabin-ridge-far" />
          <i className="pitch-night-cabin-ridge pitch-night-cabin-ridge-near" />
        </div>
      </div>
      <div className="pitch-night-lanterns" aria-hidden="true">
        {Array.from({ length: 3 }, (_, index) => (
          <span key={index} data-lantern style={{ "--lantern-index": index } as CSSProperties}>
            <i className="pitch-night-lantern-aura" />
            <i className="pitch-night-lantern-cage">
              <i className="pitch-night-lantern-flame" />
            </i>
          </span>
        ))}
      </div>
      <SceneNumber>05 · AROUND THE TABLE</SceneNumber>
      <div className="pitch-night-supper-copy">
        <p className="pitch-night-conversation" data-supper-heading>
          <span className="pitch-night-line">
            <span data-supper-line>There is food.</span>
          </span>
          <span className="pitch-night-line">
            <span data-supper-line>Proper food.</span>
          </span>
        </p>
        <p className="pitch-night-body-copy" data-soft-reveal>
          Come hungry. I mean it. We’re eating together before the room gets loud, because the best
          nights begin around a table and nobody gives a good pitch on an empty stomach.
        </p>
      </div>
      <div className="pitch-night-table-scene" data-table-scene aria-hidden="true">
        <div className="pitch-night-supper-guests">
          {guests.map((guest) => (
            <span
              key={guest}
              className={`pitch-night-supper-guest pitch-night-supper-guest-${guest + 1}`}
              data-supper-guest
            >
              <i className="pitch-night-guest-head" />
              <i className="pitch-night-guest-body" />
              <i className="pitch-night-guest-gesture" />
            </span>
          ))}
        </div>
        <i className="pitch-night-table-light" data-table-light />
        <div className="pitch-night-table" data-table-top>
          <i className="pitch-night-table-grain" />
          <i className="pitch-night-table-runner" />
          {placeSettings.map((place) => (
            <span
              key={place}
              className={`pitch-night-place-setting pitch-night-place-setting-${place + 1}`}
              data-table-place
            >
              <i className="pitch-night-plate" />
              <i className="pitch-night-napkin" />
              <i className="pitch-night-course" data-table-food />
              <i className="pitch-night-glass" data-table-drink />
              <i className="pitch-night-cutlery" />
            </span>
          ))}
          <span className="pitch-night-table-centrepiece" data-table-centrepiece>
            <i className="pitch-night-candle">
              <i />
            </i>
            <i className="pitch-night-serving-bowl" data-table-food />
            <i className="pitch-night-bread" data-table-food />
          </span>
        </div>
        <div className="pitch-night-table-edge" />
      </div>
    </section>
  );
}

export function Finale({ ticketHref }: { ticketHref: string }) {
  return (
    <section className="pitch-night-finale">
      <div className="pitch-night-final-orbit" data-final-orbit aria-hidden="true">
        <div className="pitch-night-final-window">
          <i className="pitch-night-final-window-core" />
          <i className="pitch-night-final-window-cloud pitch-night-final-window-cloud-a" />
          <i className="pitch-night-final-window-cloud pitch-night-final-window-cloud-b" />
        </div>
        <i className="pitch-night-final-arc pitch-night-final-arc-a" />
        <i className="pitch-night-final-arc pitch-night-final-arc-b" />
        <i className="pitch-night-final-arc pitch-night-final-arc-c" />
        <i className="pitch-night-final-arc pitch-night-final-arc-d" />
        <div className="pitch-night-final-debris">
          {FINALE_DEBRIS.map((piece) => (
            <i key={piece} />
          ))}
        </div>
      </div>
      <div className="pitch-night-paper-band" data-finale-flyby aria-hidden="true">
        <span className="pitch-night-band-member pitch-night-band-member-a" />
        <span className="pitch-night-band-member pitch-night-band-member-b" />
        <span className="pitch-night-band-member pitch-night-band-member-c" />
        <i className="pitch-night-band-note pitch-night-band-note-a">♪</i>
        <i className="pitch-night-band-note pitch-night-band-note-b">♫</i>
      </div>
      <div className="pitch-night-finale-inner">
        <img data-final-logo src="/MAHLogo.svg" alt="" className="pitch-night-final-logo" />
        <p className="pitch-night-kicker" data-soft-reveal>
          your turn
        </p>
        <h2 className="pitch-night-final-question">
          <RevealLine>So.</RevealLine>
          <RevealLine>What are you bringing?</RevealLine>
        </h2>
        <p className="pitch-night-finale-copy" data-soft-reveal>
          Bring the thought you can’t stop returning to: a pitch, an unpopular opinion, or a wild
          theory. We’ll save you a seat, pass you the mic, and see where the night goes.
        </p>
        <div className="pitch-night-finale-actions" data-soft-reveal>
          <Link to="/things/pitches/new" className="pitch-night-button pitch-night-button-light">
            make your pitch
          </Link>
          <a href={ticketHref} className="pitch-night-button pitch-night-button-ghost">
            come to the night
          </a>
        </div>
        <p className="pitch-night-parking" data-soft-reveal>
          And yes, parking is free.
        </p>
      </div>
    </section>
  );
}
