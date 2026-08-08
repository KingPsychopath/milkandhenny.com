# Liars

Two social deduction games sharing one room: **mafia** and **imposter**. The mode is chosen once, at
room creation, and never changes for the life of that game.

This document is the specification. `features/things/liars/liars-rules.ts` implements it as pure
data and pure functions, and is the single source of truth at runtime — the setup screen, the rules
sheet, the deal, and the engine all read from it, so the rules a player is shown cannot drift from
the rules the server enforces.

---

## 1. The design rule everything follows

> **Every role gets an identically-shaped event at every beat. Only the contents differ.**

Nothing about a player's screen, timing, animation, brightness, or haptics may reveal what role they
hold. Same envelope, same duration, same luminance, same vibration — different words inside.

This is not a polish concern. It is the game. A detective whose screen lights up differently at
night has no protection at all, and a build that gets this wrong is not worth shipping.

The second rule, downstream of it:

> **Remove the logistics. Leave the arguing.**

Nobody should be counting votes, tracking whose turn it is, remembering who is dead, working out how
long is left, or asking what a role does. The phone does all of it. People are here to shout at each
other.

---

## 2. Shared: rooms and lobby

Both modes use the same room infrastructure as the other multiplayer things — a seven-character room
code, QR invite, one Redis key per room, a 90 minute TTL, and rematch that keeps the roster.

**5–16 players** for mafia. **4–16** for imposter.

### The role board

From the moment the room opens, **every device shows the full lineup**, live, while the host is
still deciding. Composition is public information in both games — you cannot deduce anything without
knowing what is possible.

The board shows:

- Every role in play with its count, grouped by side, hostile side first
- **Tap any role to expand its full rules.** This is the rules sheet, anchored to the actual lineup
  rather than a generic list
- A totals line: `3 mafia · 8 town · 1 jester · 12 players`
- The derived number people actually want: **`the town can afford 4 wrong votes`**
- A quiet log line on every change — *"host added the Escort"* — so nobody misses an edit while
  looking down at their phone

At the deal the board **freezes and moves into the header**, available for the rest of the game.
Mid-game you constantly need to check whether there is a bodyguard in this one, and having to ask out
loud is itself a tell.

### Deal

25 seconds. One card, **hold to reveal**, so nobody catches it over your shoulder. Shows your role,
what you do, and your win condition. Mafia see each other here. Every other role sees only itself.
A *read my role again* affordance stays in the header all game.

---

## 3. Mafia

### Objective

| Side | Wins when |
|---|---|
| **Town** | every mafia-side player is dead |
| **Mafia** | mafia-side players equal or outnumber the town |
| **Jester** | they are voted out (not killed at night) |

Checked at dawn and again at verdict.

### Roles

#### Mafia side

| Role | Night action | Rules |
|---|---|---|
| **Mafia** | kill one, or **stay in** | Staying in produces no death and no movement — nothing for watchers to see. A real strategic option. |
| | | *The mafia see each other's picks **live**, including whether each has locked. Coordinating is the fun of the role, and the caller needs to see a disagreement before overruling it. Everyone who picked somebody still counts as having left the house, so being overruled does not hide you.* |
| **Godfather** | kills; reads **innocent** to the detective | From 7 players. Makes the final call when mafia disagree on a target. Without this the detective solves the game on night two. |
| | | *Once the godfather is dead, the call passes by **seniority** — longest-surviving mafia, ties broken by join order. Deterministic, so a disagreement can never stall the night.* |
| **Jammer** | cancels one player's night action | From 12 players. The blocked player **still registers as moved** — they went out and were turned away — and is told their night was interrupted. |

#### Town side

| Role | Night action | Rules |
|---|---|---|
| **Doctor** | save one, **including themselves** | Cannot protect the same person two nights running, self included. A save cancels the attack outright. |
| **Detective** | investigate one | Returns guilty / innocent on *apparent* alignment, so the Godfather reads innocent. |
| **Lookout** | watch one | Learns the **names** of everyone who visited them. From 7 players. |
| **Bodyguard** | guard one | Dies in their place. From 9 players. Someone still dies, so the night is never a no-op. |
| **Escort** | spend the night with one | See below. From 11 players. |
| **Vigilante** | one kill, once per game | From 14 players. Killing a townsperson means the vigilante dies of guilt the following night. |
| **Villager** | **watch** one | The core mechanic. See section 3.3. Never fewer than 2 in any lineup. |

