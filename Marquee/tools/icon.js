#!/usr/bin/env node
/* Marquee's sign, as an .ico.
 *
 *   node tools/icon.js            write marquee.ico
 *   node tools/icon.js --png 256  also write marquee-256.png, to look at
 *
 * A GENERATOR RATHER THAN A CHECKED-IN BLOB, for the same reason the posters
 * are printed rather than drawn: a binary nobody can regenerate is a binary
 * nobody can change. The palette below is read from marquee.html's tunables
 * block, so the icon and the page cannot drift into two different houses.
 *
 * No image library and no npm install. A PNG is a zlib stream with four
 * chunks and a CRC, and node has zlib built in; an .ico is a six-byte header,
 * a directory, and the PNGs. That is the whole dependency story.
 */
'use strict';

var fs   = require('fs');
var path = require('path');
var zlib = require('zlib');

var HERE = __dirname;
var ROOT = path.join(HERE, '..');

/* ------------------------------------------------------- the house palette */
/* Read out of marquee.html rather than retyped, so a change to the tunables
 * block reaches the sign on the next run. A missing variable is reported, not
 * silently defaulted -- a sign in the wrong colours should be loud. */
function palette() {
  var css = fs.readFileSync(path.join(ROOT, 'marquee.html'), 'utf8');
  var want = ['night', 'brick', 'line', 'bulb', 'bulb-hot', 'board', 'board-letter'];
  var out = {}, missing = [];
  want.forEach(function (name) {
    var m = css.match(new RegExp('--' + name + '\\s*:\\s*(#[0-9a-fA-F]{3,8})'));
    if (!m) { missing.push(name); return; }
    out[name] = hex(m[1]);
  });
  if (missing.length) {
    throw new Error('marquee.html no longer declares: ' + missing.join(', ') +
                    '. The icon reads its colours from there on purpose; ' +
                    'update this list rather than hardcoding them here.');
  }
  return out;
}

function hex(h) {
  h = h.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16),
          parseInt(h.slice(4, 6), 16)];
}

/* ------------------------------------------------------------- the canvas */
/* Everything is drawn at SS times the final size and box-filtered down, which
 * is the whole of the anti-aliasing. At 16px the sign is four bulbs and a bar,
 * and without this it is four bulbs and a bar with the jaggies. */
var SS = 4;

function Canvas(w) {
  this.w = w;
  this.px = new Float64Array(w * w * 3);
}

Canvas.prototype.blend = function (x, y, c, a) {
  if (a <= 0 || x < 0 || y < 0 || x >= this.w || y >= this.w) return;
  if (a > 1) a = 1;
  var i = (y * this.w + x) * 3;
  this.px[i]     = this.px[i]     * (1 - a) + c[0] * a;
  this.px[i + 1] = this.px[i + 1] * (1 - a) + c[1] * a;
  this.px[i + 2] = this.px[i + 2] * (1 - a) + c[2] * a;
};

Canvas.prototype.fill = function (c) {
  for (var i = 0; i < this.px.length; i += 3) {
    this.px[i] = c[0]; this.px[i + 1] = c[1]; this.px[i + 2] = c[2];
  }
};

Canvas.prototype.rect = function (x0, y0, x1, y1, c, a) {
  for (var y = Math.floor(y0); y < Math.ceil(y1); y++) {
    for (var x = Math.floor(x0); x < Math.ceil(x1); x++) this.blend(x, y, c, a === undefined ? 1 : a);
  }
};

/* Scanline fill. Points are [x, y] in pixels, wound in any direction. */
Canvas.prototype.poly = function (pts, c, a) {
  var ys = pts.map(function (p) { return p[1]; });
  var top = Math.max(0, Math.floor(Math.min.apply(null, ys)));
  var bot = Math.min(this.w, Math.ceil(Math.max.apply(null, ys)));
  for (var y = top; y < bot; y++) {
    var cy = y + 0.5, xs = [];
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i], q = pts[(i + 1) % pts.length];
      if ((p[1] <= cy && q[1] > cy) || (q[1] <= cy && p[1] > cy)) {
        xs.push(p[0] + (cy - p[1]) / (q[1] - p[1]) * (q[0] - p[0]));
      }
    }
    xs.sort(function (m, n) { return m - n; });
    for (var k = 0; k + 1 < xs.length; k += 2) {
      for (var x = Math.floor(xs[k]); x < Math.ceil(xs[k + 1]); x++) {
        this.blend(x, y, c, a === undefined ? 1 : a);
      }
    }
  }
};

