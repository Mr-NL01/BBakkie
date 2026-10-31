import {
  PLAYER_COUNT,
  NAME_MAX_LENGTH,
  DICE_PER_TURN,
  TARGET_TOTAL,
  DIVE_MAX,
  BEER_COUNTER_VALUE,
  DICE_MODE_DEFAULT,
} from "./config.js";

// Game state machine for Dertigen. NO DOM ACCESS — this file must be
// testable in plain Node/JS. Same subscribe/emit snapshot pattern as the
// Mexen and Inner Clock engines.
//
// Screens: HOME -> NAMES -> (per turn) DRINK? -> DICE_TURN -> [HUNT] ->
// SCOREBOARD -> next player's turn. One endless loop; the game only ends
// through the stop menu (screen "EXITED", main.js navigates away).
//
// In "offline" dice mode the players roll real dice and apply the rules
// themselves; the app only keeps score. DICE_TURN/HUNT are then replaced
// by a single OFFLINE screen: DRINK? -> OFFLINE -> SCOREBOARD.
//
// The ⬅️ back button undoes the last screen change, sips included, by
// restoring a copy of the state from the previous screen (see goBack()).

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

// rng is injectable so tests can script exact outcomes; production callers
// use the default Math.random. Each die is uniform 1-6, independent.
export function rollDie(rng = Math.random) {
  return Math.floor(rng() * 6) + 1;
}

const IN_GAME_SCREENS = ["DRINK", "DICE_TURN", "HUNT", "OFFLINE", "SCOREBOARD"];

// Screens the back button can return to. NAMES is included so the first
// turn can still go back to fix a name.
const HISTORY_SCREENS = ["NAMES", ...IN_GAME_SCREENS];

// Restored as they were on ENTRY rather than as last seen: their last state
// (all dice aside / hunt ended) would just re-fire the automatic
// resolveTurn/finishHunt and bounce straight forward again.
const REPLAY_FROM_ENTRY = ["DICE_TURN", "HUNT"];

