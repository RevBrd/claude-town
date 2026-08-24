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
var C  = TK.C;

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
  this.confirm = false;
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

Sitting.prototype.draw = function () {
  var L = [], s = this.state, self = this;

  var mood = this.view === 'files'
    ? (this.repo && this.repo.live ? 'alert' : 'awake')
    : TK.moodOf(s);
  var l1, l2;
  if (this.view === 'repos') {
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
      L.push(mark + body + (r.live ? C.live('   live') : ''));
    });
    L.push('');
    L.push('  ' + C.dim('↑↓ move · enter open · r refresh · q quit'));

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
    L.push('  ' + C.dim('space pick · a all · c commit') +
           (n ? C.warm('  (' + n + ' picked)') : '') +
           C.dim(' · r refresh · q back'));

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
  this.confirm = false;
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
