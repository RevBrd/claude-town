#!/usr/bin/env node
/* Marquee's terminal front door.
 *
 *   marquee            what is playing
 *   marquee dead space open it
 *
 * It contains NO CATALOG. It runs `tools/derive.js` -- the same derivation the
 * page runs and the same one `--write` runs -- so there is exactly one answer
 * to "what is in this building" and this is a second reader of it, never a
 * second implementation. A launcher with its own list would drift from the
 * building it claims to be the front of, and nobody would notice, because
 * nobody reads a launcher's config.
 *
 * The one rule inherited from Marquee proper and worth restating: AMBIGUITY IS
 * NEVER RESOLVED BY GUESSING. `dead` matches two games; three things are called
 * Sandbox. Opening the wrong one is the worst failure available here, because
 * it looks exactly like it worked.
 */
'use strict';

var path = require('path');
var cp   = require('child_process');
var D    = require('./tools/derive.js');

var HERE  = __dirname;
var VENUE = path.join(HERE, 'venue.json');

/* Things that are not works in the catalog but are still openable. The
 * building itself is the obvious one -- "open marquee" is the first thing
 * anybody types. */
function builtins() {
  return [{
    display: 'Marquee', folder: 'Marquee', title: 'the building itself',
    wing: 'here', entryStatus: 'ok', file: path.join(HERE, 'marquee.html'),
    builtin: true
  }];
}

/* ---------------------------------------------------------------- matching */

/* Punctuation is noise in a name typed at a prompt: nobody types
 * "Ultra Pong!!!!" or the diaeresis in "AEthermoor". */
function norm(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[Ææ]/g, 'ae')
    .normalize ? String(s == null ? '' : s).toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[Ææ]/g, 'ae')
        .replace(/[^a-z0-9]+/g, ' ').trim()
      : String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function squash(s) { return norm(s).replace(/ /g, ''); }
function initials(s) {
  return norm(s).split(' ').filter(Boolean).map(function (w) { return w[0]; }).join('');
}

/* Best tier first. The tier a match was found at is reported, because "I found
 * this by its initials" and "you typed its name" deserve different amounts of
 * trust from the person reading the output. */
var TIERS = [
  ['exact',     function (q, n) { return norm(n) === q; }],
  ['prefix',    function (q, n) { return norm(n).indexOf(q) === 0; }],
  ['words',     function (q, n) {
      var want = q.split(' ').filter(Boolean);
      var have = norm(n).split(' ').filter(Boolean);
      var at = 0;
      return want.every(function (w) {
        while (at < have.length) { if (have[at++].indexOf(w) === 0) return true; }
        return false;
      });
    }],
  ['squashed',  function (q, n) { return squash(n).indexOf(q.replace(/ /g, '')) !== -1; }],
  ['initials',  function (q, n) { return q.length >= 2 && initials(n) === q.replace(/ /g, ''); }]
];

/* What a work is CALLED, versus what its page happens to say at the top.
 *
 * These are searched in two separate passes, and the split is load-bearing.
 * A game's <title> is prose: Combat Circuit's is "COMBAT CIRCUIT — Sandbox"
 * and Dead Reckoning's is "DEAD RECKONING — Flight Sandbox". Searching titles
 * at the same rank as names turned `sandbox` -- which is three things in the
 * Planetarium -- into five, two of them unrelated games that merely describe
 * themselves that way. Titles are still searched, but only when the names find
 * nothing, so they widen a miss instead of muddying a hit. */
function namesOf(e) {
  return [e.display, e.folder].filter(function (s) { return s && String(s).trim(); });
}
function titleOf(e) {
  return [e.title].filter(function (s) { return s && String(s).trim(); });
}

function matchAgainst(q, works, fields) {
  for (var t = 0; t < TIERS.length; t++) {
    var name = TIERS[t][0], test = TIERS[t][1];
    var hits = works.filter(function (w) {
      return fields(w).some(function (n) { return test(q, n); });
    });
    if (hits.length) return { tier: name, hits: hits };
  }
  return null;
}

