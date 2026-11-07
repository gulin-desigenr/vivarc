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
  // The helper hands the press to a window waiting on LITTLE_WAIT, so no tab opens: Vivaldi stays in its space and
  // is not brought forward (a minimised window stays minimised). Only normal windows wait; the helper answers
  // "stop" to a Vivaldi it does not serve (a development copy), and a helper that is not running is asked again later.
  const LITTLE_WAIT = "http://127.0.0.1:47391/little/wait";
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitForShortcut = async () => {
    if (typeof fetch !== "function") return;
    const own = await chrome.windows.get(window.vivaldiWindowId).catch(() => null);
    if (own?.type !== "normal") return;
    for (;;) {
      let reply = null;
      try {
        const response = await fetch(LITTLE_WAIT, { cache: "no-store", headers: { "X-Vivarc": "1" }, signal: AbortSignal.timeout?.(40000) });
        reply = response.ok ? await response.json() : null;
      } catch (_) {}
      if (reply?.stop) return;
      if (reply?.open) window.__vm.openLittleArc().catch((error) => console.warn("[vivarc] Little Vivarc shortcut:", error));
      else if (!reply) await sleep(10000);
    }
  };
  waitForShortcut().catch(() => {});

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
  const promoteFromOrigin = async (littleId, spaceId = null) => {
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
        await vivaldi.tabsPrivate.move({ tabIds: [moved.id], target: "last", tweaks: ["do-not-reparent"], workspaceId: workspaceId || null });
        await chrome.tabs.update(moved.id, { active: true });
      } catch (_) {}
      // Another space chosen in the pill's menu: the sidebar's move, which lands you in that space.
      if (spaceId != null && spaceId !== workspaceId && window.__vm.moveTabToSpace) {
        await window.__vm.moveTabToSpace(moved.id, spaceId).catch((error) => console.warn("[vivarc] Little Vivarc space:", error));
      }
      await chrome.windows.update(record.originWindowId, { focused: true });
    } catch (error) {
      console.warn("[vivarc] Little Vivarc:", error);
      channel?.postMessage({ action: "failed", windowId: littleId });
      toast("Could not move the Little Vivarc page.");
    }
  };

  const promote = (spaceId = null) => {
    if (!metadata || !toolbar || promotionPending) return;
    if (!channel) { toast("Little Vivarc transfer is unavailable."); return; }
    closeSpaceMenu();
    promotionPending = true;
    toolbar.querySelector(".vm-little-promote").disabled = true;
    channel.postMessage({ action: "promote", windowId: littleWindowId, spaceId });
    // The source window might have been closed; leave the temporary page intact.
    setTimeout(() => {
      if (!promotionPending || !toolbar?.isConnected) return;
      promotionPending = false;
      toolbar.querySelector(".vm-little-promote").disabled = false;
      toast("Could not move the page. Check that its original window is open.");
    }, 2500);
  };

  // ---- The Little Vivarc bar: back, forward, reload, an editable address and "Open in Vivarc", in the title bar ----
  // The icons of the Figma design (thin strokes): the buttons draw them in a 26×24 box, the pill in small boxes.
  const ICONS = {
    back: ["0 0 26 24", 26, 24, 1.33333, '<path d="M15 16L11 12L15 8"/>'],
    forward: ["0 0 26 24", 26, 24, 1.33333, '<path d="M11 16L15 12L11 8"/>'],
    reload: ["0 0 26 24", 26, 24, 1.25, '<path d="M18 12.0039C17.9991 13.1607 17.5971 14.2813 16.8627 15.1749C16.1282 16.0685 15.1065 16.6798 13.9719 16.9046C12.8372 17.1295 11.6597 16.9539 10.6399 16.408C9.62017 15.862 8.82126 14.9793 8.37932 13.9103C7.93738 12.8413 7.87974 11.6522 8.21623 10.5455C8.55272 9.4388 9.26252 8.483 10.2247 7.84095C11.1869 7.19889 12.3419 6.91031 13.493 7.02436C14.6441 7.13841 15.72 7.64805 16.5375 8.46643M18 7.00393V10.1289H14.875"/>'],
    down: ["0 0 10 10", 10, 10, 1.25, '<path d="M2.5 3.75L5 6.25L7.5 3.75"/>'],
    check: ["0 0 12 12", 12, 12, 1.4, '<path d="M2.5 6.25L5 8.75L9.5 3.5"/>'],
  };
  const icon = (name) => {
    const [box, w, h, stroke, path] = ICONS[name];
    return `<svg viewBox="${box}" width="${w}" height="${h}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
  };
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

  // ---- Spaces for "Open in <space>": the main window knows them (its sidebar), so it answers over the channel ----
  let spaces = [];
  let spaceMenu = null;
  // Each space with its theme's hue (when it has a theme), so the pill can write its name in the space's colour.
  const answerSpaces = async (littleId) => {
    const record = registry.get(littleId);
    if (!record || record.originWindowId !== window.vivaldiWindowId) return;
    const list = window.__vm.spaceList?.() || [];
    const spaces = await Promise.all(list.map(async ({ id, name, emoji, icon, active }) => {
      const theme = await window.__vm.store?.get?.(`theme:space:${id}`, null);
      return { id, name, emoji, icon, active, hue: theme?.on ? theme.hue : null, sat: theme?.on ? theme.sat : null };
    }));
    channel?.postMessage({ action: "space-list", windowId: littleId, spaces });
  };
  const askSpaces = () => channel?.postMessage({ action: "spaces", windowId: littleWindowId });
  const showSpaces = (list) => {
    spaces = Array.isArray(list) ? list : [];
    if (!toolbar) return;
    const current = spaces.find((s) => s.active);
    const many = spaces.length > 1;
    toolbar.querySelector(".vm-little-pill")?.classList.toggle("has-spaces", many);
    const name = toolbar.querySelector(".vm-little-promote-space");
    name.textContent = many && current ? current.name : "Vivarc";
    const tinted = many && current?.hue != null;
    name.classList.toggle("tinted", tinted);
    if (tinted) {
      name.style.setProperty("--space-h", String(current.hue));
      name.style.setProperty("--space-s", `${Math.min(75, Math.max(40, current.sat))}%`);
    }
    if (spaceMenu) renderSpaceMenu();
  };
  const closeSpaceMenu = () => { spaceMenu?.remove(); spaceMenu = null; };
  const renderSpaceMenu = () => {
    spaceMenu.replaceChildren();
    const head = document.createElement("div");
    head.className = "vm-little-menu-head";
    head.textContent = "Open in";
    spaceMenu.append(head);
    for (const space of spaces) {
      const item = document.createElement("button");
      item.className = "vm-little-menu-item";
      item.classList.toggle("current", !!space.active);
      const mark = document.createElement("span");
      mark.className = "vm-little-menu-mark";
      if (!space.emoji && space.icon && window.__vm.workspaces?.iconMask) {
        const glyph = document.createElement("span");
        glyph.className = "vm-mark-icon vm-little-menu-icon";
        glyph.style.setProperty("--vm-icon", window.__vm.workspaces.iconMask(space.icon));
        mark.append(glyph);
      } else mark.textContent = space.emoji || (space.name || "?").trim().charAt(0).toUpperCase();
      const name = document.createElement("span");
      name.className = "vm-little-menu-name";
      name.textContent = space.name;
      const check = document.createElement("span");
      check.className = "vm-little-menu-check";
      if (space.active) check.innerHTML = icon("check");
      item.append(mark, name, check);
      item.addEventListener("click", () => promote(space.id));
      spaceMenu.append(item);
    }
  };
  const toggleSpaceMenu = () => {
    if (spaceMenu) return closeSpaceMenu();
    if (!toolbar || promotionPending) return;
    spaceMenu = document.createElement("div");
    spaceMenu.className = "vm-little-menu";
    renderSpaceMenu();
    toolbar.append(spaceMenu);
    askSpaces();
  };
  document.addEventListener?.("mousedown", (e) => { if (spaceMenu && !e.target.closest?.(".vm-little-menu, .vm-little-pick")) closeSpaceMenu(); }, true);
  document.addEventListener?.("keydown", (e) => { if (e.key === "Escape") closeSpaceMenu(); }, true);
  window.addEventListener?.("blur", closeSpaceMenu);

  // The bar is 44px tall: Vivaldi's "medium" placement puts the traffic lights in its middle (popups get "light",
  // at the top of a 32px bar). Vivaldi sets the placement again on some window changes, so it is put back.
  const keepTrafficLights = () => {
    const place = () => { try { vivaldi.windowPrivate?.setControlButtonsPosition?.(window.vivaldiWindowId ?? littleWindowId, "mediumPadding"); } catch (_) {} };
    place();
    setTimeout(place, 300);
    chrome.windows.onFocusChanged?.addListener(() => setTimeout(place, 150));
    chrome.windows.onBoundsChanged?.addListener((w) => { if (w.id === littleWindowId) setTimeout(place, 150); });
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
    // "Open in <space>": the main part opens the page in the space the main window is in; the chevron lists the
    // spaces to choose another one. Without spaces it is a plain "Open in Vivarc".
    const promoteButton = document.createElement("div");
    promoteButton.className = "vm-little-pill";
    const main = document.createElement("button");
    main.className = "vm-little-promote";
    main.title = "Open in the main Vivarc window (Command+O)";
    main.innerHTML = '<span class="vm-little-promote-label">Open in <span class="vm-little-promote-space">Vivarc</span></span><kbd class="vm-little-kbd">⌘O</kbd>';
    main.addEventListener("click", () => promote());
    const pick = document.createElement("button");
    pick.className = "vm-little-pick";
    pick.title = "Choose the space";
    pick.innerHTML = icon("down");
    pick.addEventListener("click", (e) => { e.stopPropagation(); toggleSpaceMenu(); });
    promoteButton.append(main, pick);
    toolbar.append(
      button("back", "Back", async () => chrome.tabs.goBack((await activeTab()).id)),
      button("forward", "Forward", async () => chrome.tabs.goForward((await activeTab()).id)),
      button("reload", "Reload", async () => chrome.tabs.reload((await activeTab()).id)),
      address,
      promoteButton,
    );
    browser.append(toolbar);
    askSpaces();
    keepTrafficLights();
    const tab = await activeTab();
    showTab(tab);
    // A blank Little Vivarc (opened by its shortcut) is for a quick search: start in the address field.
    if (!tab || /^(about:blank|chrome:\/\/newtab|vivaldi:\/\/newtab)/.test(tab.pendingUrl || tab.url || "")) setTimeout(() => address.focus(), 50);
  };
  chrome.tabs.onUpdated?.addListener((_id, _change, tab) => { if (tab.active) showTab(tab); });
  chrome.tabs.onActivated?.addListener(({ windowId }) => { if (windowId === littleWindowId) activeTab().then(showTab); });
  channel && (channel.onmessage = ({ data }) => {
    if (data?.action === "promote") promoteFromOrigin(data.windowId, data.spaceId ?? null);
    else if (data?.action === "spaces") answerSpaces(data.windowId);
    else if (data?.action === "space-list") { if (data.windowId === littleWindowId) showSpaces(data.spaces); }
    else if (data?.action === "failed" && data.windowId === littleWindowId && toolbar) {
      promotionPending = false;
      toolbar.querySelector(".vm-little-promote").disabled = false;
      toast("Could not move the page. Check that its original window is open.");
    } else install().catch(() => {});
  });
  // Command+O opens the page in the main window's space, like Little Arc (05-bootstrap.js frees it from Vivaldi's
  // "Open File"). Every window hears every shortcut, so only the focused Little Vivarc acts.
  window.__vm.onShortcut?.((key) => {
    if (key !== window.__vm.normalise("meta+o") || littleWindowId == null || !toolbar) return;
    chrome.windows.get(littleWindowId).then((w) => { if (w?.focused) promote(); }).catch(() => {});
  });
  window.__vm.onMark((browser) => {
    if (littleWindowId != null) browser.classList.add("vm-little-arc");
    install().catch(() => {});
  });
  chrome.windows.onRemoved.addListener((id) => registry.delete(id));
  install().catch(() => {});
})();
