import io
import json
import os
import plistlib
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import vivarc  # noqa: E402


class ReminderCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.app = os.path.join(self.tmp, "Vivaldi.app")
        self.resources = os.path.join(self.app, vivarc.RESOURCES)
        os.makedirs(self.resources)
        self.home = os.path.join(self.tmp, "home")
        self.plist = os.path.join(self.tmp, "LaunchAgents", "com.vivarc.reminder.plist")
        self.command = os.path.join(self.tmp, "Applications", "Update Vivarc.command")
        self.launchctl = mock.Mock()
        for p in (mock.patch.object(vivarc, "HOME_DIR", self.home),
                  mock.patch.object(vivarc, "REMINDER_PLIST", self.plist),
                  mock.patch.object(vivarc, "UPDATE_COMMAND", self.command),
                  mock.patch.object(vivarc, "REAPPLY_COMMAND", os.path.join(self.tmp, "home", "Put Vivarc back.command")),
                  mock.patch.object(vivarc, "launchctl", self.launchctl)):
            p.start()
            self.addCleanup(p.stop)

    def inject(self, html=True, bundle=True):
        with open(os.path.join(self.resources, "window.html"), "w") as f:
            f.write(vivarc.inject_window_html("<html><body>\n</body></html>\n") if html else "<html><body>\n</body></html>\n")
        bundle_path = os.path.join(self.resources, "vivarc.js")
        if bundle:
            with open(bundle_path, "w") as f:
                f.write("//")
        elif os.path.exists(bundle_path):
            os.remove(bundle_path)


class NeedsReapply(ReminderCase):
    def test_false_while_vivarc_is_in_place(self):
        self.inject()
        self.assertFalse(vivarc.needs_reapply(self.resources))

    def test_true_after_a_vivaldi_update_replaced_window_html(self):
        self.inject(html=False)
        self.assertTrue(vivarc.needs_reapply(self.resources))

    def test_true_when_the_bundle_file_is_gone(self):
        self.inject(bundle=False)
        self.assertTrue(vivarc.needs_reapply(self.resources))

    def test_false_when_vivaldi_is_not_installed(self):
        self.assertFalse(vivarc.needs_reapply(os.path.join(self.tmp, "nowhere")))


class Remind(ReminderCase):
    def remind(self, accept, latest=None):
        asked, opened = [], []
        with mock.patch.object(vivarc, "prompt_update", side_effect=lambda m: asked.append(m) or accept), \
                mock.patch.object(vivarc, "latest_release_tag", return_value=latest), \
                mock.patch.object(vivarc, "open_in_terminal", side_effect=opened.append), \
                redirect_stdout(io.StringIO()):
            vivarc.cmd_remind(mock.Mock(app=self.app))
        return asked, opened

    def test_stays_quiet_while_vivarc_is_in_sync(self):
        self.inject()
        self.assertEqual(self.remind(True), ([], []))

    def test_asks_and_runs_the_update_script_when_the_user_agrees(self):
        self.inject(html=False)
        asked, opened = self.remind(True)
        self.assertEqual(len(asked), 1)
        self.assertEqual(opened, [self.command])
        self.assertTrue(os.path.exists(self.command))

    def test_does_nothing_more_when_the_user_says_later(self):
        self.inject(html=False)
        self.assertEqual(self.remind(False)[1], [])

    def test_does_not_ask_again_within_half_a_day(self):
        self.inject(html=False)
        self.remind(False)
        self.assertEqual(self.remind(True), ([], []))

    def test_asks_again_the_next_day(self):
        self.inject(html=False)
        self.remind(False)
        with open(os.path.join(self.home, "reminded")) as f:
            asked_at = float(f.read())
        with mock.patch("time.time", return_value=asked_at + 24 * 3600):
            asked, _ = self.remind(False)
        self.assertEqual(len(asked), 1)


class NewRelease(ReminderCase):
    NEWER = "v" + ".".join(str(int(n) + (1 if k == 2 else 0)) for k, n in enumerate(vivarc.VERSION.split(".")))

    def setUp(self):
        super().setUp()
        self.inject()

    def remind(self, accept, latest):
        return Remind.remind(self, accept, latest)

    def test_asks_to_update_when_a_newer_release_is_out(self):
        asked, opened = self.remind(True, self.NEWER)
        self.assertEqual(len(asked), 1)
        self.assertIn(self.NEWER.lstrip("v"), asked[0])
        self.assertEqual(opened, [self.command])

    def test_stays_quiet_when_up_to_date_or_offline(self):
        self.assertEqual(self.remind(True, "v" + vivarc.VERSION), ([], []))
        self.assertEqual(self.remind(True, None), ([], []))

    def test_does_not_open_the_update_when_the_user_says_later(self):
        self.assertEqual(self.remind(False, self.NEWER)[1], [])

    def test_asks_only_once_per_release(self):
        self.remind(False, self.NEWER)
        self.assertEqual(self.remind(True, self.NEWER), ([], []))

    def test_asks_again_for_an_even_newer_release(self):
        self.remind(False, self.NEWER)
        major, minor, patch = self.NEWER.lstrip("v").split(".")
        asked, _ = self.remind(False, f"v{major}.{minor}.{int(patch) + 1}")
        self.assertEqual(len(asked), 1)

    def test_a_vivaldi_update_gets_one_question_not_two(self):
        self.inject(html=False)
        asked, _ = self.remind(False, self.NEWER)
        self.assertEqual(len(asked), 1)
        self.assertIn("Vivaldi was updated", asked[0])


