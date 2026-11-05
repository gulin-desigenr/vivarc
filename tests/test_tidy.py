import shutil
import unittest

from jsrun import run_js


def tidy(expr, **data):
    return run_js("12-tidy.js", expr, **data)


T = lambda i, url, title, **kw: {"id": i, "url": url, "title": title, "index": i, **kw}


@unittest.skipUnless(shutil.which("node"), "node is needed to test Tidy Tabs")
class TidyTabs(unittest.TestCase):
    def plan(self, tabs, stacks=None):
        return tidy("window.__vm.tidy.plan(tabs, stacks)", tabs=tabs, stacks=stacks or [])

    def test_same_site_goes_together_and_is_named_after_it(self):
        out = self.plan([T(1, "https://www.figma.com/file/a", "Landing v2"), T(2, "https://figma.com/file/b", "Logo"),
                         T(3, "https://example.org/", "Example")])
        self.assertEqual(out["create"], [{"ids": [1, 2], "name": "Figma"}])

    def test_google_apps_are_separate_sites(self):
        out = self.plan([T(1, "https://docs.google.com/a", "Proposta"), T(2, "https://docs.google.com/b", "Contrato"),
                         T(3, "https://mail.google.com/x", "Inbox"), T(4, "https://mail.google.com/y", "Mensagem")])
        self.assertEqual(sorted((g["name"], g["ids"]) for g in out["create"]), [("Gmail", [3, 4]), ("Google Docs", [1, 2])])

    def test_titles_sharing_two_words_go_together_across_sites(self):
        out = self.plan([T(1, "https://a.com/1", "Viagem Paraguai: roteiro de Assunção"),
                         T(2, "https://b.com/2", "Hotéis em Assunção — viagem barata"),
                         T(3, "https://c.com/3", "Receita de bolo")])
        self.assertEqual([g["ids"] for g in out["create"]], [[1, 2]])
        self.assertIn(out["create"][0]["name"], ("Viagem Assunção", "Assunção Viagem"))

    def test_a_lone_tab_joins_a_group_it_shares_two_topic_words_with(self):
        out = self.plan([T(1, "https://pt.wikipedia.org/wiki/Paraguai", "Paraguai – Wikipédia, a enciclopédia livre"),
                         T(2, "https://pt.wikipedia.org/wiki/Assuncao", "Assunção – Wikipédia, a enciclopédia livre"),
                         T(3, "https://www.booking.com/city/py/asuncion.html", "Os 10 melhores hotéis de Assunção, Paraguai"),
                         T(4, "https://news.ycombinator.com/", "Hacker News")])
        self.assertEqual([sorted(g["ids"]) for g in out["create"]], [[1, 2, 3]])
        self.assertIn(out["create"][0]["name"], ("Paraguai Assunção", "Assunção Paraguai"))

    def test_site_boilerplate_does_not_pull_a_tab_in(self):
        out = self.plan([T(1, "https://pt.wikipedia.org/wiki/A", "Gato – Wikipédia, a enciclopédia livre"),
                         T(2, "https://pt.wikipedia.org/wiki/B", "Cão – Wikipédia, a enciclopédia livre"),
                         T(3, "https://outra.com/", "Enciclopédia livre de receitas")])
        self.assertEqual([sorted(g["ids"]) for g in out["create"]], [[1, 2]])

    def test_one_shared_word_or_a_lone_tab_stays_loose(self):
        out = self.plan([T(1, "https://a.com/1", "Design systems"), T(2, "https://b.com/2", "Interior design ideas")])
        self.assertEqual(out["create"], [])

    def test_a_tab_opened_from_another_goes_with_it(self):
        out = self.plan([T(1, "https://a.com/", "Notícia"), T(2, "https://b.com/", "Outra coisa", openerTabId=1)])
        self.assertEqual([g["ids"] for g in out["create"]], [[1, 2]])

    def test_tabs_that_fit_an_existing_stack_join_it(self):
        out = self.plan([T(1, "https://github.com/x/y/pull/3", "Fix bug"), T(2, "https://a.com/", "Orçamento cliente Whop"),
                         T(3, "https://b.com/", "Nada a ver")],
                        [{"group": "g1", "name": "", "hosts": ["github.com"], "words": []},
                         {"group": "g2", "name": "Whop", "hosts": ["x.com", "y.com"], "words": ["whop"]}])
        self.assertEqual(sorted((j["group"], j["ids"]) for j in out["join"]), [("g1", [1]), ("g2", [2])])
        self.assertEqual(out["create"], [])

    def test_non_web_pages_are_left_alone(self):
        out = self.plan([T(1, "vivaldi://settings", "Settings"), T(2, "chrome://newtab/", "New Tab")])
        self.assertEqual(out, {"create": [], "join": []})

    def test_site_names(self):
        self.assertEqual(tidy('window.__vm.tidy.siteName("loja.exemplo.com.br")'), "Exemplo")
        self.assertEqual(tidy('window.__vm.tidy.siteName("pagespeed.web.dev")'), "Web")


if __name__ == "__main__":
    unittest.main()