function match(query, works) {
  var q = norm(query);
  if (!q) return { tier: null, hits: [] };

  var byName = matchAgainst(q, works, namesOf);
  if (byName) return byName;

  var byTitle = matchAgainst(q, works, titleOf);
  if (byTitle) return { tier: 'title (' + byTitle.tier + ')', hits: byTitle.hits };

  return { tier: null, hits: [] };
}

/* ------------------------------------------------------------------ venue */

/* Derived fresh every run. A launcher that reads a generated manifest is a
 * launcher that opens whatever was true the last time somebody remembered to
 * regenerate it. */
function works() {
  var m = D.deriveVenue({ venue: VENUE });

  var out = m.entries.map(function (e) {
    return {
      display: e.display || e.folder,
      folder: e.folder,
      title: e.title,
      wing: e.wing,
      entryStatus: e.entryStatus,
      candidates: e.candidates || [],
      /* `url` is the field the page itself opens, relative to this folder, so
       * it is the tested path rather than a second reconstruction of one.
       * Rebuilding it from wing root + folder + entry looked equivalent and was
       * not: the Pet is a resident whose root is relative AND whose folder is
       * also "Pet", so joining them produced `.claude/Pet/Pet/pet.html`.
       *
       * It is percent-encoded, because its other consumer is a browser --
       * decoded with derive.js's own `decodeTarget`, which is the exact inverse
       * of the `encodeUrl` that produced it, rather than a second guess at what
       * that encoding was. Half this tree has a space in its path. */
      file: e.url ? path.resolve(HERE, D.decodeTarget(e.url)) : null
    };
  });
  return { works: builtins().concat(out), wings: m.wings };
}

/* ---------------------------------------------------------------- opening */

/* `start` treats a first quoted argument as the window title, so the empty
 * string is required or a quoted path becomes the title and nothing opens.
 * Detached, because the point is to hand the thing over and get out of the way
 * -- the terminal should come straight back. */
