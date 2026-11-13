  // ---- render ----
  const fitHeight = () => {
    if (!panel?.isConnected) return;
    const top = panel.getBoundingClientRect().top;
    panel.style.maxHeight = `${Math.max(120, window.innerHeight - top - bottomToolbar())}px`;
  };

  const fitFavs = () => {
    const grid = panel?.querySelector(".vm-favs");
    const cols = grid && window.__vm.layout.favColumns(grid.querySelectorAll(":scope > .vm-fav").length, grid.clientWidth, 60, 8);
    if (cols) grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  };
  const favResize = typeof ResizeObserver === "function" ? new ResizeObserver(() => fitFavs()) : null;

  const render = () => {
    if (!panel) return;
    // While a switch is in flight Vivaldi first empties the old space; keep it on screen so it is what slides out.
    if (window.__vm.switchingSpace && state.active === renderedSpace) return;
    const scroll = panel.querySelector(".vm-scroll:not(.vm-leaving)")?.scrollTop ?? 0;
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
    fresh.style.paddingLeft = "var(--vm-row-pad)";
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

    const switching = renderedSpace !== null && renderedSpace !== state.active;
    const previous = switching ? panel.querySelector(".vm-scroll:not(.vm-leaving)") : null;
    const box = previous && { left: previous.offsetLeft, top: previous.offsetTop, width: previous.offsetWidth, height: previous.offsetHeight };
    const leaving = slideOut?.playState === "running" ? slideOut.effect.target : null;
    const leavingScroll = leaving?.scrollTop ?? 0;
    panel.replaceChildren(...(grid ? [grid] : []), body, ...(leaving ? [leaving] : []));
    if (leaving) leaving.scrollTop = leavingScroll;
    fitFavs();
    placeSpaceBar(spaceBar());
    // Each space opens at its top, like Arc; a render within the same space keeps the scroll.
    body.scrollTop = switching ? 0 : scroll;
    fitHeight();
    if (switching) animateSpaceChange(renderedSpace, state.active, previous, box, scroll);
    else keepSliding(body);
    renderedSpace = state.active;
  };
