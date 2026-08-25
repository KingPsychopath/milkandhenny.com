# Event identity, scoring, staff, discovery, and print checklist

This document is the implementation and acceptance checklist for the event scoring system. It
covers the product decisions from the planning conversation and the edge cases that must not be
left implicit.

No feature is complete because its UI works once. A section is complete only when its server
rules, permissions, audit history, failure states, accessibility, and focused verification are
also complete.

## How to use this checklist

- Check an item only after the behavior is implemented and verified.
- Keep deferred work unchecked. Do not add a compatibility path to make an incomplete feature
  appear complete.
- Use the release gates to keep each implementation unit usable.
- Add links to implementation commits or supporting evidence beside a checked item when useful.
- Keep raw test, load, print, and browser evidence under `.artifacts/`.

## Terms

| Term              | Meaning                                                                        |
| ----------------- | ------------------------------------------------------------------------------ |
| Person            | A durable human identity across events. It can exist before login support.     |
| Event participant | One human or unclaimed attendee place in one event. Scores belong here.        |
| Ticket            | One admission credential linked to one event participant.                      |
| Order             | A purchase that can contain several separate tickets and participants.         |
| Attendee session  | Anonymous browser access to one or more claimed or managed tickets.            |
| Staff assignment  | Event-scoped authority for a person, link, station, or device.                 |
| Activity          | A game, physical challenge, check-in award, discovery, or manual award source. |
| Discovery         | A QR, code, phrase, clue, or collection that an attendee can claim.            |
| Score transaction | One immutable business action.                                                 |
| Score posting     | One signed point change within a score transaction.                            |
| Projection        | A rebuildable current balance, rank, or team total.                            |

## Product decisions to confirm

The recommended defaults below close policy gaps that would otherwise produce inconsistent code.
Confirm each decision before the affected implementation begins.

- [x] Event points are event-local. They do not carry into another event or become money.
- [ ] One normal ticket represents one attendee, one admission entitlement, and one event
      participant.
- [ ] Several devices may hold the same bearer ticket, but they all see the same participant,
      admission state, score, and history.
- [ ] A second device does not create a second attendee or another admission from the same ticket.
- [ ] A group purchase creates one ticket and participant per attendee.
- [ ] A future family or table pass contains several individual admission entitlements and
      participants; it does not use one shared scoring identity.
- [ ] Anonymous ticket claims are non-exclusive device conveniences. Verified identity is needed
      for durable ownership and device revocation.
- [ ] A ticket transfer before points exist can relink its participant. A transfer after points
      exist requires reviewed identity resolution; earned points do not move automatically.
- [ ] A refund or void preserves ledger history. It makes the participant ineligible for new
      awards and applies the event's public-ranking policy without deleting audit evidence.
- [ ] Physical event claims require accepted check-in by default. An event can explicitly allow
      pre-check-in online game points.
- [ ] Public leaderboard names use generated aliases by default. Private names require explicit
      attendee choice or event policy.
- [x] Public leaderboards use `noindex` by default.
- [ ] Normal transfers and debits cannot create a negative balance. Exceptional corrections need
      admin authority, a warning, and a note.
- [ ] Team attribution is captured when points are earned. A later team move affects future points
      only unless an admin performs an explicit correction.
- [ ] Ties share rank. Prizes that require one winner need a separate tie-break or admin finalization.
- [ ] Closed events allow only explicit admin correction and re-finalization.
- [ ] Static QR codes are convenience credentials, not proof of physical proximity.
- [x] Unmetered staff scoring is online-only.
- [x] Arbitrary offline staff scoring is deferred until bounded per-device budgets exist.
- [ ] Event photographs follow an explicit event consent policy and are not made public by default.
- [ ] The temporary event album expiry remains visible. Permanent photos must be promoted to
      `/pics` or another durable collection.
- [x] Points have no cash value unless separate competition terms explicitly say otherwise.
- [ ] Prize rules, tie handling, eligibility, and correction deadlines are written before a
      points-based prize is announced.

## Release gates

### Gate 1: identity foundation

- [x] Identity records, ticket links, attendee sessions, reconciliation, and audit rules pass.
- [x] Existing ticket purchase, delivery, refund, and admission behavior still passes.
- [x] Scoring remains off for every event.

### Gate 2: core scoring

- [x] Ledger, projections, lifecycle, admin controls, staff pools, quick awards, personal score,
      public leaderboard, and notifications pass.
- [x] At least one automatic game and one manual activity pass end to end.
- [x] Online operation and offline admission reconciliation pass.

### Gate 3: discoveries and print

- [ ] QR and code discoveries, hunt sets, point pools, test mode, and branded print packs pass.
- [ ] Every exported QR is machine-validated and physically test-scanned.

### Gate 4: activity media

- [ ] Optional winner photos use the existing event media pipeline.
- [ ] Award success does not depend on media-upload success.
- [ ] Consent, expiry, retry, and deletion behavior pass.

