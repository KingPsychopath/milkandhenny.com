# Twin

A speed-matching card game. Every player holds a hand; one card sits in the middle where everyone
can see it. Your card and the middle card share **exactly one symbol**. Find it, tap it, put your
card down. The goal is to empty your hand.

This document is the specification. `features/things/twin/twin-rules.ts` and
`features/things/twin/twin-deck.ts` implement it as pure data and pure functions and are the single
source of truth at runtime — the setup screen, the engine, the board and the post-game review all
read from them, so what a player is shown cannot drift from what the server enforces.

The game is our own. The underlying mathematics is a finite projective plane and is not anybody's
property, but the name, the symbols and the artwork of the commercial games in this genre are — none
of that appears here.

---

## 1. The design rules everything follows

> **Every heat is the same length for everybody, and speed is measured on the device that saw the
> card.**

The obvious implementation — first tap to reach the server wins — is a game about broadband. A
player on a hotel wifi loses every heat to the person sitting next to them on fibre, and no amount
of polish covers that. So the server publishes an absolute reveal time, every device renders on that
clock, and the number that gets ranked is how long _that player_ took from seeing the card to
touching it. §4 covers what this costs and what it buys.

The second rule:

> **Nobody sits out.**

Classic play is a continuous scramble where one person wins each card and the rest lose the whole
exchange. Round-based play on separate phones makes that worse: with eight players, an average
person wins one heat in eight and spends the rest of the game watching. So **everyone who finds
their match inside the window puts a card down.** Speed still decides who controls the middle, who
extends their chain, and who wins the tie — but finding it at all is always worth something.

Third:

> **Missing is a cost, guessing is a bigger one.**

A phone lets you tap every symbol on the card in half a second. If wrong taps were free, that would
be the dominant strategy and the game would be over. §3.4.

---

## 2. The deck

### 2.1 The mathematics

The deck is a **finite projective plane of order n**. Symbols are points, cards are lines.

| Property                             | Count         |
| ------------------------------------ | ------------- |
| Cards in the deck                    | n² + n + 1    |
| Symbols in the deck                  | n² + n + 1    |
| Symbols on each card                 | n + 1         |
| Cards carrying any given symbol      | n + 1         |
| Symbols shared by any two cards      | **exactly 1** |
| Cards carrying any two given symbols | exactly 1     |

`n` must be a prime power, which is why the ladder below skips 6 — a projective plane of order 6
does not exist, which is Euler's thirty-six officers problem and took until 1901 to settle.

| n   | Cards | Symbols per card | Symbols needed |
| --- | ----- | ---------------- | -------------- |
| 3   | 13    | 4                | 13             |
| 4   | 21    | 5                | 21             |
| 5   | 31    | 6                | 31             |
| 7   | 57    | 8                | 57             |
| 8   | 73    | 9                | 73             |

`twin-deck.ts` generates the plane from `n` — no hand-authored card lists, and a property test
asserts the defining rule over every pair in the generated deck (§12).

**The construction, and the one trap in it.** Points of PG(2,n) are the non-zero triples over GF(n),
normalised so the leading non-zero coordinate is 1. Lines are indexed by the same triples, and a
symbol lies on a card when their dot product is zero. That is the whole generator.

The trap: **GF(n) is only integers mod n when n is prime.** Order 4 is GF(2²) and needs coefficient
arithmetic modulo an irreducible polynomial — `x² + x + 1` over GF(2). The widely-copied
"Dobble algorithm" found online is the mod-n shortcut, works beautifully for 3, 5 and 7, and
silently produces a broken order-4 deck where pairs of cards share two symbols or none. Order 4 is
the duel deck (§9.1), so this is on the critical path, not an edge case. Implement the field
properly, and let the property test tell you.

### 2.2 Deck order is derived, never chosen

**Two identical cards share every symbol, so the match stops being unique and the answer stops being
checkable.** That makes deck size a hard cap rather than a preference: nothing may be dealt twice.

    cards needed = players × hand size + 1