#### Third party

| Role | Action | Wins |
|---|---|---|
| **Jester** | watches, exactly like a villager | Alone, if voted out. Ends the game outright. |

#### The Escort in full

| | |
|---|---|
| Action | Choose one player. You spend the night at their house. |
| If they are attacked | You see the **attacker's name**, in the T−10s night report. |
| If the attack succeeds | You die with them — but **your witness report publishes at dawn as your dying testimony.** |
| If the doctor saves them | You both live and you keep the name privately. |
| Your own house | Empty. A kill aimed at you misses; you were not home. |

The dying testimony is the point: the mafia's cleanest night can hand the town the killer's name, so
every kill has to be weighed against the chance that someone is in the room. It slows the mafia
down, and the mafia are the stronger side.

You move when you visit, so watchers can see you.

Distinct from the Lookout: Lookout is broad and safe (all visitors, no attacker identity), Escort is
narrow and lethal (attacker identity, might die for it).

### 3.3 Watch

Villagers watch. **Watching reveals movement, not identity.**

If a player took a night action targeting someone else, they **moved**. **You stay up watching their
door** — you never leave your own street, which is why watching is not itself a visit. Everyone who
acts moves: mafia (unless they stay in), doctor, detective, vigilante, bodyguard, escort, lookout,
jammer.

Movement is **only ever visible locally, never globally.** There is no table of who moved. A watcher
learns one bit about the one person they chose. The mafia therefore never harvest "here are the
plain villagers" unless a mafia member spends a night watching instead of killing, which costs them
the kill — a real trade, and a fair one.

So a player who lights up did *something* — could be the killer, could be your own doctor. That
ambiguity is the mechanic, and it puts a genuine cost on the town's power roles for using their
powers.

Two rules:

1. **One watcher — private, true, unprovable.** Your device tells you they moved. You have no public
   record. To use it you have to claim it, the mafia will call you a liar, and claiming paints you as
   a watcher.
2. **Two or more watchers on the same person — public at dawn.** *"Maya was seen moving last
   night."* Nobody learns who watched.

**The public announcement fires only on movement.** Two watchers on someone who moved produces the
announcement; two watchers on someone who stayed in produces silence. Announcing stillness would
publicly clear the plain villagers every night, which is a gift to the mafia.

The corroboration threshold is what stops watch breaking the game. One-eye-reveals would let five
villagers blanket a nine-player table and solve it by night two.

**If you watched the person who died,** the town publicly learns *how many* people witnessed the
killing — *"three people saw it happen."* Anonymous. The mafia now know three players are dangerous
and have no idea which.

Nobody ever learns who watched whom until the end screen, which dumps the full night-by-night log.

### 3.4 Night resolution order

Fixed, and it matters once ten roles interact:

1. **Jammer** — target's action cancelled; they still register as moved
2. **Bodyguard** assignments bind
3. **Mafia kill** — a doctor save cancels the attack entirely, so the bodyguard survives too;
   otherwise the bodyguard dies in the target's place
4. **Vigilante kill** — same protection rules
5. **Detective** reads apparent alignment
6. **Lookout** report compiled
7. **Watch / movement** tally, then the dawn narration

### 3.5 The round

| Phase | Length | |
|---|---|---|
| Dusk | 2.5s | Identical on every device |
| **Night** | 45s | +15s per player above 10 |
| Night report | at T−10s | Same envelope on every device |
| Dawn | 2.5s | |
| **Reveal** | 15s, or 18s with a revive or substitution | |
| **Deliberation** | 60s | Host `+30s` or skip |
| **Vote** | 30s | |
| **Verdict** | 15s | |

**~3 minutes a round.** Night scales with player count because eleven people picking targets in 45
seconds is a scramble. Nothing else scales — deliberation is a conversation, and 60 seconds is 60
seconds whether there are six of you or fourteen.

#### What everyone does at night

Same screen, same countdown, same haptics on select. Only the label differs.

| Role | Chooses | Learns at T−10s |
|---|---|---|
| Mafia / Godfather | who to kill, or stay in | the target is locked |
| Jammer | who to block | who you blocked |
| Doctor | who to save (self allowed) | your protection is set |
| Detective | who to investigate | **guilty / innocent** |
| Lookout | who to watch | **every name that visited them** |
| Bodyguard | who to guard | your guard holds |
| Escort | who to spend the night with | **the attacker's name**, if anything happened |
| Vigilante | who to shoot, or hold | the shot is loaded |
| Villager, Jester | who to watch | whether they **moved**, and whether anyone corroborates |