### Gate 5: extended operation

- [ ] Remaining game integrations and any bounded offline scoring pass.
- [ ] Future login can claim existing people and participants without a score migration.

## 1. Architecture and ownership

- [x] Postgres is authoritative for people, participants, ticket links, activities, rules,
      transactions, postings, teams, discoveries, and projections.
- [x] Redis is limited to sessions, rate limits, wake signals, room state, and short-lived
      coordination.
- [x] IndexedDB stores structured browser snapshots and permitted pending commands.
- [x] Local storage contains convenience data only.
- [x] A browser total is never accepted as the official score.
- [x] Routes own transport validation, response shape, and coarse authorization only.
- [x] Feature server workflows own scoring, eligibility, permission, and reconciliation rules.
- [x] Effect wraps service boundaries only; scoring engines remain plain async functions.
- [x] No whole leaderboard or participant collection is stored in one Redis key.
- [x] Redis uses one key per record.
- [x] Scoring lives in a coherent feature module instead of event routes or the large admin
      dashboard.
- [x] Admin UI uses focused components under the existing admin component structure.
- [x] UI and CLI operations call the same server workflows.
- [x] Durable game results use an idempotent source receipt or transactional outbox.
- [x] Event rename or slug change cannot orphan participants, activities, media, or scores.
- [x] Event linkage uses an immutable identity or one atomic, complete slug-move operation.
- [x] Event deletion is blocked once durable scoring history exists; cancellation archives it.
- [x] No legacy schema, compatibility alias, or transitional scoring API remains.

## 2. Person and participant identity

- [x] Every durable human can have an opaque `personId`.
- [x] Every attendee place in an event has an opaque `eventParticipantId`.
- [x] Scores target the event participant.
- [x] Names, aliases, emails, order IDs, browsers, devices, and IP addresses are not identity keys.
- [x] A person can hold several verified identifiers.
- [x] Email changes preserve the person and score history.
- [ ] Old verified email is retained only as permitted historical evidence.
- [x] Game nicknames can change without changing identity.
- [x] The public alias is separate from canonical and ticket-holder names.
- [x] An unknown game player can hold an unclaimed participant result.
- [x] A signed claim token can connect that result later.
- [x] A future passwordless login or passkey links to `personId` without moving ledger entries.

## 3. Tickets, orders, and simultaneous access

- [x] Every issued normal ticket gets a separate participant placeholder.
- [x] A multi-ticket order never treats the purchaser as every attendee.
- [x] Every child ticket can be claimed, scored, transferred, and displayed separately.
- [x] The primary order holder can see an authorized private order aggregate.
- [x] A child ticket cannot manage the order without authority.
- [x] One phone can manage and switch between several tickets.
- [x] One ticket can be open on several phones at the same time.
- [x] Concurrent ticket viewers receive the same admission and score state.
- [x] A ticket redemption remains one-use even when several devices hold the ticket.
- [x] A second device cannot create a second participant from the same ticket.
- [x] A repeated ticket claim is idempotent.
- [x] One person may legitimately claim more than one ticket.
- [x] Claiming several tickets does not silently merge their participants or points.
- [ ] A future group pass creates separate child entitlements and participants.
- [x] A ticket screenshot has the same bearer risk as the original link and is handled as such.
- [ ] Refund, void, transfer, and order cancellation behavior is defined after check-in and after
      points exist.

## 4. Anonymous attendee session

- [x] Opening a valid ticket on the attendee's device creates or extends an attendee session.
- [x] The session uses an opaque, secure, HTTP-only, first-party cookie.
- [x] The cookie uses appropriate `Secure`, `SameSite`, expiry, and rotation settings.
- [x] The server session can reference several separately claimed or managed tickets.
- [x] The session stores one active participant choice per event.
- [x] `This is my ticket` selects a personal participant without creating permanent ownership.
- [x] `I am managing this ticket` gives access without treating all managed tickets as one person.
- [x] `Switch ticket` changes the active view without moving points or identity.
- [x] `Remove from this device` removes browser access without deleting server data.
- [x] `This is not me` clears the selection without damaging history.
- [x] Opening a new ticket offers add, switch, view-only, and managed choices in plain language.
- [x] Private browsing warns that access may not persist.
- [x] Likely in-app browsers offer `Open in Safari or Chrome` and `Copy link` actions.
- [x] Losing cookies does not lose ticket, participant, or score data.
- [x] Recovery works through the ticket link, ticket email resend, verified email, or admin support.
- [x] A staff scan never creates attendee identity on the staff device.
- [x] A staff scan cannot remotely set a cookie on an attendee phone.
- [x] A printed ticket or wallet scan does not pretend to initialize the attendee's browser.
- [ ] Session behavior is verified on current mobile Safari and Chrome.
- [ ] Multiple tabs and rapid ticket switches do not corrupt the active participant.

## 5. Identity evidence and reconciliation

- [x] Valid ticket possession, verified email, authenticated account, and signed claim tokens are
      classified as strong evidence.
