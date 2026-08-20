# Marquee

A front door to `Projects/Games/` and a few neighbours. The lit sign outside that lists what's
playing — which is also the design constraint, because a marquee is only correct if it reflects
what is actually in the building.

Marquee **keeps no list of works**. It derives one, every run, from the filesystem and from the
catalog table that already lives in each collection's own `CLAUDE.md`. That is the whole
architectural idea and everything else follows from it.

It is a **building**: five rooms as of 17 Aug 2026, holding 34 open works.

| Room | Kind | What is in it |
|---|---|---|
| Main house | wing | `Projects/Games/` — the collection this was built for, and the only room with billing shelves |
| Side stage | wing | `Misc Tools/` — the small self-contained tools |
| Art house | wing | `Misc Tools/Claudelings/` |
| Planetarium | wing | `Misc Tools/Space Stuff/` |
| Also in the building | resident | the Pet, `~/.claude/Pet/` |

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

## The venue, and the one hand-written list

`venue.json` is the floor plan, and it is **the only hand-written list in the project**. That is
unavoidable: nothing on disk knows that `Projects/Games` and `~/.claude/Pet` belong in the same
building. What keeps it honest is that it lists **roots, never works** — what is inside each root
is still derived every run — and every root is validated, so a wing whose folder vanished is
reported rather than quietly dropped.

**A wing must be a curated collection with its own `CLAUDE.md` catalog table.** That bar is
deliberate and it is the only thing standing between this and a general-purpose file browser,
which would be worth considerably less than a good front door to one collection. A folder that
merely contains HTML does not qualify. If you are tempted to add one because it has some HTML in
it, the answer is no.

**A resident** is a single work belonging to no collection, named in the floor plan because there
is no catalog for it to be a row in. The Pet is the case this exists for. One at a time, on
purpose. A resident carries two names: `section` labels its shelf, `name` is the work.

Nested wings are handled: `Claudelings/` and `Space Stuff/` live inside `Misc Tools/`, so the
Side Stage scan **annexes** them rather than reporting them as empty folders. A folder that is
another wing's root is a door, not a work.

**KSP Tools is deliberately out.** Its shape is genuinely different — loose HTML at the root, no
per-tool folders, and a catalog keyed on backticked filenames rather than folder links. It needs a
second scan mode, which is a real if bounded job. Deferred at Trevor's call, 17 Aug 2026, since
that tree may reorganise itself first.

## Layout

```
Marquee/
  CLAUDE.md         this file
  marquee.html      the launcher — open this
  venue.json        the floor plan: which roots are rooms
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
<!-- marquee: play=snek.html -->        which file is the game
<!-- marquee: play=none -->             deliberately has no playable build
<!-- marquee: defects=authored -->      visible defects are on purpose
<!-- marquee: defects=none -->          sincere; every bug is a real bug
<!-- marquee: billing=feature -->       headline it
<!-- marquee: billing=preview -->       early build; shelve it as a preview

<!-- marquee: play=b.html defects=none -->      keys may share one comment
```

**A doc may carry more than one marker, anywhere in the file** — the entry-point declaration
wants to sit beside the prose explaining it, an editorial one is happier at the bottom. Keys are
merged across all of them and the *first* occurrence of a repeated key wins. Reading only the
first marker was a real bug, caught by the fixture written while adding `billing`.

An **absent key is unknown, never false.** `authoredDefects` is `true | false | null` and the
null is load-bearing — see below for why.

Only `play` is ever *required*, and only where a scan is genuinely ambiguous — three folders as of 17 Aug 2026. `defects` and `billing` are always optional.

## Catalog columns are located by header name

The four collections write their tables differently:

```
Games        | Game | Premise | State |
Misc Tools   | Tool | What it is | Built by |
Space Stuff  | Tool | State | Built by |
```

So columns are found by matching the **header cell**, not by position, and tables are parsed one
at a time rather than by scanning every pipe-line in the file — Space Stuff's `CLAUDE.md` holds
more than one table, and a whole-file scan would merge rows with different column meanings.

This is not the prose-reading banned elsewhere: a header cell is a structured key, not a sentence.
When no header matches, it falls back to position **and records an anomaly**, and it never falls
back onto a column another key already owns. Space Stuff genuinely has no description column, so
its premise is empty and the launcher falls through to the State text — reported, not invented.

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

