import { createEngine } from "./engine.js";
import { TIMING } from "./config.js";
import * as ui from "./ui.js";

const engine = createEngine();

// All timer-driven engine calls live here, not in ui.js — ui.js only
// renders DOM, engine.js has no timers/DOM. Each timer uses a token to
// invalidate a still-pending run if a newer one is scheduled first, and
// re-checks fresh engine state at fire time (mirrors Mexen's main.js).
let autoThrowToken = 0;
let resolveToken = 0;
let jokerToken = 0;
let huntEndToken = 0;

function scheduleAutoActions(state) {
  if (state.screen === "EXITED") {
    window.location.href = "index.html";
    return;
  }

  // The 🃏 popup dismisses itself even under the stop menu — harmless, and
  // the hunt simply waits for the next Gooien.
  if (state.popup && state.popup.type === "joker") {
    const token = ++jokerToken;
    window.setTimeout(() => {
      if (token !== jokerToken) return;
      engine.dismissPopup();
    }, TIMING.jokerPopupMs);
  }

  // Everything below pauses while the stop menu is open: resolving the
  // turn mid-decision would close the quit-rollback window behind the
  // player's back. Closing the menu re-renders, which re-schedules.
  if (state.stopMenu) return;

  if (state.screen === "DICE_TURN" && !state.popup) {
    // Continue confirmed a pick -> the next throw comes automatically.
    if (!state.lastThrow && !state.turnComplete && state.setAside.length > 0) {
      const token = ++autoThrowToken;
      window.setTimeout(() => {
        if (token !== autoThrowToken) return;
        const s = engine.getState();
        if (s.screen === "DICE_TURN" && !s.stopMenu && !s.popup && !s.lastThrow && !s.turnComplete && s.setAside.length > 0) {
          engine.throwDice();
        }
      }, TIMING.nextThrowDelayMs);
    }
    // Sixth die set aside -> band logic after a short beat.
    if (state.turnComplete) {
      const token = ++resolveToken;
      window.setTimeout(() => {
        if (token !== resolveToken) return;
        const s = engine.getState();
        if (s.screen === "DICE_TURN" && !s.stopMenu && s.turnComplete) {
          engine.resolveTurn();
        }
      }, TIMING.resultPauseMs);
    }
  }

  // Hunt ended on a dead throw -> scoreboard after the dice have been seen.
  if (state.screen === "HUNT" && state.hunt && state.hunt.ended && !state.popup) {
    const token = ++huntEndToken;
    window.setTimeout(() => {
      if (token !== huntEndToken) return;
      const s = engine.getState();
      if (s.screen === "HUNT" && !s.stopMenu && s.hunt && s.hunt.ended) {
        engine.finishHunt();
      }
    }, TIMING.resultPauseMs);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const els = ui.init();
  // scheduleAutoActions only runs once ui.render has finished revealing
  // this state — if dice are still tumbling, onSettled fires after they
  // land, so popups and auto-advance timers never race ahead of what's on
  // screen. Reads fresh state via getState() rather than the snapshot
  // captured at subscribe time, in case anything changed mid-animation.
  engine.subscribe((state) => {
    ui.render(state, () => scheduleAutoActions(engine.getState()));
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
  // HOME
  els.home.playerMinus.addEventListener("pointerdown", () => {
    engine.setPlayerCount(engine.getState().playerCount - 1);
  });
  els.home.playerPlus.addEventListener("pointerdown", () => {
    engine.setPlayerCount(engine.getState().playerCount + 1);
  });
  els.home.diceModeToggle.addEventListener("pointerdown", () => engine.toggleDiceMode());
  els.home.startButton.addEventListener("pointerdown", () => engine.goToNames());

  // NAMES
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

  // DRINK
  els.drink.minus.addEventListener("pointerdown", () => engine.adjustDrinkCounter(-1));
  els.drink.plus.addEventListener("pointerdown", () => engine.adjustDrinkCounter(1));
  els.drink.beer.addEventListener("pointerdown", () => engine.beerCounter());
  els.drink.confirmButton.addEventListener("pointerdown", () => engine.confirmDrink());

  // OFFLINE — dice are thrown for real; the app only books the sips.
  els.offline.players.forEach((btn) => {
    btn.addEventListener("pointerdown", () => engine.setOfflineTarget(btn.dataset.target));
  });
  els.offline.counter.addEventListener("pointerdown", (e) => {
    const btn = e.target.closest("[data-delta]");
    if (!btn || btn.disabled) return;
    engine.adjustOfflineCounter(Number(btn.dataset.delta));
  });
  els.offline.continueButton.addEventListener("pointerdown", () => engine.confirmOffline());

  // DICE_TURN — tap any die to select its whole value group, Continue confirms.

  els.dice.throwButton.addEventListener("pointerdown", () => engine.throwDice());
  els.dice.area.addEventListener("pointerdown", (e) => {
    const die = e.target.closest(".die");
    if (!die) return;
    ui.selectFromDie(die);
  });
  els.dice.continueButton.addEventListener("pointerdown", () => {
    const v = ui.getSelectedValue();
    if (v === null) return;
    engine.pickValue(v);
  });

  // HUNT
  els.hunt.throwButton.addEventListener("pointerdown", () => engine.huntThrow());

  // SCOREBOARD
  els.board.continueButton.addEventListener("pointerdown", () => engine.advanceTurn());

  // Popups
  els.dive.continueButton.addEventListener("pointerdown", () => engine.dismissPopup());

  // Stop menu
  els.stopButton.addEventListener("pointerdown", () => engine.openStopMenu());
  els.stop.quitGameButton.addEventListener("pointerdown", () => engine.stopChooseQuitGame());
  els.stop.quitPlayerButton.addEventListener("pointerdown", () => engine.stopChooseQuitPlayer());
  els.stop.continueButton.addEventListener("pointerdown", () => engine.stopCancel());
  els.stop.confirmYes.addEventListener("pointerdown", () => engine.stopConfirm());
  els.stop.confirmNo.addEventListener("pointerdown", () => engine.stopBack());
}
