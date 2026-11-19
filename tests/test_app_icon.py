import os
import plistlib
import sys
import tempfile
import unittest
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import vivarc  # noqa: E402


def make_app(root, bundle_id):
    app = os.path.join(root, "Vivaldi.app")
    os.makedirs(os.path.join(app, "Contents"))
    with open(os.path.join(app, "Contents", "Info.plist"), "wb") as f:
        plistlib.dump({"CFBundleIdentifier": bundle_id}, f)
    return app


class AppIcon(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.calls = []

    def tearDown(self):
        self.tmp.cleanup()

    def run_ok(self, argv, **_):
        self.calls.append(argv)
        return SimpleNamespace(stdout="true\n")

    def test_sets_the_icon_on_the_real_vivaldi(self):
        app = make_app(self.tmp.name, "com.vivaldi.Vivaldi")
        self.assertTrue(vivarc.set_app_icon(app, run=self.run_ok))
        self.assertEqual(self.calls[0][:3], ["osascript", "-l", "JavaScript"])
        self.assertEqual(self.calls[0][-2:], [app, vivarc.ICON_FILE])

    def test_leaves_the_dev_copy_and_unknown_apps_alone(self):
        dev = make_app(self.tmp.name, "com.vivaldi.Vivaldi.vivarcdev")
        self.assertFalse(vivarc.set_app_icon(dev, run=self.run_ok))
        self.assertFalse(vivarc.set_app_icon(os.path.join(self.tmp.name, "missing.app"), run=self.run_ok))
        self.assertEqual(self.calls, [])

    def test_uninstall_takes_the_icon_off(self):
        app = make_app(self.tmp.name, "com.vivaldi.Vivaldi")
        vivarc.set_app_icon(app, icon=None, run=self.run_ok)
        self.assertEqual(self.calls[0][-1], "")

    def test_the_icon_ships_with_vivarc(self):
        self.assertTrue(os.path.exists(vivarc.ICON_FILE))


if __name__ == "__main__":
    unittest.main()
