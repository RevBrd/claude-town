#!/usr/bin/env node
/* Tack -- a small creature that shows you what is still held together with pins.
 *
 * PASS 1 IS READ-ONLY. Not one write, not one staged file. The allowlist in
 * git() is the mechanism, not a promise: widening it is a deliberate edit in a
 * single visible place, and tools/selftest.js goes red if it widens by accident.
 *
 * A tack is a loose temporary stitch that holds two pieces of cloth together
 * until the real seam is sewn. Uncommitted work is exactly that. The metaphor
 * lives in the chrome and nowhere else -- every number and every word in the
 * data is the real git word, because the point of this tool is that you end up
 * not needing it.
 */
'use strict';

var fs   = require('fs');
var path = require('path');
var os   = require('os');
var cp   = require('child_process');

/* ------------------------------------------------------------------ tuning */
/* Everything adjustable lives here. */
var T = {
  LIVE_MINUTES:   10,   // a file touched this recently means a session may be mid-write
  STALE_DAYS:      2,   // loose work older than this is drift worth pointing at
  PREVIEW_FILES:   2,   // how many filenames to show per repo before "+N"
  LABEL_MAX:      24,   // repo name column
  PREVIEW_MAX:    32,   // filename column
  SCAN_TIMEOUT:  8000,  // ms per git call
  ASCII:       false    // plain ` and ' instead of box-drawing, for a console that needs it
};

/* The whole of pass 1's authority over your machine. To widen this you have to
 * mean it, and the selftest asserts both the contents of the list and that the
 * choke point actually refuses what is not on it. */
var READ_ONLY_VERBS = ['status', 'log', 'rev-parse', '--version'];

/* --------------------------------------------------------------------- git */

function git(repo, args) {
  var verb = args[0];
  if (READ_ONLY_VERBS.indexOf(verb) === -1) {
    throw new Error(
      'Tack refused to run `git ' + verb + '`. Pass 1 is read-only; the ' +
      'allowlist is READ_ONLY_VERBS in tack.js.');
  }
  var r = cp.spawnSync('git', ['-C', repo].concat(args), {
    encoding: 'buffer', timeout: T.SCAN_TIMEOUT, windowsHide: true });
  if (r.error && r.error.code === 'ENOENT') {
    throw new Error('git is not on PATH. Tack needs it.');
  }
  return {
    ok:  r.status === 0,
    out: r.stdout ? r.stdout.toString('utf8') : '',
    err: r.stderr ? r.stderr.toString('utf8') : ''
  };
}

/* ------------------------------------------------------------- discovery */

function expandHome(p) {
  return p.replace(/^~(?=[\/\\]|$)/, os.homedir());
}

/* Finds .git at every level down to `depth`, and does NOT stop at the first
 * one -- ~/.claude is a repo containing another repo (Pet), and pruning would
 * hide it. */
function findRepos(root, depth, skip) {
  var found = [];
  function walk(dir, level) {
    var entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { return; }
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].name === '.git' && entries[i].isDirectory()) found.push(dir);
    }
    if (level >= depth) return;
    for (var j = 0; j < entries.length; j++) {
      var e = entries[j];
      if (!e.isDirectory()) continue;
      if (skip.indexOf(e.name) !== -1) continue;
      walk(path.join(dir, e.name), level + 1);
    }
  }
  walk(root, 0);
  return found;
}

function loadRoots(file) {
  var cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { roots: cfg.roots, skip: cfg.skip || ['.git'] };
}

function discover(cfg) {
  var seen = {}, out = [], missing = [];
  for (var i = 0; i < cfg.roots.length; i++) {
    var r = cfg.roots[i];
    var abs = path.resolve(expandHome(r.path));
    if (!fs.existsSync(abs)) { missing.push(r.path); continue; }
    var hits = findRepos(abs, r.depth == null ? 2 : r.depth, cfg.skip);
    for (var j = 0; j < hits.length; j++) {
      var k = hits[j].toLowerCase();
      if (seen[k]) continue;
      seen[k] = 1;
      out.push(hits[j]);
    }
  }
  out.sort();
  return { repos: out, missingRoots: missing };
}

