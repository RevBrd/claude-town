#!/usr/bin/env node
/* Tack's harness. Assertions first, then a mutation suite.
 *
 * The suite asserts two kinds of thing. Most of it is correctness. But some of
 * it asserts DELIBERATE properties -- that READ_ONLY_VERBS contains nothing
 * that writes, that the choke point actually refuses, that findRepos does not
 * prune at the first repo it finds. Those look like arbitrary restrictions to
 * anyone reading the code cold, and a harness that tested only correctness
 * would sit quietly while somebody helpfully removed them.
 *
 *   node tools/selftest.js            assertions + mutants
 *   node tools/selftest.js --no-mut   assertions only (fast)
 *   node tools/selftest.js --quiet    failures only
 */
'use strict';

var fs   = require('fs');
var path = require('path');
var os   = require('os');
var cp   = require('child_process');

var HERE   = __dirname;
var ROOT   = path.join(HERE, '..');
var SOURCE = path.join(ROOT, 'tack.js');

var QUIET  = process.argv.indexOf('--quiet')  !== -1;
var NO_MUT = process.argv.indexOf('--no-mut') !== -1;

var pass = 0, fail = 0, failures = [];

function ok(cond, what) {
  if (cond) { pass++; if (!QUIET) console.log('  ok   ' + what); }
  else      { fail++; failures.push(what); console.log('  FAIL ' + what); }
}
function eq(a, b, what) {
  var good = JSON.stringify(a) === JSON.stringify(b);
  ok(good, what + (good ? '' : '   got ' + JSON.stringify(a) +
                            ' want ' + JSON.stringify(b)));
}
function throws(fn, what) {
  var threw = false;
  try { fn(); } catch (e) { threw = true; }
  ok(threw, what);
}
function section(s) { if (!QUIET) console.log('\n' + s); }

/* git's core.autocrlf rewrites line endings on checkout, so a file restored on
 * Windows comes back with CRLF whatever went in. Compare content, not
 * line-ending policy -- otherwise the suite passes or fails on a git setting
 * rather than on anything Tack does. */
function normalise(s) { return String(s).replace(/\r\n/g, '\n'); }

/* ------------------------------------------------------------------ tmp fs */

var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tack-test-'));

/* Rescue into a temp attic, never the real one. Set BEFORE undo.js is required
 * so nothing can read the real path first. */
var REAL_ATTIC = process.env.TACK_ATTIC;
process.env.TACK_ATTIC = path.join(TMP, 'attic');
function tmp(p) { var full = path.join(TMP, p); fs.mkdirSync(full, { recursive: true }); return full; }
function cleanup() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  if (REAL_ATTIC === undefined) delete process.env.TACK_ATTIC;
  else process.env.TACK_ATTIC = REAL_ATTIC;
}

/* The harness may run git itself -- it is building fixtures, not being the
 * tool. Only tack.js is bound by READ_ONLY_VERBS. */
function rawGit(dir, args) {
  return cp.spawnSync('git', ['-C', dir].concat(args),
    { encoding: 'utf8', windowsHide: true });
}

/* ------------------------------------------------------------------- suite */

