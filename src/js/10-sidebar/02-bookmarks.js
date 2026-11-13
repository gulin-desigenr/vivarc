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

  // A pinned link opens in the space whose list it was clicked in. Vivaldi puts a tab the mod creates in its own
  // idea of the current workspace, which can differ from the space on screen (right after a switch, or when
  // Vivaldi still holds the previous one), so the tab is moved there if it landed elsewhere.
  const openPin = async (node) => {
    const space = state.active;
    const tab = await chrome.tabs.create({ url: node.url });
    await writeExt(tab.id, { [pinLinks.PIN]: node.id });
    recordHome(tab.id, node.id);
    try {
      const fresh = await chrome.tabs.get(tab.id);
      if (state.workspaces?.length && spacesOf.of(fresh) !== space) {
        await vivaldi.tabsPrivate.move({ tabIds: [tab.id], target: "last", tweaks: ["do-not-reparent"], workspaceId: space || null });
        await chrome.tabs.update(tab.id, { active: true });
      }
    } catch (e) { console.warn("[vivarc] pinned tab space:", e); }
  };

  // A favorite has one tab for every space, like Arc's: when its tab is in another space, it comes to this one
  // instead of a second tab opening (a tab in a split view is left where it is, and Vivarc switches to it).
  const isFavorite = (node) => !!state.favs && node.parentId === state.favs.id;
  const favoriteTabElsewhere = (node) => {
    if (!isFavorite(node)) return null;
    const tab = pinLinks.owners(state.allTabs, new Set([node.id])).get(node.id);
    return tab && spacesOf.of(tab) !== state.active ? tab : null;
  };
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
    // A favorite stays with its one tab (clicking it in another space brings the tab there): any other tab of this
    // space that carries it is a leftover duplicate, and no other tab here takes a favorite whose tab is elsewhere.
    const owners = pinLinks.owners(state.allTabs, new Set(favTiles.map((n) => n.id)));
    const elsewhere = new Set([...owners].filter(([, tab]) => spacesOf.of(tab) !== state.active).map(([id]) => id));
    // A leftover still on the favorite's site is a second copy of the same page, and two copies of a site like
    // WhatsApp Web take the session from each other ("open in another window"): it is closed. One that went
    // elsewhere keeps its page as a plain tab.
    const leftovers = state.tabs.filter((t) => owners.has(pinLinks.pinOf(t)) && owners.get(pinLinks.pinOf(t)).id !== t.id);
    for (const tab of leftovers) {
      const fav = favTiles.find((n) => n.id === pinLinks.pinOf(tab));
      if (!tab.active && fav && !pinLinks.away(tab, fav.url) && pinLinks.sameSite(tab.url, fav.url)) chrome.tabs.remove(tab.id).catch(() => {});
      else writeExt(tab.id, { [pinLinks.PIN]: undefined, [pinLinks.HOME]: undefined });
    }
    const pins = [...favTiles.filter((n) => !elsewhere.has(n.id)), ...(state.pinned ? leaves(state.pinned) : [])]
      .map((n) => ({ id: n.id, url: n.url }));
    const allIds = state.folders.flatMap((f) => leaves(f)).map((n) => n.id);
    const { bound, writes } = pinLinks.plan(state.tabs.filter((t) => !leftovers.includes(t)), pins, allIds);
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
