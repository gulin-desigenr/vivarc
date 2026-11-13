// Vivaldi's panels open on request, never from the window's edge: on macOS that edge is often the Dock's, and an
// auto-hidden panel bar there opened whenever the pointer went for it. Vivarc docks the panels (05-bootstrap.js turns
// their auto-hide off) and hides them; Vivaldi's "Toggle Panel" button in the sidebar's bottom toolbar, its ⌥⌘P, or a
// panel from the command bar brings back the bar with the last panel open, pushing the page aside. Vivaldi keeps the
// bar alone on screen when a panel is closed: here the bar goes with it, and showing the bar alone opens the last
// panel instead. Esc in a panel hides it again.
(() => {
  const DEFAULT = "PanelBookmarks";
  const store = window.__vm.store;
  let last = DEFAULT;
  let shown = null; // "hidden" | "bar" | "panel", as last seen
  let container = null;
  let observer = null;

  const press = (node) => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      const Ctor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
      node.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, view: window, button: 0 }));
    }
  };
  // Docked, the container is "switcher" while hidden, "icons" with only the bar, and "expanded" with a panel open.
  const stateOf = (c) => (!c ? null : c.classList.contains("expanded") ? "panel" : c.classList.contains("switcher") ? "hidden"
    : c.classList.contains("icons") ? "bar" : null);
  const docked = () => !!container && !container.closest(".auto-hide-wrapper");
  // Any of Vivaldi's Toggle Panel buttons does it, the one in the bottom toolbar or a hidden copy in another toolbar.
  const toggle = () => { const b = document.querySelector('[data-name="PanelToggle"]'); if (b) press(b); return !!b; };
  const switchButton = (name) => container?.querySelector(`#switch [data-name="${CSS.escape(name)}"]`);
  const activePanel = () => container?.querySelector("#switch .button-toolbar.active [data-name]")?.dataset.name;

  const update = () => {
    const now = stateOf(container);
    const before = shown;
    shown = now;
    if (!docked() || !now) return;
    if (now === "panel") {
      const name = activePanel();
      if (name && name !== last) { last = name; store.set("lastPanel", name); }
      return;
    }
    if (now !== "bar") return;
    // The bar alone: just shown (from hidden or at start), open the last panel; a panel just closed, hide the bar too.
    if (before === "panel") { toggle(); return; }
    const button = switchButton(last) || switchButton(DEFAULT) || container.querySelector("#switch [data-name^='Panel']");
    if (button) press(button);
  };

  // Opens one panel (its bar name, as PanelHistory), or hides the panels when it is the one already open.
  const open = (name) => {
    const button = switchButton(name);
    if (!button) return false;
    if (stateOf(container) === "panel" && activePanel() === name) toggle();
    else press(button);
    return true;
  };

  const watch = () => {
    const found = document.querySelector("#panels-container");
    if (found === container) return;
    observer?.disconnect();
    container = found;
    shown = null;
    if (!container) return;
    observer = new MutationObserver(update);
    observer.observe(container, { attributes: true, attributeFilter: ["class"] });
    update();
  };

  const onKey = (e) => {
    if (e.key !== "Escape" || e.defaultPrevented || !docked() || stateOf(container) !== "panel") return;
    const target = e.target;
    if (!container.contains(target)) return;
    // Esc first clears a search or ends an edit in the panel, as Vivaldi has it; on an empty field it hides the panel.
    if (target.matches?.("input, textarea") && target.value) return;
    if (target.isContentEditable || container.querySelector(".CustomizePanelPopup")) return;
    if (toggle()) e.preventDefault();
  };

  let queued = false;
  const soon = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; watch(); }); };
  const start = async () => {
    last = (await store.get("lastPanel", DEFAULT)) || DEFAULT;
    watch();
    const browser = document.querySelector("#browser");
    if (browser) new MutationObserver(soon).observe(browser, { childList: true, subtree: true });
    document.addEventListener("keydown", onKey, true);
  };
  window.__vm.panels = { open };
  window.__vm.ready.then((ok) => { if (ok) start(); });
})();
