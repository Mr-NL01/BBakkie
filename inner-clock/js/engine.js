import { MODES, SETTINGS_DEFAULTS, DISPLAY } from "./config.js";

// Game state machine. No DOM access here — this file must be testable in
// plain Node/JS with only `performance.now()` available.
//
// Screens: HOME -> INTRO -> READY(p) -> RUNNING(p) -> RESULT(p) | READY(p+1) -> END -> HOME

function clampPlayers(n) {
  return Math.min(6, Math.max(1, n));
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
    settings: { ...SETTINGS_DEFAULTS },
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
      settings: { ...state.settings },
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

  function startGame() {
    if (state.screen !== "HOME") return;
    const mode = MODES[state.settings.mode];
    const targetS = Math.random() * (mode.maxS - mode.minS) + mode.minS;
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
    startGame,
    introContinue,
    startRound,
    stopRound,
    resultContinue,
    backToMenu,
  };
}
