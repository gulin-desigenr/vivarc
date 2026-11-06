import json
import os
import shutil
import subprocess
import unittest


HARNESS = r"""
const fs = require('fs'), vm = require('vm');
const bg = {}, calls = [], listeners = {};
let channel, now = 1e6;
Date.now = () => now;
global.setTimeout = () => 0;
global.BroadcastChannel = class { constructor() { channel = this; } postMessage(v) { calls.push(['message', v]); } };
global.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options?.detail; } };
global.window = { vivaldiWindowId: 7, screen: { availLeft: 100, availTop: 25, availWidth: 1800, availHeight: 1100 },
  __vm: { onMark() {}, settings: { get: k => global.SETTINGS[k] }, workspaces: { of: t => JSON.parse(t?.vivExtData || '{}').workspaceId || 0 } }, dispatchEvent() {} };
global.SETTINGS = {};
global.WHERE = {};
global.fetch = undefined;
global.document = { querySelector() { return null; } };
const all = {};
const on = name => ({ addListener: fn => { (all[name] ||= []).push(fn); listeners[name] = (...a) => all[name].forEach(f => f(...a)); } });
global.chrome = {
  extension: { getBackgroundPage: () => bg },
  windows: { getCurrent: async () => ({ id: 7, width: 1400, height: 1000 }),
    create: async opts => { calls.push(['create', opts]); return {id: 99}; },
    get: async id => ({ id, type: 'normal', width: 1400, height: 1000 }),
    update: async (id, opts) => calls.push(['focus', id, opts]), onRemoved: on('removed') },
  webNavigation: { onCommitted: on('committed') },
  tabs: { onCreated: on('created'), onUpdated: on('updated'), onActivated: on('activated'),
    create: async opts => { calls.push(['tabcreate', opts]); return { id: 50 }; },
    query: async ({windowId}) => windowId === 7 ? [{id: 1, vivExtData: '{"workspaceId":42}'}] : [{id: 2}],
    move: async (id, opts) => { calls.push(['move', id, opts]); global.WHERE[id] = opts.windowId; return { id, vivExtData: '{"group":"old","tiling":{"id":"x"},"other":1}'}; },
    get: async id => ({ id, windowId: global.WHERE[id] ?? 7, url: 'https://news.example/a' }),
    remove: async id => calls.push(['remove', id]),
    update: async (id, opts) => calls.push(['update', id, opts]) }
};
vm.runInThisContext(fs.readFileSync(process.argv[1], 'utf8'));
const tick = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  __BODY__
  console.log(JSON.stringify(calls));
})().catch(e => { console.error(e); process.exitCode = 1; });
"""


