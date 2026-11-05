import shutil
import unittest

from jsrun import run_js


@unittest.skipUnless(shutil.which("node"), "node is needed to test the colour helpers")
class Colors(unittest.TestCase):
    def colors(self, expr, **data):
        return run_js("04-colors.js", expr, **data)

    def test_text_colour_keeps_contrast(self):
        self.assertEqual(self.colors('colors.textFor("#dc5523")'), "#ffffff")  # Reddit orange
        self.assertEqual(self.colors('colors.textFor("#2d6be0")'), "#ffffff")  # Facebook blue
        self.assertEqual(self.colors('colors.textFor("#f2d56b")'), "#1b1b1f")  # pale yellow
        self.assertEqual(self.colors('colors.textFor("rgb(255, 255, 255)")'), "#1b1b1f")
        self.assertIsNone(self.colors('colors.textFor("nonsense")'))

    def test_dominant_colour_of_an_icon(self):
        # 3 orange pixels, 1 white, 1 transparent: orange wins
        px = [220, 85, 35, 255] * 3 + [255, 255, 255, 255] + [0, 0, 255, 0]
        self.assertEqual(self.colors("colors.dominant(px)", px=px), "#dc5523")
        # a black monochrome mark keeps its colour; a pale grey one gives none
        self.assertEqual(self.colors("colors.dominant(px)", px=[24, 23, 23, 255] * 4), "#181717")
        self.assertIsNone(self.colors("colors.dominant(px)", px=[200, 200, 200, 255] * 4))
        self.assertIsNone(self.colors("colors.dominant([])"))

    def test_space_solid_colour_differs_from_the_tint_and_reads(self):
        for theme in ({"hue": 245, "sat": 18, "light": 88}, {"hue": 143, "sat": 65, "light": 65}, {"hue": 250, "sat": 28, "light": 20}):
            solid = self.colors("colors.spaceSolid(theme)", theme=theme)
            tint = self.colors("colors.hex(colors.hslToRgb(theme.hue, theme.sat, theme.light))", theme=theme)
            self.assertNotEqual(solid["bg"], tint)
            ratio = self.colors("colors.contrast(colors.parse(s.bg), colors.parse(s.fg))", s=solid)
            self.assertGreaterEqual(ratio, 3, theme)

    def test_space_ink_reads_on_every_tint(self):
        # the user's spaces: lavender, green, pink and a mid teal where neither black nor white reaches 4.5:1 easily
        for hsl in ([232, 28, 88], [147, 28, 62], [351, 28, 63], [172, 28, 38], [232, 28, 23], [47, 85, 68]):
            ink = self.colors("colors.inkFor(colors.hslToRgb(...hsl))", hsl=hsl)
            bg = self.colors("colors.hslToRgb(...hsl)", hsl=hsl)
            fg = self.colors("colors.contrast(bg, colors.parse(ink.fg))", bg=bg, ink=ink)
            muted = self.colors("colors.contrast(bg, colors.parse(ink.muted))", bg=bg, ink=ink)
            self.assertGreaterEqual(fg, 4.5, hsl)
            self.assertGreaterEqual(muted, 4.4, hsl)  # 4.5 before rounding to hex
            self.assertLessEqual(muted, fg)


if __name__ == "__main__":
    unittest.main()
