# Dertigen — Build Specification (MVP)

Author: Bram Bredewold
Purpose: hand this file to Claude Code. Build phase by phase, in order. Do not skip ahead.
Companion document: Dertigen_Master.docx (design source of truth; this file is the build contract).

## What this game is

A single-device, pass-and-play dice drinking game with 6 digital dice, added as the
third game to the existing party-game PWA (Inner Clock + Mexen). One continuous
loop of turns: throw 6 dice in up to 6 throws, sum the result, and depending on the
total either take strafpunten yourself, give them to the player on your left via a
hunt phase, or double everyone else's total with a successful duik. Points are
called "Sips" in the UI. There is no coded end condition; the game ends only via
the stop menu.

It is NOT networked. No servers, no accounts, no persistence between sessions.

## Hard constraints (non-negotiable)

- Vanilla HTML, CSS, JavaScript only. No frameworks, no build step, no npm
  dependencies. Every file must be directly editable by hand.
- Mobile-first. Primary target: iPhone Safari, installed PWA.
- Lives INSIDE the existing repo and PWA scope. Do not create a new repo, do not
  change manifest scope. All new asset paths must be relative, consistent with the
  existing subdirectory deployment (GitHub Pages under /bbakkie/).
- Engine file has NO DOM ACCESS. It must be testable without a browser.
- Dice rolls: each die is an independent uniform integer 1–6
  (`1 + Math.floor(Math.random() * 6)`). No seeding, no bias.
- All UI text in English, Dutch game terms preserved: duik/duiken, strafpunten
  (displayed as "Sips"), jagen (hunt), verschil.
- Follow the integration pattern Mexen already uses for a second game in this PWA
  (navigation entry, shared CSS variables, screen sections, service worker
  precache list). Read the existing code first; mirror it, do not invent a new
  pattern.

## File structure (new files)

```
bbakkie/
  ...existing files...
  dertigen.html            own page, same pattern as mexen.html
  js/dertigen-engine.js    state machine + all rules. NO DOM ACCESS.
  js/dertigen-ui.js        all DOM reads/writes for Dertigen screens
  js/dertigen-main.js      wires engine to ui, owns event listeners
  tests/dertigen-engine.test.js   (or match the existing test layout if one exists)
```

Dertigen screens live as sections in their own dertigen.html, same as Mexen has
mexen.html and Inner Clock has inner-clock.html — the shared index.html is only
the BBakkie landing page, not a game page. Shared styles reuse css/styles.css;
Dertigen-specific rules go in a clearly marked section of that file or a
dertigen.css if Mexen already uses a per-game stylesheet. Match the existing
convention.

If a change to visuals requires touching dertigen-engine.js, the split is wrong.

## Navigation entry

BBakkie's landing page (index.html) lists all games as tiles (`.game-tile` in
css/styles.css) under the "BBakkie" title — Inner Clock, Mexen, and a
currently-disabled "Coming soon" Dertigen tile. Wire that tile up as a real
link to dertigen.html once the game is playable; there is no more direct
game-to-game switch link on the individual game pages, navigation goes back
through the landing page.

## Engine (dertigen-engine.js)

### Game state object

```js
{
  phase,            // see state machine
  players,          // [{ name, sips }] in fixed seating order, 2..8 entries
  currentIndex,     // whose turn
  dicePool,         // dice not yet set aside this turn: [values] or count
  lastThrow,        // values of the most recent throw
  setAside,         // dice set aside this turn, in pick order: [values]
  hunt: {           // null when not hunting
    wanted,         // current hunted number 1..6
    baseVerschil,   // verschil of the triggering throw (for reference/UI only)
    pointsToLeft,   // accumulated hunt points (includes base verschil)
    jokerUsed,      // boolean, one joker per ENTIRE hunt
    remaining,      // dice still to throw at current level
  },
  drinkCounter,     // value on the drink screen, >= 0
}
```

### State machine

```
HOME -> NAMES -> TURN_START
TURN_START:
    if players[currentIndex].sips === 0 -> DICE_TURN        (drink screen skipped)
    else -> DRINK
DRINK -> DICE_TURN                                          (after "Drink" or drinking 0)
DICE_TURN:  THROWN <-> PICKING  (repeat until 6 dice set aside) -> RESOLVE
RESOLVE:
    total <= 10        -> DIVE_POPUP -> SCOREBOARD   (double all other players)
    11 <= total <= 29  -> SCOREBOARD                 (self += 30 - total)
    total === 30       -> SCOREBOARD                 (nothing)
    total  > 30        -> HUNT                       (left += verschil first)
HUNT:  HUNT_THROW loop (see hunt rules) -> SCOREBOARD  (left += pointsToLeft - baseVerschil already applied? see below)
SCOREBOARD -> advanceTurn -> TURN_START
Stop menu reachable from every state, see Stop menu.
```

