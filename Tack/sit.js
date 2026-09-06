#!/usr/bin/env node
/* The sitting -- the live pane, where the verbs are to hand.
 *
 * The glance prints under your prompt and gets out of the way. This is the
 * other mode, and you only enter it when you actually mean to do something.
 * It opens on the terminal's ALTERNATE SCREEN, so quitting leaves your
 * scrollback exactly as it was -- nothing this draws ends up in your history.
 */
'use strict';

var TK = require('./tack.js');
var W  = require('./write.js');
var U  = require('./undo.js');
var P  = require('./push.js');
var C  = TK.C;

/* Typed in full to discard. A keypress is something you can do by accident
 * while looking somewhere else; this is not. The word is the actual name of
 * the operation, so typing it means having read it. */
var CONFIRM_WORD = 'discard';

var ALT_ON  = '\x1b[?1049h\x1b[?25l';
var ALT_OFF = '\x1b[?25h\x1b[?1049l';
var CLEAR   = '\x1b[2J\x1b[H';

function pad(s, n)  { s = String(s); return s.length >= n ? s : s + Array(n - s.length + 1).join(' '); }
function clip(s, n) { s = String(s); return s.length <= n ? s : s.slice(0, n - 1) + '…'; }

/* ------------------------------------------------------------------- state */

function Sitting(cfgFile, startQuery) {
  this.cfgFile = cfgFile;
  this.view    = 'repos';
  this.cursor  = 0;
  this.picked  = {};        // path -> true, for the repo in hand
  this.expect  = {};        // path -> xy, as drawn. The anti-stale-picture record.
  this.repo    = null;
  this.message = '';
  this.notice  = '';
  this.typed   = '';        // what has been typed into the discard confirmation
  this.pending = null;      // the classified restore waiting on that confirmation
  this.log       = null;    // the repo whose history is open, and its commits
  this.logCursor = 0;
  this.logFrom   = 'repos'; // which list `l` was pressed from, so q goes back there
  this.commit    = null;    // the one commit being looked at
  this.pushing   = null;    // the repo waiting on a push confirmation
  this.refresh();

  if (startQuery) {
    var q = startQuery.toLowerCase();
    for (var i = 0; i < this.repos.length; i++) {
      if (this.repos[i].label.toLowerCase().indexOf(q) !== -1) { this.open(i); break; }
    }
    if (this.view === 'repos') this.notice = 'no repo matching "' + startQuery + '"';
  }
}

Sitting.prototype.refresh = function () {
  this.state = TK.sweep(this.cfgFile, Date.now());
  this.repos = this.state.repos;
  if (this.cursor >= this.repos.length) this.cursor = Math.max(0, this.repos.length - 1);
};

Sitting.prototype.open = function (i) {
  var r = this.repos[i];
  if (!r || r.error) { this.notice = 'that repo could not be read'; return; }
  if (!r.loose) { this.notice = r.empty ? 'no commits yet, and nothing to commit'
                                        : 'nothing loose in ' + r.label; return; }
  this.repo = TK.readRepo(r.dir, Date.now(), { untracked: 'all' });
  this.reindex();
  this.view = 'files';
  this.cursor = 0;
  this.notice = '';
};

/* Redraw the record of what is on screen. Everything the commit path checks
 * against is written here and nowhere else. */
Sitting.prototype.reindex = function () {
  this.expect = {};
  this.picked = {};
  var self = this;
  this.repo.files.sort(function (a, b) { return (a.mtime || 0) - (b.mtime || 0); });
  this.repo.files.forEach(function (f) { self.expect[f.path] = f.xy; });
};

Sitting.prototype.reopen = function () {
  var dir = this.repo.dir;
  this.repo = TK.readRepo(dir, Date.now(), { untracked: 'all' });
  this.reindex();
  this.cursor = 0;
};

Sitting.prototype.selected = function () {
  var self = this;
  return this.repo.files.filter(function (f) { return self.picked[f.path]; })
                        .map(function (f) { return f.path; });
};

/* ----------------------------------------------------------------- drawing */

