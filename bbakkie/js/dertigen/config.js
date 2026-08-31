export const PLAYER_COUNT = {
  min: 2,
  max: 8,
  default: 2,
};

export const NAME_MAX_LENGTH = 20;

export const DICE_PER_TURN = 6;

// The "dertig" the game is named after: a turn total below it costs the
// thrower the difference, above it starts a hunt for the difference.
export const TARGET_TOTAL = 30;

// A turn total at or below this is a successful duik: everyone else's
// sips double.
export const DIVE_MAX = 10;

// The 🍺 shortcut on the drink screen: each tap adds this many sips to the
// counter (capped at the player's sips).
export const BEER_COUNTER_VALUE = 10;

export const TIMING = {
  diceAnimationMs: 1000, // dice tumble theater — result is already decided before this plays
  settlePopMs: 220, // the little bounce when a die lands
  pickFlyMs: 450, // picked dice flying to the set-aside row
  matchGlowMs: 350, // hunted dice glow before they fly
  nextThrowDelayMs: 250, // beat between a confirmed pick and the automatic next throw
  resultPauseMs: 900, // "a short beat" before resolving the turn / ending the hunt
  jokerPopupMs: 800, // 🃏 popup duration, spec-fixed
  escalatePauseMs: 500, // full set-aside row shown before it clears on escalation
};

// Dice mode — a HOME-screen preference. "offline": the dice are thrown in
// real life and the app only keeps score (no DICE_TURN/HUNT screens, one
// OFFLINE screen per turn instead). "screen": the full on-screen dice game.
export const DICE_MODE_DEFAULT = "offline";