Point application timing: apply the base verschil to the left player the moment the
hunt starts, then apply each hunted die's value the moment it is set aside, so the
scoreboard after the hunt is already correct with no separate settlement step.
(Equivalent total either way; do it incrementally so the UI can show live damage.)

### Turn rules (the six dice)

1. Throw all dice in `dicePool` (starts at 6).
2. The player must pick exactly ONE face value from the throw and set aside ALL
   dice showing that value. Minimum one die. Never two different values.
   `pickValue(v)` is legal iff `lastThrow.includes(v)`; it moves every die equal
   to `v` from the throw into `setAside`.
3. Repeat until all 6 dice are set aside. Max 6 throws, fewer when multiples taken.
4. `total = sum(setAside)`. Range 6..36.

### Scoring bands (automatic, no announcements)

- total <= 10: successful duik. For every OTHER player: `sips = sips * 2`
  (0 stays 0, no minimum penalty). Diver unchanged.
- 11 <= total <= 29: thrower `sips += 30 - total`.
- total === 30: nothing.
- total > 30: `verschil = total - 30` (always 1..6). Left player
  `sips += verschil`, then the hunt starts with `wanted = verschil`.

"Left player" = `players[(currentIndex + 1) % players.length]`.

### Hunt (jagen)

1. Start: 6 fresh dice, `wanted = verschil`, `jokerUsed = false`.
2. Throw all remaining dice. Every die equal to `wanted` is set aside
   automatically (no player choice) and adds `wanted` to the left player's sips.
3. If a throw contains at least one wanted die: continue with the remaining dice.
4. If all 6 dice at the current level are set aside: ESCALATE.
   New level: `wanted = min(wanted + 1, 6)` (a verschil of 6 stays at 6),
   6 fresh dice. Escalated dice score their own face value (hunting 3s adds 3
   per die). No cap on escalation depth. NO new joker.
5. Dead throw (zero wanted dice):
   - first dead throw of the ENTIRE hunt: joker. UI shows 🃏 popup 0.7 s,
     then the player re-throws the same remaining dice.
   - second dead throw: hunt ends immediately. This includes a dead throw on the
     first throw of a fresh escalation level when the joker is already spent.
6. Hunt over -> SCOREBOARD.

Worked check (must hold in tests): total 33 → verschil 3 → left +3. Player hunts
two 3s then dead, dead: left received 3 + 3 + 3 = 9 total.

### Drinking

- Only on the DRINK screen at the start of the player's own turn.
- 1 Sip = 1 point. `drink(n)`: `sips = max(0, sips - n)`.
- Engine exposes the current sips so the UI can cap the counter; counter never
  exceeds the player's sips and never goes below 0.
- The screen is skipped entirely when sips === 0.

### Stop menu / quitting

- `quitGame()`: from any state, back to the landing page. All state discarded.
- `quitCurrentPlayer()`: the current player is removed from `players` entirely
  (points vanish, seating re-links across the gap).
  - DECISION (Bram, confirm on review): the in-progress turn is VOIDED. Any
    points already applied during this turn (band points, base verschil, hunt
    points to the left player) are ROLLED BACK to the values at TURN_START.
    Implement by snapshotting all sips at TURN_START and restoring the snapshot
    for the remaining players on quitCurrentPlayer. Play continues at
    TURN_START of the player who was to the quitter's left.
  - If fewer than 2 players remain: quitGame().

### Engine API (suggested, adjust names to match Mexen conventions)

```
newGame(names[])            -> state
startTurn()                 -> DRINK or DICE_TURN
drink(n)
throwDice()                 -> lastThrow
pickValue(v)                -> throws Error if illegal
resolveTurn()               (internal, fires band logic / starts hunt)
huntThrow()                 -> { matched: [..], dead: bool, joker: bool, escalated: bool, ended: bool }
advanceTurn()
quitGame() / quitCurrentPlayer()
```

Engine must be pure enough that every rule below is unit-testable by injecting a
fake RNG (accept an optional `rng` function defaulting to Math.random).

## Unit tests (dertigen-engine.test.js)

Use the test approach already present in the repo; if none exists, plain Node
`assert` in a file runnable with `node tests/dertigen-engine.test.js`. Required
cases, all with injected deterministic RNG:

1. pickValue takes ALL dice of the chosen value (throw [5,5,5,2,1,4], pick 5 →
   three dice aside, three remain).
2. pickValue rejects a value not in the throw.
3. A turn with six distinct throws lasts 6 throws; taking triples shortens it.
4. Band boundaries: totals 6, 10 → dive; 11 → self +19; 29 → self +1;
   30 → nothing; 31 → left +1 and hunt starts; 36 → left +6, hunt wanted = 6.
5. Dive doubling: others 0, 4, 12, 25 become 0, 8, 24, 50; diver unchanged.
6. Hunt canonical: total 33, hunt throws produce two 3s then two dead throws →
   left player total gain exactly 9; joker consumed on first dead throw.