/* ------------------------------------------------------------- history */

/* `l` from either list. The pane is where you are deciding what to commit, and
 * "what has been happening in here lately" is part of that decision -- most of
 * all when the repo is live and the answer might be somebody else.
 *
 * It reads through tack.js, which cannot write. Opening the history of a repo
 * is the one thing in this pane that has no consequences at all, so it needs
 * no picking, no confirmation and no stale-picture check. */
Sitting.prototype.openLog = function (repo) {
  if (!repo) { this.notice = 'no repo to look at'; return; }
  var got;
  try { got = TK.readLog(repo.dir, { limit: TK.T.LOG_LINES }); }
  catch (e) { this.notice = 'could not read the history: ' + e.message; return; }

  if (got.error)  { this.notice = got.error; return; }
  if (got.empty)  { this.notice = 'no commits yet in ' + repo.label; return; }
  if (!got.commits.length) { this.notice = 'nothing in the history of ' + repo.label; return; }

  this.logFrom   = this.view;
  this.log       = { label: repo.label, dir: repo.dir, commits: got.commits };
  this.logCursor = 0;
  this.commit    = null;
  this.notice    = '';
  this.view      = 'history';
};

Sitting.prototype.openCommit = function () {
  var c = this.log && this.log.commits[this.logCursor];
  if (!c) return;
  /* The stat, never the patch. This pane lives on the alternate screen so that
   * nothing it draws lands in your scrollback -- which makes it exactly the
   * wrong surface for four hundred lines of diff. The diff belongs in the
   * glance, where the terminal's own scrollback is doing its job, so this
   * names the command rather than pretending to be a pager. */
  var det;
  try { det = TK.readCommit(this.log.dir, c.hash, { patch: false }); }
  catch (e) { this.notice = 'could not read that commit: ' + e.message; return; }
  if (det.error) { this.notice = det.error; return; }
  this.commit = det;
  this.notice = '';
  this.view   = 'commit';
};

