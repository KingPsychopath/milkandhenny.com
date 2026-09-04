# System audit and action checklist — 4 September 2026

Status: dated baseline findings with implementation and verification tracking; not a release approval.
Baseline: `a3380a32`; the working tree was clean before this audit.

The foundations are strong: explicit feature ownership, transactional ticket capacity and admission,
durable email work, game command idempotency, private/public media separation, and focused recovery
interfaces already exist. The highest-value work is closing inconsistent behavior at their edges,
particularly admin editing, scheduled communication transitions, and game-night recovery.

This is a system-wide boundary review with deeper admin and games inspection, not a claim that
every line, device, provider, or failure mode has been verified. A passing suite cannot establish
that the whole system is perfect. No production data or external services were changed.

## Implementation follow-through

Twenty-three items are implemented and locally verified. Five remain open because their full
acceptance criteria require human review, physical-device/group observations, or live operations. The descriptions below preserve the original findings; checked boxes refer to the
implementation recorded here, not to the baseline behavior continuing to exist.

| Items    | Implemented behavior and evidence                                                                                                                                                                                                                                                                                                                                                  |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A01, A07 | Stage eligibility is enforced in the UPDATE predicate. Events, stages and templates compare the editor's version; template default changes and saves are transactional. Real Postgres interleavings prove a scheduler claim or another editor cannot silently lose. The browser preserves an event draft after a conflict.                                                         |
| A02, A06 | Stage scheduling is explicitly UTC and preserves an unchanged original instant including seconds. Event and ticket-window inputs use the event timezone; gaps and folds are rejected. Unit cases cover UTC, London winter/summer, New York and Kolkata; a New York browser edits a London event correctly.                                                                         |
| A03      | Event, stage, message, template and survey drafts have administrator-scoped, tab-scoped recovery, a 12-hour lifetime and a size cap. Message drafts retain selected recipient hashes. Navigation and unload guards protect edits when recovery is unavailable. Admin browser journeys cover phone navigation/Back/refresh, communication recovery, stale edits and denied storage. |
| A05      | Checksummed archives preserve full word metadata, visibility, markdown, dates and media references without sessions. A local public/private loss-and-reconstruction test passes. Permanent media backups remain a separate requirement.                                                                                                                                            |
| A08      | Event selection and the events/pitches workspace are represented in validated admin search parameters.                                                                                                                                                                                                                                                                             |
| A09      | The route loads only the selected communications workspace. Contacts are searched and paginated on the server, without consent tokens in the UI response. The 205-contact regression proves bounded pages and search beyond the first page. Opening a plan does not reconcile contacts; send workflows retain reconciliation. Poll tools still receive event choices.              |
| A10, A11 | Phones have a compact admin area selector and the game entrance action before secondary explanation. The phone test asserts that action is in the viewport. Event fields have named essentials, venue and ticket sections, expandable publishing/policies, associated hints/errors, native validation and 44px targets.                                                            |
| A12      | Quality review reports the blocked count and first affected puzzle, filters the review queue, and explains the source-controlled approval process. Review is disclosed separately from game-night operations.                                                                                                                                                                      |
| G01, G02 | Shared headers display written connection state. Hot & Cold also exposes it in its custom lobby/play/results surfaces. The Feud buzzer has initial retry, stale/read feedback and truthful uncertain-acknowledgement copy; haptics follow acceptance.                                                                                                                              |
| G03      | Same Brain defaults to host-paced reveals, offers explicit automatic pacing, and tells players the host starts the next round.                                                                                                                                                                                                                                                     |
| G04      | Pool seats survive two-minute phone-away intervals and expire after six hours; explicit leaving/removal remains authoritative. Public presence retains its shorter lifetime. Tests cover both time boundaries, and six games pass isolated-phone refresh/reconnect without duplicate assignments.                                                                                  |
| G06      | Family Feud presents the selected default and launch action before the deck catalog. Adult content stays opt-in.                                                                                                                                                                                                                                                                   |
| S01      | Poll and survey submission revalidate authoritative state inside row-locked transactions. Editing a schema and accepting a response have defined ordering, covered with real Postgres interleaving tests.                                                                                                                                                                          |
| S03      | Advisory pool updates have a 250ms response budget with observed late failures; they do not delay acknowledgement of committed game commands indefinitely.                                                                                                                                                                                                                         |
| S04      | CI fails when its required database is unavailable. A deliberately unreachable test database returned a failing exit status rather than skipped green suites. Browser CI also provisions Redis for pool assignment.                                                                                                                                                                |
| S07      | Event operations, editor conversion, communications views and shared field/draft behavior have focused modules. The existing feature ownership remains intact. This is an incremental separation, not a claim that every large operations component is now small.                                                                                                                  |

