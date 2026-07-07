"use strict";

const api = typeof chrome !== "undefined" ? chrome : browser;
const openBtn = document.getElementById("open");
const errEl = document.getElementById("err");

function showError(message) {
  errEl.textContent = message;
  errEl.style.display = "block";
}

function canInject(url) {
  if (!url) return false;
  if (url.startsWith("http://") || url.startsWith("https://")) return true;
  if (url.startsWith("file://")) return true;
  return false;
}

async function ensureContentScript(tabId) {
  try {
    const res = await api.tabs.sendMessage(tabId, { type: "twine-devtools-ping" });
    if (res && res.ok) return;
  } catch {
    /* not loaded yet */
  }

  if (!api.scripting || !api.scripting.executeScript) {
    throw new Error("Cannot inject on this page. Reload the game tab, then try again.");
  }

  await api.scripting.executeScript({
    target: { tabId },
    files: ["content/bootstrap.js"],
  });
}

openBtn.addEventListener("click", async () => {
  errEl.style.display = "none";
  try {
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab || tab.id == null) {
      showError("No active tab found.");
      return;
    }

    if (!canInject(tab.url)) {
      showError("Open a Twine game tab first (http, https, or local HTML file).");
      return;
    }

    await ensureContentScript(tab.id);

    const res = await api.tabs.sendMessage(tab.id, { type: "twine-devtools-toggle" });
    if (res && res.ok === false) {
      throw new Error(res.error || "Toggle failed");
    }
    window.close();
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    if (msg.includes("Cannot access") || msg.includes("Missing host permission")) {
      showError(
        "Extension cannot access this page. In Firefox: about:addons → Twine Peeks → Allow access to file URLs. Then reload the game tab."
      );
    } else if (msg.includes("Receiving end does not exist")) {
      showError("Reload the game page (F5), then click Open toolkit again.");
    } else {
      showError(msg || "Could not reach this page — reload the game tab first.");
    }
  }
});