Sitting.prototype.draw = function () {
  var L = [], s = this.state, self = this;

  var mood = this.view === 'files'
    ? (this.repo && this.repo.live ? 'alert' : 'awake')
    : (this.view === 'history' || this.view === 'commit') ? 'pleased'
    : this.view === 'push' ? 'awake'
    : TK.moodOf(s);
  var l1, l2;
  /* The push confirmation gets its own header, because it is reachable from
   * the REPO list as well as the file list -- so the header below it, which
   * assumes a repo is open, is not available here. Caught by the suite the
   * first time the pane was driven from the repo list. */
  if (this.view === 'push') {
    l1 = C.body(this.pushing.label) + C.dim('  ·  sending');
    l2 = C.dim('to ') + C.body(this.pushing.dest.remote) +
         C.dim(' · nothing here changes either way');
  } else if (this.view === 'history' || this.view === 'commit') {
    l1 = C.body(this.log.label) + C.dim('  ·  history');
    l2 = C.dim(this.log.commits.length + ' most recent · newest ' +
               TK.agoPhrase(this.log.commits[0].when, Date.now()));
  } else if (this.view === 'repos') {
    l1 = C.body('tack') + C.dim(' · ') +
         (s.totals.files ? C.warm(s.totals.files + ' loose') + C.dim(' in ' + s.totals.dirty + ' of ' + s.totals.repos + ' repos')
                         : C.good('everything is committed'));
    l2 = C.dim('pick a repo to work in');
  } else {
    l1 = C.body(this.repo.label) + C.dim('  ' + (this.repo.branch || '?') +
         (this.repo.upstream ? ' → ' + this.repo.upstream : ''));
    l2 = this.repo.live
      ? C.live('someone may be editing in here right now')
      : C.dim(this.repo.files.length + ' loose · oldest ' + TK.ago(this.repo.oldest, Date.now()));
  }

  L.push('');
  TK.headBlock(mood, l1, l2).forEach(function (x) { L.push(x); });
  L.push('');

  if (this.view === 'repos') {
    var w = Math.min(TK.T.LABEL_MAX, this.repos.reduce(function (m, r) {
      return Math.max(m, r.label.length); }, 4));
    this.repos.forEach(function (r, i) {
      var mark = i === self.cursor ? C.body(' ▸ ') : '   ';
      var name = clip(r.label, TK.T.LABEL_MAX);
      var body = r.loose ? C.body(pad(name, w)) + C.warm('  ' + r.loose + ' loose')
               : r.error ? C.alert(pad(name, w)) + C.alert('  unreadable')
               : r.empty ? C.chrome(pad(name, w)) + C.chrome('  no commits yet')
                         : C.dim(pad(name, w)) + C.dim('  clean');
      L.push(mark + body + (r.ahead ? C.chrome('  \u2191' + r.ahead) : '') +
             (r.live ? C.live('   live') : ''));
    });
    L.push('');
    L.push('  ' + C.dim('↑↓ move · enter open · l history · p push · r refresh · q quit'));

  } else if (this.view === 'files') {
    this.repo.files.forEach(function (f, i) {
      var mark = i === self.cursor ? C.body(' ▸ ') : '   ';
      var box  = self.picked[f.path] ? C.warm('[×]') : C.dim('[ ]');
      var word = TK.describe(f);
      var col  = word === 'untracked' ? C.chrome : (word === 'conflicted' ? C.alert : C.warm);
      L.push(mark + box + ' ' + col(pad(word, 11)) +
             TK.padVis(C.body(clip(f.path.replace(/\\/g, '/'), 44)), 46) +
             C.dim(TK.ago(f.mtime, Date.now())));
    });
    L.push('');
    var n = this.selected().length;
    L.push('  ' + C.dim('space pick · a all · c commit · u put back') +
           (n ? C.warm('  (' + n + ' picked)') : '') +
           C.dim(' · l history · p push · r refresh · q back'));

  } else if (this.view === 'history') {
    this.log.commits.forEach(function (c, i) {
      var mark = i === self.logCursor ? C.body(' ▸ ') : '   ';
      L.push(mark + C.dim(TK.lpad(TK.ago(c.when, Date.now()), 4)) + '  ' +
             C.chrome(c.short) + '  ' +
             TK.padVis(C.body(clip(c.subject, 48)), 49) +
             (c.tack ? C.good('you') : ''));
    });
    L.push('');
    L.push('  ' + C.dim('↑↓ move · enter open · q back'));

  } else if (this.view === 'commit') {
    var cm = this.commit;
    L.push('  ' + C.body(cm.subject));
    var cbody = (cm.body || '').split('\n').filter(function (line) {
      return line.trim() !== TK.TACK_TRAILER; });
    while (cbody.length && !cbody[0].trim()) cbody.shift();
    while (cbody.length && !cbody[cbody.length - 1].trim()) cbody.pop();
    if (cbody.length) {
      L.push('');
      cbody.slice(0, 12).forEach(function (line) { L.push('  ' + C.dim(clip(line, 74))); });
      if (cbody.length > 12) {
        L.push('  ' + C.dim('… ' + (cbody.length - 12) + ' more lines of message'));
      }
    }
    L.push('');
    if (!cm.files.length) {
      L.push('    ' + C.chrome('no files changed'));
    } else {
      cm.files.slice(0, 14).forEach(function (fl) {
        L.push('    ' + TK.padVis(C.body(clip(fl.path, 48)), 50) +
               (fl.binary ? C.chrome('binary')
                          : C.good('+' + fl.added) + ' ' + C.alert('-' + fl.removed)));
      });
      if (cm.files.length > 14) {
        L.push('    ' + C.dim('and ' + (cm.files.length - 14) + ' more files'));
      }
    }
    L.push('');
    L.push('  ' + C.dim('the diff: ') + C.chrome('tack log ' + cm.short + ' -p'));
    L.push('  ' + C.dim('q back'));

  } else if (this.view === 'push') {
    var pu = this.pushing;
    L.push('  ' + C.body('send ' + pu.ahead + ' commit' + (pu.ahead === 1 ? '' : 's') +
           ' from ' + pu.label));
    L.push('');
    pu.subjects.forEach(function (sub) { L.push('    ' + C.dim(clip(sub, 62))); });
    if (pu.ahead > pu.subjects.length) {
      L.push('    ' + C.dim('and ' + (pu.ahead - pu.subjects.length) + ' more'));
    }
    L.push('');
    /* THE URL, not the remote's local name. The whole lesson of this tree's
     * publication lock is that `origin` tells you nothing about where a push
     * lands -- the address does. */
    L.push('  ' + C.dim('to  ') + C.body(pu.dest.remote) + C.dim('  ' + pu.dest.url));
    L.push('');
    L.push('  ' + C.dim('this adds them to the end of what is already there. It cannot'));
    L.push('  ' + C.dim('overwrite anything, and it does not change anything here.'));
    L.push('');
    L.push('  ' + C.dim('enter to send · esc to back out'));

  } else if (this.view === 'message') {
    var picked = this.selected();
    L.push('  ' + C.body('commit ' + picked.length + ' file' +
           (picked.length === 1 ? '' : 's') + ' in ' + this.repo.label));
    L.push('');
    picked.slice(0, 8).forEach(function (p) { L.push('    ' + C.dim(clip(p, 60))); });
    if (picked.length > 8) L.push('    ' + C.dim('and ' + (picked.length - 8) + ' more'));
    L.push('');
    L.push('  ' + C.dim('message  ') + C.body(this.message || this.defaultMsg()) +
           C.body('▏'));
    L.push('  ' + C.dim('         ') +
           C.dim(this.message ? 'enter to commit · esc to go back'
                              : 'enter accepts this · or type your own'));
    if (this.repo.live) {
      L.push('');
      L.push('  ' + C.live('this repo was touched in the last few minutes.'));
      L.push('  ' + C.live('another session may be part-way through something in it.'));
    }

  } else if (this.view === 'putback') {
    var p = this.pending;
    L.push('  ' + C.alert('this throws work away'));
    L.push('');
    p.discard.forEach(function (f) {
      L.push('    ' + C.warm(clip(f, 60)));
    });
    L.push('');
    L.push('  ' + C.dim('these files go back to their last committed state. The'));
    L.push('  ' + C.dim('changes in them are not in git anywhere — this is the one'));
    L.push('  ' + C.dim('thing Tack does that git cannot get back for you.'));
    L.push('');
    L.push('  ' + C.dim('a copy is kept first, in ') + C.body(U.atticRoot()));
    if (p.recent && p.recent.length) {
      L.push('');
      L.push('  ' + C.live('touched in the last few minutes:'));
      p.recent.slice(0, 4).forEach(function (f) {
        L.push('  ' + C.live('  ' + clip(f, 56)));
      });
      L.push('  ' + C.dim('  if that was not you, somebody else may be working in here.'));
    }
    if (p.undelete.length) {
      L.push('');
      L.push('  ' + C.good(p.undelete.length + ' deleted file' +
             (p.undelete.length === 1 ? '' : 's') + ' will be put back too — that part is safe'));
    }
    if (p.refused.length) {
      L.push('');
      p.refused.forEach(function (r) {
        L.push('  ' + C.chrome('left alone: ' + clip(r.path, 40)) + C.dim('  ' + r.why));
      });
    }
    L.push('');
    L.push('  ' + C.dim('type ') + C.alert(CONFIRM_WORD) + C.dim(' to go ahead · esc to back out'));
    L.push('  ' + C.body('  ' + this.typed) + C.body('▏'));

  } else if (this.view === 'done') {
    L.push('  ' + this.notice);
    L.push('');
    L.push('  ' + C.dim('any key to carry on'));
  }

  if (this.notice && this.view !== 'done') {
    L.push('');
    L.push('  ' + C.alert(this.notice));
  }
  return L.join('\n') + '\n';
};

