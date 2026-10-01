# Pairs

Pairs is a local memory game at `/things/pairs`, inspired by the flip-and-match
interaction on [Fay’s 404 page](https://faydkr.com/404). Its card design, rules,
animation and implementation belong to this application. No external assets or
code are loaded.

Choose 3, 6 or 10 pairs. Two cards with the same rank match, regardless of suit.
Matched cards fall off the table, leaving their positions empty. Solo play counts
tries and automatically hides misses after a short observation beat. Friends
play on one shared device: a match scores one pair and keeps the turn; a miss
passes it. The highest score wins, with shared wins for ties.

The two-device race gives both players the same shuffled board with independent
card choices. A three-second countdown starts each round. The first player to
clear their board wins that round; first to two round wins takes the match.
Both players explicitly ready between rounds and before a rematch.

## Room play profile

- Fun premise: People have fun together by remembering each other’s reveals,
  calling guesses, stealing a pair someone else exposed, and celebrating a clean sweep.
- Device topology: `single-device` for friends; one personal device for solo.
- Attention profile: `room-only` on a centrally placed tablet or laptop. A phone
  is the shared table when no larger screen is available.
- Shared focal point: The card table, the pair falling away, and the named next turn.
- Player-phone job: No separate phones, accounts, room codes or private roles.
- Main in-person activity: Predict, recall, tease a near miss and react to a match.
- Inactive-player role: Watch exposed positions and plan the next choice.
- Host responsibility: None beyond setting up names. The current player chooses
  two cards; the group explicitly advances each multiplayer reveal.
- Joining requirement: Two to six distinct names entered before dealing.
- Correction path: Undo the latest turn, including score and cleared cards.
  Skip an absent player’s turn without restarting.
- Result produced: Pair counts per named player, tries, and the winning names.
- Event-scoring dependency: None.
- Reconnection behaviour: A validated, versioned command journal in tab-scoped
  session storage restores the exact shuffle, selected cards, score and phase.
  Setup offers resume after refresh or leaving the table. Recovery expires after
  six hours; blocked storage warns without preventing play.
- Deliberate exceptions: A visual memory game needs attention on the shared
  board. The group watches one board together; turns and reveals never require
  every player to look down at a separate phone. No competitive timer runs while
  a device is passed. Solo uses automatic reveal timing; multiplayer reveals
  wait for the group to continue.
- Harness level: Level 1, the required level for a purely local single-device game.
- Dev route and default scenario: `/things/pairs/dev`, development only. Seed 404
  gives Alex and Jo a six-pair table. Mismatch, last pair and shared win recipes
  use the production reducer and mount the production app.
- Playtest status: Unvalidated with first-time groups. Automated tests establish
  rules and interaction, not social fun.

## Two-device room play profile

- Fun premise: People have fun together by racing the same shuffle, watching the
  other player catch up, and comparing the pairs that tripped them up.
- Device topology: `personal-only`, exactly two devices.
- Attention profile: `continuous` during the race, then a communal result hold.
- Shared focal point: The named round winner on both screens and conversation
  between rounds. This is an explicit dexterity/memory exception to room-first play.
- Player-phone job: Each player controls their own board simultaneously. Neither
  device exposes the other player's choices or hidden faces.
- Main in-person activity: Race, react, compare strategies, and celebrate.
- Inactive-player role: Both players race simultaneously; neither is eliminated
  before the round winner is decided.
- Host responsibility: Either player can deal after both are ready.
- Joining requirement: No account; a name and the seven-character table code or invite.
- Correction path: No undo during a competitive race. Concede the match if a
  player cannot continue; refresh or reopen the invite to recover a seat.
- Result produced: Server-owned pair progress, round wins, and match winner.
- Event-scoring dependency: None.
- Reconnection behaviour: Expiring browser credentials recover the same durable
  Postgres room. Join retries reuse credentials saved before the request. An
  uncertain move can be retried with its original action ID.
- Deliberate exceptions: Personal screens are the race surface. Round results
  never auto-advance, returning attention to each other. Devices receive the same
  shuffle and start deadline; the server orders final-pair commands. Network
  arrival, rather than an untrusted device clock, determines a close finish.
- Harness level: Level 3. The two production surfaces mount together; named
  scenarios, bot steps, refresh, pop-outs and signed capture/restore are available.
- Dev route and default scenario: `/things/pairs/dev`, two-device section. Lobby,
  live race, round reveal and final result all use the production rules. A bot
  step completes one pair through the authorized production command, using a
  development clock to avoid waiting for visual holds.
- Capture lifetime: Captures restore only within the same development-server
  process, including hot reloads. A restarted server rejects earlier signatures.
  Restore allocates a new room and new player credentials, preserving the source.
- Playtest status: Unvalidated with first-time groups and real venue networks.

## Boundaries and verification

`pairs-rules.ts` owns deterministic shuffling, scoring, turn transitions, undo
and recovery validation. React owns rendering, local storage, browser history
and the cancellable solo reveal timer. Local modes do not use server persistence.
`pairs-race-rules.ts` owns independent boards, ready/start gates, server deadlines,
round wins and rematches. `pairs-race.server.ts` uses the existing Postgres room
repository: one row lock covers the room mutation and its idempotency receipt.
No new database schema, runtime, external provider or reward dependency is needed.
These are individual transactional commands, so they remain ordinary TypeScript.
Snapshots reveal only the viewer's exposed/cleared faces and aggregate opponent
progress; neither shuffle seeds nor credentials are returned. Visible-tab reads
use the shared reconciler with a 750ms minimum gap, abort on unmount, and stop on
unavailable sessions or 4xx responses. Postgres is required; no production memory fallback.

The browser renders rank/suit values only for exposed cards. Local recovery
contains the shuffle seed; it is convenience state on the shared device, not a
security boundary or trusted competitive result. Reduced motion removes deal,
flip and fall animation while preserving the rules and readable feedback.

Verification covers deterministic deck integrity, valid and rejected choices,
scoring, turn retention/handoff, undo, skip, finish, ties and corrupt recovery;
browser journeys cover shared-device play, refresh, rematch, mobile keyboard
input, blocked storage, setup validation and Back/Forward. Postgres integration
tests verify private projections, same shuffles, readiness/countdown, reveal
gates, duplicate commands, simultaneous final-pair arbitration, stale rounds,
concession, rematches, every race scenario and capture integrity. The race browser
journey uses isolated player contexts and learns cards only through visible faces.