The host picks the **hand size** (4–10, default 6). The engine picks the smallest order whose deck
covers it, and shrinks the hand rather than exceeding the ceiling.

| Players | Hand 6 needs              | Order | Symbols per card |
| ------- | ------------------------- | ----- | ---------------- |
| 2       | 13                        | 4     | 5                |
| 3       | 19                        | 4     | 5                |
| 4       | 25                        | 5     | 6                |
| 5       | 31                        | 5     | 6                |
| 6–9     | 37–55                     | 7     | 8                |
| 10–12   | hand shrinks to 5, then 4 | 7     | 8                |

**Order 7 is the ceiling.** Nine symbols on a phone card is not a harder game, it is a smaller game
— everything shrinks past the point of being readable at arm's length. Above nine players the hand
shrinks instead, which shortens the game, which is the right answer for a room with twelve people in
it anyway.

Order 4 is the floor even for two players, where order 3 would technically fit. Four symbols per
card is solved before the animation finishes.

The current game ships 31 symbols, which supports up to five players at hand 6, or six at hand 5.
Extending to 57 remains drawing work rather than an engine change.

### 2.3 Layout

A card is not a list. The same symbols in the same places would be memorised in three heats, so
each card instance carries a **layout seed** and `twin-layout.ts` derives, deterministically:

- a position for each symbol, from a jittered ring/centre packing that never overlaps
- a rotation, anywhere in 360°
- a scale, between 0.62 and 1.0 of the cell

The same card must look identical on every device that sees it in a heat, so the seed lives in room
state and is dealt with the card. This is what makes the layout function pure and testable, and it
is also what makes a presenter screen possible later.

The seed is per **deal**, not per card id: a card that comes back around in a rematch is laid out
differently.

---

## 3. The heat

One heat is one pairing of the middle card against everyone's top card, run simultaneously on every
phone.

### 3.1 Shape

| Phase      | What it is                                               |
| ---------- | -------------------------------------------------------- |
| `lobby`    | Roster, hand size, join code, QR                         |
| `dealing`  | 2.0s. Hands deal, middle card lands face down            |
| `heat`     | Cards face up and tappable. Ends per §3.3                |
| `settle`   | Result, shed animation, chain state, next card concealed |
| `finished` | Constellation review, awards, rematch                    |

Every timestamp is absolute and server-owned — `revealAt`, `deadlineAt`, `graceEndsAt`, `settleAt`,
`nextHeatAt` — and every device animates against them through the existing `clockOffset` in
`useLiveRoomSnapshot`. No client-side round timers.

### 3.2 What a player sees

The middle card and their own top card, both full width, stacked vertically, with the rest of their
hand peeking under theirs (§5). A ring around the middle card drains as the window runs down. No
scores, no leaderboard, no other players' cards — the heat is a hunt, and anything else on screen is
a reason to look away from the cards.

### 3.2.1 You tap your own card. The middle card is never tappable

In any mode, the tap target is the symbol **on your own card**. The middle card is display only.

Allowing either card is tempting — it is the same symbol, and your eye may land on the middle one
first. It breaks the duel. Two people sharing one screen both hunt the same middle card, and a touch
on it has no owner: the device cannot tell whose finger it was. Every fix for that is worse than the
rule it saves — a seat button before each tap, a claim gesture, a second copy of the middle card per
seat eating the space the cards need.

Tapping your own card makes **attribution pure geometry**: your card is in your half, so a tap in
your half is yours, and one device needs no seating logic at all. It is one rule in every mode
instead of a duel exception, it is the honest physical action — you are playing _your_ card, not
grabbing the pile — and it gives the connection a direction: the ray runs from your card to the
middle card, which is where the card itself is about to go (§8).

### 3.3 When a heat ends

Whichever of these comes first:

| Trigger         | Rule                                                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **First blood** | The moment someone lands it, everyone else has `graceMs` (default 2500) or the rest of the window, whichever is shorter |
| **Window**      | `deadlineAt`, `revealAt + windowMs` (default 8000). The backstop                                                        |
| **All in**      | Every connected player has landed it                                                                                    |

