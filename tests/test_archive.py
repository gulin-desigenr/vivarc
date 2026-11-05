import shutil
import unittest

import json
import os
import subprocess

HARNESS = r"""
const fs = require("fs"), vm = require("vm");
globalThis.window = { __vm: { workspaces: { of: (t) => t.ws || 0 } }, dispatchEvent() {} };
globalThis.CustomEvent = class { constructor(n, o) { this.type = n; this.detail = o?.detail; } };
vm.runInThisContext(fs.readFileSync(process.argv[1], "utf8"));
const archive = window.__vm.archive;
console.log(JSON.stringify(eval(process.argv[2])));
"""


def run(expr):
    path = os.path.join(os.path.dirname(__file__), "..", "src", "js", "11-archive.js")
    out = subprocess.run(["node", "-e", HARNESS, path, expr], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


@unittest.skipUnless(shutil.which("node"), "node is needed to test the archive")
class Archive(unittest.TestCase):
    def test_entry_keeps_page_space_and_safe_favicon(self):
        e = run('archive.entry({url: "https://a.com/x", title: "A", favIconUrl: "chrome://favicon/x", ws: 7}, "Work", 1000)')
        self.assertEqual((e["url"], e["title"], e["space"], e["spaceName"], e["at"], e["favicon"]),
                         ("https://a.com/x", "A", 7, "Work", 1000, ""))

    def test_add_puts_new_first_dedupes_per_space_and_caps(self):
        ids = run('''(() => {
          const old = [{id: "1", url: "u1", space: 0}, {id: "2", url: "u2", space: 0}, {id: "3", url: "u1", space: 5}];
          return archive.add(old, [{id: "4", url: "u1", space: 0}], 3).map((e) => e.id);
        })()''')
        self.assertEqual(ids, ["4", "2", "3"])

    def test_search_matches_every_word_in_title_url_or_space(self):
        ids = run('''archive.search([
          {id: "a", title: "Figma file", url: "https://figma.com/1", spaceName: "Design"},
          {id: "b", title: "Docs", url: "https://docs.google.com", spaceName: "Work"},
          {id: "c", title: "Figma community", url: "https://figma.com/c", spaceName: "Work"}], "figma work").map((e) => e.id)''')
        self.assertEqual(ids, ["c"])
        self.assertEqual(len(run('archive.search([{title: "x", url: "y", spaceName: ""}], "")')), 1)

    def test_relative_time(self):
        m = 60000
        self.assertEqual(run(f"archive.ago(0, {30 * 1000})"), "just now")
        self.assertEqual(run(f"archive.ago(0, {5 * m})"), "5 min ago")
        self.assertEqual(run(f"archive.ago(0, {3 * 60 * m})"), "3 h ago")
        self.assertEqual(run(f"archive.ago(0, {30 * 60 * m})"), "yesterday")
        self.assertEqual(run(f'archive.describe({{url: "https://www.a.com/x", spaceName: "Work", at: 0}}, {5 * m})'),
                         "a.com · Work · 5 min ago")

    def test_automatic_archive_takes_only_stale_loose_pages(self):
        h = 3600 * 1000
        ids = run(f'''archive.due([
          {{id: 1, url: "https://old.com", lastAccessed: 0}},
          {{id: 2, url: "https://new.com", lastAccessed: {11 * h}}},
          {{id: 3, url: "https://active.com", lastAccessed: 0, active: true}},
          {{id: 4, url: "https://music.com", lastAccessed: 0, audible: true}},
          {{id: 5, url: "https://pinned.com", lastAccessed: 0, pinned: true}},
          {{id: 6, url: "https://kept.com", lastAccessed: 0}},
          {{id: 7, url: "https://split.com", lastAccessed: 0, vivExtData: JSON.stringify({{tiling: {{id: "t"}}}})}},
          {{id: 8, url: "https://stack.com", lastAccessed: 0, vivExtData: JSON.stringify({{group: "g"}})}},
          {{id: 9, url: "vivaldi://settings", lastAccessed: 0}},
          {{id: 10, url: "https://loading.com", lastAccessed: 0, status: "loading"}},
        ], {{hours: 12, now: {13 * h}, keep: (t) => t.id === 6}}).map((t) => t.id)''')
        self.assertEqual(ids, [1])
        self.assertEqual(run('archive.due([{id: 1, url: "https://a.com", lastAccessed: 0}], {hours: 0, now: 1e12})'), [])
        # a tab older than the feature gets a full period from when automatic archiving started
        self.assertEqual(run(f'archive.due([{{id: 1, url: "https://a.com", lastAccessed: 0}}], {{hours: 12, now: {20 * h}, since: {10 * h}}}).length'), 0)
        self.assertEqual(run(f'archive.due([{{id: 1, url: "https://a.com", lastAccessed: 0}}], {{hours: 12, now: {23 * h}, since: {10 * h}}}).length'), 1)


if __name__ == "__main__":
    unittest.main()
