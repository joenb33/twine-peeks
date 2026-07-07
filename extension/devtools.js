"use strict";

function wirePanel(panel) {
  panel.onShown.addListener((panelWindow) => {
    panelWindow.dispatchEvent(new CustomEvent("twine-devtools-shown"));
  });
  panel.onHidden.addListener((panelWindow) => {
    panelWindow.dispatchEvent(new CustomEvent("twine-devtools-hidden"));
  });
}

if (typeof chrome === "undefined") {
  browser.devtools.panels.create("Twine Peeks", "icons/16.png", "panel/index.html").then(wirePanel);
} else {
  chrome.devtools.panels.create("Twine Peeks", "icons/16.png", "panel/index.html", wirePanel);
}
