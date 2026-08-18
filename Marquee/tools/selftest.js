#!/usr/bin/env node
// ============================================================================
// selftest.js — does derive.js still tell the truth?
//
//   node tools/selftest.js              assertions + mutation suite
//   node tools/selftest.js --keep       leave the fixture tree on disk to poke
//
// TWO HALVES, AND BOTH ARE NECESSARY.
//
// 1. ASSERTIONS against a SYNTHETIC fixture tree, not against Projects/Games.
//    Testing against the live collection was the first design and it was
//    wrong: every assertion would encode a fact about a game somebody is
//    actively editing, so the suite would go red every time a game shipped —
//    and a suite that cries wolf gets deleted. The fixture reproduces each
//    HAZARD instead, and hazards do not change when a game does. The live
//    tree is still scanned, but only to report, never to assert.
//
// 2. A MUTATION SUITE. `~/.claude/reference/building.md` is blunt about this:
//    a harness that has never failed is not evidence of anything. So each of
//    derive.js's real rules gets deliberately broken on a scratch copy, and
//    the suite has to notice. If a mutant survives, the assertion covering
//    that rule is decorative and this file says so out loud.
//
//    That is not paranoia. Writing this suite is how the authored-defect grep
//    was caught — it passed every assertion, because there was no assertion
//    that could tell "flagged correctly" from "flagged everything".
//
// CTown-4 (Opus 5), 17 Aug 2026.
// ============================================================================

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const DERIVE_SRC = path.join(__dirname, 'derive.js');

// ---------------------------------------------------------------------------
// The fixture. One folder per hazard, each named after the hazard so a failure
// message says what broke rather than which game broke.
// ---------------------------------------------------------------------------
function buildFixture(root) {
  const NL = String.fromCharCode(10);
  const html = (title) => `<!doctype html>\n<html><head><title>${title}</title></head>\n<body>x</body></html>\n`;
  const mk = (rel, body) => {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  };

  // The catalog. Deliberately includes: an encoded link target, a display name
  // that differs from its folder, and a row for a folder that does not exist.
  mk('CLAUDE.md', [
    '# Fixture',
    '',
    'Prose before the table, containing a | pipe, to prove the parser ignores it.',
    '',
    '| Game | Premise | State |',
    '|---|---|---|',
    '| [Solo](Solo/) | one file | fine |',
    '| [Decoyed](Decoyed/) | two files, one declared | fine |',
    '| [Ambiguous](Ambiguous/) | two files, undeclared | unresolved |',
    '| [BadDecl](BadDecl/) | declares a file that is not there | broken |',
    '| [Concept](Concept/) | no build | concept only |',
    '| [Nested](Nested/) | history in a subfolder | fine |',
    '| [Two Words](Two%20Words/) | encoded link target | fine |',
    '| [Rénamed](Renamed/) | display name differs from folder | fine |',
    '| [Ghost](Ghost/) | catalogued, never existed | missing |',
    '| [Sincere](Sincere/) | declares no authored defects | fine |',
    '| [Parody](Parody/) | declares authored defects | fine |',
    '',
    'Trailing prose.',
  ].join('\n'));

  mk('Solo/solo.html', html('SOLO'));
  mk('Solo/CLAUDE.md', '# Solo\n');

  // The Snek hazard: the decoy sorts FIRST and is not the game.
  mk('Decoyed/aaa-decoy.html', html('DECOY — do not launch'));
  mk('Decoyed/real.html', html('THE REAL ONE'));
  mk('Decoyed/CLAUDE.md', '# Decoyed\n\n<!-- marquee: play=real.html -->\n');

  mk('Ambiguous/one.html', html('ONE'));
  mk('Ambiguous/two.html', html('TWO'));
  mk('Ambiguous/CLAUDE.md', '# Ambiguous\n');

  mk('BadDecl/present.html', html('PRESENT'));
  mk('BadDecl/CLAUDE.md', '# BadDecl\n\n<!-- marquee: play=absent.html -->\n');

  mk('Concept/notes.jsx', 'export default function () {}\n');
  mk('Concept/CLAUDE.md', '# Concept\n');

  // The GemTD hazard: six playable-looking builds one level down.
  mk('Nested/main.html', html('MAIN'));
  mk('Nested/Old Versions/v1.html', html('V1'));
  mk('Nested/backups/v0.html', html('V0'));
  mk('Nested/CLAUDE.md', '# Nested\n');

  mk('Two Words/game.html', html('TWO WORDS'));
  mk('Renamed/game.html', html('RENAMED'));

  // On disk, absent from the catalog.
  mk('Strays/stray.html', html('STRAY'));

  // Two ways of saying it, plus the trap: prose that mentions authored defects
  // while denying them. The grep this replaced read that as a yes.
  mk('Sincere/game.html', html('SINCERE'));
  mk('Sincere/CLAUDE.md',
     '# Sincere\n\n**There are no authored defects in this game.** Every bug is a real bug.\n\n' +
     '<!-- marquee: defects=none -->\n');

  mk('Parody/game.html', html('PARODY'));
  mk('Parody/CLAUDE.md', '# Parody\n\nRegister of authored defects below.\n\n<!-- marquee: defects=authored -->\n');

  // Both keys, one comment.
  mk('Combined/a.html', html('A'));
  mk('Combined/b.html', html('B'));
  mk('Combined/CLAUDE.md', '# Combined\n\n<!-- marquee: play=b.html defects=authored -->\n');

  // Two markers in ONE doc, far apart: the entry-point declaration beside the
  // prose explaining it, the editorial one at the bottom. Reading only the
  // first was a real bug, found while adding billing.
  mk('TwoMarkers/game.html', html('TWO MARKERS'));
  mk('TwoMarkers/CLAUDE.md',
     '# TwoMarkers' + NL + NL + '<!-- marquee: play=game.html -->' + NL +
     NL + 'A paragraph of prose in between.' + NL + NL +
     '<!-- marquee: billing=feature -->' + NL);

  mk('Preview/game.html', html('PREVIEW'));
  mk('Preview/CLAUDE.md', '# Preview' + NL + NL + '<!-- marquee: billing=preview -->' + NL);

  mk('Commas/game.html', html('COMMAS'));
  mk('Commas/CLAUDE.md', '# Commas' + NL + NL + '<!-- marquee: billing=preview, defects=authored -->' + NL);

  // No folder for Ghost/ — that is the point of Ghost.
}

