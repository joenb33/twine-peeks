"use strict";

const api = typeof chrome !== "undefined" ? chrome : browser;

/**
 * Scan same-origin iframes that might contain a Twine game.
 * @returns {Array<{ index: number, src: string, title: string, accessible: boolean }>}
 */
export function findCandidateIframes() {
  const iframes = document.querySelectorAll("iframe");
  const out = [];
  let idx = 0;
  for (const frame of iframes) {
    const src = frame.getAttribute("src") || frame.src || "(inline)";
    let accessible = false;
    try {
      accessible = !!(frame.contentDocument && frame.contentDocument.documentElement);
    } catch {
      accessible = false;
    }
    if (accessible || src.includes(".html") || src === "(inline)") {
      out.push({
        index: idx++,
        element: frame,
        src: src.slice(0, 120),
        title: frame.getAttribute("title") || frame.id || `iframe ${idx}`,
        accessible,
      });
    }
  }
  return out;
}

/**
 * Inject page scripts into an iframe document (same-origin only).
 * @param {HTMLIFrameElement} iframe
 */
export async function injectIntoIframe(iframe) {
  const doc = iframe.contentDocument;
  if (!doc) throw new Error("Cannot access iframe (cross-origin). Open the game URL directly.");

  const injectScript = (url) =>
    new Promise((resolve, reject) => {
      if (doc.querySelector(`script[data-tw-src="${url}"]`)) {
        resolve();
        return;
      }
      const script = doc.createElement("script");
      script.dataset.twSrc = url;
      script.src = url;
      script.onload = () => {
        script.remove();
        resolve();
      };
      script.onerror = () => reject(new Error(`Failed to load ${url}`));
      (doc.documentElement || doc.head).appendChild(script);
    });

  await injectScript(api.runtime.getURL("injected/adapters.js"));
  await injectScript(api.runtime.getURL("injected/state-utils.js"));
  await injectScript(api.runtime.getURL("injected/page-api.js"));
  return iframe.contentWindow;
}
