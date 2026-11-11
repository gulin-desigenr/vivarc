import shutil
import unittest

from jsrun import run_js


def columns(count, width):
    return run_js("03-layout.js", "window.__vm.layout.favColumns(count, width)", count=count, width=width)


@unittest.skipUnless(shutil.which("node"), "node is needed to test the sidebar's JavaScript")
class FavoriteColumns(unittest.TestCase):
    def test_rows_are_shared_evenly_instead_of_leaving_a_short_last_row(self):
        self.assertEqual(columns(7, 324), 4)  # five fit: 4 + 3, not 5 + 2

    def test_a_full_row_stays_full(self):
        self.assertEqual(columns(5, 324), 5)
        self.assertEqual(columns(10, 324), 5)

    def test_a_few_favorites_share_the_whole_width(self):
        self.assertEqual(columns(3, 324), 3)

    def test_a_narrow_sidebar_drops_columns_but_keeps_tiles_at_least_60px(self):
        self.assertEqual(columns(5, 200), 3)  # 3 x 60 + 2 x 6 = 192
        self.assertEqual(columns(1, 40), 1)

    def test_nothing_to_lay_out(self):
        self.assertEqual(columns(0, 324), 0)
        self.assertEqual(columns(4, 0), 0)


if __name__ == "__main__":
    unittest.main()