// ---------------------------------------------------------------------------
// Assertions. Each returns nothing and throws on failure; the runner collects.
// ---------------------------------------------------------------------------
function assertions(derive, root) {
  const m = derive.derive({ gamesRoot: root });
  const by = (f) => m.games.find(g => g.folder === f);
  const T = [];
  const is = (name, actual, expected) => T.push({
    name,
    pass: JSON.stringify(actual) === JSON.stringify(expected),
    actual, expected,
  });

  // --- entry-point resolution -------------------------------------------
  is('single html resolves',              by('Solo').entry, 'solo.html');
  is('single html status ok',             by('Solo').entryStatus, 'ok');

  is('declaration beats the decoy',       by('Decoyed').entry, 'real.html');
  is('decoy was seen as a candidate',     by('Decoyed').candidates, ['aaa-decoy.html', 'real.html']);
  is('declaration recorded',              by('Decoyed').declared, 'real.html');

  is('two undeclared do not resolve',     by('Ambiguous').entry, null);
  is('two undeclared are ambiguous',      by('Ambiguous').entryStatus, 'ambiguous');
  is('ambiguous lists its candidates',    by('Ambiguous').candidates, ['one.html', 'two.html']);

  is('declaration to nowhere is caught',  by('BadDecl').entryStatus, 'declared-missing');
  is('declaration to nowhere has no entry', by('BadDecl').entry, null);

  is('no html is no-build',               by('Concept').entryStatus, 'no-build');
  is('no html counts other files',        by('Concept').otherFiles, 1);

  is('subfolder html is not a candidate', by('Nested').candidates, ['main.html']);
  is('subfolder html does not resolve',   by('Nested').entry, 'main.html');

  // --- the catalog join ---------------------------------------------------
  is('encoded link target decodes',       by('Two Words').catalogStatus, 'listed');
  is('display name comes from catalog',   by('Renamed').display, 'Rénamed');
  is('folder comes from link target',     by('Renamed').folder, 'Renamed');
  is('uncatalogued folder still appears', by('Strays') ? by('Strays').catalogStatus : 'ABSENT', 'uncatalogued');
  is('uncatalogued folder still resolves', by('Strays') ? by('Strays').entry : null, 'stray.html');
  is('catalogued-but-absent is reported', m.missingFolders.map(r => r.folder), ['Ghost']);
  is('premise is carried through',        by('Solo').premise, 'one file');

  // Direct test of the table parser rather than a count of the final join —
  // the fixture's CLAUDE.md wraps its table in prose containing a | pipe, and
  // a parser that tracked table state instead of matching links would swallow
  // those lines as rows.
  const cat = derive.parseCatalog(path.join(root, 'CLAUDE.md'));
  is('only linked rows are parsed',       cat.rows.length, 11);
  is('prose pipes produce no anomalies',  cat.anomalies, []);

  // --- authored defects: three states, and unknown is not false -----------
  is('declared authored is true',         by('Parody').authoredDefects, true);
  is('declared none is false',            by('Sincere').authoredDefects, false);
  is('undeclared is null, not false',     by('Solo').authoredDefects, null);
  is('denial prose is not read as a yes', by('Sincere').authoredDefects, false);

  // --- two keys in one comment -------------------------------------------
  is('combined declaration: play',        by('Combined').entry, 'b.html');
  is('combined declaration: defects',     by('Combined').authoredDefects, true);

  // --- more than one marker per doc ---------------------------------------
  is('first marker is honoured',        by('TwoMarkers').entry, 'game.html');
  is('second marker is honoured too',   by('TwoMarkers').billing, 'feature');
  is('billing preview reads back',      by('Preview').billing, 'preview');
  is('comma-separated keys split',      by('Commas').billing, 'preview');
  is('comma-separated second key',      by('Commas').authoredDefects, true);
  is('undeclared billing is null',      by('Solo').billing, null);

  // --- incidental ---------------------------------------------------------
  is('title is pulled from the entry',    by('Decoyed').title, 'THE REAL ONE');
  is('doc presence is reported',          by('Renamed').hasDoc, false);
  is('no anomalies on a clean fixture',   m.anomalies, []);

  return T;
}