An additional full-suite failure exposed a transfer-permission audit write using a nonexistent
`metadata` column. It now writes the schema's `after_state` column, and the restriction fixture
satisfies the current database constraint. Its focused regressions and the full suite pass.
Hot & Cold also lacked a lobby rename control for automatically named guests; it now provides one
and rejects blank, overlong or duplicate names. New survey saves retain the returned resource ID
for subsequent updates, and clear recovery only for the submitted version, preserving newer edits.
Optional on-device speech detection now waits for a user gesture instead of running during game startup.
Paired Heads Up and Spelling Bee now give restored answers a new attempt identity after undo, so
rejudging succeeds without weakening duplicate-command protection. Twin accepts keyboard input;
Liars role cards reveal on keyboard hold, hide on release/blur/cancellation, and expose the held
card to assistive technology. Word archives reject inconsistent indexes and missing bodies before
export, and refuse restore into unindexed existing metadata.

### Remaining acceptance checklist

- [ ] **A04 — Human puzzle review.** Review the six entries in the
      [prepared packet](./hot-and-cold-review-2026-09-04.md), record genuine approval evidence, then rerun
      the quality gate. The current gate still fails for exactly those six entries; it was not bypassed.
- [x] **G05 — Full isolated-role coverage.** Complete matches now pass on isolated browser contexts
      for Same Brain, Family Feud, Mafia, Imposter, Twin, Centre, Draw Country, Hot & Cold,
      legacy Spelling Party and paired Spelling Bee/Heads Up. Journeys cover private answers/roles,
      host succession, refresh, rejected inputs, undo/rejudging, matching results and rematches as
      appropriate to each mode. Six pooled modes also cover offline/online seat recovery. The
      [mode matrix](./game-playtest-2026-09-04.md) separates this evidence from physical-device tests.
- [ ] **G07 — Complete device acceptance.** Run and record each mode's complete lifecycle, physical
      screen lock, native speech/motion, storage denial and accessibility cases using that matrix.
      Silent paired Spelling Bee and Heads Up rounds, undo/rejudging, keyboard secret handoffs,
      reduced motion and denied storage now have browser evidence. The startup speech-probe crash
      was fixed; native speech, tilt and OS screen-lock behavior still require physical devices.
- [ ] **G08 — Human groups.** The two-group observation protocol is ready in the mode matrix.
      No first-time group observations or enjoyment approvals have been invented.
- [x] **S02 — Cross-store fault injection.** Production S3 adapter tests inject upload, promotion,
      and cleanup failures and prove retry or archive reconstruction. Real Redis tests inject lost
      responses before and after metadata/index commits, repair missing/stale index membership, and
      verify idempotent repair. Backups refuse inconsistent metadata instead of silently omitting it;
      restores reject unindexed target records. Interrupted cross-provider cleanup remains an explicit
      archive-recovery operation, not an atomic transaction.
- [ ] **S05 — Live retained restore.** PostgreSQL restore verifies checksum and size before using
      database tools. Tampered input is rejected, and a real local backup/restore preserved its payload.
      The runbook uses retained dated object copies. Verify the deployed schedule, independent failure
      domain and retention, then restore a deleted image/document from a retained provider copy.
      Live inspection found PITR disabled, no automatic PostgreSQL backup schedules, and one manual
      backup from 23 August expiring 22 September. Enabling daily/weekly backups was rejected by
      Railway with `OAUTH_INSUFFICIENT_GRANT`; no schedule changed. An independent backup destination
      and the required integration grant are pending.
- [ ] **S06 — Operational readiness evidence.** A daily workflow checks the puzzle window seven days
      ahead, and admin health shows scheduled-job last success/next due/errors plus oldest email age.
      Confirm workflow failure notifications and deployed worker alert delivery to the responsible
      operator; local code cannot establish that the live notification configuration is effective.
      Read-only live inspection confirms one active immediate fallback alert recipient. The readiness
      workflow is still uncommitted and absent from GitHub's active workflows. No test message was sent;
      the recipient/channel and delivery observation are pending.
- [x] **S08 — Admin browser coverage.** Eight journeys now cover draft recovery, unavailable storage,
      event and stage conflicts, timezone preservation (including UTC seconds), copied event/pitches
      URLs, keyboard actions and permission-shaped workspaces. A real Redis-backed content-admin
      session cannot see unauthorized controls or call the communications API.

### Implementation verification

- `pnpm check` passed formatting, native-dropdown policy, CLI parity, TypeScript and lint.
- `pnpm test` passed **1,621 tests across 247 files**, using isolated local Postgres. No database
  suite was skipped.
- `pnpm build` passed client/server bundling, Nitro packaging and the service-worker build. It
  emitted existing module-directive warnings; no deployment was performed.
- Browser evidence: **29 targeted journeys pass**, using real local Redis (through a loopback
  REST adapter), isolated Postgres and local object storage. This includes eight admin journeys,
  six pooled-game recovery cases, complete matches across the multiplayer modes, keyboard private
  handoffs and three Redis metadata/index fault tests. The initial combined run passed 27; focused
  reruns passed the remaining scenarios after correcting readiness synchronization and Imposter's
  two-clue-round and role-name test assumptions. External credentials and the scheduler were disabled.