Selection is free and invisible until the phase ends — changing your mind publishes nothing, so
there is no "he changed his mind" tell. The counter shows `6 of 8 have acted` and **never a name**,
because "waiting for 1 player" fingers whoever is still deciding.

**Everyone must lock, but *stay in* is a valid lock** — the same option the mafia get. The counter
counts locks, not targets, so choosing to do nothing is a real choice and never a tell.

**Selections persist server-side the moment they are tapped**, not on lock. A player who drops has
their last selection used. This is fairer, and it closes a leak: if a dropped mafia defaulted to
*stay in*, "nobody died on the night Maya was offline" would quietly point at Maya.

**An early full lock jumps to the night report, never past it.** The report always fires.

**Every role gets a card every night, even when nothing happened** — a vigilante who held gets
`—` · *you held*. An empty card beside a full one is a tell.

**The night report card is fixed-duration and cannot be dismissed.** So is the deal card. The
mafia's deal card carries teammates and takes longer to read; if cards were dismissible, whoever
tapped through fastest would be advertising how little they had to read.

#### Targeting rules

**Only the doctor may target themselves.** Detective, lookout, bodyguard, escort and watchers are
all blocked from self-targeting. **Mafia cannot target mafia**, and the jammer cannot block their own
team — teammates are simply absent from those target lists. Dead players cannot be targeted, pointed
at, or voted for.

#### What everyone does in the day

The day is **completely symmetric**. No role has a day power. All asymmetry lives at night, so
daytime behaviour is pure social read.

- **Deliberation** — talk. On screen you can **point** at someone: public, live, non-binding,
  changes nothing. That is the accusation theatre, the bandwagon, the pile-on.
- **Vote** — secret and simultaneous, all revealed at once at verdict. Running public tallies make
  late voters follow the leader; making everyone commit blind means the reveal is a real beat and the
  pointing phase actually mattered.
- **Ejection is by plurality.** Most votes goes; a tie ejects nobody — *"the town couldn't agree."*
  Not majority-of-living: forced abstentions from dropped phones would push ejections out of reach
  and deadlock the town into losing by attrition. Plurality has no denominator, so absent players
  simply do not contribute and nothing breaks.
- Abstain is a valid vote.

**Deliberation ends early when a majority of connected living players tap *ready to vote*.** This is
deliberately not a host button — the host is a player, and a mafia host with a skip button would cut
discussion short the moment it turned against them. Because the deliberation timer fires regardless,
the early end can never deadlock; worst case the table talks for the full sixty seconds.

### 3.6 The dawn sequence

Server sets absolute timestamps for every step, so all phones animate against the same clock instead
of each starting from whenever its poll landed.

| t | |
|---|---|
| 0.0s | Dawn transition completes. Every device on the same screen. |
| 0.5s | Narration starts — *"It was a beautiful morning in…"* |
| **3.0s** | **The name lands.** Card goes red, roster row strikes through, `✕` appears. **Victim's phone:** white blowout, snap to black, red breathing bleed, long vibration. **Everyone else:** their roster row goes red, short vibration. |
| 3.0–6.0s | **The hold.** Three full seconds of dead. No narration, no motion. |
| **6.0s** | **If saved:** one soft chime. Red drains upward, green rises from the bottom, the strikethrough lifts, `✚` lands beside the name. **Their phone:** red fades to green, warm pulse, gentle triple vibration. |
| 7.5s | Narration resumes — *"…but the doctor got there first."* |
| 10.0s | Roster settles |
| 15.0s | Deliberation opens |

The three-second hold is the whole trick. Shorter reads as a rendering glitch; longer and people talk
over it.

**Bodyguard substitution** runs the same shape with a second stage: the target dies, holds, then
instead of reviving, the bodyguard's card goes red. *"Maya died. No — Daniel stepped in front of
her."*

### 3.7 Default lineups

