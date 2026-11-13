import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest import mock

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "tools"))
import doctor  # noqa: E402
import vivarc  # noqa: E402

JS_DIR = os.path.join(ROOT, "src", "js")
CSS_DIR = os.path.join(ROOT, "src", "css")


class Dependencies(unittest.TestCase):
    def test_apis_come_from_code_not_from_comments_or_strings(self):
        js = ('// chrome.tabs.inComment\nchrome.tabs.query({});\nvivaldi.tabsPrivate.onKeyboardShortcut.addListener(f);\n'
              'const s = "chrome.tabs.inString"; /* vivaldi.prefs.blockComment */')
        self.assertEqual(doctor.js_dependencies(js)["apis"], ["chrome.tabs.query", "vivaldi.tabsPrivate.onKeyboardShortcut"])

    def test_an_apostrophe_in_a_comment_does_not_swallow_the_code_after_it(self):
        js = "// Vivaldi's own\nchrome.tabs.get(1); // it's here\nchrome.tabs.remove(1);"
        self.assertEqual(doctor.js_dependencies(js)["apis"], ["chrome.tabs.get", "chrome.tabs.remove"])

    def test_preferences_and_commands_come_from_strings_outside_comments(self):
        js = ('get("vivaldi.tabs.bar.width"); set({ path: "vivaldi.toolbars.tabbar_after" });\n'
              '// the whole "vivaldi.toolbars" is refused\nconst a = actions.COMMAND_NEW_TAB; // COMMAND_IN_COMMENT')
        deps = doctor.js_dependencies(js)
        self.assertEqual(deps["prefs"], ["vivaldi.tabs.bar.width", "vivaldi.toolbars.tabbar_after"])
        self.assertEqual(deps["commands"], ["COMMAND_NEW_TAB"])

    def test_vivarcs_own_source_lists_what_it_relies_on(self):
        deps = doctor.js_dependencies(vivarc.js_source(JS_DIR))
        self.assertIn("vivaldi.tabsPrivate.move", deps["apis"])
        self.assertIn("vivaldi.toolbars.tabbar_after", deps["prefs"])
        self.assertIn("COMMAND_WORKSPACE_CREATE_NEW", deps["commands"])
        self.assertNotIn("vivaldi.toolbars", deps["prefs"])  # Vivaldi's pref API refuses it

    def test_css_names_are_vivaldis_selectors_only(self):
        css = ('#browser.vm-on .toolbar-tabbar-before > .vm-row:hover { background: url("x.svg#a.b") .5px; }\n'
               '/* .commented */ @media (min-width: 1px) { #tabs-container .tab-strip { color: #fff; } }\n'
               '#vm-panel .drop-before { }')
        self.assertEqual(doctor.css_names(css), {"browser", "toolbar-tabbar-before", "tabs-container", "tab-strip"})

    def test_selector_names_in_the_code_are_checked_too(self):
        js = 'document.querySelector("#tabs-tabbar-container .UrlBar-UrlField"); el.closest(`.vm-row[data-id="${id}"]`);'
        self.assertEqual(doctor.js_selector_names(js), {"tabs-tabbar-container", "UrlBar-UrlField"})

    def test_the_webpack_markers_are_the_ones_the_workspace_module_searches_for(self):
        with open(os.path.join(JS_DIR, "07-workspaces.js"), encoding="utf8") as f:
            source = f.read()
        for marker in doctor.INTERNALS:
            self.assertIn(marker, vivarc.js_source(JS_DIR) if marker.startswith("webpack") else source)


class StaticChecks(unittest.TestCase):
    def setUp(self):
        self.res = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.res, True)
        with open(os.path.join(self.res, "prefs_definitions.json"), "w") as f:
            json.dump({"vivaldi": {"tabs": {"bar": {"width": {"type": "integer"}}}}}, f)
        with open(os.path.join(self.res, "bundle.js"), "w") as f:
            f.write('const a = {COMMAND_NEW_TAB: 1}; c("toolbar-tabbar-before"); s.removeWorkspace(w); "Back"')
        with open(os.path.join(self.res, "vivarc.js"), "w") as f:
            f.write("COMMAND_GONE tab-strip")  # Vivarc's own bundle does not count as Vivaldi's code

    def test_reports_what_vivaldi_no_longer_has(self):
        js = 'get("vivaldi.tabs.bar.width"); get("vivaldi.gone"); a.COMMAND_NEW_TAB; a.COMMAND_GONE;'
        css = '.toolbar-tabbar-before .tab-strip [data-name="Back"] [data-name="Gone"] { }'
        groups = {g["name"]: g for g in doctor.static_checks(self.res, js, css)}
        self.assertEqual(groups["Preferences"]["missing"], ["vivaldi.gone"])
        self.assertEqual(groups["Commands"]["missing"], ["COMMAND_GONE"])
        self.assertEqual(groups["Class and id names"]["missing"], ["tab-strip"])
        self.assertEqual(groups["Toolbar buttons"]["missing"], ["Gone"])
        self.assertEqual(len(groups["Vivaldi internals"]["missing"]), 3)

    def test_format_lists_the_missing(self):
        self.assertEqual(doctor.format_group({"name": "Commands", "checked": 2, "missing": []}), ["  ✓ Commands: 2"])
        self.assertEqual(doctor.format_group({"name": "Commands", "checked": 2, "missing": ["X"]}),
                         ["  ✗ Commands: 1 of 2 missing", "      X"])