Sitting.prototype.defaultMsg = function () {
  var self = this;
  return W.defaultMessage(this.repo.files.filter(function (f) { return self.picked[f.path]; }));
};

/* ------------------------------------------------------------------- doing */

/* `u` in the file list. Asks first without confirming, so the engine does the
 * sorting and this only has to draw the answer. */
Sitting.prototype.doPutBack = function () {
  var picked = this.selected();
  var res = U.restorePaths(this.repo.dir, this.repo.label, picked,
                           { expect: this.expect, now: Date.now() });

  if (res.needsConfirm) {
    this.pending = res;
    this.typed = '';
    this.view = 'putback';
    return;
  }
  this.reportPutBack(res);
};

Sitting.prototype.doPutBackConfirmed = function () {
  var res = U.restorePaths(this.repo.dir, this.repo.label, this.selected(),
                           { expect: this.expect, now: Date.now(), confirmed: true });
  this.reportPutBack(res);
};

Sitting.prototype.reportPutBack = function (res) {
  var L = [];
  if (res.ok) {
    if (res.undeleted.length) {
      L.push(C.good('put back ' + res.undeleted.length + ' deleted file' +
             (res.undeleted.length === 1 ? '' : 's')));
    }
    if (res.discarded.length) {
      L.push(C.warm('discarded changes in ' + res.discarded.length + ' file' +
             (res.discarded.length === 1 ? '' : 's')));
      L.push('');
      L.push('  ' + C.dim('a copy of what was thrown away is in'));
      L.push('  ' + C.dim(res.attic));
    }
  } else {
    L.push(C.alert('nothing was changed — ' + res.reason));
    if (res.moved) res.moved.forEach(function (m) { L.push('  ' + C.dim(m)); });
  }
  if (res.refused && res.refused.length) {
    L.push('');
    res.refused.forEach(function (r) {
      L.push('  ' + C.chrome('left alone: ' + r.path));
      L.push('  ' + C.dim('  ' + r.why));
    });
  }
  this.notice = L.join('\n  ');
  this.typed = '';
  this.pending = null;
  this.view = 'done';
};

