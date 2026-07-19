import { PLAYER_COUNT, NAME_MAX_LENGTH, RANK_ORDER, HOLDABLE_VALUES } from "./config.js";

// Game state machine for Mexen. NO DOM ACCESS — this file must be testable
// in plain Node/JS. Same subscribe/emit pattern as Inner Clock's engine.
//
// Screens: HOME -> NAMES -> GAME (per-turn loop) -> [THROWOFF | GAME
// (3+ tie fallback)] -> END -> NAMES/HOME. Dice animation (Phase 6) and
// mobile hardening are not part of this file.

function clampPlayerCount(n) {
  return Math.min(PLAYER_COUNT.max, Math.max(PLAYER_COUNT.min, n));
}

function makeDefaultNames(count) {
  return Array.from({ length: count }, () => "");
}

// Empty/whitespace-only names fall back to "Player N".
export function displayName(names, index) {
  const raw = (names[index] || "").trim();
  return raw.length > 0 ? raw : `Player ${index + 1}`;
}

// Scores a single throw of two dice per the Mexen ranking table.
// 31 is a joker: isValidScore is false and callers must re-throw rather
// than record it.
export function scoreThrow(d1, d2) {
  const high = Math.max(d1, d2);
  const low = Math.min(d1, d2);
  const code = high * 10 + low;

  if (code === 31) {
    return { dice: [d1, d2], code, isJoker: true, isValidScore: false };
  }

  const isDouble = high === low;

  return {
    dice: [d1, d2],
    code,
    label: code === 21 ? "Mex" : String(code),
    isJoker: false,
    isValidScore: true,
    isMex: code === 21,
    isDouble,
    doubleValue: isDouble ? high : null,
    is100: code === 11,
    rank: RANK_ORDER.indexOf(code), // lower index = higher-ranked score
  };
}

// Sorts scoreThrow() results best-first (Array#sort comparator semantics).
export function compareScores(a, b) {
  return a.rank - b.rank;
}

// rng is injectable so tests can script exact outcomes; production callers
// use the default Math.random. Each die is uniform 1-6, independent.
export function rollDie(rng = Math.random) {
  return Math.floor(rng() * 6) + 1;
}

// Runs a single player's turn: mandatory throws up to `throwLimit`, the 31
// joker (doesn't count, forces a rethrow), Mex (ends the turn instantly),
// and the holding rule (HOLDABLE_VALUES — 1 or 2) including the
// double-held-value swap case. Round-level concerns (whose turn is next,
// Ridder, Mex count) live outside this — a turn only knows its own throw
// limit and its own dice.
export function createTurn(throwLimit = 3, rng = Math.random) {
  let state = {
    dice: null, // [d1, d2] of the two physical dice; index is stable across rerolls
    throwsTaken: 0,
    throwLimit,
    hold: null, // { dieIndex: 0 | 1 } | null — that physical die must stay
    holdUsed: false, // the hold may be initiated only once per turn
    isJokerPending: false, // true right after a 31, awaiting the mandatory rethrow
    isDone: false,
    mexEndedTurn: false,
    lastScore: null, // the most recent valid (non-joker) throw's score, done or not — for display
    finalScore: null,
    rolledIndices: [], // which physical die index/indices the most recent throwDice() call rolled
    rollSeq: 0, // increments on every throwDice() call that actually rolls dice (joker or not) —
    // the unambiguous "something new happened" signal for animation, since dice values alone can
    // coincidentally repeat
  };

  function snapshot() {
    return {
      ...state,
      dice: state.dice ? [...state.dice] : null,
      hold: state.hold ? { ...state.hold } : null,
      rolledIndices: [...state.rolledIndices],
    };
  }

  function getState() {
    return snapshot();
  }

  function throwDice() {
    if (state.isDone) return snapshot();

    let dice;
    if (state.hold) {
      const freeIndex = 1 - state.hold.dieIndex;
      dice = [...state.dice];
      dice[freeIndex] = rollDie(rng);
      state.rolledIndices = [freeIndex];
    } else {
      dice = [rollDie(rng), rollDie(rng)];
      state.rolledIndices = [0, 1];
    }
    state.dice = dice;
    state.rollSeq += 1;

    const score = scoreThrow(dice[0], dice[1]);

    if (score.isJoker) {
      // Doesn't count as a throw; a pre-existing hold persists untouched.
      state.isJokerPending = true;
      return snapshot();
    }
    state.isJokerPending = false;
    state.throwsTaken += 1;
    state.lastScore = score;

    if (state.hold) {
      const freeIndex = 1 - state.hold.dieIndex;
      const heldValue = dice[state.hold.dieIndex]; // the held die's own value never changes while held
      if (dice[freeIndex] !== heldValue) {
        state.hold = null; // rethrow didn't match — pick up both dice, hold is over
      }
      // else: a double of the held value — still holding; swapHeldDie() may re-point which
      // physical die is held.
    } else if (!state.holdUsed && !score.isMex) {
      const throwsRemain = state.throwsTaken < state.throwLimit;
      // At most one of HOLDABLE_VALUES can match "exactly one" at a time: a 1-and-2 throw is
      // always Mex (excluded above), so there's no ambiguity in which value to hold.
      const holdableValue = HOLDABLE_VALUES.find((v) => dice.filter((d) => d === v).length === 1);
      if (holdableValue !== undefined && throwsRemain) {
        state.hold = { dieIndex: dice[0] === holdableValue ? 0 : 1 };
        state.holdUsed = true;
      }
    }

    if (score.isMex) {
      state.isDone = true;
      state.mexEndedTurn = true;
      state.finalScore = score;
    } else if (state.throwsTaken >= state.throwLimit) {
      state.isDone = true;
      state.finalScore = score;
    }

    return snapshot();
  }

  // Only meaningful right after a hold-rethrow lands on a second copy of
  // the held value (double ones, or double twos). Re-points which physical
  // die is "held" going forward; purely cosmetic, never changes the score.
  // No-op otherwise.
  function swapHeldDie() {
    if (state.isDone || !state.hold) return snapshot();
    const freeIndex = 1 - state.hold.dieIndex;
    if (state.dice[freeIndex] !== state.dice[state.hold.dieIndex]) return snapshot();
    state.hold = { dieIndex: freeIndex };
    return snapshot();
  }

  return { getState, throwDice, swapHeldDie };
}

