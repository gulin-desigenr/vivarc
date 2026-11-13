  const tabStackId = (tab) => {
    try { return JSON.parse(tab?.vivExtData || "{}").group || ""; } catch (_) { return ""; }
  };

  // Like Dia: a page opened with Cmd+click (or a middle click, or "Open Link in New Tab") stacks with the tab it came
  // from in a native Vivaldi tab stack. Those open in the background; a link that opens a tab by itself
  // (target=_blank, a site's own pop-up) opens it in front, so a tab created active is left loose. Only the first
  // one needs Vivarc: once the source is in a stack, Vivaldi's own "Open links within current tab stack" puts the
  // next ones there, and takes a tab opened in front out again (Vivaldi would stack those too). Left alone: tabs of other windows, a source bound to a
  // pinned link or favorite (its pages stay in the list), pinned tabs, Peek's temporary tabs, and a source already
  // in a stack. Every stacking move passes the tabs' space: without workspaceId, Vivaldi moves the stack (or the tab
  // joining one) into the default space.
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
      await vivaldi.tabsPrivate.move({ tabIds: [tab.id], target: source.id, workspaceId: spacesOf.of(source) || null, tweaks: ["do-not-reparent", "into"], debug: "Vivarc.autoStack" });
      refresh(false);
      return;
    }
    const job = vivaldi.tabsPrivate.move({ tabIds: [source.id, tab.id], target: source.id, workspaceId: spacesOf.of(source) || null,
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
      const { group } = (await vivaldi.tabsPrivate.move({ tabIds: ids, target: ids[0], workspaceId: state.active || null,
        tweaks: ["do-not-reparent", "create-new-group"], debug: "Vivarc.tidy" })) || {};
      if (group) await vivaldi.tabsPrivate.setGroupProperties({ groupExtId: group, groupTitle: name });
      moved.push(...ids);
    }
    for (const { group, ids } of join) {
      const target = stacks.find((st) => st.group === group)?.first;
      if (target == null) continue;
      await vivaldi.tabsPrivate.move({ tabIds: ids, target, workspaceId: state.active || null, tweaks: ["do-not-reparent", "into"], debug: "Vivarc.tidy" });
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
    await vivaldi.tabsPrivate.move({ tabIds: [tabId], target: memberId, workspaceId: state.active || null, tweaks: ["do-not-reparent", "into"], debug: "Vivarc.joinStack" });
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
    const { group } = (await vivaldi.tabsPrivate.move({ tabIds: ids, target: ids[0], workspaceId: state.active || null,
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
    ordered.forEach((tab) => content.append(tabRow(tab)));
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
