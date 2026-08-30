# Co-located multiplayer audit

Audit date: 30 August 2026

Standard: [room-first-multiplayer.md](./room-first-multiplayer.md)

Scope: shipped multiplayer and group modes under `features/things`, plus the
planned survey-board game discussed for events

This is a static product and source audit. It can identify an unsupported or
at-risk fun hypothesis; it cannot prove that a game is or is not fun. The
verdicts below describe conformance to the room-first standard. Actual fun must
be validated with first-time groups using the playtest evidence in the
standard.

---

## 1. Verdict language

### Standard conformance

- **Conforms** — the mode follows the standard with no known material conflict.
- **Conforms with risks** — the core shape is room-first, but a material design
  question or ambiguous implementation needs correction or playtesting.
- **Deliberate exception** — the personal device is the mechanic. The mode may
  be good, but it must not be presented as eyes-up room-first without the
  documented compensating social beats.
- **Does not conform** — the current mode unnecessarily fragments attention or
  violates a core flow rule.
- **Different product** — the surface is an editor, studio, or utility rather
  than a live room game; only its live-play mode is assessed as a game.

### Fun hypothesis

- **Strong on paper** — all eight fun conditions have credible support in the
  mechanic; still unvalidated until playtested.
- **Promising** — there is a recognisable fun loop with one or more important
  risks.
- **At risk** — the intended fun is legible, but current attention, downtime,
  fairness, or payoff could routinely suppress it.
- **Not applicable** — not itself a live game.

---

## 2. Summary

| Experience and mode            | Topology / attention                          | Conformance          | Fun hypothesis  | Main finding                                                                   |
| ------------------------------ | --------------------------------------------- | -------------------- | --------------- | ------------------------------------------------------------------------------ |
| Forehead / Heads Up            | `single-device` / `room-only`                 | Conforms             | Strong on paper | The phone becomes a card while friends do the play                             |
| Icebreaker                     | `personal-only` / `glance`                    | Conforms with risks  | Promising       | Conversation is primary; optional phone pairing can become a distraction       |
| Liars, pass-phone              | `single-device` / `glance`                    | Conforms             | Strong on paper | Secret handoff ends with the phone face down and talk begins                   |
| Liars, room                    | `presenter-personal` / `alternating`          | Conforms with risks  | Strong on paper | Excellent attention choreography; onboarding and elimination need validation   |
| Same Brain, one phone          | `single-device` / `room-only`                 | Conforms             | Strong on paper | The room speaks and judges together                                            |
| Same Brain, room               | `personal-only` / `alternating`               | Conforms with risks  | Promising       | Simultaneous input is justified, but the reveal lacks a public focal display   |
| Type Together / Spelling Party | `presenter-personal` / `alternating`          | Conforms with risks  | Promising       | Presenter helps; typing and automatic transitions can consume the social beat  |
| Twin, one screen               | `single-device` / `room-only`                 | Conforms             | Strong on paper | Immediate local competition with no network or lobby overhead                  |
| Twin, room                     | `personal-only` / `continuous`                | Deliberate exception | Promising       | Fast shared-symbol sport, but players can play silently into their own screens |
| Centre, room                   | `personal-only` / `continuous`                | Deliberate exception | At risk         | It can become parallel solo maze runs with weak room causality                 |
| Draw the Country, room         | `personal-only` / `continuous`                | Does not conform     | Promising       | Drawing justifies phones; fragmented, auto-advancing reveals do not            |
| Hot and Cold, room             | `personal-only` / `alternating`               | Does not conform     | At risk         | Turn waiting and duplicated public state keep the group on phones              |
| Spelling Bee                   | `single-device` or paired judge / `room-only` | Conforms with risks  | Promising       | Social performance works only when the speller cannot see the answer           |
| Pitch Night, authoring         | `personal-only` / `continuous`                | Different product    | Not applicable  | Screen-first editing is appropriate for a studio                               |
| Pitch Night, presentation      | `presenter-host` / `room-only`                | Conforms with risks  | Promising       | Live performance is room-first; audience and transition rules need validation  |

The most important existing product gaps are not “too many phones” in the
abstract. They are loss of a communal reveal, automatic advancement through the
room’s reaction, and inactive players watching duplicated state on personal
screens.

---

## 3. Game-by-game findings

### Forehead / Heads Up

**Profile.** People have fun by giving clues under pressure while one person
guesses. One phone is held to the player’s forehead, screen facing the room;
the player uses tilt or accessible buttons, with an optional remote judge.
Friends provide the actual content and feedback.