function suite(TK, W, SIT, U, O) {

  section('the read-only guarantee');

  /* If pass 2 widens this list, it updates this assertion in the same commit
   * and says so. That is the whole point of writing it down twice. */
  eq(TK.READ_ONLY_VERBS.slice().sort(),
     ['--version', 'log', 'rev-parse', 'status'],
     'READ_ONLY_VERBS is exactly the four reading verbs');

  var WRITERS = ['add', 'commit', 'checkout', 'restore', 'reset', 'clean',
                 'rm', 'mv', 'push', 'pull', 'fetch', 'stash', 'merge',
                 'rebase', 'apply', 'revert', 'branch', 'tag', 'init',
                 'gc', 'prune', 'filter-branch', 'update-ref'];
  var leaked = WRITERS.filter(function (v) {
    return TK.READ_ONLY_VERBS.indexOf(v) !== -1; });
  eq(leaked, [], 'no writing verb is on the allowlist');

  WRITERS.slice(0, 8).forEach(function (v) {
    throws(function () { TK.git(TMP, [v, '.']); },
           'git() refuses `git ' + v + '`');
  });

  /* The guard must be the first thing git() does, or a refused verb would
   * still have been spawned before anyone noticed. Proven by pointing it at a
   * directory that is not a repo: a real spawn would return ok:false, and a
   * guard that fires first throws instead. */
  throws(function () { TK.git(TMP, ['commit', '-m', 'x']); },
         'git() throws rather than returning a failed result');

  section('status parsing');

  var NUL = '\0';
  var fixture = [
    '# branch.oid abc123',
    '# branch.head master',
    '# branch.upstream origin/master',
    '# branch.ab +3 -1',
    '1 .M N... 100644 100644 100644 aaa bbb CLAUDE.md',
    '1 M. N... 100644 100644 100644 aaa bbb src/staged file.js',
    '2 R. N... 100644 100644 100644 aaa bbb R100 new name.md',
    'old name.md',
    'u UU N... 100644 100644 100644 100644 aa bb cc conflict.txt',
    '? untracked thing.txt',
    '? Tack/'
  ].join(NUL) + NUL;

  var p = TK.parseStatusV2(fixture);
  eq(p.branch, 'master', 'branch.head is read');
  eq(p.upstream, 'origin/master', 'branch.upstream is read');
  eq([p.ahead, p.behind], [3, 1], 'branch.ab gives ahead and behind');
  eq(p.files.length, 6, 'six entries, and the rename original is not one of them');
  eq(p.files.map(function (f) { return f.path; }),
     ['CLAUDE.md', 'src/staged file.js', 'new name.md', 'conflict.txt',
      'untracked thing.txt', 'Tack/'],
     'paths survive spaces, and a rename yields the new name');
  eq(p.files[4].path.charAt(0), 'u', 'an untracked path has no leading space');

  eq(TK.parseStatusV2('').files.length, 0, 'empty status parses to nothing');
  eq(TK.parseStatusV2('# branch.head master' + NUL).ahead, 0,
     'no branch.ab line means zero ahead');

  section('file descriptions use git vocabulary');

  eq(TK.describe({ state: 'untracked', xy: '??' }), 'untracked', 'untracked');
  eq(TK.describe({ state: 'unmerged',  xy: 'UU' }), 'conflicted', 'unmerged');
  eq(TK.describe({ state: 'renamed',   xy: 'R.' }), 'renamed', 'renamed');
  eq(TK.describe({ state: 'tracked',   xy: '.M' }), 'modified', 'worktree modification');
  eq(TK.describe({ state: 'tracked',   xy: 'M.' }), 'staged', 'staged modification');
  eq(TK.describe({ state: 'tracked',   xy: '.D' }), 'deleted', 'deletion');
  eq(TK.describe({ state: 'tracked',   xy: 'A.' }), 'added', 'addition');

  section('discovery finds nested repos');

  /* ~/.claude is a repo that CONTAINS a repo (Pet). A scan that prunes at the
   * first .git it finds hides the Pet completely, and the failure is invisible
   * because the parent still shows up looking correct. */
  var nest = tmp('nest');
  fs.mkdirSync(path.join(nest, '.git'));
  fs.mkdirSync(path.join(nest, 'inner', '.git'), { recursive: true });
  fs.mkdirSync(path.join(nest, 'plain'), { recursive: true });
  var hits = TK.findRepos(nest, 2, ['.git']);
  eq(hits.length, 2, 'a repo inside a repo is found, not pruned');
  ok(hits.indexOf(nest) !== -1, 'the outer repo is found');
  ok(hits.indexOf(path.join(nest, 'inner')) !== -1, 'the inner repo is found');

  var deep = tmp('deep/a/b/c');
  fs.mkdirSync(path.join(deep, '.git'));
  eq(TK.findRepos(path.join(TMP, 'deep'), 1, ['.git']).length, 0,
     'depth is respected -- a repo below the limit is not reached');
  eq(TK.findRepos(path.join(TMP, 'deep'), 3, ['.git']).length, 1,
     'and is reached when the limit allows it');

  var skipped = tmp('skipme/node_modules/pkg');
  fs.mkdirSync(path.join(skipped, '.git'));
  eq(TK.findRepos(path.join(TMP, 'skipme'), 4, ['.git', 'node_modules']).length, 0,
     'skip list is honoured');

  section('roots');

  eq(TK.expandHome('~/x').indexOf('~'), -1, 'a leading ~ expands');
  eq(TK.expandHome('/no/~/tilde'), '/no/~/tilde', 'a ~ mid-path is left alone');

  var cfgFile = path.join(TMP, 'roots.json');
  fs.writeFileSync(cfgFile, JSON.stringify({
    roots: [{ path: nest, depth: 2 }, { path: nest, depth: 2 },
            { path: path.join(TMP, 'gone'), depth: 1 }],
    skip: ['.git']
  }));
  var d = TK.discover(TK.loadRoots(cfgFile));
  eq(d.repos.length, 2, 'a root listed twice does not double the repos');
  eq(d.missingRoots.length, 1, 'a root that does not exist is reported, not dropped');

  section('reading a real repo');

  var live = tmp('live');
  rawGit(live, ['init', '-q']);
  rawGit(live, ['config', 'user.email', 'test@example.com']);
  rawGit(live, ['config', 'user.name', 'Test']);

  var now = Date.now();
  var r0 = TK.readRepo(live, now);
  ok(r0.empty, 'a repo with no commits reports empty');
  ok(!r0.last, 'and has no last commit');
  eq(r0.loose, 0, 'and nothing loose');

  fs.writeFileSync(path.join(live, 'a.txt'), 'hello');
  var r1 = TK.readRepo(live, now);
  eq(r1.loose, 1, 'an untracked file is loose');
  eq(TK.describe(r1.files[0]), 'untracked', 'and reads as untracked');
  ok(r1.empty, 'still empty -- an untracked file is not a commit');

  rawGit(live, ['add', 'a.txt']);
  rawGit(live, ['commit', '-qm', 'first']);
  var r2 = TK.readRepo(live, now);
  ok(!r2.empty, 'after a commit it is no longer empty');
  eq(r2.loose, 0, 'and clean');
  eq(r2.last.subject, 'first', 'the last commit subject is read');

  fs.writeFileSync(path.join(live, 'a.txt'), 'changed');
  var r3 = TK.readRepo(live, now);
  eq(TK.describe(r3.files[0]), 'modified', 'an edit reads as modified');
  ok(r3.oldest !== null, 'a loose file has an age');

  /* An untracked folder collapses in the glance and expands in `show`. */
  fs.mkdirSync(path.join(live, 'box'));
  fs.writeFileSync(path.join(live, 'box', 'one.txt'), '1');
  fs.writeFileSync(path.join(live, 'box', 'two.txt'), '2');
  var glance = TK.readRepo(live, now);
  var full   = TK.readRepo(live, now, { untracked: 'all' });
  ok(full.loose > glance.loose,
     'untracked:all expands a folder the glance collapsed');
  ok(glance.files.some(function (f) { return f.path === 'box/'; }),
     'the glance shows the folder itself');

  section('live detection');

  var justNow = TK.readRepo(live, now);
  ok(justNow.live, 'a file written seconds ago marks the repo live');
  var muchLater = TK.readRepo(live, now + (TK.T.LIVE_MINUTES + 5) * 60000);
  ok(!muchLater.live, 'and stops being live once the window passes');

  section('ages');

  var N = 1000000000000;
  eq(TK.ago(N, N), 'now', 'zero reads as now');
  eq(TK.ago(N - 30 * 1000, N), 'now', 'under a minute reads as now');
  eq(TK.ago(N - 90 * 1000, N), '2m', 'minutes');
  eq(TK.ago(N - 3 * 3600 * 1000, N), '3h', 'hours');
  eq(TK.ago(N - 5 * 86400 * 1000, N), '5d', 'days');
  eq(TK.ago(N - 21 * 86400 * 1000, N), '3w', 'weeks past a fortnight');
  eq(TK.ago(null, N), '', 'no timestamp renders as nothing');
  eq(TK.ago(N + 60000, N), 'now', 'a future mtime does not render a negative age');

  section('ordering');

  var mk = function (label, loose, oldest, empty, error) {
    return { label: label, loose: loose, oldest: oldest, empty: !!empty,
             error: error || null, files: [] };
  };
  eq(TK.rank(mk('a', 2, 1)), 0, 'dirty ranks first');
  eq(TK.rank(mk('b', 0, null, true)), 1, 'empty ranks second');
  eq(TK.rank(mk('c', 0, null)), 2, 'clean ranks last');
  eq(TK.rank(mk('d', 0, null, false, 'boom')), 0, 'unreadable ranks with dirty');

  var order = [mk('clean', 0, null), mk('newdirty', 1, 500),
               mk('empty', 0, null, true), mk('olddirty', 1, 100)];
  order.sort(function (a, b) {
    var ra = TK.rank(a), rb = TK.rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 0) return (a.oldest || 0) - (b.oldest || 0);
    return a.label.localeCompare(b.label);
  });
  eq(order.map(function (x) { return x.label; }),
     ['olddirty', 'newdirty', 'empty', 'clean'],
     'longest-sitting first, then empty, then clean');

  section('rendering');

  /* These used to assert "the creature is three lines", which was an
   * incidental fact rather than a property -- it went red the moment a shape
   * grew ears, having caught nothing. What actually matters is stated below,
   * and holds for any shape anyone adds later. */
  var MOODS = ['pleased', 'awake', 'alert', 'puzzled'];
  Object.keys(TK.SHAPES).forEach(function (name) {
    var head = TK.creature('awake', name);

    ok(head.length >= 3, name + ': at least three lines');
    var widths = head.map(function (l) { return l.length; });
    eq(widths, head.map(function () { return widths[0]; }),
       name + ': every line is the same width, or the text beside it shears');

    /* Only the eyes change, and they live on the line text attaches to. */
    var eyeRow = head.length - 2;
    var drawn = MOODS.map(function (m) { return TK.creature(m, name); });
    ok(drawn[0][eyeRow] !== drawn[2][eyeRow],
       name + ': the eyes change with the mood');
    for (var row = 0; row < head.length; row++) {
      if (row === eyeRow) continue;
      var same = drawn.every(function (d) { return d[row] === drawn[0][row]; });
      ok(same, name + ': line ' + row + ' is the same in every mood — only the eyes move');
    }
  });

  eq(TK.creature('awake', 'no-such-shape'), TK.creature('awake', 'plain'),
     'an unknown shape name falls back rather than throwing');

  section('the creature and its text');

  /* Text attaches to the LAST two lines, so a taller shape grows upward and
   * nothing else has to move. A shape with ears would shear against its own
   * caption if this were pinned to lines 1 and 2. */
  Object.keys(TK.SHAPES).forEach(function (name) {
    TK.T.SHAPE = name;
    var block = TK.headBlock('awake', 'FIRST', 'SECOND');
    eq(block.length, TK.creature('awake', name).length,
       name + ': the block is as tall as the creature');
    ok(block[block.length - 2].indexOf('FIRST')  !== -1, name + ': line one sits beside the eyes');
    ok(block[block.length - 1].indexOf('SECOND') !== -1, name + ': line two sits beside the chin');
    for (var i = 0; i < block.length - 2; i++) {
      ok(block[i].indexOf('FIRST') === -1 && block[i].indexOf('SECOND') === -1,
         name + ': nothing is written beside line ' + i);
    }
  });
  TK.T.SHAPE = 'bat';

  ok(TK.renderFaces().join('\n').indexOf('bat') !== -1, 'faces lists every shape');
  Object.keys(TK.SHAPES).forEach(function (name) {
    ok(TK.renderFaces().join('\n').indexOf(name) !== -1, 'faces shows ' + name);
  });

  eq(TK.moodOf({ totals: { errors: 1, empty: 0, files: 0 } }), 'alert', 'errors alarm it');
  eq(TK.moodOf({ totals: { errors: 0, empty: 0, files: 4 } }), 'awake', 'loose work wakes it');
  eq(TK.moodOf({ totals: { errors: 0, empty: 0, files: 0 } }), 'pleased', 'a clean tree pleases it');
  eq(TK.moodOf({ totals: { errors: 0, empty: 1, files: 0 } }), 'puzzled', 'an empty repo puzzles it');

  eq(TK.visLen('\x1b[38;5;179mabc\x1b[0m'), 3, 'colour codes do not count as width');
  eq(TK.visLen('abc'), 3, 'plain text measures plainly');
  eq(TK.padVis('\x1b[1max\x1b[0m', 5).replace(/\x1b\[[0-9;]*m/g, ''), 'ax   ',
     'padding measures the visible text, not the bytes');

  var wide = { error: null, empty: false, loose: 3, files: [
    { path: 'some/quite/long/name/CREDITS.md' },
    { path: 'some/quite/long/name/GRABBAG.md' },
    { path: 'some/quite/long/name/third.md' } ] };
  var prev = TK.previewOf(wide, 32);
  ok(prev.length <= 32, 'a preview never exceeds its column (' + prev.length + ')');
  ok(/\+\d/.test(prev), 'and counts what it could not show');
  eq(TK.previewOf({ error: null, empty: true, loose: 0, files: [] }),
     'no commits yet', 'an empty repo says so instead of saying clean');
  eq(TK.previewOf({ error: null, empty: false, loose: 0, files: [] }),
     'clean', 'a clean repo says clean');

  section('the whole readout');

  var state = {
    now: now, missingRoots: [],
    repos: [TK.readRepo(live, now)],
    totals: { repos: 1, dirty: 1, files: 3, empty: 0, errors: 0, oldest: now - 90000 }
  };
  var lines = TK.render(state);
  ok(lines.length > 5, 'the readout has content');
  eq(lines.filter(function (l) { return /\s$/.test(l); }).length, 0,
     'no rendered line has trailing whitespace');
  /* The glance has to state its own limits, because a tool that can commit and
   * a tool that can also throw work away look identical from the outside.
   *
   * This assertion has now been rewritten twice, each time because the true
   * statement changed -- first it said "read-only", then "cannot undo", and
   * now that discarding exists the load-bearing fact is where the copy goes.
   * Both times the harness went red on a doc edit, which is the behaviour to
   * keep: a tool whose printed description of itself has drifted from what it
   * does is worse than one that never described itself. */
  ok(/attic/.test(lines.join('\n')),
     'the readout says out loud where discarded work is kept');

  var plainState = JSON.parse(JSON.stringify(state));
  plainState.totals = { repos: 3, dirty: 0, files: 0, empty: 0, errors: 0, oldest: null };
  plainState.repos = [];
  ok(TK.render(plainState).join('\n').indexOf('everything is committed') !== -1,
     'a clean tree says so');

  eq(TK.renderOne({ totals: { repos: 3, dirty: 0, files: 0, errors: 0, oldest: null }, now: now }),
     'all 3 repos committed', 'the one-liner handles a clean tree');
  ok(TK.renderOne({ totals: { repos: 3, dirty: 2, files: 5, errors: 0, oldest: now - 86400000 },
                    now: now }).indexOf('5 loose') !== -1,
     'and reports the count otherwise');

  var missState = { now: now, repos: [], missingRoots: ['~/nowhere'],
    totals: { repos: 0, dirty: 0, files: 0, empty: 0, errors: 0, oldest: null } };
  ok(TK.render(missState).join('\n').indexOf('root not found') !== -1,
     'a vanished root is reported, never silently dropped');

  section('show');

  var shown = TK.renderShow({ now: now, repos: [TK.readRepo(live, now, { untracked: 'all' })],
                              missingRoots: [], totals: {} }, 'live');
  ok(shown.join('\n').indexOf('box/one.txt') !== -1, 'show lists files inside a folder');
  var miss = TK.renderShow({ now: now, repos: [], missingRoots: [], totals: {} }, 'zzz');
  ok(miss.join('\n').indexOf('no repo matching') !== -1, 'an unmatched name says so');

  section('the real tree');

  var realCfg = path.join(ROOT, 'roots.json');
  var s = TK.sweep(realCfg, Date.now());
  ok(s.repos.length > 0, 'the live sweep finds repos (' + s.repos.length + ')');
  eq(s.totals.repos, s.repos.length, 'the totals count what the list holds');
  eq(s.totals.files, s.repos.reduce(function (n, r) { return n + r.loose; }, 0),
     'the loose total is the sum of the rows');
  ok(s.repos.every(function (r) { return typeof r.label === 'string' && r.label.length; }),
     'every repo has a label');
  ok(TK.render(s).length > 0, 'and the real state renders');

  /* ================================================================== write */

  section('what write.js may do');

  eq(W.WRITE_VERBS.slice().sort(), ['add', 'commit'],
     'WRITE_VERBS is exactly add and commit');

  ['restore', 'checkout', 'reset', 'clean', 'rm', 'stash', 'push',
   'rebase', 'merge', 'revert', 'filter-branch'].forEach(function (v) {
    throws(function () { W.gitWrite(TMP, [v]); }, 'gitWrite refuses `git ' + v + '`');
  });

  /* Pass 2a cannot undo anything. When 2b arrives it widens WRITE_VERBS and
   * updates the assertion above in the same commit -- deliberately, in one
   * visible place, exactly like READ_ONLY_VERBS. */
  ok(W.WRITE_VERBS.indexOf('restore') === -1 &&
     W.WRITE_VERBS.indexOf('checkout') === -1 &&
     W.WRITE_VERBS.indexOf('reset') === -1,
     'nothing in pass 2a can undo your work');

  section('add -A is inexpressible');

  ['-A', '--all', '-a', '-u', '--update', '.', '*', ':/'].forEach(function (spec) {
    throws(function () { W.gitWrite(TMP, ['add', spec]); },
           'a wholesale pathspec is refused: ' + spec);
  });
  throws(function () { W.assertNoWholesale(['add', 'ok.txt', '-A']); },
         'and it is refused wherever in the arguments it appears');
  ok(W.WHOLESALE.indexOf('-A') !== -1, '-A is on the wholesale list by name');

  section('paths cannot be flags or escapes');

  throws(function () { W.assertSafePath('../outside.txt'); }, 'a path may not escape upward');
  throws(function () { W.assertSafePath('..'); }, 'nor be .. alone');
  throws(function () { W.assertSafePath('--force'); }, 'nor look like a flag');
  throws(function () { W.assertSafePath(''); }, 'nor be empty');
  throws(function () { W.assertSafePath(path.join(TMP, 'abs.txt')); }, 'nor be absolute');
  eq(W.assertSafePath('sub/fine.txt'), 'sub/fine.txt', 'an ordinary relative path is fine');
  eq(W.assertSafePath('a file with spaces.md'), 'a file with spaces.md', 'spaces are fine');

  section('the Pet folder is blocked for restore, not for commit');

  var petDir = path.join(os.homedir(), '.claude', 'Pet');
  ok(W.isBlockedForRestore(petDir), 'the Pet folder is blocked');
  ok(W.isBlockedForRestore(path.join(petDir, 'tools')), 'and so is anything under it');
  ok(!W.isBlockedForRestore(path.join(os.homedir(), '.claude')),
     'but not its parent -- .claude itself is an ordinary repo');
  ok(!W.isBlockedForRestore(path.join(os.homedir(), '.claude', 'Petunia')),
     'and not a sibling whose name merely starts the same way');
  ok(W.WRITE_VERBS.indexOf('commit') !== -1,
     'commit is allowed everywhere, including the Pet -- committing log.js is ' +
     'what preserves a visit, so refusing would leave it at risk');

  section('commit messages');

  var mkf = function (p, state, xy) { return { path: p, state: state, xy: xy || '.M' }; };
  eq(W.defaultMessage([mkf('CLAUDE.md', 'tracked')]), 'update CLAUDE.md',
     'one modified file');
  eq(W.defaultMessage([mkf('new.txt', 'untracked', '??')]), 'add new.txt',
     'one new file');
  eq(W.defaultMessage([mkf('gone.txt', 'tracked', '.D')]), 'remove gone.txt',
     'one deleted file');
  eq(W.defaultMessage([mkf('a.md', 'tracked'), mkf('b.md', 'untracked', '??')]),
     'update a.md, b.md', 'a mix falls back to update');
  eq(W.defaultMessage([mkf('deep/nested/where/file.md', 'tracked')]),
     'update file.md', 'the basename is used, not the whole path');
  eq(W.defaultMessage([]), '', 'nothing selected yields no message');

  var many = [];
  for (var mi = 0; mi < 30; mi++) many.push(mkf('file-number-' + mi + '.md', 'tracked'));
  var longMsg = W.defaultMessage(many);
  ok(longMsg.length <= 72, 'a long selection still fits a subject line (' + longMsg.length + ')');
  ok(/and \d+ more$/.test(longMsg), 'and says how many it did not name');

  /* The subject says what changed; the fact that Tack did it is metadata and
   * goes in a trailer, where it does not crowd out the explanation. */
  var withT = W.withTrailer('update CLAUDE.md');
  ok(withT.split('\n')[0] === 'update CLAUDE.md', 'the subject line is the real message');
  ok(withT.indexOf(W.TRAILER) !== -1, 'and the trailer is appended');
  eq(W.withTrailer(withT), withT, 'appending twice does not double the trailer');

  section('committing, for real');

  var wrepo = tmp('writable');
  rawGit(wrepo, ['init', '-q']);
  rawGit(wrepo, ['config', 'user.email', 'test@example.com']);
  rawGit(wrepo, ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(wrepo, 'seed.txt'), 'seed');
  rawGit(wrepo, ['add', 'seed.txt']);
  rawGit(wrepo, ['commit', '-qm', 'seed']);

  fs.writeFileSync(path.join(wrepo, 'one.txt'), '1');
  fs.writeFileSync(path.join(wrepo, 'two.txt'), '2');
  fs.mkdirSync(path.join(wrepo, 'sub'));
  fs.writeFileSync(path.join(wrepo, 'sub', 'three.txt'), '3');

  var before = TK.readRepo(wrepo, Date.now(), { untracked: 'all' });
  var expect = {};
  before.files.forEach(function (f) { expect[f.path] = f.xy; });
  eq(before.loose, 3, 'three files are loose to begin with');

  var res = W.commitPaths(wrepo, ['one.txt', 'sub/three.txt'], '', expect);
  ok(res.ok, 'a commit of two selected paths succeeds');
  eq(res.count, 2, 'and reports what it committed');
  ok(/^[0-9a-f]{4,}$/.test(res.sha), 'and hands back the sha');

  var after = TK.readRepo(wrepo, Date.now(), { untracked: 'all' });
  eq(after.files.map(function (f) { return f.path; }), ['two.txt'],
     'the file that was NOT selected is still loose');

  var body = rawGit(wrepo, ['log', '-1', '--format=%B']).stdout;
  ok(body.indexOf('add one.txt, three.txt') === 0, 'the derived subject describes what changed');
  ok(body.indexOf(W.TRAILER) !== -1, 'and the trailer records who did it');

  eq(W.commitPaths(wrepo, [], 'x', {}).ok, false, 'committing nothing is refused');

  section('another session\'s staged work is not swept in');

  /* The failure this tree has actually had: acting on a whole-repo picture and
   * carrying somebody else's half-finished file along with it. */
  fs.writeFileSync(path.join(wrepo, 'theirs.txt'), 'half done');
  rawGit(wrepo, ['add', 'theirs.txt']);
  fs.writeFileSync(path.join(wrepo, 'mine.txt'), 'mine');

  var st2 = TK.readRepo(wrepo, Date.now(), { untracked: 'all' });
  var exp2 = {};
  st2.files.forEach(function (f) { exp2[f.path] = f.xy; });

  var res2 = W.commitPaths(wrepo, ['mine.txt'], 'just mine', exp2);
  ok(res2.ok, 'committing one path succeeds while another sits staged');
  var stat = rawGit(wrepo, ['show', '--stat', '--format=', 'HEAD']).stdout;
  ok(stat.indexOf('mine.txt') !== -1, 'the selected file is in the commit');
  ok(stat.indexOf('theirs.txt') === -1,
     "and the other session's staged file is NOT");
  ok(rawGit(wrepo, ['status', '--porcelain']).stdout.indexOf('theirs.txt') !== -1,
     'it is still sitting there, untouched, for whoever owns it');

  section('a stale picture is refused');

  fs.writeFileSync(path.join(wrepo, 'moving.txt'), 'first');
  var st3 = TK.readRepo(wrepo, Date.now(), { untracked: 'all' });
  var exp3 = {};
  st3.files.forEach(function (f) { exp3[f.path] = f.xy; });

  /* Somebody else acts between the list being drawn and the key being pressed. */
  rawGit(wrepo, ['add', 'moving.txt']);
  var res3 = W.commitPaths(wrepo, ['moving.txt'], 'x', exp3);
  ok(!res3.ok, 'a file that changed while you were deciding is not committed');
  ok(/moved while you were deciding/.test(res3.reason), 'and it says so plainly');
  ok(res3.moved && res3.moved.length === 1, 'and names what moved');

  var res4 = W.commitPaths(wrepo, ['never-existed.txt'], 'x', {});
  ok(!res4.ok, 'a path that is no longer changed is refused');

  /* ==================================================================== sit */

  section('the sitting');

  var sitCfg = path.join(TMP, 'sit-roots.json');
  fs.writeFileSync(sitCfg, JSON.stringify({
    roots: [{ path: path.join(TMP, 'writable'), depth: 0 }], skip: ['.git'] }));

  fs.writeFileSync(path.join(wrepo, 'pick-me.txt'), 'x');
  var sit = new SIT.Sitting(sitCfg);
  eq(sit.view, 'repos', 'a sitting opens on the list of repos');
  ok(sit.draw().length > 0, 'and draws');

  sit.key('\r');
  eq(sit.view, 'files', 'enter opens a repo that has loose work');
  ok(sit.repo.files.length > 0, 'and it has files');
  ok(Object.keys(sit.expect).length === sit.repo.files.length,
     'every drawn file is recorded in the expect map');

  eq(sit.selected().length, 0, 'nothing is picked to begin with');
  sit.key('c');
  eq(sit.view, 'files', 'committing with nothing picked does not leave the list');
  ok(/nothing picked/.test(sit.notice), 'and says why');

  sit.key(' ');
  eq(sit.selected().length, 1, 'space picks the file under the cursor');
  sit.key(' ');
  eq(sit.selected().length, 0, 'and space again unpicks it');

  sit.key('a');
  eq(sit.selected().length, sit.repo.files.length, 'a picks everything');
  sit.key('a');
  eq(sit.selected().length, 0, 'and a again picks nothing');

  sit.key(' ');
  sit.key('c');
  eq(sit.view, 'message', 'c with something picked asks for a message');
  ok(sit.draw().indexOf(sit.defaultMsg()) !== -1, 'and offers the derived one');
  sit.key('\x1b');
  eq(sit.view, 'files', 'escape goes back without committing');

  sit.key('c');
  sit.key('h'); sit.key('i');
  eq(sit.message, 'hi', 'typing replaces the message');
  sit.key('\x7f');
  eq(sit.message, 'h', 'backspace works');
  sit.key('\r');
  eq(sit.view, 'done', 'enter commits and reports');
  ok(/committed/.test(sit.notice), 'and the report says it worked');
  ok(rawGit(wrepo, ['log', '-1', '--format=%s']).stdout.indexOf('h') === 0,
     'the typed message is the one that landed');

  var sit2 = new SIT.Sitting(sitCfg);
  ok(sit2.draw().length > 0, 'a fresh sitting still draws after a commit');
  ['repos', 'files', 'message', 'done'].forEach(function (v) {
    var s2 = new SIT.Sitting(sitCfg);
    s2.key('\r'); s2.key(' ');
    if (v === 'message' || v === 'done') s2.key('c');
    if (v === 'done') { s2.view = 'done'; s2.notice = 'x'; }
    if (v === 'repos') { s2.view = 'repos'; }
    var drew = true;
    try { s2.draw(); } catch (e) { drew = false; }
    ok(drew, 'the ' + v + ' view draws without throwing');
  });

  var quit = new SIT.Sitting(sitCfg);
  eq(quit.key('q'), false, 'q from the repo list quits');
  var back = new SIT.Sitting(sitCfg);
  back.key('\r');
  eq(back.key('q'), true, 'but q inside a repo goes back rather than quitting');
  eq(back.view, 'repos', 'and lands on the repo list');

  /* =================================================================== open */

  section('Tack shows files; it does not run programs');

  /* The headline hazard, checked with `ftype` on this machine rather than
   * assumed: .js is bound to WScript.exe, so handing tack.js to the shell
   * would EXECUTE it -- in a tree that is mostly .js. */
  ok(O.RUNS_BUT_READABLE.indexOf('.js') !== -1,
     '.js is known to be something Windows runs');
  ['.bat', '.cmd', '.ps1', '.vbs', '.hta', '.reg'].forEach(function (e) {
    ok(O.RUNS_BUT_READABLE.indexOf(e) !== -1, e + ' too');
  });
  ['.exe', '.com', '.msi', '.scr', '.lnk', '.cpl'].forEach(function (e) {
    ok(O.NEVER_OPENED.indexOf(e) !== -1, e + ' is never opened at all');
  });
  eq(O.RUNS_BUT_READABLE.filter(function (e) {
       return O.NEVER_OPENED.indexOf(e) !== -1; }), [],
     'no extension is on both lists');

  eq(O.kindOf('C:/x/tack.js'), 'script', 'a .js is a script, not a document');
  eq(O.kindOf('C:/x/TACK.JS'), 'script', 'and case does not smuggle one past');
  eq(O.kindOf('C:/x/Power On.bat'), 'script', 'a .bat is a script');
  eq(O.kindOf('C:/x/thing.exe'), 'program', 'an .exe is a program');
  eq(O.kindOf('C:/x/marquee.html'), 'document', 'an .html is a document');
  eq(O.kindOf('C:/x/CLAUDE.md'), 'document', 'so is a .md');
  eq(O.kindOf('C:/x/noextension'), 'document', 'and so is a file with no extension');

  section('nothing outside the swept repos is reachable');

  var box = tmp('openbox');
  var inside = tmp('openbox/repo');
  fs.mkdirSync(path.join(inside, '.git'));
  fs.writeFileSync(path.join(inside, 'a.html'), '<h1>a</h1>');
  fs.writeFileSync(path.join(inside, 'notes.md'), '# notes');
  fs.mkdirSync(path.join(inside, 'deep', 'deeper'), { recursive: true });
  fs.writeFileSync(path.join(inside, 'deep', 'deeper', 'buried.html'), 'x');
  fs.mkdirSync(path.join(inside, 'node_modules', 'junk'), { recursive: true });
  fs.writeFileSync(path.join(inside, 'node_modules', 'junk', 'a.html'), 'no');
  fs.writeFileSync(path.join(box, 'outside.html'), 'not in any repo');

  ok(O.isInside(path.join(inside, 'a.html'), [inside]), 'a file in a repo is inside it');
  ok(!O.isInside(path.join(box, 'outside.html'), [inside]),
     'a file next to the repo is not');

  /* A prefix test on the string would say `repo-old` is inside `repo`. Mains
   * wrote this one down; no reason to learn it twice. */
  var sibling = tmp('openbox/repo-old');
  fs.writeFileSync(path.join(sibling, 'decoy.html'), 'x');
  ok(!O.isInside(path.join(sibling, 'decoy.html'), [inside]),
     'and neither is a sibling whose name merely starts the same way');

  section('walking a repo');

  var walked = O.walk(inside, ['.git', 'node_modules'], 6);
  var names = walked.map(function (f) { return f.name; }).sort();
  ok(names.indexOf('a.html') !== -1, 'a top-level file is found');
  ok(names.indexOf('buried.html') !== -1, 'and a deep one');
  eq(walked.filter(function (f) { return /node_modules/.test(f.rel); }), [],
     'the skip list is honoured');
  eq(O.walk(inside, ['.git', 'node_modules'], 1)
      .filter(function (f) { return f.name === 'buried.html'; }), [],
     'and the depth cap is real');

  section('matching a file by part of its name');

  var FILES = [
    { name: 'marquee.html', rel: 'marquee.html', repo: 'Claude Town/Marquee', file: 'X/marquee.html' },
    { name: 'marquee.js',   rel: 'marquee.js',   repo: 'Claude Town/Marquee', file: 'X/marquee.js' },
    { name: 'marquee.cmd',  rel: 'marquee.cmd',  repo: 'Claude Town/Marquee', file: 'X/marquee.cmd' },
    { name: 'panel.html',   rel: 'panel.html',   repo: 'Claude Town/Mains',   file: 'X/panel.html' },
    { name: 'salient.html', rel: 'Salient/salient.html', repo: 'Games', file: 'X/salient.html' },
    { name: 'salient_job1.html', rel: 'Salient/salient_job1.html', repo: 'Games', file: 'X/sj.html' }
  ];

  eq(O.match('marquee.html', FILES).hits.length, 1, 'a full filename resolves to one');
  eq(O.match('marquee.html', FILES).tier, 'filename', 'reported as a filename match');
  eq(O.match('MARQUEE.HTML', FILES).hits.length, 1, 'case does not matter');
  eq(O.match('panel', FILES).hits.length, 1, 'a stem resolves when it is unique');

  var many = O.match('marquee', FILES);
  eq(many.hits.length, 3, 'a stem shared by three files matches all three');
  eq(many.tier, 'stem', 'at the stem tier');

  /* Marquee deliberately hides predecessors; the back door deliberately does
   * not. `salient` is the shipped one and `salient_job1` is reachable by name,
   * which is the entire reason this verb exists. */
  eq(O.match('salient', FILES).hits.length, 1, 'a stem beats a longer name sharing it');
  eq(O.match('salient', FILES).hits[0].name, 'salient.html', 'and picks the exact stem');
  eq(O.match('salient_job1', FILES).hits[0].name, 'salient_job1.html',
     'while the predecessor is still reachable by its own name');

  eq(O.match('Salient/', FILES).hits.length, 2, 'a path fragment matches what is under it');
  eq(O.match('', FILES).hits.length, 0, 'an empty query matches nothing');
  eq(O.match('nothing-like-this', FILES).hits.length, 0, 'and a miss is a miss');

  section('a bare repo name opens the folder');

  var fakeState = { repos: [{ dir: 'C:/x/Games', label: 'Games' },
                            { dir: 'C:/x/Misc Tools', label: 'Misc Tools' }] };
  eq(O.matchRepo('games', fakeState).length, 1, 'a repo label matches its repo');
  eq(O.matchRepo('Misc Tools', fakeState).length, 1, 'including one with a space');
  eq(O.matchRepo('marquee', fakeState).length, 0, 'and a filename does not');

  section('what open prints, and what it launches');

  /* The launch is counted rather than trusted. --dry must open NOTHING, and a
   * program must be refused rather than run. */
  var launched = [];
  var realLaunch = O.launch;
  O.launch = function (f, k) { launched.push([f, k]); };

  var one = TK.renderOpen('marquee.html',
    { tier: 'filename', hits: [FILES[0]] }, [], { dry: true });
  ok(one.lines.join('\n').indexOf('would open') !== -1, '--dry says "would open"');
  eq(launched.length, 0, 'and launches nothing at all');
  eq(one.code, 0, 'and succeeds');

  TK.renderOpen('marquee.html', { tier: 'filename', hits: [FILES[0]] }, [], {});
  eq(launched.length, 1, 'without --dry it launches');
  eq(launched[0][1], 'document', 'an .html goes to the shell as a document');

  launched.length = 0;
  var script = TK.renderOpen('tack.js',
    { tier: 'filename', hits: [{ name: 'tack.js', rel: 'tack.js', repo: 'T', file: 'X/tack.js' }] }, [], {});
  eq(launched[0][1], 'script', 'a .js is launched as a script, never as a document');
  ok(/would RUN this/.test(script.lines.join('\n')), 'and the readout says why');
  ok(script.lines.join('\n').indexOf(O.editor()) !== -1, 'and names the editor');

  launched.length = 0;
  var prog = TK.renderOpen('thing.exe',
    { tier: 'filename', hits: [{ name: 'thing.exe', rel: 'thing.exe', repo: 'T', file: 'X/thing.exe' }] }, [], {});
  eq(launched.length, 0, 'a program is never launched');
  eq(prog.code, 1, 'and it is an error');
  ok(/does not run them/.test(prog.lines.join('\n')), 'and says so plainly');

  launched.length = 0;
  var amb = TK.renderOpen('marquee', { tier: 'stem', hits: FILES.slice(0, 3) }, [], {});
  eq(launched.length, 0, 'an ambiguous match launches nothing');
  eq(amb.code, 1, 'and is an error');
  ok(/does not guess/.test(amb.lines.join('\n')), 'and refuses to choose');
  ok(amb.lines.join('\n').indexOf('marquee.cmd') !== -1, 'listing every candidate');

  launched.length = 0;
  var none = TK.renderOpen('zzz', { tier: null, hits: [] }, [], {});
  eq(launched.length, 0, 'a miss launches nothing');
  eq(none.code, 1, 'and is an error');

  launched.length = 0;
  var folder = TK.renderOpen('games', { tier: null, hits: [] },
                             [{ dir: 'C:/x/Games', label: 'Games' }], {});
  eq(launched.length, 1, 'a repo name launches its folder');
  eq(launched[0][0], 'C:/x/Games', 'the folder itself');
  eq(folder.code, 0, 'and succeeds');

  O.launch = realLaunch;

  section('the back door does not need git');

  /* It resolves where the repos are from the filesystem, not from git, so it
   * still opens things when git is the thing that is broken. */
  var where = TK.sweepPaths(path.join(ROOT, 'roots.json'));
  ok(where.repos.length > 0, 'repo paths resolve without a sweep');
  ok(where.repos.every(function (r) { return r.dir && r.label; }),
     'each with a directory and a label');
  ok(where.repos.every(function (r) { return !('branch' in r) || r.branch == null; }),
     'and no git state was gathered');

  /* =================================================================== undo */

  section('what undo.js may do');

  eq(U.RESTORE_VERBS, ['restore'], 'RESTORE_VERBS is exactly one verb');
  ['reset', 'clean', 'checkout', 'rm', 'stash', 'commit', 'add'].forEach(function (v) {
    throws(function () { U.gitRestore(TMP, [v]); }, 'undo.js refuses `git ' + v + '`');
  });

  /* --staged would destroy an index another session is holding; --source would
   * restore from an arbitrary commit rather than from what is already recorded.
   * Neither is needed, and both are worse than what they replace. */
  ['--staged', '-S', '--source', '-s', '--overlay'].forEach(function (f) {
    throws(function () { U.gitRestore(TMP, ['restore', f, 'x']); },
           'undo.js refuses to reach past the working tree: ' + f);
  });
  throws(function () { U.gitRestore(TMP, ['restore', '--', '-A']); },
         'and a wholesale pathspec is refused here too');

  section('sorting a selection into safe and dangerous');

  var sorted = U.classify([
    { path: 'gone.txt',  state: 'tracked',   xy: '.D' },
    { path: 'edit.txt',  state: 'tracked',   xy: '.M' },
    { path: 'new.txt',   state: 'untracked', xy: '??' },
    { path: 'clash.txt', state: 'unmerged',  xy: 'UU' }
  ]);
  eq(sorted.undelete, ['gone.txt'], 'a deleted tracked file is an undelete');
  eq(sorted.discard,  ['edit.txt'], 'a modified file is a discard');
  eq(sorted.refused.map(function (r) { return r.path; }), ['new.txt', 'clash.txt'],
     'untracked and conflicted files are refused');
  ok(/deleting it/.test(sorted.refused[0].why),
     'and the untracked one explains that putting it back would mean deleting it');

  section('putting files back, for real');

  var urepo = tmp('undoable');
  rawGit(urepo, ['init', '-q']);
  rawGit(urepo, ['config', 'user.email', 'test@example.com']);
  rawGit(urepo, ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(urepo, 'keep.txt'), 'committed content\n');
  fs.writeFileSync(path.join(urepo, 'gone.txt'), 'deleted later\n');
  rawGit(urepo, ['add', '.']);
  rawGit(urepo, ['commit', '-qm', 'base']);

  fs.writeFileSync(path.join(urepo, 'keep.txt'), 'PRECIOUS UNSAVED EDITS\n');
  fs.unlinkSync(path.join(urepo, 'gone.txt'));
  fs.writeFileSync(path.join(urepo, 'mine.txt'), 'untracked\n');

  var uNow = Date.now();
  var ust = TK.readRepo(urepo, uNow, { untracked: 'all' });
  var uexp = {};
  ust.files.forEach(function (f) { uexp[f.path] = f.xy; });
  var upaths = ust.files.map(function (f) { return f.path; });

  /* The dangerous half never runs on the first ask. */
  var first = U.restorePaths(urepo, 'undoable', upaths,
                             { expect: uexp, now: uNow });
  ok(!first.ok, 'a selection containing a discard is not done without confirming');
  ok(first.needsConfirm, 'and it says what it is waiting for');
  eq(first.discard, ['keep.txt'], 'and names exactly what would be lost');
  eq(normalise(fs.readFileSync(path.join(urepo, 'keep.txt'), 'utf8')), 'PRECIOUS UNSAVED EDITS\n',
     'and the file is untouched meanwhile');

  var done = U.restorePaths(urepo, 'undoable', upaths,
                            { expect: uexp, now: uNow, confirmed: true });
  ok(done.ok, 'confirming does it');
  eq(done.undeleted, ['gone.txt'], 'the deleted file is reported as put back');
  eq(done.discarded, ['keep.txt'], 'the modified file is reported as discarded');
  ok(fs.existsSync(path.join(urepo, 'gone.txt')), 'the deleted file is actually back');
  eq(normalise(fs.readFileSync(path.join(urepo, 'keep.txt'), 'utf8')), 'committed content\n',
     'the modified file is actually back to its committed state');

  /* The one that matters most. */
  ok(fs.existsSync(path.join(urepo, 'mine.txt')),
     'the untracked file still exists — restoring one would mean deleting it');

  section('the attic kept what was destroyed');

  /* The suite must never file a rescue into the real attic. It did, for one
   * build -- thirteen fake entries, found by running `tack attic` and reading
   * the output. The attic is only worth anything if what is in it is yours. */
  ok(U.atticRoot().toLowerCase().indexOf(TMP.toLowerCase()) === 0,
     'the suite rescues into a temp attic, never the real one');
  ok(U.atticRoot().toLowerCase().indexOf('localappdata') === -1 &&
     U.atticRoot().toLowerCase().indexOf(path.join('appdata', 'local', 'tack').toLowerCase()) === -1,
     'and the real attic path is nowhere near it');

  ok(done.attic && fs.existsSync(done.attic), 'a snapshot folder exists');
  eq(normalise(fs.readFileSync(path.join(done.attic, 'keep.txt'), 'utf8')),
     'PRECIOUS UNSAVED EDITS\n',
     'and holds the exact bytes that git can no longer produce');
  ok(fs.existsSync(path.join(done.attic, '_where-this-came-from.txt')),
     'with a note saying where they came from and how to put one back');
  ok(!fs.existsSync(path.join(done.attic, 'gone.txt')),
     'an undelete is not snapshotted — it destroys nothing');

  /* Outside every repo, or a snapshot would show up in the next sweep as
   * loose work, and could land in a commit. */
  var atticIn = TK.sweep(path.join(ROOT, 'roots.json'), Date.now()).repos
    .some(function (r) { return U.atticRoot().toLowerCase()
                                 .indexOf(r.dir.toLowerCase() + path.sep) === 0; });
  ok(!atticIn, 'the attic is not inside any repo Tack sweeps');

  ok(U.listAttic().length > 0, 'the attic lists what is in it');
  ok(U.listAttic().every(function (e) { return e.stamp && e.label && e.dir; }),
     'and every entry knows when and where it came from');
  ok(TK.renderAttic(U.listAttic(), U.atticRoot(), Date.now()).join('\n')
     .indexOf(U.atticRoot()) !== -1,
     'and the readout prints the folder, so it can be found without knowing it');
  ok(TK.renderAttic([], U.atticRoot(), Date.now()).join('\n').indexOf('never discarded') !== -1,
     'an empty attic says so rather than printing nothing');

  section('restore refuses the things it must');

  eq(U.restorePaths(petDir, 'Pet', ['log.js'], { confirmed: true }).ok, false,
     'the Pet folder is refused before anything is read');
  ok(/append-only|never restored/.test(
       U.restorePaths(petDir, 'Pet', ['log.js'], { confirmed: true }).reason),
     'and says why');

  throws(function () {
    U.restorePaths(urepo, 'x', ['../escape.txt'], { confirmed: true });
  }, 'a path that escapes the repo throws');

  eq(U.restorePaths(urepo, 'x', [], { confirmed: true }).ok, false,
     'restoring nothing is refused');

  /* Recent movement WARNS and never blocks. Two versions of a block were built
   * and both were wrong: one refused you for editing the file you wanted back,
   * the other refused you because an unrelated untracked file was new -- and
   * neither could see the case they existed for, because another session
   * editing your file looks exactly like you editing your file. The attic is
   * what makes this safe; the warning is what makes it informed. */
  fs.writeFileSync(path.join(urepo, 'keep.txt'), 'edited just now\n');
  fs.writeFileSync(path.join(urepo, 'someone-else.txt'), 'their work in progress\n');
  var withOther = TK.readRepo(urepo, Date.now(), { untracked: 'all' });
  var oexp = {};
  withOther.files.forEach(function (f) { oexp[f.path] = f.xy; });

  var asked = U.restorePaths(urepo, 'undoable', ['keep.txt'], { expect: oexp });
  ok(asked.needsConfirm, 'discarding a file you just edited yourself is not blocked');
  ok(asked.recent && asked.recent.length,
     'but what moved recently comes back as a warning');
  ok(/someone-else/.test(asked.recent.join(' ')),
     'and it names the file that moved');

  var mineOnly = U.restorePaths(urepo, 'undoable', ['keep.txt'],
                                { expect: oexp, confirmed: true });
  ok(mineOnly.ok, 'and confirming still goes through — the attic is the safety net');
  eq(normalise(fs.readFileSync(path.join(urepo, 'keep.txt'), 'utf8')),
     'committed content\n', 'the file went back');
  ok(fs.existsSync(path.join(urepo, 'someone-else.txt')),
     "and the other file was never touched — restore only reaches what you picked");

  section('nothing Tack does makes a file stop existing');

  /* The claim in CLAUDE.md is that no path through this program ends with a
   * file gone that was there before. The case that could falsify it: `git rm
   * --cached` leaves a file staged-deleted in the index while it is still
   * sitting on disk, reported as TWO entries with the same name -- one
   * `deleted`, one `untracked`. Restoring the worktree from an index that has
   * no entry for it is exactly the shape of an accidental delete. */
  var edge = tmp('edgecase');
  rawGit(edge, ['init', '-q']);
  rawGit(edge, ['config', 'user.email', 'test@example.com']);
  rawGit(edge, ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(edge, 'f.txt'), 'content\n');
  rawGit(edge, ['add', '.']);
  rawGit(edge, ['commit', '-qm', 'base']);
  rawGit(edge, ['rm', '--cached', '-q', 'f.txt']);

  var est = TK.readRepo(edge, Date.now(), { untracked: 'all' });
  var epaths = est.files.map(function (f) { return f.path; });
  eq(epaths, ['f.txt', 'f.txt'], 'the same path really is reported twice');

  var eexp = {};
  est.files.forEach(function (f) { eexp[f.path] = f.xy; });
  U.restorePaths(edge, 'edgecase', epaths, { expect: eexp, confirmed: true });
  ok(fs.existsSync(path.join(edge, 'f.txt')),
     'and the file is still there afterwards');
  eq(normalise(fs.readFileSync(path.join(edge, 'f.txt'), 'utf8')), 'content\n',
     'with its contents intact');

  section('putting back, through the pane');

  var pbCfg = path.join(TMP, 'pb-roots.json');
  fs.writeFileSync(pbCfg, JSON.stringify({
    roots: [{ path: path.join(TMP, 'undoable'), depth: 0 }], skip: ['.git'] }));

  /* The engine tests above already put keep.txt back, so it is clean now.
   * Dirty it again -- the pane can only offer what is actually loose. */
  fs.writeFileSync(path.join(urepo, 'keep.txt'), 'edited again\n');

  var ps = new SIT.Sitting(pbCfg);
  ps.key('\r');
  eq(ps.view, 'files', 'the pane opens the repo');
  ps.key('u');
  ok(/nothing picked/.test(ps.notice), 'u with nothing picked says so');

  /* Pick the modified file specifically. */
  var idx = ps.repo.files.map(function (f) { return f.path; }).indexOf('keep.txt');
  ok(idx !== -1, 'keep.txt is in the list');
  ps.cursor = idx;
  ps.key(' ');
  ps.key('u');
  eq(ps.view, 'putback', 'u on a modified file asks to confirm');
  ok(ps.draw().indexOf('throws work away') !== -1, 'and says plainly what it is');
  ok(ps.draw().indexOf(U.atticRoot()) !== -1, 'and where the copy will go');

  ps.key('y'); ps.key('e'); ps.key('s'); ps.key('\r');
  eq(ps.view, 'putback', 'the wrong word does not go through');
  ok(/type discard exactly/.test(ps.notice), 'and says what is needed');
  eq(normalise(fs.readFileSync(path.join(urepo, 'keep.txt'), 'utf8')), 'edited again\n',
     'and the file is untouched');

  ps.key('\x1b');
  eq(ps.view, 'files', 'escape backs out');
  eq(ps.typed, '', 'and forgets what was typed');
  eq(ps.pending, null, 'and forgets what was pending');

  ps.key('u');
  'discard'.split('').forEach(function (ch) { ps.key(ch); });
  eq(ps.typed, 'discard', 'the word can be typed');
  ps.key('\x7f');
  eq(ps.typed, 'discar', 'and backspaced');
  ps.key('d');
  ps.key('\r');
  eq(ps.view, 'done', 'the right word goes through');
  eq(normalise(fs.readFileSync(path.join(urepo, 'keep.txt'), 'utf8')), 'committed content\n',
     'and the file really did go back');
  ok(/discarded/.test(ps.notice), 'and the report says what happened');
  ok(ps.notice.indexOf(U.atticRoot()) !== -1, 'and where the copy is');

  section('refs: the allowlist is not sufficient once arguments stop being literals');

  /* Until this pass every argument Tack handed git was a literal in tack.js,
   * so the verb allowlist was the whole guard. A ref typed by a person is the
   * first one that is not, and `git log --output=FILE` writes a file -- so a
   * permitted READING verb can be made to write. These assert the second
   * guard, the one on the argument. */
  eq(TK.safeRef('ab84e67'), 'ab84e67', 'a short hash is a ref');
  eq(TK.safeRef('HEAD'), 'HEAD', 'so is HEAD');
  eq(TK.safeRef('refs/heads/master'), 'refs/heads/master', 'so is a full ref name');
  eq(TK.safeRef('v1.2.3-rc1'), 'v1.2.3-rc1', 'so is a tag with dots and dashes');

  ['--output=/tmp/pwned', '-o', '--upload-pack=calc', '-p', '--all',
   'a..b', 'HEAD..HEAD~3', '', '   ', 'a b', 'a;b', 'a|b', 'a$(id)b',
   'a`id`b', 'a\nb', '--', '-'].forEach(function (bad) {
    throws(function () { TK.safeRef(bad); },
           'safeRef refuses ' + JSON.stringify(bad));
  });

  /* The specific one worth naming: this is the argument that turns a reading
   * verb into a writing one, and it is refused by the argument guard rather
   * than by the verb list, which would happily allow it. */
  throws(function () { TK.safeRef('--output=x'); },
         'safeRef refuses the argument that makes `git log` write a file');
  ok(TK.READ_ONLY_VERBS.indexOf('log') !== -1,
     'while `log` itself is still permitted, so the guard is doing the work');

  /* `git show` would have been the obvious way to build a commit view. It is
   * deliberately absent: `log -1 -p` does the same job with a verb that is
   * already on the list, so the commit view cost the allowlist nothing. */
  ok(TK.READ_ONLY_VERBS.indexOf('show') === -1,
     'the commit view did not buy a fifth verb');

  eq(TK.safeCount('5', 15, 500), 5, 'safeCount reads a number');
  eq(TK.safeCount(undefined, 15, 500), 15, 'and falls back when there is none');
  eq(TK.safeCount('0', 15, 500), 15, 'and refuses zero');
  eq(TK.safeCount('-4', 15, 500), 15, 'and refuses a negative');
  eq(TK.safeCount('9999', 15, 500), 500, 'and clamps to the maximum');
  eq(TK.safeCount('7; rm -rf /', 15, 500), 7, 'and yields an integer, never text');

  /* `ago()` returns 'now' under a minute, so every caller that appended ' ago'
   * printed `now ago`. The suffix belongs in the phrase, not the value. */
  eq(TK.agoPhrase(Date.now(), Date.now()), 'just now', 'under a minute reads as just now');
  eq(TK.agoPhrase(Date.now() - 3600000, Date.now()), '1h ago', 'and an hour reads as 1h ago');
  ok(TK.renderCommit({ label: 'x', short: 'abc', when: Date.now(), who: 'T',
                       tack: false, subject: 's', body: '', dir: 'd', files: [], patch: null },
                     Date.now(), {}).join(' ').indexOf('now ago') === -1,
     'and a commit made this minute never says "now ago"');

  section('parsing a log');

  var U1 = '\x1f', R1 = '\x1e';
  var logFixture =
    ['h1', 'h1s', '1700000000', 'Test', 'first subject', 'body one'].join(U1) + R1 + '\n' +
    ['h2', 'h2s', '1700000060', 'Test', 'second subject',
     'why it happened\n\nCommitted with Tack.'].join(U1) + R1 + '\n' +
    ['h3', 'h3s', '1700000120', 'Test', 'third subject',
     'a body that contains ' + U1 + ' a unit separator'].join(U1) + R1 + '\n';

  var parsed = TK.parseLog(logFixture);
  eq(parsed.length, 3, 'three commits parse out');
  eq(parsed[0].subject, 'first subject', 'the subject survives');
  eq(parsed[0].when, 1700000000000, 'the date is milliseconds');
  eq(parsed[1].tack, true, 'the Tack trailer is seen');
  eq(parsed[0].tack, false, 'and not seen where it is absent');
  eq(parsed[2].body, 'a body that contains ' + U1 + ' a unit separator',
     'a body containing the separator does not shift the fields before it');
  eq(TK.parseLog('').length, 0, 'empty output parses to nothing');
  eq(TK.parseLog('   \n  ').length, 0, 'and so does whitespace');

  section('reading history from real repos');

  /* Dates are pinned so the ordering assertions test the sort rather than how
   * fast the machine ran the fixtures. */
  function commitAt(dir, msg, iso) {
    return cp.spawnSync('git', ['-C', dir, 'commit', '-qm', msg], {
      encoding: 'utf8', windowsHide: true,
      env: Object.assign({}, process.env,
        { GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso })
    });
  }

  var hroot = tmp('history');
  var hA = tmp('history/alpha'), hB = tmp('history/beta'), hEmpty = tmp('history/nothing');

  [hA, hB, hEmpty].forEach(function (d) {
    rawGit(d, ['init', '-q']);
    rawGit(d, ['config', 'user.email', 'test@example.com']);
    rawGit(d, ['config', 'user.name', 'Test']);
  });

  fs.writeFileSync(path.join(hA, 'one.txt'), 'a\n');
  rawGit(hA, ['add', 'one.txt']);
  commitAt(hA, 'alpha first', '2024-01-01T00:00:00+0000');

  fs.writeFileSync(path.join(hA, 'one.txt'), 'a\nb\nc\n');
  fs.writeFileSync(path.join(hA, 'two.txt'), 'new\n');
  rawGit(hA, ['add', '.']);
  commitAt(hA, 'alpha second\n\nthe reason\n\nCommitted with Tack.',
           '2024-01-03T00:00:00+0000');

  fs.writeFileSync(path.join(hB, 'b.txt'), 'b\n');
  rawGit(hB, ['add', 'b.txt']);
  commitAt(hB, 'beta only', '2024-01-02T00:00:00+0000');

  var la = TK.readLog(hA, { limit: 10 });
  eq(la.commits.length, 2, 'both of alpha\u2019s commits are read');
  eq(la.commits[0].subject, 'alpha second', 'newest first');
  eq(la.commits[0].tack, true, 'and the trailer is read off the real commit');
  eq(la.commits[1].tack, false, 'and the other one does not claim it');
  eq(la.error, null, 'a readable repo reports no error');

  eq(TK.readLog(hA, { limit: 1 }).commits.length, 1, 'the limit is obeyed');

  var le = TK.readLog(hEmpty, { limit: 10 });
  eq(le.empty, true, 'a repo with no commits is empty');
  eq(le.error, null, 'and that is a state, not a fault');
  eq(le.commits.length, 0, 'and has nothing to show');

  section('merging ten histories into one');

  var hCfg = path.join(TMP, 'history-roots.json');
  fs.writeFileSync(hCfg, JSON.stringify({
    roots: [{ path: hroot, depth: 1 }], skip: ['.git'] }));

  var merged = TK.sweepLog(hCfg, Date.now(), { limit: 10 });
  eq(merged.commits.map(function (c) { return c.subject; }),
     ['alpha second', 'beta only', 'alpha first'],
     'commits from different repos interleave by date, newest first');
  eq(merged.commits[0].repo, TK.labelFor(hA), 'every commit carries its repo');
  eq(merged.truncated, false, 'nothing is held back when everything fits');

  var one = TK.sweepLog(hCfg, Date.now(), { limit: 1 });
  eq(one.commits.length, 1, 'the limit applies to the merged stream');
  /* Not a count. Each repo is asked for `limit` commits, so the size of the
   * merged pool is an artefact of the fetch rather than a fact about the
   * tree -- the only exact thing available is that something was left out. */
  eq(one.truncated, true, 'and it says plainly that something was left out');

  var onlyBeta = TK.sweepLog(hCfg, Date.now(), { only: 'beta', limit: 10 });
  eq(onlyBeta.commits.map(function (c) { return c.subject; }), ['beta only'],
     'a name narrows it to one repo');

  var missed = TK.sweepLog(hCfg, Date.now(), { only: 'nosuchrepo', limit: 10 });
  eq(missed.repos.length, 0, 'a name nothing matches yields no repos rather than everything');
  ok(missed.known.length >= 3, 'while still knowing what it could have matched');

  section('finding and reading one commit');

  var head = rawGit(hA, ['rev-parse', 'HEAD']).stdout.trim();
  var shortHead = head.slice(0, 7);

  var found = TK.findCommit(hCfg, shortHead);
  eq(found.length, 1, 'a hash is found in exactly the repo that holds it');
  eq(found[0].dir, hA, 'and it is the right one');
  eq(TK.findCommit(hCfg, 'ffffff0').length, 0, 'a hash nobody holds is found nowhere');

  /* Two repos both have a HEAD, and the empty one has none. That is the
   * ambiguity case without needing two repos to collide on a short hash:
   * every repo that holds the ref is reported, and nothing resolves it. */
  var bothHave = TK.findCommit(hCfg, 'HEAD');
  eq(bothHave.length, 2, 'a ref two repos hold is found in both');
  eq(bothHave.map(function (h) { return h.label; }).sort(),
     [TK.labelFor(hA), TK.labelFor(hB)].sort(), 'and both are named');
  ok(bothHave[0].hash !== bothHave[1].hash, 'each with its own commit');

  var pick = TK.renderPickCommit('HEAD', bothHave).join('\n');
  ok(pick.indexOf(TK.labelFor(hA)) !== -1, 'the ambiguity lists the first');
  ok(pick.indexOf(TK.labelFor(hB)) !== -1, 'and the second');
  ok(pick.indexOf('2 repos') !== -1, 'and says how many there were');


  var det = TK.readCommit(hA, shortHead, {});
  eq(det.subject, 'alpha second', 'the commit reads back');
  eq(det.files.map(function (f) { return f.path; }).sort(), ['one.txt', 'two.txt'],
     'with the files it touched');
  eq(det.patch, null, 'and no diff unless one was asked for');

  var withP = TK.readCommit(hA, shortHead, { patch: true });
  ok(withP.patch && withP.patch.length > 0, 'and a diff when one was');
  ok(withP.patch.join('\n').indexOf('+b') !== -1, 'which contains the change');

  eq(TK.readCommit(hA, 'ffffff0', {}).files.length, 0,
     'a commit that is not there reports nothing rather than guessing');

  section('log arguments');

  eq(TK.parseLogArgs([]).words, [], 'no arguments means no target');
  eq(TK.parseLogArgs(['-p']).patch, true, '-p asks for the diff');
  eq(TK.parseLogArgs(['--patch']).patch, true, 'and so does --patch');
  eq(TK.parseLogArgs(['-n', '5']).limit, 5, '-n N sets the count');
  eq(TK.parseLogArgs(['-n5']).limit, 5, 'and so does -nN');
  eq(TK.parseLogArgs(['--number=9']).limit, 9, 'and so does --number=N');
  eq(TK.parseLogArgs(['--days', '3']).days, 3, '--days N sets the window');
  eq(TK.parseLogArgs(['--days=3']).days, 3, 'and so does --days=N');
  eq(TK.parseLogArgs(['claude', 'town']).words, ['claude', 'town'],
     'the rest is the target, spaces and all');
  eq(TK.parseLogArgs(['-n', '5', 'games']).words, ['games'],
     'and an option does not swallow the name after its value');

  eq(TK.parseLogArgs(['--oops']).bad, '--oops', 'an unknown option is refused by name');
  eq(TK.parseLogArgs(['--output=/tmp/x']).bad, '--output=/tmp/x',
     'including the one that would make git write a file');
  eq(TK.parseLogArgs(['--oops']).words, [], 'and it never becomes a search term');

  eq(TK.looksLikeRef(['ab84e67']), true, 'a hex string is a candidate ref');
  eq(TK.looksLikeRef(['abcd']), true, 'four characters is enough');
  eq(TK.looksLikeRef(['abc']), false, 'three is not');
  eq(TK.looksLikeRef(['games']), false, 'a name that is not hex is not a ref');
  eq(TK.looksLikeRef(['dead', 'beef']), false, 'and two words are never a ref');
  eq(TK.looksLikeRef(['decade']), true,
     'a name that happens to be hex is a candidate, settled by asking git');

  section('the log, drawn');

  var drawn = TK.renderLog(merged, {}).join('\n');
  ok(drawn.indexOf('alpha second') !== -1, 'the newest subject is on the page');
  ok(drawn.indexOf('beta only') !== -1, 'and so is the other repo');
  ok(drawn.indexOf(' you') !== -1, 'a commit carrying the trailer is marked');
  eq(drawn.split('\n').filter(function (l) { return / you$/.test(l); }).length, 1,
     'and only that one is');

  var emptyDraw = TK.renderLog(
    { now: Date.now(), commits: [], repos: [], missingRoots: [], known: [], truncated: false,
      only: null, days: 7 }, {}).join('\n');
  ok(emptyDraw.indexOf('no commits') !== -1, 'an empty window says so');

  var missDraw = TK.renderLog(
    { now: Date.now(), commits: [], repos: [], missingRoots: [], truncated: false,
      known: ['Games', 'Codeville'], only: 'nosuch', days: null }, {}).join('\n');
  ok(missDraw.indexOf('no repo matching') !== -1, 'an unmatched name says so');
  ok(missDraw.indexOf('Games') !== -1, 'and lists what it does know');

  eq(TK.matchedLabel(onlyBeta), TK.labelFor(hB),
     'the header names the repo git answered for, not the letters typed at it');
  ok(/2 repos matching/.test(TK.matchedLabel(
       { only: 'a', repos: [{ label: 'x' }, { label: 'y' }], commits: [] })),
     'and says two when a name matched two');

  section('one commit, drawn');

  var cDraw = TK.renderCommit(withP, Date.now(), { patch: true }).join('\n');
  ok(cDraw.indexOf('alpha second') !== -1, 'the subject is shown');
  ok(cDraw.indexOf('the reason') !== -1, 'and the body, which is why a log is worth reading');
  ok(cDraw.indexOf('one.txt') !== -1, 'and the files it touched');

  ok(cDraw.indexOf(TK.TACK_TRAILER) === -1, 'the trailer is not echoed back');
  ok(cDraw.indexOf('yours') !== -1, 'it is reported as a mark instead');

  var noP = TK.renderCommit(det, Date.now(), {}).join('\n');
  ok(noP.indexOf('-p') !== -1, 'without a diff it says how to get one');

  var errDraw = TK.renderCommit({ error: 'no commit zzz', files: [] }, Date.now(), {}).join('\n');
  ok(errDraw.indexOf('no commit zzz') !== -1, 'an unreadable commit says so');

  var huge = { label: 'x', short: 'abc1234', when: Date.now(), who: 'Test', tack: false,
               subject: 's', body: '', dir: 'd',
               files: [{ added: '1', removed: '0', path: 'f' }], patch: [] };
  for (var hp = 0; hp < TK.T.PATCH_MAX + 40; hp++) huge.patch.push('+line ' + hp);
  var hugeDraw = TK.renderCommit(huge, Date.now(), { patch: true }).join('\n');
  ok(hugeDraw.indexOf('40 more lines') !== -1, 'a long diff counts what it did not show');
  ok(hugeDraw.indexOf('git -C') !== -1, 'and hands over to git for the rest');
  section('history, through the pane');

  var hs = new SIT.Sitting(hCfg);

  /* The empty repo sorts first, which makes it the accidental default -- and
   * `l` on a repo with no commits has to say so rather than opening a blank
   * list. */
  eq(hs.repos[hs.cursor].label, TK.labelFor(hEmpty), 'the empty repo is where the cursor lands');
  hs.key('l');
  eq(hs.view, 'repos', 'l on a repo with no commits does not open anything');
  ok(/no commits yet/.test(hs.notice), 'and says why');

  /* Every other verb in this pane needs something loose to act on. History is
   * the one that works on a repo where there is nothing to do. */
  var alphaAt = hs.repos.map(function (r) { return r.label; }).indexOf(TK.labelFor(hA));
  ok(alphaAt !== -1, 'alpha is in the pane');
  hs.cursor = alphaAt;
  eq(hs.repos[alphaAt].loose, 0, 'and it is clean');
  hs.key('l');
  eq(hs.view, 'history', 'l opens the history of a clean repo all the same');
  eq(hs.log.commits.length, 2, 'with its commits');

  var hdraw = hs.draw();
  ok(hdraw.indexOf('alpha second') !== -1, 'the newest subject is drawn');
  ok(hdraw.indexOf('history') !== -1, 'and the header says what this is');
  ok(hdraw.indexOf('you') !== -1, 'and the trailer is marked here too');

  /* Nothing in these two views may touch anything. The keys that pick, commit
   * and discard are inert while the history is open -- asserted rather than
   * assumed, because they are one `return true` away from being live. */
  /* Space is deliberately absent from this list: in the repo list it opens
   * the thing under the cursor, and it does the same here. */
  var pickedBefore = JSON.stringify(hs.picked);
  ['a', 'c', 'u'].forEach(function (k) { hs.key(k); });
  eq(hs.view, 'history', 'picking and committing keys do nothing in the history');
  eq(JSON.stringify(hs.picked), pickedBefore, 'and nothing gets picked');

  hs.key('\x1b[B');
  eq(hs.logCursor, 1, 'the cursor moves down');
  hs.key('\x1b[A');
  eq(hs.logCursor, 0, 'and back up');
  hs.key('\x1b[A');
  eq(hs.logCursor, 0, 'and stops at the top');

  hs.key(' ');
  eq(hs.view, 'commit', 'space opens it, the same as in the repo list');
  hs.key('q');
  eq(hs.view, 'history', 'and q comes straight back');

  hs.key('\r');
  eq(hs.view, 'commit', 'so does enter');
  eq(hs.commit.subject, 'alpha second', 'the right one');
  /* It must not even READ the patch. The pane has nowhere to put four
   * hundred lines, so fetching them would be work done to be thrown away
   * on every commit anyone looks at. */
  eq(hs.commit.patch, null, 'and the pane did not fetch a diff it cannot show');
  var cdraw = hs.draw();
  ok(cdraw.indexOf('one.txt') !== -1, 'the files it touched are drawn');
  ok(cdraw.indexOf('the reason') !== -1, 'and the message body');
  ok(cdraw.indexOf(TK.TACK_TRAILER) === -1, 'and not the trailer');

  /* The pane is on the alternate screen so nothing it draws reaches your
   * scrollback, which makes it the wrong place for a long diff. It names the
   * command instead of pretending to be a pager. */
  ok(/-p/.test(cdraw), 'and it says where the diff is');

  var pickedStill = JSON.stringify(hs.picked);
  [' ', 'a', 'c', 'u'].forEach(function (k) { hs.key(k); });
  eq(hs.view, 'commit', 'every one of those keys is inert on one commit');
  eq(JSON.stringify(hs.picked), pickedStill, 'and still nothing is picked');

  hs.key('q');
  eq(hs.view, 'history', 'q leaves the commit for the list');
  hs.key('q');
  eq(hs.view, 'repos', 'and q again leaves the list for where it started');
  eq(hs.log, null, 'and forgets it');

}

