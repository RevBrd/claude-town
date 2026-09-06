#!/usr/bin/env node
/* The only file in Tack that can reach the network.
 *
 * Every other verb in this tool acts on this machine. This one sends bytes
 * somewhere else, which is a different capability class, so it gets its own
 * file with its own allowlist -- the same reasoning that put `add`/`commit` in
 * write.js and `restore` in undo.js rather than growing tack.js.
 *
 * WHY THIS IS ALLOWED AT ALL, given that Tack's own doc said pushing "is the
 * one action here that leaves the machine" and should not become a verb
 * without a conversation. The conversation happened, and the objection turned
 * out to rest on a conflation that Codeville 5 took apart on 5 Sep 2026:
 *
 *   Pushing is not publishing. Every repo in this tree is private. The event
 *   that publishes is flipping a repo's visibility, which no push performs and
 *   no hook can guard. A push to a private mirror REPLICATES; it does not
 *   disclose.
 *
 * That moves push out of the disclosure class and into the replication class --
 * the same class as the attic. What is left is the risk of a push that rewrites
 * what is already there, or that goes somewhere it was not meant to. Both are
 * answered below by being made inexpressible rather than by being asked about.
 */
'use strict';

var cp = require('child_process');
var TK = require('./tack.js');

/* This file's whole authority over the network. One verb. */
var PUSH_VERBS = ['push'];

/* And one reading verb, which exists only to answer "where would this go?".
 * `remote` can also add, rename and delete remotes, so it is guarded on the
 * SUBCOMMAND as well as on the verb -- the lesson `tack log <ref>` taught about
 * arguments, arriving before the bug this time rather than after it. */
var LOOKUP_VERBS = ['remote'];
var LOOKUP_SUB   = 'get-url';

/* Everything that would make a push something other than "add my commits to
 * the end of what is already there".
 *
 *   --force, -f, --force-with-lease, --force-if-includes
 *       A fast-forward push cannot destroy anything at the destination. These
 *       can, and the destination is the backup -- the copy that exists because
 *       the local one might not be there. Discarding a change in the working
 *       tree at least leaves a copy in the attic. There is no attic on the far
 *       end of a network connection.
 *
 *   --mirror, --prune, --delete, -d
 *       These remove refs at the destination. Same reason, more directly.
 *
 *   --no-verify
 *       THE IMPORTANT ONE. Projects/Games carries a pre-push hook that is
 *       Trevor's release lock, written in his own voice, saying "Ask Trevor
 *       first". Codeville 5 hit that hook, stopped, and asked rather than
 *       routing around it -- the right call, and exactly the call a tool must
 *       not be able to get wrong. Tack is structurally incapable of doing what
 *       a careful session chose not to do.
 *
 *   --repo, --exec, --receive-pack
 *       --repo overrides the destination. --exec and --receive-pack name a
 *       program to run on the far end. Neither has any business here.
 *
 *   --set-upstream, -u
 *       Changes where this branch points in future. Choosing a destination is
 *       a decision; see destination() below for why Tack never makes one.
 */
var FORBIDDEN = ['--force', '-f', '--force-with-lease', '--force-if-includes',
                 '--mirror', '--prune', '--delete', '-d',
                 '--no-verify', '--repo', '--exec', '--receive-pack',
                 '--set-upstream', '-u', '--all', '--tags', '--follow-tags'];

/* A refspec beginning with + is a forced update spelled a second way, and it
 * would sail straight past a list of option names. Tack passes no refspec at
 * all, so this guards a door that is currently walled up -- which is the point.
 * The wall is a decision this pass made; the guard is what notices if a later
 * pass takes it down without meaning to. */
function isForcedRefspec(a) { return String(a).charAt(0) === '+'; }

/* A push is a network round trip and may sit behind a credential prompt, so
 * the eight seconds a `git status` gets is far too short. */
var PUSH_TIMEOUT = 120000;

/* ------------------------------------------------------------------ guards */

function assertVerb(verb) {
  if (PUSH_VERBS.indexOf(verb) === -1) {
    throw new Error('push.js runs `git push` and nothing else. Asked for `git ' +
      verb + '`. The allowlist is PUSH_VERBS in push.js.');
  }
}

function assertNoReach(args) {
  for (var i = 0; i < args.length; i++) {
    if (FORBIDDEN.indexOf(args[i]) !== -1) {
      throw new Error('Tack refused `' + args[i] + '`. It adds commits to the end ' +
        'of what is already there, and does nothing else. See FORBIDDEN in push.js.');
    }
    if (isForcedRefspec(args[i])) {
      throw new Error('Tack refused the refspec `' + args[i] + '`. A leading + is ' +
        'a forced update. See isForcedRefspec in push.js.');
    }
  }
}

function assertLookup(args) {
  if (LOOKUP_VERBS.indexOf(args[0]) === -1) {
    throw new Error('push.js may only ask `git remote`. Asked for `git ' + args[0] + '`.');
  }
  if (args[1] !== LOOKUP_SUB) {
    throw new Error('Tack refused `git remote ' + args[1] + '`. The only thing it may ' +
      'ask a remote is its URL. See LOOKUP_SUB in push.js.');
  }
}