- Narrow checks additionally verified word reconstruction, archive tampering rejection, the real
  local PostgreSQL restore, advisory-write timeout, database race ordering and Hot & Cold renaming.
- Full browser release coverage, coverage thresholds and provider/live-device checks are deferred
  to CI and the acceptance checklist above. The focused browser scope exercises the UI boundaries
  changed here; the complete unit/integration suite and build cover the broad module extraction.

### Shipping verification

The requested release pass ran all 42 browser journeys: 37 passed initially. It exposed a Centre
finish failure when the synchronized clock produced fractional milliseconds; the client now
normalizes the claimed duration to the integer transport contract. Its complete match passed after
the fix. Four stale scoring journeys were updated to the documented retirement contract: historical
ledger corrections still work, ticket browsing creates no points transactions, retired public links
explain closure, and points-only staff credentials expose no active tools or award endpoint. All four
corrected journeys passed in focused reruns. Thus all 42 current journeys have passing evidence;
the initial aggregate command is recorded as failed, not retroactively green.

The release coverage run passed all 1,621 tests with 47.2% statements, 43.36% branches, 46.63%
functions and 49.39% lines, exceeding every configured threshold. The six genuine puzzle approvals
remain missing; that separate editorial gate is unchanged and still fails. Deployment was explicitly
requested with the five previously reported acceptance items still open.

## How to use this checklist

- **P1:** address before the next relevant release or operational use.
- **P2:** next tightening pass; important reliability, usability, or maintenance work.
- **P3:** polish or evidence gathering after the concrete defects are resolved.
- **Reproduced:** observed in the local browser, an executable probe, or a repository check.
- **Code-confirmed:** the implementation establishes the behavior; no complete browser reproduction.
- **Validate:** a plausible failure boundary requiring the specified experiment before changing code.
- **Design:** an improvement to evaluate, not a demonstrated correctness defect.

Size is relative: S = one focused change; M = a workflow plus tests; L = several modes or boundaries.
Check an item off only after its acceptance criteria and appropriate verification pass. Keep these
as small changes; do not turn the checklist into a framework rewrite.

## First: correctness and operational readiness

- [x] **A01 · P1 · M · Reproduced — Make communication-stage edit eligibility atomic.**
      `updateCommunicationPlanStage` reads eligibility, then updates content in a separate statement.
      In an isolated Postgres reproduction, the scheduler changed the stage to `fanout` between those
      statements; the edit still succeeded and changed its subject. The `CASE` preserves the new status
      but does not protect the content. Put eligibility in the write predicate and check `RETURNING`,
      or serialize the relevant transition in one transaction. Return a conflict that preserves the
      operator's draft. **Done when:** a concurrent scheduler claim and edit have one valid ordering;
      content cannot change after the delivery claim. Add the exact interleaving regression.
      Evidence: [communication-plans.server.ts](../features/communications/communication-plans.server.ts),
      `updateCommunicationPlanStage` and scheduled fan-out transitions.

- [x] **A02 · P1 · S · Reproduced — Stop send times moving when a stage is edited.**
      `openStage` strips an ISO timestamp to 16 characters, while `saveStage` parses it as local time.
      Under `Europe/London`, `2026-09-05T18:00:00.000Z` becomes `2026-09-05T17:00:00.000Z` after an
      unchanged round trip. Use one explicit timezone conversion policy and show the zone beside the
      field and final schedule. **Done when:** unchanged edits preserve the instant in UTC, London summer
      and winter, and a second browser timezone; ambiguous/nonexistent daylight-saving times have a
      deliberate outcome. Evidence:
      [CommunicationsPanel.tsx](../features/admin/ui/components/CommunicationsPanel.tsx),
      `openStage` / `saveStage`.

- [x] **A03 · P1 · M · Reproduced — Preserve unfinished admin edits across navigation.**
      In the browser: Events → New event → enter a title → Games → Events loses the form without a
      warning or recovery. The dashboard unmounts inactive panels; event and communication drafts are
      component state. Provide a consistent dirty-state guard and bounded draft recovery for event,
      message, template, and survey editors. Scope recovery to the resource and current administrator;
      never persist authentication credentials with drafts. **Done when:** workspace switches, Back,
      refresh, and expired-session recovery preserve edits or offer an explicit discard choice. Reuse
      the working patterns in the words editor where appropriate.
      Evidence: [AdminDashboard.tsx](../features/admin/ui/AdminDashboard.tsx),
      [EventsPanel.tsx](../features/admin/ui/components/EventsPanel.tsx),
      [EditorAdminClient.tsx](../features/admin/ui/editor/EditorAdminClient.tsx).

