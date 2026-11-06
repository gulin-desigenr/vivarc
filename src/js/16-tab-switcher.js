// Vivarc: Vivaldi's Tab Cycler (Ctrl+Tab, list layout) in the command bar's card. The look is CSS (vivarc.css);
// this adds a caption under the preview with the selected tab's title and site, which Vivaldi doesn't show there.
// Vivaldi keeps the cycler's behaviour (order, Ctrl release, mouse); the caption only reads its DOM.
(() => {
  const hostOf = (text) => {
    for (const value of [text, `https://${text}`]) {
      try { return new URL(value).hostname.replace(/^www\./, ""); } catch (_) {}
    }
    return "";
  };

  const attach = (cycler) => {
    if (cycler.querySelector(".vm-ts-caption")) return;
    const caption = document.createElement("div");
    caption.className = "vm-ts-caption";
    const title = document.createElement("div");
    title.className = "vm-ts-title";
    const host = document.createElement("div");
    host.className = "vm-ts-host";
    caption.append(title, host);
    cycler.append(caption);
    const update = () => {
      const row = cycler.querySelector("li.selected");
      const preview = cycler.querySelector("img.visual-list-preview");
      title.textContent = row?.textContent.trim() || "";
      host.textContent = hostOf(preview?.title || "");
    };
    update();
    const observer = new MutationObserver(() => {
      if (!cycler.isConnected) return observer.disconnect();
      update();
    });
    observer.observe(cycler, { subtree: true, attributes: true, attributeFilter: ["class", "src", "title"] });
  };

  const scan = (browser) => {
    const cycler = browser.querySelector(":scope > .modal-tabswitcher .tabswitcher.list");
    if (cycler) attach(cycler);
  };

  let watched = null;
  window.__vm.ready.then((ok) => {
    if (!ok) return;
    window.__vm.onMark((browser) => {
      if (watched === browser) return;
      watched = browser;
      new MutationObserver(() => { scan(browser); requestAnimationFrame(() => scan(browser)); }).observe(browser, { childList: true });
    });
  });
})();
