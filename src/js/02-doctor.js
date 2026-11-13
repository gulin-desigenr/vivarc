// Vivarc doctor: says which of the parts of Vivaldi that Vivarc relies on are gone, so a Vivaldi update that
// changed one is noticed before you run into it. Vivarc reaches into Vivaldi through private APIs, preferences,
// command names, the elements of its UI and its own modules (webpack); a Vivaldi release can change any of them.
//
// The lists of APIs, preferences and commands are read from Vivarc's own source at build time (vivarc.py,
// doctor_deps) and arrive as window.__vmDeps; the page elements are listed here, as the layout expects them.
// It runs once a few seconds after start-up (a toast says so only when something new is missing), from the
// command bar ("Check Vivarc"), and from `vivarc doctor --port` on a Vivaldi with DevTools open.
(() => {
  const deps = window.__vmDeps || { apis: [], prefs: [], commands: [] };

  // Vivaldi's UI as Vivarc's layout expects it (tabs on the left, the address field in the tab bar).
  const ELEMENTS = [
    "#browser", "#header", "#main", "#tabs-tabbar-container", "#tabs-container", ".tab-strip", "#webpage-stack",
    "#webview-container", ".toolbar-tabbar-before", ".toolbar-tabbar-after", ".UrlBar-AddressField", ".UrlBar-UrlField",
    ".toolbar-extensions", ".mainbar",
  ];

  // Errors thrown by Vivarc's code after it loaded (a click handler, a render), kept for the report.
  const errors = [];
  const fromVivarc = (text) => /\/vivarc\.js\b/.test(String(text || ""));
  const keep = (message) => { if (errors.length < 20) errors.push({ at: Date.now(), message: String(message).slice(0, 400) }); };
  window.addEventListener("error", (e) => { if (fromVivarc(e.filename) || fromVivarc(e.error?.stack)) keep(e.error?.stack || e.message); });
  window.addEventListener("unhandledrejection", (e) => { if (fromVivarc(e.reason?.stack)) keep(e.reason.stack); });

  const resolve = (path) => path.split(".").reduce((o, k) => o?.[k], globalThis);
  const isApi = (path) => { const v = resolve(path); return typeof v === "function" || typeof v?.addListener === "function"; };
  const prefExists = (path) => vivaldi.prefs.get(path).then(() => true, () => false);
  const chunks = () => { try { return chrome.extension.getBackgroundPage?.()?.webpackChunkgapp_browser_react; } catch (_) { return undefined; } };

  const group = (name, names, missing) => ({ name, checked: names.length, missing });
  const run = async () => {
    const ws = window.__vm.workspaces;
    let actions = {};
    try { actions = (await vivaldi.prefs.get("vivaldi.actions"))?.value?.[0] || {}; } catch (_) {}
    const prefs = await Promise.all(deps.prefs.map(async (p) => [p, await prefExists(p).catch(() => false)]));
    const internals = {
      "webpack modules (webpackChunkgapp_browser_react)": () => !!chunks(),
      "workspace manager (findManager)": () => !!ws?.findManager(chunks()),
      "workspace switcher (findSwitcher)": () => !!ws?.findSwitcher(chunks()),
      "workspace icons (findIcons)": () => !!ws?.findIcons(chunks()),
    };
    const vivarc = {
      "stylesheet loaded": () => !!window.__vm.cssLoaded,
      "sidebar drawn (#vm-panel)": () => !!document.querySelector("#vm-panel"),
    };
    const failing = (table) => Object.entries(table).filter(([, ok]) => { try { return !ok(); } catch (_) { return true; } }).map(([n]) => n);
    let version = "";
    try { version = (await vivaldi.utilities.getVersion())?.vivaldiVersion || ""; } catch (_) {}
    const loadErrors = (window.__vmLoadErrors || []).map((e) => `${e.module}: ${e.error.split("\n")[0]}`);
    const groups = [
      group("APIs", deps.apis, deps.apis.filter((a) => !isApi(a))),
      group("Preferences", deps.prefs, prefs.filter(([, ok]) => !ok).map(([p]) => p)),
      group("Commands", deps.commands, deps.commands.filter((c) => !(c in actions))),
      group("Page elements", ELEMENTS, ELEMENTS.filter((s) => !document.querySelector(s))),
      group("Vivaldi internals", Object.keys(internals), failing(internals)),
      group("Vivarc", [...Object.keys(vivarc), "modules loaded"], [...failing(vivarc), ...loadErrors]),
    ];
    const problems = groups.reduce((n, g) => n + g.missing.length, 0);
    return { vivaldi: version, at: new Date().toISOString(), ok: problems === 0, problems, groups, errors: [...errors] };
  };

  const text = (report) => [
    `Vivarc check on Vivaldi ${report.vivaldi} (${report.at})`,
    ...report.groups.map((g) => g.missing.length
      ? `✗ ${g.name}: ${g.missing.length} of ${g.checked} missing\n${g.missing.map((m) => `    ${m}`).join("\n")}`
      : `✓ ${g.name}: ${g.checked}`),
    ...(report.errors.length ? [`! ${report.errors.length} errors from Vivarc since start-up`, ...report.errors.map((e) => `    ${e.message.split("\n")[0]}`)] : []),
  ].join("\n");

  const toast = (message, action) => window.dispatchEvent(new CustomEvent("vm-toast", { detail: action ? { message, action } : message }));
  const copyAction = (report) => ({ label: "Copy Report", run: () => navigator.clipboard?.writeText(text(report)) });
  const problemsLine = (report) => `Vivarc: ${report.problems} ${report.problems === 1 ? "part" : "parts"} of Vivaldi missing`;

  // The command bar's "Check Vivarc": always answers.
  const show = async () => {
    const report = await run();
    if (report.ok) toast(`Vivarc check: all ${report.groups.reduce((n, g) => n + g.checked, 0)} checks passed`);
    else toast(problemsLine(report), copyAction(report));
    return report;
  };

  // At start-up, in a normal window: a toast only for problems not reported before (by this or another window).
  const atStart = async () => {
    if (!(await window.__vm.ready)) return;
    const win = await chrome.windows.getCurrent().catch(() => null);
    if (win?.type !== "normal") return;
    const report = await run();
    const seen = `${report.vivaldi} ${report.groups.flatMap((g) => g.missing).join(" ")}`;
    const decide = async () => {
      if (report.ok) return window.__vm.store.set("doctorSeen", "");
      if ((await window.__vm.store.get("doctorSeen", "")) === seen) return;
      await window.__vm.store.set("doctorSeen", seen);
      toast(problemsLine(report), copyAction(report));
    };
    await (navigator.locks ? navigator.locks.request("vivarc-doctor", decide) : decide());
    if (!report.ok) console.warn("[vivarc] " + text(report));
  };
  setTimeout(() => atStart().catch((e) => console.warn("[vivarc] doctor:", e)), 8000);

  window.__vm.doctor = { run, show, text };
})();