def run(body):
    path = os.path.join(os.path.dirname(__file__), '..', 'src', 'js', '15-little-arc.js')
    script = HARNESS.replace('__BODY__', body)
    result = subprocess.run(['node', '-e', script, path], capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


def creates(calls):
    return [c[1] for c in calls if c[0] == 'create']


@unittest.skipUnless(shutil.which('node'), 'node is needed to test Little Arc')
class LittleArc(unittest.TestCase):
    def test_open_and_promote_from_origin_preserving_current_workspace(self):
        calls = run("""
  await window.__vm.openLittleArc({url:'https://example.com'});
  channel.onmessage({data:{action:'promote', windowId:99}});
  await tick();
""")
        self.assertEqual(calls[0][1]['type'], 'popup')
        self.assertEqual(calls[0][1]['url'], 'https://example.com')
        move = next(call for call in calls if call[0] == 'move')
        self.assertEqual((move[1], move[2]['windowId']), (2, 7))
        update = next(call for call in calls if call[0] == 'update')
        self.assertEqual(json.loads(update[2]['vivExtData']), {'other': 1, 'workspaceId': 42})
        self.assertTrue(update[2]['active'])
        self.assertEqual(next(call for call in calls if call[0] == 'focus')[1], 7)

    def test_popup_is_centred_on_the_screen(self):
        opts = creates(run("await window.__vm.openLittleArc({url:'https://example.com'});"))[0]
        self.assertEqual((opts['width'], opts['height']), (980, 750))
        self.assertEqual((opts['left'], opts['top']), (100 + (1800 - 980) // 2, 25 + (1100 - 750) // 2))

    def test_popup_opens_on_the_screen_under_the_pointer(self):
        calls = run("""
  global.fetch = async (url) => { calls.push(['fetch', url]);
    return { json: async () => ({ x: -900, y: 400, display: { left: -1920, top: 0, width: 1920, height: 1080 } }) }; };
  await window.__vm.openLittleArc({url:'https://example.com'});
""")
        self.assertEqual(calls[0], ['fetch', 'http://127.0.0.1:47391/pointer'])
        opts = creates(calls)[0]
        self.assertEqual((opts['left'], opts['top']), (-1920 + (1920 - 980) // 2, 24 + (1056 - 750) // 2))

    def test_falls_back_to_the_window_screen_when_the_helper_is_down(self):
        calls = run("""
  global.fetch = async () => { throw new TypeError('Failed to fetch'); };
  console.warn = () => {};
  await window.__vm.openLittleArc({url:'https://example.com'});
""")
        self.assertEqual(creates(calls)[0]['left'], 100 + (1800 - 980) // 2)

    def test_searches_use_the_engine_chosen_in_vivaldi(self):
        out = run("""
  global.vivaldi = { searchEngines: { getTemplateUrls: async () => ({ defaultSearch: 'g1', templateUrls: [
    { guid: 'd1', url: 'https://duckduckgo.com/?q={searchTerms}' },
    { guid: 'g1', url: '{google:baseURL}search?q={searchTerms}&{google:originalQueryForSuggestion}ie={inputEncoding}' }] }) } };
  calls.push(await window.__vm.defaultSearchUrl('little arc'));
""")
        self.assertEqual(out[0], 'https://www.google.com/search?q=little%20arc&ie=')

    def test_a_blank_little_window_opens_without_a_page(self):
        opts = creates(run("await window.__vm.openLittleArc();"))[0]
        self.assertEqual(opts['url'], 'about:blank')

    def test_link_from_another_app_moves_into_little_window(self):
        calls = run("""
  now += 10000;
  chrome.windows.create = async opts => { calls.push(['create', opts]); if (opts.tabId) WHERE[opts.tabId] = 99; return {id: 99}; };
  listeners.created({ id: 5, windowId: 7, active: true, pendingUrl: 'https://news.example/a' });
  listeners.committed({ tabId: 5, frameId: 0, transitionType: 'link', transitionQualifiers: [] });
  for (let i = 0; i < 10; i++) await tick();
""")
        self.assertEqual(len(creates(calls)), 1)
        opts = creates(calls)[0]
        self.assertEqual((opts['tabId'], opts['type']), (5, 'popup'))
        self.assertEqual([c for c in calls if c[0] == 'remove'], [])

    def test_a_tab_that_cannot_move_is_reopened_in_the_popup_and_closed_in_the_main_window(self):
        calls = run("""
  now += 10000;
  console.warn = () => {};
  chrome.windows.create = async opts => { calls.push(['create', opts]); if (opts.tabId) throw new Error('nope'); return {id: 99}; };
  listeners.created({ id: 5, windowId: 7, active: true, pendingUrl: 'https://news.example/a' });
  listeners.committed({ tabId: 5, frameId: 0, transitionType: 'link', transitionQualifiers: [] });
  for (let i = 0; i < 12; i++) await tick();
""")
        self.assertEqual(creates(calls)[1]['url'], 'https://news.example/a')
        self.assertEqual([c[1] for c in calls if c[0] == 'remove'], [5])

    def test_a_copied_tab_left_in_the_main_window_is_closed(self):
        calls = run("""
  now += 10000;
  listeners.created({ id: 5, windowId: 7, active: true, pendingUrl: 'https://news.example/a' });
  listeners.committed({ tabId: 5, frameId: 0, transitionType: 'link', transitionQualifiers: [] });
  for (let i = 0; i < 12; i++) await tick();
""")
        self.assertEqual(len(creates(calls)), 1)
        self.assertEqual([c[1] for c in calls if c[0] == 'remove'], [5])

    def test_internal_tabs_stay_in_the_main_window(self):
        calls = run("""
  now += 10000;
  const open = (id, extra, commit) => { listeners.created({ id, windowId: 7, active: true, pendingUrl: 'https://x.example', ...extra });
    listeners.committed({ tabId: id, frameId: 0, transitionType: 'link', transitionQualifiers: [], ...commit }); };
  open(1, { openerTabId: 3 });                      // link opened from a page
  open(2, { windowId: 8 });                          // another window handles its own tabs
  open(3, {}, { transitionType: 'auto_bookmark' }); // bookmark
  open(4, {}, { transitionType: 'typed' });         // address bar
  await chrome.tabs.create({ url: 'https://x.example' });
  open(5, {});                                       // created by the Vivaldi/Vivarc UI itself
  now += 5000; SETTINGS.littleExternalLinks = false;
  open(6, {});                                       // setting off
  await tick(); await tick();
""")
        self.assertEqual(creates(calls), [])

    def test_ignores_tabs_restored_at_startup(self):
        calls = run("""
  listeners.created({ id: 5, windowId: 7, active: true, pendingUrl: 'https://news.example/a' });
  listeners.committed({ tabId: 5, frameId: 0, transitionType: 'link', transitionQualifiers: [] });
  await tick();
""")
        self.assertEqual(creates(calls), [])


if __name__ == '__main__':
    unittest.main()
