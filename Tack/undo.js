#!/usr/bin/env node
/* Putting a file back. The only genuinely dangerous thing Tack can do.
 *
 * Everything before this pass was additive. A commit records; it cannot lose
 * work. Discarding a modification is different in kind: the bytes you are
 * throwing away exist in exactly one place -- the working tree -- and git has
 * never seen them. Once they are gone, git cannot help you, because there is
 * nothing in git to help with.
 *
 * So the shape of this file is: separate the safe half from the dangerous half
 * and never let the dangerous half run without a copy of what it is about to
 * destroy.
 *
 *   UNDELETE  a tracked file was deleted -- bring it back.  Purely additive.
 *             Nothing can be lost. No confirmation, no snapshot needed.
 *
 *   DISCARD   a tracked file was modified -- throw the changes away.
 *             Snapshot to the attic first, always, no exceptions.
 *
 * An untracked file is never touched by anything here. "Restoring" one would
 * mean deleting it, which is `git clean`, which is not a verb Tack has and
 * should not become one -- it is the one operation whose result is not
 * recoverable from anywhere at all.
 */
'use strict';

var fs   = require('fs');
var path = require('path');
var os   = require('os');
var cp   = require('child_process');
var TK   = require('./tack.js');
var W    = require('./write.js');

/* This file's whole authority. One verb. */
var RESTORE_VERBS = ['restore'];

/* `git restore` has flags that would reach past the working tree. `--staged`
 * would blow away an index another session is holding, and `--source` would
 * restore from an arbitrary commit rather than from what is already recorded.
 * Neither is needed and both are worse than what they replace. */
var FORBIDDEN_FLAGS = ['--staged', '-S', '--source', '-s', '--overlay'];

/* --------------------------------------------------------------- the attic */

/* Outside every repo on purpose, so a snapshot never shows up in a sweep as
 * loose work, and never lands in a commit.
 *
 * Plain file copies in dated folders, NOT a git stash or a dangling object.
 * The person most likely to need this is the person who does not know git --
 * the recovery path must not require the skill whose absence caused the
 * mistake. This one is: open the folder, drag the file back. */
function atticRoot() {
  var base = process.env.LOCALAPPDATA ||
             path.join(os.homedir(), 'AppData', 'Local');
  return path.join(base, 'Tack', 'attic');
}

function stampNow(now) {
  return new Date(now || Date.now()).toISOString()
    .replace(/\.\d+Z$/, '').replace(/[:]/g, '-');
}

/* Copies the CURRENT bytes of each path -- the ones about to be destroyed --
 * into a dated folder, keeping the repo's own folder structure so what came
 * from where stays obvious a month later. */
function snapshot(repoDir, label, paths, now) {
  var dir = path.join(atticRoot(), stampNow(now), label.replace(/[\\/:]/g, '-'));
  var saved = [], missed = [];

  paths.forEach(function (p) {
    var from = path.join(repoDir, p);
    var to   = path.join(dir, p);
    try {
      if (!fs.existsSync(from)) { missed.push(p); return; }  /* a deletion has nothing to save */
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      saved.push(p);
    } catch (e) {
      missed.push(p + ' (' + e.code + ')');
    }
  });

  if (saved.length) {
    fs.writeFileSync(path.join(dir, '_where-this-came-from.txt'),
      ['These files were about to be thrown away by `tack`, so it kept a copy.',
       '',
       'repo:  ' + repoDir,
       'when:  ' + new Date(now || Date.now()).toString(),
       '',
       'To put one back, copy it from here into the repo, over the top of the',
       'file with the same name. Nothing here is ever deleted automatically.',
       '', 'files:'].concat(saved.map(function (s) { return '  ' + s; })).join('\n') + '\n');
  }
  return { dir: dir, saved: saved, missed: missed };
}

/* Every snapshot ever taken, newest first. Nothing is ever pruned -- the whole
 * point is that it is there when somebody finally goes looking. */
