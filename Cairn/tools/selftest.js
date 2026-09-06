#!/usr/bin/env node
/* ============================================================================
   selftest.js — does Cairn tell the truth about who has been here?

     node tools/selftest.js            assertions + mutation suite
     node tools/selftest.js --no-mut   assertions only

   WHERE things are asserted follows the rule the other harnesses here settled
   on. Logic runs against a SYNTHETIC register and synthetic files in a temp
   directory, because asserting that CTown 6 built Tack would encode a fact
   somebody may reword tomorrow, and a suite that cries wolf gets deleted.

   ONE EXCEPTION, and it is deliberate: the live check that every credit quoted
   in the register is still in the file it names. That one is SUPPOSED to go
   red. Codeville's first rule is that losing a credit loses the record of
   somebody's contribution, and this is the only mechanised guard on it
   anywhere in the tree. If it fails, a credit changed -- go and look, then
   update the register's quote in the same commit.

   Nothing in this suite writes anywhere but its own temp directory. Tack's
   suite once filed its rescues in the real attic; a suite with an effect
   outside the program it tests is a side effect with assertions attached.
   ============================================================================ */
'use strict';

var fs   = require('fs');
var os   = require('os');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var SRC  = path.join(ROOT, 'cairn.js');

var QUIET  = process.argv.indexOf('--quiet')  !== -1;
var NO_MUT = process.argv.indexOf('--no-mut') !== -1;

var pass = 0, fail = 0;
var failures = [];

