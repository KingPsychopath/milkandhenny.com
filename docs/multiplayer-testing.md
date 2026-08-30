# One-person multiplayer testing standard

Status: canonical development and QA standard

Applies to: every game mode with more than one role, device, or synchronized
participant

Companion standard:
[room-first-multiplayer.md](./room-first-multiplayer.md)

This document makes a multiplayer game operable by one developer, designer, or
agent before friends are available. It standardizes deterministic scenarios,
virtual devices, simulated players, state capture, time controls, and failure
testing without pretending that a harness can validate real social fun.

The target workflow is:

```text
start the app
  -> open /things/<game>/dev
  -> choose “default table” or a named scenario
  -> see every real role surface together
  -> play one role while bots or scripts operate the others
  -> pause, inspect, pop out, disconnect, or advance the room
  -> capture or export the exact useful state
```

Requiring six phones and five friends to reproduce a defect is a product
development failure. Requiring friends to judge whether the room is actually
fun is not; that is the final evidence a harness cannot manufacture.

---

## 1. Principles

### Use real product surfaces

A harness MUST mount the same presenter, MC, team, player, spectator, and result
components used by production. It may inject credentials and a test clock, but
it MUST NOT replace those surfaces with a privileged approximation.

This preserves the most important diagnostic property:

> If a secret, stale state, missing instruction, or broken control appears in a
> harness role panel, the same defect can appear on that real device.

The harness may include a separate, clearly labelled omniscient inspector. No
role panel may receive omniscient state merely because all panels happen to be
on one browser page.

### Reproduce positions, not just lobbies

“Create six players” is not enough. The tester must be able to open the game at
the reveal, one answer missing, a close finish, a host handoff, an ambiguous
ruling, or another position that actually needs inspection.

Named scenarios are durable recipes. Runtime captures are temporary debugging
artifacts. Both have a place and they are not interchangeable.

### Automate chores, preserve decisions

Bots should join, ready, submit obvious fixture inputs, and advance routine
phases. They should not silently make the human judgement currently under test.
The tester can claim any role, pause automation, and perform the meaningful
action personally.

### Keep the test world separate

Harness routes and mutation endpoints MUST fail closed outside development and
test environments. Captures can contain secrets and credentials. They are
unsafe development artifacts, not production exports or support bundles.

---

## 2. Testability levels

These levels describe development readiness, not game quality.

| Level | Name          | Capability                                                                                                                 |
| ----- | ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 0     | Logic only    | Rules may have tests, but a complete experience cannot be reproduced by one person                                         |
| 1     | Reproducible  | Deterministic content/seed and a one-click default state exist                                                             |
| 2     | Solo playable | All required real surfaces appear together and simulated seats can complete a match                                        |
| 3     | Inspectable   | Named scenarios, fast/paused time, capture/restore, import/export, and role inspection exist                               |
| 4     | Resilient     | Pop-out screens, privacy assertions, disconnect/reconnect, latency/failure controls, and critical browser automation exist |

Minimum release expectations:

- a purely local, single-device game MUST reach Level 1;
- a paired-device or room multiplayer mode MUST reach Level 3;
- an event-critical game involving secrets, buzzers, adjudication, or a public
  presenter SHOULD reach Level 4 before being treated as a headline experience;
- no multiplayer mode may ship at Level 0 merely because integration tests can
  call its engine.

---

## 3. One route, predictable controls

Each multiplayer feature SHOULD expose a development-only route:

```text
/things/<slug>/dev
```

The route MUST:

- return not-found outside `import.meta.env.DEV`;
- render nothing if the client environment is not development;
- use `noindex, nofollow` as defence in depth, not as access control;
- avoid inclusion of development credentials or capture code in production
  entry points;
- identify the game, scenario, seed, phase, and harness version on screen.

The first viewport should offer:

- **Default table** — creates the minimum representative room and takes it to
  the first meaningful action;
- **Default full game** — creates a representative room and lets automation
  finish it while the tester can interrupt;
- named scenarios grouped by lifecycle phase or risk;
- player count, timing profile, bot mode, and content seed;
- capture import and a link to saved local captures.

The route MAY support stable development query parameters such as
`?scenario=tie&fast=1&layout=grid`. Automated tools may use them, but loading a
URL MUST NOT overwrite an existing capture or production record.

---

## 4. Standard multi-surface workspace

The shared harness shell should render a workspace rather than making every game
invent its own grid.

### Required surfaces

Show every role the declared device topology requires:

- public presenter or shared television;
- MC/host controller;
- one panel per team controller;
- one panel per player-private device;
- spectator or eliminated-player surface when it materially differs;
- the omniscient inspector, visually separated from all product roles.

