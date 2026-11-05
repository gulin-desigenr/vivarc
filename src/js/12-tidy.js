// Tidy Tabs, like Arc's, without AI: the space's loose tabs are sorted into named tab stacks by rules that run on
// this Mac. Tabs go together when they are on the same site, when one was opened from the other, or when their
// titles share at least two meaningful words. A group needs two tabs; a lone tab stays loose. Tabs that fit a stack
// already in the space (same site, or its name's words in their title) join it instead.
// Pure functions only; 10-sidebar.js applies the plan with Vivaldi's tab stacks and offers Undo.
(() => {
  const STOP = new Set(`
    a o as os um uma uns umas de do da dos das em no na nos nas por para pra com sem sobre entre e ou que se sua seu
    suas seus como mais menos muito pelo pela pelos pelas ao aos à às é são foi ser ter tem não sim já até após
    the an and or of to in on at for from with by about into over your you our are was were be is it this that
    these those how what why when who new page home login sign welcome official site online free best top
    inbox caixa entrada google search pesquisa resultados results youtube video vídeo wikipedia wiki
  `.split(/\s+/).filter(Boolean));
  // Sites whose apps live on subdomains of one domain: each app is its own site (Docs is not Gmail).
  const SITE_NAMES = {
    "docs.google.com": "Google Docs", "drive.google.com": "Google Drive", "mail.google.com": "Gmail",
    "calendar.google.com": "Google Calendar", "meet.google.com": "Google Meet", "sheets.google.com": "Google Sheets",
    "github.com": "GitHub", "youtube.com": "YouTube", "linkedin.com": "LinkedIn", "figma.com": "Figma",
    "notion.so": "Notion", "trello.com": "Trello", "app.clickup.com": "ClickUp", "web.whatsapp.com": "WhatsApp",
    "x.com": "X", "facebook.com": "Facebook", "instagram.com": "Instagram", "reddit.com": "Reddit",
    "claude.ai": "Claude", "chatgpt.com": "ChatGPT", "stackoverflow.com": "Stack Overflow",
  };

  const hostOf = (url) => {
    try {
      const u = new URL(url);
      return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, "").toLowerCase() : "";
    } catch (_) { return ""; }
  };
  const siteName = (host) => {
    if (SITE_NAMES[host]) return SITE_NAMES[host];
    const parts = host.split(".");
    const main = parts.length > 2 && /^(com|co|org|net|gov|edu)$/.test(parts[parts.length - 2]) ? parts[parts.length - 3] : parts[parts.length - 2] || host;
    return main ? main.charAt(0).toUpperCase() + main.slice(1) : host;
  };
  const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  // The words that say what a page is about: no site names, no filler, no numbers, nothing shorter than 4 letters.
  const words = (title, host) => {
    const site = new Set(fold(siteName(host)).split(/\s+/).concat(host.split(".")));
    return [...new Set(fold(title).split(/[^a-z0-9]+/))]
      .filter((w) => w.length >= 4 && !/^\d+$/.test(w) && !STOP.has(w) && !site.has(w));
  };

  // tabs: [{ id, url, title, openerTabId, index }] (the loose tabs of one space); stacks: [{ group, name, hosts,
  // words }] already in that space. Returns { create: [{ ids, name }], join: [{ group, ids }] }.
  const plan = (tabs, stacks = []) => {
    const items = tabs.map((t) => ({ ...t, host: hostOf(t.url) })).filter((t) => t.host);
    items.forEach((t) => { t.words = words(t.title, t.host); });
    // Words every tab of a site has ("enciclopédia livre" on Wikipedia) are that site's boilerplate, not a topic.
    const bySite = new Map();
    for (const t of items) { if (!bySite.has(t.host)) bySite.set(t.host, []); bySite.get(t.host).push(t); }
    for (const same of bySite.values()) {
      if (same.length < 2) continue;
      const boiler = same[0].words.filter((w) => same.every((t) => t.words.includes(w)));
      same.forEach((t) => { t.words = t.words.filter((w) => !boiler.includes(w)); });
    }

    // Tabs that belong to a stack already there join it.
    const join = new Map();
    const rest = [];
    for (const t of items) {
      const stack = stacks.find((s) => s.hosts?.includes(t.host) && (s.hosts.length === 1 || !s.words?.length)) ||
        stacks.find((s) => s.words?.length && s.words.every((w) => t.words.includes(w)));
      if (stack) {
        if (!join.has(stack.group)) join.set(stack.group, []);
        join.get(stack.group).push(t.id);
      } else rest.push(t);
    }

    // Union-find over the others: same site, opened from one another, or two shared words.
    const parent = new Map(rest.map((t) => [t.id, t.id]));
    const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra); };
    const byId = new Map(rest.map((t) => [t.id, t]));
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a.openerTabId != null && byId.has(a.openerTabId)) union(a.id, a.openerTabId);
      for (let j = i + 1; j < rest.length; j++) {
        const b = rest[j];
        if (a.host === b.host) { union(a.id, b.id); continue; }
        const shared = a.words.filter((w) => b.words.includes(w));
        if (shared.length >= 2) union(a.id, b.id);
      }
    }
    const groups = new Map();
    for (const t of rest) {
      const root = find(t.id);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(t);
    }

    // A tab left alone joins a group when it shares two words with the group as a whole (a hotel page that names
    // the two places two encyclopedia pages are about).
    const multi = [...groups.values()].filter((m) => m.length >= 2);
    for (const members of groups.values()) {
      if (members.length !== 1) continue;
      const t = members[0];
      let best = null, bestShared = 1;
      for (const g of multi) {
        const pool = new Set(g.flatMap((m) => m.words));
        const shared = t.words.filter((w) => pool.has(w)).length;
        if (shared > bestShared) { best = g; bestShared = shared; }
      }
      if (best) { best.push(t); members.pop(); }
    }

    const create = [];
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      members.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      create.push({ ids: members.map((t) => t.id), name: nameFor(members) });
    }
    return { create, join: [...join.entries()].map(([group, ids]) => ({ group, ids })) };
  };

  // One site: its name. Several: the words most of them share, else the site most of them are on, plus "& more".
  const nameFor = (members) => {
    const hosts = [...new Set(members.map((t) => t.host))];
    if (hosts.length === 1) return siteName(hosts[0]);
    const counts = new Map();
    for (const t of members) for (const w of t.words) counts.set(w, (counts.get(w) || 0) + 1);
    const common = [...counts.entries()].filter(([, n]) => n >= Math.max(2, Math.ceil(members.length / 2)))
      .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).slice(0, 2).map(([w]) => w);
    if (common.length) {
      // The words as they are written in a title (case and accents), not folded.
      const original = (w) => {
        for (const t of members) for (const part of String(t.title || "").split(/[^\p{L}\p{N}]+/u)) if (fold(part) === w) return part;
        return w;
      };
      const name = common.map(original).join(" ");
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
    const tally = new Map();
    for (const t of members) tally.set(t.host, (tally.get(t.host) || 0) + 1);
    const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return `${siteName(top)} & more`;
  };

  window.__vm.tidy = { plan, hostOf, siteName, words, nameFor };
})();
