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

/* ------------------------------------------------------------------ tmp fs */

var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tack-test-'));
function tmp(p) { var full = path.join(TMP, p); fs.mkdirSync(full, { recursive: true }); return full; }
function cleanup() { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {} }

/* The harness may run git itself -- it is building fixtures, not being the
 * tool. Only tack.js is bound by READ_ONLY_VERBS. */
function rawGit(dir, args) {
  return cp.spawnSync('git', ['-C', dir].concat(args),
    { encoding: 'utf8', windowsHide: true });
}

/* ------------------------------------------------------------------- suite */

function suite(TK, W, SIT) {

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

  var head = TK.creature('awake');
  eq(head.length, 3, 'the creature is three lines');
  eq([head[0].length, head[1].length, head[2].length],
     [head[1].length, head[1].length, head[1].length],
     'and all three are the same width, or the text beside it shears');
  ok(TK.creature('pleased')[1] !== TK.creature('alert')[1],
     'the eyes change with the mood');

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
  /* The glance has to state its own limits, because a tool that can commit
   * and a tool that can also revert look identical from the outside. */
  ok(/cannot restore, reset or undo|restore, reset or undo/.test(lines.join('\n')),
     'the readout says out loud that it cannot undo your work');

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

  ['the creature shears',
   "  return [' ╭─────╮', ' │ ' + eyes + ' │', ' ╰──┬──╯'];",
   "  return [' ╭─────╮', ' │' + eyes + '│', ' ╰──┬──╯'];"],

  ['the ascii fallback shears instead',
   "  if (ascii || T.ASCII) return [' ,---. ', '( ' + eyes + ' )', \" `-|-' \"];",
   "  if (ascii || T.ASCII) return [' ,---.', '( ' + eyes + ' )', \" `-|-' \"];"],

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

MUTANTS = MUTANTS.concat(MUTANTS_WRITE, MUTANTS_SIT);

var SOURCES = {
  'tack.js':  fs.readFileSync(path.join(ROOT, 'tack.js'),  'utf8'),
  'write.js': fs.readFileSync(path.join(ROOT, 'write.js'), 'utf8'),
  'sit.js':   fs.readFileSync(path.join(ROOT, 'sit.js'),   'utf8')
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
      var mods = { TK: TK, W: W, SIT: SIT };
      if (m.file === 'tack.js')  mods.TK  = mutated;
      if (m.file === 'write.js') mods.W   = mutated;
      if (m.file === 'sit.js')   mods.SIT = mutated;
      var hush = console.log; console.log = function () {};
      try { suite(mods.TK, mods.W, mods.SIT); } finally { console.log = hush; }
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
TK.C.on = false;
suite(TK, W, SIT);

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