A topology that does not use one of these surfaces does not need to fake it. A
single-device game gets one production surface plus harness controls; a paired
judge game gets player and judge; a presenter-personal game gets presenter,
host, and player seats.

### Panel behaviour

Each panel MUST:

- mount the production component with that role’s real credentials and redacted
  snapshot;
- display a harness-only frame label with role, seat, connection, viewport, and
  current phase;
- support focus/solo, grid, and return-to-grid;
- support remount/refresh without recreating the whole room;
- offer **Pop out** so the surface can run in a real independent browser window;
- provide phone portrait, phone landscape, tablet, and presenter 16:9 viewport
  presets without changing product CSS;
- expose stable harness metadata such as role, seat, phase, and scenario for
  browser automation and agent inspection.

The shared presenter may be mirrored on more than one display, but those mirrors
consume the same public projection. They do not become additional authorities.

### Attention audit

The harness should show the declared attention target beside each phase:

- room;
- presenter;
- MC controller;
- team controller;
- player-private device.

It should warn when a player panel asks for input during a declared `room-only`
phase, when two personal-device phases occur consecutively, or when a result
phase has no communal focal surface. These warnings are design diagnostics, not
automatic proof that the phase is wrong.

---

## 5. Shared harness capabilities versus game adapters

Centralize the mechanics of testing, not the rules being tested.

### Shared harness owns

- workspace layout, panel frames, viewport presets, and pop-out coordination;
- virtual seat creation and role labelling;
- start/pause/step/fast timing controls;
- a bot scheduler and the ability to pause or claim a bot seat;
- local capture storage, JSON upload/download, schema headers, and warnings;
- action timeline, connection state, and failure-injection controls;
- scenario picker, run status, expected-outcome display, and audit export;
- stable automation selectors and development-only route guards.

### Each game adapter owns

- how to create a valid default room;
- its roles, topology, production surface component, and credentials;
- named scenario definitions and deterministic content;
- safe actions a bot or script can take in each phase;
- game-specific timing profiles and which timers can be stepped;
- state capture/restore using its authoritative engine;
- redaction rules and expected results;
- game-specific fault cases and invariants.

The exact TypeScript API can evolve, but adapters should conceptually provide:

```ts
interface MultiplayerDevAdapter {
  metadata: GameHarnessMetadata;
  scenarios: readonly GameScenario[];
  createDefault(options: HarnessOptions): Promise<HarnessRoom>;
  startScenario(id: string, options: HarnessOptions): Promise<HarnessRoom>;
  surfaces(room: HarnessRoom): readonly HarnessSurface[];
  automationFor(room: HarnessRoom): HarnessAutomation;
  capture(room: HarnessRoom): Promise<VersionedCapture>;
  restore(capture: VersionedCapture): Promise<HarnessRoom>;
}
```

Do not force domain state into a universal room schema to satisfy this adapter.
`HarnessRoom`, scenario input, capture payload, and automation actions remain
game-owned generic parameters or opaque values behind validated boundaries.

---

## 6. Scenarios, fixtures, and captures

### Named scenarios

A scenario is source-controlled data or a deterministic recipe containing:

- stable ID and human name;
- what behaviour or risk it demonstrates;
- expected visible outcome and invariant;
- player count, role arrangement, options, seed, and content;
- starting phase or scripted setup actions;
- fixture inputs for simulated seats;
- timing overrides only where timing is part of the scenario.

Scenarios MUST use production engine transitions to reach their position. They
may skip human delay and supply deterministic deals or answers, but they must not
construct a state the engine itself would reject.

Every checked-in scenario MUST be opened by an integration test. At minimum the
test verifies that it remains valid, reaches the described phase, applies role
redaction, and satisfies its stated expectation. This prevents a beautiful dev
menu full of stale fixtures.

### Runtime captures

A capture freezes an interesting room reached during manual play. It SHOULD
contain:

- capture schema and game-state version;
- game slug, source room ID, phase, creation time, and label;
- authoritative game record;
- the development credentials needed to reconstruct each role;
- deterministic content/seed references where applicable;
- enough timing information to restore safely under a fresh clock.

Restore MUST validate the payload, write a new room ID with new credentials,
and leave the source room untouched. It MUST NOT overwrite a room by ID or trust
an arbitrary production token from the file.

Captures may be saved locally, downloaded as readable JSON, and uploaded again.
The file and UI MUST say that it can contain player secrets and is for local
development only.

### Scenario promotion

When a capture reveals an important regression:

