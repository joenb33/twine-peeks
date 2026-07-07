"use strict";

import { evalInPage, showStatus } from "../lib/api.js";

export class JsonTab {
  /** @param {HTMLElement} root */
  constructor(root) {
    this.root = root;
    this.rootExpression = "";
    this.statusEl = root.querySelector("#json-status");
    this.editorEl = root.querySelector("#json-editor");

    root.querySelector("#json-refresh").addEventListener("click", () => this.refresh());
    root.querySelector("#json-copy").addEventListener("click", () => this.copy());
    root.querySelector("#json-apply").addEventListener("click", () => this.apply());
  }

  setRootExpression(expr) {
    this.rootExpression = expr;
  }

  async refresh() {
    if (!this.rootExpression) {
      showStatus(this.statusEl, "No variables root detected.", "error");
      return;
    }
    try {
      const data = await evalInPage(`JSON.stringify(${this.rootExpression}, null, 2)`);
      this.editorEl.value = data || "{}";
      showStatus(this.statusEl, "Variables exported to JSON.", "success");
    } catch (err) {
      showStatus(this.statusEl, `Export failed: ${err.message || err}`, "error");
    }
  }

  async copy() {
    try {
      await navigator.clipboard.writeText(this.editorEl.value);
      showStatus(this.statusEl, "Copied to clipboard.", "success");
    } catch {
      showStatus(this.statusEl, "Copy failed.", "error");
    }
  }

  async apply() {
    if (!this.rootExpression) return;
    const parsed = this.editorEl.value.trim();
    if (!parsed) return;

    const confirmed = confirm(
      "Replace ALL game variables with this JSON? This cannot be undone without reloading a save."
    );
    if (!confirmed) return;

    try {
      JSON.parse(parsed);
      const expr = `${this.rootExpression} = Object.assign(${this.rootExpression}, JSON.parse(${JSON.stringify(parsed)}))`;
      await evalInPage(expr);
      showStatus(this.statusEl, "Variables merged from JSON.", "success");
    } catch (err) {
      showStatus(this.statusEl, `Apply failed: ${err.message || err}`, "error");
    }
  }

  destroy() {
    this.editorEl.value = "";
  }
}