- [x] Names, unverified email, browser, device, IP address, order, and nickname are weak signals.
- [x] Weak signals never cause an automatic merge.
- [x] Admins can review possible duplicate people and participants.
- [x] A merge records actor, evidence, reason, time, and original participants.
- [x] A merge changes projections without rewriting original postings.
- [x] A mistaken merge can be reversed.
- [x] A split restores the correct source attribution.
- [ ] Simultaneous claims from different devices do not silently transfer ownership.
- [ ] A verified owner can later inspect and revoke device access.
- [ ] Staff can resolve a lost-ticket case without seeing more personal data than required.

## 6. Score ledger and projection

- [x] Score changes use immutable transaction headers and signed postings.
- [x] No workflow writes a participant total directly.
- [x] Awards create positive postings.
- [x] Penalties create negative postings.
- [x] Transfers create an atomic debit and credit.
- [x] Reversals create exact opposite postings and reference the original transaction.
- [ ] Every transaction records event, activity, source, actor, reason, rule revision, and time.
- [x] Every external command has an idempotency key.
- [x] A repeated command returns the original outcome without another posting.
- [x] A unique constraint prevents duplicate source awards.
- [x] Staff pool consumption and award postings commit in one database transaction.
- [x] Normal transfers cannot exceed the available confirmed balance.
- [x] Rule edits never alter previous transactions.
- [x] A rebuildable projection stores current balance, rank input, and revision.
- [x] Every accepted posting advances the affected projection revision.
- [x] Projection rebuild produces the same result as live updates.
- [x] Corrupt or missing projections can be rebuilt without editing the ledger.
- [x] Transaction times use the server clock and event displays use the configured event timezone.
- [x] Device clock skew cannot change eligibility or ordering.

## 7. Event lifecycle and late actions

- [x] Scoring defaults to `off`.
- [x] Supported states are `off`, `ready`, `live`, `frozen`, and `closed`.
- [x] Scoring state is independent from ticket sales and event publication.
- [x] Scheduled start and end use the event timezone and handle daylight-saving changes.
- [x] Admins can start, freeze, resume, and close scoring manually.
- [x] Freeze keeps public totals fixed.
- [x] Valid results received while frozen are stored as held source receipts.
- [x] Resume can process eligible held results once.
- [x] Close blocks normal awards and claims.
- [x] A late automatic game result after close enters review instead of disappearing.
- [x] Admin correction after close requires reason, confirmation, and re-finalization.
- [x] Cancelling an activity defines whether pending results are rejected, held, or honoured.
- [x] Cancelling an event prevents new claims while preserving audit and attendee history.
- [x] Event reopening behavior is explicit and audited.
- [x] Leaderboard visibility has hidden, preview, public-live, and public-final states.

## 8. Orders, teams, ranks, and prizes

- [x] Individual balance and rank are available.
- [x] The authorized order view can calculate a private aggregate.
- [x] An order aggregate is not a team balance.
- [x] Explicit event teams can be created and managed.
- [x] Team membership has effective times.
- [x] A posting captures team attribution at award time.
- [x] A team move affects future attribution by default.
- [ ] Reattributing old team points requires an audited correction.
- [x] Ties share standard competition rank, such as `1, 2, 2, 4`.
- [x] A deterministic secondary sort does not pretend to break the tie.
- [x] Prize finalization detects unresolved ties.
- [x] A frozen or provisional board cannot be mistaken for final prize results.
- [x] Refund, disqualification, and identity correction effects on final ranking are explicit.

## 9. Staff assignments, roles, and permissions

- [x] Existing `scanner` and `manager` concepts map cleanly into staff assignments.
- [x] Existing `requestGuests`, `addGuests`, and `approveRequests` permissions remain available.
- [x] Presets include door scanner, door manager, game moderator, points marshal, activity manager,
      event manager, and admin.
- [x] Permissions, not role labels, are the source of authority.
- [x] Admins can adjust preset permissions.
- [x] Assignments support personal staff links and shared station devices.
- [x] Every assignment has event, label, scope, expiry, status, and permitted devices.
- [ ] A future logged-in staff person can claim an existing assignment.
- [x] Access links are revocable and expire as configured.
- [x] A leaked or photographed staff link can be revoked without affecting other staff.
- [x] Lost devices can be revoked individually.
- [x] Shared stations record the station and device even when the human actor is unknown.
- [x] Personal links produce a stronger human audit trail.
- [x] Basic staff cannot change their own permissions, scope, or budget.
- [x] High-risk permissions require clear admin warnings.

Required permission boundaries:

- [x] Admit tickets and view recent admissions.
- [ ] Request, add, and approve guests.
- [x] View participant points.
- [x] Award points.
- [x] Run assigned activities.
- [ ] Transfer points.
- [ ] Reverse permitted awards.
- [ ] Review held score actions.
- [ ] Create and manage activities.
- [ ] Create and manage discoveries.
- [ ] Upload activity photographs.
- [ ] Manage staff and point pools.
- [ ] Resolve participant identity.
- [ ] Finalize the leaderboard and prizes.