/* ---------------------------------------------------------------- mutation */

/* Each mutant breaks exactly one guarantee. If the suite still passes, the
 * assertion for that guarantee is missing or too weak -- which is the only
 * thing this section is for. */
var MUTANTS = [
  ['the read-only guard is removed',
   "if (READ_ONLY_VERBS.indexOf(verb) === -1) {",
   "if (false) {"],

  ['findRepos prunes at the first repo it finds',
   "      if (entries[i].name === '.git' && entries[i].isDirectory()) found.push(dir);",
   "      if (entries[i].name === '.git' && entries[i].isDirectory()) { found.push(dir); return; }"],

  ['a rename does not consume its original-path record',
   "      i++; /* the record that follows a rename is its original path */",
   "      /* skipped */"],

  ['an untracked path keeps its leading space',
   "      out.files.push({ path: t.slice(2), xy: '??', state: 'untracked' });",
   "      out.files.push({ path: t.slice(1), xy: '??', state: 'untracked' });"],

  ['the empty-repo test is inverted',
   "  rec.empty = !head.ok;",
   "  rec.empty = head.ok;"],

  ['a staged change reads as modified',
   "  if (x !== '.')               return 'staged';",
   "  if (false)                   return 'staged';"],

  ['the hour boundary is wrong',
   "  if (m < 1440) return Math.round(m / 60) + 'h';",
   "  if (m < 1440) return Math.round(m / 30) + 'h';"],

  ['a negative age is rendered',
   "  var d = Math.max(0, now - ms), m = d / 60000;",
   "  var d = now - ms, m = d / 60000;"],

  ['empty repos sort with the clean ones',
   "  if (r.empty)   return 1;",
   "  if (r.empty)   return 2;"],

  ['the plain shape shears',
   "    return [' ╭─────╮',\n            ' │ ' + eyes + ' │',\n            ' ╰──┬──╯'];",
   "    return [' ╭─────╮',\n            ' │' + eyes + '│',\n            ' ╰──┬──╯'];"],

  ['the ears are a different width from the head',
   "    return [' ╱╲   ╱╲',\n            ' ╭─────╮',",
   "    return [' ╱╲   ╱╲ ',\n            ' ╭─────╮',"],

  ['the ascii fallback shears instead',
   "    return [' ,---. ',\n            '( ' + eyes + ' )',\n            \" `-|-' \"];",
   "    return [' ,---.',\n            '( ' + eyes + ' )',\n            \" `-|-' \"];"],

  ['the eyes stop moving with the mood',
   "  var eyes = { pleased: '^ ^', awake: 'o o', alert: 'O O', puzzled: 'o -' }[mood] || 'o o';",
   "  var eyes = 'o o';"],

  ['text is pinned to lines 1 and 2 instead of the last two',
   "    var text = i === h.length - 2 ? line1 : (i === h.length - 1 ? line2 : '');",
   "    var text = i === 1 ? line1 : (i === 2 ? line2 : '');"],

  ['visLen counts colour codes as width',
   "function visLen(s) { return String(s).replace(/\\x1b\\[[0-9;]*m/g, '').length; }",
   "function visLen(s) { return String(s).length; }"],

  ['trailing whitespace is left on the rows',
   "function trimEnd(s) { return String(s).replace(/\\s+$/, ''); }",
   "function trimEnd(s) { return String(s); }"],

  ['the preview overruns its column',
   "  var s = clip(shown.join(', '), width - (rest > 0 ? String(' +' + rest).length : 0));",
   "  var s = shown.join(', ');"],

  ['discover stops deduplicating roots',
   "      if (seen[k]) continue;",
   "      if (false) continue;"],

  ['a missing root is silently dropped',
   "    if (!fs.existsSync(abs)) { missing.push(r.path); continue; }",
   "    if (!fs.existsSync(abs)) { continue; }"],

  ['untracked:all is ignored, so show cannot expand a folder',
   "                     '--untracked-files=' + (opts.untracked || 'normal')]);",
   "                     '--untracked-files=normal']);"],

  ['the live window never closes',
   "  if (rec.newest !== null && now - rec.newest < T.LIVE_MINUTES * 60000) rec.live = true;",
   "  if (rec.newest !== null) rec.live = true;"],

  ['a writing verb is quietly added to the allowlist',
   "var READ_ONLY_VERBS = ['status', 'log', 'rev-parse', '--version'];",
   "var READ_ONLY_VERBS = ['status', 'log', 'rev-parse', '--version', 'add'];"]
].map(function (m) { return { file: 'tack.js', name: m[0], from: m[1], to: m[2] }; });

