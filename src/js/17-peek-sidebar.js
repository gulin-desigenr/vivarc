// Vivarc: hold Ctrl+S to show the hidden (auto-hide) sidebar where it slides in on hover, without pinning it open;
// letting go hides it again. Cmd+S still pins it open or hides it, and hovering the edge still works.
// Vivaldi reports key presses (and their auto-repeats while held) but never the release, so "held" means presses
// keep coming: the first press shows the sidebar for a moment, each repeat extends it, and when the repeats stop
// (or a key-up reaches the window, or it loses focus) it hides, unless the pointer is on it: then it stays until the
// pointer leaves, so a tab can be clicked after letting go.
(() => {
  const KEY = "ctrl+s";
  const FIRST = 800; // longer than macOS's delay before a held key starts repeating
  const REPEAT = 200; // a little more than the gap between repeats
  let style = null;
  let timer = 0;

  const hidden = () => !!document.querySelector("#browser.auto-hide > .auto-hide-wrapper.has-tabbar");
  // Vivaldi slides the wrapper in with its .show class (React-owned); a rule of ours does the same so a re-render
  // cannot undo it.
  const show = () => {
    if (style) return;
    style = document.createElement("style");
    style.id = "vm-peek-sidebar";
    style.textContent = "#browser.auto-hide > .auto-hide-wrapper.has-tabbar { transform: none !important; pointer-events: auto; touch-action: auto; }";
    document.head.append(style);
    window.dispatchEvent(new CustomEvent("vm-sidebar-peek"));
  };
  // Letting go while the pointer is on the sidebar keeps it open until the pointer leaves, as with hovering, so you
  // can let go of the keys and click a tab (a click with Control held is a right-click on macOS).
  const wrapper = () => document.querySelector("#browser.auto-hide > .auto-hide-wrapper.has-tabbar");
  const drop = () => {
    clearTimeout(timer);
    if (!style) return;
    style.remove();
    style = null;
    window.dispatchEvent(new CustomEvent("vm-sidebar-peek"));
  };
  const hide = () => {
    clearTimeout(timer);
    const box = wrapper();
    if (style && box?.matches(":hover")) {
      box.addEventListener("mouseleave", () => { if (!holding) drop(); }, { once: true });
      return;
    }
    drop();
  };
  let holding = false;

  window.__vm.ready.then((ok) => {
    if (!ok) return;
    try {
      vivaldi.tabsPrivate.onKeyboardShortcut.addListener((windowId, combo, repeat) => {
        if (windowId !== window.vivaldiWindowId || window.__vm.normalise(combo) !== KEY) return;
        if (!style && !hidden()) return;
        show();
        holding = true;
        clearTimeout(timer);
        timer = setTimeout(() => { holding = false; hide(); }, repeat ? REPEAT : FIRST);
      });
    } catch (e) {
      console.warn("[vivarc] peek sidebar unavailable:", e);
    }
    document.addEventListener("keyup", (e) => { if (style && (e.key === "Control" || e.key.toLowerCase() === "s")) { holding = false; hide(); } }, true);
    window.addEventListener("blur", () => { holding = false; drop(); });
  });
})();
