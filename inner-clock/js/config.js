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
