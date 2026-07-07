"use strict";

/**
 * Non-module bootstrap — always loads in Firefox/Chrome so popup sendMessage works.
 * Loads the ES module app via dynamic import().
 */
(function () {
  const api = typeof chrome !== "undefined" ? chrome : browser;
  let appPromise = null;

  function loadApp() {
    if (!appPromise) {
      appPromise = import(api.runtime.getURL("content/content.js"));
    }
    return appPromise;
  }

  loadApp().then((mod) => mod.init()).catch(() => {
    /* module load failed — popup can still retry */
  });

  api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "twine-devtools-ping") {
      sendResponse({ ok: true });
      return false;
    }
    if (!msg || msg.type !== "twine-devtools-toggle") {
      return false;
    }
    loadApp()
      .then((mod) => {
        mod.toggleToolkit();
        sendResponse({ ok: true });
      })
      .catch((err) => {
        sendResponse({ ok: false, error: String(err) });
      });
    return true;
  });
})();
