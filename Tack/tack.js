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
  SUBJECT_MAX:    46,   // commit subject column in `tack log`
  LOG_LINES:      15,   // commits `tack log` shows before counting the rest
  PATCH_MAX:     400,   // diff lines shown before it counts the rest
  SCAN_TIMEOUT:  8000,  // ms per git call
  SHAPE:       'bat'  // which creature: plain | bat | batlite | ascii. `tack faces` shows them
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

/* ---------------------------------------------------------------- refs */

/* THE VERB ALLOWLIST IS NOT SUFFICIENT ON ITS OWN, and this is the pass that
 * made that true. Until now every argument Tack handed git was a literal typed
 * into this file -- the allowlist was the whole guard because nothing else
 * could vary. `tack log <ref>` is the first argument that comes from whoever
 * is typing.
 *
 * That matters because a reading verb can be made to write: `git log
 * --output=FILE` writes its output to a file, and `log` is on the allowlist.
 * So the guard has to sit on the argument as well as on the verb.
 *
 * A ref must look like a ref. It cannot begin with `-`, which is what makes an
 * argument an option, and it cannot contain `..`, which is what makes one ref
 * a range. Anything else is refused by name rather than passed along.
 *
 * `git check-ref-format` would be the thorough answer and is deliberately not
 * used: it is a second git verb on the allowlist to validate an argument to
 * the first, which is a larger hole than the one it closes. */
var REF_OK = /^[0-9A-Za-z][0-9A-Za-z._\/-]{0,80}$/;

function safeRef(ref) {
  var s = String(ref === null || ref === undefined ? '' : ref);
  if (!REF_OK.test(s) || s.indexOf('..') !== -1) {
    throw new Error(
      'Tack will not pass "' + s + '" to git as a ref. A ref is letters, ' +
      'digits, dot, dash, slash and underscore, and does not start with a ' +
      'dash. The guard is safeRef() in tack.js.');
  }
  return s;
}

/* A whole number, for `-n` and `--days`. Same reasoning one size down: these
 * are interpolated into an argument, so they are rebuilt from a parsed integer
 * rather than passed through as text. */
function safeCount(n, dflt, max) {
  var v = parseInt(n, 10);
  if (!isFinite(v) || v < 1) return dflt;
  return Math.min(v, max);
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
      /* Repos with no commits AND loose work in them. A subset of `empty`, kept
       * separate because the two states are not the same animal: an empty repo
       * with nothing in it holds nothing at risk, while an empty repo with
       * files in it holds the ONLY copy of them. That is the one worth a face.
       * See moodOf. */
      emptyLoose: repos.filter(function (r) { return r.empty && r.loose > 0; }).length,
      errors: repos.filter(function (r) { return r.error; }).length,
      oldest: repos.reduce(function (m, r) {
        return r.oldest !== null && (m === null || r.oldest < m) ? r.oldest : m; }, null)
    }
  };
}

/* The repo list without asking git anything. `tack open` needs to know WHERE
 * the repos are, not what state they are in, and three git calls per repo is
 * over a second of waiting for an answer the filesystem already had.
 *
 * It also means the back door still opens when git is the thing that is
 * broken -- missing from PATH, a corrupt index, a lock left behind by a killed
 * process. A door that only works while the house is fine is not a back door. */
function sweepPaths(cfgFile) {
  var disc = discover(loadRoots(cfgFile));
  return {
    repos: disc.repos.map(function (d) {
      return { dir: d, label: labelFor(d), error: null };
    }),
    missingRoots: disc.missingRoots
  };
}

function rank(r) {
  if (r.error)   return 0;
  if (r.loose)   return 0;
  if (r.empty)   return 1;
  return 2;
}

/* -------------------------------------------------------------- history */

/* The sweep answers "what is loose". This answers "what happened", and the
 * reason it is worth having is the same reason the sweep is: ten repos, and no
 * vantage point from which their histories are visible at once. `git log`
 * answers for the folder you are standing in. Nothing answers for the tree.
 *
 * It reads through the same choke point as everything else -- `log` has been
 * on READ_ONLY_VERBS since pass 1, so this whole feature lives inside the tier
 * that cannot write, and that list is still four verbs long. Diffs are
 * `log -1 -p` rather than `git show` for exactly that reason: show would have
 * been a fifth verb bought for something log already does. */

var LOG_UNIT = '\x1f';   /* between fields */
var LOG_REC  = '\x1e';   /* between commits -- a subject may contain newlines */

/* Written by write.js into every commit Tack makes. Every commit in this tree
 * is authored `RevBrd` whether a session or Trevor made it, so git's own author
 * field cannot tell them apart and this trailer is the only thing that can.
 * It is read as a fact about the message, never as a claim about intent. */
var TACK_TRAILER = 'Committed with Tack.';

var LOG_FORMAT = ['%H', '%h', '%ct', '%an', '%s', '%b'].join(LOG_UNIT) + LOG_REC;