1. reduce it to the smallest deterministic recipe;
2. remove real names, secrets, room IDs, and incidental timestamps;
3. give it a stable scenario ID, description, and expected outcome;
4. add or extend the integration test;
5. check in the recipe, not the raw credential-bearing capture.

---

## 7. Simulated players and human control

The default room must be playable by one person.

- The tester chooses any player, host, MC, judge, or team role as **mine**.
- Every other required seat can be scripted or bot-controlled.
- Automation can run one action, one phase, one round, or the whole match.
- A global pause stops future bot actions without freezing UI inspection.
- Claiming a bot seat cancels its pending action before human input is enabled.
- Bot timing is deterministic by default, with optional seeded human-like delay.
- A bot never bypasses authorization or calls internal mutation helpers that a
  corresponding product client could not reach, except for an explicit
  dev-only scenario-construction boundary before play starts.

Bots are not fake users for load testing and are not evidence of game balance.
They are reproducible hands that let the tester reach the next state.

For judgement-heavy games, automation should supply the obvious cases while the
tester owns ambiguous rulings. For social deduction, scripts can choose legal
targets but cannot demonstrate persuasion. For drawing and dexterity, stored
valid/invalid gestures can advance the engine, but manual control remains
necessary to evaluate feel.

---

## 8. Time, connection, and failure controls

Waiting for production timers is not testing. Games SHOULD accept a validated
development timing profile or test clock rather than scattering special
`setTimeout` behaviour through UI components.

The harness provides:

- real, fast, paused, and step-to-next-deadline modes;
- visible authoritative time and each surface’s measured clock offset;
- pause/resume through the same product command when host pausing is a feature;
- a separate development clock step for reaching an expired-state scenario;
- remount one surface, close its wake channel, or mark it disconnected;
- delay/drop the next permitted action, duplicate an action ID, or return one
  simulated transient failure;
- disconnect presenter, host, one player, or every non-host player;
- restore connectivity and verify reconciliation;
- expire or invalidate one role credential without destroying the room.

Failure controls MUST be bounded to the harness room and development adapter.
Do not install global network monkey patches that could affect unrelated app
work in another tab.

---

## 9. Inspector and audit bundle

An omniscient inspector is useful precisely because production roles are not
omniscient. Keep it outside the product panels and make privileged fields
visually unmistakable.

It SHOULD show:

- authoritative phase, revision, deadlines, room expiry, and host lease;
- player presence/readiness, role, connection, and automation owner;
- the public projection beside each role-private projection;
- recent accepted/rejected actions with action IDs and actor roles;
- pending automation and scheduled transition;
- neutral result and whether it has been published;
- declared topology, attention profile, attention target, and current
  room-first warning.

An **Export audit** action SHOULD create a redacted bundle suitable for an agent
or bug report containing:

- game and harness versions;
- scenario ID, seed, options, topology, and attention profile;
- ordered action/phase transcript and final neutral result;
- expected versus observed invariants;
- connection/failure events;
- optional screenshots or DOM snapshots for each role with secrets removed.

This is distinct from a restorable capture. Audit bundles are safe to share
after redaction; captures are presumed secret.

---

## 10. Required scenario matrix

Every multiplayer game does not need identical fiction, but its adapter must
cover every applicable lifecycle risk.

### Baseline

- empty lobby and minimum valid group;
- default table at first meaningful action;
- maximum supported group or a representative large group;
- every role and every phase at least once;
- one normal completed round and a finished match;
- tie/close result where the rules allow it;
- rematch, rotation, or return-to-lobby path.

### Authority and fairness

- host/MC transfer or recovery;
- ambiguous answer or manual ruling;
- undo/correction and score adjustment where supported;
- simultaneous actions, buzzer tie, or duplicate action;
- late or invalid action rejected without corrupting the room.

### Presence and recovery

- unready or missing player at start;
- one player disconnects during input;
- presenter disconnects during a public state;
- host refreshes or loses its connection;
- reconnect receives the correct redacted state;
- timer expires with one or more missing actions;
- room can continue, skip, substitute, or end according to its policy.

### Privacy and attention

- every secret role/answer absent from every unauthorized panel;
- public presenter contains public truth only;
- lock state returns attention to the declared focal surface;
- inactive and eliminated roles see only their intended action;
- result and social-hold state do not auto-advance unexpectedly.

---

## 11. Automated tests and human tests

The harness complements the test suite; it does not replace it.

```text
pure rules and score tests
  -> authoritative engine integration tests
     -> scenario validity and role-redaction tests
        -> multi-surface harness inspection
           -> focused browser flows
              -> real-device session
                 -> first-time group playtest
```

