"use strict";

const api = typeof chrome !== "undefined" ? chrome : browser;
const KEY = "twineDevToolsLockedPaths";

export async function loadLockedPaths() {
  return new Promise((resolve) => {
    api.storage.local.get({ [KEY]: [] }, (data) => resolve(data[KEY] || []));
  });
}

export async function saveLockedPaths(list) {
  return new Promise((resolve) => {
    api.storage.local.set({ [KEY]: list }, resolve);
  });
}

export async function setPathLocked(pathKey, locked) {
  let list = await loadLockedPaths();
  if (locked) {
    if (!list.includes(pathKey)) list.push(pathKey);
  } else {
    list = list.filter((p) => p !== pathKey);
  }
  await saveLockedPaths(list);
  return list;
}

export async function isPathLocked(pathKey) {
  const list = await loadLockedPaths();
  return list.some((p) => pathKey === p || pathKey.startsWith(p + "."));
}
