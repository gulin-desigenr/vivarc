"""Vivarc doctor: checks that the parts of Vivaldi that Vivarc relies on are still there.

Vivarc reaches into Vivaldi through private APIs, preferences, command names, the class names of its UI and its
own webpack modules. None of it is a public interface, so a Vivaldi release can rename or drop any of them.

Two kinds of check:
- static, on the app's files (works with Vivaldi closed, on any copy): the preferences Vivarc reads exist in
  prefs_definitions.json, and its commands, class and id names, toolbar button names and the markers its webpack
  lookups search for all still occur in Vivaldi's UI code;
- live, on a running Vivaldi with DevTools open (--remote-debugging-port, as tools/dev-vivaldi.sh starts the
  copy): src/js/02-doctor.js checks the APIs, preferences, commands, page elements and Vivaldi internals from
  inside the UI, and reports modules that failed to load and errors thrown since start-up.

What Vivarc uses is read from its own source, so the lists never need updating by hand. Standard library only.
"""
import base64
import json
import os
import re
import socket
import struct
import urllib.request

# A comment, or a string / template literal, in JavaScript (left to right, so an apostrophe in a comment is safe).
_JS_TOKENS = re.compile(r"""//[^\n]*|/\*.*?\*/|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`""", re.S)
_SELECTOR_CALL = re.compile(r"""(?:querySelector(?:All)?|closest|matches)\(\s*(["'`])((?:\\.|(?!\1).)*)\1""")
_NAME = re.compile(r"(?<![\w-])[#.](-?[A-Za-z_][\w-]*)")

# Class names Vivarc gives its own elements without the vm- prefix (drag and drop in the sidebar).
OWN_NAMES = {"drop-before", "drop-after", "drop-into"}

# What src/js/07-workspaces.js searches Vivaldi's webpack modules for (tests/test_doctor.py keeps these in step).
INTERNALS = {
    "webpackChunkgapp_browser_react": "Vivaldi's webpack modules",
    "removeWorkspace(": "the workspace manager (create, rename, reorder, delete spaces)",
    "setActiveWorkspace:": "the workspace switcher",
    "activeWorkspaces": "the workspace store (space icons)",
}


def strip_js(js):
    """The code without its comments and the contents of its strings."""
    return _JS_TOKENS.sub(lambda m: " " if m.group(0)[0] == "/" else '""', js)


def strip_comments(js):
    return _JS_TOKENS.sub(lambda m: " " if m.group(0)[0] == "/" else m.group(0), js)


def js_dependencies(js):
    """The Vivaldi and Chrome APIs Vivarc calls, the preferences it reads or writes, and the commands it names."""
    code, live = strip_js(js), strip_comments(js)
    return {
        "apis": sorted(set(re.findall(r"\b((?:chrome|vivaldi)\.[a-zA-Z]+\.[a-zA-Z]+)", code))),
        "prefs": sorted(set(re.findall(r"""["'`](vivaldi\.[a-z_]+(?:\.[a-z_]+)*)["'`]""", live))),
        "commands": sorted(set(re.findall(r"\bCOMMAND_[A-Z0-9_]+\b", live))),
    }


def css_names(css):
    """Vivaldi's class and id names in Vivarc's stylesheet (Vivarc's own start with vm-)."""
    text = re.sub(r"/\*.*?\*/", " ", css, flags=re.S)
    text = re.sub(r"url\([^)]*\)", " ", text)
    text = re.sub(r'"[^"\n]*"', " ", text)
    while True:  # the declarations, innermost first, leaving only selectors and at-rules
        shorter = re.sub(r"\{[^{}]*\}", "{}", text)
        if shorter == text:
            break
        text = shorter
    return {n for n in _NAME.findall(text) if not n.startswith("vm-")} - OWN_NAMES


def js_selector_names(js):
    """Vivaldi's class and id names in the selectors Vivarc's code looks up."""
    names = set()
    for _, selector in _SELECTOR_CALL.findall(js):
        names |= {n for n in _NAME.findall(re.sub(r"\$\{[^}]*\}", " ", selector)) if not n.startswith("vm-")}
    return names - OWN_NAMES


def button_names(css):
    """Toolbar buttons Vivarc styles by name ([data-name="Back"])."""
    return set(re.findall(r'\[data-name="([^"]+)"\]', css))


def ui_code(resources):
    """Vivaldi's own UI code (every script next to window.html but Vivarc's)."""
    parts = []
    for name in sorted(os.listdir(resources)):
        if name.endswith(".js") and name != "vivarc.js":
            with open(os.path.join(resources, name), encoding="utf8", errors="replace") as f:
                parts.append(f.read())
    return "\n".join(parts)