- Unit tests prove deterministic rules, score, matching, and transition
  helpers.
- Integration tests prove room lifecycle, persistence, authorization,
  idempotency, timeouts, and every named scenario.
- Harness inspection proves that real role surfaces agree and remain usable
  together.
- Browser automation covers a few critical multi-surface journeys, refreshes,
  and pop-out/reconnection boundaries.
- Real devices expose touch, orientation, audio, venue network, and physical
  handoff problems.
- Friends expose explanation, social timing, fairness perception, inclusion,
  and fun.

An agent should be able to start the local app, open the documented dev route,
launch a named scenario, identify panels from stable metadata, perform actions,
and export an audit without reading secrets from internal storage. It still
must report that social fun is unvalidated until people play together.

---

## 12. Current coverage audit

Audit date: 30 August 2026

This inventory records current development support, not implementation quality.
Unfinished worktrees are excluded.

| Game or mode                           | Current level         | Existing strengths                                                                                                          | Material gap                                                                                |
| -------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Liars room                             | 3                     | Real player panels, named scenarios, fast timings, capture/restore, JSON import/export, scenario integration tests          | Presenter/MC workspace, bots, pop-outs, and failure controls are incomplete                 |
| Same Brain room                        | 3                     | Real player panels, answer-bearing scenarios, fast timings, capture/restore, JSON import/export, scenario integration tests | No presenter surface; limited bot/failure and pop-out support                               |
| Twin room                              | 2–3                   | Real player panels, bots, timing controls, deterministic scenarios, one-screen preview                                      | No capture/restore or audit export; incomplete failure controls                             |
| Centre                                 | 1                     | Deterministic maze generator, seed/difficulty/player controls, verified solution preview                                    | Harness does not run the multiplayer room, real role surfaces, bots, or lifecycle scenarios |
| Hot and Cold room                      | 0                     | Engine integration coverage exists                                                                                          | No one-person multi-surface harness, scenarios, bots, or state capture                      |
| Draw the Country room                  | 0                     | Engine and scoring tests exist                                                                                              | No presenter/player workspace, drawing fixtures, scenarios, or capture                      |
| Type Together / Spelling Party         | 0                     | Engine/content integration tests exist                                                                                      | No presenter/player harness, simulated answers, fast room, or capture                       |
| Heads Up and Spelling Bee paired judge | 0                     | Production pairing/reconciliation paths exist                                                                               | No two-surface player/judge harness or scripted judge/player                                |
| Icebreaker pairing                     | 0                     | Local pairing logic and production screens exist                                                                            | No two-person pairing workspace or deterministic encounter fixtures                         |
| Pitch Night presentation               | 1                     | Rehearsal/preview and a production presenter/controller flow exist                                                          | No canonical presenter/host multi-surface scenario harness or capture bundle                |
| Single-device modes                    | 1 where deterministic | Direct manual play is possible without friends                                                                              | Default fixtures and reusable state capture are inconsistent                                |

Two route-boundary gaps require correction when the shared shell is introduced:

- Liars and Same Brain correctly return not-found outside development.
- Twin and Centre currently mark their dev pages `noindex` but do not apply the
  same development-only route guard. `noindex` is not an access boundary.

The recommended migration order is:

1. extract the common panel workspace, capture storage, route guard, and stable
   metadata from Liars/Same Brain;
2. adopt Twin’s bot-seat model and bring Twin capture/failure support to Level
   3–4;
3. convert Centre from a generator viewer into a real room adapter while keeping
   the generator panel as a tool;
4. build presenter-first adapters for Draw the Country, Hot and Cold, and Type
   Together alongside their room-first product corrections;
5. add paired-role adapters for remote judging and Icebreaker;
6. add the survey-board game to the shared shell before treating it as shipped.

---

## 13. Definition of done for a multiplayer mode

A multiplayer mode is testable by one person when:

- one documented dev route launches a default representative table;
- every production role can be viewed together and popped out independently;
- the tester can own any role and automate the rest;
- the game can be driven through a complete match without waiting on production
  timings;
- named deterministic scenarios cover its phases, authority, recovery, privacy,
  and finish;
- every scenario is backed by an integration test;
- an exact runtime position can be captured, restored under a new room, and
  exported/imported locally;
- one surface can refresh, disconnect, reconnect, or fail without restarting the
  entire harness;
- role panels never receive secrets they would not receive in production;
- the harness and its mutation boundaries fail closed outside development/test;
- an agent can follow the route and scenario labels without undocumented setup;
- real-device and first-time-group testing remain explicit follow-up gates.