| Players | Mafia side | Town | Villagers | Third |
|---|---|---|---|---|
| **5** | mafia | doctor, detective | 2 | — |
| **6** | mafia | doctor, detective | 3 | — |
| **7** | godfather, mafia | doctor, detective | 3 | — |
| **8** | godfather, mafia | doctor, detective, lookout | 3 | — |
| **9** | godfather, mafia | doctor, detective, lookout | 3 | jester |
| **10** | godfather, mafia ×2 | doctor, detective, lookout | 3 | jester |
| **11** | godfather, mafia ×2 | + bodyguard | 3 | jester |
| **12** | godfather, mafia, **jammer** | doctor, detective, lookout, bodyguard | 4 | jester |
| **13** | godfather, mafia ×2, jammer | doctor, detective, lookout, bodyguard | 4 | jester |
| **14** | godfather, mafia ×2, jammer | + escort | 4 | jester |
| **15** | godfather, mafia ×2, jammer | 5 specials | 5 | jester |
| **16** | godfather, mafia ×2, jammer | + vigilante | 5 | jester |

Mafia side sits at roughly **one in four**, the ratio that produces 3–5 round games. Villagers stay
numerous on purpose: watch needs bodies, and a table where nearly everyone holds a power role stops
being a deduction game and becomes a round of role claims.

These are written out as a table in `liars-rules.ts` rather than derived, because the arithmetic
that produced them was wrong twice and a table cannot drift.

**Balance rule:** specials are soft-capped at `⌈players ÷ 2⌉ + 1` and hard-capped at 9. The
recommended lineups above never trip the warning; a host adding roles on top of them can.

### 3.8 Game length

Set by arithmetic, and tighter than people expect. Nine players, two mafia:

- Town votes perfectly: **3 rounds**
- Town votes badly: **2 rounds**
- Realistic: **3–5, with 4 the common case**

At ~3 minutes a round, a nine-player game runs **12–15 minutes** lobby to win screen. The 90-minute
room TTL fits four or five games with rematches.

---

## 4. Imposter

The word game. Everyone gets the same secret word; the imposter gets nothing and has to bluff
convincingly enough to survive the vote.

### Objective

| Side | Wins when |
|---|---|
| **Crew** | **every** imposter has been ejected, and the last one failed the final guess |
| **Imposter** | they survive two ejections, reach the final three, or the last ejected imposter names the word |

With two imposters, ejecting one does not end the game — the crew must find both. **The final guess
is offered only when the *last* imposter is ejected**, so an unlucky imposter caught on the first
vote cannot steal a game the crew were nowhere near losing.

### Roles

| Role | Knows | Wins with |
|---|---|---|
| **Crew** | the word | crew |
| **Understudy** | a *close but wrong* word — and does not know it is wrong | crew |
| **Imposter** | nothing | imposter |
| **Mole** | the word **and** who the imposter is | imposter |

The **Understudy** gives confident wrong clues and looks exactly like an imposter. It is the best
addition to the game, and publishing the lineup is what makes it work — knowing an understudy exists
turns a strange clue into genuine ambiguity rather than noise. Same for the **Mole**: knowing one
exists means a crew member giving perfect clues might still be playing the other side.

Two imposters know each other by default. Blind mode is a toggle.

### The clue round

**Turn-based and spoken. Nothing is typed and nothing is timed.**

- Turn order re-randomises every round; the full order is shown on every device so people can see
  who is coming
- Every phone shows whose turn it is in large type
- On that person's phone: *say your word out loud*, and one button — **said it →**
- They speak, they tap, it advances
- After the last player the round ends and deliberation opens

No transcript, and therefore no repeat-checking. If someone repeats a word the table shouts at them,
which is how it works at a table. The phone's only job is tracking whose turn it is so nobody has to
ask.

Failsafe only, never shown as a timer: auto-advance after 60s so a locked phone cannot stall the
room, and the host can advance at any point.

**One clue round before each vote.** Two before the first vote at 7 players or fewer, where a single
word each is not enough to go on.

Clue constraints are social, not enforced: one word, do not say the word itself, do not repeat
someone else's.

### The round

| Phase | Length | |
|---|---|---|
| Deal | 25s | |
| **Clue round** | self-paced | ~90s at nine players |
| **Deliberation** | 90s | Longer than mafia — discussion *is* the game here |
| **Vote** | 30s | Secret, simultaneous, same as mafia |
| **Verdict** | 15s | |
| **Final guess** | 30s | Only if an imposter was ejected |

### The final guess

An imposter who is voted out gets 30 seconds and **one shot** to name the word. Getting it right
takes the whole game back from the jaws of a correct lynch. This is what makes the vote tense rather
than a formality.

This is the one place typing is unavoidable, and it is worth it.

### Default lineups