The grace is the interesting one and it is what makes the round-based version feel like a race
rather than a quiz. _"Someone's got it — two and a half seconds"_ is a real pressure and it keeps
tempo high without ever guillotining somebody who is a beat behind.

**A majority threshold was considered and rejected.** It fires at an arbitrary moment unrelated to
anyone's progress, and with six players it ends heats while two people are mid-scan through no fault
of their own. First blood is the same idea with a cause.

`resolvedAt` closes the heat; payouts are computed at `settleAt = resolvedAt + 600ms`. That quiet
beat exists so a tap made in time but delivered late still counts (§4), and it doubles as the pause
the result animation wants anyway.

### 3.4 Wrong taps

A wrong tap costs a **cooldown**, escalating within the heat: **1.5s, then 2.5s, then 4s.** The card
greys and shivers, the remaining cooldown draws as a shrinking bar under it, and taps do nothing
until it clears.

That makes spraying strictly worse than looking — six symbols sprayed at 150ms apart buys you five
seconds of lockout — while one honest mistake costs you the heat but not the game. Wrong taps are
counted and surfaced at the end, gently (§6.2).

Elapsed time is measured to the **correct** tap, so a penalty is already priced into the ranking and
needs no separate arithmetic.

### 3.5 Payout

At `settleAt`, players who landed it are ranked by recorded elapsed, ascending.

| Who                    | Gets                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------ |
| Everyone who landed it | Sheds their top card. Chain +1. Connection recorded                                  |
| **Fastest**            | Their shed card becomes the new middle card                                          |
| Everyone who missed    | Keeps their card. Chain resets to 0                                                  |
| **Nobody landed it**   | Middle card stays; **every player rotates their top card to the back of their hand** |

That last row is the deadlock rule. Without it a pairing nobody can solve repeats forever. Rotating
guarantees a different pairing next heat, keeps every card in play, and quietly gives a card you
could not crack a second chance later against a different middle.

The old middle card is buried — out of play for the rest of the game, exactly as it is when you drop
a card on a pile. Total cards in the game is therefore fixed at `players × hand + 1` and the deck
never needs a reserve.

---

## 4. Fairness, timing and cheating

### 4.1 What gets ranked

The client records `performance.now()` at the first paint of the revealed cards and again at the
correct tap, and submits the difference. Not the server's arrival time.

This is the right trade and it is worth being explicit about why: server-arrival ranking makes
network quality a skill, and network quality is the one thing in this game that nobody in the room
can do anything about. Client timing makes _forgery_ possible instead — and forgery is a thing a
friend does on purpose, which is a social problem with a social fix.

### 4.2 The clamps

Server receives `{ heatId, symbolId, elapsedMs }` at server time `T`:

```
arrival  = T - revealAt
claimed  = clamp(elapsedMs, MIN_REACTION_MS, windowMs)      // 220ms floor
recorded = max(claimed, arrival - LATENCY_ALLOWANCE_MS)     // 900ms allowance
```

- The **floor** rejects prefiring and any claim faster than a human nervous system.
- The **allowance** bounds forgery: you cannot claim better than ~900ms faster than the truth, and
  only then if your connection is already fast. It cannot punish a slow connection, because it only
  ever raises a claim towards reality, never past it.
- An answer arriving after `resolvedAt` still counts if it lands before `settleAt` and its claim is
  inside the window. After `settleAt` it is discarded.

### 4.3 What this does not defend against

A client that holds both cards' symbol lists can compute the intersection in a microsecond and tap
at 250ms every heat. There is no fix: the player has to be shown both cards, so the answer is
necessarily on their device.

Deterrents that are worth their cost — only the two cards in play are sent, never the deck, never
other players' hands — are in. Anything beyond that is not, for the same reason `draw-country`
accepts that you could submit a traced outline. This is a party game on a personal site, and the
enforcement mechanism is that people are in the same room.

---