/* `p` from either list. The destination is never asked for -- see the long
 * note over destination() in push.js. What this has to get right is the same
 * thing every other verb here gets right: the number on screen was read some
 * seconds ago, and some seconds is enough. */
Sitting.prototype.doPush = function (repo) {
  if (!repo) { this.notice = 'no repo to push'; return; }
  var rec;
  try { rec = TK.readRepo(repo.dir, Date.now()); }
  catch (e) { this.notice = 'could not read the repo: ' + e.message; return; }

  var res;
  try { res = P.pushUpstream(repo.dir, rec, {}); }
  catch (e2) { this.notice = e2.message; return; }

  if (res.needsConfirm) {
    this.pushing = { dir: repo.dir, label: repo.label, dest: res.dest,
                     ahead: res.ahead, subjects: this.aheadSubjects(repo.dir, res.ahead) };
    this.view = 'push';
    this.notice = '';
    return;
  }
  /* Every other answer is a reason, and the reasons are the useful part: a
   * locked remote, a branch behind its mirror, nothing to send. None of them
   * is an error and none of them gets a screen of its own. */
  this.notice = C.chrome(repo.label + ' — ' + res.reason);
  this.view = 'done';
};

/* What is actually about to go. A count is a number; the subjects are what
 * lets somebody recognise whether it is the work they think it is. */
Sitting.prototype.aheadSubjects = function (dir, n) {
  try {
    var got = TK.readLog(dir, { limit: Math.min(n || 1, 8) });
    return got.commits.map(function (c) { return c.subject; });
  } catch (e) { return []; }
};