**Verdict: conforms; fun hypothesis strong on paper.** The implementation
explicitly assumes the phone remains on the forehead without touch during the
round, pauses safely on interruptions, offers non-motion controls, and has a
clear results/rematch state. Evidence:
[HeadsUpApp.tsx](../features/things/heads-up/HeadsUpApp.tsx),
[HeadsUpSetup.tsx](../features/things/heads-up/HeadsUpSetup.tsx), and
[RoundPlayArea.tsx](../features/things/heads-up/RoundPlayArea.tsx).

**Keep and validate.** Treat this as a reference pattern for a physical phone
role: the device is necessary, but attention remains on people. Playtest device
handoff, motion accessibility, noisy-room audio/visual parity, and rotation so
the same person is not always the guesser.

### Icebreaker

**Profile.** People have fun by finding somebody with a matching colour,
introducing themselves, and using a conversation prompt. Every participant
glances at a personal assignment and then moves through the room. Pairing phones
and collecting colour combinations is optional follow-up activity.

**Verdict: conforms with risks; fun hypothesis promising.** The primary action
is explicitly social and colour names accompany the visual colour. The optional
QR/camera pairing and colour book, however, can quietly replace conversation
with collection. Evidence:
[IcebreakerApp.tsx](../features/things/icebreaker/IcebreakerApp.tsx) and
[IcebreakerPairing.tsx](../features/things/icebreaker/IcebreakerPairing.tsx).

**Action.** Keep pairing after the introduction, never as proof that the social
interaction happened. Playtest whether people pocket their phones after the
reveal and whether mobility, colour-vision, camera, and non-camera alternatives
feel equally supported.

### Liars — pass one phone

**Profile.** People have fun by learning a secret role and then bluffing,
questioning, and reading one another. A single phone moves through a guarded
reveal sequence and then lies face down while the room plays.

**Verdict: conforms; fun hypothesis strong on paper.** The implementation names
the handoff stages, provides a hold-to-reveal action, and explicitly ends the
device phase before discussion. Evidence:
[LiarsPassPhoneApp.tsx](../features/things/liars/LiarsPassPhoneApp.tsx).

**Keep and validate.** Test shoulder-surfing, accidental back/rotation, clear
next-holder naming, and whether setup remains under the one-minute teach target.

### Liars — room and presenter

**Profile.** People have fun by bluffing, investigating, voting, and reacting
to a public narration. Personal phones protect roles and private actions; a
presenter provides the public village and shared clock; clue and deliberation
phases happen aloud.

**Verdict: conforms with risks; fun hypothesis strong on paper.** This is the
most complete implementation of intentional attention choreography. The source
states that the presenter narrates so phones stay quiet, directs players to say
clues aloud, supports host transfer/readiness, and gives eliminated players a
graveyard role. Evidence:
[LiarsPresenterApp.tsx](../features/things/liars/LiarsPresenterApp.tsx),
[LiarsRoomApp.tsx](../features/things/liars/LiarsRoomApp.tsx), and
[LiarsSetupApp.tsx](../features/things/liars/LiarsSetupApp.tsx).

**Risks and action.** Role complexity, explanation time, balance, and the value
of the graveyard cannot be proved statically. Keep a first-game ruleset with
fewer roles and one guided practice beat. Measure teach time, “what do I do?”
questions, time between meaningful contributions, and whether eliminated
players remain engaged rather than merely receiving a different phone screen.

### Same Brain — one phone

**Profile.** People have fun by predicting the room, saying answers together,
and negotiating which answers count as equivalent. One phone supplies the
prompt; the group speaks and keeps score.

**Verdict: conforms; fun hypothesis strong on paper.** The phone is a central
prompt rather than a private workstation. The room decides equivalence, which
preserves human ambiguity. Evidence:
[SoloSameBrain.tsx](../features/things/same-brain/SoloSameBrain.tsx).

**Keep and validate.** The spoken countdown, scoring explanation, and dispute
resolution should remain clear in a loud room. This is a useful low-setup
fallback when a presenter is unavailable.

### Same Brain — multiplayer room

**Profile.** People have fun by independently predicting consensus, saying or
revealing answers together, and debating equivalent groups. Every player types
briefly; a server clock synchronises the reveal; the host can merge answer
groups and correct scoring.

