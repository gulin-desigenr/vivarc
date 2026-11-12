// Vivarc space editor: each space's name and emoji (kept by Vivaldi's workspaces, changed through the sidebar) and
// its theme: a tint of one to three colors (a gradient), shade and grain, saved in the profile. The first color is
// theme.hue/sat/light, as before gradients; the others are in theme.more.
(() => {
  const { store } = window.__vm;
  const PRESETS = [
    ["#efe9e4", 30, 20, 90], ["#e89bbb", 335, 55, 75], ["#a0739f", 305, 25, 54], ["#e0626e", 355, 65, 62],
    ["#ef8c5f", 18, 80, 65], ["#f2d56b", 47, 85, 68], ["#6fe3a0", 143, 65, 65], ["#7db7dc", 203, 55, 67], ["#6d6a92", 245, 18, 48],
  ];
  const DEFAULT = { on: false, hue: 250, sat: 28, light: 20, grain: 30, more: [] };
  const MAX_COLORS = 3;
  const EMOJIS = ["💼", "🏠", "🎨", "🧪", "📚", "💡", "📝", "🛠️", "🚀", "🧠", "💰", "📈", "🛒", "✈️", "🌍", "🎵",
    "🎬", "📷", "🎮", "⚽", "🧘", "🍳", "☕", "🌱", "🐶", "❤️", "⭐", "🔥"];
  const colorsOf = (t) => [{ hue: t.hue, sat: t.sat, light: t.light }, ...(Array.isArray(t.more) ? t.more : [])].slice(0, MAX_COLORS);
  // A space's color is painted at a little over half its saturation, so even the most intense one stays a tinted
  // grey under the page, like Dia's themes; the Intensity slider keeps its whole range inside that.
  const PAINT_SATURATION = 0.55;
  const painted = (c) => ({ ...c, sat: Math.round(c.sat * PAINT_SATURATION) });
  const hsl = (c) => { const p = painted(c); return `hsl(${p.hue} ${p.sat}% ${p.light}%)`; };
  // The gradient runs down and across the sidebar and the window frame as one, fixed to the window.
  const gradientOf = (t) => {
    const colors = colorsOf(t);
    return colors.length > 1 ? `linear-gradient(160deg, ${colors.map(hsl).join(", ")})` : "";
  };
  let theme = { ...DEFAULT };
  let pop = null;
  let activeSpace = null;
  let revision = 0;
  let pending = Promise.resolve();
  const keyFor = (id) => `theme:space:${id}`;
  const updates = typeof BroadcastChannel === "function" ? new BroadcastChannel("vivarc-space-themes") : null;

  const fgFor = (light) => (light > 58 ? "#1b1b1f" : "#f2f2f5");
  // Grain like Arc's (measured on its screen): every screen pixel its own random speck, each color channel apart,
  // not the soft blotches of an SVG turbulence. A 128px tile of random pixels, drawn once, one tile pixel per screen
  // pixel (so 64 CSS px on a Retina screen).
  const FALLBACK_NOISE = "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";
  let noiseTile = null;
  const noise = () => {
    if (noiseTile) return noiseTile;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext?.("2d");
    if (!ctx) return FALLBACK_NOISE;
    canvas.width = canvas.height = 128;
    const image = ctx.createImageData(128, 128);
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = Math.random() * 256;
      image.data[i + 1] = Math.random() * 256;
      image.data[i + 2] = Math.random() * 256;
      image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    noiseTile = `url("${canvas.toDataURL("image/png")}")`;
    return noiseTile;
  };
  // The grain is blended with "overlay", whose effect shrinks toward white and black: the layer's opacity is raised
  // on light and dark colors so the slider gives the same visible grain on any color (up to about 20 levels of
  // variation per pixel at 100, Arc's strong end).
  const grainOpacity = (t) => {
    // How far overlay can move the space's colors: the channel nearest the middle (it moves most) sets the opacity.
    const toRgb = window.__vm.colors?.hslToRgb;
    const levels = toRgb
      ? colorsOf(t).map(painted).flatMap((c) => toRgb(c.hue, c.sat, c.light).map((v) => v / 255))
      : colorsOf(t).map((c) => c.light / 100);
    const reach = Math.max(0.12, ...levels.map((v) => 2 * Math.min(v, 1 - v)));
    return Math.min(1, (t.grain / 100) * 20 / (reach * 0.289 * 255));
  };

  const apply = () => {
    const browser = document.querySelector("#browser");
    if (!browser) return;
    browser.classList.toggle("vm-themed", theme.on);
    const style = browser.style;
    if (!theme.on) {
      browser.classList.toggle("vm-gradient", false);
      browser.classList.toggle("vm-light-ink", false);
      for (const k of ["--vm-tint", "--vm-tint-image", "--vm-fg", "--vm-fg-muted", "--vm-space-solid", "--vm-space-solid-fg", "--vm-grain", "--vm-noise", "--vm-noise-size", "--vm-fav-color", "--vm-fav-opacity", "--vm-fav-hover-opacity", "--vm-fav-active-opacity", "--vm-stop-1", "--vm-stop-2", "--vm-stop-3", "--vm-space-select"]) style.removeProperty(k);
      return;
    }
    style.setProperty("--vm-tint", hsl(theme));
    const gradient = gradientOf(theme);
    if (gradient) style.setProperty("--vm-tint-image", gradient); else style.removeProperty("--vm-tint-image");
    browser.classList.toggle("vm-gradient", !!gradient);
    // The same surface as three color stops (vivarc.css paints them while switching spaces): a solid space repeats
    // its color, a two-color one adds the midpoint, so the colors can crossfade where a gradient image cannot.
    const rgb = window.__vm.colors?.hslToRgb && colorsOf(theme).map(painted).map((c) => window.__vm.colors.hslToRgb(c.hue, c.sat, c.light));
    if (rgb) {
      const mid = rgb.length === 2 ? rgb[0].map((v, i) => (v + rgb[1][i]) / 2) : rgb[1] || rgb[0];
      [rgb[0], mid, rgb.at(-1)].forEach((c, i) => style.setProperty(`--vm-stop-${i + 1}`, `rgb(${c.map(Math.round).join(" ")})`));
    }
    const ink = window.__vm.colors?.inkFor(colorsOf(theme).map(painted).map((c) => window.__vm.colors.hslToRgb(c.hue, c.sat, c.light)));
    const fg = ink?.fg || fgFor(theme.light);
    style.setProperty("--vm-fg", fg);
    // Light ink means a dark space: the sidebar's pills and tiles lighten instead of whitening (vivarc.css).
    const fgRgb = window.__vm.colors?.parse(fg);
    browser.classList.toggle("vm-light-ink", fgRgb ? window.__vm.colors.luminance(fgRgb) > 0.4 : theme.light <= 58);
    style.setProperty("--vm-fg-muted", ink?.muted || fgFor(theme.light));
    // The command bar's selected row, like Arc's: the space's own color, as muted as the sidebar's, at mid lightness.
    const base = painted(colorsOf(theme)[0]);
    style.setProperty("--vm-space-select", `hsl(${base.hue} ${base.sat}% 62%)`);
    const solid = window.__vm.colors?.spaceSolid(theme);
    if (solid) { style.setProperty("--vm-space-solid", solid.bg); style.setProperty("--vm-space-solid-fg", solid.fg); }
    // Pale colored spaces get a lighter tile; near-white spaces need a dark tile for separation.
    const pale = theme.light > 58 && theme.light < 87;
    style.setProperty("--vm-fav-color", theme.light >= 87 ? "#1b1b1f" : "#fff");
    style.setProperty("--vm-fav-opacity", pale ? "46%" : theme.light >= 87 ? "20%" : "16%");
    style.setProperty("--vm-fav-hover-opacity", pale ? "58%" : theme.light >= 87 ? "27%" : "23%");
    style.setProperty("--vm-fav-active-opacity", pale ? "64%" : theme.light >= 87 ? "30%" : "24%");
    style.setProperty("--vm-grain", String(Math.round(grainOpacity(theme) * 1000) / 1000));
    style.setProperty("--vm-noise", noise());
    style.setProperty("--vm-noise-size", `${128 / (window.devicePixelRatio || 1)}px`);
  };

  // Between spaces the color crossfades (vivarc.css); edits in the space editor stay instant.
  let fading = 0;
  const fade = () => {
    const browser = document.querySelector("#browser");
    if (!browser || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    browser.classList.toggle("vm-space-fading", true);
    clearTimeout(fading);
    fading = setTimeout(() => browser.classList.toggle("vm-space-fading", false), 500);
  };

  const save = () => {
    apply();
    if (activeSpace === null) return;
    const saved = { ...theme };
    store.set(keyFor(activeSpace), saved);
    updates?.postMessage({ space: activeSpace, theme: saved });
  };

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  };

  // The name field may still hold an edit when the editor closes (a click outside removes it without a blur).
  let beforeClose = null;
  let shield = null; // catches a click on the page, which this document never sees (see the sidebar's menu)
  const close = () => { const commit = beforeClose; beforeClose = null; commit?.(); pop?.remove(); pop = null; shield?.remove(); shield = null; };

  const open = async () => {
    if (!window.__vm.cssLoaded) return;
    if (pop) return close();
    const space = activeSpace;
    await pending;
    if (space !== activeSpace || activeSpace === null) return;
    const item = window.__vm.spaceList?.().find((i) => i.id === space) || { id: space, name: "", emoji: "" };
    let selected = 0; // which color of the gradient the pad, swatches and Intensity change
    pop = el("div", "vm-theme-pop");

    // Name and mark. The mark button opens a picker: any emoji typed or pasted in its field (Ctrl+Cmd+Space opens
    // the macOS emoji picker there), a few emoji, Vivaldi's workspace icons, or none.
    const head = el("div", "vm-theme-head");
    const markButton = el("button", "vm-theme-mark");
    markButton.title = "Emoji or icon";
    const name = el("input", "vm-theme-name");
    name.value = item.name || "";
    name.placeholder = "Space name";
    head.append(markButton, name);
    const showMark = () => {
      markButton.replaceChildren();
      const mark = window.__vm.spaceMark?.(item, "vm-theme-mark-glyph");
      if (mark) markButton.append(mark);
      else markButton.append(el("span", "vm-theme-mark-letter", (item.name || "?").trim().charAt(0).toUpperCase()));
    };
    showMark();
    const picks = el("div", "vm-theme-picker");
    const typed = el("input", "vm-theme-emoji-field");
    typed.placeholder = "Type or paste any emoji";
    const hint = el("div", "vm-theme-hint", "Press ⌃⌘Space here for every emoji");
    const setEmoji = (value) => {
      const one = window.__vm.workspaces?.firstGrapheme?.(value) ?? value;
      item.emoji = one;
      item.icon = "";
      showMark();
      window.__vm.setSpaceEmoji?.(space, one);
    };
    const setIcon = (index, svg) => {
      item.emoji = "";
      item.icon = svg;
      showMark();
      window.__vm.setSpaceIcon?.(space, index);
    };
    typed.addEventListener("input", () => { if (typed.value.trim()) { setEmoji(typed.value); typed.value = ""; picks.classList.remove("open"); } });
    typed.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape" || e.key === "Enter") picks.classList.remove("open"); });
    const emojiGrid = el("div", "vm-theme-grid");
    for (const e of EMOJIS) {
      const b = el("button", "vm-theme-pick", e);
      b.addEventListener("click", () => { setEmoji(e); picks.classList.remove("open"); });
      emojiGrid.append(b);
    }
    const iconGrid = el("div", "vm-theme-grid");
    (window.__vm.spaceIcons?.() || []).forEach((svg, index) => {
      const b = el("button", "vm-theme-pick");
      const glyph = el("span", "vm-mark-icon vm-theme-pick-icon");
      glyph.style.setProperty?.("--vm-icon", window.__vm.workspaces.iconMask(svg));
      b.append(glyph);
      b.addEventListener("click", () => { setIcon(index, svg); picks.classList.remove("open"); });
      iconGrid.append(b);
    });
    const none = el("button", "vm-theme-none", "No emoji or icon");
    none.addEventListener("click", () => { setEmoji(""); picks.classList.remove("open"); });
    picks.append(typed, hint, el("div", "vm-theme-label", "Emoji"), emojiGrid,
      ...(iconGrid.children.length ? [el("div", "vm-theme-label", "Icons"), iconGrid] : []), none);
    markButton.addEventListener("click", () => {
      picks.classList.toggle("open");
      if (picks.classList.contains("open")) typed.focus();
    });
    let asked = item.name;
    const commitName = async () => {
      const value = name.value.trim();
      if (!value || value === asked) { if (!value) name.value = item.name || ""; return; }
      asked = value;
      const ok = await window.__vm.renameSpace?.(space, value);
      if (ok) { item.name = value; showMark(); } else { asked = item.name; name.value = item.name || ""; }
    };
    name.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") name.blur();
      if (e.key === "Escape") { name.value = item.name || ""; name.blur(); }
    });
    name.addEventListener("blur", commitName);
    beforeClose = commitName;

    // Opening the editor no longer turns the theme on: changing a color does.
    const colors = () => colorsOf(theme);
    const current = () => colors()[selected];
    const setCurrent = (patch) => {
      const list = colors().map((c, i) => (i === selected ? { ...c, ...patch } : c));
      const [first, ...more] = list;
      theme = { ...theme, ...first, more, on: true };
      save();
      sync();
    };

    const modes = el("div", "vm-theme-modes");
    for (const [label, light] of [["Dark", 18], ["Light", 88]]) {
      const b = el("button", "vm-theme-mode", label);
      b.addEventListener("click", () => {
        const [first, ...more] = colors().map((c) => ({ ...c, light }));
        theme = { ...theme, ...first, more, on: true };
        save();
        sync();
      });
      modes.append(b);
    }

    const pad = el("div", "vm-theme-pad");
    const stops = [0, 60, 120, 180, 240, 300, 360].map((h) => `hsl(${h} ${Math.round(70 * PAINT_SATURATION)}% 50%)`).join(",");
    pad.style.background = `linear-gradient(to bottom, hsla(0,0%,100%,.75), transparent 45%, hsla(0,0%,0%,.8)), linear-gradient(to right, ${stops})`;
    const position = (c) => ({ x: c.hue / 360, y: (90 - c.light) / 80 });
    const place = (e) => {
      const r = pad.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      setCurrent({ hue: Math.round(x * 360), light: Math.round(90 - y * 80) });
    };
    pad.addEventListener("pointerdown", (e) => {
      // Pressing on another color's dot picks it up instead of moving the selected one there.
      const r = pad.getBoundingClientRect();
      const near = colors().findIndex((c) => {
        const p = position(c);
        return Math.hypot(r.left + p.x * r.width - e.clientX, r.top + p.y * r.height - e.clientY) < 12;
      });
      if (near >= 0 && near !== selected) { selected = near; sync(); }
      pad.setPointerCapture(e.pointerId);
      place(e);
      const move = (ev) => place(ev);
      pad.addEventListener("pointermove", move);
      pad.addEventListener("pointerup", () => pad.removeEventListener("pointermove", move), { once: true });
    });

    // The colors of the gradient: pick one to change it, + adds one (up to three), Remove takes the picked one out.
    const chips = el("div", "vm-theme-colors");
    const addColor = () => {
      const list = colors();
      if (list.length >= MAX_COLORS) return;
      const last = list.at(-1);
      list.push({ hue: (last.hue + 40) % 360, sat: last.sat, light: last.light });
      const [first, ...more] = list;
      theme = { ...theme, ...first, more, on: true };
      selected = list.length - 1;
      save();
      sync();
    };
    const removeColor = () => {
      const list = colors();
      if (list.length < 2) return;
      list.splice(selected, 1);
      const [first, ...more] = list;
      theme = { ...theme, ...first, more };
      selected = Math.min(selected, list.length - 1);
      save();
      sync();
    };

    const swatches = el("div", "vm-theme-swatches");
    for (const [color, hue, sat, light] of PRESETS) {
      const s = el("button", "vm-theme-swatch");
      s.style.backgroundColor = hsl({ hue, sat, light });
      s.addEventListener("click", () => setCurrent({ hue, sat, light }));
      swatches.append(s);
    }

    // The track is filled up to the thumb, like a macOS slider (the CSS paints up to --fill).
    const fill = (input) => input.style?.setProperty?.("--fill", `${input.value}%`);
    const slider = (label, onInput) => {
      const row = el("label", "vm-theme-slider");
      row.append(el("span", null, label));
      const input = el("input");
      input.type = "range";
      input.min = "0";
      input.max = "100";
      input.addEventListener("input", () => { fill(input); onInput(Number(input.value)); });
      row.append(input);
      return { row, input };
    };
    const intensity = slider("Intensity", (value) => setCurrent({ sat: value }));
    const grain = slider("Grain", (value) => { theme = { ...theme, grain: value, on: true }; save(); });

    const reset = el("button", "vm-theme-reset", "Reset space theme");
    reset.addEventListener("click", () => { theme = { ...DEFAULT }; save(); close(); });

    const sync = () => {
      const list = colors();
      selected = Math.min(selected, list.length - 1);
      pad.replaceChildren(...list.map((c, i) => {
        const dot = el("div", `vm-theme-dot${i === selected ? " selected" : ""}`);
        const p = position(c);
        dot.style.left = `${p.x * 100}%`;
        dot.style.top = `${p.y * 100}%`;
        dot.style.backgroundColor = hsl(c);
        return dot;
      }));
      chips.replaceChildren(...list.map((c, i) => {
        const chip = el("button", `vm-theme-chip${i === selected ? " selected" : ""}`);
        chip.style.backgroundColor = hsl(c);
        chip.title = `Color ${i + 1}`;
        chip.addEventListener("click", () => { selected = i; sync(); });
        return chip;
      }));
      if (list.length < MAX_COLORS) {
        const add = el("button", "vm-theme-chip vm-theme-add", "+");
        add.title = "Add a color (gradient)";
        add.addEventListener("click", addColor);
        chips.append(add);
      }
      if (list.length > 1) {
        const remove = el("button", "vm-theme-remove", "Remove color");
        remove.addEventListener("click", removeColor);
        chips.append(remove);
      }
      intensity.input.value = String(current().sat);
      grain.input.value = String(theme.grain);
      fill(intensity.input);
      fill(grain.input);
    };
    sync();

    pop.append(head, picks, modes, pad, chips, swatches, intensity.row, grain.row, reset);
    shield = el("div", "vm-menu-shield");
    shield.addEventListener?.("mousedown", (e) => { e.preventDefault(); close(); });
    (document.querySelector("#browser") || document.body).append(shield, pop);
    if (!item.name) name.focus();
  };

  const outside = (e) => { if (pop && !pop.contains(e.target)) close(); };
  document.addEventListener("mousedown", outside, true);
  document.addEventListener("focusin", outside, true);
  window.__vm.onShortcut((key) => { if (key === "esc") close(); });
  window.addEventListener("vm-open-theme", open);

  const selectSpace = (id) => {
    if (id === activeSpace) return;
    close();
    const switching = activeSpace !== null && activeSpace !== id;
    activeSpace = id;
    const current = ++revision;
    pending = Promise.all([store.get(keyFor(id), null), store.get("theme", null)]).then(([saved, legacy]) => {
      if (current !== revision) return;
      theme = { ...DEFAULT, ...(saved || legacy || {}) };
      if (switching) fade();
      apply();
    });
  };
  window.addEventListener("vm-active-space-changed", (event) => selectSpace(event.detail));
  if (updates) updates.onmessage = ({ data }) => {
    if (data?.space !== activeSpace || !data.theme) return;
    revision++;
    theme = { ...DEFAULT, ...data.theme };
    close();
    apply();
  };

  window.__vm.onMark(apply);
  if (window.__vm.activeSpace !== undefined) selectSpace(window.__vm.activeSpace);
})();