/* --------------------------------------------------- status parsing (pure) */

/* `git status --porcelain=v2 --branch -z`. Every record is NUL-terminated,
 * headers included. Kept pure and separate so the selftest can drive it with
 * fixtures instead of a real repo. */
function parseStatusV2(text) {
  var out = { branch: null, upstream: null, ahead: 0, behind: 0, files: [] };
  var toks = text.split('\0');
  for (var i = 0; i < toks.length; i++) {
    var t = toks[i];
    if (!t) continue;
    if (t.charAt(0) === '#') {
      var m = t.match(/^# branch\.head (.*)$/);       if (m) { out.branch = m[1]; continue; }
      m     = t.match(/^# branch\.upstream (.*)$/);   if (m) { out.upstream = m[1]; continue; }
      m     = t.match(/^# branch\.ab \+(\d+) -(\d+)/);
      if (m) { out.ahead = +m[1]; out.behind = +m[2]; }
      continue;
    }
    var kind = t.charAt(0);
    if (kind === '1') {
      var f = t.split(' ');
      out.files.push({ path: f.slice(8).join(' '), xy: f[1], state: 'tracked' });
    } else if (kind === '2') {
      var g = t.split(' ');
      out.files.push({ path: g.slice(9).join(' '), xy: g[1], state: 'renamed' });
      i++; /* the record that follows a rename is its original path */
    } else if (kind === 'u') {
      var u = t.split(' ');
      out.files.push({ path: u.slice(10).join(' '), xy: u[1], state: 'unmerged' });
    } else if (kind === '?') {
      out.files.push({ path: t.slice(2), xy: '??', state: 'untracked' });
    }
    /* '!' ignored entries are not requested and would be dropped here anyway */
  }
  return out;
}

/* A file's headline word, in git's vocabulary rather than a friendlier one. */
function describe(f) {
  if (f.state === 'untracked') return 'untracked';
  if (f.state === 'unmerged')  return 'conflicted';
  if (f.state === 'renamed')   return 'renamed';
  var x = f.xy.charAt(0), y = f.xy.charAt(1);
  if (y === 'D' || x === 'D')  return 'deleted';
  if (x === 'A')               return 'added';
  if (x !== '.')               return 'staged';
  return 'modified';
}

/* ------------------------------------------------------------ repo reading */

/* opts.untracked: 'normal' collapses an untracked folder to one entry (right
 * for the glance), 'all' lists every file inside it (right for `tack show`). */
function readRepo(dir, now, opts) {
  opts = opts || {};
  var rec = {
    dir: dir, label: labelFor(dir), branch: null, upstream: null,
    ahead: 0, behind: 0, files: [], loose: 0,
    oldest: null, newest: null, empty: false, live: false, error: null
  };

  var st = git(dir, ['status', '--porcelain=v2', '--branch', '-z',
                     '--untracked-files=' + (opts.untracked || 'normal')]);
  if (!st.ok) { rec.error = firstLine(st.err) || 'git status failed'; return rec; }

  var parsed = parseStatusV2(st.out);
  rec.branch   = parsed.branch;
  rec.upstream = parsed.upstream;
  rec.ahead    = parsed.ahead;
  rec.behind   = parsed.behind;
  rec.files    = parsed.files;
  rec.loose    = parsed.files.length;

  /* porcelain v2 reports an unborn branch inconsistently across versions, so
   * ask the reliable question instead. */
  var head = git(dir, ['rev-parse', '--verify', 'HEAD']);
  rec.empty = !head.ok;

  if (!rec.empty) {
    var lg = git(dir, ['log', '-1', '--format=%ct\x1f%s\x1f%an']);
    if (lg.ok) {
      var p = lg.out.trim().split('\x1f');
      rec.last = { when: (+p[0]) * 1000, subject: p[1] || '', who: p[2] || '' };
    }
  }

  /* Age comes from the working tree, not from git -- how long has this been
   * sitting, and is somebody editing it right now? */
  for (var i = 0; i < rec.files.length; i++) {
    var full = path.join(dir, rec.files[i].path);
    var mt;
    try { mt = fs.statSync(full).mtimeMs; } catch (e) { continue; }
    rec.files[i].mtime = mt;
    if (rec.oldest === null || mt < rec.oldest) rec.oldest = mt;
    if (rec.newest === null || mt > rec.newest) rec.newest = mt;
  }
  if (rec.newest !== null && now - rec.newest < T.LIVE_MINUTES * 60000) rec.live = true;

  return rec;
}

function firstLine(s) { return (s || '').split('\n')[0].trim(); }

function labelFor(dir) {
  var rel = path.relative(os.homedir(), dir).replace(/\\/g, '/');
  if (rel && rel.indexOf('..') !== 0) {
    return rel.replace(/^Projects\//, '') || path.basename(dir);
  }
  return dir.replace(/\\/g, '/');
}

/* ---------------------------------------------------------------- sweeping */

function sweep(cfgFile, now) {
  var cfg  = loadRoots(cfgFile);
  var disc = discover(cfg);
  var repos = disc.repos.map(function (d) { return readRepo(d, now); });

  /* Loose work first, longest-sitting at the top -- the drift is the point of
   * the list, so it does not get buried under things that are fine. */
  repos.sort(function (a, b) {
    var ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 0) return (a.oldest || 0) - (b.oldest || 0);
    return a.label.localeCompare(b.label);
  });

  return {
    now: now,
    repos: repos,
    missingRoots: disc.missingRoots,
    totals: {
      repos:  repos.length,
      dirty:  repos.filter(function (r) { return r.loose > 0; }).length,
      files:  repos.reduce(function (n, r) { return n + r.loose; }, 0),
      empty:  repos.filter(function (r) { return r.empty; }).length,
      errors: repos.filter(function (r) { return r.error; }).length,
      oldest: repos.reduce(function (m, r) {
        return r.oldest !== null && (m === null || r.oldest < m) ? r.oldest : m; }, null)
    }
  };
}

function rank(r) {
  if (r.error)   return 0;
  if (r.loose)   return 0;
  if (r.empty)   return 1;
  return 2;
}

/* ------------------------------------------------------------------ render */

var C = {
  on: true,
  wrap: function (code, s) { return C.on ? '\x1b[' + code + 'm' + s + '\x1b[0m' : String(s); },
  dim:   function (s) { return C.wrap('38;5;242', s); },
  chrome:function (s) { return C.wrap('38;5;245', s); },
  warm:  function (s) { return C.wrap('38;5;179', s); },  // loose work: amber
  good:  function (s) { return C.wrap('38;5;108', s); },  // clean: sage
  alert: function (s) { return C.wrap('38;5;174', s); },  // wrong: dusty red
  body:  function (s) { return C.wrap('38;5;252', s); },
  live:  function (s) { return C.wrap('38;5;116', s); }   // someone is typing: cool
};

/* Tack, seen from the side: a round head and a point. The eyes are the only
 * thing that changes, and they change only because of what was found. */
/* Box-drawing rather than ` and ', because those two are a grave accent and a
 * straight quote in most terminal fonts and the head comes out lopsided. These
 * glyphs have one shape everywhere. --ascii keeps the old form for a console
 * that cannot draw them. */
function creature(mood, ascii) {
  var eyes = { pleased: '^ ^', awake: 'o o', alert: 'O O', puzzled: 'o -' }[mood] || 'o o';
  /* Equal width, or the three lines shear against the text beside them. */
  if (ascii || T.ASCII) return [' ,---. ', '( ' + eyes + ' )', " `-|-' "];
  return [' ╭─────╮', ' │ ' + eyes + ' │', ' ╰──┬──╯'];
}

function moodOf(s) {
  if (s.totals.errors) return 'alert';
  if (s.totals.empty && !s.totals.files) return 'puzzled';
  if (s.totals.files)  return 'awake';
  return 'pleased';
}

function ago(ms, now) {
  if (ms === null || ms === undefined) return '';
  var d = Math.max(0, now - ms), m = d / 60000;
  if (m < 1)    return 'now';
  if (m < 60)   return Math.round(m) + 'm';
  if (m < 1440) return Math.round(m / 60) + 'h';
  var days = Math.round(m / 1440);
  if (days < 14) return days + 'd';
  return Math.round(days / 7) + 'w';
}

function pad(s, n)  { s = String(s); return s.length >= n ? s : s + Array(n - s.length + 1).join(' '); }
function lpad(s, n) { s = String(s); return s.length >= n ? s : Array(n - s.length + 1).join(' ') + s; }
function clip(s, n) { s = String(s); return s.length <= n ? s : s.slice(0, n - 1) + '…'; }

/* Colour codes must not count toward column width. */
function visLen(s) { return String(s).replace(/\x1b\[[0-9;]*m/g, '').length; }
function trimEnd(s) { return String(s).replace(/\s+$/, ''); }
function spaces(n) { return n > 0 ? Array(n + 1).join(' ') : ''; }
function padVis(s, n) { return s + spaces(n - visLen(s)); }

/* Fit as many whole names as the column takes, then count the rest. Truncating
 * a second name to "Shadowle…" spends eight columns saying nothing; "+2" says
 * the same thing in two and is true. */
function previewOf(r, width) {
  if (r.error) return r.error;
  if (r.empty && !r.loose) return 'no commits yet';
  if (!r.loose) return 'clean';
  width = width || T.PREVIEW_MAX;

  var names = r.files.map(function (f) { return f.path.replace(/\\/g, '/'); });
  var shown = [], i;
  for (i = 0; i < names.length && shown.length < T.PREVIEW_FILES; i++) {
    var next = shown.concat([names[i]]).join(', ');
    var tail = names.length - (shown.length + 1);
    var cost = next.length + (tail > 0 ? String(' +' + tail).length : 0);
    if (shown.length && cost > width) break;
    shown.push(names[i]);
  }
  var rest = names.length - shown.length;
  var s = clip(shown.join(', '), width - (rest > 0 ? String(' +' + rest).length : 0));
  if (rest > 0) s += ' +' + rest;
  return s;
}

function render(s) {
  var L = [], now = s.now, t = s.totals;
  var head = creature(moodOf(s));

  var line1, line2;
  if (t.files) {
    /* "loose", not "files loose" -- git collapses an untracked folder into one
     * entry, so a count of entries is not a count of files and must not claim
     * to be. `tack show` expands the folder; the glance does not. */
    line1 = C.body('tack') + C.dim(' · ') + C.warm(t.files + ' loose') +
            C.dim(' in ') + C.body(t.dirty) + C.dim(' of ' + t.repos + ' repos');
    line2 = C.dim('oldest has been sitting ') + C.body(ago(t.oldest, now));
  } else {
    line1 = C.body('tack') + C.dim(' · ') + C.good('everything is committed') +
            C.dim(' · ' + t.repos + ' repos');
    line2 = C.dim('nothing loose anywhere');
  }
  if (t.empty)  line2 += C.dim('  ·  ') + C.chrome(t.empty + ' with no commits');
  if (t.errors) line2 += C.dim('  ·  ') + C.alert(t.errors + ' unreadable');

  L.push('');
  L.push('  ' + C.chrome(head[0]));
  L.push('  ' + C.chrome(head[1]) + '   ' + line1);
  L.push('  ' + C.chrome(head[2]) + '   ' + line2);
  L.push('');

  var w = Math.min(T.LABEL_MAX, s.repos.reduce(function (m, r) {
    return Math.max(m, r.label.length); }, 4));

  for (var i = 0; i < s.repos.length; i++) {
    var r = s.repos[i];
    var name = clip(r.label, T.LABEL_MAX);
    var count, prev = previewOf(r, T.PREVIEW_MAX), when = '';

    if (r.error)      { count = C.alert(lpad('!', 3)); prev = C.alert(prev); }
    else if (r.loose) { count = C.warm(lpad(r.loose, 3)); prev = C.body(prev); when = ago(r.oldest, now); }
    else if (r.empty) { count = C.chrome(lpad('—', 3)); prev = C.chrome(prev); }
    else              { count = C.dim(lpad('·', 3)); prev = C.dim(prev); }

    var tail = r.live ? C.live(lpad('live', 6)) : C.dim(lpad(when, 6));
    var flags = '';
    if (r.ahead)  flags += C.dim(' ↑' + r.ahead);
    if (r.behind) flags += C.dim(' ↓' + r.behind);

    L.push('  ' + (r.loose ? C.body(pad(name, w)) : C.dim(pad(name, w))) +
           ' ' + count + '  ' + padVis(prev, T.PREVIEW_MAX + 2) + tail + flags);
  }
  L.push('');
  if (t.files) {
    L.push('  ' + C.dim('`tack show <name>` for the file list · `tack sit` to commit'));
    L.push('  ' + C.dim('nothing here can restore, reset or undo your work.'));
    L.push('');
  }
  for (var k = 0; k < s.missingRoots.length; k++) {
    L.push('  ' + C.alert('root not found: ' + s.missingRoots[k]) +
           C.dim('  (Tack/roots.json)'));
    L.push('');
  }
  return L.map(trimEnd);
}

/* ------------------------------------------------------------- show <name> */

function renderShow(s, query) {
  var q = query.toLowerCase();
  var hits = s.repos.filter(function (r) { return r.label.toLowerCase().indexOf(q) !== -1; });
  var L = [''];
  if (!hits.length) {
    L.push('  ' + C.alert('no repo matching "' + query + '"'));
    L.push('  ' + C.dim('known: ' + s.repos.map(function (r) { return r.label; }).join(', ')));
    L.push('');
    return L;
  }
  for (var i = 0; i < hits.length; i++) {
    var r = hits[i];
    L.push('  ' + C.body(r.label) + C.dim('  ' + (r.branch || '?') +
      (r.upstream ? ' → ' + r.upstream : '') +
      (r.last ? '  ·  last commit ' + ago(r.last.when, s.now) + ' ago' : '')));
    if (r.last) L.push('  ' + C.dim('  “' + clip(r.last.subject, 60) + '”'));
    L.push('');
    if (r.error) { L.push('    ' + C.alert(r.error)); L.push(''); continue; }
    if (r.empty && !r.loose) { L.push('    ' + C.chrome('no commits yet')); L.push(''); continue; }
    if (!r.loose) { L.push('    ' + C.dim('clean')); L.push(''); continue; }
    var files = r.files.slice().sort(function (a, b) { return (a.mtime || 0) - (b.mtime || 0); });
    for (var j = 0; j < files.length; j++) {
      var f = files[j];
      var word = describe(f);
      var col = word === 'untracked' ? C.chrome : (word === 'conflicted' ? C.alert : C.warm);
      L.push('    ' + col(pad(word, 11)) +
             padVis(C.body(clip(f.path.replace(/\\/g, '/'), 46)), 48) +
             C.dim(ago(f.mtime, s.now)));
    }
    L.push('');
  }
  return L.map(trimEnd);
}

/* `tack show` wants every file, including the ones inside a folder the glance
 * collapsed. Re-read just the matches, so the expensive question is only asked
 * about the repo actually being looked at. Kept out of renderShow so that stays
 * a pure function of state. */
function expandMatches(s, query, now) {
  var q = query.toLowerCase();
  for (var i = 0; i < s.repos.length; i++) {
    if (s.repos[i].label.toLowerCase().indexOf(q) === -1) continue;
    if (s.repos[i].error) continue;
    s.repos[i] = readRepo(s.repos[i].dir, now, { untracked: 'all' });
  }
  return s;
}

/* ---------------------------------------------------------------- one-line */

function renderOne(s) {
  var t = s.totals;
  if (t.errors) return t.errors + ' repos unreadable';
  if (!t.files) return 'all ' + t.repos + ' repos committed';
  return t.files + ' loose in ' + t.dirty + ' repos, oldest ' + ago(t.oldest, s.now);
}

/* --------------------------------------------------------------------- cli */

var HELP = [
  '',
  '  tack            what is loose, everywhere',
  '  tack show NAME  the file list for one repo (substring match)',
  '  tack sit [NAME] the live pane -- pick files and commit them',
  '  tack one        a single line, for a status bar',
  '  tack --json     the same sweep as data',
  '',
  '  --no-color      plain text',
  '  --ascii         plain ` and \' instead of box-drawing',
  '',
  '  Tack can add and commit. It cannot restore, reset, or check out --',
  '  nothing here can undo your work. It also has no way to express',
  '  `git add -A`: it stages only paths it has shown you.',
  ''
].join('\n');

function main(argv) {
  var args = argv.slice(2);
  if (args.indexOf('--no-color') !== -1 || process.env.NO_COLOR ||
      !process.stdout.isTTY) C.on = false;
  if (args.indexOf('--ascii') !== -1 || process.env.TACK_ASCII) T.ASCII = true;
  args = args.filter(function (a) { return a !== '--no-color' && a !== '--ascii'; });

  if (args[0] === '--help' || args[0] === '-h' || args[0] === 'help') {
    process.stdout.write(HELP + '\n'); return 0;
  }

  var cfgFile = path.join(__dirname, 'roots.json');
  var s;
  try { s = sweep(cfgFile, Date.now()); }
  catch (e) {
    process.stderr.write('\n  tack: ' + e.message + '\n\n');
    return 1;
  }

  if (args[0] === '--json') {
    process.stdout.write(JSON.stringify(s, null, 2) + '\n'); return 0;
  }
  if (args[0] === 'one') { process.stdout.write(renderOne(s) + '\n'); return 0; }
  if (args[0] === 'sit') {
    /* Required lazily so the glance never loads the file that can write. */
    return require('./sit.js').run(cfgFile, args.slice(1).join(' ') || null);
  }
  var query = null;
  if (args[0] === 'show') {
    if (!args[1]) { process.stdout.write('\n  tack show needs a name.\n' + HELP + '\n'); return 1; }
    query = args.slice(1).join(' ');
  } else if (args.length && args[0].charAt(0) !== '-') {
    /* `tack games` is what everyone types before reading the help. */
    query = args.join(' ');
  }
  if (query !== null) {
    process.stdout.write(
      renderShow(expandMatches(s, query, s.now), query).join('\n') + '\n');
    return 0;
  }

  process.stdout.write(render(s).join('\n') + '\n');
  return s.totals.errors ? 1 : 0;
}

module.exports = {
  T: T, READ_ONLY_VERBS: READ_ONLY_VERBS, git: git,
  parseStatusV2: parseStatusV2, describe: describe, findRepos: findRepos,
  discover: discover, loadRoots: loadRoots, expandHome: expandHome,
  labelFor: labelFor, readRepo: readRepo, sweep: sweep, rank: rank,
  render: render, renderShow: renderShow, expandMatches: expandMatches, trimEnd: trimEnd, renderOne: renderOne, previewOf: previewOf,
  creature: creature, moodOf: moodOf, ago: ago, visLen: visLen, padVis: padVis, C: C,
  main: main
};

if (require.main === module) {
  var code = main(process.argv);
  if (code && typeof code.then === 'function') code.then(function (c) { process.exit(c); });
  else process.exit(code);
}