## 5. The hand

### 5.1 The stack

Your top card is full size. The next two peek behind it, offset upward by 6px each, rotated ∓2.5°,
scaled 0.96 and 0.92, and dimmed — face down during a heat. A count sits beside them: `4 left`.

### 5.2 Future cards stay hidden

The stack never opens during a game. Knowing the next card lets a player pre-scan while the previous
result is still animating, which turns presentation speed into an advantage. The two peeks therefore
remain face down and the result briefly replays only the pairing that was just solved.

The dealing phase provides the physical card beat instead: a small face-down pack shuffles and fans
into place before the first heat, without exposing either player's next answer.

---

## 6. Winning

### 6.1 Emptying your hand is the win

Longest chain is an **award**. This was a real question and the answer is not close.

A game needs exactly one win condition. Two rival wins means every result needs a sentence
explaining which one counted, nobody knows what to play for while playing, and the ending has no
single moment. "I got rid of my cards" is legible to a room full of people who have had a drink;
"my longest unbroken run of connections was seven" is a statistic.

It is also the goal the game already teaches. Every screen is about your hand — the count, the
stack, the shed animation. Making the win a different quantity would mean the whole interface points
at the wrong number.

And chain does not need to be the win to matter, because **chains are what empty hands.** A player
with a long chain is by construction a player who has been shedding. The award recognises the same
excellence without competing for the ending.

Ties, when two players empty on the same heat: fewest misses, then lowest total elapsed, then
longest chain.

### 6.2 Awards

Presented after the winner, as a short list of named cards. Precedent: `LiarsEndingSnapshot.awards`.

| Award                | Given for                                                  |
| -------------------- | ---------------------------------------------------------- |
| **the win**          | Emptied first                                              |
| **longest chain**    | Most consecutive heats landed                              |
| **quickest eye**     | Lowest recorded elapsed on any single heat                 |
| **most connections** | Most heats landed overall                                  |
| **never flinched**   | Landed every heat they were present for                    |
| **the scattergun**   | Most wrong taps. Worded warmly, and suppressed below three |

An award is only shown when it was actually earned — no "0 connections" trophies — and a player who
sweeps several gets them all on one line rather than six separate cards.

---

## 7. The constellation

The post-game review, and the reason the geometry is worth showing off.

### 7.1 What it draws

The game is literally a chain. Middle card c₀ was replaced by c₁, which shares exactly one symbol
with it — the one the winner tapped. c₁ was replaced by c₂ the same way. So the sequence of middle
cards is **a path where every edge is a single symbol**, which is a constellation with a name for
each line.

    spine    c₀ ──◆── c₁ ──✦── c₂ ──❋── c₃ ──✳── c₄
                   │        │ │        │
    ribs           ▢        ▢ ▢        ▢     ← cards other players shed that heat

- **The spine** is the middle-card sequence, drawn as a gentle arc of nodes across the view. Each
  edge carries the symbol that made it and the name of whoever found it first.
- **The ribs** are the cards other players shed on the same heat, hanging off the spine node they
  were played against, joined by the symbol _that_ player found.
- **A player's chain** is a run of consecutive spine positions where they have a rib. The longest
  one lights as a continuous bright path — which is exactly the shape the award names.

### 7.2 How it moves

- Nodes settle in along the spine, staggered, 40ms apart.
- Stepping to an edge expands both its cards side by side and **draws the ray**: a line from the
  symbol on one card to its twin on the other, both symbols scaling up while every other symbol on
  both cards drops to 0.25 opacity. This is the same primitive as the in-heat connection (§8) and
  should be the same component.
- Scrub with a drag along the spine, step with arrows, or let it autoplay at 1.4s a beat.
- A player filter dims every rib that is not theirs and re-runs the spine with only their
  connections lit.

The ray is a stroke-dashoffset trace, matching `country-guide-trace` in `globals.css`. Under
`prefers-reduced-motion` every trace and stagger becomes an instant state change — the diagram is
just as readable static, which is the test of whether the motion was decoration.

