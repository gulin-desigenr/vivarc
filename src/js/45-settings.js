// Vivarc settings window (designed in Figma, GULIN.CO APPs, "Vivarc Settings / Proposta"): a side list of sections
// and, on the right, the settings of every section in cards, each row a name, a short line and its control
// (see 01-settings.js for the settings themselves). Clicking a section scrolls to it; scrolling marks the section
// in view.
(() => {
  const { settings } = window.__vm;
  let overlay = null;
  let unsubs = [];

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  };
  const ICONS = {
    appearance: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="6.5"/><path d="M10 3.5a6.5 6.5 0 0 1 0 13z" fill="currentColor"/></svg>',
    sidebar: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="14" height="12" rx="2.5"/><path d="M8 4v12"/></svg>',
    command: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="9" cy="9" r="5"/><path d="m13 13 3.5 3.5"/></svg>',
    tabs: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3.5" y="5.5" width="13" height="10" rx="2"/><path d="M6 3.5h8"/></svg>',
    little: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="6" width="10" height="8" rx="2"/><path d="M3 3l3 3M17 3l-3 3"/></svg>',
  };
  const CHEVRON = '<svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m3 4.5 3 3 3-3"/></svg>';

  const close = () => { overlay?.remove(); overlay = null; unsubs.forEach((off) => off()); unsubs = []; };

  const texts = (item) => {
    const text = el("div", "vm-set-text");
    text.append(el("div", "vm-set-label", item.label));
    if (item.hint) text.append(el("div", "vm-set-hint", item.hint));
    return text;
  };

  // A range belongs to the setting above it (Glass opacity under Liquid glass): an indented row, dimmed while that
  // setting is off.
  const rangeRow = (item) => {
    const line = el("div", "vm-set-row vm-set-range");
    const text = el("div", "vm-set-text");
    const value = el("span", "vm-set-value");
    const label = el("div", "vm-set-label", item.label);
    label.append(value);
    text.append(label);
    const slider = el("input", "vm-set-slider");
    slider.type = "range";
    slider.min = String(item.min);
    slider.max = String(item.max);
    slider.step = String(item.step);
    const control = el("div", "vm-set-range-control");
    control.append(el("span", "vm-set-end", item.low), slider, el("span", "vm-set-end", item.high));
    const show = () => {
      value.textContent = `${slider.value}${item.unit || ""}`;
      slider.style.setProperty("--fill", `${((slider.value - item.min) / (item.max - item.min)) * 100}%`);
    };
    const sync = () => {
      slider.value = String(settings.get(item.key));
      slider.disabled = !!item.needs && !settings.get(item.needs);
      line.classList.toggle("dim", slider.disabled);
      show();
    };
    slider.addEventListener("input", () => { settings.set(item.key, Number(slider.value)); show(); });
    unsubs.push(settings.onChange(sync));
    line.append(text, control);
    sync();
    return line;
  };

  const choiceRow = (item) => {
    const line = el("label", "vm-set-row");
    const pop = el("span", "vm-set-pop");
    const select = el("select", "vm-set-select");
    for (const [value, label] of item.options) {
      const option = el("option", null, label);
      option.value = String(value);
      select.append(option);
    }
    select.value = String(settings.get(item.key));
    const chevron = el("span", "vm-set-chevron");
    chevron.innerHTML = CHEVRON;
    select.addEventListener("change", () => settings.set(item.key, Number(select.value)));
    pop.append(select, chevron);
    line.append(texts(item), pop);
    return line;
  };

  const switchRow = (item) => {
    const line = el("label", "vm-set-row");
    const box = el("input", "vm-set-switch");
    box.type = "checkbox";
    const sync = () => { box.checked = !!settings.get(item.key); };
    box.addEventListener("change", () => settings.set(item.key, box.checked));
    unsubs.push(settings.onChange(sync));
    sync();
    line.append(texts(item), box);
    return line;
  };

  const row = (item) => (item.type === "range" ? rangeRow(item) : item.type === "choice" ? choiceRow(item) : switchRow(item));

  // One page per section: the sidebar switches pages instead of scrolling one long list to an anchor.
  const page = (id) => {
    const card = el("div", "vm-set-group");
    settings.SCHEMA.filter((s) => s.group === id).forEach((s) => card.append(row(s)));
    return card;
  };
  let current = null; // the page shown, kept between openings

  const open = () => {
    if (!window.__vm.cssLoaded) return;
    if (overlay) return close();
    overlay = el("div", "vm-set-overlay");
    const win = el("div", "vm-set-win");
    win.setAttribute("role", "dialog");
    win.setAttribute("aria-label", "Vivarc Settings");

    const side = el("nav", "vm-set-side");
    const brand = el("div", "vm-set-brand");
    brand.append(el("span", "vm-set-logo"), el("span", null, "Vivarc"));
    const nav = el("div", "vm-set-nav");
    side.append(brand, nav, el("div", "vm-set-side-foot", "Saved for this profile."));

    const main = el("div", "vm-set-main");
    const top = el("div", "vm-set-top");
    const x = el("button", "vm-set-close", "×");
    x.setAttribute("aria-label", "Close");
    x.addEventListener("click", close);
    top.append(el("h1", "vm-set-title", "Settings"), x);
    const scroll = el("div", "vm-set-scroll");
    const bottom = el("div", "vm-set-bottom");
    const reset = el("button", "vm-set-reset", "Reset to defaults");
    bottom.append(el("span", null, "Changes apply right away."), reset);
    main.append(top, scroll, bottom);

    const title = top.querySelector(".vm-set-title");
    const items = settings.GROUPS.map(([id, name]) => {
      const item = el("button", "vm-set-nav-item");
      item.dataset.group = id;
      const icon = el("span", "vm-set-nav-icon");
      icon.innerHTML = ICONS[id] || "";
      item.append(icon, el("span", null, name));
      item.addEventListener("click", () => show(id));
      return item;
    });
    nav.append(...items);
    const show = (id) => {
      const known = settings.GROUPS.find(([g]) => g === id) || settings.GROUPS[0];
      current = known[0];
      items.forEach((i) => i.classList.toggle("selected", i.dataset.group === current));
      title.textContent = known[1];
      unsubs.forEach((off) => off());
      unsubs = [];
      scroll.replaceChildren(page(current));
      scroll.scrollTop = 0;
    };
    const fill = () => show(current);
    reset.addEventListener("click", () => { settings.reset(); fill(); });

    win.append(side, main);
    overlay.append(win);
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
    (document.querySelector("#browser") || document.body).append(overlay);
    fill();
  };

  window.__vm.onShortcut((key) => { if (key === "esc") close(); });
  window.addEventListener("vm-open-settings", open);
})();
