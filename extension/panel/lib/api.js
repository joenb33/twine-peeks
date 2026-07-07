"use strict";

export const api = typeof chrome !== "undefined" ? chrome : browser;

/** @returns {Promise<unknown>} */
export function evalInPage(expression) {
  if (typeof chrome === "undefined") {
    return browser.devtools.inspectedWindow.eval(expression);
  }
  return new Promise((resolve, reject) => {
    chrome.devtools.inspectedWindow.eval(expression, {}, (result, exception) => {
      if (exception) {
        reject(exception);
      } else {
        resolve(result);
      }
    });
  });
}

/** @returns {Promise<Record<string, unknown>>} */
export function loadOptions() {
  return new Promise((resolve) => {
    api.storage.sync.get({ autoRefresh: false, refreshInterval: 500 }, resolve);
  });
}

export function saveOptions(options) {
  api.storage.sync.set(options);
}

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatLabel(name) {
  return name
    .split("_")
    .map((part) =>
      part
        .split(/(?=[A-Z])/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ")
    )
    .join(" ");
}

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function valueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export function pathToExpression(rootExpression, pathParts) {
  let expr = rootExpression;
  for (const part of pathParts) {
    if (/^\d+$/.test(part)) {
      expr += `[${part}]`;
    } else if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(part)) {
      expr += `.${part}`;
    } else {
      expr += `[${JSON.stringify(part)}]`;
    }
  }
  return expr;
}

export function valueToExpression(type, value) {
  switch (type) {
    case "bigint":
      return `${parseInt(value, 10)}`;
    case "number":
      return `${parseFloat(value)}`;
    case "boolean":
      return value ? "true" : "false";
    case "null":
      return "null";
    case "string":
      return JSON.stringify(String(value));
    default:
      return JSON.stringify(String(value));
  }
}

export function fromEditor(type, value) {
  switch (type) {
    case "bigint":
      return parseInt(value, 10);
    case "number":
      return parseFloat(value);
    case "boolean":
      return value === true || value === "true";
    case "null":
      return null;
    case "string":
    default:
      return String(value);
  }
}

export function toEditor(type, value) {
  switch (type) {
    case "bigint":
    case "number":
      return `${value}`;
    case "boolean":
      return value ? "true" : "false";
    case "null":
      return "null";
    case "string":
    default:
      return `${value}`;
  }
}

export function showStatus(el, message, type = "info") {
  el.textContent = message;
  el.className = `status status-${type}`;
}

export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
