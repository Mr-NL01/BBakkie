import { PLAYER_COUNT, NAME_MAX_LENGTH, LABELS, TIMING } from "./config.js";
import { displayName } from "./engine.js";

// All DOM reads/writes live here. No game rules — only rendering a given
// engine state snapshot and exposing element references for main.js to
// attach listeners to.

let els = null;
let previousScreen = null;
let wakeLock = null;

export function init() {
  els = {
    screens: {
      HOME: document.getElementById("screen-home"),
      NAMES: document.getElementById("screen-names"),
      GAME: document.getElementById("screen-game"),
      THROWOFF: document.getElementById("screen-throwoff"),
      END: document.getElementById("screen-end"),
    },
    home: {
      playerMinus: document.getElementById("player-minus"),
      playerPlus: document.getElementById("player-plus"),
      playerCount: document.getElementById("player-count"),
      startButton: document.getElementById("home-start"),
    },
    names: {
      tableBody: document.querySelector("#names-table tbody"),
      startButton: document.getElementById("names-start"),
    },
    game: {
      turnView: document.getElementById("game-turn"),
      playerLabel: document.getElementById("game-player-label"),
      die0: document.getElementById("game-die-0"),
      die1: document.getElementById("game-die-1"),
      scoreLabel: document.getElementById("game-score-label"),
      throwButton: document.getElementById("game-throw"),
      throwOffSeqView: document.getElementById("game-throwoff-seq"),
      throwOffSeqLabel: document.getElementById("throwoff-seq-label"),
      throwOffSeqDie: document.getElementById("throwoff-seq-die"),
      throwOffSeqButton: document.getElementById("throwoff-seq-throw"),
    },
    throwOff: {
      topName: document.getElementById("throwoff-top-name"),
      topDie: document.getElementById("throwoff-top-die"),
      topButton: document.getElementById("throwoff-top-throw"),
      bottomName: document.getElementById("throwoff-bottom-name"),
      bottomDie: document.getElementById("throwoff-bottom-die"),
      bottomButton: document.getElementById("throwoff-bottom-throw"),
    },
    end: {
      tableBody: document.querySelector("#mexen-end-table tbody"),
      mexCount: document.getElementById("end-mex-count"),
      quitButton: document.getElementById("end-quit"),
      nextRoundButton: document.getElementById("end-next-round"),
    },
    popup: {
      overlay: document.getElementById("popup-overlay"),
      message: document.getElementById("popup-message"),
      continueButton: document.getElementById("popup-continue"),
    },
    quit: {
      overlay: document.getElementById("quit-overlay"),
      yesButton: document.getElementById("quit-yes"),
      noButton: document.getElementById("quit-no"),
    },
  };
  return els;
}

export function getElements() {
  return els;
}

// Screen Wake Lock is best-effort: unsupported browsers, desktop, or a
// denied request must never break the game, so every path is swallowed.
// Held from GAME entry through THROWOFF/END, released back on HOME (quitting
// always routes through HOME, so that path is covered too).
async function updateWakeLock(screen) {
  const shouldHold = screen === "GAME" || screen === "THROWOFF" || screen === "END";
  try {
    if (shouldHold && !wakeLock && "wakeLock" in navigator) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => {
        wakeLock = null;
      });
    } else if (!shouldHold && wakeLock) {
      const current = wakeLock;
      wakeLock = null;
      await current.release();
    }
  } catch (err) {
    wakeLock = null;
  }
}

function showScreen(name) {
  Object.entries(els.screens).forEach(([key, el]) => {
    el.classList.toggle("active", key === name);
  });
}

function renderHome(state) {
  els.home.playerCount.textContent = String(state.playerCount);
  els.home.playerMinus.disabled = state.playerCount <= PLAYER_COUNT.min;
  els.home.playerPlus.disabled = state.playerCount >= PLAYER_COUNT.max;
}

// Rebuilds the name-input rows. Only called when NAMES is freshly entered
// (see render()) — rebuilding on every keystroke would blow away input
// focus while the player is typing.
function renderNames(state) {
  els.names.tableBody.innerHTML = "";

  state.names.forEach((name, i) => {
    const tr = document.createElement("tr");

    const labelCell = document.createElement("td");
    labelCell.textContent = `Player ${i + 1}`;

    const inputCell = document.createElement("td");
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = NAME_MAX_LENGTH;
    input.value = name;
    input.placeholder = `Player ${i + 1}`;
    input.dataset.index = String(i);
    inputCell.appendChild(input);

    tr.append(labelCell, inputCell);
    els.names.tableBody.appendChild(tr);
  });
}

function nameWithRidder(state, playerIndex) {
  const name = displayName(state.names, playerIndex);
  return playerIndex === state.ridder ? `${name} ${LABELS.ridderSuffix}` : name;
}

function renderDie(el, value, isHeld) {
  el.textContent = value == null ? "" : String(value);
  el.classList.toggle("empty", value == null);
  el.classList.toggle("held", Boolean(isHeld));
}

