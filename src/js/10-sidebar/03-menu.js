  // ---- context menu ----
  // A click on the page goes to the page, never to this document: a clear shield under the menu catches it, so a
  // click anywhere closes the menu.
  let menu = null;
  let shield = null;
  const closeMenu = () => { menu?.remove(); menu = null; shield?.remove(); shield = null; };
  const showMenu = (event, items) => {
    event.preventDefault();
    event.stopPropagation();
    closeMenu();
    menu = el("div", "vm-menu");
    for (const [label, action, danger] of items) {
      if (!label) { menu.append(el("div", "vm-menu-sep")); continue; }
      const item = el("div", `vm-menu-item${danger ? " danger" : ""}`, label);
      item.addEventListener("click", () => { closeMenu(); action(); });
      menu.append(item);
    }
    shield = el("div", "vm-menu-shield");
    shield.addEventListener("mousedown", (e) => { e.preventDefault(); closeMenu(); });
    shield.addEventListener("contextmenu", (e) => { e.preventDefault(); closeMenu(); });
    (document.querySelector("#browser") || document.body).append(shield, menu);
    const { width, height } = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(event.clientX, window.innerWidth - width - 8)}px`;
    menu.style.top = `${Math.min(event.clientY, window.innerHeight - height - 8)}px`;
  };
  const outside = (e) => { if (menu && !menu.contains(e.target)) closeMenu(); };
  document.addEventListener("mousedown", outside, true);
  document.addEventListener("focusin", outside, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
  window.addEventListener("blur", closeMenu);
  window.__vm?.onShortcut((key) => { if (key === "esc") closeMenu(); });
