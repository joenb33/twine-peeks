"use strict";

import { callPage, initBridge, setPageTarget, waitForSugarCube } from "./bridge.js";
import { findCandidateIframes, injectIntoIframe } from "./iframe-bridge.js";
import { TwineToolkitOverlay } from "./overlay.js";

const api = typeof chrome !== "undefined" ? chrome : browser;
const FAB_ID = "twine-devtools-fab";

let injected = false;
let overlay = null;
let detected = false;
let started = false;

function injectScript(url) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-tw-src="${url}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.dataset.twSrc = url;
    script.src = url;
    script.onload = () => {
      script.remove();
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load ${url}`));
    (document.documentElement || document.head).appendChild(script);
  });
}

async function injectPageApi() {
  if (injected) return;
  injected = true;
  await injectScript(api.runtime.getURL("injected/adapters.js"));
  await injectScript(api.runtime.getURL("injected/state-utils.js"));
  await injectScript(api.runtime.getURL("injected/page-api.js"));
}

/** @returns {Promise<boolean>} */
export async function attachToIframe(iframe) {
  const win = await injectIntoIframe(iframe);
  setPageTarget(win);
  const ping = await callPage("ping");
  return !!(ping && ping.detected);
}

function openToolkit() {
  if (!overlay) {
    overlay = new TwineToolkitOverlay(
      () => {
        overlay = null;
      },
      {
        findIframes: findCandidateIframes,
        attachToIframe: attachToIframe,
        resetPageTarget: () => setPageTarget(null),
      }
    );
  }
  overlay.toggle();
}

function createFab() {
  if (document.getElementById(FAB_ID)) return;

  const fab = document.createElement("button");
  fab.id = FAB_ID;
  fab.type = "button";
  fab.title = "Twine Peeks";
  fab.setAttribute("aria-label", "Open Twine Peeks");
  fab.innerHTML = `<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`;

  Object.assign(fab.style, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    zIndex: "2147483646",
    width: "52px",
    height: "52px",
    borderRadius: "50%",
    border: "2px solid #3794ff",
    background: "#1e1e1e",
    color: "#3794ff",
    cursor: "pointer",
    boxShadow: "0 4px 16px rgba(0,0,0,0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0",
    transition: "transform 0.15s, box-shadow 0.15s",
  });

  fab.addEventListener("mouseenter", () => {
    fab.style.transform = "scale(1.08)";
    fab.style.boxShadow = "0 6px 20px rgba(55,148,255,0.35)";
  });
  fab.addEventListener("mouseleave", () => {
    fab.style.transform = "scale(1)";
    fab.style.boxShadow = "0 4px 16px rgba(0,0,0,0.45)";
  });

  const dragState = makeDraggable(fab);
  fab.addEventListener("click", (e) => {
    // A drag ends with a click event — don't pop the toolkit open after moving.
    if (dragState.didDrag) {
      e.preventDefault();
      return;
    }
    openToolkit();
  });
  document.documentElement.appendChild(fab);
}

function makeDraggable(el) {
  const state = { didDrag: false };
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let origRight = 0;
  let origBottom = 0;

  el.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    dragging = true;
    state.didDrag = false;
    startX = e.clientX;
    startY = e.clientY;
    origRight = parseInt(el.style.right, 10) || 20;
    origBottom = parseInt(el.style.bottom, 10) || 20;
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    if (Math.abs(e.clientX - startX) > 3 || Math.abs(e.clientY - startY) > 3) {
      state.didDrag = true;
    }
    const margin = 8;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let right = origRight - (e.clientX - startX);
    let bottom = origBottom - (e.clientY - startY);
    right = Math.max(margin, Math.min(window.innerWidth - w - margin, right));
    bottom = Math.max(margin, Math.min(window.innerHeight - h - margin, bottom));
    el.style.right = `${right}px`;
    el.style.bottom = `${bottom}px`;
  });

  window.addEventListener("mouseup", () => {
    dragging = false;
    setTimeout(() => {
      state.didDrag = false;
    }, 0);
  });

  return state;
}

function onDetected() {
  if (detected) return;
  detected = true;
  createFab();
}

async function pollDetection() {
  try {
    const ping = await callPage("ping");
    if (ping && ping.detected) {
      onDetected();
      return;
    }
  } catch {
    /* keep polling */
  }
  setTimeout(pollDetection, 1500);
}

/** Boot detection + page API. Safe to call more than once. */
export function init() {
  if (started) return;
  started = true;

  initBridge(() => {
    pollDetection();
  });

  injectPageApi().catch(() => {});

  waitForSugarCube(3, 500).then((found) => {
    if (found) onDetected();
  });

  setInterval(async () => {
    if (detected) return;
    try {
      const ping = await callPage("ping");
      if (ping && ping.detected) onDetected();
    } catch {
      /* ignore */
    }
  }, 3000);
}

export function toggleToolkit() {
  init();
  openToolkit();
}
