"use strict";

import {
  debounce,
  evalInPage,
  formatLabel,
  fromEditor,
  isPlainObject,
  pathToExpression,
  toEditor,
  valueToExpression,
  valueType,
} from "./api.js";

/** @typedef {{ path: string, type: string, value: string, editor: HTMLElement | null, locked: boolean, lockedValue: string }} FieldMeta */

export class VariablesTab {
  /** @param {HTMLElement} root */
  constructor(root) {
    this.root = root;
    this.rootExpression = "";
    /** @type {Record<string, FieldMeta>} */
    this.fields = {};
    this.refreshTimer = null;
    this.options = { autoRefresh: false, refreshInterval: 500 };
    this.filterPattern = "";
    this.highlightPattern = "";

    this.contentEl = root.querySelector("#variables-content");
    this.filterEl = root.querySelector("#var-filter");
    this.highlightEl = root.querySelector("#var-highlight");
    this.autoRefreshEl = root.querySelector("#var-auto-refresh");
    this.intervalEl = root.querySelector("#var-interval");

    this.bindControls();
  }

  bindControls() {
    this.filterEl.addEventListener("input", debounce(() => {
      this.filterPattern = this.filterEl.value.trim().toLowerCase();
      this.applyFilter();
    }, 150));

    this.highlightEl.addEventListener("input", debounce(() => {
      this.highlightPattern = this.highlightEl.value.trim().toLowerCase();
      this.applyHighlight();
    }, 150));

    rootClearButton(this.root, "#var-clear-filter", () => {
      this.filterEl.value = "";
      this.filterPattern = "";
      this.applyFilter();
    });

    rootClearButton(this.root, "#var-clear-highlight", () => {
      this.highlightEl.value = "";
      this.highlightPattern = "";
      this.applyHighlight();
    });

    this.root.querySelector("#var-collapse-all").addEventListener("click", () => {
      this.contentEl.querySelectorAll(".object-table.collapsible").forEach((el) => {
        el.classList.add("collapsed");
      });
    });

    this.root.querySelector("#var-expand-all").addEventListener("click", () => {
      this.contentEl.querySelectorAll(".object-table.collapsible").forEach((el) => {
        el.classList.remove("collapsed");
      });
    });

    this.autoRefreshEl.addEventListener("change", () => {
      this.options.autoRefresh = this.autoRefreshEl.checked;
      if (this.options.autoRefresh) {
        this.scheduleRefresh();
      } else {
        clearTimeout(this.refreshTimer);
      }
    });

    this.intervalEl.addEventListener("change", () => {
      this.options.refreshInterval = Number(this.intervalEl.value) || 500;
    });
  }

  setOptions(options) {
    this.options = { ...this.options, ...options };
    this.autoRefreshEl.checked = this.options.autoRefresh;
    this.intervalEl.value = String(this.options.refreshInterval);
  }

  /** @param {string} rootExpression @param {object} variables */
  mount(rootExpression, variables) {
    this.rootExpression = rootExpression;
    this.fields = {};
    this.contentEl.innerHTML = "";
    this.buildData(variables, "", this.fields);
    this.renderObject(variables, "", this.contentEl);
    this.applyFilter();
    this.applyHighlight();
    if (this.options.autoRefresh) {
      this.scheduleRefresh();
    }
  }

  destroy() {
    clearTimeout(this.refreshTimer);
    this.fields = {};
    this.contentEl.innerHTML = "";
  }

