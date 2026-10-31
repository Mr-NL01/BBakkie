import { PLAYER_COUNT, NAME_MAX_LENGTH, DICE_PER_TURN, TIMING } from "./config.js";

// All DOM reads/writes live here. No game rules — only rendering a given
// engine state snapshot and exposing element references for main.js to
// attach listeners to. Same contract as Mexen's ui.js: render(state,
// onSettled) fires onSettled exactly once, after any animation this render
// needed has fully played out.

let els = null;
let previousScreen = null;
let wakeLock = null;

// Animation bookkeeping (mirrors Mexen's animatedTurnSeq/rollSeq idea).
let renderedTurnSeq = null;
let animatedThrowSeq = 0;
let animatedPickSeq = 0;
let diceEls = []; // live dice elements in the DICE_TURN throw area
let huntDiceEls = []; // live dice elements in the HUNT throw area
let selectedValue = null; // forced-pick selection (UI-only state)
let pickEnabled = false; // taps ignored while dice are tumbling
let animationsInFlight = 0; // DICE_TURN/HUNT renders whose settle() hasn't fired yet

const IN_GAME_SCREENS = ["DRINK", "DICE_TURN", "HUNT", "OFFLINE", "SCOREBOARD"];

export function init() {
  els = {
    screens: {
      HOME: document.getElementById("screen-home"),
      NAMES: document.getElementById("screen-names"),
      DRINK: document.getElementById("screen-drink"),
      OFFLINE: document.getElementById("screen-offline"),
      DICE_TURN: document.getElementById("screen-dice"),
      HUNT: document.getElementById("screen-hunt"),
      SCOREBOARD: document.getElementById("screen-scoreboard"),
    },
    stopButton: document.getElementById("stop-btn"),
    backButton: document.getElementById("back-btn"),
    home: {
      playerMinus: document.getElementById("player-minus"),
      playerPlus: document.getElementById("player-plus"),
      playerCount: document.getElementById("player-count"),
      startButton: document.getElementById("home-start"),
      diceModeToggle: document.getElementById("dice-mode-toggle"),
      diceModeLabels: Array.from(document.querySelectorAll(".dice-mode-label")),
    },
    names: {
      tableBody: document.querySelector("#names-table tbody"),
      startButton: document.getElementById("names-start"),
    },
    drink: {
      player: document.getElementById("drink-player"),
      sips: document.getElementById("drink-sips"),
      minus: document.getElementById("drink-minus"),
      count: document.getElementById("drink-count"),
      plus: document.getElementById("drink-plus"),
      beer: document.getElementById("drink-beer"),
      confirmButton: document.getElementById("drink-confirm"),
    },
    offline: {
      diveButton: document.getElementById("offline-dive"),
      players: Array.from(document.querySelectorAll("#screen-offline .offline-player")),
      nameCurrent: document.getElementById("offline-name-current"),
      namePrev: document.getElementById("offline-name-prev"),
      counter: document.querySelector("#screen-offline .offline-counter"),
      count: document.getElementById("offline-count"),
      continueButton: document.getElementById("offline-continue"),
    },
    dice: {
      player: document.getElementById("dice-player"),
      total: document.getElementById("dice-total"),
      asideRow: document.getElementById("dice-aside"),
      area: document.getElementById("dice-area"),
      throwButton: document.getElementById("dice-throw"),
      continueButton: document.getElementById("dice-continue"),
    },
    hunt: {
      player: document.getElementById("hunt-player"),
      target: document.getElementById("hunt-target"),
      asideRow: document.getElementById("hunt-aside"),
      area: document.getElementById("hunt-area"),
      points: document.getElementById("hunt-points"),
      throwButton: document.getElementById("hunt-throw"),
    },
    board: {
      tableBody: document.querySelector("#score-table tbody"),
      continueButton: document.getElementById("board-continue"),
    },
    dive: {
      overlay: document.getElementById("dive-overlay"),
      continueButton: document.getElementById("dive-continue"),
    },
    diveConfirm: {
      overlay: document.getElementById("dive-confirm-overlay"),
      title: document.getElementById("dive-confirm-title"),
      yes: document.getElementById("dive-confirm-yes"),
      no: document.getElementById("dive-confirm-no"),
    },
    joker: {
      overlay: document.getElementById("joker-overlay"),
    },
    stop: {
      overlay: document.getElementById("stop-overlay"),
      quitGameButton: document.getElementById("stop-quit-game"),
      quitPlayerButton: document.getElementById("stop-quit-player"),
      continueButton: document.getElementById("stop-continue"),
      confirmOverlay: document.getElementById("stop-confirm-overlay"),
      confirmYes: document.getElementById("stop-confirm-yes"),
      confirmNo: document.getElementById("stop-confirm-no"),
    },
  };
  return els;
}