| Players | Imposters | Crew | Extras |
|---|---|---|---|
| **4–6** | 1 | 3–5 | — |
| **7–9** | 1 | 5–7 | understudy |
| **10–11** | 2 | 7–8 | understudy |
| **12–15** | 2 | 8–11 | understudy, mole |
| **16** | 3 | 11 | understudy, mole |

### Game length

**2–3 votes, 8–12 minutes**, then a rematch with a new word and a new imposter. The rematch loop *is*
the game — that is how the genre plays, and it maps onto the rematch machinery the other room games
already use.

---

## 5. Shared systems

### 5.1 Alive and dead

State is carried three ways at once, and never by colour alone.

- **Dead players never leave the list.** In place, ~35% opacity, struck through, `✕` in the status
  column. Removing them makes people lose their map of the table.
- Once two or more are gone they **sink below a hairline** under a mono `gone` label. Alive above,
  dead below, one glance.
- **The header always carries the count** — `7 alive · 3 gone`. Nobody should ever count rows.
- **Your own death is the whole screen, not a badge.** Everything drops to low-contrast grey with a
  persistent line at the top: `you are dead · you can watch, you cannot vote`.
- Dead players keep a full spectator view and see everything at the end. No vote, no night action.

Red and green is the worst pairing for the ~8% of men with deuteranopia, so **colour never carries
meaning on its own** — the glyphs and the strikethrough do, and colour reinforces.

### 5.2 Status glyphs

Beside each name, mono, right-aligned. Tap a name to expand that player's public history.

| Glyph | Meaning |
|---|---|
| `✕` | dead |
| `✚` | saved — superscript count when more than once |
| `→` | moved (publicly confirmed by two or more watchers) |
| `◐` | watched — superscript eye count |
| `◎` | investigated by you |
| `!` | pointed at this round |

The **server** computes a per-viewer public history. The client is never sent data it then has to be
trusted to hide.

### 5.3 The night transition

Every device runs the identical transition — same duration, same luminance curve, same animation —
regardless of role.

- **Dusk, 5s:** cream washes down to `--things-night`, a thin amber horizon line descends and goes
  out. **Dawn, 2.5s:** reverse, the line rises and warms.
- **Nothing role-specific is on screen during dusk.** Every device shows the same words — *"Night
  falls. Turn your screen away from the person next to you."* — so a phone lying face up on the
  table gives nothing away, and there is a real moment to move it. Five seconds rather than two and
  a half: the first was a transition, this is a warning.
- Role content appears only *after* the transition completes, in an identically sized card in the
  same screen position.
- **The whole night runs at low luminance.** Every screen equally dark; role text is low-contrast
  amber on night — readable at arm's length, unreadable from across a room.
- The T−10s night report uses one shared envelope animation. Detective, doctor, watcher, escort,
  mafia: same flash, same size, same beat. Only the words differ.

### 5.4 Effects

Fired from snapshot transitions, never from direct commands, with the fired id held in a ref so a
re-poll cannot double-fire.

- Death: white blowout, snap to black, slow red breathing bleed, long vibration
- Revive: chime, red drains up, green rises, warm pulse, gentle triple vibration
- Heartbeat accelerating through the last 10 seconds of night
- Bell toll on ejection, whisper on nightfall
- Wake lock held on every play surface

**A sustained full-screen red/white strobe at ~8Hz sits squarely in the photosensitive seizure
band,** and this is a game handed to a room full of people. Death lands through contrast, scale and
sound rather than frequency, with a `prefers-reduced-motion` path that drops to a single slow wash.

### 5.5 Narration

Server-side bank of ~120 templates split by outcome (`killed`, `saved`, `nobody-died`,
`ejected-guilty`, `ejected-innocent`), with `{victim}` / `{ejected}` / `{survivor}` slots. **The
server picks the template**, deterministically, so every device tells the same story and a re-read
does not reshuffle it.

One device speaks it — the presenter screen if attached, otherwise a stable elected player
recomputed each dawn from connected and unmuted devices. Eight phones speaking a beat apart is the
echo problem the party game already documents. Any device can take over with a *read it out* button.

### 5.6 Two new theme tokens

`--liars-dead` and `--liars-alive`, light and dark, in `src/styles/globals.css`. Consistent with
draw-country owning `--things-country-outside` / `--things-country-inside` rather than inlining hex.

### 5.7 The night report card

One card, at T−10s. Same size, same position, same animation, same beat on every device. Inside it,
always the same two lines: **a name, and one line about them.**

