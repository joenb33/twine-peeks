"use strict";

import { evalInPage, escapeHtml, showStatus } from "../lib/api.js";
import { goToPassage, readHistory, readMeta, readPassageList } from "../lib/engines.js";
import { mountSnippetBar } from "../../lib/console-snippets.js";

export class GameTab {
  /** @param {HTMLElement} root */
  constructor(root) {
    this.root = root;
    this.profile = null;
    this.statusEl = root.querySelector("#game-status");
    this.metaEl = root.querySelector("#game-meta");
    this.passageFilterEl = root.querySelector("#passage-filter");
    this.passageListEl = root.querySelector("#passage-list");
    this.historyEl = root.querySelector("#history-list");
    this.gotoInputEl = root.querySelector("#goto-passage");
    this.consoleEl = root.querySelector("#quick-console");
    this.consoleOutputEl = root.querySelector("#console-output");

    root.querySelector("#refresh-game").addEventListener("click", () => this.refresh());
    root.querySelector("#goto-btn").addEventListener("click", () => this.gotoPassage());
    root.querySelector("#console-run").addEventListener("click", () => this.runConsole());
    this.passageFilterEl.addEventListener("input", () => this.filterPassages());
    this.gotoInputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.gotoPassage();
    });
    this.consoleEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) this.runConsole();
    });

    const snippetHost = root.querySelector("#console-snippets");
    if (snippetHost) {
      mountSnippetBar(snippetHost, this.consoleEl, (code) => this.runConsole(code));
    }
  }

  /** @param {import("../lib/engines.js").EngineProfile} profile */
  setProfile(profile) {
    this.profile = profile;
  }

  async refresh() {
    if (!this.profile) {
      showStatus(this.statusEl, "No SugarCube game detected.", "error");
      return;
    }

    showStatus(this.statusEl, "Loading game info…", "info");

    try {
      const [meta, passages, history] = await Promise.all([
        readMeta(this.profile),
        readPassageList(),
        readHistory(),
      ]);

      this.renderMeta(meta);
      this.renderPassages(passages || []);
      this.renderHistory(history || []);
      showStatus(this.statusEl, "Game info loaded.", "success");
    } catch (err) {
      showStatus(this.statusEl, `Error: ${err.message || err}`, "error");
    }
  }

  /** @param {Record<string, unknown> | null} meta */
  renderMeta(meta) {
    if (!meta) {
      this.metaEl.innerHTML = "<p>No metadata available.</p>";
      return;
    }

    const rows = [
      ["Engine", meta.engine],
      ["Version", meta.version],
      ["Current passage", meta.passage],
      ["Turn", meta.turn],
      ["History depth", meta.historyDepth],
    ];

    this.metaEl.innerHTML = `
      <table class="meta-table">
        ${rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v ?? "—")}</td></tr>`).join("")}
      </table>
    `;
  }

  /** @param {string[]} passages */
  renderPassages(passages) {
    this.allPassages = passages;
    this.filterPassages();
  }

  filterPassages() {
    const q = this.passageFilterEl.value.trim().toLowerCase();
    const list = (this.allPassages || []).filter((p) => !q || p.toLowerCase().includes(q));

    if (list.length === 0) {
      this.passageListEl.innerHTML = "<li class='empty'>No passages found.</li>";
      return;
    }

    this.passageListEl.innerHTML = list
      .slice(0, 200)
      .map(
        (name) =>
          `<li><button type="button" class="passage-link" data-name="${escapeHtml(name)}">${escapeHtml(name)}</button></li>`
      )
      .join("");

    if ((this.allPassages || []).length > 200) {
      this.passageListEl.innerHTML += `<li class="hint">Showing first 200 matches. Narrow the filter.</li>`;
    }

    this.passageListEl.querySelectorAll(".passage-link").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.gotoInputEl.value = btn.dataset.name || "";
        this.gotoPassage();
      });
    });
  }

  /** @param {{ index: number, passage: string }[]} history */
  renderHistory(history) {
    if (!history.length) {
      this.historyEl.innerHTML = "<li class='empty'>No history.</li>";
      return;
    }

    this.historyEl.innerHTML = history
      .slice(-30)
      .reverse()
      .map((h) => `<li><span class="hist-idx">${h.index}</span> ${escapeHtml(h.passage)}</li>`)
      .join("");
  }

  async gotoPassage() {
    const name = this.gotoInputEl.value.trim();
    if (!name) return;
    try {
      const ok = await goToPassage(name);
      if (ok) {
        showStatus(this.statusEl, `Navigated to "${name}".`, "success");
        await this.refresh();
      } else {
        showStatus(this.statusEl, "Could not navigate — Engine.play not available.", "error");
      }
    } catch (err) {
      showStatus(this.statusEl, `Navigation failed: ${err.message || err}`, "error");
    }
  }

  async runConsole(codeOverride) {
    const code = (codeOverride ?? this.consoleEl.value).trim();
    if (!code) return;
    try {
      const result = await evalInPage(`try { eval(${JSON.stringify(code)}) } catch(e) { ({ __error: e.message || String(e) }) }`);
      const text =
        result && typeof result === "object" && result.__error
          ? `Error: ${result.__error}`
          : result === undefined
            ? "(done — no return value)"
            : typeof result === "object"
              ? JSON.stringify(result, null, 2)
              : String(result);
      this.consoleOutputEl.textContent = text;
    } catch (err) {
      this.consoleOutputEl.textContent = `Error: ${err.message || err}`;
    }
  }

  destroy() {
    this.metaEl.innerHTML = "";
    this.passageListEl.innerHTML = "";
    this.historyEl.innerHTML = "";
  }
}
