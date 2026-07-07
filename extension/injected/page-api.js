(function () {
  "use strict";

  var MSG = "twine-devtools";
  var OVERLAY_HOST_ID = "twine-devtools-overlay-host";
  var overlayKeyboardBlock = false;

  function eventFromOverlayHost(ev) {
    var path = ev.composedPath ? ev.composedPath() : [];
    for (var i = 0; i < path.length; i++) {
      if (path[i] && path[i].id === OVERLAY_HOST_ID) return true;
    }
    return false;
  }

  function onOverlayKeyEvent(ev) {
    if (!overlayKeyboardBlock) return;
    if (eventFromOverlayHost(ev)) return;
    ev.stopImmediatePropagation();
    ev.preventDefault();
  }

  document.addEventListener("keydown", onOverlayKeyEvent, true);
  document.addEventListener("keyup", onOverlayKeyEvent, true);
  document.addEventListener("keypress", onOverlayKeyEvent, true);

  function setOverlayKeyboardBlock(args) {
    overlayKeyboardBlock = !!(args && args.active);
    return { ok: true, active: overlayKeyboardBlock };
  }

  var AD = window.TwineDevToolsAdapters;
  var HL_CLASS = "twine-devtools-highlight-box";
  var activeEngine = null;
  var activeCapabilities = null;

  function getFormatMeta() {
    var fmt = document.querySelector('meta[name="twine-story-format"]');
    var ver = document.querySelector('meta[name="twine-story-format-version"]');
    return {
      name: fmt ? fmt.content : null,
      version: ver ? ver.content : null,
    };
  }

  function getSugarCube() {
    return window.SugarCube || null;
  }

  // Local fallback cache — normally adapters.js (AD) provides the cached parse.
  var _sdCache = null;
  var _sdIndex = null;

  function parseStorydataPassages() {
    if (AD && AD.parseStorydataPassages) return AD.parseStorydataPassages();
    if (!_sdCache) {
      var nodes = document.querySelectorAll("tw-passagedata");
      _sdCache = [];
      _sdIndex = {};
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        var p = {
          name: n.getAttribute("name") || "",
          tags: (n.getAttribute("tags") || "").split(/\s+/).filter(Boolean),
          text: n.textContent || "",
        };
        _sdCache.push(p);
        _sdIndex[p.name] = p;
      }
    }
    return _sdCache;
  }

  function getStorydataPassageByName(name) {
    if (AD && AD.getStorydataPassage) return AD.getStorydataPassage(name);
    parseStorydataPassages();
    return (_sdIndex && _sdIndex[name]) || null;
  }

  function invalidatePassageCaches() {
    _sdCache = null;
    _sdIndex = null;
    if (AD && AD.invalidatePassageCache) AD.invalidatePassageCache();
  }

  function detectEngine() {
    if (!AD) {
      activeEngine = detectSugarCubeLegacy() || detectChapbookLegacy() || detectHarloweLegacy() || detectSnowmanLegacy();
      return activeEngine;
    }
    var hit = AD.detect();
    if (!hit) {
      activeEngine = null;
      activeCapabilities = null;
      return null;
    }
    activeCapabilities = hit.capabilities;
    activeEngine = {
      profile: hit.profile,
      variables: hit.variables,
      capabilities: hit.capabilities,
    };
    return activeEngine;
  }

  function getAdapter() {
    detectEngine();
    return AD ? AD.getActive() : null;
  }

  function detectSugarCubeLegacy() {
    var profiles = [
      { id: "SugarCube2", label: "SugarCube 2.x", family: "sugarcube", variablesExpr: "SugarCube.State.active.variables" },
      { id: "SugarCube1", label: "SugarCube 1.x", family: "sugarcube", variablesExpr: "SugarCube.state.active.variables" },
      { id: "V-shorthand", label: "V shorthand", family: "sugarcube", variablesExpr: "V" },
    ];
    for (var i = 0; i < profiles.length; i++) {
      try {
        var vars = eval(profiles[i].variablesExpr);
        if (vars && typeof vars === "object") {
          return { profile: profiles[i], variables: vars };
        }
      } catch (e) { /* next */ }
    }
    return null;
  }

  function collectChapbookVarNames() {
    var names = {};
    var passages = parseStorydataPassages();
    for (var i = 0; i < passages.length; i++) {
      var text = passages[i].text;
      var sep = text.indexOf("\n--\n");
      if (sep === -1) sep = text.indexOf("\r\n--\r\n");
      var head = sep >= 0 ? text.slice(0, sep) : "";
      var lines = head.split(/\r?\n/);
      for (var j = 0; j < lines.length; j++) {
        var m = lines[j].match(/^([A-Za-z_$][\w$]*)\s*:/);
        if (m) names[m[1]] = true;
      }
    }
    return Object.keys(names);
  }

  function detectChapbookLegacy() {
    if (!window.engine || !engine.state || typeof engine.state.get !== "function") return null;
    var data = {};
    var names = collectChapbookVarNames();
    for (var i = 0; i < names.length; i++) {
      try { data[names[i]] = engine.state.get(names[i]); } catch (e) { data[names[i]] = "[error]"; }
    }
    return {
      profile: { id: "Chapbook", label: "Chapbook", family: "chapbook" },
      variables: data,
    };
  }

  function detectHarloweLegacy() {
    var fmt = getFormatMeta();
    if (!fmt.name || fmt.name.toLowerCase().indexOf("harlowe") === -1) return null;

    var data = {};
    var exprs = document.querySelectorAll('tw-expression[type="variable"]');
    for (var i = 0; i < exprs.length; i++) {
      var name = exprs[i].getAttribute("name");
      if (name) data[name] = exprs[i].textContent.trim();
    }
    var passages = parseStorydataPassages();
    for (var p = 0; p < passages.length; p++) {
      var re = /\(set:\s*\$([A-Za-z_][\w]*)/g;
      var m;
      while ((m = re.exec(passages[p].text)) !== null) {
        if (data[m[1]] === undefined) data[m[1]] = "(not rendered)";
      }
    }
    if (!Object.keys(data).length) return null;
    return {
      profile: { id: "Harlowe", label: fmt.name || "Harlowe", family: "harlowe" },
      variables: data,
    };
  }

  function detectSnowmanLegacy() {
    if (window.story && story.state && typeof story.state === "object") {
      return {
        profile: { id: "Snowman", label: "Snowman", family: "snowman" },
        variables: story.state,
      };
    }
    if (window.state && state.variables && typeof state.variables === "object") {
      return {
        profile: { id: "Snowman", label: "Snowman", family: "snowman" },
        variables: state.variables,
      };
    }
    return null;
  }

  function getStoryApi(S) {
    if (S.Story) return S.Story;
    if (S.tale) return S.tale;
    return null;
  }

  function getState(S) {
    if (S.State) return S.State;
    if (S.state) return S.state;
    return null;
  }

  function readMeta() {
    var adapter = getAdapter();
    if (adapter && typeof adapter.getMeta === "function") {
      var meta = adapter.getMeta();
      if (meta) {
        meta.capabilities = activeCapabilities || adapter.capabilities;
        return meta;
      }
    }
    var fmt = getFormatMeta();
    var detected = detectEngine();
    if (!detected) return null;

    if (detected.profile.family === "chapbook") {
      return {
        engine: "Chapbook",
        format: fmt.name,
        version: fmt.version || "unknown",
        storyTitle: document.querySelector("tw-story") && document.querySelector("tw-story").getAttribute("name") || document.title,
        passage: engine.state && engine.state.get ? engine.state.get("trail") : null,
        passageCount: parseStorydataPassages().length,
        hasSetup: false,
      };
    }

    if (detected.profile.family === "harlowe") {
      var cur = document.querySelector("tw-passage");
      return {
        engine: fmt.name || "Harlowe",
        format: fmt.name,
        version: fmt.version || "unknown",
        storyTitle: document.querySelector("tw-story") && document.querySelector("tw-story").getAttribute("name") || document.title,
        passage: cur ? cur.getAttribute("name") : null,
        passageCount: parseStorydataPassages().length,
        hasSetup: false,
      };
    }

    if (detected.profile.family === "snowman") {
      return {
        engine: "Snowman",
        format: fmt.name,
        version: fmt.version || "unknown",
        storyTitle: document.title,
        passage: window.state && state.passage,
        passageCount: parseStorydataPassages().length,
        hasSetup: false,
      };
    }

    var S = getSugarCube();
    if (!S) return null;
    var st = getState(S);
    var Story = getStoryApi(S);
    var passageCount = 0;
    if (Story) {
      if (typeof Story.size === "number") passageCount = Story.size;
      else if (Story.entries) passageCount = Object.keys(Story.entries).length;
    }
    if (!passageCount) {
      var counted = 0;
      iteratePassages(function () { counted++; });
      if (counted) passageCount = counted;
    }
    var extra = {};
    try {
      if (S.Story && S.Story.name) extra.storyName = S.Story.name;
      if (S.Config && S.Config.saves) extra.maxSlotSaves = S.Config.saves.maxSlotSaves;
      if (st && st.passage && S.State && S.State.hasPlayed) {
        extra.hasPlayedCurrent = S.State.hasPlayed(st.passage);
      }
    } catch (e) { /* ignore */ }

    var scVer = null;
    try {
      if (S.version && typeof S.version.short === "function") scVer = String(S.version.short());
      else if (S.version && typeof S.version.major === "number") scVer = (S.version.title || "SugarCube") + " v" + S.version.major + "." + (S.version.minor || 0) + "." + (S.version.patch || 0);
      else scVer = S.version && S.version.title ? S.version.title : S.version;
    } catch (e) { scVer = null; }

    return Object.assign({
      engine: S.State ? "SugarCube 2.x" : "SugarCube 1.x",
      format: fmt.name || "SugarCube",
      version: scVer || fmt.version || "unknown",
      storyTitle: Story && (Story.name || Story.title) ? (Story.name || Story.title) : document.title,
      passage: st ? st.passage : null,
      turn: st ? st.turns : null,
      historyDepth: S.History ? S.History.length : null,
      passageCount: passageCount,
      hasSetup: !!S.setup,
      hasSave: !!(S.Save && S.Save.browser),
    }, extra);
  }

  function iteratePassages(fn) {
    var S = getSugarCube();
    var Story = S ? getStoryApi(S) : null;
    if (Story) {
      if (typeof Story.forEach === "function") {
        Story.forEach(fn);
        return;
      }
      if (Story.entries) {
        Object.keys(Story.entries).forEach(function (k) {
          fn(Story.entries[k], k);
        });
        return;
      }
    }
    var storydata = parseStorydataPassages();
    for (var i = 0; i < storydata.length; i++) {
      fn({ name: storydata[i].name, title: storydata[i].name, tags: storydata[i].tags, text: storydata[i].text }, storydata[i].name);
    }
  }

  function passageName(p) {
    return p.name || p.title || String(p);
  }

  function getPassage(name) {
    var S = getSugarCube();
    var Story = S ? getStoryApi(S) : null;
    if (Story) {
      try {
        if (typeof Story.has === "function" && !Story.has(name)) {
          Story = null; // fall through to storydata index without throwing
        } else if (typeof Story.get === "function") {
          var p = Story.get(name);
          if (p && (p.name || p.title || p.text !== undefined)) return p;
        } else if (Story.entries && Story.entries[name]) {
          return Story.entries[name];
        }
      } catch (e) { /* Story.get can throw on missing passages */ }
    }
    var sd = getStorydataPassageByName(name);
    if (sd) {
      return { name: sd.name, title: sd.name, tags: sd.tags, text: sd.text };
    }
    return null;
  }

  // Resolve the parser once and reuse it in loops — getAdapter() per passage
  // was a major slowdown on large stories.
  function resolveParseLinksFn() {
    var adapter = getAdapter();
    if (adapter && adapter.parseLinks) return adapter.parseLinks.bind(adapter);
    if (AD) return function (t) { return AD.parseAllFormatLinks(t); };
    return function (t) { return parseWikiLinks(t).concat(parseMacroLinks(t)); };
  }

  function parsePassageLinks(text) {
    return resolveParseLinksFn()(text);
  }

  var TAG_CATEGORY_RULES = [
    {
      id: "navigation",
      label: "Navigation / location",
      test: function (t) {
        return (
          t === "location" ||
          t === "hasmap" ||
          /^closedgoto/i.test(t) ||
          /^goto[A-Za-z0-9_-]+$/i.test(t) ||
          /^locblock/i.test(t) ||
          /^loc[A-Za-z0-9]/i.test(t) ||
          /^(campuswalk|townwalk|street|shop)$/i.test(t)
        );
      },
    },
    {
      id: "time",
      label: "Time / schedule",
      test: function (t) {
        return /^openhour\d+/i.test(t) || /^closehour\d+/i.test(t) || /^openhour$/i.test(t) || /^closehour$/i.test(t);
      },
    },
    {
      id: "event",
      label: "Events",
      test: function (t) {
        return t === "event" || t === "noevents" || t === "midencounter" || t === "postencounter" || t === "endsneak";
      },
    },
    {
      id: "dialogue",
      label: "Dialogue",
      test: function (t) {
        return t === "dialogue" || t === "dialog";
      },
    },
    {
      id: "widget",
      label: "Widget / macro defs",
      test: function (t) {
        return t === "widget";
      },
    },
    {
      id: "util",
      label: "Utility",
      test: function (t) {
        return t === "util" || t === "help" || t === "exam" || t === "chargen" || t === "bypassnavoverride";
      },
    },
    {
      id: "display",
      label: "Display",
      test: function (t) {
        return t === "nobr" || t === "suppressemoji" || t === "noclothingfix";
      },
    },
    {
      id: "location-meta",
      label: "Location metadata",
      test: function (t) {
        return /^dc[A-Z]/.test(t) || /^roomtype/i.test(t) || /^(indoors|outdoors|shower|formalwear|swimwear|greekhouse)$/i.test(t);
      },
    },
  ];

  function classifyPassageTag(tag) {
    var t = String(tag);
    var categories = [];
    TAG_CATEGORY_RULES.forEach(function (rule) {
      if (rule.test(t)) categories.push(rule.id);
    });
    return {
      tag: t,
      categories: categories.length ? categories : ["other"],
      primaryCategory: categories.length ? categories[0] : "other",
    };
  }

  function classifyPassageTags(tags) {
    var classified = (tags || []).map(classifyPassageTag);
    var categorySet = {};
    classified.forEach(function (c) {
      c.categories.forEach(function (cat) {
        categorySet[cat] = true;
      });
    });
    var categories = Object.keys(categorySet);
    var primaryCategory = "other";
    var priority = ["navigation", "widget", "event", "dialogue", "time", "util", "display", "location-meta", "other"];
    for (var i = 0; i < priority.length; i++) {
      if (categorySet[priority[i]]) {
        primaryCategory = priority[i];
        break;
      }
    }
    return {
      tags: classified,
      categories: categories,
      primaryCategory: primaryCategory,
    };
  }

  function categorizeSetupKey(key) {
    var kl = String(key).toLowerCase();
    if (/people|person|character|npc|name|relationship/.test(kl)) return "characters";
    if (/map|location|room|place|travel|weather|time|schedule|event/.test(kl)) return "world";
    if (/clothes|wear|outfit|cosmetic|hair|piercing/.test(kl)) return "appearance";
    if (/skill|trait|need|inclination|archetype/.test(kl)) return "stats";
    if (/dialog|chat|phone|message|stream/.test(kl)) return "communication";
    if (/shop|business|money|inventory|item|gift|dorm/.test(kl)) return "economy";
    if (/school|sport|class|exam/.test(kl)) return "activities";
    return "other";
  }

  function parseTagNavigationHints(tags) {
    var hints = [];
    (tags || []).forEach(function (tag) {
      var t = String(tag);
      if (t === "location") {
        hints.push({
          type: "tag-location",
          tag: t,
          label: "Location hub (menu links built at runtime)",
          target: null,
          category: "navigation",
        });
        return;
      }
      if (t === "hasmap") {
        hints.push({
          type: "tag-hasmap",
          tag: t,
          label: "Has map UI (navigation built at runtime)",
          target: null,
          category: "navigation",
        });
        return;
      }
      var closed = /^closedgoto([A-Za-z0-9_-]+)$/i.exec(t);
      if (closed) {
        hints.push({
          type: "tag-closedgoto",
          tag: t,
          label: "When closed → " + closed[1],
          target: closed[1],
          category: "navigation",
        });
        return;
      }
      var got = /^goto([A-Za-z0-9_-]+)$/i.exec(t);
      if (got && got[1].length > 1) {
        hints.push({
          type: "tag-goto",
          tag: t,
          label: "Goto → " + got[1],
          target: got[1],
          category: "navigation",
        });
        return;
      }
      var openHr = /^openhour(\d+)$/i.exec(t);
      if (openHr) {
        hints.push({
          type: "tag-openhour",
          tag: t,
          label: "Opens at hour " + openHr[1],
          target: null,
          category: "time",
        });
        return;
      }
      var closeHr = /^closehour(\d+)$/i.exec(t);
      if (closeHr) {
        hints.push({
          type: "tag-closehour",
          tag: t,
          label: "Closes at hour " + closeHr[1],
          target: null,
          category: "time",
        });
        return;
      }
      if (/^locblock/i.test(t)) {
        hints.push({ type: "tag-locblock", tag: t, label: "Location block: " + t, target: null, category: "navigation" });
        return;
      }
      if (/^loc[A-Za-z0-9]/i.test(t)) {
        hints.push({ type: "tag-loc", tag: t, label: "Location id: " + t, target: null, category: "navigation" });
        return;
      }
      if (t === "dialogue" || t === "dialog") {
        hints.push({ type: "tag-dialogue", tag: t, label: "Dialogue passage", target: null, category: "dialogue" });
        return;
      }
      if (t === "widget") {
        hints.push({ type: "tag-widget", tag: t, label: "Widget definition passage", target: null, category: "widget" });
      }
    });
    return hints;
  }

  function getTagTaxonomy() {
    var tagCounts = {};
    var categoryCounts = {};
    var passagesByCategory = {};
    var totalPassages = 0;

    iteratePassages(function (p) {
      totalPassages++;
      var name = passageName(p);
      var tags = p.tags || [];
      var profile = classifyPassageTags(tags);
      tags.forEach(function (tag) {
        if (!tagCounts[tag]) tagCounts[tag] = { tag: tag, count: 0, passages: [] };
        tagCounts[tag].count++;
        if (tagCounts[tag].passages.length < 8) tagCounts[tag].passages.push(name);
      });
      profile.categories.forEach(function (cat) {
        categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
        if (!passagesByCategory[cat]) passagesByCategory[cat] = [];
        if (passagesByCategory[cat].length < 12) passagesByCategory[cat].push(name);
      });
    });

    var tags = Object.keys(tagCounts)
      .map(function (k) {
        var info = classifyPassageTag(k);
        return {
          tag: k,
          count: tagCounts[k].count,
          samplePassages: tagCounts[k].passages,
          categories: info.categories,
          primaryCategory: info.primaryCategory,
        };
      })
      .sort(function (a, b) { return b.count - a.count; });

    var categories = TAG_CATEGORY_RULES.map(function (rule) {
      return {
        id: rule.id,
        label: rule.label,
        passageCount: categoryCounts[rule.id] || 0,
        samplePassages: passagesByCategory[rule.id] || [],
      };
    });
    if (categoryCounts.other) {
      categories.push({
        id: "other",
        label: "Other / uncategorized",
        passageCount: categoryCounts.other,
        samplePassages: passagesByCategory.other || [],
      });
    }

    return {
      totalPassages: totalPassages,
      uniqueTags: tags.length,
      tags: tags,
      categories: categories,
    };
  }

  function passageNavigationSummary(name, text, tags, precomputedLinks) {
    var staticLinks = precomputedLinks || parsePassageLinks(text || "");
    var tagHints = parseTagNavigationHints(tags || []);
    var tagTargets = tagHints.filter(function (h) { return !!h.target; });
    var tagProfile = classifyPassageTags(tags || []);
    return {
      staticLinkCount: staticLinks.length,
      tagLinkCount: tagTargets.length,
      isLocationHub: (tags || []).indexOf("location") !== -1,
      tagHints: tagHints,
      staticLinks: staticLinks,
      tagTargets: tagTargets,
      tagCategories: tagProfile.categories,
      primaryCategory: tagProfile.primaryCategory,
    };
  }

  function searchVariablesByText(keyword, limit) {
    var max = limit || 12;
    var live = getLiveVariableStore();
    if (!live || !keyword) return [];
    var q = String(keyword).trim().toLowerCase();
    if (q.length < 2) return [];
    var matches = [];

    function walk(obj, pathParts) {
      if (matches.length >= max || obj == null) return;
      if (typeof obj !== "object") return;
      if (obj instanceof Map) {
        obj.forEach(function (v, k) {
          walk(v, pathParts.concat(String(k)));
        });
        return;
      }
      if (Array.isArray(obj)) {
        for (var i = 0; i < obj.length && matches.length < max; i++) {
          walk(obj[i], pathParts.concat(String(i)));
        }
        return;
      }
      Object.keys(obj).forEach(function (k) {
        if (matches.length >= max) return;
        var path = pathParts.concat(k);
        var pathStr = path.join(".").toLowerCase();
        var val = obj[k];
        var valStr = val != null && typeof val !== "object" ? String(val).toLowerCase() : "";
        if (pathStr.indexOf(q) !== -1 || valStr.indexOf(q) !== -1) {
          matches.push({
            path: path,
            pathExpr: "$" + path.join("."),
            value: serializeForPanel(val),
          });
        }
        if (typeof val === "object" && val !== null && pathParts.length < 4) {
          walk(val, path);
        }
      });
    }

    walk(live, []);
    return matches;
  }

  var DIALOG_ROOT_SELECTORS = [
    "#ui-dialog",
    "#ui-dialog-body",
    ".ui-dialog",
    "[role='dialog']",
    ".dialog-body",
    "#dialog",
    ".modal-dialog",
    ".overlay-dialog",
  ];

  var ENTITY_STAT_KEYS = [
    "friendship", "lust", "romance", "affection", "trust", "love", "relationship",
    "familiarity", "reputation", "affinity", "attraction", "respect", "opinion",
    "mood", "personality", "schedule", "traits", "status", "location", "met",
    "known", "introduced", "gender", "age", "description",
  ];

  var ENTITY_NAME_KEYS = ["name", "displayname", "fullname", "shortname", "nickname", "label", "title"];

  var SETUP_REGISTRY_PATTERNS = [
    "person", "people", "character", "npc", "dialog", "contact", "actor", "schedule", "trait",
  ];

  function elementInDialog(el) {
    if (!el || !el.closest) return false;
    for (var i = 0; i < DIALOG_ROOT_SELECTORS.length; i++) {
      if (el.closest(DIALOG_ROOT_SELECTORS[i])) return true;
    }
    return false;
  }

  function isDialogVisible(root) {
    if (!root || !root.getBoundingClientRect) return false;
    var style = window.getComputedStyle(root);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (parseFloat(style.opacity) === 0) return false;
    var rect = root.getBoundingClientRect();
    return rect.width > 4 && rect.height > 4;
  }

  function findVisibleDialogRoot() {
    try {
      if (typeof Dialog !== "undefined" && Dialog.isOpen && Dialog.isOpen()) {
        if (Dialog.dialog) {
          var dlg = Dialog.dialog();
          if (dlg && dlg.length && dlg[0] && isDialogVisible(dlg[0])) {
            return { root: dlg[0], source: "SugarCube.Dialog", apiOpen: true };
          }
        }
        if (Dialog.body) {
          var body = Dialog.body();
          if (body && body.length && body[0]) {
            var bodyEl = body[0];
            var outer = bodyEl.closest ? bodyEl.closest("#ui-dialog, [role='dialog'], .ui-dialog") : null;
            return { root: outer || bodyEl, source: "SugarCube.Dialog", apiOpen: true };
          }
        }
      }
    } catch (e) { /* ignore */ }

    var candidates = ["#ui-dialog", "[role='dialog']", ".ui-dialog", "#dialog", ".modal.show", ".modal.open"];
    for (var i = 0; i < candidates.length; i++) {
      var nodes = document.querySelectorAll(candidates[i]);
      for (var j = 0; j < nodes.length; j++) {
        if (isDialogVisible(nodes[j])) {
          return { root: nodes[j], source: "dom:" + candidates[i], apiOpen: null };
        }
      }
    }
    return null;
  }

  function getDialogTitle(root) {
    if (!root) return "";
    var titleNode =
      document.querySelector("#ui-dialog .ui-dialog-title") ||
      root.querySelector(".ui-dialog-title, .ui-dialog-titlebar, .title, h1, h2, h3");
    return titleNode ? (titleNode.textContent || "").trim().slice(0, 160) : "";
  }

  function getDialogScanRoot(found) {
    if (!found || !found.root) return null;
    var root = found.root;
    if (root.closest) {
      var outer = root.closest("#ui-dialog, [role='dialog'], .ui-dialog, .modal-dialog, #dialog");
      if (outer) root = outer;
    }
    return { root: root, source: found.source, apiOpen: found.apiOpen };
  }

  function scanDialogSnapshot() {
    var found = getDialogScanRoot(findVisibleDialogRoot());
    if (!found) return { open: false };

    var root = found.root;
    var title = getDialogTitle(root);
    var text = (root.textContent || "").trim();
    var varRefs = varsInText(text.slice(0, 4000));
    var links = collectDomLinks(root).slice(0, 24);

    return {
      open: true,
      source: found.source,
      apiOpen: found.apiOpen,
      title: title,
      textPreview: text.slice(0, 240),
      variableRefs: varRefs,
      variables: resolveVarSnapshot(varRefs),
      links: links,
      interactiveCount: links.length,
    };
  }

  function analyzeSetterIntent(setter) {
    if (!setter) return null;
    var s = String(setter);
    var hints = [];
    if (/Dialog\.(open|wiki|setup|append|body|create)/i.test(s)) {
      hints.push({ type: "dialog", label: "Opens or updates SugarCube Dialog" });
    }
    if (/<<\s*dialog|<<\s*popup/i.test(s)) {
      hints.push({ type: "dialog-macro", label: "Dialog-related macro in setter" });
    }
    if (/Engine\.play|Story\.play/i.test(s)) {
      hints.push({ type: "passage", label: "Navigates via Engine.play / Story.play" });
    }
    if (/State\.(set|variables)|State\.setVar/i.test(s) || /\$\w+\s*[=+\-]/.test(s)) {
      hints.push({ type: "state", label: "Modifies story variables" });
    }
    if (/\.show\s*\(|\.hide\s*\(|classList|\.toggle/i.test(s)) {
      hints.push({ type: "dom", label: "Shows/hides DOM elements" });
    }
    return hints.length ? hints : null;
  }

  function pickEntityPreview(obj) {
    var preview = {};
    ENTITY_NAME_KEYS.forEach(function (k) {
      if (obj[k] != null && typeof obj[k] !== "object") preview[k] = obj[k];
    });
    ENTITY_STAT_KEYS.slice(0, 10).forEach(function (k) {
      if (obj[k] != null && typeof obj[k] !== "object") preview[k] = obj[k];
    });
    if (!Object.keys(preview).length) {
      Object.keys(obj)
        .slice(0, 6)
        .forEach(function (k) {
          var v = obj[k];
          if (v != null && typeof v !== "object") preview[k] = v;
        });
    }
    return serializeForPanel(preview);
  }

  function scoreEntityObject(obj, labelTokens) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    var keys = Object.keys(obj);
    if (keys.length < 2 || keys.length > 120) return null;

    var score = 0;
    var reasons = [];
    var lowerKeys = keys.map(function (k) { return k.toLowerCase(); });
    var statHits = lowerKeys.filter(function (k) {
      return ENTITY_STAT_KEYS.some(function (s) { return k === s || k.indexOf(s) !== -1; });
    });
    if (statHits.length >= 2) {
      score += 4;
      reasons.push("relationship/stat fields: " + statHits.slice(0, 4).join(", "));
    } else if (statHits.length === 1) {
      score += 2;
      reasons.push("stat-like field: " + statHits[0]);
    }

    ENTITY_NAME_KEYS.forEach(function (nk) {
      var val = obj[nk];
      if (val != null && typeof val === "string" && labelTokens.length) {
        var nv = val.toLowerCase();
        if (labelTokens.some(function (t) { return nv.indexOf(t) !== -1 || t.indexOf(nv) !== -1; })) {
          score += 6;
          reasons.push("name field matches clicked label");
        }
      }
    });

    return score > 0 ? { score: score, reasons: reasons } : null;
  }

  function tokenizeLabel(labelText) {
    return String(labelText || "")
      .toLowerCase()
      .replace(/[^\w\s'-]/g, " ")
      .split(/\s+/)
      .filter(function (w) { return w.length > 2; })
      .slice(0, 6);
  }

  function findEntityVariableHints(labelText, limit) {
    var max = limit || 8;
    var live = getLiveVariableStore();
    if (!live || !labelText) return [];

    var tokens = tokenizeLabel(labelText);
    if (!tokens.length) return [];

    var hints = [];
    var entityContainerNames = [
      "people", "persons", "person", "characters", "character", "npcs", "npc", "contacts", "students", "actors",
    ];

    function pushHint(pathParts, obj, reasonPrefix, scored) {
      if (hints.length >= max) return;
      hints.push({
        path: pathParts,
        pathExpr: "$" + pathParts.join("."),
        confidence: scored.score >= 6 ? "high" : scored.score >= 4 ? "medium" : "low",
        reasons: reasonPrefix.concat(scored.reasons),
        preview: pickEntityPreview(obj),
      });
    }

    Object.keys(live).forEach(function (topKey) {
      if (hints.length >= max) return;
      var top = live[topKey];
      var tl = topKey.toLowerCase();
      var isContainer = entityContainerNames.some(function (n) { return tl.indexOf(n) !== -1; });

      if (typeof top === "object" && top !== null && !Array.isArray(top)) {
        var childKeys = Object.keys(top);
        if (isContainer || childKeys.length < 250) {
          childKeys.forEach(function (childKey) {
            if (hints.length >= max) return;
            var child = top[childKey];
            if (typeof child !== "object" || child === null || Array.isArray(child)) return;
            var childLower = childKey.toLowerCase();
            var keyMatch = tokens.some(function (t) { return childLower.indexOf(t) !== -1; });
            var scored = scoreEntityObject(child, tokens);
            if (!scored) return;
            if (keyMatch) {
              pushHint([topKey, childKey], child, ["key matches label"], scored);
            } else if (isContainer && scored.score >= 3) {
              pushHint([topKey, childKey], child, ["entry in " + topKey + " registry"], scored);
            }
          });
        }
      }

      if (typeof top === "object" && top !== null && !Array.isArray(top)) {
        if (tokens.some(function (t) { return tl.indexOf(t) !== -1; })) {
          var topScored = scoreEntityObject(top, tokens);
          if (topScored && topScored.score >= 3) {
            pushHint([topKey], top, ["variable name matches label"], topScored);
          }
        }
      }
    });

    hints.sort(function (a, b) {
      var order = { high: 3, medium: 2, low: 1 };
      return (order[b.confidence] || 0) - (order[a.confidence] || 0) || b.reasons.length - a.reasons.length;
    });
    return hints.slice(0, max);
  }

  function findSetupRegistryHints(labelText, limit) {
    var S = getSugarCube();
    if (!S || !S.setup) return [];
    var max = limit || 6;
    var tokens = tokenizeLabel(labelText);
    var hints = [];

    Object.keys(S.setup).forEach(function (k) {
      if (hints.length >= max) return;
      var kl = k.toLowerCase();
      var patternHit = SETUP_REGISTRY_PATTERNS.some(function (p) { return kl.indexOf(p) !== -1; });
      var tokenHit = tokens.some(function (t) { return kl.indexOf(t) !== -1; });
      if (!patternHit && !tokenHit) return;

      var entry = {
        key: "setup." + k,
        type: typeof S.setup[k],
        matchReason: tokenHit ? "matches label" : "setup registry name",
      };
      var val = S.setup[k];
      if (val && typeof val === "object" && !Array.isArray(val)) {
        var subMatch = Object.keys(val)
          .filter(function (sk) {
            return tokens.some(function (t) { return sk.toLowerCase().indexOf(t) !== -1; });
          })
          .slice(0, 6);
        if (subMatch.length) entry.subKeys = subMatch;
      }
      hints.push(entry);
    });

    return hints;
  }

  function buildInspectTips(kind, linkTarget, linkSetter, dialogSnapshot, setterAnalysis, entityHints, clickedInDialog) {
    if (dialogSnapshot && dialogSnapshot.open) {
      if (clickedInDialog) {
        return "Element is inside an open dialog/modal. Links and variables below are scoped to that overlay.";
      }
      return "A dialog/modal is open — see Dialog section for title, links, and variable refs inside it.";
    }
    if (setterAnalysis && setterAnalysis.some(function (h) { return h.type.indexOf("dialog") !== -1; })) {
      return "This action likely opens a SugarCube Dialog — click it in the game, then use Analyze dialog or inspect again.";
    }
    if (entityHints && entityHints.length) {
      return "Possible character/entity data found in variables — generic match by name and stat-like fields, not game-specific.";
    }
    if (kind === "inline-link") {
      return "Inline passage link — often names or descriptive text. Check entity hints and variable search below.";
    }
    if (kind === "action-link" || linkSetter) {
      return "In-place action (data-setter) — runs code without leaving the passage. Check setter analysis and Variables / Changes after clicking.";
    }
    if (kind === "link") {
      return "Clickable choice — use Go to passage to jump there, or open Passages for source.";
    }
    if (kind === "interactive") {
      return "Interactive element — likely a custom macro link. Try Links or DOM tabs for more.";
    }
    if (kind === "variable-text") {
      return "Text references variables — see values below. Open Variables to edit.";
    }
    return "Try clicking a link/choice for passage info, or text mentioning $variables.";
  }

  function inspectGameElement(args) {
    var OVERLAY_ID = "twine-devtools-overlay-host";
    var FAB_ID = "twine-devtools-fab";
    var x = args && args.x;
    var y = args && args.y;
    if (typeof x !== "number" || typeof y !== "number") {
      return { error: "Missing click coordinates" };
    }

    var el = document.elementFromPoint(x, y);
    while (
      el &&
      (el.id === OVERLAY_ID ||
        el.id === FAB_ID ||
        (el.closest && (el.closest("#" + OVERLAY_ID) || el.closest("#" + FAB_ID))))
    ) {
      el = el.parentElement;
    }
    if (!el || el === document.documentElement || el === document.body) {
      return { error: "Click a specific element in the game (link, text, image, etc.)" };
    }

    var meta = readMeta();
    var resolved = resolveInteractiveFromElement(el);
    var chain = [];
    var cur = el;
    var linkTarget = resolved ? resolved.target : null;
    var linkLabel = resolved ? resolved.label : null;
    var linkSetter = resolved ? resolved.setter : null;
    var depth = 0;
    while (cur && depth < 10) {
      var passage = readPassageTargetFromElement(cur);
      var setter = readSetterFromElement(cur);
      var entry = {
        tag: cur.tagName ? cur.tagName.toLowerCase() : "?",
        id: cur.id || null,
        classes: cur.className && typeof cur.className === "string" ? cur.className : null,
        passage: passage || null,
        setter: setter || null,
        role: cur.getAttribute ? cur.getAttribute("role") : null,
        text: getDirectText(cur).slice(0, 120) || null,
      };
      chain.push(entry);
      if (!linkTarget && passage) {
        linkTarget = passage;
        linkLabel = entry.text || passage;
      }
      if (!linkSetter && setter) linkSetter = setter;
      if (cur.classList && cur.classList.contains("link-internal")) {
        linkLabel = linkLabel || entry.text;
      }
      cur = cur.parentElement;
      depth++;
    }

    var text = (el.textContent || "").trim().slice(0, 300);
    var htmlSnippet = (el.outerHTML || "").slice(0, 400);
    var varRefs = varsInText(text + " " + htmlSnippet);
    var variables = resolveVarSnapshot(varRefs);
    var keyword = text.split(/\s+/).filter(function (w) { return w.length > 2; }).slice(0, 3).join(" ");
    var varMatches = searchVariablesByText(keyword || text.slice(0, 24), 10);

    var targetDetail = linkTarget ? getPassageDetail(linkTarget) : null;
    var targetSummary = targetDetail
      ? passageNavigationSummary(targetDetail.name, targetDetail.text, targetDetail.tags)
      : null;

    var kind = "element";
    if (linkTarget) kind = classifyDomLink(el, resolved);
    else if (linkSetter) kind = "action-link";
    else if (el.tagName === "IMG") kind = "image";
    else if (el.classList && (el.classList.contains("macro") || el.matches && el.matches("[data-macro], .macro-variable"))) {
      kind = "macro";
    } else if (isLikelyInteractiveElement(el)) kind = "interactive";
    else if (varRefs.length) kind = "variable-text";

    var clickedInDialog = elementInDialog(el);
    var dialogSnapshot = scanDialogSnapshot();
    var setterAnalysis = analyzeSetterIntent(linkSetter);
    var entityHints = findEntityVariableHints(text || linkLabel || "", 8);
    var setupHints = findSetupRegistryHints(text || linkLabel || "", 6);
    var inspectLabel = text.slice(0, 120) || linkLabel || el.tagName.toLowerCase();

    return {
      kind: kind,
      currentPassage: meta ? meta.passage : null,
      label: inspectLabel,
      linkTarget: linkTarget,
      linkLabel: linkLabel,
      linkSetter: linkSetter,
      inPlaceAction: !linkTarget && !!linkSetter,
      clickedInDialog: clickedInDialog,
      dialog: dialogSnapshot,
      setterAnalysis: setterAnalysis,
      entityHints: entityHints,
      setupHints: setupHints,
      selector: uniqueSelector(el),
      chain: chain,
      variables: variables,
      variableMatches: varMatches,
      targetPassage: targetDetail
        ? {
            name: targetDetail.name,
            tags: targetDetail.tags,
            tagHints: targetDetail.tagHints || parseTagNavigationHints(targetDetail.tags),
            staticLinkCount: targetDetail.staticLinkCount,
            tagLinkCount: targetDetail.tagLinkCount,
            isLocationHub: targetDetail.isLocationHub,
          }
        : null,
      targetSummary: targetSummary,
      tips: buildInspectTips(kind, linkTarget, linkSetter, dialogSnapshot, setterAnalysis, entityHints, clickedInDialog),
    };
  }

  // Lightweight sibling of inspectGameElement for hover previews — resolves
  // the interactive element and link/setter info but skips passage detail,
  // variable search, entity/setup hints, and dialog scans. Called repeatedly
  // while the mouse moves, so it must stay cheap.
  function peekGameElement(args) {
    var OVERLAY_ID = "twine-devtools-overlay-host";
    var FAB_ID = "twine-devtools-fab";
    var x = args && args.x;
    var y = args && args.y;
    if (typeof x !== "number" || typeof y !== "number") return { found: false };

    var el = document.elementFromPoint(x, y);
    while (
      el &&
      (el.id === OVERLAY_ID ||
        el.id === FAB_ID ||
        (el.closest && (el.closest("#" + OVERLAY_ID) || el.closest("#" + FAB_ID))))
    ) {
      el = el.parentElement;
    }
    if (!el || el === document.documentElement || el === document.body) return { found: false };

    var resolved = resolveInteractiveFromElement(el);
    var linkTarget = resolved ? resolved.target : null;
    var linkSetter = resolved ? resolved.setter : null;

    var kind = "element";
    if (linkTarget) kind = classifyDomLink(el, resolved);
    else if (linkSetter) kind = "action-link";
    else if (el.tagName === "IMG") kind = "image";
    else if (isLikelyInteractiveElement(el)) kind = "interactive";

    var varRefs = varsInText((el.textContent || "").slice(0, 500));
    if (kind === "element" && varRefs.length) kind = "variable-text";

    var label = (resolved && resolved.label) || getDirectText(el).slice(0, 140);
    if (el.tagName === "IMG") {
      var srcName = (el.getAttribute("src") || "").split("/").pop().split("?")[0];
      label = el.getAttribute("alt") || srcName || "image";
    }
    if (!label) label = el.tagName ? el.tagName.toLowerCase() : "element";

    var focusEl = (resolved && resolved.element) || el;
    var r = focusEl.getBoundingClientRect();

    return {
      found: true,
      kind: kind,
      tag: el.tagName ? el.tagName.toLowerCase() : "",
      label: String(label).slice(0, 140),
      linkTarget: linkTarget || null,
      targetExists: linkTarget ? !!getPassage(linkTarget) : null,
      linkSetter: linkSetter ? String(linkSetter).slice(0, 120) : null,
      varRefs: varRefs.slice(0, 4),
      varCount: varRefs.length,
      rect: { left: r.left, top: r.top, width: r.width, height: r.height },
    };
  }

  function analyzeOpenDialog() {
    var dialogSnapshot = scanDialogSnapshot();
    if (!dialogSnapshot.open) {
      return { error: "No open dialog detected. Open a character card, menu, or SugarCube Dialog in the game first." };
    }
    var searchText = [dialogSnapshot.title, dialogSnapshot.textPreview].filter(Boolean).join(" ");
    return {
      kind: "dialog",
      label: dialogSnapshot.title || "Open dialog",
      dialog: dialogSnapshot,
      entityHints: findEntityVariableHints(searchText, 8),
      setupHints: findSetupRegistryHints(searchText, 6),
      variableMatches: searchVariablesByText(searchText.slice(0, 40), 10),
      tips: "Analyzing the currently open dialog/modal using SugarCube Dialog API and generic DOM patterns.",
    };
  }

  function parseWikiLinks(text) {
    var links = [];
    var re = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
    var m;
    while ((m = re.exec(text)) !== null) {
      var a = m[1].trim();
      var b = m[2] ? m[2].trim() : null;
      links.push({
        type: "wiki",
        label: b ? a : a,
        target: b || a,
        raw: m[0],
      });
    }
    return links;
  }

  function parseMacroLinks(text) {
    var links = [];
    var re = /<<(link|button)\s+(?:"([^"]+)"|'([^']+)')\s+(?:"([^"]+)"|'([^']+)')([^>]*)>>/gi;
    var m;
    while ((m = re.exec(text)) !== null) {
      links.push({
        type: m[1].toLowerCase() === "button" ? "button" : "macro",
        label: m[2] || m[3],
        target: m[4] || m[5],
        raw: m[0],
        attrs: (m[6] || "").trim(),
      });
    }
    var incRe = /<<(?:include|display)\s+(?:"([^"]+)"|'([^']+)'|\[\[([^\]|]+)(?:\|[^\]]*)?\]\]|([A-Za-z][\w.-]*))/gi;
    while ((m = incRe.exec(text)) !== null) {
      var incTarget = (m[1] || m[2] || m[3] || m[4] || "").trim();
      if (!incTarget) continue;
      links.push({ type: "include", label: "include: " + incTarget, target: incTarget, raw: m[0] });
    }
    return links;
  }

  function parseSetMacros(text) {
    var sets = [];
    var re = /<<set\s+([^>]+)>>/gi;
    var m;
    while ((m = re.exec(text)) !== null) {
      sets.push(m[1].trim());
    }
    return sets;
  }

  function parseIfMacros(text) {
    var conds = [];
    var re = /<<if\s+([^>]+)>>/gi;
    var m;
    while ((m = re.exec(text)) !== null) {
      conds.push(m[1].trim());
    }
    return conds;
  }

  function parseUnlessMacros(text) {
    var conds = [];
    var re = /<<unless\s+([^>]+)>>/gi;
    var m;
    while ((m = re.exec(text)) !== null) {
      conds.push(m[1].trim());
    }
    return conds;
  }

  function parseElseIfMacros(text) {
    var conds = [];
    var re = /<<elseif\s+([^>]+)>>/gi;
    var m;
    while ((m = re.exec(text)) !== null) {
      conds.push(m[1].trim());
    }
    return conds;
  }

  function parseRunMacros(text) {
    var runs = [];
    var re = /<<run\s+([^>]+)>>/gi;
    var m;
    while ((m = re.exec(text)) !== null) {
      runs.push(m[1].trim());
    }
    return runs;
  }

  function parsePrintMacros(text) {
    var prints = [];
    var re = /<<print\s+([^>]+)>>/gi;
    var m;
    while ((m = re.exec(text)) !== null) {
      prints.push(m[1].trim());
    }
    return prints;
  }

  function parseGotoMacros(text) {
    var gotos = [];
    var re = /<<goto\s+([^>]+)>>/gi;
    var m;
    while ((m = re.exec(text)) !== null) {
      gotos.push(m[1].trim());
    }
    return gotos;
  }

  function parseIncludeMacros(text) {
    var includes = [];
    var re = /<<include\s+([^>]+)>>/gi;
    var m;
    while ((m = re.exec(text)) !== null) {
      includes.push(m[1].trim());
    }
    return includes;
  }

  function parseSwitchMacros(text) {
    var out = [];
    var swRe = /<<switch\s+([^>]+)>>/gi;
    var caseRe = /<<case\s+([^>]+)>>/gi;
    var m;
    while ((m = swRe.exec(text)) !== null) {
      out.push({ kind: "switch", expression: m[1].trim() });
    }
    while ((m = caseRe.exec(text)) !== null) {
      out.push({ kind: "case", expression: m[1].trim() });
    }
    return out;
  }

  function parseScriptBlocks(text) {
    var blocks = [];
    var re = /<<script>>([\s\S]*?)<\/script>>/gi;
    var m;
    while ((m = re.exec(text)) !== null) {
      blocks.push(m[1].trim());
    }
    return blocks;
  }

  function getLiveVariableStore() {
    var adapter = getAdapter();
    if (adapter && typeof adapter.getStateRoot === "function") {
      var root = adapter.getStateRoot();
      if (root) return root;
    }
    var S = getSugarCube();
    if (S && S.State && S.State.variables) {
      return S.State.variables;
    }
    var detected = detectEngine();
    if (!detected) return null;
    try {
      if (detected.profile.variablesExpr) {
        return eval(detected.profile.variablesExpr);
      }
    } catch (e) { /* ignore */ }
    return detected.variables;
  }

  function readStoryVar(nameOrPath) {
    var raw = String(nameOrPath || "");
    var isTemp = raw.charAt(0) === "_";
    var path = raw.replace(/^\$/, "");
    if (isTemp) path = path.replace(/^_/, "");

    var S = getSugarCube();
    if (S && S.State) {
      if (typeof S.State.getVar === "function" && path.indexOf(".") === -1) {
        try {
          var key = isTemp ? "_" + path : "$" + path;
          var direct = S.State.getVar(key);
          if (direct !== undefined) return direct;
        } catch (e) { /* fall through */ }
      }
      var store = isTemp ? S.State.temporary : S.State.variables;
      if (store) {
        var fromStore = getValueAtPath(store, path);
        if (fromStore !== undefined) return fromStore;
      }
    }

    if (typeof window.V !== "undefined" && window.V && !isTemp) {
      var fromV = getValueAtPath(window.V, path);
      if (fromV !== undefined) return fromV;
    }

    var live = getLiveVariableStore();
    if (live && !isTemp) {
      return getValueAtPath(live, path);
    }
    return undefined;
  }

  function varsInText(text) {
    var refs = {};
    var storyRe = /\$([A-Za-z_][\w.]*)/g;
    var tempRe = /(?:^|[\s(,|&!<>=+\-*/])((_+[A-Za-z_][\w.]*))/g;
    var m;
    while ((m = storyRe.exec(text)) !== null) {
      refs[m[1]] = true;
    }
    while ((m = tempRe.exec(text)) !== null) {
      refs[m[1]] = true;
    }
    return Object.keys(refs).sort();
  }

  function evalSugarCondition(expr, macroType) {
    if (!expr || !String(expr).trim()) {
      return { result: null, error: "empty condition" };
    }
    var trimmed = String(expr).trim();
    var S = getSugarCube();
    var Scripting = window.Scripting || (S && S.Scripting);

    if (Scripting && typeof Scripting.evalJavaScript === "function") {
      try {
        var js = trimmed;
        if (typeof Scripting.desugar === "function") {
          js = Scripting.desugar(trimmed);
        } else if (typeof Scripting.parse === "function") {
          js = Scripting.parse(trimmed);
        }
        var val = Scripting.evalJavaScript(js);
        if (macroType === "unless") val = !val;
        return { result: !!val, error: null };
      } catch (e) {
        return { result: null, error: String(e.message || e) };
      }
    }

    var WikifierCtor = (S && S.Wikifier) || window.Wikifier;
    var jQueryFn = window.jQuery && window.jQuery.fn;
    if (jQueryFn && typeof jQueryFn.wiki === "function") {
      var $host = null;
      try {
        $host = window.jQuery("<div>").attr("data-tw-devtools-eval", "1").css({
          position: "absolute",
          left: "-99999px",
          visibility: "hidden",
        }).appendTo(document.body);
        var wikiSrc = macroType === "unless"
          ? "<<if !(" + trimmed + ")>>__PASS__<<else>>__FAIL__<</if>>"
          : "<<if " + trimmed + ">>__PASS__<<else>>__FAIL__<</if>>";
        $host.wiki(wikiSrc);
        var text = $host.text() || "";
        if (text.indexOf("__PASS__") !== -1) return { result: true, error: null };
        if (text.indexOf("__FAIL__") !== -1) return { result: false, error: null };
        return { result: null, error: "could not evaluate" };
      } catch (e2) {
        return { result: null, error: String(e2.message || e2) };
      } finally {
        if ($host) $host.remove();
      }
    }

    if (!WikifierCtor) {
      return { result: null, error: "Scripting unavailable" };
    }
    var host = null;
    try {
      host = document.createElement("div");
      host.setAttribute("data-tw-devtools-eval", "1");
      host.style.cssText = "position:absolute;left:-99999px;top:0;width:0;height:0;overflow:hidden;visibility:hidden;";
      document.body.appendChild(host);
      var wikiFallback = macroType === "unless"
        ? "<<if !(" + trimmed + ")>>__PASS__<<else>>__FAIL__<</if>>"
        : "<<if " + trimmed + ">>__PASS__<<else>>__FAIL__<</if>>";
      new WikifierCtor(host, wikiFallback).fullMode();
      var hostText = host.textContent || "";
      if (hostText.indexOf("__PASS__") !== -1) return { result: true, error: null };
      if (hostText.indexOf("__FAIL__") !== -1) return { result: false, error: null };
      return { result: null, error: "could not evaluate" };
    } catch (e3) {
      return { result: null, error: String(e3.message || e3) };
    } finally {
      if (host && host.parentNode) host.parentNode.removeChild(host);
    }
  }

  function resolveVarSnapshot(names) {
    return (names || []).map(function (name) {
      var value = readStoryVar(name);
      var serialized = value === undefined ? { __twType: "undefined" } : serializeForPanel(value);
      return {
        name: name,
        path: name.charAt(0) === "_" ? name : "$" + name.replace(/^\$/, ""),
        value: serialized,
        unset: value === undefined,
        valueType: value === undefined ? "unset" : value === null ? "null" : typeof value,
      };
    });
  }

  function buildConditionEntry(type, expression) {
    var evalResult = evalSugarCondition(expression, type);
    return {
      type: type,
      expression: expression,
      result: evalResult.result,
      evalError: evalResult.error,
      variables: resolveVarSnapshot(varsInText(expression)),
    };
  }

  function getCurrentPassageContext() {
    var meta = readMeta();
    if (!meta || !meta.passage) return null;

    var detail = getPassageDetail(meta.passage);
    var domLinks = getCurrentDomLinks();

    if (!detail) {
      return {
        meta: meta,
        passage: meta.passage,
        error: "Passage source not found in story data.",
        domLinks: domLinks,
      };
    }

    var conditions = [];
    detail.ifMacros.forEach(function (c) {
      conditions.push(buildConditionEntry("if", c));
    });
    parseUnlessMacros(detail.text).forEach(function (c) {
      conditions.push(buildConditionEntry("unless", c));
    });
    parseElseIfMacros(detail.text).forEach(function (c) {
      conditions.push(buildConditionEntry("elseif", c));
    });

    var linkAnalysis = getLinkAnalysis();
    var choices = (linkAnalysis && linkAnalysis.links ? linkAnalysis.links : []).map(function (item) {
      var status = "unknown";
      if (!item.inDom) status = "not-rendered";
      else if (item.domHidden) status = "hidden";
      else status = "visible";
      return Object.assign({}, item, { status: status });
    });

    var variablesUsed = resolveVarSnapshot(varsInText(detail.text));

    return {
      meta: meta,
      passage: detail.name,
      tags: detail.tags,
      textLength: detail.text.length,
      text: detail.text,
      hasPlayed: meta.hasPlayedCurrent,
      conditions: conditions,
      effects: {
        set: detail.setMacros,
        run: parseRunMacros(detail.text),
        script: parseScriptBlocks(detail.text),
        print: parsePrintMacros(detail.text),
        goto: parseGotoMacros(detail.text),
        include: parseIncludeMacros(detail.text),
        switch: parseSwitchMacros(detail.text),
      },
      choices: choices,
      domLinks: domLinks,
      variablesUsed: variablesUsed,
      media: detail.media,
      linkCount: detail.links.length,
      sourceLinks: detail.links,
    };
  }

  function extractVarRefs(text) {
    var refs = {};
    var re = /\$([A-Za-z_][A-Za-z0-9_]*)/g;
    var m;
    while ((m = re.exec(text)) !== null) {
      refs[m[1]] = true;
    }
    return Object.keys(refs).sort();
  }

  function parseMediaRefs(text) {
    var refs = [];
    var patterns = [
      { type: "img-macro", re: /\[img\[(?:[^\]|]+\|)?([^\]|]+)(?:\|[^\]]*)?\]\]/gi },
      { type: "html-img", re: /<img[^>]+src=["']([^"']+)["']/gi },
      { type: "audio", re: /<<audio[^>]+(?:source\s+)?["']([^"']+)["']/gi },
      { type: "video", re: /<<video[^>]+(?:source\s+)?["']([^"']+)["']/gi },
      { type: "css-url", re: /url\(["']?([^"')]+)["']?\)/gi },
    ];
    for (var i = 0; i < patterns.length; i++) {
      var p = patterns[i];
      var m;
      while ((m = p.re.exec(text)) !== null) {
        refs.push({ type: p.type, url: m[1].trim(), raw: m[0] });
      }
    }
    return refs;
  }

  function resolveMediaUrl(url) {
    if (!url || url.startsWith("data:") || url.startsWith("blob:")) return url;
    try {
      return new URL(url, window.location.href).href;
    } catch (e) {
      return url;
    }
  }

  function checkMediaUrl(url) {
    return new Promise(function (resolve) {
      var resolved = resolveMediaUrl(url);
      if (resolved.startsWith("data:")) {
        resolve({ url: resolved, ok: true, status: "data" });
        return;
      }
      var img = new Image();
      var done = false;
      function finish(ok, detail) {
        if (done) return;
        done = true;
        resolve({ url: resolved, ok: ok, status: detail });
      }
      img.onload = function () { finish(true, "loaded"); };
      img.onerror = function () {
        fetch(resolved, { method: "HEAD", mode: "no-cors" })
          .then(function () { finish(true, "fetch-head"); })
          .catch(function () { finish(false, "not-found"); });
      };
      img.src = resolved;
      setTimeout(function () { finish(false, "timeout"); }, 8000);
    });
  }

  function getPassageList() {
    var list = [];
    var parseLinksFn = resolveParseLinksFn();
    iteratePassages(function (p) {
      var name = passageName(p);
      var text = p.text || "";
      var tags = p.tags || [];
      var nav = passageNavigationSummary(name, text, tags, parseLinksFn(text));
      list.push({
        name: name,
        tags: tags,
        linkCount: nav.staticLinkCount,
        tagLinkCount: nav.tagLinkCount,
        isLocationHub: nav.isLocationHub,
        tagHints: nav.tagHints,
        tagCategories: nav.tagCategories,
        primaryCategory: nav.primaryCategory,
        setCount: parseSetMacros(text).length,
        mediaCount: parseMediaRefs(text).length,
      });
    });
    list.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return list;
  }

  function getPassageDetail(name) {
    var p = getPassage(name);
    if (!p) return null;
    var text = p.text || "";
    var tags = p.tags || [];
    var nav = passageNavigationSummary(name, text, tags);
    return {
      name: passageName(p),
      tags: tags,
      text: text,
      links: nav.staticLinks,
      tagHints: nav.tagHints,
      staticLinkCount: nav.staticLinkCount,
      tagLinkCount: nav.tagLinkCount,
      isLocationHub: nav.isLocationHub,
      tagCategories: nav.tagCategories,
      primaryCategory: nav.primaryCategory,
      setMacros: parseSetMacros(text),
      ifMacros: parseIfMacros(text),
      varRefs: extractVarRefs(text),
      media: parseMediaRefs(text),
      chatHints: parsePassageChatHints(text),
      exists: true,
    };
  }

  function getPassageContentRoot() {
    return (
      document.querySelector("#passages .passage") ||
      document.querySelector("#passages") ||
      document.querySelector("tw-passage") ||
      document.body
    );
  }

  function getDirectText(el) {
    if (!el) return "";
    var parts = [];
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3) parts.push(n.textContent);
    }
    var direct = parts.join("").trim();
    if (direct) return direct;
    return (el.textContent || "").trim();
  }

  function isDomElementHidden(el) {
    if (!el) return true;
    var style = window.getComputedStyle(el);
    var rect = el.getBoundingClientRect();
    return (
      style.display === "none" ||
      style.visibility === "hidden" ||
      parseFloat(style.opacity) === 0 ||
      rect.width === 0 ||
      rect.height === 0 ||
      el.classList.contains("link-disabled") ||
      el.getAttribute("aria-disabled") === "true"
    );
  }

  function readPassageTargetFromElement(el) {
    if (!el || !el.getAttribute) return null;
    var target =
      el.getAttribute("data-passage") ||
      el.getAttribute("data-passage-name") ||
      (el.dataset && (el.dataset.passage || el.dataset.passageName)) ||
      null;
    if (!target && window.jQuery) {
      try {
        var $el = window.jQuery(el);
        target = $el.attr("data-passage") || $el.data("passage") || null;
      } catch (e) { /* ignore */ }
    }
    return target;
  }

  function readSetterFromElement(el) {
    if (!el || !el.getAttribute) return null;
    return el.getAttribute("data-setter") || (el.dataset && el.dataset.setter) || null;
  }

  function resolveInteractiveFromElement(el) {
    var cur = el;
    for (var depth = 0; cur && depth < 12; depth++) {
      var target = readPassageTargetFromElement(cur);
      var setter = readSetterFromElement(cur);
      if (target || setter) {
        return {
          element: cur,
          target: target,
          setter: setter,
          label: getDirectText(cur).slice(0, 160) || getDirectText(el).slice(0, 160),
        };
      }
      if (
        cur.classList &&
        (cur.classList.contains("link-internal") ||
          cur.classList.contains("macro-link") ||
          cur.classList.contains("macro-button"))
      ) {
        return {
          element: cur,
          target: readPassageTargetFromElement(cur),
          setter: readSetterFromElement(cur),
          label: getDirectText(cur).slice(0, 160) || getDirectText(el).slice(0, 160),
        };
      }
      cur = cur.parentElement;
    }
    return null;
  }

  function classifyDomLink(el, resolved) {
    var label = (resolved && resolved.label) || getDirectText(el).slice(0, 160);
    var target = resolved && resolved.target;
    var setter = resolved && resolved.setter;
    var tag = el.tagName ? el.tagName.toLowerCase() : "";
    var isInline =
      label.length > 36 ||
      (!/^\[\d+\]/.test(label) && tag !== "button" && !el.classList.contains("macro-button"));
    if (target && isInline) return "inline-link";
    if (target) return "link";
    if (setter) return "action-link";
    if (el.classList && el.classList.contains("link-internal")) return isInline ? "inline-link" : "link";
    if (el.getAttribute && el.getAttribute("role") === "link") return "interactive";
    return "interactive";
  }

  function collectDomLinks(root) {
    root = root || getPassageContentRoot();
    var seenEls = new WeakSet();
    var seenKeys = {};
    var out = [];

    function addItem(el, resolved) {
      if (!el || seenEls.has(el)) return;
      var resolvedInfo = resolved || resolveInteractiveFromElement(el);
      var target = resolvedInfo ? resolvedInfo.target : readPassageTargetFromElement(el);
      var setter = resolvedInfo ? resolvedInfo.setter : readSetterFromElement(el);
      if (!target && !setter && !isLikelyInteractiveElement(el)) return;

      var label = (resolvedInfo && resolvedInfo.label) || getDirectText(el).slice(0, 160);
      if (!label && !target && !setter) return;

      var type = classifyDomLink(el, resolvedInfo);
      var key = (target || "") + "|" + (setter || "") + "|" + label + "|" + type;
      seenEls.add(el);
      if (seenKeys[key]) return;
      seenKeys[key] = true;

      out.push({
        label: label || target || "(interactive)",
        target: target || "",
        setter: setter || "",
        hidden: isDomElementHidden(el),
        classes: el.className && typeof el.className === "string" ? el.className : "",
        html: (el.outerHTML || "").slice(0, 300),
        type: type,
        selector: uniqueSelector(el),
        tag: el.tagName ? el.tagName.toLowerCase() : "",
        inPlace: !target && !!setter,
      });
    }

    var selector =
      "[data-passage], [data-passage-name], [data-setter], " +
      "a.link-internal, button.link-internal, span.link-internal, " +
      ".macro-link, .macro-button, " +
      "button[data-passage], a[data-passage], [role='link']";
    var nodes;
    try {
      nodes = root.querySelectorAll(selector);
    } catch (e) {
      nodes = [];
    }

    for (var i = 0; i < nodes.length; i++) {
      addItem(nodes[i]);
    }

    // Cursor-pointer inline text (profile links, stealth links)
    var pointerNodes = root.querySelectorAll("a, button, span, [role='link'], [tabindex]");
    for (var j = 0; j < pointerNodes.length && out.length < 250; j++) {
      var cand = pointerNodes[j];
      if (seenEls.has(cand)) continue;
      if (!isLikelyInteractiveElement(cand)) continue;
      if (isDomElementHidden(cand)) continue;
      addItem(cand);
    }

    return out;
  }

  function isLikelyInteractiveElement(el) {
    if (!el || el.nodeType !== 1) return false;
    if (resolveInteractiveFromElement(el)) return true;
    var tag = el.tagName.toLowerCase();
    if (tag === "a" || tag === "button") return true;
    if (
      el.classList &&
      (el.classList.contains("link-internal") ||
        el.classList.contains("macro-link") ||
        el.classList.contains("macro-button"))
    ) {
      return true;
    }
    if (el.getAttribute("role") === "link" || el.getAttribute("role") === "button") return true;
    if (el.hasAttribute("onclick")) return true;
    if (el.hasAttribute("tabindex") && el.getAttribute("tabindex") !== "-1") {
      var style = window.getComputedStyle(el);
      if (style.cursor === "pointer") return true;
    }
    var style = window.getComputedStyle(el);
    if (style.cursor === "pointer" && getDirectText(el).length > 2) return true;
    return false;
  }

  function getCurrentDomLinks() {
    return collectDomLinks(getPassageContentRoot());
  }

  function makeGraphNode(name, tags, missing) {
    var profile = classifyPassageTags(tags || []);
    return {
      id: name,
      tags: tags || [],
      missing: !!missing,
      isLocationHub: (tags || []).indexOf("location") !== -1,
      tagCategories: profile.categories,
      primaryCategory: profile.primaryCategory,
    };
  }

  // Stub for link targets not yet visited — overwritten when the passage is
  // iterated; avoids parsing target text twice on large stories.
  function ensureGraphNode(nodes, name) {
    if (nodes[name]) return;
    var tp = getPassage(name);
    nodes[name] = makeGraphNode(name, tp ? (tp.tags || []) : [], !tp);
  }

  function attachGraphDegrees(nodesArr, edges) {
    var inDeg = {};
    var outDeg = {};
    for (var i = 0; i < edges.length; i++) {
      outDeg[edges[i].from] = (outDeg[edges[i].from] || 0) + 1;
      inDeg[edges[i].to] = (inDeg[edges[i].to] || 0) + 1;
    }
    for (var n = 0; n < nodesArr.length; n++) {
      nodesArr[n].inDegree = inDeg[nodesArr[n].id] || 0;
      nodesArr[n].outDegree = outDeg[nodesArr[n].id] || 0;
      nodesArr[n].degree = nodesArr[n].inDegree + nodesArr[n].outDegree;
    }
  }

  function getStoryGraph(limit) {
    var nodes = {};
    var edges = [];
    var count = 0;
    var adapter = getAdapter();
    var family = adapter ? adapter.family : "storydata";
    var parseLinks = resolveParseLinksFn();

    iteratePassages(function (p) {
      if (limit && count >= limit) return;
      count++;
      var name = passageName(p);
      var text = p.text || "";
      var tags = p.tags || [];
      nodes[name] = makeGraphNode(name, tags, false);
      var links = parseLinks(text);
      for (var i = 0; i < links.length; i++) {
        edges.push({
          from: name,
          to: links[i].target,
          label: links[i].label,
          type: links[i].type || "static",
        });
        ensureGraphNode(nodes, links[i].target);
      }
      var tagHints = parseTagNavigationHints(tags);
      for (var ti = 0; ti < tagHints.length; ti++) {
        if (!tagHints[ti].target) continue;
        edges.push({
          from: name,
          to: tagHints[ti].target,
          label: tagHints[ti].label,
          type: tagHints[ti].type || "tag-hint",
        });
        ensureGraphNode(nodes, tagHints[ti].target);
      }
    });
    var nodesArr = Object.keys(nodes).map(function (k) { return nodes[k]; });
    attachGraphDegrees(nodesArr, edges);
    return {
      nodes: nodesArr,
      edges: edges,
      truncated: limit ? count >= limit : false,
      startPassage: getStartPassageNameSafe(),
      format: family,
    };
  }

  function getStartPassageNameSafe() {
    try {
      if (AD && AD.getStartPassageName) return AD.getStartPassageName();
    } catch (e) { /* ignore */ }
    return null;
  }

  function getMediaInventory() {
    var map = {};
    iteratePassages(function (p) {
      var name = passageName(p);
      var refs = parseMediaRefs(p.text || "");
      for (var i = 0; i < refs.length; i++) {
        var resolved = resolveMediaUrl(refs[i].url);
        if (!map[resolved]) {
          map[resolved] = { url: resolved, original: refs[i].url, type: refs[i].type, passages: [] };
        }
        if (map[resolved].passages.indexOf(name) === -1) {
          map[resolved].passages.push(name);
        }
      }
    });
    var S = getSugarCube();
    if (S && S.setup) {
      try {
        var setupJson = JSON.stringify(S.setup);
        var setupRefs = parseMediaRefs(setupJson);
        for (var j = 0; j < setupRefs.length; j++) {
          var r = resolveMediaUrl(setupRefs[j].url);
          if (!map[r]) map[r] = { url: r, original: setupRefs[j].url, type: "setup", passages: ["[setup]"] };
        }
      } catch (e) { /* ignore */ }
    }
    var list = Object.keys(map).map(function (k) { return map[k]; });
    list.sort(function (a, b) { return a.url.localeCompare(b.url); });
    return list;
  }

  function getSetupSnapshot() {
    var S = getSugarCube();
    if (!S || !S.setup) return null;
    var out = {};
    Object.keys(S.setup).sort().forEach(function (k) {
      try {
        var v = S.setup[k];
        if (typeof v === "function") out[k] = "[Function]";
        else if (v && typeof v === "object") out[k] = JSON.parse(JSON.stringify(v));
        else out[k] = v;
      } catch (e) {
        out[k] = "[unreadable]";
      }
    });
    return out;
  }

  // Known-standard SugarCube macros — used to separate built-ins from game-authored ones.
  var SUGARCUBE_BUILTIN_MACROS = {
    set: 1, unset: 1, run: 1, script: 1, print: 1, "=": 1, "-": 1, silently: 1, "/silently": 1,
    display: 1, include: 1, nobr: 1, "/nobr": 1, if: 1, elseif: 1, else: 1, "/if": 1,
    for: 1, "/for": 1, break: 1, continue: 1, switch: 1, case: 1, default: 1, "/switch": 1,
    capture: 1, "/capture": 1, widget: 1, "/widget": 1, link: 1, "/link": 1, button: 1, "/button": 1,
    linkappend: 1, linkprepend: 1, linkreplace: 1, checkbox: 1, cycle: 1, listbox: 1, numberbox: 1,
    radiobutton: 1, textarea: 1, textbox: 1, option: 1, optionsfrom: 1, "/cycle": 1, "/listbox": 1,
    actions: 1, back: 1, choice: 1, "return": 1, addclass: 1, removeclass: 1, toggleclass: 1,
    copy: 1, remove: 1, append: 1, prepend: 1, replace: 1, timed: 1, "/timed": 1, next: 1,
    repeat: 1, "/repeat": 1, stop: 1, goto: 1, done: 1, redo: 1, type: 1, "/type": 1,
    audio: 1, cacheaudio: 1, createaudiogroup: 1, "/createaudiogroup": 1, track: 1,
    createplaylist: 1, "/createplaylist": 1, setplaylist: 1, playlist: 1, masteraudio: 1,
    removeaudiogroup: 1, removeplaylist: 1, waitforaudio: 1, remember: 1, forget: 1,
  };

  // Things game devs add on top of Twine/SugarCube: story JS/CSS, third-party
  // libraries, extra globals, external files. All checks are generic.
  var KNOWN_LIBRARIES = [
    { name: "jQuery", version: function () { return window.jQuery && window.jQuery.fn && window.jQuery.fn.jquery; } },
    { name: "Lodash", version: function () { return window._ && window._.VERSION; } },
    { name: "Underscore", version: function () { return window._ && !window._.VERSION && window._.throttle ? "detected" : null; } },
    { name: "LZString (save compression)", version: function () { return window.LZString ? "detected" : null; } },
    { name: "Howler (audio)", version: function () { return window.Howler ? "detected" : null; } },
    { name: "PIXI (2D rendering)", version: function () { return window.PIXI && window.PIXI.VERSION; } },
    { name: "Phaser (game engine)", version: function () { return window.Phaser && window.Phaser.VERSION; } },
    { name: "Three.js (3D)", version: function () { return window.THREE && window.THREE.REVISION ? "r" + window.THREE.REVISION : null; } },
    { name: "Vue", version: function () { return window.Vue && (window.Vue.version || "detected"); } },
    { name: "React", version: function () { return window.React && (window.React.version || "detected"); } },
    { name: "GSAP (animation)", version: function () { return window.gsap && (window.gsap.version || "detected"); } },
    { name: "anime.js", version: function () { return window.anime ? "detected" : null; } },
    { name: "moment.js", version: function () { return window.moment && (window.moment.version || "detected"); } },
    { name: "Day.js", version: function () { return window.dayjs ? "detected" : null; } },
    { name: "Chart.js", version: function () { return window.Chart && (window.Chart.version || "detected"); } },
    { name: "D3", version: function () { return window.d3 && (window.d3.version || "detected"); } },
    { name: "localForage (storage)", version: function () { return window.localforage ? "detected" : null; } },
    { name: "Dexie (IndexedDB)", version: function () { return window.Dexie && (window.Dexie.semVer || "detected"); } },
    { name: "marked (Markdown)", version: function () { return window.marked ? "detected" : null; } },
    { name: "CHATSYSTEM (chat macro)", version: function () { return typeof window.CHATSYSTEM === "function" ? (window.CHATSYSTEM.version || "detected") : null; } },
    { name: "MacroAPI/Customaudio", version: function () { return window.simpleaudio ? "detected" : null; } },
    { name: "FontAwesome (icons)", version: function () { return document.querySelector('link[href*="font-awesome"], link[href*="fontawesome"], .fa, .fas, .far') ? "detected" : null; } },
  ];

  function detectKnownLibraries() {
    var found = [];
    for (var i = 0; i < KNOWN_LIBRARIES.length; i++) {
      var v = null;
      try { v = KNOWN_LIBRARIES[i].version(); } catch (e) { v = null; }
      if (v) found.push({ name: KNOWN_LIBRARIES[i].name, version: String(v) });
    }
    return found;
  }

  function parseMacroAddCalls(jsText) {
    var names = {};
    var single = /Macro\.add\(\s*["']([^"']+)["']/g;
    var m;
    while ((m = single.exec(jsText)) !== null) names[m[1]] = true;
    // Array form: Macro.add(["a", "b"], …)
    var multi = /Macro\.add\(\s*\[([^\]]+)\]/g;
    while ((m = multi.exec(jsText)) !== null) {
      var inner = m[1];
      var item = /["']([^"']+)["']/g;
      var im;
      while ((im = item.exec(inner)) !== null) names[im[1]] = true;
    }
    return Object.keys(names).sort();
  }

  function getScriptInventory() {
    var inv = {
      storyScriptChars: 0,
      storyStyleChars: 0,
      macroAddNames: [],
      externalScripts: [],
      externalStyles: [],
      inlineScriptCount: 0,
      inlineScriptChars: 0,
      scriptTaggedPassages: [],
    };
    try {
      var storyJs = "";
      document.querySelectorAll('#twine-user-script, tw-storydata script, script[type="text/twine-javascript"]').forEach(function (s) {
        storyJs += (s.textContent || "") + "\n";
      });
      inv.storyScriptChars = storyJs.length;
      inv.macroAddNames = parseMacroAddCalls(storyJs);

      var storyCss = "";
      document.querySelectorAll('#twine-user-stylesheet, tw-storydata style, style[type="text/twine-css"]').forEach(function (s) {
        storyCss += (s.textContent || "") + "\n";
      });
      inv.storyStyleChars = storyCss.length;

      document.querySelectorAll("script[src]").forEach(function (s) {
        var src = s.getAttribute("src") || "";
        if (!src || src.indexOf("extension://") !== -1) return;
        inv.externalScripts.push(src.slice(0, 200));
      });
      document.querySelectorAll('link[rel="stylesheet"][href]').forEach(function (l) {
        inv.externalStyles.push((l.getAttribute("href") || "").slice(0, 200));
      });

      document.querySelectorAll("script:not([src])").forEach(function (s) {
        var t = s.getAttribute("type") || "";
        if (t && t !== "text/javascript" && t !== "module") return; // skip storydata/templates
        inv.inlineScriptCount++;
        inv.inlineScriptChars += (s.textContent || "").length;
        parseMacroAddCalls(s.textContent || "").forEach(function (n) {
          if (inv.macroAddNames.indexOf(n) === -1) inv.macroAddNames.push(n);
        });
      });
      inv.macroAddNames.sort();

      parseStorydataPassages().forEach(function (p) {
        if (p.tags && (p.tags.indexOf("script") !== -1 || p.tags.indexOf("stylesheet") !== -1)) {
          inv.scriptTaggedPassages.push({ name: p.name, tags: p.tags, chars: (p.text || "").length });
        }
      });
    } catch (e) {
      inv.error = String(e.message || e);
    }
    return inv;
  }

  // Diff window globals against a pristine same-origin frame — everything left
  // over was added by the game (or its libraries).
  function getCustomGlobals(limit) {
    var max = limit || 120;
    var baseline = {};
    var iframe = null;
    try {
      iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.setAttribute("aria-hidden", "true");
      document.documentElement.appendChild(iframe);
      Object.getOwnPropertyNames(iframe.contentWindow).forEach(function (n) {
        baseline[n] = true;
      });
    } catch (e) {
      return { error: String(e.message || e), globals: [] };
    } finally {
      if (iframe) iframe.remove();
    }

    var OWN = { TwineDevToolsAdapters: 1, TwineDevToolsState: 1 };
    // SugarCube's own debug/global exports — real page additions, but not
    // game-authored tech. Tagged so the UI can group them separately.
    var ENGINE_EXPORTS = {
      SugarCube: 1, Config: 1, Dialog: 1, Engine: 1, Fullscreen: 1, Has: 1, LoadScreen: 1,
      Macro: 1, Passage: 1, Save: 1, Serial: 1, Setting: 1, SimpleAudio: 1, State: 1,
      Story: 1, UI: 1, UIBar: 1, DebugBar: 1, Util: 1, Visibility: 1, Wikifier: 1,
      Browser: 1, Scripting: 1, SimpleStore: 1, settings: 1, setup: 1, session: 1,
      storage: 1, V: 1, T: 1, S: 1, TWINE1: 1, DEBUG: 1,
    };
    var LIB_GLOBALS = {
      jQuery: 1, $: 1, LZString: 1, FileSaver: 1, saveAs: 1, imagesLoaded: 1, idb: 1,
      _: 1, Howl: 1, Howler: 1, moment: 1, dayjs: 1, anime: 1, gsap: 1,
    };
    var globals = [];
    Object.getOwnPropertyNames(window).forEach(function (name) {
      if (globals.length >= max) return;
      if (baseline[name] || OWN[name]) return;
      if (/^(webkit|moz|on)/.test(name)) return;
      var v;
      try { v = window[name]; } catch (e) { return; }
      var t = typeof v;
      var preview = "";
      try {
        if (t === "function") preview = "function";
        else if (t === "object" && v) preview = Array.isArray(v) ? "Array(" + v.length + ")" : "object{" + Object.keys(v).slice(0, 5).join(",") + "}";
        else preview = String(v).slice(0, 60);
      } catch (e) { preview = "(unreadable)"; }
      var origin = ENGINE_EXPORTS[name] ? "engine" : LIB_GLOBALS[name] ? "library" : "game";
      globals.push({ name: name, type: t, preview: preview, origin: origin });
    });
    globals.sort(function (a, b) {
      // Game-authored first — that is what you came to see.
      var order = { game: 0, library: 1, engine: 2 };
      return (order[a.origin] - order[b.origin]) || a.name.localeCompare(b.name);
    });
    return { globals: globals, truncated: globals.length >= max };
  }

  // Generic runtime scan of SugarCube extension points that ANY game may use.
  // No game-specific names are assumed — we read SugarCube's own registries.
  // Script/library/global sections work for every story format.
  function getFormatTech() {
    var S = getSugarCube();

    var out = {
      supported: true,
      sugarcube: !!S,
      reason: S ? null : "SugarCube not detected — showing format-agnostic tech scan",
      customMacros: [],
      builtinMacroCount: 0,
      widgets: [],
      setupKeys: [],
      setupFunctions: [],
      windowClasses: [],
      settingsControls: [],
      config: null,
      libraries: detectKnownLibraries(),
      scripts: getScriptInventory(),
      customGlobals: getCustomGlobals(120),
    };

    if (!S) return out;

    // 1) Custom macros registered via Macro.add — SugarCube keeps them in Macro's registry.
    try {
      var M = S.Macro || window.Macro;
      var names = null;
      if (M) {
        if (typeof M.getNames === "function") names = M.getNames();
        else if (typeof M.get === "function" && M._macros) names = Object.keys(M._macros);
        else if (M._macros) names = Object.keys(M._macros);
      }
      if (names) {
        names.forEach(function (n) {
          var key = String(n).toLowerCase();
          if (SUGARCUBE_BUILTIN_MACROS[key]) {
            out.builtinMacroCount++;
            return;
          }
          var def = null;
          try { def = M.get ? M.get(n) : null; } catch (e) { /* ignore */ }
          out.customMacros.push({
            name: n,
            isWidget: !!(def && def.isWidget),
            hasHandler: !!(def && (def.handler || typeof def === "function")),
            tags: def && def.tags ? def.tags : null,
          });
        });
        out.customMacros.sort(function (a, b) { return a.name.localeCompare(b.name); });
      }
    } catch (e) { out.macroError = String(e.message || e); }

    // Registry enumeration is not public API in SugarCube 2 and often yields
    // nothing — merge in Macro.add(...) calls found in the story JavaScript.
    try {
      var alreadyMacro = {};
      out.customMacros.forEach(function (m) { alreadyMacro[String(m.name).toLowerCase()] = true; });
      ((out.scripts && out.scripts.macroAddNames) || []).forEach(function (n) {
        var mk = String(n).toLowerCase();
        if (SUGARCUBE_BUILTIN_MACROS[mk] || alreadyMacro[mk]) return;
        alreadyMacro[mk] = true;
        out.customMacros.push({ name: n, isWidget: false, hasHandler: true, tags: null, source: "story-js" });
      });
      out.customMacros.sort(function (a, b) { return a.name.localeCompare(b.name); });
    } catch (e) { /* ignore */ }

    // 2) Widgets — SugarCube stores widget definitions as macros flagged isWidget,
    //    but the generic authoring convention is passages tagged "widget".
    try {
      var widgetPassages = [];
      var passages = parseStorydataPassages();
      passages.forEach(function (p) {
        if (p.tags && p.tags.indexOf("widget") !== -1) {
          var wnames = [];
          var re = /<<widget\s+"?([A-Za-z0-9_$-]+)"?/g;
          var mm;
          while ((mm = re.exec(p.text)) !== null) wnames.push(mm[1]);
          widgetPassages.push({ passage: p.name, widgets: wnames });
        }
      });
      out.widgets = widgetPassages;
    } catch (e) { out.widgetError = String(e.message || e); }

    // 3) setup.* keys — the universal game-data namespace.
    try {
      if (S.setup) {
        Object.keys(S.setup).forEach(function (k) {
          var v = S.setup[k];
          var t = typeof v;
          if (t === "function") out.setupFunctions.push(k);
          else out.setupKeys.push({ key: k, type: Array.isArray(v) ? "array" : t, category: categorizeSetupKey(k) });
        });
        out.setupKeys.sort(function (a, b) { return a.key.localeCompare(b.key); });
        out.setupFunctions.sort();
      }
    } catch (e) { out.setupError = String(e.message || e); }

    // 4) Custom classes/helpers attached to window. Derived from the clean-frame
    //    baseline diff — browser built-ins (whose WebIDL prototypes have
    //    enumerable methods) never show up as false positives that way.
    try {
      ((out.customGlobals && out.customGlobals.globals) || []).forEach(function (g) {
        if (g.type !== "function" || !/^[A-Z]/.test(g.name) || g.origin !== "game") return;
        var v;
        try { v = window[g.name]; } catch (e) { return; }
        if (typeof v !== "function") return;
        var src = "";
        try { src = String(v).slice(0, 400); } catch (e2) { src = ""; }
        var protoNames = [];
        try {
          if (v.prototype) {
            protoNames = Object.getOwnPropertyNames(v.prototype).filter(function (m) { return m !== "constructor"; });
          }
        } catch (e3) { /* ignore */ }
        var isClass = /^class\s|_classCallCheck|this\./.test(src) || protoNames.length > 0;
        if (isClass) {
          out.windowClasses.push({ name: g.name, protoMethods: protoNames.slice(0, 20) });
        }
      });
      out.windowClasses.sort(function (a, b) { return a.name.localeCompare(b.name); });
    } catch (e) { out.windowError = String(e.message || e); }

    // 5) Config — SugarCube engine configuration object.
    try {
      var ConfigObj = S.Config || window.Config;
      if (ConfigObj) {
        out.config = {};
        Object.keys(ConfigObj).forEach(function (k) {
          try {
            var cv = ConfigObj[k];
            if (typeof cv === "function") out.config[k] = "[Function]";
            else if (cv && typeof cv === "object") {
              try { out.config[k] = JSON.parse(JSON.stringify(cv)); } catch (e2) { out.config[k] = "[object]"; }
            } else out.config[k] = cv;
          } catch (e3) {
            out.config[k] = "[unreadable]";
          }
        });
      }
    } catch (e) { out.configError = String(e.message || e); }

    // 6) Setting — player-facing toggles/lists registered via Setting.add*.
    try {
      var SettingObj = S.Setting || window.Setting;
      if (SettingObj) {
        if (SettingObj._list && Array.isArray(SettingObj._list)) {
          SettingObj._list.forEach(function (s) {
            var val = null;
            try { val = SettingObj.getValue(s.id); } catch (e4) { val = "[error]"; }
            out.settingsControls.push({
              id: s.id,
              name: s.name || s.id,
              type: s.type || "unknown",
              value: serializeForPanel(val),
              desc: s.desc || null,
            });
          });
        } else if (SettingObj._controls) {
          Object.keys(SettingObj._controls).forEach(function (id) {
            var ctrl = SettingObj._controls[id];
            var val = null;
            try { val = SettingObj.getValue(id); } catch (e5) { val = "[error]"; }
            out.settingsControls.push({
              id: id,
              name: ctrl.name || id,
              type: ctrl.type || "unknown",
              value: serializeForPanel(val),
              desc: ctrl.desc || null,
            });
          });
        }
      }
    } catch (e) { out.settingsError = String(e.message || e); }

    return out;
  }

  function isMapLike(value) {
    return (
      value instanceof Map ||
      (value != null &&
        typeof value === "object" &&
        typeof value.get === "function" &&
        typeof value.set === "function" &&
        typeof value.forEach === "function")
    );
  }

  function isSetLike(value) {
    return (
      value instanceof Set ||
      (value != null &&
        typeof value === "object" &&
        typeof value.add === "function" &&
        typeof value.has === "function" &&
        typeof value.forEach === "function" &&
        typeof value.get !== "function")
    );
  }

  function serializeForPanel(value, seen) {
    if (value === undefined) return { __twType: "undefined" };
    if (value === null) return null;
    if (typeof value === "function") {
      return {
        __twType: "Function",
        name: value.name || "anonymous",
        source: String(value).slice(0, 1200),
      };
    }
    if (typeof value === "symbol") {
      return { __twType: "Symbol", description: String(value) };
    }
    if (typeof value === "bigint") {
      return { __twType: "BigInt", value: value.toString() };
    }
    if (value instanceof Date) {
      return { __twType: "Date", iso: value.toISOString() };
    }
    if (value instanceof RegExp) {
      return { __twType: "RegExp", source: value.source, flags: value.flags };
    }
    if (typeof value !== "object") return value;

    if (!seen) seen = new WeakSet();
    if (seen.has(value)) return { __twType: "Circular" };
    seen.add(value);
    try {
      if (isMapLike(value)) {
        var mapEntries = [];
        try {
          value.forEach(function (v, k) {
            mapEntries.push([String(k), serializeForPanel(v, seen)]);
          });
        } catch (e) {
          return { __twType: "Map", entries: [], error: String(e.message || e) };
        }
        return { __twType: "Map", entries: mapEntries };
      }
      if (isSetLike(value)) {
        var setValues = [];
        try {
          value.forEach(function (v) {
            setValues.push(serializeForPanel(v, seen));
          });
        } catch (e) {
          return { __twType: "Set", values: [], error: String(e.message || e) };
        }
        return { __twType: "Set", values: setValues };
      }
      if (Array.isArray(value)) {
        return value.map(function (item) {
          return serializeForPanel(item, seen);
        });
      }
      var out = {};
      Object.keys(value).forEach(function (k) {
        try {
          out[k] = serializeForPanel(value[k], seen);
        } catch (e) {
          out[k] = { __twType: "Error", message: String(e.message || e) };
        }
      });
      return out;
    } finally {
      seen.delete(value);
    }
  }

  function cloneForPostMessage(value) {
    if (value === undefined) return null;
    // serializeForPanel output is already plain JSON-safe data; postMessage
    // structured-clones it, so the old JSON.parse(JSON.stringify(...)) round
    // trip only doubled the cost on large states.
    return serializeForPanel(value);
  }

  function getVariables() {
    var detected = detectEngine();
    if (!detected) return null;
    var data = getLiveVariableStore();
    return {
      expr: detected.profile.variablesExpr,
      data: data ? serializeForPanel(data) : serializeForPanel(detected.variables),
    };
  }

  var ST = window.TwineDevToolsState;
  var differ = ST ? ST.createDiffer() : null;

  function getMutableStateRoot() {
    var live = getLiveVariableStore();
    if (!live) throw new Error("No variable store");
    return live;
  }

  function setAtPath(pathParts, value) {
    var root = getMutableStateRoot();
    if (ST) ST.setStateAtPath(root, pathParts, value);
    else throw new Error("State utils unavailable");
  }

  var propertyLocker = ST
    ? ST.createPropertyLocker(getMutableStateRoot, setAtPath)
    : null;

  var diffTracker = {
    enabled: false,
    intervalId: null,
    lastSnapshot: null,
    frames: [],
    maxFrames: 150,
    pollMs: 500,
  };

  function cloneStateSnapshot() {
    var live = getLiveVariableStore();
    if (!live || !ST) return null;
    return ST.cloneValue(live);
  }

  function startDiffTracking(args) {
    if (!differ || !ST) return { ok: false, reason: "State utils not loaded" };
    var cap = getCapabilities();
    if (cap && cap.diff === false) return { ok: false, reason: "Diff not available for this format" };
    if (diffTracker.intervalId) clearInterval(diffTracker.intervalId);
    diffTracker.enabled = true;
    diffTracker.frames = [];
    diffTracker.pollMs = (args && args.intervalMs) || 500;
    diffTracker.lastSnapshot = cloneStateSnapshot();
    diffTracker.intervalId = setInterval(pollDiffFrame, diffTracker.pollMs);
    return { ok: true };
  }

  function stopDiffTracking() {
    diffTracker.enabled = false;
    if (diffTracker.intervalId) {
      clearInterval(diffTracker.intervalId);
      diffTracker.intervalId = null;
    }
    return { ok: true };
  }

  function supportsLiveStateLocks() {
    var adapter = getAdapter();
    return adapter && (adapter.family === "sugarcube" || adapter.family === "snowman");
  }

  function pollDiffFrame() {
    if (!diffTracker.enabled || !differ || !ST) return;
    try {
      if (propertyLocker && supportsLiveStateLocks()) propertyLocker.applyLocks();
      var current = cloneStateSnapshot();
      if (!current || !diffTracker.lastSnapshot) {
        diffTracker.lastSnapshot = current;
        return;
      }
      var meta = readMeta();
      var rawDiffs = differ.diff(diffTracker.lastSnapshot, current);
      var diffs = propertyLocker && supportsLiveStateLocks()
        ? propertyLocker.processDiffs(rawDiffs)
        : rawDiffs;
      if (propertyLocker && supportsLiveStateLocks() && rawDiffs.length !== diffs.length) {
        current = cloneStateSnapshot();
      }
      if (diffs.length) {
        diffTracker.frames.push({
          ts: Date.now(),
          passage: meta ? meta.passage : null,
          diffs: diffs,
        });
        if (diffTracker.frames.length > diffTracker.maxFrames) {
          diffTracker.frames.shift();
        }
      }
      diffTracker.lastSnapshot = current;
    } catch (e) {
      /* page may be reloading */
    }
  }

  function getDiffLog(args) {
    var limit = (args && args.limit) || 80;
    return {
      tracking: diffTracker.enabled,
      frames: diffTracker.frames.slice(-limit).reverse(),
      frameCount: diffTracker.frames.length,
    };
  }

  function clearDiffLog() {
    diffTracker.frames = [];
    diffTracker.lastSnapshot = cloneStateSnapshot();
    return { ok: true };
  }

  function setPathLock(args) {
    if (!supportsLiveStateLocks()) {
      throw new Error("Variable locks are only supported for SugarCube and Snowman");
    }
    if (!propertyLocker || !ST) throw new Error("Locking unavailable");
    var path = normalizePath(args.path);
    propertyLocker.setLock(path, !!args.locked);
    if (args.locked) propertyLocker.applyLocks();
    return { lockedPaths: propertyLocker.getLockedPaths() };
  }

  function getLockedPaths() {
    return propertyLocker ? propertyLocker.getLockedPaths() : [];
  }

  function clearPathLocks() {
    if (propertyLocker) propertyLocker.clearLocks();
    return { ok: true };
  }

  function deleteStateProperty(args) {
    var adapter = getAdapter();
    var path = normalizePath(args.path);
    if (adapter && adapter.deleteStateProperty) return adapter.deleteStateProperty(path);
    var root = getLiveVariableStore();
    if (ST && root) ST.deleteFromState(root, path);
    return { ok: true };
  }

  function addStateProperty(args) {
    var adapter = getAdapter();
    var parentPath = normalizePath(args.parentPath || []);
    var val = parseValue(args.value, args.type || "string");
    if (adapter && adapter.addStateProperty) {
      return adapter.addStateProperty(parentPath, args.key, val);
    }
    var root = getLiveVariableStore();
    if (ST && root) ST.addStateProperty(root, parentPath, args.key, val);
    return { ok: true };
  }

  function duplicateStateProperty(args) {
    var adapter = getAdapter();
    var parentPath = normalizePath(args.parentPath);
    if (adapter && adapter.duplicateStateProperty) {
      return adapter.duplicateStateProperty(parentPath, args.sourceKey, args.targetKey || args.sourceKey + "_copy");
    }
    var root = getLiveVariableStore();
    if (ST) ST.duplicateStateProperty(root, parentPath, args.sourceKey, args.targetKey || args.sourceKey + "_copy");
    return { ok: true };
  }

  function setPassageSource(args) {
    var name = args.name;
    var source = args.source;
    if (!name) throw new Error("Passage name required");
    var adapter = getAdapter();
    if (adapter && adapter.setPassageSource) {
      adapter.setPassageSource(name, source, args.tags);
      invalidatePassageCaches();
      return { ok: true };
    }
    throw new Error("Passage editing not supported for this format");
  }

  function globalSearch(args) {
    var query = (args && args.query || "").trim();
    if (!query) return { state: [], passages: [] };
    var limit = (args && args.limit) || 60;

    var stateResults = [];
    var live = getLiveVariableStore();
    if (live && ST) ST.searchState(live, query, [], stateResults, limit);

    var passageResults = [];
    var lq = query.toLowerCase();
    iteratePassages(function (p) {
      if (passageResults.length >= limit) return;
      var name = passageName(p);
      var text = p.text || "";
      var tags = (p.tags || []).join(" ");
      if (
        name.toLowerCase().includes(lq) ||
        text.toLowerCase().includes(lq) ||
        tags.toLowerCase().includes(lq)
      ) {
        passageResults.push({
          name: name,
          tags: p.tags || [],
          snippet: text.slice(0, 160).replace(/\s+/g, " "),
        });
      }
    });

    return { state: stateResults.slice(0, limit), passages: passageResults };
  }

  function parseValue(value, type) {
    switch (type) {
      case "number":
      case "bigint":
        return parseFloat(value);
      case "boolean":
        return value === true || value === "true";
      case "null":
        return null;
      default:
        return String(value);
    }
  }

  function valueToExpression(type, value) {
    switch (type) {
      case "number":
      case "bigint":
        return String(parseFloat(value));
      case "boolean":
        return value === true || value === "true" ? "true" : "false";
      case "null":
        return "null";
      case "string":
        return JSON.stringify(String(value));
      default:
        return JSON.stringify(String(value));
    }
  }

  function buildSetExpression(rootExpr, pathParts) {
    var expr = rootExpr;
    for (var i = 0; i < pathParts.length; i++) {
      var part = String(pathParts[i]);
      if (/^\d+$/.test(part)) {
        expr += "[" + part + "]";
      } else if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(part)) {
        expr += "." + part;
      } else {
        expr += "[" + JSON.stringify(part) + "]";
      }
    }
    return expr;
  }

  function normalizePath(pathParts) {
    if (Array.isArray(pathParts)) return pathParts;
    if (typeof pathParts === "string") return pathParts.split(".").filter(Boolean);
    throw new Error("Invalid variable path");
  }

  function setVariable(pathParts, value, type, isTemp) {
    var adapter = getAdapter();
    pathParts = normalizePath(pathParts);
    if (!pathParts.length) throw new Error("Empty path");

    if (adapter && adapter.setVariable) {
      try {
        return adapter.setVariable(pathParts, value, type, isTemp);
      } catch (e) {
        if (adapter.family === "harlowe") throw e;
      }
    }

    var detected = detectEngine();
    if (!detected) throw new Error("No engine");

    var parsed = parseValue(value, type);

    if (detected.profile.family === "harlowe") {
      throw new Error("Harlowe variables cannot be edited via this panel");
    }

    var S = getSugarCube();
    var store = isTemp && S && S.State ? S.State.temporary : getLiveVariableStore();

    if (S && S.State && typeof S.State.setVar === "function" && pathParts.length === 1 && !isTemp) {
      if (S.State.setVar("$" + pathParts[0], parsed)) {
        return { ok: true, method: "State.setVar" };
      }
    }

    if (ST && store) {
      try {
        ST.setStateAtPath(store, pathParts, parsed);
        return { ok: true, method: "setStateAtPath" };
      } catch (e) {
        /* fall through */
      }
    }

    if (detected.profile.variablesExpr) {
      var assignExpr = buildSetExpression(
        isTemp ? "SugarCube.State.temporary" : detected.profile.variablesExpr,
        pathParts
      ) + "=" + valueToExpression(type, value);
      /* eslint-disable no-eval */
      eval(assignExpr);
      return { ok: true, method: "eval", expression: assignExpr };
    }

    throw new Error("Cannot set variable");
  }

  function goToPassage(name) {
    var adapter = getAdapter();
    if (adapter && adapter.goToPassage) {
      return adapter.goToPassage(name);
    }
    var S = getSugarCube();
    if (!S) return false;
    if (S.Engine && S.Engine.play) {
      S.Engine.play(name);
      return true;
    }
    if (S.play) {
      S.play(name);
      return true;
    }
    return false;
  }

  function getTempVariables() {
    var adapter = getAdapter();
    if (!adapter || adapter.capabilities.tempVariables !== "full") {
      return { supported: false, data: null };
    }
    var S = getSugarCube();
    if (!S || !S.State || !S.State.temporary) {
      return { supported: false, data: null };
    }
    return {
      supported: true,
      expr: "SugarCube.State.temporary",
      data: serializeForPanel(S.State.temporary),
    };
  }

  function restoreHistoryMoment(args) {
    var adapter = getAdapter();
    if (!adapter || !adapter.restoreHistory) {
      throw new Error("History restore not supported for this format");
    }
    return adapter.restoreHistory(args.index);
  }

  function getStoryAnalysis() {
    var adapter = getAdapter();
    var family = adapter ? adapter.family : "storydata";
    if (AD && AD.runStoryAnalysis) return AD.runStoryAnalysis(family);
    return { passageCount: 0, brokenLinks: [], orphanPassages: [], deadEnds: [], unreachable: [] };
  }

  function getCapabilities() {
    detectEngine();
    return activeCapabilities || (getAdapter() && getAdapter().capabilities) || {};
  }

  function exportTweeDocument() {
    if (AD && AD.exportTwee) return AD.exportTwee();
    return "";
  }

  function evalCode(code) {
    /* eslint-disable no-eval */
    return eval(code);
  }

  function getLinkAnalysis() {
    var meta = readMeta();
    if (!meta || !meta.passage) return null;
    var detail = getPassageDetail(meta.passage);
    var domLinks = getCurrentDomLinks();
    var analysis = [];
    var seen = {};
    if (detail) {
      for (var i = 0; i < detail.links.length; i++) {
        var link = detail.links[i];
        var targetDetail = getPassageDetail(link.target);
        var domMatch = null;
        for (var j = 0; j < domLinks.length; j++) {
          if (domLinks[j].target === link.target) domMatch = domLinks[j];
        }
        var item = {
          label: link.label,
          target: link.target,
          type: link.type,
          targetExists: !!targetDetail,
          targetSets: targetDetail ? targetDetail.setMacros : [],
          targetIfs: targetDetail ? targetDetail.ifMacros : [],
          targetVarRefs: targetDetail ? targetDetail.varRefs : [],
          inDom: !!domMatch,
          domHidden: domMatch ? domMatch.hidden : null,
          domLabel: domMatch ? domMatch.label : null,
          sourceIfs: detail.ifMacros,
          sourceVarRefs: detail.varRefs,
        };
        analysis.push(item);
        seen[link.target + "|" + link.label] = true;
      }
    }
    for (var k = 0; k < domLinks.length; k++) {
      var d = domLinks[k];
      var sk = (d.target || d.setter || d.label) + "|" + d.label;
      if (!seen[sk]) {
        seen[sk] = true;
        analysis.push({
          label: d.label,
          target: d.target || (d.inPlace ? "(same passage)" : ""),
          type: d.type || "dom-only",
          setter: d.setter || "",
          inPlace: !!d.inPlace,
          targetExists: d.target ? !!getPassage(d.target) : false,
          inDom: true,
          domHidden: d.hidden,
          domLabel: d.label,
          sourceIfs: detail ? detail.ifMacros : [],
        });
      }
    }
    return { passage: meta.passage, conditions: detail ? detail.ifMacros : [], links: analysis };
  }

  function getValueAtPath(root, pathStr) {
    var parts = pathStr.replace(/^\$/, "").split(".");
    var cur = root;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function getWatchSnapshot(paths) {
    return (paths || []).map(function (p) {
      return { path: p, value: readStoryVar(p) };
    });
  }

  function clearHighlights() {
    document.querySelectorAll("." + HL_CLASS).forEach(function (n) { n.remove(); });
  }

  function highlightElement(selector) {
    clearHighlights();
    var el;
    try { el = document.querySelector(selector); } catch (e) { return { ok: false, error: "Invalid selector" }; }
    if (!el) return { ok: false, error: "Element not found" };
    var r = el.getBoundingClientRect();
    var box = document.createElement("div");
    box.className = HL_CLASS;
    box.style.cssText = "position:fixed;pointer-events:none;border:2px solid #3794ff;background:rgba(55,148,255,0.2);z-index:2147483645;left:" +
      r.left + "px;top:" + r.top + "px;width:" + r.width + "px;height:" + r.height + "px;border-radius:3px";
    document.documentElement.appendChild(box);
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    return { ok: true };
  }

  function getDomInspection() {
    var items = [];
    var root = getPassageContentRoot();

    collectDomLinks(root).forEach(function (d) {
      if (items.length >= 200) return;
      items.push({
        type: d.type || "link",
        family: "sugarcube",
        label: d.label,
        hidden: d.hidden,
        selector: d.selector,
        passage: d.target || null,
        setter: d.setter || "",
        inPlace: !!d.inPlace,
        tag: d.tag || "",
      });
    });

    var selectors = [
      { sel: "tw-link", type: "link", family: "harlowe" },
      { sel: 'tw-expression[type="variable"]', type: "variable", family: "harlowe" },
      { sel: ".macro-variable, [data-macro]", type: "macro", family: "sugarcube" },
      { sel: "#passages img, tw-passage img", type: "image", family: "any" },
      { sel: "[style*='display: none'], [style*='display:none'], .link-disabled", type: "hidden", family: "any" },
    ];

    var seenSelectors = {};
    items.forEach(function (it) {
      if (it.selector) seenSelectors[it.selector] = true;
    });

    for (var s = 0; s < selectors.length; s++) {
      var def = selectors[s];
      var nodes;
      try { nodes = root.querySelectorAll(def.sel); } catch (e) { continue; }
      for (var i = 0; i < nodes.length && items.length < 200; i++) {
        var el = nodes[i];
        var selector = uniqueSelector(el);
        if (seenSelectors[selector]) continue;
        seenSelectors[selector] = true;
        var style = window.getComputedStyle(el);
        var hidden = style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) === 0;
        var label = getDirectText(el).slice(0, 80) ||
          el.getAttribute("data-passage") || el.getAttribute("name") || el.tagName.toLowerCase();
        items.push({
          type: def.type,
          family: def.family,
          label: label,
          hidden: hidden,
          selector: selector,
          passage: readPassageTargetFromElement(el),
          setter: readSetterFromElement(el) || "",
          inPlace: false,
          tag: el.tagName ? el.tagName.toLowerCase() : "",
        });
      }
    }
    return items;
  }

  function escCssIdent(s) {
    if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function uniqueSelector(el) {
    if (el.id) return "#" + escCssIdent(el.id);
    if (el.getAttribute("data-passage")) return '[data-passage="' + el.getAttribute("data-passage").replace(/"/g, '\\"') + '"]';
    if (el.getAttribute("name")) return el.tagName.toLowerCase() + '[name="' + el.getAttribute("name").replace(/"/g, '\\"') + '"]';
    var path = [];
    var cur = el;
    while (cur && cur.nodeType === 1 && path.length < 4) {
      var part = cur.tagName.toLowerCase();
      if (cur.id) { path.unshift("#" + escCssIdent(cur.id)); break; }
      var parent = cur.parentElement;
      if (parent) {
        var siblings = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === cur.tagName; });
        if (siblings.length > 1) {
          part += ":nth-of-type(" + (siblings.indexOf(cur) + 1) + ")";
        }
      }
      path.unshift(part);
      cur = cur.parentElement;
    }
    return path.join(" > ");
  }

  function chatConversationId(from, withNames) {
    var arr = [from].concat(withNames || []);
    return arr.sort().join("_").toLowerCase();
  }

  function detectChatSystem() {
    var S = getSugarCube();
    var hasGlobal = typeof window.CHATSYSTEM === "function";
    var hasSetup = false;
    var options = null;
    if (S && S.setup && S.setup["@CHATSYSTEM/Options"]) {
      hasSetup = true;
      try {
        options = JSON.parse(JSON.stringify(S.setup["@CHATSYSTEM/Options"]));
      } catch (e) { /* ignore */ }
    }
    var chatData = null;
    if (S && S.State && S.State.active && S.State.active.variables) {
      chatData = S.State.active.variables.chatsystem;
    }
    var hasVar = !!(chatData && typeof chatData === "object" && Object.keys(chatData).length);
    return {
      detected: !!(hasGlobal || hasVar || hasSetup),
      hasGlobal: hasGlobal,
      hasVar: hasVar,
      hasSetup: hasSetup,
      version: hasGlobal && window.CHATSYSTEM.version ? window.CHATSYSTEM.version : null,
      options: options,
      conversationCount: chatData && typeof chatData === "object" ? Object.keys(chatData).length : 0,
    };
  }

  function serializeChatMsg(msg) {
    return {
      id: msg.id,
      from: msg.from,
      to: msg.to,
      text: typeof msg.text === "string" ? msg.text.replace(/<[^>]+>/g, " ").trim().slice(0, 500) : "",
      textHtml: typeof msg.text === "string" ? msg.text.slice(0, 1000) : "",
      date: msg.date instanceof Date ? msg.date.toISOString() : (msg.date || null),
      title: msg.title || null,
    };
  }

  function parseChatCurrConditions(text) {
    var conditions = [];
    var re = /<<if\s+([^>]+?)>>/gi;
    var m;
    while ((m = re.exec(text))) {
      var cond = m[1].trim();
      if (/_curr/.test(cond)) conditions.push(cond);
    }
    return conditions;
  }

  function parsePassageChatHints(text) {
    var hints = { macros: [], conversations: [] };
    var macroRe = /<<\s*(msg-delete|msg|history|chat-delete|chat)\b/gi;
    var m;
    while ((m = macroRe.exec(text))) {
      var name = m[1].toLowerCase();
      if (hints.macros.indexOf(name) === -1) hints.macros.push(name);
    }
    var chatRe = /<<\s*chat\b([^>]*)>>/gi;
    while ((m = chatRe.exec(text))) {
      var block = m[0];
      var fromM = block.match(/\bfrom\s+["']?([^"'\s]+)/i);
      var withM = block.match(/\bwith\s+([^">]+)/i);
      var withParts = withM ? withM[1].trim().split(/\s+and\s+/i) : [];
      hints.conversations.push({
        from: fromM ? fromM[1] : null,
        with: withParts,
        id: fromM && withParts.length ? chatConversationId(fromM[1], withParts) : null,
      });
    }
    return hints;
  }

  function getChatSystemInspector() {
    var info = detectChatSystem();
    if (!info.detected) return { detected: false };

    var S = getSugarCube();
    var chatData = {};
    var tempCurr = null;
    if (S && S.State) {
      if (S.State.active && S.State.active.variables && S.State.active.variables.chatsystem) {
        chatData = S.State.active.variables.chatsystem;
      }
      if (S.State.temporary && typeof S.State.temporary.curr !== "undefined") {
        tempCurr = S.State.temporary.curr;
      }
    }

    var domConversationId = null;
    var seq = document.querySelector(".chat_sequence");
    if (seq && seq.id) domConversationId = seq.id;

    var responseLinks = [];
    var resp = document.querySelector(".chat_response");
    if (resp) {
      var els = resp.querySelectorAll("a, button, .link-internal, [data-passage]");
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var style = window.getComputedStyle(el);
        var hidden =
          style.display === "none" ||
          style.visibility === "hidden" ||
          Number(style.opacity) === 0 ||
          el.classList.contains("link-disabled");
        responseLinks.push({
          label: (el.textContent || "").trim().slice(0, 120),
          hidden: hidden,
          tag: el.tagName.toLowerCase(),
        });
      }
    }

    var conversations = Object.keys(chatData || {}).map(function (name) {
      var msgs = chatData[name];
      if (!Array.isArray(msgs)) {
        return { id: name, messages: [], messageCount: 0, lastId: 0 };
      }
      return {
        id: name,
        messageCount: msgs.length,
        lastId: msgs.length ? msgs[msgs.length - 1].id : 0,
        messages: msgs.map(serializeChatMsg),
      };
    });

    return {
      detected: true,
      version: info.version,
      options: info.options,
      tempCurr: tempCurr,
      domConversationId: domConversationId,
      responseLinks: responseLinks,
      conversations: conversations,
    };
  }

  function getChatBranchDebug() {
    var inspector = getChatSystemInspector();
    if (!inspector.detected) return { detected: false };

    var meta = readMeta();
    var passage = meta ? meta.passage : null;
    var detail = passage ? getPassageDetail(passage) : null;
    var text = detail ? detail.text : "";
    var chatBlockMatch = text.match(/<<\s*chat\b[\s\S]*?>>([\s\S]*?)<<\/\s*chat\s*>>/i);
    var chatPayload = chatBlockMatch ? chatBlockMatch[1] : text;
    var payloadConditions = parseChatCurrConditions(chatPayload);
    var currConditions = payloadConditions.length ? payloadConditions : parseChatCurrConditions(text);

    return {
      detected: true,
      passage: passage,
      tempCurr: inspector.tempCurr,
      domConversationId: inspector.domConversationId,
      currConditions: currConditions,
      responseLinks: inspector.responseLinks,
      hints: detail ? parsePassageChatHints(text) : null,
    };
  }

  function chatSystemSetCurr(args) {
    var S = getSugarCube();
    if (!S || !S.State) throw new Error("SugarCube State not available");
    S.State.temporary.curr = args.value;
    return S.State.temporary.curr;
  }

  function chatSystemAction(args) {
    if (typeof window.CHATSYSTEM !== "function") {
      throw new Error("CHATSYSTEM not loaded on this page");
    }
    var action = args.action;
    var name = args.conversationId;
    if (action === "addMsg") {
      window.CHATSYSTEM.addMsg(name, args.message);
      return true;
    }
    if (action === "deleteMsg") {
      window.CHATSYSTEM.deleteMsg(name, args.messageId);
      return true;
    }
    if (action === "deleteChat") {
      window.CHATSYSTEM.deleteChat(name);
      return true;
    }
    throw new Error("Unknown chat action: " + action);
  }

  function getBrowserStorage(args) {
    var filter = args && args.filter ? String(args.filter).toLowerCase() : "";

    function collect(storage, type) {
      var out = [];
      try {
        for (var i = 0; i < storage.length; i++) {
          var key = storage.key(i);
          var val = storage.getItem(key) || "";
          if (filter && key.toLowerCase().indexOf(filter) === -1) continue;
          out.push({
            key: key,
            size: val.length,
            preview: val.slice(0, 160),
            type: type,
          });
        }
      } catch (e) { /* private mode / blocked */ }
      out.sort(function (a, b) { return a.key.localeCompare(b.key); });
      return out;
    }

    return {
      origin: location.origin,
      local: collect(localStorage, "local"),
      session: collect(sessionStorage, "session"),
    };
  }

  function setBrowserStorageKey(args) {
    var storage = args.storageType === "session" ? sessionStorage : localStorage;
    storage.setItem(args.key, args.value);
    return true;
  }

  function deleteBrowserStorageKey(args) {
    var storage = args.storageType === "session" ? sessionStorage : localStorage;
    storage.removeItem(args.key);
    return true;
  }

  function getSaveSlots() {
    var S = getSugarCube();
    if (!S || !S.Save || !S.Save.browser) {
      return { supported: false, reason: "Save API not available (SugarCube 2.37+)" };
    }
    var out = { supported: true, auto: [], slots: [], bundleAvailable: false };
    try {
      if (S.Save.browser.auto && S.Save.browser.auto.entries) {
        out.auto = S.Save.browser.auto.entries().map(function (e) {
          return {
            index: e.index,
            desc: e.info.desc,
            date: e.info.date,
            dateStr: new Date(e.info.date).toLocaleString(),
            id: e.info.id,
            metadata: e.info.metadata,
          };
        });
      }
      if (S.Save.browser.slot && S.Save.browser.slot.entries) {
        out.slots = S.Save.browser.slot.entries().map(function (e) {
          return {
            index: e.index,
            desc: e.info.desc,
            date: e.info.date,
            dateStr: new Date(e.info.date).toLocaleString(),
            id: e.info.id,
            metadata: e.info.metadata,
          };
        });
      }
      out.bundleAvailable = !!(S.Save.base64 && S.Save.base64.export);
      out.totalSize = S.Save.browser.size;
    } catch (e) {
      out.error = e.message || String(e);
    }
    return out;
  }

  function decodeSaveBundle() {
    var S = getSugarCube();
    if (!S || !S.Save || !S.Save.base64 || !S.Save.base64.export) {
      throw new Error("Save.base64.export not available");
    }
    var bundle = S.Save.base64.export();
    var decoded = null;
    if (typeof LZString !== "undefined" && LZString.decompressFromBase64) {
      decoded = LZString.decompressFromBase64(bundle);
    } else {
      try { decoded = atob(bundle); } catch (e) { decoded = bundle; }
    }
    var data = null;
    try { data = JSON.parse(decoded); } catch (e) {
      return { raw: decoded ? decoded.slice(0, 5000) : null, parseError: e.message };
    }
    var preview = [];
    if (data && data.saves) {
      data.saves.forEach(function (save, idx) {
        var moment = save.state && save.state.history && save.state.history[save.state.index];
        preview.push({
          index: idx,
          desc: save.desc,
          date: save.date,
          dateStr: new Date(save.date).toLocaleString(),
          passage: moment ? moment.title : null,
          variableCount: moment && moment.variables ? Object.keys(moment.variables).length : 0,
          variables: moment && moment.variables ? moment.variables : null,
        });
      });
    }
    return { saveCount: preview.length, saves: preview };
  }

  function getGraphForVisual(args) {
    var center = args && args.center;
    var depth = (args && args.depth) || 2;
    var full = args && args.full;
    var includeDom = args && args.includeDom !== false;
    var tagCategory = args && args.tagCategory;
    var locationHubsOnly = !!(args && args.locationHubsOnly);

    function nodeMatchesFilter(node) {
      if (!node) return false;
      if (locationHubsOnly && !node.isLocationHub) return false;
      if (tagCategory) {
        var cats = node.tagCategories || [];
        if (cats.indexOf(tagCategory) === -1) return false;
      }
      return true;
    }

    if (full) {
      var fullGraph = getStoryGraph(0);
      if (!tagCategory && !locationHubsOnly) return fullGraph;
      var allowed = {};
      fullGraph.nodes.forEach(function (n) {
        if (nodeMatchesFilter(n)) allowed[n.id] = true;
      });
      if (center && !allowed[center]) allowed[center] = true;
      return {
        nodes: fullGraph.nodes.filter(function (n) { return allowed[n.id]; }),
        edges: fullGraph.edges.filter(function (e) { return allowed[e.from] && allowed[e.to]; }),
        center: center || null,
        filtered: true,
      };
    }

    if (!center) {
      var metaStart = readMeta();
      center = metaStart && metaStart.passage;
    }
    if (!center) return { nodes: [], edges: [] };

    // Targeted BFS — only parse the passages actually visited. This keeps the
    // neighborhood map fast even on 5000+ passage stories.
    var parseLinksFn = resolveParseLinksFn();
    var nodesMap = {};
    var edgeSet = [];
    var edgeKeys = {};

    function addEdge(from, to, label, type) {
      var key = from + "→" + to + "|" + (type || "");
      if (edgeKeys[key]) return;
      edgeKeys[key] = true;
      ensureGraphNode(nodesMap, to);
      edgeSet.push({ from: from, to: to, label: label || to, type: type || "static" });
    }

    function outgoingOf(name) {
      var p = getPassage(name);
      if (!p) return [];
      var text = p.text || "";
      var out = parseLinksFn(text).map(function (l) {
        return { to: l.target, label: l.label, type: l.type || "static" };
      });
      parseTagNavigationHints(p.tags || []).forEach(function (h) {
        if (h.target) out.push({ to: h.target, label: h.label, type: h.type || "tag-hint" });
      });
      return out;
    }

    ensureGraphNode(nodesMap, center);
    var visited = {};
    visited[center] = true;
    var q = [{ id: center, d: 0 }];
    var guard = 0;
    while (q.length && guard < 5000) {
      var cur = q.shift();
      if (cur.d >= depth) continue;
      guard++;
      outgoingOf(cur.id).forEach(function (link) {
        addEdge(cur.id, link.to, link.label, link.type);
        if (cur.d + 1 < depth && !visited[link.to]) {
          visited[link.to] = true;
          q.push({ id: link.to, d: cur.d + 1 });
        }
      });
    }

    if (includeDom) {
      var metaNow = readMeta();
      if (metaNow && metaNow.passage === center) {
        getCurrentDomLinks().forEach(function (d) {
          if (d.target) addEdge(center, d.target, d.label || d.target, d.type === "inline-link" ? "dom-inline" : "dom-live");
        });
      }
    }

    var nodesOut = Object.keys(nodesMap).map(function (k) { return nodesMap[k]; });
    if (tagCategory || locationHubsOnly) {
      nodesOut = nodesOut.filter(function (n) { return n.id === center || nodeMatchesFilter(n); });
      var allowedIds = {};
      nodesOut.forEach(function (n) { allowedIds[n.id] = true; });
      edgeSet = edgeSet.filter(function (e) { return allowedIds[e.from] && allowedIds[e.to]; });
    }
    attachGraphDegrees(nodesOut, edgeSet);

    return {
      nodes: nodesOut,
      edges: edgeSet,
      center: center,
      filtered: !!(tagCategory || locationHubsOnly),
    };
  }

  // ---- Generic entity/People registry detection -------------------------
  // Finds state containers holding many same-shaped objects that look like
  // characters/NPCs/items. Purely structural + name-pattern based, so it works
  // on any SugarCube game ($people, $npcs, $girls, $characters, $monsters…).
  var ENTITY_REGISTRY_KEY_HINT = /peopl|persons?|npcs?|characters?|\bchars?\b|cast|actors?|contacts?|girls?|guys?|students?|residents?|monsters?|companions?|crew|roster|dramatis|cast|waifus?|slaves?|servants?|followers?|party/i;
  var ENTITY_MET_KEYS = /^(known|met|introduced|seen|discovered|unlocked|recruited|active|alive|gender_known|name_known|nameknown|majorknown|partnerknown|available|encountered|visible)$/i;
  var ENTITY_REL_KEYS = /relationship|attitude|friendship|lust|love|affection|trust|romance|corruption|arousal|attraction|respect|rapport|bond|affinity|dating|obedience|devotion|fear|hate|jealous|mood|disposition/i;

  function looksLikeEntity(obj) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return 0;
    var keys = Object.keys(obj);
    if (!keys.length || keys.length > 200) return 0;
    var lower = keys.map(function (k) { return k.toLowerCase(); });
    var score = 0;
    if (lower.some(function (k) { return ENTITY_NAME_KEYS.indexOf(k) !== -1; })) score += 2;
    var relHits = lower.filter(function (k) { return ENTITY_REL_KEYS.test(k); }).length;
    score += Math.min(relHits, 4) * 2;
    if (lower.some(function (k) { return ENTITY_MET_KEYS.test(k); })) score += 1;
    var statHits = lower.filter(function (k) {
      return ENTITY_STAT_KEYS.some(function (s) { return k === s || k.indexOf(s) !== -1; });
    }).length;
    score += Math.min(statHits, 4);
    return score;
  }

  function containerEntries(container) {
    if (container instanceof Map) {
      var out = [];
      container.forEach(function (v, k) { out.push([String(k), v]); });
      return out;
    }
    if (Array.isArray(container)) {
      return container.map(function (v, i) { return [String(i), v]; });
    }
    return Object.keys(container).map(function (k) { return [k, container[k]]; });
  }

  function detectRegistryFromContainer(pathArr, container) {
    if (!container || typeof container !== "object") return null;
    var isArr = Array.isArray(container);
    var isMap = container instanceof Map;
    var pairs = containerEntries(container);
    var n = pairs.length;
    if (n < 3) return null;

    var sampleN = Math.min(n, 60);
    var objCount = 0;
    var scoreSum = 0;
    var keyLooksName = 0;
    var fieldFreq = {};
    for (var i = 0; i < sampleN; i++) {
      var key = pairs[i][0];
      var val = pairs[i][1];
      if (val && typeof val === "object" && !Array.isArray(val) && !(val instanceof Map)) {
        objCount++;
        scoreSum += looksLikeEntity(val);
        Object.keys(val).forEach(function (f) { fieldFreq[f] = (fieldFreq[f] || 0) + 1; });
      }
      if (!/^\d+$/.test(key) && /[A-Za-z]{2,}/.test(key)) keyLooksName++;
    }
    if (objCount < sampleN * 0.5) return null; // must be mostly object entries

    var avgScore = scoreSum / objCount;
    var lastKey = String(pathArr[pathArr.length - 1] || "");
    var keyHint = ENTITY_REGISTRY_KEY_HINT.test(lastKey);
    if (avgScore < 1.5 && !keyHint) return null;

    var nameField = null;
    ENTITY_NAME_KEYS.forEach(function (nk) { if (!nameField && fieldFreq[nk]) nameField = nk; });
    var byKeyName = !isArr && keyLooksName >= sampleN * 0.6;

    var statFields = Object.keys(fieldFreq).filter(function (f) {
      var fl = f.toLowerCase();
      return ENTITY_REL_KEYS.test(fl) || ENTITY_STAT_KEYS.some(function (s) { return fl === s || fl.indexOf(s) !== -1; });
    });

    var sampleNames = [];
    for (var j = 0; j < pairs.length && sampleNames.length < 6; j++) {
      var pv = pairs[j][1];
      if (!pv || typeof pv !== "object") continue;
      sampleNames.push(byKeyName ? pairs[j][0] : (nameField && pv[nameField]) || pv.name || pv.nickname || pairs[j][0]);
    }

    return {
      path: pathArr,
      pathExpr: "$" + pathArr.join("."),
      kind: isMap ? "map" : isArr ? "array" : "object",
      count: n,
      score: Math.round((avgScore + (keyHint ? 2 : 0)) * 10) / 10,
      nameField: nameField,
      nameByKey: byKeyName,
      statFields: statFields.slice(0, 10),
      commonFields: Object.keys(fieldFreq).sort(function (a, b) { return fieldFreq[b] - fieldFreq[a]; }).slice(0, 14),
    };
  }

  function getEntityRegistries() {
    var live = getLiveVariableStore();
    if (!live || typeof live !== "object") return { registries: [] };
    var found = [];
    var topPairs = containerEntries(live);
    topPairs.forEach(function (pair) {
      var k = pair[0];
      var v = pair[1];
      if (!v || typeof v !== "object") return;
      var reg = detectRegistryFromContainer([k], v);
      if (reg) found.push(reg);
      // one level deeper for wrapper objects like $game.people, $world.npcs
      else if (!Array.isArray(v) && !(v instanceof Map)) {
        var innerKeys = Object.keys(v);
        if (innerKeys.length <= 40) {
          innerKeys.forEach(function (ik) {
            var iv = v[ik];
            if (iv && typeof iv === "object") {
              var inner = detectRegistryFromContainer([k, ik], iv);
              if (inner) found.push(inner);
            }
          });
        }
      }
    });
    found.sort(function (a, b) { return b.score - a.score || b.count - a.count; });
    return { registries: found.slice(0, 24) };
  }

  function surfaceEntityFields(entry) {
    var rel = [];
    var flags = [];
    var tags = [];
    Object.keys(entry).forEach(function (f) {
      var v = entry[f];
      var fl = f.toLowerCase();
      if (v === null || v === undefined) return;
      if (typeof v === "object" && !Array.isArray(v) && !(v instanceof Map)) {
        // Nested meter objects, e.g. attitude.friendship / stats.love
        if (ENTITY_REL_KEYS.test(fl) || /stat|meter|rel|score|value/.test(fl)) {
          Object.keys(v).forEach(function (sf) {
            if (typeof v[sf] === "number" && rel.length < 10) rel.push({ label: f + "." + sf, value: v[sf], num: true });
          });
        }
        return;
      }
      if (typeof v === "number" && ENTITY_REL_KEYS.test(fl)) rel.push({ label: f, value: v, num: true });
      else if (typeof v === "boolean" && ENTITY_MET_KEYS.test(fl)) flags.push({ label: f, value: v });
      else if (typeof v === "string" && /relationship|attitude|status|disposition|rank|title|role/.test(fl)) tags.push({ label: f, value: String(v).slice(0, 40) });
    });
    return { rel: rel.slice(0, 10), flags: flags.slice(0, 8), tags: tags.slice(0, 6) };
  }

  function entityRelValue(surfaced, key) {
    for (var i = 0; i < surfaced.rel.length; i++) {
      if (surfaced.rel[i].label === key) return Number(surfaced.rel[i].value) || 0;
    }
    return -Infinity;
  }

  function getEntityRegistryEntries(args) {
    var path = normalizePath(args.path);
    var live = getLiveVariableStore();
    var container = ST ? ST.getStateValue(live, path) : null;
    if (!container || typeof container !== "object") return { entries: [], total: 0, shown: 0 };

    var pairs = containerEntries(container);
    var q = (args && args.filter ? String(args.filter) : "").trim().toLowerCase();
    var nameField = args && args.nameField;
    var byKey = !!(args && args.nameByKey);
    var onlyMet = !!(args && args.onlyMet);

    var results = [];
    for (var i = 0; i < pairs.length; i++) {
      var key = pairs[i][0];
      var val = pairs[i][1];
      if (!val || typeof val !== "object" || Array.isArray(val)) continue;
      var name = byKey ? key : (nameField && val[nameField]) || val.name || val.nickname || val.fullname || key;
      var surfaced = surfaceEntityFields(val);
      var isMet = surfaced.flags.some(function (fl) { return fl.value === true; }) || surfaced.rel.length > 0 || surfaced.tags.length > 0;
      if (onlyMet && !isMet) continue;
      if (q) {
        var hay = String(name).toLowerCase();
        if (hay.indexOf(q) === -1) {
          var extra = surfaced.tags.map(function (t) { return t.value; }).join(" ").toLowerCase();
          if (extra.indexOf(q) === -1) continue;
        }
      }
      results.push({
        key: key,
        name: String(name),
        path: path.concat(key),
        pathExpr: "$" + path.concat(key).join("."),
        rel: surfaced.rel,
        flags: surfaced.flags,
        tags: surfaced.tags,
        met: isMet,
        fieldCount: Object.keys(val).length,
      });
    }

    var total = results.length;
    var sort = (args && args.sort) || "name";
    if (sort === "name") results.sort(function (a, b) { return a.name.localeCompare(b.name); });
    else if (sort === "fields") results.sort(function (a, b) { return b.fieldCount - a.fieldCount; });
    else if (sort === "met") results.sort(function (a, b) { return (b.met ? 1 : 0) - (a.met ? 1 : 0) || a.name.localeCompare(b.name); });
    else if (sort.indexOf("rel:") === 0) {
      var rk = sort.slice(4);
      results.sort(function (a, b) { return entityRelValue(b, rk) - entityRelValue(a, rk); });
    }

    var limit = (args && args.limit) || 200;
    return {
      entries: results.slice(0, limit),
      total: total,
      shown: Math.min(total, limit),
      containerCount: pairs.length,
    };
  }

  var BOOST_SKIP_TOP_KEYS = {
    turn: 1, moment: 1, history: 1, seed: 1, prng: 1, rng: 1, args: 1, error: 1, version: 1,
  };

  var BOOST_SKIP_KEY_PARTIAL = /seed|prng|historystack|callstack|sidebar|twine|devtools/i;
  var BOOST_UNLOCK_BOOL = /unlock|known|met|introduced|discovered|seen|visited|enabled|available|purchased|owned|complete|finished|learned|acquired|revealed|notified|familiar|befriended|romanced|dating|hired|recruited/i;
  var BOOST_LOCK_BOOL = /locked|hidden|blocked|denied|forbidden|sealed|restricted|banned|blacklisted/i;
  var BOOST_STAT_NUMERIC = /level|skill|stat|friendship|lust|romance|affection|trust|familiarity|reputation|mood|energy|health|hp|stamina|xp|experience|strength|dexterity|intelligence|wisdom|charisma|fitness|beauty|attraction|respect|affinity|proficiency|progress|rank|points|score|corruption|innocence|purity|willpower|endurance|agility|perception|will|mana|magic/i;
  var BOOST_MONEY_NUMERIC = /money|gold|cash|currency|credits|coins|wealth|bucks|dollars|yen|gems|tokens|funds|balance|income|salary/i;
  var BOOST_SKIP_NUMERIC = /^(turn|hour|day|month|year|week|date|time|index|count|id|size|length|width|height|minute|second|version|timestamp|slot|page|step|phase|round|tick)$/i;

  function shouldSkipBoostPath(pathParts, key) {
    var kl = String(key).toLowerCase();
    if (BOOST_SKIP_TOP_KEYS[kl] && pathParts.length <= 1) return true;
    if (BOOST_SKIP_KEY_PARTIAL.test(kl)) return true;
    if (kl.indexOf("__") === 0) return true;
    return false;
  }

  function classifyBooleanBoost(key, val) {
    var kl = String(key).toLowerCase();
    if (BOOST_LOCK_BOOL.test(kl)) {
      if (val === true) return { type: "invert-lock", value: false, reason: "clear lock flag" };
      return null;
    }
    if (BOOST_UNLOCK_BOOL.test(kl)) {
      if (val === false) return { type: "unlock", value: true, reason: "set unlock/known flag" };
      return null;
    }
    if (/^(is|has|can|did|was)/.test(kl) && val === false) {
      return { type: "unlock", value: true, reason: "affirmative flag" };
    }
    return null;
  }

  function inferNumericCap(key, val, parent, options) {
    if (typeof val !== "number" || !isFinite(val)) return null;
    var kl = String(key).toLowerCase();

    if (BOOST_MONEY_NUMERIC.test(kl)) {
      return options.boostMoney ? Math.max(val, 999999) : null;
    }

    if (BOOST_SKIP_NUMERIC.test(kl) && !BOOST_STAT_NUMERIC.test(kl)) return null;

    if (parent && typeof parent.max === "number" && parent.max >= val) return parent.max;
    if (parent && typeof parent.cap === "number" && parent.cap >= val) return parent.cap;
    if (parent && typeof parent[kl + "max"] === "number") return parent[kl + "max"];

    var isStat = BOOST_STAT_NUMERIC.test(kl) || /^skill/i.test(kl);
    if (!isStat) {
      if (val >= 0 && val <= 100 && parent && Object.keys(parent).length < 80) return 100;
      return null;
    }

    if (val <= 10) return 10;
    if (val <= 100) return 100;
    if (val <= 1000) return 1000;
    return Math.max(val, 100);
  }

  function inferNumericReason(key) {
    if (BOOST_MONEY_NUMERIC.test(key)) return "currency boost";
    if (BOOST_STAT_NUMERIC.test(key)) return "stat-like numeric";
    return "small numeric (likely meter)";
  }

  function tryMarkPassageMap(obj, pathParts, passageNames, changes, seenPaths) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return;
    var keys = Object.keys(obj);
    if (keys.length < 2) return;
    var matchCount = 0;
    keys.forEach(function (k) {
      if (passageNames.indexOf(k) !== -1) matchCount++;
    });
    if (matchCount < 3 && matchCount / keys.length < 0.2) return;

    keys.forEach(function (k) {
      if (passageNames.indexOf(k) === -1) return;
      var path = pathParts.concat(k);
      var pathKey = path.join(".");
      if (seenPaths[pathKey]) return;
      var cur = obj[k];
      if (cur === true) return;
      if (typeof cur === "boolean" && cur === false) {
        seenPaths[pathKey] = true;
        changes.push({
          path: path,
          pathExpr: "$" + path.join("."),
          action: "passage",
          from: cur,
          to: true,
          reason: "passage-name map (visit flag)",
        });
      } else if (cur === 0 || cur === null || cur === undefined) {
        seenPaths[pathKey] = true;
        changes.push({
          path: path,
          pathExpr: "$" + path.join("."),
          action: "passage",
          from: cur,
          to: true,
          reason: "passage-name map (unset → true)",
        });
      }
    });
  }

  function walkStateForBoost(obj, pathParts, depth, options, changes, skipped, passageNames, seenObjs, seenPaths) {
    if (depth > (options.maxDepth || 6)) return;
    if (obj == null || typeof obj !== "object") return;
    if (seenObjs.indexOf(obj) !== -1) return;
    seenObjs.push(obj);

    if (Array.isArray(obj)) {
      if (obj.length > 250) return;
      for (var i = 0; i < obj.length; i++) {
        walkStateForBoost(obj[i], pathParts.concat(String(i)), depth + 1, options, changes, skipped, passageNames, seenObjs, seenPaths);
      }
      return;
    }

    if (obj instanceof Map) {
      obj.forEach(function (v, k) {
        var key = String(k);
        if (shouldSkipBoostPath(pathParts, key)) return;
        walkStateForBoost(v, pathParts.concat(key), depth + 1, options, changes, skipped, passageNames, seenObjs, seenPaths);
      });
      return;
    }

    Object.keys(obj).forEach(function (key) {
      if (shouldSkipBoostPath(pathParts, key)) {
        if (skipped.length < 40) skipped.push({ path: pathParts.concat(key), reason: "skipped key pattern" });
        return;
      }

      var path = pathParts.concat(key);
      var pathKey = path.join(".");
      var val = obj[key];

      if (typeof val === "boolean" && options.unlockBooleans) {
        var boolAction = classifyBooleanBoost(key, val);
        if (boolAction && !seenPaths[pathKey]) {
          seenPaths[pathKey] = true;
          changes.push({
            path: path,
            pathExpr: "$" + path.join("."),
            action: boolAction.type,
            from: val,
            to: boolAction.value,
            reason: boolAction.reason,
          });
        }
      } else if (typeof val === "number" && options.maxNumerics) {
        var cap = inferNumericCap(key, val, obj, options);
        if (cap != null && val < cap && !seenPaths[pathKey]) {
          seenPaths[pathKey] = true;
          changes.push({
            path: path,
            pathExpr: "$" + path.join("."),
            action: "max",
            from: val,
            to: cap,
            reason: inferNumericReason(key),
          });
        }
      } else if (val && typeof val === "object") {
        if (options.markPassages && depth < 4) {
          tryMarkPassageMap(val, path, passageNames, changes, seenPaths);
        }
        walkStateForBoost(val, path, depth + 1, options, changes, skipped, passageNames, seenObjs, seenPaths);
      }
    });
  }

  function summarizeBoostChanges(changes) {
    var summary = { unlock: 0, max: 0, passage: 0, invertLock: 0 };
    changes.forEach(function (c) {
      if (c.action === "unlock") summary.unlock++;
      else if (c.action === "invert-lock") summary.invertLock++;
      else if (c.action === "max") summary.max++;
      else if (c.action === "passage") summary.passage++;
    });
    return summary;
  }

  function getStoryPassageNames() {
    var names = [];
    var S = getSugarCube();
    if (S && S.Story && typeof S.Story.forEach === "function") {
      S.Story.forEach(function (p) {
        if (p && p.title) names.push(p.title);
      });
      if (names.length) return names;
    }
    iteratePassages(function (p) {
      names.push(passageName(p));
    });
    return names;
  }

  function scanSandboxBoost(args) {
    var S = getSugarCube();
    if (!S) return { supported: false, reason: "SugarCube required for sandbox boost" };

    var live = getLiveVariableStore();
    if (!live) return { supported: false, reason: "No live variable store found" };

    var options = {
      maxNumerics: args && args.maxNumerics !== false,
      unlockBooleans: args && args.unlockBooleans !== false,
      markPassages: args && args.markPassages !== false,
      boostMoney: args && args.boostMoney !== false,
      maxDepth: (args && args.maxDepth) || 6,
    };

    var changes = [];
    var skipped = [];
    var seenObjs = [];
    var seenPaths = {};
    var passageNames = getStoryPassageNames();

    walkStateForBoost(live, [], 0, options, changes, skipped, passageNames, seenObjs, seenPaths);

    var previewLimit = args && args.previewLimit != null ? args.previewLimit : 400;

    return {
      supported: true,
      options: options,
      changes: previewLimit > 0 ? changes.slice(0, previewLimit) : changes,
      changeCount: changes.length,
      truncated: previewLimit > 0 && changes.length > previewLimit,
      summary: summarizeBoostChanges(changes),
      skippedSample: skipped.slice(0, 25),
      disclaimer:
        "Heuristic scan only — uses generic patterns (unlock flags, stat-like numbers, passage maps). " +
        "Some games store progress differently; preview and use Changes tab to verify.",
    };
  }

  function applySandboxBoost(args) {
    var fullScan = scanSandboxBoost(Object.assign({}, args || {}, { previewLimit: 0 }));
    if (!fullScan.supported) return fullScan;

    if (!args || !args.apply) {
      return fullScan;
    }

    if (!ST) throw new Error("State utils unavailable");

    var live = getLiveVariableStore();
    if (!live) throw new Error("No live variable store");

    var applied = 0;
    var errors = [];

    fullScan.changes.forEach(function (ch) {
      try {
        ST.setStateAtPath(live, ch.path, ch.to);
        applied++;
      } catch (e) {
        errors.push({ path: ch.pathExpr, error: String(e.message || e) });
      }
    });

    return {
      supported: true,
      ok: errors.length === 0,
      applied: applied,
      failed: errors.length,
      errors: errors.slice(0, 20),
      summary: fullScan.summary,
    };
  }

  var handlers = {
    ping: function () { return { ok: true, detected: !!detectEngine() }; },
    detect: detectEngine,
    // Like detect, but without serializing the (possibly huge) variable store.
    detectLite: function () {
      var d = detectEngine();
      return d ? { profile: d.profile, capabilities: d.capabilities || activeCapabilities } : null;
    },
    getMeta: readMeta,
    getVariables: getVariables,
    getHistory: function () {
      var adapter = getAdapter();
      if (adapter && adapter.getHistory) return adapter.getHistory();
      return [];
    },
    getCapabilities: getCapabilities,
    getStoryAnalysis: getStoryAnalysis,
    getTempVariables: getTempVariables,
    restoreHistory: restoreHistoryMoment,
    exportTwee: exportTweeDocument,
    setVariable: function (args) {
      return setVariable(args.path, args.value, args.type, args.isTemp);
    },
    getPassageList: getPassageList,
    getPassageDetail: function (args) { return getPassageDetail(args.name); },
    getCurrentDomLinks: getCurrentDomLinks,
    getStoryGraph: function (args) { return getStoryGraph(args && args.limit); },
    getMediaInventory: getMediaInventory,
    checkMedia: function (args) { return checkMediaUrl(args.url); },
    checkMediaBatch: function (args) {
      var urls = args.urls || [];
      return Promise.all(urls.slice(0, 40).map(function (u) { return checkMediaUrl(u); }));
    },
    getSetup: getSetupSnapshot,
    goToPassage: function (args) { return goToPassage(args.name); },
    eval: function (args) { return evalCode(args.code); },
    getLinkAnalysis: getLinkAnalysis,
    getCurrentPassageContext: getCurrentPassageContext,
    mergeVariables: function (args) {
      var parsed = JSON.parse(args.json);
      var adapter = getAdapter();
      if (adapter && adapter.family === "chapbook" && window.engine && engine.state.restoreFromObject) {
        var snap = engine.state.saveToObject();
        Object.assign(snap, parsed);
        engine.state.restoreFromObject(snap);
        return true;
      }
      var live = getLiveVariableStore();
      if (live && typeof live === "object") {
        Object.assign(live, parsed);
        return true;
      }
      throw new Error("Cannot merge variables for this format");
    },
    exportVariablesJson: function () {
      var v = getVariables();
      return v ? JSON.stringify(v.data, null, 2) : "{}";
    },
    getWatchSnapshot: function (args) { return getWatchSnapshot(args.paths); },
    getDomInspection: getDomInspection,
    highlightElement: function (args) { return highlightElement(args.selector); },
    clearHighlights: clearHighlights,
    setOverlayKeyboardBlock: setOverlayKeyboardBlock,
    getSaveSlots: getSaveSlots,
    decodeSaveBundle: decodeSaveBundle,
    detectChatSystem: detectChatSystem,
    getChatSystemInspector: getChatSystemInspector,
    getChatBranchDebug: getChatBranchDebug,
    chatSystemSetCurr: chatSystemSetCurr,
    chatSystemAction: chatSystemAction,
    getBrowserStorage: getBrowserStorage,
    setBrowserStorageKey: setBrowserStorageKey,
    deleteBrowserStorageKey: deleteBrowserStorageKey,
    getGraphForVisual: getGraphForVisual,
    inspectGameElement: inspectGameElement,
    peekGameElement: peekGameElement,
    getDialogSnapshot: scanDialogSnapshot,
    analyzeOpenDialog: analyzeOpenDialog,
    getFormatTech: getFormatTech,
    getEntityRegistries: getEntityRegistries,
    getEntityRegistryEntries: getEntityRegistryEntries,
    getTagTaxonomy: getTagTaxonomy,
    scanSandboxBoost: scanSandboxBoost,
    applySandboxBoost: applySandboxBoost,
    getFormatMeta: getFormatMeta,
    startDiffTracking: startDiffTracking,
    stopDiffTracking: stopDiffTracking,
    getDiffLog: getDiffLog,
    clearDiffLog: clearDiffLog,
    setPathLock: setPathLock,
    getLockedPaths: getLockedPaths,
    clearPathLocks: clearPathLocks,
    deleteStateProperty: deleteStateProperty,
    addStateProperty: addStateProperty,
    duplicateStateProperty: duplicateStateProperty,
    setPassageSource: setPassageSource,
    globalSearch: globalSearch,
    getSanitizedVariables: function () {
      var v = getVariables();
      return v ? v.data : null;
    },
  };

  window.addEventListener("message", function (event) {
    // Accept requests from this window and, when we run inside a same-origin
    // iframe, from the parent/top window (the content script posts from there).
    if (event.source !== window && event.source !== window.parent && event.source !== window.top) return;
    var data = event.data;
    if (!data || data.source !== MSG + "-request") return;

    var id = data.id;
    var method = data.method;
    var args = data.args || {};

    function respond(result, error) {
      var safeResult = null;
      if (!error) {
        try {
          safeResult = cloneForPostMessage(result);
        } catch (e) {
          error = String(e.message || e);
        }
      }
      var payload = {
        source: MSG + "-response",
        id: id,
        result: safeResult,
        error: error || null,
      };
      try {
        window.postMessage(payload, "*");
        if (window.parent && window.parent !== window) {
          window.parent.postMessage(payload, "*");
        }
      } catch (e) {
        window.postMessage(
          {
            source: MSG + "-response",
            id: id,
            result: null,
            error: String(e.message || e),
          },
          "*"
        );
      }
    }

    var handler = handlers[method];
    if (!handler) {
      respond(null, "Unknown method: " + method);
      return;
    }

    try {
      var result = handler(args);
      if (result && typeof result.then === "function") {
        result.then(function (r) { respond(r); }).catch(function (e) { respond(null, e.message || String(e)); });
      } else {
        respond(result);
      }
    } catch (e) {
      respond(null, e.message || String(e));
    }
  });

  window.postMessage({ source: MSG + "-ready" }, "*");
})();
