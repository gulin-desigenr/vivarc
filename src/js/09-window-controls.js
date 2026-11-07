// Arc-style window controls: no title bar; the macOS traffic lights stay in the sidebar's first row.
// With the tab bar on the side and the address bar hidden, Vivaldi puts the traffic lights in a title bar that
// auto-hide only reveals when the pointer reaches the top edge (vivaldi.windowPrivate.setControlButtonsPosition
// "hidden" the rest of the time). The stylesheet hides that title bar (#header) and leaves room in the sidebar's
// first row; this module keeps the native buttons visible there by overriding the position Vivaldi asks for.
(() => {
  const windowPrivate = window.vivaldi?.windowPrivate;
  const original = windowPrivate?.setControlButtonsPosition;
  if (typeof original !== "function" || original.__vmWrapped) return;
  const MODE = "mediumPadding";

  const enabled = () => window.__vm.settings?.get?.("arcWindowControls") !== false;
  const isLittle = () => !!document.querySelector("#browser.vm-little-arc");
  // The sidebar is on screen (not auto-hidden away, not in fullscreen).
  const sidebarShown = () => {
    const browser = document.querySelector("#browser");
    if (!browser || browser.classList.contains("fullscreen")) return false;
    const bar = document.querySelector("#tabs-tabbar-container.left");
    const box = bar?.getBoundingClientRect();
    return !!box && box.width > 0 && box.left <= 1;
  };
  // A hidden sidebar (auto-hide) slides in over the page inside Vivaldi's wrapper. Like Arc, the traffic lights go
  // with it: shown while it is in, hidden while it is away (Vivaldi would otherwise leave them over the page).
  const hiddenBar = () => document.querySelector("#browser.auto-hide:not(.fullscreen) > .auto-hide-wrapper.has-tabbar");
  const choice = (mode) => {
    if (!enabled() || isLittle()) return mode;
    const away = hiddenBar();
    if (away) return away.getBoundingClientRect().left >= 0 ? MODE : "hidden";
    return sidebarShown() ? MODE : mode;
  };
  const wanted = (mode) => choice(mode);

  let asked = null;
  let last = null;
  const wrapped = function (windowId, mode, ...rest) {
    if (windowId === window.vivaldiWindowId) { asked = mode; last = null; }
    const next = windowId === window.vivaldiWindowId ? wanted(mode) : mode;
    return original.call(this, windowId, next, ...rest);
  };
  wrapped.__vmWrapped = true;
  try { windowPrivate.setControlButtonsPosition = wrapped; } catch (_) { return; }

  // Vivaldi does not always go through the wrapper above (some of its calls hold their own reference), so the
  // position is also re-asserted after everything that makes it hide the buttons: focus changes, the pointer
  // reaching or leaving the top edge, resizes, and a slow heartbeat for anything missed.
  const sync = () => {
    if (window.vivaldiWindowId == null) return;
    const decided = enabled() && !isLittle() && (hiddenBar() || sidebarShown()) ? choice(asked) : null;
    // Only ever hand back what Vivaldi asked for; with nothing asked yet, leave its own choice alone.
    if (decided == null && asked == null) return;
    const mode = decided ?? asked;
    if (mode !== MODE && mode === last) return;
    last = mode;
    try { original.call(windowPrivate, window.vivaldiWindowId, mode); } catch (_) {}
  };
  const soon = () => { for (const delay of [0, 150, 400]) setTimeout(sync, delay); };
  for (const ev of ["focus", "blur", "resize", "mouseleave"]) window.addEventListener(ev, soon);
  let nearTop = false;
  window.addEventListener("mousemove", (e) => {
    const near = e.clientY < 12;
    if (near !== nearTop) { nearTop = near; soon(); }
  }, { passive: true });
  // The hidden sidebar sliding in or out (hover, Ctrl+S) ends with a transform transition.
  document.addEventListener("transitionend", (e) => { if (e.target?.classList?.contains("auto-hide-wrapper")) soon(); }, true);
  window.addEventListener("vm-sidebar-peek", soon);
  const resized = new ResizeObserver(() => { last = null; sync(); });
  const observe = (browser) => {
    browser.classList.toggle("vm-arc-controls", enabled());
    resized.disconnect();
    resized.observe(browser);
    sync();
  };
  window.__vm.onMark(observe);
  window.__vm.settings?.onChange?.(() => {
    document.querySelector("#browser")?.classList.toggle("vm-arc-controls", enabled());
    last = null;
    sync();
  });
  setInterval(sync, 2000);
})();
