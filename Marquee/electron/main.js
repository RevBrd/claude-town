/* ============================================================================
   MARQUEE — Electron main process.

   Step 1 (CTown 7) opened marquee.html in a real window and stopped there,
   deliberately and at a clean boundary. This is step 2, and what it buys is
   narrow on purpose:

     - Escape works from inside a running work, which on file:// it cannot.
     - The window says what is playing.
     - The shell cannot be navigated out of the collection, and a work cannot
       open a chromeless window with no way back.

   WHAT IT DELIBERATELY DOES NOT DO IS ORIGIN ISOLATION. The roadmap's step 2
   was a custom scheme per work, to give each one a real origin instead of the
   single `null` bucket every file:// page shares. That is still the right
   destination and it is not this pass, because six works here keep real saves
   in localStorage — Asterism, Asterism Expanded, DRIFT, Nebula Strike,
   Shadowless, Snek — and a fresh origin is a fresh, EMPTY localStorage. The
   saves would not be deleted; they would become unreachable, which to whoever
   set the high score is the same thing. Marquee's own doc lists "an iframed
   game reads the same saves as a double-clicked one" as a measured virtue.
   Trading that away needs a migration, and a migration needs its own pass.
   See CLAUDE.md, "The runtime, and what it is not doing yet".

   Batteries mode is unchanged and this file is not loaded on that path.
   ============================================================================ */

'use strict';

var electron = require('electron');
var path     = require('path');
var fs       = require('fs');

var app           = electron.app;
var BrowserWindow = electron.BrowserWindow;
var shell         = electron.shell;

var HERE = __dirname;
var PAGE = path.join(HERE, '..', 'marquee.html');

/* ------------------------------------------------------------------ tuning */
var T = {
  DOUBLE_MS: 700,   // how long the second Escape has to arrive
  ZOOM_MIN:   -3,   // about half size
  ZOOM_MAX:    4,   // about three times
  WIDTH:    1280,
  HEIGHT:    860
};

/* --------------------------------------------------------- where we may go */

/* Read from venue.json — the same hand-written roots file the derivation uses,
 * and the only list in this project. The shell must not carry a second copy of
 * where the works live: two lists disagree eventually, and the one nobody reads
 * is the one that goes stale. A wing added there is reachable here with no edit
 * to this file. */
function allowedRoots(base) {
  base = base || path.join(HERE, '..');
  var roots = [path.resolve(base)];              // Marquee's own folder
  try {
    var v = JSON.parse(fs.readFileSync(path.join(base, 'venue.json'), 'utf8'));
    (v.wings || []).forEach(function (w) {
      if (w.root) roots.push(path.resolve(base, w.root)); });
    (v.residents || []).forEach(function (r) {
      if (r.path) roots.push(path.resolve(base, r.path)); });
  } catch (e) {
    /* A venue that cannot be read is REPORTED, never quietly treated as empty.
     * An empty allowlist would make the shell look broken rather than
     * misconfigured. Marquee's own folder stays reachable either way, so the
     * lobby still loads and the page's own drift readout can say what is
     * wrong — same rule as a missing root on Mains' panel. */
    process.stderr.write('Marquee shell: could not read venue.json (' +
                         e.message + '). Only the lobby is reachable.\n');
  }
  return roots;
}

/* Containment is checked on the RESOLVED path and with a separator, never as a
 * bare prefix — `Games-old` must not count as inside `Games`. Mains learned
 * this one and Tack copied it; no reason to learn it a third time. */
function isInside(target, roots) {
  var t = path.resolve(target);
  for (var i = 0; i < roots.length; i++) {
    var r = path.resolve(roots[i]);
    if (t === r) return true;
    if (t.toLowerCase().indexOf(r.toLowerCase() + path.sep) === 0) return true;
  }
  return false;
}

