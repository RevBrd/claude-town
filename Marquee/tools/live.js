// ============================================================================
// live.js — the second reader. Derives the manifest IN THE BROWSER, over Mains.
//
//   <script src="tools/derive.js"></script>
//   <script src="tools/live.js"></script>
//   MarqueeLive.derive().then(r => { ... })
//
// WHY THIS IS NOT A SECOND SCAN
// The whole architecture of this project is that a second copy of a list
// drifts from the first. A second copy of the *scan* would drift exactly the
// same way and be far harder to notice, because both copies would look
// plausible and only disagree on the folders nobody checks.
//
// So there is one derivation — tools/derive.js — and it runs here verbatim.
// This file supplies nothing but bytes: the four primitives behind derive.js's
// I/O seam, backed by Mains instead of by fs. Every rule about ambiguity,
// declarations, catalog headers and drift is the same code making the same
// decisions. The terminal and the page cannot disagree, because disagreeing
// would require running different code.
//
// THE SYNC/ASYNC PROBLEM, AND HOW IT IS SOLVED
// derive.js is synchronous, as it should be — it is a fold over a tree, and
// making it async would infect every function in the file for no gain under
// node. But the browser can only fetch asynchronously.
//
// The resolution is to run the derivation REPEATEDLY against a growing
// snapshot. Each pass answers every read from the snapshot; anything not in
// the snapshot is recorded as a MISS and answered with a neutral placeholder.
// Then every miss is fetched at once, and the pass runs again. The loop ends
// when a pass completes having missed NOTHING.
//
//   THAT TERMINATION CONDITION IS THE CORRECTNESS ARGUMENT, not a heuristic.
//   A pass with zero misses read only real data, so its result is exactly what
//   node would have produced. Placeholders can never leak into the output,
//   because any pass that saw one is thrown away in full.
//
// It converges in as many passes as the read-dependency chain is deep — four,
// in practice: venue, wing roots, folder contents, then the docs and titles
// inside them.
// ============================================================================

