import http.client
import importlib.util
import json
import os
import shutil
import subprocess
import tempfile
import threading
import unittest
from unittest import mock

HERE = os.path.dirname(__file__)
JS = os.path.join(HERE, "..", "src", "js", "46-backup.js")
HARNESS = r"""
const fs = require("fs"), vm = require("vm");
globalThis.window = { __vm: {} };
vm.runInThisContext(fs.readFileSync(process.argv[1], "utf8"));
const backup = window.__vm.backup;
console.log(JSON.stringify(eval(process.argv[2])));
"""


def js(expr):
    out = subprocess.run(["node", "-e", HARNESS, JS, expr], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def load_helper():
    spec = importlib.util.spec_from_file_location("vivarc_pointer", os.path.join(HERE, "..", "src", "native", "pointer.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@unittest.skipUnless(shutil.which("node"), "node is needed to test the backup")
class BackupData(unittest.TestCase):
    def test_pack_leaves_out_caches_and_bookkeeping(self):
        b = js('backup.pack([["settings", {glass: true}], ["icons", {}], ["bootstrap", 1], ["archive", []], ["theme:space:7", {hue: 1}]], [{id: 7, name: "Work", extra: 1}], {now: 5, profile: "Me"})')
        self.assertEqual(b["format"], "vivarc-backup")
        self.assertEqual(sorted(b["data"]), ["archive", "settings", "theme:space:7"])
        self.assertEqual(b["spaces"], [{"id": 7, "name": "Work"}])
        self.assertEqual((b["createdAt"], b["profile"]), (5, "Me"))

    def test_restore_moves_themes_to_spaces_with_the_same_name(self):
        out = js('''backup.plan({format: "vivarc-backup", version: 1, spaces: [{id: 1, name: "Work"}, {id: 2, name: "Gone"}, {id: 0, name: "Home"}],
          data: {"theme:space:1": {hue: 10}, "theme:space:2": {hue: 20}, "theme:space:0": {hue: 30}, settings: {glass: true}}},
          [{id: 0, name: "Home"}, {id: 99, name: "work"}])''')
        self.assertEqual(dict(map(tuple, out["writes"])), {"theme:space:99": {"hue": 10}, "theme:space:0": {"hue": 30}, "settings": {"glass": True}})
        self.assertEqual((out["themes"], out["skipped"]), (2, 1))

    def test_restore_merges_archive_and_colours_and_rejects_other_files(self):
        out = js('''backup.plan({format: "vivarc-backup", version: 1, spaces: [],
          data: {archive: [{id: "b"}], tabColors: {page: {"https://a": {bg: "#111"}, "https://b": {bg: "#222"}}, icon: {}}}},
          [], {archive: [{id: "a"}], tabColors: {page: {"https://a": {bg: "#999"}}, icon: {"https://c": "#333"}}})''')
        writes = dict(map(tuple, out["writes"]))
        self.assertEqual([e["id"] for e in writes["archive"]], ["a", "b"])
        self.assertEqual(writes["tabColors"]["page"]["https://a"]["bg"], "#999")  # what was learned here wins
        self.assertEqual(writes["tabColors"]["page"]["https://b"]["bg"], "#222")
        self.assertEqual(writes["tabColors"]["icon"], {"https://c": "#333"})
        self.assertTrue(js('(() => { try { backup.plan({format: "other", data: {}}, []); return false; } catch (_) { return true; } })()'))
        self.assertFalse(js('backup.isBackup({format: "vivarc-backup", version: 9, data: {}})'))

    def test_file_name_is_profile_and_day(self):
        self.assertRegex(js('backup.fileName("Trabalho / Pessoal", new Date(2026, 10, 5, 12))'), r"^Trabalho-Pessoal-2026-11-05$")
        self.assertRegex(js('backup.fileName("", new Date(2026, 0, 2, 12))'), r"^Vivarc-2026-01-02$")


class BackupHelper(unittest.TestCase):
    def setUp(self):
        self.helper = load_helper()
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir)

    def body(self):
        return json.dumps({"format": "vivarc-backup", "version": 1, "data": {}}).encode()

    def test_save_keeps_the_newest_per_profile(self):
        h = self.helper
        for day in range(1, 6):
            path = h.save_backup(f"Work-2026-11-0{day}", self.body(), self.dir, keep=3)
            os.utime(path, (day * 1000, day * 1000))
        h.save_backup("Home-2026-11-01", self.body(), self.dir, keep=3)
        names = sorted(item["name"] for item in h.list_backups(self.dir))
        self.assertEqual(names, ["Home-2026-11-01", "Work-2026-11-03", "Work-2026-11-04", "Work-2026-11-05"])
        self.assertEqual(oct(os.stat(os.path.join(self.dir, "Home-2026-11-01.json")).st_mode & 0o777), "0o600")

    def test_save_refuses_bad_names_and_other_json(self):
        h = self.helper
        for name in ("../x", ".hidden", "a/b", ""):
            with self.assertRaises(ValueError):
                h.save_backup(name, self.body(), self.dir)
        with self.assertRaises(ValueError):
            h.save_backup("ok", b'{"format": "other"}', self.dir)
        self.assertEqual(h.backup_profile("Work-2026-11-05-before-restore"), "Work")

    def test_http_endpoints_answer_only_vivaldis_ui(self):
        h = self.helper
        server = h.http.server.HTTPServer(("127.0.0.1", 0), h.Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.shutdown)
        port = server.server_address[1]

        def call(method, path, origin=None, body=None, marked=True):
            conn = http.client.HTTPConnection("127.0.0.1", port)
            headers = {"Content-Type": "application/json"}
            if marked:
                headers["X-Vivarc"] = "1"
            if origin:
                headers["Origin"] = origin
            conn.request(method, path, body=body, headers=headers)
            response = conn.getresponse()
            return response.status, response.read()

        with mock.patch.object(h, "BACKUP_DIR", self.dir):
            self.assertEqual(call("POST", "/backup?name=Work-2026-11-05", "https://evil.example", self.body())[0], 404)
            self.assertEqual(call("POST", "/backup?name=Work-2026-11-05", None, self.body(), marked=False)[0], 404)
            self.assertEqual(call("POST", "/backup?name=Work-2026-11-05", h.UI_ORIGIN, self.body())[0], 200)
            self.assertEqual(call("POST", "/backup?name=Work-2026-11-06", None, self.body())[0], 200)  # the UI sends no Origin
            self.assertEqual(call("GET", "/backups", "https://evil.example")[0], 404)
            self.assertEqual(call("GET", "/backups", marked=False)[0], 404)
            status, listing = call("GET", "/backups")
            self.assertEqual((status, [b["name"] for b in json.loads(listing)["backups"]]), (200, ["Work-2026-11-06", "Work-2026-11-05"]))
            status, saved = call("GET", "/backups/Work-2026-11-05", h.UI_ORIGIN)
            self.assertEqual((status, json.loads(saved)["format"]), (200, "vivarc-backup"))
            self.assertEqual(call("GET", "/backups/..%2Fstate", h.UI_ORIGIN)[0], 404)


if __name__ == "__main__":
    unittest.main()
