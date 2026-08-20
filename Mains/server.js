#!/usr/bin/env node
// ============================================================================
// server.js — Mains. Power for the tree.
//
//   node server.js                    energize, using mains.json
//   node server.js --port 12060       override the port
//   node server.js --config <path>    a different circuit map
//   node server.js --check            validate the map and exit, serve nothing
//   node server.js --quiet            no per-request logging
//
// WHY THIS EXISTS
// Every artifact in this tree is a page opened by double-clicking it, which
// means it runs at a `file://` origin. That is a genuinely good default — no
// install, no build step, no server, works forever, survives being emailed to
// somebody. It is also a hard ceiling. From `file://` a page cannot fetch(),
// cannot read the tree it lives in, cannot load an ES module, cannot share a
// stylesheet without either a fragile relative path or a copy that drifts, and
// cannot persist anything an instance can later grep.
//
// So the tree has two power sources, and the distinction is the whole idea:
//
//   ON BATTERIES  file://  — every artifact, forever, unchanged. Works with
//                            less. This never stops being supported and no
//                            artifact may ever *require* the mains.
//   ON THE MAINS  http://  — the same artifact, served from 127.0.0.1, with
//                            fetch, modules, a shared origin, and (pass 2) a
//                            way to write to disk.
//
// A page asks which one it is on by including client/mains.js and reading
// `Mains.plugged`. It then lights up whatever it can and degrades on its own.
// The rule that falls out, and it is the important one:
//
//   MAINS IS ADDITIVE, NEVER REQUIRED. If unplugging the server breaks an
//   artifact, the artifact is wrong, not the server. Anything built here has
//   to still open by double-click, because that property is why this
//   collection is still readable years later and a build step is not.
//
// THE SECURITY MODEL, IN ONE SENTENCE
// Nothing outside a circuit declared in mains.json is reachable, because
// resolution starts at a circuit root and any path that resolves outside one
// is refused rather than clamped. This fails closed. Every other defence in
// this file — the traversal checks, the Windows device-name list, the Host
// header check — is a second lock on a door that is already bolted, and they
// are all here because a localhost file server is exactly the kind of thing
// that is one bug away from handing out an SSH key.
//
// The threats actually defended against, since "it is only localhost" is the
// reasoning that makes these bugs:
//
//   TRAVERSAL      ../, encoded ../, backslash (Windows accepts both
//                  separators), absolute paths, UNC paths, null bytes. Never
//                  string-matched: the request is resolved, then the RESULT is
//                  proven to be inside the circuit root.
//   SYMLINKS       a link inside a circuit pointing out of it. Caught by
//                  re-checking containment after realpath, not before.
//   WINDOWS NAMES  CON, PRN, AUX, NUL, COM1-9, LPT1-9 are devices, not files,
//                  and opening one can block. Also `name:stream` alternate
//                  data streams, which is why a colon in a segment is refused.
//   DNS REBINDING  a page on the open internet can point a hostname it owns at
//                  127.0.0.1 and then read this server from the user's own
//                  browser. Defeated by requiring the Host header to be a
//                  loopback literal, which a rebound name cannot be.
//   CROSS-ORIGIN   Origin and Sec-Fetch-Site are checked, so a foreign page
//                  cannot read your files through fetch() even if it guesses
//                  the port.
//   BINDING        127.0.0.1 only, never 0.0.0.0. Nothing on the network can
//                  see this, including the phone on the same wifi.
//
// READ-ONLY, DELIBERATELY. GET and HEAD are the only methods this server
// implements. Writing to disk is a separate circuit with its own design
// problems and it does not get to ride along with the pass that turns the
// power on.
// ============================================================================

'use strict'

const http = require('http')
const fs   = require('fs')
const path = require('path')

const VERSION = '1.0.0'
const HERE    = __dirname

// ============================================================================
// SECTION 1 — PATH SAFETY
// The load-bearing part. Everything here is pure and exported, because a
// security boundary that cannot be unit-tested is a security boundary nobody
// has tested.
// ============================================================================

// Windows treats these as devices at any directory depth, with or without an
// extension. fs calls against them can block rather than error.
const WINDOWS_DEVICES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
])

