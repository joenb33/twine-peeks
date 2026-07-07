(function () {
  "use strict";

  var PATH_SEP = "\u0000";

  function specificType(v) {
    if (v === null) return "null";
    if (v === undefined) return "undefined";
    if (Array.isArray(v)) return "array";
    if (v instanceof Map) return "map";
    if (v instanceof Set) return "set";
    if (typeof v === "function") return "function";
    return typeof v;
  }

  function isPrimitive(v) {
    var t = specificType(v);
    return t === "string" || t === "number" || t === "boolean" || t === "null" || t === "undefined";
  }

  function deepEqual(a, b) {
    if (Object.is(a, b)) return true;
    var ta = specificType(a);
    var tb = specificType(b);
    if (ta !== tb) return ta === "function" && tb === "function";
    if (ta === "array") {
      if (a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) {
        if (!deepEqual(a[i], b[i])) return false;
      }
      return true;
    }
    if (ta === "map") {
      if (a.size !== b.size) return false;
      for (var entry of a.entries()) {
        if (!b.has(entry[0]) || !deepEqual(entry[1], b.get(entry[0]))) return false;
      }
      return true;
    }
    if (ta === "set") {
      if (a.size !== b.size) return false;
      var rest = Array.from(b);
      for (var item of a) {
        var idx = rest.findIndex(function (x) { return deepEqual(x, item); });
        if (idx === -1) return false;
        rest.splice(idx, 1);
      }
      return true;
    }
    if (ta === "object") {
      var keys = Object.keys(a);
      if (keys.length !== Object.keys(b).length) return false;
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        if (!Object.prototype.hasOwnProperty.call(b, key) || !deepEqual(a[key], b[key])) return false;
      }
      return true;
    }
    return false;
  }

  function cloneValue(v) {
    if (v === null || v === undefined) return v;
    var t = specificType(v);
    if (t === "function") return v;
    if (t === "array") return v.map(cloneValue);
    if (t === "map") {
      var m = new Map();
      v.forEach(function (val, key) { m.set(key, cloneValue(val)); });
      return m;
    }
    if (t === "set") {
      var s = new Set();
      v.forEach(function (val) { s.add(cloneValue(val)); });
      return s;
    }
    if (t === "object") {
      var o = {};
      Object.keys(v).forEach(function (key) { o[key] = cloneValue(v[key]); });
      return o;
    }
    return v;
  }

  function summarize(v) {
    if (v === undefined) return undefined;
    if (v === null) return null;
    var t = specificType(v);
    if (t === "string") return v.length > 80 ? v.slice(0, 77) + "…" : v;
    if (t === "number" || t === "boolean") return v;
    if (t === "array") return "[Array(" + v.length + ")]";
    if (t === "map") return "[Map(" + v.size + ")]";
    if (t === "set") return "[Set(" + v.size + ")]";
    if (t === "function") return "[Function]";
    if (t === "object") return "[Object]";
    return String(v);
  }

  function pathToStr(path) {
    return path.join(PATH_SEP);
  }

  function strToPath(str) {
    return str ? str.split(PATH_SEP) : [];
  }

  function getStateValue(root, path) {
    var cur = root;
    for (var i = 0; i < path.length; i++) {
      if (cur == null) return undefined;
      var key = path[i];
      if (Array.isArray(cur)) cur = cur[Number(key)];
      else if (cur instanceof Map) cur = cur.get(String(key));
      else cur = cur[key];
    }
    return cur;
  }

  function getStateParent(root, path) {
    if (!path.length) return null;
    return getStateValue(root, path.slice(0, -1));
  }

  function setStateAtPath(root, path, value) {
    if (!path.length) throw new Error("Empty path");
    var parent = getStateValue(root, path.slice(0, -1));
    var key = path[path.length - 1];
    if (Array.isArray(parent)) parent[Number(key)] = value;
    else if (parent instanceof Map) parent.set(String(key), value);
    else parent[key] = value;
  }

  function deleteFromState(root, path) {
    if (!path.length) throw new Error("Empty path");
    var parent = getStateValue(root, path.slice(0, -1));
    var key = path[path.length - 1];
    if (Array.isArray(parent)) parent.splice(Number(key), 1);
    else if (parent instanceof Map) parent.delete(String(key));
    else delete parent[key];
  }

  function addStateProperty(root, parentPath, key, value) {
    var parent = parentPath.length ? getStateValue(root, parentPath) : root;
    if (parent == null || typeof parent !== "object") throw new Error("Invalid parent");
    if (Array.isArray(parent)) parent.push(value);
    else if (parent instanceof Map) parent.set(String(key), value);
    else parent[String(key)] = value;
  }

  function duplicateStateProperty(root, parentPath, sourceKey, targetKey) {
    var parent = getStateValue(root, parentPath);
    if (parent == null || typeof parent !== "object") throw new Error("Invalid parent");
    if (Array.isArray(parent)) {
      parent.push(cloneValue(parent[Number(sourceKey)]));
      return;
    }
    if (!targetKey) throw new Error("targetKey required");
    var val = parent instanceof Map ? parent.get(String(sourceKey)) : parent[sourceKey];
    if (parent instanceof Map) parent.set(String(targetKey), cloneValue(val));
    else parent[targetKey] = cloneValue(val);
  }

  function findDifferences(oldVal, newVal, path, diffs) {
    if (deepEqual(oldVal, newVal)) return;

    var oldT = specificType(oldVal);
    var newT = specificType(newVal);

    if (oldT !== newT) {
      diffs.push({
        kind: "type-changed",
        path: path.slice(),
        oldValue: summarize(oldVal),
        newValue: summarize(newVal),
      });
      return;
    }

    if (isPrimitive(oldVal)) {
      diffs.push({
        kind: "update",
        path: path.slice(),
        oldValue: oldVal,
        newValue: newVal,
      });
      return;
    }

    if (oldT === "map") {
      var allKeys = new Set();
      oldVal.forEach(function (_, k) { allKeys.add(String(k)); });
      newVal.forEach(function (_, k) { allKeys.add(String(k)); });
      allKeys.forEach(function (k) {
        var had = oldVal.has(k);
        var has = newVal.has(k);
        var childPath = path.concat(k);
        if (had && !has) {
          diffs.push({ kind: "remove", path: path.slice(), key: k, oldValue: summarize(oldVal.get(k)) });
        } else if (!had && has) {
          diffs.push({ kind: "add", path: path.slice(), key: k, newValue: summarize(newVal.get(k)) });
        } else {
          findDifferences(oldVal.get(k), newVal.get(k), childPath, diffs);
        }
      });
      return;
    }

    if (oldT === "set") {
      if (oldVal.size !== newVal.size) {
        diffs.push({ kind: "set-size", path: path.slice(), oldValue: oldVal.size, newValue: newVal.size });
      }
      return;
    }

    if (oldT === "array") {
      if (oldVal.length !== newVal.length) {
        diffs.push({ kind: "array-length", path: path.slice(), oldValue: oldVal.length, newValue: newVal.length });
      }
      var max = Math.max(oldVal.length, newVal.length);
      for (var i = 0; i < max; i++) {
        if (i >= oldVal.length) {
          diffs.push({ kind: "add", path: path.slice(), key: String(i), newValue: summarize(newVal[i]) });
        } else if (i >= newVal.length) {
          diffs.push({ kind: "remove", path: path.slice(), key: String(i), oldValue: summarize(oldVal[i]) });
        } else {
          findDifferences(oldVal[i], newVal[i], path.concat(String(i)), diffs);
        }
      }
      return;
    }

    if (oldT === "object") {
      var keys = new Set(Object.keys(oldVal).concat(Object.keys(newVal)));
      keys.forEach(function (k) {
        var had = Object.prototype.hasOwnProperty.call(oldVal, k);
        var has = Object.prototype.hasOwnProperty.call(newVal, k);
        var childPath = path.concat(k);
        if (had && !has) {
          diffs.push({ kind: "remove", path: path.slice(), key: k, oldValue: summarize(oldVal[k]) });
        } else if (!had && has) {
          diffs.push({ kind: "add", path: path.slice(), key: k, newValue: summarize(newVal[k]) });
        } else {
          findDifferences(oldVal[k], newVal[k], childPath, diffs);
        }
      });
    }
  }

  function createDiffer() {
    return {
      diff: function (oldState, newState) {
        var diffs = [];
        findDifferences(oldState, newState, [], diffs);
        return diffs;
      },
    };
  }

  function createPropertyLocker(getRoot, setAtPath) {
    var locks = new Map();

    function findLock(path) {
      for (var i = 1; i <= path.length; i++) {
        var sub = pathToStr(path.slice(0, i));
        if (locks.has(sub)) return path.slice(0, i);
      }
      return null;
    }

    return {
      setLock: function (path, locked) {
        var key = pathToStr(path);
        if (locked) {
          var root = getRoot();
          locks.set(key, cloneValue(getStateValue(root, path)));
        } else {
          locks.delete(key);
        }
        return Array.from(locks.keys()).map(strToPath);
      },
      getLockedPaths: function () {
        return Array.from(locks.keys()).map(strToPath);
      },
      clearLocks: function () {
        locks.clear();
      },
      applyLocks: function () {
        locks.forEach(function (val, keyStr) {
          setAtPath(strToPath(keyStr), cloneValue(val));
        });
      },
      processDiffs: function (diffs) {
        var filtered = [];
        for (var i = 0; i < diffs.length; i++) {
          var d = diffs[i];
          var fullPath = d.path.slice();
          if (d.key !== undefined && d.kind !== "update" && d.kind !== "type-changed") {
            fullPath = d.path.concat(d.key);
          }
          var lockPath = findLock(fullPath);
          if (lockPath) {
            setAtPath(lockPath, cloneValue(locks.get(pathToStr(lockPath))));
          } else {
            filtered.push(d);
          }
        }
        return filtered;
      },
    };
  }

  function searchState(data, query, path, results, limit) {
    if (results.length >= limit) return;
    var lq = query.toLowerCase();

    if (isPrimitive(data)) {
      var str = String(data);
      if (path.length && (path[path.length - 1].toLowerCase().includes(lq) || str.toLowerCase().includes(lq))) {
        results.push({ path: path.slice(), value: summarize(data) });
      }
      return;
    }

    if (data instanceof Map) {
      data.forEach(function (val, key) {
        searchState(val, query, path.concat(String(key)), results, limit);
      });
      return;
    }

    if (data instanceof Set) {
      var idx = 0;
      data.forEach(function (val) {
        searchState(val, query, path.concat(String(idx++)), results, limit);
      });
      return;
    }

    if (Array.isArray(data)) {
      for (var i = 0; i < data.length; i++) {
        searchState(data[i], query, path.concat(String(i)), results, limit);
      }
      return;
    }

    if (data && typeof data === "object") {
      Object.keys(data).forEach(function (key) {
        if (key.toLowerCase().includes(lq)) {
          results.push({ path: path.concat(key), value: summarize(data[key]) });
        }
        searchState(data[key], query, path.concat(key), results, limit);
      });
    }
  }

  window.TwineDevToolsState = {
    specificType: specificType,
    isPrimitive: isPrimitive,
    cloneValue: cloneValue,
    summarize: summarize,
    pathToStr: pathToStr,
    strToPath: strToPath,
    getStateValue: getStateValue,
    setStateAtPath: setStateAtPath,
    deleteFromState: deleteFromState,
    addStateProperty: addStateProperty,
    duplicateStateProperty: duplicateStateProperty,
    createDiffer: createDiffer,
    createPropertyLocker: createPropertyLocker,
    searchState: searchState,
  };
})();
