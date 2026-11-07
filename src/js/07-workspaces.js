// Arc's Spaces on top of Vivaldi Workspaces: which workspace a tab is in, the list of spaces for the space bar,
// where switching to a space goes, and which pinned-links folder belongs to which space.
// A workspace is not a login: all of them share the profile's cookies (profiles are the isolation boundary).
(() => {
  const ARC_PREFIX = "Arc - ";

  // Vivaldi keeps the workspace id in the tab's vivExtData JSON; no key means the default space (id 0).
  const of = (tab) => {
    try { return Number(JSON.parse(tab?.vivExtData || "{}").workspaceId) || 0; } catch (_) { return 0; }
  };
  const tabsIn = (tabs, id) => tabs.filter((t) => of(t) === id);
  const activeId = (tabs) => {
    const active = tabs.find((t) => t.active);
    return active ? of(active) : 0;
  };

  // What the sidebar lists: the active space's tabs. With no known workspace everything is one space, so a failed
  // read of the list never hides tabs.
  const scope = (tabs, list) => {
    if (!list?.length) return { active: 0, tabs };
    const active = activeId(tabs);
    return { active, tabs: tabsIn(tabs, active) };
  };

  // Without any workspace there is only one space, so no bar.
  const items = (list, defaultName) => {
    if (!list?.length) return [];
    return [{ id: 0, name: defaultName, emoji: "", icon: "" },
      ...list.map((w) => ({ id: w.id, name: w.name, emoji: w.emoji || "", icon: w.emoji ? "" : w.icon || "" }))];
  };

  const itemForShortcut = (list, defaultName, combo) => {
    const match = /^(?:ctrl\+([1-9])|([1-9])\+ctrl)$/.exec(String(combo).toLowerCase().replace(/\s/g, ""));
    return match ? items(list, defaultName)[Number(match[1] || match[2]) - 1] || null : null;
  };

  // Where switching to a space lands: its most recently used tab (Vivaldi then switches the workspace by itself).
  const recentTab = (tabs, id) => {
    const own = tabsIn(tabs, id);
    if (!own.length) return null;
    return own.reduce((best, t) => ((t.lastAccessed ?? 0) > (best.lastAccessed ?? 0) ||
      ((t.lastAccessed ?? 0) === (best.lastAccessed ?? 0) && t.index > best.index) ? t : best));
  };

  // After the active tab of space `closed` closes or leaves the window, Vivaldi may activate a tab of another space
  // (and then ignore a switch back, as it believes it is still in `closed`). Arc stays in the space: returns the
  // tab to bring back, { empty: true } when the space has no tab left, or null when nothing needs doing.
  const stayIn = (tabs, closed, removedIds = new Set()) => {
    const active = tabs.find((t) => t.active);
    if (!active || of(active) === closed) return null;
    const tab = recentTab(tabs.filter((t) => !removedIds.has(t.id)), closed);
    return tab ? { tab } : { empty: true };
  };

  const label = (folder) => folder.title.startsWith(ARC_PREFIX) ? folder.title.slice(ARC_PREFIX.length) : folder.title;
  const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

  // folders: every bookmark folder that holds a Pinned folder, in bookmark order. A workspace takes the folder with
  // its name; the default space is the first folder nobody claims (the only one, if all are claimed).
  const assign = (folders, list) => {
    const byId = {};
    const used = new Set();
    for (const w of list || []) {
      const found = folders.find((f) => !used.has(f.id) && same(label(f), w.name));
      if (found) { byId[w.id] = found; used.add(found.id); }
    }
    return { default: folders.find((f) => !used.has(f.id)) ?? folders[0] ?? null, byId };
  };

  // A tab opened while a space is active joins it. Vivaldi does not do this for tabs a mod or a command bar opens,
  // so they would land in the default space. Returns the new vivExtData, or null when nothing needs writing.
  // Every window runs its own copy of the mod and sees the tabs of all windows, so only this window's tabs are stamped.
  const stamp = (tab, activeSpace, windowId) => {
    if (!activeSpace || tab?.windowId !== windowId) return null;
    let data;
    try { data = JSON.parse(tab?.vivExtData || "{}") || {}; } catch (_) { data = {}; }
    if ("workspaceId" in data) return null;
    return JSON.stringify({ ...data, workspaceId: activeSpace });
  };

  // Writing the workspace list in the prefs does nothing (Vivaldi reads it once); spaces are created through
  // Vivaldi's workspace manager (findManager). The install still binds "Create New Workspace" to this chord, and
  // the hint names it when the manager cannot be found.
  const CREATE_KEY = "ctrl+meta+n";
  const KEY_NAMES = { ctrl: "Ctrl", meta: "Cmd", alt: "Option", shift: "Shift" };
  const CREATE_HINT = `Press ${CREATE_KEY.split("+").map((k) => KEY_NAMES[k] || k.toUpperCase()).join("+")} to create a space`;

  // Vivaldi has no extension API to change workspaces, only its own store. Its webpack chunk array lives on the
  // background page (chrome.extension.getBackgroundPage), not on the window the mod runs in, and its push hands out
  // the module list; the module of the workspace manager is found by its source and loaded only if it already ran.
  // The manager (Vivaldi 8.3) has addWorkspace(name, icon, emoji, tabs, stayHere), setName(id, name),
  // setEmoji(id, emoji), setOrder(ids) and removeWorkspace(windowId, id). Returns it, or null when Vivaldi no
  // longer looks like this.
  const findManager = (chunks) => {
    try {
      let load;
      chunks.push([[Symbol("vivarc")], {}, (require) => { load = require; }]);
      for (const [id, factory] of Object.entries(load?.m || {})) {
        if (!String(factory).includes("removeWorkspace(")) continue;
        let exported;
        try { exported = load(id); } catch (_) { continue; }
        for (const key of Object.keys(exported || {})) {
          const manager = exported[key];
          if (typeof manager?.removeWorkspace === "function") return manager;
        }
      }
    } catch (_) {}
    return null;
  };
  const findRemover = (chunks) => {
    const manager = findManager(chunks);
    return manager ? (windowId, workspaceId) => manager.removeWorkspace(windowId, workspaceId) : null;
  };

  // Vivaldi's own workspace icons (its workspace menu offers them): 16 px line drawings in currentColor, set with
  // setIcon(id, index), which also clears the emoji. The workspace store's module exports the list.
  let icons = null;
  const findIcons = (chunks) => {
    if (icons) return icons;
    try {
      let load;
      chunks.push([[Symbol("vivarc-icons")], {}, (require) => { load = require; }]);
      for (const [id, factory] of Object.entries(load?.m || {})) {
        const source = String(factory);
        if (source.length > 200000 || !source.includes("activeWorkspaces")) continue; // the workspace store's module
        let exported;
        try { exported = load(id); } catch (_) { continue; }
        const list = Object.values(exported || {}).find((v) => Array.isArray(v) && v.length >= 8 && v.every((x) => typeof x === "string" && x.trim().startsWith("<svg")));
        if (list) return (icons = list);
      }
    } catch (_) {}
    return [];
  };
  // An icon drawn through a CSS mask in the text color, so its markup is never put in the page.
  const iconMask = (svg) => `url("data:image/svg+xml;utf8,${encodeURIComponent(String(svg || ""))}")`;

  // The order of the spaces after dragging `id` to `to` (an index among the workspaces, the default space not
  // counted: it is not a workspace and stays first).
  const reorder = (ids, id, to) => {
    const rest = ids.filter((x) => x !== id);
    if (rest.length === ids.length) return ids;
    rest.splice(Math.max(0, Math.min(rest.length, to)), 0, id);
    return rest;
  };

  // An emoji typed or pasted: its first character as the user sees it (a flag or a family is one), or "".
  const firstGrapheme = (text) => {
    const value = String(text || "").trim();
    if (!value) return "";
    try { return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)][0]?.segment || ""; }
    catch (_) { return [...value][0] || ""; }
  };

  // Use the same workspace activation action as Vivaldi's own workspace menu.
  const findSwitcher = (chunks) => {
    try {
      let load;
      chunks.push([[Symbol("vivarc-switch")], {}, (require) => { load = require; }]);
      for (const [id, factory] of Object.entries(load?.m || {})) {
        if (!String(factory).includes("setActiveWorkspace:")) continue;
        let exported;
        try { exported = load(id); } catch (_) { continue; }
        for (const key of Object.keys(exported || {})) {
          const actions = exported[key];
          if (typeof actions?.setActiveWorkspace === "function") return (windowId, workspaceId) => actions.setActiveWorkspace(windowId, workspaceId || undefined);
        }
      }
    } catch (_) {}
    return null;
  };

  const removalLabel = (name, tabCount) =>
    `Delete \u201c${name}\u201d${tabCount ? ` and close its ${tabCount} ${tabCount === 1 ? "tab" : "tabs"}` : ""}`;

  window.__vm.workspaces = { of, tabsIn, activeId, scope, items, itemForShortcut, recentTab, stayIn, label, assign, stamp, findManager, findRemover, findSwitcher, findIcons, iconMask, removalLabel, reorder, firstGrapheme, CREATE_HINT };
})();