/* The write layer's guarantees. Every one of these is a thing somebody could
 * remove while believing they were simplifying. */
var MUTANTS_WRITE = [
  ['the wholesale-pathspec check is removed',
   "  for (var i = 0; i < args.length; i++) {\n    if (WHOLESALE.indexOf(args[i]) !== -1) {",
   "  for (var i = 0; i < args.length; i++) {\n    if (false) {"],

  ['-A drops off the wholesale list',
   "var WHOLESALE = ['-A', '--all', '-a', '--update', '-u', '.', '*', ':/', ':(top)'];",
   "var WHOLESALE = ['--all', '-a', '--update', '-u', '.', '*', ':/', ':(top)'];"],

  ['restore is quietly added to the write allowlist',
   "var WRITE_VERBS = ['add', 'commit'];",
   "var WRITE_VERBS = ['add', 'commit', 'restore'];"],

  ['the verb allowlist is not consulted',
   "  if (WRITE_VERBS.indexOf(verb) === -1) {",
   "  if (false) {"],

  ['a path may escape the repo',
   "  if (norm === '..' || norm.indexOf('../') === 0) {",
   "  if (false) {"],

  ['a path may be an absolute path',
   "  if (path.isAbsolute(p))   throw new Error('path must be relative: ' + p);",
   "  if (false)   throw new Error('path must be relative: ' + p);"],

  ['a path may look like a flag',
   "  if (p.charAt(0) === '-')  throw new Error('path looks like a flag: ' + p);",
   "  if (false)  throw new Error('path looks like a flag: ' + p);"],

  ['the Pet block matches by prefix, so a sibling is caught too',
   "    return real === lb || real.indexOf(lb + path.sep) === 0;",
   "    return real === lb || real.indexOf(lb) === 0;"],

  ['the Pet folder stops being blocked',
   "var NEVER_RESTORE = [path.join(os.homedir(), '.claude', 'Pet')];",
   "var NEVER_RESTORE = [];"],

  ['the stale-picture check is removed',
   "  if (moved.length) {",
   "  if (false) {"],

  ['a path that vanished is committed anyway',
   "    if (!(p in current)) { moved.push(p + ' is no longer changed'); return; }",
   "    if (!(p in current)) { return; }"],

  ['the commit is not limited to the selected paths',
   "  var out = gitWrite(repoDir, ['commit', '-m', msg, '--'].concat(paths));",
   "  var out = gitWrite(repoDir, ['commit', '-m', msg]);"],

  ['an empty selection commits everything staged',
   "  if (!paths || !paths.length) return { ok: false, reason: 'nothing selected' };",
   "  if (false) return { ok: false, reason: 'nothing selected' };"],

  ['the derived subject stops describing what changed',
   "  return verb + ' ' + shown.join(', ') + (rest > 0 ? ' and ' + rest + ' more' : '');",
   "  return 'committed by Tack';"],

  ['the subject line is no longer capped',
   "    if (shown.length && (verb.length + 1 + candidate.length) > 68) break;",
   "    if (false) break;"],

  ['the trailer is appended every time',
   "  if (message.indexOf(TRAILER) !== -1) return message;",
   "  if (false) return message;"]
].map(function (m) { return { file: 'write.js', name: m[0], from: m[1], to: m[2] }; });

