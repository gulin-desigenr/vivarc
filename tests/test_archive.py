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


if __name__ == "__main__":
    unittest.main()
