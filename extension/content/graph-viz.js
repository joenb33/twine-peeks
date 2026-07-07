"use strict";

const NODE_CATEGORY_COLORS = {
  navigation: "#d4a017",
  time: "#9b59b6",
  event: "#e67e22",
  dialogue: "#3498db",
  widget: "#1abc9c",
  util: "#7f8c8d",
  display: "#95a5a6",
  "location-meta": "#16a085",
  other: "#333",
};

const EDGE_STYLES = {
  static: { stroke: "#555", width: 1, dash: "" },
  include: { stroke: "#9b59b6", width: 1, dash: "2 3" },
  tag: { stroke: "#d4a017", width: 1.5, dash: "4 4" },
  "dom-live": { stroke: "#3794ff", width: 2, dash: "6 4" },
  "dom-inline": { stroke: "#4ec9b0", width: 1.5, dash: "3 3" },
};

const EDGE_LEGEND = [
  { label: "Static link", ...EDGE_STYLES.static },
  { label: "Include", ...EDGE_STYLES.include },
  { label: "Tag hint", ...EDGE_STYLES.tag },
  { label: "Live DOM", ...EDGE_STYLES["dom-live"] },
  { label: "Inline DOM", ...EDGE_STYLES["dom-inline"] },
];

function edgeStyleKey(type) {
  if (type === "dom-live" || type === "dom-inline" || type === "include") return type;
  if (type && type.indexOf("tag-") === 0) return "tag";
  return "static";
}

/**
 * Render the story graph. Returns { cleanup, matchCount }.
 * @param {HTMLElement} container
 */