**Verdict: conforms with risks; fun hypothesis promising.** Simultaneous private
input is justified, and the host has a socially flexible equivalence ruling.
The weakness is topology: the best moment is rendered across personal phones,
not on an optional public presenter. Evidence:
[SameBrainRoomApp.tsx](../features/things/same-brain/SameBrainRoomApp.tsx),
[SameBrainViews.tsx](../features/things/same-brain/SameBrainViews.tsx), and
[SameBrainSetupApp.tsx](../features/things/same-brain/SameBrainSetupApp.tsx).

**Action.** Add a presenter/public reveal mode for events. After answer lock,
show “Locked — look up”; make the shared reveal dominant; let the host hold the
reveal long enough for debate. Keep elimination off by default and give any
eliminated player a real role if enabled.

### Type Together / Spelling Party

**Profile.** People have fun by hearing the same word, attempting it under time
pressure, and comparing how close the room came. Personal phones collect
simultaneous spelling; a presenter provides the public prompt, progress, and
reveal.

**Verdict: conforms with risks; fun hypothesis promising.** The presenter is the
right focal surface, and private typing is mechanically necessary. The risk is
that a substantial typing window followed by a timed cooldown makes both the
action and payoff feel automated. Evidence:
[PartyPlayerApp.tsx](../features/things/spelling-party/PartyPlayerApp.tsx),
[PartyPresenterApp.tsx](../features/things/spelling-party/PartyPresenterApp.tsx),
and
[PartyRoundCooldown.tsx](../features/things/spelling-party/PartyRoundCooldown.tsx).

**Action.** Lock and return eyes to the presenter immediately on submission.
Keep the answer comparison on the presenter and make the post-reveal social
hold host-controlled by default. Add a harmless practice word before scored
play and test whether non-fast typists still feel agency rather than merely
device friction.

### Twin — one screen

**Profile.** People have fun by racing to spot and name the one shared symbol.
One device holds both touch zones and resolves the duel locally.

**Verdict: conforms; fun hypothesis strong on paper.** It starts quickly,
creates immediate visible causality, and avoids network fairness concerns for
players sharing one surface. Evidence:
[TwinDuelApp.tsx](../features/things/twin/TwinDuelApp.tsx).

**Keep and validate.** Require or encourage saying the symbol aloud so the
mechanic stays socially legible. Test reach, accidental touches, dominant-side
advantage, and rematch/rotation flow.

### Twin — multiplayer room

**Profile.** People have fun by visually comparing cards across devices and
racing to identify the shared symbol. Each player’s phone is the card and input
surface throughout the duel.

**Verdict: deliberate exception; fun hypothesis promising.** Continuous device
attention is inherent to the visual mechanic, but the room is still relevant
because players compare and contest shared symbols. It nevertheless passes the
negative test too easily: players may silently tap without a public focal
display or spoken claim. Evidence:
[TwinRoomApp.tsx](../features/things/twin/TwinRoomApp.tsx) and
[TwinBoard.tsx](../features/things/twin/TwinBoard.tsx).

**Action.** Describe this as a device-sport exception, not an eyes-up game.
Require a spoken symbol claim, create a strong communal finish/audio-visual
beat, and consider a public score/round display for event play. Preserve the
one-screen mode as the room-first default for two players.

### Centre — multiplayer room

**Profile.** People have fun by tracing a maze under pressure and seeing whether
they beat nearby rivals. Each player traces continuously on a personal device;
rival positions and finishes provide limited shared context.

**Verdict: deliberate exception; fun hypothesis at risk.** The phone is the
necessary dexterity surface, but players can complete parallel solo runs
without speaking, looking up, or materially affecting one another. That is not
room-first social causality. Evidence:
[CentreRoomApp.tsx](../features/things/centre/CentreRoomApp.tsx) and
[MazeBoard.tsx](../features/things/centre/MazeBoard.tsx).

**Action.** Market the current mode as a synchronised personal race. For event
play, add a public race state, finish-order reveal, and spectator role; explore
team relay or verbal-navigation variants where another person changes the run.
Playtest whether rival markers actually create tension or are ignored while
tracing.

### Draw the Country — multiplayer room

**Profile.** People have fun by attempting the same shape and laughing at the
comparison. Personal screens are necessary while drawing; the strongest social
moment should be the ranked communal reveal.

**Verdict: does not conform; fun hypothesis promising.** The creative action
supports surprise and comparison, but the reveal is distributed to personal
devices and the round progresses automatically. The implementation spends the
room’s best payoff as another phone state instead of holding it publicly.
Evidence:
[DrawCountryRoomApp.tsx](../features/things/draw-country/DrawCountryRoomApp.tsx),
[DrawCanvas.tsx](../features/things/draw-country/DrawCanvas.tsx), and
[scoring.ts](../features/things/draw-country/scoring.ts).