- [ ] **A04 · P1 · S · Reproduced — Renew the six missing Hot & Cold approvals.**
      `pnpm check:hot-and-cold-quality` currently fails for daily #36 `cabinet`, #37 `brother`,
      #38 `dinner`, #39 `ring`, #40 `farmer`, and #41 `village`. Review the actual trails, hints, and
      comparisons before updating approval evidence; do not bypass the gate or mechanically approve
      hashes. **Done when:** the rolling 30-puzzle window passes the existing check and the admin
      accurately explains the remaining work. Evidence:
      [check-hot-and-cold-quality.ts](../scripts/check-hot-and-cold-quality.ts),
      [HotAndColdReviewPanel.tsx](../features/admin/ui/components/HotAndColdReviewPanel.tsx).

- [x] **A05 · P1 · M · Code-confirmed gap — Establish recovery for Redis-owned writing metadata.**
      Words require Redis metadata and its index to locate and interpret their stored bodies. Restoring
      Git, Postgres, and private objects alone does not restore admin-authored writing. The recovery
      runbook explicitly has no application-managed Redis restore guarantee. Select and document a
      durable backup/reconstruction policy for word metadata, visibility, and indexes; verify the actual
      provider configuration separately. **Done when:** an isolated loss-and-restore drill recovers
      a public word and a private draft, including visibility and media references. Do not restore
      obsolete sessions just to recover content. Evidence:
      [words/store.server.ts](../features/words/store.server.ts), `getWord` / `getWordMeta`,
      [disaster-recovery.md](./disaster-recovery.md).

## Admin: make the normal job safe and short

- [x] **A06 · P2 · M · Code-confirmed — Interpret event times in the event's timezone.**
      Event inputs use `getTimezoneOffset()` / `new Date(value)`, independently of `draft.timezone`.
      A travelling operator can enter London wall-clock time but save an instant interpreted in their
      device zone. Unlike A02, an unchanged ordinary round trip is not necessarily wrong; the mismatch
      is the meaning of the editable field. **Done when:** starts, doors, ends, and ticket sales windows
      show an explicit zone and retain the same event meaning across device zones, with DST tests.
      Evidence: [EventsPanel.tsx](../features/admin/ui/components/EventsPanel.tsx),
      `toLocalInput`, `fromLocalInput`, and the timezone field.

- [x] **A07 · P2 · M · Code-confirmed — Detect concurrent admin edits.**
      Event updates merge from a read and then upsert without comparing the version originally opened
      by the editor. Two administrators can overwrite one another's event fields. Communication
      templates/stages have similar unconditional updates. Add a narrow expected-version contract,
      beginning with events, and a useful reload/review conflict state. **Done when:** two editors
      cannot silently erase one another's changes; the second keeps its local draft. The words editor
      already provides a precedent. Evidence:
      [events.server.ts](../features/events/events.server.ts), `updateEvent`,
      [events/store.server.ts](../features/events/store.server.ts), `putEvent`,
      [words/store.server.ts](../features/words/store.server.ts), `WordUpdateConflictError`.

- [x] **A08 · P2 · M · Code-confirmed — Complete resource navigation in admin.**
      The URL accepts an event, but the dashboard does not connect `EventsPanel`'s
      `onSelectedEventChange`; event selection and the tickets/pitches workspace remain local state.
      Refresh and Back therefore cannot consistently restore the selected job. Persist addressable
      selection in validated search parameters while keeping unsaved form state separate. **Done when:**
      opening a specific event or pitch workspace, refreshing, copying its URL, and using Back restore
      the same resource. Evidence: [admin/index.tsx](../src/routes/admin/index.tsx),
      [AdminDashboard.tsx](../features/admin/ui/AdminDashboard.tsx),
      [navigation.md](./navigation.md).

- [x] **A09 · P2 · M · Code-confirmed — Make Communications reads bounded and workspace-specific.**
      Initial loading fetches contacts, messages, all plans, templates, surveys, and events together.
      `listCommunicationContacts()` first scans ticket/pitch identities and performs a sequential upsert
      for every merged contact, then returns the full contact list. Every full reload repeats that work.
      Split reads by active workspace, paginate/search contacts on the server, and move reconciliation
      to an explicit bounded workflow or the owning write boundary. Supply initial selected-workspace
      data through the route/server boundary. **Done when:** viewing a plan does not synchronize all
      contacts, one failed subview does not disable unrelated tools, and cost is bounded with a large
      seeded audience. Evidence:
      [communications/route.ts](../src/routes/api/admin/communications/route.ts),
      [communications.server.ts](../features/communications/communications.server.ts), `syncContacts`,
      [CommunicationsPanel.tsx](../features/admin/ui/components/CommunicationsPanel.tsx), `load`.

