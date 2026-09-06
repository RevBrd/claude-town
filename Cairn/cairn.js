#!/usr/bin/env node
/* ============================================================================
   CAIRN — who has come through here, and what they left.

     cairn                  the roll
     cairn <designation>    one session
     cairn commits          the history, and which of it nobody has claimed
     cairn check            is every credit still where it was signed

   The tree has a designation system so that credit attaches to a PARTICULAR
   session rather than to a model name shared by thousands. Until now nothing
   could redeem that: there was no way to ask what CTown 6 built without
   grepping, and no way at all to find a session that discussed rather than
   shipped.

   IT PARSES NO PROSE. That is the whole architectural decision and it was
   measured rather than assumed -- see register.json's header for the census
   that killed the alternative. Designations are declared in register.json;
   everything else here is derived from git and from the files the register
   points at. A credit is checked by looking for the quote the register
   recorded, so a credit edited away is reported rather than silently lost,
   which is the one thing Codeville's rules say must never happen.

   DISAGREEMENT IS OUTPUT, NOT ERROR -- Marquee's rule, and it is what keeps
   this from becoming a nag. A session with no commits is a discussion session
   and shown as one. A commit nobody has claimed is shown as unclaimed. A
   number that names nobody says so. None of that is a failure state; it is a
   record still being assembled, and the unclaimed count is meant to fall.
   ============================================================================ */
'use strict';

var fs   = require('path') && require('fs');
var path = require('path');
var cp   = require('child_process');

var HERE     = __dirname;
var REGISTER = path.join(HERE, 'register.json');

/* ------------------------------------------------------------------ colour */
var C = {
  on: true,
  w: function (c, s) { return C.on ? '\x1b[' + c + 'm' + s + '\x1b[0m' : String(s); },
  dim:    function (s) { return C.w('38;5;242', s); },
  body:   function (s) { return C.w('38;5;252', s); },
  warm:   function (s) { return C.w('38;5;179', s); },
  good:   function (s) { return C.w('38;5;108', s); },
  chrome: function (s) { return C.w('38;5;145', s); },
  bad:    function (s) { return C.w('38;5;174', s); }
};

