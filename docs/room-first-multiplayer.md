# Room-first multiplayer design standard

Status: canonical product and interaction standard

Applies to: every co-located multiplayer mode in `features/things`

Audience: product, design, engineering, content, QA, and event operators

This document defines how multiplayer games should divide attention between the
room, a shared display, a host controller, and player phones. It also defines
what this project means by **fun**, **flow**, and a successful room-first game.

It is a design contract, not a promise that an untested game is fun. Source
review can show whether a game has the conditions for fun. Only play with real
groups can validate the outcome.

The current implementation review lives in
[room-first-multiplayer-audit.md](./room-first-multiplayer-audit.md).

---

## 1. Product intent

A room-first game uses software to help people play **with one another in the
same place**. The main entertainment happens between people. Screens may
coordinate the room, protect secrets, collect simultaneous answers, make fair
decisions, or stage a reveal; they should not casually become the place where
everyone spends the game.

The test is simple:

> If everyone can play silently, looking only at their own phone and barely
> noticing the other people, the mode is not room-first.

That does not automatically make the mode bad. Some drawing, dexterity, or
speed games need a personal screen. Those modes are explicit exceptions and
must deliberately restore communal moments rather than being described as
eyes-up room play.

Every proposal must complete this sentence before interface work begins:

> People have fun together by **...**

The answer must describe something people do or feel with one another: debate,
bluff, perform, race, teach, surprise, judge, negotiate, recognise, celebrate,
or laugh. “Submit answers on their phones” is an interface description, not a
fun premise.

---

## 2. Normative language

- **MUST** is required for a conforming mode.
- **SHOULD** is the default; departures need a documented reason.
- **MAY** is optional.
- A **mode** is one playable device arrangement. A game with one-phone and
  everyone-on-a-phone variants has two profiles and reviews them separately.
- A **player phone** is a personal device used by a participant.
- A **shared screen** is the public focal display: television, projector,
  laptop, or centrally placed tablet.
- The **host** or **MC** is the person pacing and ruling the game. The host may
  also play only when the mode explicitly supports it.

---

## 3. What “fun” means here

Fun is the experienced result of a healthy loop, not a feature count or an
animation. A multiplayer mode has a credible fun hypothesis when it repeatedly
creates this loop:

```text
anticipation -> meaningful action -> visible consequence
             -> social reaction -> changed next decision
```

The loop should close quickly enough that players feel momentum. About one
minute is a useful default alarm, not a universal turn timer; storytelling and
social-deduction rounds may be longer because conversation itself is active
play.

### The eight conditions

1. **Legibility** — players understand the objective, their available action,
   and what happened because of it.
2. **Agency** — a choice, performance, judgement, or skill can affect the
   outcome. Administrative tapping is not agency.
3. **Social causality** — players affect and notice one another. Removing the
   room would materially change the game.
4. **Tension and uncertainty** — there is something worth anticipating: a
   hidden answer, close race, risky claim, scarce turn, or contested judgement.
5. **Feedback and delight** — meaningful actions receive immediate private
   acknowledgement and a legible communal consequence at the right time.
6. **Pace and turn density** — meaningful participation is frequent; setup,
   dead air, device passing, and waiting do not dominate.
7. **Fairness and trust** — rules, authority, timing, and scoring feel
   consistent, and ordinary mistakes can be corrected without restarting.
8. **Arc and closure** — the game builds, reaches a recognisable finish, shows
   the result, and makes the next choice clear: rematch, rotate, or leave.

Belonging and emotional safety are prerequisites. Humiliation, exclusion, or
unavoidable personal disclosure must not be the default source of tension.
Sensitive or adult content is opt-in. Elimination SHOULD be brief or give
eliminated players a meaningful continuing role.

### What code review can and cannot claim

A static review MAY say that a mode’s **fun hypothesis passes**, **is at risk**,
or **is unsupported**. It MUST NOT call the experience validated fun without
observed playtests. Before promotion as a headline event game, test with at
least two independent groups containing first-time players and record:

- time until the first meaningful action;
- every “what do I do now?” or accidental rule violation;
- heads-down time and transitions that fail to bring eyes back up;
- dead-air or inactive-player waits longer than expected;
- disputes, latency concerns, and host corrections;
- the moment players identify as best and the moment they identify as
  confusing;
- whether the group asks for, or accepts, another round.

A simple post-game check is enough: “What was the best moment?”, “What was
confusing?”, and “Would you play another round?”

---

## 4. What “flow” means here

Flow means players stay oriented and socially engaged without reasoning about
the interface. At every transition they can answer:

