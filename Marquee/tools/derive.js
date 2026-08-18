#!/usr/bin/env node
// ============================================================================
// derive.js — Marquee's catalog, pulled rather than kept.
//
//   node tools/derive.js                      human-readable report
//   node tools/derive.js --json               the manifest, to stdout
//   node tools/derive.js --write              write manifest.json + manifest.js
//   node tools/derive.js --games <path>       point at a different tree
//   node tools/derive.js --strict             exit non-zero on any drift
//
// WHY THIS EXISTS
// Marquee is a front door to Projects/Games. The obvious way to build one is
// to keep a list of games. That was rejected on sight: Games/CLAUDE.md already
// documents that its catalog table drifts, and that a row was silently lost
// once because a session wrote the whole file from a stale copy. A second list
// in a second format would drift the same way, faster, and nobody would notice
// because nobody reads a launcher's config.
//
// So Marquee holds no list. It derives one, every time, from two sources that
// already exist and are already maintained:
//
//   1. THE FILESYSTEM — ground truth for what exists.
//   2. THE CATALOG TABLE in Games/CLAUDE.md — ground truth for what it *is*
//      (display name, premise, state), already written per-row by whichever
//      session built the game.
//
// Neither is sufficient alone, and that is not a theoretical point. Measured
// against the live tree on 17 Aug 2026:
//
//   - Snek/ holds snek.html (47 KB) and snake.html (10 KB). snake.html is not
//     a backup; it is a DIFFERENT GAME, titled "SERPENT // 8K", left over from
//     before the ballpoint-pen reskin. A filesystem scan offers it as Snek.
//   - Asterism/ holds three, and the one named index.html is a 6.8 KB landing
//     page. "Prefer index.html", the obvious tiebreaker, picks wrong.
//   - Benthos/ and Volley/ have real builds on disk and no catalog row at all.
//
// Hence the two rules this file is built around:
//
//   AMBIGUITY IS NEVER RESOLVED BY GUESSING. Two or more candidates and no
//   declaration is a reported state, not a coin flip. Launching a discarded
//   predecessor as if it were the game is the worst failure available here,
//   because it looks like it worked.
//
//   DISAGREEMENT BETWEEN THE SOURCES IS OUTPUT, NOT ERROR. A folder with no
//   catalog row still appears, flagged. A catalog row with no folder appears
//   too. The join is the point: Marquee cannot drift, because it keeps
//   nothing — and it reports the drift in the list that can.
//
// The declaration (rule 3 below) is an HTML comment in a game's own CLAUDE.md,
// which every game is already required to have. Three games need one today.
// No new file type, no new convention to remember.
//
// CTown-4 (Opus 5), 17 Aug 2026.
// ============================================================================

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Tunables. Kept together and named so they can be adjusted without reading
// the rest of the file.
// ---------------------------------------------------------------------------
const TUNE = {
  // (There is deliberately no ignore-list of subdirectory names here. The rule
  // is simpler and stronger than a blocklist: entry candidates are TOP LEVEL
  // ONLY. A list of names to skip would imply a recursive scan that has to be
  // kept correct forever — miss one folder name and GemTD/Old Versions/ offers
  // six playable-looking builds, none of which is the game. Depth is where
  // history lives, in every folder in this collection, without exception.)

  // How much of an HTML file to read when pulling its <title>. The tag is in
  // <head>, and some of these files are 55 MB.
  TITLE_SNIFF_BYTES: 8192,

  // The declaration marker, e.g.  <!-- marquee: play=snek.html -->
  DECLARATION: /<!--\s*marquee:\s*([^>]*?)\s*-->/i,

  // NOTE — there is deliberately no heuristic here for "does this game have
  // authored defects". The first version of this file grepped each game's
  // CLAUDE.md for /authored defect/i, and against the live tree that flagged
  // 13 of 18 games. It was reading lines like Oblique's "**There are no
  // authored defects**" and GemTD's "This game is sincere. There are no
  // authored defects." — i.e. it reported the exact opposite of the truth for
  // the majority of the collection, confidently and silently.
  //
  // The same rule that governs entry points governs this: a signal that can be
  // wrong in the direction of "looks like it worked" does not get guessed. It
  // is declared, or it is unknown. See `defects` in the declaration below.
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function readTextSafe(p, maxBytes) {
  try {
    if (maxBytes == null) return fs.readFileSync(p, 'utf8');
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(maxBytes);
    const n = fs.readSync(fd, buf, 0, maxBytes, 0);
    fs.closeSync(fd);
    return buf.slice(0, n).toString('utf8');
  } catch {
    return null;
  }
}

// Catalog links are hand-written and inconsistent: "Dead Space/" sits next to
// "Nebula%20Strike/". Decode when it is a valid escape sequence, keep the raw
// text when it is not — a stray % must not throw the whole parse away.
function decodeTarget(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

function isHtml(name) { return /\.html?$/i.test(name); }

// ---------------------------------------------------------------------------
// Source 1 — the catalog table in Games/CLAUDE.md
//
// Rows look like:   | [Dead Space](Dead Space/) | premise | state |
// The LINK TARGET is authoritative for the folder, never the link text: the
// catalog lists "Æthermoor" for a folder named "Aethermoor", and matching on
// display name would lose it.
// ---------------------------------------------------------------------------
function parseCatalog(catalogPath) {
  const out = { rows: [], anomalies: [] };
  const text = readTextSafe(catalogPath);
  if (text == null) {
    out.anomalies.push({ kind: 'catalog-unreadable', detail: catalogPath });
    return out;
  }

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('|')) continue;

    // A data row is one whose first cell is a markdown link. That skips the
    // header and the |---|---| separator without having to track table state,
    // and it means a second table elsewhere in the file cannot poison this.
    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    if (!cells.length) continue;

    const link = cells[0].match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (!link) continue;

    if (cells.length !== 3) {
      // Not fatal — take what is there — but say so, because the likeliest
      // cause is a literal | inside a cell, which would mangle the text.
      out.anomalies.push({
        kind: 'catalog-row-shape',
        detail: `line ${i + 1}: expected 3 cells, found ${cells.length}`,
      });
    }

    out.rows.push({
      display: link[1],
      folder: decodeTarget(link[2]).replace(/\/+$/, ''),
      premise: cells[1] || '',
      state: cells[2] || '',
      line: i + 1,
    });
  }

  if (!out.rows.length) {
    out.anomalies.push({ kind: 'catalog-empty', detail: 'no rows matched — has the table format changed?' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Source 2 — the filesystem
// ---------------------------------------------------------------------------
function listGameFolders(gamesRoot) {
  return fs.readdirSync(gamesRoot, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .map(d => d.name)
    // Plain codepoint order, not localeCompare — localeCompare de-weights
    // punctuation, so "salient_job1.html" sorted before "salient.html". A
    // manifest gets diffed; its ordering has to be boring and stable.
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// Top level only. GemTD/Old Versions/ holds six playable-looking builds and
// none of them is the game; depth is where history lives.
function listEntryCandidates(gameDir) {
  let entries;
  try { entries = fs.readdirSync(gameDir, { withFileTypes: true }); }
  catch { return []; }
  return entries
    .filter(d => d.isFile() && isHtml(d.name))
    .map(d => d.name)
    // Plain codepoint order, not localeCompare — localeCompare de-weights
    // punctuation, so "salient_job1.html" sorted before "salient.html". A
    // manifest gets diffed; its ordering has to be boring and stable.
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// Only used for the "no build" line, to answer "is there anything in here at
// all, or is the folder a placeholder?" CLAUDE.md is excluded because every
// folder is supposed to have one — counting it makes an empty folder look
// occupied, which is the opposite of the question being asked.
function countOtherFiles(gameDir) {
  try {
    return fs.readdirSync(gameDir, { withFileTypes: true })
      .filter(d => d.isFile() && !isHtml(d.name) && d.name.toLowerCase() !== 'claude.md').length;
  } catch { return 0; }
}

// ---------------------------------------------------------------------------
// The declaration — a game telling us things a scan cannot know.
//
//   <!-- marquee: play=snek.html -->        which file is the game
//   <!-- marquee: play=none -->             deliberately has no build
//   <!-- marquee: defects=authored -->      visible defects are on purpose
//   <!-- marquee: defects=none -->          sincere; every bug is a real bug
//
// Keys are independent and may share one comment:
//   <!-- marquee: play=snek.html defects=none -->
//
// An absent key is UNKNOWN, never false. That distinction is the whole reason
// this exists rather than a grep.
// ---------------------------------------------------------------------------
function readDoc(gameDir) {
  const p = path.join(gameDir, 'CLAUDE.md');
  return { path: p, text: readTextSafe(p), exists: fs.existsSync(p) };
}

function parseDeclaration(docText) {
  if (!docText) return {};
  const m = docText.match(TUNE.DECLARATION);
  if (!m) return {};
  const out = {};
  for (const pair of m[1].split(/[\s,]+/)) {
    const eq = pair.indexOf('=');
    if (eq > 0) out[pair.slice(0, eq).toLowerCase()] = pair.slice(eq + 1);
    else if (pair) out[pair.toLowerCase()] = true;
  }
  return out;
}

function extractTitle(htmlPath) {
  const head = readTextSafe(htmlPath, TUNE.TITLE_SNIFF_BYTES);
  if (!head) return null;
  const m = head.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m ? m[1].trim().replace(/\s+/g, ' ') : null;
}

// ---------------------------------------------------------------------------
// Rule 3 — entry-point resolution.
//
//   declaration present   → obey it (and check the file is really there)
//   exactly one candidate → that is the game
//   zero candidates       → no build yet
//   two or more           → ambiguous. STOP. Do not pick one.
// ---------------------------------------------------------------------------
function resolveEntry(gameDir, candidates, declaration) {
  if (declaration.play === 'none') {
    return { entry: null, entryStatus: 'no-build', declared: 'none' };
  }
  if (declaration.play) {
    const exists = candidates.includes(declaration.play) ||
                   fs.existsSync(path.join(gameDir, declaration.play));
    return {
      entry: exists ? declaration.play : null,
      entryStatus: exists ? 'ok' : 'declared-missing',
      declared: declaration.play,
    };
  }
  if (candidates.length === 1) return { entry: candidates[0], entryStatus: 'ok', declared: null };
  if (candidates.length === 0) return { entry: null, entryStatus: 'no-build', declared: null };
  return { entry: null, entryStatus: 'ambiguous', declared: null };
}

// ---------------------------------------------------------------------------
// The join
// ---------------------------------------------------------------------------
function derive(opts) {
  const gamesRoot = path.resolve(opts.gamesRoot);
  if (!fs.existsSync(gamesRoot)) throw new Error('games root not found: ' + gamesRoot);

  const catalog = parseCatalog(path.join(gamesRoot, 'CLAUDE.md'));
  const byFolder = new Map(catalog.rows.map(r => [r.folder, r]));
  const seen = new Set();

  const games = [];
  for (const folder of listGameFolders(gamesRoot)) {
    const dir = path.join(gamesRoot, folder);
    const row = byFolder.get(folder) || null;
    if (row) seen.add(folder);

    const doc = readDoc(dir);
    const declaration = parseDeclaration(doc.text);
    const candidates = listEntryCandidates(dir);
    const resolved = resolveEntry(dir, candidates, declaration);

    let bytes = null, modified = null, title = null;
    if (resolved.entry) {
      const full = path.join(dir, resolved.entry);
      try {
        const st = fs.statSync(full);
        bytes = st.size;
        modified = st.mtime.toISOString();
      } catch { /* resolved but unreadable — bytes stay null, status stays ok */ }
      title = extractTitle(full);
    }

    games.push({
      folder,
      display: row ? row.display : folder,
      premise: row ? row.premise : '',
      state: row ? row.state : '',
      catalogStatus: row ? 'listed' : 'uncatalogued',
      entry: resolved.entry,
      entryStatus: resolved.entryStatus,
      declared: resolved.declared,
      candidates,
      otherFiles: countOtherFiles(dir),
      title,
      bytes,
      modified,
      hasDoc: doc.exists,
      // true | false | null. null means nobody has said, and that is a real
      // and common answer — do not collapse it to false at any point
      // downstream, or "unknown" quietly becomes "sincere".
      authoredDefects: declaration.defects === 'authored' ? true
                     : declaration.defects === 'none'     ? false
                     : null,
    });
  }

  const missingFolders = catalog.rows
    .filter(r => !seen.has(r.folder))
    .map(r => ({ display: r.display, folder: r.folder, line: r.line }));

  return {
    gamesRoot,
    // The launcher is a static page next to this manifest, and it builds its
    // iframe URLs from here. Relative, not absolute: a file:// page can follow
    // "../../Games/Snek/snek.html" but an absolute Windows path has to be
    // rebuilt into a file:/// URL, and that breaks the moment the tree moves
    // or gets synced to another machine. Posix separators — this is a URL.
    gamesRootRelative: path.relative(path.resolve(__dirname, '..'), gamesRoot).split(path.sep).join('/'),
    generated: new Date().toISOString(),
    games,
    missingFolders,
    anomalies: catalog.anomalies,
  };
}

// ---------------------------------------------------------------------------
// Report. Grouped by what a reader would do about it, not by folder order.
// ---------------------------------------------------------------------------
function kb(n) { return n == null ? '' : (n < 1024 ? n + ' B' : Math.round(n / 1024) + ' KB'); }

function report(m) {
  const L = [];
  const playable   = m.games.filter(g => g.entryStatus === 'ok');
  const ambiguous  = m.games.filter(g => g.entryStatus === 'ambiguous');
  const noBuild    = m.games.filter(g => g.entryStatus === 'no-build');
  const badDecl    = m.games.filter(g => g.entryStatus === 'declared-missing');
  const uncat      = m.games.filter(g => g.catalogStatus === 'uncatalogued');
  const noDoc      = m.games.filter(g => !g.hasDoc);

  L.push('Marquee — derived catalog');
  L.push('Games root: ' + m.gamesRoot);
  L.push('');

  L.push(`PLAYABLE (${playable.length})`);
  for (const g of playable) {
    const flag = g.authoredDefects === true ? '  [authored defects]' : '';
    L.push('  ' + g.display.padEnd(22) + (g.entry || '').padEnd(30) +
           kb(g.bytes).padStart(7) + '   ' + (g.title ? '"' + g.title + '"' : '(no <title>)') + flag);
  }

  if (badDecl.length) {
    L.push('');
    L.push(`BROKEN DECLARATION (${badDecl.length})  — CLAUDE.md names a file that is not there`);
    for (const g of badDecl) L.push('  ' + g.display.padEnd(22) + 'declared: ' + g.declared);
  }

  if (ambiguous.length) {
    L.push('');
    L.push(`NEEDS A DECLARATION (${ambiguous.length})  — add <!-- marquee: play=FILE --> to the game's CLAUDE.md`);
    for (const g of ambiguous) {
      L.push('  ' + g.display.padEnd(22) + g.candidates.length + ' candidates: ' + g.candidates.join(', '));
    }
  }

  if (noBuild.length) {
    L.push('');
    L.push(`NO BUILD (${noBuild.length})`);
    for (const g of noBuild) {
      L.push('  ' + g.display.padEnd(22) +
             (g.declared === 'none' ? 'declared none' : `no top-level .html (${g.otherFiles} other file${g.otherFiles === 1 ? '' : 's'})`));
    }
  }

  L.push('');
  L.push('DRIFT');
  L.push('  uncatalogued (on disk, no catalog row): ' + (uncat.length ? uncat.map(g => g.folder).join(', ') : '—'));
  L.push('  missing folder (catalog row, no folder): ' + (m.missingFolders.length ? m.missingFolders.map(r => r.folder).join(', ') : '—'));
  L.push('  no CLAUDE.md: ' + (noDoc.length ? noDoc.map(g => g.folder).join(', ') : '—'));
  const undeclared = m.games.filter(g => g.authoredDefects === null).length;
  L.push('  authored-defect status undeclared: ' + undeclared + ' of ' + m.games.length +
         '  (unknown, not "sincere" — see TUNE in derive.js)');
  for (const a of m.anomalies) L.push('  anomaly [' + a.kind + '] ' + a.detail);

  return L.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1] : dflt;
}
function flag(name) { return process.argv.includes('--' + name); }

if (require.main === module) {
  // tools/ -> Marquee/ -> Claude Town/ -> Projects/ + Games
  const DEFAULT_GAMES = path.resolve(__dirname, '..', '..', '..', 'Games');
  const gamesRoot = arg('games', DEFAULT_GAMES);

  let m;
  try { m = derive({ gamesRoot }); }
  catch (e) { console.error('derive: ' + e.message); process.exit(2); }

  if (flag('json')) {
    console.log(JSON.stringify(m, null, 2));
  } else {
    console.log(report(m));
  }

  if (flag('write')) {
    const outDir = path.resolve(__dirname, '..');
    fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(m, null, 2));
    // The launcher is a static page opened from file://, where fetch() is
    // blocked. So the manifest also ships as a plain assignment that loads via
    // <script src> — the same trick Shadowless and the Pet use.
    fs.writeFileSync(path.join(outDir, 'manifest.js'),
      '// Generated by tools/derive.js — do not edit by hand.\n' +
      'window.MARQUEE_MANIFEST = ' + JSON.stringify(m, null, 2) + ';\n');
    console.error('\nwrote manifest.json and manifest.js');
  }

  const broken = m.games.some(g => g.entryStatus === 'declared-missing') || m.anomalies.length > 0;
  const drift  = m.games.some(g => g.entryStatus === 'ambiguous' || g.catalogStatus === 'uncatalogued') ||
                 m.missingFolders.length > 0;
  // Drift is a normal, expected state — four folders are adrift today — so it
  // is not an error by default, or the exit code would be noise. --strict is
  // for when someone wants the tree actually clean.
  process.exit(broken || (flag('strict') && drift) ? 1 : 0);
}

module.exports = {
  derive, report, parseCatalog, parseDeclaration,
  listEntryCandidates, resolveEntry, decodeTarget, TUNE,
};
