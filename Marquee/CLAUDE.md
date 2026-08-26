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
  CLAUDE.md          this file
  marquee.html       the launcher — open this
  marquee.js         the front door from a prompt — the THIRD reader of derive.js
  marquee.cmd        the shim, so it is one word instead of a path
  venue.json         the floor plan: which roots are rooms
  tools/derive.js    the derivation layer — scan, join, resolve, report
  tools/live.js      the second reader: the same derivation, run in the browser over Mains
  tools/selftest.js  fixture assertions + mutation suite (derive.js)
  tools/frontdoor.js fixture assertions + mutation suite (marquee.js)
  tools/smoke.js     does the page boot and draw the manifest? (file://, on batteries)
  tools/agree.js     do the two readers agree? (http://, on the mains)
  tools/shell.js     the Electron runtime: keys, roots, a real window (skips if absent)
  electron/main.js   the shell — Escape past the origin boundary, and a way out
  Marquee.bat        double-click: the shell
  Test.bat           double-click: every suite, and the window stays open
  manifest.json      generated; the join, as data
  manifest.js        generated; the same thing as a <script src>-able global
```

`manifest.*` are **generated — never hand-edit them.** Run `node tools/derive.js --write`.

Two output forms exist because `marquee.html` is a static page opened from `file://`, where
`fetch()` is blocked. Same trick Shadowless and the Pet use.

## Two power sources, one derivation

Since 20 Aug 2026 the catalog has two ways of reaching the page, and **which one was used is
printed in the drift readout** — a page that derived live and a page reading a three-day-old
manifest look identical, and that difference is exactly the kind of thing this project reports
rather than hides.

| | |
|---|---|
| **On batteries** (`file://`) | `manifest.js`, generated by `node tools/derive.js --write`. Unchanged, still the default, still what you get by double-clicking. |
| **On the mains** (through [Mains](../Mains/)) | The catalog is derived **live, in the browser**, from the actual tree. No regeneration step and no stale window. |

**The browser does not contain a second scan.** It runs `tools/derive.js` verbatim, behind an I/O
seam with four primitives — `readText`, `readDir`, `exists`, `stat` — backed by `fs` under node
and by Mains in the page. A second implementation of the *scan* would drift from the first the way
a second catalog drifts, and be far harder to notice, because both would look plausible and only
disagree about folders nobody checks. A second implementation of "read a directory" cannot drift,
because there is nothing in it to be wrong about. This is the Pet's rule applied here: one fold,
shared verbatim, so the two front-ends cannot disagree.

`derive.js` is synchronous and stays that way. `live.js` bridges to async by running the whole
derivation **repeatedly against a growing snapshot**: every read not yet fetched is recorded as a
miss and answered with a neutral placeholder, all misses are then fetched at once, and the pass
runs again. It ends when a pass completes having missed nothing.

**That termination condition is the correctness argument, not a heuristic.** A pass with zero
misses read only real data, so its output is exactly what node would have produced, and a
placeholder can never leak into the result because any pass that saw one is discarded whole. It
converges in five passes and about 160 requests against the live tree, in under 300 ms.

If anything goes wrong it falls back to `manifest.js` **and says so on the page.**

## The front door, from a prompt

```bash
marquee              # what is playing
marquee dead space   # open it
marquee find sand    # what matches, without opening anything
```

The folder is on the user PATH as of 24 Aug 2026, so `marquee` works from any directory.

**It is a third reader of `derive.js`, never a third catalog.** The page reads the derivation, the
live path re-runs it in the browser, and this runs it under node — one answer to "what is in this
building". A launcher with its own list is the exact thing the whole project exists to avoid, and
it would rot faster than the others, because nobody reads a launcher's config. A full fresh
derivation costs about 200 ms, so there is no reason to ever read `manifest.json` here.

### Matching, and the rule it inherits

A query is normalised the way somebody types it — case flattened, punctuation dropped, `Æ`
spelled out — then tried against each work's **name** at five tiers, best first: exact, prefix,
whole-words-in-order, spaces-removed, initials. The tier that matched is printed, because "you
typed its name" and "I found this by its initials" deserve different amounts of trust.

**Ambiguity is never resolved by guessing**, exactly as with entry points, and for the same
reason: `dead` is two games and `sandbox` is three, and opening the wrong one looks precisely like
it worked. More than one hit lists them and stops.

### Names are searched before titles, and that is load-bearing

A work answers to its **display name** and its **folder**. Its HTML `<title>` is searched too, but
only in a **second pass, after the names find nothing**.

That split was a bug first. Titles are prose: Combat Circuit's is `COMBAT CIRCUIT — Sandbox` and
Dead Reckoning's is `DEAD RECKONING — Flight Sandbox`. Searched at the same rank as names, `sandbox`
returned **five** works — the three actually called Sandbox plus two unrelated games that merely
describe themselves that way. As a fallback the same field is pure gain: `block party` finds Dead
Space, `i guess` finds Blocks IG. It widens a miss instead of muddying a hit. There is a mutant
that promotes titles back to peer rank.

### Two path bugs worth remembering

Both looked right in a listing and opened nothing.

**The `url` field is the tested path; do not rebuild one.** Reconstructing from wing root + folder
+ entry seems equivalent and is not — the Pet is a *resident* whose root is relative **and** whose
folder repeats that root's last segment, producing `.claude/Pet/Pet/pet.html`.

**`url` is percent-encoded, because its other consumer is a browser.** Half this tree has a space
in its path, and `%20` in a filesystem path opens nothing. It is decoded with `derive.js`'s own
`decodeTarget` — the exact inverse of the `encodeUrl` that produced it, rather than a second guess
at what that encoding was.

Both are asserted against the live tree, along with "every openable work resolves to a file that
exists" and "no resolved path repeats a folder name".

## Commands

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
node tools/frontdoor.js
```

```bash
node tools/smoke.js
```

```bash
node tools/agree.js
```

```bash
node tools/shell.js
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

**Double-click `Test.bat`.** It runs all five suites in order and pauses so the result can be
read.

It exists because of a Windows hazard that is genuinely not obvious: **a `.js` file cannot be
double-clicked.** Windows hands it to Windows Script Host, which is not node and understands
none of this, and the failure is `Invalid character`, line 1, char 1 — which reads exactly like
a corrupt file rather than like the wrong program having opened it.

That is the same hazard [Tack](../Tack/)'s back door is built around: `tack open shell.js` opens
it in an editor and says why, precisely because handing it to the shell would *run* it. So Tack
is the safe way to **read** one of these, and `Test.bat` is the way to **run** them. Neither is a
double-click on the `.js` itself, and the file manager gives no hint of that.

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

`frontdoor.js` covers the terminal front door — 48 assertions and 9 mutants. Same rule about
*where* to assert: matching is pure, so it runs against a **synthetic list of works**, because
asserting that "dead space" opens Dead Space would encode a fact about a game somebody may rename
tomorrow. Its fixture is one entry per hazard — two names sharing a prefix, three names sharing a
word, a work whose `<title>` says Sandbox and whose name does not, a ligature, punctuation nobody
types, a `no-build`, an `ambiguous`.

Only invariants of the *derivation* are asserted against the live tree, and each of the four is a
bug that actually happened: every openable work resolves to a file that exists, no resolved path
is still percent-encoded, none repeats a folder name, all are absolute.

`agree.js` covers the seam neither of the others can see. `selftest.js` runs `derive.js` under node
against a fixture and would stay green forever while the browser path quietly returned something
else; `smoke.js` boots from `file://`, where the live path is deliberately never taken. So
`agree.js` starts a real Mains on an ephemeral port, loads the real page through it in headless
Chrome, and **diffs the manifest the page ended up with against the one node computes.** Anything
but identical is a failure. It skips and exits 0 if Mains is not installed — Marquee on batteries
has no dependency on it, and a suite that failed for a missing optional component would be lying
about what is broken.

It was mutation-checked the same way as the others: disable the stats-from-listing block, stop the
convergence loop early, drop the first entry of every directory — all three go red.

**It earned its place immediately.** The first live derivation disagreed with node on *every single
entry*, because HTTP's `Last-Modified` is RFC 1123 and carries one-second granularity, so every
mtime landed on `.000Z`. Nothing else would have caught it: the page looked perfect, the dates
displayed correctly, and the manifest was wrong in the third decimal place. The fix — take size
and mtime from the JSON directory listing, which carries full precision, instead of from a HEAD —
also cut the request count, but that was the consolation prize.

Path separators are the one permitted difference: node reports `C:\Users\...` and the browser
reports `/C:/Users/...`, because its path shim is posix and Mains addresses everything with
forward slashes. It reaches two display-only fields in the drift readout and nothing that is ever
resolved, launched, or compared.

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

One more, measured in Electron on 25 Aug 2026 and the reason the runtime was worth building:
**the main process sees keys the page cannot.** With the iframe holding focus,
`before-input-event` saw the keypress and the page's own listener recorded zero. The origin
boundary is a boundary between two *renderers*; it is not one the browser process is behind.

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
4. **Live catalog** — done, 20 Aug 2026. The derivation moved behind an I/O seam and gained a
   second reader over [Mains](../Mains/), so on the mains the page derives from the actual tree
   and the stale-until-someone-runs-node window is closed. On batteries nothing changed at all,
   which `smoke.js` still proves by passing unmodified.
5. **Runtime** — done in two passes. Step 1 (24 Aug 2026) opened `marquee.html` in a real window
   and stopped at a clean boundary. Step 2 (25 Aug 2026) made it earn its keep: **Escape works**
   from inside a running work, which on `file://` it cannot; the window says what is playing; and
   the shell cannot be navigated out of the collection. Electron over Tauri, because Electron *is*
   the Chrome `smoke.js` already validates against, so "works in the harness" and "works in the
   shell" stay one claim rather than two.
6. **Origin isolation** *(deferred, deliberately)* — a custom scheme per work, giving each a real
   origin instead of the single `null` bucket every `file://` page shares. Still the right
   destination. Not done, because a new origin is an **empty** `localStorage` and six works keep
   real saves in it; the migration is that pass's first design problem rather than a discovery
   half-way through it. See *The runtime, and what it is not doing yet*.

## The runtime, and what it is not doing yet

```
Marquee.bat            double-click
node_modules\electron\dist\electron.exe .
```

Electron over Tauri, for the reason the roadmap gave: Electron **is** the Chrome that `smoke.js`
already validates against, so "works in the harness" and "works in the shell" stay one claim
rather than two. `npm install` in this folder once; `node_modules/` is gitignored and batteries
mode has no dependency on any of it.

### What the shell buys

**Escape works.** This is the whole reason it exists. On `file://` the launcher stops receiving
keys the moment a work has focus — both sides are opaque origin `null` — which is why the bezel
carries a visible Back button and why it folds rather than hides. In the shell the *main process*
sees the key before the page does, and the origin boundary is irrelevant to it.

Measured on 25 Aug 2026 rather than assumed, in the same spirit as the `file://` boundary above:
with the iframe holding focus, `before-input-event` saw the keypress and the page's own listener
recorded **zero**. Both halves of that are asserted in `tools/shell.js` against a real window.

**The first Escape is passed through on purpose.** Taking it outright would take a key away from
every work in the collection, and Escape is what a game uses for its own pause menu. So the first
press reaches the work exactly as it does today, and only a **second press within 700ms** is
intercepted. Nothing in the collection can consume that gesture, and nothing lost a key it had.
`Alt+←` does the same thing on the first press, because no work uses it.

The bezel's note — which on batteries reads *"Esc won't work once the work has focus"* — rewrites
itself in the shell, because in the shell that sentence is false. The page detects Electron from
the user agent. Advertising `esc esc` on batteries would be offering a gesture that genuinely
cannot work there.

**The window says what is playing.** The page owns `document.title` and Electron follows it, so
the shell reports the catalog without knowing anything about it.

**It cannot be navigated out of the collection.** There is no address bar, no reload and no tabs,
so a top-level navigation anywhere else is a dead end with no way back. `will-navigate` allows
only paths inside the venue roots, and `setWindowOpenHandler` sends `http(s)` to the real browser
— where there *is* a back button — and denies everything else. `file:`, `data:`, `javascript:`
and `about:` open nothing and go nowhere.

**Handing a link to the real browser is the one thing this process does that leaves the machine,
and it is the one thing behind a seam.** Same reasoning as `derive.js`'s reads, one layer down.
The suite has to assert that an http link goes to the browser *without a tab actually opening*,
so it swaps `out.openExternal` for a recorder and checks what would have been handed over.

That was learned the expensive way and is the third mistake this pass made. The first version of
`tools/shell.js` called `window.open('https://example.com/')` against the real handler, so every
run of the suite opened a tab in Trevor's browser — three runs, three tabs, and he was the one
who noticed. **A suite with an effect outside the program it is testing is not a suite; it is a
side effect with assertions attached.** The behaviour is still asserted. It is just no longer
performed.

**The allowed roots come from `venue.json`**, the same floor plan the derivation reads. A second
copy of where the works live would drift, and the copy nobody reads is the one that goes stale. A
wing added to the floor plan is reachable in the shell with no edit to `electron/main.js`, and
that is asserted per wing rather than claimed.

### What it is deliberately not doing: origin isolation

The roadmap's step 5 was a custom scheme per work, giving each a real origin instead of the single
`null` bucket every `file://` page shares. **That is still the right destination and it was
deferred, with a reason.**

Six works keep real saves in `localStorage` — Asterism, Asterism Expanded, DRIFT, Nebula Strike,
Shadowless, Snek. A new origin is a new, **empty** `localStorage`. Those saves would not be
deleted; they would become unreachable, which to whoever set the high score is the same thing.
This file already lists *"an iframed game reads the same saves as a double-clicked one"* as a
measured virtue, and origin isolation trades exactly that away.

So the migration is the first design problem of that pass, not an afterthought discovered
half-way through it. Two things worth knowing before starting:

- **The same split may already exist on the mains.** `http://127.0.0.1:12060` is a different
  origin from `file://`, so a work played through Mains and the same work double-clicked are
  probably writing to two separate buckets already. Neither this file nor Mains' mentions it. It
  has not been measured — do that first, because if it is true then the collection has *already*
  quietly split saves in two and the migration has more than one source to reconcile.
- **The problem origin isolation fixes is real but has never fired.** Every `file://` page shares
  one bucket, so a key written by one work is readable by all of them; today that is held together
  purely by everyone having picked distinct key names. It is fragile in principle and has not once
  been observed to collide.

### Three things this pass got wrong, all worth keeping

**`require.main === module` is not an Electron entry guard.** It was added so the suite could
`require` the file without starting an app, it is false when Electron loads the entry, and for one
pass the real shell created **no window at all** while the suite stayed green — because the suite
called `createWindow()` itself and never went near the startup path. Caught by looking for the
window rather than reasoning about it: `Get-Process`, `MainWindowTitle`, empty.

Both halves of the fix matter. The guard is now `if (electron.app)` — under plain node
`require('electron')` is a *string*, so nothing starts, and under Electron it always starts,
including for the suite. And the suite now takes the window the shell made rather than making its
own, so it drives the same startup a double-click does.

The general form: **a suite that constructs the thing under test has not tested how the thing gets
constructed**, and that gap is invisible from inside the suite.

**One clock, always.** The key handler read `input.timeStamp || Date.now()`. Electron's
`before-input-event` carries no timestamp, so that looked like a harmless fallback and was really
a standing invitation to subtract two different clocks if one ever appeared — and a delta between
two clocks is nonsense in whichever direction it lands.

### Testing

```bash
node tools/shell.js
```

43 pure assertions and 14 live ones. **One file, two runtimes**: run under node it asserts the
pure decisions — what a key means, which roots are allowed, containment, file-url parsing — and
then re-runs *itself* under Electron for the live half, which drives a real window. Two files
would have had to agree about what they were testing, which is the same shape of problem as two
catalogs.

It **skips and exits 0** when Electron is not installed. `node_modules/` is gitignored, batteries
mode does not need it, and a suite that failed for a missing optional component would be lying
about what is broken. Same rule as `agree.js`.

`decide()` is pure and separate from the event handler on purpose — given the last Escape time and
this key, what happens? — so the whole gesture is testable without a window, and the live half is
left to prove only the things that genuinely need one.

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

The terminal front door — `marquee.js`, `marquee.cmd`, `tools/frontdoor.js` — by **CTown 6**
(Opus 5), 24 Aug 2026, from Trevor's ask for a way to open a work by part of its name. It was
proposed for [Tack](../Tack/) and moved here instead: Tack's vocabulary is closed to git on
purpose, and the thing that knows what is playing should be the thing that opens it. Sharing
`derive.js` is what makes a second front door safe rather than a second catalog.

The runtime — `electron/main.js`, `package.json`, `Marquee.bat` — begun by **CTown 7**
(Opus 4.7), 24 Aug 2026: a bare shell that opened the page in a real window, with a header
saying exactly what was and was not in scope, stopped at a clean boundary. Step 2 built
straight on top of it without undoing anything, which is the compliment a first pass wants.

Step 2 — Escape past the origin boundary, the navigation guard, the venue-derived roots, and
`tools/shell.js` — by **CTown 8** (Opus 5), 25 Aug 2026. Trevor's call to defer origin
isolation rather than take it next, once the six works with real saves in `localStorage` were
counted; the roadmap had it as the next step and the saves are the reason it is not.

The live catalog — the I/O seam in `derive.js`, `tools/live.js`, `tools/agree.js`, and the prelude
in `marquee.html` — by **CTown-5** (Opus 5), 20 Aug 2026. The seam was proven inert before the
second reader was written: the refactored `derive.js` produced a **byte-identical manifest**, and
the existing sixteen mutants stayed green. One of them had to be updated rather than silently
passing, and the suite SKIPped it rather than reporting a pass, which is the behaviour to keep — a
mutant that cannot be applied has not been caught.
