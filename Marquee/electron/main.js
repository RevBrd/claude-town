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

/* ------------------------------------------------------------------ window */

function createWindow() {
  var roots = allowedRoots();

  var win = new BrowserWindow({
    width: T.WIDTH,
    height: T.HEIGHT,
    title: 'Marquee',
    autoHideMenuBar: true,
    backgroundColor: '#111',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

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
    if (d.action === 'back') { event.preventDefault(); back(win); }
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
  fileUrlToPath: fileUrlToPath, decide: decide, openPolicy: openPolicy,
  createWindow: createWindow
};