var MUTANTS_SIT = [
  ['the expect map is not rebuilt when a repo is reopened',
   "  this.expect = {};\n  this.picked = {};",
   "  this.picked = {};"],

  ['committing with nothing picked is allowed through',
   "    if (!this.selected().length) { this.notice = 'nothing picked yet — space picks a file'; return true; }",
   "    if (false) { return true; }"],

  ['q quits from inside a repo instead of going back',
   "    if (v === 'files') { this.view = 'repos'; this.repo = null; this.notice = '';\n                         this.refresh(); return true; }",
   "    if (false) { return true; }"],

  ['space stops toggling',
   "  if (k === ' ') { if (f) { this.picked[f.path] = !this.picked[f.path]; } this.notice = ''; return true; }",
   "  if (k === ' ') { if (f) { this.picked[f.path] = true; } this.notice = ''; return true; }"],

  ['the expect map is never handed to the commit',
   "  var res = W.commitPaths(this.repo.dir, picked, msg, this.expect, Date.now());",
   "  var res = W.commitPaths(this.repo.dir, picked, msg, null, Date.now());"]
].map(function (m) { return { file: 'sit.js', name: m[0], from: m[1], to: m[2] }; });

/* The restore layer. This is the only part of Tack that can destroy work, so
 * every guarantee here gets a mutant that removes it. */