- [x] **A10 · P2 · M · Design, browser-observed — Put the mobile job above the fold.**
      At 390×844 the Games admin uses roughly the first 430px for shared header/navigation; explanation
      then pushes entrance creation below the first viewport. Keep the current area and a compact area
      switcher visible, with utilities and editorial review one level away. Do not remove capabilities.
      **Done when:** an operator can see the current task and its primary action immediately on a phone,
      and keyboard navigation and desktop workspace switching remain clear. Evidence:
      [AdminSectionNav.tsx](../features/admin/ui/components/AdminSectionNav.tsx),
      [AdminDashboard.tsx](../features/admin/ui/AdminDashboard.tsx),
      [GamePoolsPanel.tsx](../features/admin/ui/components/GamePoolsPanel.tsx).

- [x] **A11 · P2 · M · Code-confirmed / design — Make event forms explain errors locally.**
      The event `Field` uses a 40px minimum height, has no field-error contract, and does not connect its
      hint with `aria-describedby`. The form presents a long sequence of basic, venue, media, policy,
      and ticket fields. Introduce clear sections, field-level errors, error-summary focus, and 44px
      targets; keep optional publishing/media controls progressively disclosed. **Done when:** an empty
      or invalid save names and focuses the problem, assistive technology gets the hint/error, and
      required setup is distinguishable from optional detail. Evidence:
      [EventsPanel.tsx](../features/admin/ui/components/EventsPanel.tsx), `Field` and event form,
      [CommunicationsPanel.tsx](../features/admin/ui/components/CommunicationsPanel.tsx), `Field`.

- [x] **A12 · P2 · S · Design — Make the quality gate actionable from its summary.**
      Games shows “release blocked” beside the first upcoming puzzle, which is itself approved; the
      operator must inspect the selector to find the failing items. Show the blocked count, first
      affected date, and a filtered review queue, with a clear explanation of the source-controlled
      approval workflow. Keep quality review separate from running a game night. **Done when:** the six
      failures in A04 are discoverable directly from the summary and an approved puzzle cannot look like
      the cause. Evidence:
      [HotAndColdReviewPanel.tsx](../features/admin/ui/components/HotAndColdReviewPanel.tsx).

## Games: orientation, pace, and recovery

- [x] **G01 · P2 · S · Code-confirmed — Show connection trouble in visible words.**
      `RoomConnectionIndicator` renders a dot with an accessible label and hover title but no visible
      text. Touch users cannot reliably distinguish offline from reconnecting. Show a short written
      state when unhealthy, without replacing the game prompt. **Done when:** a phone user and a screen
      reader can both understand the state without color or hover. Evidence:
      [RoomHeader.tsx](../features/things/shared/RoomHeader.tsx),
      [RoomHeader.css](../features/things/shared/RoomHeader.css).

- [x] **G02 · P2 · M · Code-confirmed — Give the Family Feud buzzer explicit recovery feedback.**
      The hook exposes connection state and read messages, but the buzzer does not render them. Before
      its first snapshot it can stay at “opening buzzers…” through network failure; with an old snapshot
      it can still look ready. Show initial-load retry and freshness/connectivity feedback. After a lost
      acknowledgement, reconcile before claiming that the buzz was not recorded: it may have committed.
      Preserve the existing MC assignment fallback. **Done when:** offline-before-load, a stale faceoff,
      and a lost successful response each produce truthful, actionable feedback. Evidence:
      [FamilyFeudBuzzerApp.tsx](../features/things/family-feud/FamilyFeudBuzzerApp.tsx),
      [useFamilyFeudRoom.ts](../features/things/family-feud/useFamilyFeudRoom.ts).

- [x] **G03 · P2 · M · Code-confirmed / design — Let the room own Same Brain's reveal hold.**
      The default reveal lasts 20 seconds and `advance` starts the next round automatically. A host can
      pause, but must intervene before the social beat disappears. Offer host-paced reveal as the
      co-located default, retaining explicitly chosen automatic pacing where useful. **Done when:**
      laughter, answer correction, and discussion can finish before “next round”, with one clear host
      action and a waiting cue for everyone else. Evidence:
      [same-brain-rules.ts](../features/things/same-brain/same-brain-rules.ts),
      [same-brain-room-engine.server.ts](../features/things/same-brain/same-brain-room-engine.server.ts),
      `advance`; [room-first-multiplayer.md](./room-first-multiplayer.md).

- [x] **G04 · P2 · M · Validate — Reconcile pool expiry with putting phones away.**
      Pool assignments expire after 90 seconds without a heartbeat; room reads update that heartbeat,
      and hidden tabs stop the shared refresh loop. `markGamePoolPlayerSeen` only revives rows still
      marked active. Investigate returning after a two-minute discussion, screen lock, or host pause:
      the game room may survive while its pool membership no longer does. Do not describe this as
      proven game deletion. **Done when:** the same player returns to the correct room/seat without
      duplicate allocation, or receives a deliberate host-approved recovery; absent users still release
      genuinely abandoned capacity. Evidence:
      [membership.server.ts](../features/things/pool/membership.server.ts),
      [useVisibilityReconciler.ts](../hooks/useVisibilityReconciler.ts),
      [same-brain-room.server.ts](../features/things/same-brain/same-brain-room.server.ts).