// ---------------------------------------------------------------------------
// Mutation suite. Each entry breaks exactly one rule in derive.js's source and
// names the assertion that must go red. `expect` is matched against the names
// of the assertions that failed.
// ---------------------------------------------------------------------------
const MUTANTS = [
  {
    name: 'M1  ambiguity resolved by guessing (take the first candidate)',
    find: "return { entry: null, entryStatus: 'ambiguous', declared: null };",
    repl: "return { entry: candidates[0], entryStatus: 'ok', declared: null };",
    expect: 'two undeclared do not resolve',
  },
  {
    name: 'M2  declaration ignored, falls through to the scan',
    find: '  if (declaration.play) {',
    repl: '  if (false) {',
    expect: 'declaration beats the decoy',
  },
  {
    name: 'M3  declared-but-missing file trusted anyway',
    find: '      entry: exists ? declaration.play : null,',
    repl: '      entry: declaration.play,',
    expect: 'declaration to nowhere has no entry',
  },
  {
    name: 'M4  entry scan recurses one level into subfolders',
    find: '  return entries\n    .filter(d => d.isFile() && isHtml(d.name))\n    .map(d => d.name)',
    repl: '  const deep = [];\n' +
          '  for (const d of entries) if (d.isDirectory()) {\n' +
          '    try { for (const f of fs.readdirSync(path.join(gameDir, d.name))) if (isHtml(f)) deep.push(f); } catch {}\n' +
          '  }\n' +
          '  return entries\n    .filter(d => d.isFile() && isHtml(d.name))\n    .map(d => d.name).concat(deep)',
    expect: 'subfolder html is not a candidate',
  },
  {
    name: 'M5  link target not decoded',
    find: '  try { return decodeURIComponent(s); } catch { return s; }',
    repl: '  return s;',
    expect: 'encoded link target decodes',
  },
  {
    name: 'M6  catalogued-but-absent rows dropped',
    find: '    .filter(r => !seen.has(r.folder))',
    repl: '    .filter(() => false)',
    expect: 'catalogued-but-absent is reported',
  },
  {
    name: 'M7  uncatalogued folders hidden',
    find: '    const row = byFolder.get(folder) || null;',
    repl: '    const row = byFolder.get(folder) || null;\n    if (!row) continue;',
    expect: 'uncatalogued folder still appears',
  },
  {
    name: 'M8  unknown defect status collapsed to false',
    find: '                     : null,',
    repl: '                     : false,',
    expect: 'undeclared is null, not false',
  },
  {
    name: 'M9  display name taken from the folder, not the catalog',
    find: '      display: row ? row.display : folder,',
    repl: '      display: folder,',
    expect: 'display name comes from catalog',
  },
  {
    name: 'M10 only the first marker in a doc is read',
    find: '  for (const m of docText.matchAll(TUNE.DECLARATION)) {',
    repl: '  for (const m of [...docText.matchAll(TUNE.DECLARATION)].slice(0, 1)) {',
    expect: 'second marker is honoured too',
  },
  {
    name: 'M11 billing=preview silently dropped',
    find: "             : declaration.billing === 'preview' ? 'preview'",
    repl: "             : false ? 'preview'",
    expect: 'billing preview reads back',
  },
];

