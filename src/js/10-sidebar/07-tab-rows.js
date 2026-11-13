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
    await vivaldi.tabsPrivate.move({ tabIds: tabs.map((t) => t.id), target: tabs[0].id, workspaceId: spacesOf.of(tabs[0]) || null,
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
    row.style.paddingLeft = "var(--vm-row-pad)";
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