- [x] **G05 · P2 · L · Code-confirmed coverage gap — Complete isolated-device game journeys.**
      Dedicated multiscreen browser journeys exist for Same Brain and Family Feud. Dev harnesses exist
      for Same Brain, Liars, Twin, and Centre, but the browser suite does not provide a corresponding
      isolated-role journey for every multiplayer mode. Start with Liars secrets/host succession and
      Spelling Party presenter/player recovery, then paired judging, Twin, Centre, and Draw Country.
      Reuse real production surfaces, not a second engine. **Done when:** each mode meets its required
      harness level and proves one complete match plus its most consequential recovery/privacy boundary.
      Evidence: [e2e](../e2e), [multiplayer-testing.md](./multiplayer-testing.md),
      [multiplayer registry](../features/things/shared/multiplayer-telemetry.ts).

- [x] **G06 · P3 · S · Design, browser-observed — Shorten Family Feud's first setup decision.**
      At 390×844, six vibe choices precede the launch action; it is outside the first viewport. Present
      the selected default and launch action early, with alternative decks and detailed settings behind
      one choice. Keep adult content opt-in. Make the TV/presenter versus MC-phone role unmistakable.
      **Done when:** a first-time host can identify the required devices and start with defaults without
      reading the whole deck catalog. Evidence:
      [FamilyFeudSetupApp.tsx](../features/things/family-feud/FamilyFeudSetupApp.tsx).

- [ ] **G07 · P2 · L · Validate — Run the same lifecycle acceptance pass for every game mode.**
      Test teach → join → ready → first input → waiting → reveal → correction → finish → rematch/leave.
      Each state must explain what happened, who acts next, and whether a phone is needed. Exercise
      long names, no sound, reduced motion, failed storage, Back/refresh, and one missing device.
      Single-device modes additionally need safe secret handoff and motion-control alternatives.
      **Done when:** the mode matrix below records real results and specific exceptions rather than
      assuming shared components make every game correct.
      Evidence: [game surfaces](../features/things),
      [room-first-multiplayer.md](./room-first-multiplayer.md).

- [ ] **G08 · P3 · M · Validate — Record first-time-group playtests.**
      Run at least two independent groups for each proposed headline event game. Record time to first
      meaningful action, “what do I do?” moments, inactive waits, phone attention, disputes, best/confusing
      moments, and willingness to replay. Test at realistic room distance, noise, and lighting.
      **Done when:** fun and accessibility claims are backed by observations; fixes go into game-owned
      work items. A harness or this audit cannot validate social fun.
      Evidence: [room-first-multiplayer.md](./room-first-multiplayer.md), playtest requirements.

## Systems: protect the edges and reduce maintenance

- [x] **S01 · P2 · M · Code-confirmed — Move poll/survey acceptance checks into the commit boundary.**
      Poll submission checks open status/options before its transaction. Poll editing checks response
      count before an unconditional upsert. Survey submission similarly validates the current survey
      before its response transaction. Race closing/editing against a response, and serialize validation
      against the authoritative row/version. **Done when:** a close or schema change has a defined
      ordering with submissions, and accepted responses cannot reference invalidated choices/questions.
      Add real-Postgres concurrency regressions, not just sequential tests. Evidence:
      [polls.server.ts](../features/polls/polls.server.ts), `savePoll` / `submitPollVote`,
      [surveys.server.ts](../features/surveys/surveys.server.ts), submission transaction.

- [x] **S02 · P2 · M · Code-confirmed — Commit word metadata and index changes together.**
      Creation writes the body, then performs separate Redis `SET` and `SADD`; deletion removes metadata
      and index membership independently. A partial failure can leave an existing but unlisted record,
      or stale index membership. Make the Redis pair atomic and explicitly reconcile cross-store body
      promotion/cleanup. **Done when:** fault injection between each boundary leaves either a usable
      record or a discoverable repair state, and retry does not get stuck on an invisible existing slug.
      Evidence: [words/store.server.ts](../features/words/store.server.ts),
      `createWordLocked` and deletion; [durable-work.md](./durable-work.md).

- [x] **S03 · P2 · M · Validate — Bound game-pool bookkeeping after a successful game command.**
      Game facades await pool membership writes after the authoritative game operation, suppressing
      errors. A slow Postgres side write can delay the game response even though Redis already committed.
      Test that dependency separately from game authority; give advisory bookkeeping an explicit small
      budget and reconciliation path where needed. **Done when:** a stalled pool database cannot hold
      successful gameplay hostage or misrepresent an accepted command as uncommitted. Preserve required
      moderation effects and eventual membership correctness.
      Evidence: [same-brain-room.server.ts](../features/things/same-brain/same-brain-room.server.ts),
      [membership.server.ts](../features/things/pool/membership.server.ts).

