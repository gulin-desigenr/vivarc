import shutil
import unittest

from jsrun import run_js

ACTIONS = [
    ("Vivaldi Settings", "open settings preferences options browser"),
    ("Export Vivarc Backup", "backup export save settings themes file"),
    ("Back Up Vivarc Now", "backup save settings themes"),
    ("Restore Vivarc Backup…", "backup restore import settings themes"),
    ("Vivarc Settings", "preferences options configure features toggle glass"),
    ("Edit Space", "theme color gradient appearance sidebar rename name emoji icon"),
]


def ranked(typed):
    expr = """actions.map(([l, w]) => [l, window.__vm.match.actionScore(l, w, typed)])
      .filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([l]) => l)"""
    return run_js("04-match.js", expr, actions=ACTIONS, typed=typed)


@unittest.skipUnless(shutil.which("node"), "node is needed to test the command bar's JavaScript")
class ActionRanking(unittest.TestCase):
    def test_a_word_of_the_name_ranks_above_a_search_word(self):
        top = ranked("setting")[:3]
        self.assertIn("Vivarc Settings", top)
        self.assertIn("Vivaldi Settings", top)

    def test_every_typed_word_counts(self):
        self.assertEqual(ranked("vivarc set")[0], "Vivarc Settings")
        self.assertEqual(ranked("viv set")[:2], ["Vivaldi Settings", "Vivarc Settings"])

    def test_a_search_word_still_finds_an_action(self):
        self.assertEqual(ranked("glass"), ["Vivarc Settings"])
        self.assertEqual(ranked("emoji"), ["Edit Space"])

    def test_a_word_that_matches_nothing_rules_the_action_out(self):
        self.assertEqual(ranked("vivarc zebra"), [])
        self.assertEqual(ranked("   "), [])

    def test_the_start_of_the_name_wins_a_tie(self):
        self.assertEqual(ranked("back")[0], "Back Up Vivarc Now")