/* A TRAILER IS A WHOLE LINE, NEVER A SUBSTRING, and this tool proved it on
 * itself. The test used to be body.indexOf(), a substring search over the whole
 * message -- so any commit whose body *discusses* the trailer was read as one
 * that carries it. Measured against the live tree: 60 commits match as a
 * substring, 58 carry it on its own line, and both of the extras are commits
 * explaining the convention. One of them is `1f679af`, the commit that
 * introduced this very marking, whose body says "Which commits are yours is
 * read off the `Committed with Tack.` trailer, because ..." -- so the feature
 * misattributed its own birth certificate for a fortnight.
 *
 * The general form is worth more than the fix: every doc and commit message in
 * this tree writes about these conventions constantly, so a substring check
 * makes the tree unable to describe itself without lying about who wrote it.
 *
 * One definition, used by the reader here and by the writer in write.js, so
 * the two halves cannot drift into disagreeing about what a signature is.
 * (Cairn hit the identical bug on 6 Sep 2026 and caught it within the hour;
 * this is the same fix one repo over.) */
function hasTrailer(text, trailer) {
  var lines = String(text === null || text === undefined ? '' : text).split('\n');
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].trim() === trailer) return true;
  }
  return false;
}

function parseLog(text) {
  var out = [];
  var recs = String(text).split(LOG_REC);
  for (var i = 0; i < recs.length; i++) {
    var rec = recs[i].replace(/^[\r\n]+/, '');
    if (!rec.trim()) continue;
    var f = rec.split(LOG_UNIT);
    if (f.length < 5) continue;
    /* The body is last and is joined back from whatever remains, so a message
     * that happens to contain the unit separator cannot shift the fields
     * before it. */
    var body = f.slice(5).join(LOG_UNIT);
    out.push({
      hash:    f[0],
      short:   f[1],
      when:    (+f[2]) * 1000,
      who:     f[3],
      subject: f[4],
      body:    body,
      tack:    hasTrailer(body, TACK_TRAILER)
    });
  }
  return out;
}

/* One repo's history. Returns the same shape whether it worked or not, so a
 * repo that cannot be read is reported rather than silently missing -- same
 * rule as a missing root and a dead circuit on the Mains panel. */
function readLog(dir, opts) {
  opts = opts || {};
  var rec = { dir: dir, label: labelFor(dir), commits: [], empty: false, error: null };

  var args = ['log', '--no-color', '-n', String(safeCount(opts.limit, 20, 500)),
              '--format=' + LOG_FORMAT];
  if (opts.days) args.push('--since=' + safeCount(opts.days, 7, 3650) + '.days.ago');
  if (opts.ref)  args.push(safeRef(opts.ref));

  var r = git(dir, args);
  if (!r.ok) {
    /* A repo with no commits fails `git log` with a message about a bad
     * revision. That is a state, not a fault, and it gets its own word here
     * for the same reason it does in the sweep. */
    var head = git(dir, ['rev-parse', '--verify', 'HEAD']);
    if (!head.ok) { rec.empty = true; return rec; }
    rec.error = firstLine(r.err) || 'git log failed';
    return rec;
  }
  rec.commits = parseLog(r.out);
  return rec;
}

/* Every repo's history, merged into one stream, newest first.
 *
 * Built on sweepPaths rather than sweep: this reports history, so paying for
 * `git status` on ten repos would be over a second spent on an answer that is
 * never printed. Same call the back door makes, and for the same reason. */
function sweepLog(cfgFile, now, opts) {
  opts = opts || {};
  var where = sweepPaths(cfgFile);
  var want  = safeCount(opts.limit, 15, 500);

  var repos = [], all = [];
  for (var i = 0; i < where.repos.length; i++) {
    var r = where.repos[i];
    if (opts.only && r.label.toLowerCase().indexOf(opts.only.toLowerCase()) === -1) continue;
    var got;
    try { got = readLog(r.dir, { limit: want, days: opts.days }); }
    catch (e) { got = { dir: r.dir, label: r.label, commits: [], empty: false,
                        error: firstLine(e.message) }; }
    repos.push(got);
    for (var j = 0; j < got.commits.length; j++) {
      got.commits[j].repo = got.label;
      got.commits[j].dir  = got.dir;
      all.push(got.commits[j]);
    }
  }

  all.sort(function (a, b) { return b.when - a.when || a.repo.localeCompare(b.repo); });
  var shown = all.slice(0, want);

  /* `all.length` is not the tree's commit count -- it is what came back from
   * asking each repo for `want`. So the only exact statement available is
   * whether anything was left out, which is true if the pool overflowed or if
   * any single repo filled its share and might have had more behind it. */
  var truncated = all.length > shown.length || repos.some(function (r) {
    return r.commits.length >= want; });

  return {
    now: now, only: opts.only || null, days: opts.days || null,
    commits: shown, truncated: truncated,
    repos: repos, missingRoots: where.missingRoots,
    known: where.repos.map(function (r) { return r.label; }),
    unknown: opts.only && !repos.length
  };
}