## 10. Staff point authority and budgets

- [x] Admins can assign a fixed point pool to staff or a station.
- [x] Admins can add to or reclaim unused allocation.
- [x] Staff always see their confirmed remaining pool.
- [x] Two concurrent devices cannot overspend one pool.
- [x] Activities can have independent point pools.
- [x] Automatic game results use system rules and do not spend a moderator's pool.
- [x] Activity-controlled staff select an outcome rather than type a point amount.
- [x] Unmetered authority is explicit, restricted, and online-only.
- [x] Large or unusual awards show a preview and warning.
- [x] Overrides, penalties, reversals, and free-form awards require a note.
- [ ] Unused reservations return to the correct parent pool when an activity closes.
- [x] The admin dashboard distinguishes issued, reserved, spent, held, and available points.

## 11. Scanner and moderator experience

- [x] Existing admission scan and offline-manifest behavior remains intact.
- [x] Door-only staff land on one clear `Scan and admit` action.
- [x] Door-only staff do not see scoring controls.
- [ ] Combined staff see `Admit guests`, `Run an activity`, and `Award points` as separate actions.
- [x] Staff choose the operation before scanning a ticket.
- [x] A scan cannot accidentally perform both an admission and an unrelated award.
- [ ] Quick awards can be pinned as large buttons.
- [x] A physical-game award needs only the winner unless the activity requires more participants.
- [x] Staff can scan the winner's ticket or use event search.
- [ ] Search supports permitted names, aliases, ticket suffixes, recent scans, and recent recipients.
- [ ] Email appears only to authorized managers.
- [x] The award preview shows participant, source, amount, limits, and remaining pool.
- [x] Repeated-award warnings use plain language.
- [ ] Permitted staff can undo their own recent mistake through an immutable reversal.
- [ ] The UI handles camera denial, unreadable QR, dead ticket, duplicate scan, and lost network.
- [x] Normal moderators never see raw tokens, IDs, or permission names.

## 12. Manual and physical activities

- [x] Admins can create a physical activity without game-specific code.
- [x] Templates support winner, placement, participation, completion, team result, audience vote,
      scan-to-award, and free-form staff award.
- [x] A winner-only activity does not require opponent or match entry.
- [x] Activities support fixed awards, limits, time windows, repeat rules, staff scope, and pools.
- [x] Managers can create a safe quick activity during an event.
- [x] Basic moderators cannot invent point values unless explicitly permitted.
- [x] Every award has a structured reason.
- [x] A free-text note is optional for a normal configured outcome.
- [x] A free-text note is required for overrides, debits, reversals, and `Other`.
- [x] An activity can be paused without deleting its history or print material.
- [x] Rematches and repeat winner awards use distinct source IDs.
- [x] A cancelled or abandoned physical result cannot issue automatic points.

## 13. Automatic game scoring

- [x] Games store a server-authoritative result before scoring.
- [x] Games never edit event balances directly.
- [x] A durable source receipt connects the game result to one scoring activity.
- [x] The receipt records the event, game instance, round or match, participants, and result.
- [x] The scoring workflow validates event state, activity state, player links, rule, and limits.
- [x] Raw game scores convert to normalized event points.
- [x] Reprocessing a result cannot duplicate points.
- [x] Failed processing can retry safely.
- [x] A cancelled game result is not scored.
- [x] A corrected game result reverses the prior score before applying the new one.
- [x] Reconnects and repeated finish messages cannot settle a game twice.
- [x] Unclaimed players can receive an event participant placeholder and claim it later.
- [x] Browser-only local results remain untrusted until server or moderator confirmation.

Initial integrations:

- [x] Centre.
- [x] Twin.
- [x] Draw Country.
- [x] Same Brain.
- [x] Spelling Party.

Extended integrations:

- [ ] Liars after outcome rules are defined.
- [ ] Pitches after vote integrity is defined.
- [ ] Server-confirmed Heads Up.
- [ ] Server-confirmed Spelling Bee.
- [ ] Server-authoritative Icebreaker encounters.

## 14. Discoveries and Easter egg hunts