44 assertions. `selftest.js` asserts against a **synthetic fixture**, not against `Projects/Games/`. Testing the
live collection was the first design and it was wrong: every assertion would encode a fact about
a game somebody is actively editing, so the suite would go red every time a game shipped, and a
suite that cries wolf gets deleted. The fixture reproduces each *hazard* instead, and hazards
don't change when a game does.

It also carries a **mutation suite** — sixteen deliberate breakages of derive.js's real rules, each
naming the assertion that must go red. All sixteen are caught. If one ever escapes, the rule it
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

## Billing is editorial, and that is the point

`billing` decides which shelf a game lands on — **Feature presentation**, **Now showing**
(the default, for anything undeclared), or **Sneak preview**. It is the one field here that is
not a fact about the filesystem, and it is deliberately **not inferred from the catalog's State
column**, even though that column plainly says things like "Complete and playable" and "A kernel,
not a game".

That column is English prose, and reading prose for meaning is exactly how the authored-defect
flag came to report the opposite of the truth for 13 of 18 games. A person reads it and writes a
declaration; the tool never guesses. An undeclared game shows up on the middle shelf, so adding a
game still needs no curation at all.

## Roadmap

1. **Derivation layer** — done. Scan, join, resolve, report, manifest.
2. **Launcher** — done. `marquee.html`: filter, keyboard nav, three billing shelves, launch into a
   floating-bezel iframe, and the drift readout on the page rather than only in the terminal.
3. **Cabinet** — done. The picture house, above. Deferring it was the right call: by the time it
   was built the machinery had already survived three rounds of widening, so the skin was a skin
   and nothing else.
4. **Runtime** *(if it happens)* — Electron over Tauri. Electron *is* the Chrome that `probe.js`
   already validates against, so "works in the harness" and "works in the shell" stay one claim
   rather than two. Buys a custom scheme per game — real origin isolation, which the filesystem
   cannot give, because every `file://` page in the collection currently shares one localStorage
   bucket under origin `null`. Verified empirically, not assumed.

## The house

Marquee is a **single-screen neighbourhood cinema, a couple of decades past its best**. It is a
theatre rather than an arcade because the vocabulary got there first — feature presentation,
sneak preview, side stage, art house — and fighting that would have cost more than it bought.

- **The facade** is a projecting marquee sign: chased bulbs top and bottom, the house name, and a
  changeable-letter **reader board** underneath. The board announces whatever poster is hovered or
  focused, and with nothing selected it works through what is currently on the shelves. An empty
  board is a closed cinema.
- **Two bulbs are out and they stay out**, as does a deterministic tilt on a few reader-board
  letters. A marquee with every bulb lit and every letter straight is a rendering, not a sign.
- **The lobby** is rooms of posters. **The auditorium** is the full viewport with the bezel
  floating over it.

### You walk between the rooms

**One room is open at a time.** The doors sit under the sign, the open one is lit, and you move
with a click, `[` / `]`, or a digit. The room is remembered in `localStorage` under
`marquee:room` — namespaced because every `file://` page in this tree shares one bucket under
origin `null`, which is the collision the Electron step exists to fix.

**Typing in the filter box temporarily opens the whole building.** A directory search that only
looks in the room you happen to be standing in is a worse search than no rooms at all, so the
doors dim, a note says so, and every match appears with its room named. Clear the box and you are
back where you were standing.

### The posters are derived, not drawn — unless the work says otherwise

There is no artwork for any of these works, and inventing some would break a rule that matters:
`Games/CLAUDE.md` says games are stylistically independent on purpose and a look must never be
carried from one into another. **A poster is therefore not a claim about how a game looks.** It is
the *house's* printing — one grid, one type treatment, eight faded offset-ink palettes and five
layout variants, all picked from a hash of the work's own folder name. The cinema prints its own
programme; it does not speak for the film.

