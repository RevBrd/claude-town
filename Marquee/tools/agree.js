#!/usr/bin/env node
// ============================================================================
// agree.js — do the two readers agree?
//
//   node tools/agree.js
//   node tools/agree.js --keep     leave the temp page behind for inspection
//
// WHAT THIS PROTECTS
// Marquee derives its catalog twice: once in the terminal over `fs`, and once
// in the browser over Mains. The entire justification for that arrangement is
// that BOTH RUN THE SAME CODE — tools/derive.js, verbatim, behind an I/O seam
// — so the two cannot drift the way two hand-written lists drift.
//
// That claim is only worth anything if something checks it. Nothing in
// selftest.js can: it exercises derive.js under node against a fixture, and
// would stay green forever while the browser path quietly returned something
// else. Nothing in smoke.js can either: it boots the page from file://, where
// the live path is deliberately never taken.
//
// So this one boots a real Mains against the real tree, loads the real page
// through it in headless Chrome, and diffs the manifest the page ended up with
// against the one node computes. Anything but "identical" is a failure.
//
// It has already earned its place. The first live derivation disagreed with
// node on EVERY SINGLE ENTRY, because HTTP's Last-Modified header is RFC 1123
// and carries one-second granularity, so every mtime landed on .000Z. Nothing
// else would have caught that: the page looked perfect, the dates displayed
// correctly, and the manifest was wrong in the third decimal place.
//
// PATH SEPARATORS ARE NORMALISED BEFORE COMPARING, and that is the one
// permitted difference. Node reports C:\Users\... and the browser reports
// /C:/Users/... because its path shim is posix — Mains addresses everything
// with forward slashes, so posix is correct there rather than approximate.
// The difference reaches exactly two display-only fields in the drift readout
// and nothing that is ever resolved, launched, or compared.
//
// If Mains is not installed this test SKIPS and exits 0. Marquee on batteries
// has no dependency on Mains whatsoever, and a suite that failed for a missing
// optional component would be lying about what is broken.
// ============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');
const http = require('http');
// execFile, NOT execFileSync. The Mains instance under test runs in THIS
// process, so a synchronous spawn blocks the event loop and the server can
// never answer the browser it just launched — which presents as Chrome timing
// out, and looks for all the world like a browser problem.
const { execFile } = require('child_process');

const ROOT      = path.resolve(__dirname, '..');
const PAGE      = path.join(ROOT, 'marquee.html');
const MAINS_DIR = path.resolve(ROOT, '..', 'Mains');
const KEEP      = process.argv.includes('--keep');

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

function skip(why) {
  console.log('');
  console.log('  SKIP  ' + why);
  console.log('        Marquee on batteries does not depend on Mains, so this is not a failure.');
  console.log('');
  process.exit(0);
}

if (!fs.existsSync(path.join(MAINS_DIR, 'server.js'))) skip('Mains is not installed next to Marquee.');
if (!fs.existsSync(PAGE)) { console.error('agree: marquee.html missing.'); process.exit(2); }

const browser = process.env.PROBE_CHROME || CHROME_CANDIDATES.find(c => fs.existsSync(c));
if (!browser) skip('no Chrome or Edge found.');

const mains  = require(path.join(MAINS_DIR, 'server.js'));
const derive = require(path.join(ROOT, 'tools', 'derive.js'));

// ---------------------------------------------------------------------------
// Comparison. `generated` is a timestamp on both sides and is always different;
// path separators are normalised per the note at the top. Everything else has
// to match exactly.
// ---------------------------------------------------------------------------
function normalise(m) {
  const BS = String.fromCharCode(92);
  return JSON.parse(JSON.stringify(m, (k, v) => {
    if (k === 'generated') return 0;
    if (typeof v !== 'string') return v;
    return v.split(BS).join('/').replace(/^\/([A-Za-z]:)/, '$1');
  }));
}

function diff(a, b, at, out) {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set(Object.keys(a).concat(Object.keys(b)));
    for (const k of keys) diff(a[k], b[k], at + '.' + k, out);
    return;
  }
  out.push(at + ':  node=' + JSON.stringify(a) + '   live=' + JSON.stringify(b));
}

// ---------------------------------------------------------------------------
// The page, instrumented to hand back what it actually ended up with. The
// manifest is base64'd rather than written as text: it is ~40 KB of arbitrary
// prose from thirty-eight CLAUDE.md files, and any of it may contain the
// characters that would end the element it was sitting in.
// ---------------------------------------------------------------------------
const REPORT = `<script>
setTimeout(function () {
  var out = { err: (window.__errs || []).join(' || ') || 'ok', src: window.MARQUEE_SOURCE || null, b64: '' };
  try {
    out.b64 = btoa(unescape(encodeURIComponent(JSON.stringify(window.MARQUEE_MANIFEST))));
  } catch (e) { out.err = 'encode failed: ' + e.message; }
  var d = document.createElement('div');
  d.id = 'AGREE';
  d.textContent = btoa(unescape(encodeURIComponent(JSON.stringify(out))));
  d.style.cssText = 'position:fixed;left:-9999px';
  document.body.appendChild(d);
}, 2500);
<\/script>`;

const LISTENER = `<script>
window.__errs=[];
addEventListener('error',function(e){window.__errs.push((e.message||'?')+' @'+(e.lineno||'?'))});
addEventListener('unhandledrejection',function(e){window.__errs.push('rejection: '+e.reason)});
<\/script>`;