- [x] Admins can create a single discovery or a named discovery set.
- [x] Claim methods include QR, code, word, three-word phrase, and collected clues.
- [x] A normal phone camera can open a discovery URL.
- [x] The ticket or score page includes `Scan a clue` and `Enter a code`.
- [x] A page load or link preview never consumes a claim.
- [x] Claiming requires an explicit server-side POST from an identified attendee session.
- [x] An unidentified browser can open a ticket and return to the pending discovery.
- [x] Claim tokens and phrases are random, unguessable for their value, and stored as hashes.
- [x] Codes normalize case and whitespace without creating ambiguous matches.
- [x] Generated words avoid offensive, easily confused, and unsuitable combinations.
- [x] Incorrect attempts are rate-limited without locking out valid users unfairly.
- [x] One participant cannot claim one discovery twice unless the rule explicitly permits it.
- [x] Collected-clue progress is durable and event-scoped.
- [x] Completion bonuses issue exactly once.
- [x] Discovery eligibility can require check-in, team, ticket type, or time window.
- [x] Status supports draft, scheduled, live, paused, exhausted, ended, and cancelled.
- [x] Static-code sharing risk is stated in the setup UI.
- [x] Higher-value claims can use rotating QRs, short windows, or staff confirmation.
- [x] A leaked clue can be replaced without replacing the whole hunt.
- [x] Physical loss or damage of a clue has a replacement workflow.

Supported point modes:

- [x] Once per participant with no global pool.
- [x] Fixed global point pool.
- [x] First configured number of claimants.
- [x] One total winner.
- [x] Diminishing claimant tiers.
- [x] Points per clue.
- [x] Completion-only award.
- [x] Points per clue plus completion bonus.
- [x] Exact-award exhaustion by default.
- [x] Optional remainder award.
- [x] Concurrent final claims cannot overspend the pool.

## 15. Activity and hunt templates

Built-in templates:

- [x] Hidden QR hunt.
- [x] First finders.
- [x] Collect them all.
- [x] Secret word.
- [x] Three-word phrase.
- [x] Timed QR.
- [x] Completion station.
- [x] Winner award.
- [x] Participation award.
- [x] Staff spot award.
- [x] Check-in bonus.
- [x] Audience choice.
- [x] One-off prize.

Template behavior:

- [x] The normal setup asks only for name, points, limits, availability, and eligible people.
- [x] Advanced settings remain collapsed.
- [x] The setup estimates maximum point issue from expected attendance.
- [x] Unusual totals produce a warning, not an unexplained block.
- [x] Activities and hunts can be duplicated.
- [x] Activities can be copied from another event.
- [ ] A configured activity can be saved as a personal template.
- [x] Template edits do not change existing event configuration.
- [x] Public titles can use any event-appropriate name.
- [ ] An admin can preview the attendee and moderator experiences before publication.

## 16. Print Studio

- [x] Every event has a Print Studio.
- [x] A4 is the default paper size.
- [x] US Letter, A5, and common card layouts are supported.
- [x] Final output is a stable PDF, not only browser print CSS.
- [ ] PDFs use the Milk & Henny design language and suitable embedded fonts.
- [ ] The logo or wordmark, event title, date, and optional subtitle can be included.
- [x] QR reliability takes priority over decoration.
- [x] QRs use a high-contrast field, sufficient quiet area, and safe minimum size.
- [x] Print output remains usable in black and white and without background graphics.
- [x] Instructions do not rely on colour.
- [x] A human-readable fallback code can be included.
- [x] Point values can be shown or hidden.
- [x] Cut guides, page numbers, placement notes, and clue identifiers are configurable.
- [x] Every generated QR is decoded successfully before PDF export.
- [x] Export fails clearly if any QR cannot be validated.
- [ ] A physical test print scans under normal indoor light and from an expected distance.

Required layouts:

- [x] One full-page poster.
- [x] Two signs per page.
- [x] Four cards per page.
- [x] Six cards per page.
- [x] Eight clue cards per page.
- [x] Twelve small cards per page.
- [x] A5 sign.
- [x] Folded table tent.
- [x] Individual replacement clue.

Required packs:

- [x] Complete public hunt pack.
- [x] Setup checklist.
- [x] Instruction poster.
- [x] Private placement list.
- [x] Private answer and control sheet.
- [x] Moderator instructions.
- [x] Leaderboard poster.
- [x] Ticket and score poster.
- [x] Event photo-upload poster.
- [x] Public packs contain no staff or admin credentials.
- [ ] Private activation credentials expire and remain revocable.
- [x] Reprinting preserves a clue token.
- [x] Replacing a clue invalidates its old token after a clear warning.
- [x] A visible, non-secret revision lets staff identify obsolete paper.

## 17. Test mode

- [x] Activities and discoveries can be tested before publication.
- [x] Test claims issue no ledger postings and do not change ranks or pools.
- [ ] Test mode covers valid, duplicate, exhausted, expired, paused, and unidentified states.
- [ ] Ticket recovery and return-to-claim are testable.
- [x] Printed fallback codes are testable.
- [ ] The admin sees how many clues have passed validation.
- [ ] Test and live credentials cannot be confused.
- [ ] Live publication requires a clear preview and confirmation.

## 18. Event photographs and media