Sitting.prototype.doPushConfirmed = function () {
  var pend = this.pushing;
  if (!pend) return;

  /* The stale-picture contract, in the shape this verb needs it. The screen
   * says "3 commits"; if a session in another window has committed a fourth
   * since it was drawn, the sentence somebody agreed to is no longer the
   * sentence being carried out. Refuse and redraw rather than deciding the
   * difference was probably fine. */
  var fresh;
  try { fresh = TK.readRepo(pend.dir, Date.now()); }
  catch (e) { this.reportPush({ ok: false, reason: 'could not re-read the repo' }); return; }

  if (fresh.ahead !== pend.ahead) {
    this.reportPush({ ok: false, reason: 'the repo moved while you were deciding — it ' +
      'was ' + pend.ahead + ' ahead and is now ' + fresh.ahead });
    return;
  }

  var res;
  try { res = P.pushUpstream(pend.dir, fresh, { confirmed: true }); }
  catch (e2) { res = { ok: false, reason: e2.message }; }
  this.reportPush(res, pend);
};

Sitting.prototype.reportPush = function (res, pend) {
  var L = [];
  if (res.ok) {
    L.push(C.good('pushed ' + res.sent + ' commit' + (res.sent === 1 ? '' : 's') +
           ' to ' + res.dest.remote));
    L.push('');
    L.push('  ' + C.dim(res.dest.url));
  } else {
    L.push(C.alert('nothing was pushed — ' + res.reason));
    /* A hook that refuses said why, and those words are the point of the hook. */
    if (res.said && res.said.length) {
      L.push('');
      res.said.slice(0, 12).forEach(function (line) { L.push('  ' + C.dim(line)); });
    }
  }
  this.notice = L.join('\n  ');
  this.pushing = null;
  this.view = 'done';
};

Sitting.prototype.doCommit = function () {
  var picked = this.selected();
  var msg = this.message.trim() || this.defaultMsg();
  var res = W.commitPaths(this.repo.dir, picked, msg, this.expect, Date.now());

  if (res.ok) {
    this.notice = C.good('committed ' + res.count + ' file' +
      (res.count === 1 ? '' : 's') + ' as ' + res.sha) + '\n\n' +
      '  ' + C.dim(res.message.split('\n')[0]);
  } else {
    this.notice = C.alert('nothing was committed — ' + res.reason);
    if (res.moved) res.moved.forEach(function (m) { this.notice += '\n  ' + C.dim(m); }, this);
  }
  this.message = '';
  this.pending = null;
  this.view = 'done';
};

/* ------------------------------------------------------------------- input */

