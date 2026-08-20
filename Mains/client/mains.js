// ============================================================================
// mains.js — the client shim. One classic script, no build step, no modules.
//
//   <script src="../../Claude Town/Mains/client/mains.js"></script>
//
// Include it with a relative path and it works from BOTH power sources, which
// is the entire point: the same file, loaded the same way, off a file:// page
// or off the server. Nothing here ever throws, and nothing here is required.
//
// THE ONE QUESTION THIS ANSWERS
//
//   if (Mains.plugged) { ...ask the tree things... }
//   else               { ...the artifact still works, with less... }
//
// `plugged` is synchronous, because the decision it drives — "may I call
// fetch()?" — has to be made while the page is building itself, and an async
// answer arrives too late to shape a UI without a flicker.
//
// AN ARTIFACT MUST NEVER REQUIRE THE MAINS. If cutting the power breaks it,
// the artifact is wrong. Every build in this tree opens by double-click and
// that property is not negotiable — it is why a page written in 2026 still
// opens in 2036 while anything with a build step does not. The mains adds a
// second, better way to open the same file. It never becomes the only way.
//
// WHAT `plugged` ACTUALLY MEANS, precisely, because a vague answer here
// produces artifacts that break in one of the two modes and nobody notices:
// the page was served over http(s) from a loopback address, so relative
// fetch() will work. It does NOT prove the server is Mains rather than some
// other local server. Await `Mains.ready` for that — it resolves to the
// status object when the server has actually identified itself, or to null.
// ============================================================================

;(function (global) {
  'use strict'

  var LOOPBACK = { '127.0.0.1': 1, 'localhost': 1, '::1': 1, '[::1]': 1 }

  var loc      = global.location || {}
  var proto    = String(loc.protocol || '')
  var host     = String(loc.hostname || '')
  var isHttp   = proto === 'http:' || proto === 'https:'
  var plugged  = isHttp && Object.prototype.hasOwnProperty.call(LOOPBACK, host)
  var origin   = plugged ? loc.origin : null

  // When served by Mains, the first path segment is the circuit this page
  // lives in. Knowing it lets a page address siblings without hardcoding
  // where it sits in the tree.
  var circuit = null
  if (plugged) {
    var segs = String(loc.pathname || '').split('/').filter(Boolean)
    if (segs.length) circuit = decodeURIComponent(segs[0])
  }

  function fail () { return null }

  function getJSON (url) {
    if (!plugged || typeof global.fetch !== 'function') return Promise.resolve(null)
    return global.fetch(url, { credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : null })
      .catch(fail)
  }

  function getText (url) {
    if (!plugged || typeof global.fetch !== 'function') return Promise.resolve(null)
    return global.fetch(url, { credentials: 'omit' })
      .then(function (r) { return r.ok ? r.text() : null })
      .catch(fail)
  }

  // Build an absolute URL into any circuit. Segments are encoded individually
  // so a folder called "Blocks IG" or "Misc Tools" survives the trip.
  function urlFor (circuitId, subPath) {
    if (!plugged) return null
    var parts = String(subPath || '').split('/').filter(Boolean).map(encodeURIComponent)
    return origin + '/' + encodeURIComponent(circuitId) + (parts.length ? '/' + parts.join('/') : '/')
  }

  var Mains = {

    // --- synchronous facts, safe to branch on during page construction ----
    plugged: plugged,
    origin:  origin,
    circuit: circuit,

    // --- confirmation: is the local server actually Mains? ----------------
    // Resolves to the status object, or null. Fired once, on load, so a page
    // that wants it does not pay a round-trip at the moment it asks.
    ready: null,

    // --- the read-only API ------------------------------------------------
    status: function () {
      return getJSON(origin + '/_mains/status')
    },

    // List a directory. `path` is "circuit" or "circuit/sub/folder".
    // Resolves to { circuit, path, entries: [{name, dir, size, mtime}] }.
    list: function (p) {
      if (!plugged) return Promise.resolve(null)
      var parts = String(p || '').split('/').filter(Boolean).map(encodeURIComponent)
      return getJSON(origin + '/_mains/list/' + parts.join('/'))
    },

    // Read a file as text, addressed the same way as list().
    read: function (p) {
      if (!plugged) return Promise.resolve(null)
      var parts = String(p || '').split('/').filter(Boolean)
      if (!parts.length) return Promise.resolve(null)
      return getText(urlFor(parts[0], parts.slice(1).join('/')))
    },

    url: urlFor,

    // Branch without an if. Returns whichever callback ran, so it can be
    // used as an expression.
    when: function (onMains, onBattery) {
      if (plugged) return typeof onMains === 'function' ? onMains(Mains) : undefined
      return typeof onBattery === 'function' ? onBattery(Mains) : undefined
    },

    // A small corner indicator, opt-in. Not injected automatically, because
    // an artifact's own design decides whether it wants a badge on it.
    badge: function (opts) {
      opts = opts || {}
      var el = document.createElement('div')
      el.textContent = plugged ? 'ON THE MAINS' : 'ON BATTERIES'
      el.title = plugged
        ? 'served by Mains at ' + origin
        : 'opened directly from disk — full function needs the mains'
      el.style.cssText = [
        'position:fixed', (opts.corner === 'left' ? 'left:10px' : 'right:10px'),
        'bottom:10px', 'z-index:99999', 'pointer-events:none',
        'font:600 9px/1 ui-monospace,Consolas,monospace', 'letter-spacing:.14em',
        'padding:5px 8px', 'border-radius:2px', 'user-select:none',
        'color:' + (plugged ? '#12100c' : '#8a7f6d'),
        'background:' + (plugged ? '#e8b33a' : 'transparent'),
        'border:1px solid ' + (plugged ? '#e8b33a' : '#3a3126'),
        'opacity:' + (plugged ? '.92' : '.55'),
      ].join(';')
      ;(document.body || document.documentElement).appendChild(el)
      return el
    },

    // Printed by design. An instance reading this file in a console should
    // not have to open the source to learn what it can call.
    help: function () {
      return [
        'Mains.plugged   ' + plugged + (plugged ? '  (' + origin + ')' : '  (file:// — on batteries)'),
        'Mains.circuit   ' + circuit,
        'Mains.ready     promise -> status object or null',
        'Mains.status()  promise -> { version, port, circuits[], meter }',
        'Mains.list(p)   promise -> { entries[] }        p = "games" or "games/Snek"',
        'Mains.read(p)   promise -> text or null',
        'Mains.url(c,p)  absolute URL into a circuit, or null',
        'Mains.when(a,b) run a() on the mains, b() on batteries',
        'Mains.badge()   inject a corner indicator',
      ].join('\n')
    },
  }

  Mains.ready = plugged ? Mains.status() : Promise.resolve(null)

  global.Mains = Mains

})(typeof window !== 'undefined' ? window : this)