function instrument() {
  const src = fs.readFileSync(PAGE, 'utf8');
  const m = src.match(/^\s*<!doctype[^>]*>/i);
  return (m ? src.slice(0, m[0].length) + '\n' + LISTENER + src.slice(m[0].length)
            : LISTENER + '\n' + src) + REPORT;
}

// ---------------------------------------------------------------------------
async function main() {
  // A real Mains, on an ephemeral port, using Marquee's real neighbour config
  // so the circuits under test are the ones actually shipped.
  const cfg = path.join(MAINS_DIR, 'mains.json');
  let map;
  try { map = mains.loadCircuits(cfg); }
  catch (e) { skip('Mains circuit map would not load: ' + e.message); }

  const dead = map.circuits.filter(c => !c.live);
  if (dead.length) {
    console.log('  note  ' + dead.length + ' dead circuit(s): ' + dead.map(c => c.id).join(', '));
  }

  const state = { circuits: map.circuits, port: 0, meter: mains.newMeter(), quiet: true };
  const srv = http.createServer((req, res) => state.handler(req, res));
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  state.port = port;
  state.handler = mains.makeHandler(state);

  // Which circuit is Claude Town? The page has to be reached through the same
  // mapping the browser will use, and hardcoding "town" would be a second copy
  // of a fact that already lives in mains.json.
  const here = path.resolve(ROOT);
  const townRow = map.circuits
    .filter(c => c.live)
    .filter(c => here.toLowerCase().indexOf(c.root.toLowerCase()) === 0)
    .sort((a, b) => b.root.length - a.root.length)[0];
  if (!townRow) { srv.close(); skip('Marquee is not inside any Mains circuit.'); }

  const tmpName = '.agree-tmp.html';
  const tmp = path.join(ROOT, tmpName);
  fs.writeFileSync(tmp, instrument());

  const rel = path.relative(townRow.root, tmp).split(path.sep).map(encodeURIComponent).join('/');
  const url = 'http://127.0.0.1:' + port + '/' + townRow.id + '/' + rel;

  let dom = '';
  try {
    dom = await new Promise((resolve, reject) => {
      execFile(browser, [
        '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
        '--window-size=1400,900', '--virtual-time-budget=9000',
        '--dump-dom', url,
      ], { encoding: 'utf8', timeout: 90000, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout) => (err && !stdout ? reject(err) : resolve(stdout || '')));
    });
  } catch (e) {
    if (!KEEP) try { fs.unlinkSync(tmp); } catch {}
    srv.close();
    console.error('agree: browser launch failed — ' + String(e.message).split('\n')[0]);
    process.exit(2);
  } finally {
    if (!KEEP) { try { fs.unlinkSync(tmp); } catch {} }
    srv.close();
  }

  const hit = dom.match(/id="AGREE"[^>]*>([A-Za-z0-9+/=]*)</);
  if (!hit) { console.error('FAIL  the page never reported — it may not have booted.'); process.exit(1); }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(hit[1], 'base64').toString('utf8'));
  } catch (e) { console.error('FAIL  unreadable report: ' + e.message); process.exit(1); }

  const nodeManifest = derive.deriveVenue({ venue: path.join(ROOT, 'venue.json') });
  const liveManifest = payload.b64
    ? JSON.parse(Buffer.from(payload.b64, 'base64').toString('utf8'))
    : null;

  const fails = [];
  const say = (cond, label, detail) => {
    console.log('  ' + (cond ? 'ok   ' : 'FAIL ') + ' ' + label + (cond ? '' : '   — ' + detail));
    if (!cond) fails.push(label);
  };

  console.log('');
  console.log('  MARQUEE / MAINS AGREEMENT');
  console.log('  ' + '-'.repeat(58));
  console.log('');

  say(payload.err === 'ok', 'the page loads with no JS errors', payload.err);
  say(!!payload.src && payload.src.live === true,
      'the page derived LIVE rather than falling back',
      payload.src ? ('fell back: ' + payload.src.why) : 'no source recorded');
  say(!!liveManifest, 'the page produced a manifest', 'none');

  if (liveManifest) {
    const a = normalise(nodeManifest);
    const b = normalise(liveManifest);
    const out = [];
    diff(a, b, '', out);

    say(a.entries.length === b.entries.length,
        'the same number of works', a.entries.length + ' vs ' + b.entries.length);
    say(JSON.stringify(a.entries) === JSON.stringify(b.entries),
        'EVERY ENTRY IS IDENTICAL — same code, same answer',
        out.filter(d => d.indexOf('.entries') === 0).length + ' field(s) differ');
    say(out.length === 0, 'the whole manifest is identical', out.length + ' field(s) differ');

    if (out.length) {
      console.log('');
      for (const d of out.slice(0, 25)) console.log('        ' + d);
      if (out.length > 25) console.log('        ... and ' + (out.length - 25) + ' more');
    }
  }

  if (payload.src && payload.src.live) {
    console.log('');
    console.log('  derived in ' + payload.src.passes + ' passes, ' +
                payload.src.requests + ' requests, ' + payload.src.ms + ' ms');
  }

  console.log('');
  console.log('  ' + '-'.repeat(58));
  console.log('  ' + (fails.length ? fails.length + ' FAILED' : 'The two readers agree.'));
  console.log('');
  process.exit(fails.length ? 1 : 0);
}

main().catch(e => { console.error('agree crashed: ' + (e && e.stack || e)); process.exit(2); });
