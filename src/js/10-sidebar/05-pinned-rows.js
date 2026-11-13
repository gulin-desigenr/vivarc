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
    row.style.paddingLeft = `calc(var(--vm-row-pad) + ${depth} * var(--vm-row-indent))`;
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
    head.style.paddingLeft = `calc(var(--vm-row-pad) + ${depth} * var(--vm-row-indent))`;
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
