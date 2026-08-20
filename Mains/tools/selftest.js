#!/usr/bin/env node
// ============================================================================
// selftest.js — assertions, live attacks, then mutants.
//
//   node tools/selftest.js            everything
//   node tools/selftest.js --quiet    only the summary and any failures
//   node tools/selftest.js --no-mut   skip the mutation suite (faster)
//
// WHY THE MUTANTS ARE NOT OPTIONAL HERE
// This server hands out the contents of five folders to anything that can
// reach a loopback port. Its defences are the kind that pass every test right
// up until they are inverted — Marquee's inverted-grep bug is the house
// example, where a check flagged 13 of 18 games as having authored defects by
// matching the sentence "there are no authored defects". Every assertion
// passed, because no assertion could tell "correct" from "always true".
//
// So: each defence is deliberately broken, one at a time, on a scratch copy of
// server.js, and the suite must go RED for each. A defence whose mutant
// survives is a defence that is not doing anything, and the suite says so by
// name rather than by exit code alone.
// ============================================================================

'use strict'

const http = require('http')
const fs   = require('fs')
const os   = require('os')
const path = require('path')
const vm   = require('vm')

const MAINS_DIR  = path.resolve(__dirname, '..')
const SERVER_SRC = path.join(MAINS_DIR, 'server.js')

const QUIET  = process.argv.includes('--quiet')
const NO_MUT = process.argv.includes('--no-mut')

// ============================================================================
// FIXTURE — a tiny tree with a folder deliberately left OUTSIDE every circuit.
// Everything the attack suite tries to reach is `outside/secret.txt`, and the
// single question the whole file asks is whether any spelling of any request
// can produce its contents.
// ============================================================================

const SECRET = 'IF-YOU-CAN-READ-THIS-THE-CIRCUIT-LEAKED'

function buildFixture () {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mains-fixture-'))
  const safe = path.join(root, 'safe')

  fs.mkdirSync(path.join(safe, 'sub'), { recursive: true })
  fs.mkdirSync(path.join(root, 'outside'), { recursive: true })
  fs.mkdirSync(path.join(root, 'listing'), { recursive: true })

  fs.writeFileSync(path.join(root, 'outside', 'secret.txt'), SECRET)
  fs.writeFileSync(path.join(safe, 'index.html'), '<!doctype html><title>INDEX</title>ok')
  fs.writeFileSync(path.join(safe, 'page.html'), '<!doctype html><title>PAGE</title>hello')
  fs.writeFileSync(path.join(safe, 'data.json'), '{"n":1}')
  fs.writeFileSync(path.join(safe, 'blob.zzz'), 'unknown-extension-body')
  fs.writeFileSync(path.join(safe, 'sub', 'deep.txt'), 'DEEP')
  fs.writeFileSync(path.join(safe, 'sub', 'media.bin'), Buffer.from('0123456789'))
  fs.writeFileSync(path.join(root, 'listing', 'a.txt'), 'a')
  fs.mkdirSync(path.join(root, 'listing', 'zdir'), { recursive: true })

  // A junction pointing out of the circuit. Junctions do not need elevation on
  // Windows, unlike symlinks, so this normally succeeds — but if it does not,
  // the test is reported SKIPPED rather than silently passing.
  let junction = false
  try {
    fs.symlinkSync(path.join(root, 'outside'), path.join(safe, 'escape'), 'junction')
    junction = true
  } catch {
    try {
      fs.symlinkSync(path.join(root, 'outside'), path.join(safe, 'escape'), 'dir')
      junction = true
    } catch { /* no link support; reported below */ }
  }

  const cfg = path.join(root, 'circuits.json')
  fs.writeFileSync(cfg, JSON.stringify({
    port: 0,
    circuits: [
      { id: 'safe',    name: 'Safe',    root: path.join(root, 'safe') },
      { id: 'listing', name: 'Listing', root: path.join(root, 'listing') },
      { id: 'gone',    name: 'Gone',    root: path.join(root, 'no-such-folder') },
    ],
  }))

  return { root, cfg, junction }
}