Sitting.prototype.key = function (k) {
  var v = this.view;

  if (v === 'message') {
    if (k === '\r' || k === '\n') { this.doCommit(); return true; }
    if (k === '\x1b') { this.view = 'files'; this.message = ''; return true; }
    if (k === '\x7f' || k === '\b') { this.message = this.message.slice(0, -1); return true; }
    if (k >= ' ' && k <= '~' && k.length === 1) { this.message += k; return true; }
    return true;
  }

  /* Sending is a keypress, not a typed word. Nothing here destroys anything --
   * the local copy is untouched and the far end only gains commits -- and the
   * typed word belongs to the one operation that does destroy work. Spending it
   * here would be the confirmation-you-click-through failure undo.js names. */
  if (v === 'push') {
    if (k === '\x1b' || k === 'q') { this.view = this.repo ? 'files' : 'repos';
                                     this.pushing = null; this.notice = ''; return true; }
    if (k === '\x03') return false;
    if (k === '\r' || k === '\n') { this.doPushConfirmed(); return true; }
    return true;
  }

  if (v === 'putback') {
    if (k === '\x1b') { this.view = 'files'; this.typed = ''; this.pending = null; return true; }
    if (k === '\x7f' || k === '\b') { this.typed = this.typed.slice(0, -1); return true; }
    if (k === '\r' || k === '\n') {
      if (this.typed.trim().toLowerCase() === CONFIRM_WORD) this.doPutBackConfirmed();
      else this.notice = 'type ' + CONFIRM_WORD + ' exactly, or esc to back out';
      return true;
    }
    if (k >= ' ' && k <= '~' && k.length === 1) { this.typed += k; this.notice = ''; }
    return true;
  }

  /* Reading history has no consequences, so these two views come before every
   * guard below them: nothing here can pick, stage, commit or discard. */
  if (v === 'commit') {
    if (k === 'q' || k === '\x1b') { this.view = 'history'; this.commit = null; return true; }
    if (k === '\x03') return false;
    return true;
  }

  if (v === 'history') {
    if (k === 'q' || k === '\x1b') {
      this.view = this.logFrom === 'files' && this.repo ? 'files' : 'repos';
      this.log = null; this.notice = ''; return true;
    }
    if (k === '\x03') return false;
    if (k === '\x1b[A' || k === 'k') {
      this.logCursor = Math.max(0, this.logCursor - 1); return true; }
    if (k === '\x1b[B' || k === 'j') {
      this.logCursor = Math.min(this.log.commits.length - 1, this.logCursor + 1); return true; }
    if (k === '\r' || k === '\n' || k === ' ') { this.openCommit(); return true; }
    return true;
  }

  if (v === 'done') { this.view = this.repo ? 'files' : 'repos';
                      this.notice = ''; if (this.repo) this.reopen(); return true; }

  if (k === 'q' || k === '\x1b') {
    if (v === 'files') { this.view = 'repos'; this.repo = null; this.notice = '';
                         this.refresh(); return true; }
    return false;  /* quit */
  }
  if (k === '\x03') return false;

  var list = v === 'repos' ? this.repos : this.repo.files;
  if (k === '\x1b[A' || k === 'k') { this.cursor = Math.max(0, this.cursor - 1); this.notice = ''; return true; }
  if (k === '\x1b[B' || k === 'j') { this.cursor = Math.min(list.length - 1, this.cursor + 1); this.notice = ''; return true; }
  if (k === 'r') { this.notice = ''; if (v === 'repos') this.refresh(); else this.reopen(); return true; }
  if (k === 'l') {
    this.openLog(v === 'repos' ? this.repos[this.cursor] : this.repo);
    return true;
  }
  if (k === 'p') {
    this.doPush(v === 'repos' ? this.repos[this.cursor] : this.repo);
    return true;
  }

  if (v === 'repos') {
    if (k === '\r' || k === '\n' || k === ' ') { this.open(this.cursor); return true; }
    return true;
  }

  /* files */
  var f = this.repo.files[this.cursor];
  if (k === ' ') { if (f) { this.picked[f.path] = !this.picked[f.path]; } this.notice = ''; return true; }
  if (k === 'a') {
    var all = this.repo.files.every(function (x) { return this.picked[x.path]; }, this);
    this.repo.files.forEach(function (x) { this.picked[x.path] = !all; }, this);
    this.notice = '';
    return true;
  }
  if (k === 'c' || k === '\r' || k === '\n') {
    if (!this.selected().length) { this.notice = 'nothing picked yet — space picks a file'; return true; }
    this.view = 'message'; this.message = ''; this.notice = '';
    return true;
  }
  if (k === 'u') {
    if (!this.selected().length) { this.notice = 'nothing picked yet — space picks a file'; return true; }
    this.doPutBack();
    return true;
  }
  return true;
};

/* -------------------------------------------------------------------- loop */

function run(cfgFile, startQuery) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write('\n  tack sit needs an interactive terminal.\n' +
      '  Run it from PowerShell rather than through a pipe.\n\n');
    return 1;
  }

  var sit = new Sitting(cfgFile, startQuery);
  var out = process.stdout;

  out.write(ALT_ON);
  var paint = function () { out.write(CLEAR + sit.draw()); };
  paint();

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  return new Promise(function (resolve) {
    var leave = function () {
      try { process.stdin.setRawMode(false); } catch (e) {}
      process.stdin.pause();
      out.write(ALT_OFF);
      resolve(0);
    };
    process.stdin.on('data', function (chunk) {
      /* One chunk can hold several keys when a key repeats fast. */
      var keys = String(chunk).match(/\x1b\[[A-D]|[\s\S]/g) || [];
      for (var i = 0; i < keys.length; i++) {
        if (!sit.key(keys[i])) { leave(); return; }
      }
      paint();
    });
  });
}

module.exports = { Sitting: Sitting, run: run, pad: pad, clip: clip };