### 7.3 Where the data comes from

The heat log — see §10.3, because it must not live in the room snapshot.

---

## 8. The connection, in play

When you land a match: the symbol you tapped and its twin both scale to 1.35 and hold, a line traces
between them in the accent, every other symbol on both cards drops to 0.25 opacity, and your card
lifts and slides down out of frame as it sheds. About 520ms end to end.

This is the payoff moment of the entire game and it should be the single most satisfying thing in
the app. It is also the constellation's ray, run once — build it once as `TwinRay`, take two symbol
positions and two card rects, and use it in both places.

Other players' results arrive at `settleAt` as a quiet ordered list of names and times. Nobody's
result animates on your phone except your own.

---

## 9. The board — one device

### 9.1 Duel

Two people facing each other across a phone or tablet. Each player gets a seat: their own hand at
their own edge, controls rounded into the corners nearest them, **and their entire seat rotated 180°
from the other's** so both read upright from where they are sitting.

    ┌─────────────────────┐
    │   ◗ two   3 left    │  ← rotated 180°
    │  ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁  │
    │        MATCH        │
    │  ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔  │
    │   ◖ one   4 left    │
    └─────────────────────┘

The match is between the two face-up cards. Only your own card is tappable: **a tap is owned by the
half of the screen it lands in.** No seat buttons, no claim gesture, nothing to explain.

Rules change in two ways.

**No grace, no heat, no standings.** There is no network to be fair to and no hidden information:
each player can see the other's hand and see their fingers move. The whole one-device game collapses
to its natural continuous form — first correct tap takes it and the next hunt begins after one short
connection beat. The round structure exists to solve a problem that only appears on separate devices.

**No middle card either.** Your card faces their card; the match is between the two of them. When
you find it you **shed your card** and deal your next. First to empty wins. A dead heat sheds one card
from both hands, so an exact tie always makes equal progress instead of replaying the pairing.

Dropping the middle card here is not a space fix — measured on a 375×812 phone, three cards fit with
no scrolling at 219px each and tap targets from 60 to 118px, all of which clears the 44px floor
comfortably. It is a better _game_ for two people: two cards instead of three means each is half
again as large, and you spend the round staring at your opponent's card rather than at a neutral pile,
which is most of the fun of playing someone across a table.

Shed, do not pass. Passing the won card to the other hand makes progress reverse direction and can
repeat forever; removing it makes the stack and the win condition say the same thing. The mode still
carries a time cap as a backstop. First to empty wins; if the cap runs out, fewest cards wins.

The **middle card stays in solo** (§9.2), where there is no opponent card to face.

Order 4, five symbols a card, hand of 10 — twenty of the 21-card deck. "Fewer icons" was the right
instinct: two people, one screen, cards at half the size.

Wrong taps lock that seat out for 1.5s while the other player keeps hunting, which is a far sharper
penalty than in multiplayer and is the correct one here.

### 9.2 Solo

Same board, one seat, middle card centred. Clear the deck against the clock; best time per deck
order persists to `localStorage` through `useGamePreferences`. A miss costs 3 seconds on the clock,
shown landing on the timer.

Solo uses the duel board and the same deck/layout rules rather than maintaining a second engine.

### 9.3 Screen

`useWakeLock(active)` — already in `hooks/useWakeLock.ts` — is held for `dealing`, `heat` and
`settle`, in every mode. A tablet lying flat with two people staring at it goes to sleep faster than
anywhere else in this codebase, and this is the one game where a dimmed screen ends the round.

`useFullscreen` is offered but not forced, and orientation is left `auto`. The duel board is
symmetric and works either way up.

---

## 10. Architecture

Follows `features/things/draw-country` almost exactly. That module is the closest existing
analogue — simultaneous submissions, a server-owned deadline, a reveal, a rematch that keeps the
roster — and matching it is worth more than any improvement invented on the way.

### 10.1 Files