Canvas.prototype.disc = function (cx, cy, r, c, a) {
  for (var y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (var x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      var dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r * r) this.blend(x, y, c, a === undefined ? 1 : a);
    }
  }
};

/* A soft halo, so a lit bulb reads as lit rather than as a dot. */
Canvas.prototype.glow = function (cx, cy, r, c, strength) {
  for (var y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (var x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      var dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      var d = Math.sqrt(dx * dx + dy * dy) / r;
      if (d < 1) this.blend(x, y, c, strength * (1 - d) * (1 - d));
    }
  }
};

Canvas.prototype.downsample = function (n) {
  var out = Buffer.alloc(n * n * 4);
  var f = this.w / n;
  for (var y = 0; y < n; y++) {
    for (var x = 0; x < n; x++) {
      var r = 0, g = 0, b = 0, count = 0;
      for (var sy = Math.floor(y * f); sy < Math.floor((y + 1) * f); sy++) {
        for (var sx = Math.floor(x * f); sx < Math.floor((x + 1) * f); sx++) {
          var i = (sy * this.w + sx) * 3;
          r += this.px[i]; g += this.px[i + 1]; b += this.px[i + 2]; count++;
        }
      }
      var o = (y * n + x) * 4;
      out[o]     = Math.round(r / count);
      out[o + 1] = Math.round(g / count);
      out[o + 2] = Math.round(b / count);
      out[o + 3] = 255;
    }
  }
  return out;
};

/* ---------------------------------------------------------------- the sign */

/* A projecting marquee seen head-on: the canopy, a row of bulbs under its lip,
 * and the reader board below. Detail is dropped by size rather than scaled
 * down into mud -- at 16 pixels a row of eight bulbs is a grey smear, so there
 * are four, and the board's lettering is not drawn at all. */
function drawSign(n, P) {
  var w = n * SS;
  var c = new Canvas(w);
  var u = function (v) { return v * w; };     /* unit -> pixels */

  c.fill(P.night);

  /* the street glow behind the sign */
  c.glow(u(0.5), u(0.32), u(0.80), P['bulb-hot'], 0.22);

  var detail = n >= 32;
  var bulbs  = n >= 48 ? 9 : (n >= 32 ? 7 : 4);

  /* The canopy: wider at the bottom, because you are standing under it. */
  var top = 0.20, lip = 0.46;

  /* A RIM FIRST, then the body inside it. Without this the whole canopy is
   * near-black on near-black and the 16px icon is a row of bulbs floating over
   * nothing -- checked on a magnified contact sheet rather than guessed at,
   * because a silhouette that fails only at 16px fails exactly where an icon
   * is actually looked at. */
  c.poly([[u(0.185), u(top - 0.018)], [u(0.815), u(top - 0.018)],
          [u(0.955), u(lip + 0.012)], [u(0.045), u(lip + 0.012)]], P.line);

  c.poly([[u(0.20), u(top)], [u(0.80), u(top)],
          [u(0.94), u(lip)], [u(0.06), u(lip)]], P.brick);

  /* The lit face of it. */
  c.poly([[u(0.235), u(top + 0.035)], [u(0.765), u(top + 0.035)],
          [u(0.875), u(lip - 0.055)], [u(0.125), u(lip - 0.055)]], P.board);

  /* The lip the bulbs are screwed into: one bright horizontal, which is the
   * strongest small-size cue there is and survives to 16px intact. */
  c.poly([[u(0.115), u(lip - 0.05)], [u(0.885), u(lip - 0.05)],
          [u(0.925), u(lip - 0.005)], [u(0.075), u(lip - 0.005)]], P.bulb, 0.30);

  if (detail) {
    /* MARQUEE, as three bars of changeable letters — unreadable at any size
     * this is used, and that is fine: it is texture that says "words". */
    c.rect(u(0.30), u(0.27), u(0.70), u(0.305), P['board-letter'], 0.85);
    c.rect(u(0.27), u(0.33), u(0.73), u(0.365), P['board-letter'], 0.55);
  }

  /* The bulbs under the lip. TWO ARE OUT AND THEY STAY OUT — the page does the
   * same thing for the same reason: a sign with every bulb lit is a rendering,
   * not a sign. Which two is fixed, never random, so the icon is byte-identical
   * on every run and a rebuild is not a diff. */
  var dead = { 2: true, 6: true };
  var y = lip + 0.045;
  for (var i = 0; i < bulbs; i++) {
    var t = (i + 0.5) / bulbs;
    var x = 0.10 + t * 0.80;
    var r = u(n >= 48 ? 0.032 : 0.038);
    if (dead[i] && bulbs > 4) {
      c.disc(u(x), u(y), r, P.line);
    } else {
      c.glow(u(x), u(y), r * 3.2, P['bulb-hot'], 0.5);
      c.disc(u(x), u(y), r, P.bulb);
    }
  }

  /* The reader board underneath, where what is playing is announced. */
  if (detail) {
    c.rect(u(0.16), u(0.60), u(0.84), u(0.84), P.board);
    c.rect(u(0.16), u(0.595), u(0.84), u(0.617), P.line);
    c.rect(u(0.21), u(0.655), u(0.79), u(0.695), P['board-letter'], 0.80);
    c.rect(u(0.25), u(0.735), u(0.75), u(0.775), P['board-letter'], 0.55);
  } else {
    c.rect(u(0.16), u(0.60), u(0.84), u(0.84), P.board);
    c.rect(u(0.24), u(0.66), u(0.76), u(0.72), P['board-letter'], 0.75);
  }

  return c.downsample(n);
}

