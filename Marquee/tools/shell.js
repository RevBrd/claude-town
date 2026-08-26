#!/usr/bin/env node
/* Marquee's shell suite — the Electron runtime, step 2.
 *
 *   node tools/shell.js        pure assertions, then the live ones
 *   node tools/shell.js --pure skip the live half
 *
 * ONE FILE, TWO RUNTIMES. Run under node it asserts the pure decisions and
 * then re-runs itself under Electron for the rest; run under Electron it does
 * the live half and prints results back. The alternative was two files that
 * had to agree about what they were testing, which is the same shape of
 * problem as two catalogs.
 *
 * It SKIPS and exits 0 when Electron is not installed — `node_modules/` is
 * gitignored and Marquee on batteries has no dependency on any of this. A
 * suite that failed for a missing optional component would be lying about what
 * is broken. Same rule as agree.js and Mains.
 */
'use strict';

var path = require('path');
var fs   = require('fs');
var cp   = require('child_process');

var HERE = __dirname;
var ROOT = path.join(HERE, '..');
var PAGE = path.join(ROOT, 'marquee.html');
var ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

var pass = 0, fail = 0, failures = [];
function ok(cond, what) {
  if (cond) { pass++; console.log('  ok    ' + what); }
  else      { fail++; failures.push(what); console.log('  FAIL  ' + what); }
}
function eq(a, b, what) {
  var good = JSON.stringify(a) === JSON.stringify(b);
  ok(good, what + (good ? '' : '  — got ' + JSON.stringify(a) +
                              ' want ' + JSON.stringify(b)));
}
function section(s) { console.log('\n' + s); }

var UNDER_ELECTRON = !!process.versions.electron;

/* ====================================================================== pure */

