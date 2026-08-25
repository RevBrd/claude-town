#!/usr/bin/env node
/* The back door. Opening a FILE, by part of its name, anywhere in the repos
 * Tack already sweeps.
 *
 * This is not a second Marquee and must never become one. Marquee opens
 * WORKS -- a curated, derived catalog that deliberately hides predecessors
 * (`salient_job1.html` is invisible to it on purpose) and deliberately admits
 * nothing that is not a curated collection. This opens FILES, by path, and the
 * filesystem cannot drift from itself. The two answer different questions and
 * neither is the other's fallback list.
 *
 * IT SHARES NO CODE WITH MARQUEE, and that is deliberate rather than lazy.
 * The reason this exists is to still work when Marquee is the thing being
 * inspected -- a half-built Electron shell, a derive.js that throws. A back
 * door that imports the front door is not a back door. Trevor's framing,
 * 24 Aug 2026, and it is the whole argument for the file existing.
 *
 * Two rules, both mechanized below:
 *   - Nothing outside the swept roots is reachable.
 *   - Tack shows you files. It does not run programs.
 */
'use strict';

var fs   = require('fs');
var path = require('path');
var cp   = require('child_process');
var TK   = require('./tack.js');

/* Windows decides what "open" means from the extension, and for a great many
 * of them it means EXECUTE. `.js` is the one that matters here: it is bound to
 * WScript.exe on this machine, so handing `tack.js` to the shell would run it
 * under Windows Script Host rather than show it -- in a tree that is mostly
 * .js. Checked with `ftype`, not assumed.
 *
 * These are readable, so Tack opens them in an EDITOR and says why. Refusing
 * outright would make the back door useless for exactly the infrastructure it
 * exists to reach. */
var RUNS_BUT_READABLE = ['.js', '.jse', '.bat', '.cmd', '.ps1', '.psm1', '.psd1',
                         '.vbs', '.vbe', '.wsf', '.wsh', '.hta', '.reg', '.sh'];

/* These are not documents. There is nothing to show and opening one means
 * running it, so Tack prints the path and stops. */
var NEVER_OPENED = ['.exe', '.com', '.msi', '.msp', '.scr', '.cpl', '.lnk',
                    '.pif', '.jar', '.msc', '.dll', '.sys', '.gadget', '.appref-ms'];

/* An allowlist would be wrong here and the asymmetry is the reason. For git
 * verbs the dangerous set is unbounded and the safe set is tiny, so write.js
 * and undo.js name what is permitted. For opening a file it is the other way
 * round: the dangerous set is small, closed and well known, while the safe set
 * is every document format that exists. Naming the hazards is the honest
 * shape; an allowlist here would just be a list that is always missing
 * something Trevor wanted to look at. */

var TUNE = {
  MAX_DEPTH: 6,       // how far into a repo to look
  MAX_HITS:  12,      // how many matches to print before saying "and N more"
  EDITOR: null,       // null = notepad. Set to a path or a command on PATH.
  SKIP: ['.git', 'node_modules', 'dist', 'backups', 'projects', 'todos',
         'shell-snapshots', 'statsig', 'file-history', 'attic']
};

function editor() { return TUNE.EDITOR || 'notepad'; }

/* ----------------------------------------------------------------- finding */

function walk(root, skip, depth) {
  var out = [];
  (function step(dir, rel, level) {
    var entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { return; }
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (e.isDirectory()) {
        if (skip.indexOf(e.name) !== -1) continue;
        if (level < depth) step(path.join(dir, e.name), rel + e.name + '/', level + 1);
      } else if (e.isFile()) {
        out.push({ rel: rel + e.name, name: e.name, file: path.join(dir, e.name) });
      }
    }
  })(root, '', 0);
  return out;
}

/* Every file in every repo Tack sweeps, each tagged with the repo it is in.
 * The sweep is the containment boundary: a path Tack would not report on is a
 * path Tack will not open. */
function catalogue(state) {
  var files = [];
  state.repos.forEach(function (r) {
    if (r.error) return;
    walk(r.dir, TUNE.SKIP, TUNE.MAX_DEPTH).forEach(function (f) {
      f.repo = r.label;
      f.repoDir = r.dir;
      files.push(f);
    });
  });
  return files;
}

/* ---------------------------------------------------------------- matching */

function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/\\/g, '/'); }
function stem(name) { return name.replace(/\.[^.]+$/, ''); }

/* Best tier first, and the tier is reported. Same rule as everywhere else in
 * this tree: more than one hit is a list, never a guess. Opening the wrong
 * file is quieter than opening the wrong game and just as wrong. */
var TIERS = [
  ['filename',     function (q, f) { return norm(f.name) === q; }],
  ['stem',         function (q, f) { return norm(stem(f.name)) === q; }],
  ['starts with',  function (q, f) { return norm(f.name).indexOf(q) === 0; }],
  ['in the name',  function (q, f) { return norm(f.name).indexOf(q) !== -1; }],
  ['in the path',  function (q, f) { return norm(f.repo + '/' + f.rel).indexOf(q) !== -1; }]
];

function match(query, files) {
  var q = norm(query).trim();
  if (!q) return { tier: null, hits: [] };
  for (var t = 0; t < TIERS.length; t++) {
    var hits = files.filter(function (f) { return TIERS[t][1](q, f); });
    if (hits.length) return { tier: TIERS[t][0], hits: hits };
  }
  return { tier: null, hits: [] };
}

/* A bare repo name opens the folder itself, which is what "open games" means
 * to somebody who wants to go and look at something. */
function matchRepo(query, state) {
  var q = norm(query).trim();
  return state.repos.filter(function (r) {
    return norm(r.label) === q || norm(path.basename(r.dir)) === q;
  });
}

/* ---------------------------------------------------------------- opening */

function kindOf(file) {
  var ext = (String(file).match(/\.[^.\\/]+$/) || [''])[0].toLowerCase();
  if (NEVER_OPENED.indexOf(ext) !== -1)     return 'program';
  if (RUNS_BUT_READABLE.indexOf(ext) !== -1) return 'script';
  return 'document';
}

/* Every path handed to the shell is proven to be inside a swept repo first.
 * Resolution, then containment on the RESULT -- a prefix test on the string
 * would say `Games-Old` is inside `Games`, which is the bug Mains wrote down
 * and there is no reason to learn it twice. */
function isInside(file, roots) {
  var real;
  try { real = fs.realpathSync(file); } catch (e) { real = path.resolve(file); }
  return roots.some(function (root) {
    var r;
    try { r = fs.realpathSync(root); } catch (e) { r = path.resolve(root); }
    return real.toLowerCase().indexOf(r.toLowerCase() + path.sep) === 0;
  });
}

function launch(file, kind) {
  if (kind === 'script') {
    /* Opened to READ. Handing it to the shell would run it. */
    cp.spawn(editor(), [file], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return;
  }
  /* `start` treats a first quoted argument as a window title, so the empty
   * string is required or the path becomes the title and nothing opens. */
  cp.spawn('cmd', ['/c', 'start', '', file],
           { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

module.exports = {
  RUNS_BUT_READABLE: RUNS_BUT_READABLE, NEVER_OPENED: NEVER_OPENED, TUNE: TUNE,
  editor: editor, walk: walk, catalogue: catalogue, norm: norm, stem: stem,
  match: match, matchRepo: matchRepo, kindOf: kindOf, isInside: isInside,
  launch: launch
};
