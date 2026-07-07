"use strict";

import { evalInPage, loadOptions } from "./lib/api.js";
import { detectEngine } from "./lib/engines.js";
import { VariablesTab } from "./tabs/variables.js";
import { GameTab } from "./tabs/game.js";
import { SetupTab } from "./tabs/setup.js";
import { JsonTab } from "./tabs/json.js";

const titleEl = document.getElementById("page-title");
const badgeEl = document.getElementById("engine-badge");
const tabButtons = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".panel");

/** @type {{ profile: import("./lib/engines.js").EngineProfile, variables: object } | null} */
let engine = null;

const variablesTab = new VariablesTab(document.getElementById("panel-variables"));
const gameTab = new GameTab(document.getElementById("panel-game"));
const setupTab = new SetupTab(document.getElementById("panel-setup"));
const jsonTab = new JsonTab(document.getElementById("panel-json"));

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => activateTab(btn.dataset.tab));
});

async function init() {
  const options = await loadOptions();
  variablesTab.setOptions(options);

  try {
    const docTitle = await evalInPage("document.title");
    titleEl.textContent = docTitle || "Twine Peeks";
  } catch {
    titleEl.textContent = "Twine Peeks";
  }

  engine = await detectEngine();

  if (!engine) {
    badgeEl.textContent = "No SugarCube game detected on this page.";
    badgeEl.className = "subtitle error";
    return;
  }

  badgeEl.textContent = `${engine.profile.label} · ${engine.profile.variablesExpr}`;
  badgeEl.className = "subtitle success";

  variablesTab.mount(engine.profile.variablesExpr, engine.variables);
  jsonTab.setRootExpression(engine.profile.variablesExpr);
  gameTab.setProfile(engine.profile);
}

function activateTab(name) {
  tabButtons.forEach((btn) => {
    const active = btn.dataset.tab === name;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });

  panels.forEach((panel) => {
    const active = panel.id === `panel-${name}`;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });

  if (name === "game" && engine) {
    gameTab.refresh();
  } else if (name === "setup") {
    setupTab.refresh();
  } else if (name === "json" && engine) {
    jsonTab.refresh();
  }
}

function onShown() {
  init();
}

function onHidden() {
  variablesTab.destroy();
  gameTab.destroy();
  setupTab.destroy();
  jsonTab.destroy();
}

window.addEventListener("twine-devtools-shown", onShown);
window.addEventListener("twine-devtools-hidden", onHidden);
