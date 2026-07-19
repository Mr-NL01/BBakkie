export const MODES = {
  short:  { label: "Short",  minS: 0.5, maxS: 5.0,  decimals: 2 },
  medium: { label: "Long", minS: 5.0, maxS: 10.0, decimals: 1 },
};

// Bounds a player can drag each mode's custom range to in the settings screen.
export const RANGE_LIMITS = {
  short:  { minS: 0.5, maxS: 10.0 },
  medium: { minS: 5.0, maxS: 120.0 },
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