/* Which repo holds this commit. Every repo is asked, and every repo that says
 * yes is reported -- a four-character hash could honestly live in two of them,
 * and opening the wrong commit looks exactly like it worked. Same rule the
 * back door and the front door already follow. */
function findCommit(cfgFile, ref) {
  var where = sweepPaths(cfgFile);
  var hits = [];
  for (var i = 0; i < where.repos.length; i++) {
    var r = where.repos[i];
    var ok;
    try { ok = git(r.dir, ['rev-parse', '--verify', '--quiet', safeRef(ref) + '^{commit}']); }
    catch (e) { continue; }
    if (ok.ok && ok.out.trim()) hits.push({ dir: r.dir, label: r.label, hash: ok.out.trim() });
  }
  return hits;
}

/* One commit, in full: its message, what it touched, and -- only if asked --
 * the diff itself. `--stat` is the quick read and `-p` is the zoom. */
function readCommit(dir, ref, opts) {
  opts = opts || {};
  var meta = readLog(dir, { limit: 1, ref: ref });
  if (meta.error || !meta.commits.length) {
    return { error: meta.error || 'no commit ' + ref, files: [], patch: null };
  }
  var c = meta.commits[0];
  c.dir = dir;
  c.label = labelFor(dir);

  var st = git(dir, ['log', '-1', '--no-color', '--format=', '--numstat', safeRef(ref)]);
  c.files = [];
  if (st.ok) {
    st.out.split('\n').forEach(function (line) {
      var m = line.trim().match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (!m) return;
      c.files.push({ added: m[1], removed: m[2], path: m[3],
                     binary: m[1] === '-' && m[2] === '-' });
    });
  }

  c.patch = null;
  if (opts.patch) {
    var p = git(dir, ['log', '-1', '--no-color', '--format=', '-p', safeRef(ref)]);
    if (p.ok) c.patch = p.out.replace(/\s+$/, '').split('\n');
  }
  return c;
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
 * glyphs have one shape everywhere.
 *
 * Every shape returns lines of EQUAL WIDTH, or the text beside them shears.
 * The last two lines are the ones text attaches to, so a shape may be as tall
 * as it likes above them. `tack faces` prints them all. */
var SHAPES = {
  /* A thumbtack seen from the side: round head, two eyes, a point. */
  plain: function (eyes) {
    return [' ╭─────╮',
            ' │ ' + eyes + ' │',
            ' ╰──┬──╯'];
  },
  /* Ears. Trevor read `.bat` as an animal rather than as Windows' extension
   * for a batch file, which is a better idea than the truth.
   *
   * These keep `plain`'s exact width. The first version widened the head to
   * eight to give the ears room, and the wider proportions stopped reading as
   * a tack -- which was the whole name. The ears fit at the narrow width; the
   * widening was a choice, and the wrong one. */
  bat: function (eyes) {
    return [' ╱╲   ╱╲',
            ' ╭─────╮',
            ' │ ' + eyes + ' │',
            ' ╰──┬──╯'];
  },
  /* The same, in characters every font has had since forever. */
  batlite: function (eyes) {
    return [' /\\   /\\',
            ' ╭─────╮',
            ' │ ' + eyes + ' │',
            ' ╰──┬──╯'];
  },
  /* For a console that cannot draw box-drawing glyphs at all. */
  ascii: function (eyes) {
    return [' ,---. ',
            '( ' + eyes + ' )',
            " `-|-' "];
  }
};

function creature(mood, shape) {
  var eyes = { pleased: '^ ^', awake: 'o o', alert: 'O O', puzzled: 'o -' }[mood] || 'o o';
  var draw = SHAPES[shape || T.SHAPE] || SHAPES.plain;
  return draw(eyes);
}

/* The creature with its two lines of text beside it. Text always attaches to
 * the last two lines, so a taller shape grows upward and nothing else moves. */
function headBlock(mood, line1, line2) {
  var h = creature(mood), L = [];
  for (var i = 0; i < h.length; i++) {
    var text = i === h.length - 2 ? line1 : (i === h.length - 1 ? line2 : '');
    L.push('  ' + C.chrome(h[i]) + (text ? '   ' + text : ''));
  }
  return L;
}

/* Tack is asked exactly one question -- what is loose -- and the face is the
 * answer to it, so nothing that is not loose may change the face.
 *
 * `puzzled` used to fire on `empty && !files`, which turned out to be a state
 * that can only ever be noise: if a repo has no commits and nothing loose, then
 * by definition it holds nothing at risk. It fired permanently, because
 * `Projects/Home` is an abandoned `git init` with nothing in it, and a
 * permanent worried face is a face nobody reads. (Trevor, 28 Aug 2026: the
 * clean tree should get the happy one.)
 *
 * So it now points at the state that is genuinely a *huh?* -- loose work in a
 * repo that has never been committed at all. There is no history under those
 * files; they are the only copy. It is rare, it is reachable (every new project
 * passes through it), and unlike the old trigger it is worth interrupting for. */
function moodOf(s) {
  if (s.totals.errors) return 'alert';
  if (s.totals.emptyLoose) return 'puzzled';
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

/* `ago()` says 'now' for anything under a minute, and 'now ago' is not English.
 * The suffix belongs wherever the phrase is built rather than in the value,
 * so every caller that wants one says so here and gets the edge handled once. */
function agoPhrase(ms, now) {
  var a = ago(ms, now);
  return a === 'now' ? 'just now' : a + ' ago';
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

  /* A repo with loose work and no commits at all used to render identically to
   * any other dirty repo -- the `no commits yet` line above is only reached
   * when the repo is also empty of work, so the one case where it matters most
   * was the one case that never said it. It leads, because it is the thing that
   * changes what the file names underneath it mean. */
  var lead = r.empty ? 'no commits yet · ' : '';
  if (lead) width = Math.max(12, width - lead.length);

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
  return lead + s;
}

function render(s) {
  var L = [], now = s.now, t = s.totals;
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
  headBlock(moodOf(s), line1, line2).forEach(function (x) { L.push(x); });
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
    L.push('  ' + C.dim('`tack show <name>` for the file list · `tack sit` to commit or put back'));
    L.push('  ' + C.dim('anything discarded is copied to the attic first — `tack attic`.'));
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
      (r.last ? '  ·  last commit ' + agoPhrase(r.last.when, s.now) : '')));
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

/* ------------------------------------------------------------------ faces */

/* Every shape in every mood, side by side. This exists because which glyphs
 * render well is a property of the font on the machine reading them, which is
 * not a thing this file can find out -- so it shows them all and lets whoever
 * is looking decide. */
function renderFaces() {
  var MOODS = ['pleased', 'awake', 'alert', 'puzzled'];
  var WHY = { pleased: 'all committed', awake: 'work is loose',
              alert: 'unreadable repo', puzzled: 'a repo with no commits' };
  var L = [''];

  Object.keys(SHAPES).forEach(function (name) {
    var drawn = MOODS.map(function (m) { return creature(m, name); });
    var tall  = drawn[0].length;
    L.push('  ' + C.body(name) + C.dim(name === T.SHAPE ? '   (current)' : ''));
    L.push('');
    for (var row = 0; row < tall; row++) {
      L.push('    ' + drawn.map(function (d) { return C.chrome(d[row]); }).join('   '));
    }
    L.push('    ' + drawn.map(function (d, i) {
      return C.dim(pad(MOODS[i], visLen(d[0])));
    }).join('   '));
    L.push('');
  });

  L.push('  ' + C.dim('what each mood means:'));
  MOODS.forEach(function (m) {
    L.push('    ' + C.dim(pad(m, 9) + WHY[m]));
  });
  L.push('');
  L.push('  ' + C.dim('try one:  tack --shape=bat'));
  L.push('  ' + C.dim('keep one: set SHAPE in the tuning block at the top of tack.js'));
  L.push('');
  return L.map(trimEnd);
}

/* ------------------------------------------------------------- the back door */

/* `tack open <thing>`. Marquee opens works; this opens files, and it exists so
 * that something can still open Marquee when Marquee is the thing being taken
 * apart. Rendering is here; the finding, the containment check and the
 * launching are in open.js. */
function renderOpen(query, res, repos, opts) {
  var O = require('./open.js');
  var L = [''], dry = opts && opts.dry;

  if (repos && repos.length === 1) {
    var r = repos[0];
    L.push('  ' + C.good(dry ? 'would open' : 'opening') + '  ' +
           C.body(r.label) + C.dim('   the folder'));
    L.push('  ' + C.dim(r.dir));
    L.push('');
    if (!dry) O.launch(r.dir, 'document');
    return { lines: L.map(trimEnd), code: 0 };
  }

  if (!res.hits.length) {
    L.push('  ' + C.alert('no file matching "' + query + '"'));
    L.push('  ' + C.dim('Tack looks inside the repos it sweeps, no further.'));
    L.push('');
    return { lines: L.map(trimEnd), code: 1 };
  }

  if (res.hits.length > 1) {
    L.push('  ' + C.warm(res.hits.length + ' files match "' + query + '"') +
           C.dim('  (' + res.tier + ')'));
    L.push('');
    res.hits.slice(0, O.TUNE.MAX_HITS).forEach(function (f) {
      L.push('    ' + C.body(pad(clip(f.name, 30), 31)) +
             C.dim(f.repo + '/' + f.rel.replace(/[^\/]+$/, '')));
    });
    if (res.hits.length > O.TUNE.MAX_HITS) {
      L.push('    ' + C.dim('and ' + (res.hits.length - O.TUNE.MAX_HITS) + ' more'));
    }
    L.push('');
    L.push('  ' + C.dim('say which one. Tack does not guess between them.'));
    L.push('');
    return { lines: L.map(trimEnd), code: 1 };
  }

  var hit = res.hits[0];
  var kind = O.kindOf(hit.file);

  if (kind === 'program') {
    L.push('  ' + C.alert('that is a program, not a document'));
    L.push('  ' + C.dim(hit.file));
    L.push('');
    L.push('  ' + C.dim('Tack shows you files. It does not run them — opening this'));
    L.push('  ' + C.dim('would mean executing it. Run it yourself if you meant to.'));
    L.push('');
    return { lines: L.map(trimEnd), code: 1 };
  }

  L.push('  ' + C.good(dry ? 'would open' : 'opening') + '  ' +
         C.body(hit.name) + C.dim('   (matched on ' + res.tier + ')'));
  L.push('  ' + C.dim(hit.file));
  if (kind === 'script') {
    L.push('');
    L.push('  ' + C.live('opened in ' + O.editor() + ' to read.') +
           C.dim(' Windows would RUN this'));
    L.push('  ' + C.dim('one rather than show it, so Tack does not hand it to the shell.'));
  }
  L.push('');
  if (!dry) O.launch(hit.file, kind);
  return { lines: L.map(trimEnd), code: 0 };
}

/* ------------------------------------------------------------------ attic */

/* Everything Tack has ever thrown away on your behalf. Nothing here is ever
 * pruned, and the point of the command is that the folder is findable without
 * already knowing where it is. */
function renderAttic(entries, root, now) {
  var L = [''];
  if (!entries.length) {
    L.push('  ' + C.dim('nothing in the attic. Tack has never discarded anything.'));
    L.push('');
    L.push('  ' + C.dim('when it does, a copy of what was thrown away goes to'));
    L.push('  ' + C.dim(root));
    L.push('');
    return L.map(trimEnd);
  }
  L.push('  ' + C.body(entries.length + ' rescue' + (entries.length === 1 ? '' : 's')) +
         C.dim(' · nothing here is ever deleted'));
  L.push('');
  var w = entries.reduce(function (m, e) { return Math.max(m, e.label.length); }, 4);
  entries.forEach(function (e) {
    L.push('  ' + C.dim(e.stamp.replace('T', '  ')) + '  ' +
           C.body(pad(e.label, w)) + '  ' +
           C.warm(e.files + ' file' + (e.files === 1 ? '' : 's')));
  });
  L.push('');
  L.push('  ' + C.dim('they are plain files. Open the folder and copy one back:'));
  L.push('  ' + C.dim(root));
  L.push('');
  return L.map(trimEnd);
}

/* ---------------------------------------------------------------- one-line */

function renderOne(s) {
  var t = s.totals;
  if (t.errors) return t.errors + ' repos unreadable';
  if (!t.files) return 'all ' + t.repos + ' repos committed';
  return t.files + ' loose in ' + t.dirty + ' repos, oldest ' + ago(t.oldest, s.now);
}

/* --------------------------------------------------------------------- cli */

/* --------------------------------------------------------------- log view */

/* The quick read: one line per commit, newest first, repo named on every line
 * because the whole point is that they are mixed together. */
function renderLog(s, opts) {
  opts = opts || {};
  var L = [''], now = s.now;

  if (s.only && !s.repos.length) {
    L.push('  ' + C.alert('no repo matching "' + s.only + '"'));
    L.push('  ' + C.dim('known: ' + s.known.join(', ')));
    L.push('  ' + C.dim('`tack log` on its own is every repo.'));
    L.push('');
    return L.map(trimEnd);
  }

  var n = s.commits.length;
  var line1, line2;
  if (!n) {
    line1 = C.body('tack') + C.dim(' · ') + C.chrome('no commits' +
            (s.days ? ' in the last ' + s.days + ' days' : '')) +
            (s.only ? C.dim(' in ') + C.body(s.only) : '');
    line2 = C.dim(s.days ? 'try a wider window: `tack log --days 30`'
                         : 'nothing to show');
  } else {
    line1 = C.body('tack') + C.dim(' · ') + C.body(n + ' commit' + (n === 1 ? '' : 's')) +
            C.dim(' in ') + C.body(matchedLabel(s));
    line2 = C.dim('newest ') + C.body(agoPhrase(s.commits[0].when, now)) +
            C.dim(' · oldest ') + C.body(agoPhrase(s.commits[n - 1].when, now));
    if (s.days) line2 += C.dim('  ·  last ' + s.days + 'd');
  }

  headBlock(n ? 'pleased' : 'puzzled', line1, line2).forEach(function (x) { L.push(x); });
  L.push('');

  var w = Math.min(T.LABEL_MAX, s.commits.reduce(function (m, c) {
    return Math.max(m, c.repo.length); }, 4));

  for (var i = 0; i < s.commits.length; i++) {
    var c = s.commits[i];
    /* `you` rather than a name: the author field says RevBrd for every commit
     * in this tree, so the honest thing to report is the one distinction that
     * actually exists -- this message carries Tack's trailer, which means it
     * was made from the pane rather than by a session. */
    var mine = c.tack ? C.good(' you') : '    ';
    L.push('  ' + C.dim(lpad(ago(c.when, now), 4)) + '  ' +
           C.chrome(pad(clip(c.repo, T.LABEL_MAX), w)) + '  ' +
           C.dim(c.short) + '  ' +
           padVis(C.body(clip(c.subject, T.SUBJECT_MAX)), T.SUBJECT_MAX + 1) + mine);
  }

  if (s.truncated) {
    L.push('');
    L.push('  ' + C.dim('older commits not shown · `tack log -n ' +
                        (s.commits.length * 2) + '`'));
  }

  for (var k = 0; k < s.repos.length; k++) {
    if (s.repos[k].error) {
      L.push('  ' + C.alert(s.repos[k].label + ': ' + s.repos[k].error));
    }
  }

  L.push('');
  if (n) L.push('  ' + C.dim('`tack log ' + s.commits[0].short +
                             '` for one commit · add `-p` for the diff'));
  L.push('');

  for (var q = 0; q < s.missingRoots.length; q++) {
    L.push('  ' + C.alert('root not found: ' + s.missingRoots[q]) +
           C.dim('  (Tack/roots.json)'));
    L.push('');
  }
  return L.map(trimEnd);
}

/* A short hash is short enough to honestly live in two repos. Same rule as
 * everywhere else in this tool: say so, list them, resolve nothing. */
function renderPickCommit(ref, hits) {
  var L = ['', '  ' + C.warm(hits.length + ' repos have a commit ' + ref) , ''];
  for (var i = 0; i < hits.length; i++) {
    L.push('    ' + C.body(pad(hits[i].label, 24)) + C.dim(hits[i].hash.slice(0, 12)));
  }
  L.push('');
  L.push('  ' + C.dim('use more of the hash, or name the repo: `tack log ' +
                      hits[0].label.split('/').pop() + '`'));
  L.push('');
  return L.map(trimEnd);
}

/* What the filter actually landed on. With no filter it is a count, because
 * naming ten repos in a header is not a header. */
function matchedLabel(s) {
  if (!s.only) return countRepos(s.commits) + ' repos';
  var labels = s.repos.map(function (r) { return r.label; });
  if (labels.length === 1) return labels[0];
  return labels.length + ' repos matching "' + s.only + '"';
}

function countRepos(commits) {
  var seen = {};
  for (var i = 0; i < commits.length; i++) seen[commits[i].repo] = 1;
  return Object.keys(seen).length;
}

/* The zoom: one commit. Which files, how much moved, and the diff if asked. */
function renderCommit(c, now, opts) {
  opts = opts || {};
  var L = [''];

  if (c.error) {
    L.push('  ' + C.alert(c.error));
    L.push('');
    return L.map(trimEnd);
  }

  L.push('  ' + C.body(c.label) + C.dim('  ·  ') + C.chrome(c.short) +
         C.dim('  ·  ' + agoPhrase(c.when, now)) +
         (c.tack ? C.dim('  ·  ') + C.good('yours') : C.dim('  ·  ' + c.who)));
  L.push('');
  L.push('  ' + C.body(c.subject));

  /* The trailer is Tack's own bookkeeping and saying it back is noise -- the
   * `yours` mark above already carries it. Anything else the message says is
   * the point of reading a log at all, so it is printed in full. */
  var body = (c.body || '').split('\n').filter(function (line) {
    return line.trim() !== TACK_TRAILER; });
  while (body.length && !body[0].trim()) body.shift();
  while (body.length && !body[body.length - 1].trim()) body.pop();
  if (body.length) {
    L.push('');
    body.forEach(function (line) { L.push('  ' + C.dim(line)); });
  }
  L.push('');

  if (!c.files.length) {
    L.push('  ' + C.chrome('no files changed'));
  } else {
    var w = c.files.reduce(function (m, f) {
      return Math.max(m, Math.min(f.path.length, 52)); }, 4);
    for (var i = 0; i < c.files.length; i++) {
      var f = c.files[i];
      var moved = f.binary ? C.chrome('binary')
                : C.good('+' + f.added) + ' ' + C.alert('-' + f.removed);
      L.push('    ' + C.body(pad(clip(f.path, 52), w)) + '  ' + moved);
    }
  }
  L.push('');

  if (c.patch) {
    var lines = c.patch;
    var cap = T.PATCH_MAX;
    for (var j = 0; j < Math.min(lines.length, cap); j++) {
      L.push('  ' + paintDiff(lines[j]));
    }
    if (lines.length > cap) {
      L.push('');
      /* Counted, never quietly truncated. And the way to see the rest is git
       * itself, spelled out -- this tool exists to be outgrown. */
      L.push('  ' + C.dim((lines.length - cap) + ' more lines. All of it:'));
      L.push('  ' + C.chrome('git -C "' + c.dir + '" show ' + c.short));
    }
    L.push('');
  } else if (c.files.length) {
    L.push('  ' + C.dim('`tack log ' + c.short + ' -p` for the diff'));
    L.push('');
  }
  return L.map(trimEnd);
}

/* git's own colours are off (--no-color) so that what Tack parses is what git
 * printed. Painting it here instead keeps one palette across the whole tool. */
function paintDiff(line) {
  var s = String(line);
  if (/^diff --git |^index |^--- |^\+\+\+ |^new file|^deleted file|^similarity|^rename /.test(s))
    return C.chrome(s);
  if (s.charAt(0) === '@') return C.live(s);
  if (s.charAt(0) === '+') return C.good(s);
  if (s.charAt(0) === '-') return C.alert(s);
  return C.dim(s);
}

var HELP = [
  '',
  '  tack            what is loose, everywhere',
  '  tack show NAME  the file list for one repo (substring match)',
  '  tack sit [NAME] the live pane -- pick files and commit them',
  '  tack log        what happened, everywhere, newest first',
  '  tack log NAME   the history of one repo',
  '  tack log HASH   one commit: what it touched. add -p for the diff',
  '  tack one        a single line, for a status bar',
  '  tack faces      every shape of him, in every mood',
  '  tack attic      everything Tack has ever thrown away, and where it is',
  '  tack open NAME  open a file, or a repo folder, from anywhere in the sweep',
  '  tack --json     the same sweep as data',
  '',
  '  --no-color      plain text',
  '  --shape=NAME    plain | bat | batlite | ascii  (see `tack faces`)',
  '  --dry           with open: say what it would open, and do not open it',
  '  -n N            with log: how many commits (default ' + T.LOG_LINES + ')',
  '  --days N        with log: only the last N days',
  '  -p              with log HASH: the diff itself',
  '',
  '  Tack stages only paths it has shown you -- `git add -A` is not a thing',
  '  it declines, it is a thing it cannot express. Discarding a change always',
  '  copies it to the attic first. It cannot reset, check out, or delete an',
  '  untracked file at all.',
  ''
].join('\n');

/* Argument handling for `tack log`, kept out of main() so the suite can drive
 * the whole command without a terminal -- the same reason sit.js holds no I/O
 * of its own. Everything numeric goes through safeCount, and everything that
 * reaches git as a ref goes through safeRef. */
function parseLogArgs(argv) {
  var opt = { patch: false, limit: T.LOG_LINES, days: null, words: [], bad: null };
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i], m;
    if (a === '-p' || a === '--patch') { opt.patch = true; continue; }
    if (a === '-n' || a === '--number') { opt.limit = safeCount(argv[++i], T.LOG_LINES, 500); continue; }
    if ((m = a.match(/^-n(\d+)$/)) || (m = a.match(/^--number=(\d+)$/))) {
      opt.limit = safeCount(m[1], T.LOG_LINES, 500); continue; }
    if (a === '--days') { opt.days = safeCount(argv[++i], 7, 3650); continue; }
    if ((m = a.match(/^--days=(\d+)$/))) { opt.days = safeCount(m[1], 7, 3650); continue; }
    /* An unknown option is refused rather than kept as a name. It would
     * otherwise become a search term and quietly report finding nothing. */
    if (a.charAt(0) === '-') { opt.bad = a; return opt; }
    opt.words.push(a);
  }
  return opt;
}

