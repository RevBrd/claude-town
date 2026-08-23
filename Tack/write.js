#!/usr/bin/env node
/* The only file in Tack that can write.
 *
 * tack.js stays read-only forever -- its READ_ONLY_VERBS list and its choke
 * point are unchanged by pass 2, and the selftest still asserts them by value.
 * Everything that can touch history is here instead, in one file short enough
 * to read in a sitting, with its own allowlist and its own guards.
 *
 * Pass 2a is add and commit. Both are additive: a commit records, it does not
 * destroy. restore/checkout/reset are pass 2b and are the genuinely dangerous
 * ones, so they get their own pass -- the guard that will hold them back is
 * already written down and tested below, before the verb it guards exists.
 */
'use strict';

var path = require('path');
var os   = require('os');
var cp   = require('child_process');
var TK   = require('./tack.js');

/* Pass 2a's whole authority. Asserted by value in tools/selftest.js, so
 * widening it means updating that assertion in the same commit. */
var WRITE_VERBS = ['add', 'commit'];

/* Pathspecs that mean "everything in this repo". `git add -A` is not a thing
 * Tack declines to do -- it is a thing Tack has no way to express. Both
 * catalog-loss incidents in this tree came from acting on a whole-file picture
 * somebody had stopped looking at, and the fix is a tool that cannot form the
 * thought. */
var WHOLESALE = ['-A', '--all', '-a', '--update', '-u', '.', '*', ':/', ':(top)'];

/* Append-only files: restoring one permanently deletes somebody's mark, and
 * the Pet's own doc forbids it -- "nothing anyone leaves is ever discarded".
 * Trevor's call, 20 Aug 2026, was to block the whole folder rather than the
 * one file, which is the better rule because it has no judgement call in it.
 *
 * Committing inside this folder stays ALLOWED and that is deliberate: log.js
 * sits uncommitted after every visit, and committing it is exactly what
 * preserves the visit. Refusing would leave it permanently at risk. Only
 * restore is blocked here. */
var NEVER_RESTORE = [path.join(os.homedir(), '.claude', 'Pet')];

/* ------------------------------------------------------------------ guards */

function assertVerb(verb) {
  if (WRITE_VERBS.indexOf(verb) === -1) {
    throw new Error('Tack cannot run `git ' + verb + '`. Pass 2a is add and ' +
      'commit only; the allowlist is WRITE_VERBS in write.js.');
  }
}

function assertNoWholesale(args) {
  for (var i = 0; i < args.length; i++) {
    if (WHOLESALE.indexOf(args[i]) !== -1) {
      throw new Error('Tack refused `' + args[i] + '`. It stages only paths it ' +
        'has shown you, one at a time. See WHOLESALE in write.js.');
    }
  }
}

/* A path must be relative, inside the repo, and not a flag in disguise. */
function assertSafePath(p) {
  if (typeof p !== 'string' || !p.length) throw new Error('empty path');
  if (p.charAt(0) === '-')  throw new Error('path looks like a flag: ' + p);
  if (path.isAbsolute(p))   throw new Error('path must be relative: ' + p);
  var norm = path.normalize(p).replace(/\\/g, '/');
  if (norm === '..' || norm.indexOf('../') === 0) {
    throw new Error('path escapes the repo: ' + p);
  }
  return p;
}

function isBlockedForRestore(repoDir) {
  var real = path.resolve(repoDir).toLowerCase();
  return NEVER_RESTORE.some(function (b) {
    var lb = path.resolve(b).toLowerCase();
    return real === lb || real.indexOf(lb + path.sep) === 0;
  });
}

/* --------------------------------------------------------------------- git */

function gitWrite(repo, args) {
  assertVerb(args[0]);
  assertNoWholesale(args);
  var r = cp.spawnSync('git', ['-C', repo].concat(args), {
    encoding: 'buffer', timeout: TK.T.SCAN_TIMEOUT, windowsHide: true });
  if (r.error && r.error.code === 'ENOENT') throw new Error('git is not on PATH.');
  return {
    ok:  r.status === 0,
    out: r.stdout ? r.stdout.toString('utf8') : '',
    err: r.stderr ? r.stderr.toString('utf8') : ''
  };
}

/* ------------------------------------------------------------------ message */

