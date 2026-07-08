"use strict";

import { callPage } from "./bridge.js";
import { renderStoryGraph } from "./graph-viz.js";
import { GameInspector } from "./inspect-mode.js";
import { loadWatchList, addWatch, removeWatch } from "./watch-storage.js";
import { loadLockedPaths, setPathLocked } from "./lock-storage.js";
import { mountSnippetBar } from "../lib/console-snippets.js";

const FEEDBACK_REPO = "joenb33/twine-peeks";
const UPDATE_CHECK_KEY = "twine-devtools-update-check";
const SNAPSHOTS_KEY = "twine-devtools-snapshots";
const MAX_SNAPSHOTS_PER_STORY = 5;
const MAX_SNAPSHOT_BYTES = 1_000_000;

function getRuntime() {
  if (typeof chrome !== "undefined") return chrome;
  if (typeof browser !== "undefined") return browser;
  return null;
}

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "variables", label: "Variables" },
  { id: "changes", label: "Changes" },
  { id: "watch", label: "Watch" },
  { id: "search", label: "Search" },
  { id: "analysis", label: "Analysis" },
  { id: "format", label: "Format" },
  { id: "people", label: "People" },
  { id: "passages", label: "Passages" },
  { id: "links", label: "Links" },
  { id: "graph", label: "Map" },
  { id: "dom", label: "DOM" },
  { id: "chat", label: "Chat" },
  { id: "media", label: "Media" },
  { id: "saves", label: "Saves" },
  { id: "setup", label: "Setup" },
  { id: "json", label: "JSON" },
  { id: "console", label: "Console" },
];

const TAB_GROUPS = [
  { label: "Play", tabs: ["overview", "links", "graph", "dom"] },
  { label: "Story", tabs: ["passages", "analysis", "format"] },
  { label: "State", tabs: ["variables", "people", "changes", "watch", "json", "setup"] },
  { label: "Tools", tabs: ["search", "media", "saves", "console", "chat"] },
];

const TAG_CATEGORY_OPTIONS = [
  { id: "", label: "All categories" },
  { id: "navigation", label: "Navigation" },
  { id: "time", label: "Time" },
  { id: "event", label: "Events" },
  { id: "dialogue", label: "Dialogue" },
  { id: "widget", label: "Widgets" },
  { id: "util", label: "Utility" },
  { id: "display", label: "Display" },
  { id: "location-meta", label: "Location meta" },
];

export class TwineToolkitOverlay {
  /**
   * @param {() => void} onClose
   * @param {{ findIframes?: () => Array<{ element: HTMLIFrameElement, src: string, title: string, accessible: boolean }>, attachToIframe?: (iframe: HTMLIFrameElement) => Promise<boolean>, resetPageTarget?: () => void }} iframeBridge
   */
  constructor(onClose, iframeBridge = {}) {
    this.onClose = onClose;
    this.iframeBridge = iframeBridge;
    this.open = false;
    this.cssLoaded = false;
    this.activeTab = "overview";
    this.engine = null;
    this.refreshTimer = null;
    this.watchTimer = null;
    this.diffTimer = null;
    this.watchPrev = {};
    this.pendingVarPaths = new Set();
    this.lockedPaths = new Set();
    this.capabilities = null;
    this.showTempVars = false;
    this.chatSystemDetected = false;
    this.overviewRefreshTimer = null;
    this.chatRefreshTimer = null;
    this.gameInspector = null;
    this.lastInspectResult = null;
    this.host = document.createElement("div");
    this.host.id = "twine-devtools-overlay-host";
    this.shadow = this.host.attachShadow({ mode: "closed" });
    document.documentElement.appendChild(this.host);
    this.build();
  }

  async loadCss() {
    if (this.cssLoaded) return;
    const runtime = typeof chrome !== "undefined" ? chrome : browser;
    const url = runtime.runtime.getURL("content/overlay.css");
    const res = await fetch(url);
    const css = await res.text();
    const style = document.createElement("style");
    style.textContent = css;
    this.shadow.appendChild(style);
    this.cssLoaded = true;
  }

  build() {
    this.backdrop = el("div", "overlay-backdrop");
    this.panel = el("div", "panel");

    const header = el("div", "panel-header");
    this.titleEl = el("span", "panel-title");
    this.titleEl.textContent = "Twine Peeks";
    this.badgeEl = el("span", "panel-badge");
    this.updateEl = document.createElement("a");
    this.updateEl.className = "update-link";
    this.updateEl.href = `https://github.com/${FEEDBACK_REPO}/releases`;
    this.updateEl.target = "_blank";
    this.updateEl.rel = "noopener";
    this.updateEl.title = "A newer version is available — open the releases page";
    this.updateEl.hidden = true;
    const actions = el("div", "panel-actions");
    const feedbackBtn = el("button", "icon-btn");
    feedbackBtn.textContent = "💬";
    feedbackBtn.title = "Send feedback / report a problem";
    feedbackBtn.addEventListener("click", () => this.showFeedbackDialog());
    const refreshBtn = el("button", "icon-btn");
    refreshBtn.textContent = "↻";
    refreshBtn.title = "Refresh";
    refreshBtn.addEventListener("click", () => this.refreshActiveTab());
    const closeBtn = el("button", "icon-btn");
    closeBtn.textContent = "×";
    closeBtn.title = "Close";
    closeBtn.addEventListener("click", () => this.hide());
    actions.append(feedbackBtn, refreshBtn, closeBtn);
    header.append(this.titleEl, this.badgeEl, this.updateEl, actions);
    this.makePanelDraggable(header);

    const tabsWrap = el("div", "tabs-wrap");
    const tabsScroll = el("div", "tabs-scroll");
    this.tabButtons = {};
    for (const group of TAB_GROUPS) {
      const groupEl = el("div", "tab-group");
      const groupLabel = el("span", "tab-group-label");
      groupLabel.textContent = group.label;
      groupEl.appendChild(groupLabel);
      for (const tabId of group.tabs) {
        const tab = TABS.find((t) => t.id === tabId);
        if (!tab) continue;
        const btn = el("button", "tab");
        btn.type = "button";
        btn.textContent = tab.label;
        btn.dataset.tab = tab.id;
        if (tab.id === "chat" || tab.id === "people") btn.hidden = true;
        btn.addEventListener("click", () => this.switchTab(tab.id));
        groupEl.appendChild(btn);
        this.tabButtons[tab.id] = btn;
      }
      tabsScroll.appendChild(groupEl);
    }
    tabsWrap.appendChild(tabsScroll);

    this.tabPanels = {};
    this.tabPanels.overview = this.buildOverviewPanel();
    this.tabPanels.variables = this.buildVariablesPanel();
    this.tabPanels.changes = this.buildChangesPanel();
    this.tabPanels.watch = this.buildWatchPanel();
    this.tabPanels.search = this.buildSearchPanel();
    this.tabPanels.analysis = this.buildAnalysisPanel();
    this.tabPanels.format = this.buildFormatPanel();
    this.tabPanels.people = this.buildPeoplePanel();
    this.tabPanels.passages = this.buildPassagesPanel();
    this.tabPanels.links = this.buildLinksPanel();
    this.tabPanels.graph = this.buildGraphPanel();
    this.tabPanels.dom = this.buildDomPanel();
    this.tabPanels.chat = this.buildChatPanel();
    this.tabPanels.media = this.buildMediaPanel();
    this.tabPanels.saves = this.buildSavesPanel();
    this.tabPanels.setup = this.buildSetupPanel();
    this.tabPanels.json = this.buildJsonPanel();
    this.tabPanels.console = this.buildConsolePanel();

    this.panel.append(header, tabsWrap);
    for (const tab of TABS) {
      this.panel.appendChild(this.tabPanels[tab.id]);
    }
    this.inspectHud = el("div", "inspect-hud");
    this.inspectHud.hidden = true;
    this.inspectHud.innerHTML = `
      <span class="inspect-hud-dot"></span>
      <span>Inspect — hover to preview, click to open details</span>
      <button type="button" class="btn btn-xs" id="hud-cancel" title="Esc also cancels">Cancel</button>`;
    this.inspectHud.querySelector("#hud-cancel").addEventListener("click", () => this.stopInspectMode());

    this.feedbackModal = el("div", "feedback-modal");
    this.feedbackModal.hidden = true;
    this.feedbackModal.innerHTML = `
      <div class="feedback-card">
        <h3>Send feedback</h3>
        <p class="hint">Opens a prefilled GitHub issue in a new tab — you review and edit everything before it is submitted. Requires a GitHub account.</p>
        <div class="feedback-kind">
          <label><input type="radio" name="fb-kind" value="bug" checked/> 🐛 Bug / problem</label>
          <label><input type="radio" name="fb-kind" value="idea"/> 💡 Idea / suggestion</label>
        </div>
        <textarea id="fb-desc" rows="5" placeholder="What happened, or what would you like to see?"></textarea>
        <label><input type="checkbox" id="fb-diag" checked/> Include diagnostics (version, browser, detected engine)</label>
        <label><input type="checkbox" id="fb-url"/> Include page URL <span class="hint">(off by default — the game you play stays private)</span></label>
        <pre class="console-out" id="fb-preview"></pre>
        <p class="sandbox-actions">
          <button type="button" class="btn primary" id="fb-open">Open GitHub issue</button>
          <button type="button" class="btn" id="fb-cancel">Cancel</button>
        </p>
      </div>`;
    this.feedbackModal.addEventListener("click", (e) => {
      if (e.target === this.feedbackModal) this.hideFeedbackDialog();
    });
    this.feedbackModal.querySelector("#fb-cancel").addEventListener("click", () => this.hideFeedbackDialog());
    this.feedbackModal.querySelector("#fb-open").addEventListener("click", () => this.openFeedbackIssue());
    this.feedbackModal.querySelector("#fb-diag").addEventListener("change", () => this.updateFeedbackPreview());
    this.feedbackModal.querySelector("#fb-url").addEventListener("change", () => this.updateFeedbackPreview());

    this.backdrop.appendChild(this.panel);
    this.backdrop.appendChild(this.inspectHud);
    this.backdrop.appendChild(this.feedbackModal);
    this.shadow.appendChild(this.backdrop);

    this.backdrop.addEventListener("click", (e) => {
      if (e.target === this.backdrop) this.hide();
    });

    this.panel.tabIndex = -1;
    this.installKeyboardShield();
  }

  installKeyboardShield() {
    const stopKeys = (e) => {
      if (!this.open) return;
      e.stopPropagation();
      if (e.type === "keydown" && e.key === "Escape") {
        e.preventDefault();
        if (this.feedbackModal && !this.feedbackModal.hidden) {
          this.hideFeedbackDialog();
          return;
        }
        this.hide();
      }
    };
    this.keyboardShield = stopKeys;
    for (const type of ["keydown", "keyup", "keypress"]) {
      this.host.addEventListener(type, stopKeys);
    }
  }

  buildOverviewPanel() {
    const panel = el("div", "tab-panel");
    panel.dataset.tab = "overview";
    panel.innerHTML = `
      <div class="toolbar toolbar-stacked">
        <div class="toolbar-row">
          <button type="button" class="btn primary" id="ov-inspect">Inspect</button>
          <button type="button" class="btn sandbox-btn" id="ov-sandbox" title="Heuristic unlock/max for learning">Sandbox</button>
          <button type="button" class="btn" id="ov-analyze-dialog" title="Scan open dialog">Dialog</button>
        </div>
        <div class="toolbar-row toolbar-row-secondary">
          <button type="button" class="btn" id="ov-format-tech" title="Format tech tab">Format</button>
          <button type="button" class="btn" id="ov-goto-links" title="Links tab">Links</button>
          <label class="toolbar-check"><input type="checkbox" id="ov-auto"/> Auto-refresh</label>
        </div>
      </div>
      <p class="hint toolbar-hint">Inspect hides this panel — hover the game to preview, click for details, Esc cancels · Sandbox: preview unlock/max</p>
      <div class="tab-body scroll" id="ov-body">
        <div id="ov-inspect-banner" class="inspect-banner" hidden></div>
        <div id="ov-sandbox-panel" class="sandbox-panel" hidden></div>
        <div id="ov-inspect-result" class="inspect-result" hidden></div>
        <div id="ov-scroll"><p class="hint">Loading…</p></div>
      </div>`;
    panel.querySelector("#ov-inspect").addEventListener("click", () => this.startInspectMode());
    panel.querySelector("#ov-analyze-dialog").addEventListener("click", () => this.analyzeOpenDialog());
    panel.querySelector("#ov-format-tech").addEventListener("click", () => this.showFormatTech());
    panel.querySelector("#ov-goto-links").addEventListener("click", () => this.switchTab("links"));
    panel.querySelector("#ov-sandbox").addEventListener("click", () => this.toggleSandboxPanel());
    panel.querySelector("#ov-auto").addEventListener("change", (e) => {
      if (e.target.checked) this.startOverviewRefresh();
      else this.stopOverviewRefresh();
    });
    return panel;
  }

  buildVariablesPanel() {
    const panel = el("div", "tab-panel");
    panel.dataset.tab = "variables";
    panel.innerHTML = `
      <div class="toolbar">
        <input type="search" id="var-filter" placeholder="Filter variables…"/>
        <label><input type="checkbox" id="var-auto"/> Auto-refresh</label>
        <button type="button" class="btn" id="var-collapse">Collapse all</button>
        <button type="button" class="btn" id="var-add-root" title="Add top-level property">+ Add</button>
        <label class="var-temp-toggle" id="var-temp-wrap" hidden><input type="checkbox" id="var-temp"/> Temp vars (_)</label>
      </div>
      <p class="hint toolbar-hint">Lock <span class="lock-icon">🔒</span> keeps values when the game updates them. Map/Set containers are fully editable.</p>
      <div class="scroll" id="var-scroll"></div>`;
    panel.querySelector("#var-filter").addEventListener("input", (e) => this.filterVariables(e.target.value));
    panel.querySelector("#var-auto").addEventListener("change", (e) => {
      if (e.target.checked) this.startVarRefresh();
      else this.stopVarRefresh();
    });
    panel.querySelector("#var-collapse").addEventListener("click", () => {
      panel.querySelectorAll("details[open]").forEach((d) => d.removeAttribute("open"));
    });
    panel.querySelector("#var-add-root").addEventListener("click", () => this.promptAddProperty([]));
    panel.querySelector("#var-temp").addEventListener("change", (e) => {
      this.showTempVars = e.target.checked;
      this.renderVariables();
    });
    return panel;
  }

  buildChangesPanel() {
    const panel = el("div", "tab-panel");
    panel.dataset.tab = "changes";
    panel.innerHTML = `
      <div class="toolbar">
        <button type="button" class="btn primary" id="diff-refresh">Refresh</button>
        <button type="button" class="btn" id="diff-clear">Clear log</button>
        <label><input type="checkbox" id="diff-auto"/> Track changes</label>
        <span id="diff-status" class="status"></span>
      </div>
      <p class="hint toolbar-hint">Shows variable changes since you opened the panel — useful for debugging what a choice changed.</p>
      <div class="scroll" id="diff-scroll"></div>`;
    panel.querySelector("#diff-refresh").addEventListener("click", () => this.renderChanges());
    panel.querySelector("#diff-clear").addEventListener("click", () => this.clearChanges());
    panel.querySelector("#diff-auto").addEventListener("change", (e) => {
      if (e.target.checked) this.startDiffTracking();
      else this.stopDiffTracking();
    });
    return panel;
  }