class DoctorCommand(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.app = os.path.join(self.tmp, "Vivaldi.app")
        self.res = os.path.join(self.app, vivarc.RESOURCES)
        os.makedirs(self.res)
        for p in (mock.patch.object(vivarc, "HOME_DIR", os.path.join(self.tmp, "home")),
                  mock.patch.object(vivarc, "app_version", return_value="9.9.9")):
            p.start()
            self.addCleanup(p.stop)

    def run_doctor(self, static):
        with open(os.path.join(self.res, "window.html"), "w") as f:
            f.write(vivarc.inject_window_html("<html><body>\n</body></html>\n"))
        with open(os.path.join(self.res, "vivarc.js"), "w") as f:
            f.write(vivarc.bundle_text(False))
        os.makedirs(os.path.join(self.tmp, "home", "backup"))
        open(os.path.join(self.tmp, "home", "backup", "window.html.9.9.9.orig"), "w").close()
        out = io.StringIO()
        with mock.patch.object(doctor, "static_checks", return_value=static), redirect_stdout(out):
            try:
                vivarc.main(["--app", self.app, "doctor"])
                code = 0
            except SystemExit as e:
                code = e.code
        return code, out.getvalue()

    def test_all_good_exits_zero(self):
        code, out = self.run_doctor([{"name": "Commands", "checked": 3, "missing": []}])
        self.assertEqual(code, 0, out)
        self.assertIn("✓ vivarc.js is what this checkout builds", out)
        self.assertIn("All good.", out)

    def test_something_missing_exits_one(self):
        code, out = self.run_doctor([{"name": "Commands", "checked": 3, "missing": ["COMMAND_GONE"]}])
        self.assertEqual(code, 1)
        self.assertIn("COMMAND_GONE", out)
        self.assertIn("1 problem found.", out)


class Bundle(unittest.TestCase):
    def write(self, d, name, text):
        os.makedirs(os.path.dirname(os.path.join(d, name)), exist_ok=True)
        with open(os.path.join(d, name), "w") as f:
            f.write(text)

    def run_bundle(self, d):
        bundle = vivarc.build_bundle(d, {})
        script = "globalThis.window = globalThis; console.error = () => {};\n" + bundle + \
                 "\nconsole.log(JSON.stringify({ out: globalThis.out, errors: (window.__vmLoadErrors || []).map((e) => e.module) }));"
        return json.loads(subprocess.run(["node", "-e", script], capture_output=True, text=True, check=True).stdout)

    def test_a_folder_is_one_module_whose_files_share_a_scope(self):
        with tempfile.TemporaryDirectory() as d:
            self.write(d, "10-side/00-a.js", "  const a = 2;\n")
            self.write(d, "10-side/01-b.js", "  globalThis.out = a * 21;\n")
            self.assertEqual(self.run_bundle(d), {"out": 42, "errors": []})

    def test_a_module_that_throws_is_recorded_and_the_next_ones_still_load(self):
        with tempfile.TemporaryDirectory() as d:
            self.write(d, "01-broken.js", "(() => { throw new Error('gone'); })();\n")
            self.write(d, "02-next.js", "(() => { globalThis.out = 'loaded'; })();\n")
            self.assertEqual(self.run_bundle(d), {"out": "loaded", "errors": ["01-broken.js"]})

    def test_the_bundle_parses(self):
        result = subprocess.run(["node", "--check", "-"], input=vivarc.bundle_text(False), capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_the_stylesheet_is_the_css_files_in_order(self):
        names = sorted(n for n in os.listdir(CSS_DIR) if n.endswith(".css"))
        self.assertTrue(vivarc.stylesheet(CSS_DIR).startswith(vivarc.read_text(os.path.join(CSS_DIR, names[0]))))
        self.assertTrue(vivarc.stylesheet(CSS_DIR).endswith(vivarc.read_text(os.path.join(CSS_DIR, names[-1]))))


if __name__ == "__main__":
    unittest.main()