1. What just happened?
2. What is happening now?
3. Who acts next?
4. Do I need my device?
5. What ends this state?

Flow depends on six things:

- **state legibility** — one named phase and one obvious next action;
- **continuity** — no avoidable account, menu, QR, or settings interruption
  once play begins;
- **attention choreography** — the game intentionally moves eyes between
  private devices, people, and the shared reveal;
- **pacing** — timers govern competitive action, while the MC governs human
  reaction and conversation;
- **recovery** — refreshes, disconnects, wrong rulings, and accidental taps do
  not destroy the match;
- **low cognitive load** — the interface remembers state and offers contextual
  controls instead of asking players to reconstruct the rules.

Useful design alarms for a casual event mode are:

- first meaningful action within two minutes of opening the lobby;
- core rules teachable aloud in under one minute and summarised in three or
  four short points;
- an unfamiliar input receives a practice beat before it can affect the game;
- a participant performs or contributes at least every 30–60 seconds, unless
  listening or discussion is itself their active role;
- a personal interaction normally finishes within 20 seconds;
- any inactive wait approaching 60 seconds receives an explicit audience,
  clue-giving, judging, predicting, or team role.

These are diagnostic thresholds, not accessibility time limits. The UI MUST
support people who need more time and the MC MUST be able to pause where timing
is not the skill being tested.

---

## 5. Classify the mode on two axes

Do not describe a game with a single “phone level”. Device count and attention
are different decisions. Every mode MUST declare both.

### Device topology

| Topology             | Meaning                                               | Normal use                                    |
| -------------------- | ----------------------------------------------------- | --------------------------------------------- |
| `single-device`      | One central or deliberately passed device             | Card, judge, or turn authority                |
| `presenter-host`     | Shared screen plus one private MC controller          | Prompts, rulings, reveals, pacing             |
| `presenter-team`     | Shared screen plus one controller per team or station | Buzzer, captain answer, team choice           |
| `presenter-personal` | Shared screen plus one phone per player               | Secrets or truly simultaneous input           |
| `personal-only`      | Personal devices with no public focal display         | Explicit exception or lightweight glance mode |

### Attention profile

| Profile       | Personal-device behaviour                                                       |
| ------------- | ------------------------------------------------------------------------------- |
| `room-only`   | No player phone during active play                                              |
| `glance`      | Read a role, word, pairing, or team, usually for 5–10 seconds, then pocket it   |
| `burst`       | Short answer, vote, judgement, or buzzer action, normally under 20 seconds      |
| `alternating` | Repeated phone phases separated by room activity and shared reveals             |
| `continuous`  | The phone is the primary play surface; this is an explicit room-first exception |

Room-first defaults to `room-only`, `glance`, or `burst`. Across active play,
the design SHOULD target roughly 70–80% of attention on people or the shared
display. Personal-device time SHOULD stay below 25% by default and MUST have a
documented reason above 40%. Measure active phases, excluding setup and genuine
breaks, during playtesting rather than pretending these numbers can be inferred
from source.

---

## 6. Give every surface one job

| Surface       | Owns                                                                                     | Must not become                                             |
| ------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Shared screen | Public truth: phase, prompt, public timer, team state, score, reveal, result             | A wall of controls or any player’s secret                   |
| MC controller | Secrets, rulings, pacing, reveals, corrections, exceptional recovery                     | A second presenter the MC must continuously read            |
| Player phone  | Necessary private information, simultaneous input, identity, team control, accessibility | A miniature duplicate of the whole game                     |
| Room          | Talking, moving, performing, negotiating, judging, teaching, reacting                    | Dead time while servers and screens do the interesting work |
| Event system  | Attendance, event points, eligibility, rewards, claims, and reversals                    | A dependency required to complete a match                   |

A proposed player-phone action is justified only when it protects private
information, captures simultaneous independent input, establishes identity,
provides a fair team controller or buzzer, or supplies an accessibility path.
Convenience alone is not enough.

---

## 7. Canonical round rhythm

Use this as a vocabulary, not a mandatory state machine:

```text
setup -> teach -> ready -> brief private input -> room action -> lock
      -> shared reveal -> social hold -> handoff -> finish
```

- **Setup** establishes mode, teams, content, and authority before a timer.
- **Teach** gives the objective and three or four rules. Rules remain available
  later without leaving the match.
- **Ready** confirms only people whose presence matters to the next action.
- **Private input** is as short as the mechanic permits.
- **Room action** is the talk, performance, race, clue, judgement, or movement.
- **Lock** acknowledges the input immediately and says “Locked — look up” when
  attention should return to the room.
- **Shared reveal** makes the consequence communal and more prominent than any
  private duplicate.
