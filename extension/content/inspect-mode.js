"use strict";

import { callPage, getPageTarget } from "./bridge.js";

const OVERLAY_HOST_ID = "twine-devtools-overlay-host";
const FAB_ID = "twine-devtools-fab";
const PEEK_INTERVAL_MS = 120;

// These elements live in the page DOM, outside the overlay's shadow root, so
// overlay.css can never style them — everything must be inlined here.
const HIGHLIGHT_CSS =
  "position:fixed;display:none;pointer-events:none;z-index:2147483645;" +
  "border:2px solid #3794ff;background:rgba(55,148,255,0.15);border-radius:3px;" +
  "box-shadow:0 0 0 1px rgba(0,0,0,0.4);";
const TOOLTIP_CSS =
  "position:fixed;display:none;pointer-events:none;z-index:2147483646;max-width:340px;" +
  "padding:6px 10px;border-radius:5px;background:#1e1e1e;color:#ccc;border:1px solid #3e3e42;" +
  "box-shadow:0 4px 16px rgba(0,0,0,0.5);font:12px/1.45 'Segoe UI',system-ui,sans-serif;" +
  "white-space:normal;word-break:break-word;";

const KIND_BADGES = {
  link: { label: "Link", color: "#3794ff" },
  "inline-link": { label: "Inline link", color: "#3794ff" },
  "action-link": { label: "Action — runs code", color: "#ce9178" },
  interactive: { label: "Interactive", color: "#4ec9b0" },
  image: { label: "Image", color: "#c586c0" },
  "variable-text": { label: "Variable text", color: "#dcdcaa" },
  element: { label: "Element", color: "#858585" },
};

/** @param {{ host: HTMLElement, panel: HTMLElement, backdrop: HTMLElement, onResult: (data: unknown) => void, onCancel?: () => void }} opts */
export class GameInspector {
  constructor(opts) {
    this.host = opts.host;
    this.panel = opts.panel;
    this.backdrop = opts.backdrop;
    this.onResult = opts.onResult;
    this.onCancel = opts.onCancel || (() => {});
    this.active = false;
    this.clickHandler = null;
    this.keyHandler = null;
    this.moveHandler = null;
    this.suppressHandler = null;
    this.highlightEl = null;
    this.tooltipEl = null;
    this.peekTimer = null;
    this.lastX = 0;
    this.lastY = 0;
    this.prevCursor = "";
    this.targetIframe = null;
  }

  isActive() {
    return this.active;
  }

