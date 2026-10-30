// Group a Peek's promoted tab with its owning tab using Vivaldi's native tab stacks.
(() => {
  const tabsByPeek = new Map();
  const tabData = (tab) => { try { return JSON.parse(tab?.vivExtData || "{}"); } catch (_) { return {}; } };
  const get = async (id) => { try { return await chrome.tabs.get(id); } catch (_) { return null; } };
  const group = async (sourceId, promotedId) => {
    if (!sourceId || !promotedId || sourceId === promotedId || !vivaldi?.tabsPrivate?.move) return false;
    const [source, promoted] = await Promise.all([get(sourceId), get(promotedId)]);
    if (!source || !promoted || source.windowId !== promoted.windowId || source.pinned !== promoted.pinned) return false;
    const sourceData = tabData(source), promotedData = tabData(promoted);
    if ((sourceData.workspaceId || 0) !== (promotedData.workspaceId || 0)) return false;
    // Never take a tab out of an unrelated existing stack.
    if (promotedData.group && promotedData.group !== sourceData.group) return false;
    if (sourceData.group && sourceData.group === promotedData.group) return true;
    const move = sourceData.group
      ? { tabIds: [promotedId], target: sourceData.ext_id || sourceId, windowId: source.windowId,
          tweaks: ["target-is-tab", "into", "do-not-reparent"], workspaceId: sourceData.workspaceId || 0 }
      : { tabIds: [sourceId, promotedId], target: sourceId, windowId: source.windowId,
          tweaks: ["do-not-reparent", "create-new-group", "target-is-tab"], workspaceId: sourceData.workspaceId || 0 };
    try {
      const result = await vivaldi.tabsPrivate.move({ ...move, debug: "Vivarc.peekStack" });
      const [afterSource, afterPromoted] = await Promise.all([get(sourceId), get(promotedId)]);
      const sourceGroup = tabData(afterSource).group;
      const success = result?.success !== false && !!sourceGroup && sourceGroup === tabData(afterPromoted).group;
      if (success) window.dispatchEvent(new CustomEvent("vm-refresh-sidebar"));
      return success;
    } catch (error) {
      console.warn("[vivarc] Could not group promoted Peek:", error);
      return false;
    }
  };
  const install = () => {
    const peek = window.ArcPeekDebug;
    if (!peek) return false;
    if (peek.__vivarcPeekGroups) return true;
    if (typeof peek.openNewTab !== "function" || typeof peek.ensureParallelTab !== "function" || typeof peek.createParallelTab !== "function") return false;
    const ensure = peek.ensureParallelTab.bind(peek);
    const preload = peek.createParallelTab.bind(peek);
    const open = peek.openNewTab.bind(peek);
    peek.createParallelTab = async (id, url) => {
      const result = await preload(id, url);
      window.dispatchEvent(new CustomEvent("vm-refresh-sidebar"));
      return result;
    };
    peek.ensureParallelTab = async (id, options) => {
      const result = await ensure(id, options);
      if (result?.tab?.id) tabsByPeek.set(id, result.tab.id);
      return result;
    };
    peek.openNewTab = async (id, active) => {
      const data = peek.webviews.get(id);
      const sourceId = peek.getOwningTabId(data);
      const parallelId = data?.parallelTabId;
      tabsByPeek.delete(id);
      try {
        await open(id, active);
        // A preloaded parallel tab may have been promoted directly in background mode.
        const promotedId = tabsByPeek.get(id) || parallelId;
        if (promotedId && !peek.webviews.has(id)) {
          const ok = await group(sourceId, promotedId);
          if (!ok) window.dispatchEvent(new CustomEvent("vm-toast", { detail: "Opened the tab, but could not group it with its source." }));
        }
      } finally { tabsByPeek.delete(id); }
    };
    peek.__vivarcPeekGroups = true;
    return true;
  };
  if (install()) return;
  let attempts = 0;
  const timer = setInterval(() => { if (install() || ++attempts >= 100) clearInterval(timer); }, 100);
})();