- **Social hold** leaves room for laughter, debate, applause, explanation, or a
  ruling. It does not auto-advance through the human payoff.
- **Handoff** states what happened, who is next, whether a device is needed,
  and the next action.
- **Finish** provides a clear result and next choice.

There MUST NOT be two consecutive heads-down phases without a room or shared
beat between them. A competitive timer MAY close input, but a reveal or
reaction state SHOULD wait for the MC or an explicit group action.

---

## 8. Universal interaction rules

During active play:

- each player or host state MUST have one primary action;
- a player state SHOULD expose no more than two secondary actions;
- timed interactions MUST NOT require scrolling or menu navigation;
- controls MUST meet the project accessibility rules and be usable under event
  lighting, noise, and distance;
- every accepted input MUST acknowledge immediately, even if the shared result
  is intentionally delayed;
- public progress MAY show counts such as “6 of 8 locked” but MUST NOT leak
  private answers, roles, or votes;
- sound MUST have a visual equivalent and colour MUST have a text, shape, icon,
  or position equivalent;
- joining MUST NOT require an account for a casual room game;
- a QR code MAY appear in setup or recovery, never as the main task during an
  active round;
- readiness MUST be bounded. One missing device cannot trap the room forever;
- disconnecting or refreshing MUST restore the correct role and phase or give
  the MC a safe way to continue;
- a game MUST be able to finish and publish its result without the event
  rewards system being available.

Individual points SHOULD NOT encourage teammates to shout over, withhold help
from, or sabotage one another unless that conflict is the declared mechanic.
If the room is divided into teams, the game result belongs to the team by
default; event rewards can later credit eligible members.

---

## 9. Topology-specific rules

### Single device

- Keep the device central unless secrecy requires a deliberate handoff.
- Do not pass it while a competitive timer is running.
- A secret handoff MUST use `ready -> reveal -> hide -> pass` and clearly name
  the next holder.
- Back navigation, rotation, sleep, and accidental taps MUST not expose the
  previous secret or lose the round.
- Do not make one person a permanent unpaid operator. Rotate the role or create
  a separate judge/host mode.

### Shared screen plus host

- Pair and verify the controller before play.
- The presenter shows public truth only and must be readable from the furthest
  expected seat without scrolling.
- The presenter has one focal message, with persistent phase, public timer, and
  score only when they help orientation.
- The MC sees secrets and context; the audience does not.
- The MC’s normal controls are reveal/rule, pause/resume, and continue. Put
  uncommon actions behind a contextual **Fix something** control.
- The MC MUST be able to undo the latest ruling, correct an answer, adjust a
  score, reset or pause a timer, replace an unusable prompt, and resume after a
  refresh. This is bounded recovery, not arbitrary timeline editing.
- The MC owns social transitions. A buzzer or timer can announce an event; it
  does not decide when the room has finished reacting.

### Shared screen plus team devices

- Give each team device one job, such as buzzer or answer confirmation.
- Name the active captain or rotate ownership so the loudest person does not
  silently become the permanent controller.
- Prefer a centrally resolved buzzer order when latency determines who acts;
  client timestamps alone are not trusted fairness.
- Team identity MUST use a name, icon, pattern, or position in addition to
  colour.
- Team devices return flat or to pockets outside their active burst.

### Shared screen plus personal devices

- Personal devices exist only for necessary secrets or simultaneous input.
- After submission, show a locked state and direct attention to the shared
  screen.
- The public reveal is visually and temporally dominant over private copies.
- The presenter exposes aggregate readiness, never private content.
- One disconnected player cannot indefinitely stall the room; the engine needs
  a bounded skip, remove, substitute, or host-start policy.

### Personal devices only

This is either a lightweight `glance` mode or an explicit exception.

- Create synchronised communal beats through speech, movement, shared audio,
  a round leader, or a deliberate everyone-look-up reveal.
- Do not duplicate the full public state on every phone merely because it is
  easy.
- A `continuous` mode MUST explain why the personal surface is the mechanic and
  how the design restores social causality.
- If a shared display would materially improve the best moment, the event mode
  SHOULD provide one even if a personal-only fallback remains available.

---

## 10. Teams, host authority, scoring, and rewards

### Teams

Team names are optional and editable for character; stable identity cannot rely
on colour alone. A sensible default is two named teams with an icon or fixed
side of the screen. Do not make every person join merely to exist on a team.
Only devices with a necessary game job need to connect.

### Host authority

The MC should focus on one or two things: the current ruling and the pace. The
software owns arithmetic, state consistency, and synchronisation. The MC owns
human ambiguity. Content matching SHOULD be flexible enough for obvious
synonyms, pronunciation, spelling variants, and room context, with a manual
ruling path rather than rigidly rejecting an answer the room accepts.

