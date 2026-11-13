  // ---- tab colours: like Vivaldi's "accent from page", a hovered or active tab takes its page's main colour ----
  // The page's colour is Vivaldi's own accent, learned while the tab is active (Vivaldi computes it only for the
  // active page); until then the favicon's main colour stands in. Both are kept per origin.
  const colorsOf = window.__vm.colors;
  let tabColors = { page: {}, icon: {} }; // page: origin -> { bg, fg }; icon: origin -> "#rrggbb" or null (no colour)
  let saveColorsTimer = null;
  const saveColors = () => {
    clearTimeout(saveColorsTimer);
    saveColorsTimer = setTimeout(() => store.set("tabColors", tabColors), 1000);
  };
  const colorFor = (origin) => {
    if (tabColors.page[origin]) return tabColors.page[origin];
    const icon = tabColors.icon[origin];
    return icon ? { bg: icon, fg: colorsOf.textFor(icon) } : null;
  };
  const paintRow = (row) => {
    const origin = row.dataset.origin;
    // A black or near-black mark (GitHub, MDN) disappears on a dark sidebar: vivarc.css lightens it there.
    const mark = colorsOf.parse(tabColors.icon[origin]);
    row.classList.toggle("vm-ico-dark", !!mark && colorsOf.rgbToHsl(mark)[2] < 20);
    const color = colorFor(origin);
    if (!color) return;
    row.style.setProperty("--vm-tab-bg", color.bg);
    row.style.setProperty("--vm-tab-fg", color.fg);
    row.classList.add("vm-tinted");
    // An icon in the row's own colour would vanish on it: a dark mark is inverted, a coloured one gets a white tile.
    const icon = colorsOf.parse(tabColors.icon[origin]), bg = colorsOf.parse(color.bg);
    const lost = icon && bg && colorsOf.contrast(icon, bg) < 1.8;
    const grey = lost && colorsOf.rgbToHsl(icon)[1] < 20;
    row.classList.toggle("vm-ico-invert", !!grey);
    row.classList.toggle("vm-ico-tile", !!lost && !grey);
  };
  const repaint = (origin) => panel?.querySelectorAll(`[data-origin="${CSS.escape(origin)}"]`).forEach(paintRow);
  const iconPending = new Set();
  const learnIcon = (origin) => {
    const src = [icons[origin], seedIcons[origin]].find((v) => v?.startsWith("data:")); // a data URL never taints the canvas
    if (!src || origin in tabColors.icon || iconPending.has(origin)) return;
    iconPending.add(origin);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = new OffscreenCanvas(24, 24);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, 24, 24);
        tabColors.icon[origin] = colorsOf.dominant(ctx.getImageData(0, 0, 24, 24).data);
        saveColors();
        repaint(origin);
      } catch (_) {}
    };
    img.src = src;
  };
  const tintRow = (row, url) => {
    const origin = originOf(url);
    if (!/^https?:/.test(origin)) return;
    row.dataset.origin = origin;
    paintRow(row);
    learnIcon(origin);
    // No favicon at all: the row's letter tile has a colour of its own, so the row uses it (white text on 40% L).
    const letter = row.querySelector(".vm-ico > .vm-letter");
    if (letter && !colorFor(origin)) {
      row.style.setProperty("--vm-tab-bg", letter.style.backgroundColor);
      row.style.setProperty("--vm-tab-fg", "#ffffff");
      row.classList.add("vm-tinted");
    }
  };
  // Before a page has a colour of its own (at start-up, a tab still loading or asleep) Vivaldi shows the theme's
  // accent, saturation-limited: a colour that close to it says nothing about the page.
  const themeAccent = async () => {
    try {
      const pref = async (key) => { const p = await vivaldi.prefs.get(key); return p?.value ?? p?.defaultValue ?? p; };
      const id = await pref("vivaldi.themes.current");
      const themes = [...((await pref("vivaldi.themes.user")) || []), ...((await pref("vivaldi.themes.system")) || [])];
      return colorsOf.parse(themes.find((t) => t.id === id)?.colorAccentBg);
    } catch (_) { return null; }
  };
  const isThemeAccent = (bg, theme) => {
    const rgb = colorsOf.parse(bg);
    return !!(rgb && theme) && Math.hypot(...rgb.map((v, i) => v - theme[i])) < 48;
  };
  let lastAccent = null;
  const learnAccent = async () => {
    const browser = document.querySelector("#browser");
    if (!browser?.classList.contains("color-accent-from-page")) return;
    const style = getComputedStyle(browser);
    const bg = style.getPropertyValue("--colorAccentBg").trim();
    if (!colorsOf.parse(bg) || bg === lastAccent) return;
    lastAccent = bg;
    const [tab] = await chrome.tabs.query({ active: true, windowId: window.vivaldiWindowId });
    const origin = originOf(tab?.url);
    if (!/^https?:/.test(origin) || tab.status === "loading" || tab.discarded) return;
    if (isThemeAccent(bg, await themeAccent())) return;
    const fg = colorsOf.parse(style.getPropertyValue("--colorAccentFg").trim()) ? style.getPropertyValue("--colorAccentFg").trim() : colorsOf.textFor(bg);
    if (tabColors.page[origin]?.bg === bg) return;
    tabColors.page[origin] = { bg, fg };
    saveColors();
    repaint(origin);
  };
  let accentTimer = null;
  const watchAccent = () => {
    const browser = document.querySelector("#browser");
    if (!browser || browser.__vmAccent) return;
    browser.__vmAccent = true;
    // Vivaldi sets the accent on #browser's inline style after the page has painted; wait for it to settle.
    new MutationObserver(() => { clearTimeout(accentTimer); accentTimer = setTimeout(learnAccent, 400); })
      .observe(browser, { attributes: true, attributeFilter: ["style", "class"] });
  };