```
features/things/twin/
  types.ts                    browser-safe snapshot, actions, and results
  twin-deck.ts                pure projective-plane generation and deck sizing
  twin-layout.ts              pure seeded symbol placement
  twin-rules.ts               pure heat resolution, ranking, chains, and awards
  twin-symbols.ts             source-controlled 31-symbol registry
  twin-room-engine.server.ts  authoritative room state machine
  twin-room-service.server.ts Effect service boundary
  twin-room.server.ts         shared Multiplayer runtime facade
  twin-room.functions.ts      TanStack server functions and validation
  TwinRoomApp.tsx             multiplayer phase surface
  TwinDuelApp.tsx             shared one-screen and solo engine
  TwinConstellation.tsx       post-game review
  TwinDevHarness.tsx          development-only scenario harness

server/routes/api/things/twin-ws.ts        createMultiplayerWakeHandler
src/routes/things.twin.tsx                 setup + host
src/routes/things.twin_.$roomId.tsx        player
src/routes/things.twin_.one-screen.tsx     one device, two seats
src/routes/things.twin_.solo.tsx           one device, one seat
src/routes/things.twin_.dev.tsx            development harness
docs/twin.md                               this file
```

Plus: a `THINGS` entry in `features/things/catalog.ts`, a `THING_OFFLINE` entry in
`features/things/offline.ts` (the duel and solo boards work with no network at all), and a
`things-game--<tone>` class if none of the five existing tones fit.

### 10.2 Snapshot

```ts
export interface TwinSnapshot
  extends MultiplayerRoomIdentity, MultiplayerRevision, MultiplayerSequence {
  phase: TwinPhase;
  serverNow: number;
  expiresAt: number;
  gameNumber: number;
  hostPlayerId: string;
  canControl: boolean;
  order: 4 | 5 | 7;
  handSize: number;
  players: TwinPlayerSummary[]; // name, cardsLeft, chain, connections, connected, ready, place
  heat: TwinHeatSnapshot | null;
  player: TwinPrivateState | null;
  ending: TwinEndingSnapshot | null; // populated at `finished` only
}

export interface TwinHeatSnapshot {
  id: string;
  number: number;
  middle: TwinDealtCard; // the promoted card for the next heat
  playedMiddle: TwinDealtCard; // frozen pairing for this heat's result
  revealAt: number;
  deadlineAt: number;
  graceEndsAt: number | null;
  resolvedAt: number | null;
  settleAt: number | null;
  landedCount: number; // a count, never names, while the heat is live
  results: TwinHeatResult[]; // empty until settleAt
}

export interface TwinPrivateState extends MultiplayerReadiness {
  playerId: string;
  top: TwinDealtCard | null;
  /** The rest of your hand. Sent for the stack count and kept face down (§5.2). */
  rest: TwinDealtCard[];
  landedAt: number | null;
  misses: number;
  cooldownUntil: number | null;
  chain: number;
}
```

`landedCount` while a heat is live is deliberate: a bare number is the pressure, a list of names is a
distraction and a tell about who to watch.

### 10.3 Persistence

One key per room, as everywhere else — `things:twin:v1:room:<id>:state` plus `:lock`, written under
`withMultiplayerRoomLock`.

**The heat log lives in its own key**, `…:log`, and this is not optional. Twelve players over fifty
heats is six hundred result records; carried in the room value that is tens of kilobytes re-read by
every player on every 8-second poll for the whole game, which is precisely the shape of
`docs/postmortem-guestlist-kv-read-spike.md`. So:

- The log is **appended to** at each `settleAt` and **never read during play.**
- `TwinSnapshot.ending` is `null` until `finished`, at which point the log is read once and folded
  into the constellation payload.
- The log key carries the room's TTL and dies with it.

Everything else follows the house rules: production fails closed without Redis, the in-memory store
is `createMemoryRoomStore("twin")` and dev-only, never retry 4xx, ref-stable callbacks in the poller.

### 10.4 Actions

