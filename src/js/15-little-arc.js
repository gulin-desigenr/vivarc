// Little Vivarc: a temporary popup, centred on the screen under the pointer, that can return its actual tab to its source window.
// Links opened from other apps are routed into it (setting "littleExternalLinks").
(() => {
  const background = chrome.extension.getBackgroundPage?.();
  if (!background) return;
  const registry = background.__vivarcLittleWindows ||= new Map();
  const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("vivarc-little-arc") : null;
  const startedAt = Date.now();
  const isWeb = (url) => /^https?:\/\//i.test(url || "");
  let metadata = null;
  let toolbar = null;
  let littleWindowId = null;
  let promotionPending = false;
  const toast = (text) => window.dispatchEvent(new CustomEvent("vm-toast", { detail: text }));

  // The screen under the pointer, from the helper vivarc.py runs on 127.0.0.1 (src/native/pointer.py). Vivaldi's UI
  // cannot read the global pointer, and a link from another app should open on the screen where it was clicked.
  const POINTER_URL = "http://127.0.0.1:47391/pointer";
  const pointerScreen = async () => {
    if (typeof fetch !== "function") return null;
    try {
      const response = await fetch(POINTER_URL, { cache: "no-store", signal: AbortSignal.timeout?.(400) });
      const reply = await response.json();
      const d = reply?.display;
      if (!d) throw new Error(reply?.error || "no display");
      return { left: d.left, top: d.top + MENU_BAR, width: d.width, height: d.height - MENU_BAR };
    } catch (error) {
      console.warn("[vivarc] Little Vivarc pointer helper:", error);
      return null;
    }
  };
  const MENU_BAR = 24;

  // Size from the source window, centred on the given screen area (default: the screen the source window is on).
  const frame = (origin, area) => {
    const s = window.screen || {};
    area ||= { left: s.availLeft ?? origin.left ?? 0, top: s.availTop ?? origin.top ?? 0,
      width: s.availWidth || origin.width, height: s.availHeight || origin.height };
    const width = Math.min(1000, Math.max(480, Math.round((origin.width || 1200) * .7)), area.width || Infinity);
    const height = Math.min(760, Math.max(400, Math.round((origin.height || 900) * .75)), area.height || Infinity);
    const left = Math.round(area.left + Math.max(0, (area.width || width) - width) / 2);
    const top = Math.round(area.top + Math.max(0, (area.height || height) - height) / 2);
    return { width, height, left, top };
  };

  const openPopup = async (source, origin) => {
    const area = await pointerScreen();
    const popup = await chrome.windows.create({ ...source, type: "popup", focused: true, ...frame(origin, area) });
    if (!popup?.id) throw new Error("Could not create Little Vivarc window");
    registry.set(popup.id, { originWindowId: origin.id });
    channel?.postMessage({ windowId: popup.id });
    return popup;
  };

  // With a web page: that page in a Little Vivarc. Without one: a blank Little Vivarc for a quick search.
  window.__vm.openLittleArc = async (tab) => {
    if (tab && !isWeb(tab.url)) {
      toast("Little Vivarc supports web pages (http or https).");
      return;
    }
    const origin = await chrome.windows.getCurrent();
    if (!origin?.id) throw new Error("Source window unavailable");
    await openPopup({ url: tab?.url || "about:blank" }, origin);
  };

  // ---- Global shortcut (Option+Command+N, registered by the helper) ----
  // The helper opens LITTLE_URL in Vivaldi; the window that receives that tab swaps it for a blank Little Vivarc.
  const LITTLE_URL = "http://127.0.0.1:47391/little/new";
  const handled = new Set();
  const catchShortcut = (tab) => {
    const url = tab?.pendingUrl || tab?.url || "";
    if (!url.startsWith(LITTLE_URL) || tab.windowId !== window.vivaldiWindowId || handled.has(tab.id)) return false;
    handled.add(tab.id);
    chrome.tabs.remove(tab.id).catch(() => {});
    window.__vm.openLittleArc().catch((error) => console.warn("[vivarc] Little Vivarc shortcut:", error));
    return true;
  };
  chrome.tabs.onCreated?.addListener(catchShortcut);
  chrome.tabs.onUpdated?.addListener((_id, change, tab) => { if (change.url || change.status) catchShortcut(tab); });
  // Vivaldi started by the shortcut: the tab can predate this code.
  chrome.tabs.query?.({ windowId: window.vivaldiWindowId })?.then?.((tabs) => tabs.forEach(catchShortcut)).catch?.(() => {});

  // ---- Links from other apps ----
  // Chromium gives no "external" flag, so a tab counts as external when: it lands in this normal window with a web URL,
  // has no opener, was not created by this window's UI (chrome.tabs/windows.create are stamped below), and its first
  // navigation commits as a plain link (bookmarks, typed URLs, restores and back/forward commit differently).
  let lastUiCreate = 0;
  for (const api of [chrome.tabs, chrome.windows]) {
    const original = api?.create;
    if (typeof original !== "function" || original.__vmStamped) continue;
    const stamped = function (...args) { lastUiCreate = Date.now(); return original.apply(this, args); };
    stamped.__vmStamped = true;
    try { api.create = stamped; } catch (_) {}
  }
  const candidates = new Map();
  const externalEnabled = () => window.__vm.settings?.get?.("littleExternalLinks") !== false;

  chrome.tabs.onCreated?.addListener((tab) => {
    if (tab.windowId !== window.vivaldiWindowId || registry.has(window.vivaldiWindowId)) return;
    if (!externalEnabled() || Date.now() - startedAt < 5000 || Date.now() - lastUiCreate < 1500) return;
    if (tab.openerTabId != null || tab.active === false || !isWeb(tab.pendingUrl || tab.url)) return;
    if ((tab.pendingUrl || tab.url).startsWith(LITTLE_URL)) return;
    candidates.set(tab.id, Date.now());
    setTimeout(() => candidates.delete(tab.id), 15000);
  });

  // Popups take no tabs.move / tabs.create (Chromium sends those to a normal window), so the page goes in when the
  // popup is created: first the tab itself (no reload, so a one-time sign-in link is not spent twice), else its URL.
  const routeExternal = async (tabId) => {
    const origin = await chrome.windows.get(window.vivaldiWindowId);
    if (origin?.type !== "normal") return;
    let popup = null;
    try {
      popup = await openPopup({ tabId }, origin);
    } catch (error) {
      console.warn("[vivarc] Little Vivarc: could not move the tab, reopening it", error);
    }
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (popup && (!tab || tab.windowId === popup.id)) return;
    const url = tab?.url || tab?.pendingUrl;
    if (!popup) {
      if (!isWeb(url)) return;
      popup = await openPopup({ url }, origin);
    }
    // Whatever happened, the page must not stay behind in the main window.
    if (tab && tab.windowId !== popup.id) await chrome.tabs.remove(tabId).catch(() => {});
  };

  chrome.webNavigation?.onCommitted?.addListener((details) => {
    if (details.frameId !== 0 || !candidates.has(details.tabId)) return;
    candidates.delete(details.tabId);
    const qualifiers = details.transitionQualifiers || [];
    if (!["link", "auto_toplevel"].includes(details.transitionType)) return;
    if (qualifiers.includes("from_address_bar") || qualifiers.includes("forward_back")) return;
    routeExternal(details.tabId).catch((error) => console.warn("[vivarc] Little Vivarc:", error));
  });

  // ---- Back to the main window ----
  // Transfer from the still-open origin context: moving the popup's last tab destroys its UI context.
  const promoteFromOrigin = async (littleId) => {
    const record = registry.get(littleId);
    if (!record || record.originWindowId !== window.vivaldiWindowId) return;
    try {
      const destination = await chrome.windows.get(record.originWindowId);
      if (!destination?.id || destination.type !== "normal") throw new Error("Original window is no longer open");
      const [active, target] = await Promise.all([
        chrome.tabs.query({ active: true, windowId: record.originWindowId }),
        chrome.tabs.query({ active: true, windowId: littleId }),
      ]);
      if (!target[0]?.id) throw new Error("No page to move");
      const workspaceId = window.__vm.workspaces.of(active[0]);
      const moved = await chrome.tabs.move(target[0].id, { windowId: record.originWindowId, index: -1 });
      let ext = {};
      try { ext = JSON.parse(moved.vivExtData || "{}"); } catch (_) {}
      delete ext.group;
      delete ext.tiling;
      if (workspaceId) ext.workspaceId = workspaceId;
      else delete ext.workspaceId;
      await chrome.tabs.update(moved.id, { active: true, vivExtData: JSON.stringify(ext) });
      // Vivaldi 8.3 ignores workspaceId in vivExtData; its own move puts the page in the origin's space.
      try {
        await vivaldi.tabsPrivate.move({ tabIds: [moved.id], target: "last", tweaks: ["do-not-reparent"], workspaceId: workspaceId || "window" });
        await chrome.tabs.update(moved.id, { active: true });
      } catch (_) {}
      await chrome.windows.update(record.originWindowId, { focused: true });
    } catch (error) {
      console.warn("[vivarc] Little Vivarc:", error);
      channel?.postMessage({ action: "failed", windowId: littleId });
      toast("Could not move the Little Vivarc page.");
    }
  };

  const promote = () => {
    if (!metadata || !toolbar || promotionPending) return;
    if (!channel) { toast("Little Vivarc transfer is unavailable."); return; }
    promotionPending = true;
    toolbar.querySelector(".vm-little-promote").disabled = true;
    channel.postMessage({ action: "promote", windowId: littleWindowId });
    // The source window might have been closed; leave the temporary page intact.
    setTimeout(() => {
      if (!promotionPending || !toolbar?.isConnected) return;
      promotionPending = false;
      toolbar.querySelector(".vm-little-promote").disabled = false;
      toast("Could not move the page. Check that its original window is open.");
    }, 2500);
  };

  // ---- The Little Vivarc bar: back, forward, reload, an editable address and "Open in Vivarc", in the title bar ----
  const ICONS = {
    back: '<path d="M15 18l-6-6 6-6"/>',
    forward: '<path d="M9 18l6-6-6-6"/>',
    reload: '<path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"/>',
    open: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  };
  const icon = (name) => `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  const looksLikeUrl = (text) => /^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^(localhost|[^\s/]+\.[a-z]{2,})(:\d+)?(\/\S*)?$/i.test(text);
  const shownUrl = (url) => (/^about:blank$/.test(url || "") ? "" : (url || "").replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""));
  let address = null;
  let currentTabId = null;

  // The search engine chosen in Vivaldi's settings (chrome.search is not available to Vivaldi's UI).
  window.__vm.defaultSearchUrl = async (query) => {
    try {
      const reply = await vivaldi.searchEngines.getTemplateUrls();
      const engine = (reply.templateUrls || []).find((t) => t.guid === reply.defaultSearch);
      const template = (engine?.url || "").replace(/\{google:baseURL\}/g, "https://www.google.com/");
      if (/\{searchTerms\}|%s/.test(template)) {
        const url = template.replace(/\{searchTerms\}|%s/, encodeURIComponent(query)).replace(/\{[^}]*\}/g, "");
        if (/^https?:\/\//.test(url)) return url;
      }
    } catch (_) {}
    return `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
  };

  const activeTab = async () => (await chrome.tabs.query({ windowId: littleWindowId, active: true }))[0];
  const showTab = (tab) => {
    if (!tab || tab.windowId !== littleWindowId || !address) return;
    currentTabId = tab.id;
    if (document.activeElement !== address) address.value = shownUrl(tab.pendingUrl || tab.url);
    address.title = tab.url || "";
  };
  const navigate = async (text) => {
    const tab = await activeTab();
    if (!tab || !text.trim()) return;
    const query = text.trim();
    if (looksLikeUrl(query)) {
      await chrome.tabs.update(tab.id, { url: /^[a-z][a-z0-9+.-]*:\/\//i.test(query) ? query : `https://${query}` });
      return;
    }
    await chrome.tabs.update(tab.id, { url: await window.__vm.defaultSearchUrl(query) });
  };
  const button = (name, title, run) => {
    const b = document.createElement("button");
    b.className = `vm-little-button vm-little-${name}`;
    b.title = title;
    b.innerHTML = icon(name);
    b.addEventListener("click", () => run().catch?.(() => {}));
    return b;
  };

  const install = async () => {
    const current = await chrome.windows.getCurrent();
    const found = registry.get(current?.id);
    const browser = document.querySelector("#browser");
    if (!found || !browser) return;
    // Vivaldi rewrites #browser's classes on re-render; onMark calls this again to put the marker back.
    browser.classList.add("vm-little-arc");
    if (toolbar?.isConnected) return;
    metadata = found;
    littleWindowId = current.id;
    toolbar = document.createElement("div");
    toolbar.className = "vm-little-toolbar";
    address = document.createElement("input");
    address.className = "vm-little-address";
    address.spellcheck = false;
    address.placeholder = "Search or enter address";
    address.addEventListener("focus", () => address.select());
    address.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") { navigate(address.value).catch(() => {}); address.blur(); }
      if (e.key === "Escape") { address.blur(); activeTab().then(showTab); }
    });
    address.addEventListener("blur", () => activeTab().then(showTab));
    const promoteButton = document.createElement("button");
    promoteButton.className = "vm-little-promote";
    promoteButton.title = "Open in the main Vivarc window";
    promoteButton.innerHTML = `<span>Open in Vivarc</span>${icon("open")}`;
    promoteButton.addEventListener("click", promote);
    toolbar.append(
      button("back", "Back", async () => chrome.tabs.goBack((await activeTab()).id)),
      button("forward", "Forward", async () => chrome.tabs.goForward((await activeTab()).id)),
      button("reload", "Reload", async () => chrome.tabs.reload((await activeTab()).id)),
      address,
      promoteButton,
    );
    browser.append(toolbar);
    const tab = await activeTab();
    showTab(tab);
    // A blank Little Vivarc (opened by its shortcut) is for a quick search: start in the address field.
    if (!tab || /^(about:blank|chrome:\/\/newtab|vivaldi:\/\/newtab)/.test(tab.pendingUrl || tab.url || "")) setTimeout(() => address.focus(), 50);
  };
  chrome.tabs.onUpdated?.addListener((_id, _change, tab) => { if (tab.active) showTab(tab); });
  chrome.tabs.onActivated?.addListener(({ windowId }) => { if (windowId === littleWindowId) activeTab().then(showTab); });
  channel && (channel.onmessage = ({ data }) => {
    if (data?.action === "promote") promoteFromOrigin(data.windowId);
    else if (data?.action === "failed" && data.windowId === littleWindowId && toolbar) {
      promotionPending = false;
      toolbar.querySelector(".vm-little-promote").disabled = false;
      toast("Could not move the page. Check that its original window is open.");
    } else install().catch(() => {});
  });
  window.__vm.onMark((browser) => {
    if (littleWindowId != null) browser.classList.add("vm-little-arc");
    install().catch(() => {});
  });
  chrome.windows.onRemoved.addListener((id) => registry.delete(id));
  install().catch(() => {});
})();
