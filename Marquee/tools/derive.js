#!/usr/bin/env node
// ============================================================================
// derive.js — Marquee's catalog, pulled rather than kept.
//
//   node tools/derive.js                      human-readable report
//   node tools/derive.js --json               the manifest, to stdout
//   node tools/derive.js --write              write manifest.json + manifest.js
//   node tools/derive.js --venue <path>       a different floor plan
//   node tools/derive.js --games <path>       scan ONE root, ignore the venue
//   node tools/derive.js --strict             exit non-zero on any drift
//
// WHY THIS EXISTS
// Marquee is a front door to Projects/Games and a few neighbours. The obvious
// way to build one is to keep a list. That was rejected on sight:
// Games/CLAUDE.md already documents that its catalog table drifts, and that a
// row was silently lost once because a session wrote the whole file from a
// stale copy. A second list, in a second format, in a folder nobody opens,
// would drift the same way and faster.
//
// So Marquee holds no list of works. It derives one, every run, from two
// sources that already exist and are already maintained:
//
//   1. THE FILESYSTEM — ground truth for what exists.
//   2. THE CATALOG TABLE in the collection's own CLAUDE.md — ground truth for
//      what it *is*, already written per-row by whoever built the thing.
//
// Neither is sufficient alone, and that is not theoretical. Measured against
// the live tree, 17 Aug 2026:
//
//   - Snek/ holds snek.html (47 KB) and snake.html (10 KB). snake.html is not
//     a backup; it is a DIFFERENT GAME, titled "SERPENT // 8K", left over from
//     before the ballpoint-pen reskin. A filesystem scan offers it as Snek.
//   - Asterism/ holds three, and the one named index.html is a 6.8 KB landing
//     page. "Prefer index.html", the obvious tiebreaker, picks wrong.
//   - Benthos/ and Volley/ have real builds on disk and no catalog row at all.
//
// Hence the two rules the whole file is built around:
//
//   AMBIGUITY IS NEVER RESOLVED BY GUESSING. Two or more candidates and no
//   declaration is a reported state, not a coin flip. Launching a discarded
//   predecessor as if it were the real thing is the worst failure available
//   here, because it looks like it worked.
//
//   DISAGREEMENT BETWEEN THE SOURCES IS OUTPUT, NOT ERROR. A folder with no
//   catalog row still appears, flagged. A catalog row with no folder appears
//   too. Marquee cannot drift, because it keeps nothing — and it reports the
//   drift in the lists that can.
//
// THE VENUE
// Marquee is a building. `venue.json` is its floor plan: which collections are
// wings, and which single works are residents. That file IS a hand-written
// list, and it is the only one — unavoidable, because nothing on disk knows
// that Projects/Games and ~/.claude/Pet belong in the same building. What
// keeps it honest is that it lists only ROOTS, never works, and every root is
// validated: a wing whose folder has vanished is reported, exactly like a
// catalog row whose folder has vanished.
//
// The bar for adding a wing is deliberately high, and it is written down in
// CLAUDE.md: a wing must be a curated collection with its own catalog table,
// so premises exist and drift is detectable. A folder that merely contains
// HTML does not qualify. That rule is the only thing standing between this and
// a general-purpose file browser, which would be worth less than a good front
// door to one collection.
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
  // (There is deliberately no ignore-list of subdirectory names. The rule is
  // simpler and stronger than a blocklist: entry candidates are TOP LEVEL
  // ONLY. A list of names to skip would imply a recursive scan that has to be
  // kept correct forever — miss one name and GemTD/Old Versions/ offers six
  // playable-looking builds, none of which is the game. In this collection,
  // depth is where history lives, without exception.)

  // How much of an HTML file to read when pulling its <title>. The tag is in
  // <head>, and some of these files are 55 MB.
  TITLE_SNIFF_BYTES: 8192,

  // The declaration marker, e.g.  <!-- marquee: play=snek.html -->
  // GLOBAL on purpose. A doc may carry more than one: the entry-point
  // declaration wants to sit beside the prose explaining it, an editorial one
  // is happier at the bottom. Matching only the first silently dropped the
  // rest, which is exactly the failure this project is organised against —
  // it looked like it worked.
  DECLARATION: /<!--\s*marquee:\s*([^>]*?)\s*-->/gi,

  // Catalog tables are hand-written and their headers vary a lot:
  //   Games        | Game | Premise | State |
  //   Misc Tools   | Tool | What it is | Built by |
  //   Space Stuff  |      | What it simulates | What it's for |
  // So columns are located by HEADER NAME, not by position. This is not the
  // prose-reading that got banned elsewhere — a header cell is a structured
  // key, not a sentence — and when nothing matches it falls back to position
  // AND says so, rather than silently mislabelling a column.
  // A work may declare its own poster. Deliberately a SMALL, CLOSED vocabulary
  // rather than free CSS: the values are injected into the page, and a lobby
  // of 34 unrelated posters is noise rather than a lobby. Three colours and a
  // named face is enough to make a sheet unmistakably a game's own while still
  // reading as one printer's work.
  //
  // Anything that fails validation is DROPPED AND REPORTED, never injected.
  POSTER_HEX: /^#[0-9a-fA-F]{3,8}$/,
  POSTER_FACES: ['house', 'condensed', 'slab', 'hand', 'mono', 'neon'],
  // Below this contrast ratio the sheet is reported as hard to read. It is
  // still rendered — a declaration beats a derivation, and the drift readout
  // is the right place to argue about it — but nobody gets to ship an
  // illegible poster without the tool saying so.
  POSTER_MIN_CONTRAST: 3.2,

  COLUMNS: {
    premise: /premise|what it|description|about|summary|concept/i,
    state:   /state|status|progress/i,
    credit:  /built by|author|credit|made by|model/i,
  },

  // NOTE — there is deliberately no heuristic for "does this have authored
  // defects". The first version of this file grepped each CLAUDE.md for
  // /authored defect/i, and against the live tree that flagged 13 of 18 games.
  // It was reading lines like Oblique's "**There are no authored defects**"
  // and GemTD's "This game is sincere. There are no authored defects." — i.e.
  // it reported the exact opposite of the truth for the majority of the
  // collection, confidently and silently.
  //
  // The rule that governs entry points governs this too: a signal that can be
  // wrong in the direction of "looks like it worked" does not get guessed. It
  // is declared, or it is unknown.
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

