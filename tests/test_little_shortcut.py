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
        self.assertIn({"open": True, "cold": False}, [r[1] for r in results])

    def test_another_vivaldi_is_told_to_stop_waiting(self):
        with mock.patch.object(self.helper, "client_app", return_value="/Users/x/Applications/Vivaldi Dev.app/Contents/Helper"):
            self.assertEqual(self.wait(), (200, {"open": False, "stop": True}))

    def test_web_pages_cannot_wait(self):
        with mock.patch.object(self.helper, "client_app", return_value=self.helper.LITTLE_APP):
            self.assertEqual(self.wait(headers={})[0], 404)
            self.assertEqual(self.wait(headers={"X-Vivarc": "1", "Origin": "https://evil.example"})[0], 404)

    def test_no_window_waiting_falls_back_to_opening_the_address(self):
        calls = []
        with mock.patch.object(self.helper, "vivaldi_running", return_value=True), \
                mock.patch.object(self.helper.time, "sleep", lambda _s: None), \
                mock.patch.object(self.helper.subprocess, "run", lambda args, **_k: calls.append(args)), \
                mock.patch.object(self.helper.threading, "Thread", lambda target, daemon: mock.Mock(start=target)):
            self.helper.open_little(47391)
        self.assertEqual(calls, [["open", "-b", "com.vivaldi.Vivaldi", "http://127.0.0.1:47391/little/new"]])

    def test_a_cold_launch_is_hidden_and_tells_the_window(self):
        calls, entry = [], {"event": threading.Event(), "taken": False, "cold": False}
        def run(args, **_k):
            calls.append(args)
            self.helper.WAITERS.waiting.append(entry)  # Vivarc starts waiting once Vivaldi is up
        with mock.patch.object(self.helper, "vivaldi_running", return_value=False), \
                mock.patch.object(self.helper.time, "sleep", lambda _s: None), \
                mock.patch.object(self.helper.subprocess, "run", run), \
                mock.patch.object(self.helper.threading, "Thread", lambda target, daemon: mock.Mock(start=target)):
            self.helper.open_little(47391)
        self.assertEqual(calls, [["open", "-g", "-j", "-b", "com.vivaldi.Vivaldi"]])
        self.assertEqual((entry["taken"], entry["cold"]), (True, True))

    def test_a_waiting_window_gets_the_press_without_opening_vivaldi(self):
        calls = []
        self.helper.WAITERS.waiting.append({"event": threading.Event(), "taken": False, "cold": False})
        with mock.patch.object(self.helper.subprocess, "run", lambda args, **_k: calls.append(args)), \
                mock.patch.object(self.helper.threading, "Thread", lambda target, daemon: mock.Mock(start=target)):
            self.helper.open_little(47391)
        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