| Role | Card |
|---|---|
| Detective | `MAYA` · *guilty* |
| Escort | `DANIEL` · *it was Maya* |
| Lookout | `MAYA` · *Daniel and Priya came to her door* |
| Watcher | `MAYA` · *she went out* / *her door didn't open* |
| Doctor | `MAYA` · *you're watching over her* |
| Bodyguard | `MAYA` · *you're at her door* |
| Vigilante | `—` · *you held* |
| Mafia | `MAYA` · *it's done* |

The reveal has a beat in it — the name lands, a pause, then the line, arriving with **a single amber
pulse on the glyph** (`→` went out, `·` stillness). One pulse, identical on every card regardless of
what it says. The pause is the same length for everyone, which is what makes the cards
indistinguishable from across a room.

### 5.8 Where information lives

Three places, deliberately separate. This is what decides whether the game stays simple.

**The roster row shows only what is true right now.** This round's public facts and nothing else:
alive/dead, `→` seen moving, `!` pointed at, `✚` saved at this dawn. They clear when the day ends.
Accumulating glyphs would turn the roster into confetti by round four.

**Tap a name for that player's full public history**, by round:

```
night 1   seen moving
night 2   attacked · saved
day 2     4 votes
```

**A "what you know" list in the header — your private record.** The server accumulates everything
your role has learned, across the whole game, with no typing:

```
night 1   MAYA      she went out
night 2   DANIEL    innocent
night 3   PRIYA     her door didn't open
```

Without it, people spend night four trying to recall who they investigated on night one and getting
it wrong. It is also what feeds last words, and what makes reconnecting instant — a returning player
needs no recap read out loud, which means reconnection tells the table nothing about them.

Every role's list is populated, including the mafia's (*"night 1 · MAYA · it's done"*), so the list
itself is never a tell.

### 5.9 The dead

Mafia only — in imposter, ejection effectively ends the game.

**1. Last words.** On death you get 30 seconds to type **one line, 80 characters**. It publishes to
everyone 30 seconds into deliberation, so the table is already arguing when the dead person's voice
cuts in.

Last words are about **what you knew in life, not who killed you** — the dead never learn their
killer (unless they were the escort, who saw them). That makes it a role payoff rather than a free
reveal: the detective who died on night two now matters. You may lie, and lynched players get it
too, so the channel is not pure town-truth.

**Sequencing constraint:** last words must close *before* any spectator view unlocks. Otherwise the
dead player reads the full state and publishes the killer's name.

**2. Spectating.** During play the dead see the public board, the narration, the votes, and their own
history — **no roles and no night actions.** Full god view opens at game end.

This is deliberate. Live god view means people in one room cannot keep a straight face, and it would
make the graveyard vote a guaranteed-correct ballot. `liveGodView` exists as a toggle for groups who
want pure spectacle; the engine disables the graveyard vote when it is on, because the two are
incompatible.

**3. The graveyard.** The caucus opens **the moment you die**. You tap a name, you watch the dead
tally shift live as others arrive and change their minds. It just does not *count* yet, and the UI
says so: `the graveyard votes when 5 are gone · 3 so far`.

**Once half the table is dead, the graveyard's plurality becomes one additional ballot** in each
remaining day's lynch. A tie means the graveyard abstains.

The trigger is what makes it work. It fires late, when only one or two days remain and the mafia are
usually ahead, so it is an endgame comeback rather than a permanent second town. Nine players, half
dead, means five dead and four alive with the mafia probably two of them — it fires for one round,
maybe two. And the last two rounds of a mafia game, normally four people talking while eight watch,
become eight people arguing about their one shot.

### 5.10 Disconnection

> **No phase ever blocks on a player.** Every phase has a hard timer that fires regardless. Locking
> early is only ever an optimisation, never a requirement.

That one constraint means no number of dropped phones can stall the room.

- **Connected window: 25s.** Shown as a quiet hollow dot on the roster — never a banner, never
  announced. People need to know not to wait for someone; they do not need it dramatised.
- **Night:** the last persisted selection is used (§3.5). Only someone who selected nothing stays in.
- **Votes:** a dropped player abstains. Plurality means this changes nothing structurally, and
  **dropped players remain votable** — excluding them would make dropping a shield.
- **Never auto-removed.** Removal would reveal their role under `revealRoleOnDeath`.
- **Reconnection** restores the same player id, role and seat from stored credentials, then shows a
  **catch-up card** built from the public history that already exists:

  ```
  you missed
  night 2   Maya died
  day 2     Daniel ejected · villager
  ```