function isSeparatorRow(line) {
  return /^\s*\|[\s:|-]+\|\s*$/.test(line) && line.indexOf('-') >= 0;
}

function cellsOf(line) {
  return line.split('|').slice(1, -1).map(c => c.trim());
}

// Posix separators — these become URLs.
function toUrlPath(p) { return p.split(path.sep).join('/'); }

function encodeUrl(relPath) {
  return relPath.split('/')
    .map(seg => (seg === '..' || seg === '.') ? seg : encodeURIComponent(seg))
    .join('/');
}

// ---------------------------------------------------------------------------
// Source 1 — the catalog table in a collection's CLAUDE.md
//
// Parsed TABLE BY TABLE rather than by scanning every pipe-line in the file.
// Space Stuff's CLAUDE.md holds more than one table, and a whole-file scan
// would merge rows from two tables with different column meanings into one
// set. Tracking table boundaries costs a few lines and removes a whole class
// of silent mislabelling.
//
// A data row is one whose first cell is a markdown link. The LINK TARGET is
// authoritative for the folder, never the link text: the Games catalog lists
// "Æthermoor" for a folder named "Aethermoor", and matching on display name
// would lose it.
// ---------------------------------------------------------------------------
function parseCatalog(catalogPath) {
  const out = { rows: [], anomalies: [] };
  const text = readTextSafe(catalogPath);
  if (text == null) {
    out.anomalies.push({ kind: 'catalog-unreadable', detail: catalogPath });
    return out;
  }

  const lines = text.split(/\r?\n/);
  let i = 0;
  let tables = 0;

  while (i < lines.length) {
    // A table starts at a header row followed by a separator row.
    const looksLikeHeader = lines[i].trim().charAt(0) === '|' &&
                            i + 1 < lines.length && isSeparatorRow(lines[i + 1]);
    if (!looksLikeHeader) { i++; continue; }

    const header = cellsOf(lines[i]);
    const map = { premise: -1, state: -1, credit: -1 };
    for (let c = 1; c < header.length; c++) {
      for (const key of Object.keys(map)) {
        if (map[key] === -1 && TUNE.COLUMNS[key].test(header[c])) { map[key] = c; break; }
      }
    }
    // Positional fallback, but never onto a column another key already owns.
    // Misc Tools' header is | Tool | What it is | Built by | — premise and
    // credit both match by name, and an unguarded fallback then shoved "state"
    // onto the credit column and reported a bogus anomaly. A missing column is
    // a real and fine answer; inventing one is not.
    const taken = () => [map.premise, map.state, map.credit].filter(i => i >= 0);
    if (map.premise === -1 && header.length > 1 && taken().indexOf(1) < 0) map.premise = 1;
    if (map.state   === -1 && header.length > 2 && taken().indexOf(2) < 0) map.state = 2;
    // Only worth reporting when the DESCRIPTION could not be located, since
    // that is the one a reader actually sees on a plate.
    const fellBack = map.premise === -1;

    const headerLine = i + 1;
    i += 2;

    let rowsHere = 0;
    while (i < lines.length && lines[i].trim().charAt(0) === '|') {
      const cells = cellsOf(lines[i]);
      const link = (cells[0] || '').match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link) {
        out.rows.push({
          display: link[1],
          folder:  decodeTarget(link[2]).replace(/\/+$/, ''),
          premise: map.premise >= 0 ? (cells[map.premise] || '') : '',
          state:   map.state   >= 0 ? (cells[map.state]   || '') : '',
          credit:  map.credit  >= 0 ? (cells[map.credit]  || '') : '',
          line: i + 1,
        });
        rowsHere++;
      }
      i++;
    }

    if (rowsHere) {
      tables++;
      if (fellBack) {
        out.anomalies.push({
          kind: 'catalog-header-unrecognised',
          detail: 'line ' + headerLine + ': columns located by position, not by name — header was ' +
                  JSON.stringify(header),
        });
      }
    }
  }

  if (!tables) {
    out.anomalies.push({ kind: 'catalog-empty', detail: 'no table with linked rows in ' + catalogPath });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Source 2 — the filesystem
// ---------------------------------------------------------------------------

// Plain codepoint order, not localeCompare — localeCompare de-weights
// punctuation, so "salient_job1.html" sorted before "salient.html". A manifest
// gets diffed; its ordering has to be boring and stable.
function byCodepoint(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

function listFolders(root) {
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name.charAt(0) !== '.')
    .map(d => d.name)
    .sort(byCodepoint);
}

// Top level only. GemTD/Old Versions/ holds six playable-looking builds and
// none of them is the game; depth is where history lives.
function listEntryCandidates(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return []; }
  return entries
    .filter(d => d.isFile() && isHtml(d.name))
    .map(d => d.name)
    .sort(byCodepoint);
}