var MUTANTS_UNDO = [
  ['a discard runs without being confirmed',
   "  if (sorted.discard.length && !opts.confirmed) {",
   "  if (false) {"],

  ['nothing is copied to the attic first',
   "  if (sorted.discard.length) {\n    kept = snapshot(repoDir, label, sorted.discard, now);",
   "  if (false) {\n    kept = snapshot(repoDir, label, sorted.discard, now);"],

  ['a failed snapshot no longer stops the discard',
   "    if (!kept.saved.length) {",
   "    if (false) {"],

  ['an untracked file is treated as something to restore',
   "    if (word === 'untracked') {\n      out.refused.push({ path: f.path, why: 'untracked — putting this back would mean deleting it' });",
   "    if (word === 'untracked') {\n      out.discard.push(f.path);"],

  ['a conflicted file is restored instead of left alone',
   "    } else if (word === 'conflicted') {",
   "    } else if (false) {"],

  ['a deletion is classed as a discard, so undeleting asks to confirm',
   "    } else if (word === 'deleted') {\n      out.undelete.push(f.path);",
   "    } else if (false) {\n      out.undelete.push(f.path);"],

  ['the Pet folder stops being refused for restore',
   "  if (W.isBlockedForRestore(repoDir)) {",
   "  if (false) {"],

  ['restore stops checking for a stale picture',
   "  if (moved.length) {",
   "  if (false) {"],

  ['--staged stops being forbidden',
   "var FORBIDDEN_FLAGS = ['--staged', '-S', '--source', '-s', '--overlay'];",
   "var FORBIDDEN_FLAGS = ['-S', '--source', '-s', '--overlay'];"],

  ['the forbidden-flag check is skipped',
   "    if (FORBIDDEN_FLAGS.indexOf(args[i]) !== -1) {",
   "    if (false) {"],

  ['undo.js accepts any git verb',
   "  if (RESTORE_VERBS.indexOf(verb) === -1) {",
   "  if (false) {"],

  ['a wholesale pathspec is no longer refused on restore',
   "  W.assertNoWholesale(args);",
   "  /* skipped */"],

  ['the restore is not limited to the paths you picked',
   "  var r = gitRestore(repoDir, ['restore', '--'].concat(doing));",
   "  var r = gitRestore(repoDir, ['restore', '--'].concat(Object.keys(current)));"],

  ['the attic moves inside the repo it is rescuing from',
   "  var base = process.env.LOCALAPPDATA ||\n             path.join(os.homedir(), 'AppData', 'Local');\n  return path.join(base, 'Tack', 'attic');",
   "  return path.join(__dirname, 'attic');"],

  ['the attic keeps no note of where the files came from',
   "  if (saved.length) {\n    fs.writeFileSync(path.join(dir, '_where-this-came-from.txt'),",
   "  if (false) {\n    fs.writeFileSync(path.join(dir, '_where-this-came-from.txt'),"],

  ['recent movement is never reported to the caller',
   "  var recent = fresh.files.filter(function (f) {\n    return f.mtime && now - f.mtime < TK.T.LIVE_MINUTES * 60000;\n  }).map(function (f) { return f.path + ' (' + TK.ago(f.mtime, now) + ')'; });",
   "  var recent = [];"]
].map(function (m) { return { file: 'undo.js', name: m[0], from: m[1], to: m[2] }; });