class AutoReapply(ReminderCase):
    def run_auto(self, running=False, restart=True, writable=True, reapply_fixes=True):
        calls = {"asked": [], "notified": [], "restarted": [], "terminal": [], "applied": []}

        def apply(app, resources, with_peek):
            calls["applied"].append(app)
            if reapply_fixes:
                self.inject()

        with mock.patch.object(vivarc, "can_write", return_value=writable), \
                mock.patch.object(vivarc, "sync_guide"), mock.patch.object(vivarc, "install_pointer_helper"), \
                mock.patch.object(vivarc, "apply_js", side_effect=apply), \
                mock.patch.object(vivarc, "app_running", return_value=running), \
                mock.patch.object(vivarc, "ask_restart", side_effect=lambda: calls["asked"].append(1) or restart), \
                mock.patch.object(vivarc, "restart_app", side_effect=calls["restarted"].append), \
                mock.patch.object(vivarc, "notify", side_effect=calls["notified"].append), \
                mock.patch.object(vivarc, "prompt_update", side_effect=lambda m: calls["asked"].append(m) or True), \
                mock.patch.object(vivarc, "open_in_terminal", side_effect=calls["terminal"].append), \
                mock.patch.object(vivarc, "latest_release_tag", return_value=None), \
                mock.patch("time.sleep"), redirect_stdout(io.StringIO()):
            vivarc.cmd_remind(mock.Mock(app=self.app, auto=True))
        return calls

    def test_puts_vivarc_back_and_offers_a_restart_while_vivaldi_runs(self):
        self.inject(html=False)
        calls = self.run_auto(running=True)
        self.assertEqual(calls["applied"], [self.app])
        self.assertEqual(calls["asked"], [1])
        self.assertEqual(calls["restarted"], [self.app])
        self.assertEqual(calls["terminal"], [])

    def test_later_leaves_vivaldi_running(self):
        self.inject(html=False)
        calls = self.run_auto(running=True, restart=False)
        self.assertEqual(calls["restarted"], [])

    def test_only_a_notification_when_vivaldi_is_closed(self):
        self.inject(html=False)
        calls = self.run_auto(running=False)
        self.assertEqual(calls["applied"], [self.app])
        self.assertEqual(calls["asked"], [])
        self.assertEqual(len(calls["notified"]), 1)

    def test_re_applies_from_terminal_when_macos_blocks_the_background_job(self):
        self.inject(html=False)
        calls = self.run_auto(writable=False)
        self.assertEqual((calls["applied"], calls["asked"]), ([], []))
        self.assertEqual(calls["terminal"], [vivarc.REAPPLY_COMMAND])
        script = open(vivarc.REAPPLY_COMMAND).read()
        self.assertIn("apply --offer-restart", script)
        self.assertIn(self.app, script)
        self.assertTrue(os.access(vivarc.REAPPLY_COMMAND, os.X_OK))

    def test_opens_terminal_at_most_once_per_half_day(self):
        self.inject(html=False)
        self.run_auto(writable=False)
        self.assertEqual(self.run_auto(writable=False)["terminal"], [])

    def test_does_nothing_while_vivarc_is_in_place(self):
        self.inject()
        calls = self.run_auto(running=True)
        self.assertEqual((calls["applied"], calls["asked"], calls["notified"]), ([], [], []))

    def test_agent_runs_remind_auto_and_status_reports_it(self):
        vivarc.enable_reminder(self.app, auto=True)
        with open(self.plist, "rb") as f:
            self.assertEqual(plistlib.load(f)["ProgramArguments"][-2:], ["remind", "--auto"])
        self.assertEqual(vivarc.reminder_state(), "auto")
        vivarc.enable_reminder(self.app)
        self.assertEqual(vivarc.reminder_state(), "on")
        vivarc.disable_reminder()
        self.assertEqual(vivarc.reminder_state(), "off")


class ReminderAgent(ReminderCase):
    def test_on_writes_a_launch_agent_that_runs_remind_and_loads_it(self):
        vivarc.enable_reminder(self.app)
        with open(self.plist, "rb") as f:
            agent = plistlib.load(f)
        self.assertEqual(agent["Label"], "com.vivarc.reminder")
        args = agent["ProgramArguments"]
        self.assertEqual(args[0], "/usr/bin/python3")
        self.assertEqual(args[1], os.path.join(vivarc.HERE, "vivarc.py"))
        self.assertEqual(args[-1], "remind")
        self.assertIn(self.app, args)
        self.assertTrue(agent["RunAtLoad"])
        self.assertIn(os.path.join(self.app, "Contents", "Info.plist"), agent["WatchPaths"])
        self.launchctl.assert_called()

    def test_warns_when_run_from_a_folder_background_jobs_cannot_read(self):
        out = io.StringIO()
        with mock.patch.object(vivarc, "HERE", os.path.join(vivarc.HOME, "Documents", "vivarc")), redirect_stdout(out):
            vivarc.enable_reminder(self.app)
        self.assertIn("Documents", out.getvalue())

    def test_off_unloads_and_deletes_it_and_tolerates_it_being_absent(self):
        vivarc.enable_reminder(self.app)
        vivarc.disable_reminder()
        self.assertFalse(os.path.exists(self.plist))
        vivarc.disable_reminder()

    def test_cli_switches_it_on_and_off(self):
        with redirect_stdout(io.StringIO()):
            vivarc.main(["--app", self.app, "--data-dir", "/data", "reminder", "on"])
            self.assertTrue(os.path.exists(self.plist))
            vivarc.main(["--app", self.app, "--data-dir", "/data", "reminder", "off"])
        self.assertFalse(os.path.exists(self.plist))


if __name__ == "__main__":
    unittest.main()