def pref_defined(definitions, path):
    node = definitions
    for key in path.split("."):
        if not isinstance(node, dict) or key not in node:
            return False
        node = node[key]
    return True


def group(name, checked, missing):
    return {"name": name, "checked": len(checked), "missing": sorted(missing)}


def static_checks(resources, js, css):
    """Groups of {name, checked, missing} for what Vivarc uses, looked up in Vivaldi's files."""
    with open(os.path.join(resources, "prefs_definitions.json"), encoding="utf8") as f:
        definitions = json.load(f)
    code = ui_code(resources)
    words = set(re.findall(r"[\w-]+", code))
    deps = js_dependencies(js)
    names = css_names(css) | js_selector_names(js)
    buttons = button_names(css)
    return [
        group("Preferences", deps["prefs"], [p for p in deps["prefs"] if not pref_defined(definitions, p)]),
        group("Commands", deps["commands"], [c for c in deps["commands"] if c not in words]),
        group("Class and id names", names, [n for n in names if n not in words]),
        group("Toolbar buttons", buttons, [b for b in buttons if b not in words]),
        group("Vivaldi internals", INTERNALS, [f"{m} ({why})" for m, why in INTERNALS.items() if m not in code]),
    ]


# ---------------------------------------------------------------- live, over the DevTools protocol
class _Socket:
    """Just enough of a WebSocket client for one DevTools exchange (text frames, no extensions)."""

    def __init__(self, url, timeout):
        match = re.match(r"ws://([^/:]+):(\d+)(/.*)", url)
        if not match:
            raise OSError(f"unexpected DevTools address {url}")
        host, port, path = match.group(1), int(match.group(2)), match.group(3)
        self.sock = socket.create_connection((host, port), timeout=timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((f"GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                           f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise OSError("DevTools closed the connection")
            head += chunk
        if b" 101 " not in head.split(b"\r\n", 1)[0]:
            raise OSError("DevTools refused the connection: " + head.split(b"\r\n", 1)[0].decode(errors="replace"))
        self.buffer = head.split(b"\r\n\r\n", 1)[1]

    def _read(self, n):
        while len(self.buffer) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise OSError("DevTools closed the connection")
            self.buffer += chunk
        data, self.buffer = self.buffer[:n], self.buffer[n:]
        return data

    def send(self, text):
        data = text.encode()
        mask = os.urandom(4)
        size = len(data)
        head = bytes([0x81]) + (bytes([0x80 | size]) if size < 126 else
                                bytes([0x80 | 126]) + struct.pack(">H", size) if size < 65536 else
                                bytes([0x80 | 127]) + struct.pack(">Q", size))
        self.sock.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def receive(self):
        message = b""
        while True:
            first, second = self._read(2)
            size = second & 0x7F
            if size == 126:
                size = struct.unpack(">H", self._read(2))[0]
            elif size == 127:
                size = struct.unpack(">Q", self._read(8))[0]
            payload = self._read(size)
            opcode = first & 0x0F
            if opcode == 8:
                raise OSError("DevTools closed the connection")
            if opcode in (0, 1):
                message += payload
                if first & 0x80:
                    return message.decode()

    def close(self):
        self.sock.close()


def evaluate(port, expression, timeout=20):
    """Evaluate `expression` (a promise is awaited) in the UI of Vivaldi's first window; returns its JSON value."""
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=timeout) as response:
        targets = json.load(response)
    target = next((t for t in targets if t.get("url", "").endswith("/window.html") and t.get("webSocketDebuggerUrl")), None)
    if not target:
        raise OSError("no Vivaldi window found")
    ws = _Socket(target["webSocketDebuggerUrl"], timeout)
    try:
        ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate",
                            "params": {"expression": expression, "awaitPromise": True, "returnByValue": True}}))
        while True:
            reply = json.loads(ws.receive())
            if reply.get("id") == 1:
                break
    finally:
        ws.close()
    result = reply.get("result", {})
    if "exceptionDetails" in result:
        raise OSError(result["exceptionDetails"].get("exception", {}).get("description") or "the check failed in Vivaldi")
    return result.get("result", {}).get("value")


def live_report(port):
    """The report of src/js/02-doctor.js from the running Vivaldi, or None when that Vivarc has no doctor yet."""
    value = evaluate(port, "window.__vm?.doctor ? window.__vm.doctor.run().then(JSON.stringify) : null")
    return json.loads(value) if value else None


def format_group(g):
    if not g["missing"]:
        return [f"  ✓ {g['name']}: {g['checked']}"]
    return [f"  ✗ {g['name']}: {len(g['missing'])} of {g['checked']} missing"] + [f"      {m}" for m in g["missing"]]
