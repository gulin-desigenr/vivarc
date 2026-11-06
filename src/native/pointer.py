"""Vivarc pointer helper: reports where the mouse pointer is and the bounds of the display under it.

Vivaldi's UI cannot read the global pointer position, so Little Vivarc asks this helper which screen the user
clicked on. Coordinates are macOS global points (top-left origin of the main display), the same space Chromium
uses for window bounds. Uses only the standard library (ctypes + CoreGraphics), so it needs no permissions.

Vivaldi's UI has no nativeMessaging permission, but it may fetch any URL, so the helper is a tiny HTTP server on
127.0.0.1 kept running by a LaunchAgent. It sends no CORS headers (web pages cannot read it) and refuses requests
that carry a web page's Origin or another Host name.

It also owns the global Option+Command+N shortcut that opens a blank Little Vivarc from any app (Vivaldi's windows
wait for it on GET /little/wait, so the press reaches Vivaldi without opening a tab or bringing it forward), and keeps the
daily Vivarc backups: POST /backup?name=... writes ~/.vivarc/backups/<name>.json (the last 30 per profile are
kept), GET /backups lists them and GET /backups/<name> reads one. Those three answer only Vivaldi's UI (its exact
Origin or none, plus an X-Vivarc header), so no web page can read or write a backup.
"""
import ctypes
import ctypes.util
import http.server
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.parse

UI_ORIGIN = "chrome-extension://mpognobbkildjkofajifpdfhcoklimli"


class CGPoint(ctypes.Structure):
    _fields_ = [("x", ctypes.c_double), ("y", ctypes.c_double)]


class CGSize(ctypes.Structure):
    _fields_ = [("width", ctypes.c_double), ("height", ctypes.c_double)]


class CGRect(ctypes.Structure):
    _fields_ = [("origin", CGPoint), ("size", CGSize)]