- **Host migration:** after 60s of host disconnection, any living player can claim host.
- **Whole-room drop:** phases advance lazily on read, so a room nobody has read for ten minutes
  would otherwise fast-forward through several rounds of nobody acting. **The room pauses when
  nobody is connected** and resumes from where it paused on the first read back.
- **A permanent leaver** — someone actually leaving rather than dropping — is killed off with
  neutral narration (*"Priya left town"*), and the engine **re-checks win conditions immediately**,
  because removing one person can end the game on the spot.

### 5.11 Room mode

Set at creation, because a group in one room and a group on a call want different games.

| | Same room | Remote |
|---|---|---|
| Narration | presenter screen, or one elected phone | every device |
| Sound effects | one device only, or it is cacophony | every device |
| Deliberation | 60s | **90s** |
| Dead cannot speak | enforceable socially | a reminder to mute |

Deliberation length is the one that actually matters: sixty seconds is a real conversation in a room
and barely two exchanges on a laggy call.

### 5.12 The end screen

Where the whole game pays off, and the payoff for the dead who have been watching in silence.

- Who won, and **every role revealed**
- **The full night log** — each night and day in order, what actually happened
- Awards, from data already collected: most-voted-for, best read from the grave, the doctor's save
  count, whoever pointed at the mafia earliest and was ignored
- Rematch, keeping the roster

**Rematch weights the deal against your previous role**, so nobody draws mafia three times running.
A rematch returns to the lobby, so latecomers can join there.

### 5.13 The dev harness

`/things/liars/dev`, development builds only.

A game whose entire design is about what each player can and cannot see is close to untestable from
one device, and five phones and a stopwatch makes a two-minute change a twenty-minute loop. The
harness opens a real room, joins a table, and mounts the **real player surface** once per seat, side
by side in phone-sized frames.

Every panel is the same `LiarsRoom` component a phone gets, with its own poll loop, its own wake
socket and its own redacted snapshot. The harness has no privileged access and does nothing a
player could not do — which is the point. **If a leak shows up on that screen, it is a real leak.**

A "short phases" switch drops the timings to the validator's floor, keeping the night long enough
ahead of the T−10s report for a whole table to act.

**Preset scenarios.** `liars-scenarios.ts` names eighteen starting positions — the bodyguard
substitution, the escort walking into the kill, two blind imposters, the jester ejection, sixteen
players with every role at once — each opening straight into a dealt game rather than an empty
lobby. A few pin the deal exactly, so "the doctor is the mafia's target" is a starting position
rather than something you wait for.

The same list is walked by the integration tests, so a preset that stops being reachable fails CI
rather than failing quietly in the harness.

**Captured scenarios.** Reaching "night three, doctor already dead, mafia at parity" by playing
three rounds is a poor way to look at it twice. **Capture** freezes the room exactly as it stands —
full state and every player's token — as a JSON file you can keep, download, diff or check in.
**Restore** writes it back under a fresh room id with the timestamps rebased onto now, so the same
capture can be reloaded as often as you like and comes back identical every time: same roles, same
history, same phase.

This is a complete bypass of every secrecy rule in the game, so both server functions refuse
outright when `NODE_ENV` is production, and the route 404s outside development builds.

### 5.14 Permissions

Only two things in the whole game need one, and neither may fail silently.

**Camera** (§7, `cameraTorch`) is asked for in setup on the tap that enables it, reports the answer,
and offers a retry with the reason when the answer was no.

**Nothing else asks.** Motion and microphone belong to forehead and the spelling bee; the rule those
share with this game is that a refused permission and a device that cannot do it are different
problems, and only one of them has a way out. Saying "unavailable" to somebody who tapped *don't
allow* leaves them with no idea they can change their mind.

### 5.15 Accessibility

The game is unusually timing-dependent, so the baseline rules in `.cursor/rules/accessibility.mdc`
need active work here:

- Phase transitions and night reports announce via `aria-live`
- Timers carry accessible text, not only a shrinking bar
- Colour never carries meaning alone (§5.1)
- `prefers-reduced-motion` has a real path through every effect (§5.4)

---

## 6. Controls

### Host, in the lobby