function open(file) {
  var child = cp.spawn('cmd', ['/c', 'start', '', file],
                       { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

/* ---------------------------------------------------------------- drawing */

var C = {
  on: true,
  w: function (c, s) { return C.on ? '\x1b[' + c + 'm' + s + '\x1b[0m' : String(s); },
  dim:  function (s) { return C.w('38;5;242', s); },
  body: function (s) { return C.w('38;5;252', s); },
  warm: function (s) { return C.w('38;5;179', s); },
  good: function (s) { return C.w('38;5;108', s); },
  bad:  function (s) { return C.w('38;5;174', s); }
};

var ROOM = { games: 'Main house', tools: 'Side stage', claudelings: 'Art house',
             space: 'Planetarium', pet: 'Also in the building', here: '' };

function pad(s, n) { s = String(s); return s.length >= n ? s : s + Array(n - s.length + 1).join(' '); }
function trimEnd(s) { return String(s).replace(/\s+$/, ''); }

function renderList(all) {
  var L = [''], seen = {};
  /* Count what the list actually shows. The building itself is openable but is
   * not a work in the catalog, so counting it makes the header disagree with
   * the rows underneath it. */
  var shown = all.filter(function (w) { return !w.builtin; });
  var open = shown.filter(function (w) { return w.entryStatus === 'ok'; });
  L.push('  ' + C.body('now playing') + C.dim(' · ' + open.length + ' of ' +
         shown.length + ' open'));
  L.push('');
  all.forEach(function (w) {
    if (w.builtin) return;
    if (!seen[w.wing]) {
      seen[w.wing] = 1;
      L.push('  ' + C.dim(ROOM[w.wing] || w.wing));
    }
    var ok = w.entryStatus === 'ok';
    L.push('    ' + (ok ? C.body(pad(w.display, 26)) : C.dim(pad(w.display, 26))) +
           (ok ? '' : C.dim(w.entryStatus === 'no-build' ? 'no build yet'
                          : 'two candidate files — undeclared')));
  });
  L.push('');
  L.push('  ' + C.dim('marquee <name> opens one. Part of a name is enough.'));
  L.push('');
  return L.map(trimEnd);
}

function renderHits(query, res) {
  var L = [''];
  if (!res.hits.length) {
    L.push('  ' + C.bad('nothing here is called "' + query + '"'));
    L.push('  ' + C.dim('`marquee` on its own lists everything.'));
    L.push('');
    return L;
  }
  L.push('  ' + C.warm(res.hits.length + ' things match "' + query + '"') +
         C.dim('  (' + res.tier + ')'));
  L.push('');
  res.hits.forEach(function (w) {
    L.push('    ' + C.body(pad(w.display, 26)) +
           C.dim(ROOM[w.wing] || w.wing) +
           (w.entryStatus === 'ok' ? '' : C.dim('  — ' + w.entryStatus)));
  });
  L.push('');
  L.push('  ' + C.dim('say which one. Marquee does not guess between them —'));
  L.push('  ' + C.dim('opening the wrong one looks exactly like it worked.'));
  L.push('');
  return L.map(trimEnd);
}

/* -------------------------------------------------------------------- cli */

var HELP = [
  '',
  '  marquee              what is playing',
  '  marquee <name>       open it. Part of the name is enough',
  '  marquee find <name>  show what matches, without opening anything',
  '',
  '  --dry                say what would open, and do not open it',
  '  --no-color           plain text',
  '',
  '  The catalog is derived from the filesystem every run, by the same code the',
  '  page itself runs. There is no list in here to go stale.',
  ''
].join('\n');

function main(argv) {
  var args = argv.slice(2);
  if (args.indexOf('--no-color') !== -1 || process.env.NO_COLOR ||
      !process.stdout.isTTY) C.on = false;
  var dry = args.indexOf('--dry') !== -1;
  args = args.filter(function (a) { return a.charAt(0) !== '-'; });

  if (argv.indexOf('--help') !== -1 || argv.indexOf('-h') !== -1) {
    process.stdout.write(HELP + '\n'); return 0;
  }

  var v;
  try { v = works(); }
  catch (e) {
    process.stderr.write('\n  marquee: ' + e.message + '\n\n');
    return 1;
  }

  var findOnly = args[0] === 'find';
  if (findOnly) args = args.slice(1);

  if (!args.length) {
    process.stdout.write(renderList(v.works).join('\n') + '\n');
    return 0;
  }

  var query = args.join(' ');
  var res = match(query, v.works);

  if (findOnly || res.hits.length !== 1) {
    process.stdout.write(renderHits(query, res).join('\n') + '\n');
    return res.hits.length ? 0 : 1;
  }

  var w = res.hits[0];

  if (w.entryStatus !== 'ok' || !w.file) {
    process.stdout.write('\n  ' + C.body(w.display) + C.dim(' cannot be opened') + '\n' +
      '  ' + C.dim(w.entryStatus === 'no-build'
        ? 'there is no build in its folder yet'
        : 'it has ' + (w.candidates.length || 'several') + ' candidate files and ' +
          'none is declared, so Marquee will not pick one') + '\n\n');
    return 1;
  }

  process.stdout.write('\n  ' + C.good(dry ? 'would open' : 'opening') + '  ' +
    C.body(w.display) + C.dim('   (matched on ' + res.tier + ')') + '\n' +
    '  ' + C.dim(w.file) + '\n\n');

  if (!dry) open(w.file);
  return 0;
}

module.exports = { norm: norm, squash: squash, initials: initials, match: match,
                   works: works, builtins: builtins, renderList: renderList,
                   renderHits: renderHits, open: open, C: C, main: main };

if (require.main === module) process.exit(main(process.argv));