  buildSearchPanel() {
    const panel = el("div", "tab-panel");
    panel.dataset.tab = "search";
    panel.innerHTML = `
      <div class="toolbar">
        <input type="search" id="search-q" placeholder="Search variables and passage text…"/>
        <button type="button" class="btn primary" id="search-run">Search</button>
      </div>
      <div class="scroll" id="search-scroll"><p class="hint">Search variable names/values and passage names, tags, and source.</p></div>`;
    panel.querySelector("#search-run").addEventListener("click", () => this.renderSearch());
    panel.querySelector("#search-q").addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.renderSearch();
    });
    return panel;
  }

  buildAnalysisPanel() {
    const panel = el("div", "tab-panel");
    panel.dataset.tab = "analysis";
    panel.innerHTML = `
      <div class="toolbar">
        <button type="button" class="btn primary" id="analysis-run">Analyze story</button>
        <button type="button" class="btn" id="analysis-twee">Export Twee</button>
        <button type="button" class="btn" id="analysis-copy-twee">Copy Twee</button>
      </div>
      <p class="hint toolbar-hint">Works on any Twine 2 HTML — broken links, orphans, dead ends, unreachable passages.</p>
      <div class="scroll" id="analysis-scroll"></div>`;
    panel.querySelector("#analysis-run").addEventListener("click", () => this.renderAnalysis());
    panel.querySelector("#analysis-twee").addEventListener("click", () => this.downloadTwee());
    panel.querySelector("#analysis-copy-twee").addEventListener("click", () => this.copyTwee());
    return panel;
  }

  buildWatchPanel() {
    const panel = el("div", "tab-panel");
    panel.dataset.tab = "watch";
    panel.innerHTML = `
      <div class="toolbar">
        <input type="text" id="watch-add" placeholder="Variable path e.g. health or gold"/>
        <button type="button" class="btn primary" id="watch-add-btn">Pin</button>
        <button type="button" class="btn" id="watch-refresh">Refresh</button>
      </div>
      <p class="hint toolbar-hint">Pinned variables refresh every second. Changed values flash yellow.</p>
      <div class="tab-body scroll" id="watch-scroll"></div>`;
    panel.querySelector("#watch-add-btn").addEventListener("click", () => this.addWatchVar());
    panel.querySelector("#watch-add").addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.addWatchVar();
    });
    panel.querySelector("#watch-refresh").addEventListener("click", () => this.renderWatch());
    return panel;
  }

  buildDomPanel() {
    const panel = el("div", "tab-panel");
    panel.dataset.tab = "dom";
    panel.innerHTML = `
      <div class="toolbar">
        <button type="button" class="btn primary" id="dom-scan">Scan DOM</button>
        <button type="button" class="btn" id="dom-clear-hl">Clear highlights</button>
        <select id="dom-filter"><option value="">All types</option><option value="link">Menu links</option><option value="inline-link">Inline / profile links</option><option value="action-link">In-place actions</option><option value="interactive">Other interactive</option><option value="variable">Variables</option><option value="image">Images</option><option value="hidden">Hidden</option><option value="macro">Macros</option></select>
      </div>
      <p class="hint toolbar-hint">Finds passage links, inline text links, buttons, and <code>data-setter</code> actions (no navigation).</p>
      <div class="scroll" id="dom-scroll"></div>`;
    panel.querySelector("#dom-scan").addEventListener("click", () => this.renderDom());
    panel.querySelector("#dom-clear-hl").addEventListener("click", () => callPage("clearHighlights"));
    panel.querySelector("#dom-filter").addEventListener("change", () => this.renderDom());
    return panel;
  }

  buildSavesPanel() {
    const panel = el("div", "tab-panel");
    panel.dataset.tab = "saves";
    panel.innerHTML = `
      <div class="toolbar">
        <button type="button" class="btn primary" id="saves-refresh">Refresh</button>
        <button type="button" class="btn" id="saves-decode">Decode save bundle</button>
        <button type="button" class="btn" id="saves-storage">Raw storage</button>
      </div>
      <p class="hint" style="padding:0 12px">Uses SugarCube <code>Save.browser.*</code> and <code>Save.base64.export()</code>. Raw storage lists all <code>localStorage</code> / <code>sessionStorage</code> keys for this origin (like SugarCube's Storage Explorer).</p>
      <div class="scroll" id="saves-scroll"></div>`;
    panel.querySelector("#saves-refresh").addEventListener("click", () => this.renderSaves(false));
    panel.querySelector("#saves-decode").addEventListener("click", () => this.renderSaves(true));
    panel.querySelector("#saves-storage").addEventListener("click", () => this.renderSaves("storage"));
    return panel;
  }

  buildChatPanel() {
    const panel = el("div", "tab-panel");
    panel.dataset.tab = "chat";
    panel.hidden = true;
    panel.innerHTML = `
      <div class="toolbar">
        <button type="button" class="btn primary" id="chat-refresh">Refresh</button>
        <label><input type="checkbox" id="chat-auto"/> Auto-refresh</label>
      </div>
      <p class="hint toolbar-hint">CHATSYSTEM — conversations, branch debugging, and dev actions.</p>
      <div class="tab-body scroll" id="chat-scroll"></div>`;
    panel.querySelector("#chat-refresh").addEventListener("click", () => this.renderChat());
    panel.querySelector("#chat-auto").addEventListener("change", (e) => {
      if (e.target.checked) this.startChatRefresh();
      else this.stopChatRefresh();
    });
    return panel;
  }

  buildFormatPanel() {
    const panel = el("div", "tab-panel");
    panel.dataset.tab = "format";
    panel.innerHTML = `
      <div class="toolbar">
        <button type="button" class="btn primary" id="format-refresh">Refresh scan</button>
      </div>
      <p class="hint toolbar-hint">Generic SugarCube introspection — custom macros, widgets, setup, Config, Setting, and window classes. Works on any game.</p>
      <div class="tab-body scroll" id="format-scroll"><p class="hint">Click Refresh scan to analyze this story.</p></div>`;
    panel.querySelector("#format-refresh").addEventListener("click", () => this.renderFormat());
    return panel;
  }

  buildPeoplePanel() {
    const panel = el("div", "tab-panel");
    panel.dataset.tab = "people";
    panel.innerHTML = `
      <div class="toolbar toolbar-stacked">
        <div class="toolbar-row">
          <label>Registry <select id="people-registry"></select></label>
          <button type="button" class="btn" id="people-refresh" title="Re-scan state for entity registries">Rescan</button>
        </div>
        <div class="toolbar-row">
          <input type="search" id="people-filter" placeholder="Filter by name / status…" class="people-filter"/>
          <label>Sort <select id="people-sort">
            <option value="name">Name</option>
            <option value="met">Met / known first</option>
            <option value="fields">Detail (fields)</option>
          </select></label>
          <label class="toolbar-check"><input type="checkbox" id="people-onlymet"/> Only met/known</label>
        </div>
      </div>
      <p class="hint toolbar-hint">Auto-detected registries of character/NPC-like objects in game state. Generic — works on any SugarCube game that stores entities this way. Click a name to edit it in Variables.</p>
      <div class="tab-body scroll" id="people-scroll"><p class="hint">Scanning game state…</p></div>`;
    panel.querySelector("#people-registry").addEventListener("change", () => this.renderPeople());
    panel.querySelector("#people-refresh").addEventListener("click", () => this.renderPeople(true));
    panel.querySelector("#people-sort").addEventListener("change", () => this.renderPeopleEntries());
    panel.querySelector("#people-onlymet").addEventListener("change", () => this.renderPeopleEntries());
    let peopleFilterTimer = null;
    panel.querySelector("#people-filter").addEventListener("input", () => {
      clearTimeout(peopleFilterTimer);
      peopleFilterTimer = setTimeout(() => this.renderPeopleEntries(), 200);
    });
    return panel;
  }

  buildPassagesPanel() {
    const panel = el("div", "tab-panel");
    panel.dataset.tab = "passages";
    panel.innerHTML = `
      <div class="toolbar">
        <input type="search" id="pass-filter" placeholder="Filter passages…"/>
        <select id="pass-category" title="Filter by tag category">
          ${TAG_CATEGORY_OPTIONS.map((o) => `<option value="${escAttr(o.id)}">${esc(o.label)}</option>`).join("")}
        </select>
        <input type="text" id="pass-goto" placeholder="Go to passage…"/>
        <button type="button" class="btn primary" id="pass-goto-btn">Go</button>
      </div>
      <div class="scroll" id="pass-scroll"></div>`;
    let passFilterTimer = null;
    panel.querySelector("#pass-filter").addEventListener("input", (e) => {
      clearTimeout(passFilterTimer);
      passFilterTimer = setTimeout(() => this.renderPassageList(e.target.value), 200);
    });
    panel.querySelector("#pass-category").addEventListener("change", () => this.renderPassageList(panel.querySelector("#pass-filter").value));
    panel.querySelector("#pass-goto-btn").addEventListener("click", () => this.gotoPassage(panel.querySelector("#pass-goto").value));
    panel.querySelector("#pass-goto").addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.gotoPassage(e.target.value);
    });
    return panel;
  }

  buildLinksPanel() {
    const panel = el("div", "tab-panel");
    panel.dataset.tab = "links";
    panel.innerHTML = `<div class="toolbar"><span class="hint">Outgoing links from current passage + DOM visibility</span><button type="button" class="btn" id="links-refresh">Refresh</button></div><div class="scroll" id="links-scroll"></div>`;
    panel.querySelector("#links-refresh").addEventListener("click", () => this.renderLinks());
    return panel;
  }

  buildGraphPanel() {
    const panel = el("div", "tab-panel");
    panel.dataset.tab = "graph";
    panel.innerHTML = `
      <div class="toolbar toolbar-stacked">
        <div class="toolbar-row">
          <label>From <select id="graph-from"><option value="">— current —</option></select></label>
          <label>Depth <input type="number" id="graph-depth" min="1" max="5" value="2" class="input-sm"/></label>
          <select id="graph-category" title="Filter by tag category">
            ${TAG_CATEGORY_OPTIONS.map((o) => `<option value="${escAttr(o.id)}">${esc(o.label)}</option>`).join("")}
          </select>
          <label class="toolbar-check"><input type="checkbox" id="graph-hubs"/> Hubs only</label>
        </div>
        <div class="toolbar-row">
          <button type="button" class="btn primary" id="graph-render">Visual map</button>
          <button type="button" class="btn" id="graph-all">Full story</button>
          <button type="button" class="btn" id="graph-table">Table</button>
          <label class="toolbar-check"><input type="checkbox" id="graph-dom" checked/> Live DOM</label>
        </div>
        <div class="toolbar-row">
          <input type="search" id="graph-find" placeholder="Find passage in map…" class="graph-find"/>
          <label class="toolbar-check" title="Hide passages with fewer total links — declutters huge maps">Min links <input type="number" id="graph-min" min="0" max="99" value="0" class="input-sm"/></label>
          <span id="graph-find-status" class="hint"></span>
        </div>
      </div>
      <p class="hint toolbar-hint">Node colors = tag category · node size = link count · gold dashed = tag hints · blue = live DOM choices</p>
      <div class="tab-body scroll graph-body" id="graph-scroll"></div>`;
    panel.querySelector("#graph-render").addEventListener("click", () => this.renderGraphVisual(false));
    panel.querySelector("#graph-all").addEventListener("click", () => this.renderGraphVisual(true));
    panel.querySelector("#graph-table").addEventListener("click", () => this.renderGraph(false));
    panel.querySelector("#graph-find").addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.rerenderLastGraph();
    });
    panel.querySelector("#graph-min").addEventListener("change", () => this.rerenderLastGraph());
    return panel;
  }

  buildMediaPanel() {
    const panel = el("div", "tab-panel");
    panel.dataset.tab = "media";
    panel.innerHTML = `
      <div class="toolbar">
        <button type="button" class="btn primary" id="media-scan">Scan media</button>
        <button type="button" class="btn" id="media-check">Check all (slow)</button>
        <span id="media-status" class="status"></span>
      </div>
      <div class="scroll" id="media-scroll"></div>`;
    panel.querySelector("#media-scan").addEventListener("click", () => this.renderMedia(false));
    panel.querySelector("#media-check").addEventListener("click", () => this.renderMedia(true));
    return panel;
  }

  buildSetupPanel() {
    const panel = el("div", "tab-panel");
    panel.dataset.tab = "setup";
    panel.innerHTML = `<div class="toolbar"><input type="search" id="setup-filter" placeholder="Filter setup keys…"/><button type="button" class="btn" id="setup-refresh">Refresh</button></div><div class="scroll" id="setup-scroll"></div>`;
    panel.querySelector("#setup-filter").addEventListener("input", (e) => this.renderSetup(e.target.value));
    panel.querySelector("#setup-refresh").addEventListener("click", () => this.renderSetup());
    return panel;
  }

  buildJsonPanel() {
    const panel = el("div", "tab-panel");
    panel.dataset.tab = "json";
    panel.innerHTML = `
      <div class="toolbar">
        <button type="button" class="btn primary" id="json-export">Export</button>
        <button type="button" class="btn" id="json-copy">Copy</button>
        <button type="button" class="btn danger" id="json-merge">Merge apply</button>
        <button type="button" class="btn" id="json-snap" title="Save the current variables inside the extension">📸 Snapshot</button>
      </div>
      <p class="hint toolbar-hint">Snapshots keep up to ${MAX_SNAPSHOTS_PER_STORY} variable states per story inside the extension — restore one to A/B-test branching paths. Restore merges values (use a test save).</p>
      <div id="json-snaps" class="snap-list"></div>
      <div class="tab-body json-body">
        <textarea class="json-area" id="json-editor" spellcheck="false"></textarea>
      </div>`;
    panel.querySelector("#json-export").addEventListener("click", () => this.exportJson());
    panel.querySelector("#json-copy").addEventListener("click", () => this.copyJson());
    panel.querySelector("#json-merge").addEventListener("click", () => this.mergeJson());
    panel.querySelector("#json-snap").addEventListener("click", () => this.takeSnapshot());
    return panel;
  }

  buildConsolePanel() {
    const panel = el("div", "tab-panel");
    panel.dataset.tab = "console";
    panel.innerHTML = `
      <div class="toolbar"><span class="hint">Eval in game context · Ctrl+Enter to run</span></div>
      <div class="tab-body console-body">
        <div id="con-snippets" class="snippet-bar"></div>
        <textarea id="con-in" rows="3" placeholder="SugarCube.State.passage"></textarea>
        <button type="button" class="btn" id="con-run">Run</button>
        <pre class="console-out" id="con-out"></pre>
      </div>`;
    const input = panel.querySelector("#con-in");
    const snippetHost = panel.querySelector("#con-snippets");
    mountSnippetBar(snippetHost, input, (code) => this.runConsole(code));
    panel.querySelector("#con-run").addEventListener("click", () => this.runConsole());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) this.runConsole();
    });
    return panel;
  }

  toggle() {
    if (this.open) this.hide();
    else this.show();
  }

  async show() {
    await this.loadCss();
    this.open = true;
    this.backdrop.classList.add("open");
    if (document.body) document.body.setAttribute("inert", "");
    callPage("setOverlayKeyboardBlock", { active: true }).catch(() => {});
    await this.initEngine();
    this.switchTab(this.activeTab);
    const active = document.activeElement;
    if (active && active !== document.body && active.getRootNode() !== this.shadow) {
      active.blur();
    }
    this.panel.focus({ preventScroll: true });
    this.maybeCheckForUpdate();
  }

  hide() {
    this.open = false;
    this.stopInspectMode(false);
    this.backdrop.classList.remove("open");
    if (document.body) document.body.removeAttribute("inert");
    callPage("setOverlayKeyboardBlock", { active: false }).catch(() => {});
    this.stopVarRefresh();
    this.stopWatchRefresh();
    this.stopOverviewRefresh();
    this.stopDiffRefresh();
    this.stopChatRefresh();
    callPage("clearHighlights").catch(() => {});
    // Keep the host and instance alive so the active tab, filters, map, and
    // inspect results survive close/reopen. destroy() removes it for real.
  }

  destroy() {
    this.hide();
    this.stopDiffTracking();
    if (this.graphCleanup) {
      this.graphCleanup();
      this.graphCleanup = null;
    }
    this.host.remove();
    if (this.onClose) this.onClose();
  }

  switchTab(id) {
    this.activeTab = id;
    if (id !== "watch") this.stopWatchRefresh();
    if (id !== "variables") this.stopVarRefresh();
    if (id !== "overview") this.stopOverviewRefresh();
    if (id !== "changes") this.stopDiffRefresh();
    if (id !== "chat") this.stopChatRefresh();
    for (const tab of TABS) {
      this.tabButtons[tab.id].classList.toggle("active", tab.id === id);
      this.tabPanels[tab.id].classList.toggle("active", tab.id === id);
    }
    const activeBtn = this.tabButtons[id];
    if (activeBtn) {
      activeBtn.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
    }
    this.refreshActiveTab();
  }

  refreshActiveTab() {
    const map = {
      overview: () => this.renderOverview(),
      variables: () => this.renderVariables(),
      changes: () => this.renderChanges(),
      watch: () => this.renderWatch(),
      search: () => {},
      analysis: () => this.renderAnalysis(),
      format: () => this.renderFormat(),
      people: () => this.renderPeople(),
      passages: () => this.renderPassageList(""),
      links: () => this.renderLinks(),
      graph: () => this.showGraphPlaceholder(),
      dom: () => this.renderDom(),
      chat: () => this.renderChat(),
      media: () => this.renderMedia(false),
      saves: () => this.renderSaves(false),
      setup: () => this.renderSetup(""),
      json: () => {
        this.exportJson();
        this.renderSnapshots();
      },
      console: () => {},
    };
    map[this.activeTab]?.();
  }

  async initEngine() {
    try {
      // detectLite skips serializing the whole variable store (slow on big games).
      try {
        this.engine = await callPage("detectLite");
      } catch {
        this.engine = await callPage("detect");
      }
      this.capabilities = (this.engine && this.engine.capabilities) || (await callPage("getCapabilities")) || {};
      if (this.engine) {
        const cap = this.capabilities;
        const level = cap.variables === "full" ? "full edit" : cap.variables === "read" ? "read-only vars" : "storydata";
        this.badgeEl.textContent = `${this.engine.profile.label} · ${level}`;
        this.badgeEl.title = formatCapabilitiesTooltip(cap);
        const meta = await callPage("getMeta");
        if (meta && meta.storyTitle) this.titleEl.textContent = meta.storyTitle;
        this.applyFormatUi();
        await this.syncLocksFromPage();
        try {
          const chatInfo = await callPage("detectChatSystem");
          this.chatSystemDetected = !!(chatInfo && chatInfo.detected);
        } catch (e) {
          this.chatSystemDetected = false;
        }
        this.applyChatTabVisibility();
        await this.detectEntityRegistries();
        if (cap.diff !== false && this.tabPanels.changes?.querySelector("#diff-auto")?.checked) {
          await this.startDiffTracking();
        }
        return;
      }

      this.badgeEl.textContent = "No Twine engine detected";
      await this.renderIframePicker();
    } catch (e) {
      this.badgeEl.textContent = "Connection error";
    }
  }

  applyFormatUi() {
    const cap = this.capabilities || {};
    const tempWrap = this.tabPanels.variables?.querySelector("#var-temp-wrap");
    if (tempWrap) tempWrap.hidden = cap.tempVariables !== "full";
    const savesHint = cap.saves ? "" : " (SugarCube only)";
    if (this.tabButtons.saves) {
      this.tabButtons.saves.title = cap.saves ? "Save slots" : `Save slots${savesHint} — not available for this format`;
    }
    this.applyChatTabVisibility();
  }

  applyChatTabVisibility() {
    const show = !!this.chatSystemDetected;
    if (this.tabButtons.chat) {
      this.tabButtons.chat.hidden = !show;
      this.tabButtons.chat.title = show ? "CHATSYSTEM inspector" : "";
    }
    if (this.tabPanels.chat) this.tabPanels.chat.hidden = !show;
    if (this.badgeEl && show && !/\bCHATSYSTEM\b/.test(this.badgeEl.textContent)) {
      this.badgeEl.textContent = `${this.badgeEl.textContent} · CHATSYSTEM`;
    }
  }

  async renderAnalysis() {
    const scroll = this.tabPanels.analysis.querySelector("#analysis-scroll");
    try {
      const [data, meta, taxonomy] = await Promise.all([
        callPage("getStoryAnalysis"),
        callPage("getMeta"),
        callPage("getTagTaxonomy"),
      ]);
      scroll.innerHTML = `
        <div class="stat-grid">
          <div class="stat-card"><div class="label">Passages</div><div class="value">${data.passageCount}</div></div>
          <div class="stat-card"><div class="label">Start</div><div class="value" style="font-size:12px">${esc(data.startPassage || "—")}</div></div>
          <div class="stat-card"><div class="label">Broken links</div><div class="value">${data.brokenLinks.length}</div></div>
          <div class="stat-card"><div class="label">Unreachable</div><div class="value">${data.unreachable.length}</div></div>
        </div>
        <p class="hint">Format: ${esc((meta && meta.format) || (meta && meta.engine) || "?")} · Link parser: ${esc(this.engine?.profile?.family || "storydata")} · ${data.totalStaticLinks ?? "?"} static links found</p>
        ${data.runtimeNavLikely ? `<div class="inspect-banner"><strong>Runtime-driven navigation detected.</strong> Most passages here are connected by widgets, macros, or Story JavaScript rather than static links — so orphan / dead-end / unreachable counts below are not meaningful for this game. Use the Links tab and the Map's Live DOM edges while playing to see real navigation, and the Format tab to see the widget/macro systems that build it.</div>` : ""}
        ${renderTagTaxonomySection(taxonomy)}
        ${renderAnalysisSection("Broken link targets", data.brokenLinks, (x) =>
          `<tr><td>${esc(x.from)}</td><td>${esc(x.label)}</td><td><span class="tag bad">${esc(x.target)}</span></td></tr>`,
          ["From", "Label", "Missing target"]
        )}
        ${renderAnalysisSection("Orphan passages (no incoming links)", data.orphanPassages, (n) =>
          `<tr><td><button type="button" class="link-btn" data-goto="${escAttr(n)}">${esc(n)}</button></td></tr>`,
          ["Passage"]
        )}
        ${renderAnalysisSection("Dead ends (no outgoing links)", data.deadEnds, (n) =>
          `<tr><td><button type="button" class="link-btn" data-goto="${escAttr(n)}">${esc(n)}</button></td></tr>`,
          ["Passage"]
        )}
        ${renderAnalysisSection("Unreachable from start", data.unreachable, (n) =>
          `<tr><td><button type="button" class="link-btn" data-goto="${escAttr(n)}">${esc(n)}</button></td></tr>`,
          ["Passage"]
        )}`;
      scroll.querySelectorAll("[data-goto]").forEach((btn) => {
        btn.addEventListener("click", () => this.gotoPassage(btn.dataset.goto));
      });
    } catch (e) {
      scroll.innerHTML = `<p class="status err">${esc(e.message)}</p>`;
    }
  }

  async downloadTwee() {
    try {
      const twee = await callPage("exportTwee");
      const blob = new Blob([twee], { type: "text/plain" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = (this.titleEl.textContent || "story") + ".twee";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      alert(e.message);
    }
  }

  async copyTwee() {
    try {
      const twee = await callPage("exportTwee");
      await navigator.clipboard.writeText(twee);
    } catch (e) {
      alert(e.message);
    }
  }

  async renderIframePicker() {
    const findIframes = this.iframeBridge.findIframes;
    if (!findIframes) return;

    const iframes = findIframes().filter((f) => f.accessible);
    if (!iframes.length) return;

    const scroll = this.tabPanels.overview.querySelector("#ov-scroll");
    if (!scroll) return;

    scroll.innerHTML = `
      <div class="iframe-picker">
        <h4>Game may be inside an iframe</h4>
        <p class="hint">Twine Peeks did not detect a story on this page, but found embedded frames. Pick one to attach:</p>
        <ul class="iframe-list">
          ${iframes.map((f, i) => `
            <li>
              <button type="button" class="btn primary iframe-pick" data-iframe-idx="${i}">
                ${esc(f.title)} — ${esc(f.src)}
              </button>
            </li>`).join("")}
        </ul>
      </div>`;

    this._iframeCandidates = iframes;
    scroll.querySelectorAll(".iframe-pick").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const idx = Number(btn.dataset.iframeIdx);
        const frame = this._iframeCandidates[idx];
        if (!frame || !this.iframeBridge.attachToIframe) return;
        try {
          btn.disabled = true;
          btn.textContent = "Connecting…";
          const ok = await this.iframeBridge.attachToIframe(frame.element);
          if (!ok) throw new Error("No Twine game in that frame");
          await this.initEngine();
          this.refreshActiveTab();
        } catch (err) {
          alert(err.message || String(err));
          btn.disabled = false;
        }
      });
    });
  }

  async syncLocksFromPage() {
    try {
      const paths = await callPage("getLockedPaths");
      const stored = await loadLockedPaths();
      const all = new Set([...(paths || []).map((p) => p.join(".")), ...stored]);
      this.lockedPaths = all;
      for (const p of stored) {
        await callPage("setPathLock", { path: p.split("."), locked: true });
      }
    } catch {
      this.lockedPaths = new Set(await loadLockedPaths());
    }
  }

  async startDiffTracking() {
    try {
      await callPage("startDiffTracking", { intervalMs: 500 });
    } catch {
      /* ignore */
    }
    this.startDiffRefresh();
  }

  async stopDiffTracking() {
    try {
      await callPage("stopDiffTracking");
    } catch {
      /* ignore */
    }
    this.stopDiffRefresh();
  }

  startDiffRefresh() {
    this.stopDiffRefresh();
    if (this.tabPanels.changes?.querySelector("#diff-auto")?.checked === false) return;
    this.diffTimer = setInterval(() => {
      if (this.open && this.activeTab === "changes") this.renderChanges();
    }, 800);
  }

  stopDiffRefresh() {
    if (this.diffTimer) clearInterval(this.diffTimer);
    this.diffTimer = null;
  }

  async clearChanges() {
    await callPage("clearDiffLog");
    await this.renderChanges();
  }

  async renderChanges() {
    const scroll = this.tabPanels.changes.querySelector("#diff-scroll");
    const status = this.tabPanels.changes.querySelector("#diff-status");
    try {
      const log = await callPage("getDiffLog", { limit: 100 });
      status.textContent = log.tracking ? `${log.frameCount} frames` : "paused";
      if (!log.frames.length) {
        scroll.innerHTML = `<p class="empty">No changes recorded yet. Make a choice in the game.</p>`;
        if (this.tabPanels.changes.querySelector("#diff-auto")?.checked) this.startDiffRefresh();
        return;
      }
      scroll.innerHTML = log.frames
        .map((frame) => {
          const time = new Date(frame.ts).toLocaleTimeString();
          const rows = frame.diffs
            .map((d) => `<tr><td><code>${esc(formatDiffPath(d))}</code></td><td>${formatDiffBadge(d)}</td><td>${formatDiffValues(d)}</td></tr>`)
            .join("");
          return `
            <details class="diff-frame" open>
              <summary><strong>${esc(time)}</strong> · passage <span class="tag">${esc(frame.passage || "?")}</span> · ${frame.diffs.length} change(s)</summary>
              <table class="data diff-table"><tr><th>Path</th><th>Kind</th><th>Values</th></tr>${rows}</table>
            </details>`;
        })
        .join("");
      if (this.tabPanels.changes.querySelector("#diff-auto")?.checked) this.startDiffRefresh();
    } catch (e) {
      scroll.innerHTML = `<p class="status err">${esc(e.message)}</p>`;
    }
  }

  async renderSearch() {
    const scroll = this.tabPanels.search.querySelector("#search-scroll");
    const q = this.tabPanels.search.querySelector("#search-q").value.trim();
    if (!q) {
      scroll.innerHTML = `<p class="hint">Enter a search term.</p>`;
      return;
    }
    try {
      const results = await callPage("globalSearch", { query: q, limit: 80 });
      const stateRows = (results.state || [])
        .map((r) => `<tr><td><code>${esc(r.path.join("."))}</code></td><td>${esc(String(r.value))}</td></tr>`)
        .join("");
      const passRows = (results.passages || [])
        .map(
          (p) =>
            `<tr><td><button type="button" class="link-btn" data-pass="${escAttr(p.name)}">${esc(p.name)}</button></td><td>${(p.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join(" ") || "—"}</td><td class="snippet">${esc(p.snippet)}…</td></tr>`
        )
        .join("");

      scroll.innerHTML = `
        <h4>Variables (${(results.state || []).length})</h4>
        ${stateRows ? `<table class="data"><tr><th>Path</th><th>Value</th></tr>${stateRows}</table>` : `<p class="empty">No variable matches.</p>`}
        <h4>Passages (${(results.passages || []).length})</h4>
        ${passRows ? `<table class="data"><tr><th>Name</th><th>Tags</th><th>Snippet</th></tr>${passRows}</table>` : `<p class="empty">No passage matches.</p>`}`;

      scroll.querySelectorAll("[data-pass]").forEach((btn) => {
        btn.addEventListener("click", () => {
          this.switchTab("passages");
          this.selectedPassage = btn.dataset.pass;
          this.renderPassageList("");
        });
      });
    } catch (e) {
      scroll.innerHTML = `<p class="status err">${esc(e.message)}</p>`;
    }
  }

  stopOverviewRefresh() {
    if (this.overviewRefreshTimer) clearInterval(this.overviewRefreshTimer);
    this.overviewRefreshTimer = null;
  }

  async analyzeOpenDialog() {
    try {
      const data = await callPage("analyzeOpenDialog");
      this.lastInspectResult = data;
      this.renderInspectResult(data);
    } catch (e) {
      this.renderInspectResult({ error: e.message || String(e) });
    }
  }

  async showFormatTech() {
    this.switchTab("format");
  }

  toggleSandboxPanel() {
    const panel = this.tabPanels.overview?.querySelector("#ov-sandbox-panel");
    if (!panel) return;
    if (!panel.hidden) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    this.lastSandboxScan = null;
    panel.innerHTML = `
      <div class="sandbox-card">
        <div class="inspect-result-head">
          <strong>Sandbox boost</strong>
          <span class="tag warn">heuristic</span>
        </div>
        <p class="hint">Generic unlock/max for learning — scans <code>State.variables</code> with pattern matching. Works best on SugarCube sandbox games. Always preview first.</p>
        <div class="sandbox-options">
          <label><input type="checkbox" id="sb-unlock" checked/> Unlock flags (booleans: met, known, unlocked…)</label>
          <label><input type="checkbox" id="sb-max" checked/> Max stats & meters (friendship, skills, level…)</label>
          <label><input type="checkbox" id="sb-money" checked/> Boost money/currency</label>
          <label><input type="checkbox" id="sb-passages" checked/> Fill passage visit maps</label>
        </div>
        <p class="sandbox-actions">
          <button type="button" class="btn primary" id="sb-preview">Preview changes</button>
          <button type="button" class="btn sandbox-btn" id="sb-apply" disabled>Apply boost</button>
          <button type="button" class="btn" id="sb-close">Close</button>
        </p>
        <div id="sb-results"></div>
      </div>`;
    panel.querySelector("#sb-preview").addEventListener("click", () => this.previewSandboxBoost());
    panel.querySelector("#sb-apply").addEventListener("click", () => this.applySandboxBoost());
    panel.querySelector("#sb-close").addEventListener("click", () => {
      panel.hidden = true;
    });
  }

  getSandboxBoostOptions() {
    const panel = this.tabPanels.overview?.querySelector("#ov-sandbox-panel");
    return {
      unlockBooleans: panel?.querySelector("#sb-unlock")?.checked !== false,
      maxNumerics: panel?.querySelector("#sb-max")?.checked !== false,
      boostMoney: panel?.querySelector("#sb-money")?.checked !== false,
      markPassages: panel?.querySelector("#sb-passages")?.checked !== false,
    };
  }

  async previewSandboxBoost() {
    const results = this.tabPanels.overview?.querySelector("#sb-results");
    const applyBtn = this.tabPanels.overview?.querySelector("#sb-apply");
    if (!results) return;
    results.innerHTML = `<p class="hint">Scanning variables…</p>`;
    if (applyBtn) applyBtn.disabled = true;
    try {
      const scan = await callPage("scanSandboxBoost", this.getSandboxBoostOptions());
      this.lastSandboxScan = scan;
      if (!scan.supported) {
        results.innerHTML = `<p class="status err">${esc(scan.reason || "Not supported")}</p>`;
        return;
      }
      results.innerHTML = renderSandboxPreview(scan);
      if (applyBtn) applyBtn.disabled = !scan.changeCount;
    } catch (e) {
      results.innerHTML = `<p class="status err">${esc(e.message || String(e))}</p>`;
    }
  }

  async applySandboxBoost() {
    const scan = this.lastSandboxScan;
    const count = scan?.changeCount || 0;
    if (!count) {
      await this.previewSandboxBoost();
      return;
    }
    if (
      !confirm(
        `Apply ${count} heuristic changes to live save variables?\n\nThis cannot be undone automatically. Use a test save or export JSON first.`
      )
    ) {
      return;
    }
    const results = this.tabPanels.overview?.querySelector("#sb-results");
    try {
      const result = await callPage("applySandboxBoost", {
        ...this.getSandboxBoostOptions(),
        apply: true,
      });
      if (results) {
        results.innerHTML = `
          <p class="status ok">Applied ${result.applied} changes${result.failed ? ` (${result.failed} failed)` : ""}.</p>
          <p class="hint">Unlock: ${result.summary?.unlock || 0} · Locks cleared: ${result.summary?.invertLock || 0} · Maxed: ${result.summary?.max || 0} · Passages: ${result.summary?.passage || 0}</p>
          ${result.errors?.length ? `<pre class="console-out">${esc(JSON.stringify(result.errors, null, 2))}</pre>` : ""}
          <p class="hint">Check Variables / Changes tabs. You may need to navigate or refresh the passage for UI to update.</p>`;
      }
      this.tabPanels.overview.querySelector("#sb-apply").disabled = true;
      this.lastSandboxScan = null;
    } catch (e) {
      if (results) results.innerHTML = `<p class="status err">${esc(e.message || String(e))}</p>`;
    }
  }

  async renderFormat() {
    const scroll = this.tabPanels.format?.querySelector("#format-scroll");
    if (!scroll) return;
    scroll.innerHTML = `<p class="hint">Scanning SugarCube extension points…</p>`;
    try {
      const tech = await callPage("getFormatTech");
      scroll.innerHTML = renderFormatTech(tech, { inTab: true });
    } catch (e) {
      scroll.innerHTML = `<p class="status err">${esc(e.message || String(e))}</p>`;
    }
  }

  entityRegistries = [];

  applyPeopleTabVisibility() {
    const show = this.entityRegistries.length > 0;
    if (this.tabButtons.people) {
      this.tabButtons.people.hidden = !show;
      this.tabButtons.people.title = show
        ? `${this.entityRegistries.length} entity registr${this.entityRegistries.length === 1 ? "y" : "ies"} detected`
        : "";
    }
    if (this.tabPanels.people) this.tabPanels.people.hidden = !show;
  }

  async detectEntityRegistries() {
    try {
      const res = await callPage("getEntityRegistries");
      this.entityRegistries = (res && res.registries) || [];
    } catch {
      this.entityRegistries = [];
    }
    this.applyPeopleTabVisibility();
  }

  async renderPeople(rescan = false) {
    const scroll = this.tabPanels.people.querySelector("#people-scroll");
    const select = this.tabPanels.people.querySelector("#people-registry");
    if (rescan || !this.entityRegistries.length) {
      await this.detectEntityRegistries();
    }
    if (!this.entityRegistries.length) {
      scroll.innerHTML = `<p class="empty">No character/NPC-like registries found in game state. This game may store entities differently, or none are created yet — try again after starting a game.</p>`;
      return;
    }
    const prev = select.value;
    select.innerHTML = this.entityRegistries
      .map(
        (r, i) =>
          `<option value="${i}">${esc(r.pathExpr)} — ${r.count} ${esc(r.kind === "array" ? "items" : "entries")}${r.statFields.length ? " · stats: " + esc(r.statFields.slice(0, 3).join(", ")) : ""}</option>`
      )
      .join("");
    if (prev && this.entityRegistries[Number(prev)]) select.value = prev;
    await this.renderPeopleEntries();
  }

  async renderPeopleEntries() {
    const scroll = this.tabPanels.people.querySelector("#people-scroll");
    const select = this.tabPanels.people.querySelector("#people-registry");
    const reg = this.entityRegistries[Number(select.value) || 0];
    if (!reg) {
      scroll.innerHTML = `<p class="empty">Pick a registry.</p>`;
      return;
    }
    const filter = this.tabPanels.people.querySelector("#people-filter").value;
    const sortSel = this.tabPanels.people.querySelector("#people-sort");
    const onlyMet = this.tabPanels.people.querySelector("#people-onlymet").checked;

    // Offer per-stat sort options for whatever meters this registry exposes.
    const statOpts = (reg.statFields || []).map((f) => `rel:${f}`);
    const wantStatOpts = statOpts.join("|");
    if (sortSel.dataset.stats !== wantStatOpts) {
      sortSel.dataset.stats = wantStatOpts;
      const base = `<option value="name">Name</option><option value="met">Met / known first</option><option value="fields">Detail (fields)</option>`;
      const extra = statOpts.map((v) => `<option value="${escAttr(v)}">Highest ${esc(v.slice(4))}</option>`).join("");
      const cur = sortSel.value;
      sortSel.innerHTML = base + extra;
      if ([...sortSel.options].some((o) => o.value === cur)) sortSel.value = cur;
    }

    try {
      const data = await callPage("getEntityRegistryEntries", {
        path: reg.path,
        nameField: reg.nameField,
        nameByKey: reg.nameByKey,
        filter,
        sort: sortSel.value,
        onlyMet,
        limit: 300,
      });
      const entries = data.entries || [];
      if (!entries.length) {
        scroll.innerHTML = `<p class="empty">No entries match. ${onlyMet ? "Try unchecking “Only met/known”." : ""}</p>`;
        return;
      }
      scroll.innerHTML = `
        <p class="hint">${data.shown} of ${data.total} shown${data.total > data.shown ? " (filter to narrow)" : ""} · registry <code>${esc(reg.pathExpr)}</code> (${reg.count} total)</p>
        <div class="people-grid">
          ${entries.map((e) => this.renderPersonCard(e)).join("")}
        </div>`;
      scroll.querySelectorAll("[data-person-path]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const path = btn.dataset.personPath;
          this.switchTab("variables");
          const filterInput = this.tabPanels.variables.querySelector("#var-filter");
          if (filterInput) {
            filterInput.value = path;
            this.filterVariables(path);
          }
        });
      });
    } catch (e) {
      scroll.innerHTML = `<p class="status err">${esc(e.message || String(e))}</p>`;
    }
  }

  renderPersonCard(e) {
    const relChips = (e.rel || [])
      .map((r) => `<span class="tag ${r.num ? "ok" : ""}" title="${escAttr(r.label)}">${esc(shortStatLabel(r.label))}: ${esc(String(r.value))}</span>`)
      .join("");
    const tagChips = (e.tags || [])
      .map((t) => `<span class="tag warn" title="${escAttr(t.label)}">${esc(t.value)}</span>`)
      .join("");
    const flagChips = (e.flags || [])
      .filter((f) => f.value === true)
      .map((f) => `<span class="tag">${esc(shortStatLabel(f.label))}</span>`)
      .join("");
    return `
      <div class="person-card${e.met ? " person-met" : ""}">
        <div class="person-card-head">
          <button type="button" class="link-btn person-name" data-person-path="${escAttr((e.path || []).join("."))}" title="Open in Variables">${esc(e.name)}</button>
          <span class="hint">${e.fieldCount} fields</span>
        </div>
        <div class="person-card-body">
          ${tagChips || ""}
          ${relChips || ""}
          ${flagChips || ""}
          ${!tagChips && !relChips && !flagChips ? '<span class="hint">background — no relationship data yet</span>' : ""}
        </div>
      </div>`;
  }

  startInspectMode() {
    if (!this.gameInspector) {
      this.gameInspector = new GameInspector({
        host: this.host,
        panel: this.panel,
        backdrop: this.backdrop,
        onResult: (data) => {
          this.setInspectVisual(false);
          this.lastInspectResult = data;
          callPage("setOverlayKeyboardBlock", { active: true }).catch(() => {});
          if (document.body) document.body.setAttribute("inert", "");
          this.renderInspectBanner(null);
          this.renderInspectResult(data);
          this.panel.focus({ preventScroll: true });
        },
        onCancel: () => {
          this.setInspectVisual(false);
          this.renderInspectBanner(null);
          callPage("setOverlayKeyboardBlock", { active: true }).catch(() => {});
          if (document.body) document.body.setAttribute("inert", "");
          this.panel.focus({ preventScroll: true });
        },
      });
    }
    callPage("setOverlayKeyboardBlock", { active: false }).catch(() => {});
    callPage("clearHighlights").catch(() => {});
    this.gameInspector.start();
    this.setInspectVisual(true);
  }

  /** Hide the panel (keep a floating HUD pill) while picking an element. */
  setInspectVisual(active) {
    this.backdrop.classList.toggle("inspecting", active);
    if (this.inspectHud) this.inspectHud.hidden = !active;
  }

  stopInspectMode(restoreKeyboardBlock = true) {
    if (this.gameInspector?.isActive()) this.gameInspector.stop();
    this.setInspectVisual(false);
    const banner = this.tabPanels.overview?.querySelector("#ov-inspect-banner");
    if (banner) banner.hidden = true;
    if (restoreKeyboardBlock && this.open) {
      callPage("setOverlayKeyboardBlock", { active: true }).catch(() => {});
      if (document.body) document.body.setAttribute("inert", "");
      this.panel.focus({ preventScroll: true });
    }
  }

  renderInspectBanner(message) {
    const banner = this.tabPanels.overview?.querySelector("#ov-inspect-banner");
    if (!banner) return;
    if (!message) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    banner.textContent = message;
  }

  renderInspectResult(data, { highlight = true } = {}) {
    const box = this.tabPanels.overview?.querySelector("#ov-inspect-result");
    if (!box) return;
    if (!data || data.error) {
      box.hidden = false;
      box.innerHTML = `<p class="status err">${esc(data?.error || "Inspect failed")}</p>`;
      return;
    }

    const varsHtml = (data.variables || [])
      .map(
        (v) =>
          `<tr><td><code>${esc(v.path)}</code></td><td>${esc(formatOverviewValue(v.value, v.unset))}</td><td><button type="button" class="btn btn-xs" data-inspect-var="${escAttr(v.name)}">Find in Variables</button></td></tr>`
      )
      .join("");

    const matchHtml = (data.variableMatches || [])
      .map(
        (m) =>
          `<tr><td><code>${esc(m.pathExpr || m.path.join("."))}</code></td><td>${esc(formatOverviewValue(m.value))}</td><td><button type="button" class="btn btn-xs" data-inspect-var="${escAttr(m.path.join("."))}">Find</button></td></tr>`
      )
      .join("");

    const tagHintsHtml = (data.targetPassage?.tagHints || [])
      .map((h) => `<span class="tag ${h.target ? "warn" : ""}">${esc(h.label || h.tag)}</span>`)
      .join(" ") || "—";

    const dialog = data.dialog;
    const dialogHtml = dialog?.open
      ? `<section class="inspect-dialog-block">
          <h4 class="ov-section-title">Open dialog</h4>
          <p><strong>Title:</strong> ${esc(dialog.title || "—")}
            <span class="tag ok">open</span>
            ${dialog.source ? `<span class="tag">${esc(dialog.source)}</span>` : ""}
          </p>
          ${dialog.textPreview ? `<p class="snippet">${esc(dialog.textPreview)}${dialog.textPreview.length >= 240 ? "…" : ""}</p>` : ""}
          ${renderInspectDialogLinks(dialog.links)}
          ${renderInspectVarTable("Variables referenced in dialog", dialog.variables, "inspect-dialog-var")}
        </section>`
      : "";

    const setterHtml = (data.setterAnalysis || [])
      .map((h) => `<span class="tag warn">${esc(h.label)}</span>`)
      .join(" ");

    const entityHtml = (data.entityHints || [])
      .map(
        (e) =>
          `<tr>
            <td><code>${esc(e.pathExpr || e.path.join("."))}</code> <span class="tag ${e.confidence === "high" ? "ok" : e.confidence === "medium" ? "warn" : ""}">${esc(e.confidence)}</span></td>
            <td>${esc(formatOverviewValue(e.preview))}</td>
            <td class="snippet">${esc((e.reasons || []).join("; "))}</td>
            <td><button type="button" class="btn btn-xs" data-inspect-var="${escAttr(e.path.join("."))}">Find</button></td>
          </tr>`
      )
      .join("");

    const setupHtml = (data.setupHints || [])
      .map(
        (s) =>
          `<tr>
            <td><code>${esc(s.key)}</code></td>
            <td>${esc(s.type || "—")}</td>
            <td>${esc(s.matchReason || "—")}${s.subKeys?.length ? `<br><span class="hint">subkeys: ${s.subKeys.map((k) => esc(k)).join(", ")}</span>` : ""}</td>
          </tr>`
      )
      .join("");

    box.hidden = false;
    box.innerHTML = `
      <div class="inspect-result-card">
        <div class="inspect-result-head">
          <strong>Inspected:</strong> ${esc(data.label || "element")}
          <span class="tag">${esc(data.kind || "element")}</span>
          ${data.clickedInDialog ? '<span class="tag warn">in dialog</span>' : ""}
        </div>
        <p class="hint">${esc(data.tips || "")}</p>
        ${dialogHtml}
        ${setterHtml ? `<p><strong>Setter analysis:</strong> ${setterHtml}</p>` : ""}
        ${data.linkTarget ? `<p><strong>→ Passage:</strong> <button type="button" class="link-btn" data-inspect-goto="${escAttr(data.linkTarget)}">${esc(data.linkTarget)}</button>
          <button type="button" class="btn btn-xs" data-inspect-passage="${escAttr(data.linkTarget)}">Open in Passages</button></p>` : ""}
        ${data.linkSetter ? `<p><strong>In-place action:</strong> <code>${esc(data.linkSetter)}</code> <span class="hint">Runs on click without changing passage — watch Variables / Changes tab.</span></p>` : ""}
        ${data.currentPassage ? `<p><strong>Current passage:</strong> <span class="tag ok">${esc(data.currentPassage)}</span></p>` : ""}
        ${data.targetPassage ? `<p><strong>Target tags:</strong> ${(data.targetPassage.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join(" ") || "—"}
          ${data.targetPassage.isLocationHub ? '<span class="tag warn">location hub</span>' : ""}</p>
          <p><strong>Tag navigation hints:</strong> ${tagHintsHtml}</p>` : ""}
        ${entityHtml ? `<h4 class="ov-section-title">Possible entity / character data</h4><p class="hint">Heuristic match — looks for name + stat-like fields in variable objects, not game-specific rules.</p><table class="data"><tr><th>Path</th><th>Preview</th><th>Why</th><th></th></tr>${entityHtml}</table>` : ""}
        ${setupHtml ? `<h4 class="ov-section-title">Setup registry hints</h4><p class="hint">Static <code>setup.*</code> keys from SugarCube — definitions, not live save state.</p><table class="data"><tr><th>Key</th><th>Type</th><th>Match</th></tr>${setupHtml}</table>` : ""}
        ${varsHtml ? `<h4 class="ov-section-title">Variables in this element</h4><table class="data"><tr><th>Path</th><th>Value</th><th></th></tr>${varsHtml}</table>` : ""}
        ${matchHtml ? `<h4 class="ov-section-title">Variable search matches</h4><table class="data"><tr><th>Path</th><th>Value</th><th></th></tr>${matchHtml}</table>` : ""}
        ${data.chain?.length ? `<details class="ov-details"><summary>DOM chain</summary><pre class="console-out">${esc(JSON.stringify(data.chain || [], null, 2))}</pre></details>` : ""}
        <p><button type="button" class="btn" id="inspect-clear">Clear inspect result</button></p>
      </div>`;

    box.querySelector("#inspect-clear")?.addEventListener("click", () => {
      box.hidden = true;
      this.lastInspectResult = null;
      callPage("clearHighlights").catch(() => {});
    });
    box.querySelectorAll("[data-inspect-goto]").forEach((btn) => {
      btn.addEventListener("click", () => this.gotoPassage(btn.dataset.inspectGoto));
    });
    box.querySelectorAll("[data-inspect-passage]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.selectedPassage = btn.dataset.inspectPassage;
        this.switchTab("passages");
        this.renderPassageList("");
      });
    });
    box.querySelectorAll("[data-inspect-var]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const path = btn.dataset.inspectVar;
        this.switchTab("variables");
        const filter = this.tabPanels.variables.querySelector("#var-filter");
        if (filter) {
          filter.value = path;
          this.filterVariables(path);
        }
      });
    });

    // Only on fresh results — re-renders (e.g. overview auto-refresh) would
    // otherwise re-run highlightElement's scrollIntoView every tick.
    if (highlight && data.selector) {
      callPage("highlightElement", { selector: data.selector }).catch(() => {});
    }
  }

  async renderOverview() {
    const scroll = this.tabPanels.overview.querySelector("#ov-scroll");
    try {
      const [meta, ctx, dialogSnap] = await Promise.all([
        callPage("getMeta"),
        callPage("getCurrentPassageContext"),
        callPage("getDialogSnapshot"),
      ]);
      if (!meta) {
        scroll.innerHTML = `<p class="empty">No Twine story format detected on this page.</p>`;
        return;
      }
      const vars = await callPage("getVariables");
      const varCount = vars && vars.data ? Object.keys(vars.data).length : 0;

      scroll.innerHTML = `
        <div class="stat-grid">
          <div class="stat-card"><div class="label">Engine</div><div class="value" style="font-size:14px">${esc(meta.engine)}</div></div>
          <div class="stat-card"><div class="label">Version</div><div class="value" style="font-size:14px">${esc(meta.version)}</div></div>
          <div class="stat-card"><div class="label">Passages</div><div class="value">${meta.passageCount ?? "—"}</div></div>
          <div class="stat-card"><div class="label">Variables</div><div class="value">${varCount}</div></div>
          <div class="stat-card"><div class="label">Turn</div><div class="value">${meta.turn ?? "—"}</div></div>
          <div class="stat-card"><div class="label">History</div><div class="value">${meta.historyDepth ?? "—"}</div></div>
        </div>
        ${renderDialogOpenBanner(dialogSnap)}
        ${renderCurrentPassageContext(ctx, meta)}
        <h4 class="ov-section-title">Recent history</h4>
        <div id="ov-history"></div>`;

      scroll.querySelectorAll("[data-goto-pass]").forEach((btn) => {
        btn.addEventListener("click", () => this.gotoPassage(btn.dataset.gotoPass));
      });
      scroll.querySelector("#ov-analyze-dialog-inline")?.addEventListener("click", () => this.analyzeOpenDialog());

      const hist = await callPage("getHistory");
      const histEl = scroll.querySelector("#ov-history");
      if (hist && hist.length) {
        const canRestore = this.capabilities && this.capabilities.history;
        histEl.innerHTML = `<table class="data"><tr><th>#</th><th>Passage</th>${canRestore ? "<th></th>" : ""}</tr>${hist
          .slice(-15)
          .reverse()
          .map(
            (h) =>
              `<tr><td>${h.index}</td><td>${esc(h.passage)}</td>${
                canRestore
                  ? `<td><button type="button" class="btn btn-xs" data-restore-hist="${h.index}">Restore</button></td>`
                  : ""
              }</tr>`
          )
          .join("")}</table>`;
        histEl.querySelectorAll("[data-restore-hist]").forEach((btn) => {
          btn.addEventListener("click", async () => {
            if (!confirm(`Restore history moment #${btn.dataset.restoreHist}?`)) return;
            try {
              await callPage("restoreHistory", { index: Number(btn.dataset.restoreHist) });
              await this.renderOverview();
            } catch (err) {
              alert(err.message || String(err));
            }
          });
        });
      } else {
        histEl.innerHTML = `<p class="empty">No history.</p>`;
      }

      if (this.tabPanels.overview.querySelector("#ov-auto")?.checked && !this.overviewRefreshTimer) {
        this.startOverviewRefresh();
      }
      if (this.lastInspectResult && !this.lastInspectResult.error) {
        this.renderInspectResult(this.lastInspectResult, { highlight: false });
      }
    } catch (e) {
      scroll.innerHTML = `<p class="status err">${esc(e.message)}</p>`;
    }
  }

  startOverviewRefresh() {
    this.stopOverviewRefresh();
    if (this.activeTab !== "overview") return;
    this.overviewRefreshTimer = setInterval(() => {
      if (this.activeTab === "overview" && this.open) this.renderOverview();
    }, 2000);
  }

  stopOverviewRefresh() {
    if (this.overviewRefreshTimer) clearInterval(this.overviewRefreshTimer);
    this.overviewRefreshTimer = null;
  }

  lastVarData = null;
  varSearchMode = false;

  async renderVariables() {
    const scroll = this.tabPanels.variables.querySelector("#var-scroll");
    try {
      const storedLocks = await loadLockedPaths();
      this.lockedPaths = new Set(storedLocks);
      let v;
      if (this.showTempVars) {
        v = await callPage("getTempVariables");
        if (!v || !v.supported) {
          scroll.innerHTML = `<p class="empty">Temporary variables require SugarCube 2.</p>`;
          return;
        }
      } else {
        v = await callPage("getVariables");
      }
      if (!v || !v.data) {
        const cap = this.capabilities || {};
        scroll.innerHTML = `<p class="empty">${cap.variables === "read" ? "Variables are read-only for this format (Harlowe)." : "No variables found."} Use Passages, Search, Analysis, Map, and DOM tabs.</p>`;
        return;
      }
      this.lastVarData = v.data;
      const filterVal = this.tabPanels.variables.querySelector("#var-filter")?.value.trim() || "";
      if (filterVal) {
        this.renderVarSearch(filterVal);
      } else {
        this.varSearchMode = false;
        scroll.innerHTML = "";
        scroll.appendChild(this.buildVarNode(v.data, []));
      }
      if (this.tabPanels.variables.querySelector("#var-auto").checked) {
        this.startVarRefresh();
      }
    } catch (e) {
      scroll.innerHTML = `<p class="status err">${esc(e.message)}</p>`;
    }
  }

  /** Flat, data-backed search over the whole state — finds values the lazy
   *  tree has not rendered yet, and stays fast on huge saves. */
  renderVarSearch(query) {
    const scroll = this.tabPanels.variables.querySelector("#var-scroll");
    if (!this.lastVarData) return;
    this.varSearchMode = true;
    const lq = query.trim().toLowerCase();
    const matches = [];
    collectVarMatches(this.lastVarData, [], lq, matches, 400);

    scroll.innerHTML = "";
    const info = document.createElement("p");
    info.className = "hint";
    info.textContent = matches.length
      ? `${matches.length}${matches.length >= 400 ? "+" : ""} matching value${matches.length === 1 ? "" : "s"} — clear the filter to return to the tree.`
      : "No matches in variable paths or values.";
    scroll.appendChild(info);

    for (const m of matches) {
      const wrap = document.createElement("div");
      wrap.className = "var-search-row";
      const pathLabel = document.createElement("code");
      pathLabel.className = "var-search-path";
      pathLabel.textContent = m.path.slice(0, -1).join(".");
      if (pathLabel.textContent) wrap.appendChild(pathLabel);
      wrap.appendChild(this.buildPrimitiveVarRow(m.value, m.path, m.type));
      scroll.appendChild(wrap);
    }
  }

  buildVarNode(obj, path) {
    try {
      const type = panelValueType(obj);

      if (type === "map") {
        return this.buildContainerNode(obj, path, "map", mapEntries(obj));
      }
      if (type === "set") {
        const det = document.createElement("details");
        det.open = path.length < 2;
        const sum = document.createElement("summary");
        sum.textContent = `${path.length ? path[path.length - 1] : "root"} Set(${setValues(obj).length})`;
        det.appendChild(sum);
        setValues(obj).forEach((val, i) => {
          const child = document.createElement("div");
          child.style.marginLeft = "12px";
          child.dataset.varPath = [...path, String(i)].join(".");
          child.appendChild(this.buildVarNode(val, [...path, String(i)]));
          det.appendChild(child);
        });
        return det;
      }

      if (type === "array") {
        const arr = Array.isArray(obj) ? obj : [];
        const entries = arr.map((v, i) => [String(i), v]);
        return this.buildContainerNode(obj, path, "array", entries);
      }

      if (type === "object") {
        const keys = obj && typeof obj === "object" ? Object.keys(obj) : [];
        const entries = keys.sort(sortKeys).map((k) => [k, obj[k]]);
        return this.buildContainerNode(obj, path, "object", entries);
      }

      return this.buildPrimitiveVarRow(obj, path, type);
    } catch (err) {
      const row = document.createElement("div");
      row.className = "var-row";
      row.dataset.varPath = path.join(".");
      const name = document.createElement("span");
      name.className = "var-name";
      name.textContent = path[path.length - 1] || "?";
      const errSpan = document.createElement("span");
      errSpan.className = "status err";
      errSpan.textContent = ` (render error: ${err.message})`;
      row.append(name, errSpan);
      return row;
    }
  }

  buildContainerNode(_obj, path, type, entries) {
    const readOnly = this.capabilities && this.capabilities.variables !== "full";
    const det = document.createElement("details");
    det.open = path.length < 2;
    const label = path.length ? path[path.length - 1] : "root";
    const sum = document.createElement("summary");
    const sumWrap = document.createElement("span");
    sumWrap.className = "container-summary";
    sumWrap.textContent =
      type === "array"
        ? `${label} [${entries.length}]`
        : type === "map"
          ? `${label} Map(${entries.length})`
          : `${label} {${entries.length}}`;
    sum.appendChild(sumWrap);

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "btn btn-xs var-add-btn";
    addBtn.textContent = "+";
    addBtn.title = "Add property";
    if (!readOnly) {
      addBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.promptAddProperty(path);
      });
    } else {
      addBtn.disabled = true;
    }
    sum.appendChild(addBtn);
    det.appendChild(sum);

    const safeEntries = Array.isArray(entries) ? entries : [];
    // Render children lazily on expand — building the full DOM tree up front
    // froze the panel on games with tens of thousands of state values.
    let childrenRendered = false;
    const renderChildren = () => {
      if (childrenRendered) return;
      childrenRendered = true;
      for (const [k, val] of safeEntries) {
        const childWrap = document.createElement("div");
        childWrap.className = "var-child";
        childWrap.style.marginLeft = "12px";
        childWrap.dataset.varPath = [...path, k].join(".");

        const head = document.createElement("div");
        head.className = "var-child-head";
        if (type !== "array") {
          const keyLabel = document.createElement("span");
          keyLabel.className = "var-key-label";
          keyLabel.textContent = k;
          head.appendChild(keyLabel);
        }

        const dupBtn = document.createElement("button");
        dupBtn.type = "button";
        dupBtn.className = "btn btn-xs";
        dupBtn.textContent = "⧉";
        dupBtn.title = "Duplicate";
        if (!readOnly) dupBtn.addEventListener("click", () => this.duplicateVar(path, k));
        else dupBtn.disabled = true;
        head.appendChild(dupBtn);

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "btn btn-xs danger";
        delBtn.textContent = "×";
        delBtn.title = "Delete";
        if (!readOnly) delBtn.addEventListener("click", () => this.deleteVar([...path, k]));
        else delBtn.disabled = true;
        head.appendChild(delBtn);

        childWrap.appendChild(head);
        childWrap.appendChild(this.buildVarNode(val, [...path, k]));
        det.appendChild(childWrap);
      }
    };
    if (det.open) renderChildren();
    else det.addEventListener("toggle", () => {
      if (det.open) renderChildren();
    });
    return det;
  }

  buildPrimitiveVarRow(obj, path, type) {
    const row = document.createElement("div");
    row.className = "var-row";
    row.dataset.varPath = path.join(".");
    const name = document.createElement("span");
    name.className = "var-name";
    name.textContent = path[path.length - 1] || "?";

    const pathKey = path.join(".");
    const readOnly = this.capabilities && this.capabilities.variables !== "full";

    const lock = document.createElement("input");
    lock.type = "checkbox";
    lock.className = "lock-toggle";
    lock.title = "Lock value (keep when game updates)";
    lock.checked = this.lockedPaths.has(pathKey);
    lock.disabled = readOnly || (this.capabilities && this.engine && this.engine.profile.family === "chapbook");
    lock.addEventListener("change", () => this.toggleLock(path, lock.checked));

    if (type === "boolean") {
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!obj;
      cb.disabled = readOnly;
      if (!readOnly) cb.addEventListener("change", () => this.setVar(path, cb.checked, "boolean"));
      row.append(name, cb, lock);
    } else if (type === "null" || type === "undefined") {
      row.append(name, document.createTextNode(` ${type}`), lock);
    } else if (type === "function") {
      const preview = document.createElement("code");
      preview.className = "snippet";
      preview.textContent =
        obj && obj.source ? String(obj.source).slice(0, 160) : obj && obj.name ? String(obj.name) : "[Function]";
      row.append(name, preview, lock);
    } else if (type === "bigint" || type === "date" || type === "regexp" || type === "symbol" || type === "circular") {
      const preview = document.createElement("span");
      preview.className = "hint";
      preview.textContent = formatSerializedPreview(obj, type);
      row.append(name, preview, lock);
    } else {
      const inp = document.createElement("input");
      inp.type = type === "number" ? "number" : "text";
      inp.value = String(obj);
      inp.className = "value-input";
      inp.readOnly = readOnly;
      if (!readOnly) {
        const commit = () => this.setVar(path, inp.value, type);
        inp.addEventListener("change", commit);
        inp.addEventListener("blur", commit);
      }
      row.append(name, inp, lock);
    }
    return row;
  }

  async toggleLock(path, locked) {
    const pathKey = path.join(".");
    try {
      await callPage("setPathLock", { path, locked });
      await setPathLocked(pathKey, locked);
      if (locked) this.lockedPaths.add(pathKey);
      else this.lockedPaths.delete(pathKey);
    } catch (e) {
      alert(e.message || String(e));
    }
  }

  async promptAddProperty(parentPath) {
    const key = prompt(parentPath.length ? "Property name:" : "Variable name:");
    if (!key || !key.trim()) return;
    const value = prompt("Initial value:", "0");
    if (value === null) return;
    const type = /^-?\d+(\.\d+)?$/.test(value.trim()) ? "number" : "string";
    try {
      await callPage("addStateProperty", {
        parentPath,
        key: key.trim(),
        value: value.trim(),
        type,
      });
      await this.renderVariables();
    } catch (e) {
      alert(e.message || String(e));
    }
  }

  async deleteVar(path) {
    const pathKey = path.join(".");
    if (!confirm(`Delete ${pathKey}?`)) return;
    try {
      await callPage("deleteStateProperty", { path });
      await this.renderVariables();
    } catch (e) {
      alert(e.message || String(e));
    }
  }

  async duplicateVar(parentPath, sourceKey) {
    const targetKey = prompt("Duplicate as key name:", `${sourceKey}_copy`);
    if (!targetKey) return;
    try {
      await callPage("duplicateStateProperty", { parentPath, sourceKey, targetKey: targetKey.trim() });
      await this.renderVariables();
    } catch (e) {
      alert(e.message || String(e));
    }
  }

  async setVar(path, value, type) {
    const pathKey = path.join(".");
    this.pendingVarPaths.add(pathKey);
    try {
      const result = await callPage("setVariable", {
        path,
        value,
        type,
        isTemp: this.showTempVars,
      });
      const row = this.tabPanels.variables.querySelector(
        `.var-row[data-var-path="${cssPathAttr(pathKey)}"]`
      );
      const inp = row && row.querySelector("input");
      if (inp) {
        inp.classList.add("var-saved");
        setTimeout(() => inp.classList.remove("var-saved"), 1200);
      }
      if (!result || !result.ok) {
        throw new Error("Variable write was rejected by the game");
      }
    } catch (e) {
      alert(`Failed to set ${pathKey}: ${e.message || e}`);
    } finally {
      setTimeout(() => this.pendingVarPaths.delete(pathKey), 2500);
    }
  }

  filterVariables(q) {
    const lq = q.trim().toLowerCase();
    if (!lq) {
      if (this.varSearchMode) {
        this.varSearchMode = false;
        this.renderVariables();
      }
      return;
    }
    this.renderVarSearch(lq);
  }

  varRefreshInFlight = false;

  startVarRefresh() {
    this.stopVarRefresh();
    this.refreshTimer = setInterval(async () => {
      if (!this.open || this.activeTab !== "variables" || this.varRefreshInFlight) return;
      this.varRefreshInFlight = true;
      try {
        let v;
        if (this.showTempVars) {
          v = await callPage("getTempVariables");
        } else {
          v = await callPage("getVariables");
        }
        if (!v || !v.data) return;
        this.lastVarData = v.data;
        this.syncVarInputs(v.data, []);
      } catch { /* ignore */ } finally {
        this.varRefreshInFlight = false;
      }
    }, 800);
  }

  stopVarRefresh() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }

  syncVarInputs(obj, path) {
    const type = panelValueType(obj);
    if (type === "map") {
      for (const entry of mapEntries(obj)) {
        this.syncVarInputs(entry[1], [...path, entry[0]]);
      }
      return;
    }
    if (type === "set") {
      setValues(obj).forEach((val, i) => this.syncVarInputs(val, [...path, String(i)]));
      return;
    }
    if (type === "array") {
      const arr = Array.isArray(obj) ? obj : [];
      arr.forEach((val, i) => this.syncVarInputs(val, [...path, String(i)]));
      return;
    }
    if (type === "object") {
      const keys = obj && typeof obj === "object" ? Object.keys(obj) : [];
      for (const k of keys) {
        this.syncVarInputs(obj[k], [...path, k]);
      }
      return;
    }
    const pathKey = path.join(".");
    if (this.pendingVarPaths.has(pathKey)) return;

    const row = this.tabPanels.variables.querySelector(
      `.var-row[data-var-path="${cssPathAttr(pathKey)}"]`
    );
    if (!row) return;
    const inp = row.querySelector("input");
    if (!inp || document.activeElement === inp) return;
    if (type === "boolean") inp.checked = !!obj;
    else if (type !== "null") inp.value = String(obj);
  }

  allPassages = [];
  selectedPassage = null;
  passListFetchedAt = 0;
  passSelectSignature = "";

  async fetchPassageList(force = false) {
    const now = Date.now();
    if (!force && this.allPassages.length && now - this.passListFetchedAt < 5000) {
      return this.allPassages;
    }
    this.allPassages = (await callPage("getPassageList")) || [];
    this.passListFetchedAt = now;
    // Rebuilding a 5000-option <select> on every keystroke froze big games —
    // only rebuild when the passage list actually changed.
    const sig = `${this.allPassages.length}|${this.allPassages[0]?.name || ""}|${this.allPassages[this.allPassages.length - 1]?.name || ""}`;
    if (sig !== this.passSelectSignature) {
      this.passSelectSignature = sig;
      const select = this.tabPanels.graph.querySelector("#graph-from");
      select.innerHTML = `<option value="">— current —</option>${this.allPassages.map((p) => `<option value="${escAttr(p.name)}">${esc(p.name)}</option>`).join("")}`;
    }
    return this.allPassages;
  }

  async renderPassageList(filter = "") {
    const scroll = this.tabPanels.passages.querySelector("#pass-scroll");
    try {
      await this.fetchPassageList();

      const lq = filter.trim().toLowerCase();
      const catFilter = this.tabPanels.passages.querySelector("#pass-category")?.value || "";
      const filtered = this.allPassages.filter((p) => {
        if (lq && !p.name.toLowerCase().includes(lq)) return false;
        if (catFilter && !(p.tagCategories || []).includes(catFilter)) return false;
        return true;
      });
      const list = filtered.slice(0, 300);

      if (!list.length) {
        scroll.innerHTML = `<p class="empty">No passages found.</p>`;
        return;
      }

      scroll.innerHTML = `<div class="table-scroll"><table class="data pass-table"><tr><th>Passage</th><th>Category</th><th>Tags</th><th>Static</th><th>Tag hints</th><th>Sets</th><th>Media</th></tr>
        ${list.map((p) => {
          const locBadge = p.isLocationHub ? ' <span class="tag warn" title="Location hub">loc</span>' : "";
          const catBadge =
            p.primaryCategory && p.primaryCategory !== "other"
              ? `<span class="tag tag-cat-${escAttr(p.primaryCategory)}">${esc(p.primaryCategory)}</span>`
              : "—";
          const tagHintCell =
            p.tagLinkCount > 0
              ? `<span class="tag warn">${p.tagLinkCount}</span>`
              : p.isLocationHub
                ? `<span class="hint" title="Uses setup/widgets for navigation">runtime</span>`
                : "0";
          return `<tr class="pass-row" data-pass-row="${escAttr(p.name)}"><td><button type="button" class="link-btn" data-pass="${escAttr(p.name)}">${esc(p.name)}</button>${locBadge}</td>
        <td>${catBadge}</td>
        <td>${(p.tags || []).slice(0, 6).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}${(p.tags || []).length > 6 ? `<span class="hint"> +${p.tags.length - 6}</span>` : ""}</td>
        <td>${p.linkCount}</td><td>${tagHintCell}</td><td>${p.setCount}</td><td>${p.mediaCount}</td></tr>`;
        }).join("")}
        </table></div>
        <p class="hint"><strong>Category</strong> = inferred tag role (navigation, event, widget, time, etc.). <strong>Static</strong> = links in source. <strong>Tag hints</strong> = from tags like <code>closedgoto…</code>, <code>openhour8</code>.</p>
        ${filtered.length > 300 ? `<p class="hint">Showing 300 of ${filtered.length} matches. Use filter to narrow.</p>` : ""}`;

      scroll.querySelectorAll("[data-pass]").forEach((btn) => {
        btn.addEventListener("click", () => this.showPassageDetail(btn.dataset.pass));
      });

      if (this.selectedPassage && list.some((p) => p.name === this.selectedPassage)) {
        await this.showPassageDetail(this.selectedPassage, true);
      }
    } catch (e) {
      scroll.innerHTML = `<p class="status err">${esc(e.message)}</p>`;
    }
  }

  async showPassageDetail(name, skipToggle = false) {
    const scroll = this.tabPanels.passages.querySelector("#pass-scroll");
    const existingRow = findPassageRow(scroll, name);

    if (!skipToggle && this.selectedPassage === name && scroll.querySelector(".pass-detail-row")) {
      this.selectedPassage = null;
      scroll.querySelectorAll(".pass-detail-row").forEach((r) => r.remove());
      scroll.querySelectorAll(".pass-row.pass-selected").forEach((r) => r.classList.remove("pass-selected"));
      return;
    }

    this.selectedPassage = name;
    scroll.querySelectorAll(".pass-detail-row").forEach((r) => r.remove());
    scroll.querySelectorAll(".pass-row.pass-selected").forEach((r) => r.classList.remove("pass-selected"));

    if (!existingRow) return;
    existingRow.classList.add("pass-selected");

    const detailRow = document.createElement("tr");
    detailRow.className = "pass-detail-row";
    detailRow.innerHTML = `<td colspan="7"><div class="pass-detail-inner"><p class="hint">Loading…</p></div></td>`;
    existingRow.after(detailRow);
    detailRow.scrollIntoView({ block: "nearest", behavior: "smooth" });

    const detailEl = detailRow.querySelector(".pass-detail-inner");
    try {
      const d = await callPage("getPassageDetail", { name });
      if (!d) {
        detailEl.innerHTML = `<p class="empty">Passage not found.</p>`;
        return;
      }
      detailEl.innerHTML = `
        <h4>${esc(d.name)}</h4>
        <p>${(d.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join(" ")}${d.primaryCategory && d.primaryCategory !== "other" ? ` <span class="tag tag-cat-${escAttr(d.primaryCategory)}">${esc(d.primaryCategory)}</span>` : ""}</p>
        <p>
          <button type="button" class="btn primary" id="pd-goto">Go to passage</button>
        </p>
        <p><strong>Static links:</strong> ${d.links.map((l) => `<span class="tag">${esc(l.label)} → ${esc(l.target)}</span>`).join(" ") || "none in source"}</p>
        <p><strong>Tag navigation hints:</strong> ${(d.tagHints || []).map((h) => `<span class="tag ${h.target ? "warn" : ""}">${esc(h.label || h.tag)}</span>`).join(" ") || "none"}${d.isLocationHub ? ' <span class="tag warn">location hub</span>' : ""}</p>
        <p class="hint">${d.isLocationHub || d.staticLinkCount === 0 ? "This passage may build choices at runtime — open Links tab while on this passage to see live choices." : ""}</p>
        <p><strong>&lt;&lt;set&gt;&gt;:</strong> ${d.setMacros.map((s) => `<code>${esc(s)}</code>`).join(", ") || "none"}</p>
        <p><strong>&lt;&lt;if&gt;&gt; conditions:</strong> ${d.ifMacros.map((s) => `<code>${esc(s)}</code>`).join(", ") || "none"}</p>
        ${d.chatHints && d.chatHints.macros && d.chatHints.macros.length ? `<p><strong>CHATSYSTEM:</strong> ${d.chatHints.macros.map((m) => `<span class="tag">${esc(m)}</span>`).join(" ")}${d.chatHints.conversations.length ? ` — ${d.chatHints.conversations.map((c) => `<code>${esc(c.id || "?")}</code>`).join(", ")}` : ""}</p>` : ""}
        <p><strong>Variable refs:</strong> ${d.varRefs.map((v) => `<span class="tag">$${esc(v)}</span>`).join(" ") || "none"}</p>
        <label class="pass-edit-label"><strong>Passage source</strong> (SugarCube — edits apply in-memory)</label>
        <textarea class="passage-editor" id="pd-source" spellcheck="false">${esc(d.text)}</textarea>
        <p><button type="button" class="btn primary" id="pd-save">Save passage</button></p>`;
      detailEl.querySelector("#pd-goto").addEventListener("click", () => this.gotoPassage(name));
      detailEl.querySelector("#pd-save").addEventListener("click", async () => {
        const source = detailEl.querySelector("#pd-source").value;
        try {
          await callPage("setPassageSource", { name, source });
          alert("Passage updated in memory.");
        } catch (err) {
          alert(err.message || String(err));
        }
      });
    } catch (e) {
      detailEl.innerHTML = `<p class="status err">${esc(e.message)}</p>`;
    }
  }

  async gotoPassage(name) {
    if (!name) return;
    try {
      await callPage("goToPassage", { name });
      setTimeout(() => this.refreshActiveTab(), 400);
    } catch (e) {
      alert(e.message);
    }
  }

  async renderLinks() {
    const scroll = this.tabPanels.links.querySelector("#links-scroll");
    try {
      const data = await callPage("getLinkAnalysis");
      if (!data) {
        scroll.innerHTML = `<p class="empty">No link data.</p>`;
        return;
      }
      scroll.innerHTML = `
        <p><strong>Passage:</strong> <span class="tag ok">${esc(data.passage)}</span></p>
        <p><strong>Passage-level &lt;&lt;if&gt;&gt;:</strong> ${data.conditions.map((c) => `<code>${esc(c)}</code>`).join(", ") || "none"}</p>
        <p class="hint">Links from passage source + live DOM (menu links, inline/profile text, in-place actions). <strong>dom-only</strong> / <strong>inline-link</strong> = built at runtime.</p>
        <table class="data"><tr><th>Label</th><th>Target</th><th>Source</th><th>Target exists</th><th>In DOM</th><th>Visible</th><th>Setter / action</th><th>Target &lt;&lt;set&gt;&gt;</th><th>Target conditions</th></tr>
        ${data.links.map((l) => `<tr class="${l.domHidden ? "hidden-row" : ""}">
          <td>${esc(l.label)}</td>
          <td>${l.target && l.target !== "(same passage)" ? `<button type="button" class="link-btn" data-goto="${escAttr(l.target)}">${esc(l.target)}</button>` : `<span class="hint">${esc(l.target || "—")}</span>`}</td>
          <td>${esc(l.type)}</td>
          <td>${l.target && l.target !== "(same passage)" ? (l.targetExists ? '<span class="tag ok">yes</span>' : '<span class="tag bad">missing</span>') : "—"}</td>
          <td>${l.inDom ? "yes" : "no"}</td>
          <td>${l.inDom ? (l.domHidden ? '<span class="tag warn">hidden</span>' : '<span class="tag ok">visible</span>') : "—"}</td>
          <td>${l.setter ? `<code>${esc(l.setter)}</code>` : l.inPlace ? '<span class="tag ok">in-place</span>' : "—"}</td>
          <td>${(l.targetSets || []).map((s) => `<code>${esc(s)}</code>`).join("<br>") || "—"}</td>
          <td>${(l.targetIfs || []).map((s) => `<code>${esc(s)}</code>`).join("<br>") || "—"}</td>
        </tr>`).join("")}
        </table>`;
      scroll.querySelectorAll("[data-goto]").forEach((btn) => {
        btn.addEventListener("click", () => this.gotoPassage(btn.dataset.goto));
      });
    } catch (e) {
      scroll.innerHTML = `<p class="status err">${esc(e.message)}</p>`;
    }
  }

  async renderGraph(fullStory) {
    const scroll = this.tabPanels.graph.querySelector("#graph-scroll");
    try {
      const from = this.tabPanels.graph.querySelector("#graph-from").value;
      const meta = await callPage("getMeta");
      const start = from || (meta && meta.passage) || "";

      if (fullStory) {
        const graph = await callPage("getStoryGraph", { limit: 0 });
        scroll.innerHTML = `
          <p><strong>${graph.nodes.length}</strong> passages, <strong>${graph.edges.length}</strong> links</p>
          <div class="graph-list">${graph.edges.slice(0, 500).map((e) => `<div class="graph-edge"><span class="tag">${esc(e.from)}</span> → <span class="tag ok">${esc(e.to)}</span> <span class="hint">(${esc(e.label)})</span></div>`).join("")}</div>
          ${graph.edges.length > 500 ? `<p class="hint">Showing first 500 edges.</p>` : ""}`;
        return;
      }

      if (!start) {
        scroll.innerHTML = `<p class="empty">No current passage.</p>`;
        return;
      }

      const detail = await callPage("getPassageDetail", { name: start });
      if (!detail) {
        scroll.innerHTML = `<p class="empty">Passage not found.</p>`;
        return;
      }

      const rows = [];
      for (const link of detail.links) {
        const target = await callPage("getPassageDetail", { name: link.target });
        rows.push({ link, target, source: "static" });
      }
      for (const hint of detail.tagHints || []) {
        if (!hint.target) continue;
        const target = await callPage("getPassageDetail", { name: hint.target });
        rows.push({
          link: { label: hint.label || hint.tag, target: hint.target, type: hint.type },
          target,
          source: "tag",
        });
      }

      scroll.innerHTML = `
        <p><strong>From:</strong> ${esc(start)} — ${rows.length} outgoing links (static + tag hints)</p>
        <table class="data"><tr><th>Choice</th><th>Source</th><th>→ Passage</th><th>Exists</th><th>Variables set on arrival</th><th>Conditions on target</th></tr>
        ${rows.map(({ link, target, source }) => `<tr>
          <td>${esc(link.label)}</td>
          <td><span class="tag ${source === "tag" ? "warn" : ""}">${source === "tag" ? "tag hint" : esc(link.type || "static")}</span></td>
          <td><button type="button" class="link-btn" data-goto="${escAttr(link.target)}">${esc(link.target)}</button></td>
          <td>${target ? '<span class="tag ok">yes</span>' : '<span class="tag bad">missing</span>'}</td>
          <td>${target ? target.setMacros.map((s) => `<code>${esc(s)}</code>`).join("<br>") : "—"}</td>
          <td>${target ? target.ifMacros.map((s) => `<code>${esc(s)}</code>`).join("<br>") : "—"}</td>
        </tr>`).join("")}
        </table>
        <p class="hint">Static + tag-hint links from passage metadata. For live DOM choices, use Links tab or Visual map with Live DOM links.</p>`;
      scroll.querySelectorAll("[data-goto]").forEach((btn) => {
        btn.addEventListener("click", () => this.gotoPassage(btn.dataset.goto));
      });
    } catch (e) {
      scroll.innerHTML = `<p class="status err">${esc(e.message)}</p>`;
    }
  }

  mediaCache = [];

  async renderMedia(checkAll) {
    const scroll = this.tabPanels.media.querySelector("#media-scroll");
    const status = this.tabPanels.media.querySelector("#media-status");
    status.textContent = "Scanning…";
    try {
      this.mediaCache = (await callPage("getMediaInventory")) || [];
      if (!this.mediaCache.length) {
        scroll.innerHTML = `<p class="empty">No media references found in passage text.</p>`;
        status.textContent = "";
        return;
      }

      let checks = {};
      if (checkAll) {
        status.textContent = "Checking URLs…";
        const batch = this.mediaCache.slice(0, 40).map((m) => m.url);
        const results = await callPage("checkMediaBatch", { urls: batch });
        results.forEach((r) => { checks[r.url] = r; });
      }

      scroll.innerHTML = `<table class="data"><tr><th>Preview</th><th>URL</th><th>Type</th><th>Used in</th><th>Status</th></tr>
        ${this.mediaCache.slice(0, 200).map((m) => {
          const c = checks[m.url];
          const st = c ? (c.ok ? `<span class="tag ok">${esc(c.status)}</span>` : `<span class="tag bad">${esc(c.status)}</span>`) : "—";
          return `<tr>
            <td>${m.type.includes("img") ? `<img class="media-thumb" src="${escAttr(m.url)}" onerror="this.style.display='none'"/>` : "—"}</td>
            <td style="word-break:break-all;max-width:240px"><a href="${escAttr(m.url)}" target="_blank" rel="noopener" style="color:#3794ff">${esc(m.original || m.url)}</a></td>
            <td>${esc(m.type)}</td>
            <td>${m.passages.slice(0, 5).map((p) => esc(p)).join(", ")}${m.passages.length > 5 ? "…" : ""}</td>
            <td>${st}</td>
          </tr>`;
        }).join("")}</table>
        ${this.mediaCache.length > 200 ? `<p class="hint">${this.mediaCache.length} total assets, showing 200.</p>` : ""}`;
      status.textContent = `${this.mediaCache.length} assets`;
    } catch (e) {
      scroll.innerHTML = `<p class="status err">${esc(e.message)}</p>`;
      status.textContent = "";
    }
  }

  setupCache = null;

  async renderSetup(filter = "") {
    const scroll = this.tabPanels.setup.querySelector("#setup-scroll");
    try {
      this.setupCache = await callPage("getSetup");
      if (!this.setupCache) {
        scroll.innerHTML = `<p class="empty">SugarCube.setup not available.</p>`;
        return;
      }
      const lq = (filter || this.tabPanels.setup.querySelector("#setup-filter").value || "").trim().toLowerCase();
      const keys = Object.keys(this.setupCache).filter((k) => !lq || k.toLowerCase().includes(lq));
      const groups = {};
      keys.forEach((k) => {
        const cat = categorizeSetupKey(k);
        if (!groups[cat]) groups[cat] = [];
        groups[cat].push(k);
      });
      const groupOrder = ["characters", "world", "stats", "appearance", "communication", "economy", "activities", "other"];
      scroll.innerHTML =
        `<p class="hint">Grouped by generic key patterns (people, maps, events, etc.) — not game-specific.</p>` +
        groupOrder
          .filter((cat) => groups[cat]?.length)
          .map((cat) => {
            const items = groups[cat]
              .map((k) => {
                const v = this.setupCache[k];
                const body =
                  typeof v === "object"
                    ? `<pre class="passage-text">${esc(JSON.stringify(v, null, 2))}</pre>`
                    : `<code>${esc(String(v))}</code>`;
                return `<details class="setup-item"><summary>${esc(k)}</summary>${body}</details>`;
              })
              .join("");
            return `<section class="setup-group"><h4 class="ov-section-title">${esc(cat)} (${groups[cat].length})</h4>${items}</section>`;
          })
          .join("") || `<p class="empty">No matching keys.</p>`;
    } catch (e) {
      scroll.innerHTML = `<p class="status err">${esc(e.message)}</p>`;
    }
  }

  async exportJson() {
    try {
      const json = await callPage("exportVariablesJson");
      this.tabPanels.json.querySelector("#json-editor").value = json;
    } catch (e) {
      alert(e.message);
    }
  }

  async copyJson() {
    const ta = this.tabPanels.json.querySelector("#json-editor");
    try {
      await navigator.clipboard.writeText(ta.value);
    } catch {
      ta.select();
      document.execCommand("copy");
    }
  }

  async mergeJson() {
    const json = this.tabPanels.json.querySelector("#json-editor").value;
    if (!confirm("Merge this JSON into live variables? Use a test save first.")) return;
    try {
      JSON.parse(json);
      await callPage("mergeVariables", { json });
      alert("Merged successfully.");
    } catch (e) {
      alert(e.message);
    }
  }

  async runConsole(codeOverride) {
    const input = this.tabPanels.console.querySelector("#con-in");
    const code = (codeOverride ?? input.value).trim();
    const out = this.tabPanels.console.querySelector("#con-out");
    if (!code) return;
    try {
      const result = await callPage("eval", { code });
      if (result === undefined) {
        out.textContent = "(done — no return value)";
      } else if (typeof result === "object") {
        out.textContent = JSON.stringify(result, null, 2);
      } else {
        out.textContent = String(result);
      }
    } catch (e) {
      out.textContent = `Error: ${e.message}`;
    }
  }

  async addWatchVar() {
    const input = this.tabPanels.watch.querySelector("#watch-add");
    const path = input.value.trim();
    if (!path) return;
    await addWatch(path);
    input.value = "";
    await this.renderWatch();
  }

  async renderWatch() {
    const scroll = this.tabPanels.watch.querySelector("#watch-scroll");
    const paths = await loadWatchList();
    if (!paths.length) {
      scroll.innerHTML = `<p class="empty">No pinned variables. Type a path above (e.g. <code>health</code> or <code>player.gold</code>).</p>`;
      return;
    }
    try {
      const snapshot = await callPage("getWatchSnapshot", { paths });
      scroll.innerHTML = `<table class="data"><tr><th>Path</th><th>Value</th><th></th></tr>
        ${snapshot.map((row) => {
          const valStr = typeof row.value === "object" ? JSON.stringify(row.value) : String(row.value);
          const prev = this.watchPrev[row.path];
          const changed = prev !== undefined && prev !== valStr;
          this.watchPrev[row.path] = valStr;
          return `<tr class="${changed ? "watch-changed" : ""}"><td><code>$${esc(row.path)}</code></td><td>${esc(valStr)}</td>
            <td><button type="button" class="btn" data-unwatch="${escAttr(row.path)}">×</button></td></tr>`;
        }).join("")}</table>`;
      scroll.querySelectorAll("[data-unwatch]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          await removeWatch(btn.dataset.unwatch);
          delete this.watchPrev[btn.dataset.unwatch];
          await this.renderWatch();
        });
      });
      if (this.activeTab === "watch") this.startWatchRefresh();
    } catch (e) {
      scroll.innerHTML = `<p class="status err">${esc(e.message)}</p>`;
    }
  }

  startWatchRefresh() {
    this.stopWatchRefresh();
    this.watchTimer = setInterval(() => {
      if (this.open && this.activeTab === "watch") this.renderWatch();
    }, 1000);
  }

  stopWatchRefresh() {
    if (this.watchTimer) clearInterval(this.watchTimer);
    this.watchTimer = null;
  }

  domCache = [];

  async renderDom() {
    const scroll = this.tabPanels.dom.querySelector("#dom-scroll");
    const filter = this.tabPanels.dom.querySelector("#dom-filter").value;
    try {
      this.domCache = (await callPage("getDomInspection")) || [];
      const list = filter ? this.domCache.filter((i) => i.type === filter) : this.domCache;
      if (!list.length) {
        scroll.innerHTML = `<p class="empty">No DOM elements matched.</p>`;
        return;
      }
      scroll.innerHTML = `<table class="data"><tr><th>Type</th><th>Label</th><th>Hidden</th><th>Passage</th><th>Action</th><th></th></tr>
        ${list.map((item, idx) => `<tr class="${item.hidden ? "hidden-row" : ""}">
          <td><span class="tag ${item.type === "inline-link" ? "warn" : item.type === "action-link" ? "ok" : ""}">${esc(item.type)}</span></td>
          <td>${esc(item.label)}</td>
          <td>${item.hidden ? '<span class="tag warn">yes</span>' : "no"}</td>
          <td>${item.passage ? esc(item.passage) : item.inPlace ? '<span class="hint">(same passage)</span>' : "—"}</td>
          <td>${item.setter ? `<code class="snippet">${esc(String(item.setter).slice(0, 60))}${String(item.setter).length > 60 ? "…" : ""}</code>` : "—"}</td>
          <td><button type="button" class="btn" data-hl="${idx}">Highlight</button></td>
        </tr>`).join("")}</table>`;
      scroll.querySelectorAll("[data-hl]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const item = list[Number(btn.dataset.hl)];
          const res = await callPage("highlightElement", { selector: item.selector });
          if (!res.ok) alert(res.error || "Could not highlight");
        });
      });
    } catch (e) {
      scroll.innerHTML = `<p class="status err">${esc(e.message)}</p>`;
    }
  }

  async renderSaves(decode) {
    const scroll = this.tabPanels.saves.querySelector("#saves-scroll");
    if (decode === "storage") {
      try {
        const filter = this.tabPanels.saves.querySelector("#storage-filter")?.value || "";
        const data = await callPage("getBrowserStorage", { filter });
        scroll.innerHTML = `
          <div class="toolbar" style="padding:0 0 8px">
            <input type="search" id="storage-filter" placeholder="Filter keys…" value="${escAttr(filter)}"/>
            <button type="button" class="btn" id="storage-refresh">Refresh</button>
          </div>
          <p class="hint">Origin: <code>${esc(data.origin)}</code></p>
          ${renderStorageTable("localStorage", data.local)}
          ${renderStorageTable("sessionStorage", data.session)}`;
        scroll.querySelector("#storage-refresh").addEventListener("click", () => this.renderSaves("storage"));
        scroll.querySelector("#storage-filter").addEventListener("keydown", (e) => {
          if (e.key === "Enter") this.renderSaves("storage");
        });
        scroll.querySelectorAll("[data-del-storage]").forEach((btn) => {
          btn.addEventListener("click", async () => {
            if (!confirm(`Delete ${btn.dataset.delStorage} key "${btn.dataset.key}"?`)) return;
            try {
              await callPage("deleteBrowserStorageKey", {
                storageType: btn.dataset.delStorage,
                key: btn.dataset.key,
              });
              await this.renderSaves("storage");
            } catch (err) {
              alert(err.message || String(err));
            }
          });
        });
      } catch (e) {
        scroll.innerHTML = `<p class="status err">${esc(e.message)}</p>`;
      }
      return;
    }
    if (this.capabilities && !this.capabilities.saves) {
      scroll.innerHTML = `<p class="empty">Save slot tools are SugarCube-only. This story uses ${esc(this.engine?.profile?.label || "another format")}.</p>
        <p class="hint">Use <strong>Raw storage</strong> to browse <code>localStorage</code> / <code>sessionStorage</code> for any game on this origin.</p>`;
      return;
    }
    try {
      if (decode) {
        const data = await callPage("decodeSaveBundle");
        if (data.parseError) {
          scroll.innerHTML = `<p class="status err">Parse error: ${esc(data.parseError)}</p><pre class="passage-text">${esc(data.raw || "")}</pre>`;
          return;
        }
        scroll.innerHTML = `<p><strong>${data.saveCount}</strong> saves in bundle</p>
          ${(data.saves || []).map((s) => `
            <details class="setup-item"><summary>${esc(s.desc || "Save")} — ${esc(s.dateStr)} — ${esc(s.passage || "?")} (${s.variableCount} vars)</summary>
            ${s.variables ? `<pre class="passage-text">${esc(JSON.stringify(s.variables, null, 2).slice(0, 8000))}</pre>` : ""}
            </details>`).join("")}`;
        return;
      }

      const slots = await callPage("getSaveSlots");
      if (!slots.supported) {
        scroll.innerHTML = `<p class="empty">${esc(slots.reason || "Save API not available on this page.")}</p>`;
        return;
      }
      scroll.innerHTML = `
        <p>Total browser saves: <strong>${slots.totalSize ?? "—"}</strong></p>
        <h4>Auto saves</h4>
        ${slots.auto.length ? `<table class="data"><tr><th>#</th><th>Description</th><th>Date</th></tr>
          ${slots.auto.map((s) => `<tr><td>${s.index}</td><td>${esc(s.desc)}</td><td>${esc(s.dateStr)}</td></tr>`).join("")}</table>` : `<p class="empty">None</p>`}
        <h4>Slot saves</h4>
        ${slots.slots.length ? `<table class="data"><tr><th>Slot</th><th>Description</th><th>Date</th></tr>
          ${slots.slots.map((s) => `<tr><td>${s.index}</td><td>${esc(s.desc)}</td><td>${esc(s.dateStr)}</td></tr>`).join("")}</table>` : `<p class="empty">None</p>`}
        <p class="hint">Use <strong>Decode save bundle</strong> to inspect variables inside saves (read-only). <strong>Raw storage</strong> browses all browser storage keys.</p>`;
    } catch (e) {
      scroll.innerHTML = `<p class="status err">${esc(e.message)}</p>`;
    }
  }

  async renderChat() {
    const scroll = this.tabPanels.chat.querySelector("#chat-scroll");
    if (!this.chatSystemDetected) {
      scroll.innerHTML = `<p class="empty">CHATSYSTEM not detected. Games using hituro's chat-macro expose <code>window.CHATSYSTEM</code> and <code>$chatsystem</code>.</p>`;
      return;
    }
    try {
      const [inspector, branch] = await Promise.all([
        callPage("getChatSystemInspector"),
        callPage("getChatBranchDebug"),
      ]);
      if (!inspector.detected) {
        scroll.innerHTML = `<p class="empty">CHATSYSTEM not detected.</p>`;
        return;
      }

      const convId = branch.domConversationId || inspector.domConversationId || "";

      scroll.innerHTML = `
        <div class="stat-grid">
          <div class="stat-card"><div class="label">Version</div><div class="value" style="font-size:13px">${esc(inspector.version || "—")}</div></div>
          <div class="stat-card"><div class="label">Conversations</div><div class="value">${inspector.conversations.length}</div></div>
          <div class="stat-card"><div class="label">_curr</div><div class="value">${branch.tempCurr ?? "—"}</div></div>
          <div class="stat-card"><div class="label">Active chat</div><div class="value" style="font-size:11px">${esc(convId || "—")}</div></div>
        </div>
        <h4 class="ov-section-title">Branch debugger</h4>
        <p class="hint">Passage: <strong>${esc(branch.passage || "—")}</strong> · DOM conversation: <code>${esc(convId || "—")}</code></p>
        <p><strong><code>_curr</code> conditions in passage:</strong> ${branch.currConditions.length ? branch.currConditions.map((c) => `<code>${esc(c)}</code>`).join(", ") : "none found"}</p>
        <p><strong>Visible chat response links:</strong> ${
          branch.responseLinks.length
            ? branch.responseLinks.map((l) => `<span class="tag ${l.hidden ? "warn" : "ok"}">${esc(l.label || l.tag)}${l.hidden ? " (hidden)" : ""}</span>`).join(" ")
            : "none in DOM"
        }</p>
        <div class="toolbar" style="padding:8px 0">
          <label>Set <code>_curr</code>:
            <input type="number" id="chat-curr-input" value="${escAttr(String(branch.tempCurr ?? 0))}" style="width:64px"/>
          </label>
          <button type="button" class="btn primary" id="chat-set-curr">Apply</button>
        </div>
        <h4 class="ov-section-title">Conversations</h4>
        ${inspector.conversations.length
          ? inspector.conversations.map((c) => `
            <details class="setup-item"${c.id === convId ? " open" : ""}>
              <summary><code>${esc(c.id)}</code> — ${c.messageCount} messages · last id ${c.lastId}</summary>
              ${c.messages.length ? `<table class="data"><tr><th>id</th><th>from</th><th>to</th><th>text</th><th></th></tr>
                ${c.messages.map((m) => `<tr>
                  <td>${m.id}</td><td>${esc(m.from || "")}</td><td>${esc(Array.isArray(m.to) ? m.to.join(", ") : m.to || "")}</td>
                  <td>${esc(m.text || "")}</td>
                  <td><button type="button" class="btn btn-xs" data-del-msg="${escAttr(c.id)}" data-msg-id="${escAttr(String(m.id))}">Del</button></td>
                </tr>`).join("")}
              </table>` : `<p class="empty">No messages</p>`}
              <p><button type="button" class="btn btn-xs" data-del-chat="${escAttr(c.id)}">Delete conversation</button></p>
            </details>`).join("")
          : `<p class="empty">No conversations in $chatsystem yet.</p>`}`;

      scroll.querySelector("#chat-set-curr").addEventListener("click", async () => {
        const val = Number(scroll.querySelector("#chat-curr-input").value);
        try {
          await callPage("chatSystemSetCurr", { value: val });
          await this.renderChat();
        } catch (err) {
          alert(err.message || String(err));
        }
      });

      scroll.querySelectorAll("[data-del-msg]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm(`Delete message #${btn.dataset.msgId}?`)) return;
          try {
            await callPage("chatSystemAction", {
              action: "deleteMsg",
              conversationId: btn.dataset.delMsg,
              messageId: Number(btn.dataset.msgId),
            });
            await this.renderChat();
          } catch (err) {
            alert(err.message || String(err));
          }
        });
      });

      scroll.querySelectorAll("[data-del-chat]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm(`Delete conversation "${btn.dataset.delChat}"?`)) return;
          try {
            await callPage("chatSystemAction", {
              action: "deleteChat",
              conversationId: btn.dataset.delChat,
            });
            await this.renderChat();
          } catch (err) {
            alert(err.message || String(err));
          }
        });
      });

      if (this.tabPanels.chat.querySelector("#chat-auto")?.checked && !this.chatRefreshTimer) {
        this.startChatRefresh();
      }
    } catch (e) {
      scroll.innerHTML = `<p class="status err">${esc(e.message)}</p>`;
    }
  }

  startChatRefresh() {
    this.stopChatRefresh();
    if (this.activeTab !== "chat") return;
    this.chatRefreshTimer = setInterval(() => {
      if (this.activeTab === "chat" && this.open) this.renderChat();
    }, 2000);
  }

  stopChatRefresh() {
    if (this.chatRefreshTimer) clearInterval(this.chatRefreshTimer);
    this.chatRefreshTimer = null;
  }

  showGraphPlaceholder() {
    const scroll = this.tabPanels.graph.querySelector("#graph-scroll");
    if (scroll.querySelector(".graph-viewport-root")) return;
    scroll.innerHTML = `
      <p class="hint">Pick a starting passage and depth, then click <strong>Visual map</strong>. Enable <strong>Live DOM links</strong> while standing on a passage to see runtime choices.</p>
      <p class="hint">For large stories, keep depth at 1–2. Use <strong>Table view</strong> or filtered maps instead of <strong>Full story</strong>.</p>`;
  }

  lastGraphRequest = null;

  rerenderLastGraph() {
    if (this.lastGraphRequest !== null) {
      this.renderGraphVisual(this.lastGraphRequest);
    }
  }

  async renderGraphVisual(fullStory) {
    const scroll = this.tabPanels.graph.querySelector("#graph-scroll");
    try {
      const minLinks = Number(this.tabPanels.graph.querySelector("#graph-min")?.value) || 0;
      if (fullStory) {
        const meta = await callPage("getMeta");
        const count = meta?.passageCount ?? 0;
        if (count > 400 && minLinks === 0) {
          const ok = confirm(
            `This story has ${count} passages. The full map will work, but it is a lot to look at.\n\n` +
              `Tip: set "Min links" to 2+ to see only the well-connected passages (hubs and main routes), ` +
              `or use the category filter.\n\nRender the full map anyway?`
          );
          if (!ok) return;
        }
      }
      this.lastGraphRequest = fullStory;

      const from = this.tabPanels.graph.querySelector("#graph-from").value;
      const depth = Number(this.tabPanels.graph.querySelector("#graph-depth").value) || 2;
      const meta = await callPage("getMeta");
      const center = from || (meta && meta.passage) || null;

      const includeDom = this.tabPanels.graph.querySelector("#graph-dom")?.checked !== false;
      const tagCategory = this.tabPanels.graph.querySelector("#graph-category")?.value || "";
      const locationHubsOnly = this.tabPanels.graph.querySelector("#graph-hubs")?.checked === true;
      const graph = await callPage("getGraphForVisual", {
        center,
        depth,
        full: fullStory,
        includeDom,
        tagCategory: tagCategory || undefined,
        locationHubsOnly,
      });

      // Client-side degree filter — declutters huge maps without re-querying.
      let nodes = graph.nodes || [];
      let edges = graph.edges || [];
      if (minLinks > 0) {
        const keep = new Set(
          nodes.filter((n) => (n.degree || 0) >= minLinks || n.id === (graph.center || center)).map((n) => n.id)
        );
        nodes = nodes.filter((n) => keep.has(n.id));
        edges = edges.filter((e) => keep.has(e.from) && keep.has(e.to));
      }

      if (this.graphCleanup) {
        this.graphCleanup();
        this.graphCleanup = null;
      }
      scroll.innerHTML = `<div class="graph-visual-root"><div id="graph-viz-host"></div></div>`;
      const host = scroll.querySelector("#graph-viz-host");
      const highlightQuery = this.tabPanels.graph.querySelector("#graph-find")?.value || "";
      const result = renderStoryGraph(host, { ...graph, nodes, edges }, {
        center: graph.center || center,
        focusCenter: !fullStory && !highlightQuery.trim(),
        highlightQuery,
        startPassage: graph.startPassage,
        onNodeClick: (name) => this.gotoPassage(name),
      });
      this.graphCleanup = result?.cleanup || null;

      const findStatus = this.tabPanels.graph.querySelector("#graph-find-status");
      if (findStatus) {
        findStatus.textContent = highlightQuery.trim()
          ? `${result?.matchCount || 0} match${(result?.matchCount || 0) === 1 ? "" : "es"}`
          : "";
      }

      const hiddenNote = minLinks > 0 ? ` · min links ≥ ${minLinks} (${(graph.nodes || []).length - nodes.length} hidden)` : "";
      if (!fullStory && edges.length) {
        const domCount = edges.filter((e) => e.type === "dom-live" || e.type === "dom-inline").length;
        const tagCount = edges.filter((e) => e.type && e.type.indexOf("tag-") === 0).length;
        const filterNote = graph.filtered ? " · filtered view" : "";
        scroll.insertAdjacentHTML(
          "beforeend",
          `<p class="hint">${nodes.length} nodes, ${edges.length} edges (${domCount} DOM, ${tagCount} tag hints)${filterNote}${hiddenNote}. See legend above map for colors.</p>`
        );
      } else if (fullStory) {
        scroll.insertAdjacentHTML("beforeend", `<p class="hint">${nodes.length} nodes, ${edges.length} edges shown${hiddenNote}.</p>`);
      }
    } catch (e) {
      scroll.innerHTML = `<p class="status err">${esc(e.message)}</p>`;
    }
  }

  // ── Feedback → GitHub issue ─────────────────────────────────────────────

  showFeedbackDialog() {
    this.feedbackModal.hidden = false;
    this.updateFeedbackPreview();
    this.feedbackModal.querySelector("#fb-desc").focus();
  }

  hideFeedbackDialog() {
    this.feedbackModal.hidden = true;
    this.panel.focus({ preventScroll: true });
  }

  updateFeedbackPreview() {
    const preview = this.feedbackModal.querySelector("#fb-preview");
    const diagOn = this.feedbackModal.querySelector("#fb-diag").checked;
    const urlOn = this.feedbackModal.querySelector("#fb-url").checked;
    preview.textContent = diagOn
      ? this.buildFeedbackDiagnostics(urlOn)
      : "(no diagnostics will be included)";
  }

  buildFeedbackDiagnostics(includeUrl) {
    const runtime = getRuntime();
    let version = "?";
    try {
      version = runtime?.runtime?.getManifest?.().version || "?";
    } catch { /* harness or restricted context */ }
    const lines = [
      `Twine Peeks: ${version}`,
      `Browser: ${navigator.userAgent}`,
      `Engine: ${this.engine?.profile?.label || "not detected"}`,
      `Panel badge: ${this.badgeEl?.textContent || "—"}`,
    ];
    if (this.chatSystemDetected) lines.push("CHATSYSTEM: detected");
    if (includeUrl) lines.push(`Page: ${location.href}`);
    return lines.join("\n");
  }

  openFeedbackIssue() {
    const desc = this.feedbackModal.querySelector("#fb-desc").value.trim();
    if (!desc) {
      alert("Please describe the problem or idea first.");
      return;
    }
    const kind = this.feedbackModal.querySelector('input[name="fb-kind"]:checked')?.value || "bug";
    const diagOn = this.feedbackModal.querySelector("#fb-diag").checked;
    const urlOn = this.feedbackModal.querySelector("#fb-url").checked;

    // Field ids must match .github/ISSUE_TEMPLATE/*.yml — GitHub prefills
    // issue-form fields from query params named after the field id.
    const template = kind === "bug" ? "bug_report.yml" : "feature_request.yml";
    const fieldId = kind === "bug" ? "what-happened" : "idea";
    const title = (kind === "bug" ? "[Bug] " : "[Idea] ") + desc.replace(/\s+/g, " ").slice(0, 60);

    const params = new URLSearchParams();
    params.set("template", template);
    params.set("title", title);
    params.set(fieldId, desc.slice(0, 2000));
    if (diagOn) params.set("diagnostics", this.buildFeedbackDiagnostics(urlOn).slice(0, 1500));

    window.open(`https://github.com/${FEEDBACK_REPO}/issues/new?${params.toString()}`, "_blank", "noopener");
    this.hideFeedbackDialog();
  }

  // ── Update notice ────────────────────────────────────────────────────────

  maybeCheckForUpdate() {
    if (this.updateChecked) return;
    this.updateChecked = true;
    const runtime = getRuntime();
    let current = null;
    try {
      current = parseVersion(runtime?.runtime?.getManifest?.().version);
    } catch { /* no manifest access (test harness) — skip the check */ }
    const storage = runtime?.storage?.local;
    if (!current || !storage) return;

    const apply = (latestTag) => {
      const latest = parseVersion(latestTag);
      if (!latest || !isNewerVersion(latest, current)) return;
      this.updateEl.textContent = `${latestTag} available`;
      this.updateEl.hidden = false;
    };

    storage.get({ [UPDATE_CHECK_KEY]: null }, (res) => {
      const cached = res?.[UPDATE_CHECK_KEY];
      if (cached && Date.now() - cached.ts < 24 * 60 * 60 * 1000) {
        apply(cached.latest);
        return;
      }
      fetch(`https://api.github.com/repos/${FEEDBACK_REPO}/releases/latest`, {
        headers: { Accept: "application/vnd.github+json" },
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          const latest = (data && data.tag_name) || null;
          storage.set({ [UPDATE_CHECK_KEY]: { ts: Date.now(), latest } }, () => {});
          apply(latest);
        })
        .catch(() => { /* offline or rate-limited — try again next day */ });
    });
  }

  // ── Quick state snapshots (JSON tab) ────────────────────────────────────

  snapshotStoryKey() {
    return `${location.host}${location.pathname}`;
  }

  loadSnapshotStore() {
    return new Promise((resolve) => {
      const storage = getRuntime()?.storage?.local;
      if (!storage) return resolve({});
      storage.get({ [SNAPSHOTS_KEY]: {} }, (res) => resolve(res?.[SNAPSHOTS_KEY] || {}));
    });
  }

  saveSnapshotStore(store) {
    return new Promise((resolve, reject) => {
      const runtime = getRuntime();
      const storage = runtime?.storage?.local;
      if (!storage) return reject(new Error("Extension storage unavailable"));
      storage.set({ [SNAPSHOTS_KEY]: store }, () => {
        const err = runtime.runtime?.lastError;
        if (err) reject(new Error(err.message || "Storage error (quota?)"));
        else resolve();
      });
    });
  }

  async takeSnapshot() {
    try {
      const json = await callPage("exportVariablesJson");
      if (!json || json === "{}") {
        alert("No variables to snapshot yet — start or load a game first.");
        return;
      }
      if (json.length > MAX_SNAPSHOT_BYTES) {
        alert(`This game's state is too large to snapshot (${Math.round(json.length / 1024)} KB > ${MAX_SNAPSHOT_BYTES / 1000} KB). Use Export / Copy instead.`);
        return;
      }
      let meta = null;
      try { meta = await callPage("getMeta"); } catch { /* fine without */ }
      const defName = `${meta?.passage || "state"} — ${new Date().toLocaleString()}`;
      const name = prompt("Snapshot name:", defName);
      if (name === null) return;

      const store = await this.loadSnapshotStore();
      const key = this.snapshotStoryKey();
      const list = store[key] || [];
      list.unshift({ name: name.trim() || defName, ts: Date.now(), passage: meta?.passage || "", json });
      const dropped = list.length > MAX_SNAPSHOTS_PER_STORY;
      if (dropped) list.length = MAX_SNAPSHOTS_PER_STORY;
      store[key] = list;
      await this.saveSnapshotStore(store);
      await this.renderSnapshots();
      if (dropped) alert(`Oldest snapshot dropped — ${MAX_SNAPSHOTS_PER_STORY} are kept per story. Use “Save .json” to keep older ones as files.`);
    } catch (e) {
      alert(e.message || String(e));
    }
  }

  async renderSnapshots() {
    const box = this.tabPanels.json?.querySelector("#json-snaps");
    if (!box) return;
    const store = await this.loadSnapshotStore();
    const list = store[this.snapshotStoryKey()] || [];
    if (!list.length) {
      box.innerHTML = "";
      return;
    }
    box.innerHTML = list
      .map(
        (s, i) => `
        <div class="snap-row">
          <span class="snap-name" title="${escAttr(s.name)}">${esc(s.name)}</span>
          <span class="hint">${s.passage ? esc(s.passage) + " · " : ""}${Math.round(s.json.length / 1024)} KB</span>
          <button type="button" class="btn btn-xs" data-snap-restore="${i}">Restore</button>
          <button type="button" class="btn btn-xs" data-snap-dl="${i}">Save .json</button>
          <button type="button" class="btn btn-xs" data-snap-del="${i}" title="Delete snapshot">×</button>
        </div>`
      )
      .join("");
    box.querySelectorAll("[data-snap-restore]").forEach((btn) => {
      btn.addEventListener("click", () => this.restoreSnapshot(Number(btn.dataset.snapRestore)));
    });
    box.querySelectorAll("[data-snap-dl]").forEach((btn) => {
      btn.addEventListener("click", () => this.downloadSnapshot(Number(btn.dataset.snapDl)));
    });
    box.querySelectorAll("[data-snap-del]").forEach((btn) => {
      btn.addEventListener("click", () => this.deleteSnapshot(Number(btn.dataset.snapDel)));
    });
  }

  async restoreSnapshot(index) {
    const store = await this.loadSnapshotStore();
    const snap = (store[this.snapshotStoryKey()] || [])[index];
    if (!snap) return;
    if (!confirm(`Restore snapshot “${snap.name}”?\n\nValues are merged into the live variables (keys added since the snapshot are kept). Use a test save first.`)) {
      return;
    }
    try {
      await callPage("mergeVariables", { json: snap.json });
      await this.exportJson();
      alert("Snapshot restored (merged). You may need to navigate or refresh the passage for the UI to update.");
    } catch (e) {
      alert(e.message || String(e));
    }
  }

  async downloadSnapshot(index) {
    const store = await this.loadSnapshotStore();
    const snap = (store[this.snapshotStoryKey()] || [])[index];
    if (!snap) return;
    const safeName = snap.name.replace(/[^\w.-]+/g, "_").slice(0, 60) || "snapshot";
    const blob = new Blob([snap.json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `twine-peeks-${safeName}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  async deleteSnapshot(index) {
    const store = await this.loadSnapshotStore();
    const key = this.snapshotStoryKey();
    const list = store[key] || [];
    const snap = list[index];
    if (!snap) return;
    if (!confirm(`Delete snapshot “${snap.name}”?`)) return;
    list.splice(index, 1);
    if (list.length) store[key] = list;
    else delete store[key];
    await this.saveSnapshotStore(store);
    await this.renderSnapshots();
  }

  makePanelDraggable(header) {
    let dx = 0;
    let dy = 0;

    const clampOffset = () => {
      const margin = 16;
      const pw = this.panel.offsetWidth;
      const ph = this.panel.offsetHeight;
      const maxDx = Math.max(0, (window.innerWidth - pw) / 2 - margin);
      const maxDy = Math.max(0, (window.innerHeight - ph) / 2 - margin);
      dx = Math.max(-maxDx, Math.min(maxDx, dx));
      dy = Math.max(-maxDy, Math.min(maxDy, dy));
    };

    window.addEventListener("resize", () => {
      if (dx === 0 && dy === 0) return;
      clampOffset();
      this.panel.style.transform = `translate(${dx}px, ${dy}px)`;
    });

    header.addEventListener("mousedown", (e) => {
      if (e.target.closest(".icon-btn")) return;
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const origDx = dx;
      const origDy = dy;

      const onMove = (ev) => {
        dx = origDx + (ev.clientX - startX);
        dy = origDy + (ev.clientY - startY);
        clampOffset();
        this.panel.style.transform = `translate(${dx}px, ${dy}px)`;
      };

      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  }
}

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function parseVersion(s) {
  const m = String(s || "").match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function isNewerVersion(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

function renderStorageTable(title, rows) {
  if (!rows || !rows.length) {
    return `<h4>${esc(title)}</h4><p class="empty">No keys</p>`;
  }
  const storageType = title.includes("session") ? "session" : "local";
  return `<h4>${esc(title)} (${rows.length})</h4>
    <table class="data"><tr><th>Key</th><th>Size</th><th>Preview</th><th></th></tr>
    ${rows.map((r) => `<tr>
      <td><code>${esc(r.key)}</code></td>
      <td>${r.size}</td>
      <td><code>${esc(r.preview)}</code></td>
      <td><button type="button" class="btn btn-xs" data-del-storage="${storageType}" data-key="${escAttr(r.key)}">Delete</button></td>
    </tr>`).join("")}
    </table>`;
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escAttr(s) {
  return esc(s).replace(/'/g, "&#39;");
}

function cssPathAttr(path) {
  return path.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function findPassageRow(container, name) {
  return [...container.querySelectorAll(".pass-row")].find((row) => row.dataset.passRow === name) || null;
}

function formatOverviewValue(value, unset = false) {
  if (unset || value === undefined) return "(not set)";
  if (value === null) return "null";
  if (typeof value === "object") {
    if (value.__twType === "Function") {
      const label = value.name ? `[Function ${value.name}]` : "[Function]";
      return label;
    }
    if (value.__twType === "undefined") return "undefined";
    if (value.__twType === "Map") return `[Map(${mapEntries(value).length})]`;
    if (value.__twType === "Set") return `[Set(${setValues(value).length})]`;
    if (value.__twType === "Circular") return "[Circular]";
    const s = JSON.stringify(value);
    return s.length > 60 ? `${s.slice(0, 57)}…` : s;
  }
  const s = String(value);
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
}

function renderConditionStatus(c) {
  if (c.result === true) return '<span class="tag ok">passes</span>';
  if (c.result === false) return '<span class="tag bad">fails</span>';
  const detail = c.evalError ? esc(c.evalError) : "could not evaluate";
  return `<span class="tag warn" title="${escAttr(detail)}">unknown</span>`;
}

function renderVarChips(vars) {
  if (!vars || !vars.length) return "—";
  return vars
    .map(
      (v) =>
        `<span class="tag var-chip${v.unset ? " var-unset" : ""}" title="${escAttr(v.unset ? "Variable not set in save" : String(v.value))}">${esc(v.path)} = ${esc(formatOverviewValue(v.value, v.unset))}</span>`
    )
    .join(" ");
}

function renderChoiceStatus(status) {
  switch (status) {
    case "visible":
      return '<span class="tag ok">visible</span>';
    case "hidden":
      return '<span class="tag warn">hidden in DOM</span>';
    case "not-rendered":
      return '<span class="tag bad">not on screen</span>';
    default:
      return '<span class="tag">unknown</span>';
  }
}

function renderEffectsList(effects) {
  if (!effects) return `<p class="empty">No macros detected.</p>`;
  const parts = [];
  if (effects.set?.length) {
    parts.push(`<p><strong>&lt;&lt;set&gt;&gt;</strong> ${effects.set.map((s) => `<code>${esc(s)}</code>`).join(", ")}</p>`);
  }
  if (effects.run?.length) {
    parts.push(`<p><strong>&lt;&lt;run&gt;&gt;</strong> ${effects.run.map((s) => `<code>${esc(s)}</code>`).join(", ")}</p>`);
  }
  if (effects.print?.length) {
    parts.push(`<p><strong>&lt;&lt;print&gt;&gt;</strong> ${effects.print.map((s) => `<code>${esc(s)}</code>`).join(", ")}</p>`);
  }
  if (effects.goto?.length) {
    parts.push(`<p><strong>&lt;&lt;goto&gt;&gt;</strong> ${effects.goto.map((s) => `<code>${esc(s)}</code>`).join(", ")}</p>`);
  }
  if (effects.include?.length) {
    parts.push(`<p><strong>&lt;&lt;include&gt;&gt;</strong> ${effects.include.map((s) => `<code>${esc(s)}</code>`).join(", ")}</p>`);
  }
  if (effects.switch?.length) {
    parts.push(
      `<p><strong>&lt;&lt;switch&gt;&gt; / &lt;&lt;case&gt;&gt;</strong> ${effects.switch
        .map((s) => `<code>${esc(s.kind)}: ${esc(s.expression)}</code>`)
        .join(", ")}</p>`
    );
  }
  if (effects.script?.length) {
    parts.push(
      `<details class="ov-details"><summary>&lt;&lt;script&gt;&gt; blocks (${effects.script.length})</summary>${effects.script
        .map((s) => `<pre class="passage-text">${esc(s.slice(0, 1200))}${s.length > 1200 ? "\n…" : ""}</pre>`)
        .join("")}</details>`
    );
  }
  return parts.length ? parts.join("") : `<p class="empty">No &lt;&lt;set&gt;&gt;, &lt;&lt;run&gt;&gt;, or other effect macros on this passage.</p>`;
}

function renderSandboxPreview(scan) {
  const s = scan.summary || {};
  const rows = (scan.changes || [])
    .slice(0, 80)
    .map(
      (c) =>
        `<tr><td><code>${esc(c.pathExpr)}</code></td><td><span class="tag">${esc(c.action)}</span></td><td>${esc(String(c.from))} → <strong>${esc(String(c.to))}</strong></td><td class="snippet">${esc(c.reason)}</td></tr>`
    )
    .join("");
  return `
    <p><strong>${scan.changeCount}</strong> proposed changes
      (${s.unlock || 0} unlock · ${s.invertLock || 0} locks cleared · ${s.max || 0} max · ${s.passage || 0} passage maps)
      ${scan.truncated ? " — preview shows first 80" : ""}
    </p>
    <p class="hint">${esc(scan.disclaimer || "")}</p>
    ${rows ? `<div class="table-scroll"><table class="data sandbox-table"><tr><th>Path</th><th>Action</th><th>Change</th><th>Why</th></tr>${rows}</table></div>` : `<p class="empty">No changes matched — this game may use different variable patterns.</p>`}`;
}

function renderFormatTech(tech, options = {}) {
  const inTab = options.inTab;
  if (!tech || !tech.supported) {
    return `<div class="inspect-result-card"><p class="empty">${esc(tech?.reason || "Format tech scan unavailable.")}</p>
      ${inTab ? "" : `<p><button type="button" class="btn" id="format-tech-clear">Close</button></p>`}</div>`;
  }

  const macroRows = (tech.customMacros || [])
    .map(
      (m) =>
        `<tr><td><code>&lt;&lt;${esc(m.name)}&gt;&gt;</code></td>
        <td>${m.isWidget ? '<span class="tag">widget</span>' : m.source === "story-js" ? '<span class="tag ok">Macro.add in story JS</span>' : m.hasHandler ? '<span class="tag ok">handler</span>' : "—"}</td>
        <td>${m.tags ? m.tags.map((t) => `<code>${esc(t)}</code>`).join(" ") : "—"}</td></tr>`
    )
    .join("");

  const widgetRows = (tech.widgets || [])
    .map(
      (w) =>
        `<tr><td>${esc(w.passage)}</td><td>${(w.widgets || []).map((n) => `<code>&lt;&lt;${esc(n)}&gt;&gt;</code>`).join(" ") || "—"}</td></tr>`
    )
    .join("");

  const setupByCat = {};
  (tech.setupKeys || []).forEach((k) => {
    const cat = k.category || "other";
    if (!setupByCat[cat]) setupByCat[cat] = [];
    setupByCat[cat].push(k);
  });
  const setupGrouped = Object.keys(setupByCat)
    .sort()
    .map(
      (cat) =>
        `<div class="setup-group"><strong>${esc(cat)}</strong><div class="chip-wrap">${setupByCat[cat]
          .map((k) => `<span class="tag" title="${escAttr(k.type)}">${esc(k.key)}</span>`)
          .join(" ")}</div></div>`
    )
    .join("");

  const setupFnChips = (tech.setupFunctions || [])
    .map((k) => `<span class="tag ok">${esc(k)}()</span>`)
    .join(" ");

  const classRows = (tech.windowClasses || [])
    .map(
      (c) =>
        `<tr><td><code>${esc(c.name)}</code></td><td>${(c.protoMethods || []).map((m) => `<code>${esc(m)}</code>`).join(" ") || "—"}</td></tr>`
    )
    .join("");

  const configRows = tech.config
    ? Object.keys(tech.config)
        .sort()
        .map((k) => {
          const v = tech.config[k];
          const preview =
            typeof v === "object" ? esc(JSON.stringify(v).slice(0, 120)) + (JSON.stringify(v).length > 120 ? "…" : "") : esc(String(v));
          return `<tr><td><code>Config.${esc(k)}</code></td><td><code>${preview}</code></td></tr>`;
        })
        .join("")
    : "";

  const settingRows = (tech.settingsControls || [])
    .map(
      (s) =>
        `<tr><td><code>${esc(s.id)}</code></td><td>${esc(s.name || s.id)}</td><td>${esc(s.type || "—")}</td><td>${esc(formatOverviewValue(s.value))}</td></tr>`
    )
    .join("");

  const libraryRows = (tech.libraries || [])
    .map((l) => `<tr><td>${esc(l.name)}</td><td><code>${esc(l.version)}</code></td></tr>`)
    .join("");

  const scripts = tech.scripts || {};
  const kb = (n) => (n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n || 0} chars`);
  const extScriptRows = (scripts.externalScripts || [])
    .map((s) => `<tr><td><code>${esc(s)}</code></td><td>script</td></tr>`)
    .join("");
  const extStyleRows = (scripts.externalStyles || [])
    .map((s) => `<tr><td><code>${esc(s)}</code></td><td>stylesheet</td></tr>`)
    .join("");
  const scriptPassRows = (scripts.scriptTaggedPassages || [])
    .map((p) => `<tr><td>${esc(p.name)}</td><td>${(p.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join(" ")}</td><td>${kb(p.chars)}</td></tr>`)
    .join("");

  const globalsData = tech.customGlobals || {};
  const gameGlobals = (globalsData.globals || []).filter((g) => !g.origin || g.origin === "game");
  const otherGlobals = (globalsData.globals || []).filter((g) => g.origin === "library" || g.origin === "engine");
  const globalRow = (g) =>
    `<tr><td><code>${esc(g.name)}</code></td><td><span class="tag">${esc(g.type)}</span></td><td class="snippet">${esc(g.preview || "")}</td></tr>`;
  const globalRows = gameGlobals.map(globalRow).join("");
  const otherGlobalRows = otherGlobals.map(globalRow).join("");

  const genericSections = `
      <h4 class="ov-section-title">Detected libraries (${(tech.libraries || []).length})</h4>
      <p class="hint">Third-party JavaScript libraries the game loads on top of the story format.</p>
      ${libraryRows ? `<table class="data"><tr><th>Library</th><th>Version</th></tr>${libraryRows}</table>` : `<p class="empty">No known third-party libraries detected.</p>`}

      <h4 class="ov-section-title">Story code &amp; external files</h4>
      <p class="hint">Code the author added: Story JavaScript/Stylesheet plus any extra files loaded by the page.</p>
      <div class="chip-wrap">
        <span class="tag">Story JS: ${kb(scripts.storyScriptChars || 0)}</span>
        <span class="tag">Story CSS: ${kb(scripts.storyStyleChars || 0)}</span>
        <span class="tag">Inline scripts: ${scripts.inlineScriptCount || 0} (${kb(scripts.inlineScriptChars || 0)})</span>
      </div>
      ${extScriptRows || extStyleRows ? `<table class="data" style="margin-top:6px"><tr><th>External file</th><th>Type</th></tr>${extScriptRows}${extStyleRows}</table>` : `<p class="empty">No external script/style files — everything is bundled in the HTML.</p>`}
      ${scriptPassRows ? `<h4 class="ov-section-title">Script/stylesheet passages (${(scripts.scriptTaggedPassages || []).length})</h4><table class="data"><tr><th>Passage</th><th>Tags</th><th>Size</th></tr>${scriptPassRows}</table>` : ""}

      <h4 class="ov-section-title">Game-added globals (${gameGlobals.length}${globalsData.truncated ? "+" : ""})</h4>
      <p class="hint">Everything on <code>window</code> that a clean page does not have, minus engine exports and known libraries — the quickest way to spot a game's homemade systems.</p>
      ${globalRows ? `<div class="table-scroll"><table class="data"><tr><th>Global</th><th>Type</th><th>Preview</th></tr>${globalRows}</table></div>` : `<p class="empty">${esc(globalsData.error || "No game-specific globals detected.")}</p>`}
      ${otherGlobalRows ? `<details class="ov-details"><summary>Engine exports &amp; library globals (${otherGlobals.length})</summary><div class="table-scroll"><table class="data"><tr><th>Global</th><th>Type</th><th>Preview</th></tr>${otherGlobalRows}</table></div></details>` : ""}`;

  const sugarcubeSections = tech.sugarcube
    ? `
      <h4 class="ov-section-title">Custom macros (${(tech.customMacros || []).length}) <span class="hint">+${tech.builtinMacroCount || 0} built-ins</span></h4>
      <p class="hint">From the Macro registry plus <code>Macro.add(…)</code> calls found in story JavaScript.</p>
      ${macroRows ? `<table class="data"><tr><th>Macro</th><th>Kind</th><th>Child tags</th></tr>${macroRows}</table>` : `<p class="empty">No custom macros found.</p>`}

      <h4 class="ov-section-title">Widget passages (${(tech.widgets || []).length})</h4>
      <p class="hint">Passages tagged <code>widget</code> — the standard place SugarCube games define <code>&lt;&lt;widget&gt;&gt;</code> macros.</p>
      ${widgetRows ? `<table class="data"><tr><th>Passage</th><th>Widgets defined</th></tr>${widgetRows}</table>` : `<p class="empty">No widget-tagged passages.</p>`}

      <h4 class="ov-section-title">setup.* data (${(tech.setupKeys || []).length}) & functions (${(tech.setupFunctions || []).length})</h4>
      <p class="hint">The <code>setup</code> object is SugarCube's conventional namespace for game-defined data and helpers.</p>
      ${setupGrouped || `<p class="empty">No setup data keys.</p>`}
      ${setupFnChips ? `<div class="chip-wrap" style="margin-top:6px">${setupFnChips}</div>` : ""}

      <h4 class="ov-section-title">Config (${tech.config ? Object.keys(tech.config).length : 0})</h4>
      <p class="hint">SugarCube engine configuration — saves, history, passages, UI behavior.</p>
      ${configRows ? `<table class="data"><tr><th>Key</th><th>Value</th></tr>${configRows}</table>` : `<p class="empty">Config not available.</p>`}

      <h4 class="ov-section-title">Settings (${(tech.settingsControls || []).length})</h4>
      <p class="hint">Player-facing options registered via <code>Setting.addToggle</code>, <code>Setting.addList</code>, etc.</p>
      ${settingRows ? `<table class="data"><tr><th>ID</th><th>Name</th><th>Type</th><th>Current</th></tr>${settingRows}</table>` : `<p class="empty">No Setting controls registered (or not exposed).</p>`}

      <h4 class="ov-section-title">Custom window classes (${(tech.windowClasses || []).length})</h4>
      <p class="hint">Constructor/classes attached to <code>window</code> — games often expose helpers like Person, Meter, Encounter here.</p>
      ${classRows ? `<table class="data"><tr><th>Class</th><th>Methods</th></tr>${classRows}</table>` : `<p class="empty">No custom window classes detected.</p>`}`
    : `<p class="hint">${esc(tech.reason || "SugarCube-specific sections unavailable for this format.")}</p>`;

  return `
    <div class="inspect-result-card">
      <div class="inspect-result-head"><strong>Format tech</strong>
        <span class="tag">${tech.sugarcube ? "SugarCube + generic scan" : "generic scan"}</span>
      </div>
      <p class="hint">Runtime scan of the game's tech stack — libraries, custom code, and engine extension points. Nothing here is hardcoded to a specific title.</p>
      ${genericSections}
      ${sugarcubeSections}
      ${inTab ? "" : `<p style="margin-top:10px"><button type="button" class="btn" id="format-tech-clear">Close</button></p>`}
    </div>`;
}

function renderTagTaxonomySection(taxonomy) {
  if (!taxonomy) return "";
  const catRows = (taxonomy.categories || [])
    .filter((c) => c.passageCount > 0)
    .map(
      (c) =>
        `<tr><td><span class="tag tag-cat-${escAttr(c.id)}">${esc(c.label || c.id)}</span></td><td>${c.passageCount}</td><td class="snippet">${(c.samplePassages || []).map((p) => esc(p)).join(", ")}</td></tr>`
    )
    .join("");
  const topTags = (taxonomy.tags || [])
    .slice(0, 25)
    .map(
      (t) =>
        `<tr><td><span class="tag">${esc(t.tag)}</span> <span class="tag tag-cat-${escAttr(t.primaryCategory)}">${esc(t.primaryCategory)}</span></td><td>${t.count}</td><td class="snippet">${(t.samplePassages || []).slice(0, 3).map((p) => esc(p)).join(", ")}</td></tr>`
    )
    .join("");
  return `
    <section class="ov-section">
      <h4 class="ov-section-title">Tag taxonomy (${taxonomy.uniqueTags || 0} unique tags)</h4>
      <p class="hint">Generic classification of passage tags — navigation, time gates, events, widgets, etc. Patterns work on any SugarCube game using similar conventions.</p>
      ${catRows ? `<table class="data"><tr><th>Category</th><th>Passages</th><th>Examples</th></tr>${catRows}</table>` : ""}
      ${topTags ? `<h4 class="ov-section-title">Most common tags</h4><table class="data"><tr><th>Tag</th><th>Count</th><th>Sample passages</th></tr>${topTags}</table>` : ""}
    </section>`;
}

function categorizeSetupKey(key) {
  const kl = String(key).toLowerCase();
  if (/people|person|character|npc|name|relationship/.test(kl)) return "characters";
  if (/map|location|room|place|travel|weather|time|schedule|event/.test(kl)) return "world";
  if (/clothes|wear|outfit|cosmetic|hair|piercing/.test(kl)) return "appearance";
  if (/skill|trait|need|inclination|archetype/.test(kl)) return "stats";
  if (/dialog|chat|phone|message|stream/.test(kl)) return "communication";
  if (/shop|business|money|inventory|item|gift|dorm/.test(kl)) return "economy";
  if (/school|sport|class|exam/.test(kl)) return "activities";
  return "other";
}

function renderDialogOpenBanner(dialogSnap) {
  if (!dialogSnap?.open) return "";
  const title = dialogSnap.title ? esc(dialogSnap.title) : "Untitled dialog";
  const count = dialogSnap.interactiveCount ?? dialogSnap.links?.length ?? 0;
  return `
    <div class="inspect-banner inspect-dialog-banner">
      <strong>Dialog open:</strong> ${title}
      <span class="hint">· ${count} interactive element${count === 1 ? "" : "s"} inside</span>
      <button type="button" class="btn btn-xs" id="ov-analyze-dialog-inline">Analyze dialog</button>
    </div>`;
}

function renderInspectDialogLinks(links) {
  if (!links?.length) return `<p class="empty">No links or actions detected inside dialog.</p>`;
  const rows = links
    .map(
      (l) =>
        `<tr>
          <td>${esc(l.label || "—")}</td>
          <td>${l.target ? esc(l.target) : "—"}</td>
          <td>${l.setter ? `<code>${esc(l.setter.slice(0, 120))}${l.setter.length > 120 ? "…" : ""}</code>` : "—"}</td>
          <td><span class="tag">${esc(l.type || "link")}</span></td>
        </tr>`
    )
    .join("");
  return `<table class="data"><tr><th>Label</th><th>Passage</th><th>Setter</th><th>Type</th></tr>${rows}</table>`;
}

function renderInspectVarTable(title, variables, btnPrefix) {
  if (!variables?.length) return "";
  const rows = variables
    .map(
      (v, i) =>
        `<tr><td><code>${esc(v.path || v.name)}</code></td><td>${esc(formatOverviewValue(v.value, v.unset))}</td>
        <td><button type="button" class="btn btn-xs" data-inspect-var="${escAttr(v.name || v.path)}">${esc("Find")}</button></td></tr>`
    )
    .join("");
  return `<h4 class="ov-section-title">${esc(title)}</h4><table class="data"><tr><th>Path</th><th>Value</th><th></th></tr>${rows}</table>`;
}

function renderCurrentPassageContext(ctx, meta) {
  if (!ctx) {
    return `<section class="ov-section"><p class="empty">No current passage context.</p></section>`;
  }
  if (ctx.error && !ctx.conditions) {
    return `
      <section class="ov-section ov-current">
        <h3 class="ov-passage-title">${esc(ctx.passage || meta.passage || "—")}</h3>
        <p class="status err">${esc(ctx.error)}</p>
        ${renderDomLinksOnly(ctx.domLinks)}
      </section>`;
  }

  const tags = (ctx.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("") || "—";
  const played =
    ctx.hasPlayed === true
      ? '<span class="tag ok">visited before</span>'
      : ctx.hasPlayed === false
        ? '<span class="tag warn">first visit</span>'
        : "";

  const conditionsHtml = ctx.conditions?.length
    ? `<table class="data ov-cond-table"><tr><th>Type</th><th>Condition</th><th>Now</th><th>Variables</th></tr>
      ${ctx.conditions
        .map(
          (c) => `<tr class="ov-cond-${c.result === true ? "pass" : c.result === false ? "fail" : "unknown"}">
          <td><code>&lt;&lt;${esc(c.type)}&gt;&gt;</code></td>
          <td><code>${esc(c.expression)}</code></td>
          <td>${renderConditionStatus(c)}</td>
          <td class="ov-var-cell">${renderVarChips(c.variables)}</td>
        </tr>`
        )
        .join("")}</table>`
    : `<p class="empty">No &lt;&lt;if&gt;&gt;, &lt;&lt;elseif&gt;&gt;, or &lt;&lt;unless&gt;&gt; conditions in this passage source.</p>`;

  const choicesHtml = ctx.choices?.length
    ? `<table class="data"><tr><th>Choice</th><th>Target</th><th>On screen</th><th>Target exists</th><th>Sets on target</th><th>Checks on target</th></tr>
      ${ctx.choices
        .map(
          (c) => `<tr class="ov-choice-${c.status}">
          <td>${esc(c.label || c.domLabel || "—")}</td>
          <td><button type="button" class="link-btn" data-goto-pass="${escAttr(c.target)}">${esc(c.target)}</button></td>
          <td>${renderChoiceStatus(c.status)}</td>
          <td>${c.targetExists ? '<span class="tag ok">yes</span>' : '<span class="tag bad">missing</span>'}</td>
          <td>${(c.targetSets || []).map((s) => `<code>${esc(s)}</code>`).join("<br>") || "—"}</td>
          <td>${(c.targetIfs || []).map((s) => `<code>${esc(s)}</code>`).join("<br>") || "—"}</td>
        </tr>`
        )
        .join("")}</table>
      <p class="hint">Choices marked <span class="tag bad">not on screen</span> are in passage source but not rendered — usually blocked by a failing &lt;&lt;if&gt;&gt; or hidden link.</p>`
    : renderDomLinksOnly(ctx.domLinks);

  const varsHtml = ctx.variablesUsed?.length
    ? `<div class="ov-var-grid">${ctx.variablesUsed
        .map(
          (v) =>
            `<div class="ov-var-item${v.unset ? " ov-var-unset" : ""}"><span class="var-name">${esc(v.path)}</span><code>${esc(formatOverviewValue(v.value, v.unset))}</code></div>`
        )
        .join("")}</div>`
    : `<p class="empty">No $variables referenced in this passage.</p>`;

  return `
    <section class="ov-section ov-current">
      <div class="ov-passage-head">
        <h3 class="ov-passage-title">${esc(ctx.passage)}</h3>
        <div class="ov-passage-meta">${tags} ${played} <span class="hint">${ctx.textLength ?? 0} chars · ${ctx.linkCount ?? 0} links in source</span></div>
      </div>

      <h4 class="ov-section-title">Checks &amp; conditions</h4>
      <p class="hint">Evaluated against your current game state. <span class="tag ok">passes</span> / <span class="tag bad">fails</span> show whether each check would succeed right now.</p>
      ${conditionsHtml}

      <h4 class="ov-section-title">What happens here</h4>
      ${renderEffectsList(ctx.effects)}

      <h4 class="ov-section-title">Choices &amp; links</h4>
      ${choicesHtml}

      <h4 class="ov-section-title">Variables used on this passage</h4>
      ${varsHtml}

      <details class="ov-details ov-source">
        <summary>Passage source</summary>
        <pre class="passage-text ov-source-text">${esc((ctx.text || "").slice(0, 8000))}${(ctx.text || "").length > 8000 ? "\n…[truncated]" : ""}</pre>
      </details>
    </section>`;
}

function renderDomLinksOnly(domLinks) {
  if (!domLinks?.length) return `<p class="empty">No links visible in the DOM.</p>`;
  return `<table class="data"><tr><th>Label</th><th>Target</th><th>Visible</th></tr>
    ${domLinks
      .map(
        (d) => `<tr><td>${esc(d.label)}</td><td>${esc(d.target)}</td><td>${d.hidden ? '<span class="tag warn">hidden</span>' : '<span class="tag ok">visible</span>'}</td></tr>`
      )
      .join("")}</table>`;
}

function valueType(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function panelValueType(v) {
  if (v && typeof v === "object" && v.__twType === "Map" && Array.isArray(v.entries)) return "map";
  if (v && typeof v === "object" && v.__twType === "Set" && Array.isArray(v.values)) return "set";
  if (v && typeof v === "object" && v.__twType === "Function") return "function";
  if (v && typeof v === "object" && v.__twType === "undefined") return "undefined";
  if (v && typeof v === "object" && v.__twType === "BigInt") return "bigint";
  if (v && typeof v === "object" && v.__twType === "Date") return "date";
  if (v && typeof v === "object" && v.__twType === "RegExp") return "regexp";
  if (v && typeof v === "object" && v.__twType === "Symbol") return "symbol";
  if (v && typeof v === "object" && v.__twType === "Circular") return "circular";
  return valueType(v);
}

function mapEntries(obj) {
  return Array.isArray(obj?.entries) ? obj.entries : [];
}

function setValues(obj) {
  return Array.isArray(obj?.values) ? obj.values : [];
}

/** Walk serialized state data collecting editable leaves whose path or value
 *  matches the query. Depth-first, capped. */
function collectVarMatches(data, path, lq, out, cap) {
  if (out.length >= cap) return;
  const type = panelValueType(data);
  if (type === "map") {
    for (const [k, v] of mapEntries(data)) {
      collectVarMatches(v, [...path, String(k)], lq, out, cap);
      if (out.length >= cap) return;
    }
    return;
  }
  if (type === "set") {
    const vals = setValues(data);
    for (let i = 0; i < vals.length; i++) {
      collectVarMatches(vals[i], [...path, String(i)], lq, out, cap);
      if (out.length >= cap) return;
    }
    return;
  }
  if (type === "array") {
    const arr = Array.isArray(data) ? data : [];
    for (let i = 0; i < arr.length; i++) {
      collectVarMatches(arr[i], [...path, String(i)], lq, out, cap);
      if (out.length >= cap) return;
    }
    return;
  }
  if (type === "object") {
    for (const k of Object.keys(data)) {
      collectVarMatches(data[k], [...path, k], lq, out, cap);
      if (out.length >= cap) return;
    }
    return;
  }
  if (!path.length) return;
  const pathStr = path.join(".").toLowerCase();
  const isPrim = type === "string" || type === "number" || type === "boolean";
  const valStr = isPrim ? String(data).toLowerCase() : "";
  if (pathStr.includes(lq) || (valStr && valStr.includes(lq))) {
    out.push({ path, value: data, type });
  }
}

function formatSerializedPreview(obj, type) {
  if (!obj || typeof obj !== "object") return String(obj);
  switch (type) {
    case "bigint":
      return obj.value != null ? String(obj.value) : "0n";
    case "date":
      return obj.iso || "—";
    case "regexp":
      return `/${obj.source || ""}/${obj.flags || ""}`;
    case "symbol":
      return obj.description || "Symbol()";
    case "circular":
      return "[Circular]";
    default:
      return String(obj.__twType || type);
  }
}

function sortKeys(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return a.localeCompare(b);
}

function shortStatLabel(label) {
  // "attitude.friendship" → "friendship"; keep single-segment labels as-is.
  const parts = String(label).split(".");
  return parts[parts.length - 1];
}

function formatDiffPath(d) {
  const base = (d.path || []).join(".");
  if (d.key !== undefined && d.kind !== "update" && d.kind !== "type-changed") {
    return base ? `${base}.${d.key}` : String(d.key);
  }
  return base || "(root)";
}

function formatDiffBadge(d) {
  const kind = d.kind || "change";
  const cls = kind === "add" ? "ok" : kind === "remove" ? "bad" : kind === "update" ? "warn" : "";
  return `<span class="tag ${cls}">${esc(kind)}</span>`;
}

function formatDiffValues(d) {
  if (d.kind === "update" || d.kind === "type-changed") {
    return `${esc(String(d.oldValue ?? "—"))} → ${esc(String(d.newValue ?? "—"))}`;
  }
  if (d.kind === "add") return esc(String(d.newValue ?? "—"));
  if (d.kind === "remove") return esc(String(d.oldValue ?? "—"));
  if (d.oldValue !== undefined && d.newValue !== undefined) {
    return `${esc(String(d.oldValue))} → ${esc(String(d.newValue))}`;
  }
  return "—";
}

function formatCapabilitiesTooltip(cap) {
  if (!cap || !Object.keys(cap).length) return "";
  return Object.entries(cap)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

function renderAnalysisSection(title, items, rowFn, headers) {
  if (!items || !items.length) {
    return `<h4 class="ov-section-title">${esc(title)}</h4><p class="empty">None found.</p>`;
  }
  const rows = items.slice(0, 100).map(rowFn).join("");
  const more = items.length > 100 ? `<p class="hint">Showing 100 of ${items.length}.</p>` : "";
  return `<h4 class="ov-section-title">${esc(title)} (${items.length})</h4>
    <table class="data"><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>${rows}</table>${more}`;
}
