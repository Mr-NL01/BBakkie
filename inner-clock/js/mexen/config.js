export const PLAYER_COUNT = {
  min: 2,
  max: 6,
  default: 2,
};

export const NAME_MAX_LENGTH = 20;

// Ranking order, highest to lowest. A throw's code is (higher die * 10 +
// lower die), e.g. 6 & 2 = 62. 31 is deliberately absent: it's a joker,
// never a valid final score.
export const RANK_ORDER = [
  21, // Mex — immune, always wins the round
  66, 55, 44, 33, 22, 11, // doubles, descending (11 = Ridder)
  65, 64, 63, 62, 61,
  54, 53, 52, 51,
  43, 42, 41,
  32, // lowest possible score
];

export const LABELS = {
  mex: "Mex",
  ridderSuffix: "⚔️",
  mexFireSuffix: "🔥",
};

export const TIMING = {
  resultPauseMs: 900, // "a short beat" before auto-advancing to the next player/screen
  diceAnimationMs: 1000, // dice tumble theater — result is already decided before this plays
};