| Control | |
|---|---|
| Mode | mafia or imposter — locked once the game starts. **Mafia is disabled below 5 players**, with the reason shown rather than a greyed-out button. |
| Room mode | same room or remote (§5.11) |
| Roles | preset for the player count in one tap, then **customise** for the à la carte checklist |
| First game | strips the lineup to doctor / detective / villager at any player count, and lengthens the deal with a three-card explainer. Twelve first-timers handed nine roles is a disaster. |
| Timings | every phase length, defaults as specified above |
| Toggles | section 7 |
| Remove player | before the deal |
| Start | blocked until everyone is ready |

Role presets are saved per device, so a group's house rules are one tap next time.

### Host, in game

Deliberately thin. The host is a player, and every control that could change the flow of a round in
their favour has been moved to the table.

| Control | |
|---|---|
| `+30s` | extend the current phase |
| Pause | freeze between phases |
| Remove | a permanent leaver (§5.10) |
| End game | with confirmation |

**Skip is not a host control** — deliberation ends early on a majority of connected living players
tapping *ready to vote* (§3.5).

**The host sees nothing extra.** Informationally they are a normal player.

### Player

| Control | Available |
|---|---|
| Ready | lobby |
| Select target | night — free to change until lock, publishes nothing, persisted on tap |
| Ready to vote | deliberation — majority of connected living ends it early |
| Point | deliberation — public, live, non-binding |
| Vote / abstain | vote — secret until verdict |
| Said it | your turn, imposter clue round |
| Last words | 30s after your death |
| Graveyard vote | from the moment you die; counts once half the table is gone |
| Final guess | if ejected as the last imposter |
| Claim host | after 60s of host disconnection |
| My role | always |
| What you know | always — your private record (§5.8) |
| Rules | always — deep-linked to your own role |
| Mute | always, per device, persists across games |
| Read it out | dawn, if the elected narrator is muted |

---

## 7. Toggles

| Toggle | Default | Effect |
|---|---|---|
| `announceAttackTarget` | **on** | The death-then-revive names the target. Off: the table only sees *"someone was attacked, and someone saved them"*, and the sequence plays on the victim's phone alone. |
| `lastWords` | **on** | 30 seconds, one line, on death (§5.9) |
| `graveyardVote` | **on** | The dead get one collective ballot once half the table is gone (§5.9). Forced off by `liveGodView`. |
| `liveGodView` | off | The dead see roles and night actions during play, not only at the end. Disables `graveyardVote`. |
| `firstGame` | off | Doctor / detective / villager only, longer deal, explainer cards |
| `revealRoleOnDeath` | **on** | Night kills show the dead player's role |
| `revealEjectedRole` | **on** | Verdict shows the ejected player's role |
| `jesterEndsGame` | **on** | Voting out the jester ends the game outright |
| `doctorRepeatTarget` | off | Allow protecting the same person two nights running |
| `coldOpen` | off | The victim's phone detonates the moment the mafia lock in, not at dawn |
| `blindImposters` | off | Two imposters do not know each other |
| `simultaneousClues` | off | Imposter clue rounds run all at once instead of by turn |
| `cameraTorch` | off | Chrome on Android only. The camera is asked for **in setup, on the tap that turns it on**, with the reason on screen — never mid-death with no explanation. A refusal is reported rather than swallowed, because a browser will not prompt twice and a silently dead toggle is worse than no toggle. No video is ever rendered; the track exists only to hold the lamp on. |
| `reducedEffects` | auto | Detected from `prefers-reduced-motion`, manually overridable |

`announceAttackTarget` is the one with a real cost: showing the death before the save partly
undercuts the mafia's *stay in* option, because a quiet night and a saved night become
distinguishable. The drama is worth it as a default; the toggle is there for groups who want the
tighter game.

---

## 8. Balance rules the engine enforces

Checked in `liars-rules.ts` as pure functions, so the setup screen validates instantly and the server
re-validates on create. Rejections carry a specific reason, never a generic error.

Checked in this order, so a host who has broken the shape of the game hears about that before they
hear about one role's minimum:

1. Role belongs to this mode, and within its copy limit
2. Lineup size matches the roster
3. Mafia side never equals or outnumbers the town at the deal
4. **At least 2 plain villagers, always** — watch needs bodies to work
5. Every role's minimum player count
6. Hard ceiling of 9 distinct special roles
7. *Warning only:* specials above `⌈players ÷ 2⌉ + 1`

Sample rejections:

> `3 mafia and 4 town — mafia would start at parity`
> `no plain villagers left — watch stops working`
> `the escort needs 11 players`
