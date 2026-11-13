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
      favResize?.observe(panel);
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
        if (next?.tab) {
          await chrome.tabs.update(next.tab.id, { active: true });
          if (BLANK.test(next.tab.pendingUrl || next.tab.url || "")) window.dispatchEvent(new CustomEvent("vm-open-command-bar"));
        }
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