export function getElements() {
  return els;
}

// True while dice are tumbling/flying. main.js ignores the back button then:
// leaving mid-animation would let the stale chain paint over the new screen.
export function isAnimating() {
  return animationsInFlight > 0;
}

// ---- pip dice ----

// 3x3 grid cells 0..8; classic die pip layout per face value.
const PIP_MAP = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function createDieEl() {
  const die = document.createElement("div");
  die.className = "die";
  for (let i = 0; i < 9; i++) {
    die.appendChild(document.createElement("span")).className = "pip";
  }
  return die;
}

function setDieFace(el, value) {
  el.dataset.value = String(value);
  el.classList.remove("empty");
  const on = PIP_MAP[value] || [];
  Array.from(el.children).forEach((pip, i) => {
    pip.classList.toggle("on", on.includes(i));
  });
}

function setDieEmpty(el) {
  delete el.dataset.value;
  el.classList.add("empty");
  el.classList.remove("settled", "selected", "matched", "dead", "slot-pop");
  Array.from(el.children).forEach((pip) => pip.classList.remove("on"));
}

// Ensures a row holds exactly 6 slot dice; returns them.
function ensureSlots(rowEl) {
  while (rowEl.children.length < DICE_PER_TURN) {
    const slot = createDieEl();
    setDieEmpty(slot);
    rowEl.appendChild(slot);
  }
  return Array.from(rowEl.children);
}

// Paints the first `count` slots with faces from `values` (a single value
// is repeated — the hunt case), the rest empty.
function paintSlots(rowEl, values, count) {
  ensureSlots(rowEl).forEach((slot, i) => {
    if (i < count) {
      setDieFace(slot, Array.isArray(values) ? values[i] : values);
    } else {
      setDieEmpty(slot);
    }
  });
}

// ---- roll animation ----

// The result is decided by the engine before this runs — pure theater.
// CSS handles the physical tumble (randomized per-die duration/phase);
// this cycles the pip face at a decelerating pace, then settles with a
// bounce, like a real die running out of momentum.
function tumbleDie(el, finalValue, durationMs, onDone) {
  el.classList.remove("settled", "selected", "matched", "dead");
  el.classList.add("rolling");
  el.style.animationDuration = `${(0.8 + Math.random() * 0.3).toFixed(2)}s`;
  el.style.animationDelay = `${(-Math.random() * 0.4).toFixed(2)}s`;

  const start = performance.now();
  let nextTick = 0;
  let interval = 70;

  function tick(now) {
    const elapsed = now - start;
    if (elapsed >= durationMs) {
      setDieFace(el, finalValue);
      el.classList.remove("rolling");
      el.style.animationDuration = "";
      el.style.animationDelay = "";
      el.classList.add("settled");
      onDone();
      return;
    }
    if (elapsed >= nextTick) {
      setDieFace(el, 1 + Math.floor(Math.random() * 6));
      interval *= 1.12;
      nextTick = elapsed + interval;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function tumbleAll(entries, durationMs, onAllDone) {
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

// ---- fly-to-aside animation (FLIP clones) ----

function flyDie(fromEl, toSlot, value, onDone) {
  const from = fromEl.getBoundingClientRect();
  const to = toSlot.getBoundingClientRect();

  const clone = createDieEl();
  setDieFace(clone, value);
  clone.classList.add("fly-clone");
  clone.style.width = `${from.width}px`;
  clone.style.height = `${from.height}px`;
  clone.style.left = `${from.left}px`;
  clone.style.top = `${from.top}px`;
  document.body.appendChild(clone);
  fromEl.classList.add("picked-away");

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const scale = to.width / from.width;
      clone.style.transform = `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${scale})`;
    });
  });

  window.setTimeout(() => {
    clone.remove();
    setDieFace(toSlot, value);
    toSlot.classList.add("slot-pop");
    onDone();
  }, TIMING.pickFlyMs + 60);
}

function flyAll(pairs, value, onAllDone) {
  if (pairs.length === 0) {
    onAllDone();
    return;
  }
  let remaining = pairs.length;
  pairs.forEach(({ fromEl, toSlot }) => {
    flyDie(fromEl, toSlot, value, () => {
      remaining -= 1;
      if (remaining === 0) onAllDone();
    });
  });
}

