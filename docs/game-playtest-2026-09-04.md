# Game acceptance and group playtest record — 4 September 2026

Status: test protocol and evidence inventory. Empty observations are pending, not passes.

The automated checks use separate browser contexts with separate cookies and browser storage.
They cannot establish readability across a noisy room, physical motion behavior, or whether a
first-time group enjoys a game. Do not approve those claims from engine tests.

## Current mode evidence

| Mode                                   | Executable evidence                                                                                                                                             | Remaining consequential acceptance                                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Same Brain                             | Three-phone full eight-round match and rematch; private answers, submitted-phone refresh, host-only progression; pool reconnect                                 | Physical devices and first-time group judgement/discussion                                                              |
| Family Feud                            | TV/MC/team-buzzer full match and rematch; answer acknowledgement, MC refresh, adjudication and scoring                                                          | Lost acknowledgement/offline-before-load on physical phones; human adjudication rehearsal                               |
| Mafia / Imposter (Liars)               | Five isolated phones in each mode; private role snapshots, keyboard hold/release and pointer cancellation; host succession/refresh, complete voting/end/rematch | Physical privacy/readability and first-time groups                                                                      |
| Twin                                   | Two-phone full match, rejected wrong symbol, keyboard correct symbol, scoring and rematch; pool reconnect                                                       | Touch timing and real-device responsiveness                                                                             |
| Centre                                 | Two-phone complete keyboard race, hidden maze before GO, matching results and rematch; pool reconnect                                                           | Physical controls and missing-player rehearsal                                                                          |
| Draw Country                           | Two-phone drawing, submit/refresh lock, reveal, full match and rematch; pool reconnect                                                                          | Touch hardware, rotation and interrupted physical submission                                                            |
| Hot & Cold room                        | Two-phone complete hunt, shared guess ledger, submitted-phone refresh, results/replay; pool reconnect                                                           | Timed turns, give-up and real-device behavior                                                                           |
| Daily Hot & Cold                       | Existing mobile browser journey and generated quality gate                                                                                                      | Six genuine human approvals in the [review packet](./hot-and-cold-review-2026-09-04.md)                                 |
| Spelling Party legacy rooms            | Presenter/two-phone full five-word match; private answers and player refresh                                                                                    | Native audio and physical devices; old launch URL redirects to Spelling Bee, so this checks existing-room compatibility |
| Spelling Bee / Heads Up paired judging | Silent isolated player/judge complete rounds; undo/rejudge; Spelling judge refresh/takeover; Heads Up timed results/rematch; reduced motion                     | Native speech/tilt and physical screen lock                                                                             |
| Imposter pass-phone / local variants   | Six keyboard-only private handoffs, denied storage, reduced motion, reveal and redeal; existing deterministic/local-state tests                                 | Physical orientation/privacy and device Back behavior                                                                   |

Shared pool recovery is tested after two minutes without a heartbeat, with eventual six-hour
expiry. The browser checks simulate offline/online and refresh, not a real OS screen lock.
Room presence and seat reservation have intentionally different lifetimes.

## Repeatable device acceptance

Use local/test services and a fresh room for each mode. Record browser, OS, device, viewport,
build revision, mode, deck, settings and date. Save only sanitized screenshots; room captures may
contain credentials or secrets.

- [ ] Teach: the host can explain the objective, required devices and first action from the UI.
- [ ] Join: two isolated devices receive different identities; repeating a join creates no duplicate.
- [ ] Ready: everyone knows who is missing and what starting without them does.
- [ ] Input: the active player sees the prompt; other roles cannot see secrets early.
- [ ] Waiting: a submitted or inactive player knows whose turn comes next.
- [ ] Reveal: the room has time to react; only the intended role can advance or adjudicate.
- [ ] Correction: rejected, duplicated and uncertain actions leave truthful state and retry guidance.
- [ ] Recovery: refresh, Back, offline/online, denied storage and a two-minute screen lock preserve
      identity and accepted work, or clearly explain the available recovery.
- [ ] Finish: all roles agree on results; rematch and explicit leave do not resurrect a prior round.
- [ ] Accessibility: long names fit, keyboard focus remains usable, and sound/motion are optional
      wherever the rules permit. Check secret handoff in single-device modes.

For any failure, record the exact action, expected and observed result, role and lifecycle phase,
then add a regression at the smallest failing boundary.

## First-time groups

Run two independent groups per proposed headline game. Use the normal launch screen and defaults,
not a seeded developer scenario. Avoid explaining a control before the group has tried to find it.
Use realistic lighting, distance and background noise, and include someone unfamiliar with the game.

| Observation                                                   | Group 1 | Group 2 |
| ------------------------------------------------------------- | ------- | ------- |
| Game, settings, participants and device mix                   | Pending | Pending |
| Time from launch to first meaningful player action            | Pending | Pending |
| Every “what do I do?” moment, with phase and role             | Pending | Pending |
| Longest inactive wait and whether its reason was clear        | Pending | Pending |
| When phones drew attention away from the room                 | Pending | Pending |
| Disputed results and whether correction was understood        | Pending | Pending |
| Best moment and most confusing moment, in participants' words | Pending | Pending |
| Who wanted another round, and why                             | Pending | Pending |
| Accessibility obstacles and interventions                     | Pending | Pending |
| Required fixes, owner and retest outcome                      | Pending | Pending |

Keep concrete observations separate from proposed explanations. Approve a headline game only after
its consequential failures are fixed and retested; do not substitute a numerical “fun score” for
what participants actually did and said.
