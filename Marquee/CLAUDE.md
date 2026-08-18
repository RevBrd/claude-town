# Marquee

A front door to `Projects/Games/`. The lit sign outside that lists what's playing — which is
also the design constraint, because a marquee is only correct if it reflects what's actually in
the building.

Marquee **keeps no list of games**. It derives one, every run, from the filesystem and from the
catalog table that already lives in `Games/CLAUDE.md`. That is the whole architectural idea and
everything else follows from it.

## Why it's built this way

The obvious design is a config file listing each game. That was rejected before a line was
written. `Games/CLAUDE.md` already documents that its catalog drifts, and that a row was silently
lost once when a session wrote the whole file from a stale copy. A second list, in a second
format, in a folder nobody opens, would drift the same way and faster — and nobody would notice,
because nobody reads a launcher's config.

So the list is derived, and the two rules that fall out of that are the ones to protect:

- **Ambiguity is never resolved by guessing.** Two candidate HTML files and no declaration is a
  *reported state*, not a coin flip. Launching a discarded predecessor as though it were the game
  is the worst failure available here, because it looks like it worked.
- **Disagreement between the sources is output, not error.** A folder with no catalog row still
  appears, flagged. A catalog row with no folder appears too. Marquee cannot drift, because it
  keeps nothing — and it reports the drift in the list that can.

That second property turned out to be worth more than expected. On the first live run it found
Benthos and Volley sitting on disk with real builds and no catalog row at all.

## Layout

```
Marquee/
  CLAUDE.md         this file
  marquee.html      the launcher — open this
  tools/derive.js   the derivation layer — scan, join, resolve, report
  tools/selftest.js fixture assertions + mutation suite (derive.js)
  tools/smoke.js    does the page boot and draw the manifest?
  manifest.json     generated; the join, as data
  manifest.js       generated; the same thing as a <script src>-able global
```

`manifest.*` are **generated — never hand-edit them.** Run `node tools/derive.js --write`.

Two output forms exist because `marquee.html` is a static page opened from `file://`, where
`fetch()` is blocked. Same trick Shadowless and the Pet use.

**`marquee.html` holds no list of games and must never grow one** — not even as a fallback for a
missing manifest. A hardcoded list here would be a second catalog drifting quietly behind the
first, which is the exact thing this project exists to avoid. With no manifest the page says so
and shows nothing, and that is the design working.

## Commands

```bash
node tools/derive.js
```

```bash
node tools/derive.js --write
```

```bash
node tools/selftest.js
```

```bash
node tools/smoke.js
```

`--json` dumps the manifest to stdout, `--games <path>` points at a different tree, `--strict`
makes drift a non-zero exit (by default only genuinely broken things fail, since drift is a
normal state and an always-red exit code is noise).

## The declaration

A game tells Marquee things a scan cannot know, via an HTML comment in the game's own
`CLAUDE.md` — the file every game is already required to have. No new file type.

```
<!-- marquee: play=snek.html -->
<!-- marquee: play=none -->
<!-- marquee: defects=authored -->
<!-- marquee: play=b.html defects=none -->
```

An **absent key is unknown, never false.** `authoredDefects` is `true | false | null` and the
null is load-bearing — see below for why.

Only needed where a scan is genuinely ambiguous. Eighteen of twenty-three folders need nothing.

## Entry-point resolution, in order

1. A declaration → obey it, and check the file is really there (`declared-missing` if not).
2. Exactly one top-level `.html` → that's the game.
3. Zero → `no-build`.
4. Two or more → `ambiguous`. Stop. Report the candidates and resolve nothing.

**Top level only, always.** There is deliberately no ignore-list of subdirectory names, because a
blocklist implies a recursive scan that has to stay correct forever — miss one folder name and
`GemTD/Old Versions/` offers six playable-looking builds, none of which is the game. In this
collection, depth is where history lives, without exception.

## The hazards this exists to survive

Measured against the live tree, 17 Aug 2026. These are the reason the rules are shaped this way,
and they're the fixture cases in `selftest.js`:

