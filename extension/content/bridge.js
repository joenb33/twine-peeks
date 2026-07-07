"use strict";

const MSG = "twine-devtools";
let nextId = 0;
const pending = new Map();

/** @type {Window | null} */
let targetWindow = null;

export function setPageTarget(win) {
  targetWindow = win || null;
}

export function getPageTarget() {
  return targetWindow || window;
}

export function initBridge(onReady) {
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.source !== `${MSG}-response`) return;
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    if (data.error) entry.reject(new Error(data.error));
    else entry.resolve(data.result);
  });

  window.addEventListener("message", (event) => {
    if (event.data && event.data.source === `${MSG}-ready`) {
      onReady();
    }
  });
}

/** @returns {Promise<unknown>} */
export function callPage(method, args = {}) {
  return new Promise((resolve, reject) => {
    const id = `td-${++nextId}-${Date.now()}`;
    pending.set(id, { resolve, reject });
    const win = getPageTarget();
    win.postMessage({ source: `${MSG}-request`, id, method, args }, "*");
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error("Page API timeout"));
      }
    }, 30000);
  });
}

export async function waitForSugarCube(maxAttempts = 60, intervalMs = 1000) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const ping = await callPage("ping");
      if (ping && ping.detected) return true;
    } catch {
      /* not ready */
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}
