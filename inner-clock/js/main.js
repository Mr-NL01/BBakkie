import { createEngine } from "./engine.js";
import * as ui from "./ui.js";

const engine = createEngine();

document.addEventListener("DOMContentLoaded", () => {
  const els = ui.init();
  engine.subscribe(ui.render);
  wireEvents(els);
  wireKeyboard(els);
});

// Best-effort: offline caching is a nicety, never block the game on it.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}

function wireEvents(els) {
  els.home.modeButtons.forEach((btn) => {
    btn.addEventListener("pointerdown", () => engine.setMode(btn.dataset.mode));
  });

  els.home.playerMinus.addEventListener("pointerdown", () => {
    engine.setPlayers(engine.getState().settings.players - 1);
  });
  els.home.playerPlus.addEventListener("pointerdown", () => {
    engine.setPlayers(engine.getState().settings.players + 1);
  });

  els.home.showTimeToggle.addEventListener("pointerdown", () => {
    engine.toggleShowTimeAfterRound();
  });

  els.home.startButton.addEventListener("pointerdown", () => engine.startGame());

  els.intro.continueButton.addEventListener("pointerdown", () => engine.introContinue());

  els.game.startButton.addEventListener("pointerdown", () => engine.startRound());
  els.game.stopArea.addEventListener("pointerdown", () => engine.stopRound());
  els.game.resultContinue.addEventListener("pointerdown", () => engine.resultContinue());

  els.end.backButton.addEventListener("pointerdown", () => engine.backToMenu());
}

// Spacebar mirrors the primary action button for the current screen:
// Start (HOME/READY), Continue (INTRO/RESULT), Stop (RUNNING), Back to menu (END).
function wireKeyboard(els) {
  document.addEventListener("keydown", (e) => {
    if (e.code !== "Space" || e.repeat) return;
    e.preventDefault();

    const screen = engine.getState().screen;
    if (screen === "HOME") engine.startGame();
    else if (screen === "INTRO") {
      if (!els.intro.continueButton.disabled) engine.introContinue();
    } else if (screen === "READY") engine.startRound();
    else if (screen === "RUNNING") engine.stopRound();
    else if (screen === "RESULT") engine.resultContinue();
    else if (screen === "END") engine.backToMenu();
  });
}