- **Snek/** holds `snek.html` (47 KB) and `snake.html` (10 KB). `snake.html` is not a backup —
  it's a *different game*, titled "SERPENT // 8K", from before the ballpoint-pen reskin. A naive
  scan offers it as Snek.
- **Asterism/** holds three. The one named `index.html` is 6.8 KB — so "prefer index.html", the
  obvious tiebreaker, would have picked wrong on size alone. (It happens to be right here anyway:
  it's a purpose-built chooser linking to both versions. Right answer, wrong reasoning, and the
  next folder wouldn't have been so lucky.)
- **Benthos/** and **Volley/** have real builds and no catalog row.
- **Arcane Artillery/** is a single `.jsx` — an unported Claude Chat artifact no browser can run.

## The inverted-grep story, which is the real lesson here

The first version carried a soft flag for "does this game have authored defects", by grepping
each game's `CLAUDE.md` for `/authored defect/i`. Against the live tree it flagged **13 of 18**.

It was matching lines like Oblique's *"**There are no authored defects**"* and GemTD's *"This
game is sincere. There are no authored defects."* — reporting the exact opposite of the truth,
for the majority of the collection, confidently and silently.

It passed every assertion in the suite, because no assertion could tell "flagged correctly" from
"flagged everything". It was caught while *writing the mutation tests*, which is precisely the
argument `~/.claude/reference/building.md` makes for having them.

The fix was to apply the rule already governing entry points: a signal that can be wrong in the
direction of *looks like it worked* does not get guessed. It gets declared, or it stays unknown.

**Do not reintroduce a heuristic here.** If a future job wants defect status for all twenty-three
games, the answer is twenty-three one-line declarations, not a cleverer regex.

## Testing

`selftest.js` asserts against a **synthetic fixture**, not against `Projects/Games/`. Testing the
live collection was the first design and it was wrong: every assertion would encode a fact about
a game somebody is actively editing, so the suite would go red every time a game shipped, and a
suite that cries wolf gets deleted. The fixture reproduces each *hazard* instead, and hazards
don't change when a game does.

It also carries a **mutation suite** — nine deliberate breakages of derive.js's real rules, each
naming the assertion that must go red. All nine are caught. If one ever escapes, the rule it
breaks is not actually covered and the suite is lying about its own coverage.

`smoke.js` covers the page rather than the logic: it boots `marquee.html` in headless Chrome and
checks the plate counts against the manifest. It was mutation-checked the same way — remove the
drift block, break the playable filter, inject a syntax error; all three go red.

**`probe.js` cannot substitute for it.** The global probe copies an artifact to the system temp
dir before loading, which is correct for a self-contained file and wrong here: `marquee.html`
loads `manifest.js` by relative path, so a copy in tmp renders the "no manifest" state and passes
cheerfully having shown nothing. `smoke.js` copies alongside the original instead.

## The file:// boundary, measured

All verified in headless Chrome on 17 Aug 2026, not assumed — each one changed a design decision:

- **`file://` iframes load from a `file://` parent.** The launcher works with no runtime at all.
- **The parent cannot script into them.** Both sides are opaque origin `null`, so
  `contentDocument` is `null`. Once a game has focus this page stops receiving keys — which is
  why the bezel has a visible Back button rather than relying on Escape. Not a bug to route
  around; it's the origin boundary, and only a runtime with a custom scheme changes it.
- **localStorage is not partitioned for the frame.** An iframed game reads the same saves as a
  double-clicked one, so launching through Marquee doesn't orphan high scores.
- **But every `file://` page shares one bucket** under origin `null` — a key written by one game
  is readable by all of them. Today that's held together purely by everyone picking distinct key
  names. This is the strongest single argument for the Electron step, which can hand each game a
  real origin.
- **`postMessage` works child→parent** (origin `"null"`). Unused, but it's the one channel that
  exists if a game ever wants to tell the shell something.

## Roadmap

1. **Derivation layer** — done. Scan, join, resolve, report, manifest.
2. **Launcher** — done. `marquee.html`: filter, keyboard nav, launch into a bezelled iframe, and
   the drift readout on the page rather than only in the terminal.
3. **Cabinet** — the skin, and the next decision. Deliberately deferred to here: launcher and
   cabinet share *all* the machinery and differ only in presentation, so the call gets made with
   the thing running rather than in the abstract. Nothing in `marquee.html` below the CSS block
   should need to change to do it.
4. **Runtime** *(if it happens)* — Electron over Tauri. Electron *is* the Chrome that `probe.js`
   already validates against, so "works in the harness" and "works in the shell" stay one claim
   rather than two. Buys a custom scheme per game — real origin isolation, which the filesystem
   cannot give, because every `file://` page in the collection currently shares one localStorage
   bucket under origin `null`. Verified empirically, not assumed.

## Open

- **Salient** needs a declaration and it's a judgement call, not a lookup. Two prototypes, and the
  catalog says neither was carried forward. `salient.html` is v2 ("feels closer"),
  `salient_job1.html` is v1. Either `play=salient.html` or `play=none` is defensible — ask before
  writing one.

---

Built by **CTown-4** (Opus 5), 17 Aug 2026. Named for the sign, not the building.
