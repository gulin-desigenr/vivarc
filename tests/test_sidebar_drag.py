import shutil
import unittest

from jsrun import run_js


def outside(point, bounds):
    return run_js("10-sidebar/04-drag-drop.js", "window.__vm.dragOutsideWindow(point, bounds)",
                  point=point, bounds=bounds)


@unittest.skipUnless(shutil.which("node"), "node is needed to test the sidebar's JavaScript")
class TearOutDropPoint(unittest.TestCase):
    def test_detects_a_drop_beyond_each_window_edge(self):
        bounds = {"left": 100, "top": 50, "width": 800, "height": 600}
        for point in ({"x": 99, "y": 100}, {"x": 100, "y": 49}, {"x": 900, "y": 100}, {"x": 100, "y": 650}):
            with self.subTest(point=point):
                self.assertTrue(outside(point, bounds))

    def test_keeps_points_inside_window_and_unknown_positions(self):
        bounds = {"left": 100, "top": 50, "width": 800, "height": 600}
        self.assertFalse(outside({"x": 100, "y": 50}, bounds))
        self.assertFalse(outside({"x": 899, "y": 649}, bounds))
        self.assertFalse(outside(None, bounds))
        self.assertFalse(outside({"x": 0, "y": 0}, None))


if __name__ == "__main__":
    unittest.main()
