// Vivarc sidebar: favorites grid on top, then one scrollable panel (pinned folders, divider,
// open tabs). The data lives in a bookmarks folder that has a "Favorites" and a "Pinned" subfolder
// (created on first run, or produced by `vivarc import-arc`). Vivaldi's own tab strip is hidden.
//
// The sidebar is one module split over the files of this folder: the bundler (vivarc.py, module_source) joins
// them in name order inside a single function, so they share one scope, as if they were one file. A name
// declared in one file is visible in all of them; only the order matters for code that runs at load, which
// is all in 14-start.js.
  const cfg = window.__vm.config;
  const BLANK = /^(chrome|vivaldi):\/\/(newtab|vivaldi-webui\/startpage)/;
  const bottomToolbar = () => (window.__vm.settings.get("compactBottomBar") ? 35 : 64);

  const store = window.__vm.store;
  const openFolders = new Set();
  const collapsedStacks = new Set();
  const seedIcons = window.__vmIcons || {};
  let icons = {};
  const saveOpen = () => store.set("open", [...openFolders]);
  const state = { space: null, defaultSpace: null, folders: [], favs: null, pinned: null, trash: null, tabs: [], allTabs: [], bound: new Map(),
    profiles: [], renameId: null, workspaces: [], active: 0 };
  const spacesOf = window.__vm.workspaces;
  let panel = null;
  let renderedSpace = null;
  // Like Arc, switching spaces slides the space's content (its name, pinned and tabs) sideways while the
  // favorites above stay put: the old page leaves on one side as the new one comes in from the other, in the
  // order of the space bar. Only the sidebar moves; Vivaldi shows the new page at once.
  const SPACE_SLIDE = { duration: 460, easing: "cubic-bezier(0.16, 1, 0.3, 1)" };
  let slideIn = null;
  let slideOut = null;

  const spaceOrder = (id) => spaceItems().findIndex((item) => item.id === id);

  // `old` is the previous space's scroll body, already detached by the render that replaced it.
  const animateSpaceChange = (from, to, old, oldBox, oldScroll) => {
    slideOut?.effect?.target?.remove();
    slideOut?.cancel();
    slideOut = null;
    const body = panel.querySelector(".vm-scroll");
    if (!body?.animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { slideIn = null; return; }
    const a = spaceOrder(from);
    const b = spaceOrder(to);
    const sign = a < 0 || b < 0 || b > a ? 1 : -1;
    const width = panel.clientWidth;
    slideIn = body.animate([{ transform: `translateX(${sign * width}px)` }, { transform: "translateX(0)" }], SPACE_SLIDE);
    if (!old || !oldBox) return;
    Object.assign(old.style, {
      position: "absolute", left: `${oldBox.left}px`, top: `${oldBox.top}px`, width: `${oldBox.width}px`,
      height: `${oldBox.height}px`, pointerEvents: "none",
    });
    old.classList.add("vm-leaving");
    old.inert = true;
    panel.append(old);
    old.scrollTop = oldScroll;
    slideOut = old.animate([{ transform: "translateX(0)" }, { transform: `translateX(${-sign * width}px)` }], SPACE_SLIDE);
    slideOut.finished.then(() => old.remove(), () => {});
  };

  // A render during the slide (tabs and bookmarks arrive in several steps) carries the slide on to its new body.
  const keepSliding = (body) => {
    if (!slideIn || slideIn.playState !== "running") { slideIn = null; return; }
    const next = body.animate(slideIn.effect.getKeyframes(), SPACE_SLIDE);
    next.startTime = slideIn.startTime;
    slideIn = next;
  };

  // Folders as in Arc: a filled body in a light wash of the folder's color with a firmer outline and a front flap.
  const ICON_CLOSED =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.4a2 2 0 0 1 1.5.68L12 7.5h6.5A2.5 2.5 0 0 1 21 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" fill="currentColor" fill-opacity=".22"/><path d="M3 10h18" stroke-opacity=".6"/></svg>';
  const ICON_OPEN =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M3 17.5V7.5A2.5 2.5 0 0 1 5.5 5h3.4a2 2 0 0 1 1.5.68L12 7.5h6.5A2.5 2.5 0 0 1 21 10v1.5" fill="currentColor" fill-opacity=".14"/><path d="M3.3 18.6 5.2 12a2 2 0 0 1 1.9-1.5H21a1 1 0 0 1 1 1.3l-1.8 6.4A2 2 0 0 1 18.3 20H5.5a2.2 2.2 0 0 1-2.2-1.4z" fill="currentColor" fill-opacity=".26"/></svg>';

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  };

  const pinLinks = window.__vm.pins;
  const { sameSite } = pinLinks;

  const originOf = (url) => {
    try { return new URL(url).origin; } catch (_) { return ""; }
  };

  const letterIcon = (url) => {
    let host = "?";
    try { host = new URL(url).hostname.replace(/^www\./, "") || (url.startsWith("file:") ? "vivarc" : "?"); } catch (_) {}
    let hash = 0;
    for (const ch of host) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
    const span = el("span", "vm-letter", host[0].toUpperCase());
    span.style.backgroundColor = `hsl(${hash} 38% 40%)`;
    return span;
  };

  const iconEl = (url, live) => {
    const wrap = el("span", "vm-ico");
    const origin = originOf(url);
    const sources = [live, icons[origin], seedIcons[origin]].filter(Boolean);
    const next = () => {
      const src = sources.shift();
      if (!src) {
        // Nothing known yet (a pin never opened here, a tab restored without its icon): show the letter, then
        // swap in the icon from Vivaldi's own favicon database if it has one for this site (from upstream 0.1.18).
        wrap.replaceChildren(letterIcon(url));
        historyIcon(url).then((found) => {
          if (!found || !wrap.isConnected) return;
          const img = el("img");
          img.src = found;
          wrap.replaceChildren(img);
          // The row was coloured from its letter: now that there is an icon, learn the icon's colour instead.
          const row = wrap.closest("[data-origin]");
          if (row && colorFor(origin)) paintRow(row);
          else if (row) { row.classList.remove("vm-tinted"); learnIcon(origin); }
        });
        return;
      }
      const img = el("img");
      img.addEventListener("error", next);
      img.src = src;
      wrap.replaceChildren(img);
    };
    next();
    return wrap;
  };