- [ ] A quick award can include an optional new or existing photograph.
- [ ] Photo capture requires the correct staff permission.
- [x] Staff can select event-album, admin-evidence, or discard visibility.
- [ ] The event's photo-consent policy is shown at capture time.
- [ ] The workflow can record that consent was requested or obtained where required.
- [x] Photos do not automatically appear on the public leaderboard.
- [x] Photos are not automatic identity evidence.
- [ ] Media links record event, activity, score transaction, participant, staff actor, and time.
- [ ] Staff media uses the existing event drop, transfer, object-storage, and processing pipeline.
- [ ] Public guest-drop disablement does not remove authorized staff upload while the album exists.
- [ ] HEIC conversion, image previews, video processing, and file limits remain enforced.
- [ ] Public derivatives do not expose unnecessary GPS or sensitive metadata.
- [ ] Original-file access follows the existing restricted media policy.
- [x] A failed photo upload never reverses a valid score award.
- [x] Media upload retry never duplicates the award.
- [ ] Orphaned uploads and abandoned pending attachments are cleaned safely.
- [x] Album expiry is clear before capture and in admin.
- [ ] Selected files can be promoted to a durable `/pics` album.
- [x] Deleting a photo does not delete or alter its score transaction.
- [ ] Reports of inappropriate media have an admin removal path.

## 19. Public leaderboard and personal score

Public leaderboard:

- [x] A stable event URL works without login.
- [x] It is read-only and shows rank, public alias, team, points, and event state.
- [x] It can highlight the current attendee without exposing their identity to others.
- [x] It never exposes email, ticket ID, order data, private notes, device data, or fraud signals.
- [ ] Generated aliases, custom aliases, anonymous display, and opt-out follow event policy.
- [x] It uses `noindex` by default.
- [x] Pagination or indexed queries handle the expected event size without polling spikes.
- [x] Frozen, provisional, corrected, and final states are visually distinct.

Personal ticket and score:

- [x] The ticket page shows points, individual rank, and team rank where enabled.
- [x] Authorized order management shows the private order aggregate.
- [x] The full page shows source history, pending actions, held actions, and reversals.
- [x] Every positive or negative change has a safe reason.
- [x] The page shows last successful synchronization.
- [x] Discovery progress, camera scan, and code entry are available.
- [x] A simple ticket switcher supports personal and managed tickets.
- [x] `My events` remains understandable when several events are claimed.

## 20. Navigation and notifications

- [x] Normal site pages show a small ticket or score link for a claimed attendee.
- [x] Event and ticket pages show a fuller score summary.
- [ ] Game setup, lobby, and result screens can show contextual score access.
- [x] Active timed, camera, presenter, controller, and full-screen game views hide it.
- [ ] Opening score details from a safe game screen preserves live room state.
- [x] Positive awards produce a subtle notification.
- [x] Negative changes produce a clear notification with a reason.
- [x] Notifications update the visible score chip.
- [x] Notifications use a polite live region and never move focus.
- [x] Active gameplay queues notifications until a safe screen.
- [x] Reconnect does not replay old notifications as new ones.
- [x] Out-of-order network messages display in confirmed server order.
- [x] The full history remains available when a toast is missed.
- [x] Per-point email is not sent; a later digest remains possible.

## 21. Client synchronization and offline admission

- [x] Every client command has a UUID.
- [x] Every score snapshot has a confirmed revision.
- [x] Clients distinguish pending, accepted, held, and rejected actions.
- [x] Reconnection fetches the latest server snapshot and reconciles command IDs.
- [x] The client never uses last-write-wins balance replacement.
- [ ] Redis wake signals cause a bounded server read.
- [x] Polling callbacks are ref-stable and enforce a hard minimum fetch gap.
- [x] Clients never retry 4xx responses.
- [x] Network and 5xx retries are bounded and jittered.
- [x] Several tabs do not create a poll or command storm.
- [x] Offline status and last sync are visible.
- [x] Existing offline admission manifests remain usable.
- [x] Offline redemption queues exactly once.
- [x] Check-in points issue only after the server accepts redemption.
- [x] Rejected redemption creates no score.
- [x] Two scanners redeeming the same ticket resolve safely.
- [ ] The staff screen shows pending and accepted check-in points separately.

Deferred bounded offline scoring:

- [ ] The server reserves a fixed budget for one device before it goes offline.
- [ ] Offline commands include command ID, local sequence, participant proof, activity, result, and
      device time while eligibility uses server policy.
- [ ] The device cannot exceed its reservation.
- [ ] Reconnection accepts each valid command once.
- [ ] Conflicts enter review instead of disappearing.
- [ ] Unmetered scoring remains unavailable offline.
- [ ] Pending offline photos have a clear local-only warning and retry path.

## 22. QR, NFC, and camera boundaries

- [ ] QR is the standard ticket, participant, station, activity, and discovery method.
- [ ] Public station QRs never contain staff authority.
- [ ] Private staff activation QRs expire and can be revoked.
- [ ] Public QR GET requests are safe and side-effect free.
- [ ] Camera denial has code-entry and link alternatives.
- [ ] Damaged print has a human-readable fallback.
- [ ] High-value static QR claims can require another confirmation.
- [ ] QR tokens have enough entropy and no personal data.
- [ ] Logs and analytics do not record raw capability tokens.