**Priority action.** Add a presenter showing the country prompt, aggregate
progress, ranked drawings, and final result. Submitted phones should say
“Locked — look up.” Replace automatic post-reveal advancement with an MC or
explicit group continue. Keep drawing private until the shared reveal.

### Hot and Cold — multiplayer room

**Profile.** People have fun by proposing words, interpreting semantic heat,
and collectively narrowing in on a hidden target. The current room rotates a
typed turn through personal phones while public history and heat are also
rendered on those phones.

**Verdict: does not conform; fun hypothesis at risk.** The word hunt has
understandable tension, but turn-based typing creates inactive waits and the
public ledger has no communal focal surface. A group can become silent people
watching the same app. Evidence:
[HotAndColdRoomApp.tsx](../features/things/hot-and-cold/HotAndColdRoomApp.tsx),
[HeatLedger.tsx](../features/things/hot-and-cold/HeatLedger.tsx), and
[WordVisibilityControl.tsx](../features/things/hot-and-cold/WordVisibilityControl.tsx).

**Priority action.** Make the heat ledger, current turn, public clues, and result
a presenter view. Prefer a team-spoken mode with one rotating input controller
or host transcription; if all players keep phones, give non-active players a
prediction or clue-discussion role and explicitly return their eyes to the
room. Test round length and the longest wait between contributions.

### Spelling Bee

**Profile.** People have fun by hearing a word, spelling it aloud, and waiting
for a judge’s ruling. One judge-held phone or a paired remote judge owns the
word and ruling; the speller should not see the answer.

**Verdict: conforms with risks; fun hypothesis promising.** Spoken performance,
immediate judgement, pausing, and paired authority fit room-first play. The
local play area also renders the target word, so the device ownership and
orientation are an integrity requirement rather than a cosmetic instruction.
Evidence:
[SpellingBeeApp.tsx](../features/things/spelling-bee/SpellingBeeApp.tsx),
[SpellingPlayArea.tsx](../features/things/spelling-bee/SpellingPlayArea.tsx), and
[SpellingSetup.tsx](../features/things/spelling-bee/SpellingSetup.tsx).

**Priority action.** State and enforce that local competitive mode is
judge-held, screen hidden from the speller. If one person both sees and spells,
label that as practice rather than competition. Treat the paired judge as the
cleanest co-located mode, and test pronunciation, accent, hearing, and manual
override paths.

### Pitch Night

**Profile.** People have fun during the live mode by presenting an idea,
persuading a room, and reacting as an audience. The studio/editor is a separate
screen-based authoring product; the presentation uses a shared display and an
approved controller.

**Verdict: authoring is a different product; presentation conforms with risks;
live fun hypothesis promising.** Continuous screen use is appropriate while
building slides and irrelevant to the live attention standard. Presentation is
room-first because the human pitch is the activity and the display supports it.
Evidence: [pitch-night-platform.md](./pitch-night-platform.md) and
[PresentationSetup.tsx](../features/things/pitches/ui/PresentationSetup.tsx).

**Action.** Audit presentation and authoring separately in future reviews. For
live events, define audience participation, pitch timer visibility, host
handoff, recovery when the controller disconnects, and whether voting is an
optional burst or belongs entirely outside the pitch. Keep event rewards and
match scoring external.

---

## 4. Worked target: survey board / On the List

This is the proposed event game inspired by survey-board guessing and category
card games. It is not a claim about an implemented feature; it demonstrates how
to use the standard before building.

### Room play profile

- **Fun premise:** People have fun by shouting plausible answers, debating what
  the room or survey would say, and watching hidden board answers flip over.
- **Fun loop:** category appears -> teams anticipate -> one answer is claimed ->
  MC rules -> board flips or strikes -> room reacts -> control or stakes change.
- **Device topology:** `presenter-host`; optional `presenter-team` burst for one
  buzzer per team.
- **Attention profile:** `room-only`, with a `burst` only for team buzzers.
- **Shared focal point:** public board, strikes, active team, bank, timer, and
  scores.
- **Player-phone job:** none by default. A team buzzer is one shared controller,
  not one phone per person.
- **Main in-person activity:** shout, confer, perform the answer, and react.
- **Inactive-player role:** confer with the active team, anticipate a steal, and
  react to reveals; no one watches a private duplicate board.
- **Host responsibility:** accept/map an answer, reveal a board slot, issue or
  undo a strike, pause/reset the timer, transfer control, award the board, and
  continue after the social beat.