function listAttic() {
  var root = atticRoot(), out = [];
  var stamps;
  try { stamps = fs.readdirSync(root, { withFileTypes: true }); }
  catch (e) { return out; }

  stamps.forEach(function (s) {
    if (!s.isDirectory()) return;
    var repos;
    try { repos = fs.readdirSync(path.join(root, s.name), { withFileTypes: true }); }
    catch (e) { return; }
    repos.forEach(function (r) {
      if (!r.isDirectory()) return;
      var dir = path.join(root, s.name, r.name);
      out.push({ stamp: s.name, label: r.name, dir: dir, files: countFiles(dir) });
    });
  });
  return out.sort(function (a, b) { return a.stamp < b.stamp ? 1 : -1; });
}

function countFiles(dir) {
  var n = 0;
  (function walk(d) {
    var e;
    try { e = fs.readdirSync(d, { withFileTypes: true }); } catch (x) { return; }
    e.forEach(function (x) {
      if (x.isDirectory()) walk(path.join(d, x.name));
      else if (x.name !== '_where-this-came-from.txt') n++;
    });
  })(dir);
  return n;
}

/* ------------------------------------------------------------------ guards */

function assertVerb(verb) {
  if (RESTORE_VERBS.indexOf(verb) === -1) {
    throw new Error('undo.js runs `git restore` and nothing else. Asked for `git ' +
                    verb + '`.');
  }
}

function assertNoReach(args) {
  for (var i = 0; i < args.length; i++) {
    if (FORBIDDEN_FLAGS.indexOf(args[i]) !== -1) {
      throw new Error('Tack refused `' + args[i] + '`. It restores the working tree ' +
        'only -- never the index, never from another commit. See FORBIDDEN_FLAGS ' +
        'in undo.js.');
    }
  }
}

function gitRestore(repo, args) {
  assertVerb(args[0]);
  assertNoReach(args);
  W.assertNoWholesale(args);
  var r = cp.spawnSync('git', ['-C', repo].concat(args), {
    encoding: 'buffer', timeout: TK.T.SCAN_TIMEOUT, windowsHide: true });
  if (r.error && r.error.code === 'ENOENT') throw new Error('git is not on PATH.');
  return {
    ok:  r.status === 0,
    out: r.stdout ? r.stdout.toString('utf8') : '',
    err: r.stderr ? r.stderr.toString('utf8') : ''
  };
}

/* ---------------------------------------------------------------- sorting */

/* Which of the two operations each file is, and which are neither. The UI
 * needs this to show them differently, and the engine needs it to know what
 * requires a snapshot. */
function classify(files) {
  var out = { undelete: [], discard: [], refused: [] };
  files.forEach(function (f) {
    var word = TK.describe(f);
    if (word === 'untracked') {
      out.refused.push({ path: f.path, why: 'untracked — putting this back would mean deleting it' });
    } else if (word === 'conflicted') {
      out.refused.push({ path: f.path, why: 'conflicted — resolve it in an editor, not here' });
    } else if (word === 'deleted') {
      out.undelete.push(f.path);
    } else {
      out.discard.push(f.path);
    }
  });
  return out;
}

/* ----------------------------------------------------------------- doing */

/* opts:
 *   expect     path -> xy as drawn, same stale-picture contract as committing
 *   confirmed  must be true before anything in the discard half runs
 *
 * Returns `recent`: files in this repo touched in the last few minutes. It is
 * a warning for the caller to show, never a refusal -- see the long note below
 * for why a block was tried twice and removed twice.
 */