Corrections must be attributable and visible: show what changed, then return to
the current state. Avoid an unrestricted admin console during active play.

### Game result versus event rewards

The game publishes a neutral result:

- match ID and completion state;
- participating player or team IDs where known;
- raw score, placement, winner, and relevant round facts.

The event layer decides attendance, participation credit, event points,
eligibility, ticket ownership, reward claims, and reversals. The match MUST NOT
force every person in the room to scan in merely so the game can award points.
If event credit is needed, use team membership already established outside the
round or a post-game, signed claim flow. A QR claim is shown after the result,
not during play, and must be resistant to casual reuse.

---

## 11. Architecture boundary

Shared multiplayer infrastructure owns repeatable capabilities:

- room credentials, membership, expiry, and reconnect;
- public and role-private snapshots;
- presenter synchronisation and host pairing;
- clock alignment, readiness, idempotency, wake transport, and backpressure;
- distributed mutation safety, telemetry, and official result publication.

The game owns its fun and rules:

- phase model, team rules, prompts, secrets, timing, and score;
- which inputs are valid and who has authority;
- correction limits and ambiguous-answer policy;
- device topology, attention profile, inactive-player role, and finish arc.

Do not create a universal game engine that erases these differences. Compose
shared capabilities under a game-owned engine, consistent with
[architecture.md](./architecture.md#multiplayer-runtime).

---

## 12. Required room play profile

Every new co-located multiplayer mode, and every material redesign of one,
MUST include this profile in its feature documentation or implementation plan:

```markdown
## Room play profile

- Fun premise: People have fun together by ...
- Fun loop: Anticipation -> action -> consequence -> reaction -> changed decision
- Device topology:
- Attention profile:
- Shared focal point:
- Player-phone job:
- Main in-person activity:
- Inactive-player role:
- Host responsibility:
- Joining requirement:
- Correction path:
- Result produced:
- Event-scoring dependency: none
- Reconnection behaviour:
- Deliberate exceptions:
- Harness level:
- Dev route and default scenario:
- Playtest status: unvalidated | promising | validated | regressed
```

If the game has multiple modes, repeat the topology, attention, phone job, and
exception fields for each mode.

---

## 13. One-person operability

Every multiplayer mode MUST be testable by one developer or agent before a
group playtest. That means mounting the real presenter, MC, team, player, judge,
and spectator surfaces together; choosing any one role to control; simulating
the remaining seats; opening deterministic lifecycle scenarios; shortening or
stepping time; and capturing/restoring an interesting room state.

This infrastructure is centralized as a development harness and composed with a
game-owned adapter. It does not centralize game rules or replace production
surfaces with mock panels. Paired and room multiplayer modes must reach Level 3
of the [one-person multiplayer testing standard](./multiplayer-testing.md);
event-critical secret, buzzer, adjudication, and presenter games should reach
Level 4.

Harness success proves reproducibility, role projections, controls, and
resilience. It cannot prove that conversation, tension, inclusion, or laughter
works with real people. Real-device testing and first-time-group playtests remain
separate release evidence.

---

## 14. Review gate

Before implementation or approval, answer all of these:

### Fun and room

- Can we explain the fun without describing a phone interface?
- Does another person visibly affect each player’s experience?
- Is the best moment focused on people or a shared reveal?
- Does every inactive player have a meaningful role?
- Are tension, feedback, fairness, and the ending legible?

### Attention and controls

- Is every personal-phone interaction necessary under the allowed reasons?
- Can a player pocket the phone without blocking the room?
- Does every private input end with an explicit return of attention?
- Is there only one primary action in every live state?
- Are rules available, brief, and practised when the input is unfamiliar?

### Host and resilience

- Can the shared screen always say what is happening and who acts next?
- Can the MC make ordinary rulings and corrections without becoming a systems
  operator?
- Can a missing, disconnected, or refreshed device be recovered or skipped?
- Are secrets absent from public snapshots, logs, presenters, and URLs?

### Boundaries and validation

- Can the match finish if event scoring is unavailable?
- Is the game result neutral and the reward decision external?
- Are deliberate exceptions written down rather than hidden?
- Can one tester launch every real role, automate the remaining seats, open
  named scenarios, and restore an exported state?
- Are harness routes and privileged scenario operations unavailable in
  production?
- Has the fun claim been worded as a hypothesis until observed playtests pass?

Any “no” is a design issue to resolve or a documented exception to test. A
mode that has no credible social-causality answer MUST NOT be called room-first.
