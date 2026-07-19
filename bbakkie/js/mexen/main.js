import { createEngine } from "./engine.js";
import { TIMING } from "./config.js";
import * as ui from "./ui.js";

const engine = createEngine();

// All timer-driven engine calls (the "short beat" auto-advances) live here,
// not in ui.js — ui.js only renders DOM, engine.js has no timers/DOM. Each
// uses a token to invalidate a still-pending timer if a newer one is
// scheduled before it fires (mirrors Inner Clock's introAnimationToken).
let advanceTurnToken = 0;
let throwOffToken = 0;

function scheduleAutoAdvance(state) {
  if (state.screen === "GAME" && state.turn && state.turn.isDone && !state.popup) {
    const token = ++advanceTurnToken;
    window.setTimeout(() => {
      if (token !== advanceTurnToken) return;
      engine.advanceTurn();
    }, TIMING.resultPauseMs);
  }

  const throwOff = state.round && state.round.throwOff;
  if (throwOff && throwOff.awaitingAck) {
    const token = ++throwOffToken;
    window.setTimeout(() => {
      if (token !== throwOffToken) return;
      if (throwOff.resolved) {
        engine.advanceFromThrowOff();
      } else {
        engine.acknowledgeThrowOffRoll();
      }
    }, TIMING.resultPauseMs);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const els = ui.init();
  // scheduleAutoAdvance only runs once ui.render has finished revealing
  // this state — if a die is still tumbling, onSettled fires after it
  // lands, so the popup and the auto-advance timers never race ahead of
  // what's on screen. Reads fresh state via getState() rather than the
  // snapshot captured at subscribe time, in case anything changed while
  // the animation was in flight.
  engine.subscribe((state) => {
    ui.render(state, () => scheduleAutoAdvance(engine.getState()));
  });
  wireEvents(els);
});

// Best-effort: offline caching is a nicety, never block the game on it.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}

function wireEvents(els) {
  els.home.playerMinus.addEventListener("pointerdown", () => {
    engine.setPlayerCount(engine.getState().playerCount - 1);
  });
  els.home.playerPlus.addEventListener("pointerdown", () => {
    engine.setPlayerCount(engine.getState().playerCount + 1);
  });
  els.home.startButton.addEventListener("pointerdown", () => engine.goToNames());

  els.names.tableBody.addEventListener("input", (e) => {
    const input = e.target.closest("input[data-index]");
    if (!input) return;
    engine.setName(Number(input.dataset.index), input.value);
  });
  els.names.tableBody.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    if (!e.target.closest("input[data-index]")) return;
    e.preventDefault();
    engine.startGame();
  });
  els.names.startButton.addEventListener("pointerdown", () => engine.startGame());

  els.game.throwButton.addEventListener("pointerdown", () => engine.throwDice());

  els.game.throwOffSeqButton.addEventListener("pointerdown", () => {
    const idx = els.game.throwOffSeqButton.dataset.playerIndex;
    if (idx === "") return;
    engine.throwOffThrow(Number(idx));
  });

  els.throwOff.topButton.addEventListener("pointerdown", () => {
    const round = engine.getState().round;
    if (!round || !round.throwOff) return;
    engine.throwOffThrow(round.throwOff.candidates[0]);
  });
  els.throwOff.bottomButton.addEventListener("pointerdown", () => {
    const round = engine.getState().round;
    if (!round || !round.throwOff) return;
    engine.throwOffThrow(round.throwOff.candidates[1]);
  });

  els.popup.continueButton.addEventListener("pointerdown", () => engine.dismissPopup());

  els.end.quitButton.addEventListener("pointerdown", () => engine.openQuitDialog());
  els.end.nextRoundButton.addEventListener("pointerdown", () => engine.nextRound());
  els.quit.yesButton.addEventListener("pointerdown", () => engine.quitGame());
  els.quit.noButton.addEventListener("pointerdown", () => engine.cancelQuitDialog());
}
