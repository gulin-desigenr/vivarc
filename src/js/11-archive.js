// Tab archive, like Arc's: archiving closes a tab but keeps it, searchable from the command bar ("Archived Tabs",
// or any search) and restorable into the space it came from. Not the same as Vivaldi's Memory Saver, which keeps
// the tab open and only unloads it. The list lives in the profile's IndexedDB (key "archive"), newest first.
(() => {
  const { store } = window.__vm;
  const KEY = "archive";
  const MAX = 1000;

  // ---- pure helpers (tested) ----
  const entry = (tab, spaceName, now = Date.now()) => ({
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    url: tab.url,
    title: tab.title || tab.url,
    favicon: /^(https?:|data:)/.test(tab.favIconUrl || "") ? tab.favIconUrl : "",
    space: window.__vm.workspaces?.of(tab) ?? 0,
    spaceName: spaceName || "",
    at: now,
  });
  // New entries go first; an archived page that was already there (same address, same space) moves up.
  const add = (list, entries, max = MAX) => {
    const key = (e) => `${e.space}\n${e.url}`;
    const fresh = new Set(entries.map(key));
    return [...entries, ...list.filter((e) => !fresh.has(key(e)))].slice(0, max);
  };
  const remove = (list, id) => list.filter((e) => e.id !== id);
  const search = (list, text, limit = Infinity) => {
    const words = String(text || "").toLowerCase().split(/\s+/).filter(Boolean);
    return list.filter((e) => {
      const hay = `${e.title} ${e.url} ${e.spaceName}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    }).slice(0, limit);
  };
  const ago = (at, now = Date.now()) => {
    const minutes = Math.max(0, Math.floor((now - at) / 60000));
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.round(hours / 24);
    return days === 1 ? "yesterday" : `${days} days ago`;
  };
  const describe = (e, now) => {
    let host = "";
    try { host = new URL(e.url).hostname.replace(/^www\./, ""); } catch (_) {}
    return [host, e.spaceName, ago(e.at, now)].filter(Boolean).join(" · ");
  };

  // ---- storage and tabs ----
  const load = async () => (await store?.get(KEY, [])) || [];
  const save = (list) => store.set(KEY, list);
  const toast = (message) => window.dispatchEvent(new CustomEvent("vm-toast", { detail: message }));
  const isPage = (tab) => /^https?:|^file:/.test(tab?.url || "");

  // Archive and close `tabs` (web pages only). A window never loses its last tab: a blank one opens first.
  const archiveTabs = async (tabs, { quiet = false } = {}) => {
    const pages = tabs.filter(isPage);
    if (!pages.length) return 0;
    const now = Date.now();
    const nameOf = window.__vm.spaceNameOf || (() => "");
    await save(add(await load(), pages.map((t, i) => entry(t, nameOf(window.__vm.workspaces?.of(t) ?? 0), now - i))));
    const remaining = await chrome.tabs.query({ windowId: pages[0].windowId });
    if (remaining.every((t) => pages.some((p) => p.id === t.id))) await chrome.tabs.create({ windowId: pages[0].windowId });
    await chrome.tabs.remove(pages.map((t) => t.id));
    if (!quiet) toast(pages.length === 1 ? "Archived Tab" : `Archived ${pages.length} Tabs`);
    window.dispatchEvent(new CustomEvent("vm-archive-changed"));
    return pages.length;
  };

  // Reopen an archived page in its own space (the current one if that space is gone) and drop it from the archive.
  // Vivaldi 8.3 ignores workspaceId writes to vivExtData; tabs change space only through tabsPrivate.move (what its
  // "Move to Workspace" menu uses), and only into a workspace that already has a tab in the window. So: the active
  // space gets a plain new tab; a space with tabs gets one moved in; an empty space is switched to first (Vivaldi
  // then opens a blank tab there, which is navigated). While this runs the sidebar does not stamp the new tab.
  const BLANK = /^(chrome|vivaldi):\/\/(newtab|vivaldi-webui\/startpage)/;
  const restore = async (e) => {
    const ws = window.__vm.workspaces;
    const windowId = window.vivaldiWindowId;
    const tabs = await chrome.tabs.query({ windowId });
    const current = ws.activeId(tabs);
    const target = (window.__vm.spaceExists?.(e.space) ?? true) ? e.space : current;
    api.busy = true;
    try {
      if (target === current) {
        await chrome.tabs.create({ windowId, url: e.url, active: true });
      } else if (ws.tabsIn(tabs, target).length) {
        const tab = await chrome.tabs.create({ windowId, url: e.url, active: false });
        await vivaldi.tabsPrivate.move({ tabIds: [tab.id], target: "last", tweaks: ["do-not-reparent"], workspaceId: target || "window" });
        await chrome.tabs.update(tab.id, { active: true });
      } else {
        const activate = ws.findSwitcher(chrome.extension.getBackgroundPage?.()?.webpackChunkgapp_browser_react);
        window.__vm.switchingSpace = true;
        try { await activate?.(windowId, target); } finally { window.__vm.switchingSpace = false; }
        const [active] = await chrome.tabs.query({ active: true, windowId });
        if (active && ws.of(active) === target && BLANK.test(active.pendingUrl || active.url || "")) {
          await chrome.tabs.update(active.id, { url: e.url });
        } else {
          await chrome.tabs.create({ windowId, url: e.url, active: true });
        }
      }
    } finally {
      setTimeout(() => { api.busy = false; }, 300);
    }
    await save(remove(await load(), e.id));
    window.dispatchEvent(new CustomEvent("vm-archive-changed"));
  };

  const forget = async (id) => {
    await save(remove(await load(), id));
    window.dispatchEvent(new CustomEvent("vm-archive-changed"));
  };

  const api = { entry, add, remove, search, ago, describe, load, archiveTabs, restore, forget, busy: false };
  window.__vm.archive = api;
})();
