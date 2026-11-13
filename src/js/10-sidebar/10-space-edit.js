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
