// Vivaldi's panels push the page aside while one is open. Vivarc sets the panel bar to auto-hide, and Vivaldi then
// shows the bar and an open panel over the page, in a fixed wrapper at the window's edge. While a panel is open
// there, --vm-panels-push on #browser carries the wrapper's width and the page's margin makes room for it
// (21-panels.css), with a transition so the page slides aside as the panel opens. A panel docked by Vivaldi
// itself (auto-hide off) already takes its room, and the bar alone, revealed by the pointer, still floats over.
(() => {
  const GAP = 2; // with the page's own 4px margin: 6px between the page and the panel, as between sidebar and page
  let container = null;
  let wrapper = null;
  const observers = [];

  // Vivaldi grows the container to its width (min(400px, 65vw), or what you dragged it to) in a short transition.
  // The page goes straight for that width, so the two slide together instead of the page chasing every frame.
  const targetWidth = () => {
    const wanted = container.style.width;
    if (!wanted) return Math.round(container.getBoundingClientRect().width);
    const probe = document.createElement("div");
    probe.style.cssText = `position:fixed;visibility:hidden;pointer-events:none;height:0;width:${wanted}`;
    document.body.append(probe);
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    return Math.round(width || container.getBoundingClientRect().width);
  };

  const update = () => {
    const browser = document.querySelector("#browser");
    if (!browser) return;
    const open = !!container?.isConnected && container.classList.contains("expanded") && !!wrapper?.classList.contains("show");
    const width = open ? targetWidth() : 0;
    browser.style.setProperty("--vm-panels-push", open && width > 0 ? `${width + GAP}px` : "0px");
  };

  const watch = () => {
    const found = document.querySelector("#panels-container");
    const holder = found?.closest(".auto-hide-wrapper") || null;
    if (found === container && holder === wrapper) return update();
    observers.splice(0).forEach((o) => o.disconnect());
    container = found;
    wrapper = holder;
    if (container) {
      const attrs = new MutationObserver(update);
      attrs.observe(container, { attributes: true, attributeFilter: ["class", "style"] });
      observers.push(attrs);
      if (typeof ResizeObserver === "function") {
        const size = new ResizeObserver(update);
        size.observe(container);
        observers.push(size);
      }
    }
    if (wrapper) {
      const shown = new MutationObserver(update);
      shown.observe(wrapper, { attributes: true, attributeFilter: ["class"] });
      observers.push(shown);
    }
    update();
  };

  // Vivaldi rebuilds the panel area when its settings change (auto-hide on or off, the bar moved): find it again,
  // once per frame at most.
  let queued = false;
  const soon = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; watch(); }); };
  const start = () => {
    watch();
    const browser = document.querySelector("#browser");
    if (browser) new MutationObserver(soon).observe(browser, { childList: true, subtree: true });
  };
  window.__vm.ready.then((ok) => { if (ok) start(); });
})();