Deferred NFC:

- [ ] A fixed NFC tag opens the same public station URL as its QR.
- [ ] NFC identifies the station, not the person.
- [ ] The attendee session identifies the participant.
- [ ] No core flow depends on phone-to-phone browser NFC.
- [ ] Every NFC station has a QR fallback.

## 23. Invalid activity and abuse controls

- [x] All final score decisions are server-authoritative.
- [ ] Event, activity, ticket, check-in, participant, and staff eligibility is checked server-side.
- [ ] Time windows, point caps, repeat rules, and budgets are enforced under concurrency.
- [ ] Duplicate result, claim, scan, and vote sources are rejected idempotently.
- [ ] Impossible timing and abnormal repetition can be flagged.
- [ ] A copied static QR is handled according to configured risk, not treated as physical proof.
- [ ] Deterministic invalid actions are rejected with a useful reason.
- [ ] Uncertain actions are held for review.
- [ ] Held postings do not affect public totals until accepted.
- [ ] Device and IP data are anomaly signals only.
- [ ] Weak signals never produce an automatic cheating accusation or identity merge.
- [ ] Staff collusion and self-award patterns can be reviewed by actor, device, activity, and time.
- [ ] Staff cannot award themselves where event policy forbids it.
- [ ] Secrets, ticket credentials, emails, and private notes are not written to application logs.

## 24. Audit, privacy, and retention

- [ ] Every score action records system, admin, staff assignment, station, or device actor.
- [ ] Online, offline, automatic, scan, search, and code origins are distinguishable.
- [ ] Overrides and reversals preserve their source chain.
- [ ] Audit search supports participant, actor, activity, source, status, and time.
- [x] Admin export excludes secrets and follows authorization.
- [ ] Destructive or high-impact actions require confirmation.
- [x] Appropriate admin actions require step-up authorization.
- [ ] Public pages use aliases and expose no private identifiers.
- [ ] Scanner search returns the minimum permitted personal data.
- [ ] Identity evidence and private notes are admin-only.
- [x] Retention is defined for ledger, identity evidence, sessions, audit, media, and exports.
- [ ] A privacy deletion request can pseudonymize a person without corrupting financial, admission,
      or score audit records that must remain.
- [x] Export and deletion behavior is documented for attendees and admins.
- [ ] Backup and restore preserve the immutable ledger and participant links.
- [ ] Projections are rebuilt and compared after a restore rehearsal.

## 25. Accessibility and design

- [ ] Buttons perform actions and links perform navigation.
- [ ] Core controls have at least 44-pixel touch targets.
- [ ] All core flows work with keyboard input.
- [ ] Focus is predictable after scan, modal, success, and error states.
- [ ] Status changes use suitable live regions.
- [ ] Errors name the affected action and recovery.
- [ ] Colour is never the only status signal.
- [ ] Public, attendee, staff, admin, and print surfaces follow the design language.
- [ ] Moderator language is short, concrete, and free of internal jargon.
- [x] Active games remain free from score-navigation distraction.
- [x] Print remains legible in black and white and at actual size.
- [ ] Camera, code-entry, and search alternatives cover common access needs.

## 26. Admin control and CLI parity

The admin UI and CLI must use the same feature workflows for:

- [x] Set scoring state and schedule.
- [x] Set leaderboard visibility and finalization.
- [x] Create, copy, update, pause, cancel, and close activities.
- [x] Create, copy, update, rotate, pause, and close discoveries.
- [x] Inspect and change point pools.
- [x] Create, scope, expire, and revoke staff assignments.
- [ ] Admit, undo permitted admission, and inspect redemption state.
- [x] Award, transfer, reverse, and inspect points.
- [x] Review held results and claims.
- [x] Merge and split participants.
- [x] Export score, audit, staff, and discovery data.
- [x] Generate and inspect print-pack data.
- [ ] Enable, disable, and inspect event media drops.
- [x] Rebuild and compare score projections.

## 27. Required focused verification

Unit verification:

- [x] Lifecycle eligibility and timezone boundaries.
- [x] Rule conversion and rule revision snapshots.
- [x] Ranking, ties, and deterministic ordering.
- [ ] Team attribution and movement.
- [x] Pool calculation and exhaustion.
- [x] Discovery code normalization and completion.
- [x] Identity evidence classification and participant resolution.
- [ ] Notification suppression and ordering.
- [x] Client command reconciliation.

Database integration verification:

- [x] Concurrent duplicate game result.
- [x] Concurrent final discovery claim.
- [x] Concurrent staff-pool awards.
- [ ] Atomic transfer and exact reversal.
- [ ] Rule revision preservation.
- [ ] Offline redemption and check-in award exactly once.
- [ ] Simultaneous devices using one ticket.
- [ ] Merge, split, refund, void, and post-score transfer behavior.
- [x] Freeze, late result, resume, close, and correction behavior.
- [x] Public projections exclude private data.
- [x] Projection rebuild matches live totals.
- [ ] Media failure does not affect score transaction.