/* A hash, or the name of a repo? Decided by shape first and then by whether any
 * repo actually holds it -- never by guessing, and a thing that is held by two
 * repos is reported as two rather than resolved. */
function looksLikeRef(words) {
  return words.length === 1 && /^[0-9a-fA-F]{4,40}$/.test(words[0]);
}

function runLog(cfgFile, argv) {
  var opt = parseLogArgs(argv);
  if (opt.bad) {
    process.stdout.write('\n  tack log does not know ' + opt.bad + '\n' + HELP + '\n');
    return 1;
  }
  var now = Date.now();
  var target = opt.words.join(' ');

  if (looksLikeRef(opt.words)) {
    var hits;
    try { hits = findCommit(cfgFile, target); }
    catch (e) { process.stderr.write('\n  tack: ' + e.message + '\n\n'); return 1; }

    if (hits.length > 1) {
      process.stdout.write(renderPickCommit(target, hits).join('\n') + '\n');
      return 1;
    }
    if (hits.length === 1) {
      var c;
      try { c = readCommit(hits[0].dir, target, { patch: opt.patch }); }
      catch (e2) { process.stderr.write('\n  tack: ' + e2.message + '\n\n'); return 1; }
      process.stdout.write(renderCommit(c, now, opt).join('\n') + '\n');
      return c.error ? 1 : 0;
    }
    /* Shaped like a hash and held by nobody. Falling through to the repo-name
     * path here would answer a question that was not asked. */
    process.stdout.write('\n  ' + C.alert('no commit ' + target + ' in any repo') +
                         '\n  ' + C.dim('`tack log` is everything, newest first.') + '\n\n');
    return 1;
  }

  var sl;
  try { sl = sweepLog(cfgFile, now, { limit: opt.limit, days: opt.days, only: target || null }); }
  catch (e3) { process.stderr.write('\n  tack: ' + e3.message + '\n\n'); return 1; }
  process.stdout.write(renderLog(sl, opt).join('\n') + '\n');
  return (target && !sl.repos.length) ? 1 : 0;
}

