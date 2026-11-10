import http.client
import http.server
import json
import threading
import time
import unittest
from unittest import mock

from test_backup import load_helper


class LittleShortcut(unittest.TestCase):
    """The helper hands Option+Command+N to a Vivaldi window waiting on /little/wait, instead of opening a tab."""

    def setUp(self):
        self.helper = load_helper()
        self.helper.WAITERS = self.helper.Waiters()
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), self.helper.Handler)
        self.server.daemon_threads = True
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def wait(self, headers=None, results=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_address[1], timeout=10)
        conn.request("GET", "/little/wait", headers=headers if headers is not None else {"X-Vivarc": "1"})
        response = conn.getresponse()
        body = response.read()
        result = (response.status, json.loads(body) if response.status == 200 else None)
        if results is not None:
            results.append(result)
        return result

    def test_a_press_goes_to_one_waiting_window(self):
        results = []
        with mock.patch.object(self.helper, "client_app", return_value=self.helper.LITTLE_APP + "Contents/Helper"):
            threads = [threading.Thread(target=self.wait, kwargs={"results": results}) for _ in range(2)]
            with mock.patch.object(self.helper, "WAIT_SECONDS", 1):
                for t in threads:
                    t.start()
                for _ in range(100):
                    if len(self.helper.WAITERS.waiting) == 2:
                        break
                    time.sleep(0.01)
                self.assertTrue(self.helper.WAITERS.give())
                for t in threads:
                    t.join()
        self.assertEqual(sorted(r[1]["open"] for r in results), [False, True])

    def test_another_vivaldi_is_told_to_stop_waiting(self):
        with mock.patch.object(self.helper, "client_app", return_value="/Users/x/Applications/Vivaldi Dev.app/Contents/Helper"):
            self.assertEqual(self.wait(), (200, {"open": False, "stop": True}))

    def test_web_pages_cannot_wait(self):
        with mock.patch.object(self.helper, "client_app", return_value=self.helper.LITTLE_APP):
            self.assertEqual(self.wait(headers={})[0], 404)
            self.assertEqual(self.wait(headers={"X-Vivarc": "1", "Origin": "https://evil.example"})[0], 404)

    def test_with_no_window_waiting_nothing_is_opened(self):
        calls = []
        with mock.patch.object(self.helper.time, "sleep", lambda _s: None), \
                mock.patch.object(self.helper, "frontmost_app", lambda: None), \
                mock.patch.object(self.helper.subprocess, "run", lambda args, **_k: calls.append(args)), \
                mock.patch.object(self.helper.threading, "Thread", lambda target, daemon: mock.Mock(start=target)):
            self.helper.open_little(47391)
        self.assertEqual(calls, [])

    def test_a_waiting_window_gets_the_press_without_opening_vivaldi(self):
        calls = []
        self.helper.WAITERS.waiting.append({"event": threading.Event(), "taken": False})
        with mock.patch.object(self.helper, "frontmost_app", lambda: None), \
                mock.patch.object(self.helper.subprocess, "run", lambda args, **_k: calls.append(args)), \
                mock.patch.object(self.helper.threading, "Thread", lambda target, daemon: mock.Mock(start=target)):
            self.helper.open_little(47391)
        self.assertEqual(calls, [])



class KeepVivaldiBehind(unittest.TestCase):
    """Opening the Little Vivarc activates Vivaldi and macOS raises its main window too; the app that was in front
    is activated again, then only Vivaldi's key window (the Little Vivarc)."""

    def setUp(self):
        self.helper = load_helper()
        self.calls = []
        self.patch = mock.patch.object(self.helper, "activate", lambda pid: self.calls.append(pid))
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.sleep = mock.patch.object(self.helper.time, "sleep", lambda _s: None)
        self.sleep.start()
        self.addCleanup(self.sleep.stop)

    def test_the_app_you_were_in_comes_back_then_only_the_little_vivarc(self):
        self.assertTrue(self.helper.restore_front((501, "com.figma.Desktop"), (900, "com.vivaldi.Vivaldi")))
        self.assertEqual(self.calls, [501, 900])

    def test_nothing_happens_when_vivaldi_was_already_in_front(self):
        self.assertFalse(self.helper.restore_front((900, "com.vivaldi.Vivaldi"), (900, "com.vivaldi.Vivaldi")))
        self.assertFalse(self.helper.restore_front((901, "com.vivaldi.Vivaldi.vivarcdev"), (900, "com.vivaldi.Vivaldi")))
        self.assertFalse(self.helper.restore_front(None, (900, "com.vivaldi.Vivaldi")))
        self.assertEqual(self.calls, [])

    def test_the_remembered_app_is_used_once_and_only_while_fresh(self):
        front = self.helper.FrontBefore()
        front.remember((501, "com.figma.Desktop"))
        self.assertEqual(front.take(), (501, "com.figma.Desktop"))
        self.assertIsNone(front.take())
        front.remember((501, "com.figma.Desktop"))
        front.at -= 10
        self.assertIsNone(front.take())

    def test_the_app_in_front_is_read_with_lsappinfo(self):
        outputs = iter(['"Figma" ASN:0x0-0x1b01b:\n',
                        '    bundleID="com.figma.Desktop"\n    pid = 501 type="Foreground"\n'])
        with mock.patch.object(self.helper.subprocess, "run",
                               lambda args, **_k: mock.Mock(stdout=next(outputs))):
            self.assertEqual(self.helper.frontmost_app(), (501, "com.figma.Desktop"))

    def test_the_shortcut_remembers_the_app_in_front_before_vivaldi_is_activated(self):
        self.helper.WAITERS = self.helper.Waiters()
        self.helper.FRONT_BEFORE = self.helper.FrontBefore()
        with mock.patch.object(self.helper, "frontmost_app", return_value=(501, "com.figma.Desktop")), \
                mock.patch.object(self.helper.threading, "Thread", lambda target, daemon: mock.Mock(start=lambda: None)):
            self.helper.open_little(47391)
        self.assertEqual(self.helper.FRONT_BEFORE.take(), (501, "com.figma.Desktop"))


if __name__ == "__main__":
    unittest.main()