// Only used for the "no build" line, to answer "is there anything in here at
// all, or is this a placeholder?" CLAUDE.md is excluded because every folder
// is supposed to have one — counting it makes an empty folder look occupied,
// which is the opposite of the question being asked.
function countOtherFiles(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isFile() && !isHtml(d.name) && d.name.toLowerCase() !== 'claude.md').length;
  } catch { return 0; }
}

// ---------------------------------------------------------------------------
// The declaration — a work telling us things a scan cannot know.
//
//   <!-- marquee: play=snek.html -->        which file is the work
//   <!-- marquee: play=none -->             deliberately has no build
//   <!-- marquee: defects=authored -->      visible defects are on purpose
//   <!-- marquee: defects=none -->          sincere; every bug is a real bug
//   <!-- marquee: billing=feature -->       headline it
//   <!-- marquee: billing=preview -->       early build; shelve it as a preview
//   <!-- marquee: paper=#10001f ink=#ffd000 accent=#ff1f8f face=neon -->
//                                           print this one in its own colours
//
// Keys are independent, may share one comment, and may be spread across
// several comments anywhere in the file. An absent key is UNKNOWN, never
// false. That distinction is the whole reason this exists rather than a grep.
// ---------------------------------------------------------------------------
function readDoc(dir) {
  const p = path.join(dir, 'CLAUDE.md');
  return { path: p, text: readTextSafe(p), exists: fs.existsSync(p) };
}

