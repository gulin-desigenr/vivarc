  // ---- space bar: Vivaldi workspaces as Arc-style spaces ----
  // Like Arc, the favorite you are on goes with you when you switch spaces, instead of the new space's last tab
  // showing. Only a switch of space carries it (the space bar, Ctrl+1..9, Cmd+Option+Left/Right), never a tab of
  // another space chosen on purpose (Switch to Tab, a pinned link). The switch request and the change of space
  // arrive in either order, so each is kept for a moment and whichever comes second moves the tab.
  const favoriteTab = (tab) => !!tab && !!state.favs && !window.__vm.tilingOf(tab)
    && state.favs.children.some((c) => !c.children && c.id === pinLinks.pinOf(tab));
  let wantCarry = 0; // when a switch of space was asked for
  let lastDeparture = null; // { tabId, to, at }: the favorite left behind by the last change of space
  const carry = async () => {
    const now = Date.now();
    if (!lastDeparture || now - wantCarry > 2000 || now - lastDeparture.at > 2000) return;
    const { tabId, to } = lastDeparture;
    lastDeparture = null;
    wantCarry = 0;
    if (to !== state.active) return; // already switched again
    try {
      await moveTabToSpace(tabId, to);
      refresh(false);
    } catch (e) { console.warn("[vivarc] favorite to space:", e); }
  };
  const departed = (before, to) => {
    lastDeparture = favoriteTab(before.tab) ? { tabId: before.tab.id, to, at: Date.now() } : null;
    if (lastDeparture) carry();
  };
  const askCarry = () => { wantCarry = Date.now(); carry(); };
  window.__vm.onShortcut((key) => {
    if (key === window.__vm.normalise("alt+meta+left") || key === window.__vm.normalise("alt+meta+right")) askCarry();
  });

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
    const carrying = item.id !== state.active && favoriteTab(tabs.find((t) => t.active));
    const empty = !carrying && targetTabs.every((tab) => BLANK.test(tab.pendingUrl || tab.url || ""));
    if (carrying) askCarry();
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

  // The default space is "no workspace": tabsPrivate.move takes workspaceId null for it (0 or "window" leave the
  // tab where it is, and activating it then switched to its old space).
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
    await vivaldi.tabsPrivate.move({ tabIds: [tab.id], target: "last", tweaks: ["do-not-reparent"], workspaceId: id || null });
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