```ts
type TwinHostAction =
  | { type: "game.start"; removePlayerIds?: string[] }
  | { type: "game.replay" }
  | { type: "game.lobby" }
  | { type: "game.configure"; handSize?: number; windowMs?: number; graceMs?: number }
  | { type: "heat.next" };
type TwinPlayerAction =
  | { type: "readiness.set"; ready: boolean }
  | { type: "answer.tap"; heatId: string; symbolId: string; elapsedMs: number };
```

`answer.tap` is the whole game. The server owns hands, so it does not take the player's word for
which card they hold; it looks up their top card, intersects, and rules.

Validation in `twin-room.functions.ts` via the existing `multiplayer-validation` helpers, with
`elapsedMs` bounded before it reaches the engine.

---

## 11. Symbols

31 symbols for v1, hand-tuned, mono-line, single-colour, inline SVG in one registry.

Requirements, in priority order:

1. **Distinct in silhouette.** The failure mode is two symbols that resolve alike at 44px under
   rotation — a crescent and a comma, a star and a sparkle. Every pair gets looked at rotated.
2. **Legible at 44px** on the smallest phone the site supports, at 0.62 scale, at any rotation.
3. **No inherent up.** Symbols are rotated freely and must not look broken upside down, which rules
   out letters, digits and anything with text in it.
4. **Warm-stone native.** Single stroke weight, `currentColor`, no fills, no hardcoded hex —
   `theme-*` tokens only, per `docs/design-language.md`.
5. **Nameable in one word**, for the constellation's edge labels and for screen readers.

Anything drawn from an existing MIT/ISC set gets a `CREDITS.md` in the module, following
`features/things/draw-country/CREDITS.md`.

Symbols are structured as a **deck** from the start — `twin-symbols.ts` exports a registry keyed by
set id — because `heads-up` and `spelling` both already have a deck concept and an alternate set is
the obvious first thing anyone will ask for.

---

## 12. Testing

Per `.cursor/rules/testing.mdc`, the pure modules carry the weight.

| Test                      | Asserts                                                                                                                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `twin-deck.test.ts`       | **Property test**: for every order in {3,4,5,7}, every pair of cards in the generated deck shares exactly one symbol. Card count, symbol count, symbols per card, symbol frequency all match n²+n+1 / n+1 |
| `twin-deck.test.ts`       | Deck sizing never deals a duplicate for any player count 2–12 at any hand size 4–10; order and hand fall out as the table in §2.2                                                                         |
| `twin-layout.test.ts`     | Same seed → identical layout. Different seeds → different. No two symbols overlap. Everything stays inside the card                                                                                       |
| `twin-rules.test.ts`      | Ranking by recorded elapsed. The three end conditions and their precedence. Grace never extends past the deadline. The clamps in §4.2, including that the allowance can only raise a claim                |
| `twin-rules.test.ts`      | Payout: every lander sheds, fastest takes the middle, nobody lands → everyone rotates. Chains extend and reset. Awards are only issued when earned                                                        |
| `twin-rules.test.ts`      | Ties on emptying resolve by misses → elapsed → chain                                                                                                                                                      |
| `twin-engine` integration | A full game over a fake clock: deal, heats, disconnect mid-heat, rematch keeps the roster and re-deals                                                                                                    |

The deck property test is the one that matters. Every other rule in this document is downstream of
"any two cards share exactly one symbol", and if that ever fails the game does not degrade, it
becomes unplayable in a way that looks like a UI bug.

---

## 13. Open, deliberately

- **A presenter screen.** `liars` and `spelling-party` both have one, and a TV showing the middle
  card with the heat's constellation growing live would be the best-looking thing on the site. It is
  not v1 because the middle card is already on everyone's phone and a big screen adds nothing to
  play — only to watching.
- **Sound.** `useGameSound` exists. The connection wants a sound and the cooldown wants a different
  one, and both should be chosen against the real animation rather than specified here.
- **Difficulty inside an order.** Tightening the scale range and widening rotation makes a card
  meaningfully harder without changing the deck. A "hard" toggle is one number, once the board
  exists and can be judged.