// "62", "Mex!", "Ridder!", "31!" — reads only pre-computed engine flags, no
// scoring logic lives here.
function scoreDisplayText(turn) {
  if (!turn) return "";
  if (turn.isJokerPending) return "31!";
  const score = turn.lastScore;
  if (!score) return "";
  if (score.isMex) return "Mex!";
  if (score.is100) return "Ridder!";
  return String(score.code);
}

// Dice results are decided by the engine before this ever runs — this is
// pure theater, cycling a die's face through random values before locking
// to the true (already-known) result, the same idea as Inner Clock's intro
// count-up animating up to a precomputed target.
function tumbleDie(el, finalValue, durationMs, onDone) {
  el.classList.remove("empty");
  const start = performance.now();
  let lastTick = -Infinity;
  const tickIntervalMs = 90;

  function tick(now) {
    const elapsed = now - start;
    if (elapsed >= durationMs) {
      el.textContent = String(finalValue);
      onDone();
      return;
    }
    if (now - lastTick >= tickIntervalMs) {
      lastTick = now;
      el.textContent = String(1 + Math.floor(Math.random() * 6));
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// Runs several dice tumbles in parallel and fires onAllDone once every one
// of them has landed. Used with a single entry for a lone die (throw-off)
// or up to two for a normal turn.
function tumbleDice(entries, durationMs, onAllDone) {
  if (entries.length === 0) {
    onAllDone();
    return;
  }
  let remaining = entries.length;
  entries.forEach(({ el, finalValue }) => {
    tumbleDie(el, finalValue, durationMs, () => {
      remaining -= 1;
      if (remaining === 0) onAllDone();
    });
  });
}

// Tracks which turn instance (engine's turnSeq) and roll (rollSeq) have
// already been animated, so a re-render that isn't a fresh throw (e.g. the
// doubles popup being dismissed) just paints the settled state instead of
// tumbling again.
let animatedTurnSeq = null;
let animatedRollSeq = 0;

function renderNormalTurn(state, onSettled) {
  const turn = state.turn;
  els.game.playerLabel.textContent = nameWithRidder(state, state.currentPlayerIndex);

  if (state.turnSeq !== animatedTurnSeq) {
    animatedTurnSeq = state.turnSeq;
    animatedRollSeq = 0;
  }

  const dieEls = [els.game.die0, els.game.die1];
  const isHeldIndex = (i) => Boolean(turn.hold && turn.hold.dieIndex === i);

  const revealSettled = () => {
    for (let i = 0; i < 2; i++) {
      renderDie(dieEls[i], turn.dice ? turn.dice[i] : null, isHeldIndex(i));
    }
    els.game.scoreLabel.textContent = scoreDisplayText(turn);
    els.game.throwButton.classList.toggle("invisible", !(!state.popup && !turn.isDone));
    onSettled();
  };

  const isNewRoll = turn.rollSeq > 0 && turn.rollSeq !== animatedRollSeq;
  if (!isNewRoll) {
    revealSettled();
    return;
  }
  animatedRollSeq = turn.rollSeq;

  // The held die (if any) is static and shows immediately; only the
  // rolled index/indices tumble. A die that's being rolled can't
  // simultaneously be held — clear any stale "held" ring left over from a
  // previous throw (e.g. this is the "pick up both dice" throw right after
  // a hold ended), since tumbleDie only touches textContent.
  for (let i = 0; i < 2; i++) {
    if (turn.rolledIndices.includes(i)) {
      dieEls[i].classList.remove("held");
    } else {
      renderDie(dieEls[i], turn.dice[i], isHeldIndex(i));
    }
  }
  els.game.scoreLabel.textContent = "";
  els.game.throwButton.classList.add("invisible");

  const entries = turn.rolledIndices.map((i) => ({ el: dieEls[i], finalValue: turn.dice[i] }));
  tumbleDice(entries, TIMING.diceAnimationMs, revealSettled);
}

// 3+ tie throw-off, one candidate at a time on the normal game screen.
// awaitingAck marks a roll that hasn't been shown yet; animatedFor tracks
// which player's roll we've already tumbled this sub-round so a later
// re-render (e.g. nothing changed) doesn't replay it.
let throwOffSeqAnimatedFor = null;

function renderThrowOffSequential(state, onSettled) {
  const t = state.round.throwOff;
  if (Object.keys(t.rolls).length === 0) throwOffSeqAnimatedFor = null;

  if (t.awaitingAck && t.lastRolledPlayerIndex !== throwOffSeqAnimatedFor) {
    throwOffSeqAnimatedFor = t.lastRolledPlayerIndex;
    const playerIndex = t.lastRolledPlayerIndex;
    els.game.throwOffSeqLabel.textContent = displayName(state.names, playerIndex);
    els.game.throwOffSeqButton.classList.add("invisible");
    tumbleDice([{ el: els.game.throwOffSeqDie, finalValue: t.rolls[playerIndex] }], TIMING.diceAnimationMs, () => {
      renderDie(els.game.throwOffSeqDie, t.rolls[playerIndex], false);
      onSettled();
    });
    return;
  }

  let displayPlayer;
  let showButton;
  if (t.awaitingAck) {
    displayPlayer = t.lastRolledPlayerIndex;
    showButton = false;
  } else {
    const pending = t.candidates.find((p) => t.rolls[p] == null);
    displayPlayer = pending !== undefined ? pending : t.lastRolledPlayerIndex;
    showButton = pending !== undefined;
  }

  els.game.throwOffSeqLabel.textContent = displayName(state.names, displayPlayer);
  renderDie(els.game.throwOffSeqDie, displayPlayer == null ? null : t.rolls[displayPlayer] ?? null, false);
  els.game.throwOffSeqButton.classList.toggle("invisible", !showButton);
  els.game.throwOffSeqButton.dataset.playerIndex = showButton ? String(displayPlayer) : "";
  onSettled();
}

function renderGame(state, onSettled) {
  const inThrowOffSeq = Boolean(state.round && state.round.throwOff);
  els.game.turnView.classList.toggle("active", !inThrowOffSeq);
  els.game.throwOffSeqView.classList.toggle("active", inThrowOffSeq);

  if (inThrowOffSeq) {
    renderThrowOffSequential(state, onSettled);
  } else {
    renderNormalTurn(state, onSettled);
  }
}

// 2-player split screen. Both halves render independently and can tumble
// simultaneously — unlike the sequential fallback there's no single shared
// display slot, so each side just tracks its own "already animated" state.
let throwOffSplitAnimated = new Set();

function renderThrowoff(state, onSettled) {
  const t = state.round.throwOff;
  if (Object.keys(t.rolls).length === 0) throwOffSplitAnimated.clear();

  const [top, bottom] = t.candidates;
  let pending = 0;
  const maybeSettled = () => {
    if (pending === 0) onSettled();
  };

  const renderHalf = (playerIndex, nameEl, dieEl, buttonEl) => {
    nameEl.textContent = displayName(state.names, playerIndex);
    const value = t.rolls[playerIndex];

    if (value != null && !throwOffSplitAnimated.has(playerIndex)) {
      throwOffSplitAnimated.add(playerIndex);
      buttonEl.classList.add("invisible");
      pending += 1;
      tumbleDice([{ el: dieEl, finalValue: value }], TIMING.diceAnimationMs, () => {
        renderDie(dieEl, value, false);
        pending -= 1;
        maybeSettled();
      });
    } else {
      renderDie(dieEl, value ?? null, false);
      buttonEl.classList.toggle("invisible", value != null);
    }
  };

  renderHalf(top, els.throwOff.topName, els.throwOff.topDie, els.throwOff.topButton);
  renderHalf(bottom, els.throwOff.bottomName, els.throwOff.bottomDie, els.throwOff.bottomButton);

  maybeSettled();
}

function endScoreText(score) {
  return score.isMex ? `Mex ${LABELS.mexFireSuffix}` : String(score.code);
}

function renderEnd(state) {
  const round = state.round;
  const originalCandidates = round.throwOffOriginalCandidates;
  const throwOffWinner =
    originalCandidates && originalCandidates.length === 2
      ? originalCandidates.find((p) => p !== round.loserIndex)
      : null;

  els.end.tableBody.innerHTML = "";
  round.results.forEach(({ playerIndex, score }) => {
    const tr = document.createElement("tr");
    if (playerIndex === round.loserIndex) tr.classList.add("row-loser");

    const nameCell = document.createElement("td");
    let nameText = nameWithRidder(state, playerIndex);
    if (playerIndex === throwOffWinner) nameText += " ✅";
    if (playerIndex === round.loserIndex && originalCandidates) nameText += " ❌";
    nameCell.textContent = nameText;

    const scoreCell = document.createElement("td");
    scoreCell.textContent = endScoreText(score);

    tr.append(nameCell, scoreCell);
    els.end.tableBody.appendChild(tr);
  });

  if (round.mexCount > 0) {
    els.end.mexCount.textContent = `${round.mexCount} Mex!!`;
    els.end.mexCount.classList.remove("hidden");
  } else {
    els.end.mexCount.textContent = "";
    els.end.mexCount.classList.add("hidden");
  }
}

function renderPopup(state) {
  els.popup.overlay.classList.toggle("active", Boolean(state.popup));
  if (state.popup) els.popup.message.textContent = state.popup.message;
}

function renderQuitDialog(state) {
  els.quit.overlay.classList.toggle("active", state.quitDialogOpen);
}

// onSettled fires once whatever this render needed to show is fully
// revealed — immediately if there's nothing to animate, or after any dice
// tumble completes. main.js defers the popup reveal and its auto-advance
// timers until then, so nothing appears before the dice have visually
// landed.
export function render(state, onSettled = () => {}) {
  const changedScreen = state.screen !== previousScreen;
  showScreen(state.screen);
  updateWakeLock(state.screen);

  if (state.screen === "HOME") renderHome(state);
  if (state.screen === "NAMES" && changedScreen) renderNames(state);
  if (state.screen === "END") renderEnd(state);

  renderQuitDialog(state);
  previousScreen = state.screen;

  const settle = () => {
    renderPopup(state);
    onSettled();
  };

  if (state.screen === "GAME") {
    renderGame(state, settle);
  } else if (state.screen === "THROWOFF") {
    renderThrowoff(state, settle);
  } else {
    settle();
  }
}