// ============================================================================
// HTTP HELPERS
// ============================================================================

function request (port, target, opts) {
  opts = opts || {}
  return new Promise((resolve) => {
    const headers = Object.assign({ Host: '127.0.0.1:' + port }, opts.headers || {})
    const req = http.request({
      host: '127.0.0.1', port, path: target,
      method: opts.method || 'GET',
      headers,
      // setHost:false so our explicit Host header is not overwritten — the
      // DNS-rebinding test depends on sending a hostile one.
      setHost: false,
    }, (res) => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
        raw: Buffer.concat(chunks),
      }))
    })
    req.on('error', (e) => resolve({ status: 0, headers: {}, body: String(e.message), raw: Buffer.alloc(0) }))
    req.end()
  })
}

function startServer (mod, cfgPath) {
  const map = mod.loadCircuits(cfgPath)
  return new Promise((resolve) => {
    const state = { circuits: map.circuits, port: 0, meter: mod.newMeter(), quiet: true }
    // A mutant that throws inside the handler must fail ITS OWN assertions,
    // not take the whole run down with an uncaught exception. Answering 500
    // keeps the suite running and still goes red everywhere it matters.
    const srv = http.createServer((req, res) => {
      try {
        state.handler(req, res)
      } catch (e) {
        try {
          res.writeHead(500, { 'Content-Type': 'text/plain' })
          res.end('handler threw: ' + e.message)
        } catch { /* response already begun */ }
      }
    })
    srv.listen(0, '127.0.0.1', () => {
      state.port = srv.address().port
      state.handler = mod.makeHandler(state)
      resolve({ srv, port: state.port })
    })
  })
}

// ============================================================================
// THE SUITE
// Returns an array of failure descriptions. Empty means everything held.
// ============================================================================

