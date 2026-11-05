// Backup of what Vivarc keeps in the profile (settings, space themes, open folders, learned tab colours, the tab
// archive). Pinned links and favorites are Vivaldi bookmarks, which Vivaldi Sync already carries.
//
// - Export / import a JSON file from the command bar ("Export Vivarc Backup", "Restore Vivarc Backup…").
// - Once a day the local helper (src/native/pointer.py) writes a copy to ~/.vivarc/backups, one file per profile
//   and day, keeping the last 30; "Restore Vivarc Backup…" lists them.
// Space themes are saved per workspace id, which differs on another Mac, so a backup also records each space's
// name and a restore matches themes to spaces by name.
(() => {
  const FORMAT = "vivarc-backup";
  const VERSION = 1;
  // Kept per machine, rebuilt by Vivarc, or bookkeeping: never in a backup.
  const SKIP = new Set(["icons", "bootstrap", "spaceNumberShortcuts", "archiveSince", "backupLast"]);
  const THEME = /^theme:space:(-?\d+(?:\.\d+)?)$/;

  // ---- pure (tested) ----
  const pack = (entries, spaces, meta = {}) => ({
    format: FORMAT,
    version: VERSION,
    createdAt: meta.now ?? Date.now(),
    profile: meta.profile || "",
    spaces: (spaces || []).map((s) => ({ id: s.id, name: s.name })),
    data: Object.fromEntries(entries.filter(([key]) => !SKIP.has(key))),
  });

  const isBackup = (b) => !!b && b.format === FORMAT && typeof b.data === "object" && b.data !== null && Number(b.version) <= VERSION;

  // What a restore writes: [key, value] pairs. A space theme moves to the space with the same name here (or stays
  // on its id when the backup has no name for it); themes of spaces that do not exist here are dropped. The
  // archive and the learned colours are merged with what is already here, everything else is replaced.
  const plan = (backup, here, current = {}, addArchive = (now, old) => [...now, ...old]) => {
    if (!isBackup(backup)) throw new Error("Not a Vivarc backup");
    const nameOf = new Map((backup.spaces || []).map((s) => [String(s.id), String(s.name || "").trim().toLowerCase()]));
    const idByName = new Map((here || []).map((s) => [String(s.name || "").trim().toLowerCase(), s.id]));
    const known = new Set((here || []).map((s) => String(s.id)));
    const writes = [];
    let themes = 0, skipped = 0;
    for (const [key, value] of Object.entries(backup.data)) {
      if (SKIP.has(key)) continue;
      const theme = THEME.exec(key);
      if (theme) {
        const name = nameOf.get(theme[1]);
        const id = name !== undefined && idByName.has(name) ? idByName.get(name) : known.has(theme[1]) ? theme[1] : undefined;
        if (id === undefined) { skipped++; continue; }
        writes.push([`theme:space:${id}`, value]);
        themes++;
      } else if (key === "archive" && Array.isArray(value)) {
        writes.push([key, addArchive(current.archive || [], value)]);
      } else if (key === "tabColors" && value && typeof value === "object") {
        const mine = current.tabColors || {};
        writes.push([key, { page: { ...value.page, ...mine.page }, icon: { ...value.icon, ...mine.icon } }]);
      } else {
        writes.push([key, value]);
      }
    }
    return { writes, themes, skipped };
  };

  const fileName = (profile, now = new Date()) => {
    const safe = String(profile || "Vivarc").normalize("NFKD").replace(/[^\w .-]/g, "").trim().replace(/\s+/g, "-") || "Vivarc";
    const day = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    return `${safe}-${day}`;
  };

  const api = { pack, plan, isBackup, fileName, SKIP };
  window.__vm.backup = api;
  if (!window.__vm.store || typeof chrome === "undefined" || !chrome.tabs) return;

  // ---- profile data ----
  const { store } = window.__vm;
  const HELPER = "http://127.0.0.1:47391"; // keep in sync with POINTER_PORT in vivarc.py
  const toast = (message) => window.dispatchEvent(new CustomEvent("vm-toast", { detail: message }));

  const profileName = () => new Promise((resolve) => {
    try { vivaldi.runtimePrivate.getUserProfiles((list) => resolve((list || []).find((p) => p.active)?.name || "")); }
    catch (_) { resolve(""); }
  });
  const spaces = () => (window.__vm.spaceList?.() || []).map(({ id, name }) => ({ id, name }));

  const collect = async () => {
    const keys = (await store.keys()).filter((k) => !SKIP.has(k));
    const entries = await Promise.all(keys.map(async (k) => [k, await store.get(k)]));
    return pack(entries, spaces(), { profile: await profileName() });
  };

  const exportFile = async () => {
    const backup = await collect();
    const blob = new Blob([JSON.stringify(backup, null, 1)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    try {
      await chrome.downloads.download({ url, filename: `Vivarc Backup ${fileName(backup.profile)}.json`, saveAs: true });
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  };

  // Writes the backup in, then lets the open windows pick up settings and the space theme right away.
  const restore = async (backup) => {
    if (!isBackup(backup)) throw new Error("Not a Vivarc backup");
    await saveToHelper("before-restore").catch(() => {}); // a way back
    const current = { archive: await store.get("archive", []), tabColors: await store.get("tabColors", {}) };
    const add = window.__vm.archive?.add || ((now, old) => [...now, ...old]);
    const { writes, themes, skipped } = plan(backup, spaces(), current, (mine, theirs) => add(mine, theirs));
    for (const [key, value] of writes) await store.set(key, value);
    const settings = writes.find(([k]) => k === "settings");
    if (settings && typeof BroadcastChannel === "function") new BroadcastChannel("vivarc-settings").postMessage(settings[1]);
    if (typeof BroadcastChannel === "function") {
      const channel = new BroadcastChannel("vivarc-space-themes");
      for (const [key, value] of writes) {
        const m = THEME.exec(key);
        if (m) channel.postMessage({ space: Number(m[1]), theme: value });
      }
    }
    window.dispatchEvent(new CustomEvent("vm-archive-changed"));
    const note = skipped ? ` (${skipped} theme${skipped === 1 ? "" : "s"} for spaces not on this Mac skipped)` : "";
    toast(`Vivarc backup restored: ${themes} space theme${themes === 1 ? "" : "s"}${note}. Restart Vivaldi to see everything.`);
  };

  const importFile = () => new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return resolve(false);
      try {
        await restore(JSON.parse(await file.text()));
        resolve(true);
      } catch (error) {
        console.warn("[vivarc] restore:", error);
        toast("That file is not a Vivarc backup.");
        resolve(false);
      }
    });
    input.click();
  });

  // ---- automatic copies through the local helper ----
  const saveToHelper = async (suffix = "") => {
    const backup = await collect();
    const name = fileName(backup.profile) + (suffix ? `-${suffix}` : "");
    const reply = await fetch(`${HELPER}/backup?name=${encodeURIComponent(name)}`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Vivarc": "1" }, body: JSON.stringify(backup),
    });
    if (!reply.ok) throw new Error(`helper: ${reply.status}`);
    return name;
  };
  const listSaved = async () => {
    const reply = await fetch(`${HELPER}/backups`, { cache: "no-store", headers: { "X-Vivarc": "1" } });
    if (!reply.ok) return [];
    return (await reply.json()).backups || [];
  };
  const loadSaved = async (name) => {
    const reply = await fetch(`${HELPER}/backups/${encodeURIComponent(name)}`, { cache: "no-store", headers: { "X-Vivarc": "1" } });
    if (!reply.ok) throw new Error(`helper: ${reply.status}`);
    return reply.json();
  };

  const DAY = 20 * 3600 * 1000; // a little under a day, so a daily habit does not drift
  const daily = async () => {
    try {
      const last = await store.get("backupLast", 0);
      if (Date.now() - last < DAY) return;
      await store.set("backupLast", Date.now()); // claimed first, so other windows skip
      await saveToHelper();
    } catch (error) {
      console.warn("[vivarc] daily backup:", error);
      await store.set("backupLast", Date.now() - DAY + 3600 * 1000); // the helper may be starting: retry in an hour
    }
  };
  setTimeout(daily, 2 * 60 * 1000);
  setInterval(daily, 3 * 3600 * 1000);

  Object.assign(api, { collect, exportFile, importFile, restore, saveToHelper, listSaved, loadSaved });
})();