7. Joker does not reset on escalation: six 2s (escalate to 3), dead, dead →
   hunt ends after second dead throw overall.
8. Escalation scoring by NEW number: six 2s (12 pts) then two 3s (6 pts) then
   dead, dead → left gained base 2 + 12 + 6 = 20.
9. Escalation at 6 stays 6.
10. Rotation wraps: last player's left is player 0.
11. drink floors at 0 and cannot exceed current sips.
12. startTurn skips DRINK when sips === 0.
13. quitCurrentPlayer mid-hunt: left player's sips restored to TURN_START
    snapshot, quitter removed, next turn belongs to the ex-left player.
14. quitCurrentPlayer with 2 players ends the game.

Verification rule: after Claude Code claims tests pass, the actual executed
command output with matching assertion counts must be shown. Prose summaries are
not acceptance.

## Screens (dertigen-ui.js / index.html sections)

All screens are sections in the existing index.html, toggled by dertigen-ui.js.
Reuse existing CSS variables/colours. Black background, same look as Mexen.

HOME: player count selector 2–8, big green Start button.

NAMES: identical to the Mexen name screen (table, white outlines, 20-char
fields, "Player N" fallback). Green Start button below. Reuse the Mexen markup/CSS
pattern; do not duplicate logic if it can be shared cleanly without refactoring
Mexen.

SCOREBOARD: all players in fixed seating order with their Sips. No highlighting
of any row. Continue button advances to the next player's TURN_START.

DRINK: player name + current Sips. Counter with minus, plus, and a 🍺 button that
sets the counter to 10. "Drink" button subtracts and proceeds to the dice phase.
Counter clamps between 0 and the player's current Sips. Skipped when Sips = 0.

DICE_TURN: player name big at the top. Set-aside dice from earlier throws shown in
a row at the top, accumulating. Big green "Gooien" button. On throw: ~1 s dice
roll animation in the style of the Google dice widget (dice tumble/shake and
settle). CSS/JS animation only, no libraries. After settling, dice are tappable:
tapping one die highlights ALL dice of that value (the forced pick). A "Continue"
button at the bottom confirms and either triggers the next throw or, after the
sixth die, resolves the turn.

HUNT: same dice area. Throws are automatic on "Gooien"; matched dice visibly move
to the set-aside row; a running "+N to <left player>" indicator updates live.
🃏 popup exactly 0.7 s on the joker. Hunt end returns to SCOREBOARD.

DIVE POPUP: "🤿 Successful dive!!!" subtitle "All amounts are doubled". Dismiss →
SCOREBOARD with doubled figures.

STOP MENU: permanent 🛑 button top left on ALL Dertigen screens. Opens a prompt
with three options: "Quit whole game" (app red), "Current player quits" (orange),
"Continue" (app green). The first two open a confirmation: title "Are you sure?",
subtitle "This action can't be undone".

Mobile hardening is inherited from the existing app (touch-action, no user-select,
overscroll-behavior, pointerdown listeners). Dertigen must not regress any of it;
new buttons use pointerdown-compatible handlers consistent with the existing code.

## Local development and testing

- Serve over HTTP (`python -m http.server 8000`), never file://. ES modules.
- Full game must be playable with a mouse on desktop before any device testing.
- Engine tests run headless with Node, no browser.

## Phases for Claude Code

- Phase 1: Read the existing Mexen integration end to end. Add the 🎲 "Dertigen"
  entry (upper left, landing page), empty screen sections, empty module files
  wired together, screens switchable with dummy buttons. Nothing functional.
- Phase 2: Engine core WITHOUT the hunt: state object, dice throw, pickValue
  rules, turn loop to a total, scoring bands with dive doubling and self-points.
  Unit tests 1–5, 10–12 passing with injected RNG.
- Phase 3: Hunt engine: auto set-aside, joker, dead-throw logic, escalation,
  incremental point application, plus quit logic with turn-void snapshot.
  Unit tests 6–9, 13–14 passing. Show real test output.
- Phase 4: UI for the full loop: HOME, NAMES (reuse Mexen pattern), DRINK with
  skip-at-zero, DICE_TURN with roll animation and forced-pick highlighting,
  HUNT view, SCOREBOARD, dive popup, joker popup (0.7 s).
- Phase 5: Stop menu on every screen with both quit paths and confirmations;
  edge-case pass (quit mid-hunt, quit on drink screen, 2-player quit ends game);
  mobile-hardening consistency check against the existing games.
- Phase 6: PWA integration: add the new JS (and CSS if any) files to the service
  worker precache list, bump the VERSION constant, deploy to GitHub Pages,
  verify offline load and the new nav entry on the installed iPhone PWA.

## Explicitly out of scope for MVP

Coded end condition, score persistence between sessions, sounds, haptics,
statistics, undo (beyond the quit rollback), animations beyond the dice roll and
popups, networked play.