var MUTANTS_SIT2 = [
  ['the confirmation word is not checked',
   "      if (this.typed.trim().toLowerCase() === CONFIRM_WORD) this.doPutBackConfirmed();",
   "      if (true) this.doPutBackConfirmed();"],

  ['u puts files back without ever asking',
   "  if (res.needsConfirm) {",
   "  if (false) {"],

  ['backing out of a discard leaves it pending',
   "    if (k === '\\x1b') { this.view = 'files'; this.typed = ''; this.pending = null; return true; }",
   "    if (k === '\\x1b') { this.view = 'files'; return true; }"],

  ['the confirmation is a single keypress instead of a word',
   "var CONFIRM_WORD = 'discard';",
   "var CONFIRM_WORD = 'y';"]
].map(function (m) { return { file: 'sit.js', name: m[0], from: m[1], to: m[2] }; });

/* The back door. Its two rules are "nothing outside the sweep" and "shows
 * files, does not run programs", and every mutant here removes one of them. */
var MUTANTS_OPEN = [
  ['.js stops being treated as something Windows runs',
   "var RUNS_BUT_READABLE = ['.js', '.jse',",
   "var RUNS_BUT_READABLE = ['.jse',"],

  ['nothing is treated as a script, so everything goes to the shell',
   '  if (RUNS_BUT_READABLE.indexOf(ext) !== -1) return \'script\';',
   '  if (false) return \'script\';'],

  ['programs stop being refused',
   '  if (NEVER_OPENED.indexOf(ext) !== -1)     return \'program\';',
   '  if (false)     return \'program\';'],

  ['the extension check becomes case-sensitive',
   "  var ext = (String(file).match(/\\.[^.\\\\/]+$/) || [''])[0].toLowerCase();",
   "  var ext = (String(file).match(/\\.[^.\\\\/]+$/) || [''])[0];"],

  ['containment is a bare prefix test, so a sibling repo counts as inside',
   "    return real.toLowerCase().indexOf(r.toLowerCase() + path.sep) === 0;",
   "    return real.toLowerCase().indexOf(r.toLowerCase()) === 0;"],

  ['containment is not checked at all',
   "  return roots.some(function (root) {",
   "  return true || roots.some(function (root) {"],

  ['the skip list is ignored while walking',
   '        if (skip.indexOf(e.name) !== -1) continue;',
   '        if (false) continue;'],

  ['the depth cap is removed',
   '        if (level < depth) step(path.join(dir, e.name), rel + e.name + \'/\', level + 1);',
   '        step(path.join(dir, e.name), rel + e.name + \'/\', level + 1);'],

  ['an ambiguous match is resolved by taking the first file',
   '    if (hits.length) return { tier: TIERS[t][0], hits: hits };',
   '    if (hits.length) return { tier: TIERS[t][0], hits: hits.slice(0, 1) };'],

  ['an empty query matches every file in the tree',
   '  if (!q) return { tier: null, hits: [] };',
   '  if (!q) return { tier: null, hits: files };'],

  ['a script is handed to the shell instead of the editor',
   "  if (kind === 'script') {\n    /* Opened to READ. Handing it to the shell would run it. */",
   "  if (false) {\n    /* Opened to READ. Handing it to the shell would run it. */"]
].map(function (m) { return { file: 'open.js', name: m[0], from: m[1], to: m[2] }; });