// A segment is refused outright if it is any of these. This runs BEFORE any
// resolution, so nothing below ever sees a hostile segment.
function segmentIsHostile (seg) {
  if (seg === '' || seg === '.') return false        // harmless, dropped later
  if (seg === '..') return true                      // traversal
  if (seg.includes('\0')) return true                // null byte
  if (seg.includes(':')) return true                 // drive letter / ADS
  if (seg.includes('\\')) return true                // Windows separator
  if (seg.includes('/')) return true                 // already split; defensive
  // Trailing dots and spaces are stripped by the Windows filesystem, so
  // "foo.txt " and "foo.txt" name the same file and only one spelling would
  // ever have been checked. Refuse the ambiguous one.
  if (/[ .]$/.test(seg)) return true
  const base = seg.split('.')[0].toLowerCase()
  if (WINDOWS_DEVICES.has(base)) return true
  return false
}

// Split a decoded request path into safe segments, or null if any part of it
// is hostile. Decoding happens exactly once, here, so that %2e%2e and %5c are
// seen for what they are. Double-encoded input decodes to a literal "%2e%2e",
// which is not a traversal and resolves to a file of that name or a 404.
function safeSegments (rawPath) {
  let decoded
  try {
    decoded = decodeURIComponent(rawPath)
  } catch {
    return null                                       // malformed percent-escape
  }
  if (decoded.includes('\0')) return null
  const parts = decoded.split('/')
  const out = []
  for (const seg of parts) {
    if (segmentIsHostile(seg)) return null
    if (seg === '' || seg === '.') continue
    out.push(seg)
  }
  return out
}

// Is `child` the same as, or inside, `parent`? Both must be absolute.
// Uses path.relative rather than string prefixing, because a prefix test says
// C:\Projects\Games-Old is inside C:\Projects\Games.
function isInside (parent, child) {
  const rel = path.relative(parent, child)
  if (rel === '') return true
  if (rel === '..' || rel.startsWith('..' + path.sep)) return false
  if (path.isAbsolute(rel)) return false
  return true
}

// Resolve request segments against a circuit root and PROVE the result is
// still inside it. Returns an absolute path, or null.
//
// Containment is checked twice on purpose. The lexical check catches a path
// that escapes on paper. The realpath check catches a path that escapes only
// once the filesystem is consulted — a symlink or a junction — and it can only
// run on something that exists, which is why the lexical check cannot be
// skipped in favour of it.
function resolveInCircuit (rootAbs, segments) {
  if (segments === null) return null
  const candidate = path.resolve(rootAbs, ...segments)
  if (!isInside(rootAbs, candidate)) return null

  let realRoot
  try {
    realRoot = fs.realpathSync.native(rootAbs)
  } catch {
    return null                                       // circuit root is gone
  }
  let real
  try {
    real = fs.realpathSync.native(candidate)
  } catch {
    return candidate                                  // does not exist; 404 later
  }
  if (!isInside(realRoot, real)) return null          // symlink escaped
  return real
}

// ============================================================================
// SECTION 2 — ORIGIN SAFETY
// A localhost server is reachable from any page the user happens to have open.
// These two checks are what stops a foreign site from reading the tree.
// ============================================================================

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

// The Host header must name loopback literally. A DNS-rebinding attack points
// attacker.example at 127.0.0.1, so the browser connects here but still sends
// `Host: attacker.example` — which is not in the set, so it is refused.
function hostIsLoopback (hostHeader, port) {
  if (!hostHeader) return false
  const h = String(hostHeader).toLowerCase().trim()
  let name = h
  let given = null
  if (h.startsWith('[')) {
    const close = h.indexOf(']')
    if (close === -1) return false
    name = h.slice(0, close + 1)
    if (h.length > close + 1) {
      if (h[close + 1] !== ':') return false
      given = h.slice(close + 2)
    }
  } else {
    const idx = h.lastIndexOf(':')
    if (idx > -1) {
      name = h.slice(0, idx)
      given = h.slice(idx + 1)
    }
  }
  if (!LOOPBACK_HOSTS.has(name)) return false
  if (given !== null && given !== '' && given !== String(port)) return false
  return true
}