- [x] **S04 · P2 · S · Code-confirmed — Fail CI if its test database is unavailable.**
      `vitest.globalSetup.ts` sets `MAH_TEST_DB_READY=0` and skips database suites on any connection error,
      including CI. CI provisions Postgres, but the test runner does not enforce that its database suites
      actually ran. Preserve convenient local skipping and throw in CI when the required database is
      missing. **Done when:** deliberately broken CI database configuration fails loudly rather than
      reporting a misleading green database test run.
      Evidence: [vitest.globalSetup.ts](../vitest.globalSetup.ts),
      [postgres test helper](../__tests__/helpers/postgres.ts), [CI](../.github/workflows/ci.yml).

- [ ] **S05 · P2 · M · Validate — Prove recovery and backup retention, not just backup commands.**
      The backup tool writes a checksum sidecar; restore verifies the archive catalogue but does not
      compare that checksum. The runbook's fallback object `sync` also needs retained versions or dated
      snapshots so deletion/corruption cannot simply propagate into the only backup. Verify the deployed
      schedules, retention, separate failure domain, and restore durations. **Done when:** tampered or
      mismatched archives are rejected and a deleted permanent image/document can be restored from an
      earlier retained copy. Provider settings were not inspected in this audit.
      Evidence: [postgres-archive.mjs](../ops/postgres-archive.mjs),
      [disaster-recovery.md](./disaster-recovery.md).

- [ ] **S06 · P2 · M · Design — Monitor product readiness between deployments.**
      The Hot & Cold quality window advances with time, while its CI gate runs on code changes. Add
      advance notice before unapproved puzzles enter the window. For email/media/scheduled work, use
      oldest-work age and last successful run alongside counts, and make per-replica versus aggregate
      multiplayer metrics explicit. Reuse current health/outbox telemetry. **Done when:** an operator
      learns about an approaching content gap or stalled worker before users do, without noisy unchanged
      alerts. Evidence: [CI](../.github/workflows/ci.yml),
      [SystemHealthPanel.tsx](../features/admin/ui/components/SystemHealthPanel.tsx),
      [application-scheduler-service.server.ts](../features/system/application-scheduler-service.server.ts),
      [observability.md](./observability.md).

- [x] **S07 · P2 · M · Design — Split admin files by independent responsibility.**
      EventsPanel is 4,236 lines and CommunicationsPanel 2,741 at this baseline. They contain distinct
      resource editors, read models, and operational tools. Extract the event editor, ticket operations,
      and communication workspaces as those workflows are fixed; remove repeated field/date/error code
      only where contracts really match. **Done when:** each extracted unit owns its state and requests,
      the shell only composes/navigation, and changes need fewer branches and less duplicated code.
      Do not split by arbitrary line count or introduce a universal admin engine.
      Evidence: [EventsPanel.tsx](../features/admin/ui/components/EventsPanel.tsx),
      [CommunicationsPanel.tsx](../features/admin/ui/components/CommunicationsPanel.tsx).

- [x] **S08 · P2 · M · Code-confirmed coverage gap — Add consequential admin browser journeys.**
      Existing admin component tests include static markup assertions; the browser suite emphasizes
      event-night staff and attendee operations. Add a small set for dirty-draft navigation, event
      selection/history, timezone-preserving scheduling, conflict recovery, and permission-shaped
      workspace access. Include a phone viewport and keyboard operation. **Done when:** A01–A03 and
      A06–A11 have behavior-level regression coverage at the boundary that actually failed.
      Evidence: [admin-events-panel.test.ts](../__tests__/unit/admin-events-panel.test.ts),
      [e2e](../e2e).

## Coverage map and remaining release evidence

This table records depth honestly. “Reviewed” means implementation/contracts were inspected;
it does not mean every behavior passed an end-to-end test.

