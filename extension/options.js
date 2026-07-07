"use strict";

const api = typeof chrome !== "undefined" ? chrome : browser;
const autoRefresh = document.getElementById("autoRefresh");
const refreshInterval = document.getElementById("refreshInterval");

function save() {
  api.storage.sync.set({
    autoRefresh: autoRefresh.checked,
    refreshInterval: Number(refreshInterval.value) || 500,
  });
}

api.storage.sync.get({ autoRefresh: false, refreshInterval: 500 }, (opts) => {
  autoRefresh.checked = opts.autoRefresh;
  refreshInterval.value = opts.refreshInterval;
});

autoRefresh.addEventListener("change", save);
refreshInterval.addEventListener("change", save);