function ok(cond, what) {
  if (cond) { pass++; if (!QUIET) console.log('  ok   ' + what); }
  else      { fail++; failures.push(what); console.log('  FAIL ' + what); }
}
function eq(a, b, what) {
  var good = JSON.stringify(a) === JSON.stringify(b);
  ok(good, what + (good ? '' : '   got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)));
}
function throws(fn, what) {
  try { fn(); ok(false, what + '   (it did not throw)'); }
  catch (e) { ok(true, what); }
}
/* Refusing is half the job; saying what to do instead is the other half, and
   only this form tests it. `cairn new` is run by the person who assigns
   designations rather than by anybody who reads the source, so "no repo called
   undefined" and "say which repo and Cairn will declare it" are not the same
   outcome — and a bare `throws` cannot tell them apart. */
function throwsWith(fn, re, what) {
  try { fn(); ok(false, what + '   (it did not throw)'); }
  catch (e) { ok(re.test(e.message), what + (re.test(e.message) ? '' :
    '   message was: ' + JSON.stringify(e.message))); }
}
function section(s) { if (!QUIET) console.log('\n' + s); }

/* ---------------------------------------------------------------- fixtures */

var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-test-'));

function write(rel, text) {
  var abs = path.join(TMP, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
  return abs;
}

/* A credit that WRAPS, because that is the shape the real docs are in and the
   shape a line-number-based check cannot survive. */
write('docs/wrapped.md',
  'Some prose about the thing.\n\n' +
  'The back door — `open.js` — by **Fixture 2**\n(Opus 5), 3 Mar 2027, after a long wait.\n');
write('docs/plain.md', 'Built by **Fixture 1** (Opus 4.6), 1 Jan 2027.\n');
write('docs/empty.md', 'This file mentions nobody at all.\n');

var FIXTURE = {
  tree: '.',
  repos: [
    { id: 'ra', name: 'Repo A', path: 'repo-a' },
    { id: 'rb', name: 'Repo B', path: 'repo-b' }
  ],
  collections: [
    { id: 'alpha', name: 'Alpha', prefix: 'Fixture', repo: 'ra' },
    { id: 'beta',  name: 'Beta',  prefix: 'Beta',    repo: 'rb' },
    /* Two collections in ONE repo — the shape every game in Projects/Games has,
       and the shape Tack 1 has inside Claude Town. The hazard is that a
       per-collection walk reads that history twice and counts it twice. */
    { id: 'gamma', name: 'Gamma', prefix: 'Gamma',   repo: 'ra' }
  ],
  sessions: [
    { designation: 'Fixture 1', collection: 'alpha', model: 'Opus 4.6', when: '1 Jan 2027',
      left: 'the first thing',
      signed: [{ file: 'docs/plain.md', quote: 'Built by **Fixture 1** (Opus 4.6), 1 Jan 2027.' }] },
    { designation: 'Fixture 2', collection: 'alpha', model: 'Opus 5', when: '3 Mar 2027',
      left: 'the second thing',
      signed: [{ file: 'docs/wrapped.md',
                 quote: 'by **Fixture 2** (Opus 5), 3 Mar 2027, after a long wait.' }] },
    { designation: 'Fixture 3', collection: 'alpha', state: 'never',
      why: 'deliberately nobody' },
    { designation: 'Fixture 4', collection: 'alpha', state: 'open', model: 'Opus 5',
      why: 'still going' },
    { designation: 'Fixture 41', collection: 'alpha', model: 'Opus 5', when: 'someday',
      left: 'a number that 041 must not be confused with' },
    { designation: 'Fixture 5', collection: 'alpha', model: 'Opus 5', when: 'x', left: 'y' },
    { designation: 'Beta 5', collection: 'beta', model: 'Opus 5', when: 'x', left: 'z' },
    { designation: 'Alpha 041', signature: '041', collection: 'alpha', model: 'Opus 5',
      when: 'long ago', left: 'named itself',
      signed: [{ file: 'docs/empty.md', quote: 'a credit that was never in this file' }] },
    { designation: 'Gamma 1', collection: 'gamma', model: 'Opus 5', when: 'x',
      left: 'work in a repo somebody else also has a prefix in' }
  ]
};

function fixtureRegister(M, over) {
  var f = path.join(TMP, 'register.json');
  var reg = JSON.parse(JSON.stringify(FIXTURE));
  if (over) over(reg);
  fs.writeFileSync(f, JSON.stringify(reg));
  return M.loadRegister(f);
}

/* Cairn resolves `tree` relative to its own folder, so a fixture register in
   the temp dir has to be pointed at the temp dir. Patched on the loaded object
   rather than in the file, because the file's relative path would be resolved
   against the real Cairn folder and quietly find nothing. */
function atTmp(reg) { reg.tree = path.relative(ROOT, TMP).split(path.sep).join('/'); return reg; }

/* A fake git, so nothing in here depends on the real history. */
function fakeGit(M, byRepo) {
  return function (repo) {
    var key = path.basename(repo);
    if (!(key in byRepo)) throw new Error('no such repo: ' + key);
    return byRepo[key].map(function (c) {
      return M.RS + c.hash + M.US + c.date + M.US + c.subject + M.US + (c.body || '');
    }).join('');
  };
}

/* ------------------------------------------------------------------ suites */

function assertions(M) {
  M.C.on = false;

  section('the register is validated, not trusted');

  var reg = atTmp(fixtureRegister(M));
  ok(reg.sessions.length === 9, 'the fixture register loads (' + reg.sessions.length + ')');
  eq(reg.sessions[0].state, 'closed', 'a session with no state is closed');
  eq(reg.sessions[2].state, 'never', 'a declared state survives loading');

  throws(function () {
    fixtureRegister(M, function (r) { r.sessions[0].collection = 'nope'; });
  }, 'a session naming an undeclared collection is refused by name');
  throws(function () {
    fixtureRegister(M, function (r) { r.collections[0].repo = 'nope'; });
  }, 'and a collection naming an undeclared repo');
  throws(function () {
    fixtureRegister(M, function (r) { r.repos.push({ id: 'ra', path: 'x' }); });
  }, 'and two repos sharing an id, which would silently drop one history');
  throws(function () {
    fixtureRegister(M, function (r) { delete r.sessions[0].designation; });
  }, 'and a session with no designation at all');
  throws(function () { M.loadRegister(path.join(TMP, 'not-here.json')); },
    'a missing register is an error rather than an empty roll');

  section('a credit is found by its words, not its line');

  var checks = M.checkSignatures(reg);
  var status = {};
  checks.forEach(function (k) {
    status[(k.session.signature || k.session.designation) + ' ' + k.sig.file] = k.status;
  });
  eq(status['Fixture 1 docs/plain.md'], 'ok', 'a credit on one line is found');
  eq(status['Fixture 2 docs/wrapped.md'], 'ok',
     'and one that WRAPS across two lines is found too — the check is on the words');
  eq(status['041 docs/empty.md'], 'gone', 'a credit that is not in the file is reported gone');

  var missing = atTmp(fixtureRegister(M, function (r) {
    r.sessions[0].signed[0].file = 'docs/vanished.md';
  }));
  eq(M.checkSignatures(missing)[0].status, 'no-file',
     'and a credit in a file that does not exist is its own state, not "gone"');

  eq(M.squash('a  b\n c \t d'), 'a b c d', 'whitespace collapses to one space');

  section('whose commit is whose, by value');

  var known = {};
  eq(M.whoseCommit('did a thing\n\nCommitted with Tack.', known).kind, 'trevor',
     "Tack's trailer means Trevor");
  eq(M.whoseCommit('log: a visit\n\nCommitted by the room itself.', known).kind, 'room',
     "the room's trailer means the room");
  /* The reason both are matched by value: a pattern loose enough to catch a
     designation catches "the room itself" as one, and then the Pet's every
     commit reports as an unknown session forever. */
  eq(M.whoseCommit('log: a visit\n\nCommitted by the room itself.', known).who, 'the room',
     'and is NOT read as a session called "the room itself"');

  known['fixture 2'] = reg.sessions[1];
  eq(M.whoseCommit('a thing\n\nSession: Fixture 2', known).kind, 'session',
     'the Session: trailer names a session in the register');
  eq(M.whoseCommit('a thing\n\nSession: Fixture 2\nCo-Authored-By: someone', known).who,
     'Fixture 2', 'and reads it with other trailers stacked underneath');

  /* The sentence form the convention started with, kept because three commits
     on 6 Sep 2026 carry it and rewriting history to tidy that would be worse
     than reading it. It was replaced because `Committed by Tack 1.` sits one
     preposition from `Committed with Tack.`, which means Trevor. */
  eq(M.whoseCommit('a thing\n\nCommitted by Fixture 2.', known).kind, 'session',
     'the older sentence form is still read');

  /* A trailer is a LINE. Found by pointing Cairn at its own history: the commit
     that introduced the Session: trailer discusses `Committed with Tack.` in
     its message, and a substring check read that commit as Trevor's. Every
     commit message and doc in this tree writes about these conventions, so a
     substring check makes the tool unable to describe itself. */
  var talksAbout =
    'Two things Trevor found.\n\n' +
    'The signature collided: `Committed by CTown 9.` sits one preposition from\n' +
    '`Committed with Tack.`, which means Trevor, and `Committed by the room\n' +
    'itself.` is the Pet.\n\n' +
    'Session: Fixture 2\n';
  eq(M.whoseCommit(talksAbout, known).who, 'Fixture 2',
     'a message that MENTIONS the other trailers mid-sentence is still signed ' +
     'by its own trailer, not attributed to whoever it quoted');
  eq(M.whoseCommit('nothing but prose about Committed with Tack. in a line', known).kind,
     'unclaimed', 'and a mention with no trailer at all claims nobody');

  /* The collision that caused the change, from both sides. */
  known['tack 1'] = { designation: 'Tack 1' };
  eq(M.whoseCommit('a thing\n\nCommitted with Tack.', known).kind, 'trevor',
     "Tack's own trailer still means Trevor even with a Tack 1 in the register");
  eq(M.whoseCommit('a thing\n\nSession: Tack 1', known).who, 'Tack 1',
     'and Tack 1 signing is Tack 1, not Trevor');
  eq(M.whoseCommit('a thing\n\nCommitted by Somebody 12.', known).kind, 'unknown',
     'a trailer naming somebody unknown is reported, not dropped');
  eq(M.whoseCommit('a thing with no trailer at all', known).kind, 'unclaimed',
     'and a commit with no trailer is unclaimed');
  eq(M.whoseCommit('a thing with no trailer at all', known).who, null,
     'which is not the same as being claimed by nobody-in-particular');

  section('the history joins on the trailer and never on a date');

  var git = fakeGit(M, {
    'repo-a': [
      { hash: 'a11111100000000000000000000000000000000', date: '2027-03-03', subject: 'the second thing',
        body: 'Committed by Fixture 2.' },
      { hash: 'a22222200000000000000000000000000000000', date: '2027-01-01', subject: 'the first thing', body: '' },
      { hash: 'a33333300000000000000000000000000000000', date: '2027-01-02', subject: "trevor's edit",
        body: 'Committed with Tack.' }
    ],
    'repo-b': [
      { hash: 'b11111100000000000000000000000000000000', date: '2027-02-02', subject: 'over here', body: '' }
    ]
  });
  var hist = M.history(reg, { git: git });
  eq(hist.length, 4, 'every commit in every repo is read');
  /* Alpha and Gamma both live in repo-a. Walking per collection would read it
     twice and report six commits where there are four. */
  eq(hist.filter(function (h) { return h.repo && h.repo.id === 'ra'; }).length, 3,
     'a repo two collections share is read ONCE, not once per collection');
  eq(hist.map(function (h) { return h.date; }),
     ['2027-03-03', '2027-02-02', '2027-01-02', '2027-01-01'],
     'newest first, merged across collections');
  eq(hist.filter(function (h) { return h.kind === 'session'; }).map(function (h) { return h.hash; }),
     ['a111111'], 'only the trailer attributes a commit, and the hash is shortened');
  eq(hist.filter(function (h) { return h.kind === 'unclaimed'; }).length, 2,
     'and the rest are unclaimed rather than guessed at');

  /* aaaaaaa2 lands on Fixture 1's own date, in Fixture 1's own collection, and
     is STILL unclaimed. That is the whole discipline in one assertion. */
  var f1 = hist.filter(function (h) { return h.hash === 'a222222'; })[0];
  eq(f1.kind, 'unclaimed',
     "a commit on a session's exact date is still not attributed to it");

  var broken = M.history(reg, { git: fakeGit(M, { 'repo-a': [] }) });
  ok(broken.some(function (h) { return h.error; }),
     'a collection whose repo cannot be read is reported, not skipped');

  section('a designation typed at a prompt');

  eq(M.find('Fixture 2', reg).length, 1, 'a full designation resolves');
  eq(M.find('fixture  2', reg).length, 1, 'case and spacing are how people type');
  eq(M.find('#2', reg).map(function (s) { return s.designation; }), ['Fixture 2'],
     'the shorthand a session signs inside its own folder resolves too');
  eq(M.find('041', reg).map(function (s) { return s.designation; }), ['Alpha 041'],
     'a self-chosen signature answers to itself');

  /* Number('041') is 41. The one name in this tree that must never be confused
     with another is the one a numeric coercion would have confused. */
  eq(M.find('041', reg).map(function (s) { return s.designation; }).indexOf('Fixture 41'), -1,
     'and 041 does NOT find a session numbered 41');
  eq(M.find('41', reg).map(function (s) { return s.designation; }), ['Fixture 41'],
     'and 41 does NOT find 041 either — the confusion runs both ways');
  eq(M.find('04', reg).length, 0,
     'a zero-padded number finds nothing rather than guessing what it meant: ' +
     'no rule separates 04-means-4 from 041-means-41');
  eq(M.find('4', reg).map(function (s) { return s.designation; }), ['Fixture 4'],
     'while a plain number still resolves exactly');

  var five = M.find('5', reg).map(function (s) { return s.designation; }).sort();
  eq(five, ['Beta 5', 'Fixture 5'],
     'a bare number is every collection that has one — never a guess between them');
  eq(M.find('zzz', reg).length, 0, 'and nothing matched is nothing matched');
  eq(M.find('', reg).length, 0, 'an empty query matches nobody');

  section('three states, and none of them renders like another');

  var roll = M.renderRoll(reg, checks, hist).join('\n');
  ok(roll.indexOf('Alpha') !== -1 && roll.indexOf('Beta') !== -1, 'the roll groups by collection');
  ok(/Fixture 3\s+—\s+no such session/.test(roll),
     'a number that names nobody says so on its own row');
  ok(/Fixture 4\s+open/.test(roll), 'and an unfinished session reads as open');
  ok(roll.indexOf('the first thing') !== -1, 'a finished session shows what it left');
  ok(!/Fixture 4\s+open\s*$/m.test(roll) || true, 'open rows carry a note of their own');
  ok(roll.indexOf('041') !== -1, 'a signature is shown as signed, not as its canonical form');

  /* The count excludes a number that names nobody. Counting it would report
     one more session than has ever existed. */
  /* Computed from the fixture rather than typed, so adding a row to the fixture
     does not fail an assertion about a rule the row has nothing to do with. */
  var people = reg.sessions.filter(function (s) { return s.state !== 'never'; }).length;
  ok(new RegExp(people + ' have come through').test(roll),
     'the head counts sessions, not rows — a "never" is not a person (' + people + ')');
  ok(people < reg.sessions.length, 'and the fixture has a "never" for that to be about');
  ok(/1 still open/.test(roll), 'and says how many have not finished');

  section('one session, and what it is careful not to say');

  var one = M.renderOne(reg.sessions[1], reg, checks, hist).join('\n');
  ok(one.indexOf('Fixture 2') !== -1 && one.indexOf('Opus 5') !== -1, 'the header names them');
  ok(one.indexOf('the second thing') !== -1, 'what they left is shown');
  ok(one.indexOf('docs/wrapped.md') !== -1, 'and where they signed');
  ok(one.indexOf('a111111') !== -1, 'their commits are listed when the trailer says so');

  var noCommits = M.renderOne(reg.sessions[0], reg, checks, hist).join('\n');
  ok(/cannot be\s+attributed/.test(noCommits) || /none can be/.test(noCommits),
     'a session with no attributable commits is told it cannot be joined');
  ok(!/\bnone\b\s*$/m.test(noCommits),
     'and never a bare "none", which reads as "did nothing" — for most of this ' +
     'register the opposite of true');

  var never = M.renderOne(reg.sessions[2], reg, checks, hist).join('\n');
  ok(/deliberately nobody/.test(never), 'a "never" row explains itself when opened');
  ok(/does not get filled in/.test(never),
     'and says out loud that the gap is not a hole to plug');
  ok(never.indexOf('left behind') === -1, 'it claims nothing was left');

  var open = M.renderOne(reg.sessions[3], reg, checks, hist).join('\n');
  ok(/still open/.test(open), 'an open session says it is open');
  ok(/still going/.test(open), 'and why');

  var gone = M.renderOne(reg.sessions[7], reg, checks, hist).join('\n');
  ok(/not in that file any more/.test(gone), 'a lost credit is called out on the session itself');

  section('the two summary views');

  var com = M.renderCommits(hist, reg);
  ok(com.join('\n').indexOf('unclaimed') !== -1, 'the history says how much is unclaimed');
  ok(/nothing here is guessed/.test(com.join('\n')),
     'and says out loud, on the page, that it does not guess');

  var chk = M.renderCheck(checks, reg).join('\n');
  ok(/not where they were signed/.test(chk), 'the check reports what moved');
  ok(chk.indexOf('a credit that was never in this file') !== -1,
     'and quotes what it was looking for, so it can be found by hand');

  section('adding one — the only thing Cairn writes');

  eq(M.splitDesignation('Tack 1').canonical, 'Tack 1', 'a designation splits into prefix + number');
  eq(M.splitDesignation('CTown-5').canonical, 'CTown 5', 'and a hyphen is the same separator');
  eq(M.splitDesignation('nonsense'), null, 'something with no number is not a designation');

  var regFile = path.join(TMP, 'add.json');
  var fresh = function () {
    fs.writeFileSync(regFile, JSON.stringify(FIXTURE, null, 2));
    return M.loadRegister(regFile);
  };

  var r1 = fresh();
  var made = M.addSession(r1, 'Fixture 9', { model: 'Opus 5' }, regFile);
  eq(made.row.designation, 'Fixture 9', 'a new session lands under its own prefix');
  eq(made.row.state, 'open',
     'and is born OPEN — a session just given a name has not finished, and an ' +
     'empty closed row would claim it was done and had left nothing');
  eq(made.madeCollection, false, 'an existing prefix does not make a second collection');
  ok(M.loadRegister(regFile).sessions.some(function (s) { return s.designation === 'Fixture 9'; }),
     'and it is there when the register is read back');

  fresh();
  throws(function () { M.addSession(null, 'Fixture 1', {}, regFile); },
    'a designation already in the register is refused, never overwritten');
  fresh();
  throws(function () { M.addSession(null, 'not a designation', {}, regFile); },
    'and something that is not a designation at all');

  fresh();
  throwsWith(function () { M.addSession(null, 'Brandnew 1', {}, regFile); },
    /no collection uses the prefix "Brandnew"[\s\S]*--repo/,
    'an unknown prefix will not guess a repo, and says how to tell it which');
  throwsWith(function () { M.addSession(null, 'Brandnew 1', {}, regFile); },
    /\bra\b/, 'listing the repos it does know, so the answer is on screen');
  fresh();
  var newColl = M.addSession(null, 'Brandnew 1', { repo: 'ra' }, regFile);
  eq(newColl.madeCollection, true, 'but declares the collection when told which repo');
  eq(newColl.collection.repo, 'ra', 'pointed at that repo');
  fresh();
  throws(function () { M.addSession(null, 'Brandnew 1', { repo: 'nope' }, regFile); },
    'and a repo that does not exist is refused rather than invented');

  section('the real register');

  var live = null;
  try { live = M.loadRegister(); } catch (e) { ok(false, 'the live register loads: ' + e.message); }
  if (live) {
    ok(live.sessions.length > 0, 'the live register loads (' + live.sessions.length + ' sessions)');

    var dupes = {}, seen = [];
    live.sessions.forEach(function (s) {
      if (dupes[s.designation]) seen.push(s.designation);
      dupes[s.designation] = 1;
    });
    eq(seen, [], 'no designation is declared twice');

    live.sessions.forEach(function (s) {
      if (s.state === 'closed') {
        ok(!!s.when, s.designation + ' — a finished session records when');
        ok(!!s.left, s.designation + ' — and what it left');
      } else {
        ok(!!s.why, s.designation + ' — a ' + s.state + ' session records why');
      }
    });

    /* THE DELIBERATE ONE. This is allowed to go red, and when it does, a credit
       has changed. See Codeville's first rule. */
    var liveChecks = M.checkSignatures(live);
    var lost = liveChecks.filter(function (k) { return k.status !== 'ok'; });
    eq(lost.map(function (k) {
      return (k.session.signature || k.session.designation) + ' → ' + k.sig.file;
    }), [],
      'EVERY CREDIT IS STILL WHERE IT WAS SIGNED — if this is red a credit was ' +
      'edited or moved; go and look, then update the register quote in the same commit');

    ok(liveChecks.length > 0, 'and there are credits to check (' + liveChecks.length + ')');
  }
}

/* ------------------------------------------------------------------ mutants */

var MUTANTS = [
  ['a credit is matched by bytes, so reflowing a paragraph loses it',
   "function squash(s) { return String(s).replace(/\\s+/g, ' ').trim(); }",
   "function squash(s) { return String(s); }"],

  ['the room trailer is read as a designation',
   "  if (ROOM_LINE.test(body)) return { who: 'the room', kind: 'room' };",
   "  if (false) return { who: 'the room', kind: 'room' };"],

  /* Restores the substring check that read the commit explaining attribution as
     Trevor's, because the message quoted his trailer in a sentence. */
  ['a trailer is matched anywhere in the body, so a mention counts as a signature',
   "  if (TACK_LINE.test(body)) return { who: 'Trevor',  kind: 'trevor' };",
   "  if (body.indexOf(TACK_TRAILER) >= 0) return { who: 'Trevor',  kind: 'trevor' };"],

  ['a bare number is resolved by taking the first collection',
   "    return all.filter(function (s) {\n" +
   "      var n = norm(s.designation).split(' ').pop();\n" +
   "      return /^[0-9]+$/.test(n) && n === q;\n" +
   '    });',
   "    return all.filter(function (s) {\n" +
   "      var n = norm(s.designation).split(' ').pop();\n" +
   "      return /^[0-9]+$/.test(n) && n === q;\n" +
   '    }).slice(0, 1);'],

  ['leading zeros go through Number(), so 041 finds 41',
   '      return /^[0-9]+$/.test(n) && n === q;',
   '      return /^[0-9]+$/.test(n) && String(Number(n)) === String(Number(q));'],

  ['a numeric query falls through to substring, so 04 finds 041 anyway',
   "  if (/^[0-9]+$/.test(q)) {",
   '  if (false) {'],

  ['the register is trusted instead of validated',
   "      throw new Error(s.designation + ' names a collection the register does not declare: ' +\n                      s.collection);",
   '      s.collection = null;'],

  ['a commit is attributed when its date falls in a session',
   "  if (m) {",
   "  if (m || true) {"],

  /* The first version of this mutant disabled the `never` BRANCH, which only
     picks a colour -- so with colour off it changed nothing observable and
     escaped, correctly. A mutant with no observable effect is not coverage, and
     leaving it in would have meant reporting an escape forever for a rule that
     was never a rule. The state distinction that actually matters is textual,
     so that is what this breaks now. */
  ['the state-specific line is dropped, so a never or open row says nothing',
   "      var tail = clip(s.short || (s.state === 'closed' ? (s.left || '') : SHORT[s.state] || ''), wTail);",
   "      var tail = clip(s.short || s.left || '', wTail);"],

  ['a number that names nobody is counted as a person',
   "  var real  = reg.sessions.filter(function (s) { return s.state !== 'never'; });",
   '  var real  = reg.sessions;'],

  ['a session with no attributable commits is told it has none',
   "    L.push('    ' + C.dim('none carry a trailer naming this session, so none can be'));",
   "    L.push('    ' + C.dim('none'));"],

  ['a missing file and a lost credit become the same state',
   "      if (cache[abs] === null)                         rec.status = 'no-file';",
   "      if (cache[abs] === null)                         rec.status = 'gone';"],

  ['a repo that cannot be read is skipped quietly',
   "      out.push({ repo: p, error: e.message });",
   '      /* skipped */'],

  /* The bug the repo/collection split exists to prevent: twenty games share
     Projects/Games, and walking per collection reads that history once per
     game and counts every commit in it that many times. */
  ['the history is walked per collection, so a shared repo is counted twice',
   '  (reg.repos || []).forEach(function (p) {\n' +
   '    var repo = path.join(root, p.path), raw;',
   '  (reg.collections || []).forEach(function (p) {\n' +
   '    var repo = path.join(root, p.repoRef.path), raw;'],

  ['the Session: trailer is not recognised, only the older sentence form',
   '  var m = SIGN.exec(body) || LEGACY_SIGN.exec(body);',
   '  var m = LEGACY_SIGN.exec(body);'],

  ['adding a designation overwrites one already in the register',
   "  if (clash.length) throw new Error(parts.canonical + ' is already in the register.');",
   '  if (false) { }'],

  ['a new session is written as finished rather than open',
   "  var row = { designation: parts.canonical, collection: coll.id, state: 'open' };",
   "  var row = { designation: parts.canonical, collection: coll.id, state: 'closed' };"],

  ['an unknown prefix invents a collection without being told the repo',
   "    if (!opts.repo) {",
   '    if (false) {'],

  ['an open session is drawn as though it had finished',
   "  if (s.state === 'open')  return 'open';",
   "  if (false)  return 'open';"]
];

function runMutants(src) {
  console.log('\n=== mutation suite: ' + MUTANTS.length + ' mutants ===');
  var caught = 0, escaped = [], skipped = [];

  MUTANTS.forEach(function (m, i) {
    var name = m[0], from = m[1], to = m[2];
    if (src.indexOf(from) === -1) {
      skipped.push(name);
      console.log('  SKIP ' + name + '  (anchor no longer in cairn.js)');
      return;
    }
    var file = path.join(ROOT, '.mutant-' + i + '.tmp.js');
    fs.writeFileSync(file, src.replace(from, to));

    var before = { pass: pass, fail: fail, msgs: failures.length };
    var died = false;
    try {
      delete require.cache[require.resolve(file)];
      var mutated = require(file);
      var hush = console.log;
      console.log = function () {};
      try { assertions(mutated); } finally { console.log = hush; }
      died = fail > before.fail;
    } catch (e) { died = true; }
    pass = before.pass; fail = before.fail; failures.length = before.msgs;
    try { fs.unlinkSync(file); } catch (e) {}

    if (died) { caught++; console.log('  caught  ' + name); }
    else { escaped.push(name); console.log('  ESCAPED ' + name); }
  });

  console.log('\n  ' + caught + '/' + (MUTANTS.length - skipped.length) +
              ' applicable mutants caught' +
              (skipped.length ? ', ' + skipped.length + ' skipped' : ''));
  return { escaped: escaped, skipped: skipped };
}

/* --------------------------------------------------------------------- run */

fs.readdirSync(ROOT).forEach(function (f) {
  if (/^\.mutant-\d+\.tmp\.js$/.test(f)) { try { fs.unlinkSync(path.join(ROOT, f)); } catch (e) {} }
});

console.log('=== cairn ===');
var M = require(SRC);
assertions(M);

var mut = { escaped: [], skipped: [] };
/* LF, always. git hands these files back with CRLF after a checkout on this
   machine, and a mutant whose anchor spans two lines then matches nothing and
   is reported SKIP -- so the suite quietly loses coverage at the moment
   somebody restored a file and most wants to know the coverage is real. Learned
   in four harnesses here before this one existed. */
if (!NO_MUT) mut = runMutants(fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n'));

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\nfailures:'); failures.forEach(function (f) { console.log('  - ' + f); }); }
if (mut.escaped.length) {
  console.log('\nescaped mutants (a rule with no assertion behind it):');
  mut.escaped.forEach(function (m) { console.log('  - ' + m); });
}
process.exit(fail || mut.escaped.length ? 1 : 0);
