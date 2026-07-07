"use strict";

import { evalInPage } from "./api.js";

/** @typedef {{ id: string, label: string, variablesExpr: string, metaExpr: string }} EngineProfile */

/** @type {EngineProfile[]} */
export const ENGINE_PROFILES = [
  {
    id: "SugarCube2",
    label: "SugarCube 2.x",
    variablesExpr: "SugarCube.State.active.variables",
    metaExpr: `(function(){
      var S = window.SugarCube;
      if (!S || !S.State) return null;
      var st = S.State;
      return {
        engine: "SugarCube 2.x",
        version: S.version && S.version.title ? S.version.title : (S.version || "unknown"),
        passage: st.passage,
        turn: st.turns,
        historyDepth: S.History ? S.History.length : null,
        hasSetup: !!S.setup,
        hasStory: !!S.Story
      };
    })()`,
  },
  {
    id: "SugarCube1",
    label: "SugarCube 1.x",
    variablesExpr: "SugarCube.state.active.variables",
    metaExpr: `(function(){
      var S = window.SugarCube;
      if (!S || !S.state) return null;
      var st = S.state;
      return {
        engine: "SugarCube 1.x",
        version: S.version || "unknown",
        passage: st.passage,
        turn: st.turns,
        historyDepth: S.History ? S.History.length : null,
        hasSetup: !!S.setup,
        hasStory: !!S.tale
      };
    })()`,
  },
  {
    id: "V-shorthand",
    label: "V shorthand",
    variablesExpr: "V",
    metaExpr: `(function(){
      if (typeof V === "undefined") return null;
      var S = window.SugarCube;
      return {
        engine: "V shorthand",
        version: S && S.version ? (S.version.title || S.version) : "unknown",
        passage: S && S.State ? S.State.passage : (S && S.state ? S.state.passage : null),
        turn: S && S.State ? S.State.turns : null,
        historyDepth: S && S.History ? S.History.length : null,
        hasSetup: !!(S && S.setup),
        hasStory: !!(S && (S.Story || S.tale))
      };
    })()`,
  },
];

/**
 * @returns {Promise<{ profile: EngineProfile, variables: object } | null>}
 */
export async function detectEngine() {
  for (const profile of ENGINE_PROFILES) {
    try {
      const variables = await evalInPage(`try { ${profile.variablesExpr} } catch(e) { null }`);
      if (variables && typeof variables === "object") {
        return { profile, variables };
      }
    } catch {
      // try next profile
    }
  }
  return null;
}

export async function readMeta(profile) {
  return evalInPage(`try { ${profile.metaExpr} } catch(e) { null }`);
}

export async function readSetupKeys() {
  const expr = `(function(){
    var S = window.SugarCube;
    if (!S || !S.setup) return null;
    var keys = Object.keys(S.setup).sort();
    var out = {};
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      try {
        var v = S.setup[k];
        var t = v === null ? "null" : (Array.isArray(v) ? "array" : typeof v);
        if (t === "function") out[k] = "[Function]";
        else if (t === "object" && v !== null) out[k] = JSON.parse(JSON.stringify(v));
        else out[k] = v;
      } catch(e) {
        out[k] = "[unreadable]";
      }
    }
    return out;
  })()`;
  return evalInPage(expr);
}

export async function readPassageList() {
  const expr = `(function(){
    var S = window.SugarCube;
    if (!S) return null;
    if (S.Story && typeof S.Story.size === "number") {
      var names = [];
      S.Story.forEach(function(p) { names.push(p.name || p.title || String(p)); });
      return names.sort();
    }
    if (S.tale && S.tale.entries) {
      return Object.keys(S.tale.entries).sort();
    }
    return null;
  })()`;
  return evalInPage(expr);
}

export async function goToPassage(name) {
  const expr = `(function(){
    var S = window.SugarCube;
    if (!S) return false;
    if (S.Engine && S.Engine.play) { S.Engine.play(${JSON.stringify(name)}); return true; }
    if (S.play) { S.play(${JSON.stringify(name)}); return true; }
    return false;
  })()`;
  return evalInPage(expr);
}

export async function readHistory() {
  const expr = `(function(){
    var S = window.SugarCube;
    if (!S || !S.History) return null;
    var items = [];
    for (var i = 0; i < S.History.length; i++) {
      var h = S.History[i];
      items.push({
        index: i,
        passage: h.passage || h.title || (h.state && h.state.passage) || "?"
      });
    }
    return items;
  })()`;
  return evalInPage(expr);
}