- **Joining requirement:** presenter and host pair before play. Players do not
  scan. Optional team controllers join once per team.
- **Correction path:** undo latest ruling; map a synonym to a board answer;
  reveal/unreveal; add/remove a strike; adjust score; replace an invalid board.
- **Result produced:** team identities, round banks, final scores, winner, and
  match ID.
- **Event-scoring dependency:** none. An event layer may credit eligible team
  members afterward.
- **Reconnection behaviour:** presenter restores public state; host reclaims
  authority with a pairing secret; team buzzer loss falls back to spoken
  face-off without blocking the match.
- **Playtest status:** unvalidated.

### Recommended rules for the first version

Use two teams. Default to stable labels such as **Left Team** and **Right Team**
with an icon/pattern and editable fun names. Keep one person as a dedicated MC.

1. The MC starts a board and reads the category aloud.
2. A face-off decides control. With team controllers, the server accepts the
   first valid buzzer and the shared screen gives both a visual flash and a
   sound. Without controllers, the MC names the first speaker.
3. The MC listens to the spoken answer and maps it to a hidden board entry.
   Obvious synonyms are a human ruling, not a rigid exact-string failure.
4. A match flips the answer and adds its board value to the round bank. A miss
   adds a strike. After three strikes, the other team gets one conferred steal
   answer.
5. A successful steal takes the bank; a failed steal leaves it with the active
   team. The MC confirms the award and advances only after the room has reacted.
6. Play four main boards for a short event match: the first two at face value,
   the third doubled, and the fourth tripled. Highest total wins. Round count
   and multipliers are host-configurable before play, not live-round clutter.

This preserves the familiar tension without reproducing every television rule.
A small-room variant MAY omit face-offs: alternate the starting team each board
and keep the same three-strike/one-steal rhythm.

### Content and decks

- Ship curated board decks. Each board contains a category, ranked accepted
  answers, display labels, point values, alternative accepted phrases, content
  rating, and provenance/review state.
- Let the host select a deck or prepared pack before the lobby. A custom-board
  builder MAY exist outside active play.
- Hosts MAY submit a correction or suggested synonym after a match. Do not let
  arbitrary audience text silently become a live accepted answer.
- A separate survey-collection mode MAY ask participants for future answers,
  but those submissions are moderated and compiled into a deck before game
  night.
- The MC may make a one-match manual ruling without mutating the canonical deck.

### Scoring and event credit

Board values belong to the answer; the MC decides only whether the spoken
answer maps to it. Round banks and match totals belong to teams, not individual
shouters. That lets everyone help without fighting teammates for personal
credit.

After the result, the event system may award participation or winner credit to
an already known roster. If no roster exists, show one signed, expiring
post-game claim QR for each eligible team. Scanning is optional and happens
after play; it is not how the game knows who won.

---

## 5. Remediation order

This order reflects the standard’s largest current violations and the likely
effect on live event flow. It is a product sequence, not a claim about which
game is most enjoyable.

1. **Restore the best communal moments:** add presenter and host-held reveal
   states to Draw the Country and Same Brain; stop automatic advancement through
   reaction states.
2. **Remove duplicated phone watching:** give Hot and Cold a public heat ledger
   and a spoken/team input mode with an explicit inactive-player role.
3. **Protect competitive integrity:** make Spelling Bee’s judge-held orientation
   unambiguous and keep the answer hidden from the speller.
4. **Label device sports honestly:** retain Twin and Centre personal modes, but
   document them as continuous-attention exceptions and add public event beats.
5. **Validate complex social systems:** run first-time-group tests for Liars,
   Type Together, and Pitch Night transitions rather than assuming their richer
   state machines produce better flow.
6. **Preserve reference patterns:** avoid burdening Forehead, one-phone Same
   Brain, and pass-phone Liars with mandatory lobbies or per-person identity.

---

## 6. Follow-up evidence required

No source-only audit can close these questions:

- which games reliably trigger laughter, debate, celebration, or a rematch;
- whether category and word decks fit the actual audience;
- whether first-time players learn the rules within the stated targets;
- the measured personal-screen attention percentage for each mode;
- whether quieter players, disabled players, and non-native speakers have equal
  agency;
- whether network latency is perceived as unfair in races and buzzers;
- whether host correction controls are discoverable under event pressure.

Record those findings beside this audit after facilitated playtests. Change a
fun hypothesis to **validated** only when independent first-time groups complete
the flow without coaching beyond the intended MC role and the observed social
payoff matches the written premise.
