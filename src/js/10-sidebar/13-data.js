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
    const before = { space: state.active, tab: state.allTabs.find((t) => t.active) };
    state.allTabs = (await chrome.tabs.query({ currentWindow: true })).filter((tab) => {
      if (temporary.has(tab.id)) return false;
      try { return !JSON.parse(tab.vivExtData || "{}").arcPeekRuntime; } catch (_) { return true; }
    });
    state.workspaces = await readWorkspaces();
    ({ active: state.active, tabs: state.tabs } = spacesOf.scope(state.allTabs, state.workspaces));
    for (const id of selected) if (!state.tabs.some((t) => t.id === id)) selected.delete(id);
    if (before.space !== state.active && state.workspaces.length) departed(before, state.active);
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