// Refuse anything a browser has labelled as coming from another site. Direct
// navigation sends `none`, our own pages send `same-origin`; a foreign page's
// fetch sends `cross-site` and gets nothing. Absent headers are allowed
// through, because curl and node send neither and the Host check already
// covers the browser case.
function originIsAllowed (headers, port) {
  const site = headers['sec-fetch-site']
  if (site && site !== 'same-origin' && site !== 'none') return false
  const origin = headers['origin']
  if (origin) {
    const ok = [
      'http://127.0.0.1:' + port,
      'http://localhost:' + port,
      'http://[::1]:' + port,
    ]
    if (!ok.includes(String(origin).toLowerCase())) return false
  }
  return true
}

// ============================================================================
// SECTION 3 — CONTENT TYPES
// Unknown extensions are served as octet-stream and every response carries
// nosniff, so a file the map does not know about can never be guessed into
// something executable by the browser.
// ============================================================================

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm':  'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map':  'application/json; charset=utf-8',
  '.txt':  'text/plain; charset=utf-8',
  '.md':   'text/plain; charset=utf-8',
  '.csv':  'text/plain; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.otf':  'font/otf',
  '.mp3':  'audio/mpeg',
  '.ogg':  'audio/ogg',
  '.wav':  'audio/wav',
  '.m4a':  'audio/mp4',
  '.mp4':  'video/mp4',
  '.webm': 'video/webm',
  '.wasm': 'application/wasm',
  '.pdf':  'application/pdf',
}

function mimeFor (p) {
  return MIME[path.extname(p).toLowerCase()] || 'application/octet-stream'
}

// The pathname, and nothing else. A request target is `/path?query#frag`, and
// everything from the first ? or # onward is not part of the file being asked
// for. Cutting it here means no later stage ever has to think about it.
function pathnameOf (target) {
  let t = String(target || '/')
  const q = t.indexOf('?')
  if (q !== -1) t = t.slice(0, q)
  const h = t.indexOf('#')
  if (h !== -1) t = t.slice(0, h)
  return t || '/'
}

// ============================================================================
// SECTION 4 — THE CIRCUIT MAP
// Loaded once at boot and validated. A dead circuit stays in the list and is
// reported; it is never dropped, because a room you can see is missing is a
// bug report and a room that quietly vanished is a mystery.
// ============================================================================

function loadCircuits (configPath) {
  const raw = fs.readFileSync(configPath, 'utf8')
  let cfg
  try {
    cfg = JSON.parse(raw)
  } catch (e) {
    throw new Error('circuit map is not valid JSON: ' + e.message)
  }
  if (!Array.isArray(cfg.circuits)) throw new Error('circuit map has no "circuits" array')

  const base = path.dirname(path.resolve(configPath))
  const seen = new Set()
  const circuits = cfg.circuits.map(c => {
    if (!c.id || !/^[a-z0-9-]+$/.test(c.id)) {
      throw new Error('circuit id must be lowercase letters, digits and dashes: ' + JSON.stringify(c.id))
    }
    if (c.id === '_mains') throw new Error('circuit id "_mains" is reserved')
    if (seen.has(c.id)) throw new Error('duplicate circuit id: ' + c.id)
    seen.add(c.id)
    if (!c.root) throw new Error('circuit "' + c.id + '" has no root')

    const rootAbs = path.resolve(base, c.root)
    let live = false
    let note = ''
    try {
      const st = fs.statSync(rootAbs)
      if (st.isDirectory()) live = true
      else note = 'not a directory'
    } catch {
      note = 'not found'
    }
    return { id: c.id, name: c.name || c.id, root: rootAbs, live, note }
  })

  return { port: cfg.port || 12060, circuits }
}

// ============================================================================
// SECTION 5 — THE METER
// Requests and bytes since the power came on. Deliberately not persisted:
// this is a gauge, not a record. Writing it to disk would make reading the
// panel a write, which is the mistake the Pet's statusline exists to not make.
// ============================================================================

function newMeter () {
  return { started: Date.now(), requests: 0, bytes: 0, refused: 0 }
}

// ============================================================================
// SECTION 6 — THE SERVER
// ============================================================================

// Headers only. Used where a body is about to be streamed — writing the
// headers and ending the response are separate acts, and conflating them once
// cost an afternoon: send() ended the response, serveFile then piped a file
// into a closed stream, and every client hung waiting for a Content-Length
// worth of bytes that could never arrive.
function writeHead (res, code, headers) {
  res.writeHead(code, Object.assign({
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  }, headers))
}