Browser verification:

- [ ] Ticket opening creates an attendee session on mobile Safari and Chrome.
- [ ] Private and in-app browser warnings and recovery work.
- [ ] Several tickets can be claimed, managed, and switched without merging identity.
- [ ] Several devices can open one ticket without duplicate admission or points.
- [x] Public leaderboard works without login.
- [x] Active game score navigation and notifications are hidden.
- [ ] Automatic result notification appears on a safe screen.
- [x] Role-specific staff UI hides unauthorized controls.
- [x] Quick winner scan and search both work.
- [ ] QR claim, browser-camera claim, and code entry work.
- [ ] Lost attendee session recovery works.
- [ ] Optional photo capture, failure, retry, and visibility work.
- [ ] Offline admission reconciles after several scanners reconnect.

Print verification:

- [x] Every source PDF QR decodes automatically.
- [x] A4, US Letter, A5, card, and table-tent dimensions are correct.
- [x] No layout clips at common printer margins.
- [x] Black-and-white output remains readable.
- [x] Fallback codes match QR destinations.
- [x] Public packs contain no private credentials.
- [x] Replaced clue revisions are identifiable.
- [ ] Representative physical prints scan on iPhone and Android devices.

Operational verification:

- [ ] Metrics cover score writes, rejected commands, held actions, projection lag, pool exhaustion,
      session failure, discovery claims, and media failure without personal data.
- [ ] Alerts exist for repeated write failure, projection drift, and abnormal rejection rate.
- [x] An admin can revoke one staff device during a live event.
- [x] A projection rebuild can run without losing ledger writes.
- [x] A documented event closeout exports results, resolves held work, finalizes the board, and
      releases unused pools.

## 28. End-to-end acceptance scenarios

Ticket and identity:

- [ ] A four-ticket order creates four tickets and four participant places.
- [ ] One phone manages all four without merging them.
- [ ] One child ticket is claimed on another phone.
- [ ] Two phones open the same child ticket and see the same state.
- [ ] One admission succeeds and the repeated scan is handled safely.
- [ ] Names and game aliases change without changing identity.
- [ ] A lost session is recovered from the ticket or verified email.

Door admission:

- [ ] Door staff admit a ticket without becoming the attendee.
- [ ] Offline admission queues and later synchronizes.
- [ ] Check-in points appear once after server acceptance.
- [ ] A refunded, void, duplicate, or wrong-event ticket produces the correct safe response.

Moderator award:

- [ ] An admin creates a moderator assignment and a fixed pool.
- [ ] The moderator selects a pinned winner award.
- [ ] They scan or search for one winner without entering every player.
- [ ] They optionally add a note and photo.
- [ ] The award, pool change, notification, projection, and audit commit correctly.
- [ ] A mistaken award is reversed without editing history.
- [ ] A second device cannot overspend the same pool.

Automatic game:

- [x] An event-linked game stores one official result.
- [x] The configured rule creates event points once.
- [x] Retry and reconnect create no duplicate.
- [ ] An unclaimed player can claim the result later.
- [x] A corrected or cancelled result follows the defined reversal policy.

Discovery hunt:

- [ ] An admin creates a hunt from a template and sees its maximum point issue.
- [ ] A branded A4 pack is generated and every QR validates.
- [ ] A normal camera opens a safe, side-effect-free claim page.
- [ ] An attendee identifies themselves and claims once.
- [ ] Duplicate, expired, paused, shared, and final-pool claims behave correctly.
- [ ] Collected clues produce one completion bonus.
- [ ] Replacing one damaged clue invalidates only that clue.

Event photo:

- [ ] A moderator captures a consented winner photo.
- [ ] The score succeeds independently.
- [ ] The photo enters the selected event-album or evidence scope.
- [ ] Upload failure and retry do not duplicate or remove points.
- [ ] Album expiry, deletion, and permanent promotion behave correctly.

Final leaderboard:

- [ ] The public can open the board without login and see only safe fields.
- [ ] A claimed attendee sees themselves highlighted and can inspect their private history.
- [ ] Frozen, held, corrected, tied, and final states are accurate.
- [ ] The final board matches a fresh ledger projection rebuild.

## 29. Repository completion gate

- [x] Database migrations apply to a clean database.
- [x] Relevant foreign keys, indexes, check constraints, and unique constraints exist.
- [x] Concurrency-sensitive operations use transactions and row or advisory locks as appropriate.
- [x] Production fails closed when required persistence is unavailable.
- [x] In-memory fallbacks remain development or test only.
- [x] Changed behavior has proportionate focused verification.
- [x] Relevant UI and PDFs are rendered and inspected.
- [x] `pnpm typecheck` passes.
- [x] `pnpm lint` passes.
- [x] `pnpm test` passes, with database-backed test execution confirmed rather than silently skipped.
- [x] The final status, staged diff, and commit contain no unrelated changes.