Everything on a sheet is something already in the manifest: title, premise (or state, or the
page's own `<title>`), size, and the **credit** column — which is why the Side Stage posters
carry "OPUS 4.8" and the Main House ones do not. Misc Tools has a *Built by* column and Games
does not.

### A work may print its own sheet

Trevor's call, 17 Aug 2026: the Games rule about stylistic independence is "try not to do the
same things" between *games*, and a showcase *for* the games is a different thing. So a work can
carry its own colours.

**The declaration lives with the work, never here.** That is the whole point. A poster
hand-authored inside Marquee would be per-work data kept in the launcher — it would go stale the
moment someone reskinned a game, and nothing would notice. A declaration in the game's own
`CLAUDE.md` sits next to the code that would change it.

```
<!-- marquee: paper=#10001f ink=#ffd000 accent=#ff1f8f face=neon -->
```

- **A closed, validated vocabulary** — three hex colours and one of six named faces
  (`house`, `condensed`, `slab`, `hand`, `mono`, `neon`). Not free CSS: the values are injected
  into the page, and a lobby of 34 unrelated posters is noise rather than a lobby.
- **Anything invalid is dropped and reported**, never injected. A non-hex colour, an unknown face,
  or a half-declaration (paper without ink) all surface in the drift readout.
- **Contrast is measured, not eyeballed.** WCAG relative luminance; under 3.2:1 the sheet is
  reported as hard to read. It still renders — a declaration beats a derivation, and the drift
  readout is the right place to argue about it — but nobody ships an illegible poster in silence.
- **A declared face replaces the derived layout variant.** Both govern the type, and leaving both
  on meant Prompt Defense's declared `mono` rendered in the variant's italic: a game's own choice
  losing an argument with a hash. Colours override cleanly, so the variant stays when only colours
  are declared.

Eight games declare one as of 17 Aug 2026, and **every colour was read out of that game's own
stylesheet rather than invented** — each declaration names its source so a later session can check
the claim instead of trusting it. The other thirty are house-printed, which is not a deficiency:
a lobby with some studio one-sheets and some house programme cards is what a real one looks like.

The large ghosted initial is a printer's device. It exists because a one-sheet is mostly image and
there is no image, so a sheet with a two-line tagline would otherwise read as a card with a hole
in it.

**A measured detail worth keeping:** the palette is chosen with `hash >>> 3`, not `hash`. FNV-1a's
low bits are badly biased on short similar strings — across the real 38 folder names, `hash % 8`
put **19 of them in one bucket**; `hash >>> 3` spreads the same names 6,4,6,5,4,5,4,4. A palette
picker that paints half the lobby one colour is not much of a palette picker, and it looked
plausible until it was counted.

### The skin and the machinery really were separable

The cabinet pass changed presentation only, and there is evidence rather than a claim:
**`tools/smoke.js` passed unmodified**, because every class name it depends on — `.card`,
`.card.inert`, `.roomname`, `details.drift` — was deliberately preserved. Keep it that way. If a
future skin renames those, update the suite in the same commit and say so.

The **doors** pass then broke that suite on purpose, and that was correct too. One room open at a
time means the page no longer draws every room, so the suite's counts were genuinely stale rather
than wrong-headed. It went red, and the fix was to teach it the new model: count the plates in
whichever room is *actually* open, read off the lit door rather than assumed. An assumption about
which room opens would be a suite that passes on this machine and fails on the next.

## Why the bezel floats

The bar overlays the game rather than sitting above it, and that is load-bearing rather than
stylistic. Ultra Pong sets `body{height:100%}` with flex centring. Take 46px off the viewport and
centred content taller than the box overflows in **both** directions — the game's own header goes
permanently out of reach, and no amount of scrolling gets it back. Every game that centres on a
full-height body has that shape, so the game gets the whole viewport.

It **folds and dims** after a few seconds instead of hiding, and that is also forced: once a game
has focus this page stops receiving `mousemove` entirely, because the cross-origin iframe swallows
it. A bar that vanished could never be summoned back by moving the mouse toward it. It has to stay
physically present, just quiet enough to ignore.

## Open

- **Salient** needs a declaration and it's a judgement call, not a lookup. Two prototypes, and the
  catalog says neither was carried forward. `salient.html` is v2 ("feels closer"),
  `salient_job1.html` is v1. Either `play=salient.html` or `play=none` is defensible — ask before
  writing one.

---

Built by **CTown-4** (Opus 5), 17 Aug 2026. Named for the sign, not the building.