async function runSuite (mod, fx, opts) {
  opts = opts || {}
  const fails = []
  const notes = []
  let checks = 0

  const ok = (cond, label) => {
    checks++
    if (!cond) fails.push(label)
    else if (!QUIET && opts.verbose) console.log('    ok   ' + label)
  }

  // ---- pure functions ----------------------------------------------------

  ok(mod.segmentIsHostile('..') === true,            'pure: ".." is hostile')
  ok(mod.segmentIsHostile('a\\b') === true,          'pure: backslash is hostile')
  ok(mod.segmentIsHostile('f.txt:s') === true,       'pure: colon (ADS) is hostile')
  ok(mod.segmentIsHostile('CON') === true,           'pure: CON is hostile')
  ok(mod.segmentIsHostile('con.txt') === true,       'pure: con.txt is hostile')
  ok(mod.segmentIsHostile('LPT9') === true,          'pure: LPT9 is hostile')
  ok(mod.segmentIsHostile('nul') === true,           'pure: nul is hostile')
  ok(mod.segmentIsHostile('file.txt ') === true,     'pure: trailing space is hostile')
  ok(mod.segmentIsHostile('file.txt.') === true,     'pure: trailing dot is hostile')
  ok(mod.segmentIsHostile('a\0b') === true,          'pure: null byte is hostile')
  ok(mod.segmentIsHostile('normal.html') === false,  'pure: an ordinary name is fine')
  ok(mod.segmentIsHostile('Blocks IG') === false,    'pure: an inner space is fine')
  ok(mod.segmentIsHostile('console.js') === false,   'pure: console.js is NOT a device')
  ok(mod.segmentIsHostile('aux-panel.css') === false,'pure: aux-panel is NOT a device')

  ok(mod.safeSegments('/a/b/c').join('/') === 'a/b/c',  'pure: plain path splits')
  ok(mod.safeSegments('/a/./b').join('/') === 'a/b',    'pure: "." is dropped')
  ok(mod.safeSegments('/a/../b') === null,              'pure: traversal refused')
  ok(mod.safeSegments('/a/%2e%2e/b') === null,          'pure: encoded traversal refused')
  ok(mod.safeSegments('/a/..%2fb') === null,            'pure: encoded slash traversal refused')
  ok(mod.safeSegments('/a/..%5cb') === null,            'pure: encoded backslash traversal refused')
  ok(mod.safeSegments('/a/%00b') === null,              'pure: encoded null refused')
  ok(mod.safeSegments('/a/%ZZ') === null,               'pure: malformed escape refused')
  ok(mod.safeSegments('/Misc%20Tools/x')[0] === 'Misc Tools', 'pure: %20 decodes to a space')

  // resolveInCircuit is tested DIRECTLY, with segments safeSegments would
  // never let through. Otherwise its containment check is dead code as far as
  // any test can tell: every hostile path is refused a layer earlier, so the
  // second lock is never tried and "it works" is an untested claim. Found by
  // a mutant that removed the check and escaped.
  const safeRoot = path.join(fx.root, 'safe')
  ok(mod.resolveInCircuit(safeRoot, ['..', 'outside', 'secret.txt']) === null,
     'resolve: escaping segments are refused even if they reach the resolver')
  ok(mod.resolveInCircuit(safeRoot, ['..']) === null,
     'resolve: the parent directory itself is refused')
  ok(mod.resolveInCircuit(safeRoot, ['sub', '..', '..', 'outside']) === null,
     'resolve: a path that only escapes after normalising is refused')
  // THE CASE ONLY THE LEXICAL CHECK COVERS, and the reason the two checks are
  // not redundant. realpath cannot inspect a file that does not exist, so for
  // an escaping path to a missing target the realpath check is skipped
  // entirely and the lexical one is the only thing standing there. Every
  // other escape test in this file happens to hit an existing file and is
  // therefore caught by the second lock — which is how a mutant that deleted
  // the first lock escaped twice before this assertion existed.
  ok(mod.resolveInCircuit(safeRoot, ['..', 'no-such-file.txt']) === null,
     'resolve: an escaping path is refused even when the target does not exist')
  ok(mod.resolveInCircuit(safeRoot, ['..', 'no-such-dir', 'x.html']) === null,
     'resolve: an escaping path through a missing directory is refused')

  ok(mod.resolveInCircuit(safeRoot, ['page.html']) !== null,
     'resolve: an ordinary file inside the circuit resolves')
  ok(mod.resolveInCircuit(safeRoot, ['not-here-yet.html']) !== null,
     'resolve: a missing file INSIDE the circuit still resolves (404 is the caller\'s job)')
  ok(mod.resolveInCircuit(safeRoot, []) !== null,
     'resolve: the circuit root itself resolves')
  ok(mod.resolveInCircuit(safeRoot, null) === null,
     'resolve: null segments (a refused path) stay refused')

  const P = path.resolve('/tmp/parent')
  ok(mod.isInside(P, path.resolve('/tmp/parent/child')) === true,  'pure: child is inside')
  ok(mod.isInside(P, P) === true,                                  'pure: self is inside')
  ok(mod.isInside(P, path.resolve('/tmp/parent-evil')) === false,  'pure: sibling prefix is NOT inside')
  ok(mod.isInside(P, path.resolve('/tmp/other')) === false,        'pure: unrelated is not inside')

  ok(mod.hostIsLoopback('127.0.0.1:1234', 1234) === true,   'pure: loopback host accepted')
  ok(mod.hostIsLoopback('localhost:1234', 1234) === true,   'pure: localhost accepted')
  ok(mod.hostIsLoopback('[::1]:1234', 1234) === true,       'pure: ipv6 loopback accepted')
  ok(mod.hostIsLoopback('evil.example:1234', 1234) === false, 'pure: foreign host refused')
  ok(mod.hostIsLoopback('127.0.0.1:9999', 1234) === false,  'pure: wrong port refused')
  ok(mod.hostIsLoopback('', 1234) === false,                'pure: empty host refused')
  ok(mod.hostIsLoopback(undefined, 1234) === false,         'pure: missing host refused')

  ok(mod.originIsAllowed({ 'sec-fetch-site': 'cross-site' }, 1) === false, 'pure: cross-site refused')
  ok(mod.originIsAllowed({ 'sec-fetch-site': 'same-origin' }, 1) === true, 'pure: same-origin allowed')
  ok(mod.originIsAllowed({ 'sec-fetch-site': 'none' }, 1) === true,        'pure: direct nav allowed')
  ok(mod.originIsAllowed({ origin: 'http://evil.example' }, 1) === false,  'pure: foreign origin refused')
  ok(mod.originIsAllowed({}, 1) === true,                                 'pure: no headers allowed (curl)')

  ok(mod.mimeFor('a.html') === 'text/html; charset=utf-8',  'pure: html mime')
  ok(mod.mimeFor('a.JS') === 'text/javascript; charset=utf-8', 'pure: mime is case-insensitive')
  ok(mod.mimeFor('a.zzz') === 'application/octet-stream',   'pure: unknown ext is octet-stream')
  ok(mod.mimeFor('noext') === 'application/octet-stream',   'pure: no ext is octet-stream')

  // ---- circuit map validation -------------------------------------------

  const tmpCfg = (obj) => {
    const p = path.join(fx.root, 'cfg-' + Math.abs(JSON.stringify(obj).length) + '-' + checks + '.json')
    fs.writeFileSync(p, JSON.stringify(obj))
    return p
  }
  const throws = (fn) => { try { fn(); return false } catch { return true } }

  ok(throws(() => mod.loadCircuits(tmpCfg({ circuits: [{ id: 'A', root: '.' }] }))),
     'map: uppercase circuit id refused')
  ok(throws(() => mod.loadCircuits(tmpCfg({ circuits: [{ id: 'a', root: '.' }, { id: 'a', root: '.' }] }))),
     'map: duplicate circuit id refused')
  ok(throws(() => mod.loadCircuits(tmpCfg({ circuits: [{ id: 'x' }] }))),
     'map: circuit with no root refused')
  ok(throws(() => mod.loadCircuits(tmpCfg({ circuits: [{ id: '_mains', root: '.' }] }))),
     'map: reserved id "_mains" refused')
  ok(throws(() => mod.loadCircuits(tmpCfg({ nope: true }))),
     'map: no circuits array refused')

  const loaded = mod.loadCircuits(fx.cfg)
  ok(loaded.circuits.length === 3,                        'map: a dead circuit is KEPT, not dropped')
  ok(loaded.circuits.find(c => c.id === 'gone').live === false, 'map: missing root marked dead')
  ok(loaded.circuits.find(c => c.id === 'gone').note === 'not found', 'map: dead circuit explains itself')

  // ---- live server -------------------------------------------------------

  const { srv, port } = await startServer(mod, fx.cfg)
  const get = (t, o) => request(port, t, o)

  try {
    // --- it serves what it should ---
    const page = await get('/safe/page.html')
    ok(page.status === 200 && page.body.includes('hello'), 'serve: a real file is served')
    ok(String(page.headers['content-type']).startsWith('text/html'), 'serve: correct content-type')
    ok(page.headers['x-content-type-options'] === 'nosniff', 'serve: nosniff on every response')
    ok(page.headers['cache-control'] === 'no-store', 'serve: no-store so edits show up')

    const idx = await get('/safe/')
    ok(idx.status === 200 && idx.body.includes('INDEX'), 'serve: directory serves index.html')

    const list = await get('/listing/')
    ok(list.status === 200 && list.body.includes('a.txt') && list.body.includes('zdir'),
       'serve: directory with no index gets a listing')

    const blob = await get('/safe/blob.zzz')
    ok(blob.headers['content-type'] === 'application/octet-stream',
       'serve: unknown extension is never guessed')

    const head = await get('/safe/page.html', { method: 'HEAD' })
    ok(head.status === 200 && head.body === '', 'serve: HEAD returns headers and no body')

    const rng = await get('/safe/sub/media.bin', { headers: { Range: 'bytes=2-5' } })
    ok(rng.status === 206 && rng.body === '2345', 'serve: range request returns the right slice')
    ok(String(rng.headers['content-range']) === 'bytes 2-5/10', 'serve: content-range is correct')

    const st = await get('/_mains/status')
    const stj = JSON.parse(st.body)
    ok(st.status === 200 && stj.mains === true, 'api: status identifies the server as mains')
    ok(Array.isArray(stj.circuits) && stj.circuits.length === 3, 'api: status reports every circuit')

    const jl = await get('/_mains/list/safe')
    const jlj = JSON.parse(jl.body)
    ok(jl.status === 200 && jlj.entries.some(e => e.name === 'page.html'),
       'api: list returns directory entries')
    ok(jlj.entries.some(e => e.name === 'sub' && e.dir === true),
       'api: list distinguishes directories')

    const shim = await get('/_mains/client.js')
    ok(shim.status === 200 && shim.body.includes('Mains.plugged') === false || shim.status === 200,
       'api: the client shim is served')
    ok(shim.body.includes('plugged'), 'api: the shim really is the shim')

    // --- THE ATTACKS. Every one of these must fail to produce SECRET. ---

    const attacks = [
      ['/safe/../outside/secret.txt',            'attack: plain traversal'],
      ['/safe/%2e%2e/outside/secret.txt',        'attack: encoded traversal'],
      ['/safe/..%2foutside/secret.txt',          'attack: encoded-slash traversal'],
      ['/safe/..%5coutside/secret.txt',          'attack: encoded-backslash traversal'],
      ['/safe/sub/../../outside/secret.txt',     'attack: deep traversal'],
      ['/safe/....//outside/secret.txt',         'attack: dot-padding traversal'],
      ['/../outside/secret.txt',                 'attack: traversal above every circuit'],
      ['/safe/..\\outside\\secret.txt',          'attack: literal backslash traversal'],
      ['/safe/%00../outside/secret.txt',         'attack: null-byte traversal'],
      ['/safe/sub/%2e%2e%2f%2e%2e%2foutside/secret.txt', 'attack: fully encoded traversal'],
    ]
    for (const [target, label] of attacks) {
      const r = await get(target)
      ok(!r.body.includes(SECRET), label + ' does not leak')
      ok(r.status >= 400, label + ' is refused with an error status')
    }

    if (fx.junction) {
      const j = await get('/safe/escape/secret.txt')
      ok(!j.body.includes(SECRET), 'attack: symlink out of the circuit does not leak')
      ok(j.status === 403, 'attack: symlink escape is refused as 403')
    } else {
      notes.push('symlink escape test SKIPPED — this machine would not create a link')
    }

    const jlEsc = await get('/_mains/list/safe/../outside')
    ok(jlEsc.status >= 400 && !jlEsc.body.includes('secret.txt'),
       'attack: the JSON list endpoint uses the same resolver')

    const dev = await get('/safe/CON')
    ok(dev.status >= 400, 'attack: a Windows device name is refused')

    const ads = await get('/safe/data.json:stream')
    ok(ads.status >= 400, 'attack: an alternate data stream is refused')

    // Ask for a filename that EXISTS in the first circuit. Asking for one that
    // does not means a server which silently fell back to circuit[0] would
    // still answer 404 and look correct — which is precisely what happened,
    // and what a mutant had to point out.
    const nocirc = await get('/nosuchcircuit/page.html')
    ok(nocirc.status === 404, 'attack: an undeclared circuit is 404, not a fallback')
    ok(!nocirc.body.includes('hello'),
       'attack: an undeclared circuit does not silently serve another circuit')

    const deadc = await get('/gone/anything.html')
    ok(deadc.status === 503, 'attack: a dead circuit is 503, and says so')

    const post = await get('/safe/page.html', { method: 'POST' })
    ok(post.status === 405, 'attack: POST is refused — this server is read-only')

    const put = await get('/safe/page.html', { method: 'PUT' })
    ok(put.status === 405, 'attack: PUT is refused')

    const del = await get('/safe/page.html', { method: 'DELETE' })
    ok(del.status === 405, 'attack: DELETE is refused')

    const rebind = await get('/safe/page.html', { headers: { Host: 'attacker.example:' + port } })
    ok(rebind.status === 403, 'attack: DNS rebinding refused via Host header')
    ok(!rebind.body.includes('hello'), 'attack: rebinding leaks nothing')

    const cross = await get('/safe/page.html', { headers: { 'Sec-Fetch-Site': 'cross-site' } })
    ok(cross.status === 403, 'attack: a cross-site fetch is refused')

    const forg = await get('/safe/page.html', { headers: { Origin: 'http://evil.example' } })
    ok(forg.status === 403, 'attack: a foreign Origin is refused')

    const badep = await get('/_mains/whatever')
    ok(badep.status === 404, 'attack: an unknown _mains endpoint is 404')

  } finally {
    await new Promise(r => srv.close(r))
  }

  // ---- the client shim, on both power sources -----------------------------
  // The central promise of this project is that an artifact still works with
  // the power cut. That promise lives entirely in client/mains.js, and it is
  // only observable from a page — so the shim is loaded here into a synthetic
  // global with a file:// location, which is the case no HTTP test can reach.

  const shimSrc = fs.readFileSync(path.join(MAINS_DIR, 'client', 'mains.js'), 'utf8')

  function loadShim (location) {
    const sandbox = { location, document: null, fetch: undefined }
    sandbox.window = sandbox
    vm.createContext(sandbox)
    vm.runInContext(shimSrc, sandbox)
    return sandbox.Mains
  }

  const onBattery = loadShim({ protocol: 'file:', hostname: '', pathname: '/C:/x/y.html', origin: 'null' })
  ok(onBattery.plugged === false,  'shim: file:// reports ON BATTERIES')
  ok(onBattery.origin === null,    'shim: no origin on batteries')
  ok(onBattery.circuit === null,   'shim: no circuit on batteries')
  ok(onBattery.url('games', 'x') === null, 'shim: url() is null on batteries')
  ok(typeof onBattery.help() === 'string', 'shim: help() works on batteries')
  ok(onBattery.when(() => 'mains', () => 'battery') === 'battery', 'shim: when() takes the battery branch')
  ok(await onBattery.status() === null,   'shim: status() resolves null, does not throw')
  ok(await onBattery.list('games') === null, 'shim: list() resolves null, does not throw')
  ok(await onBattery.read('games/x') === null, 'shim: read() resolves null, does not throw')
  ok(await onBattery.ready === null,      'shim: ready resolves null on batteries')

  const onMains = loadShim({
    protocol: 'http:', hostname: '127.0.0.1', origin: 'http://127.0.0.1:12060',
    pathname: '/games/Blocks%20IG/blocks.html',
  })
  ok(onMains.plugged === true,           'shim: loopback http reports ON THE MAINS')
  ok(onMains.circuit === 'games',        'shim: circuit read from the first path segment')
  ok(onMains.url('tools', 'Game of Life/life.html') ===
     'http://127.0.0.1:12060/tools/Game%20of%20Life/life.html',
     'shim: url() encodes each segment so folders with spaces survive')
  ok(onMains.when(() => 'mains', () => 'battery') === 'mains', 'shim: when() takes the mains branch')

  // A page served from a NON-loopback http origin is not the mains, and must
  // not be told that it is — otherwise an artifact copied to a real web host
  // would sit there fetching endpoints that are not there.
  const onStranger = loadShim({
    protocol: 'https:', hostname: 'example.com', origin: 'https://example.com', pathname: '/x.html',
  })
  ok(onStranger.plugged === false, 'shim: a non-loopback origin is NOT the mains')

  // ---- source-level invariants -------------------------------------------
  // Two properties that cannot be observed from a request against a server
  // already bound to loopback, so they are asserted against the text instead.

  const src = fs.readFileSync(SERVER_SRC, 'utf8')
  ok(/listen\(port,\s*'127\.0\.0\.1'/.test(src), 'source: binds 127.0.0.1 explicitly')
  ok(!/['"]0\.0\.0\.0['"]/.test(src),            'source: never mentions 0.0.0.0')

  return { fails, checks, notes }
}

// ============================================================================
// MUTANTS — break one defence at a time; the suite must notice each one.
// ============================================================================

const MUTANTS = [
  { name: 'traversal: ".." accepted',
    find: "if (seg === '..') return true", repl: "if (seg === '..') return false" },

  { name: 'traversal: backslash accepted',
    find: "if (seg.includes('\\\\')) return true", repl: "if (seg.includes('\\\\')) return false" },

  { name: 'traversal: colon / ADS accepted',
    find: "if (seg.includes(':')) return true", repl: "if (seg.includes(':')) return false" },

  // Null bytes are checked in two places on purpose, so breaking either one
  // alone changes nothing observable — an EQUIVALENT mutant, which escapes
  // and means nothing. The honest test of a redundant pair is to remove the
  // whole pair, which is what this does.
  { name: 'traversal: null byte accepted (both checks)',
    edits: [
      { find: "  if (decoded.includes('\\0')) return null", repl: '' },
      { find: "  if (seg.includes('\\0')) return true                // null byte",
        repl: '  if (false) return true' },
    ] },

  { name: 'windows device names accepted',
    find: 'if (WINDOWS_DEVICES.has(base)) return true', repl: 'if (false) return true' },

  { name: 'containment: isInside always true',
    find: "  const rel = path.relative(parent, child)", repl: "  if (true) return true\n  const rel = path.relative(parent, child)" },

  { name: 'containment: lexical check skipped',
    find: '  if (!isInside(rootAbs, candidate)) return null',
    repl: '  if (false) return null' },

  { name: 'containment: symlink re-check skipped',
    find: '  if (!isInside(realRoot, real)) return null          // symlink escaped',
    repl: '  if (false) return null' },

  { name: 'host header check disabled',
    find: '  if (!LOOPBACK_HOSTS.has(name)) return false', repl: '  if (false) return false' },

  { name: 'host port check disabled',
    find: "  if (given !== null && given !== '' && given !== String(port)) return false",
    repl: '  if (false) return false' },

  { name: 'cross-origin check disabled',
    find: "  if (site && site !== 'same-origin' && site !== 'none') return false",
    repl: '  if (false) return false' },

  { name: 'foreign Origin accepted',
    find: '    if (!ok.includes(String(origin).toLowerCase())) return false',
    repl: '    if (false) return false' },

  { name: 'read-only: write methods allowed',
    find: "    if (req.method !== 'GET' && req.method !== 'HEAD') {",
    repl: '    if (false) {' },

  { name: 'unknown circuit falls back to the first one',
    find: '    const circuit = byId.get(segments[0])\n    if (!circuit) return refuse(404,',
    repl: '    const circuit = byId.get(segments[0]) || circuits[0]\n    if (!circuit) return refuse(404,' },

  { name: 'dead circuit served anyway',
    find: "    if (!circuit.live) return refuse(503, 'circuit is dead: ' + circuit.note)\n\n    const rest",
    repl: '\n    const rest' },

  { name: 'mime: everything served as html',
    find: "  return MIME[path.extname(p).toLowerCase()] || 'application/octet-stream'",
    repl: "  return 'text/html; charset=utf-8'" },

  { name: 'nosniff header dropped',
    find: "    'X-Content-Type-Options': 'nosniff',", repl: '' },

  { name: 'dead circuit dropped from the map instead of reported',
    find: '    return { id: c.id, name: c.name || c.id, root: rootAbs, live, note }',
    repl: '    return live ? { id: c.id, name: c.name || c.id, root: rootAbs, live, note } : null' },
]

async function runMutants (fx) {
  const src = fs.readFileSync(SERVER_SRC, 'utf8')
  const results = []

  for (let i = 0; i < MUTANTS.length; i++) {
    const m = MUTANTS[i]
    // A mutant is one or more edits. Redundant defences need the whole pair
    // removed to be tested at all, so a single-edit mutant is only sugar for
    // an edits array of length one.
    const edits = m.edits || [{ find: m.find, repl: m.repl }]
    const missing = edits.find(e => !src.includes(e.find))
    if (missing) {
      results.push({
        name: m.name, outcome: 'STALE',
        detail: 'anchor text not found in server.js: ' + JSON.stringify(missing.find.slice(0, 52)),
      })
      continue
    }
    let mutated = src
    for (const e of edits) mutated = mutated.replace(e.find, e.repl)
    const tmpPath = path.join(MAINS_DIR, '.mutant-' + i + '.tmp.js')
    fs.writeFileSync(tmpPath, mutated)

    let caught = null
    try {
      delete require.cache[tmpPath]
      const mod = require(tmpPath)
      const r = await runSuite(mod, fx, {})
      caught = r.fails
    } catch (e) {
      caught = ['threw: ' + e.message]      // a crash is also "the suite noticed"
    } finally {
      try { fs.unlinkSync(tmpPath) } catch { /* best effort */ }
    }

    results.push({
      name: m.name,
      outcome: caught.length ? 'CAUGHT' : 'ESCAPED',
      detail: caught.length ? caught.length + ' assertion(s) went red, first: ' + caught[0] : 'no assertion noticed',
    })
  }
  return results
}

// ============================================================================
// MAIN
// ============================================================================

async function main () {
  // Clean up anything a previous crashed run left behind.
  for (const f of fs.readdirSync(MAINS_DIR)) {
    if (/^\.mutant-\d+\.tmp\.js$/.test(f)) fs.unlinkSync(path.join(MAINS_DIR, f))
  }

  const fx = buildFixture()
  let exitCode = 0

  try {
    console.log('')
    console.log('  MAINS SELFTEST')
    console.log('  ' + '-'.repeat(58))
    console.log('')

    const mod = require(SERVER_SRC)
    const base = await runSuite(mod, fx, { verbose: !QUIET && false })

    console.log('  assertions')
    console.log('    ' + base.checks + ' checks, ' + base.fails.length + ' failed')
    for (const f of base.fails) console.log('    FAIL  ' + f)
    for (const n of base.notes) console.log('    note  ' + n)
    if (base.fails.length) exitCode = 1
    console.log('')

    if (!NO_MUT) {
      console.log('  mutants')
      const results = await runMutants(fx)
      const escaped = results.filter(r => r.outcome === 'ESCAPED')
      const stale   = results.filter(r => r.outcome === 'STALE')
      for (const r of results) {
        const tag = r.outcome === 'CAUGHT' ? 'caught ' : r.outcome === 'STALE' ? 'STALE  ' : 'ESCAPED'
        if (r.outcome === 'CAUGHT' && QUIET) continue
        console.log('    ' + tag + ' ' + r.name)
        if (r.outcome !== 'CAUGHT') console.log('             ' + r.detail)
      }
      console.log('')
      console.log('    ' + results.length + ' mutants, ' + (results.length - escaped.length - stale.length) +
                  ' caught, ' + escaped.length + ' escaped, ' + stale.length + ' stale')
      if (escaped.length || stale.length) exitCode = 1
      console.log('')
    }

    console.log('  ' + '-'.repeat(58))
    console.log('  ' + (exitCode === 0 ? 'ALL HELD' : 'FAILURES ABOVE'))
    console.log('')
  } finally {
    try { fs.rmSync(fx.root, { recursive: true, force: true }) } catch { /* temp dir */ }
  }

  process.exit(exitCode)
}

main().catch(e => {
  console.error('selftest crashed: ' + (e && e.stack || e))
  process.exit(2)
})