function main(argv) {
  var args = argv.slice(2);
  if (args.indexOf('--no-color') !== -1 || process.env.NO_COLOR ||
      !process.stdout.isTTY) C.on = false;
  var dryRun = args.indexOf('--dry') !== -1;
  if (args.indexOf('--ascii') !== -1 || process.env.TACK_ASCII) T.SHAPE = 'ascii';
  args.forEach(function (a) {
    var m = a.match(/^--shape=(.+)$/);
    if (m && SHAPES[m[1]]) T.SHAPE = m[1];
    else if (m) process.stderr.write('  no shape called "' + m[1] + '". try: ' +
                                     Object.keys(SHAPES).join(', ') + '\n');
  });
  args = args.filter(function (a) {
    return a !== '--no-color' && a !== '--ascii' && a !== '--dry' &&
           !/^--shape=/.test(a); });

  if (args[0] === '--help' || args[0] === '-h' || args[0] === 'help') {
    process.stdout.write(HELP + '\n'); return 0;
  }

  /* Purely cosmetic, so it does not pay for a sweep of ten repos first. */
  if (args[0] === 'faces') {
    process.stdout.write(renderFaces().join('\n') + '\n'); return 0;
  }
  if (args[0] === 'attic') {
    var U = require('./undo.js');
    process.stdout.write(renderAttic(U.listAttic(), U.atticRoot(), Date.now())
                         .join('\n') + '\n');
    return 0;
  }

  var cfgFile = path.join(__dirname, 'roots.json');

  /* Above the sweep on purpose. `open` needs to know WHERE the repos are, not
   * what state they are in, so it skips three git calls per repo -- and keeps
   * working when git is the thing that is broken. */
  if (args[0] === 'open') {
    var q = args.slice(1).join(' ');
    if (!q) { process.stdout.write('\n  tack open needs something to open.\n' + HELP + '\n'); return 1; }
    var O = require('./open.js');
    var where = sweepPaths(cfgFile);
    var repos = O.matchRepo(q, where);
    var res = repos.length === 1 ? { tier: null, hits: [] }
                                 : O.match(q, O.catalogue(where));
    /* Containment is checked on the RESULT of resolution, never assumed from
     * where the walk found it -- a junction pointing out of a repo is exactly
     * the case a directory walk cannot see. Mains wrote this down; no reason
     * to learn it twice. */
    var roots = where.repos.map(function (r) { return r.dir; });
    res.hits = res.hits.filter(function (f) { return O.isInside(f.file, roots); });
    var out = renderOpen(q, res, repos, { dry: dryRun });
    process.stdout.write(out.lines.join('\n') + '\n');
    return out.code;
  }

  /* Above the sweep for the same reason `open` is: this reports history, so
   * paying for `git status` across ten repos would be a second spent on an
   * answer that is never printed. */
  if (args[0] === 'log') {
    return runLog(cfgFile, args.slice(1), dryRun);
  }

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
  safeRef: safeRef, safeCount: safeCount, parseLog: parseLog, readLog: readLog,
  sweepLog: sweepLog, findCommit: findCommit, readCommit: readCommit,
  parseLogArgs: parseLogArgs, looksLikeRef: looksLikeRef, runLog: runLog,
  renderLog: renderLog, renderCommit: renderCommit, renderPickCommit: renderPickCommit,
  matchedLabel: matchedLabel,
  paintDiff: paintDiff, countRepos: countRepos, TACK_TRAILER: TACK_TRAILER,
  hasTrailer: hasTrailer,
  parseStatusV2: parseStatusV2, describe: describe, findRepos: findRepos,
  discover: discover, loadRoots: loadRoots, expandHome: expandHome,
  labelFor: labelFor, readRepo: readRepo, sweep: sweep, sweepPaths: sweepPaths, rank: rank,
  render: render, renderShow: renderShow, renderAttic: renderAttic, renderOpen: renderOpen, expandMatches: expandMatches, trimEnd: trimEnd, renderOne: renderOne, previewOf: previewOf,
  creature: creature, headBlock: headBlock, SHAPES: SHAPES, renderFaces: renderFaces,
  moodOf: moodOf, ago: ago, agoPhrase: agoPhrase, visLen: visLen, padVis: padVis,
  lpad: lpad, C: C,
  main: main
};

if (require.main === module) {
  var code = main(process.argv);
  if (code && typeof code.then === 'function') code.then(function (c) { process.exit(c); });
  else process.exit(code);
}