/* --------------------------------------------------------------------- git */

/* Reading only: where would this go? */
function gitAsk(repo, args) {
  assertLookup(args);
  var r = cp.spawnSync('git', ['-C', repo].concat(args), {
    encoding: 'buffer', timeout: TK.T.SCAN_TIMEOUT, windowsHide: true });
  if (r.error && r.error.code === 'ENOENT') throw new Error('git is not on PATH.');
  return { ok: r.status === 0,
           out: r.stdout ? r.stdout.toString('utf8') : '',
           err: r.stderr ? r.stderr.toString('utf8') : '' };
}

/* The one call in this tool that leaves the machine.
 *
 * GIT_TERMINAL_PROMPT=0 so git can never block on a prompt nobody can see. The
 * credential helper on this machine is `manager`, which raises its own window,
 * and that is left able to work -- windowsHide is off here, unlike everywhere
 * else in Tack, because hiding a sign-in window is how you get a tool that
 * appears to hang for two minutes and then fails without saying why. An expired
 * token should ask, or fail fast. It must not sit there silently. */
function gitPush(repo, args) {
  assertVerb(args[0]);
  assertNoReach(args);
  var env = {};
  Object.keys(process.env).forEach(function (k) { env[k] = process.env[k]; });
  env.GIT_TERMINAL_PROMPT = '0';
  var r = cp.spawnSync('git', ['-C', repo].concat(args), {
    encoding: 'buffer', timeout: PUSH_TIMEOUT, windowsHide: false, env: env });
  if (r.error && r.error.code === 'ENOENT') throw new Error('git is not on PATH.');
  return { ok: r.status === 0,
           timedOut: !!(r.error && r.error.code === 'ETIMEDOUT'),
           out: r.stdout ? r.stdout.toString('utf8') : '',
           err: r.stderr ? r.stderr.toString('utf8') : '' };
}

/* --------------------------------------------------------- the destination */

/* A dead push URL is how a remote is disarmed without being deleted, and this
 * tree uses one: Games has remote.origin.pushurl = no_push, set 15 Aug 2026 as
 * the first layer of a deliberate publication lock.
 *
 * So a destination that is not a URL is not an error. It is somebody's
 * decision, and Tack's job is to report it in those terms rather than to walk
 * into it and print whatever git says about a repository it cannot find. */
function looksLikeUrl(s) {
  var u = String(s || '').trim();
  if (!u) return false;
  return /^(https?|ssh|git|ftps?):\/\//i.test(u) ||
         /^[^\s@\/]+@[^\s:]+:/.test(u) ||          /* git@host:path */
         /^[A-Za-z]:[\\\/]/.test(u) ||             /* a local drive path */
         u.charAt(0) === '/' || u.charAt(0) === '.';
}

/* WHERE A PUSH GOES IS NEVER TYPED, AND THIS IS THE HEART OF THE DESIGN.
 *
 * Tack takes the destination from the branch's own upstream and offers no way
 * to name a remote or a URL. Choosing where work goes is a decision, and it is
 * one somebody has already made, in git's own configuration, on purpose.
 *
 * What that buys is clearest in the one repo where it matters. Games has two
 * remotes: origin, the release repo, locked; and backup, a private mirror.
 * Codeville 5 pointed master at backup so the safe action is the default.
 * Because Tack pushes only to upstream, Tack cannot reach the release repo AT
 * ALL -- while knowing nothing whatsoever about Games. It inherits the routing
 * decision rather than re-making it, which is the same reason roots.json lists
 * roots and lets the filesystem answer what is inside them.
 *
 * A tool that accepted `tack push games origin` would have to know which
 * remotes are dangerous. This one does not need to know, and cannot be wrong. */
function destination(repoDir, rec) {
  if (!rec.upstream) {
    return { ok: false, why: 'no upstream',
             reason: 'this branch does not track anything, so there is nowhere for ' +
                     'Tack to send it. Setting that up is a decision, and a decision ' +
                     'is not something Tack makes.' };
  }
  /* `# branch.upstream` is <remote>/<branch>. Split at the first slash and then
   * CHECK, rather than trusting the split: a branch name may contain a slash
   * and, rarely, so may a remote. If git does not recognise the name that came
   * out, that is reported rather than guessed at. */
  var slash = rec.upstream.indexOf('/');
  if (slash < 1) {
    return { ok: false, why: 'unreadable upstream',
             reason: 'could not tell which remote "' + rec.upstream + '" means.' };
  }
  var remote = rec.upstream.slice(0, slash);
  var branch = rec.upstream.slice(slash + 1);

  var got = gitAsk(repoDir, ['remote', 'get-url', '--push', remote]);
  if (!got.ok) {
    return { ok: false, why: 'unknown remote', remote: remote,
             reason: 'git does not know a remote called "' + remote + '".' };
  }
  var url = got.out.trim().split('\n')[0];

  if (!looksLikeUrl(url)) {
    return { ok: false, why: 'locked', remote: remote, url: url,
             reason: 'the push address for "' + remote + '" is "' + url + '", which ' +
                     'is not a URL. That is how a remote is deliberately disarmed, so ' +
                     'this is a decision rather than a fault. Tack does not undo it.' };
  }
  return { ok: true, remote: remote, branch: branch, url: url };
}