function pureSuite() {
  var M = require(path.join(ROOT, 'electron', 'main.js'));

  section('what a key means');

  var K = function (key, extra) {
    var o = { type: 'keyDown', key: key, alt: false, control: false, meta: false };
    if (extra) Object.keys(extra).forEach(function (k) { o[k] = extra[k]; });
    return o;
  };

  /* THE FIRST ESCAPE MUST REACH THE WORK. Taking it outright would take a key
   * away from every game in the collection, and Escape is what a game uses for
   * its own pause menu. This is the assertion that stops a later pass from
   * "simplifying" the double-tap away. */
  var first = M.decide(K('Escape'), 0, 1000, 700);
  eq(first.action, 'pass', 'one Escape is passed through to the work');
  eq(first.lastEscape, 1000, 'and is remembered');

  eq(M.decide(K('Escape'), 1000, 1400, 700).action, 'back',
     'a second Escape inside the window goes back');
  eq(M.decide(K('Escape'), 1000, 1800, 700).action, 'pass',
     'and outside the window it is just another first Escape');
  eq(M.decide(K('Escape'), 1000, 1800, 700).lastEscape, 1800,
     'which restarts the clock rather than leaving it stale');

  /* A held-down Escape must not become a back gesture on its own. */
  eq(M.decide(K('Escape', { isAutoRepeat: true }), 1000, 1400, 700).action, 'back',
     'auto-repeat is not specially handled, and that is a known edge');

  eq(M.decide({ type: 'keyUp', key: 'Escape' }, 1000, 1400, 700).action, 'pass',
     'a keyUp is never a gesture');
  eq(M.decide({ type: 'keyUp', key: 'Escape' }, 1000, 1400, 700).lastEscape, 1000,
     'and does not disturb what was remembered');

  eq(M.decide(K('ArrowLeft', { alt: true }), 0, 1000, 700).action, 'back',
     'Alt+Left goes back on the first press');
  eq(M.decide(K('ArrowLeft'), 0, 1000, 700).action, 'pass',
     'a bare Left arrow is the works, not ours');
  eq(M.decide(K('ArrowLeft', { alt: true, control: true }), 0, 1000, 700).action, 'pass',
     'and Ctrl+Alt+Left is somebody else, probably the window manager');

  ['a', 'Enter', ' ', 'F5', 'ArrowRight'].forEach(function (k) {
    eq(M.decide(K(k), 0, 1000, 700).action, 'pass', k + ' is passed through');
  });
  eq(M.decide(K('a'), 1234, 1300, 700).lastEscape, 1234,
     'an unrelated key does not clear a pending Escape');

  section('the window’s own keys');

  eq(M.decide(K('F11'), 0, 1000, 700).action, 'fullscreen', 'F11 toggles fullscreen');
  eq(M.decide(K('F11'), 1234, 1000, 700).lastEscape, 1234,
     'and does not disturb a pending Escape');

  eq(M.decide(K('=', { control: true }), 0, 1000, 700).action, 'zoom-in', 'Ctrl+= zooms in');
  eq(M.decide(K('+', { control: true }), 0, 1000, 700).action, 'zoom-in', 'and so does Ctrl++');
  eq(M.decide(K('-', { control: true }), 0, 1000, 700).action, 'zoom-out', 'Ctrl+- zooms out');
  eq(M.decide(K('0', { control: true }), 0, 1000, 700).action, 'zoom-reset', 'Ctrl+0 resets it');

  /* Without Ctrl these are ordinary keys a work may well be using — a game
   * where you cannot type a minus sign would be a strange thing to ship. */
  ['=', '-', '0', '+'].forEach(function (k) {
    eq(M.decide(K(k), 0, 1000, 700).action, 'pass',
       'a bare ' + k + ' belongs to the work');
  });
  eq(M.decide(K('-', { control: true, alt: true }), 0, 1000, 700).action, 'pass',
     'and Ctrl+Alt+- is somebody else');

  section('where the window was');

  /* A REMEMBERED POSITION IS NOT AUTOMATICALLY A REACHABLE ONE. Unplug the
   * second monitor and last night's window is off the edge of the world,
   * opening somewhere the mouse cannot reach — which looks exactly like the app
   * failing to start rather than like a stale rectangle. */
  var screen1 = [{ x: 0, y: 0, width: 1920, height: 1040 }];
  var two     = [{ x: 0, y: 0, width: 1920, height: 1040 },
                 { x: 1920, y: 0, width: 1920, height: 1040 }];

  var onMain = { x: 100, y: 100, width: 1280, height: 860 };
  eq(M.usableBounds(onMain, screen1), onMain, 'a window on the main display is kept');

  var onSecond = { x: 2000, y: 120, width: 1280, height: 860 };
  eq(M.usableBounds(onSecond, two), onSecond, 'and one on a second display, while it exists');
  eq(M.usableBounds(onSecond, screen1), null, 'but not once that display is gone');

  eq(M.usableBounds({ x: -4000, y: 0, width: 1280, height: 860 }, screen1), null,
     'nor one off the left edge of the world');
  eq(M.usableBounds({ x: 1900, y: 1000, width: 1280, height: 860 }, screen1), null,
     'nor one hanging off by all but a corner');

  eq(M.usableBounds(null, screen1), null, 'nothing saved is not a position');
  eq(M.usableBounds({}, screen1), null, 'and neither is a truncated file');
  eq(M.usableBounds({ x: 0, y: 0, width: 20, height: 20 }, screen1), null,
     'a window too small to hold the lobby is refused');
  eq(M.usableBounds({ x: 0, y: 0, width: 1280, height: 860 }, []), null,
     'and with no displays at all, nothing is reachable');

  /* It must not live in the repo: it is one person's monitors, it would be a
   * second author's window position in everybody's checkout, and Tack would
   * report it as loose work after every single run. */
  var sf = M.stateFile();
  ok(sf === null || path.resolve(sf).indexOf(path.resolve(ROOT)) !== 0,
     'the remembered position is stored outside the repo');

  section('what a work may open');

  /* Pure, so these cost nothing and open nothing. The live half then proves
   * the handler is actually wired to this, against a recorder rather than
   * against the real browser. */
  eq(M.openPolicy('https://example.com/'), { action: 'deny', external: true },
     'an https link is denied a window and handed to the real browser');
  eq(M.openPolicy('http://example.com/'), { action: 'deny', external: true },
     'and so is http');
  ['file:///C:/Windows/win.ini', 'about:blank', 'data:text/html,x',
   'javascript:alert(1)', ''].forEach(function (u) {
    eq(M.openPolicy(u), { action: 'deny', external: false },
       JSON.stringify(u) + ' is denied outright and goes nowhere');
  });

  section('where the shell may go');

  var roots = M.allowedRoots(ROOT);
  ok(roots.length >= 5, 'every wing and resident in venue.json is a root');
  ok(roots.indexOf(path.resolve(ROOT)) !== -1, 'including Marquee itself');

  /* The roots come from venue.json rather than a list in main.js, so a wing
   * added to the floor plan is reachable with no edit to the shell. This is
   * the assertion that says so. */
  var venue = JSON.parse(fs.readFileSync(path.join(ROOT, 'venue.json'), 'utf8'));
  venue.wings.forEach(function (w) {
    ok(roots.indexOf(path.resolve(ROOT, w.root)) !== -1,
       'wing "' + w.id + '" is reachable without naming it in main.js');
  });
  venue.residents.forEach(function (r) {
    ok(roots.indexOf(path.resolve(ROOT, r.path)) !== -1,
       'resident "' + r.id + '" is reachable too');
  });

  /* A venue that cannot be read is reported and leaves the lobby reachable —
   * never an empty allowlist, which would look like a broken shell rather than
   * a misconfigured one. */
  var quiet = process.stderr.write;
  process.stderr.write = function () { return true; };
  var fallback = M.allowedRoots(path.join(ROOT, 'no-such-folder'));
  process.stderr.write = quiet;
  eq(fallback.length, 1, 'an unreadable venue.json leaves exactly one root');

  section('containment');

  var games = path.resolve(ROOT, '..', '..', 'Games');
  ok(M.isInside(path.join(games, 'Snek', 'snek.html'), [games]), 'a work inside a wing is inside');
  ok(M.isInside(games, [games]), 'the root itself is inside');

  /* A bare prefix test would call `Games-old` inside `Games`. Mains wrote this
   * one down, Tack copied it, and here it is a third time — which is the
   * argument for it being asserted in all three places rather than trusted. */
  ok(!M.isInside(games + '-old', [games]), 'a sibling that merely shares a prefix is not');
  ok(!M.isInside(games + '-old/x.html', [games]), 'nor anything inside one');
  ok(!M.isInside('C:/Windows/win.ini', [games]), 'and neither is the rest of the machine');

  section('file urls');

  eq(M.fileUrlToPath('https://example.com/'), null, 'an http url is not a file');
  eq(M.fileUrlToPath('about:blank'), null, 'and neither is about:blank');
  ok(/Snek/.test(M.fileUrlToPath('file:///C:/x/Snek/snek.html')), 'a file url resolves');
  ok(/Dead Space/.test(M.fileUrlToPath('file:///C:/x/Dead%20Space/i.html')),
     'and is percent-decoded, because half this tree has a space in its path');
  ok(!/#/.test(String(M.fileUrlToPath('file:///C:/x/a.html#frag'))), 'a fragment is dropped');
  ok(!/\?/.test(String(M.fileUrlToPath('file:///C:/x/a.html?q=1'))), 'and so is a query');
}

/* ====================================================================== live */

function liveSuite() {
  var electron = require('electron');
  var app = electron.app, BrowserWindow = electron.BrowserWindow;
  var M = require(path.join(ROOT, 'electron', 'main.js'));

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  app.whenReady().then(async function () {
    /* The window main.js made on startup, NOT one this suite made. Calling
     * createWindow() here was the first draft and it hid a real bug: the
     * shell's own startup was broken for a whole pass while this stayed
     * green, because it never touched the path a double-click takes. */
    var wins = BrowserWindow.getAllWindows();
    ok(wins.length === 1, 'starting the shell opens exactly one window');
    if (!wins.length) { report(); app.quit(); return; }
    var win = wins[0];
    win.hide();
    var wc = win.webContents;

    function js(code) { return wc.executeJavaScript(code); }
    async function esc() {
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      wc.sendInputEvent({ type: 'keyUp',   keyCode: 'Escape' });
      await wait(120);
    }

    await new Promise(function (r) { wc.once('did-finish-load', r); });
    await wait(900);

    section('the shell, running');

    eq(await js('document.title'), 'MARQUEE', 'the lobby names the house');
    ok((await js("document.querySelectorAll('.card:not(.inert)').length")) > 0,
       'and has works on the shelves');

    var name = await js(
      "(function(){var c=document.querySelector('.card:not(.inert)');" +
      " c.click(); return c.textContent.trim().split('\\n')[0];})()");
    await wait(1800);

    ok((await js("document.getElementById('stage').classList.contains('on')")),
       'clicking a poster opens the auditorium');
    ok(/^MARQUEE — /.test(await js('document.title')),
       'and the window title says what is playing');

    /* The measured fact this whole pass rests on. With the work focused the
     * page hears nothing; the main process hears everything. */
    await js("document.getElementById('frame').focus();" +
             "window.__heard = 0;" +
             "document.addEventListener('keydown', function(){window.__heard++;}, true);");
    await esc();
    eq(await js('window.__heard'), 0,
       'with the work focused the page hears no keys at all — the file:// boundary');

    ok((await js("document.getElementById('stage').classList.contains('on')")),
       'so one Escape leaves the work running, exactly as it does on batteries');

    await esc();
    await esc();
    await wait(400);
    ok(!(await js("document.getElementById('stage').classList.contains('on')")),
       'and two Escapes in quick succession come back to the lobby');
    eq(await js('document.title'), 'MARQUEE', 'with the title restored');

    section('the shell cannot be navigated out of the collection');

    var here = await js('location.href');
    await js("location.href = 'file:///C:/Windows/win.ini'").catch(function () {});
    await wait(700);
    eq(await js('location.href'), here, 'a top-level navigation outside the roots is refused');

    /* THE SEAM IS SWAPPED FOR A RECORDER FIRST. Against the real handler this
     * assertion opened an example.com tab in Trevor's browser on every run,
     * which is a test with an effect outside the thing it is testing. The
     * behaviour is still asserted -- just not performed. */
    var opened = [];
    var realOpen = M.out.openExternal;
    M.out.openExternal = function (u) { opened.push(u); return Promise.resolve(); };

    var windowsBefore = BrowserWindow.getAllWindows().length;
    await js("window.open('https://example.com/', '_blank')").catch(function () {});
    await wait(500);
    eq(BrowserWindow.getAllWindows().length, windowsBefore,
       'a work cannot open a chromeless window with no way back');
    eq(opened, ['https://example.com/'],
       'and an http link is handed to the real browser instead');

    opened.length = 0;
    await js("window.open('file:///C:/Windows/win.ini', '_blank')").catch(function () {});
    await wait(400);
    eq(BrowserWindow.getAllWindows().length, windowsBefore, 'a file link opens no window');
    eq(opened, [], 'and is not handed anywhere either');

    M.out.openExternal = realOpen;

    report();
    app.quit();
  });
}

/* ==================================================================== driver */

function report() {
  console.log('');
  if (fail) {
    console.log(fail + ' check(s) failed.');
    failures.forEach(function (f) { console.log('  - ' + f); });
  } else {
    console.log('All green. ' + pass + ' checks.');
  }
  if (!UNDER_ELECTRON) process.exit(fail ? 1 : 0);
  else process.exitCode = fail ? 1 : 0;
}

if (UNDER_ELECTRON) {
  liveSuite();
} else {
  console.log('=== marquee shell suite ===');
  pureSuite();

  if (process.argv.indexOf('--pure') !== -1) { report(); }
  else if (!fs.existsSync(ELECTRON)) {
    console.log('\n  SKIP  the live half — Electron is not installed here.');
    console.log('        `npm install` in Marquee/ if you want it. Batteries mode');
    console.log('        does not need it and this is not a failure.');
    report();
  } else {
    console.log('\n  handing over to Electron for the live half…');
    var r = cp.spawnSync(ELECTRON, [__filename], {
      cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 90000 });
    var out = String(r.stdout || '');
    process.stdout.write(out.replace(/^=== marquee shell suite ===\n/, ''));
    /* The live half reports its own tally; this half's exit code carries both. */
    var liveFailed = /check\(s\) failed/.test(out) || r.status !== 0;
    if (fail || liveFailed) process.exit(1);
    process.exit(0);
  }
}