// ---- selection (forced pick) ----

// Tapping one die highlights ALL dice of that value — the pick is always
// the whole set, per the rules.
export function selectFromDie(dieEl) {
  if (!pickEnabled || !dieEl.dataset.value) return;
  selectedValue = Number(dieEl.dataset.value);
  paintSelection();
  els.dice.continueButton.disabled = false;
}

export function getSelectedValue() {
  return selectedValue;
}

function paintSelection() {
  diceEls.forEach((el) => {
    el.classList.toggle("selected", selectedValue !== null && Number(el.dataset.value) === selectedValue);
  });
}

function rebuildArea(areaEl, values, listRef) {
  areaEl.innerHTML = "";
  listRef.length = 0;
  values.forEach((v) => {
    const die = createDieEl();
    setDieFace(die, v);
    areaEl.appendChild(die);
    listRef.push(die);
  });
}

// ---- wake lock (best-effort, copied pattern from Mexen) ----

async function updateWakeLock(screen) {
  const shouldHold = IN_GAME_SCREENS.includes(screen);
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

// ---- per-screen renderers ----

function showScreen(name) {
  Object.entries(els.screens).forEach(([key, el]) => {
    el.classList.toggle("active", key === name);
  });
}

function renderHome(state) {
  els.home.playerCount.textContent = String(state.playerCount);
  els.home.playerMinus.disabled = state.playerCount <= PLAYER_COUNT.min;
  els.home.playerPlus.disabled = state.playerCount >= PLAYER_COUNT.max;

  const screenDice = state.diceMode === "screen";
  els.home.diceModeToggle.classList.toggle("on", screenDice);
  els.home.diceModeToggle.setAttribute("aria-checked", String(screenDice));
  els.home.diceModeLabels.forEach((lbl) => {
    lbl.classList.toggle("active", lbl.dataset.mode === state.diceMode);
  });
}

// Rebuilds the name-input rows. Only called when NAMES is freshly entered —
// rebuilding on every keystroke would blow away input focus.
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

function renderDrink(state) {
  const p = state.players[state.currentIndex];
  els.drink.player.textContent = p.name;
  els.drink.sips.textContent = `${p.sips} Sips`;
  els.drink.count.textContent = String(state.drinkCounter);
  els.drink.minus.disabled = state.drinkCounter <= 0;
  els.drink.plus.disabled = state.drinkCounter >= p.sips;
}

// Offline mode's whole turn: who threw, who they throw for (the seat before
// them), and how many sips the table decided that costs. Exactly one name is
// armed at a time.
function renderOffline(state) {
  els.offline.nameCurrent.textContent = state.players[state.currentIndex].name;
  els.offline.namePrev.textContent = state.players[state.prevIndex].name;
  els.offline.players.forEach((btn) => {
    btn.classList.toggle("armed", btn.dataset.target === state.offlineTarget);
  });
  els.offline.count.textContent = String(state.offlineCounter);
  els.offline.counter.querySelectorAll("[data-delta]").forEach((btn) => {
    // Only the decrements can run out of room; Continue at 0 is always legal.
    btn.disabled = Number(btn.dataset.delta) < 0 && state.offlineCounter === 0;
  });
}

function renderScoreboard(state) {

  els.board.tableBody.innerHTML = "";
  state.players.forEach((p) => {
    const tr = document.createElement("tr");
    const nameCell = document.createElement("td");
    nameCell.textContent = p.name;
    const sipsCell = document.createElement("td");
    sipsCell.textContent = String(p.sips);
    tr.append(nameCell, sipsCell);
    els.board.tableBody.appendChild(tr);
  });
}

function sumDice(values) {
  return values.reduce((a, b) => a + b, 0);
}

function paintTotal(n) {
  els.dice.total.textContent = `Total: ${n}`;
}

function setActionButtons(showGooien, showContinue) {
  els.dice.throwButton.classList.toggle("invisible", !showGooien);
  els.dice.continueButton.classList.toggle("invisible", !showContinue);
  if (!showContinue) els.dice.continueButton.disabled = true;
}

function renderDiceTurn(state, settle) {
  if (state.turnSeq !== renderedTurnSeq) {
    renderedTurnSeq = state.turnSeq;
    animatedThrowSeq = state.throwSeq;
    animatedPickSeq = state.pickSeq;
    selectedValue = null;
    pickEnabled = false;
    diceEls = [];
    els.dice.area.innerHTML = "";
    paintSlots(els.dice.asideRow, state.setAside, 0);
  }

  els.dice.player.textContent = state.players[state.currentIndex].name;
  paintTotal(sumDice(state.setAside));

  // A) fresh throw — tumble the dice, then open the pick.
  if (state.lastThrow && state.throwSeq !== animatedThrowSeq) {
    animatedThrowSeq = state.throwSeq;
    selectedValue = null;
    pickEnabled = false;
    paintSlots(els.dice.asideRow, state.setAside, state.setAside.length);
    rebuildArea(els.dice.area, state.lastThrow, diceEls);
    setActionButtons(false, false);
    const entries = diceEls.map((el, i) => ({ el, finalValue: state.lastThrow[i] }));
    tumbleAll(entries, TIMING.diceAnimationMs, () => {
      pickEnabled = true;
      setActionButtons(false, true);
      els.dice.continueButton.disabled = true; // until a die is tapped
      settle();
    });
    return;
  }

  // B) confirmed pick — the chosen dice fly to the set-aside row.
  if (state.lastPick && state.pickSeq !== animatedPickSeq) {
    animatedPickSeq = state.pickSeq;
    pickEnabled = false;
    setActionButtons(false, false);
    const { value, count } = state.lastPick;
    const asideBefore = state.setAside.length - count;
    paintSlots(els.dice.asideRow, state.setAside, asideBefore);
    paintTotal(sumDice(state.setAside) - value * count); // counts up as the dice land
    const slots = ensureSlots(els.dice.asideRow);
    const sources = diceEls.filter((el) => Number(el.dataset.value) === value);
    const pairs = sources.map((fromEl, i) => ({ fromEl, toSlot: slots[asideBefore + i] }));
    flyAll(pairs, value, () => {
      sources.forEach((el) => el.remove());
      diceEls = diceEls.filter((el) => !sources.includes(el));
      paintSlots(els.dice.asideRow, state.setAside, state.setAside.length);
      paintTotal(sumDice(state.setAside));
      settle();
    });
    return;
  }

  // C/D) no new animation — paint the settled truth.
  paintSlots(els.dice.asideRow, state.setAside, state.setAside.length);
  if (state.lastThrow) {
    if (diceEls.length !== state.lastThrow.length) {
      rebuildArea(els.dice.area, state.lastThrow, diceEls);
    } else {
      state.lastThrow.forEach((v, i) => setDieFace(diceEls[i], v));
    }
    pickEnabled = true;
    paintSelection();
    setActionButtons(false, true);
    els.dice.continueButton.disabled = selectedValue === null;
  } else if (state.turnComplete) {
    setActionButtons(false, false); // resolveTurn is on its way
  } else if (state.setAside.length === 0) {
    setActionButtons(true, false); // opening throw of the turn
  } else {
    setActionButtons(false, false); // automatic next throw is on its way
  }
  settle();
}

function renderHunt(state, settle) {
  const h = state.hunt;
  if (!h) {
    settle();
    return;
  }
  const prevName = state.players[state.prevIndex].name;
  els.hunt.player.textContent = state.players[state.currentIndex].name;

  const enteredHunt = previousScreen !== "HUNT";
  if (enteredHunt) {
    huntDiceEls = [];
    els.hunt.area.innerHTML = "";
  }

  // Fresh hunt throw: tumble, glow the matches, fly them aside, maybe
  // escalate — all before the settled repaint.
  if (h.lastResult && state.throwSeq !== animatedThrowSeq) {
    animatedThrowSeq = state.throwSeq;
    const r = h.lastResult;
    const pointsBefore = h.pointsToPrev - r.matchedCount * r.wanted;
    els.hunt.target.textContent = `Hunting ${r.wanted}s`;
    els.hunt.points.textContent = `+${pointsBefore} to ${prevName}`;
    paintSlots(els.hunt.asideRow, r.wanted, r.asideBefore);
    rebuildArea(els.hunt.area, r.dice, huntDiceEls);
    els.hunt.throwButton.classList.add("invisible");

    const entries = huntDiceEls.map((el, i) => ({ el, finalValue: r.dice[i] }));
    tumbleAll(entries, TIMING.diceAnimationMs, () => {
      if (r.matchedCount === 0) {
        huntDiceEls.forEach((el) => el.classList.add("dead"));
        // joker: the popup appears via settle(); ended: main.js takes it
        // to the scoreboard after a beat. Gooien stays hidden either way
        // until the next settled repaint.
        settle();
        return;
      }

      const matched = huntDiceEls.filter((el) => Number(el.dataset.value) === r.wanted);
      matched.forEach((el) => el.classList.add("matched"));
      window.setTimeout(() => {
        const slots = ensureSlots(els.hunt.asideRow);
        const pairs = matched.map((fromEl, i) => ({ fromEl, toSlot: slots[r.asideBefore + i] }));
        flyAll(pairs, r.wanted, () => {
          matched.forEach((el) => el.remove());
          huntDiceEls = huntDiceEls.filter((el) => !matched.includes(el));
          els.hunt.points.textContent = `+${h.pointsToPrev} to ${prevName}`;
          if (!r.escalated) {
            els.hunt.throwButton.classList.remove("invisible");
            settle();
            return;
          }
          // Full level: show the completed row for a beat, then clear it
          // and flash the new hunted number.
          window.setTimeout(() => {
            paintSlots(els.hunt.asideRow, h.wanted, 0);
            els.hunt.target.textContent = `Hunting ${h.wanted}s`;
            els.hunt.target.classList.add("level-up");
            window.setTimeout(() => els.hunt.target.classList.remove("level-up"), 650);
            els.hunt.throwButton.classList.remove("invisible");
            settle();
          }, TIMING.escalatePauseMs);
        });
      }, TIMING.matchGlowMs);
    });
    return;
  }

  // Settled repaint (hunt entry, joker dismissed, stop menu closed...).
  els.hunt.target.textContent = `Hunting ${h.wanted}s`;
  els.hunt.points.textContent = `+${h.pointsToPrev} to ${prevName}`;
  paintSlots(els.hunt.asideRow, h.wanted, h.asideCount);
  els.hunt.throwButton.classList.toggle("invisible", h.ended || Boolean(state.popup));
  settle();
}

function renderPopups(state) {
  els.dive.overlay.classList.toggle("active", Boolean(state.popup && state.popup.type === "dive"));
  els.joker.overlay.classList.toggle("active", Boolean(state.popup && state.popup.type === "joker"));
  const confirmingDive = Boolean(state.popup && state.popup.type === "dive-confirm");
  els.diveConfirm.overlay.classList.toggle("active", confirmingDive);
  if (confirmingDive) {
    els.diveConfirm.title.textContent = `Did ${state.players[state.currentIndex].name} successfully dive?`;
  }
}

function renderStop(state) {
  els.stopButton.classList.toggle("hidden", !IN_GAME_SCREENS.includes(state.screen));
  els.backButton.classList.toggle("hidden", !state.canGoBack);
  els.stop.overlay.classList.toggle("active", state.stopMenu === "menu");
  const confirming = state.stopMenu === "confirm-game" || state.stopMenu === "confirm-player";
  els.stop.confirmOverlay.classList.toggle("active", confirming);
  if (confirming) {
    // Yes matches the colour of the action being confirmed.
    els.stop.confirmYes.classList.toggle("btn-danger", state.stopMenu === "confirm-game");
    els.stop.confirmYes.classList.toggle("btn-warning", state.stopMenu === "confirm-player");
  }
}

// onSettled fires once whatever this render needed to show is fully
// revealed — immediately if there's nothing to animate, or after the
// tumble/fly chain completes. main.js defers popups and all auto-advance
// timers until then, so nothing outruns what's on screen.
export function render(state, onSettled = () => {}) {
  if (state.screen === "EXITED") {
    onSettled(); // main.js navigates back to the landing page
    return;
  }

  showScreen(state.screen);
  updateWakeLock(state.screen);

  if (state.screen === "HOME") renderHome(state);
  if (state.screen === "NAMES" && previousScreen !== "NAMES") renderNames(state);
  if (state.screen === "DRINK") renderDrink(state);
  if (state.screen === "OFFLINE") renderOffline(state);
  if (state.screen === "SCOREBOARD") renderScoreboard(state);

  renderStop(state);

  const screenForThisRender = state.screen;
  const settle = () => {
    renderPopups(state);
    onSettled();
  };

  if (state.screen === "DICE_TURN" || state.screen === "HUNT") {
    animationsInFlight += 1;
    const settleAnimated = () => {
      animationsInFlight -= 1;
      settle();
    };
    if (state.screen === "DICE_TURN") {
      previousScreen = screenForThisRender;
      renderDiceTurn(state, settleAnimated);
    } else {
      renderHunt(state, settleAnimated);
      previousScreen = screenForThisRender;
    }
  } else {
    previousScreen = screenForThisRender;
    settle();
  }
}