// A complete response: headers and body, finished.
function send (res, code, headers, body) {
  writeHead(res, code, headers)
  if (body === undefined || body === null) res.end()
  else res.end(body)
}

function sendText (res, code, text) {
  const buf = Buffer.from(text, 'utf8')
  send(res, code, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': buf.length }, buf)
}

function sendJSON (res, code, obj) {
  const buf = Buffer.from(JSON.stringify(obj, null, 2), 'utf8')
  send(res, code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': buf.length }, buf)
}

function htmlEscape (s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

// A plain, functional directory index. Not themed: this is a surface you land
// on by accident on the way to somewhere else.
function directoryIndex (circuit, segments, entries) {
  const here = '/' + [circuit.id, ...segments].join('/')
  const up = segments.length ? '/' + [circuit.id, ...segments.slice(0, -1)].join('/') : '/'
  const rows = entries.map(e => {
    const href = here.replace(/\/$/, '') + '/' + encodeURIComponent(e.name) + (e.dir ? '/' : '')
    return '<li class="' + (e.dir ? 'd' : 'f') + '"><a href="' + htmlEscape(href) + '">' +
           htmlEscape(e.name) + (e.dir ? '/' : '') + '</a></li>'
  }).join('\n')
  return '<!doctype html><meta charset="utf-8">' +
    '<title>' + htmlEscape(here) + '</title>' +
    '<style>body{background:#14110d;color:#d8cfc0;font:14px ui-monospace,Consolas,monospace;' +
    'padding:2rem;max-width:60rem;margin:0 auto}a{color:#e8b33a;text-decoration:none}' +
    'a:hover{text-decoration:underline}h1{font-size:1rem;font-weight:600;color:#8a7f6d;' +
    'border-bottom:1px solid #33291c;padding-bottom:.6rem}ul{list-style:none;padding:0}' +
    'li{padding:.15rem 0}li.d a{color:#7fb3d5}.up{color:#8a7f6d}</style>' +
    '<h1>' + htmlEscape(here) + '</h1>' +
    '<p class="up"><a href="' + htmlEscape(up) + '">&#8617; up</a></p><ul>' + rows + '</ul>'
}

function serveFile (req, res, abs, meter) {
  let st
  try {
    st = fs.statSync(abs)
  } catch {
    sendText(res, 404, 'not found')
    return
  }

  const type = mimeFor(abs)
  const range = req.headers['range']

  // Range support exists so <audio> and <video> can seek. Chrome will not
  // scrub a media element the server answers with a flat 200.
  if (range && /^bytes=/.test(range)) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
    if (m) {
      let start = m[1] === '' ? null : parseInt(m[1], 10)
      let end   = m[2] === '' ? null : parseInt(m[2], 10)
      if (start === null && end !== null) { start = Math.max(0, st.size - end); end = st.size - 1 }
      if (start !== null && end === null) { end = st.size - 1 }
      if (start !== null && end !== null && start <= end && start < st.size) {
        end = Math.min(end, st.size - 1)
        const len = end - start + 1
        writeHead(res, 206, {
          'Content-Type': type,
          'Content-Length': len,
          'Content-Range': 'bytes ' + start + '-' + end + '/' + st.size,
          'Accept-Ranges': 'bytes',
        })
        meter.bytes += len
        if (req.method === 'HEAD') { res.end(); return }
        fs.createReadStream(abs, { start, end }).pipe(res)
        return
      }
      send(res, 416, { 'Content-Range': 'bytes */' + st.size })
      return
    }
  }

  writeHead(res, 200, {
    'Content-Type': type,
    'Content-Length': st.size,
    'Accept-Ranges': 'bytes',
    'Last-Modified': st.mtime.toUTCString(),
  })
  meter.bytes += st.size
  if (req.method === 'HEAD') { res.end(); return }
  fs.createReadStream(abs).pipe(res)
}

function makeHandler (state) {
  const { circuits, port, meter } = state
  const quiet = state.quiet
  const byId = new Map(circuits.map(c => [c.id, c]))

  return function handler (req, res) {
    meter.requests++

    const refuse = (code, why) => {
      meter.refused++
      if (!quiet) console.log('  ' + code + '  ' + req.method + ' ' + req.url + '   (' + why + ')')
      sendText(res, code, why)
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD')
      return refuse(405, 'mains is read-only')
    }
    if (!hostIsLoopback(req.headers['host'], port)) {
      return refuse(403, 'host must be loopback')
    }
    if (!originIsAllowed(req.headers, port)) {
      return refuse(403, 'cross-origin requests are refused')
    }

    // Split the pathname off by hand rather than with url.parse(), which node
    // has deprecated specifically because its behaviour is non-standard in
    // ways with security implications — not a dependency this file wants.
    const rawPath = pathnameOf(req.url)

    // --- the panel -------------------------------------------------------
    if (rawPath === '/' || rawPath === '/index.html') {
      const abs = path.join(HERE, 'panel.html')
      if (!fs.existsSync(abs)) return sendText(res, 200, 'MAINS LIVE - panel.html is missing')
      if (!quiet) console.log('  200  ' + req.method + ' /  (panel)')
      return serveFile(req, res, abs, meter)
    }

    // --- the machine-facing surface --------------------------------------
    if (rawPath === '/_mains/status') {
      if (!quiet) console.log('  200  ' + req.method + ' ' + rawPath)
      return sendJSON(res, 200, {
        mains: true,
        version: VERSION,
        port,
        uptimeSeconds: Math.round((Date.now() - meter.started) / 1000),
        meter: { requests: meter.requests, bytes: meter.bytes, refused: meter.refused },
        circuits: circuits.map(c => ({ id: c.id, name: c.name, live: c.live, note: c.note })),
      })
    }
    if (rawPath === '/_mains/client.js') {
      const abs = path.join(HERE, 'client', 'mains.js')
      if (!fs.existsSync(abs)) return refuse(404, 'client shim missing')
      return serveFile(req, res, abs, meter)
    }
    if (rawPath.startsWith('/_mains/list/')) {
      return handleList(req, res, rawPath.slice('/_mains/list/'.length), byId, meter, refuse)
    }
    if (rawPath === '/_mains/list' || rawPath.startsWith('/_mains/')) {
      return refuse(404, 'no such mains endpoint')
    }

    // --- circuits ---------------------------------------------------------
    const segments = safeSegments(rawPath)
    if (segments === null) return refuse(400, 'refused path')
    if (segments.length === 0) return refuse(404, 'not found')

    const circuit = byId.get(segments[0])
    if (!circuit) return refuse(404, 'no such circuit')
    if (!circuit.live) return refuse(503, 'circuit is dead: ' + circuit.note)

    const rest = segments.slice(1)
    const abs = resolveInCircuit(circuit.root, rest)
    if (abs === null) return refuse(403, 'outside the circuit')

    let st
    try {
      st = fs.statSync(abs)
    } catch {
      return refuse(404, 'not found')
    }

    if (st.isDirectory()) {
      const idx = path.join(abs, 'index.html')
      if (fs.existsSync(idx)) {
        if (!quiet) console.log('  200  ' + req.method + ' ' + rawPath + '  (index)')
        return serveFile(req, res, idx, meter)
      }
      let entries
      try {
        entries = fs.readdirSync(abs, { withFileTypes: true })
          .filter(d => !d.name.startsWith('.'))
          .map(d => ({ name: d.name, dir: d.isDirectory() }))
          .sort((a, b) => (Number(b.dir) - Number(a.dir)) || a.name.localeCompare(b.name))
      } catch {
        return refuse(403, 'cannot read directory')
      }
      const body = Buffer.from(directoryIndex(circuit, rest, entries), 'utf8')
      if (!quiet) console.log('  200  ' + req.method + ' ' + rawPath + '  (listing)')
      meter.bytes += body.length
      return send(res, 200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length }, body)
    }

    if (!quiet) console.log('  200  ' + req.method + ' ' + rawPath)
    return serveFile(req, res, abs, meter)
  }
}

// A read-only directory listing as JSON, for pages that want to scan the tree
// live rather than through a generated manifest. Same resolution path as a
// file request — it does not get its own, weaker, copy of the safety checks.
function handleList (req, res, target, byId, meter, refuse) {
  const segments = safeSegments('/' + target)
  if (segments === null) return refuse(400, 'refused path')
  if (segments.length === 0) return refuse(400, 'name a circuit')

  const circuit = byId.get(segments[0])
  if (!circuit) return refuse(404, 'no such circuit')
  if (!circuit.live) return refuse(503, 'circuit is dead: ' + circuit.note)

  const abs = resolveInCircuit(circuit.root, segments.slice(1))
  if (abs === null) return refuse(403, 'outside the circuit')

  let entries
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true }).map(d => {
      let size = null
      let mtime = null
      try {
        const st = fs.statSync(path.join(abs, d.name))
        size = st.size
        mtime = st.mtime.toISOString()
      } catch { /* unreadable entry is still listed, without stats */ }
      return { name: d.name, dir: d.isDirectory(), size, mtime }
    }).sort((a, b) => (Number(b.dir) - Number(a.dir)) || a.name.localeCompare(b.name))
  } catch {
    return refuse(404, 'not a readable directory')
  }
  return sendJSON(res, 200, {
    circuit: circuit.id,
    path: segments.slice(1).join('/'),
    entries,
  })
}

