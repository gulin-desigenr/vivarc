// Peek's AI summary feature is not used by Vivarc; these stubs keep the mod from throwing.
window.VividAI = {
  loadConfig: () => Promise.resolve({}),
  applyConfig: () => {},
  streamChat: () => Promise.reject(new Error("AI disabled")),
};
window.VividMarkdown = { render: (text) => text };

// Peek opens only with Option+click on a link. Its own defaults also open it on any plain click in a Google site
// (so Gmail's account menu, a link, became a Peek) and in pinned tabs, and on holding the middle button.
// Peek reads its triggers from a config event; this sends that event the moment Peek starts (it sets
// window.ArcPeekDebug in its constructor, after its listener is up and before it injects into any page).
(() => {
  const TRIGGERS = { clickOpenModifiers: ["alt"], longPressButtons: [], autoOpenList: [] };
  let peek;
  Object.defineProperty(window, "ArcPeekDebug", {
    configurable: true,
    get: () => peek,
    set: (value) => {
      const first = !peek && value;
      peek = value;
      if (first) window.dispatchEvent(new CustomEvent("vivaldi-mod-config-updated", { detail: { mods: { arcPeek: TRIGGERS } } }));
    },
  });
})();
