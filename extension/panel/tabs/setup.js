"use strict";

import { escapeHtml, showStatus } from "../lib/api.js";
import { readSetupKeys } from "../lib/engines.js";

export class SetupTab {
  /** @param {HTMLElement} root */
  constructor(root) {
    this.root = root;
    this.statusEl = root.querySelector("#setup-status");
    this.contentEl = root.querySelector("#setup-content");
    this.filterEl = root.querySelector("#setup-filter");
    this.rawData = null;

    root.querySelector("#refresh-setup").addEventListener("click", () => this.refresh());
    this.filterEl.addEventListener("input", () => this.renderFiltered());
  }

  async refresh() {
    showStatus(this.statusEl, "Reading SugarCube.setup…", "info");
    try {
      this.rawData = await readSetupKeys();
      if (!this.rawData) {
        showStatus(this.statusEl, "SugarCube.setup not found on this page.", "error");
        this.contentEl.innerHTML = "";
        return;
      }
      this.renderFiltered();
      showStatus(this.statusEl, `${Object.keys(this.rawData).length} setup keys loaded.`, "success");
    } catch (err) {
      showStatus(this.statusEl, `Error: ${err.message || err}`, "error");
    }
  }

  renderFiltered() {
    if (!this.rawData) return;
    const q = this.filterEl.value.trim().toLowerCase();
    const keys = Object.keys(this.rawData).filter((k) => !q || k.toLowerCase().includes(q));

    if (keys.length === 0) {
      this.contentEl.innerHTML = "<p class='empty'>No matching setup keys.</p>";
      return;
    }

    this.contentEl.innerHTML = keys
      .map((key) => {
        const val = this.rawData[key];
        const display =
          typeof val === "object" && val !== null
            ? `<pre class="setup-json">${escapeHtml(JSON.stringify(val, null, 2))}</pre>`
            : `<code>${escapeHtml(String(val))}</code>`;
        return `<details class="setup-item"><summary>${escapeHtml(key)}</summary>${display}</details>`;
      })
      .join("");
  }

  destroy() {
    this.rawData = null;
    this.contentEl.innerHTML = "";
  }
}