/* A commit message is the one durable explanation of why a change happened,
 * and "committed by Tack" explains nothing to the person reading it in a year.
 * So the default is derived from what actually changed -- true, useful, and no
 * typing -- and the fact that Tack did it goes in a trailer, where metadata
 * belongs. Typing your own always beats the default. */
function defaultMessage(files) {
  if (!files.length) return '';
  var words = {}, names = [];
  files.forEach(function (f) {
    var w = TK.describe(f);
    words[w === 'untracked' || w === 'added' ? 'add'
        : w === 'deleted' ? 'remove'
        : w === 'renamed' ? 'rename' : 'update'] = 1;
    names.push(path.basename(f.path.replace(/\/+$/, '')) + (/\/$/.test(f.path) ? '/' : ''));
  });
  var verbs = Object.keys(words);
  var verb = verbs.length === 1 ? verbs[0] : 'update';

  var shown = [], i;
  for (i = 0; i < names.length; i++) {
    var tail = names.length - (i + 1);
    var candidate = shown.concat([names[i]]).join(', ') +
                    (tail > 0 ? ' and ' + tail + ' more' : '');
    if (shown.length && (verb.length + 1 + candidate.length) > 68) break;
    shown.push(names[i]);
  }
  var rest = names.length - shown.length;
  return verb + ' ' + shown.join(', ') + (rest > 0 ? ' and ' + rest + ' more' : '');
}

var TRAILER = 'Committed with Tack.';

function withTrailer(message) {
  if (message.indexOf(TRAILER) !== -1) return message;
  return message.replace(/\s+$/, '') + '\n\n' + TRAILER + '\n';
}

/* ------------------------------------------------------------------ commit */

/* `expect` is what the caller was looking at when it decided: a map of
 * path -> xy. Every path is re-read at this instant and compared against it.
 * A list drawn thirty seconds ago is a stale picture, and acting on a stale
 * picture is the exact failure this tree has already had twice. If anything
 * moved underneath, this refuses and says what moved -- it never proceeds on
 * the assumption that the difference was probably fine. */
function commitPaths(repoDir, paths, message, expect, now) {
  if (!paths || !paths.length) return { ok: false, reason: 'nothing selected' };
  paths.forEach(assertSafePath);

  var fresh = TK.readRepo(repoDir, now || Date.now(), { untracked: 'all' });
  if (fresh.error) return { ok: false, reason: 'could not read the repo: ' + fresh.error };

  var current = {};
  fresh.files.forEach(function (f) { current[f.path] = f.xy; });

  var moved = [];
  paths.forEach(function (p) {
    if (!(p in current)) { moved.push(p + ' is no longer changed'); return; }
    if (expect && (p in expect) && expect[p] !== current[p]) {
      moved.push(p + ' changed again (' + expect[p] + ' → ' + current[p] + ')');
    }
  });
  if (moved.length) {
    return { ok: false, reason: 'the working tree moved while you were deciding',
             moved: moved };
  }

  var add = gitWrite(repoDir, ['add', '--'].concat(paths));
  if (!add.ok) return { ok: false, reason: (add.err || 'git add failed').split('\n')[0] };

  var msg = withTrailer(message && message.trim() ? message.trim()
                        : defaultMessage(fresh.files.filter(function (f) {
                            return paths.indexOf(f.path) !== -1; })));

  /* `commit -- <paths>` limits the commit to exactly these paths even if
   * something else was already sitting in the index -- another session's
   * staged work does not get swept in behind your message. */
  var out = gitWrite(repoDir, ['commit', '-m', msg, '--'].concat(paths));
  if (!out.ok) return { ok: false, reason: (out.err || out.out || 'git commit failed').split('\n')[0] };

  var sha = '';
  var head = TK.git(repoDir, ['rev-parse', '--short', 'HEAD']);
  if (head.ok) sha = head.out.trim();

  return { ok: true, sha: sha, count: paths.length, message: msg };
}

module.exports = {
  WRITE_VERBS: WRITE_VERBS, WHOLESALE: WHOLESALE, NEVER_RESTORE: NEVER_RESTORE,
  TRAILER: TRAILER,
  assertVerb: assertVerb, assertNoWholesale: assertNoWholesale,
  assertSafePath: assertSafePath, isBlockedForRestore: isBlockedForRestore,
  gitWrite: gitWrite, defaultMessage: defaultMessage, withTrailer: withTrailer,
  commitPaths: commitPaths
};