// ============================================================================
// SECTION 7 — CLI
// ============================================================================

function parseArgs (argv) {
  const out = { config: path.join(HERE, 'mains.json'), port: null, check: false, quiet: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--config') out.config = argv[++i]
    else if (a === '--port') out.port = parseInt(argv[++i], 10)
    else if (a === '--check') out.check = true
    else if (a === '--quiet') out.quiet = true
    else if (a === '--help' || a === '-h') out.help = true
  }
  return out
}

function main () {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log([
      'mains — power for the tree',
      '',
      '  node server.js                 energize, using mains.json',
      '  node server.js --port N        override the port',
      '  node server.js --config PATH   a different circuit map',
      '  node server.js --check         validate the map and exit',
      '  node server.js --quiet         no per-request logging',
      '',
      'read-only. GET and HEAD only. binds 127.0.0.1 only.',
    ].join('\n'))
    return
  }

  let map
  try {
    map = loadCircuits(args.config)
  } catch (e) {
    console.error('mains: ' + e.message)
    process.exit(2)
  }

  const port = args.port || map.port
  const dead = map.circuits.filter(c => !c.live)

  if (args.check) {
    for (const c of map.circuits) {
      console.log((c.live ? '  live  ' : '  DEAD  ') + c.id.padEnd(8) + c.root + (c.live ? '' : '   (' + c.note + ')'))
    }
    console.log('')
    console.log(map.circuits.length + ' circuits, ' + dead.length + ' dead, port ' + port)
    process.exit(dead.length ? 1 : 0)
  }

  const state = { circuits: map.circuits, port, meter: newMeter(), quiet: args.quiet }
  const server = http.createServer(makeHandler(state))

  server.on('error', e => {
    if (e.code === 'EADDRINUSE') {
      console.error('mains: port ' + port + ' is already in use — the power may already be on.')
      console.error('       open http://127.0.0.1:' + port + '/ to check.')
      process.exit(3)
    }
    console.error('mains: ' + e.message)
    process.exit(3)
  })

  // 127.0.0.1 and never 0.0.0.0. Nothing on the network can reach this.
  server.listen(port, '127.0.0.1', () => {
    console.log('')
    console.log('  MAINS LIVE   http://127.0.0.1:' + port + '/')
    console.log('')
    for (const c of map.circuits) {
      console.log('   ' + (c.live ? '\u25cf' : '\u25cb') + ' ' + c.id.padEnd(8) +
                  (c.live ? '/' + c.id + '/' : 'DEAD \u2014 ' + c.note))
    }
    console.log('')
    if (dead.length) console.log('  ' + dead.length + ' dead circuit(s) \u2014 reported, not dropped.')
    console.log('  read-only \u00b7 loopback only \u00b7 ctrl-c to cut the power')
    console.log('')
  })

  const cut = () => {
    console.log('\n  power cut.')
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 500).unref()
  }
  process.on('SIGINT', cut)
  process.on('SIGTERM', cut)
}

module.exports = {
  VERSION,
  segmentIsHostile, safeSegments, isInside, resolveInCircuit,
  hostIsLoopback, originIsAllowed, mimeFor, pathnameOf,
  loadCircuits, newMeter, makeHandler, WINDOWS_DEVICES,
}

if (require.main === module) main()
