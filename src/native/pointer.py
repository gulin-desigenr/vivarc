"""Vivarc pointer helper: reports where the mouse pointer is and the bounds of the display under it.

Vivaldi's UI cannot read the global pointer position, so Little Vivarc asks this helper which screen the user
clicked on. Coordinates are macOS global points (top-left origin of the main display), the same space Chromium
uses for window bounds. Uses only the standard library (ctypes + CoreGraphics), so it needs no permissions.

Vivaldi's UI has no nativeMessaging permission, but it may fetch any URL, so the helper is a tiny HTTP server on
127.0.0.1 kept running by a LaunchAgent. It sends no CORS headers (web pages cannot read it) and refuses requests
that carry a web page's Origin or another Host name.

It also owns the global Option+Command+N shortcut that opens a blank Little Vivarc from any app.
"""
import ctypes
import ctypes.util
import http.server
import json
import subprocess
import sys
import threading
import time

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


LITTLE_PATH = "/little/new"  # Vivarc turns a tab opening this address into a blank Little Vivarc
LITTLE_PAGE = b"<!doctype html><meta charset=utf-8><title>Little Vivarc</title><p>Opening Little Vivarc&hellip;</p>"


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
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
    """Hand LITTLE_PATH to Vivaldi. A cold start first launches it and gives Vivarc time to load, or the address
    would arrive before anything can catch it."""
    def run():
        if not vivaldi_running():
            subprocess.run(["open", "-b", "com.vivaldi.Vivaldi"], capture_output=True)
            for _ in range(60):
                if vivaldi_running():
                    break
                time.sleep(0.25)
            time.sleep(5)
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
        server = http.server.HTTPServer(("127.0.0.1", port), Handler)
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
