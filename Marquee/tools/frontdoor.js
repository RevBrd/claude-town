#!/usr/bin/env node
// ============================================================================
// frontdoor.js — does `marquee <name>` open the right thing?
//
//   node tools/frontdoor.js            assertions + mutation suite
//   node tools/frontdoor.js --no-mut   assertions only
//
// Separate from selftest.js on purpose: that one asks whether derive.js tells
// the truth about the building, this one asks whether the front door opens the
// thing you named. Different subject, different fixture shape.
//
// It follows selftest.js's rule about WHERE to assert, which is the important
// one. Matching is pure, so it is tested against a SYNTHETIC list of works --
// asserting that "dead space" opens Dead Space would encode a fact about a game
// somebody may rename tomorrow, and a suite that cries wolf gets deleted.
//
// The live tree is asserted against only for things that are true of the
// DERIVATION rather than of any particular work: that an openable work resolves
// to a file that exists, that no resolved path is still percent-encoded, and
// that no path repeats a folder. Each of those is a bug this file was written
// after finding.
//
// CTown 6 (Opus 5), 24 Aug 2026.
// ============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC  = path.join(ROOT, 'marquee.js');

const QUIET  = process.argv.indexOf('--quiet')  !== -1;
const NO_MUT = process.argv.indexOf('--no-mut') !== -1;

let pass = 0, fail = 0;
const failures = [];

