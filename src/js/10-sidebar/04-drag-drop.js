  // ---- drag and drop ----
  let drag = null;
  let dragPoint = null;
  let refreshAfterDrag = false;
  // A zero screen coordinate is Chromium's "unknown" dragend position on macOS, not a reliable drop point.
  const pointOf = (e) => Number.isFinite(e?.screenX) && Number.isFinite(e?.screenY) && (e.screenX !== 0 || e.screenY !== 0)
    ? { x: e.screenX, y: e.screenY } : null;
  const outsideWindow = (point, bounds) => !!point && !!bounds &&
    (point.x < bounds.left || point.y < bounds.top || point.x >= bounds.left + bounds.width || point.y >= bounds.top + bounds.height);
  window.__vm.dragOutsideWindow = outsideWindow;
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
      dragPoint = pointOf(e);
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
    node.addEventListener("drag", (e) => { dragPoint = pointOf(e) || dragPoint; });
    node.addEventListener("dragend", async (e) => {
      const data = drag;
      const point = pointOf(e) || dragPoint;
      drag = null;
      dragPoint = null;
      if (refreshAfterDrag) refresh(true);
      node.classList.remove("dragging");
      document.querySelector("#browser")?.classList.remove("vm-dragging");
      clearDrop();
      // Dropped outside the window (nothing took it): the tab moves to a new window there, like Chrome's.
      if (data?.type === "tab" && !data.tab.pinned && e.dataTransfer?.dropEffect === "none") {
        try {
          const bounds = await chrome.windows.getCurrent();
          if (outsideWindow(point, bounds)) {
            // Detach one tab from its stack before Vivaldi transfers it to the new window.
            if (tabStackId(data.tab)) await unstack([data.tab.id]);
            await chrome.windows.create({ tabId: data.tab.id, left: point.x, top: point.y, focused: true, type: "normal" });
          }
        } catch (err) { console.warn("[vivarc] tear out tab:", err); }
      }
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