| Area                                                              | Evidence in this audit                                                                            | Next consequential proof                                                                      |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Admin overview, events, communications, games                     | Source review; local browser overview/events/games; phone layout review; draft-loss reproduction  | A01–A12 and S08                                                                               |
| Auth, admin permissions, attendee access                          | Boundary/configuration review; focused permission tests                                           | Real-device passkey/recovery and revoked-role journeys                                        |
| Events, tickets, capacity, admission, email                       | Real-Postgres capacity/admission/outbox tests; workflow review                                    | Provider-sandbox payment/refund/exchange uncertainty and webhook replay; not exercised here   |
| Waitlists, credits, teams, guest/staff operations                 | Persistence/ownership and test inventory review                                                   | Concurrency across cancellation, credit reservation, reassignment, and last-seat availability |
| Surveys, polls, Best Dressed, icebreakers                         | Source and route/persistence inventory; deeper poll/survey write review                           | S01; privacy/identity and concurrent-close journeys                                           |
| Writing, albums, private transfers, media                         | Storage/recovery/queue boundary review; words write-path inspection                               | A05/S02/S05; interrupted upload, publish/unpublish failure, worker restart                    |
| Pitch studio and presentation                                     | Recovery UI, lifecycle, and existing journey inventory review                                     | Missing-media restoration and presenter/controller reconnect on real devices                  |
| Shared multiplayer, room pools, results                           | Reconciler/idempotency/expiry/result-outbox review; Same Brain and Family Feud integration suites | G01–G05 and S03; two-replica Redis testing                                                    |
| Same Brain / Family Feud                                          | Deeper engine/controller review, local launch screens, integration tests                          | Full isolated-browser matches, mobile reconnect, social pacing                                |
| Liars / Twin / Centre                                             | Harness, role, recovery, and scenario inventory                                                   | Complete isolated-role lifecycle and failure journeys                                         |
| Spelling Party / paired judging / Draw Country / Hot & Cold rooms | Role/route and test inventory, shared boundary review                                             | G05/G07; presenter secrecy, adjudication, refresh, rematch                                    |
| Heads Up / Spelling Bee / local variants / standalone icebreaker  | Shared history/storage/motion contract and surface inventory                                      | Device rotation, Back, storage denial, safe handoff and non-motion controls                   |
| Daily Hot & Cold                                                  | Actual quality gate and admin inspection                                                          | A04/A12/S06; existing focused mobile journey at release                                       |
| Editorial site, navigation, offline/PWA, exam                     | Architecture, routing/cache and feature inventory; sampled implementation                         | Built service-worker upgrade/offline test; editorial keyboard/image journeys; exam errors     |
| Runtime, scheduler, health, backups, CI                           | Lifecycle/configuration review, scheduler tests, fresh local migrations                           | Real restore drill, two-replica failover, worker shutdown and production alert evidence       |

Keep retired event scoring sealed. Existing scoring persistence supports historical records and some
operational team data; its presence is not a reason to restore points UI or couple games to rewards.
Any later removal should follow a dependency map and preserve historical records.

## Baseline audit verification (before implementation)

Used the repository-pinned pnpm and Node 22 runtime family from the Dockerfile. The shell's default
Node was newer, so verification explicitly selected the installed Node 22 runtime.

**Passed: 148 tests across 13 focused files.**

```sh
pnpm exec vitest run \
  __tests__/unit/admin-events-panel.test.ts \
  __tests__/unit/admin-route-permissions.test.ts \
  __tests__/unit/admin-workspace-access.test.ts \
  __tests__/unit/reliable-multiplayer-action.test.ts \
  __tests__/unit/live-room-state.test.ts \
  __tests__/unit/room-join-control.test.ts \
  __tests__/unit/application-scheduler-service.test.ts

pnpm exec vitest run \
  __tests__/integration/communication-plans.test.ts \
  __tests__/integration/checkout-capacity.test.ts \
  __tests__/integration/ticket-issuance-redemption.test.ts \
  __tests__/integration/email-outbox.test.ts \
  __tests__/integration/same-brain-room.test.ts \
  __tests__/integration/family-feud-room.test.ts
```

The integration run used a newly created isolated local database, not production or the existing
shared test database. All six files ran; none was skipped. The browser server used that isolated
database with external credentials disabled and the application scheduler disabled. Missing Redis
and object storage produced expected local capability warnings. A pooled Same Brain join failed in
that environment; it is not classified as a production defect. No complete multiplayer browser
match or live provider action was performed.

Additional evidence:

- A01: executed the real `updateCommunicationPlanStage` against Postgres while holding its row lock,
  waited for its update to block, changed status to `fanout`, and released the lock. Result:
  `{"status":"fanout","subject":"Changed after claim"}`. No message was sent.
- A02: an executable `TZ=Europe/London` probe of the editor's exact conversion expressions showed
  the unchanged timestamp moving backwards 60 minutes.
- A03: local browser navigation reproduced loss of an entered event title with no warning.
- Local browser inspection covered admin overview, event creation, Games, Same Brain launch, and
  Family Feud setup; mobile visual inspection used 390×844. This is not a complete accessibility audit.
- **Failed:** `pnpm check:hot-and-cold-quality`, with the six approval failures listed in A04.
- Documentation formatting, relative links/referenced paths, and diff whitespace were checked.

These checks established the original audit baseline. The initial audit was documentation only.
The later implementation checks and remaining acceptance work are recorded at the top of this file.

## Suggested order

1. A01–A04: delivery correctness, draft safety, and the currently failing quality gate.
2. A05–A09 and S01–S04: durable recovery, edit conflicts, bounded reads, and atomic transitions.
3. A10–A12, G01–G04, and S08: observable mobile/admin and game recovery improvements.
4. G05–G08 and S05–S07: complete mode evidence, real-device/group rehearsal, operational drills,
   and incremental simplification.

Finish the concrete fixes before spending time on cosmetic redesign. Preserve the existing modular
monolith, shared room primitives, authoritative stores, and game-owned rules.
