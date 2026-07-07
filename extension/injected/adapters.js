(function () {
  "use strict";

  /** @typedef {'full'|'read'|'partial'|'none'} FeatureLevel */

  // Storydata parsing is expensive on 5000+ passage games and the underlying
  // <tw-passagedata> nodes never change unless we edit them — cache aggressively.
  var passageCache = null;
  var passageIndex = null;

  function readStorydataPassages() {
    var nodes = document.querySelectorAll("tw-storydata tw-passagedata, tw-passagedata");
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      out.push({
        name: n.getAttribute("name") || "",
        pid: n.getAttribute("pid") || "",
        tags: (n.getAttribute("tags") || "").split(/\s+/).filter(Boolean),
        text: n.textContent || "",
      });
    }
    return out;
  }

  function parseStorydataPassages() {
    if (!passageCache) {
      passageCache = readStorydataPassages();
      passageIndex = {};
      for (var i = 0; i < passageCache.length; i++) {
        passageIndex[passageCache[i].name] = passageCache[i];
      }
    }
    return passageCache;
  }

  function getStorydataPassage(name) {
    parseStorydataPassages();
    return (passageIndex && passageIndex[name]) || null;
  }

  function invalidatePassageCache() {
    passageCache = null;
    passageIndex = null;
  }

  function getFormatMeta() {
    var fmt = document.querySelector('meta[name="twine-story-format"]');
    var ver = document.querySelector('meta[name="twine-story-format-version"]');
    return {
      name: fmt ? fmt.content : null,
      version: ver ? ver.content : null,
    };
  }

  function getStartPassageName() {
    var sd = document.querySelector("tw-storydata");
    if (!sd) return null;
    var startPid = sd.getAttribute("startnode");
    if (!startPid) return null;
    var passages = parseStorydataPassages();
    for (var i = 0; i < passages.length; i++) {
      if (passages[i].pid === startPid) return passages[i].name;
    }
    return null;
  }

  function parseSugarCubeLinks(text) {
    var links = [];
    var wiki = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
    var m;
    while ((m = wiki.exec(text)) !== null) {
      links.push({ type: "wiki", label: m[2] ? m[2].trim() : m[1].trim(), target: (m[2] || m[1]).trim() });
    }
    // <<link "Label" "Target">> and <<button "Label" "Target">>
    var macro = /<<(link|button)\s+(?:"([^"]+)"|'([^']+)')\s+(?:"([^"]+)"|'([^']+)')[^>]*>>/gi;
    while ((m = macro.exec(text)) !== null) {
      links.push({ type: m[1].toLowerCase() === "button" ? "button" : "macro", label: m[2] || m[3], target: m[4] || m[5] });
    }
    var gotoRe = /<<goto\s+['"]([^'"]+)['"]>>/gi;
    while ((m = gotoRe.exec(text)) !== null) {
      links.push({ type: "goto", label: m[1], target: m[1] });
    }
    // <<include "Target">> / <<display Target>> — structural edges; big
    // macro-driven games compose passages this way far more than [[links]].
    // Quoted, [[bracketed]], and bareword argument forms; $var/_var args are
    // dynamic and can't be resolved statically.
    var incRe = /<<(?:include|display)\s+(?:"([^"]+)"|'([^']+)'|\[\[([^\]|]+)(?:\|[^\]]*)?\]\]|([A-Za-z][\w.-]*))/gi;
    while ((m = incRe.exec(text)) !== null) {
      var incTarget = (m[1] || m[2] || m[3] || m[4] || "").trim();
      if (!incTarget) continue;
      links.push({ type: "include", label: "include: " + incTarget, target: incTarget });
    }
    return links;
  }

  function sugarCubeVersionString(S) {
    var v = S && S.version;
    if (!v) return null;
    // v.title alone is just the name; v.short() is already "SugarCube (v2.x.y)".
    try {
      if (typeof v.short === "function") return String(v.short());
    } catch (e) { /* ignore */ }
    if (typeof v.major === "number") {
      return (v.title || "SugarCube") + " v" + v.major + "." + (v.minor || 0) + "." + (v.patch || 0);
    }
    return v.title || String(v);
  }

  function parseHarloweLinks(text) {
    var links = [];
    var patterns = [
      /\(\s*link(?:-goto|-reveal)?:\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/gi,
      /\(\s*link(?:-goto|-reveal)?:\s*['"]([^'"]+)['"]\s*\)/gi,
    ];
    for (var p = 0; p < patterns.length; p++) {
      var re = patterns[p];
      var m;
      while ((m = re.exec(text)) !== null) {
        if (m[2]) links.push({ type: "harlowe", label: m[1], target: m[2] });
        else links.push({ type: "harlowe", label: m[1], target: m[1] });
      }
    }
    return links;
  }

  function parseChapbookLinks(text) {
    var links = [];
    var re = /\[link:\s*([^\]|]+)(?:\|([^\]]+))?\]/gi;
    var m;
    while ((m = re.exec(text)) !== null) {
      links.push({ type: "chapbook", label: m[2] ? m[2].trim() : m[1].trim(), target: (m[2] || m[1]).trim() });
    }
    return links;
  }

  function parseSnowmanLinks(text) {
    var links = [];
    var re = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
    var m;
    while ((m = re.exec(text)) !== null) {
      links.push({ type: "wiki", label: m[2] ? m[2].trim() : m[1].trim(), target: (m[2] || m[1]).trim() });
    }
    return links;
  }

  function parseAllFormatLinks(text) {
    var seen = {};
    var out = [];
    [parseSugarCubeLinks, parseHarloweLinks, parseChapbookLinks, parseSnowmanLinks].forEach(function (fn) {
      fn(text).forEach(function (l) {
        var k = l.target + "|" + l.label;
        if (!seen[k]) {
          seen[k] = true;
          out.push(l);
        }
      });
    });
    return out;
  }

  function parseLinksForFamily(family, text) {
    switch (family) {
      case "sugarcube":
        return parseSugarCubeLinks(text);
      case "harlowe":
        return parseHarloweLinks(text);
      case "chapbook":
        return parseChapbookLinks(text);
      case "snowman":
        return parseSnowmanLinks(text);
      default:
        return parseAllFormatLinks(text);
    }
  }

  function defaultCapabilities(overrides) {
    return Object.assign(
      {
        variables: "none",
        tempVariables: "none",
        passages: "read",
        navigate: false,
        passageEdit: false,
        saves: false,
        conditions: false,
        diff: false,
        setup: false,
        history: false,
        analysis: true,
      },
      overrides || {}
    );
  }

  function makeSugarCubeAdapter() {
    function getSC() {
      return window.SugarCube || null;
    }

    return {
      id: "SugarCube",
      label: "SugarCube",
      family: "sugarcube",
      detect: function () {
        var profiles = [
          { id: "SugarCube2", label: "SugarCube 2.x", variablesExpr: "SugarCube.State.active.variables" },
          { id: "SugarCube1", label: "SugarCube 1.x", variablesExpr: "SugarCube.state.active.variables" },
          { id: "V-shorthand", label: "V shorthand", variablesExpr: "V" },
        ];
        for (var i = 0; i < profiles.length; i++) {
          try {
            var vars = eval(profiles[i].variablesExpr);
            if (vars && typeof vars === "object") {
              return { profile: Object.assign({ family: "sugarcube" }, profiles[i]), variables: vars };
            }
          } catch (e) { /* next */ }
        }
        return null;
      },
      capabilities: defaultCapabilities({
        variables: "full",
        tempVariables: "full",
        passages: "full",
        navigate: true,
        passageEdit: true,
        saves: true,
        conditions: true,
        diff: true,
        setup: true,
        history: true,
      }),
      getStateRoot: function () {
        var S = getSC();
        if (S && S.State && S.State.variables) return S.State.variables;
        var d = this.detect();
        if (!d) return null;
        try {
          return eval(d.profile.variablesExpr);
        } catch (e) {
          return d.variables;
        }
      },
      getTempStateRoot: function () {
        var S = getSC();
        return S && S.State && S.State.temporary ? S.State.temporary : null;
      },
      getVariablesExpr: function () {
        var d = this.detect();
        return d ? d.profile.variablesExpr : null;
      },
      getMeta: function () {
        var fmt = getFormatMeta();
        var S = getSC();
        if (!S) return null;
        var st = S.State || S.state;
        var Story = S.Story || S.tale;
        var passageCount = 0;
        if (Story) {
          if (typeof Story.size === "number") passageCount = Story.size;
          else if (Story.entries) passageCount = Object.keys(Story.entries).length;
        }
        var extra = {};
        try {
          if (S.Story && S.Story.name) extra.storyName = S.Story.name;
          if (S.Config && S.Config.saves) extra.maxSlotSaves = S.Config.saves.maxSlotSaves;
          if (st && st.passage && S.State && S.State.hasPlayed) {
            extra.hasPlayedCurrent = S.State.hasPlayed(st.passage);
          }
        } catch (e) { /* ignore */ }
        return Object.assign(
          {
            engine: S.State ? "SugarCube 2.x" : "SugarCube 1.x",
            format: fmt.name || "SugarCube",
            version: sugarCubeVersionString(S) || fmt.version || "unknown",
            storyTitle: Story && (Story.name || Story.title) ? Story.name || Story.title : document.title,
            passage: st ? st.passage : null,
            turn: st ? st.turns : null,
            historyDepth: S.History ? S.History.length : null,
            passageCount: passageCount || parseStorydataPassages().length,
            hasSetup: !!S.setup,
            hasSave: !!(S.Save && S.Save.browser),
            startPassage: getStartPassageName(),
          },
          extra
        );
      },
      goToPassage: function (name) {
        var S = getSC();
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
      },
      setPassageSource: function (name, source, tags) {
        var S = getSC();
        var Story = S && (S.Story || S.tale);
        if (!Story) throw new Error("Story API unavailable");
        if (typeof Story.has === "function" && Story.has(name)) {
          var passage = Story.get(name);
          if (passage.element) passage.element.textContent = source;
          if (passage.text !== undefined) passage.text = source;
          if (tags && passage.tags) {
            passage.tags = tags;
            if (passage.element) passage.element.setAttribute("tags", tags.join(" "));
          }
        } else if (typeof Story.add === "function") {
          Story.add({ name: name, text: source, tags: tags || [] });
        } else {
          throw new Error("Cannot update passage");
        }
        invalidatePassageCache();
      },
      setVariable: function (pathParts, value, type, isTemp) {
        var S = getSC();
        var parsed = value;
        if (type === "number") parsed = parseFloat(value);
        else if (type === "boolean") parsed = value === true || value === "true";
        else if (type === "null") parsed = null;

        if (S && S.State && typeof S.State.setVar === "function" && pathParts.length === 1 && !isTemp) {
          if (S.State.setVar("$" + pathParts[0], parsed)) return { ok: true, method: "State.setVar" };
        }

        var store = isTemp && S && S.State ? S.State.temporary : this.getStateRoot();
        var ST = window.TwineDevToolsState;
        if (ST && store) {
          ST.setStateAtPath(store, pathParts, parsed);
          return { ok: true, method: "setStateAtPath" };
        }
        throw new Error("Cannot set variable");
      },
      getHistory: function () {
        var S = getSC();
        if (!S) return [];
        // SugarCube 2: moments live on State.history (State.index = active moment).
        try {
          if (S.State && S.State.history && S.State.history.length) {
            var out = [];
            for (var j = 0; j < S.State.history.length; j++) {
              var moment = S.State.history[j];
              out.push({
                index: j,
                passage: (moment && (moment.title || moment.passage)) || "?",
                turn: j + 1,
                active: typeof S.State.activeIndex === "number" ? j === S.State.activeIndex : undefined,
              });
            }
            return out;
          }
        } catch (e) { /* fall through to SC1 path */ }
        // SugarCube 1: global History array of moments.
        if (!S.History || !S.History.length) return [];
        var items = [];
        for (var i = 0; i < S.History.length; i++) {
          var h = S.History[i];
          items.push({
            index: i,
            passage: h.passage || h.title || (h.state && h.state.passage) || "?",
            turn: h.state && h.state.turns,
          });
        }
        return items;
      },
      restoreHistory: function (index) {
        var S = getSC();
        if (!S) throw new Error("SugarCube unavailable");
        // SugarCube 2 public API: Engine.goTo(index) navigates to a history moment.
        if (S.Engine && typeof S.Engine.goTo === "function") {
          S.Engine.goTo(index);
          return { ok: true, method: "Engine.goTo" };
        }
        if (!S.State) throw new Error("SugarCube State unavailable");
        if (typeof S.State.restore === "function") {
          S.State.restore(index);
          return { ok: true, method: "State.restore" };
        }
        if (S.History && S.History[index]) {
          var moment = S.History[index];
          if (moment.state && typeof S.State.replace === "function") {
            S.State.replace(moment.state);
            return { ok: true, method: "State.replace" };
          }
        }
        throw new Error("History restore not supported in this SugarCube version");
      },
      deleteStateProperty: function (pathParts) {
        var root = this.getStateRoot();
        var ST = window.TwineDevToolsState;
        if (ST && root) ST.deleteFromState(root, pathParts);
        return { ok: true };
      },
      addStateProperty: function (parentPath, key, value) {
        var ST = window.TwineDevToolsState;
        var root = this.getStateRoot();
        if (ST && root) ST.addStateProperty(root, parentPath, key, value);
        return { ok: true };
      },
      duplicateStateProperty: function (parentPath, sourceKey, targetKey) {
        var ST = window.TwineDevToolsState;
        var root = this.getStateRoot();
        if (ST && root) ST.duplicateStateProperty(root, parentPath, sourceKey, targetKey);
        return { ok: true };
      },
      parseLinks: parseSugarCubeLinks,
    };
  }

  function makeChapbookAdapter() {
    return {
      id: "Chapbook",
      label: "Chapbook",
      family: "chapbook",
      detect: function () {
        if (!window.engine || !engine.state || typeof engine.state.get !== "function") return null;
        if (!document.querySelector("tw-storydata tw-passagedata, tw-passagedata")) return null;
        var data = {};
        try {
          var snap = engine.state.saveToObject ? engine.state.saveToObject() : {};
          Object.keys(snap).forEach(function (k) {
            data[k] = snap[k];
          });
        } catch (e) {
          var passages = parseStorydataPassages();
          for (var i = 0; i < passages.length; i++) {
            var text = passages[i].text;
            var sep = text.indexOf("\n--\n");
            if (sep === -1) sep = text.indexOf("\r\n--\r\n");
            var head = sep >= 0 ? text.slice(0, sep) : "";
            head.split(/\r?\n/).forEach(function (line) {
              var m = line.match(/^([A-Za-z_$][\w$]*)\s*:/);
              if (m) {
                try {
                  data[m[1]] = engine.state.get(m[1]);
                } catch (e2) {
                  data[m[1]] = "[error]";
                }
              }
            });
          }
        }
        return {
          profile: { id: "Chapbook", label: "Chapbook", family: "chapbook" },
          variables: data,
        };
      },
      capabilities: defaultCapabilities({
        variables: "full",
        passages: "full",
        navigate: true,
        passageEdit: true,
        diff: true,
      }),
      getStateRoot: function () {
        if (!window.engine || !engine.state) return null;
        if (typeof engine.state.saveToObject === "function") {
          return engine.state.saveToObject();
        }
        var d = this.detect();
        return d ? d.variables : null;
      },
      getVariablesExpr: function () {
        return null;
      },
      getMeta: function () {
        var fmt = getFormatMeta();
        var passage = null;
        try {
          passage = engine.state.get("passage.name") || engine.state.get("trail");
        } catch (e) { /* ignore */ }
        return {
          engine: "Chapbook",
          format: fmt.name || "Chapbook",
          version: fmt.version || "unknown",
          storyTitle:
            (document.querySelector("tw-story") && document.querySelector("tw-story").getAttribute("name")) ||
            document.title,
          passage: passage,
          passageCount: parseStorydataPassages().length,
          startPassage: getStartPassageName(),
        };
      },
      goToPassage: function (name) {
        if (typeof window.go === "function") {
          window.go(name);
          return true;
        }
        if (window.engine && typeof engine.go === "function") {
          engine.go(name);
          return true;
        }
        return false;
      },
      setPassageSource: function (name, source, tags) {
        if (!engine || !engine.story || typeof engine.story.passages !== "function") {
          throw new Error("Chapbook story API unavailable");
        }
        var passages = engine.story.passages();
        var passage = passages.find(function (p) {
          return p.name === name;
        });
        if (!passage) {
          var maxId = Math.max.apply(null, passages.map(function (p) {
            return p.id;
          }).concat([0]));
          passages.push({ id: maxId + 1, name: name, source: source, tags: tags || [] });
        } else {
          passage.source = source;
          if (tags) passage.tags = tags;
        }
      },
      setVariable: function (pathParts, value, type) {
        if (!engine || !engine.state || typeof engine.state.set !== "function") {
          throw new Error("Chapbook state unavailable");
        }
        var parsed = value;
        if (type === "number") parsed = parseFloat(value);
        else if (type === "boolean") parsed = value === true || value === "true";
        else if (type === "null") parsed = null;
        var pathStr = pathParts.join(".");
        engine.state.set(pathStr, parsed);
        return { ok: true };
      },
      deleteStateProperty: function (pathParts) {
        if (!engine || !engine.state) throw new Error("Chapbook state unavailable");
        var deleteKey = pathParts[pathParts.length - 1];
        var parentPath = pathParts.slice(0, -1);
        if (!parentPath.length) {
          var snap = engine.state.saveToObject();
          var copy = Object.assign({}, snap);
          delete copy[deleteKey];
          engine.state.restoreFromObject(copy);
          return { ok: true };
        }
        var parentVal = engine.state.get(parentPath.join("."));
        if (Array.isArray(parentVal)) {
          var newArray = parentVal.slice();
          newArray.splice(Number(deleteKey), 1);
          engine.state.set(parentPath.join("."), newArray);
        } else if (parentVal && typeof parentVal === "object") {
          var next = Object.assign({}, parentVal);
          delete next[deleteKey];
          engine.state.set(parentPath.join("."), next);
        }
        return { ok: true };
      },
      addStateProperty: function (parentPath, key, value) {
        if (!parentPath.length) {
          engine.state.set(String(key), value);
          return { ok: true };
        }
        var parentVal = engine.state.get(parentPath.join("."));
        if (Array.isArray(parentVal)) {
          parentVal.push(value);
          engine.state.set(parentPath.join("."), parentVal.slice());
        } else if (parentVal && typeof parentVal === "object") {
          var next = Object.assign({}, parentVal);
          next[String(key)] = value;
          engine.state.set(parentPath.join("."), next);
        }
        return { ok: true };
      },
      duplicateStateProperty: function (parentPath, sourceKey, targetKey) {
        var srcPath = parentPath.concat(sourceKey).join(".");
        var val = engine.state.get(srcPath);
        engine.state.set(parentPath.concat(targetKey || sourceKey + "_copy").join("."), JSON.parse(JSON.stringify(val)));
        return { ok: true };
      },
      getHistory: function () {
        return [];
      },
      parseLinks: parseChapbookLinks,
    };
  }

  function makeSnowmanAdapter() {
    return {
      id: "Snowman",
      label: "Snowman",
      family: "snowman",
      detect: function () {
        if (!window.story || !story.state) return null;
        if (!document.querySelector("tw-storydata tw-passagedata, tw-passagedata")) return null;
        return {
          profile: { id: "Snowman", label: "Snowman", family: "snowman" },
          variables: story.state,
        };
      },
      capabilities: defaultCapabilities({
        variables: "full",
        passages: "full",
        navigate: true,
        passageEdit: true,
        diff: true,
      }),
      getStateRoot: function () {
        return window.story && story.state ? story.state : null;
      },
      getVariablesExpr: function () {
        return "story.state";
      },
      getMeta: function () {
        var fmt = getFormatMeta();
        return {
          engine: "Snowman",
          format: fmt.name || "Snowman",
          version: fmt.version || "unknown",
          storyTitle: (story && story.name) || document.title,
          passage: window.passage && passage.name,
          passageCount: parseStorydataPassages().length,
          startPassage: getStartPassageName(),
        };
      },
      goToPassage: function (name) {
        if (window.story && typeof story.show === "function") {
          story.show(name);
          return true;
        }
        return false;
      },
      setPassageSource: function (name, source, tags) {
        if (!story || !story.passages) throw new Error("Snowman story unavailable");
        var p = story.passages.find(function (item) {
          return item && item.name === name;
        });
        if (!p) {
          var maxId = Math.max.apply(
            null,
            story.passages.map(function (item) {
              return (item && item.id) || 0;
            }).concat([0])
          );
          story.passages.push({ id: maxId + 1, name: name, source: source, tags: tags || [] });
        } else {
          p.source = source;
          if (tags) p.tags = tags;
        }
      },
      setVariable: function (pathParts, value, type) {
        var root = this.getStateRoot();
        if (!root) throw new Error("Snowman state unavailable");
        var ST = window.TwineDevToolsState;
        var parsed = value;
        if (type === "number") parsed = parseFloat(value);
        else if (type === "boolean") parsed = value === true || value === "true";
        else if (type === "null") parsed = null;
        if (ST) {
          ST.setStateAtPath(root, pathParts, parsed);
          return { ok: true };
        }
        throw new Error("State utils unavailable");
      },
      deleteStateProperty: function (pathParts) {
        var root = this.getStateRoot();
        var ST = window.TwineDevToolsState;
        if (ST && root) ST.deleteFromState(root, pathParts);
        return { ok: true };
      },
      addStateProperty: function (parentPath, key, value) {
        var ST = window.TwineDevToolsState;
        var root = this.getStateRoot();
        if (ST && root) ST.addStateProperty(root, parentPath, key, value);
        return { ok: true };
      },
      duplicateStateProperty: function (parentPath, sourceKey, targetKey) {
        var ST = window.TwineDevToolsState;
        var root = this.getStateRoot();
        if (ST && root) ST.duplicateStateProperty(root, parentPath, sourceKey, targetKey);
        return { ok: true };
      },
      getHistory: function () {
        if (!story || !story.history) return [];
        return story.history.map(function (id, index) {
          var p = story.passages && story.passages.find(function (x) {
            return x && x.id === id;
          });
          return { index: index, passage: p ? p.name : String(id) };
        });
      },
      parseLinks: parseSnowmanLinks,
    };
  }

  function makeHarloweAdapter() {
    return {
      id: "Harlowe",
      label: "Harlowe",
      family: "harlowe",
      detect: function () {
        var fmt = getFormatMeta();
        if (!fmt.name || fmt.name.toLowerCase().indexOf("harlowe") === -1) return null;
        if (!document.querySelector("tw-storydata, tw-passagedata")) return null;

        var data = {};
        document.querySelectorAll('tw-expression[type="variable"]').forEach(function (expr) {
          var name = expr.getAttribute("name");
          if (name) data[name] = expr.textContent.trim();
        });
        parseStorydataPassages().forEach(function (p) {
          var re = /\(set:\s*\$([A-Za-z_][\w]*)/g;
          var m;
          while ((m = re.exec(p.text)) !== null) {
            if (data[m[1]] === undefined) data[m[1]] = "(not rendered)";
          }
        });
        if (!Object.keys(data).length && !document.querySelector("tw-passage")) return null;

        return {
          profile: { id: "Harlowe", label: fmt.name || "Harlowe", family: "harlowe" },
          variables: data,
        };
      },
      capabilities: defaultCapabilities({
        variables: "read",
        passages: "read",
        navigate: true,
        passageEdit: false,
        conditions: false,
      }),
      getStateRoot: function () {
        var d = this.detect();
        return d ? d.variables : null;
      },
      getVariablesExpr: function () {
        return null;
      },
      getMeta: function () {
        var fmt = getFormatMeta();
        var cur = document.querySelector("tw-passage");
        return {
          engine: fmt.name || "Harlowe",
          format: fmt.name,
          version: fmt.version || "unknown",
          storyTitle:
            (document.querySelector("tw-story") && document.querySelector("tw-story").getAttribute("name")) ||
            document.title,
          passage: cur ? cur.getAttribute("name") : null,
          passageCount: parseStorydataPassages().length,
          startPassage: getStartPassageName(),
        };
      },
      goToPassage: function (name) {
        var link = document.querySelector('tw-link[name="' + name.replace(/"/g, '\\"') + '"]');
        if (link) {
          link.click();
          return true;
        }
        return false;
      },
      setPassageSource: function () {
        throw new Error("Harlowe passage editing requires author mode — read-only in DevTools");
      },
      setVariable: function () {
        throw new Error("Harlowe variables are not exposed to JavaScript (by design)");
      },
      getHistory: function () {
        return [];
      },
      parseLinks: parseHarloweLinks,
    };
  }

  function makeStorydataAdapter() {
    return {
      id: "Storydata",
      label: "Twine 2 (storydata only)",
      family: "storydata",
      detect: function () {
        var passages = parseStorydataPassages();
        if (!passages.length) return null;
        var fmt = getFormatMeta();
        return {
          profile: {
            id: "Storydata",
            label: fmt.name ? fmt.name + " (read-only)" : "Twine 2 storydata",
            family: "storydata",
          },
          variables: {},
        };
      },
      capabilities: defaultCapabilities({
        variables: "none",
        passages: "read",
        navigate: false,
        analysis: true,
      }),
      getStateRoot: function () {
        return {};
      },
      getVariablesExpr: function () {
        return null;
      },
      getMeta: function () {
        var fmt = getFormatMeta();
        return {
          engine: fmt.name || "Twine 2",
          format: fmt.name,
          version: fmt.version || "unknown",
          storyTitle:
            (document.querySelector("tw-story") && document.querySelector("tw-story").getAttribute("name")) ||
            document.title,
          passage: null,
          passageCount: parseStorydataPassages().length,
          startPassage: getStartPassageName(),
        };
      },
      goToPassage: function () {
        return false;
      },
      setPassageSource: function (name, source) {
        var nodes = document.querySelectorAll("tw-passagedata");
        for (var i = 0; i < nodes.length; i++) {
          if (nodes[i].getAttribute("name") === name) {
            nodes[i].textContent = source;
            invalidatePassageCache();
            return;
          }
        }
        throw new Error("Passage not found in storydata");
      },
      setVariable: function () {
        throw new Error("No live variable store — storydata-only mode");
      },
      getHistory: function () {
        return [];
      },
      parseLinks: parseAllFormatLinks,
    };
  }

  var ADAPTERS = [
    makeSugarCubeAdapter(),
    makeChapbookAdapter(),
    makeSnowmanAdapter(),
    makeHarloweAdapter(),
    makeStorydataAdapter(),
  ];

  var activeAdapter = null;
  var activeDetection = null;

  function detectAdapter() {
    // Once an adapter matched, only re-run its own detect — trying the whole
    // chain re-parses storydata/DOM and is called from many hot paths.
    if (activeAdapter) {
      var rehit = null;
      try { rehit = activeAdapter.detect(); } catch (e) { rehit = null; }
      if (rehit) {
        activeDetection = rehit;
        return { adapter: activeAdapter, profile: rehit.profile, variables: rehit.variables, capabilities: activeAdapter.capabilities };
      }
      activeAdapter = null;
      activeDetection = null;
    }
    for (var i = 0; i < ADAPTERS.length; i++) {
      var hit = ADAPTERS[i].detect();
      if (hit) {
        activeAdapter = ADAPTERS[i];
        activeDetection = hit;
        return { adapter: activeAdapter, profile: hit.profile, variables: hit.variables, capabilities: activeAdapter.capabilities };
      }
    }
    activeAdapter = null;
    activeDetection = null;
    return null;
  }

  function getActiveAdapter() {
    if (!activeAdapter) detectAdapter();
    return activeAdapter;
  }

  function runStoryAnalysis(family) {
    var passages = parseStorydataPassages();
    var names = {};
    passages.forEach(function (p) {
      names[p.name] = true;
    });

    var start = getStartPassageName();
    var incoming = {};
    var outgoing = {};
    var broken = [];

    passages.forEach(function (p) {
      if (!outgoing[p.name]) outgoing[p.name] = [];
      var links = parseLinksForFamily(family || "storydata", p.text);
      links.forEach(function (l) {
        outgoing[p.name].push(l.target);
        if (!incoming[l.target]) incoming[l.target] = [];
        incoming[l.target].push(p.name);
        if (l.target && !names[l.target] && l.target.indexOf("http") !== 0 && l.target.indexOf("#") !== 0) {
          broken.push({ from: p.name, target: l.target, label: l.label });
        }
      });
    });

    var orphans = passages
      .map(function (p) {
        return p.name;
      })
      .filter(function (name) {
        return name !== start && (!incoming[name] || !incoming[name].length);
      });

    var deadEnds = passages
      .map(function (p) {
        return p.name;
      })
      .filter(function (name) {
        return !outgoing[name] || !outgoing[name].length;
      });

    var unreachable = [];
    if (start && names[start]) {
      var seen = {};
      var q = [start];
      var qi = 0;
      seen[start] = true;
      while (qi < q.length) {
        var cur = q[qi++];
        (outgoing[cur] || []).forEach(function (t) {
          if (names[t] && !seen[t]) {
            seen[t] = true;
            q.push(t);
          }
        });
      }
      unreachable = Object.keys(names).filter(function (n) {
        return !seen[n];
      });
    }

    var totalLinks = 0;
    Object.keys(outgoing).forEach(function (k) {
      totalLinks += outgoing[k].length;
    });
    // Heuristic: when most passages are "unreachable" by static links, the
    // game routes through widgets/macros/Story JS and these stats mislead.
    var runtimeNavLikely =
      passages.length > 50 &&
      (totalLinks < passages.length * 0.5 || unreachable.length > passages.length * 0.6);

    return {
      passageCount: passages.length,
      startPassage: start,
      totalStaticLinks: totalLinks,
      runtimeNavLikely: runtimeNavLikely,
      brokenLinks: broken,
      orphanPassages: orphans,
      deadEnds: deadEnds,
      unreachable: unreachable,
    };
  }

  function exportTwee() {
    var fmt = getFormatMeta();
    var sd = document.querySelector("tw-storydata");
    var storyName =
      (document.querySelector("tw-story") && document.querySelector("tw-story").getAttribute("name")) ||
      document.title ||
      "Untitled";
    var lines = [
      ":: Story Title",
      storyName,
      "",
      ":: Story Data",
      "format: " + (fmt.name || "Unknown"),
    ];
    if (fmt.version) lines.push("format-version: " + fmt.version);
    if (sd && sd.getAttribute("ifid")) lines.push("ifid: " + sd.getAttribute("ifid"));
    lines.push("");

    parseStorydataPassages().forEach(function (p) {
      var tagStr = p.tags && p.tags.length ? " [" + p.tags.join(" ") + "]" : "";
      lines.push(":: " + p.name + tagStr);
      lines.push(p.text);
      lines.push("");
    });
    return lines.join("\n");
  }

  window.TwineDevToolsAdapters = {
    detect: detectAdapter,
    getActive: getActiveAdapter,
    getDetection: function () {
      return activeDetection;
    },
    parseStorydataPassages: parseStorydataPassages,
    getStorydataPassage: getStorydataPassage,
    invalidatePassageCache: invalidatePassageCache,
    parseLinksForFamily: parseLinksForFamily,
    parseAllFormatLinks: parseAllFormatLinks,
    getFormatMeta: getFormatMeta,
    getStartPassageName: getStartPassageName,
    runStoryAnalysis: runStoryAnalysis,
    exportTwee: exportTwee,
    ADAPTERS: ADAPTERS,
  };
})();