function runMutant(mutant, root, tmpDir) {
  const src = fs.readFileSync(DERIVE_SRC, 'utf8');
  if (!src.includes(mutant.find)) {
    return { applied: false, note: 'anchor text not found — derive.js changed, update the mutant' };
  }
  const mutated = src.replace(mutant.find, mutant.repl);
  const p = path.join(tmpDir, 'mutant-' + mutant.name.split(/\s+/)[0] + '.js');
  fs.writeFileSync(p, mutated);
  let failedNames = [];
  try {
    delete require.cache[require.resolve(p)];
    const mod = require(p);
    failedNames = assertions(mod, root).filter(t => !t.pass).map(t => t.name);
  } catch (e) {
    // A mutant that throws is still caught — that is a red suite.
    failedNames = ['<threw: ' + e.message.split('\n')[0] + '>'];
  }
  return { applied: true, failedNames };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marquee-selftest-'));
  const root = path.join(tmpDir, 'fixture');
  buildFixture(root);

  const derive = require(DERIVE_SRC);
  const results = assertions(derive, root);
  const failed = results.filter(t => !t.pass);

  console.log('FIXTURE ASSERTIONS');
  for (const t of results) {
    if (t.pass) console.log('  ok    ' + t.name);
    else console.log('  FAIL  ' + t.name +
                     '\n          expected ' + JSON.stringify(t.expected) +
                     '\n          actual   ' + JSON.stringify(t.actual));
  }
  console.log(`  ${results.length - failed.length}/${results.length} passed`);

  console.log('\nMUTATION SUITE  — each mutant must make its named assertion go red');
  let escaped = 0, unapplied = 0;
  for (const mut of MUTANTS) {
    const r = runMutant(mut, root, tmpDir);
    if (!r.applied) {
      console.log('  SKIP  ' + mut.name + '\n          ' + r.note);
      unapplied++;
      continue;
    }
    const caught = r.failedNames.includes(mut.expect) ||
                   r.failedNames.some(n => n.startsWith('<threw'));
    if (caught) {
      console.log('  ok    ' + mut.name + `  (caught, ${r.failedNames.length} assertion(s) red)`);
    } else {
      console.log('  ESCAPED  ' + mut.name +
                  '\n          expected "' + mut.expect + '" to fail; red were: ' +
                  (r.failedNames.length ? r.failedNames.join(', ') : 'NOTHING'));
      escaped++;
    }
  }

  if (process.argv.includes('--keep')) console.log('\nfixture kept at ' + root);
  else fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log('');
  if (failed.length) console.log(`${failed.length} assertion(s) failed.`);
  if (escaped)  console.log(`${escaped} mutant(s) escaped — the rule they break is not actually covered.`);
  if (unapplied) console.log(`${unapplied} mutant(s) could not be applied.`);
  if (!failed.length && !escaped && !unapplied) console.log('All green, and the suite is known to be able to go red.');

  process.exit(failed.length || escaped || unapplied ? 1 : 0);
}

if (require.main === module) main();