export function createEngine(rng = Math.random) {
  let state = {
    screen: "HOME",
    playerCount: PLAYER_COUNT.default,
    names: makeDefaultNames(PLAYER_COUNT.default),
    players: null, // [{ name, sips }] in fixed seating order, set at startGame
    currentIndex: 0,
    turnStartSips: null, // sips snapshot at TURN_START — the quit-rollback window,
    // which closes the moment the turn reaches SCOREBOARD (see quitCurrentPlayer)
    throwsTaken: 0,
    dicePool: DICE_PER_TURN, // dice not yet set aside this turn
    lastThrow: null, // [values] awaiting a pick; null = awaiting a throw
    setAside: [], // dice set aside this turn, in pick order
    lastPick: null, // { value, count } of the most recent confirmed pick — for the fly animation
    turnComplete: false, // all 6 aside; resolveTurn() is UI-scheduled so the last pick can animate
    hunt: null, // see resolveTurn()
    drinkCounter: 0,
    diceMode: DICE_MODE_DEFAULT, // "offline" | "screen" — HOME preference
    offlineCounter: 0, // sips to hand out this turn (OFFLINE screen)
    offlineTarget: "current", // "current" | "prev" — who offlineCounter is booked onto
    popup: null, // { type: "dive" } | { type: "joker" } | { type: "dive-confirm" }
    stopMenu: null, // null | "menu" | "confirm-game" | "confirm-player"
    throwSeq: 0, // increments on every roll (turn + hunt) — animation trigger for the UI
    pickSeq: 0, // increments on every confirmed pick — ditto
    turnSeq: 0, // increments every TURN_START so the UI can detect turn boundaries
  };

  const listeners = [];

  // One entry per screen visit this game, oldest first; the top is the
  // current visit. Kept outside `state` so snapshots never carry it.
  let history = [];

  // Who a turn pays out to: the seat BEFORE the thrower. Turn order itself is
  // untouched — only the receiver moved — so sips land on a player just after
  // their own turn has passed, and they drink them almost a full lap later
  // instead of on the very next turn.
  function prevIndex() {
    return (state.currentIndex - 1 + state.players.length) % state.players.length;
  }

  // Where a turn's dice phase happens, per the HOME dice-mode preference.
  function throwScreen() {
    return state.diceMode === "offline" ? "OFFLINE" : "DICE_TURN";
  }

  function snapshot() {
    return {
      ...state,
      names: [...state.names],
      players: state.players ? state.players.map((p) => ({ ...p })) : null,
      turnStartSips: state.turnStartSips ? [...state.turnStartSips] : null,
      lastThrow: state.lastThrow ? [...state.lastThrow] : null,
      setAside: [...state.setAside],
      lastPick: state.lastPick ? { ...state.lastPick } : null,
      hunt: state.hunt
        ? {
            ...state.hunt,
            lastResult: state.hunt.lastResult
              ? { ...state.hunt.lastResult, dice: [...state.hunt.lastResult.dice] }
              : null,
          }
        : null,
      popup: state.popup ? { ...state.popup } : null,
      prevIndex: state.players && IN_GAME_SCREENS.includes(state.screen) ? prevIndex() : null,
      canGoBack: canGoBack(),
    };
  }

  // Called on every emit. A new screen (or a new turn on the same screen)
  // opens a new history entry; further changes on the same visit overwrite
  // it, so going back lands on the screen as it was last seen — counters
  // and typed names included — except for REPLAY_FROM_ENTRY screens.
  function recordHistory() {
    if (!HISTORY_SCREENS.includes(state.screen)) return;
    const top = history[history.length - 1];
    const sameVisit = top && top.screen === state.screen && top.turnSeq === state.turnSeq;
    if (!sameVisit) {
      history.push(structuredClone(state));
    } else if (!REPLAY_FROM_ENTRY.includes(state.screen)) {
      history[history.length - 1] = structuredClone(state);
    }
  }

  function emit() {
    recordHistory();
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

  // ---- HOME / NAMES ----

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

  // Purely a HOME preference; locked once the game is running.
  function toggleDiceMode() {
    if (state.screen !== "HOME") return;
    state.diceMode = state.diceMode === "offline" ? "screen" : "offline";
    emit();
  }

  function goToNames() {
    if (state.screen !== "HOME") return;
    history = [];
    state.screen = "NAMES";
    emit();
  }

  function setName(index, value) {
    if (state.screen !== "NAMES") return;
    if (index < 0 || index >= state.names.length) return;
    state.names[index] = value.slice(0, NAME_MAX_LENGTH);
    emit();
  }

  function startGame() {
    if (state.screen !== "NAMES") return;
    state.players = state.names.map((_, i) => ({ name: displayName(state.names, i), sips: 0 }));
    state.currentIndex = 0;
    startTurn();
    emit();
  }

  // ---- turn loop ----

  // TURN_START of the state machine. Not exposed: every path into it
  // (startGame, advanceTurn, quitCurrentPlayer) calls it internally.
  function startTurn() {
    state.turnSeq += 1;
    state.turnStartSips = state.players.map((p) => p.sips);
    state.throwsTaken = 0;
    state.dicePool = DICE_PER_TURN;
    state.lastThrow = null;
    state.setAside = [];
    state.lastPick = null;
    state.turnComplete = false;
    state.hunt = null;
    state.drinkCounter = 0;
    state.offlineCounter = 0;
    // Under 30 is by far the common outcome, so pre-arm the thrower.
    state.offlineTarget = "current";
    // The drink screen is skipped entirely at 0 sips.
    state.screen = state.players[state.currentIndex].sips === 0 ? throwScreen() : "DRINK";
  }

  // ---- DRINK ----

  function adjustDrinkCounter(delta) {
    if (state.screen !== "DRINK") return;
    const max = state.players[state.currentIndex].sips;
    state.drinkCounter = Math.min(max, Math.max(0, state.drinkCounter + delta));
    emit();
  }

  // 🍺 adds 10 per tap, clamped to the player's sips (35 sips, three taps:
  // 10 -> 20 -> 30; a fourth tops out at 35).
  function beerCounter() {
    if (state.screen !== "DRINK") return;
    const max = state.players[state.currentIndex].sips;
    state.drinkCounter = Math.min(max, state.drinkCounter + BEER_COUNTER_VALUE);
    emit();
  }

  // 1 Sip = 1 point, floored at 0. Proceeds to the dice phase.
  function drink(n) {
    if (state.screen !== "DRINK") return;
    const p = state.players[state.currentIndex];
    p.sips = Math.max(0, p.sips - Math.max(0, Math.floor(n)));
    state.screen = throwScreen();
    emit();
  }

  function confirmDrink() {
    drink(state.drinkCounter);
  }

  // Successful duik: every OTHER player doubles (0 stays 0), diver unchanged.
  function diveDoubleOthers() {
    state.players.forEach((p, i) => {
      if (i !== state.currentIndex) p.sips *= 2;
    });
    state.popup = { type: "dive" };
    state.screen = "SCOREBOARD";
  }

  // ---- OFFLINE (score-keeping only) ----
  //
  // The players throw real dice and know the rules themselves; the app just
  // books the sips. Exactly one player can be armed at a time, because every
  // Dertigen payout goes to exactly one player: under 30 the thrower, over 30
  // the player before them. A dive doubles everyone, which the table settles
  // for itself — hence a free counter rather than the band logic.

  function setOfflineTarget(target) {
    if (state.screen !== "OFFLINE") return;
    if (target !== "current" && target !== "prev") return;
    state.offlineTarget = target;
    emit();
  }

  function adjustOfflineCounter(delta) {
    if (state.screen !== "OFFLINE") return;
    state.offlineCounter = Math.max(0, state.offlineCounter + Math.trunc(delta));
    emit();
  }

  // Books the counter onto the armed player and closes the turn. 0 is a legal
  // outcome (a total of exactly 30 pays nobody), so Continue is never blocked.
  function confirmOffline() {
    if (state.screen !== "OFFLINE") return;
    const i = state.offlineTarget === "prev" ? prevIndex() : state.currentIndex;
    state.players[i].sips += state.offlineCounter;
    state.screen = "SCOREBOARD";
    emit();
  }

  // The one payout the counter can't express: a dive doubles everyone else.
  // Asks first ("Did X successfully dive?") since it can't be booked by
  // accident-and-adjust like the counter can.
  function offlineDive() {
    if (state.screen !== "OFFLINE" || state.popup) return;
    state.popup = { type: "dive-confirm" };
    emit();
  }

  function confirmOfflineDive() {
    if (state.screen !== "OFFLINE" || !state.popup || state.popup.type !== "dive-confirm") return;
    diveDoubleOthers();
    emit();
  }

  function cancelOfflineDive() {
    if (!state.popup || state.popup.type !== "dive-confirm") return;
    state.popup = null;
    emit();
  }

  // ---- DICE_TURN ----

  function throwDice() {
    if (state.screen !== "DICE_TURN" || state.popup) return;
    if (state.lastThrow || state.turnComplete) return;
    state.lastThrow = Array.from({ length: state.dicePool }, () => rollDie(rng));
    state.throwsTaken += 1;
    state.throwSeq += 1;
    emit();
  }

  // The player picks exactly ONE face value; ALL dice showing it are set
  // aside. Throws on an illegal pick (per spec) — the UI only offers legal
  // values, so this surfacing means a caller bug.
  function pickValue(v) {
    if (state.screen !== "DICE_TURN" || !state.lastThrow) {
      throw new Error("pickValue: no throw to pick from");
    }
    if (!state.lastThrow.includes(v)) {
      throw new Error(`pickValue: no ${v} in the current throw`);
    }
    const taken = state.lastThrow.filter((d) => d === v);
    state.setAside.push(...taken);
    state.dicePool -= taken.length;
    state.lastThrow = null;
    state.lastPick = { value: v, count: taken.length };
    state.pickSeq += 1;
    if (state.setAside.length === DICE_PER_TURN) {
      state.turnComplete = true;
    }
    emit();
  }

  // Fires the band logic once all 6 dice are aside. UI-scheduled (like
  // Mexen's advanceTurn) so the final pick can finish animating first.
  function resolveTurn() {
    if (state.screen !== "DICE_TURN" || !state.turnComplete) return;
    const total = state.setAside.reduce((a, b) => a + b, 0);

    if (total <= DIVE_MAX) {
      diveDoubleOthers();
    } else if (total < TARGET_TOTAL) {
      state.players[state.currentIndex].sips += TARGET_TOTAL - total;
      state.screen = "SCOREBOARD";
    } else if (total === TARGET_TOTAL) {
      state.screen = "SCOREBOARD";
    } else {
      // Base verschil is applied to the previous player the moment the hunt
      // starts; each hunted die adds incrementally in huntThrow() — the
      // scoreboard is always already correct, no settlement step.
      const verschil = total - TARGET_TOTAL; // always 1..6
      state.players[prevIndex()].sips += verschil;
      state.hunt = {
        wanted: verschil, // current hunted number
        baseVerschil: verschil,
        pointsToPrev: verschil, // includes the base verschil
        jokerUsed: false, // one joker per ENTIRE hunt — never resets, not even on escalation
        remaining: DICE_PER_TURN, // dice still to throw at the current level
        asideCount: 0, // dice set aside at the current level
        ended: false, // finishHunt() is UI-scheduled so the dead throw can be shown
        lastResult: null, // last throw's breakdown, for the UI animation
      };
      state.screen = "HUNT";
    }
    emit();
  }

  // ---- HUNT ----

  function huntThrow() {
    if (state.screen !== "HUNT" || state.popup || !state.hunt || state.hunt.ended) return;
    const h = state.hunt;
    const dice = Array.from({ length: h.remaining }, () => rollDie(rng));
    state.throwSeq += 1;

    const matchedCount = dice.filter((d) => d === h.wanted).length;
    const result = {
      dice,
      wanted: h.wanted,
      matchedCount,
      asideBefore: h.asideCount,
      escalated: false,
      joker: false,
      ended: false,
    };

    if (matchedCount > 0) {
      // Wanted dice are set aside automatically, each scoring the hunted
      // number (escalated dice thereby score their own face value).
      const points = matchedCount * h.wanted;
      h.pointsToPrev += points;
      state.players[prevIndex()].sips += points;
      h.remaining -= matchedCount;
      h.asideCount += matchedCount;
      if (h.remaining === 0) {
        // ESCALATE: next number, 6 fresh dice. A verschil of 6 stays at 6.
        h.wanted = Math.min(h.wanted + 1, 6);
        h.remaining = DICE_PER_TURN;
        h.asideCount = 0;
        result.escalated = true;
      }
    } else if (!h.jokerUsed) {
      // First dead throw of the ENTIRE hunt: joker — re-throw the same dice.
      h.jokerUsed = true;
      result.joker = true;
      state.popup = { type: "joker" };
    } else {
      // Any later dead throw ends the hunt immediately.
      h.ended = true;
      result.ended = true;
    }

    h.lastResult = result;
    emit();
  }

  // UI-scheduled after the hunt-ending throw has been shown for a beat.
  function finishHunt() {
    if (state.screen !== "HUNT" || !state.hunt || !state.hunt.ended) return;
    state.hunt = null;
    state.screen = "SCOREBOARD";
    emit();
  }

  // ---- SCOREBOARD / popups ----

  function dismissPopup() {
    if (!state.popup) return;
    state.popup = null;
    emit();
  }

  function advanceTurn() {
    if (state.screen !== "SCOREBOARD" || state.popup) return;
    state.currentIndex = (state.currentIndex + 1) % state.players.length;
    startTurn();
    emit();
  }

  // ---- back button ----

  function canGoBack() {
    return IN_GAME_SCREENS.includes(state.screen) && history.length >= 2 && !state.popup && !state.stopMenu;
  }

  // Drops the current visit and restores the previous one — a full undo of
  // everything that happened since, sips included. The animation counters
  // stay monotonic (the UI compares them against what it already played),
  // and turnSeq moves on so the UI treats the restored screen as fresh.
  function goBack() {
    if (!canGoBack()) return;
    history.pop();
    const throwSeq = state.throwSeq;
    const pickSeq = state.pickSeq;
    const turnSeq = state.turnSeq + 1;
    state = structuredClone(history[history.length - 1]);
    Object.assign(state, { throwSeq, pickSeq, turnSeq, popup: null, stopMenu: null });
    history[history.length - 1] = structuredClone(state);
    emit();
  }

  // ---- stop menu / quitting ----

  function openStopMenu() {
    if (!IN_GAME_SCREENS.includes(state.screen) || state.stopMenu) return;
    state.stopMenu = "menu";
    emit();
  }

  function stopChooseQuitGame() {
    if (state.stopMenu !== "menu") return;
    state.stopMenu = "confirm-game";
    emit();
  }

  function stopChooseQuitPlayer() {
    if (state.stopMenu !== "menu") return;
    state.stopMenu = "confirm-player";
    emit();
  }

  function stopCancel() {
    if (!state.stopMenu) return;
    state.stopMenu = null;
    emit();
  }

  // "No" on a confirmation goes back to the three-option menu.
  function stopBack() {
    if (state.stopMenu !== "confirm-game" && state.stopMenu !== "confirm-player") return;
    state.stopMenu = "menu";
    emit();
  }

  function stopConfirm() {
    if (state.stopMenu === "confirm-game") {
      quitGame();
    } else if (state.stopMenu === "confirm-player") {
      quitCurrentPlayer();
    }
  }

  // All state discarded; main.js navigates back to the landing page.
  function quitGame() {
    state.screen = "EXITED";
    history = [];
    state.players = null;
    state.turnStartSips = null;
    state.hunt = null;
    state.popup = null;
    state.stopMenu = null;
    emit();
  }

  // The current player is removed entirely; seating re-links across the
  // gap and play continues at the next player's TURN_START.
  //
  // Rollback window (Bram's ruling): during DRINK/DICE_TURN/HUNT the
  // in-progress turn is VOIDED — every remaining player's sips return to
  // the TURN_START snapshot. On SCOREBOARD the turn is already settled, so
  // its points (band, hunt, dive doubling) all stand.
  function quitCurrentPlayer() {
    if (!IN_GAME_SCREENS.includes(state.screen) || !state.players) return;

    if (state.screen !== "SCOREBOARD") {
      state.players.forEach((p, j) => {
        if (j !== state.currentIndex) p.sips = state.turnStartSips[j];
      });
    }
    state.players.splice(state.currentIndex, 1);
    history = []; // "can't be undone"
    state.popup = null;
    state.stopMenu = null;

    if (state.players.length < 2) {
      quitGame();
      return;
    }
    // The splice shifted the next player in turn order into the quitter's seat.
    state.currentIndex = state.currentIndex % state.players.length;
    startTurn();
    emit();
  }

  return {
    subscribe,
    getState,
    setPlayerCount,
    toggleDiceMode,
    goToNames,
    setName,
    startGame,
    adjustDrinkCounter,
    beerCounter,
    drink,
    confirmDrink,
    setOfflineTarget,
    adjustOfflineCounter,
    confirmOffline,
    offlineDive,
    confirmOfflineDive,
    cancelOfflineDive,
    throwDice,
    pickValue,
    resolveTurn,
    huntThrow,
    finishHunt,
    dismissPopup,
    advanceTurn,
    goBack,
    openStopMenu,
    stopChooseQuitGame,
    stopChooseQuitPlayer,
    stopCancel,
    stopBack,
    stopConfirm,
    quitGame,
    quitCurrentPlayer,
  };
}