function pad(s, n)  { s = String(s); return s.length >= n ? s : s + Array(n - s.length + 1).join(' '); }
function visLen(s)  { return String(s).replace(/\x1b\[[0-9;]*m/g, '').length; }
function padVis(s, n) { var d = n - visLen(s); return d > 0 ? s + Array(d + 1).join(' ') : s; }
function clip(s, n) { s = String(s); return s.length <= n ? s : s.slice(0, n - 1) + '…'; }
function trimEnd(s) { return String(s).replace(/\s+$/, ''); }

/* ---------------------------------------------------------------- register */

function loadRegister(file) {
  var raw;
  try { raw = fs.readFileSync(file || REGISTER, 'utf8'); }
  catch (e) { throw new Error('cannot read the register: ' + e.message); }
  var r;
  try { r = JSON.parse(raw); }
  catch (e) { throw new Error('the register is not valid JSON: ' + e.message); }

  var byId = {};
  (r.collections || []).forEach(function (c) { byId[c.id] = c; });

  (r.sessions || []).forEach(function (s) {
    if (!s.designation) throw new Error('a session in the register has no designation');
    if (!byId[s.collection]) {
      throw new Error(s.designation + ' names a collection the register does not declare: ' +
                      s.collection);
    }
    s.state = s.state || 'closed';
    s.coll  = byId[s.collection];
  });
  return r;
}

/* The tree root, resolved from the register's own declaration rather than
   guessed from __dirname. One anchor for every path in the file, because a
   credit may sit outside the collection that earned it -- CTown 9 signed
   inside the Pet, which is a different repository entirely. */
function treeRoot(reg) { return path.resolve(HERE, reg.tree || '../../..'); }

/* --------------------------------------------------------------- the check */

/* Whitespace is collapsed on both sides before matching. A credit line wraps
   in the source at whatever column its author was using, and a quote that
   spanned a line break would otherwise never match -- reporting a credit as
   lost at the moment somebody reflowed a paragraph. What is being asserted is
   that the WORDS are still there, not the line breaks. */
function squash(s) { return String(s).replace(/\s+/g, ' ').trim(); }

function checkSignatures(reg) {
  var root = treeRoot(reg), cache = {}, out = [];
  reg.sessions.forEach(function (s) {
    (s.signed || []).forEach(function (sig) {
      var abs = path.join(root, sig.file), rec = { session: s, sig: sig };
      if (!(abs in cache)) {
        try { cache[abs] = squash(fs.readFileSync(abs, 'utf8')); }
        catch (e) { cache[abs] = null; }
      }
      if (cache[abs] === null)                         rec.status = 'no-file';
      else if (cache[abs].indexOf(squash(sig.quote)) >= 0) rec.status = 'ok';
      else                                             rec.status = 'gone';
      out.push(rec);
    });
  });
  return out;
}

/* ----------------------------------------------------------------- history */

/* Which commits are whose. Three trailers exist in this tree and all three are
   matched BY VALUE rather than by pattern, because a pattern loose enough to
   catch a designation is loose enough to read "the room itself" as one.
   Anything else after "Committed by " is a claim, and a claim naming somebody
   the register has never heard of is reported -- that is a new arrival, not an
   error. */
var TACK_TRAILER = 'Committed with Tack.';
var ROOM_TRAILER = 'Committed by the room itself.';
var CLAIM        = /^Committed by (.+?)\.\s*$/m;

function whoseCommit(body, known) {
  if (body.indexOf(TACK_TRAILER) >= 0) return { who: 'Trevor',  kind: 'trevor' };
  if (body.indexOf(ROOM_TRAILER) >= 0) return { who: 'the room', kind: 'room' };
  var m = CLAIM.exec(body);
  if (m) {
    var name = m[1].trim();
    return { who: name, kind: known[name.toLowerCase()] ? 'session' : 'unknown' };
  }
  return { who: null, kind: 'unclaimed' };
}

var RS = '\x1e', US = '\x1f';

function history(reg, opts) {
  opts = opts || {};
  var root = treeRoot(reg), known = {}, out = [];
  reg.sessions.forEach(function (s) {
    known[s.designation.toLowerCase()] = s;
    if (s.signature) known[s.signature.toLowerCase()] = s;
  });

  reg.collections.forEach(function (c) {
    var repo = path.join(root, c.repo), raw;
    try {
      raw = (opts.git || gitLog)(repo);
    } catch (e) {
      out.push({ coll: c, error: e.message });
      return;
    }
    raw.split(RS).slice(1).forEach(function (rec) {
      var p = rec.split(US);
      var body = (p[3] || '');
      var w = whoseCommit(body, known);
      out.push({ coll: c, hash: (p[0] || '').slice(0, 7), date: p[1] || '',
                 subject: p[2] || '', who: w.who, kind: w.kind });
    });
  });
  out.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
  return out;
}

function gitLog(repo) {
  return cp.execFileSync('git', ['-C', repo, 'log', '--no-merges', '--date=short',
    '--format=' + RS + '%H' + US + '%ad' + US + '%s' + US + '%b'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
}

/* ------------------------------------------------------------------ naming */

/* A designation typed at a prompt, matched the way somebody types it. The
   shorthand is expanded here and only here: inside a collection a session may
   sign just "#30", and the folder supplies the rest -- so a bare number is
   ambiguous ACROSS collections and is answered with every match rather than a
   guess. KSP 1 and Shadowless 1 are different people and picking one would
   look exactly like it worked. */
function norm(s) {
  return String(s == null ? '' : s).toLowerCase()
    .replace(/[#]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}

function find(query, reg) {
  var q = norm(query);
  if (!q) return [];
  var all = reg.sessions;

  var exact = all.filter(function (s) {
    return norm(s.designation) === q || (s.signature && norm(s.signature) === q);
  });
  if (exact.length) return exact;

  /* A bare number: every collection that has one, never the first.
     A number is matched LITERALLY, and the two attempts to be helpful about
     leading zeros were both wrong for the same reason. Number('041') is 41, so
     typing 041 found a session numbered 41. Stripping the zeros instead was
     symmetrical and no better: it made 41 find 041. There is no rule that
     separates them, because there is nothing structural to separate -- and 041
     is the one self-chosen name in this tree, the single identity that must
     never be confused with another.
     So `cairn 04` finds nothing and says so. A convenience that manufactures a
     false identity is not a convenience; it is guessing, wearing a helpful
     face. `cairn` on its own lists everybody. */
  if (/^[0-9]+$/.test(q)) {
    /* And a numeric query STOPS here, matched or not. Falling through to the
       substring pass let `04` find 041 by containment -- the same false
       identity arriving by a different door, which is how a rule gets removed
       from one branch and quietly survives in the next. */
    return all.filter(function (s) {
      var n = norm(s.designation).split(' ').pop();
      return /^[0-9]+$/.test(n) && n === q;
    });
  }

  var pre = all.filter(function (s) { return norm(s.designation).indexOf(q) === 0; });
  if (pre.length) return pre;

  return all.filter(function (s) {
    return norm(s.designation).indexOf(q) >= 0 ||
           (s.signature && norm(s.signature).indexOf(q) >= 0);
  });
}

/* ----------------------------------------------------------------- drawing */

function whenOf(s) {
  if (s.state === 'open')  return 'open';
  if (s.state === 'never') return '—';
  return s.when || '';
}

function renderRoll(reg, checks, hist) {
  var L = [''], byColl = {};
  reg.sessions.forEach(function (s) { (byColl[s.collection] = byColl[s.collection] || []).push(s); });

  var real  = reg.sessions.filter(function (s) { return s.state !== 'never'; });
  var open  = real.filter(function (s) { return s.state === 'open'; });

  L.push('  ' + C.body('cairn') + C.dim(' · ') + C.chrome(real.length + ' have come through') +
         C.dim(' · ' + reg.collections.length + ' collections') +
         (open.length ? C.dim(' · ') + C.warm(open.length + ' still open') : ''));
  L.push('');

  /* Columns are measured from the content rather than guessed. The first draft
     used fixed widths and "Codeville 5" ran straight into its own date, which
     is the kind of thing that looks like a rendering bug and is really a magic
     number nobody re-measured after a row was added. */
  var labelOf = function (s) { return s.signature || s.designation; };
  var wName = reg.sessions.reduce(function (m, s) { return Math.max(m, labelOf(s).length); }, 4) + 2;
  var wWhen = reg.sessions.reduce(function (m, s) { return Math.max(m, whenOf(s).length); }, 4) + 2;
  var wTail = Math.max(28, (process.stdout.columns || 100) - 6 - wName - wWhen);

  /* What the third column says when there is nothing left behind to say. The
     full reason lives in `why` and is shown by `cairn <designation>`; clipping
     a paragraph to fit a column produced a half-sentence that read as an
     error message. */
  var SHORT = { never: 'no such session, and the gap is deliberate',
                open:  'unfinished — it will pick back up' };

  reg.collections.forEach(function (c) {
    var rows = byColl[c.id] || [];
    if (!rows.length) return;
    L.push('  ' + C.dim(c.name));
    rows.forEach(function (s) {
      var name = pad(labelOf(s), wName);
      var when = pad(whenOf(s), wWhen);
      var tail = clip(s.short || (s.state === 'closed' ? (s.left || '') : SHORT[s.state] || ''), wTail);
      if (s.state === 'never')     L.push('    ' + C.dim(name) + C.dim(when) + C.dim(tail));
      else if (s.state === 'open') L.push('    ' + C.body(name) + C.warm(when) + C.dim(tail));
      else                         L.push('    ' + C.body(name) + C.dim(when) + C.body(tail));
    });
    L.push('');
  });

  /* Two numbers, and the second one is the point of the trailer convention. */
  var unclaimed = hist.filter(function (h) { return h.kind === 'unclaimed'; }).length;
  var claimed   = hist.filter(function (h) { return h.kind === 'session'; }).length;
  var commits   = hist.filter(function (h) { return !h.error; }).length;
  L.push('  ' + C.dim(commits + ' commits across those collections · ') +
         (unclaimed ? C.warm(unclaimed + ' nobody has claimed') : C.good('all of them claimed')) +
         C.dim(claimed ? ' · ' + claimed + ' signed' : ''));

  var lost = checks.filter(function (k) { return k.status !== 'ok'; });
  if (lost.length) {
    L.push('  ' + C.bad(lost.length + ' credit' + (lost.length > 1 ? 's are' : ' is') +
           ' no longer where it was signed') + C.dim(' — `cairn check`'));
  }
  L.push('');
  L.push('  ' + C.dim('`cairn <designation>` for one · `cairn commits` · `cairn check`'));
  L.push('');
  return L.map(trimEnd);
}

function renderOne(s, reg, checks, hist) {
  var L = [''];
  var label = s.signature || s.designation;
  var head = C.body(label);
  if (s.signature && s.signature !== s.designation) head += C.dim('  (' + s.designation + ')');
  head += C.dim(' · ') + C.chrome(s.model || 'model unrecorded') +
          C.dim(' · ') + C.chrome(whenOf(s)) + C.dim(' · ' + s.coll.name);
  L.push('  ' + head);
  L.push('');

  if (s.state === 'never') {
    L.push('  ' + C.dim(s.why));
    L.push('');
    L.push('  ' + C.dim('this row exists so the gap does not get filled in.'));
    L.push('');
    return L.map(trimEnd);
  }

  if (s.state === 'open') {
    L.push('  ' + C.warm('still open.') + ' ' + C.body(s.why || ''));
    L.push('');
  }

  if (s.left) {
    L.push('  ' + C.dim('left behind'));
    L.push('    ' + C.body(s.left));
    L.push('');
  }

  var mine = checks.filter(function (k) { return k.session === s; });
  if (mine.length) {
    L.push('  ' + C.dim('signed'));
    mine.forEach(function (k) {
      var mark = k.status === 'ok' ? C.dim('·') :
                 k.status === 'gone' ? C.bad('!') : C.bad('?');
      L.push('    ' + mark + ' ' + C.dim(k.sig.file));
      if (k.status === 'gone') L.push('      ' + C.bad('the credit is not in that file any more'));
      if (k.status === 'no-file') L.push('      ' + C.bad('that file is not there'));
    });
    L.push('');
  }

  var theirs = hist.filter(function (h) {
    return h.who && (h.who.toLowerCase() === s.designation.toLowerCase() ||
                    (s.signature && h.who.toLowerCase() === s.signature.toLowerCase()));
  });
  L.push('  ' + C.dim('commits'));
  if (theirs.length) {
    theirs.forEach(function (h) {
      L.push('    ' + C.dim(h.hash) + ' ' + C.dim(h.date) + '  ' + C.body(clip(h.subject, 64)));
    });
  } else {
    /* Not 'none'. A session before the trailer convention committed plenty and
       simply cannot be joined to it, and saying 'none' would read as 'did
       nothing' -- which for most of this register is the opposite of true. */
    L.push('    ' + C.dim('none carry a trailer naming this session, so none can be'));
    L.push('    ' + C.dim('attributed. Guessing by date would be a guess.'));
  }
  L.push('');

  if (s.note) {
    L.push('  ' + C.dim('note'));
    wrap(s.note, 74).forEach(function (line) { L.push('    ' + C.dim(line)); });
    L.push('');
  }
  return L.map(trimEnd);
}

function wrap(text, width) {
  var words = String(text).split(/\s+/), lines = [], cur = '';
  words.forEach(function (w) {
    if (!cur.length) { cur = w; return; }
    if ((cur + ' ' + w).length > width) { lines.push(cur); cur = w; }
    else cur += ' ' + w;
  });
  if (cur.length) lines.push(cur);
  return lines;
}

function renderCommits(hist, reg) {
  var L = [''];
  var kinds = { unclaimed: 0, session: 0, trevor: 0, room: 0, unknown: 0 };
  hist.forEach(function (h) { if (!h.error) kinds[h.kind]++; });

  L.push('  ' + C.body('the history') + C.dim(' · ') +
         C.chrome(hist.filter(function (h) { return !h.error; }).length + ' commits'));
  L.push('  ' + C.dim('signed ') + C.good(kinds.session) +
         C.dim(' · Trevor ') + C.chrome(kinds.trevor) +
         C.dim(' · the room ') + C.chrome(kinds.room) +
         C.dim(' · unclaimed ') + C.warm(kinds.unclaimed) +
         (kinds.unknown ? C.dim(' · ') + C.bad(kinds.unknown + ' claimed by a name the register lacks') : ''));
  L.push('');

  hist.forEach(function (h) {
    if (h.error) { L.push('    ' + C.bad('! ' + h.coll.name + ' — ' + h.error)); return; }
    var who = h.kind === 'unclaimed' ? C.dim('—') :
              h.kind === 'unknown'   ? C.bad(clip(h.who, 14)) :
              h.kind === 'trevor'    ? C.chrome('Trevor') :
              h.kind === 'room'      ? C.chrome('the room') : C.good(clip(h.who, 14));
    L.push('    ' + C.dim(h.date) + ' ' + padVis(who, 15) +
           padVis(C.dim(clip(h.coll.name, 12)), 14) + C.body(clip(h.subject, 56)));
  });
  L.push('');
  L.push('  ' + C.dim('a commit is claimed by a `Committed by <designation>.` trailer.'));
  L.push('  ' + C.dim('nothing here is guessed from dates — see CLAUDE.md for why.'));
  L.push('');
  return L.map(trimEnd);
}

function renderCheck(checks, reg) {
  var L = [''];
  var bad = checks.filter(function (k) { return k.status !== 'ok'; });
  L.push('  ' + C.body('credits') + C.dim(' · ') + C.chrome(checks.length + ' signatures recorded') +
         C.dim(' · ') + (bad.length ? C.bad(bad.length + ' not where they were signed')
                                    : C.good('all still in place')));
  L.push('');
  checks.forEach(function (k) {
    var mark = k.status === 'ok' ? C.good('·') : C.bad('!');
    L.push('    ' + mark + ' ' + padVis(C.body(pad(k.session.signature || k.session.designation, 12)), 13) +
           C.dim(clip(k.sig.file, 46)));
    if (k.status !== 'ok') {
      L.push('        ' + C.bad(k.status === 'gone' ? 'the quoted credit is gone from that file'
                                                    : 'that file does not exist'));
      L.push('        ' + C.dim('quoted: ' + clip(squash(k.sig.quote), 66)));
    }
  });
  L.push('');
  L.push('  ' + C.dim('a credit is matched by its words, not its line number, so reflowing'));
  L.push('  ' + C.dim('a paragraph does not report a loss. Losing the words does.'));
  L.push('');
  return L.map(trimEnd);
}

/* --------------------------------------------------------------------- cli */

var HELP = [
  '',
  '  cairn                  who has come through here',
  '  cairn <designation>    one session — what it left, where it signed',
  '  cairn commits          the history, and which of it nobody has claimed',
  '  cairn check            is every credit still where it was signed',
  '',
  '  --no-color             plain text',
  '',
  '  Designations are declared in register.json because an assignment is a',
  '  speech act, not a fact about the filesystem. Everything else is derived.',
  ''
].join('\n');

function main(argv) {
  var args = argv.slice(2);
  if (args.indexOf('--no-color') !== -1 || process.env.NO_COLOR ||
      !process.stdout.isTTY) C.on = false;
  if (args.indexOf('--help') !== -1 || args.indexOf('-h') !== -1) {
    process.stdout.write(HELP + '\n'); return 0;
  }
  args = args.filter(function (a) { return a.charAt(0) !== '-'; });

  var reg;
  try { reg = loadRegister(); }
  catch (e) { process.stderr.write('\n  cairn: ' + e.message + '\n\n'); return 1; }

  var checks = checkSignatures(reg);

  if (!args.length) {
    process.stdout.write(renderRoll(reg, checks, history(reg)).join('\n') + '\n');
    return 0;
  }
  if (args[0] === 'commits') {
    process.stdout.write(renderCommits(history(reg), reg).join('\n') + '\n');
    return 0;
  }
  if (args[0] === 'check') {
    process.stdout.write(renderCheck(checks, reg).join('\n') + '\n');
    return checks.some(function (k) { return k.status !== 'ok'; }) ? 1 : 0;
  }

  var hits = find(args.join(' '), reg);
  if (!hits.length) {
    process.stdout.write('\n  ' + C.bad('nobody here is called "' + args.join(' ') + '"') +
      '\n  ' + C.dim('`cairn` on its own lists everyone.') + '\n\n');
    return 1;
  }
  if (hits.length > 1) {
    process.stdout.write('\n  ' + C.warm(hits.length + ' match "' + args.join(' ') + '"') + '\n\n' +
      hits.map(function (s) {
        return '    ' + C.body(pad(s.signature || s.designation, 14)) + C.dim(s.coll.name);
      }).join('\n') +
      '\n\n  ' + C.dim('say which. A bare number is a different session in every') +
      '\n  ' + C.dim('collection, so Cairn will not pick one.') + '\n\n');
    return 1;
  }
  process.stdout.write(renderOne(hits[0], reg, checks, history(reg)).join('\n') + '\n');
  return 0;
}

module.exports = {
  loadRegister: loadRegister, checkSignatures: checkSignatures, squash: squash,
  whoseCommit: whoseCommit, history: history, find: find, norm: norm,
  renderRoll: renderRoll, renderOne: renderOne, renderCommits: renderCommits,
  renderCheck: renderCheck, treeRoot: treeRoot, wrap: wrap, C: C, main: main,
  TACK_TRAILER: TACK_TRAILER, ROOM_TRAILER: ROOM_TRAILER, RS: RS, US: US
};

if (require.main === module) process.exit(main(process.argv));