// Mex on throw k shortens the throw limit to k for the rest of the round;
// otherwise the mandatory limit of 3 stands. Call with the round's first
// player's finished turn state.
export function deriveRoundThrowLimit(firstPlayerTurnState) {
  return firstPlayerTurnState.mexEndedTurn ? firstPlayerTurnState.throwsTaken : 3;
}

// Among players who didn't throw Mex (Mex is immune), finds those tied for
// the worst-ranked score. Empty when everyone Mexed — the degenerate no-loser
// case. Length 1 is a clean loser; 2+ means a throw-off is needed.
function computeLoserCandidates(results) {
  const nonImmune = results.filter((r) => !r.score.isMex);
  if (nonImmune.length === 0) return [];
  const worstRank = Math.max(...nonImmune.map((r) => r.score.rank));
  return nonImmune.filter((r) => r.score.rank === worstRank);
}

export function createEngine() {
  let state = {
    screen: "HOME",
    playerCount: PLAYER_COUNT.default,
    names: makeDefaultNames(PLAYER_COUNT.default),
    ridder: null, // player index, persists across rounds within a session
    startIndex: 0, // player index who starts the current round
    round: null, // active/last-finished round bookkeeping; see beginRound()
    popup: null, // { message } | null — doubles announcement, blocks the game
    quitDialogOpen: false,
  };

  // The live turn/throw-off controllers are NOT part of `state`: they carry
  // methods, not plain data, so they live in this closure and get folded
  // into the emitted snapshot instead (mirrors how `state` itself is never
  // handed out directly — see snapshot()).
  let currentTurn = null;

  // A turn's own rollSeq restarts at 0 every time — it can't tell the UI
  // "this is a different turn" on its own (a fresh turn's 3rd roll would
  // otherwise collide with a stale rollSeq===3 left over from someone
  // else's turn). This counter is unique per turn instance for the whole
  // session, so the UI can safely detect turn boundaries before comparing
  // rollSeq.
  let turnInstanceCounter = 0;

  const listeners = [];

  function snapshot() {
    return {
      ...state,
      names: [...state.names],
      round: state.round
        ? {
            ...state.round,
            results: state.round.results.map((r) => ({ ...r, score: { ...r.score } })),
            throwOffOriginalCandidates: state.round.throwOffOriginalCandidates
              ? [...state.round.throwOffOriginalCandidates]
              : null,
            throwOff: state.round.throwOff
              ? {
                  ...state.round.throwOff,
                  candidates: [...state.round.throwOff.candidates],
                  originalCandidates: [...state.round.throwOff.originalCandidates],
                  rolls: { ...state.round.throwOff.rolls },
                  tiedNext: state.round.throwOff.tiedNext ? [...state.round.throwOff.tiedNext] : null,
                }
              : null,
          }
        : null,
      turn: currentTurn ? currentTurn.getState() : null,
      turnSeq: currentTurn ? turnInstanceCounter : null,
      popup: state.popup ? { ...state.popup } : null,
      currentPlayerIndex:
        state.round && currentTurn ? (state.startIndex + state.round.turnPos) % state.playerCount : null,
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

  function setPlayerCount(n) {
    if (state.screen !== "HOME") return;
    const clamped = clampPlayerCount(n);
    if (clamped === state.playerCount) return;

    const names = makeDefaultNames(clamped);
    for (let i = 0; i < Math.min(names.length, state.names.length); i++) {
      names[i] = state.names[i];
    }
    state.playerCount = clamped;
    state.names = names;
    emit();
  }

  function goToNames() {
    if (state.screen !== "HOME") return;
    state.screen = "NAMES";
    emit();
  }

  function setName(index, value) {
    if (state.screen !== "NAMES") return;
    if (index < 0 || index >= state.names.length) return;
    state.names[index] = value.slice(0, NAME_MAX_LENGTH);
    emit();
  }

  function beginRound() {
    state.round = {
      turnPos: 0,
      throwLimitForRest: null, // set once the round's first player finishes
      results: [],
      mexCount: 0,
      loserIndex: null,
      throwOff: null,
      throwOffOriginalCandidates: null,
    };
    currentTurn = createTurn(3); // the round's first player always throws exactly 3 (or Mexes early)
    turnInstanceCounter += 1;
    state.screen = "GAME";
  }

  function startGame() {
    if (state.screen !== "NAMES") return;
    state.ridder = null;
    state.startIndex = 0;
    beginRound();
    emit();
  }

  // Resolves one throw of the current player's turn. 31 doesn't count and
  // triggers its own "hand out sips" popup (comparable to the Ridder
  // doubles popup); the throw counter doesn't advance and the mandatory
  // rethrow is blocked until it's dismissed. A real throw may instead
  // trigger a doubles popup and/or a Ridder change; the round loop itself
  // does NOT auto-advance here — see advanceTurn().
  function throwDice() {
    if (state.screen !== "GAME" || state.popup || !currentTurn) return;
    if (currentTurn.getState().isDone) return; // turn already resolved — awaiting advanceTurn()

    const result = currentTurn.throwDice();
    if (result.isJokerPending) {
      state.popup = { message: "Hand out 3 sips!" };
      emit();
      return;
    }

    const score = scoreThrow(result.dice[0], result.dice[1]);
    const playerIndex = (state.startIndex + state.round.turnPos) % state.playerCount;

    if (score.isMex) {
      state.round.mexCount += 1;
    }
    if (score.is100) {
      state.ridder = playerIndex; // takes the title even if they already held it
    }
    if (score.isDouble && score.doubleValue >= 2 && state.ridder !== null) {
      const ridderName = displayName(state.names, state.ridder);
      state.popup =
        state.ridder === playerIndex
          ? { message: `Divide ${score.doubleValue} sips!` }
          : { message: `${ridderName} has to drink ${score.doubleValue}!` };
    }

    if (result.isDone) {
      state.round.results.push({ playerIndex, score });
      if (state.round.throwLimitForRest === null) {
        state.round.throwLimitForRest = deriveRoundThrowLimit(result);
      }
    }

    emit();
  }

  function dismissPopup() {
    if (!state.popup) return;
    state.popup = null;
    emit();
  }

  function finishRound() {
    const candidates = computeLoserCandidates(state.round.results);
    currentTurn = null;

    if (candidates.length <= 1) {
      state.round.loserIndex = candidates.length === 1 ? candidates[0].playerIndex : null;
      state.screen = "END";
    } else {
      state.round.throwOff = {
        originalCandidates: candidates.map((c) => c.playerIndex),
        candidates: candidates.map((c) => c.playerIndex),
        rolls: {},
        lastRolledPlayerIndex: null,
        awaitingAck: false, // true right after any roll, until the UI has shown it for a beat
        tiedNext: null, // staged next candidates when a sub-round ties, applied on acknowledge
        resolved: false,
        loserIndex: null,
      };
      // Split screen only for a clean 2-way tie; 3+ resolves sequentially
      // on the normal game screen.
      state.screen = candidates.length === 2 ? "THROWOFF" : "GAME";
    }
  }

  // UI calls this once it's done displaying the just-finished throw (after
  // its own "short beat" pause) — never called while a popup is blocking.
  function advanceTurn() {
    if (state.screen !== "GAME" || state.popup || !currentTurn) return;
    if (!currentTurn.getState().isDone) return;

    state.round.turnPos += 1;
    if (state.round.turnPos >= state.playerCount) {
      finishRound();
    } else {
      currentTurn = createTurn(state.round.throwLimitForRest);
      turnInstanceCounter += 1;
    }
    emit();
  }

  // Rolls one die for `playerIndex` in the active throw-off (2-player split
  // screen, or the 3+ sequential fallback running on the normal game
  // screen — same resolution either way). Sets awaitingAck rather than
  // immediately resolving/narrowing: engine mutation and re-render both
  // happen synchronously, so applying the outcome (reset for a rethrow, or
  // advancing to END) right away would mean the just-rolled die is never
  // actually painted to the screen. The UI shows the result for a beat,
  // then calls acknowledgeThrowOffRoll() (or advanceFromThrowOff() once
  // resolved) to apply it.
  function throwOffThrow(playerIndex) {
    const t = state.round && state.round.throwOff;
    if (!t || t.resolved) return;
    if (!t.candidates.includes(playerIndex) || t.rolls[playerIndex] != null) return;

    t.rolls[playerIndex] = rollDie();
    t.lastRolledPlayerIndex = playerIndex;
    t.awaitingAck = true;

    const allRolled = t.candidates.every((p) => t.rolls[p] != null);
    if (allRolled) {
      const lowest = Math.min(...t.candidates.map((p) => t.rolls[p]));
      const stillTied = t.candidates.filter((p) => t.rolls[p] === lowest);
      if (stillTied.length > 1) {
        t.tiedNext = stillTied;
      } else {
        t.resolved = true;
        t.loserIndex = stillTied[0];
      }
    }
    emit();
  }

  // UI calls this once it's shown the just-rolled die for a beat. Applies a
  // staged tie-rethrow narrowing if the sub-round completed in a tie;
  // otherwise just clears the "awaiting" flag so the next candidate's
  // button (sequential mode) becomes the displayed one. No-op once
  // resolved — advanceFromThrowOff() handles that transition instead.
  function acknowledgeThrowOffRoll() {
    const t = state.round && state.round.throwOff;
    if (!t || !t.awaitingAck || t.resolved) return;

    t.awaitingAck = false;
    if (t.tiedNext) {
      t.candidates = t.tiedNext;
      t.tiedNext = null;
      t.rolls = {};
    }
    emit();
  }

  // UI calls this after showing the resolved throw-off result for a beat.
  function advanceFromThrowOff() {
    const t = state.round && state.round.throwOff;
    if (!t || !t.resolved) return;

    state.round.loserIndex = t.loserIndex;
    state.round.throwOffOriginalCandidates = t.originalCandidates;
    state.round.throwOff = null;
    state.screen = "END";
    emit();
  }

  // Same players, same order. Ridder persists, Mex count resets. The
  // previous round's loser starts; if there was no loser (everyone Mexed),
  // the previous starter goes again.
  function nextRound() {
    if (state.screen !== "END") return;
    if (state.round.loserIndex !== null) {
      state.startIndex = state.round.loserIndex;
    }
    beginRound();
    emit();
  }

  function openQuitDialog() {
    if (state.screen !== "END") return;
    state.quitDialogOpen = true;
    emit();
  }

  function cancelQuitDialog() {
    state.quitDialogOpen = false;
    emit();
  }

  function quitGame() {
    if (!state.quitDialogOpen) return;
    state.screen = "HOME";
    state.playerCount = PLAYER_COUNT.default;
    state.names = makeDefaultNames(PLAYER_COUNT.default);
    state.ridder = null;
    state.startIndex = 0;
    state.round = null;
    state.popup = null;
    state.quitDialogOpen = false;
    currentTurn = null;
    emit();
  }

  return {
    subscribe,
    getState,
    setPlayerCount,
    goToNames,
    setName,
    startGame,
    throwDice,
    dismissPopup,
    advanceTurn,
    throwOffThrow,
    acknowledgeThrowOffRoll,
    advanceFromThrowOff,
    nextRound,
    openQuitDialog,
    cancelQuitDialog,
    quitGame,
  };
}