;(function (global) {
  'use strict'

  var CONCURRENCY = 12          // parallel fetches per round; localhost is fast
  var MAX_PASSES  = 12          // a backstop; real convergence is ~4

  // ---- posix-ifying Windows paths ---------------------------------------
  // derive.js's browser path shim is posix. A Windows absolute path becomes
  // "/C:/Users/..." so that it has a leading slash and one separator, which is
  // all the shim needs to resolve "../.." correctly. The mapping is
  // reversible and never leaves this file.
  function toPosix (p) {
    var s = String(p).replace(/\\/g, '/')
    if (/^[A-Za-z]:/.test(s)) s = '/' + s
    return s
  }

  function lower (s) { return String(s).toLowerCase() }

  // ---- the circuit map, from the server ---------------------------------
  // Which real directory is behind which URL. Derived from /_mains/status,
  // never hardcoded — a hardcoded copy would be one more list to drift.
  function CircuitMap (circuits) {
    this.rows = circuits
      .filter(function (c) { return c.live && c.root })
      .map(function (c) { return { id: c.id, root: toPosix(c.root).replace(/\/+$/, '') } })
      // Longest root first, so a nested circuit wins over the one containing
      // it. Misc Tools/Claudelings must not be served as part of Misc Tools,
      // or its own catalog would never be read.
      .sort(function (a, b) { return b.root.length - a.root.length })
  }

  // An absolute posix path -> a Mains URL, or null if it is in no circuit.
  // Windows is case-insensitive, so the comparison is too; the URL is built
  // from the ORIGINAL casing, because the server resolves against a real
  // filesystem that may care.
  CircuitMap.prototype.urlFor = function (absPosix) {
    var p = String(absPosix).replace(/\/+$/, '')
    for (var i = 0; i < this.rows.length; i++) {
      var row = this.rows[i]
      if (lower(p) === lower(row.root)) return '/' + row.id + '/'
      if (lower(p).indexOf(lower(row.root) + '/') === 0) {
        var rel = p.slice(row.root.length + 1)
        return '/' + row.id + '/' + rel.split('/').map(encodeURIComponent).join('/')
      }
    }
    return null
  }

  CircuitMap.prototype.listUrlFor = function (absPosix) {
    var u = this.urlFor(absPosix)
    if (u === null) return null
    return '/_mains/list/' + u.replace(/^\//, '').replace(/\/$/, '')
  }

  // ---- the snapshot -----------------------------------------------------

  function Snapshot (map) {
    this.map = map
    this.dirs  = {}       // path -> entries[] | null(not a directory)
    this.texts = {}       // path|maxBytes -> string | null
    this.stats = {}       // path -> {size, mtime} | null
    this.exists = {}      // path -> boolean
    this.misses = {}      // key -> request descriptor, cleared each pass
    this.missCount = 0
    this.fetched = 0
  }

  Snapshot.prototype.miss = function (key, req) {
    if (!this.misses[key]) { this.misses[key] = req; this.missCount++ }
  }

  // The four primitives. Every placeholder returned here is chosen so that
  // derive.js keeps running rather than throwing — a pass that dies early
  // discovers only the misses before the throw, which would turn convergence
  // from four passes into one per file.
  Snapshot.prototype.io = function () {
    var self = this
    return {
      name: 'mains',

      readDir: function (p) {
        if (Object.prototype.hasOwnProperty.call(self.dirs, p)) return self.dirs[p]
        self.miss('dir:' + p, { kind: 'dir', path: p })
        return []                       // "empty for now", never "unreadable"
      },

      readText: function (p, maxBytes) {
        var key = p + '\u0000' + (maxBytes == null ? 'all' : maxBytes)
        if (Object.prototype.hasOwnProperty.call(self.texts, key)) return self.texts[key]
        self.miss('text:' + key, { kind: 'text', path: p, maxBytes: maxBytes })
        return null                     // "no such doc" is a state derive.js handles
      },

      exists: function (p) {
        if (Object.prototype.hasOwnProperty.call(self.exists, p)) return self.exists[p]
        self.miss('stat:' + p, { kind: 'stat', path: p })
        // OPTIMISTIC ON PURPOSE. deriveWing throws on a missing root, and a
        // throw would abort the pass before it could record what else it
        // needed. Optimism is safe because no pass containing a miss is ever
        // used for anything.
        return true
      },

      stat: function (p) {
        if (Object.prototype.hasOwnProperty.call(self.stats, p)) return self.stats[p]
        self.miss('stat:' + p, { kind: 'stat', path: p })
        return null                     // derive.js leaves size/date null
      },
    }
  }

  // ---- fetching ---------------------------------------------------------

  function getJSON (url) {
    return fetch(url, { credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : null })
      .catch(function () { return null })
  }

  Snapshot.prototype.fetchOne = function (req) {
    var self = this
    var url

    if (req.kind === 'dir') {
      url = this.map.listUrlFor(req.path)
      if (url === null) { self.dirs[req.path] = null; return Promise.resolve() }
      return getJSON(url).then(function (data) {
        self.fetched++
        // A path outside every circuit, or simply not a directory, records as
        // null — which is what fs would have produced, and which derive.js
        // already treats as "not readable".
        if (!data || !data.entries) { self.dirs[req.path] = null; return }

        self.dirs[req.path] = data.entries.map(function (e) {
          return { name: e.name, isDirectory: !!e.dir, isFile: !e.dir }
        })

        // A listing already carries size and mtime for every child, so fill
        // their stats in from here rather than issuing a HEAD each.
        //
        // This is not only an optimisation. HTTP's Last-Modified is RFC 1123,
        // which has ONE-SECOND granularity, so a HEAD-derived mtime lands on
        // .000Z and the live manifest disagreed with the node one on every
        // single entry. The JSON listing carries a full-precision ISO string.
        // Caught by diffing the two manifests, which is exactly why that
        // comparison is now an assertion in the suite.
        for (var i = 0; i < data.entries.length; i++) {
          var e = data.entries[i]
          var childPath = req.path.replace(/\/+$/, '') + '/' + e.name
          self.exists[childPath] = true
          self.stats[childPath] = (e.size == null && e.mtime == null)
            ? null
            : { size: e.size, mtime: e.mtime }
        }
      })
    }

    if (req.kind === 'text') {
      url = this.map.urlFor(req.path)
      var key = req.path + '\u0000' + (req.maxBytes == null ? 'all' : req.maxBytes)
      if (url === null) { self.texts[key] = null; return Promise.resolve() }
      var opts = { credentials: 'omit' }
      // A Range request for a bounded read, so sniffing a <title> out of a
      // 47 KB game does not pull 47 KB. Mains answers 206 for these; this is
      // the one place its range support is load-bearing rather than polite.
      if (req.maxBytes != null) opts.headers = { Range: 'bytes=0-' + (req.maxBytes - 1) }
      return fetch(url, opts).then(function (r) {
        self.fetched++
        if (!r.ok) { self.texts[key] = null; return null }
        return r.text().then(function (t) { self.texts[key] = t })
      }).catch(function () { self.texts[key] = null })
    }

    // stat: one HEAD answers both `exists` and `stat`, since Mains returns
    // Content-Length and Last-Modified on a HEAD.
    url = this.map.urlFor(req.path)
    if (url === null) {
      self.exists[req.path] = false
      self.stats[req.path] = null
      return Promise.resolve()
    }
    return fetch(url, { method: 'HEAD', credentials: 'omit' }).then(function (r) {
      self.fetched++
      if (!r.ok) {
        self.exists[req.path] = false
        self.stats[req.path] = null
        return
      }
      self.exists[req.path] = true
      var len = r.headers.get('content-length')
      var mod = r.headers.get('last-modified')
      self.stats[req.path] = {
        size: len == null ? null : parseInt(len, 10),
        mtime: mod ? new Date(mod).toISOString() : null,
      }
    }).catch(function () {
      self.exists[req.path] = false
      self.stats[req.path] = null
    })
  }

  Snapshot.prototype.fetchAll = function (reqs) {
    var self = this
    var queue = reqs.slice()
    function worker () {
      if (!queue.length) return Promise.resolve()
      return self.fetchOne(queue.shift()).then(worker)
    }
    var lanes = []
    for (var i = 0; i < Math.min(CONCURRENCY, queue.length); i++) lanes.push(worker())
    return Promise.all(lanes)
  }

  // ---- the loop ---------------------------------------------------------

  function derive (opts) {
    opts = opts || {}
    var D = global.MarqueeDerive
    if (!D) return Promise.reject(new Error('derive.js is not loaded'))
    if (!global.Mains || !global.Mains.plugged) {
      return Promise.reject(new Error('not on the mains'))
    }

    return global.Mains.status().then(function (status) {
      if (!status) throw new Error('mains did not answer')

      var map = new CircuitMap(status.circuits)

      // Where does this page actually live on disk? Derived, not configured:
      // the first path segment names our circuit, the status names that
      // circuit's real root, and the rest of the URL is the way down from it.
      var segs = global.location.pathname.split('/').filter(Boolean)
      var circuitId = decodeURIComponent(segs[0] || '')
      var row = null
      for (var i = 0; i < status.circuits.length; i++) {
        if (status.circuits[i].id === circuitId) row = status.circuits[i]
      }
      if (!row || !row.root) throw new Error('this page is not inside a known circuit')

      var within = segs.slice(1, -1).map(decodeURIComponent).join('/')   // drop the filename
      var hereAbs = toPosix(row.root).replace(/\/+$/, '') + (within ? '/' + within : '')

      D.posixPath.cwd = hereAbs
      var venuePath = opts.venue || (hereAbs + '/venue.json')

      var snap = new Snapshot(map)
      var previousIO = D.setIO(snap.io())
      var passes = 0

      function pass () {
        snap.misses = {}
        snap.missCount = 0

        var manifest = null
        var thrown = null
        try {
          manifest = D.deriveVenue({ venue: venuePath })
        } catch (e) {
          thrown = e
        }
        passes++

        if (snap.missCount === 0) {
          // A pass that missed nothing read only real data. If it still threw,
          // the tree genuinely is in that state and the error is the answer.
          D.setIO(previousIO)
          if (thrown) throw thrown
          return { manifest: manifest, passes: passes, requests: snap.fetched }
        }

        if (passes >= MAX_PASSES) {
          D.setIO(previousIO)
          throw new Error('live derivation did not converge in ' + MAX_PASSES + ' passes')
        }

        var pending = []
        for (var k in snap.misses) {
          if (Object.prototype.hasOwnProperty.call(snap.misses, k)) pending.push(snap.misses[k])
        }
        return snap.fetchAll(pending).then(pass)
      }

      return Promise.resolve().then(pass).catch(function (e) {
        D.setIO(previousIO)      // never leave the shared module holding our reader
        throw e
      })
    })
  }

  global.MarqueeLive = {
    derive: derive,
    CircuitMap: CircuitMap,
    Snapshot: Snapshot,
    toPosix: toPosix,
    MAX_PASSES: MAX_PASSES,
  }

})(typeof window !== 'undefined' ? window : this)