/* --------------------------------------------------------------- the check */

/* Everything that has to be true before anything leaves the machine, in one
 * place, with a word for each state rather than a boolean -- so the pane can
 * draw the answer, and say which kind of no it is. */
function pushable(repoDir, rec) {
  if (rec.error)  return { ok: false, why: 'unreadable', reason: rec.error };
  if (rec.empty)  return { ok: false, why: 'no commits',
                           reason: 'nothing has ever been committed here.' };

  var dest = destination(repoDir, rec);
  if (!dest.ok) return { ok: false, why: dest.why, reason: dest.reason,
                         remote: dest.remote, url: dest.url };

  /* Behind means the far end holds commits this machine has not seen, and a
   * push would be refused. Saying so is more use than letting git say it in its
   * own words, which run to nine lines and end by suggesting --force. */
  if (rec.behind) {
    return { ok: false, why: 'behind', dest: dest,
             reason: dest.remote + ' has ' + rec.behind + ' commit' +
                     (rec.behind === 1 ? '' : 's') + ' this machine does not. Pull ' +
                     'them first -- Tack has no verb for that.' };
  }
  if (!rec.ahead) {
    return { ok: false, why: 'nothing to push', dest: dest,
             reason: 'everything here is already on ' + dest.remote + '.' };
  }
  return { ok: true, dest: dest, ahead: rec.ahead };
}

/* ------------------------------------------------------------------- doing */

/* opts.confirmed must be true before anything is sent. Unlike a discard there
 * is nothing to snapshot -- a push does not touch the local copy, which is
 * still there afterwards -- so the confirmation is a keypress rather than a
 * typed word. The typed word belongs to the one operation that destroys work,
 * and spending it here would be the confirmation-you-click-through failure
 * that undo.js already names. */
function pushUpstream(repoDir, rec, opts) {
  opts = opts || {};
  var check = pushable(repoDir, rec);
  if (!check.ok) return { ok: false, reason: check.reason, why: check.why,
                          dest: check.dest };

  if (!opts.confirmed) {
    return { ok: false, needsConfirm: true, dest: check.dest, ahead: check.ahead };
  }

  /* No refspec, no remote, no flags. There is nothing here for a caller to
   * influence, which is why FORBIDDEN currently guards a walled-up door: it is
   * there to notice if a later pass opens one. */
  var r = gitPush(repoDir, ['push']);

  if (r.timedOut) {
    return { ok: false, why: 'timed out', dest: check.dest,
             reason: 'git did not finish in ' + Math.round(PUSH_TIMEOUT / 1000) +
                     ' seconds. If it is asking you to sign in, a window may be ' +
                     'waiting behind this one.' };
  }
  if (!r.ok) {
    /* A pre-push hook that refuses says WHY, in the words of whoever wrote it,
     * and those words are the entire point of the hook. They are handed back
     * whole rather than summarised into "push failed". */
    return { ok: false, why: 'refused', dest: check.dest,
             reason: firstUseful(r.err) || firstUseful(r.out) || 'git push failed',
             said: trimBlank((r.err + '\n' + r.out).split('\n')) };
  }
  return { ok: true, dest: check.dest, sent: check.ahead,
           said: trimBlank((r.err + '\n' + r.out).split('\n')) };
}

/* git narrates a push on stderr, so the first line is usually "To <url>" and
 * the one worth reading is further down. */
function firstUseful(s) {
  var lines = String(s || '').split('\n');
  for (var i = 0; i < lines.length; i++) {
    var t = lines[i].trim();
    if (!t) continue;
    if (/^To\s/.test(t)) continue;
    return t;
  }
  return '';
}

function trimBlank(lines) {
  var out = lines.map(function (l) { return String(l).replace(/\s+$/, ''); });
  while (out.length && !out[0].trim()) out.shift();
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out;
}

module.exports = {
  PUSH_VERBS: PUSH_VERBS, LOOKUP_VERBS: LOOKUP_VERBS, LOOKUP_SUB: LOOKUP_SUB,
  FORBIDDEN: FORBIDDEN, PUSH_TIMEOUT: PUSH_TIMEOUT,
  assertVerb: assertVerb, assertNoReach: assertNoReach, assertLookup: assertLookup,
  isForcedRefspec: isForcedRefspec, looksLikeUrl: looksLikeUrl,
  gitAsk: gitAsk, gitPush: gitPush,
  destination: destination, pushable: pushable, pushUpstream: pushUpstream,
  firstUseful: firstUseful, trimBlank: trimBlank
};
