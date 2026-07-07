# Inner Clock — Build Specification (MVP)

Author: Bram Bredewold
Purpose: hand this file to Claude Code. Build phase by phase, in order. Do not skip ahead.

## What this game is

A single-device, pass-and-play time-estimation game. A target time is randomly
generated and shown to all players once. Each player, in turn, presses Start and
tries to stop an invisible timer exactly at the target. After all players have
played, a ranked leaderboard shows who came closest.

It is NOT networked multiplayer. It is NOT a reaction game (there is no stimulus
to react to). Do not add servers, accounts, names, or network code.

## Hard constraints (non-negotiable)

- Vanilla HTML, CSS, JavaScript only. No frameworks, no build step, no bundler,
  no npm dependencies. Every file must be directly editable by hand.
- Mobile-first. Primary target: iPhone Safari, installed as a PWA later.
- Timing uses `performance.now()`, never `Date.now()`.
- All times stored internally as full-precision floats (milliseconds).
  Rounding happens ONLY at display time.
- Decimal separator is a config flag, default comma (Dutch style: `3,45`).

## File structure

```
inner-clock/
  index.html            single page, contains all four screens as sections
  css/styles.css
  js/config.js          modes, settings, display formatting — plain data
  js/engine.js          game state machine + timer. NO DOM ACCESS in this file.
  js/ui.js              all DOM reads/writes, screen switching
  js/main.js            wires engine to ui, owns event listeners
  assets/icons/         (Phase 6)
  manifest.webmanifest  (Phase 6)
  service-worker.js     (Phase 6)
```

engine.js must be testable without a browser DOM. ui.js must contain no game
rules. If a change to the visuals requires touching engine.js, the split is wrong.

## config.js contents

```js
export const MODES = {
  short:  { label: "Short",  minS: 0.5,  maxS: 8.0,   decimals: 2 },
  medium: { label: "Medium", minS: 10.0, maxS: 30.0,  decimals: 1 },
  long:   { label: "Long",   minS: 30.0, maxS: 120.0, decimals: 0 },
};

export const SETTINGS_DEFAULTS = {
  mode: "short",
  players: 2,          // 1..6
  showTimeAfterRound: false,
};

export const DISPLAY = {
  decimalSeparator: ",",   // "," or "."
  endScreenDecimals: 2,    // end screen ALWAYS uses this, regardless of mode
  introAnimationMs: 2500,  // count-up theater duration, fixed for all modes
  stopGuardMs: 250,        // ignore touches on red screen for this long
};
```

## Game flow / state machine (engine.js)

States: `HOME -> INTRO -> READY(p) -> RUNNING(p) -> RESULT(p) | READY(p+1) -> END -> HOME`

1. HOME. Player picks mode, player count (1–6), toggles "Show time after round".
   Green Start button -> INTRO.
2. INTRO. Target is generated ONCE per game:
   `target = random float in [minS, maxS]` of the selected mode, stored in ms
   at full precision. After a 1 s pause, a count-up animation runs for exactly
   `introAnimationMs` (it is an animation easing into the target, NOT a real
   clock — a 97 s target must not take 97 s to display). Final target shown
   large, formatted to the mode's decimals. Continue button -> READY(1).
3. READY(p). Shows "Player p" and a large round Start button.
4. RUNNING(p). On Start tap: record `t0 = performance.now()`, whole screen
   turns red with the word "Stop" centered. For the first `stopGuardMs`,
   ignore ALL touch/click input (prevents the Start tap from also stopping).
   Any touch anywhere after the guard: `t1 = performance.now()`,
   `achieved = t1 - t0` stored full precision.
5. Branch on the toggle:
   - toggle ON  -> RESULT(p): show achieved time formatted to mode decimals,
     Continue button -> READY(p+1) or END if last player.
   - toggle OFF -> straight to READY(p+1) or END. Nothing shown.
