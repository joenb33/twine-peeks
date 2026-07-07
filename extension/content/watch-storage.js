"use strict";

const api = typeof chrome !== "undefined" ? chrome : browser;
const KEY = "twineDevToolsWatchList";

export async function loadWatchList() {
  return new Promise((resolve) => {
    api.storage.local.get({ [KEY]: [] }, (data) => resolve(data[KEY] || []));
  });
}

export async function saveWatchList(list) {
  return new Promise((resolve) => {
    api.storage.local.set({ [KEY]: list }, resolve);
  });
}

export async function addWatch(path) {
  const list = await loadWatchList();
  const norm = path.trim().replace(/^\$/, "");
  if (!norm || list.includes(norm)) return list;
  list.push(norm);
  await saveWatchList(list);
  return list;
}

export async function removeWatch(path) {
  let list = await loadWatchList();
  list = list.filter((p) => p !== path);
  await saveWatchList(list);
  return list;
}