function parseDeclaration(docText) {
  const out = {};
  if (!docText) return out;
  // FIRST WINS on a repeated key: the declaration nearest the top of the doc
  // is the canonical one, and a later contradiction should not quietly win
  // just for being later.
  for (const m of docText.matchAll(TUNE.DECLARATION)) {
    for (const pair of m[1].split(/[\s,]+/)) {
      const eq = pair.indexOf('=');
      const key = (eq > 0 ? pair.slice(0, eq) : pair).toLowerCase();
      if (!key || Object.prototype.hasOwnProperty.call(out, key)) continue;
      out[key] = eq > 0 ? pair.slice(eq + 1) : true;
    }
  }
  return out;
}

// WCAG relative luminance, so "is this readable" is a measured number rather
// than an opinion formed while looking at one monitor in one room.
function luminance(hex) {
  let h = hex.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const v = [0, 2, 4].map(i => {
    const c = parseInt(h.substr(i, 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}

function contrastRatio(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// A declared poster, validated. Returns { poster, warnings }: poster is null
// when nothing was declared, which is the normal case and means the house
// prints its own sheet from the derived palette.
function parsePoster(declaration, folder) {
  const warnings = [];
  const out = {};

  for (const key of ['paper', 'ink', 'accent']) {
    const v = declaration[key];
    if (v == null) continue;
    if (TUNE.POSTER_HEX.test(v)) out[key] = v.toLowerCase();
    else warnings.push(folder + ': ' + key + '="' + v + '" is not a hex colour — ignored');
  }

  if (declaration.face != null) {
    if (TUNE.POSTER_FACES.indexOf(declaration.face) >= 0) out.face = declaration.face;
    else warnings.push(folder + ': face="' + declaration.face + '" is not one of ' +
                       TUNE.POSTER_FACES.join('/') + ' — ignored');
  }

  if (!Object.keys(out).length) return { poster: null, warnings };

  // A half-declared poster is worse than none: declaring paper alone leaves
  // the derived ink on top of it, and those were never chosen together.
  if (out.paper && !out.ink) warnings.push(folder + ': paper declared without ink — the sheet keeps its derived type colour');
  if (out.ink && !out.paper) warnings.push(folder + ': ink declared without paper — the type keeps its derived sheet');

  if (out.paper && out.ink) {
    const r = contrastRatio(out.paper, out.ink);
    if (r < TUNE.POSTER_MIN_CONTRAST) {
      warnings.push(folder + ': paper/ink contrast is ' + r.toFixed(1) + ':1, under ' +
                    TUNE.POSTER_MIN_CONTRAST + ':1 — the poster will be hard to read');
    }
  }
  return { poster: out, warnings };
}

function extractTitle(htmlPath) {
  const head = readTextSafe(htmlPath, TUNE.TITLE_SNIFF_BYTES);
  if (!head) return null;
  const m = head.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m ? m[1].trim().replace(/\s+/g, ' ') : null;
}

// ---------------------------------------------------------------------------
// Entry-point resolution.
//
//   declaration present   -> obey it (and check the file is really there)
//   exactly one candidate -> that is the work
//   zero candidates       -> no build yet
//   two or more           -> ambiguous. STOP. Do not pick one.
// ---------------------------------------------------------------------------
function resolveEntry(dir, candidates, declaration) {
  if (declaration.play === 'none') {
    return { entry: null, entryStatus: 'no-build', declared: 'none' };
  }
  if (declaration.play) {
    const exists = candidates.indexOf(declaration.play) >= 0 ||
                   fs.existsSync(path.join(dir, declaration.play));
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

// One folder -> one record. Shared by wings and residents, so a resident gets
// exactly the same rules as a game: same declaration, same refusal to guess.
function describeFolder(dir, folder, row, fromDir) {
  const doc = readDoc(dir);
  const declaration = parseDeclaration(doc.text);
  const candidates = listEntryCandidates(dir);
  const resolved = resolveEntry(dir, candidates, declaration);
  const posterInfo = parsePoster(declaration, folder);

  let bytes = null, modified = null, title = null, url = null;
  if (resolved.entry) {
    const full = path.join(dir, resolved.entry);
    try {
      const st = fs.statSync(full);
      bytes = st.size;
      modified = st.mtime.toISOString();
    } catch { /* resolved but unstattable — status stays ok, numbers stay null */ }
    title = extractTitle(full);
    // Built here rather than in the page. The launcher opens from file://, and
    // these folder names include spaces, an apostrophe, four exclamation marks
    // and an Æ — one encoder, tested, beats the same logic reimplemented in a
    // script tag where it cannot be unit-tested.
    url = encodeUrl(toUrlPath(path.relative(fromDir, full)));
  }

  return {
    folder,
    display: row ? row.display : folder,
    premise: row ? row.premise : '',
    state:   row ? row.state   : '',
    credit:  row ? row.credit  : '',
    catalogStatus: row ? 'listed' : 'uncatalogued',
    entry: resolved.entry,
    entryStatus: resolved.entryStatus,
    declared: resolved.declared,
    candidates,
    otherFiles: countOtherFiles(dir),
    title,
    bytes,
    modified,
    url,
    hasDoc: doc.exists,
    // true | false | null. null means nobody has said, and that is a real and
    // common answer — do not collapse it to false anywhere downstream, or
    // "unknown" quietly becomes "sincere".
    authoredDefects: declaration.defects === 'authored' ? true
                   : declaration.defects === 'none'     ? false
                   : null,
    // Editorial, not derivable. Nothing on disk knows whether a work is
    // finished enough to headline — only a person does. Deliberately NOT
    // inferred from the catalog's State column: that column is English prose,
    // and reading prose for meaning is precisely how the authored-defect flag
    // came to report the opposite of the truth for 13 of 18 games.
    billing: declaration.billing === 'feature' ? 'feature'
           : declaration.billing === 'preview' ? 'preview'
           : null,
    // null = nobody has declared one, so the house prints its own from the
    // derived palette. That is the normal case and not a deficiency.
    poster: posterInfo.poster,
    posterWarnings: posterInfo.warnings,
  };
}

// ---------------------------------------------------------------------------
// A wing — one collection root, joined against its own catalog.
//   opts.root     path to the collection
//   opts.fromDir  what generated URLs should be relative to
//   opts.annex    paths inside this root that belong to other wings
// ---------------------------------------------------------------------------
function deriveWing(opts) {
  const root = path.resolve(opts.gamesRoot || opts.root);
  if (!fs.existsSync(root)) throw new Error('root not found: ' + root);
  const fromDir = path.resolve(opts.fromDir || path.resolve(__dirname, '..'));
  const annex = (opts.annex || []).map(p => path.resolve(p));

  const catalog = parseCatalog(path.join(root, 'CLAUDE.md'));
  const byFolder = new Map(catalog.rows.map(r => [r.folder, r]));
  const seen = new Set();
  const annexed = [];

  const games = [];
  for (const folder of listFolders(root)) {
    const dir = path.join(root, folder);
    // A folder that is itself another wing's root is not an empty work here,
    // it is a door. Reporting it as "no build" would be true and useless.
    if (annex.indexOf(dir) >= 0) { annexed.push(folder); seen.add(folder); continue; }
    const row = byFolder.get(folder) || null;
    if (row) seen.add(folder);
    games.push(describeFolder(dir, folder, row, fromDir));
  }

  const missingFolders = catalog.rows
    .filter(r => !seen.has(r.folder))
    .map(r => ({ display: r.display, folder: r.folder, line: r.line }));

  return {
    gamesRoot: root,
    gamesRootRelative: toUrlPath(path.relative(fromDir, root)),
    games,
    annexed,
    missingFolders,
    anomalies: catalog.anomalies,
  };
}

// ---------------------------------------------------------------------------
// A resident — one work that belongs to no collection.
//
// The Pet is the case this exists for. It has a folder and a CLAUDE.md but no
// catalog to be a row in, because it is not part of a collection — so it gets
// the same folder rules and carries its name from the floor plan instead.
// ---------------------------------------------------------------------------
function deriveResident(spec, fromDir) {
  const dir = path.resolve(fromDir, spec.path);
  if (!fs.existsSync(dir)) {
    return { missing: true, folder: path.basename(spec.path), display: spec.name || path.basename(spec.path) };
  }
  const rec = describeFolder(dir, path.basename(dir), null, fromDir);
  if (spec.name) rec.display = spec.name;
  if (spec.title === false) rec.title = null;
  if (spec.premise) rec.premise = spec.premise;
  // A resident is named by the floor plan, so "no catalog row" is the expected
  // and correct state rather than drift. Calling it drift would train the eye
  // to ignore the drift readout, which is the one thing it must not do.
  rec.catalogStatus = 'resident';
  return rec;
}

// ---------------------------------------------------------------------------
// The venue — the whole building.
// ---------------------------------------------------------------------------
function deriveVenue(opts) {
  const venuePath = path.resolve(opts.venue);
  const fromDir = path.dirname(venuePath);
  const plan = JSON.parse(fs.readFileSync(venuePath, 'utf8'));
  const planWings = plan.wings || [];

  const wingRoots = planWings.map(w => path.resolve(fromDir, w.root));
  const wings = [];
  const entries = [];

  for (let k = 0; k < planWings.length; k++) {
    const w = planWings[k];
    const root = wingRoots[k];
    const annex = wingRoots.filter((r, j) => j !== k && r.indexOf(root + path.sep) === 0);

    let res;
    try {
      res = deriveWing({ root, fromDir, annex });
    } catch (e) {
      wings.push({ id: w.id, name: w.name, kind: 'wing', missing: true, root: w.root, error: e.message,
                   count: 0, annexed: [], missingFolders: [], anomalies: [] });
      continue;
    }
    for (const g of res.games) { g.wing = w.id; entries.push(g); }
    wings.push({
      id: w.id, name: w.name, kind: 'wing', primary: !!w.primary,
      root: res.gamesRoot, rootRelative: res.gamesRootRelative,
      count: res.games.length, annexed: res.annexed,
      missingFolders: res.missingFolders, anomalies: res.anomalies,
    });
  }

  for (const r of (plan.residents || [])) {
    const rec = deriveResident(r, fromDir);
    if (rec.missing) {
      wings.push({ id: r.id, name: r.section || r.name, kind: 'resident', missing: true, root: r.path,
                   count: 0, annexed: [], missingFolders: [], anomalies: [] });
      continue;
    }
    rec.wing = r.id;
    entries.push(rec);
    // A resident carries two names: `section` labels the shelf it sits on,
    // `name` is what the work is called. Collapsing them made the Pet appear
    // as "Also in the building" by "Also in the building".
    wings.push({ id: r.id, name: r.section || r.name, kind: 'resident', primary: false,
                 root: r.path, count: 1, annexed: [], missingFolders: [], anomalies: [] });
  }

  return { generated: new Date().toISOString(), venue: venuePath, wings, entries };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
function kb(n) { return n == null ? '' : (n < 1024 ? n + ' B' : Math.round(n / 1024) + ' KB'); }
function shelfMark(g) {
  return g.billing === 'feature' ? '◆ ' : g.billing === 'preview' ? '○ ' : '  ';
}

function report(m) {
  const L = [];
  L.push('Marquee — derived catalog');
  L.push('Floor plan: ' + m.venue);
  L.push('');

  for (const w of m.wings) {
    const label = (w.name || w.id).toUpperCase();
    if (w.missing) { L.push('== ' + label + '  — MISSING: ' + w.root); L.push(''); continue; }

    const mine = m.entries.filter(e => e.wing === w.id);
    const live = mine.filter(g => g.entryStatus === 'ok');
    const dead = mine.filter(g => g.entryStatus !== 'ok');

    L.push('== ' + label + '   ' + live.length + ' of ' + mine.length + ' open' +
           (w.kind === 'resident' ? '   (resident)' : '') + '    ◆ feature  ○ preview');
    for (const g of live) {
      L.push('   ' + shelfMark(g) + g.display.padEnd(22) + (g.entry || '').padEnd(30) +
             kb(g.bytes).padStart(7) + '   ' + (g.title ? '"' + g.title + '"' : '(no <title>)') +
             (g.authoredDefects === true ? '  [authored defects]' : ''));
    }
    for (const g of dead) {
      const why = g.entryStatus === 'ambiguous'
        ? g.candidates.length + ' candidates: ' + g.candidates.join(', ')
        : g.entryStatus === 'declared-missing'
          ? 'declares "' + g.declared + '", which is not there'
          : g.declared === 'none' ? 'declared none'
            : 'no top-level .html (' + g.otherFiles + ' other file' + (g.otherFiles === 1 ? '' : 's') + ')';
      L.push('     ' + g.display.padEnd(22) + '— ' + why);
    }
    if (w.annexed && w.annexed.length) {
      L.push('     (annexed to their own wings: ' + w.annexed.join(', ') + ')');
    }
    L.push('');
  }

  L.push('DRIFT');
  const names = a => a.length ? a.map(g => g.wing + '/' + g.folder).join(', ') : '—';
  L.push('  on disk, no catalog row     ' + names(m.entries.filter(g => g.catalogStatus === 'uncatalogued')));
  L.push('  ambiguous entry point       ' + names(m.entries.filter(g => g.entryStatus === 'ambiguous')));
  L.push('  no CLAUDE.md                ' + names(m.entries.filter(g => !g.hasDoc)));
  for (const w of m.wings) {
    for (const r of (w.missingFolders || [])) L.push('  catalog row, no folder      ' + w.id + '/' + r.folder);
    for (const a of (w.anomalies || []))      L.push('  anomaly [' + a.kind + ']  ' + w.id + ': ' + a.detail);
  }
  const themed = m.entries.filter(g => g.poster).length;
  L.push('  posters declared            ' + themed + ' of ' + m.entries.length + '  (the rest are house-printed)');
  for (const g of m.entries) {
    for (const w of (g.posterWarnings || [])) L.push('  poster                      ' + w);
  }
  const undec = m.entries.filter(g => g.authoredDefects === null).length;
  L.push('  defect status undeclared    ' + undec + ' of ' + m.entries.length + '  (unknown, not "sincere")');
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--'
    ? process.argv[i + 1] : dflt;
}
function flag(name) { return process.argv.indexOf('--' + name) >= 0; }

if (require.main === module) {
  const ROOT = path.resolve(__dirname, '..');
  const oneRoot = arg('games', null);

  let m;
  try {
    if (oneRoot) {
      // Ad-hoc single-collection scan, wrapped to look like a one-wing venue so
      // the report and the manifest only ever have one shape.
      const res = deriveWing({ root: oneRoot, fromDir: ROOT });
      for (const g of res.games) g.wing = 'adhoc';
      m = {
        generated: new Date().toISOString(),
        venue: res.gamesRoot,
        wings: [{ id: 'adhoc', name: path.basename(res.gamesRoot), kind: 'wing', primary: true,
                  root: res.gamesRoot, rootRelative: res.gamesRootRelative, count: res.games.length,
                  annexed: res.annexed, missingFolders: res.missingFolders, anomalies: res.anomalies }],
        entries: res.games,
      };
    } else {
      m = deriveVenue({ venue: arg('venue', path.join(ROOT, 'venue.json')) });
    }
  } catch (e) {
    console.error('derive: ' + e.message);
    process.exit(2);
  }

  console.log(flag('json') ? JSON.stringify(m, null, 2) : report(m));

  if (flag('write')) {
    fs.writeFileSync(path.join(ROOT, 'manifest.json'), JSON.stringify(m, null, 2));
    // The launcher is a static page opened from file://, where fetch() is
    // blocked, so the manifest also ships as a plain assignment loaded by
    // <script src> — the same trick Shadowless and the Pet use.
    fs.writeFileSync(path.join(ROOT, 'manifest.js'),
      '// Generated by tools/derive.js — do not edit by hand.\n' +
      'window.MARQUEE_MANIFEST = ' + JSON.stringify(m, null, 2) + ';\n');
    console.error('\nwrote manifest.json and manifest.js');
  }

  const broken = m.entries.some(g => g.entryStatus === 'declared-missing') ||
                 m.wings.some(w => w.missing || (w.anomalies || []).length);
  const drift  = m.entries.some(g => g.entryStatus === 'ambiguous' || g.catalogStatus === 'uncatalogued') ||
                 m.wings.some(w => (w.missingFolders || []).length);
  // Drift is a normal, expected state, so it is not an error by default or the
  // exit code would be noise. --strict is for when someone wants it clean.
  process.exit(broken || (flag('strict') && drift) ? 1 : 0);
}

module.exports = {
  deriveVenue, deriveWing, deriveResident, derive: deriveWing,
  report, parseCatalog, parseDeclaration, listEntryCandidates, resolveEntry,
  decodeTarget, encodeUrl, parsePoster, contrastRatio, TUNE,
};