  start() {
    if (this.active) return;
    this.active = true;
    document.documentElement.classList.add("twine-devtools-inspect-mode");
    this.prevCursor = document.documentElement.style.cursor;
    document.documentElement.style.cursor = "crosshair";
    if (document.body) document.body.removeAttribute("inert");
    this.backdrop.style.pointerEvents = "none";
    this.host.style.pointerEvents = "none";

    this.highlightEl = document.createElement("div");
    this.highlightEl.className = "twine-devtools-inspect-highlight";
    this.highlightEl.style.cssText = HIGHLIGHT_CSS;
    document.documentElement.appendChild(this.highlightEl);

    this.tooltipEl = document.createElement("div");
    this.tooltipEl.className = "twine-devtools-inspect-tooltip";
    this.tooltipEl.style.cssText = TOOLTIP_CSS;
    document.documentElement.appendChild(this.tooltipEl);

    this.moveHandler = (e) => {
      if (!this.active) return;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      if (this.isOverlayTarget(e.target)) {
        this.hideHints();
        return;
      }
      // Instant local feedback in the top document; iframe games get their
      // highlight from the async peek (local rect would cover the whole frame).
      if (getPageTarget() === window) {
        const el = this.elementAt(e.clientX, e.clientY);
        if (el) this.positionHighlight(el.getBoundingClientRect(), 0, 0);
        else this.highlightEl.style.display = "none";
      }
      this.schedulePeek();
    };

    this.clickHandler = async (e) => {
      if (!this.active) return;
      if (this.isOverlayTarget(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const pt = this.translatePoint(e.clientX, e.clientY);
      if (!pt) return;
      if (getPageTarget() === window && !this.elementAt(e.clientX, e.clientY)) return;

      try {
        const data = await callPage("inspectGameElement", { x: pt.x, y: pt.y });
        this.stop();
        this.onResult(data);
      } catch (err) {
        this.stop();
        this.onResult({ error: err.message || String(err) });
      }
    };

    // Some games navigate or run handlers on mousedown/pointerdown — swallow
    // the whole click gesture outside the overlay while inspecting.
    this.suppressHandler = (e) => {
      if (!this.active) return;
      if (this.isOverlayTarget(e.target)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };

    this.keyHandler = (e) => {
      if (!this.active) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.stop();
        this.onCancel();
      }
    };

    document.addEventListener("mousemove", this.moveHandler, true);
    document.addEventListener("click", this.clickHandler, true);
    document.addEventListener("keydown", this.keyHandler, true);
    for (const type of ["mousedown", "mouseup", "pointerdown", "pointerup", "dblclick", "auxclick"]) {
      document.addEventListener(type, this.suppressHandler, true);
    }
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    document.documentElement.classList.remove("twine-devtools-inspect-mode");
    document.documentElement.style.cursor = this.prevCursor;
    this.backdrop.style.pointerEvents = "";
    this.host.style.pointerEvents = "";

    if (this.peekTimer) {
      clearTimeout(this.peekTimer);
      this.peekTimer = null;
    }
    if (this.highlightEl) {
      this.highlightEl.remove();
      this.highlightEl = null;
    }
    if (this.tooltipEl) {
      this.tooltipEl.remove();
      this.tooltipEl = null;
    }
    if (this.moveHandler) document.removeEventListener("mousemove", this.moveHandler, true);
    if (this.clickHandler) document.removeEventListener("click", this.clickHandler, true);
    if (this.keyHandler) document.removeEventListener("keydown", this.keyHandler, true);
    if (this.suppressHandler) {
      for (const type of ["mousedown", "mouseup", "pointerdown", "pointerup", "dblclick", "auxclick"]) {
        document.removeEventListener(type, this.suppressHandler, true);
      }
    }
    this.moveHandler = null;
    this.clickHandler = null;
    this.keyHandler = null;
    this.suppressHandler = null;
    this.targetIframe = null;

    if (document.body && this.host.isConnected) {
      document.body.setAttribute("inert", "");
    }
  }

  hideHints() {
    if (this.highlightEl) this.highlightEl.style.display = "none";
    if (this.tooltipEl) this.tooltipEl.style.display = "none";
  }

  schedulePeek() {
    if (this.peekTimer) return;
    this.peekTimer = setTimeout(() => {
      this.peekTimer = null;
      this.runPeek();
    }, PEEK_INTERVAL_MS);
  }

  async runPeek() {
    if (!this.active) return;
    const pt = this.translatePoint(this.lastX, this.lastY);
    if (!pt) {
      this.hideHints();
      return;
    }
    try {
      const res = await callPage("peekGameElement", { x: pt.x, y: pt.y });
      if (!this.active) return;
      this.renderPeek(res, pt);
    } catch {
      /* peek is best-effort — older page-api or timing races just skip the tooltip */
    }
  }

  renderPeek(res, pt) {
    if (!res || !res.found) {
      this.hideHints();
      return;
    }
    if (res.rect) {
      this.positionHighlight(res.rect, pt.dx, pt.dy);
    }

    const tip = this.tooltipEl;
    tip.textContent = "";

    const head = document.createElement("div");
    const badge = document.createElement("span");
    const kindInfo = KIND_BADGES[res.kind] || KIND_BADGES.element;
    badge.textContent = res.kind === "element" && res.tag ? `<${res.tag}>` : kindInfo.label;
    badge.style.cssText =
      `display:inline-block;margin-right:6px;padding:0 6px;border-radius:3px;font-size:10px;` +
      `font-weight:600;letter-spacing:0.02em;color:#1e1e1e;background:${kindInfo.color};`;
    head.appendChild(badge);
    const label = document.createElement("span");
    label.textContent = truncate(res.label || res.tag || "element", 90);
    head.appendChild(label);
    tip.appendChild(head);

    if (res.linkTarget) {
      const row = document.createElement("div");
      row.style.cssText = "margin-top:3px;color:#9cdcfe;";
      row.textContent = `→ ${res.linkTarget}`;
      if (res.targetExists === false) {
        const warn = document.createElement("span");
        warn.textContent = " (passage not found!)";
        warn.style.color = "#f48771";
        row.appendChild(warn);
      }
      tip.appendChild(row);
    }
    if (res.linkSetter) {
      const row = document.createElement("div");
      row.style.cssText = "margin-top:3px;color:#ce9178;font-family:Consolas,monospace;font-size:11px;";
      row.textContent = `⚡ ${truncate(res.linkSetter, 80)}`;
      tip.appendChild(row);
    }
    if (res.varCount) {
      const row = document.createElement("div");
      row.style.cssText = "margin-top:3px;color:#dcdcaa;";
      const names = (res.varRefs || []).map((v) => (v.startsWith("_") ? v : `$${v}`)).join(", ");
      row.textContent = `vars: ${names}${res.varCount > (res.varRefs || []).length ? ` +${res.varCount - res.varRefs.length} more` : ""}`;
      tip.appendChild(row);
    }
    const hint = document.createElement("div");
    hint.style.cssText = "margin-top:3px;color:#858585;font-size:10px;";
    hint.textContent = "click for details · Esc cancels";
    tip.appendChild(hint);

    tip.style.display = "block";
    this.positionTooltip();
  }

  positionHighlight(rect, dx, dy) {
    if (!this.highlightEl) return;
    Object.assign(this.highlightEl.style, {
      display: "block",
      left: `${rect.left + dx - 2}px`,
      top: `${rect.top + dy - 2}px`,
      width: `${rect.width + 4}px`,
      height: `${rect.height + 4}px`,
    });
  }

  positionTooltip() {
    const tip = this.tooltipEl;
    if (!tip) return;
    const margin = 8;
    let x = this.lastX + 14;
    let y = this.lastY + 18;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    if (x + w > window.innerWidth - margin) x = Math.max(margin, this.lastX - w - 14);
    if (y + h > window.innerHeight - margin) y = Math.max(margin, this.lastY - h - 14);
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  }

  /**
   * Map top-window client coordinates into the coordinate space of the page
   * target (a same-origin game iframe when the overlay is attached to one).
   * Returns null when the point is outside the target frame.
   */
  translatePoint(x, y) {
    const target = getPageTarget();
    if (!target || target === window) return { x, y, dx: 0, dy: 0 };
    const iframe = this.findTargetIframe(target);
    if (!iframe) return null;
    const r = iframe.getBoundingClientRect();
    const ix = x - r.left - iframe.clientLeft;
    const iy = y - r.top - iframe.clientTop;
    if (ix < 0 || iy < 0 || ix > iframe.clientWidth || iy > iframe.clientHeight) return null;
    return { x: ix, y: iy, dx: r.left + iframe.clientLeft, dy: r.top + iframe.clientTop };
  }

  findTargetIframe(targetWin) {
    if (this.targetIframe && this.targetIframe.isConnected && this.targetIframe.contentWindow === targetWin) {
      return this.targetIframe;
    }
    this.targetIframe = null;
    for (const frame of document.querySelectorAll("iframe")) {
      if (frame.contentWindow === targetWin) {
        this.targetIframe = frame;
        break;
      }
    }
    return this.targetIframe;
  }

  isOverlayTarget(target) {
    if (!target) return false;
    const host = this.host;
    return target === host || target === this.panel || host.contains(target);
  }

  elementAt(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    if (el.id === OVERLAY_HOST_ID || (el.closest && el.closest(`#${OVERLAY_HOST_ID}`))) return null;
    if (el.id === FAB_ID || (el.closest && el.closest(`#${FAB_ID}`))) return null;
    if (el === document.documentElement || el === document.body) return null;
    return el;
  }
}

function truncate(s, max) {
  s = String(s);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