export function renderStoryGraph(container, graph, options = {}) {
  const {
    center = null,
    onNodeClick = null,
    focusCenter = true,
    highlightQuery = "",
    startPassage = null,
  } = options;
  const nodes = graph.nodes || [];
  const edges = graph.edges || [];
  container.innerHTML = "";

  if (!nodes.length) {
    container.innerHTML = "<p class='empty'>No graph data.</p>";
    return { cleanup: () => {}, matchCount: 0 };
  }

  // Degrees: prefer server-provided, else compute from edges.
  const degree = {};
  if (nodes[0] && typeof nodes[0].degree === "number") {
    for (const n of nodes) degree[n.id] = n.degree;
  } else {
    for (const e of edges) {
      degree[e.from] = (degree[e.from] || 0) + 1;
      degree[e.to] = (degree[e.to] || 0) + 1;
    }
  }

  const isLarge = nodes.length > 120;
  const isHuge = nodes.length > 600 || edges.length > 1200;
  const width = Math.max(container.clientWidth || 700, 400);
  const height = estimateGraphHeight(nodes.length, width);
  const positions = layoutGraph(nodes, edges, center, degree, width, height, startPassage || graph.startPassage);
  const bounds = computeBounds(positions, nodes);
  const padding = 48;
  const initialViewBox = {
    x: bounds.minX - padding,
    y: bounds.minY - padding,
    w: bounds.maxX - bounds.minX + padding * 2,
    h: bounds.maxY - bounds.minY + padding * 2,
  };

  const showAllLabels = nodes.length <= 80;
  // On big maps, label only the hubs — that is what you navigate by.
  let labelSet = null;
  if (!showAllLabels) {
    labelSet = new Set(
      [...nodes]
        .sort((a, b) => (degree[b.id] || 0) - (degree[a.id] || 0))
        .slice(0, 40)
        .map((n) => n.id)
    );
    if (center) labelSet.add(center);
  }

  const baseRadius = nodes.length > 120 ? 5 : nodes.length > 60 ? 8 : 10;
  const nodeRadius = (n) => {
    if (n.id === center) return baseRadius + 4;
    if (!isLarge) return baseRadius;
    const d = degree[n.id] || 0;
    return Math.min(baseRadius + 7, baseRadius + Math.sqrt(d) * 0.9);
  };

  const root = document.createElement("div");
  root.className = "graph-viewport-root";

  const controls = document.createElement("div");
  controls.className = "graph-controls";
  controls.innerHTML = `
    <button type="button" class="btn graph-zoom-btn" data-action="in" title="Zoom in">+</button>
    <button type="button" class="btn graph-zoom-btn" data-action="out" title="Zoom out">−</button>
    <button type="button" class="btn graph-zoom-btn" data-action="fit" title="Fit all">Fit</button>
    <span class="hint graph-controls-hint">${nodes.length} nodes · ${edges.length} edges · Drag to pan · Scroll to zoom${showAllLabels ? "" : " · Labels = top hubs, hover for names"}</span>`;

  const legend = document.createElement("div");
  legend.className = "graph-legend";
  legend.innerHTML = `
    <span class="graph-legend-title">Edges:</span>
    ${EDGE_LEGEND.map(
      (e) =>
        `<span class="graph-legend-item"><svg width="28" height="10" aria-hidden="true"><line x1="0" y1="5" x2="28" y2="5" stroke="${e.stroke}" stroke-width="2"${e.dash ? ` stroke-dasharray="${e.dash}"` : ""}/></svg> ${e.label}</span>`
    ).join("")}
    <span class="graph-legend-title">Nodes:</span>
    ${Object.entries(NODE_CATEGORY_COLORS)
      .filter(([k]) => k !== "other")
      .map(
        ([cat, color]) =>
          `<span class="graph-legend-item"><svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill="${color}"/></svg> ${cat}</span>`
      )
      .join("")}`;

  const viewport = document.createElement("div");
  viewport.className = "graph-viewport";
  viewport.style.height = `${Math.min(height, Math.max(320, window.innerHeight * 0.55))}px`;
  viewport.tabIndex = 0;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "graph-svg");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");

  const viewBox = { ...initialViewBox };
  const applyViewBox = () => {
    svg.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
  };
  applyViewBox();

  const panState = { active: false, didPan: false, lastX: 0, lastY: 0 };

  // Arrowheads are expensive with thousands of edges — skip them on huge maps.
  if (!isHuge) {
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
    marker.setAttribute("id", "twine-graph-arrow");
    marker.setAttribute("markerWidth", "8");
    marker.setAttribute("markerHeight", "8");
    marker.setAttribute("refX", "6");
    marker.setAttribute("refY", "3");
    marker.setAttribute("orient", "auto");
    const markerPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    markerPath.setAttribute("d", "M0,0 L0,6 L6,3 z");
    markerPath.setAttribute("fill", "#666");
    marker.appendChild(markerPath);
    defs.appendChild(marker);
    svg.appendChild(defs);
  }

  const content = document.createElementNS("http://www.w3.org/2000/svg", "g");
  content.setAttribute("class", "graph-content");

  const edgeLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
  if (isHuge) {
    // Batch edges into one <path> per visual style — a handful of DOM nodes
    // instead of thousands keeps pan/zoom smooth on 5000+ passage stories.
    const pathData = { static: "", include: "", tag: "", "dom-live": "", "dom-inline": "" };
    for (const e of edges) {
      const a = positions[e.from];
      const b = positions[e.to];
      if (!a || !b) continue;
      pathData[edgeStyleKey(e.type)] += `M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    }
    for (const key of Object.keys(pathData)) {
      if (!pathData[key]) continue;
      const style = EDGE_STYLES[key];
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", pathData[key]);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", style.stroke);
      path.setAttribute("stroke-width", key === "static" ? "0.6" : String(style.width));
      path.setAttribute("stroke-opacity", key === "static" ? "0.55" : "0.9");
      if (style.dash) path.setAttribute("stroke-dasharray", style.dash);
      edgeLayer.appendChild(path);
    }
  } else {
    for (const e of edges) {
      const a = positions[e.from];
      const b = positions[e.to];
      if (!a || !b) continue;
      const styleKey = edgeStyleKey(e.type);
      const style = EDGE_STYLES[styleKey];
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", String(a.x));
      line.setAttribute("y1", String(a.y));
      line.setAttribute("x2", String(b.x));
      line.setAttribute("y2", String(b.y));
      line.setAttribute("stroke", style.stroke);
      line.setAttribute("stroke-width", styleKey === "static" && nodes.length > 100 ? "0.75" : String(style.width));
      if (style.dash) line.setAttribute("stroke-dasharray", style.dash);
      line.setAttribute("marker-end", "url(#twine-graph-arrow)");
      if (styleKey !== "static") {
        const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
        title.textContent = `${e.type}: ${e.label || e.to}`;
        line.appendChild(title);
      }
      edgeLayer.appendChild(line);
    }
  }
  content.appendChild(edgeLayer);

  const lq = String(highlightQuery || "").trim().toLowerCase();
  const matches = [];

  const nodeLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
  for (const n of nodes) {
    const pos = positions[n.id];
    if (!pos) continue;
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", "graph-node");
    g.style.cursor = onNodeClick ? "pointer" : "default";

    const isCenter = n.id === center;
    const isMatch = lq && n.id.toLowerCase().includes(lq);
    if (isMatch) matches.push(n.id);
    const category = n.primaryCategory || (n.isLocationHub ? "navigation" : "other");
    const fillColor = n.missing ? "#5a1d1d" : isCenter ? "#0e639c" : NODE_CATEGORY_COLORS[category] || NODE_CATEGORY_COLORS.other;
    const r = nodeRadius(n);
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", String(pos.x));
    circle.setAttribute("cy", String(pos.y));
    circle.setAttribute("r", String(r));
    circle.setAttribute("fill", fillColor);
    circle.setAttribute("stroke", isMatch ? "#ffd700" : isCenter ? "#3794ff" : n.isLocationHub ? "#d4a017" : "#666");
    circle.setAttribute("stroke-width", isMatch ? "3" : isCenter || n.isLocationHub ? "2" : "1");

    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    const tagList = (n.tags || []).slice(0, 8).join(", ");
    title.textContent =
      n.id +
      (tagList ? `\nTags: ${tagList}` : "") +
      (category ? `\nCategory: ${category}` : "") +
      (degree[n.id] ? `\nLinks: ${degree[n.id]}` : "");
    g.appendChild(title);
    g.appendChild(circle);

    if (showAllLabels || (labelSet && labelSet.has(n.id)) || isMatch) {
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("x", String(pos.x));
      label.setAttribute("y", String(pos.y + r + 11));
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("fill", isMatch ? "#ffd700" : "#ccc");
      label.setAttribute("font-size", nodes.length > 40 ? "8" : "9");
      label.textContent = truncate(n.id, nodes.length > 40 ? 16 : 20);
      g.appendChild(label);
    }

    if (onNodeClick) {
      g.addEventListener("click", (ev) => {
        if (panState.didPan) {
          ev.stopPropagation();
          return;
        }
        onNodeClick(n.id);
      });
    }
    nodeLayer.appendChild(g);
  }
  content.appendChild(nodeLayer);
  svg.appendChild(content);

  viewport.appendChild(svg);
  root.append(controls, legend, viewport);
  container.appendChild(root);

  const clientToSvg = (clientX, clientY) => {
    const rect = svg.getBoundingClientRect();
    const nx = (clientX - rect.left) / rect.width;
    const ny = (clientY - rect.top) / rect.height;
    return {
      x: viewBox.x + nx * viewBox.w,
      y: viewBox.y + ny * viewBox.h,
    };
  };

  const zoomAt = (clientX, clientY, factor) => {
    const pt = clientToSvg(clientX, clientY);
    const newW = Math.max(initialViewBox.w * 0.02, Math.min(initialViewBox.w * 8, viewBox.w * factor));
    const newH = Math.max(initialViewBox.h * 0.02, Math.min(initialViewBox.h * 8, viewBox.h * factor));
    const ratioX = (pt.x - viewBox.x) / viewBox.w;
    const ratioY = (pt.y - viewBox.y) / viewBox.h;
    viewBox.x = pt.x - ratioX * newW;
    viewBox.y = pt.y - ratioY * newH;
    viewBox.w = newW;
    viewBox.h = newH;
    applyViewBox();
  };

  const panByPixels = (dx, dy) => {
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    viewBox.x -= (dx / rect.width) * viewBox.w;
    viewBox.y -= (dy / rect.height) * viewBox.h;
    applyViewBox();
  };

  viewport.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
      zoomAt(e.clientX, e.clientY, factor);
    },
    { passive: false }
  );

  viewport.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    panState.active = true;
    panState.didPan = false;
    panState.lastX = e.clientX;
    panState.lastY = e.clientY;
    viewport.classList.add("graph-panning");
    e.preventDefault();
  });

  const onPointerMove = (e) => {
    if (!panState.active) return;
    const dx = e.clientX - panState.lastX;
    const dy = e.clientY - panState.lastY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) panState.didPan = true;
    panState.lastX = e.clientX;
    panState.lastY = e.clientY;
    panByPixels(dx, dy);
  };

  const endPan = () => {
    if (!panState.active) return;
    panState.active = false;
    viewport.classList.remove("graph-panning");
    setTimeout(() => {
      panState.didPan = false;
    }, 0);
  };

  window.addEventListener("mousemove", onPointerMove);
  window.addEventListener("mouseup", endPan);

  controls.querySelector('[data-action="in"]')?.addEventListener("click", () => {
    const rect = svg.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1 / 1.25);
  });
  controls.querySelector('[data-action="out"]')?.addEventListener("click", () => {
    const rect = svg.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1.25);
  });
  controls.querySelector('[data-action="fit"]')?.addEventListener("click", () => {
    Object.assign(viewBox, initialViewBox);
    applyViewBox();
  });

  const focusOn = (id) => {
    const p = positions[id];
    if (!p) return;
    // Zoom to a readable, label-scale region around the node (world units),
    // never wider than the fit-all view.
    const w = Math.min(initialViewBox.w, 900);
    const h = Math.min(initialViewBox.h, w * (initialViewBox.h / initialViewBox.w));
    Object.assign(viewBox, { x: p.x - w / 2, y: p.y - h / 2, w, h });
    applyViewBox();
  };

  if (matches.length) {
    focusOn(matches[0]);
  } else if (focusCenter && center && positions[center] && nodes.length > 30) {
    focusOn(center);
  }

  const cleanup = () => {
    window.removeEventListener("mousemove", onPointerMove);
    window.removeEventListener("mouseup", endPan);
  };
  return { cleanup, matchCount: matches.length };
}

function estimateGraphHeight(nodeCount, width) {
  const base = Math.max(Math.min(window.innerHeight * 0.45, 520), 320);
  if (nodeCount <= 40) return base;
  const cols = Math.ceil(Math.sqrt(nodeCount * 1.4));
  const rows = Math.ceil(nodeCount / cols);
  const gridHeight = rows * 44 + 80;
  return Math.min(Math.max(base, gridHeight), 900);
}

function computeBounds(positions, nodes) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    const p = positions[n.id];
    if (!p) continue;
    minX = Math.min(minX, p.x - 16);
    maxX = Math.max(maxX, p.x + 16);
    minY = Math.min(minY, p.y - 16);
    maxY = Math.max(maxY, p.y + 28);
  }
  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 400, maxY: 300 };
  }
  return { minX, minY, maxX, maxY };
}

function layoutGraph(nodes, edges, center, degree, width, height, startPassage) {
  const ids = nodes.map((n) => n.id);
  const idSet = new Set(ids);

  // Small graph with no meaningful structure — simple circle reads fine.
  if (!center && ids.length <= 35 && edges.length < ids.length) {
    return layoutCircle(ids, width, height);
  }

  // Pick a BFS root: explicit center → start passage → best-connected node.
  let root = center && idSet.has(center) ? center : null;
  if (!root && startPassage && idSet.has(startPassage)) root = startPassage;
  if (!root) {
    let best = null;
    let bestDeg = -1;
    for (const id of ids) {
      const d = degree[id] || 0;
      if (d > bestDeg) {
        bestDeg = d;
        best = id;
      }
    }
    root = best;
  }
  if (!root) return layoutGrid(ids, width, height);

  return layoutRadialBfs(ids, edges, root, width, height);
}

/**
 * BFS ring layout: rings by link-distance from the root, each ring ordered by
 * the angle of its parent in the previous ring (barycentric ordering) so
 * related branches stay together and edge crossings drop dramatically.
 * Disconnected passages go into a grid block beside the rings.
 */
function layoutRadialBfs(ids, edges, root, width, height) {
  const positions = {};
  const adj = {};
  for (const e of edges) {
    if (!adj[e.from]) adj[e.from] = [];
    adj[e.from].push(e.to);
    // Treat edges as undirected for layout so back-linked areas cluster too.
    if (!adj[e.to]) adj[e.to] = [];
    adj[e.to].push(e.from);
  }

  const depth = {};
  const parent = {};
  depth[root] = 0;
  const queue = [root];
  let qi = 0;
  const idSet = new Set(ids);
  while (qi < queue.length) {
    const cur = queue[qi++];
    for (const n of adj[cur] || []) {
      if (depth[n] == null && idSet.has(n)) {
        depth[n] = depth[cur] + 1;
        parent[n] = cur;
        queue.push(n);
      }
    }
  }

  const byDepth = {};
  const leftovers = [];
  for (const id of ids) {
    if (depth[id] == null) {
      if (id !== root) leftovers.push(id);
      continue;
    }
    if (depth[id] === 0) continue;
    (byDepth[depth[id]] ||= []).push(id);
  }

  const cx = 0;
  const cy = 0;
  positions[root] = { x: cx, y: cy };
  const angleOf = { [root]: 0 };

  const ringDepths = Object.keys(byDepth)
    .map(Number)
    .sort((a, b) => a - b);
  let maxR = 0;
  for (const d of ringDepths) {
    const ring = byDepth[d];
    // Order by parent angle so subtrees stay in the same sector.
    ring.sort((a, b) => {
      const pa = angleOf[parent[a]] ?? 0;
      const pb = angleOf[parent[b]] ?? 0;
      if (pa !== pb) return pa - pb;
      return a.localeCompare(b);
    });
    const minArc = 26;
    const r = Math.max(80 + (d - 1) * 95, (ring.length * minArc) / (2 * Math.PI) + 60);
    maxR = Math.max(maxR, r);
    ring.forEach((id, i) => {
      const angle = (2 * Math.PI * i) / ring.length - Math.PI / 2;
      angleOf[id] = angle;
      positions[id] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    });
  }

  // Disconnected passages: grid block to the right of the rings.
  if (leftovers.length) {
    leftovers.sort((a, b) => a.localeCompare(b));
    const cols = Math.max(4, Math.ceil(Math.sqrt(leftovers.length)));
    const cellW = 100;
    const cellH = 38;
    const ox = cx + maxR + 160;
    const oy = cy - ((Math.ceil(leftovers.length / cols) - 1) * cellH) / 2;
    leftovers.forEach((id, i) => {
      positions[id] = {
        x: ox + (i % cols) * cellW,
        y: oy + Math.floor(i / cols) * cellH,
      };
    });
  }
  return positions;
}

function layoutGrid(ids, width, height) {
  const positions = {};
  const sorted = [...ids].sort((a, b) => a.localeCompare(b));
  const cols = Math.ceil(Math.sqrt(sorted.length * 1.4));
  const cellW = 108;
  const cellH = 40;
  const gridW = cols * cellW;
  const rows = Math.ceil(sorted.length / cols);
  const gridH = rows * cellH;
  const ox = Math.max(cellW / 2, (width - gridW) / 2 + cellW / 2);
  const oy = Math.max(cellH / 2, (height - gridH) / 2 + cellH / 2);

  sorted.forEach((id, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    positions[id] = { x: ox + col * cellW, y: oy + row * cellH };
  });
  return positions;
}

function layoutCircle(ids, width, height) {
  const positions = {};
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) * 0.42;
  ids.forEach((id, i) => {
    const angle = (2 * Math.PI * i) / ids.length - Math.PI / 2;
    positions[id] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });
  return positions;
}

function truncate(s, n) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
