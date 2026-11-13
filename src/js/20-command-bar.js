// Vivarc command bar. Opens whenever a blank new tab is created (Cmd+T bound to "New Tab",
// the sidebar "+ New Tab" row). The blank tab is navigated to the choice, or closed on Escape.
(() => {
  const BLANK = /^(chrome|vivaldi):\/\/(newtab|vivaldi-webui\/startpage)/;
  const isBlank = (tab) => BLANK.test(tab.pendingUrl || tab.url || "");
  const startedAt = Date.now();

  const DEFAULT = {
    name: "DuckDuckGo",
    url: "https://duckduckgo.com/?q={searchTerms}",
    suggest: "https://duckduckgo.com/ac/?q={searchTerms}&type=list",
  };
  // Built-in search shortcuts (keyword + Tab). Engines from the user's Vivaldi settings win on a clash.
  const SEED = [
    ["az", "Amazon", "https://www.amazon.com/s?k={searchTerms}"],
    ["b", "Bing", "https://www.bing.com/search?q={searchTerms}"],
    ["d", "DuckDuckGo", "https://duckduckgo.com/?q={searchTerms}"],
    ["g", "Google", "https://www.google.com/search?q={searchTerms}"],
    ["gc", "Calendar", "https://calendar.google.com/calendar/u/0/r/search?q={searchTerms}"],
    ["gd", "Drive", "https://drive.google.com/drive/search?q={searchTerms}"],
    ["gh", "GitHub", "https://github.com/search?q={searchTerms}"],
    ["gm", "Gmail", "https://mail.google.com/mail/u/0/#search/{searchTerms}"],
    ["li", "LinkedIn", "https://www.linkedin.com/search/results/all/?keywords={searchTerms}"],
    ["m", "Maps", "https://www.google.com/maps/search/{searchTerms}"],
    ["mdn", "MDN", "https://developer.mozilla.org/en-US/search?q={searchTerms}"],
    ["npm", "npm", "https://www.npmjs.com/search?q={searchTerms}"],
    ["r", "Reddit", "https://www.reddit.com/search/?q={searchTerms}"],
    ["so", "Stack Overflow", "https://stackoverflow.com/search?q={searchTerms}"],
    ["tr", "Translate", "https://translate.google.com/?sl=auto&text={searchTerms}&op=translate"],
    ["w", "Wikipedia", "https://en.wikipedia.org/wiki/Special:Search?search={searchTerms}"],
    ["x", "X", "https://x.com/search?q={searchTerms}"],
    ["yt", "YouTube", "https://www.youtube.com/results?search_query={searchTerms}"],
  ].map(([keyword, name, url]) => ({ keyword, name, url }));
  const CHIP_COLORS = {
    yt: "#ff0000", g: "#4285f4", d: "#de5833", r: "#ff4500", gh: "#24292f", m: "#188038", w: "#636466",
    gm: "#ea4335", gd: "#188038", gc: "#4285f4", li: "#0a66c2", x: "#111111", so: "#f48024", npm: "#cb3837", mdn: "#1b1b1b",
  };

  let engines = SEED;
  (async () => {
    try {
      const reply = await vivaldi.searchEngines.getTemplateUrls();
      const list = (reply.templateUrls || reply)
        .filter((t) => t.keyword && t.url && !t.keyword.startsWith("@"))
        .map((t) => ({ keyword: t.keyword, name: t.name,
          url: t.url.replace(/\{google:baseURL\}/g, "https://www.google.com/").replace(/\{(?!searchTerms\})[^}]*\}/g, "") }));
      const taken = new Set(list.map((t) => t.keyword.toLowerCase()));
      engines = [...list, ...SEED.filter((e) => !taken.has(e.keyword))];
    } catch (_) {}
  })();

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  };
  const SEARCH_SVG =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4-4"/></svg>';

  const hostOf = (url) => {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch (_) { return ""; }
  };
  // A site's base address: mail.google.com and google.com are one site.
  const siteOf = (host) => {
    const parts = String(host || "").split(".").filter(Boolean);
    if (parts.length < 2) return host || "";
    const n = parts.length > 2 && /^(com|co|org|net|gov|edu|ac)$/.test(parts[parts.length - 2]) && parts[parts.length - 1].length === 2 ? 3 : 2;
    return parts.slice(-n).join(".");
  };
  const looksLikeUrl = (text) =>
    /^(https?:\/\/|chrome:\/\/|vivaldi:\/\/)/i.test(text) || (/^[^\s]+\.[a-z]{2,}(\/\S*)?$/i.test(text) && !text.includes(" "));
  const toUrl = (text) => (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  const engineUrl = (engine, query) => engine.url.replace(/\{searchTerms\}|%s/, encodeURIComponent(query));

  const toast = (message) => window.dispatchEvent(new CustomEvent("vm-toast", { detail: message }));
  const openPage = (url) => chrome.tabs.create({ url });
  const press = (node) => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      const Ctor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
      node.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, view: window, button: 0 }));
    }
  };
  const findDownloadsButton = () => {
    const host = document.querySelector('[data-name="PanelDownloads"]');
    if (host) return host.querySelector("button") || host;
    return [...document.querySelectorAll("#browser button, #browser [role=button]")]
      .find((n) => /download|téléchar/i.test(`${n.title} ${n.getAttribute("aria-label") || ""} ${n.className}`));
  };
  const openDownloads = () => {
    const button = findDownloadsButton();
    if (button) press(button);
    else chrome.downloads?.showDefaultFolder?.();
  };
  const openPanel = (name) => { if (!window.__vm.panels?.open(name)) toast("That panel is not in Vivaldi's panel bar."); };
  const togglePanels = () => {
    const button = document.querySelector('[data-name="PanelToggle"]');
    if (button) press(button);
    else toast("Vivaldi's Toggle Panel button is missing. Use ⌥⌘P.");
  };
  const setExtData = async (tab, patch) => {
    const fresh = await chrome.tabs.get(tab.id);
    let ext = {};
    try { ext = JSON.parse(fresh.vivExtData || "{}"); } catch (_) {}
    // Vivaldi merges vivExtData into what the tab has, so a key left out stays; null is what removes it.
    const cleared = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v === undefined ? null : v]));
    await chrome.tabs.update(tab.id, { vivExtData: JSON.stringify({ ...ext, ...cleared }) });
  };
  // Split view like Arc's: the page behind the bar and a new tab form a fresh Vivaldi tile group. "row" puts them
  // side by side, "column" one above the other (measured from the rendered panes in Vivaldi 8.2). If the page was
  // already in a group it leaves it. Vivaldi only honours the layout when every tile gets its data at once, so both
  // tabs are written together and once more shortly after. The new tab opens the command bar for its address.
  const splitView = async (tab, layout) => {
    const fresh = await chrome.tabs.get(tab.id);
    const previous = window.__vm.tilingOf(fresh);
    const others = previous
      ? (await chrome.tabs.query({ currentWindow: true })).filter((t) => t.id !== fresh.id && window.__vm.tilingOf(t)?.id === previous.id)
      : [];
    const created = await chrome.tabs.create({ active: true, index: fresh.index + 1 });
    const id = crypto.randomUUID();
    const write = () => Promise.all([fresh, created].map((t, index) =>
      setExtData(t, { tiling: { id, layout, type: "selection", index } })));
    await write();
    setTimeout(() => write().catch(() => {}), 400);
    if (others.length === 1) await setExtData(others[0], { tiling: undefined });
    else await Promise.all(others.map((t, index) => setExtData(t, { tiling: { ...window.__vm.tilingOf(t), index } })));
  };
  // Selected tabs (2 to 4) from the sidebar become one tile group, side by side, leaving any group they were in;
  // a group left with a single tab is dissolved. The first selected tab is activated so the split shows.
  const splitTabs = async (tabs, layout = "row") => {
    const fresh = await Promise.all(tabs.map((t) => chrome.tabs.get(t.id)));
    const ids = new Set(fresh.map((t) => t.id));
    const left = new Set(fresh.map((t) => window.__vm.tilingOf(t)?.id).filter(Boolean));
    const id = crypto.randomUUID();
    const write = () => Promise.all(fresh.map((t, index) => setExtData(t, { tiling: { id, layout, type: "selection", index } })));
    await write();
    setTimeout(() => write().catch(() => {}), 400);
    const all = await chrome.tabs.query({ currentWindow: true });
    for (const old of left) {
      const rest = all.filter((t) => !ids.has(t.id) && window.__vm.tilingOf(t)?.id === old);
      if (rest.length === 1) await setExtData(rest[0], { tiling: undefined });
      else await Promise.all(rest.map((t, index) => setExtData(t, { tiling: { ...window.__vm.tilingOf(t), index } })));
    }
    await chrome.tabs.update(fresh[0].id, { active: true });
  };
  window.__vm.splitTabs = splitTabs;
  window.__vm.closeSplitView = (tab) => closeSplitView(tab);
  const closeSplitView = async (tab) => {
    const id = window.__vm.tilingOf(tab)?.id;
    const peers = (await chrome.tabs.query({ currentWindow: true })).filter((t) => window.__vm.tilingOf(t)?.id === id);
    await Promise.all(peers.map((t) => setExtData(t, { tiling: undefined })));
  };

  // Quick actions, matched against what is typed. `tab` actions apply to the page behind the bar.
  const ACTIONS = [
    { label: "View History", words: "history visited", run: () => openPage("vivaldi://history") },
    { label: "View Downloads", words: "downloads files", run: openDownloads },
    { label: "View Bookmarks", words: "bookmarks saved", run: () => openPage("vivaldi://bookmarks") },
    // Vivaldi's panels, beside the page (18-panels.js); run again on the open one, it hides the panels.
    { label: "Bookmarks Panel", words: "bookmarks panel sidebar", run: () => openPanel("PanelBookmarks") },
    { label: "History Panel", words: "history panel visited", run: () => openPanel("PanelHistory") },
    { label: "Notes Panel", words: "notes panel write", run: () => openPanel("PanelNotes") },
    { label: "Window Panel", words: "window panel tabs all", run: () => openPanel("PanelWindow") },
    { label: "Show / Hide Panels", words: "panels toggle panel bar right", run: () => togglePanels() },
    { label: "Vivaldi Settings", words: "open settings preferences options browser", run: () => openPage("vivaldi://settings") },
    { label: "Create New Space", words: "space workspace new create add", run: () => (window.__vm.promptNewSpace ? window.__vm.promptNewSpace() : toast(window.__vm.workspaces.CREATE_HINT)) },
    { label: "Manage Extensions", words: "extensions addons", run: () => openPage("vivaldi://extensions") },
    { label: "Pin This Tab", words: "pin bookmark", tab: true, run: async (tab) => {
      if (await window.__vm.pinTab?.(tab, "Pinned")) toast("Pinned Tab");
    } },
    { label: "Add This Tab to Favorites", words: "favorite pin", tab: true, run: async (tab) => {
      if (await window.__vm.pinTab?.(tab, "Favorites")) toast("Added to Favorites");
    } },
    { label: "Copy Current URL", words: "copy link address share", tab: true, run: async (tab) => {
      await navigator.clipboard?.writeText(tab.url).catch(() => {});
      toast("Copied Current URL");
    } },
    { label: "Split View: Side by Side", words: "split tile vertical columns", tab: true, run: (tab) => splitView(tab, "row") },
    { label: "Split View: Top and Bottom", words: "split tile horizontal rows", tab: true, run: (tab) => splitView(tab, "column") },
    { label: "Close Split View", words: "unsplit untile split", tab: true, when: (tab) => !!window.__vm.tilingOf(tab), run: closeSplitView },
    { label: "Duplicate Tab", words: "clone copy", tab: true, run: (tab) => chrome.tabs.duplicate(tab.id) },
    { label: "Mute / Unmute Tab", words: "sound audio silence", tab: true, run: (tab) =>
      chrome.tabs.update(tab.id, { muted: !tab.mutedInfo?.muted }) },
    { label: "Close Tab", words: "quit remove", tab: true, run: (tab) => chrome.tabs.remove(tab.id) },
    { label: "Move Tab to Space…", words: "move space workspace send", tab: true, stay: true, when: () => (window.__vm.spaceList?.() || []).length > 1,
      run: (tab) => setMode(moveToSpacePicker(tab)) },
    { label: "Switch to Space…", words: "space workspace go switch", stay: true, when: () => (window.__vm.spaceList?.() || []).length > 1,
      run: () => setMode(spacePicker()) },
    { label: "Pin Tab to Folder…", words: "pin folder bookmark save", tab: true, stay: true, when: () => (window.__vm.pinFolders?.() || []).length > 0,
      run: (tab) => setMode(folderPicker(tab)) },
    { label: "Rename Tab…", words: "rename title name label", tab: true, stay: true, run: async (tab) => setMode(await renamePicker(tab)) },
    { label: "Back to Pinned Page", words: "pinned original reset home restore url", tab: true,
      when: (tab) => { const home = window.__vm.pins?.homeOf(tab); return !!home && !!window.__vm.pins.away(tab, home); },
      run: (tab) => chrome.tabs.update(tab.id, { url: window.__vm.pins.homeOf(tab) }) },
    { label: "Tidy Tabs", words: "tidy organize group sort stacks clean arrange", run: () => window.__vm.tidyTabs?.() },
    { label: "Archive Tab", words: "archive clear close save later", tab: true, run: (tab) => window.__vm.archive?.archiveTabs([tab]) },
    { label: "View Archived Tabs", words: "archive archived restore history closed", stay: true, run: () => setMode(ARCHIVE) },
    { label: "Reopen Closed Tab", words: "restore undo", run: () => chrome.sessions.restore() },
    { label: "New Window", words: "open window", run: () => chrome.windows.create({}) },
    { label: "New Little Vivarc", words: "little arc vivarc temporary popup window quick search", run: () => window.__vm.openLittleArc?.() },
    { label: "Open Page in Little Vivarc", words: "little arc vivarc temporary popup window", tab: true, run: (tab) => window.__vm.openLittleArc?.(tab) },
    { label: "New Private Window", words: "incognito private", run: () => chrome.windows.create({ incognito: true }) },
    { label: "Vivarc Guide", words: "welcome help shortcuts tour start", run: () => {
      const url = window.__vm.config.startUrl;
      if (url) openPage(url);
    } },
    { label: "Collapse All Folders", words: "close fold folders pinned sidebar", run: () => {
      window.dispatchEvent(new CustomEvent("vm-folders", { detail: "collapse" }));
      toast("Collapsed all folders");
    } },
    { label: "Expand All Folders", words: "open unfold folders pinned sidebar", run: () => {
      window.dispatchEvent(new CustomEvent("vm-folders", { detail: "expand" }));
      toast("Expanded all folders");
    } },
    { label: "Export Vivarc Backup", words: "backup export save settings themes file", run: () => window.__vm.backup?.exportFile()
      .catch((e) => { console.warn("[vivarc] export:", e); toast("Could not export the backup"); }) },
    { label: "Back Up Vivarc Now", words: "backup save settings themes", run: () => window.__vm.backup?.saveToHelper()
      .then(() => toast("Saved a Vivarc backup in ~/.vivarc/backups"), () => toast("Could not save the backup")) },
    { label: "Restore Vivarc Backup…", words: "backup restore import settings themes", stay: true, run: async () => setMode(await backupPicker()) },
    { label: "Vivarc Settings", words: "preferences options configure features toggle glass", run: () => window.dispatchEvent(new CustomEvent("vm-open-settings")) },
    { label: "Check Vivarc", words: "doctor diagnose health broken vivaldi update compatibility problems", run: () => window.__vm.doctor?.show() },
    { label: "Edit Space",words: "theme color gradient appearance sidebar rename name emoji icon", run: () => window.dispatchEvent(new CustomEvent("vm-open-theme")) },
  ];
  const ACTION_SVG =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/></svg>';
  // Each command has its own icon and, when Vivaldi has one, its keyboard shortcut (read from Vivaldi's own
  // shortcut settings, so a shortcut you changed shows as you set it), like Arc's command bar.
  const svg = (paths) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  const GLYPHS = {
    history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    bookmark: '<path d="M7 4h10v16l-5-4-5 4z"/>',
    notes: '<rect x="5" y="3.5" width="14" height="17" rx="2.5"/><path d="M8.5 9h7M8.5 12.5h7M8.5 16h4"/>',
    panel: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M15 5v14"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M2.5 12h3M18.5 12h3M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1"/>',
    plus: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/>',
    puzzle: '<path d="M10 4a2 2 0 1 1 4 0v2h4v4h-2a2 2 0 1 0 0 4h2v4h-4v-2a2 2 0 1 0-4 0v2H6v-4h2a2 2 0 1 0 0-4H6V6h4z"/>',
    pin: '<path d="M9 4h6l-1 5 3 3v2H7v-2l3-3zM12 14v6"/>',
    star: '<path d="m12 4 2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.5-.8z"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    splitV: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 5v14"/>',
    splitH: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 12h18"/>',
    unsplit: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m9 10 6 4M15 10l-6 4"/>',
    duplicate: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    speaker: '<path d="M4 10v4h4l5 4V6l-5 4z"/><path d="M16.5 9a4 4 0 0 1 0 6"/>',
    close: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
    move: '<rect x="3" y="5" width="12" height="14" rx="2"/><path d="M15 12h6M18 9l3 3-3 3"/>',
    spaces: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    folder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.4a2 2 0 0 1 1.5.7L12 7.5h6.5A2.5 2.5 0 0 1 21 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>',
    pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    tidy: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
    archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10h14V9M10 13h4"/>',
    reopen: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    window: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18"/>',
    little: '<rect x="6" y="7" width="12" height="10" rx="2"/><path d="M6 10.5h12"/>',
    private: '<path d="M3 12s3-6 9-6 9 6 9 6-3 6-9 6-9-6-9-6z"/><path d="m4 4 16 16"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01"/>',
    collapse: '<path d="m7 20 5-5 5 5M7 4l5 5 5-5"/>',
    expand: '<path d="m7 15 5 5 5-5M7 9l5-5 5 5"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>',
    save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
    sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.5-.8 1.5-1.5 0-1.3-1-1.5-1-2.5 0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4-4-7.5-9-7.5z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7" r="1"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4-4"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  };
  // label: [icon, Vivaldi command whose shortcut is shown]
  const ACTION_LOOK = {
    "View History": ["history", "COMMAND_SHOW_HISTORY"], "View Downloads": ["download", "COMMAND_SHOW_DOWNLOADS_PANEL"],
    "View Bookmarks": ["bookmark", "COMMAND_SHOW_BOOKMARKS"], "Bookmarks Panel": ["bookmark", "COMMAND_SHOW_BOOKMARK_PANEL"],
    "History Panel": ["history", "COMMAND_SHOW_HISTORY_PANEL"], "Notes Panel": ["notes", "COMMAND_SHOW_NOTES_PANEL"],
    "Window Panel": ["window"], "Show / Hide Panels": ["panel", "COMMAND_TOGGLE_PANEL"], "Vivaldi Settings": ["gear", "COMMAND_SHOW_SETTINGS"],
    "Create New Space": ["plus", "COMMAND_WORKSPACE_CREATE_NEW"], "Manage Extensions": ["puzzle", "COMMAND_SHOW_EXTENSIONS"],
    "Pin This Tab": ["pin"], "Add This Tab to Favorites": ["star"], "Copy Current URL": ["link", "COMMAND_PAGE_COPY_URL"],
    "Split View: Side by Side": ["splitV"], "Split View: Top and Bottom": ["splitH"], "Close Split View": ["unsplit", "COMMAND_DISBAND_TILE_GROUP"],
    "Duplicate Tab": ["duplicate"], "Mute / Unmute Tab": ["speaker"], "Close Tab": ["close", "COMMAND_CLOSE_TAB"],
    "Move Tab to Space…": ["move"], "Switch to Space…": ["spaces"], "Pin Tab to Folder…": ["folder"], "Rename Tab…": ["pencil"],
    "Back to Pinned Page": ["undo"], "Tidy Tabs": ["tidy"], "Archive Tab": ["archive"], "View Archived Tabs": ["archive"],
    "Reopen Closed Tab": ["reopen", "COMMAND_TAB_REOPEN_RECENTLY_CLOSED"], "New Window": ["window", "COMMAND_NEW_WINDOW"],
    "New Little Vivarc": ["little"], "Open Page in Little Vivarc": ["little"], "New Private Window": ["private", "COMMAND_NEW_PRIVATE_WINDOW"],
    "Vivarc Guide": ["help"], "Collapse All Folders": ["collapse"], "Expand All Folders": ["expand"],
    "Export Vivarc Backup": ["upload"], "Back Up Vivarc Now": ["save"], "Restore Vivarc Backup…": ["reopen"],
    "Vivarc Settings": ["sliders"], "Edit Space": ["palette"],
  };
  const glyphOf = (name) => svg(GLYPHS[name] || GLYPHS.tidy);
  let shortcuts = {};
  const loadShortcuts = async () => {
    try { shortcuts = (await vivaldi.prefs.get("vivaldi.actions"))?.value?.[0] || {}; } catch (_) { shortcuts = {}; }
  };
  const KEY_NAMES = { meta: "⌘", shift: "⇧", alt: "⌥", ctrl: "⌃", left: "←", right: "→", up: "↑", down: "↓", backspace: "⌫",
    enter: "↩", esc: "⎋", space: "Space", tab: "⇥", del: "⌦" };
  // "shift+meta+t" → "⇧⌘T" (the modifiers in macOS order); a shortcut without a modifier is not shown.
  const keysOf = (command) => {
    const list = shortcuts[command]?.shortcuts || [];
    const combo = list.find((k) => /(meta|ctrl|alt)\+/.test(k));
    if (!combo) return "";
    const parts = combo.endsWith("++") ? [...combo.slice(0, -2).split("+"), "+"] : combo.split("+");
    const key = parts.pop();
    const order = ["ctrl", "alt", "shift", "meta"].filter((m) => parts.includes(m)).map((m) => KEY_NAMES[m]);
    return order.join("") + (KEY_NAMES[key] || key.toUpperCase());
  };

  // Pickers: a mode where what is typed filters a list of choices (spaces, folders) or names something (rename).
  // pick(text) returns rows { label, sub, run }; Enter runs the selected one and closes the bar.
  const matchesText = (text, ...fields) => fields.join(" ").toLowerCase().includes(text.trim().toLowerCase());
  const spaceRows = (text, run, skip) => (window.__vm.spaceList?.() || [])
    .filter((space) => space.id !== skip && matchesText(text, space.name))
    .map((space) => ({ label: space.name, sub: space.active ? "Current space" : "Space", run: () => run(space) }));
  const spacePicker = () => ({ name: "Switch to Space", placeholder: "Space name…",
    pick: (text) => spaceRows(text, (space) => window.__vm.switchToSpace(space.id)) });
  const moveToSpacePicker = (tab) => {
    const from = window.__vm.workspaces.of(tab);
    return { name: "Move to Space", placeholder: "Move this tab to…",
      pick: (text) => spaceRows(text, (space) => window.__vm.moveTabToSpace(tab.id, space.id)
        .then(() => toast(`Moved to ${space.name}`), (e) => { console.warn("[vivarc] move:", e); toast("Could not move the tab"); }), from) };
  };
  const folderPicker = (tab) => ({ name: "Pin to Folder", placeholder: "Folder name…",
    pick: (text) => (window.__vm.pinFolders?.() || []).filter((f) => matchesText(text, f.title))
      .map((f) => ({ label: `${"\u2003".repeat(Math.max(0, f.depth - 1))}${f.title}`, sub: f.depth ? "Folder in Pinned" : "Top of Pinned",
        run: () => window.__vm.pinTabTo(tab, f.id).then(() => toast(`Pinned to ${f.title}`)) })) });
  // A tab bound to a pinned link or a favorite shows the bookmark's name in the sidebar, so renaming it renames the
  // bookmark (what the sidebar's own Rename does); any other tab gets a fixedTitle.
  const renamePicker = async (tab) => {
    const pin = window.__vm.pins?.pinOf(tab);
    const bookmark = pin ? (await chrome.bookmarks.get(String(pin)).catch(() => []))[0] : null;
    if (bookmark?.url) {
      return { name: "Rename Tab", placeholder: bookmark.title || "New name…", initial: bookmark.title || "",
        pick: (text) => text.trim() ? [{ label: `Rename to \u201c${text.trim()}\u201d`, sub: "Pinned tab",
          run: () => chrome.bookmarks.update(bookmark.id, { title: text.trim().slice(0, 80) }) }] : [] };
    }
    const fixed = (() => { try { return JSON.parse(tab.vivExtData || "{}").fixedTitle; } catch (_) { return ""; } })();
    return { name: "Rename Tab", placeholder: tab.title || "New name…", initial: fixed || tab.title || "",
      pick: (text) => [
        ...(text.trim() ? [{ label: `Rename to \u201c${text.trim()}\u201d`, sub: tab.title || tab.url,
          run: () => setExtData(tab, { fixedTitle: text.trim().slice(0, 80) }).then(() => window.dispatchEvent(new CustomEvent("vm-refresh-sidebar"))) }] : []),
        ...(fixed ? [{ label: "Use the Page's Own Title", sub: tab.title || tab.url,
          run: () => setExtData(tab, { fixedTitle: undefined }).then(() => window.dispatchEvent(new CustomEvent("vm-refresh-sidebar"))) }] : []),
      ] };
  };

  // Backups saved by the daily copy (newest first), and a file of your own.
  const backupPicker = async () => {
    const B = window.__vm.backup;
    const saved = await B.listSaved().catch(() => []);
    const when = (ms) => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    return { name: "Restore Backup", placeholder: "Search backups…",
      pick: (text) => [
        { label: "Import from File…", sub: "A backup you exported", run: () => B.importFile() },
        ...saved.filter((b) => matchesText(text, b.name)).slice(0, 30).map((b) => ({
          label: b.name, sub: `${when(b.modified)} · ${Math.max(1, Math.round(b.size / 1024))} KB`,
          run: async () => B.restore(await B.loadSaved(b.name)).catch((e) => { console.warn("[vivarc] restore:", e); toast("Could not restore that backup"); }),
        })),
      ] };
  };

  // The command bar's archive view: what is typed searches the archive (11-archive.js); Enter restores.
  const ARCHIVE = { name: "Archived Tabs", archive: true };
  const archivedRow = (entry) => ({ type: "archived", entry, url: entry.url, favicon: entry.favicon, label: entry.title,
    sub: String(entry.url || "").replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^www\./i, "").replace(/[?#].*$/, "").replace(/\/$/, "") });

  let bar = null;
  let input = null;
  let list = null;
  let chipHolder = null;
  let targetTab = null;
  let mode = null;
  let rows = [];
  let selected = 0;
  let seq = 0;
  let autoCompleted = false;
  const LIMIT = 5; // Arc shows five results
  let completion = null; // the address completed in the field: { typed, shown, url, title, favicon, tab }
  let siteEngine = null; // the site whose search Tab opens ("Search YouTube  Tab")
  let siteHint = null;
  // What was typed, without the completion selected after it.
  const typed = () => {
    if (!input) return "";
    const { value, selectionStart, selectionEnd } = input;
    return selectionEnd === value.length && selectionStart < selectionEnd ? value.slice(0, selectionStart) : value;
  };
  let rowsFor = null; // the text the rows on screen were found for: Enter on older rows acts on what is typed now
  let listFloor = 0; // the list never shrinks while you type (it only grows), so the bar keeps still
  const icons = new Map(); // icon nodes kept for the bar's lifetime: a row found again keeps its icon, no reload
  let editing = false; // opened by Cmd+L on the current page: Enter navigates that page, nothing is closed

  // `used` holds the icons already placed in the list being built: a second row for the same page gets a copy.
  const iconFor = (url, favicon, used = new Set(), owner = "") => {
    const key = `${owner}|${url}|${favicon || ""}`; // owner: two open tabs on the same page each keep their own
    const kept = icons.get(key);
    if (kept) {
      if (used.has(kept)) return kept.cloneNode(true);
      used.add(kept);
      return kept;
    }
    const wrap = el("span", "vm-cmd-ico");
    icons.set(key, wrap);
    used.add(wrap);
    if (window.__vm.iconEl) {
      wrap.append(window.__vm.iconEl(url, favicon)); // live icon, then the sidebar's cache, then Vivaldi's database
    } else if (favicon) {
      const img = el("img");
      img.src = favicon;
      img.addEventListener("error", () => wrap.replaceChildren(letter(url)));
      wrap.append(img);
    } else {
      wrap.append(letter(url));
    }
    return wrap;
  };
  const letter = (url) => {
    const host = hostOf(url) || "?";
    let hash = 0;
    for (const ch of host) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
    const span = el("span", "vm-cmd-letter", host[0].toUpperCase());
    span.style.backgroundColor = `hsl(${hash} 38% 40%)`;
    return span;
  };

  // Like Arc's, the bar goes at once.
  const leave = (node) => node?.remove();
  const close = (removeBlank) => {
    const blank = editing ? null : targetTab; // editing: the target is the page you are on, never closed
    leave(bar);
    bar = input = list = chipHolder = targetTab = mode = stackHere = siteHint = completion = siteEngine = null;
    editing = false;
    rows = [];
    rowsFor = null;
    listFloor = 0;
    icons.clear();
    seq++;
    if (removeBlank && blank != null) removeBlankTab(blank);
  };
  // The blank tab the bar was opened for is closed, unless it is all its space has: closing it would leave the space
  // empty, and Vivaldi would hand the window to another space's tab (a new space, opened from the space dots).
  const removeBlankTab = async (id) => {
    try {
      const tab = await chrome.tabs.get(id);
      if (!isBlank(tab)) return;
      const space = window.__vm.workspaces?.of(tab) ?? 0;
      const others = (await chrome.tabs.query({ windowId: tab.windowId }))
        .filter((t) => t.id !== id && (window.__vm.workspaces?.of(t) ?? 0) === space);
      if (others.length) await chrome.tabs.remove(id);
    } catch (_) {}
  };

  // The page behind the bar is in a tab stack: what opens from the bar joins that stack, unless the row says
  // "Outside Stack". Vivaldi itself stacks a tab created from a stacked one, and leaves the blank tab of Cmd+T out,
  // so the tab is put in place (or taken out) once it exists, and checked again a moment later.
  let stackHere = null; // { group, name, memberId }
  const groupOf = (tab) => { try { return JSON.parse(tab?.vivExtData || "{}").group || ""; } catch (_) { return ""; } };
  const place = (id, outside, stack = stackHere) => {
    if (id == null || !stack || !vivaldi?.tabsPrivate?.move) return;
    const check = async () => {
      const tab = await chrome.tabs.get(id).catch(() => null);
      if (!tab) return;
      const group = groupOf(tab);
      if (outside && group) await vivaldi.tabsPrivate.move({ tabIds: [id], target: "last", tweaks: ["ungroup"], debug: "Vivarc.cmdOutside" });
      else if (!outside && group !== stack.group) {
        await vivaldi.tabsPrivate.move({ tabIds: [id], target: stack.memberId, workspaceId: window.__vm.workspaces.of(await chrome.tabs.get(stack.memberId)) || null,
          tweaks: ["do-not-reparent", "into"], debug: "Vivarc.cmdIntoStack" });
      } else return;
      window.dispatchEvent(new CustomEvent("vm-refresh-sidebar"));
    };
    setTimeout(() => check().catch((e) => console.warn("[vivarc] stack:", e)), 250);
    setTimeout(() => check().catch(() => {}), 900);
  };

  const go = (url, outside = false) => {
    const id = targetTab;
    const stack = stackHere;
    close(false);
    if (id != null) chrome.tabs.update(id, { url, active: true }).then(() => place(id, outside, stack));
    else chrome.tabs.create({ url }).then((tab) => place(tab.id, outside, stack));
  };

  // Plain searches use the engine chosen in Vivaldi; DuckDuckGo is only the fallback. (chrome.search, which would
  // run the search itself, is not available to Vivaldi's UI.)
  const defaultSearch = async (query, outside = false) => {
    const id = targetTab;
    const stack = stackHere;
    close(false);
    place(id, outside, stack);
    const url = (await window.__vm.defaultSearchUrl?.(query)) || engineUrl(DEFAULT, query);
    if (id != null) chrome.tabs.update(id, { url, active: true });
    else chrome.tabs.create({ url });
  };

  const run = (row) => {
    if (!row || ((row.type === "search" || row.type === "suggest") && !row.query)) return;
    if (row.type === "tab") {
      chrome.tabs.update(row.tab.id, { active: true });
      close(true);
    } else if (row.type === "search" || row.type === "suggest") {
      if (row.engine === DEFAULT) defaultSearch(row.query, row.outside);
      else go(engineUrl(row.engine, row.query), row.outside);
    } else if (row.type === "engine") {
      input.value = "";
      setMode(row.engine);
    } else if (row.type === "pick") {
      close(true);
      Promise.resolve(row.run()).catch((e) => console.warn("[vivarc] pick:", e));
    } else if (row.type === "archived") {
      close(true);
      window.__vm.archive.restore(row.entry).catch((e) => console.warn("[vivarc] restore:", e));
    } else if (row.type === "action" && row.action.stay) {
      input.value = "";
      row.action.run(row.tab);
    } else if (row.type === "action") {
      close(true);
      Promise.resolve(row.action.run(row.tab)).catch((e) => console.warn("[vivarc] action:", e));
    } else {
      go(row.url, row.outside);
    }
  };

  // What a result shows after its title, in grey after a dash, as Arc does: the address without the scheme and
  // "www." (and without its query), for a page from history or bookmarks; nothing for an open tab or a command.
  const shownUrl = (url) => String(url || "").replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^www\./i, "").replace(/[?#].*$/, "").replace(/\/$/, "");
  const glyphIcon = (name, plain = false) => {
    const icon = el("span", `vm-cmd-ico vm-cmd-glyph${plain ? " vm-cmd-plain" : ""}`);
    icon.innerHTML = name === "action" ? ACTION_SVG : glyphOf(name);
    return icon;
  };
  // The field's own glyph follows the first result, like Arc's: the page's icon for a completed address, a globe for
  // a typed address, the command's icon for a command, the magnifier otherwise.
  const setFieldGlyph = () => {
    const glyph = bar?.querySelector(".vm-cmd-head > .vm-cmd-glyph");
    if (!glyph) return;
    const top = rows[0];
    const typedNow = typed().trim();
    glyph.replaceChildren();
    if (!mode && typedNow && top && (top.completed || (top.type === "tab" && completion?.tab?.id === top.tab.id))) {
      glyph.append(iconFor(top.url, top.favicon, new Set(), "field").cloneNode(true));
    } else if (!mode && typedNow && top?.type === "url" && top.globe) glyph.innerHTML = glyphOf("globe");
    else if (!mode && typedNow && top?.type === "action") glyph.innerHTML = glyphOf(ACTION_LOOK[top.action.label]?.[0]);
    else glyph.innerHTML = SEARCH_SVG;
  };

  const render = () => {
    if (!list) return;
    const nodes = [];
    const used = new Set();
    // One line per result, no section titles or dividers, like Arc: the icon, the title, the address in grey, and on
    // the right what Arc shows there: "Switch to Tab" for an open tab, the shortcut for a command.
    rows.forEach((row, i) => {
      const item = el("div", `vm-cmd-row${i === selected ? " sel" : ""}`);
      item.id = `vm-cmd-option-${i}`;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(i === selected));
      let icon;
      if (row.type === "action") icon = glyphIcon(ACTION_LOOK[row.action.label]?.[0] || "action");
      else if (row.type === "engine" || row.type === "pick") icon = glyphIcon(row.icon || "action");
      else if (row.type === "search" || row.type === "suggest") icon = glyphIcon("search", true);
      else if (row.type === "url" && row.globe) icon = glyphIcon("globe", true);
      else icon = iconFor(row.url, row.favicon, used, row.tab?.id ?? "");
      icon.setAttribute("aria-hidden", "true");
      const content = el("span", "vm-cmd-content");
      content.append(el("span", "vm-cmd-title", row.label));
      const detail = row.type === "tab" || row.type === "action" || row.type === "search" || row.type === "suggest" ? "" : row.sub || "";
      if (detail && detail !== row.label) content.append(el("span", "vm-cmd-sub", detail));
      item.append(icon, content);
      if (row.type === "tab") {
        const hint = el("span", "vm-cmd-hint");
        const arrow = el("span", "vm-cmd-arrow");
        arrow.innerHTML = glyphOf("arrow");
        hint.append(el("span", null, "Switch to Tab"), arrow);
        item.append(hint);
      } else if (row.type === "action") {
        const keys = keysOf(ACTION_LOOK[row.action.label]?.[1]);
        if (keys) {
          const hint = el("span", "vm-cmd-hint");
          hint.append(el("kbd", null, keys));
          item.append(hint);
        }
      } else if (row.type === "archived") {
        item.append(el("span", "vm-cmd-hint", "Restore"));
      }
      item.addEventListener("mousemove", () => {
        if (selected === i) return;
        selected = i;
        const previous = list.querySelector(".sel");
        previous?.classList.remove("sel");
        previous?.setAttribute("aria-selected", "false");
        item.classList.add("sel");
        item.setAttribute("aria-selected", "true");
        input.setAttribute("aria-activedescendant", item.id);
      });
      item.addEventListener("click", () => run(row));
      nodes.push(item);
    });
    list.replaceChildren(...nodes);
    holdHeight();
    setFieldGlyph();
    if (rows.length) input.setAttribute("aria-activedescendant", `vm-cmd-option-${selected}`);
    else input.removeAttribute("aria-activedescendant");
    list.querySelector(`#vm-cmd-option-${selected}`)?.scrollIntoView({ block: "nearest" });
  };

  // While something is typed the list keeps the tallest height it has had, so new suggestions arriving (or fewer
  // matches) do not make the bar jump; clearing the field or switching mode lets it fit again.
  const holdHeight = () => {
    if (!list) return;
    if (!input?.value.trim()) { listFloor = 0; list.style.minHeight = ""; return; }
    list.style.minHeight = "";
    listFloor = Math.max(listFloor, list.getBoundingClientRect().height);
    list.style.minHeight = `${listFloor}px`;
  };

  const allTabs = async () =>
    (await chrome.tabs.query({ currentWindow: true })).filter((t) => !isBlank(t) && t.id !== targetTab);

  const pageBehindBar = async () => {
    if (editing && targetTab != null) return chrome.tabs.get(targetTab).catch(() => null);
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (active && !isBlank(active) && active.id !== targetTab) return active;
    const last = activeHistory.filter((id) => id !== targetTab).pop();
    return last != null ? chrome.tabs.get(last).catch(() => null) : null;
  };

  const matchingActions = async (needle) => {
    // Best match first (a stable sort keeps the list's order among equals), then the first three.
    const hits = ACTIONS.map((a) => [a, window.__vm.match.actionScore(a.label, a.words, needle)])
      .filter(([, score]) => score > 0).sort((a, b) => b[1] - a[1]).map(([a]) => a);
    if (!hits.length) return [];
    const tab = hits.some((a) => a.tab) ? await pageBehindBar() : null;
    return hits.filter((a) => (!a.tab || tab) && (!a.when || a.when(tab))).slice(0, 3)
      .map((action) => ({ type: "action", action, tab, label: action.label }));
  };

  const compute = async () => {
    const id = ++seq;
    const text = typed().trim();
    const out = [];
    if (mode?.pick) {
      const picked = await mode.pick(text);
      if (id !== seq) return;
      out.push(...picked.map((p) => ({ type: "pick", ...p })));
      if (!picked.length) {
        rows = [];
        render();
        list.append(el("div", "vm-cmd-empty", text ? "Nothing matches" : "Type a name"));
        return;
      }
    } else if (mode?.archive) {
      const found = window.__vm.archive.search(await window.__vm.archive.load(), text, 40);
      if (id !== seq) return;
      out.push(...found.map(archivedRow));
      if (!found.length) {
        rows = [];
        render();
        list.append(el("div", "vm-cmd-empty", text ? "No archived tab matches" : "No archived tabs yet. Archive a tab from its menu, or Clear the sidebar."));
        return;
      }
    } else if (mode) {
      out.push({ type: "search", engine: mode, query: text, label: text || "%s" });
    } else if (!text) {
      (await allTabs()).slice(0, 5).forEach((tab) =>
        out.push({ type: "tab", tab, url: tab.url, favicon: tab.favIconUrl, label: window.__vm.titleOf(tab) }));
    } else {
      const needle = text.toLowerCase();
      const seen = new Set();
      const matches = [];
      const add = (row) => {
        const key = row.url.replace(/#.*$/, "");
        if (seen.has(key)) return;
        seen.add(key);
        matches.push(row);
      };
      const tabsNow = await allTabs();
      // The page behind the bar is in a stack: what opens from here goes into it by default.
      stackHere = null;
      const behind = editing ? null : await pageBehindBar();
      if (groupOf(behind)) stackHere = { group: groupOf(behind), memberId: behind.id };
      const tabRow = (tab) => ({ type: "tab", tab, url: tab.url, favicon: tab.favIconUrl, label: window.__vm.titleOf(tab) });
      const hit = completion && completion.typed.toLowerCase() === needle ? completion : null;
      if (hit?.tab) seen.add(hit.tab.url.replace(/#.*$/, ""));
      tabsNow
        .filter((t) => `${t.title} ${t.url}`.toLowerCase().includes(needle))
        .slice(0, 3)
        .forEach((tab) => add(tabRow(tab)));
      // Spaces by name ("go to" a space, like Arc): only the ones that start with what is typed.
      const spaceHits = needle.length < 3 ? [] : (window.__vm.spaceList?.() || [])
        .filter((sp) => !sp.active && (sp.name.toLowerCase().startsWith(needle) || sp.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(needle))))
        .slice(0, 2)
        .map((space) => ({ type: "pick", icon: "spaces", url: `vivarc-space:${space.id}`, label: `Switch to ${space.name}`, sub: "Space", run: () => window.__vm.switchToSpace(space.id) }));
      try {
        window.__vm.archive.search(await window.__vm.archive.load(), text, 2).forEach((e) => add(archivedRow(e)));
      } catch (_) {}
      try {
        (await chrome.bookmarks.search(text)).filter((b) => b.url).slice(0, 2)
          .forEach((b) => add({ type: "bookmark", url: b.url, label: b.title || b.url, sub: shownUrl(b.url) }));
      } catch (_) {}
      try {
        (await chrome.history.search({ text, maxResults: 4 }))
          .forEach((h) => add({ type: "history", url: h.url, favicon: null, label: h.title || shownUrl(h.url), sub: shownUrl(h.url) }));
      } catch (_) {}
      if (id !== seq) return;
      const searchRow = { type: "search", engine: DEFAULT, query: text, label: text };
      const actions = needle.length > 1 ? await matchingActions(needle) : [];
      if (id !== seq) return;
      // Arc's first result is its best guess, with the web search second: the address it completed in the field (the
      // open tab, if that page is open), else a typed address, else a command named by what is typed ("set" →
      // Settings, "split" → Split View), else the search.
      let top = null;
      if (hit?.tab) top = tabRow(hit.tab);
      else if (hit) top = { type: "url", url: hit.url, favicon: hit.favicon, label: hit.title || hit.shown, sub: hit.title ? hit.shown : "", completed: true };
      else if (looksLikeUrl(text)) top = { type: "url", url: toUrl(text), label: text, globe: true };
      else {
        const named = actions.find((a) => a.label.toLowerCase().split(/[\s:/()…]+/).some((w) => w.startsWith(needle)));
        if (named) top = named;
      }
      const first = top || searchRow;
      out.push(first);
      if (stackHere && (first.type === "url" || first.type === "search")) {
        out.push({ ...first, outside: true, sub: first.type === "url" ? "Open in New Tab, Outside Stack" : "Search Outside Stack", label: first.label });
      }
      if (top) out.push(searchRow);
      const openTabs = matches.filter((m) => m.type === "tab" && m.tab.id !== top?.tab?.id);
      const pages = matches.filter((m) => m.type !== "tab" && m.url !== top?.url);
      out.push(...openTabs, ...actions.filter((a) => a !== top).slice(0, 2), ...pages, ...spaceHits);
      if (window.__vm.settings.get("searchSuggestions") && !looksLikeUrl(text) && text.length > 1) {
        // What is on this computer shows at once; the web's suggestions fill the list's free places when they arrive,
        // without moving the rows above or the selection.
        show(id, text, out);
        try {
          const reply = await fetch(DEFAULT.suggest.replace("{searchTerms}", encodeURIComponent(text)));
          const data = await reply.json();
          const phrases = Array.isArray(data[1]) ? data[1] : data.map((d) => d.phrase);
          if (id !== seq || rows.length >= LIMIT) return;
          const more = phrases.filter((p) => p && p.toLowerCase() !== needle)
            .map((p) => ({ type: "suggest", engine: DEFAULT, query: p, label: p }));
          if (!more.length) return;
          rows = [...rows, ...more].slice(0, LIMIT);
          render();
        } catch (_) {}
        return;
      }
    }
    show(id, text, out);
  };
  const show = (id, text, out) => {
    if (id !== seq) return;
    rows = mode ? out : out.slice(0, LIMIT); // five results, like Arc; pickers and the archive show all they find
    rowsFor = text;
    selected = 0;
    render();
    showSite();
  };

  const setMode = (engine) => {
    mode = engine;
    chipHolder.replaceChildren();
    if (engine) {
      const chip = el("span", "vm-cmd-chip", engine.name);
      chip.style.backgroundColor = CHIP_COLORS[engine.keyword] || "#5b5670";
      chipHolder.append(chip);
    }
    input.placeholder = engine?.placeholder || (engine?.archive ? "Search archived tabs…" : engine ? "Search…" : "Search or Enter URL…");
    input.value = engine?.initial || "";
    if (engine?.initial) setTimeout(() => input?.select(), 0);
    compute();
  };

  // Arc completes the address in the field as you type, from the pages you have open, saved and visited: an open
  // tab's own address (so Enter goes back to it), a bookmark's, or for a page from history the site itself.
  const autocomplete = async () => {
    completion = null;
    const text = input.value;
    if (mode || !text || /\s/.test(text) || !autoCompleted) return;
    const needle = text.toLowerCase();
    const tabs = (await chrome.tabs.query({ currentWindow: true })).filter((t) => /^https?:/.test(t.url || ""))
      .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    const marks = (await chrome.bookmarks.search(text).catch(() => [])).filter((b) => /^https?:/.test(b.url || ""));
    const visited = (await chrome.history.search({ text, maxResults: 40, startTime: 0 }).catch(() => []))
      .filter((h) => /^https?:/.test(h.url || ""))
      .sort((a, b) => (b.typedCount || 0) - (a.typedCount || 0) || (b.visitCount || 0) - (a.visitCount || 0));
    const fits = (shown) => shown.toLowerCase().startsWith(needle) && shown.length > needle.length;
    let found = null;
    for (const tab of tabs) {
      const shown = shownUrl(tab.url);
      const host = shownUrl(`https://${hostOf(tab.url)}`);
      if (fits(shown)) { found = { shown, url: tab.url, title: window.__vm.titleOf(tab), favicon: tab.favIconUrl, tab }; break; }
      if (fits(host)) { found = { shown: host, url: tab.url, title: window.__vm.titleOf(tab), favicon: tab.favIconUrl, tab }; break; }
    }
    if (!found) {
      const mark = marks.find((b) => fits(shownUrl(b.url)));
      if (mark) found = { shown: shownUrl(mark.url), url: mark.url, title: mark.title };
    }
    if (!found) {
      const page = visited.find((h) => fits(hostOf(h.url)));
      if (page) {
        const root = visited.find((h) => shownUrl(h.url) === hostOf(page.url));
        found = { shown: hostOf(page.url), url: `https://${hostOf(page.url)}/`, title: root?.title || "" };
      }
    }
    if (!found || input.value !== text) return;
    input.value = text + found.shown.slice(text.length);
    input.setSelectionRange(text.length, input.value.length);
    completion = { typed: text, ...found };
  };

  // "Search YouTube  Tab" at the end of the field when what is typed is a search engine's keyword or the address of
  // a site with a search engine (Vivaldi's engines, then Vivarc's own list).
  const showSite = () => {
    if (!siteHint) return;
    const text = typed().trim().toLowerCase();
    siteEngine = null;
    if (!mode && text && !/\s/.test(text)) {
      const host = completion ? hostOf(completion.url) : looksLikeUrl(text) ? hostOf(toUrl(text)) : "";
      siteEngine = engines.find((en) => en.keyword.toLowerCase() === text)
        || (host ? engines.find((en) => siteOf(hostOf(en.url.replace("{searchTerms}", ""))) === siteOf(host)) : null) || null;
    }
    siteHint.classList.toggle("on", !!siteEngine);
    if (siteEngine) siteHint.replaceChildren(el("span", null, `Search ${siteEngine.name}`), el("kbd", null, "Tab"));
  };

  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(true); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!rows.length) return;
      selected = (selected + (e.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length;
      render();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      // Typed faster than the rows came: the first row is still for an earlier text. Act on what is in the field.
      const now = typed().trim();
      if (!mode && selected === 0 && now && now !== rowsFor) {
        const full = input.value.trim();
        run(looksLikeUrl(full) ? { type: "url", url: toUrl(full), label: full } : { type: "search", engine: DEFAULT, query: now, label: now });
        return;
      }
      run(rows[selected]);
      return;
    }
    // Cmd+Backspace removes the selected page from the archive for good.
    if (e.key === "Backspace" && e.metaKey && rows[selected]?.type === "archived") {
      e.preventDefault();
      window.__vm.archive.forget(rows[selected].entry.id).then(compute);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      showSite();
      if (!mode && siteEngine) setMode(siteEngine);
      return;
    }
    if (e.key === "Backspace" && mode && !input.value) { e.preventDefault(); setMode(null); return; }
    autoCompleted = e.key.length === 1 && !e.metaKey && !e.ctrlKey;
  };

  const open = (tabId, { edit = null } = {}) => {
    if (!window.__vm.cssLoaded) return;
    if (bar && !bar.isConnected) close(false); // its element was taken out of the page without closing the bar
    if (bar) { if (!editing && tabId != null) targetTab = tabId; return; }
    targetTab = tabId;
    editing = edit != null;
    mode = null;
    completion = siteEngine = null;
    loadShortcuts().then(() => { if (bar) render(); });
    bar = el("div");
    bar.id = "vm-cmd";
    const box = el("div", "vm-cmd-box");
    const head = el("div", "vm-cmd-head");
    const glyph = el("span", "vm-cmd-glyph");
    glyph.innerHTML = SEARCH_SVG;
    chipHolder = el("span", "vm-cmd-chips");
    input = el("input");
    input.placeholder = "Search or Enter URL…";
    input.spellcheck = false;
    input.autocomplete = "off";
    input.setAttribute("aria-label", "Search or enter URL");
    input.setAttribute("aria-controls", "vm-cmd-results");
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-expanded", "true");
    siteHint = el("span", "vm-cmd-site");
    head.append(glyph, chipHolder, input, siteHint);
    list = el("div", "vm-cmd-list");
    list.id = "vm-cmd-results";
    list.setAttribute("role", "listbox");
    box.append(head, list);
    bar.append(box);
    // A click outside the box closes the bar and still reaches what it was on in the sidebar (a space dot, a tab),
    // instead of taking two clicks.
    bar.addEventListener("mousedown", (e) => {
      if (e.target !== bar) return;
      close(true);
      document.addEventListener("mouseup", (up) => {
        const under = document.elementFromPoint(up.clientX, up.clientY);
        const target = under?.closest?.("#vm-panel .vm-row, #vm-panel .vm-fav, .vm-space-bar .vm-space-pill");
        if (target && target === document.elementFromPoint(e.clientX, e.clientY)?.closest?.("#vm-panel .vm-row, #vm-panel .vm-fav, .vm-space-bar .vm-space-pill")) target.click();
      }, { once: true, capture: true });
    });
    input.addEventListener("keydown", onKey);
    // The address is completed first, so the rows are found once, for the completed address.
    input.addEventListener("input", async () => { await autocomplete(); compute(); });
    (document.querySelector("#browser") || document.body).append(bar);
    if (editing) {
      input.value = edit;
      input.setAttribute("aria-label", "Edit address");
    }
    // Vivaldi may focus its own address field right after (Cmd+L is also its shortcut): take the focus back.
    const focus = () => { if (!input) return; input.focus(); if (editing && input.value === edit) input.select(); };
    focus();
    setTimeout(focus, 60);
    setTimeout(focus, 250);
    compute();
    if (!editing) window.dispatchEvent(new CustomEvent("vm-command-bar-opened"));
  };

  window.addEventListener("vm-open-command-bar", () => open(null));
  // From the sidebar's tab menu: open the bar straight in a picker for that tab.
  const openPicker = async (tabId, make) => {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return;
    const picker = await make(tab);
    open(null);
    setMode(picker);
  };
  window.addEventListener("vm-rename-tab", (e) => openPicker(e.detail, renamePicker));
  // A tab stack's name (Vivaldi's own stack title, shared with its tab bar); empty brings back the first tab's title.
  window.addEventListener("vm-rename-stack", ({ detail }) => {
    open(null);
    setMode({ name: "Rename Stack", placeholder: "Stack name…", initial: detail.name,
      pick: (text) => [
        ...(text.trim() ? [{ label: `Rename to \u201c${text.trim()}\u201d`, sub: "Tab stack", run: () => window.__vm.renameStackTo(detail.group, text.trim().slice(0, 50)) }] : []),
        { label: "Use the First Tab's Title", sub: "Tab stack", run: () => window.__vm.renameStackTo(detail.group, "") },
      ] });
  });
  window.addEventListener("vm-move-tab", (e) => openPicker(e.detail, moveToSpacePicker));
  window.__vm.onShortcut((key) => { if (key === window.__vm.normalise("meta+t")) open(null); });
  // Cmd+L, like Arc: the page's address opens in the command bar, centred, to edit or replace; Enter loads it in
  // this tab. The sidebar's address field stays where it is (Vivaldi's own Cmd+L focus is taken back).
  window.__vm.onShortcut(async (key) => {
    if (key !== window.__vm.normalise("meta+l") || !window.__vm.settings?.get?.("commandBarForAddress")) return;
    if (document.querySelector("#browser.vm-little-arc")) return; // Little Vivarc has its own address bar
    const [tab] = await chrome.tabs.query({ active: true, windowId: window.vivaldiWindowId });
    if (!tab) return;
    if (bar) close(false);
    open(tab.id, { edit: isBlank(tab) ? "" : (tab.url || "") });
    document.querySelector("#tabs-tabbar-container .UrlBar-UrlField")?.blur();
  });

  const activeHistory = [];
  chrome.tabs.onActivated.addListener(({ tabId }) => {
    activeHistory.push(tabId);
    if (activeHistory.length > 6) activeHistory.shift();
  });

  chrome.tabs.onCreated.addListener((tab) => {
    if (tab.windowId !== window.vivaldiWindowId || window.__vm.switchingSpace || Date.now() - startedAt < 5000 || !isBlank(tab) || tab.active === false) return;
    const previous = activeHistory.filter((id) => id !== tab.id).pop();
    open(tab.id);
    if (previous != null) {
      setTimeout(() => {
        if (bar && targetTab === tab.id) {
          chrome.tabs.update(previous, { active: true }).then(() => input?.focus(), () => {});
        }
      }, 120);
    }
  });
  console.log("[vivarc] command bar started");
})();