function restorePaths(repoDir, label, paths, opts) {
  opts = opts || {};
  if (!paths || !paths.length) return { ok: false, reason: 'nothing selected' };
  paths.forEach(W.assertSafePath);

  /* Blocked by folder, before anything else looks at anything. The Pet's log
   * is append-only and there is no other copy of a visit. */
  if (W.isBlockedForRestore(repoDir)) {
    return { ok: false, reason: 'this folder is never restored — ' +
      'its files are append-only and a copy of what is in them exists nowhere else' };
  }

  var now = opts.now || Date.now();
  var fresh = TK.readRepo(repoDir, now, { untracked: 'all' });
  if (fresh.error) return { ok: false, reason: 'could not read the repo: ' + fresh.error };

  /* The live flag WARNS here. It does not block, and that is a decision made
   * after building the block twice and getting it wrong both times.
   *
   * Version one refused whenever the repo was live, which blocks the commonest
   * honest use there is: you edit a file, you dislike it, you want it back.
   * Your own edit makes the repo live. A guard that fires on the person it is
   * meant to serve gets switched off, and then it is not a guard.
   *
   * Version two refused when a file you did NOT pick had moved recently. That
   * fires on an untracked file you made a minute ago, which is nobody's live
   * work -- and it still misses the case it exists for, because a file that
   * ANOTHER session is editing right now looks exactly like a file YOU were
   * editing right now. There is no observable difference. The status code does
   * not even change: an edit on top of an edit is `.M` either way, so the
   * stale-picture check cannot see it either.
   *
   * So the signal does not exist, and pretending otherwise buys a refusal that
   * annoys the user in the common case and protects nobody in the rare one.
   * What actually makes this safe is the attic: the bytes are copied out before
   * anything is destroyed, so the worst outcome is a file to drag back rather
   * than work that is gone. Warn loudly, keep the copy, let the person decide. */
  var recent = fresh.files.filter(function (f) {
    return f.mtime && now - f.mtime < TK.T.LIVE_MINUTES * 60000;
  }).map(function (f) { return f.path + ' (' + TK.ago(f.mtime, now) + ')'; });

  var current = {}, byPath = {};
  fresh.files.forEach(function (f) { current[f.path] = f.xy; byPath[f.path] = f; });

  var moved = [];
  paths.forEach(function (p) {
    if (!(p in current)) { moved.push(p + ' is no longer changed'); return; }
    if (opts.expect && (p in opts.expect) && opts.expect[p] !== current[p]) {
      moved.push(p + ' changed again (' + opts.expect[p] + ' → ' + current[p] + ')');
    }
  });
  if (moved.length) {
    return { ok: false, reason: 'the working tree moved while you were deciding',
             moved: moved };
  }

  var sorted = classify(paths.map(function (p) { return byPath[p]; }));

  /* The dangerous half needs saying yes to. The safe half never does, because
   * a confirmation you click through on the harmless case is a confirmation
   * you will click through on the harmful one. */
  if (sorted.discard.length && !opts.confirmed) {
    return { ok: false, reason: 'discarding needs confirming', needsConfirm: true,
             discard: sorted.discard, undelete: sorted.undelete,
             refused: sorted.refused, recent: recent };
  }

  var kept = null;
  if (sorted.discard.length) {
    kept = snapshot(repoDir, label, sorted.discard, now);
    if (!kept.saved.length) {
      return { ok: false, reason: 'could not copy anything to the attic, so ' +
        'nothing was discarded: ' + (kept.missed.join(', ') || 'unknown') };
    }
  }

  /* One path can appear twice in a status: `git rm --cached` leaves a file
   * both staged-deleted and untracked, so it is reported as two entries with
   * the same name. Deduplicate before handing anything to git, or the same
   * path gets acted on twice with two different intentions. */
  var doing = sorted.undelete.concat(sorted.discard).filter(
    function (p, i, all) { return all.indexOf(p) === i; });
  if (!doing.length) {
    return { ok: false, reason: 'nothing here can be put back',
             refused: sorted.refused };
  }

  var r = gitRestore(repoDir, ['restore', '--'].concat(doing));
  if (!r.ok) {
    return { ok: false, reason: (r.err || 'git restore failed').split('\n')[0],
             attic: kept ? kept.dir : null };
  }

  return { ok: true, undeleted: sorted.undelete, discarded: sorted.discard,
           refused: sorted.refused, recent: recent, attic: kept ? kept.dir : null };
}

module.exports = {
  RESTORE_VERBS: RESTORE_VERBS, FORBIDDEN_FLAGS: FORBIDDEN_FLAGS,
  atticRoot: atticRoot, stampNow: stampNow, snapshot: snapshot,
  listAttic: listAttic, countFiles: countFiles,
  assertVerb: assertVerb, assertNoReach: assertNoReach, gitRestore: gitRestore,
  classify: classify, restorePaths: restorePaths
};