var MUTANTS_TACK2 = [
  ['--dry opens the file anyway',
   '  if (!dry) O.launch(hit.file, kind);',
   '  O.launch(hit.file, kind);'],

  ['a program is launched rather than refused',
   "  if (kind === 'program') {",
   "  if (false) {"],

  ['an ambiguous list is opened rather than printed',
   '  if (res.hits.length > 1) {',
   '  if (false) {'],

  ['sweepPaths gathers git state after all',
   '      return { dir: d, label: labelFor(d), error: null };',
   '      return readRepo(d, Date.now());']
].map(function (m) { return { file: 'tack.js', name: m[0], from: m[1], to: m[2] }; });

/* The log pass. Half of these break a guard and half break a claim the render
 * makes; both kinds are here because both kinds are things a later session
 * could remove while believing it was tidying up. */
var MUTANTS_LOG = [
  ['the ref guard is removed',
   "  if (!REF_OK.test(s) || s.indexOf('..') !== -1) {",
   "  if (false) {"],

  ['a ref may begin with a dash, so an option can pose as one',
   "var REF_OK = /^[0-9A-Za-z][0-9A-Za-z._\\/-]{0,80}$/;",
   "var REF_OK = /^[0-9A-Za-z-][0-9A-Za-z._\\/-]{0,80}$/;"],

  ['a ref may be a range',
   "  if (!REF_OK.test(s) || s.indexOf('..') !== -1) {",
   "  if (!REF_OK.test(s)) {"],

  ['a count is passed through as text rather than rebuilt as a number',
   "  var v = parseInt(n, 10);\n  if (!isFinite(v) || v < 1) return dflt;\n  return Math.min(v, max);",
   "  if (n === undefined || n === null || n === '') return dflt;\n  return n;"],

  ['a count is not clamped',
   "  return Math.min(v, max);",
   "  return v;"],

  ['a body containing the separator shifts the fields before it',
   "    var body = f.slice(5).join(LOG_UNIT);",
   "    var body = f[5];"],

  ['the trailer test is inverted, so every commit claims to be yours',
   "      tack:    body.indexOf(TACK_TRAILER) !== -1",
   "      tack:    body.indexOf(TACK_TRAILER) === -1"],

  ['a repo with no commits is reported as broken rather than empty',
   "    if (!head.ok) { rec.empty = true; return rec; }",
   "    if (false) { rec.empty = true; return rec; }"],

  ['the merged stream is oldest first',
   "  all.sort(function (a, b) { return b.when - a.when || a.repo.localeCompare(b.repo); });",
   "  all.sort(function (a, b) { return a.when - b.when || a.repo.localeCompare(b.repo); });"],

  ['a name does not narrow the sweep',
   "    if (opts.only && r.label.toLowerCase().indexOf(opts.only.toLowerCase()) === -1) continue;",
   "    if (false) continue;"],

  ['holding commits back is not reported',
   "  var truncated = all.length > shown.length || repos.some(function (r) {",
   "  var truncated = false && all.length > shown.length || repos.some(function (r) {"],

  ['a repo that filled its share is assumed to have had no more',
   "  var truncated = all.length > shown.length || repos.some(function (r) {\n    return r.commits.length >= want; });",
   "  var truncated = all.length > shown.length;"],

  ['an ambiguous ref is resolved by taking the first repo',
   "  return hits;\n}\n\n/* One commit, in full",
   "  return hits.slice(0, 1);\n}\n\n/* One commit, in full"],

  ['the diff is read whether it was asked for or not',
   "  if (opts.patch) {",
   "  if (true) {"],

  ['an unknown option becomes a search term',
   "    if (a.charAt(0) === '-') { opt.bad = a; return opt; }",
   "    if (false) { opt.bad = a; return opt; }"],

  ['three characters are enough to be a hash',
   "  return words.length === 1 && /^[0-9a-fA-F]{4,40}$/.test(words[0]);",
   "  return words.length === 1 && /^[0-9a-fA-F]{3,40}$/.test(words[0]);"],

  ['several words can be a hash',
   "  return words.length === 1 && /^[0-9a-fA-F]{4,40}$/.test(words[0]);",
   "  return /^[0-9a-fA-F]{4,40}$/.test(words[0]);"],

  ['Tack quotes its own trailer back at you',
   "  var body = (c.body || '').split('\\n').filter(function (line) {\n    return line.trim() !== TACK_TRAILER; });",
   "  var body = (c.body || '').split('\\n');"],

  ['the commit body is clipped, losing the thing worth reading',
   "    body.forEach(function (line) { L.push('  ' + C.dim(line)); });",
   "    body.forEach(function (line) { L.push('  ' + C.dim(clip(line, 40))); });"],

  ['a long diff is truncated silently',
   "    if (lines.length > cap) {",
   "    if (false) {"],

  ['the header repeats what was typed instead of what git answered for',
   "  if (labels.length === 1) return labels[0];",
   "  if (labels.length === 1) return s.only;"],

  ['a name matching two repos claims to have matched one',
   "  return labels.length + ' repos matching \"' + s.only + '\"';",
   "  return labels[0];"]
].map(function (m) { return { file: 'tack.js', name: m[0], from: m[1], to: m[2] }; });


/* The pane's two reading views. Both are one `return true` away from letting
 * a key that stages or discards through, which is the thing to keep proving. */
var MUTANTS_AGO = [
  ['"now ago" comes back',
   "  return a === 'now' ? 'just now' : a + ' ago';",
   "  return a + ' ago';"]
].map(function (m) { return { file: 'tack.js', name: m[0], from: m[1], to: m[2] }; });

var MUTANTS_SITLOG = [
  ['the history view falls through to the keys that pick and commit',
   "  if (v === 'history') {",
   "  if (false) {"],

  ['the commit view falls through to the keys that pick and commit',
   "  if (v === 'commit') {",
   "  if (false) {"],

  ['l opens the history of whatever the other list was pointing at',
   "    this.openLog(v === 'repos' ? this.repos[this.cursor] : this.repo);",
   "    this.openLog(this.repos[this.cursor]);"],

  ['a repo with no commits opens a blank history',
   "  if (got.empty)  { this.notice = 'no commits yet in ' + repo.label; return; }",
   "  if (false)  { this.notice = 'no commits yet in ' + repo.label; return; }"],

  ['the pane fetches a diff it has nowhere to draw',
   "  try { det = TK.readCommit(this.log.dir, c.hash, { patch: false }); }",
   "  try { det = TK.readCommit(this.log.dir, c.hash, { patch: true }); }"],

  ['q out of a commit quits the pane instead of going back',
   "    if (k === 'q' || k === '\\x1b') { this.view = 'history'; this.commit = null; return true; }",
   "    if (k === 'q' || k === '\\x1b') { return false; }"],

  ['the pane quotes Tack’s own trailer back at you',
   "    var cbody = (cm.body || '').split('\\n').filter(function (line) {\n      return line.trim() !== TK.TACK_TRAILER; });",
   "    var cbody = (cm.body || '').split('\\n');"]
].map(function (m) { return { file: 'sit.js', name: m[0], from: m[1], to: m[2] }; });
MUTANTS = MUTANTS.concat(MUTANTS_WRITE, MUTANTS_SIT, MUTANTS_UNDO, MUTANTS_SIT2,
                         MUTANTS_OPEN, MUTANTS_TACK2, MUTANTS_LOG, MUTANTS_SITLOG,
                         MUTANTS_AGO);

var SOURCES = {
  'tack.js':  fs.readFileSync(path.join(ROOT, 'tack.js'),  'utf8'),
  'write.js': fs.readFileSync(path.join(ROOT, 'write.js'), 'utf8'),
  'sit.js':   fs.readFileSync(path.join(ROOT, 'sit.js'),   'utf8'),
  'undo.js':  fs.readFileSync(path.join(ROOT, 'undo.js'),  'utf8'),
  'open.js':  fs.readFileSync(path.join(ROOT, 'open.js'),  'utf8')
};

function runMutants() {
  console.log('\n=== mutation suite: ' + MUTANTS.length + ' mutants ===');
  var caught = 0, escaped = [], skipped = [];

  for (var i = 0; i < MUTANTS.length; i++) {
    var m = MUTANTS[i];
    var src = SOURCES[m.file];

    if (src.indexOf(m.from) === -1) {
      /* A mutant that cannot be applied has not been caught. Say SKIP, never
       * pass -- the source moved and this mutant is now testing nothing. */
      skipped.push(m.name);
      console.log('  SKIP ' + m.name + '  (anchor no longer in ' + m.file + ')');
      continue;
    }

    /* The copy sits beside the originals, so its own require('./tack.js') and
     * require('./write.js') still resolve -- one file is mutated at a time and
     * everything it leans on stays honest. */
    var file = path.join(ROOT, '.mutant-' + i + '.tmp.js');
    fs.writeFileSync(file, src.replace(m.from, m.to));

    var before = { pass: pass, fail: fail, msgs: failures.length };
    var died = false;
    try {
      delete require.cache[require.resolve(file)];
      var mutated = require(file);
      var mods = { TK: TK, W: W, SIT: SIT, U: U, O: O };
      if (m.file === 'tack.js')  mods.TK  = mutated;
      if (m.file === 'write.js') mods.W   = mutated;
      if (m.file === 'sit.js')   mods.SIT = mutated;
      if (m.file === 'undo.js')  mods.U   = mutated;
      if (m.file === 'open.js')  mods.O   = mutated;
      var hush = console.log; console.log = function () {};
      try { suite(mods.TK, mods.W, mods.SIT, mods.U, mods.O); } finally { console.log = hush; }
      died = fail > before.fail;
    } catch (e) {
      died = true; /* a mutant that crashes the suite is caught, loudly */
    }
    pass = before.pass; fail = before.fail; failures.length = before.msgs;

    try { fs.unlinkSync(file); } catch (e) {}

    if (died) { caught++; console.log('  caught  ' + m.name + C_DIM(' (' + m.file + ')')); }
    else      { escaped.push(m.name + ' (' + m.file + ')');
                console.log('  ESCAPED ' + m.name + '  (' + m.file + ')'); }
  }

  console.log('\n  ' + caught + '/' + (MUTANTS.length - skipped.length) +
              ' applicable mutants caught' +
              (skipped.length ? ', ' + skipped.length + ' skipped' : ''));
  return { escaped: escaped, skipped: skipped };
}

function C_DIM(s) { return s; }

/* -------------------------------------------------------------------- main */

/* A crashed run leaves a .mutant-N.tmp.js behind. Clean up before starting so
 * a crash can never put one in a commit. */
fs.readdirSync(ROOT).forEach(function (f) {
  if (/^\.mutant-\d+\.tmp\.js$/.test(f)) { try { fs.unlinkSync(path.join(ROOT, f)); } catch (e) {} }
});

console.log('=== tack selftest ===');
var TK  = require(SOURCE);
var W   = require(path.join(ROOT, 'write.js'));
var SIT = require(path.join(ROOT, 'sit.js'));
var U   = require(path.join(ROOT, 'undo.js'));
var O   = require(path.join(ROOT, 'open.js'));
TK.C.on = false;
suite(TK, W, SIT, U, O);

var mut = { escaped: [], skipped: [] };
if (!NO_MUT) mut = runMutants();

cleanup();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\nfailures:'); failures.forEach(function (f) { console.log('  - ' + f); }); }
if (mut.escaped.length) {
  console.log('\nescaped mutants (a guarantee with no assertion behind it):');
  mut.escaped.forEach(function (m) { console.log('  - ' + m); });
}
process.exit(fail || mut.escaped.length ? 1 : 0);
