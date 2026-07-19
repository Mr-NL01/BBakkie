import { MODES, DISPLAY } from "./config.js";

const RANGE_MODES = ["short", "medium"];

// All DOM reads/writes live here. No game rules — only rendering a given
// engine state snapshot and exposing element references for main.js to
// attach listeners to.

let els = null;
let previousScreen = null;
let introAnimationToken = 0;
let wakeLock = null;

// Screen Wake Lock is best-effort: unsupported browsers, desktop, or a
// denied request must never break the game, so every path is swallowed.
async function updateWakeLock(screen) {
  const shouldHold = screen !== "HOME" && screen !== "END" && screen !== "SETTINGS";
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

export function init() {
  els = {
    screens: {
      HOME: document.getElementById("screen-home"),
      SETTINGS: document.getElementById("screen-settings"),
      INTRO: document.getElementById("screen-intro"),
      GAME: document.getElementById("screen-game"),
      END: document.getElementById("screen-end"),
    },
    home: {
      modeButtons: Array.from(document.querySelectorAll("#mode-select .segment[data-mode]")),
      settingsOpenButton: document.getElementById("settings-open"),
      playerMinus: document.getElementById("player-minus"),
      playerPlus: document.getElementById("player-plus"),
      playerCount: document.getElementById("player-count"),
      showTimeToggle: document.getElementById("show-time-toggle"),
      startButton: document.getElementById("home-start"),
    },
    settings: {
      ranges: Object.fromEntries(
        RANGE_MODES.map((mode) => [
          mode,
          {
            minSlider: document.getElementById(`${mode}-min`),
            minValue: document.getElementById(`${mode}-min-value`),
            maxSlider: document.getElementById(`${mode}-max`),
            maxValue: document.getElementById(`${mode}-max-value`),
          },
        ])
      ),
      backButton: document.getElementById("settings-back"),
    },
    intro: {
      number: document.getElementById("intro-number"),
      continueButton: document.getElementById("intro-continue"),
    },
    game: {
      ready: document.getElementById("game-ready"),
      running: document.getElementById("game-running"),
      result: document.getElementById("game-result"),
      playerLabel: document.getElementById("game-player-label"),
      targetDisplay: document.getElementById("game-target-display"),
      startButton: document.getElementById("game-start"),
      stopArea: document.getElementById("game-running"),
      resultTime: document.getElementById("game-result-time"),
      resultContinue: document.getElementById("game-result-continue"),
    },
    end: {
      targetValue: document.getElementById("end-target-value"),
      tableBody: document.querySelector("#end-table tbody"),
      backButton: document.getElementById("end-back"),
    },
  };
  return els;
}

export function getElements() {
  return els;
}

function formatNumber(valueMs, decimals) {
  const seconds = valueMs / 1000;
  const fixed = seconds.toFixed(decimals);
  return DISPLAY.decimalSeparator === "," ? fixed.replace(".", ",") : fixed;
}

function showScreen(name) {
  Object.entries(els.screens).forEach(([key, el]) => {
    el.classList.toggle("active", key === name);
  });
}

function renderHome(state) {
  els.home.modeButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === state.settings.mode);
  });
  els.home.playerCount.textContent = String(state.settings.players);
  els.home.showTimeToggle.classList.toggle("on", state.settings.showTimeAfterRound);
  els.home.showTimeToggle.setAttribute("aria-checked", String(state.settings.showTimeAfterRound));
}

function formatSeconds(valueS) {
  const fixed = valueS.toFixed(1);
  return DISPLAY.decimalSeparator === "," ? fixed.replace(".", ",") : fixed;
}

function renderSettings(state) {
  RANGE_MODES.forEach((mode) => {
    const refs = els.settings.ranges[mode];
    const range = state.settings.ranges[mode];
    refs.minSlider.value = String(range.minS);
    refs.maxSlider.value = String(range.maxS);
    refs.minValue.textContent = `${formatSeconds(range.minS)}s`;
    refs.maxValue.textContent = `${formatSeconds(range.maxS)}s`;
  });
}

function runIntroAnimation(targetMs, decimals) {
  const token = ++introAnimationToken;
  els.intro.number.textContent = formatNumber(0, decimals);
  els.intro.continueButton.disabled = true;

  window.setTimeout(() => {
    if (token !== introAnimationToken) return; // superseded by a newer game
    const start = performance.now();
    const duration = DISPLAY.introAnimationMs;

    function tick() {
      if (token !== introAnimationToken) return;
      const elapsed = performance.now() - start;
      const progress = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      const shown = targetMs * eased;
      els.intro.number.textContent = formatNumber(shown, decimals);

      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        els.intro.number.textContent = formatNumber(targetMs, decimals);
        els.intro.continueButton.disabled = false;
      }
    }
    requestAnimationFrame(tick);
  }, 1000);
}

function renderIntro(state) {
  const decimals = MODES[state.settings.mode].decimals;
  if (previousScreen !== "INTRO") {
    runIntroAnimation(state.target, decimals);
  }
}

function renderGame(state) {
  els.game.ready.classList.toggle("active", state.screen === "READY");
  els.game.running.classList.toggle("active", state.screen === "RUNNING");
  els.game.result.classList.toggle("active", state.screen === "RESULT");

  els.game.playerLabel.textContent = `Player ${state.currentPlayer}`;

  if (state.screen === "READY") {
    const decimals = MODES[state.settings.mode].decimals;
    els.game.targetDisplay.textContent = formatNumber(state.target, decimals);
  }

  if (state.screen === "RESULT") {
    const decimals = MODES[state.settings.mode].decimals;
    els.game.resultTime.textContent = formatNumber(state.lastAchieved, decimals);
  }
}

function renderEnd(state) {
  const decimals = DISPLAY.endScreenDecimals;
  els.end.targetValue.textContent = formatNumber(state.target, decimals);
  els.end.tableBody.innerHTML = "";

  state.leaderboard.forEach((row) => {
    const tr = document.createElement("tr");
    if (row.highlight === "best") tr.classList.add("row-best");
    if (row.highlight === "worst") tr.classList.add("row-worst");

    const playerCell = document.createElement("td");
    playerCell.textContent = `${row.rank}. Player ${row.player}`;

    const timeCell = document.createElement("td");
    timeCell.textContent = formatNumber(row.achieved, decimals);

    const diffCell = document.createElement("td");
    diffCell.textContent = formatNumber(row.diff, decimals);

    tr.append(playerCell, timeCell, diffCell);
    els.end.tableBody.appendChild(tr);
  });
}

export function render(state) {
  const screenName =
    state.screen === "READY" || state.screen === "RUNNING" || state.screen === "RESULT"
      ? "GAME"
      : state.screen;

  showScreen(screenName);
  updateWakeLock(state.screen);

  if (state.screen === "HOME") renderHome(state);
  if (state.screen === "SETTINGS") renderSettings(state);
  if (state.screen === "INTRO") renderIntro(state);
  if (screenName === "GAME") renderGame(state);
  if (state.screen === "END") renderEnd(state);

  previousScreen = state.screen;
}