function ok(cond, what) {
  if (cond) { pass++; if (!QUIET) console.log('  ok   ' + what); }
  else      { fail++; failures.push(what); console.log('  FAIL ' + what); }
}
function eq(a, b, what) {
  const good = JSON.stringify(a) === JSON.stringify(b);
  ok(good, what + (good ? '' : '   got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)));
}
function section(s) { if (!QUIET) console.log('\n' + s); }

// ---------------------------------------------------------------------------
// The fixture. Every entry is a HAZARD, named after the hazard it reproduces.
// ---------------------------------------------------------------------------

const WORKS = [
  // two names sharing a prefix — the reason guessing is forbidden
  { display: 'Dead Space',      folder: 'Dead Space',      title: 'DEAD SPACE — Block Party', wing: 'games', entryStatus: 'ok', file: 'X/dead.html' },
  { display: 'Dead Reckoning',  folder: 'Dead Reckoning',  title: 'DEAD RECKONING — Flight Sandbox', wing: 'games', entryStatus: 'ok', file: 'X/dr.html' },
  // three works whose names genuinely share a word
  { display: 'Gravity Sandbox', folder: 'Gravity Sandbox', title: 'Gravity Sandbox', wing: 'space', entryStatus: 'ok', file: 'X/g.html' },
  { display: 'Orbital Sandbox', folder: 'Orbital Sandbox', title: 'Orbital Sandbox', wing: 'space', entryStatus: 'ok', file: 'X/o.html' },
  // a work whose <title> says "Sandbox" but whose NAME does not
  { display: 'Combat Circuit',  folder: 'Combat Circuit',  title: 'COMBAT CIRCUIT — Sandbox', wing: 'games', entryStatus: 'ok', file: 'X/cc.html' },
  // punctuation nobody types
  { display: 'Ultra Pong!!!!',  folder: 'Ultra Pong!!!!',  title: 'ULTRA PONG', wing: 'games', entryStatus: 'ok', file: 'X/up.html' },
  // a ligature nobody can type
  { display: 'Æthermoor',       folder: 'Aethermoor',      title: 'ÆTHERMOOR', wing: 'games', entryStatus: 'ok', file: 'X/ae.html' },
  // display and folder disagree — both must answer
  { display: 'Blocks IG',       folder: 'Blocks IG',       title: 'BLOCKS, I GUESS', wing: 'games', entryStatus: 'ok', file: 'X/b.html' },
  // exists, catalogued, and cannot be opened
  { display: 'Salient',         folder: 'Salient',         title: null, wing: 'games', entryStatus: 'no-build', file: null },
  // two candidate builds and no declaration — the worst case to guess at
  { display: 'Twofold',         folder: 'Twofold',         title: null, wing: 'games', entryStatus: 'ambiguous', file: null, candidates: ['a.html', 'b.html'] }
];

// ---------------------------------------------------------------------------

function assertions(M) {

  section('names are normalised the way people type them');

  eq(M.norm('Ultra Pong!!!!'), 'ultra pong', 'punctuation falls away');
  eq(M.norm('Æthermoor'), 'aethermoor', 'a ligature nobody can type is spelled out');
  eq(M.norm('  Dead   Space  '), 'dead space', 'spacing is collapsed');
  eq(M.norm('GemTD'), 'gemtd', 'case is flattened');
  eq(M.norm(null), '', 'nothing normalises to nothing');
  eq(M.squash('Ultra Pong!!!!'), 'ultrapong', 'squashed drops the spaces too');
  eq(M.initials('Gravity Sandbox'), 'gs', 'initials are the first letters');

  section('an exact name wins outright');

  let r = M.match('dead space', WORKS);
  eq(r.hits.length, 1, 'a full name matches one thing');
  eq(r.hits[0].display, 'Dead Space', 'and it is the right one');
  eq(r.tier, 'exact', 'reported as exact');

  eq(M.match('ULTRA PONG', WORKS).hits.length, 1, 'case does not matter');
  eq(M.match('ultra pong!!!!', WORKS).hits.length, 1, 'nor does typing the punctuation');
  eq(M.match('aethermoor', WORKS).hits[0].display, 'Æthermoor',
     'a ligature is reachable from the keyboard');

  section('ambiguity is reported, never guessed');

  // The rule this whole file exists to protect. Opening the wrong game is the
  // worst failure available, because it looks exactly like it worked.
  const dead = M.match('dead', WORKS);
  eq(dead.hits.length, 2, '"dead" matches two games');
  eq(dead.hits.map(h => h.display).sort(), ['Dead Reckoning', 'Dead Space'],
     'and names both rather than picking one');

  const sandbox = M.match('sandbox', WORKS);
  eq(sandbox.hits.map(h => h.display).sort(), ['Gravity Sandbox', 'Orbital Sandbox'],
     '"sandbox" matches the two things actually called Sandbox');
  ok(!sandbox.hits.some(h => h.display === 'Combat Circuit'),
     'and NOT the one that merely says so in its <title>');

  section('a <title> widens a miss, it never muddies a hit');

  // Titles are prose. Searched at the same rank as names they turn a clean
  // three-way match into a noisy five-way one; searched only after the names
  // find nothing they are pure gain.
  const block = M.match('block party', WORKS);
  eq(block.hits.length, 1, 'a phrase only in a <title> still finds its work');
  eq(block.hits[0].display, 'Dead Space', 'and the right one');
  ok(/^title/.test(block.tier), 'and says it matched on the title');

  const guess = M.match('i guess', WORKS);
  eq(guess.hits.length, 1, 'another title-only phrase resolves');
  eq(guess.hits[0].display, 'Blocks IG', 'to the work whose page says it');

  ok(!/^title/.test(M.match('dead space', WORKS).tier),
     'but a name match never reports as a title match');

  section('a partial name is enough');

  eq(M.match('gravity', WORKS).hits.length, 1, 'a prefix of one name resolves');
  eq(M.match('blocks', WORKS).hits[0].display, 'Blocks IG', 'and picks the right work');
  eq(M.match('ultrapong', WORKS).hits[0].display, 'Ultra Pong!!!!',
     'a name typed without its space still lands');

  section('nothing matched is said plainly');

  const miss = M.match('there is no game called this', WORKS);
  eq(miss.hits.length, 0, 'a miss returns nothing');
  eq(miss.tier, null, 'with no tier');
  eq(M.match('', WORKS).hits.length, 0, 'an empty query matches nothing at all');
  eq(M.match('   ', WORKS).hits.length, 0, 'and so does whitespace');

  section('a work that cannot be opened is found, then explained');

  const sal = M.match('salient', WORKS);
  eq(sal.hits.length, 1, 'a work with no build is still findable');
  eq(sal.hits[0].entryStatus, 'no-build', 'and carries why it cannot open');
  eq(M.match('twofold', WORKS).hits[0].entryStatus, 'ambiguous',
     'so does one with two undeclared candidates');

  section('the building itself is openable');

  const b = M.builtins();
  ok(b.length >= 1, 'there is at least one built-in target');
  ok(b.some(x => x.display === 'Marquee'), 'Marquee is one of them');
  ok(b.every(x => x.file && fs.existsSync(x.file)), 'and its file exists');
  eq(M.match('marquee', b).hits.length, 1, 'and it answers to its name');

  section('the real building');

  // Only invariants of the DERIVATION are asserted here, never facts about a
  // particular work. Each of these three is a bug that actually happened.
  let v = null;
  try { v = M.works(); } catch (e) { ok(false, 'the live venue derives: ' + e.message); }

  if (v) {
    ok(v.works.length > 1, 'the live venue derives (' + v.works.length + ' targets)');

    const openable = v.works.filter(w => w.entryStatus === 'ok');
    ok(openable.length > 0, 'and some of them are openable (' + openable.length + ')');

    const missing = openable.filter(w => !w.file || !fs.existsSync(w.file));
    eq(missing.map(w => w.display), [],
       'every openable work resolves to a file that exists');

    // `url` is percent-encoded for the browser. Half this tree has a space in
    // its path, and `%20` in a filesystem path opens nothing.
    const encoded = v.works.filter(w => w.file && /%[0-9a-f]{2}/i.test(w.file));
    eq(encoded.map(w => w.display), [], 'no resolved path is still percent-encoded');

    // The Pet is a resident whose root is relative AND whose folder repeats the
    // last segment of that root. Rebuilding a path from root + folder + entry
    // produced `.claude/Pet/Pet/pet.html`, which looked plausible in a listing.
    const doubled = v.works.filter(w => {
      if (!w.file) return false;
      const seg = w.file.split(/[\\/]/).filter(Boolean);
      return seg.some((s, i) => i > 0 && s === seg[i - 1]);
    });
    eq(doubled.map(w => w.display), [], 'no resolved path repeats a folder name');

    const relative = v.works.filter(w => w.file && !path.isAbsolute(w.file));
    eq(relative.map(w => w.display), [], 'every resolved path is absolute');
  }

  section('what it prints');

  if (v) {
    M.C.on = false;
    const list = M.renderList(v.works).join('\n');
    ok(list.indexOf('now playing') !== -1, 'the listing says what it is');
    ok(list.indexOf('Planetarium') !== -1, 'and groups by room');

    const hits = M.renderHits('dead', { tier: 'prefix', hits: WORKS.slice(0, 2) }).join('\n');
    ok(hits.indexOf('Dead Space') !== -1 && hits.indexOf('Dead Reckoning') !== -1,
       'an ambiguous result lists every candidate');
    ok(/does not guess/.test(hits), 'and says out loud that it will not choose');

    const none = M.renderHits('zzz', { tier: null, hits: [] }).join('\n');
    ok(/nothing here is called/.test(none), 'a miss says so');
  }
}

// ---------------------------------------------------------------------------
// Mutants. Each breaks one rule this file exists to protect.
// ---------------------------------------------------------------------------

const MUTANTS = [
  ['ambiguity is resolved by taking the first hit',
   '    if (hits.length) return { tier: name, hits: hits };',
   '    if (hits.length) return { tier: name, hits: hits.slice(0, 1) };'],

  ['titles are searched at the same rank as names',
   'function namesOf(e) {\n  return [e.display, e.folder].filter(function (s) { return s && String(s).trim(); });\n}',
   'function namesOf(e) {\n  return [e.display, e.folder, e.title].filter(function (s) { return s && String(s).trim(); });\n}'],

  ['the title pass is dropped, so a page title finds nothing',
   '  var byTitle = matchAgainst(q, works, titleOf);',
   '  var byTitle = null;'],

  ['prefix is tried before exact',
   "  ['exact',     function (q, n) { return norm(n) === q; }],\n  ['prefix',    function (q, n) { return norm(n).indexOf(q) === 0; }],",
   "  ['prefix',    function (q, n) { return norm(n).indexOf(q) === 0; }],\n  ['exact',     function (q, n) { return norm(n) === q; }],"],

  ['punctuation is no longer stripped from a name',
   "        .replace(/[^a-z0-9]+/g, ' ').trim()",
   "        .trim()"],

  ['the percent-encoded url is used without decoding',
   '      file: e.url ? path.resolve(HERE, D.decodeTarget(e.url)) : null',
   '      file: e.url ? path.resolve(HERE, e.url) : null'],

  ['paths are rebuilt from the wing root instead of the tested url',
   '      file: e.url ? path.resolve(HERE, D.decodeTarget(e.url)) : null',
   '      file: e.entry ? path.join(HERE, e.folder || "", e.entry) : null'],

  ['an empty query matches everything',
   '  if (!q) return { tier: null, hits: [] };',
   '  if (!q) return { tier: null, hits: works };'],

  ['the building itself stops being openable',
   '  return [{',
   '  return [].concat([{'.replace('[].concat([{', '[].slice(0,0).concat([{')]
];

function runMutants(src) {
  console.log('\n=== mutation suite: ' + MUTANTS.length + ' mutants ===');
  let caught = 0;
  const escaped = [], skipped = [];

  MUTANTS.forEach(([name, from, to], i) => {
    if (src.indexOf(from) === -1) {
      skipped.push(name);
      console.log('  SKIP ' + name + '  (anchor no longer in marquee.js)');
      return;
    }
    const file = path.join(ROOT, '.mutant-fd-' + i + '.tmp.js');
    fs.writeFileSync(file, src.replace(from, to));

    const before = { pass, fail, msgs: failures.length };
    let died = false;
    try {
      delete require.cache[require.resolve(file)];
      const mutated = require(file);
      const hush = console.log;
      console.log = () => {};
      try { assertions(mutated); } finally { console.log = hush; }
      died = fail > before.fail;
    } catch (e) {
      died = true;
    }
    pass = before.pass; fail = before.fail; failures.length = before.msgs;
    try { fs.unlinkSync(file); } catch (e) {}

    if (died) { caught++; console.log('  caught  ' + name); }
    else { escaped.push(name); console.log('  ESCAPED ' + name); }
  });

  console.log('\n  ' + caught + '/' + (MUTANTS.length - skipped.length) +
              ' applicable mutants caught' +
              (skipped.length ? ', ' + skipped.length + ' skipped' : ''));
  return { escaped, skipped };
}

// ---------------------------------------------------------------------------

fs.readdirSync(ROOT).forEach(f => {
  if (/^\.mutant-fd-\d+\.tmp\.js$/.test(f)) {
    try { fs.unlinkSync(path.join(ROOT, f)); } catch (e) {}
  }
});

console.log('=== marquee front door ===');
const M = require(SRC);
M.C.on = false;
assertions(M);

let mut = { escaped: [], skipped: [] };
// LF, always. git's core.autocrlf hands this file back with CRLF after any
// checkout on Windows, and a mutant whose anchor spans two lines then matches
// nothing and is reported SKIP -- so the suite quietly loses coverage at the
// moment somebody restores a file, which is exactly when they want it.
// Attested here: a `git checkout` of marquee.js dropped 9 mutants to 7.
if (!NO_MUT) mut = runMutants(fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n'));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\nfailures:'); failures.forEach(f => console.log('  - ' + f)); }
if (mut.escaped.length) {
  console.log('\nescaped mutants (a rule with no assertion behind it):');
  mut.escaped.forEach(m => console.log('  - ' + m));
}
process.exit(fail || mut.escaped.length ? 1 : 0);