6. END. Leaderboard, all players, sorted by `abs(achieved - target)` ascending.
   Exact ties share their rank; no tiebreaker. Columns: player label,
   achieved time, difference. End screen formatting ALWAYS uses
   `endScreenDecimals` (2), in every mode — the coarse mode display applies
   during play only, the final reckoning is full resolution. Difference is
   shown as absolute value.
   If players >= 2: best row highlighted green, worst row highlighted red.
   (If best and worst tie exactly across all rows, green wins: highlight
   first row green, last red only if its error differs from the best.)
   Button "Back to menu" -> HOME. Settings persist; a new game generates a
   new target.

## Screens (ui.js / index.html)

All four screens live in one index.html as sections; ui.js toggles visibility.
No page navigation, no routing.

HOME: title "Inner Clock", subtitle "Stop the time", credit
"Made by Bram Bredewold". Mode selector (3-way segmented control),
player count selector (1–6), toggle "Show time after round",
large green Start button.

INTRO: count-up animation then large final target number. Continue button
at bottom.

GAME: READY substate shows "Player p" + large round Start button centered.
RUNNING substate: full-screen red, "Stop" centered, entire screen is the
hit target.

END: ranked table as specified above, "Back to menu" button.

## Mobile hardening (Phase 5, but keep in mind from the start)

These are correctness requirements, not polish. A stray browser gesture
ruins a round:
- viewport meta: `width=device-width, initial-scale=1, user-scalable=no`
- CSS: `touch-action: manipulation` globally (kills double-tap zoom delay),
  `user-select: none`, `-webkit-user-select: none`,
  `overscroll-behavior: none` (kills pull-to-refresh / rubber-banding)
- Prevent long-press callout: `-webkit-touch-callout: none`
- Listen for `pointerdown` (not `click`) on the red Stop screen so the stop
  timestamp is taken at first contact, not on release.
- Request Screen Wake Lock (`navigator.wakeLock.request('screen')`) while a
  game is in progress; release on END/HOME. Wrap in try/catch, it is
  best-effort.

## Local development and testing (applies from Phase 1 onward)

The game must be fully playable and testable in a desktop browser on the PC
before any iPhone or PWA work happens. Requirements:

- CRITICAL: the JS files use ES modules (`import`/`export`), which browsers
  refuse to load from `file://`. Never test by double-clicking index.html.
  Always serve the folder over a local HTTP server. Either works:
  `python -m http.server 8000` or `npx serve .`
  Then open `http://localhost:8000`. Claude Code: put this in a README.md
  and mention it after Phase 1 is built.
- All input handlers must use pointer events (`pointerdown`), never
  touch-only events, so mouse clicks on the PC behave exactly like taps on
  the phone. The full game loop, including the red Stop screen and the
  250 ms stop-guard, must work with a mouse.
- Layout testing on PC: use the browser DevTools device toolbar (mobile
  emulation, e.g. iPhone viewport) to check the mobile layout. Design
  portrait-first; the desktop window is a debugging convenience, not the
  target.
- Anything that is best-effort on desktop (Wake Lock, overscroll behavior)
  must fail silently, never break the game in a desktop browser.
- Phase 6 note: service workers require a secure context, but `localhost`
  counts as secure, so the PWA layer is also testable on the PC before
  deploying. Testing on the physical iPhone requires the deployed HTTPS URL
  (or the PC and iPhone on the same network, but HTTPS is the simple path).

## Phases for Claude Code

- Phase 1: file skeleton, empty modules wired together, screens switchable
  with dummy buttons.
- Phase 2: single-player core loop only (hardcode players=1): Start, red
  screen, stop-guard, timestamp capture, log result to console.
- Phase 3: settings on HOME wired to engine; multi-player turn loop and the
  show-time toggle branch.
- Phase 4: END screen with sorting, ties, green/red highlighting, formatting
  rules (mode decimals during play, 2 decimals at the end, comma separator).
- Phase 5: mobile hardening list above.
- Phase 6: PWA — manifest.webmanifest, apple-touch-icon, minimal cache-first
  service-worker.js caching the static files, deploy to a free HTTPS host
  (GitHub Pages / Netlify / Cloudflare Pages). No push, no background sync.

## Explicitly out of scope for MVP

Player names, sounds, haptics, animations beyond the intro count-up,
score history, persistence between sessions, networked play, best-of-N rounds.

## Note to myself: location http://localhost:8000/inner-clock/