  scheduleRefresh() {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.refreshAll(), this.options.refreshInterval);
  }

  async refreshAll() {
    if (!this.rootExpression) return;
    try {
      const variables = await evalInPage(this.rootExpression);
      if (!variables || typeof variables !== "object") return;

      for (const path of Object.keys(this.fields)) {
        const meta = this.fields[path];
        if (meta.locked) {
          await this.applyLockedValue(path);
        }
        const newValue = this.getAtPath(variables, path.slice(1).split("."));
        this.updateEditor(path, newValue);
      }

      if (this.options.autoRefresh) {
        this.scheduleRefresh();
      }
    } catch {
      // page may have navigated away
    }
  }

  /** @param {object} obj @param {string[]} parts */
  getAtPath(obj, parts) {
    let cur = obj;
    for (const part of parts) {
      if (cur == null) return undefined;
      cur = cur[part];
    }
    return cur;
  }

  /** @param {object} obj @param {string} path @param {Record<string, FieldMeta>} store */
  buildData(obj, path, store) {
    const type = valueType(obj);
    if (type === "object" || type === "array") {
      for (const key of Object.keys(obj)) {
        this.buildData(obj[key], `${path}.${key}`, store);
      }
      return;
    }
    store[path] = {
      path,
      type,
      value: toEditor(type, obj),
      editor: null,
      locked: false,
      lockedValue: toEditor(type, obj),
    };
  }

  /** @param {unknown} value @param {string} path @param {HTMLElement} parent */
  renderObject(value, path, parent) {
    const type = valueType(value);

    if (type === "object" || type === "array") {
      const table = document.createElement("table");
      table.className = "object-table grid" + (path ? " collapsible" : "");
      if (path) {
        table.id = `obj-${cssId(path)}`;
      }

      const keys = Object.keys(value).sort((a, b) => {
        const na = Number(a);
        const nb = Number(b);
        if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
        return a.localeCompare(b);
      });

      if (keys.length === 0) {
        const empty = document.createElement("span");
        empty.className = "type-tag";
        empty.textContent = type === "array" ? "[]" : "{}";
        parent.appendChild(empty);
        return empty;
      }

      for (const key of keys) {
        const childPath = `${path}.${key}`;
        const row = document.createElement("tr");
        row.className = "var-row";
        row.dataset.path = childPath.toLowerCase();
        row.id = `row-${cssId(childPath)}`;

        const th = document.createElement("th");
        th.className = "cell-label";
        const label = document.createElement("button");
        label.type = "button";
        label.className = "path-label";
        label.title = childPath.slice(1);
        label.textContent = type === "array" ? `[${key}]` : formatLabel(key);
        if (isPlainObject(value[key]) || Array.isArray(value[key])) {
          label.addEventListener("click", () => {
            const nested = document.getElementById(`obj-${cssId(childPath)}`);
            if (nested) nested.classList.toggle("collapsed");
          });
        }
        th.appendChild(label);

        const td = document.createElement("td");
        td.className = "cell-value";
        this.renderObject(value[key], childPath, td);

        row.append(th, td);
        table.appendChild(row);
      }

      parent.appendChild(table);
      return table;
    }

    return this.renderScalar(value, path, type, parent);
  }

  /** @param {unknown} value @param {string} path @param {string} type @param {HTMLElement} parent */
  renderScalar(value, path, type, parent) {
    const wrap = document.createElement("div");
    wrap.className = "scalar-editor";

    let editor;
    if (type === "boolean") {
      editor = document.createElement("input");
      editor.type = "checkbox";
      editor.checked = !!value;
    } else if (type === "null") {
      editor = document.createElement("span");
      editor.className = "null-value";
      editor.textContent = "null";
    } else {
      editor = document.createElement("input");
      editor.type = type === "number" || type === "bigint" ? "number" : "text";
      editor.value = toEditor(type, value);
      editor.className = "value-input";
    }

    if (this.fields[path]) {
      this.fields[path].editor = editor;
    }

    const lock = document.createElement("input");
    lock.type = "checkbox";
    lock.className = "lock-toggle";
    lock.title = "Lock value (keep when game updates)";
    lock.addEventListener("change", () => {
      const meta = this.fields[path];
      if (!meta) return;
      meta.locked = lock.checked;
      if (lock.checked) {
        meta.lockedValue = type === "boolean"
          ? (editor.checked ? "true" : "false")
          : editor.value;
      }
    });

    const commit = () => {
      if (type === "null") return;
      const raw = type === "boolean" ? editor.checked : editor.value;
      this.setValue(path, raw);
    };

    if (type !== "null") {
      editor.addEventListener("change", commit);
      editor.addEventListener("blur", commit);
      if (type === "boolean") {
        editor.addEventListener("click", commit);
      }
    }

    wrap.append(editor, lock);
    parent.appendChild(wrap);
    return wrap;
  }

  updateEditor(path, newValue) {
    const meta = this.fields[path];
    if (!meta || !meta.editor) return;

    const type = meta.type;
    const editorValue = toEditor(type, newValue);

    if (meta.value === editorValue) return;

    if (type === "boolean" && meta.editor instanceof HTMLInputElement) {
      meta.editor.checked = !!newValue;
    } else if (meta.editor instanceof HTMLInputElement) {
      meta.editor.value = editorValue;
    }

    meta.value = editorValue;
    meta.editor.classList.add("changed");
  }

  async applyLockedValue(path) {
    const meta = this.fields[path];
    if (!meta || !meta.locked) return;
    await this.setValue(path, meta.lockedValue, true);
  }

  async setValue(path, rawValue, fromLock = false) {
    const meta = this.fields[path];
    if (!meta) return;

    const parsed = fromEditor(meta.type, rawValue);
    const pathParts = path.slice(1).split(".");

    if (pathParts.length === 1) {
      const setVarExpr = `(function(){
        var S = window.SugarCube;
        if (S && S.State && S.State.setVar) {
          return S.State.setVar("$${pathParts[0].replace(/\\/g, "\\\\").replace(/'/g, "\\'")}", ${valueToExpression(meta.type, parsed)});
        }
        return false;
      })()`;
      try {
        const used = await evalInPage(setVarExpr);
        if (used) {
          meta.value = toEditor(meta.type, parsed);
          if (meta.editor) meta.editor.classList.remove("changed");
          if (fromLock) meta.lockedValue = meta.value;
          return;
        }
      } catch {
        /* fall through to expression assign */
      }
    }

    const expr = `${pathToExpression(this.rootExpression, pathParts)}=${valueToExpression(meta.type, parsed)}`;
    try {
      await evalInPage(expr);
      meta.value = toEditor(meta.type, parsed);
      if (meta.editor) {
        meta.editor.classList.remove("changed");
      }
      if (fromLock) {
        meta.lockedValue = meta.value;
      }
    } catch (err) {
      alert(`Failed to set ${path.slice(1)}: ${err.message || err}`);
    }
  }

  applyFilter() {
    for (const path of Object.keys(this.fields)) {
      const row = document.getElementById(`row-${cssId(path)}`);
      if (!row) continue;
      const hay = path.toLowerCase();
      const show = !this.filterPattern || hay.includes(this.filterPattern);
      row.classList.toggle("hidden", !show);
    }
  }

  applyHighlight() {
    for (const path of Object.keys(this.fields)) {
      const row = document.getElementById(`row-${cssId(path)}`);
      if (!row) continue;
      const meta = this.fields[path];
      const inPath = this.highlightPattern && path.toLowerCase().includes(this.highlightPattern);
      const inValue = this.highlightPattern && `${meta.value}`.toLowerCase().includes(this.highlightPattern);
      row.classList.toggle("highlight", !!(inPath || inValue));
    }
  }
}

function cssId(path) {
  return path.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
}

function rootClearButton(root, selector, handler) {
  root.querySelector(selector).addEventListener("click", handler);
}
