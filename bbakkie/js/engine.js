import { MODES, RANGE_LIMITS, SETTINGS_DEFAULTS, DISPLAY } from "./config.js";

// Game state machine. No DOM access here — this file must be testable in
// plain Node/JS with only `performance.now()` available.
//
// Screens: HOME -> SETTINGS -> HOME
//       -> INTRO -> READY(p) -> RUNNING(p) -> RESULT(p) | READY(p+1) -> END -> HOME

const RANGES_STORAGE_KEY = "inner-clock-ranges";

function clampPlayers(n) {
  return Math.min(6, Math.max(1, n));
}

function clampRangeValue(mode, valueS) {
  const limits = RANGE_LIMITS[mode];
  return Math.min(limits.maxS, Math.max(limits.minS, valueS));
}

function defaultRanges() {
  const ranges = {};
  Object.keys(MODES).forEach((mode) => {
    ranges[mode] = { minS: MODES[mode].minS, maxS: MODES[mode].maxS };
  });
  return ranges;
}

// Custom short/medium ranges are the one setting worth remembering between
// sessions — everything else (mode, players, show-time) intentionally resets.
function loadStoredRanges() {
  try {
    const raw = localStorage.getItem(RANGES_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const ranges = {};
    for (const mode of Object.keys(MODES)) {
      const r = parsed[mode];
      if (!r || typeof r.minS !== "number" || typeof r.maxS !== "number") return null;
      const minS = clampRangeValue(mode, r.minS);
      const maxS = clampRangeValue(mode, r.maxS);
      if (minS > maxS) return null;
      ranges[mode] = { minS, maxS };
    }
    return ranges;
  } catch {
    return null;
  }
}

function saveStoredRanges(ranges) {
  try {
    localStorage.setItem(RANGES_STORAGE_KEY, JSON.stringify(ranges));
  } catch {
    // best-effort persistence only
  }
}

function computeLeaderboard(results) {
  const sorted = results
    .map((r, i) => ({ ...r, originalIndex: i }))
    .sort((a, b) => a.diff - b.diff || a.originalIndex - b.originalIndex);

  const ranked = [];
  let prevDiff = null;
  let prevRank = 0;
  sorted.forEach((r, i) => {
    const rank = prevDiff !== null && r.diff === prevDiff ? prevRank : i + 1;
    ranked.push({ ...r, rank, highlight: null });
    prevDiff = r.diff;
    prevRank = rank;
  });

  const n = ranked.length;
  if (n >= 2) {
    const bestDiff = ranked[0].diff;
    const worstDiff = ranked[n - 1].diff;
    ranked[0].highlight = "best";
    if (worstDiff !== bestDiff) {
      ranked[n - 1].highlight = "worst";
    }
  }
  return ranked;
}

export function createEngine() {
  let state = {
    screen: "HOME",
    settings: { ...SETTINGS_DEFAULTS, ranges: loadStoredRanges() || defaultRanges() },
    target: 0,
    currentPlayer: 1,
    t0: 0,
    lastAchieved: 0,
    results: [],
    leaderboard: [],
  };

  const listeners = [];

  function snapshot() {
    return {
      ...state,
      settings: {
        ...state.settings,
        ranges: Object.fromEntries(
          Object.entries(state.settings.ranges).map(([mode, r]) => [mode, { ...r }])
        ),
      },
      results: state.results.map((r) => ({ ...r })),
      leaderboard: state.leaderboard.map((r) => ({ ...r })),
    };
  }

  function emit() {
    const snap = snapshot();
    listeners.forEach((fn) => fn(snap));
  }

  function subscribe(fn) {
    listeners.push(fn);
    fn(snapshot());
    return () => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  function getState() {
    return snapshot();
  }

  function setMode(modeKey) {
    if (state.screen !== "HOME" || !MODES[modeKey]) return;
    state.settings.mode = modeKey;
    emit();
  }

  function setPlayers(n) {
    if (state.screen !== "HOME") return;
    state.settings.players = clampPlayers(n);
    emit();
  }

  function toggleShowTimeAfterRound() {
    if (state.screen !== "HOME") return;
    state.settings.showTimeAfterRound = !state.settings.showTimeAfterRound;
    emit();
  }

  function openSettings() {
    if (state.screen !== "HOME") return;
    state.screen = "SETTINGS";
    emit();
  }

  function closeSettings() {
    if (state.screen !== "SETTINGS") return;
    state.screen = "HOME";
    emit();
  }

  function setRangeValue(mode, bound, valueS) {
    if (state.screen !== "SETTINGS" || !state.settings.ranges[mode] || Number.isNaN(valueS)) return;
    const clamped = clampRangeValue(mode, valueS);
    const range = state.settings.ranges[mode];
    if (bound === "min") {
      range.minS = clamped;
      if (range.minS > range.maxS) range.maxS = range.minS;
    } else if (bound === "max") {
      range.maxS = clamped;
      if (range.maxS < range.minS) range.minS = range.maxS;
    } else {
      return;
    }
    saveStoredRanges(state.settings.ranges);
    emit();
  }

  function startGame() {
    if (state.screen !== "HOME") return;
    const range = state.settings.ranges[state.settings.mode];
    const targetS = Math.random() * (range.maxS - range.minS) + range.minS;
    state.target = targetS * 1000;
    state.currentPlayer = 1;
    state.results = [];
    state.leaderboard = [];
    state.screen = "INTRO";
    emit();
  }

  function introContinue() {
    if (state.screen !== "INTRO") return;
    state.screen = "READY";
    emit();
  }

  function startRound() {
    if (state.screen !== "READY") return;
    state.t0 = performance.now();
    state.screen = "RUNNING";
    emit();
  }

  function advancePlayer() {
    if (state.currentPlayer >= state.settings.players) {
      state.leaderboard = computeLeaderboard(state.results);
      state.screen = "END";
    } else {
      state.currentPlayer += 1;
      state.screen = "READY";
    }
    emit();
  }

  function stopRound() {
    if (state.screen !== "RUNNING") return;
    const t1 = performance.now();
    if (t1 - state.t0 < DISPLAY.stopGuardMs) return; // stop-guard: ignore early input

    const achieved = t1 - state.t0;
    state.lastAchieved = achieved;
    state.results.push({
      player: state.currentPlayer,
      achieved,
      diff: Math.abs(achieved - state.target),
    });

    if (state.settings.showTimeAfterRound) {
      state.screen = "RESULT";
      emit();
    } else {
      advancePlayer();
    }
  }

  function resultContinue() {
    if (state.screen !== "RESULT") return;
    advancePlayer();
  }

  function backToMenu() {
    state.screen = "HOME";
    emit();
  }

  return {
    subscribe,
    getState,
    setMode,
    setPlayers,
    toggleShowTimeAfterRound,
    openSettings,
    closeSettings,
    setRangeValue,
    startGame,
    introContinue,
    startRound,
    stopRound,
    resultContinue,
    backToMenu,
  };
}