def pointer_display():
    cg = ctypes.cdll.LoadLibrary(ctypes.util.find_library("CoreGraphics") or
                                 "/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics")
    cf = ctypes.cdll.LoadLibrary(ctypes.util.find_library("CoreFoundation") or
                                 "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
    cg.CGEventCreate.restype = ctypes.c_void_p
    cg.CGEventCreate.argtypes = [ctypes.c_void_p]
    cg.CGEventGetLocation.restype = CGPoint
    cg.CGEventGetLocation.argtypes = [ctypes.c_void_p]
    cg.CGGetDisplaysWithPoint.argtypes = [CGPoint, ctypes.c_uint32, ctypes.POINTER(ctypes.c_uint32), ctypes.POINTER(ctypes.c_uint32)]
    cg.CGDisplayBounds.restype = CGRect
    cg.CGDisplayBounds.argtypes = [ctypes.c_uint32]
    cg.CGMainDisplayID.restype = ctypes.c_uint32
    cf.CFRelease.argtypes = [ctypes.c_void_p]

    event = cg.CGEventCreate(None)
    point = cg.CGEventGetLocation(event)
    if event:
        cf.CFRelease(event)
    display, count = ctypes.c_uint32(0), ctypes.c_uint32(0)
    if cg.CGGetDisplaysWithPoint(point, 1, ctypes.byref(display), ctypes.byref(count)) != 0 or count.value == 0:
        display = ctypes.c_uint32(cg.CGMainDisplayID())
    rect = cg.CGDisplayBounds(display.value)
    return {
        "x": point.x, "y": point.y,
        "display": {"left": rect.origin.x, "top": rect.origin.y, "width": rect.size.width, "height": rect.size.height},
    }


BACKUP_DIR = os.path.join(os.path.expanduser("~"), ".vivarc", "backups")
BACKUP_NAME = re.compile(r"^[\w.-]{1,120}$")
BACKUP_MAX_BYTES = 32 * 1024 * 1024
BACKUP_KEEP = 30


def backup_profile(name):
    """Profile part of a backup name: "Work-2026-11-05" and "Work-2026-11-05-before-restore" -> "Work"."""
    return re.sub(r"-\d{4}-\d{2}-\d{2}(-.*)?$", "", name)


def list_backups(directory=None):
    directory = directory or BACKUP_DIR
    if not os.path.isdir(directory):
        return []
    items = []
    for entry in os.scandir(directory):
        if entry.is_file() and entry.name.endswith(".json"):
            stat = entry.stat()
            items.append({"name": entry.name[:-5], "size": stat.st_size, "modified": int(stat.st_mtime * 1000)})
    return sorted(items, key=lambda item: (item["modified"], item["name"]), reverse=True)


def save_backup(name, body, directory=None, keep=BACKUP_KEEP):
    """Write a backup atomically, then keep only the newest `keep` files of the same profile."""
    directory = directory or BACKUP_DIR
    if not BACKUP_NAME.match(name) or name.startswith("."):
        raise ValueError("bad name")
    data = json.loads(body)
    if not isinstance(data, dict) or data.get("format") != "vivarc-backup":
        raise ValueError("not a Vivarc backup")
    os.makedirs(directory, mode=0o700, exist_ok=True)
    path = os.path.join(directory, name + ".json")
    temp = path + ".tmp"
    with open(temp, "wb") as handle:
        handle.write(body)
    os.chmod(temp, 0o600)
    os.replace(temp, path)
    profile = backup_profile(name)
    same = [item for item in list_backups(directory) if backup_profile(item["name"]) == profile]
    for old in same[keep:]:
        os.remove(os.path.join(directory, old["name"] + ".json"))
    return path


LITTLE_PATH = "/little/new"  # Vivarc turns a tab opening this address into a blank Little Vivarc (fallback)
LITTLE_WAIT = "/little/wait"  # Vivaldi's windows wait here for the shortcut
WAIT_SECONDS = 25
# The Vivaldi whose windows take the shortcut (another copy, such as a development one, may poll the same helper).
LITTLE_APP = os.environ.get("VIVARC_LITTLE_APP", "/Applications/Vivaldi.app/")


class Waiters:
    """The Vivaldi windows waiting for the shortcut. A press goes to exactly one of them, the latest to ask."""

    def __init__(self):
        self.lock = threading.Lock()
        self.waiting = []  # [{"event": Event, "taken": bool}], newest last

    def wait(self, timeout=None):
        entry = {"event": threading.Event(), "taken": False}
        with self.lock:
            self.waiting.append(entry)
        entry["event"].wait(WAIT_SECONDS if timeout is None else timeout)
        with self.lock:
            if entry in self.waiting:
                self.waiting.remove(entry)
        return entry["taken"]

    def give(self):
        with self.lock:
            if not self.waiting:
                return False
            entry = self.waiting.pop()
            entry["taken"] = True
            entry["event"].set()
            return True


WAITERS = Waiters()


def client_app(port):
    """The path of the process on the other end of a local connection (lsof, then ps), or ""."""
    try:
        out = subprocess.run(["lsof", "-nP", f"-iTCP:{port}", "-sTCP:ESTABLISHED", "-Fp"], capture_output=True,
                             text=True, timeout=3).stdout
        for line in out.splitlines():
            if line.startswith("p") and int(line[1:]) != os.getpid():
                return subprocess.run(["ps", "-o", "comm=", "-p", line[1:]], capture_output=True, text=True,
                                      timeout=3).stdout.strip()
    except (OSError, ValueError, subprocess.SubprocessError):
        pass
    return ""
LITTLE_PAGE = b"<!doctype html><meta charset=utf-8><title>Little Vivarc</title><p>Opening Little Vivarc&hellip;</p>"


class Handler(http.server.BaseHTTPRequestHandler):
    def from_ui(self):
        """Only Vivaldi's own UI. Its fetches carry no Origin (it has host permission), while a web page's always do
        on POST and on a cross-site fetch; the X-Vivarc header cannot come from a page without a CORS preflight,
        which this server never grants; and the Host check stops DNS rebinding."""
        host = (self.headers.get("Host") or "").split(":")[0]
        origin = (self.headers.get("Origin") or "").rstrip("/")
        return host in ("127.0.0.1", "localhost") and origin in ("", UI_ORIGIN) and self.headers.get("X-Vivarc") == "1"

    def reply(self, status, body=b"", kind="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        path, _, query = self.path.partition("?")
        if path != "/backup" or not self.from_ui():
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > BACKUP_MAX_BYTES:
            self.send_error(413)
            return
        name = urllib.parse.parse_qs(query).get("name", [""])[0]
        try:
            save_backup(name, self.rfile.read(length))
        except (ValueError, OSError) as error:
            self.reply(400, json.dumps({"error": str(error)}).encode("utf8"))
            return
        self.reply(200, b'{"ok": true}')

    def do_GET(self):
        if self.path.split("?")[0] == "/backups" or self.path.startswith("/backups/"):
            if not self.from_ui():
                self.send_error(404)
                return
            if self.path.split("?")[0] == "/backups":
                self.reply(200, json.dumps({"backups": list_backups()}).encode("utf8"))
                return
            name = urllib.parse.unquote(self.path[len("/backups/"):].split("?")[0])
            path = os.path.join(BACKUP_DIR, name + ".json")
            if not BACKUP_NAME.match(name) or name.startswith(".") or not os.path.isfile(path):
                self.send_error(404)
                return
            with open(path, "rb") as handle:
                self.reply(200, handle.read())
            return
        if self.path.split("?")[0] == LITTLE_WAIT:
            # Only Vivaldi's UI, and only the Vivaldi the shortcut belongs to; others are told to stop asking.
            if not self.from_ui():
                self.send_error(404)
                return
            if not client_app(self.client_address[1]).startswith(LITTLE_APP):
                self.reply(200, b'{"open": false, "stop": true}')
                return
            self.reply(200, json.dumps({"open": WAITERS.wait()}).encode("utf8"))
            return
        if self.path.split("?")[0] == LITTLE_PATH:  # shown only if Vivarc is not running to catch it
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(LITTLE_PAGE)))
            self.end_headers()
            self.wfile.write(LITTLE_PAGE)
            return
        origin = self.headers.get("Origin")
        host = (self.headers.get("Host") or "").split(":")[0]
        # Host check: a rebound DNS name cannot reach the helper from a web page.
        if self.path != "/pointer" or host not in ("127.0.0.1", "localhost") or (origin and origin.rstrip("/") != UI_ORIGIN):
            self.send_error(404)
            return
        try:
            body = json.dumps(pointer_display()).encode("utf8")
        except Exception as error:  # never leave Vivaldi waiting
            body = json.dumps({"error": str(error)}).encode("utf8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


# ---- Global shortcut: Option+Command+N opens a blank Little Vivarc from any app, like Little Arc ----
# Carbon hot keys need no Accessibility permission. The press opens LITTLE_PATH in Vivaldi; Vivarc catches it.
KEY_N, CMD_KEY, OPTION_KEY = 45, 256, 2048


def fourcc(text):
    return int.from_bytes(text.encode("ascii"), "big")


class EventTypeSpec(ctypes.Structure):
    _fields_ = [("eventClass", ctypes.c_uint32), ("eventKind", ctypes.c_uint32)]


class EventHotKeyID(ctypes.Structure):
    _fields_ = [("signature", ctypes.c_uint32), ("id", ctypes.c_uint32)]


HANDLER = ctypes.CFUNCTYPE(ctypes.c_int32, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p)


def vivaldi_running():
    return subprocess.run(["pgrep", "-x", "Vivaldi"], capture_output=True).returncode == 0


def open_little(port):
    """Tell a waiting Vivaldi window to open a blank Little Vivarc. Nothing is opened in Vivaldi itself, so it stays
    where it is (minimised, behind other apps, in its current space). Vivaldi not running is launched hidden and
    gets a few seconds to start waiting. Only when no window waits (an older Vivarc) is LITTLE_PATH opened in
    Vivaldi, which brings it forward."""
    def run():
        if WAITERS.give():
            return
        tries = 6  # a window between two waits asks again at once
        if not vivaldi_running():
            subprocess.run(["open", "-g", "-j", "-b", "com.vivaldi.Vivaldi"], capture_output=True)
            tries = 80
        for _ in range(tries):
            time.sleep(0.25)
            if WAITERS.give():
                return
        subprocess.run(["open", "-b", "com.vivaldi.Vivaldi", f"http://127.0.0.1:{port}{LITTLE_PATH}"], capture_output=True)
    threading.Thread(target=run, daemon=True).start()


def run_hotkey(port):
    """Register the shortcut and run the Carbon event loop on this (main) thread. Returns only on failure."""
    carbon = ctypes.cdll.LoadLibrary("/System/Library/Frameworks/Carbon.framework/Carbon")
    carbon.GetApplicationEventTarget.restype = ctypes.c_void_p
    carbon.InstallEventHandler.argtypes = [ctypes.c_void_p, HANDLER, ctypes.c_ulong, ctypes.POINTER(EventTypeSpec),
                                           ctypes.c_void_p, ctypes.c_void_p]
    carbon.RegisterEventHotKey.argtypes = [ctypes.c_uint32, ctypes.c_uint32, EventHotKeyID, ctypes.c_void_p,
                                           ctypes.c_uint32, ctypes.POINTER(ctypes.c_void_p)]
    target = carbon.GetApplicationEventTarget()
    handler = HANDLER(lambda _call, _event, _data: (open_little(port), 0)[1])
    spec = EventTypeSpec(fourcc("keyb"), 5)  # kEventClassKeyboard, kEventHotKeyPressed
    if carbon.InstallEventHandler(target, handler, 1, ctypes.byref(spec), None, None) != 0:
        return
    ref = ctypes.c_void_p()
    if carbon.RegisterEventHotKey(KEY_N, CMD_KEY | OPTION_KEY, EventHotKeyID(fourcc("vvrc"), 1), target, 0, ctypes.byref(ref)) != 0:
        return
    carbon.RunApplicationEventLoop()


def main(argv):
    port = int(argv[1]) if len(argv) > 1 else 47391
    if len(argv) > 0 and argv[0] == "serve":
        server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
        server.daemon_threads = True
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            run_hotkey(port)
        except Exception as error:  # the pointer service keeps working without the shortcut
            print(f"Little Vivarc shortcut unavailable: {error}", file=sys.stderr)
        thread.join()
    else:
        print(json.dumps(pointer_display()))


if __name__ == "__main__":
    main(sys.argv[1:])