/* ------------------------------------------------------------------- png */

var CRC = (function () {
  var t = new Int32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  var c = 0xFFFFFFFF;
  for (var i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  var len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  var body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  var crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function png(rgba, n) {
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0);
  ihdr.writeUInt32BE(n, 4);
  ihdr[8] = 8;    /* bit depth */
  ihdr[9] = 6;    /* colour type: RGBA */

  /* One filter byte per scanline, always zero. Filtering would compress a
     little better and this is a 60KB file. */
  var raw = Buffer.alloc(n * (n * 4 + 1));
  for (var y = 0; y < n; y++) {
    raw[y * (n * 4 + 1)] = 0;
    rgba.copy(raw, y * (n * 4 + 1) + 1, y * n * 4, (y + 1) * n * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ------------------------------------------------------------------- ico */

/* Six-byte header, then one 16-byte directory entry per image, then the
 * payloads. The images are PNGs rather than BMPs, which Windows has accepted
 * since Vista and which means one encoder instead of two. */
function ico(images) {
  var head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);              /* reserved */
  head.writeUInt16LE(1, 2);              /* 1 = icon */
  head.writeUInt16LE(images.length, 4);

  var dir = Buffer.alloc(16 * images.length);
  var offset = 6 + dir.length;
  images.forEach(function (im, i) {
    var e = i * 16;
    dir[e]     = im.size >= 256 ? 0 : im.size;   /* 0 means 256 */
    dir[e + 1] = im.size >= 256 ? 0 : im.size;
    dir[e + 2] = 0;                              /* palette size */
    dir[e + 3] = 0;                              /* reserved */
    dir.writeUInt16LE(1, e + 4);                 /* colour planes */
    dir.writeUInt16LE(32, e + 6);                /* bits per pixel */
    dir.writeUInt32LE(im.data.length, e + 8);
    dir.writeUInt32LE(offset, e + 12);
    offset += im.data.length;
  });

  return Buffer.concat([head, dir].concat(images.map(function (im) { return im.data; })));
}

/* ------------------------------------------------------------------ main */

var SIZES = [16, 24, 32, 48, 64, 128, 256];

function build() {
  var P = palette();
  return SIZES.map(function (n) {
    return { size: n, data: png(drawSign(n, P), n) };
  });
}

module.exports = { build: build, ico: ico, png: png, crc32: crc32,
                   palette: palette, drawSign: drawSign, SIZES: SIZES };

if (require.main === module) {
  var images = build();
  var out = path.join(ROOT, 'marquee.ico');
  fs.writeFileSync(out, ico(images));
  console.log('wrote ' + out + '  (' + SIZES.join(', ') + 'px, ' +
              fs.statSync(out).size + ' bytes)');

  var pngArg = process.argv.indexOf('--png');
  if (pngArg !== -1) {
    var want = Number(process.argv[pngArg + 1]) || 256;
    var hit = images.filter(function (im) { return im.size === want; })[0];
    if (!hit) { console.error('no ' + want + 'px image; sizes are ' + SIZES.join(', ')); process.exit(1); }
    var p = path.join(ROOT, 'marquee-' + want + '.png');
    fs.writeFileSync(p, hit.data);
    console.log('wrote ' + p);
  }
}
