#!/usr/bin/env node
// ============================================================================
// smoke.js — does marquee.html actually boot and draw the manifest?
//
//   node tools/smoke.js
//
// ~/.claude/tools/probe.js cannot do this one. It copies the artifact to the
// system temp dir before loading it, which is correct for a self-contained
// file and fatal here: marquee.html loads manifest.js by relative path and
// builds its iframe URLs as ../../Games/..., so a copy in tmp renders the
// "no manifest" state and reports a cheerful pass for a page that showed
// nothing. The copy therefore goes NEXT TO the original, under a temp name,
// where every relative path still resolves.
//
// This is a smoke test, in the same sense probe.js is one: it catches "threw
// on load", "drew nothing", and "drew the wrong number of things". It cannot
// see a wrong colour or a dead button. The derivation logic is covered
// properly by selftest.js; this only asserts that the page and the manifest
// agree about reality.
//
// CTown-4 (Opus 5), 17 Aug 2026.
// ============================================================================

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

const ROOT     = path.resolve(__dirname, '..');
const PAGE     = path.join(ROOT, 'marquee.html');
const MANIFEST = path.join(ROOT, 'manifest.json');

const browser = process.env.PROBE_CHROME || CHROME_CANDIDATES.find(c => fs.existsSync(c));
if (!browser)              { console.error('smoke: no Chrome or Edge found.'); process.exit(2); }
if (!fs.existsSync(PAGE))  { console.error('smoke: marquee.html missing.'); process.exit(2); }
if (!fs.existsSync(MANIFEST)) {
  console.error('smoke: manifest.json missing — run `node tools/derive.js --write` first.');
  process.exit(2);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const entries    = manifest.entries || manifest.games || [];
const expectLive = entries.filter(g => g.entryStatus === 'ok').length;
const expectDead = entries.length - expectLive;

// The listener goes in FIRST, before the page's own scripts, or a parse error
// in the page is invisible — the error fires before any later listener exists.
// (probe.js learned this from mutation testing; inheriting the lesson.)
const LISTENER = `<script>
window.__errs=[];
addEventListener('error',function(e){window.__errs.push((e.message||'?')+' @'+(e.lineno||'?'))});
addEventListener('unhandledrejection',function(e){window.__errs.push('rejection: '+e.reason)});
<\/script>`;

const REPORT = `<script>
setTimeout(function(){
  var d=document.createElement('div'); d.id='SMOKE';
  var live=document.querySelectorAll('.card:not(.inert)').length;
  var dead=document.querySelectorAll('.card.inert').length;
  var rooms=document.querySelectorAll('.roomname').length;
  var firstHref='';
  try{ var c=document.querySelector('.card:not(.inert)'); firstHref=c?c.title:''; }catch(e){}
  d.textContent='SMOKE:'+((window.__errs||[]).join(' || ')||'ok')+
                '|live='+live+'|dead='+dead+'|drift='+(document.querySelector('details.drift')?1:0)+'|rooms='+rooms+
                '|first='+firstHref;
  d.style.cssText='position:fixed;left:-9999px';
  document.body.appendChild(d);
},1200);
<\/script>`;

const src = fs.readFileSync(PAGE, 'utf8');
const m = src.match(/^\s*<!doctype[^>]*>/i);
const instrumented = (m ? src.slice(0, m[0].length) + '\n' + LISTENER + src.slice(m[0].length)
                       : LISTENER + '\n' + src) + REPORT;

// Alongside the original, so ./manifest.js and ../../Games/... still resolve.
const tmp = path.join(ROOT, '.smoke-tmp.html');
fs.writeFileSync(tmp, instrumented);

let dom = '';
try {
  dom = execFileSync(browser, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--window-size=1400,900', '--virtual-time-budget=4000',
    '--dump-dom', 'file:///' + tmp.replace(/\\/g, '/'),
  ], { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'ignore'] });
} catch (e) {
  console.error('smoke: browser launch failed — ' + e.message.split('\n')[0]);
  fs.unlinkSync(tmp);
  process.exit(2);
} finally {
  try { fs.unlinkSync(tmp); } catch {}
}

// Match the RENDERED marker, not the literal string in the bootstrap source —
// --dump-dom returns script text too, and matching that passes a page that
// never ran a line of JS.
const hit = dom.match(/id="SMOKE"[^>]*>SMOKE:([^<]*)/);
if (!hit) { console.error('FAIL  the page never ran its scripts'); process.exit(1); }

const [status, liveP, deadP, driftP, roomsP, firstP] = hit[1].split('|');
const live  = Number(liveP.replace('live=', ''));
const dead  = Number(deadP.replace('dead=', ''));
const drift = driftP === 'drift=1';
const rooms = Number(roomsP.replace('rooms=', ''));
const expectRooms = (manifest.wings || []).filter(w => !w.missing && entries.some(e => e.wing === w.id)).length;
const first = firstP.replace('first=', '');

const checks = [
  ['no JS errors on load',            status === 'ok', status],
  ['playable plates match manifest',  live === expectLive,  live + ' drawn, ' + expectLive + ' expected'],
  ['unplayable plates match manifest', dead === expectDead, dead + ' drawn, ' + expectDead + ' expected'],
  ['drift readout present',           drift, String(drift)],
  ['every room drew a heading',       rooms === expectRooms, rooms + ' drawn, ' + expectRooms + ' expected'],
  ['a plate knows its entry file',    /\/.+\.html?$/.test(first), first || '(none)'],
];

let bad = 0;
for (const [name, pass, detail] of checks) {
  console.log((pass ? '  ok    ' : '  FAIL  ') + name + (pass ? '' : '  — ' + detail));
  if (!pass) bad++;
}
console.log(bad ? `\n${bad} check(s) failed.` : `\nAll green. ${live} playable, ${dead} not.`);
process.exit(bad ? 1 : 0);