function fileUrlToPath(url) {
  if (!/^file:\/\//i.test(url)) return null;
  try {
    var p = decodeURIComponent(String(url).replace(/^file:\/\//i, '')
              .split('#')[0].split('?')[0]);
    if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);      /* /C:/... -> C:/... */
    return path.normalize(p);
  } catch (e) { return null; }
}

/* THE ONE THING THIS PROCESS DOES THAT LEAVES THE MACHINE, and therefore the
 * one thing behind a seam -- the same reasoning as derive.js's reads, one
 * layer down. The suite has to be able to assert that an http link goes to the
 * real browser WITHOUT a browser tab actually opening: a suite with an effect
 * outside the program it is testing is not a suite, it is a side effect with
 * assertions attached.
 *
 * Learned the hard way. The first version of tools/shell.js called
 * window.open('https://example.com/') against the real handler, so every run
 * of it opened a tab in Trevor's Chrome. Three runs, three tabs, and he was
 * the one who noticed. */
var out = {
  openExternal: function (url) { return shell.openExternal(url); }
};

/* What to do with a window a work tried to open. Pure, so the decision can be
 * asserted without anything being opened at all.
 *
 * http(s) goes to the real browser, where there is a back button and an
 * address bar. Everything else -- file:, javascript:, data:, about: -- is
 * refused outright rather than opened in a chromeless window nobody can get
 * out of. */
function openPolicy(url) {
  return { action: 'deny', external: /^https?:/i.test(String(url)) };
}

/* Everything the shell does with a key, as a pure decision. Kept out of the
 * event handler so the suite can drive it without a window: given the last
 * Escape time and this key, what happens? */
function decide(input, lastEscape, now, doubleMs) {
  if (input.type !== 'keyDown') return { action: 'pass', lastEscape: lastEscape };

  /* The conventional Back gesture. No work in the collection uses Alt+Left, so
   * unlike Escape it can be taken on the first press. */
  if (input.key === 'ArrowLeft' && input.alt && !input.control && !input.meta) {
    return { action: 'back', lastEscape: 0 };
  }
  /* The window's own keys. F11 is the browser's fullscreen key rather than
   * anything a game reaches for, and the zoom trio is Ctrl-modified, so neither
   * takes a key off a work the way a bare Escape would. */
  if (input.key === 'F11') return { action: 'fullscreen', lastEscape: lastEscape };
  if (input.control && !input.alt && !input.meta) {
    if (input.key === '=' || input.key === '+') return { action: 'zoom-in',  lastEscape: lastEscape };
    if (input.key === '-' || input.key === '_') return { action: 'zoom-out', lastEscape: lastEscape };
    if (input.key === '0')                      return { action: 'zoom-reset', lastEscape: lastEscape };
  }

  if (input.key !== 'Escape') return { action: 'pass', lastEscape: lastEscape };

  /* THE FIRST ESCAPE IS LET THROUGH ON PURPOSE. Taking it outright would take a
   * key away from every work in the collection, and Escape is what a game uses
   * for its own pause menu. The first press reaches the work exactly as it does
   * today; only a second press inside the window is intercepted. Nothing here
   * can consume that gesture, and nothing loses a key it used to have. */
  if (lastEscape && (now - lastEscape) < doubleMs) {
    return { action: 'back', lastEscape: 0 };
  }
  return { action: 'pass', lastEscape: now };
}

/* --------------------------------------------------- where the window was */

/* Kept in Electron's userData folder, NOT in this repo. It is a fact about one
 * person's monitors on one machine — committing it would put a second author's
 * window position into everybody's checkout, and Tack would report it as loose
 * work after every single run. */
function stateFile() {
  try { return path.join(app.getPath('userData'), 'window.json'); }
  catch (e) { return null; }
}

function readBounds() {
  var f = stateFile();
  if (!f) return null;
  try {
    var b = JSON.parse(fs.readFileSync(f, 'utf8'));
    return usableBounds(b, electron.screen.getAllDisplays().map(function (d) { return d.workArea; }));
  } catch (e) { return null; }
}

/* A REMEMBERED POSITION IS NOT AUTOMATICALLY A REACHABLE ONE. Unplug the second
 * monitor and last night's window is off the edge of the world, opening
 * somewhere the mouse cannot go — which looks exactly like the app failing to
 * start. So the saved rectangle has to overlap some display that exists now,
 * and anything else falls back to the default. Pure, so it is asserted without
 * a second monitor to hand. */
function usableBounds(b, areas) {
  if (!b || typeof b.width !== 'number' || typeof b.height !== 'number') return null;
  if (b.width < 480 || b.height < 360) return null;
  if (typeof b.x !== 'number' || typeof b.y !== 'number') return null;

  var VISIBLE = 80;   /* px of the window that must land on a real display */
  var ok = (areas || []).some(function (a) {
    var overlapX = Math.min(b.x + b.width,  a.x + a.width)  - Math.max(b.x, a.x);
    var overlapY = Math.min(b.y + b.height, a.y + a.height) - Math.max(b.y, a.y);
    return overlapX >= VISIBLE && overlapY >= VISIBLE;
  });
  return ok ? b : null;
}

function saveBounds(win) {
  var f = stateFile();
  if (!f || win.isDestroyed()) return;
  try {
    /* Never the fullscreen or maximised rectangle — restoring into fullscreen
     * with no menu bar and no title bar is a room with the door painted over. */
    if (win.isFullScreen() || win.isMaximized()) return;
    fs.writeFileSync(f, JSON.stringify(win.getNormalBounds()));
  } catch (e) { /* a window position is not worth an error dialog */ }
}

/* ------------------------------------------------------------------ window */

function createWindow() {
  var roots = allowedRoots();
  var saved = readBounds();

  var opts = {
    width: T.WIDTH,
    height: T.HEIGHT,
    minWidth: 480,
    minHeight: 360,
    title: 'Marquee',
    icon: path.join(HERE, '..', 'marquee.ico'),
    autoHideMenuBar: true,
    backgroundColor: '#0a0910',   /* --night, so the frame does not flash grey */
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  };
  if (saved) {
    opts.x = saved.x; opts.y = saved.y;
    opts.width = saved.width; opts.height = saved.height;
  }

  var win = new BrowserWindow(opts);

  var saveT = null;
  function rememberSoon() {
    clearTimeout(saveT);
    saveT = setTimeout(function () { saveBounds(win); }, 400);
  }
  win.on('resize', rememberSoon);
  win.on('move', rememberSoon);
  win.on('close', function () { clearTimeout(saveT); saveBounds(win); });

  /* ---- Escape, twice ------------------------------------------------------
   * The one thing this shell exists to fix. On file:// the launcher stops
   * receiving keys the moment a work has focus — both sides are opaque origin
   * `null` — which is why the bezel carries a visible Back button and cannot
   * hide. Measured in Electron on 25 Aug 2026, not assumed: with the iframe
   * holding focus, the main process still saw the key and the page saw nothing
   * at all. */
  var lastEscape = 0;
  win.webContents.on('before-input-event', function (event, input) {
    /* One clock, always. Electron’s before-input-event carries no timestamp,
     * so `input.timeStamp || Date.now()` looked like a fallback and was really
     * a way to mix two clocks if one ever appeared -- and a delta between two
     * different clocks is nonsense in whichever direction it lands. */
    var d = decide(input, lastEscape, Date.now(), T.DOUBLE_MS);
    lastEscape = d.lastEscape;
    if (d.action === 'pass') return;
    event.preventDefault();

    if (d.action === 'back') { back(win); return; }
    if (d.action === 'fullscreen') { win.setFullScreen(!win.isFullScreen()); return; }

    /* Zoom is the window's, not the page's, so it scales a running work along
     * with the lobby — which is the point on a large monitor. Clamped, because
     * a zoom level nobody can read is a window nobody can fix without deleting
     * a file they do not know about. */
    var wc = win.webContents, z = wc.getZoomLevel();
    if (d.action === 'zoom-in')    wc.setZoomLevel(Math.min(z + 0.5, T.ZOOM_MAX));
    if (d.action === 'zoom-out')   wc.setZoomLevel(Math.max(z - 0.5, T.ZOOM_MIN));
    if (d.action === 'zoom-reset') wc.setZoomLevel(0);
  });

  /* ---- the shell cannot be navigated out of the collection -----------------
   * There is no address bar, no reload and no tabs, so a top-level navigation
   * anywhere else is a dead end with no way back. A work is loaded into the
   * iframe by the page; it is never reached by navigating this window. */
  win.webContents.on('will-navigate', function (event, url) {
    var p = fileUrlToPath(url);
    if (p && isInside(p, roots)) return;
    event.preventDefault();
    process.stderr.write('Marquee shell: refused to navigate to ' + url + '\n');
    if (openPolicy(url).external) out.openExternal(url);
  });

  /* Same for a new window: an http link goes to the real browser, where there
   * is a back button and an address bar. Anything else is refused rather than
   * opened in a chromeless window nobody can get out of. */
  win.webContents.setWindowOpenHandler(function (details) {
    var p = openPolicy(details.url);
    if (p.external) out.openExternal(details.url);
    return { action: p.action };
  });

  win.loadFile(PAGE);
  return win;
}

/* The page decides what going back MEANS; the shell only says when. Sent as an
 * event rather than by calling into the page's internals, so the page can
 * change how it leaves a work without this file knowing. On batteries nothing
 * ever fires it and the listener costs nothing. */
function back(win) {
  win.webContents.executeJavaScript(
    "window.dispatchEvent(new CustomEvent('marquee:back'))"
  ).catch(function () { /* the page is mid-load; the key was simply early */ });
}

/* The only condition is whether there is an Electron app to start at all.
 *
 * `require.main === module` was the first draft and it is WRONG HERE, which
 * cost a window: Electron does not load the entry the way node does, so the
 * guard was false in the real shell and no window was ever created. The suite
 * passed the whole time, because it called createWindow() itself and never
 * went near the startup path. Verified by looking for the window rather than
 * by reasoning about it -- Get-Process, MainWindowTitle, empty.
 *
 * Under plain node `require('electron')` is a string (the path to the binary),
 * so `electron.app` is undefined and nothing starts. Under Electron it always
 * starts, INCLUDING when the suite requires it -- which is the point: the
 * suite now drives the same startup the double-click does. */
if (electron.app) {
  app.whenReady().then(createWindow);

  app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

module.exports = {
  T: T, out: out, allowedRoots: allowedRoots, isInside: isInside,
  usableBounds: usableBounds, stateFile: stateFile,
  fileUrlToPath: fileUrlToPath, decide: decide, openPolicy: openPolicy,
  createWindow: createWindow
};
