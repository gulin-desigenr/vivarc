// Vivarc sidebar: favorites grid on top, then one scrollable panel (pinned folders, divider,
// open tabs). The data lives in a bookmarks folder that has a "Favorites" and a "Pinned" subfolder
// (created on first run, or produced by `vivarc import-arc`). Vivaldi's own tab strip is hidden.
(() => {
  const cfg = window.__vm.config;
  const BLANK = /^(chrome|vivaldi):\/\/(newtab|vivaldi-webui\/startpage)/;
  const bottomToolbar = () => (window.__vm.settings.get("compactBottomBar") ? 35 : 64);

  const store = window.__vm.store;
  const openFolders = new Set();
  const collapsedStacks = new Set();
  const seedIcons = window.__vmIcons || {};
  let icons = {};
  const saveOpen = () => store.set("open", [...openFolders]);
  const state = { space: null, defaultSpace: null, folders: [], favs: null, pinned: null, trash: null, tabs: [], allTabs: [], bound: new Map(),
    profiles: [], renameId: null, workspaces: [], active: 0 };
  const spacesOf = window.__vm.workspaces;
  let panel = null;
  let renderedSpace = null;
  let spaceAnimations = [];

  // Animate the existing surfaces, not the tabs themselves: Vivaldi changes the page immediately.
  const animateSpaceChange = () => {
    spaceAnimations.forEach((animation) => animation.cancel());
    spaceAnimations = [];
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const page = document.querySelector("#webpage-stack");
    if (panel?.animate) spaceAnimations.push(panel.animate(
      [{ opacity: 0.72, transform: "translateY(4px)" }, { opacity: 1, transform: "translateY(0)" }],
      { duration: 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
    ));
    if (page?.animate) spaceAnimations.push(page.animate(
      [{ opacity: 0.9 }, { opacity: 1 }],
      { duration: 180, easing: "ease-out" }
    ));
  };

  const ICON_CLOSED =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4l2 2.5h7A2.5 2.5 0 0 1 21 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/></svg>';
  const ICON_OPEN =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M3 17.5V7.5A2.5 2.5 0 0 1 5.5 5h4l2 2.5h7A2.5 2.5 0 0 1 21 10v1.5"/><path d="M3.3 18.6 5.2 12a2 2 0 0 1 1.9-1.5H21a1 1 0 0 1 1 1.3l-1.8 6.4A2 2 0 0 1 18.3 20H5.5a2.2 2.2 0 0 1-2.2-1.4z"/></svg>';

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  };

  const pinLinks = window.__vm.pins;
  const { sameSite } = pinLinks;

  const originOf = (url) => {
    try { return new URL(url).origin; } catch (_) { return ""; }
  };

  const letterIcon = (url) => {
    let host = "?";
    try { host = new URL(url).hostname.replace(/^www\./, "") || (url.startsWith("file:") ? "vivarc" : "?"); } catch (_) {}
    let hash = 0;
    for (const ch of host) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
    const span = el("span", "vm-letter", host[0].toUpperCase());
    span.style.backgroundColor = `hsl(${hash} 38% 40%)`;
    return span;
  };

  const iconEl = (url, live) => {
    const wrap = el("span", "vm-ico");
    const origin = originOf(url);
    const sources = [live, icons[origin], seedIcons[origin]].filter(Boolean);
    const next = () => {
      const src = sources.shift();
      if (!src) {
        // Nothing known yet (a pin never opened here, a tab restored without its icon): show the letter, then
        // swap in the icon from Vivaldi's own favicon database if it has one for this site (from upstream 0.1.18).
        wrap.replaceChildren(letterIcon(url));
        historyIcon(url).then((found) => {
          if (!found || !wrap.isConnected) return;
          const img = el("img");
          img.src = found;
          wrap.replaceChildren(img);
          // The row was coloured from its letter: now that there is an icon, learn the icon's colour instead.
          const row = wrap.closest("[data-origin]");
          if (row && colorFor(origin)) paintRow(row);
          else if (row) { row.classList.remove("vm-tinted"); learnIcon(origin); }
        });
        return;
      }
      const img = el("img");
      img.addEventListener("error", next);
      img.src = src;
      wrap.replaceChildren(img);
    };
    next();
    return wrap;
  };

  // ---- tab colours: like Vivaldi's "accent from page", a hovered or active tab takes its page's main colour ----
  // The page's colour is Vivaldi's own accent, learned while the tab is active (Vivaldi computes it only for the
  // active page); until then the favicon's main colour stands in. Both are kept per origin.
  const colorsOf = window.__vm.colors;
  let tabColors = { page: {}, icon: {} }; // page: origin -> { bg, fg }; icon: origin -> "#rrggbb" or null (no colour)
  let saveColorsTimer = null;
  const saveColors = () => {
    clearTimeout(saveColorsTimer);
    saveColorsTimer = setTimeout(() => store.set("tabColors", tabColors), 1000);
  };
  const colorFor = (origin) => {
    if (tabColors.page[origin]) return tabColors.page[origin];
    const icon = tabColors.icon[origin];
    return icon ? { bg: icon, fg: colorsOf.textFor(icon) } : null;
  };
  const paintRow = (row) => {
    const origin = row.dataset.origin;
    const color = colorFor(origin);
    if (!color) return;
    row.style.setProperty("--vm-tab-bg", color.bg);
    row.style.setProperty("--vm-tab-fg", color.fg);
    row.classList.add("vm-tinted");
    // An icon in the row's own colour would vanish on it: a dark mark is inverted, a coloured one gets a white tile.
    const icon = colorsOf.parse(tabColors.icon[origin]), bg = colorsOf.parse(color.bg);
    const lost = icon && bg && colorsOf.contrast(icon, bg) < 1.8;
    const grey = lost && colorsOf.rgbToHsl(icon)[1] < 20;
    row.classList.toggle("vm-ico-invert", !!grey);
    row.classList.toggle("vm-ico-tile", !!lost && !grey);
  };
  const repaint = (origin) => panel?.querySelectorAll(`[data-origin="${CSS.escape(origin)}"]`).forEach(paintRow);
  const iconPending = new Set();
  const learnIcon = (origin) => {
    const src = [icons[origin], seedIcons[origin]].find((v) => v?.startsWith("data:")); // a data URL never taints the canvas
    if (!src || origin in tabColors.icon || iconPending.has(origin)) return;
    iconPending.add(origin);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = new OffscreenCanvas(24, 24);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, 24, 24);
        tabColors.icon[origin] = colorsOf.dominant(ctx.getImageData(0, 0, 24, 24).data);
        saveColors();
        repaint(origin);
      } catch (_) {}
    };
    img.src = src;
  };
  const tintRow = (row, url) => {
    const origin = originOf(url);
    if (!/^https?:/.test(origin)) return;
    row.dataset.origin = origin;
    paintRow(row);
    learnIcon(origin);
    // No favicon at all: the row's letter tile has a colour of its own, so the row uses it (white text on 40% L).
    const letter = row.querySelector(".vm-ico > .vm-letter");
    if (letter && !colorFor(origin)) {
      row.style.setProperty("--vm-tab-bg", letter.style.backgroundColor);
      row.style.setProperty("--vm-tab-fg", "#ffffff");
      row.classList.add("vm-tinted");
    }
  };
  // Before a page has a colour of its own (at start-up, a tab still loading or asleep) Vivaldi shows the theme's
  // accent, saturation-limited: a colour that close to it says nothing about the page.
  const themeAccent = async () => {
    try {
      const pref = async (key) => { const p = await vivaldi.prefs.get(key); return p?.value ?? p?.defaultValue ?? p; };
      const id = await pref("vivaldi.themes.current");
      const themes = [...((await pref("vivaldi.themes.user")) || []), ...((await pref("vivaldi.themes.system")) || [])];
      return colorsOf.parse(themes.find((t) => t.id === id)?.colorAccentBg);
    } catch (_) { return null; }
  };
  const isThemeAccent = (bg, theme) => {
    const rgb = colorsOf.parse(bg);
    return !!(rgb && theme) && Math.hypot(...rgb.map((v, i) => v - theme[i])) < 48;
  };
  let lastAccent = null;
  const learnAccent = async () => {
    const browser = document.querySelector("#browser");
    if (!browser?.classList.contains("color-accent-from-page")) return;
    const style = getComputedStyle(browser);
    const bg = style.getPropertyValue("--colorAccentBg").trim();
    if (!colorsOf.parse(bg) || bg === lastAccent) return;
    lastAccent = bg;
    const [tab] = await chrome.tabs.query({ active: true, windowId: window.vivaldiWindowId });
    const origin = originOf(tab?.url);
    if (!/^https?:/.test(origin) || tab.status === "loading" || tab.discarded) return;
    if (isThemeAccent(bg, await themeAccent())) return;
    const fg = colorsOf.parse(style.getPropertyValue("--colorAccentFg").trim()) ? style.getPropertyValue("--colorAccentFg").trim() : colorsOf.textFor(bg);
    if (tabColors.page[origin]?.bg === bg) return;
    tabColors.page[origin] = { bg, fg };
    saveColors();
    repaint(origin);
  };
  let accentTimer = null;
  const watchAccent = () => {
    const browser = document.querySelector("#browser");
    if (!browser || browser.__vmAccent) return;
    browser.__vmAccent = true;
    // Vivaldi sets the accent on #browser's inline style after the page has painted; wait for it to settle.
    new MutationObserver(() => { clearTimeout(accentTimer); accentTimer = setTimeout(learnAccent, 400); })
      .observe(browser, { attributes: true, attributeFilter: ["style", "class"] });
  };

  const leaves = (node) =>
    node.children ? node.children.flatMap(leaves) : [node];

  const hasPinnedChild = (n) => n.children?.some((c) => c.children && c.title === "Pinned");
  // A space folder in the trash is not a space (a deleted space, or one renamed away and back, would find it again).
  const findSpaces = (nodes) => nodes.flatMap((n) => n.trash === true ? [] : hasPinnedChild(n) ? [n] : n.children ? findSpaces(n.children) : []);

  // The tab that belongs to a pin or favorite stays bound to it wherever it navigates (see 08-pins.js).
  const boundTab = (node) => state.bound.get(node.id);
  const isAway = (tab, node) => !!tab && pinLinks.away(tab, node.url);

  // Re-read the tab right before writing: Vivaldi keeps its own keys in the same field.
  const writeExt = async (tabId, patch) => {
    const local = state.tabs.find((t) => t.id === tabId);
    if (local) local.vivExtData = pinLinks.patched(local, patch);
    try {
      const fresh = await chrome.tabs.get(tabId);
      if (pinLinks.needsWrite(fresh, patch)) await chrome.tabs.update(tabId, { vivExtData: pinLinks.patched(fresh, patch) });
    } catch (_) {}
  };

  // A pin opened from the sidebar remembers where it landed after the site's redirects.
  const recordHome = (tabId, pinId) => {
    const done = () => chrome.tabs.onUpdated.removeListener(onUpdated);
    const onUpdated = async (id, change) => {
      if (id !== tabId || change.status !== "complete") return;
      done();
      try {
        const fresh = await chrome.tabs.get(tabId);
        if (pinLinks.pinOf(fresh) === pinId && pinLinks.homeOf(fresh) === undefined) {
          writeExt(tabId, { [pinLinks.HOME]: pinLinks.norm(fresh.url) });
        }
      } catch (_) {}
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    setTimeout(done, 60000);
  };

  const openPin = async (node) => {
    const tab = await chrome.tabs.create({ url: node.url });
    await writeExt(tab.id, { [pinLinks.PIN]: node.id });
    recordHome(tab.id, node.id);
  };

  // A favorite has one tab for every space, like Arc's: when its tab is in another space, it comes to this one
  // instead of a second tab opening (a tab in a split view is left where it is, and Vivarc switches to it).
  const isFavorite = (node) => !!state.favs && node.parentId === state.favs.id;
  const favoriteTabElsewhere = (node) => isFavorite(node)
    ? state.allTabs.find((t) => pinLinks.pinOf(t) === node.id && spacesOf.of(t) !== state.active) ?? null
    : null;
  const focusOrOpen = async (node) => {
    const tab = boundTab(node);
    if (tab) { chrome.tabs.update(tab.id, { active: true }); return; }
    const elsewhere = favoriteTabElsewhere(node);
    if (elsewhere) {
      try {
        if (window.__vm.tilingOf(elsewhere)) await chrome.tabs.update(elsewhere.id, { active: true });
        else await moveTabToSpace(elsewhere.id, state.active);
        refresh(false);
        return;
      } catch (e) { console.warn("[vivarc] favorite tab:", e); }
    }
    openPin(node);
  };

  const backToPin = (tab, node) => chrome.tabs.update(tab.id, { url: node.url });

  // The page you are on moves to a regular tab and the pinned tab goes back to its pinned page.
  const separate = async (tab, node) => {
    await chrome.tabs.create({ url: tab.url, index: tab.index + 1 });
    await chrome.tabs.update(tab.id, { url: node.url });
  };

  const bindTabs = () => {
    if (!state.space) { state.bound = new Map(); return; }
    // Only links the sidebar shows can own a tab: the favorites grid shows the top level of Favorites, so a link in
    // a folder inside Favorites (never drawn) must not take a tab, or that tab would be shown nowhere.
    const favTiles = state.favs ? state.favs.children.filter((c) => !c.children) : [];
    const pins = [...favTiles, ...(state.pinned ? leaves(state.pinned) : [])]
      .map((n) => ({ id: n.id, url: n.url }));
    const allIds = state.folders.flatMap((f) => leaves(f)).map((n) => n.id);
    const { bound, writes } = pinLinks.plan(state.tabs, pins, allIds);
    state.bound = bound;
    for (const { tabId, patch } of writes) writeExt(tabId, patch);
  };

  // Favorites are shared by every space (like Arc's); Pinned belongs to the space on screen.
  const ensureFolder = async (name) => {
    const owner = name === "Favorites" ? state.defaultSpace : state.space;
    const existing = owner.children.find((c) => c.children && c.title === name);
    if (existing) return existing;
    return chrome.bookmarks.create({ parentId: owner.id, title: name, index: 0 });
  };

  window.__vm.pinTab = async (tab, kind) => {
    if (!state.space) return false;
    const parent = kind === "Favorites" ? await ensureFolder("Favorites") : (state.pinned || await ensureFolder("Pinned"));
    await chrome.bookmarks.create({ parentId: parent.id, title: window.__vm.titleOf(tab), url: tab.url });
    return true;
  };
  // The current space's pinned folders, for "Pin Tab to Folder" in the command bar: [{ id, title, depth }].
  window.__vm.pinFolders = () => {
    if (!state.space || !state.pinned) return [];
    const out = [{ id: state.pinned.id, title: "Pinned", depth: 0 }];
    const walk = (node, depth) => node.children?.forEach((c) => {
      if (!c.children) return;
      out.push({ id: c.id, title: c.title || "Untitled", depth });
      walk(c, depth + 1);
    });
    walk(state.pinned, 1);
    return out;
  };
  window.__vm.pinTabTo = async (tab, folderId) => {
    await chrome.bookmarks.create({ parentId: folderId, title: window.__vm.titleOf(tab), url: tab.url });
    openFolders.add(folderId);
    saveOpen();
    return true;
  };

  const copy = (text) => navigator.clipboard?.writeText(text).catch(() => {});

  // Removing goes to Vivaldi's bookmark trash, so it can be undone from there.
  const discard = (node) => {
    if (state.trash) chrome.bookmarks.move(node.id, { parentId: state.trash.id });
    else if (node.children) chrome.bookmarks.removeTree(node.id);
    else chrome.bookmarks.remove(node.id);
  };

  const cloneTree = async (node, parentId, suffix = "") => {
    const made = await chrome.bookmarks.create({
      parentId, title: `${node.title}${suffix}`, ...(node.children ? {} : { url: node.url }),
    });
    for (const child of node.children ?? []) await cloneTree(child, made.id);
  };

  const newFolder = async (parent) => {
    const target = parent ?? state.pinned ?? await ensureFolder("Pinned");
    openFolders.add(target.id);
    saveOpen();
    const made = await chrome.bookmarks.create({ parentId: target.id, title: "New Folder" });
    state.renameId = made.id;
  };

  // ---- context menu ----
  // A click on the page goes to the page, never to this document: a clear shield under the menu catches it, so a
  // click anywhere closes the menu.
  let menu = null;
  let shield = null;
  const closeMenu = () => { menu?.remove(); menu = null; shield?.remove(); shield = null; };
  const showMenu = (event, items) => {
    event.preventDefault();
    event.stopPropagation();
    closeMenu();
    menu = el("div", "vm-menu");
    for (const [label, action, danger] of items) {
      if (!label) { menu.append(el("div", "vm-menu-sep")); continue; }
      const item = el("div", `vm-menu-item${danger ? " danger" : ""}`, label);
      item.addEventListener("click", () => { closeMenu(); action(); });
      menu.append(item);
    }
    shield = el("div", "vm-menu-shield");
    shield.addEventListener("mousedown", (e) => { e.preventDefault(); closeMenu(); });
    shield.addEventListener("contextmenu", (e) => { e.preventDefault(); closeMenu(); });
    (document.querySelector("#browser") || document.body).append(shield, menu);
    const { width, height } = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(event.clientX, window.innerWidth - width - 8)}px`;
    menu.style.top = `${Math.min(event.clientY, window.innerHeight - height - 8)}px`;
  };
  const outside = (e) => { if (menu && !menu.contains(e.target)) closeMenu(); };
  document.addEventListener("mousedown", outside, true);
  document.addEventListener("focusin", outside, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
  window.addEventListener("blur", closeMenu);
  window.__vm?.onShortcut((key) => { if (key === "esc") closeMenu(); });

  // ---- drag and drop ----
  let drag = null;
  let refreshAfterDrag = false;
  // The window a chrome.tabs event belongs to, or undefined when the event does not say.
  const eventWindowId = (ev, [first, second, third]) => ({
    onCreated: first?.windowId, onUpdated: third?.windowId, onActivated: first?.windowId,
    onRemoved: second?.windowId, onMoved: second?.windowId, onAttached: second?.newWindowId, onDetached: second?.oldWindowId,
  })[ev];
  let pressing = false;
  let refreshAfterPress = false;
  const released = () => {
    if (!pressing) return;
    pressing = false;
    if (refreshAfterPress) { refreshAfterPress = false; refresh(false); }
  };
  const clearDrop = () => {
    for (const n of panel?.querySelectorAll(".drop-before, .drop-after, .drop-into") ?? []) {
      n.classList.remove("drop-before", "drop-after", "drop-into");
    }
  };

  const wireDrag = (node, payload) => {
    node.draggable = true;
    node.addEventListener("dragstart", (e) => {
      drag = payload;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", payload.url || "");
      closeMenu();
      // Changing the layout inside dragstart makes Chrome cancel the drag, so it waits a frame.
      requestAnimationFrame(() => {
        if (!drag) return;
        node.classList.add("dragging");
        document.querySelector("#browser")?.classList.add("vm-dragging");
      });
    });
    node.addEventListener("dragend", () => {
      drag = null;
      if (refreshAfterDrag) refresh(true);
      node.classList.remove("dragging");
      document.querySelector("#browser")?.classList.remove("vm-dragging");
      clearDrop();
    });
  };

  // zone: "before" | "after" | "into" depending on pointer position inside the target
  const wireDrop = (node, { horizontal = false, allowInto = false, accept, onDrop }) => {
    const zoneOf = (e) => {
      const r = node.getBoundingClientRect();
      const t = horizontal ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height;
      if (allowInto) return t < 0.28 ? "before" : t > 0.72 ? "after" : "into";
      return t < 0.5 ? "before" : "after";
    };
    node.addEventListener("dragover", (e) => {
      if (!drag || (accept && !accept(drag))) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      clearDrop();
      node.classList.add(`drop-${zoneOf(e)}`);
    });
    node.addEventListener("drop", async (e) => {
      if (!drag || (accept && !accept(drag))) return;
      e.preventDefault();
      e.stopPropagation();
      const zone = zoneOf(e), payload = drag;
      drag = null;
      clearDrop();
      try { await onDrop(zone, payload); } catch (err) { console.warn("[vivarc] drop:", err); }
    });
  };

  const isBookmark = (d) => d.type === "bm";
  const insertPinned = async (data, parentId, index) => {
    if (data.type === "bm") {
      await chrome.bookmarks.move(data.node.id, { parentId, ...(index == null ? {} : { index }) });
    } else {
      const existing = [...(state.pinned ? leaves(state.pinned) : []), ...(state.favs ? leaves(state.favs) : [])]
        .find((n) => sameSite(data.tab.url, n.url) && n.url === data.tab.url);
      if (existing) await chrome.bookmarks.move(existing.id, { parentId, ...(index == null ? {} : { index }) });
      else await chrome.bookmarks.create({ parentId, title: data.tab.title, url: data.tab.url, ...(index == null ? {} : { index }) });
    }
  };
  const unpin = async (data) => {
    if (data.type !== "bm" || data.node.children) return;
    const { url } = data.node;
    const hadTab = boundTab(data.node);
    discard(data.node);
    if (!hadTab) await chrome.tabs.create({ url, active: false });
  };

  // ---- rows ----
  const actionButton = (symbol, title, onClick) => {
    const b = el("span", "vm-act", symbol);
    b.title = title;
    b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
    return b;
  };

  const editTitle = (field, node, cleanup = () => {}) => {
    field.value = node.title;
    field.focus();
    field.select();
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      cleanup();
      const title = field.value.trim();
      if (commit && title && title !== node.title) chrome.bookmarks.update(node.id, { title });
      else refresh(true);
    };
    field.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") finish(true);
      if (e.key === "Escape") finish(false);
    });
    field.addEventListener("blur", () => finish(true));
    field.addEventListener("click", (e) => e.stopPropagation());
  };
  const startRename = (titleEl, node) => {
    const field = el("input", "vm-rename");
    titleEl.replaceWith(field);
    editTitle(field, node);
  };
  // A favorite tile only shows its icon, so its name is edited in a field floating under its row of the grid.
  const renameFavorite = (tile, node) => {
    const grid = tile.closest(".vm-favs");
    if (!grid) return;
    const box = grid.getBoundingClientRect();
    const field = el("input", "vm-rename-float");
    field.style.left = `${box.left}px`;
    field.style.top = `${tile.getBoundingClientRect().bottom + 6}px`;
    field.style.width = `${box.width}px`;
    (document.querySelector("#browser") || document.body).append(field);
    editTitle(field, node, () => field.remove());
  };

  const bookmarkMenu = (node, isFav) => (e) => {
    const tab = boundTab(node);
    showMenu(e, [
      ["Open in New Tab", () => chrome.tabs.create({ url: node.url })],
      ["Copy Link", () => copy(node.url)],
      ["Rename…", () => { state.renameId = node.id; refresh(true); }],
      ...(isAway(tab, node) ? [
        [isFav ? "Back to Favorite Page" : "Back to Pinned Page", () => backToPin(tab, node)],
        ["Separate From Pinned Tab", () => separate(tab, node)],
      ] : []),
      [isFav ? "Move to Pinned" : "Move to Favorites", async () => {
        const target = isFav ? state.pinned : await ensureFolder("Favorites");
        if (target) chrome.bookmarks.move(node.id, { parentId: target.id });
      }],
      ...(tab ? [["Close Tab", () => chrome.tabs.remove(tab.id)]] : []),
      [],
      [isFav ? "Remove from Favorites" : "Remove from Pinned", () => discard(node), true],
    ]);
  };

  const pinnedLink = (node, depth) => {
    const row = el("div", "vm-row vm-link");
    row.style.paddingLeft = `${8 + depth * 20}px`;
    const tab = boundTab(node);
    const away = isAway(tab, node);
    row.title = away ? `${node.title || node.url}\n${tab.url}` : node.url;
    if (tab?.active) row.classList.add("active");
    if (away) row.classList.add("away");
    row.append(iconEl(node.url, away ? undefined : tab?.favIconUrl));
    tintRow(row, away ? tab.url : node.url);
    if (away) row.append(el("span", "vm-away-mark", "/"));
    const title = el("span", "vm-title", away ? window.__vm.titleOf(tab) : (node.title || node.url));
    row.append(title);
    if (away) row.append(actionButton("↩", "Back to pinned page", () => backToPin(tab, node)));
    if (!tab) row.append(actionButton("×", "Remove from Pinned", () => discard(node)));
    else if (away) row.append(actionButton("–", "Separate From Pinned Tab", () => separate(tab, node)));
    else row.append(actionButton("–", "Close tab", () => chrome.tabs.remove(tab.id)));
    row.addEventListener("click", () => focusOrOpen(node));
    row.addEventListener("contextmenu", bookmarkMenu(node, false));
    wireDrag(row, { type: "bm", node, url: node.url });
    wireDrop(row, {
      onDrop: async (zone, data) => {
        if (data.type === "bm" && data.node.id === node.id) return;
        await insertPinned(data, node.parentId, node.index + (zone === "after" ? 1 : 0));
      },
    });
    if (state.renameId === node.id) {
      state.renameId = null;
      setTimeout(() => startRename(title, node), 0);
    }
    return row;
  };

  const folderMenu = (node) => (e) => showMenu(e, [
    ["New Nested Folder…", () => newFolder(node)],
    ["Rename…", () => { state.renameId = node.id; refresh(true); }],
    [],
    ["Copy All Links", () => copy(leaves(node).map((l) => l.url).join("\n"))],
    ["Open All in New Tabs", () => leaves(node).forEach((l) => chrome.tabs.create({ url: l.url, active: false }))],
    ["Duplicate", () => cloneTree(node, node.parentId, " copy")],
    ["Convert to Stack", () => folderToStack(node)],
    [],
    ["Delete", () => discard(node), true],
  ]);

  const pinnedNode = (node, depth) => {
    if (!node.children) return pinnedLink(node, depth);
    const wrap = el("div", "vm-folder");
    const head = el("div", "vm-row vm-folder-head");
    head.style.paddingLeft = `${8 + depth * 20}px`;
    const glyph = el("span", "vm-glyph");
    const title = el("span", "vm-title", node.title || "Untitled");
    head.append(glyph, title);
    const body = el("div", "vm-folder-body");
    const content = el("div", "vm-folder-content");
    node.children.forEach((c) => content.append(pinnedNode(c, depth + 1)));
    body.append(content);
    // A closed folder with open tabs inside shows how many, so no open tab is ever out of sight.
    const openInside = leaves(node).filter((n) => n.url && boundTab(n)).length;
    if (openInside) {
      const badge = el("span", "vm-folder-open-count", String(openInside));
      badge.title = `${openInside} open ${openInside === 1 ? "tab" : "tabs"} inside`;
      head.append(badge);
    }
    const sync = () => {
      const open = openFolders.has(node.id);
      wrap.classList.toggle("open", open);
      content.inert = !open;
      glyph.innerHTML = open ? ICON_OPEN : ICON_CLOSED;
    };
    head.addEventListener("click", () => {
      openFolders.has(node.id) ? openFolders.delete(node.id) : openFolders.add(node.id);
      saveOpen();
      sync();
    });
    head.addEventListener("contextmenu", folderMenu(node));
    wireDrag(head, { type: "bm", node, url: "" });
    wireDrop(head, {
      allowInto: true,
      accept: (d) => !(d.type === "bm" && d.node.id === node.id),
      onDrop: async (zone, data) => {
        if (zone === "into") {
          openFolders.add(node.id);
          saveOpen();
          await insertPinned(data, node.id, null);
        } else {
          await insertPinned(data, node.parentId, node.index + (zone === "after" ? 1 : 0));
        }
      },
    });
    sync();
    wrap.append(head, body);
    if (state.renameId === node.id) {
      state.renameId = null;
      setTimeout(() => startRename(title, node), 0);
    }
    return wrap;
  };

  const favTile = (node) => {
    const tile = el("div", "vm-fav");
    tile.title = node.title || node.url;
    const tab = boundTab(node);
    const away = isAway(tab, node);
    if (tab?.active) tile.classList.add("active");
    if (away) tile.classList.add("away");
    tile.append(iconEl(node.url, away ? undefined : (tab || favoriteTabElsewhere(node))?.favIconUrl));
    tintRow(tile, away ? tab.url : node.url);
    tile.addEventListener("click", () => focusOrOpen(node));
    tile.addEventListener("contextmenu", bookmarkMenu(node, true));
    wireDrag(tile, { type: "bm", node, url: node.url });
    wireDrop(tile, {
      horizontal: true,
      accept: (d) => !(d.type === "bm" && d.node.children),
      onDrop: async (zone, data) => {
        if (data.type === "bm" && data.node.id === node.id) return;
        await insertPinned(data, node.parentId, node.index + (zone === "after" ? 1 : 0));
      },
    });
    if (state.renameId === node.id) {
      state.renameId = null;
      setTimeout(() => renameFavorite(tile, node), 0);
    }
    return tile;
  };

  const tabStackId = (tab) => {
    try { return JSON.parse(tab?.vivExtData || "{}").group || ""; } catch (_) { return ""; }
  };

  // Like Dia: a page opened with Cmd+click (or a middle click, or "Open Link in New Tab") stacks with the tab it came
  // from in a native Vivaldi tab stack. Those open in the background; a link that opens a tab by itself
  // (target=_blank, a site's own pop-up) opens it in front, so a tab created active is left loose. Only the first
  // one needs Vivarc: once the source is in a stack, Vivaldi's own "Open links within current tab stack" puts the
  // next ones there, and takes a tab opened in front out again (Vivaldi would stack those too). Left alone: tabs of other windows, a source bound to a
  // pinned link or favorite (its pages stay in the list), pinned tabs, Peek's temporary tabs, and a source already
  // in a stack. Vivaldi 8.3 creates a stack with tabsPrivate.move(..., ["do-not-reparent", "create-new-group"]),
  // the call its own "Stack tabs" action makes.
  const autoStack = async (tab) => {
    if (!window.__vm.settings.get("stackOpenedTabs") || tab.windowId !== window.vivaldiWindowId || tab.openerTabId == null) return;
    if (tab.active) return keepLoose(tab);
    if (!vivaldi?.tabsPrivate?.move || BLANK.test(tab.pendingUrl || tab.url || "")) return;
    const source = await chrome.tabs.get(tab.openerTabId).catch(() => null);
    if (!source || source.windowId !== tab.windowId || source.pinned || tab.pinned) return;
    if (spacesOf.of(source) !== spacesOf.of(tab) || tabStackId(source) || tabStackId(tab)) return;
    if (pinLinks.pinOf(source) || [...state.bound.values()].some((t) => t.id === source.id)) return;
    const peek = (t) => { try { return !!JSON.parse(t.vivExtData || "{}").arcPeekRuntime; } catch (_) { return false; } };
    if (peek(source) || peek(tab)) return;
    // Links opened in a quick burst: the first creates the stack, the others wait for it and then join it.
    const pending = stacking.get(source.id);
    if (pending) {
      await pending;
      const now = await chrome.tabs.get(source.id).catch(() => null);
      const mine = await chrome.tabs.get(tab.id).catch(() => null);
      if (!now || !mine || !tabStackId(now) || tabStackId(mine)) return;
      await vivaldi.tabsPrivate.move({ tabIds: [tab.id], target: source.id, tweaks: ["do-not-reparent", "into"], debug: "Vivarc.autoStack" });
      refresh(false);
      return;
    }
    const job = vivaldi.tabsPrivate.move({ tabIds: [source.id, tab.id], target: source.id,
      tweaks: ["do-not-reparent", "create-new-group"], debug: "Vivarc.autoStack" });
    stacking.set(source.id, job);
    try {
      const { success } = (await job) || {};
      if (success) refresh(false);
    } finally {
      stacking.delete(source.id);
    }
  };
  const stacking = new Map();
  const keepLoose = async (tab) => {
    const source = await chrome.tabs.get(tab.openerTabId).catch(() => null);
    const group = tabStackId(source);
    if (!group || !vivaldi?.tabsPrivate?.move) return;
    for (let i = 0; i < 10; i++) { // Vivaldi stacks the new tab a moment after creating it
      const now = await chrome.tabs.get(tab.id).catch(() => null);
      if (!now) return;
      if (tabStackId(now) === group) {
        await vivaldi.tabsPrivate.move({ tabIds: [tab.id], target: "last", tweaks: ["ungroup"], debug: "Vivarc.keepLoose" });
        refresh(false);
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  };

  // ---- Tidy Tabs ----
  const tidyTabs = async () => {
    const tabs = await chrome.tabs.query({ windowId: window.vivaldiWindowId });
    const here = spacesOf.tabsIn(tabs, state.active);
    const taken = new Set([...state.bound.values()].map((t) => t.id));
    const loose = here.filter((t) => !t.pinned && !taken.has(t.id) && !tabStackId(t) && !BLANK.test(t.url || ""));
    const byGroup = new Map();
    for (const t of here) { const g = tabStackId(t); if (g) { if (!byGroup.has(g)) byGroup.set(g, []); byGroup.get(g).push(t); } }
    const tidy = window.__vm.tidy;
    const stacks = [...byGroup.entries()].map(([group, members]) => {
      const name = stackName(members);
      return { group, name, first: members[0].id, hosts: [...new Set(members.map((t) => tidy.hostOf(t.url)).filter(Boolean))],
        words: name ? tidy.words(name, "") : [] };
    });
    const { create, join } = tidy.plan(loose, stacks);
    if (!create.length && !join.length) {
      window.dispatchEvent(new CustomEvent("vm-toast", { detail: "Nothing to tidy: no tabs that go together" }));
      return;
    }
    const moved = [];
    for (const { ids, name } of create) {
      const { group } = (await vivaldi.tabsPrivate.move({ tabIds: ids, target: ids[0],
        tweaks: ["do-not-reparent", "create-new-group"], debug: "Vivarc.tidy" })) || {};
      if (group) await vivaldi.tabsPrivate.setGroupProperties({ groupExtId: group, groupTitle: name });
      moved.push(...ids);
    }
    for (const { group, ids } of join) {
      const target = stacks.find((st) => st.group === group)?.first;
      if (target == null) continue;
      await vivaldi.tabsPrivate.move({ tabIds: ids, target, tweaks: ["do-not-reparent", "into"], debug: "Vivarc.tidy" });
      moved.push(...ids);
    }
    refresh(false);
    const made = create.length, joined = join.reduce((n, j) => n + j.ids.length, 0);
    const parts = [made ? `${made} new ${made === 1 ? "stack" : "stacks"}` : "", joined ? `${joined} ${joined === 1 ? "tab" : "tabs"} into existing stacks` : ""].filter(Boolean);
    window.dispatchEvent(new CustomEvent("vm-toast", { detail: {
      message: `Tidied: ${parts.join(", ")}`,
      action: { label: "Undo", run: () => unstack(moved) },
    } }));
  };
  window.__vm.tidyTabs = tidyTabs;
  window.__vm.iconEl = iconEl; // the command bar shows the same icons as the sidebar
  // Out of a stack, as Vivaldi's own "Remove from Tab Stack" does (the tab goes to the end of the list), and into one.
  const unstack = async (tabIds) => {
    await vivaldi.tabsPrivate.move({ tabIds, target: "last", tweaks: ["ungroup"], debug: "Vivarc.unstack" });
    refresh(false);
  };
  const joinStack = async (tabId, memberId) => {
    await vivaldi.tabsPrivate.move({ tabIds: [tabId], target: memberId, tweaks: ["do-not-reparent", "into"], debug: "Vivarc.joinStack" });
    refresh(false);
  };

  // A stack's row is its title, not a tab: clicking it folds and unfolds the stack and never leaves the tab you are
  // on. The title is the stack's name (Vivaldi's own, set with "Rename Stack…") or else its first tab's. Inside, the
  // first tab, where the reading started, comes first and is marked as the origin; the tabs opened from it hang
  // under it along a guide line.
  const STACK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="7.5" y="7.5" width="12" height="12" rx="2.5"/><path d="M4.5 15.5v-8a3 3 0 0 1 3-3h8"/></svg>';
  const CHEVRON = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 4 4 4-4 4"/></svg>';
  const stackName = (tabs) => {
    for (const t of tabs) { try { const n = JSON.parse(t.vivExtData || "{}").fixedGroupTitle; if (n) return n; } catch (_) {} }
    return "";
  };
  // "Save as Pinned Folder": a folder in this space's Pinned with a link for every tab, in order; the stack ends
  // and its tabs, now bound to those links, show inside the folder.
  const stackToFolder = async (id, tabs, title) => {
    const pinned = state.pinned || await ensureFolder("Pinned");
    const folder = await chrome.bookmarks.create({ parentId: pinned.id, title });
    for (const t of tabs) await chrome.bookmarks.create({ parentId: folder.id, title: window.__vm.titleOf(t), url: t.url });
    openFolders.add(folder.id);
    saveOpen();
    collapsedStacks.delete(id);
    await unstack(tabs.map((t) => t.id));
    refresh(true);
    window.dispatchEvent(new CustomEvent("vm-toast", { detail: {
      message: `Saved as the pinned folder \u201c${title}\u201d`,
      action: { label: "Undo", run: async () => folderToStack((await chrome.bookmarks.getSubTree(folder.id))[0]) },
    } }));
  };
  // The way back, and for any pinned folder ("Convert to Stack"): every link becomes a tab (the open ones are
  // reused, the others open in the background), the tabs form a stack named after the folder, and the folder goes
  // to Vivaldi's bookmark trash, from where it can still be restored. No tab is closed.
  const folderToStack = async (node) => {
    if (!node?.children) return;
    const links = leaves(node).filter((n) => n.url);
    if (!links.length) return;
    const tabs = [];
    for (const link of links) {
      const open = boundTab(link);
      tabs.push(open || await chrome.tabs.create({ url: link.url, active: false }));
    }
    const ids = tabs.map((t) => t.id);
    const { group } = (await vivaldi.tabsPrivate.move({ tabIds: ids, target: ids[0],
      tweaks: ["do-not-reparent", "create-new-group"], debug: "Vivarc.folderToStack" })) || {};
    if (group) await vivaldi.tabsPrivate.setGroupProperties({ groupExtId: group, groupTitle: node.title || undefined });
    discard(node);
    openFolders.delete(node.id);
    saveOpen();
    refresh(true);
    window.dispatchEvent(new CustomEvent("vm-toast", { detail: `\u201c${node.title}\u201d is a stack again` }));
  };
  const tabStack = (id, tabs) => {
    const wrap = el("div", "vm-folder vm-tab-stack");
    const ordered = tabs.slice().sort((a, b) => a.index - b.index);
    const name = stackName(ordered);
    const title = name || window.__vm.titleOf(ordered[0]) || "Tab stack";
    const head = el("div", "vm-row vm-stack-head");
    head.setAttribute("role", "button");
    head.tabIndex = 0;
    const glyph = el("span", "vm-glyph vm-stack-glyph");
    glyph.innerHTML = STACK_ICON;
    const chevron = el("span", "vm-stack-chevron");
    chevron.innerHTML = CHEVRON;
    head.append(glyph, el("span", "vm-title", title), el("span", "vm-stack-count", String(ordered.length)), chevron);
    head.title = name ? `${name} \u2014 from ${window.__vm.titleOf(ordered[0])}` : title;
    const body = el("div", "vm-folder-body");
    const content = el("div", "vm-folder-content vm-stack-content");
    ordered.forEach((tab, i) => {
      const row = tabRow(tab);
      if (i === 0) { row.classList.add("vm-stack-origin"); row.title = `Where this stack started\n${tab.url}`; }
      content.append(row);
    });
    body.append(content);
    const sync = () => {
      const open = !collapsedStacks.has(id);
      wrap.classList.toggle("open", open);
      content.inert = !open;
      head.setAttribute("aria-expanded", String(open));
    };
    const toggle = () => { collapsedStacks.has(id) ? collapsedStacks.delete(id) : collapsedStacks.add(id); sync(); };
    head.addEventListener("click", toggle);
    head.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
    head.addEventListener("contextmenu", (e) => showMenu(e, [
      ["Rename Stack\u2026", () => window.dispatchEvent(new CustomEvent("vm-rename-stack", { detail: { group: id, name: title } }))],
      ...(state.space ? [["Save as Pinned Folder", () => stackToFolder(id, ordered, title)]] : []),
      [],
      ["Ungroup Stack", () => unstack(ordered.map((t) => t.id))],
      ["Archive Stack", () => window.__vm.archive.archiveTabs(ordered)],
      [],
      ["Close Stack", () => chrome.tabs.remove(ordered.map((t) => t.id)), true],
    ]));
    // A tab dropped on the stack's row joins the stack.
    wireDrop(head, {
      accept: (d) => d.type === "tab" && tabStackId(d.tab) !== id,
      onDrop: async (_zone, data) => joinStack(data.tab.id, ordered[0].id),
    });
    // A folded stack holding the tab you are on stays open: no open tab is ever out of sight.
    if (ordered.some((t) => t.active)) collapsedStacks.delete(id);
    sync();
    wrap.append(head, body);
    return wrap;
  };
  window.__vm.renameStackTo = async (group, name) => {
    await vivaldi.tabsPrivate.setGroupProperties({ groupExtId: group, groupTitle: name || undefined });
    refresh(false);
  };

  // ---- selecting several tabs: Cmd+click toggles one, Shift+click takes a range; then right-click acts on all ----
  const selected = new Set();
  let selectAnchor = null;
  const visibleTabIds = () => [...(panel?.querySelectorAll(".vm-tab[data-tab-id]") ?? [])]
    .filter((r) => r.offsetParent).map((r) => Number(r.dataset.tabId));
  const paintSelection = () => panel?.querySelectorAll(".vm-tab[data-tab-id]")
    .forEach((r) => r.classList.toggle("vm-selected", selected.has(Number(r.dataset.tabId))));
  const clearSelection = () => { if (!selected.size) return; selected.clear(); selectAnchor = null; paintSelection(); };
  const selectWith = (e, tab) => {
    if (e.shiftKey && selectAnchor != null) {
      const order = visibleTabIds();
      const [a, b] = [order.indexOf(selectAnchor), order.indexOf(tab.id)].sort((x, y) => x - y);
      if (a >= 0 && b >= 0) order.slice(a, b + 1).forEach((id) => selected.add(id));
    } else {
      // The tab you are on counts as the first one picked, so Cmd+click on another gives two.
      if (!selected.size) { const active = state.tabs.find((t) => t.active && t.id !== tab.id); if (active && visibleTabIds().includes(active.id)) selected.add(active.id); }
      selected.has(tab.id) ? selected.delete(tab.id) : selected.add(tab.id);
      selectAnchor = tab.id;
    }
    paintSelection();
  };
  const selectedTabs = () => state.tabs.filter((t) => selected.has(t.id)).sort((a, b) => a.index - b.index);
  const stackSelected = async () => {
    const tabs = selectedTabs();
    if (tabs.length < 2) return;
    clearSelection();
    await vivaldi.tabsPrivate.move({ tabIds: tabs.map((t) => t.id), target: tabs[0].id,
      tweaks: ["do-not-reparent", "create-new-group"], debug: "Vivarc.stackSelected" });
    refresh(false);
  };
  // Split view in a stack of its own, so the split tabs stay together in the sidebar: stack first, then tile.
  const splitSelected = async () => {
    const tabs = selectedTabs();
    if (tabs.length < 2) return;
    await stackSelected();
    await window.__vm.splitTabs(tabs).catch(() => {});
    refresh(false);
  };
  const selectionMenu = () => {
    const tabs = selectedTabs();
    const n = tabs.length;
    return [
      [`Stack ${n} Tabs`, stackSelected],
      ...(tabs.every((t) => window.__vm.tilingOf(t)) && window.__vm.closeSplitView
        ? [["Close Split View", () => { clearSelection(); Promise.all(tabs.map((t) => window.__vm.closeSplitView(t))).then(() => refresh(false)).catch(() => {}); }]]
        : n <= 4 && window.__vm.splitTabs ? [[`Open ${n} Tabs in Split View`, () => splitSelected()]] : []),
      [`Archive ${n} Tabs`, () => { clearSelection(); window.__vm.archive.archiveTabs(tabs); }],
      [],
      ["Clear Selection", clearSelection],
      [`Close ${n} Tabs`, () => { clearSelection(); chrome.tabs.remove(tabs.map((t) => t.id)); }, true],
    ];
  };
  window.__vm.onShortcut((key) => { if (key === "esc") clearSelection(); });

  const tabRow = (tab) => {
    const row = el("div", "vm-row vm-tab");
    row.dataset.tabId = String(tab.id);
    row.style.paddingLeft = "8px";
    if (tab.active) row.classList.add("active");
    if (selected.has(tab.id)) row.classList.add("vm-selected");
    if (tab.discarded) row.classList.add("discarded");
    row.title = tab.url;
    row.append(iconEl(tab.url, tab.favIconUrl), el("span", "vm-title", window.__vm.titleOf(tab)));
    tintRow(row, tab.url);
    if (window.__vm.tilingOf(tab)) row.append(el("span", "vm-split-mark", "◫"));
    row.append(actionButton("×", "Close tab", () => chrome.tabs.remove(tab.id)));
    row.addEventListener("click", (e) => {
      if (e.metaKey || e.shiftKey) { e.preventDefault(); selectWith(e, tab); return; }
      clearSelection();
      chrome.tabs.update(tab.id, { active: true });
    });
    row.addEventListener("auxclick", (e) => { if (e.button === 1) chrome.tabs.remove(tab.id); });
    wireDrag(row, { type: "tab", tab, url: tab.url });
    wireDrop(row, {
      onDrop: async (zone, data) => {
        if (data.type === "bm") return unpin(data);
        if (data.tab.id === tab.id) return;
        // Onto a tab of another stack: join that stack. Out of a stack onto a loose tab: leave the stack first.
        const from = tabStackId(data.tab), to = tabStackId(tab);
        if (to && from !== to) { await joinStack(data.tab.id, tab.id); return; }
        if (from && !to) { await unstack([data.tab.id]); data = { ...data, tab: await chrome.tabs.get(data.tab.id) }; tab = await chrome.tabs.get(tab.id); }
        // the list shows the highest tab index first, so "before" means a higher index
        const below = data.tab.index < tab.index;
        const index = zone === "before" ? (below ? tab.index : tab.index + 1) : (below ? tab.index - 1 : tab.index);
        await chrome.tabs.move(data.tab.id, { index });
      },
    });
    row.addEventListener("contextmenu", (e) => showMenu(e, selected.size > 1 && selected.has(tab.id) ? selectionMenu() : [
      ...(state.space ? [
        ["Pin Tab", async () => chrome.bookmarks.create({
          parentId: (state.pinned || await ensureFolder("Pinned")).id, title: window.__vm.titleOf(tab), url: tab.url })],
        ["Add to Favorites", async () => chrome.bookmarks.create({
          parentId: (await ensureFolder("Favorites")).id, title: window.__vm.titleOf(tab), url: tab.url })],
        [],
      ] : []),
      ["Rename Tab…", () => window.dispatchEvent(new CustomEvent("vm-rename-tab", { detail: tab.id }))],
      ["Move to Space…", () => window.dispatchEvent(new CustomEvent("vm-move-tab", { detail: tab.id }))],
      ["Duplicate Tab", () => chrome.tabs.duplicate(tab.id)],
      ["Copy Link", () => copy(tab.url)],
      [],
      ...(window.__vm.tilingOf(tab) && window.__vm.closeSplitView ? [["Close Split View", () => window.__vm.closeSplitView(tab).then(() => refresh(false)).catch(() => {})]] : []),
      ...(tabStackId(tab) ? [["Remove from Stack", () => unstack([tab.id])]] : []),
      ["Archive Tab", () => window.__vm.archive.archiveTabs([tab])],
      ["Close Tab", () => chrome.tabs.remove(tab.id)],
      ["Close Other Tabs", () => {
        const ids = state.tabs.filter((t) => t.id !== tab.id && !t.pinned).map((t) => t.id);
        if (ids.length) chrome.tabs.remove(ids);
      }],
    ]));
    return row;
  };

  // ---- profile switcher ----
  const openProfile = (path) => vivaldi.runtimePrivate.openNamedProfile(path, (ok) => {
    if (!ok) console.warn("[vivarc] could not open profile", path);
  });

  const profileChip = (chip, index) => {
    const node = el("div", `vm-space-chip${chip.active ? " active" : ""}`);
    node.title = chip.active ? chip.name : `${chip.name}${index < 9 ? ` (⌃⌘${index + 1})` : ""}`;
    const letter = () => {
      const span = el("span", "vm-space-letter", chip.letter);
      span.style.backgroundColor = `hsl(${chip.hue} 38% 40%)`;
      return span;
    };
    if (chip.avatar) {
      const img = el("img");
      img.addEventListener("error", () => img.replaceWith(letter()));
      img.src = chip.avatar;
      node.append(img);
    } else {
      node.append(letter());
    }
    if (chip.active) {
      node.addEventListener("contextmenu", (e) => showMenu(e, [
        ["Manage Profiles…", () => vivaldi.runtimePrivate.openProfileSelectionWindow()],
      ]));
    } else {
      node.addEventListener("click", () => openProfile(chip.path));
    }
    return node;
  };

  const promptProfileName = (bar, plus) => {
    const field = el("input", "vm-space-input");
    field.placeholder = "New profile";
    try { vivaldi.runtimePrivate.getProfileDefaults((name) => { if (!field.value) field.value = name || ""; field.select(); }); } catch (_) {}
    plus.replaceWith(field);
    field.focus();
    let done = false;
    const finish = async (commit) => {
      if (done) return;
      done = true;
      const name = field.value.trim();
      if (commit && name) {
        const images = await new Promise((resolve) => vivaldi.runtimePrivate.getUserProfileImages(resolve));
        const index = Math.floor(Math.random() * (images?.length || 1));
        vivaldi.runtimePrivate.createProfile(name, index, false, (ok) => { if (!ok) console.warn("[vivarc] could not create the profile"); });
      }
      renderProfileBar();
    };
    field.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") finish(true);
      if (e.key === "Escape") finish(false);
    });
    field.addEventListener("blur", () => finish(false));
  };

  let profileBarEl = null;
  const renderProfileBar = () => {
    const chips = window.__vm.spaces.profileChips(state.profiles);
    if (!chips.length) { profileBarEl?.remove(); return; }
    profileBarEl ||= el("div", "vm-spaces");
    const plus = el("div", "vm-space-chip vm-space-plus", "+");
    plus.title = "New profile";
    plus.addEventListener("click", () => promptProfileName(profileBarEl, plus));
    profileBarEl.replaceChildren(...chips.map(profileChip), plus);
  };

  const placeProfileBar = () => {
    if (!profileBarEl?.isConnected && profileBarEl) {
      const toolbar = document.querySelector("#tabs-tabbar-container .toolbar-tabbar-after");
      toolbar?.prepend(profileBarEl);
    }
  };

  const loadProfiles = () => {
    try {
      vivaldi.runtimePrivate.getUserProfiles((list) => {
        state.profiles = list || [];
        renderProfileBar();
        placeProfileBar();
        window.__vm.spaces.syncBottomBar(window.__vm.spaces.wantsAccountButton(state.profiles)).catch((e) => console.warn("[vivarc] bottom bar:", e));
      });
    } catch (e) {
      console.warn("[vivarc] profile list unavailable:", e);
    }
  };

  // ---- space bar: Vivaldi workspaces as Arc-style spaces ----
  const switchSpace = async (item, { force = false } = {}) => {
    if (item.id === state.active && !force) return;
    const activate = spacesOf.findSwitcher(chrome.extension.getBackgroundPage?.()?.webpackChunkgapp_browser_react);
    if (!activate) {
      window.dispatchEvent(new CustomEvent("vm-toast", { detail: "Could not switch space. Use Vivaldi's Workspaces button." }));
      return;
    }
    // An empty workspace can already have a blank landing tab from an earlier visit.
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const targetTabs = spacesOf.tabsIn(tabs, item.id);
    const empty = targetTabs.every((tab) => BLANK.test(tab.pendingUrl || tab.url || ""));
    window.__vm.switchingSpace = true;
    try {
      await activate(window.vivaldiWindowId, item.id);
      // Vivaldi skips the switch when it believes it is already in that workspace (after a closed tab handed the
      // focus to another space's tab), so land on the space's most recent tab ourselves.
      const [after] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (after && spacesOf.of(after) !== item.id) {
        const target = spacesOf.recentTab(await chrome.tabs.query({ currentWindow: true }), item.id);
        if (target) await chrome.tabs.update(target.id, { active: true });
      }
    } finally { window.__vm.switchingSpace = false; }
    refresh(false);
    if (empty) {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      // Do not open over another workspace if the user switched again while activation was in flight.
      if (active && spacesOf.of(active) === item.id && BLANK.test(active.pendingUrl || active.url || "")) {
        window.dispatchEvent(new CustomEvent("vm-open-command-bar"));
      }
    }
  };

  // Vivaldi 8.3 moves a tab between workspaces only with tabsPrivate.move (what its "Move to Workspace" menu does),
  // and only into a workspace already open in the window: an empty one is opened first (Vivaldi adds a blank tab
  // there, closed again). The moved tab becomes active, so you land in its new space, like Arc.
  const moveTabToSpace = async (tabId, id) => {
    const tab = await chrome.tabs.get(tabId);
    if (spacesOf.of(tab) === id) return;
    const windowId = tab.windowId;
    let blank = null;
    if (!spacesOf.tabsIn(await chrome.tabs.query({ windowId }), id).length) {
      const activate = spacesOf.findSwitcher(chrome.extension.getBackgroundPage?.()?.webpackChunkgapp_browser_react);
      if (!activate) throw new Error("no workspace switcher");
      window.__vm.switchingSpace = true;
      try { await activate(windowId, id); } finally { window.__vm.switchingSpace = false; }
      const [active] = await chrome.tabs.query({ active: true, windowId });
      if (active && active.id !== tab.id && spacesOf.of(active) === id && BLANK.test(active.pendingUrl || active.url || "")) blank = active;
    }
    await vivaldi.tabsPrivate.move({ tabIds: [tab.id], target: "last", tweaks: ["do-not-reparent"], workspaceId: id || "window" });
    await chrome.tabs.update(tab.id, { active: true });
    if (blank) await chrome.tabs.remove(blank.id).catch(() => {});
  };
  window.__vm.moveTabToSpace = moveTabToSpace;
  // The default space is not a Vivaldi workspace and has no emoji there: Vivarc keeps its own.
  const spaceItems = () => spacesOf.items(state.workspaces, state.defaultSpace ? spacesOf.label(state.defaultSpace) : "Home")
    .map((item) => (item.id === 0 ? { ...item, emoji: state.defaultEmoji || "", icon: state.defaultEmoji || state.defaultIcon == null ? "" : spaceIcons()[state.defaultIcon] || "" } : item));
  const chunks = () => chrome.extension.getBackgroundPage?.()?.webpackChunkgapp_browser_react;
  const spaceIcons = () => spacesOf.findIcons(chunks());
  window.__vm.spaceIcons = spaceIcons;
  // A space's mark: its emoji, else its icon (drawn by a mask in the text color), else nothing.
  const spaceMark = (item, cls) => {
    if (item.emoji) return el("span", `${cls} vm-mark-emoji`, item.emoji);
    if (!item.icon) return null;
    const mark = el("span", `${cls} vm-mark-icon`);
    mark.style.setProperty("--vm-icon", spacesOf.iconMask(item.icon));
    return mark;
  };
  window.__vm.spaceMark = spaceMark;
  window.__vm.spaceList = () => spaceItems().map((item) => ({ ...item, active: item.id === state.active }));
  window.__vm.switchToSpace = (id) => switchSpace({ id });

  // ---- editing spaces: name, emoji, order, new space ----
  const manager = () => spacesOf.findManager(chrome.extension.getBackgroundPage?.()?.webpackChunkgapp_browser_react);
  const waitForWorkspaces = async (done) => {
    for (let i = 0; i < 20; i++) {
      if (done(await readWorkspaces())) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  };
  // A space's pinned links live in the bookmark folder with its name, so a rename renames the folder too ("Arc - "
  // kept), folder first. While both change, applySpace must not see the workspace without a folder and make one.
  let renaming = false;
  const spaceFolder = (id) => {
    const { default: base, byId } = spacesOf.assign(state.folders || [], state.workspaces || []);
    return id ? byId[id] ?? null : base;
  };
  window.__vm.renameSpace = async (id, name) => {
    name = String(name || "").trim();
    const item = spaceItems().find((i) => i.id === id);
    if (!name || !item || name === item.name) return false;
    const folder = spaceFolder(id);
    const m = id ? manager() : null;
    if (id && !m) return false;
    if (!id && !folder) return false;
    renaming = true;
    try {
      if (folder) await chrome.bookmarks.update(folder.id, { title: folder.title.startsWith("Arc - ") ? `Arc - ${name}` : name });
      if (id) {
        m.setName(id, name);
        await waitForWorkspaces((list) => list.some((w) => w.id === id && w.name === name));
      }
    } finally { renaming = false; }
    refresh(true);
    return true;
  };
  // An emoji and an icon replace each other ("" clears both). Vivaldi's setIcon clears the emoji, and
  // setIcon(id, undefined) clears both, so an emoji is set after clearing the icon.
  window.__vm.setSpaceEmoji = async (id, emoji) => {
    emoji = spacesOf.firstGrapheme(emoji);
    if (!id) {
      state.defaultEmoji = emoji;
      state.defaultIcon = null;
      await store.set("defaultSpaceEmoji", emoji);
      await store.set("defaultSpaceIcon", null);
    } else {
      const m = manager();
      if (!m) return false;
      m.setIcon(id, undefined);
      if (emoji) m.setEmoji(id, emoji);
      await waitForWorkspaces((list) => list.some((w) => w.id === id && (w.emoji || "") === emoji && (emoji || !w.icon)));
    }
    refresh(false);
    return true;
  };
  window.__vm.setSpaceIcon = async (id, index) => {
    if (!spaceIcons()[index]) return false;
    if (!id) {
      state.defaultEmoji = "";
      state.defaultIcon = index;
      await store.set("defaultSpaceEmoji", "");
      await store.set("defaultSpaceIcon", index);
    } else {
      const m = manager();
      if (!m) return false;
      m.setIcon(id, index);
      await waitForWorkspaces((list) => list.some((w) => w.id === id && w.iconId === index));
    }
    refresh(false);
    return true;
  };
  const reorderSpaces = async (ids) => {
    const m = manager();
    if (!m) return;
    m.setOrder(ids);
    await waitForWorkspaces((list) => list.map((w) => w.id).join() === ids.join());
    refresh(false);
  };
  // Vivaldi's own "new workspace": created and opened in this window, empty (Vivaldi gives it a blank tab).
  window.__vm.createSpace = async (name, emoji = "") => {
    name = String(name || "").trim();
    const m = manager();
    if (!name || !m) return null;
    const id = await m.addWorkspace(name, undefined, spacesOf.firstGrapheme(emoji), undefined, false);
    await waitForWorkspaces((list) => list.some((w) => w.id === id));
    refresh(true);
    return id;
  };
  // A name field floating above the space dots, for "+".
  const promptSpaceName = () => {
    if (!manager()) { window.dispatchEvent(new CustomEvent("vm-toast", { detail: spacesOf.CREATE_HINT })); return; }
    document.querySelector(".vm-space-name-float")?.remove();
    const bar = spaceBarEl?.getBoundingClientRect();
    const field = el("input", "vm-rename-float vm-space-name-float");
    field.placeholder = "New space name";
    const width = 200;
    const left = bar ? Math.max(8, bar.left + bar.width / 2 - width / 2) : 8;
    field.style.left = `${left}px`;
    field.style.width = `${width}px`;
    field.style.top = `${(bar?.top ?? window.innerHeight - 40) - 40}px`;
    (document.querySelector("#browser") || document.body).append(field);
    field.focus();
    let done = false;
    const finish = async (commit) => {
      if (done) return;
      done = true;
      const name = field.value.trim();
      field.remove();
      if (commit && name) await window.__vm.createSpace(name);
    };
    field.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") finish(true);
      if (e.key === "Escape") finish(false);
    });
    field.addEventListener("blur", () => finish(false));
  };
  window.__vm.promptNewSpace = promptSpaceName;

  // The editor works on the space on screen: switch first, and open it once the switch has reached the theme.
  const editSpace = async (item) => {
    if (item.id !== state.active) {
      await switchSpace(item);
      for (let i = 0; i < 30 && window.__vm.activeSpace !== item.id; i++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 50));
    }
    window.dispatchEvent(new CustomEvent("vm-open-theme"));
  };

  // Dragging a dot sideways reorders the spaces (the default space stays first). A drag of a few pixels is still a
  // click; after a real drag the click that follows is swallowed.
  let swallowClick = false;
  // The dragged dot follows the pointer and the others slide aside (FLIP, on the `translate` property, which the
  // bar's `transform: none` does not touch). Positions are read from the layout (offsetLeft), never from the
  // moving boxes, so the order does not jitter while they slide.
  const SLIDE = { duration: 180, easing: "cubic-bezier(.2, .7, .2, 1)" };
  const dragDots = (pill, item) => {
    if (!item.id) return;
    pill.addEventListener("pointerdown", (down) => {
      if (down.button !== 0) return;
      const bar = pill.parentElement;
      let moved = false;
      const center = (n) => n.offsetLeft + n.offsetWidth / 2;
      const pointer = (e) => e.clientX - bar.getBoundingClientRect().left;
      const grab = pointer(down) - center(pill);
      const follow = (e) => { pill.style.translate = `${pointer(e) - grab - center(pill)}px 0`; };
      // Moving the dot in the bar drops pointer capture, so the drag is followed on the document.
      const move = (e) => {
        if (!moved && Math.abs(e.clientX - down.clientX) < 4) return;
        if (!moved) { moved = true; bar.classList.add("vm-reordering"); pill.classList.add("vm-dragging"); }
        const x = pointer(e) - grab;
        const others = [...bar.querySelectorAll(".vm-space-pill[data-space-id]")].filter((n) => n !== pill && n.dataset.spaceId !== "0");
        const before = others.find((n) => x < center(n));
        const where = before ? (pill.nextElementSibling === before ? null : before) : (others.at(-1)?.nextElementSibling === pill ? null : "end");
        if (where && others.length) {
          const was = new Map(others.map((n) => [n, n.offsetLeft]));
          if (where === "end") others.at(-1).after(pill); else bar.insertBefore(pill, where);
          for (const [n, left] of was) {
            const dx = left - n.offsetLeft;
            if (dx) n.animate([{ translate: `${dx}px 0` }, { translate: "0 0" }], SLIDE);
          }
        }
        follow(e);
      };
      const up = () => {
        document.removeEventListener("pointermove", move, true);
        document.removeEventListener("pointerup", up, true);
        document.removeEventListener("pointercancel", up, true);
        bar.classList.remove("vm-reordering");
        pill.classList.remove("vm-dragging");
        if (!moved) return;
        const from = pill.style.translate || "0 0";
        pill.style.translate = "";
        pill.animate([{ translate: from }, { translate: "0 0" }], SLIDE);
        swallowClick = true;
        setTimeout(() => { swallowClick = false; }, 0);
        const ids = [...bar.querySelectorAll(".vm-space-pill[data-space-id]")].map((n) => Number(n.dataset.spaceId)).filter(Boolean);
        if (ids.join() !== state.workspaces.map((w) => w.id).join()) setTimeout(() => reorderSpaces(ids), SLIDE.duration);
      };
      document.addEventListener("pointermove", move, true);
      document.addEventListener("pointerup", up, true);
      document.addEventListener("pointercancel", up, true);
    });
  };

  const spacePill = (item) => {
    const mark = spaceMark(item, "vm-space-mark");
    const pill = el("div", `vm-space-pill${item.id === state.active ? " active" : ""}${mark ? " vm-has-mark" : ""}`);
    if (mark) pill.append(mark);
    pill.dataset.spaceId = String(item.id);
    pill.title = item.name;
    pill.addEventListener("click", () => { if (!swallowClick) switchSpace(item); });
    pill.addEventListener("contextmenu", (e) => showMenu(e, [
      ["Edit Space…", () => editSpace(item)],
      ...(item.id ? [[], ["Delete Space…", () => confirmDeleteSpace(item, e), true]] : []),
    ]));
    dragDots(pill, item);
    return pill;
  };

  const confirmDeleteSpace = (item, event) => {
    const label = spacesOf.removalLabel(item.name, spacesOf.tabsIn(state.allTabs, item.id).length);
    const at = { clientX: event.clientX, clientY: event.clientY, preventDefault() {}, stopPropagation() {} };
    showMenu(at, [[label, () => deleteSpace(item), true], ["Cancel", () => {}]]);
  };

  const deleteSpace = async (item) => {
    const remove = spacesOf.findRemover(chrome.extension.getBackgroundPage?.()?.webpackChunkgapp_browser_react);
    if (!remove) {
      window.dispatchEvent(new CustomEvent("vm-toast", { detail: "Could not delete the space. Use Vivaldi's Workspaces button." }));
      return;
    }
    await remove(window.vivaldiWindowId, item.id);
    refresh(false);
  };

  // The space dots live in the bottom toolbar, centred between the profile and downloads buttons, like Dia.
  // That toolbar is outside the panel, so it needs the panel's own guards: no double-click new tab, no drag
  // region, and no re-render between mousedown and mouseup.
  let spaceBarEl = null;
  const placeSpaceBar = (bar = spaceBarEl) => {
    if (bar !== spaceBarEl) {
      spaceBarEl?.remove();
      spaceBarEl = bar;
      bar?.addEventListener("dblclick", (e) => e.stopPropagation());
      bar?.addEventListener("pointerdown", () => { pressing = true; }, true);
    }
    const toolbar = document.querySelector("#tabs-tabbar-container .toolbar-tabbar-after");
    if (!bar || !toolbar) return;
    if (bar.parentElement !== toolbar) toolbar.append(bar); // Vivaldi re-renders this toolbar; place() puts the bar back
    // The toolbar stretches up to fill the sidebar and keeps growing after load: centre the dots on its buttons'
    // row (the profile button), measured from the bottom edge, which stays put while the toolbar grows.
    // Vivaldi 8.3 wraps the bottom buttons in .tabbar-nested-buttons; earlier versions put them directly in the toolbar.
    const button = [...toolbar.querySelectorAll(".tabbar-nested-buttons, .button-toolbar:not(.toolbar-spacer-flexible)")]
      .filter((c) => c.offsetHeight && !bar.contains(c)).at(-1);
    if (button) {
      const box = button.getBoundingClientRect();
      const bottom = toolbar.getBoundingClientRect().bottom - box.top - box.height / 2;
      if (bar.style.bottom !== `${bottom}px`) bar.style.bottom = `${bottom}px`;
    }
  };

  // For the archive (11-archive.js): a space's name when a tab is archived, and whether it still exists on restore.
  const spaceName = (id) => spacesOf.items(state.workspaces, state.defaultSpace ? spacesOf.label(state.defaultSpace) : "Home")
    .find((item) => item.id === id)?.name || "";
  window.__vm.spaceNameOf = spaceName;
  // Tabs the automatic archive leaves alone: those bound to a pinned link or a favorite, in any space (state.bound
  // covers the space on screen; the vivarcPin mark in vivExtData stays on the tab in the others).
  window.__vm.isKeptTab = (tab) => [...state.bound.values()].some((t) => t.id === tab.id) || !!pinLinks.pinOf?.(tab);
  window.__vm.spaceExists = (id) => !id || !state.workspaces?.length || state.workspaces.some((w) => w.id === id);

  const spaceBar = () => {
    const items = spaceItems();
    if (!items.length) return null;
    const bar = el("div", "vm-space-bar");
    const plus = el("div", "vm-space-pill vm-space-plus", "+");
    plus.title = "New space";
    plus.addEventListener("click", promptSpaceName);
    bar.append(...items.map(spacePill), plus);
    return bar;
  };

  // ---- render ----
  const fitHeight = () => {
    if (!panel?.isConnected) return;
    const top = panel.getBoundingClientRect().top;
    panel.style.maxHeight = `${Math.max(120, window.innerHeight - top - bottomToolbar())}px`;
  };

  const render = () => {
    if (!panel) return;
    const scroll = panel.querySelector(".vm-scroll")?.scrollTop ?? 0;
    const body = el("div", "vm-scroll");
    const favLeaves = state.favs ? state.favs.children.filter((c) => !c.children) : [];
    let grid = null;
    if (state.defaultSpace) {
      grid = el("div", "vm-favs");
      favLeaves.forEach((n) => grid.append(favTile(n)));
      wireDrop(grid, {
        horizontal: true,
        accept: (d) => !(d.type === "bm" && d.node.children),
        onDrop: async (_zone, data) => insertPinned(data, (await ensureFolder("Favorites")).id, null),
      });
    }
    if (state.space) {
      const label = el("div", "vm-space");
      const name = el("span", "vm-space-name");
      const mark = spaceMark(spaceItems().find((i) => i.id === state.active) || {}, "vm-space-label-mark");
      if (mark) name.append(mark);
      name.append(spacesOf.label(state.space));
      label.append(name);
      label.append(actionButton("🎨", "Edit space", () => window.dispatchEvent(new CustomEvent("vm-open-theme"))));
      wireDrop(label, {
        onDrop: async (_zone, data) => insertPinned(data, (state.pinned || await ensureFolder("Pinned")).id, 0),
      });
      body.append(label);
    }
    if (state.pinned) state.pinned.children.forEach((c) => body.append(pinnedNode(c, 0)));

    const taken = new Set([...state.bound.values()].map((t) => t.id));
    const blank = state.tabs.filter((t) => BLANK.test(t.url || ""));
    const nonblank = state.tabs.filter((t) => !BLANK.test(t.url || ""));
    const stacks = new Map();
    for (const tab of nonblank) {
      const id = tabStackId(tab);
      if (id) { if (!stacks.has(id)) stacks.set(id, []); stacks.get(id).push(tab); }
    }
    for (const [id, tabs] of stacks) if (tabs.length < 2) stacks.delete(id);
    const clearable = nonblank.filter((t) => !taken.has(t.id));
    const open = clearable.filter((t) => !stacks.has(tabStackId(t)));
    const divider = el("div", "vm-divider");
    const clear = el("span", "vm-clear", "Clear");
    // Like Arc, Clear archives the space's loose tabs (searchable and restorable from the command bar).
    clear.title = "Archive these tabs";
    clear.addEventListener("click", async () => {
      if (!clearable.length) return;
      if (clearable.length + blank.length === state.tabs.length) await chrome.tabs.create({});
      const pages = clearable.filter((t) => /^https?:|^file:/.test(t.url || ""));
      const others = clearable.filter((t) => !pages.includes(t));
      if (others.length) chrome.tabs.remove(others.map((t) => t.id));
      if (pages.length) await window.__vm.archive.archiveTabs(pages);
    });
    // Tidy, like Arc's broom: the loose tabs sorted into named stacks (12-tidy.js), with Undo.
    const tidyButton = el("span", "vm-clear vm-tidy", "Tidy");
    tidyButton.title = "Group these tabs into stacks";
    tidyButton.addEventListener("click", () => tidyTabs());
    divider.append(tidyButton, clear);
    wireDrop(divider, { accept: isBookmark, onDrop: (_zone, data) => unpin(data) });
    body.append(divider);
    const fresh = el("div", "vm-row vm-newtab");
    fresh.style.paddingLeft = "8px";
    fresh.append(el("span", "vm-plus", "+"), el("span", "vm-title", "New Tab"));
    fresh.addEventListener("click", () => window.dispatchEvent(new CustomEvent("vm-open-command-bar")));
    // A stacked tab dropped on "New Tab" leaves its stack (a pinned link dropped there is unpinned, as before).
    wireDrop(fresh, {
      accept: (d) => isBookmark(d) || (d.type === "tab" && !!tabStackId(d.tab)),
      onDrop: (_zone, data) => (data.type === "tab" ? unstack([data.tab.id]) : unpin(data)),
    });
    body.append(fresh);
    const entries = [
      ...open.map((tab) => ({ index: tab.index, node: () => tabRow(tab) })),
      ...[...stacks.entries()].map(([id, tabs]) => ({ index: Math.max(...tabs.map((tab) => tab.index)), node: () => tabStack(id, tabs) })),
    ];
    entries.sort((a, b) => b.index - a.index).forEach((entry) => body.append(entry.node()));

    panel.replaceChildren(...(grid ? [grid] : []), body);
    placeSpaceBar(spaceBar());
    body.scrollTop = scroll;
    fitHeight();
    if (renderedSpace !== null && renderedSpace !== state.active) animateSpaceChange();
    renderedSpace = state.active;
  };

  const ICON_MAX = 20000;
  // Vivaldi's favicon database (filled by browsing and by Sync) knows icons for sites that are not open. For a
  // site it does not know it returns a stock globe instead of an error, so that globe is fingerprinted once and
  // treated as "no icon". Found icons join the per-profile cache like the ones learned from open tabs.
  // Ported from upstream KASOGIT/vivarc 0.1.18 (7428eda).
  const FAVICON_DB = "chrome://favicon/size/32@2x/";
  const loadImage = (src) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
  const pixelsOf = (img) => {
    const canvas = new OffscreenCanvas(img.naturalWidth || 1, img.naturalHeight || 1);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return { canvas, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
  };
  const samePixels = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  let stockGlobe = null;
  const globePixels = () => (stockGlobe ||= loadImage(`${FAVICON_DB}https://vivarc-no-icon.invalid/`)
    .then((img) => (img ? pixelsOf(img).data : null)).catch(() => null));
  const fromHistory = new Map();
  let saveIconsTimer = null;
  const saveIconsSoon = () => {
    clearTimeout(saveIconsTimer);
    saveIconsTimer = setTimeout(() => store.set("icons", icons), 2000);
  };
  const historyIcon = (url) => {
    const origin = originOf(url);
    if (!/^https?:/.test(origin)) return Promise.resolve(null);
    if (!fromHistory.has(origin)) {
      fromHistory.set(origin, (async () => {
        const img = await loadImage(FAVICON_DB + url);
        if (!img) return null;
        const { canvas, data } = pixelsOf(img);
        const globe = await globePixels();
        if (!globe || samePixels(data, globe)) return null;
        const value = await dataUrl(await canvas.convertToBlob({ type: "image/png" }));
        if (value.length >= ICON_MAX) return null;
        if (!icons[origin]) {
          icons[origin] = value;
          saveIconsSoon();
        }
        return value;
      })().catch(() => null));
    }
    return fromHistory.get(origin);
  };
  const dataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  // Some favicons are multi-size .ico files (Gmail's is 26 KB): too big to keep as is, so they are
  // redrawn at 64px, enough for the 24px tiles on a Retina screen.
  const shrinkIcon = async (blob) => {
    const bitmap = await createImageBitmap(blob, { resizeWidth: 64, resizeHeight: 64, resizeQuality: "high" });
    const canvas = new OffscreenCanvas(64, 64);
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    return dataUrl(await canvas.convertToBlob({ type: "image/png" }));
  };
  const cacheIcons = async () => {
    for (const t of state.allTabs) {
      const src = t.favIconUrl;
      const origin = originOf(t.url);
      if (!src || !/^https?:/.test(origin) || icons[origin] === src || icons[origin]?.startsWith("data:")) continue;
      let value = src;
      try {
        const blob = await (await fetch(src)).blob();
        value = await dataUrl(blob);
        if (value.length >= ICON_MAX) value = await shrinkIcon(blob);
      } catch (_) {}
      if (value.length < ICON_MAX) icons[origin] = value;
    }
    store.set("icons", icons);
  };

  const STARTER_FAVORITES = [
    ["Gmail", "https://mail.google.com/"],
    ["Calendar", "https://calendar.google.com/"],
    ["Drive", "https://drive.google.com/"],
    ["YouTube", "https://www.youtube.com/"],
    ["GitHub", "https://github.com/"],
    ["Maps", "https://www.google.com/maps"],
  ];

  // A pinned link, a folder with two links, and a folder nested inside it, so the layout is visible on day one.
  const addStarterPins = async (pinnedId) => {
    if (cfg.startUrl) await chrome.bookmarks.create({ parentId: pinnedId, title: "Vivarc Guide", url: cfg.startUrl });
    const reading = await chrome.bookmarks.create({ parentId: pinnedId, title: "Reading" });
    await chrome.bookmarks.create({ parentId: reading.id, title: "Hacker News", url: "https://news.ycombinator.com/" });
    await chrome.bookmarks.create({ parentId: reading.id, title: "Wikipedia", url: "https://www.wikipedia.org/" });
    const dev = await chrome.bookmarks.create({ parentId: reading.id, title: "Dev" });
    await chrome.bookmarks.create({ parentId: dev.id, title: "MDN Web Docs", url: "https://developer.mozilla.org/" });
    await chrome.bookmarks.create({ parentId: dev.id, title: "Stack Overflow", url: "https://stackoverflow.com/" });
    openFolders.add(reading.id);
    openFolders.add(dev.id);
    saveOpen();
  };

  let triedFirstRun = false;
  const createSpace = async (tree) => {
    const bar = tree[0]?.children?.[0];
    if (!bar) return;
    const space = await chrome.bookmarks.create({ parentId: bar.id, title: cfg.spaceFolderTitle });
    const favs = await chrome.bookmarks.create({ parentId: space.id, title: "Favorites" });
    for (const [title, url] of STARTER_FAVORITES) await chrome.bookmarks.create({ parentId: favs.id, title, url });
    const pinned = await chrome.bookmarks.create({ parentId: space.id, title: "Pinned" });
    await addStarterPins(pinned.id);
  };

  const loadBookmarks = async () => {
    let tree = await chrome.bookmarks.getTree();
    if (!findSpaces(tree).length && !triedFirstRun) {
      triedFirstRun = true;
      await createSpace(tree);
      tree = await chrome.bookmarks.getTree();
    }
    state.folders = findSpaces(tree);
    state.trash = (tree[0]?.children ?? []).find((c) => c.trash === true || /^trash$/i.test(c.title)) ?? null;
  };

  // The folder of the space on screen. A workspace Vivarc meets for the first time gets its own empty Pinned folder.
  const madeFolderFor = new Set();
  const applySpace = async () => {
    const pick = () => {
      const { default: base, byId } = spacesOf.assign(state.folders, state.workspaces);
      return { base, space: state.active ? byId[state.active] ?? null : base };
    };
    let picked = pick();
    const workspace = state.workspaces.find((w) => w.id === state.active);
    if (!picked.space && workspace && picked.base && !renaming && !madeFolderFor.has(workspace.id)) {
      madeFolderFor.add(workspace.id);
      const folder = await chrome.bookmarks.create({ parentId: picked.base.parentId, title: workspace.name });
      await chrome.bookmarks.create({ parentId: folder.id, title: "Pinned" });
      await loadBookmarks();
      picked = pick();
    }
    state.defaultSpace = picked.base;
    state.space = picked.space;
    state.favs = picked.base?.children.find((c) => c.children && c.title === "Favorites") ?? null;
    state.pinned = picked.space?.children.find((c) => c.children && c.title === "Pinned") ?? null;
  };

  const readWorkspaces = async () => {
    try { return (await vivaldi.prefs.get("vivaldi.workspaces.list"))?.value || []; } catch (_) { return []; }
  };
  const loadTabs = async () => {
    // Peek uses temporary runtime/preload tabs; keep them out of the sidebar until promoted.
    const temporary = new Set();
    for (const data of window.ArcPeekDebug?.webviews?.values?.() || []) {
      if (data.relatedTabId) temporary.add(Number(data.relatedTabId));
      if (data.parallelTabId) temporary.add(Number(data.parallelTabId));
    }
    state.allTabs = (await chrome.tabs.query({ currentWindow: true })).filter((tab) => {
      if (temporary.has(tab.id)) return false;
      try { return !JSON.parse(tab.vivExtData || "{}").arcPeekRuntime; } catch (_) { return true; }
    });
    state.workspaces = await readWorkspaces();
    ({ active: state.active, tabs: state.tabs } = spacesOf.scope(state.allTabs, state.workspaces));
    for (const id of selected) if (!state.tabs.some((t) => t.id === id)) selected.delete(id);
    if (window.__vm.activeSpace !== state.active) {
      window.__vm.activeSpace = state.active;
      window.dispatchEvent(new CustomEvent("vm-active-space-changed", { detail: state.active }));
    }
  };

  // Calls inside the debounce window are merged, and a request to reload bookmarks is never lost to a later
  // tab-only refresh (at start-up the tab events used to cancel the first bookmark load, leaving the sidebar empty).
  let timer = 0;
  let wantBookmarks = false;
  let failures = 0;
  function refresh(withBookmarks) {
    wantBookmarks ||= !!withBookmarks;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (drag) { refreshAfterDrag = true; return; } // re-rendering would detach the node being dragged
      // Nor while a button is held: replacing the pressed node between mousedown and mouseup swallows the click.
      if (pressing) { refreshAfterPress = true; return; }
      refreshAfterDrag = false;
      const bookmarks = wantBookmarks || !state.defaultSpace;
      wantBookmarks = false;
      try {
        await loadTabs();
        if (bookmarks) await loadBookmarks();
        await applySpace();
        bindTabs();
        cacheIcons();
        render();
        failures = 0;
      } catch (e) {
        console.warn("[vivarc] sidebar:", e);
        if (++failures <= 5) { wantBookmarks = bookmarks; setTimeout(() => refresh(false), 1500); }
      }
    }, 80);
  }

  // ---- placement ----
  const place = () => {
    const container = document.querySelector("#tabs-container.left, #tabs-container.right");
    const strip = container?.querySelector(".tab-strip");
    if (!strip) return;
    let anchor = strip;
    while (anchor.parentElement !== container) anchor = anchor.parentElement;
    if (!panel) {
      panel = el("div");
      panel.id = "vm-panel";
      // Vivaldi's vertical tab container opens a new tab on any double-click.
      // Keep rapid clicks inside Vivarc controls from triggering that handler.
      panel.addEventListener("dblclick", (e) => e.stopPropagation());
      panel.addEventListener("pointerdown", () => { pressing = true; }, true);
      panel.addEventListener("contextmenu", (e) => showMenu(e, [
        ["New Folder", async () => { await newFolder(null); }],
        ["Edit Space…", () => window.dispatchEvent(new CustomEvent("vm-open-theme"))],
        ["Vivarc Settings…", () => window.dispatchEvent(new CustomEvent("vm-open-settings"))],
        ["New Tab", () => window.dispatchEvent(new CustomEvent("vm-open-command-bar"))],
        ["Reopen Closed Tab", () => chrome.sessions.restore()],
      ]));
      refresh(true);
    }
    anchor.classList.add("vm-strip-hidden");
    placeProfileBar();
    placeSpaceBar();
    fitHeight();
    if (panel.parentElement !== container || panel.nextElementSibling !== anchor) {
      container.insertBefore(panel, anchor);
    }
  };

  // Like Arc, opening the command bar scrolls the sidebar down to the new-tab area.
  window.addEventListener("vm-folders", (e) => {
    for (const id of pinLinks.folderIds(state.pinned)) e.detail === "expand" ? openFolders.add(id) : openFolders.delete(id);
    saveOpen();
    render();
  });
  window.addEventListener("vm-command-bar-opened", () => {
    const scroller = panel?.querySelector(".vm-scroll");
    scroller?.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
  });

  const start = () => {
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; place(); });
    }).observe(document.body, { childList: true, subtree: true });
    place();
    window.addEventListener("resize", fitHeight);
    for (const ev of ["pointerup", "pointercancel", "dragstart", "blur"]) window.addEventListener(ev, () => setTimeout(released), true);
    window.addEventListener("vm-refresh-sidebar", () => refresh(false));
    window.addEventListener("arcpeek-state-changed", () => refresh(false));
    window.__vm.settings.onChange(fitHeight);
    for (const ev of ["onCreated", "onRemoved", "onChanged", "onMoved", "onImportEnded"]) {
      chrome.bookmarks[ev]?.addListener(() => refresh(true));
    }
    chrome.tabs.onCreated.addListener((tab) => {
      autoStack(tab).catch((e) => console.warn("[vivarc] auto stack:", e));
      if (window.__vm.switchingSpace || window.__vm.archive?.busy) return; // a restored page brings its own space
      const active = state.active;
      chrome.windows.getCurrent().then((win) => {
        const data = spacesOf.stamp(tab, active, win.id);
        if (data) chrome.tabs.update(tab.id, { vivExtData: data });
      }).catch(() => {});
    });
    // Every window runs its own sidebar and sees the tab events of all windows (a Little Vivarc page loading,
    // another window's titles): only this window's events, or ones that do not say, trigger a re-render.
    // Closing the active tab (or sending it to Little Vivarc) keeps you in its space, like Arc.
    let leaving = null;
    const leftSpace = (tabId) => {
      const tab = state.allTabs.find((t) => t.id === tabId);
      if (!tab || !state.workspaces?.length || window.__vm.switchingSpace) return;
      leaving ||= { space: spacesOf.of(tab), removed: new Set(), wasActive: false };
      leaving.removed.add(tabId);
      leaving.wasActive ||= !!tab.active;
      clearTimeout(leaving.timer);
      leaving.timer = setTimeout(async () => {
        const { space, removed, wasActive } = leaving;
        leaving = null;
        if (!wasActive || window.__vm.switchingSpace) return;
        const next = spacesOf.stayIn(await chrome.tabs.query({ currentWindow: true }), space, removed);
        if (next?.tab) await chrome.tabs.update(next.tab.id, { active: true });
        else if (next?.empty) await switchSpace({ id: space }, { force: true });
      }, 150);
    };
    chrome.tabs.onRemoved.addListener((id, info) => {
      if (info?.windowId === window.vivaldiWindowId && !info.isWindowClosing) leftSpace(id);
    });
    chrome.tabs.onDetached.addListener((id, info) => { if (info?.oldWindowId === window.vivaldiWindowId) leftSpace(id); });
    for (const ev of ["onCreated", "onRemoved", "onUpdated", "onMoved", "onActivated", "onAttached", "onDetached", "onReplaced"]) {
      chrome.tabs[ev]?.addListener((...args) => {
        const id = eventWindowId(ev, args);
        if (id == null || id === window.vivaldiWindowId) refresh(false);
      });
    }
    window.__vm.onShortcut((key) => {
      const item = spacesOf.itemForShortcut(state.workspaces, state.defaultSpace ? spacesOf.label(state.defaultSpace) : "Home", key);
      if (item) switchSpace(item).catch((e) => console.warn("[vivarc] space shortcut:", e));
    });
    setInterval(async () => {
      const brief = (list) => JSON.stringify(list.map((w) => [w.id, w.name, w.emoji]));
      if (brief(await readWorkspaces()) !== brief(state.workspaces)) refresh(false);
    }, 3000);
    try {
      vivaldi.runtimePrivate.onProfilesUpdated.addListener(loadProfiles);
      window.__vm.onShortcut((key) => {
        const path = window.__vm.spaces.pathForShortcut(state.profiles, key);
        if (path) openProfile(path);
      });
    } catch (e) {
      console.warn("[vivarc] profile switching unavailable:", e);
    }
    loadProfiles();
    console.log("[vivarc] sidebar started");
  };

  const init = async () => {
    if (!(await window.__vm.ready)) return;
    (await store.get("open", [])).forEach((id) => openFolders.add(id));
    icons = await store.get("icons", {});
    state.defaultEmoji = await store.get("defaultSpaceEmoji", "");
    state.defaultIcon = await store.get("defaultSpaceIcon", null);
    const savedColors = await store.get("tabColors", {});
    tabColors = { page: savedColors.page || {}, icon: savedColors.icon || {} };
    const theme = await themeAccent();
    for (const [origin, color] of Object.entries(tabColors.page)) if (isThemeAccent(color.bg, theme)) delete tabColors.page[origin];
    start();
    watchAccent();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
