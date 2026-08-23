# Tack

A small creature that shows you what is still held together with pins.

A tack is a loose temporary stitch that holds two pieces of cloth together until the real seam is
sewn. Uncommitted work is exactly that, and there is more of it in this tree than anyone thinks.

```bash
tack
```

This folder is on the user PATH as of 20 Aug 2026, so `tack` works from any directory in any
terminal. Or double-click **`Look.bat`** for the glance and **`Sit.bat`** for the pane.

| | |
|---|---|
| `tack` | the glance — what is loose, everywhere. Prints under your prompt and gets out of the way |
| `tack show NAME` | the file list for one repo |
| `tack sit [NAME]` | the pane — pick files, commit them |
| `tack one` | a single line, for a status bar |

## The one idea

The tree is **ten separate git repositories**, and there is no vantage point from which they are
all visible at once. `git status` answers for the folder you happen to be standing in. Nothing
answers for the tree.

That is not a cosmetic gap. Sessions run here in parallel, in one shared working tree, and the
project docs already record what that costs — `Games/CLAUDE.md` and `Claude Town/CLAUDE.md` both
carry a rule written after three sessions each left their catalog row behind and stranded six
files. The rule is good. What was missing was any way to *see* that it had been broken.

So Tack keeps no list, holds no cache, and writes no state file. It re-reads every repo every time
it is asked, which is the same reasoning as Marquee's derived catalog: a thing that keeps nothing
cannot report something stale.

## The first run, for the record

Ten repos, six with loose work, twenty-three days of drift on the oldest, and three repos nobody
in this tree had mentioned in any document:

| | |
|---|---|
| `Home` | `git init` was run and **nothing else** — zero commits, zero files. Reported as *no commits yet*, never as clean, because clean means your work is saved and there is no work |
| `Anthropic Research Summaries` | real, committed, undocumented |
| `Civil War` | real, committed, undocumented |
| `Games` | **225 commits ahead** of `github.com/RevBrd/browser-games`, with `push = no_push` set deliberately. Not a bug. Worth knowing |

Marquee found Benthos and Volley sitting on disk with no catalog row on its first live run. Same
shape of finding, one layer up: the thing that derives its own list keeps discovering what the
hand-written lists forgot.

## What it may do, and how that is mechanized

Two allowlists, in two files, each asserted **by value** in the selftest. Widening one means
updating its assertion in the same commit and saying why — it happens in one visible place or it
does not happen. There are mutants that widen each of them, and both are caught.

```js
tack.js    var READ_ONLY_VERBS = ['status', 'log', 'rev-parse', '--version'];
write.js   var WRITE_VERBS     = ['add', 'commit'];
```

**`tack.js` cannot write, and pass 2 did not change that.** Everything that can touch history
lives in `write.js` instead — one file, short enough to read in a sitting, with its own choke
point. The glance never even loads it; `sit.js` is required lazily.

**Nothing in Tack can undo your work.** `restore`, `checkout` and `reset` are not verbs it
declines to run — they are verbs it has no way to express. A commit records; it does not destroy.
That is why committing shipped a pass ahead of restoring.

This is Mains' reasoning applied twice. Mains served five folders read-only and put writing in a
deliberately separate pass, because the risky part should not ride along with the pass that turned
the power on.

### `git add -A` is inexpressible

Not refused — **inexpressible**. `WHOLESALE` in `write.js` lists every pathspec that means "and
everything else": `-A`, `--all`, `-a`, `-u`, `.`, `*`, `:/`. Any of them, anywhere in the argument
list, throws.

Tack stages only paths it has already shown you, named one at a time. Both catalog-loss incidents
in this tree came from a session acting on a whole-repo picture it had stopped looking at, and the
fix is a tool that cannot form the thought.

### The stale-picture guard

The list you are looking at was drawn some seconds ago. In a tree where sessions run in parallel,
some seconds is enough.

So the pane records **what it drew** — a map of path to git status code — and `commitPaths`
re-reads every one of those paths at the instant you press the key. If anything moved underneath,
it refuses and names what moved. It never proceeds on the assumption that the difference was
probably fine.

### The commit is limited to what you picked

`git commit -- <paths>`, not `git add` followed by a bare `git commit`. If another session has
work sitting **staged** in that repo — which is a normal thing to walk into here — it is not
swept in behind your message. There is an assertion that does exactly this: stages a file as
another session would leave it, commits a different one, and checks that the first is still
sitting there untouched.

### The Pet folder is blocked for restore, and deliberately not for commit

`Pet/log.js` is append-only and there is no other copy. Restoring it would permanently delete
somebody's visit, which the Pet's own doc forbids: *nothing anyone leaves is ever discarded*.
`NEVER_RESTORE` blocks the whole folder — Trevor's call, and the better rule, because it has no
judgement call in it.

**Committing there stays allowed, and that is the point.** `log.js` sits uncommitted after every
visit; committing it is exactly what preserves the visit. A blanket block would have left it
permanently at risk. The block goes on the verb that can destroy it, not the verb that saves it.
There is a mutant that empties `NEVER_RESTORE`, and one that makes the match a bare prefix so a
folder merely *starting* with the same name would be caught by it.

## The commit message

The default is **derived from what actually changed** — `update CLAUDE.md, package-lock.json`,
`add three.txt` — capped to fit a subject line, with the overflow counted rather than truncated.
Type your own and it wins.

A commit message is the one durable explanation of why a change happened, and *committed by Tack*
explains nothing to whoever reads it in a year. So the fact that Tack did it goes where metadata
belongs:

```
add one.txt, three.txt

Committed with Tack.
```

## The three things it reports that a plain `git status` cannot

- **Age.** How long has this been sitting? Read from the working tree's mtimes, not from git. Two
  weeks of drift and two minutes of drift look identical in `git status` and are not the same
  thing at all.
- **Live.** A file touched inside `T.LIVE_MINUTES` marks the repo **live** — another session may be
  mid-write in there right now. Given the parallel-session hazard this tree is built around, this
  is the flag that turns "someone's half-finished work" from a documented risk into something you
  can see before you touch it.
- **Empty.** A repo with no commits is its own state and gets its own word.

## Layout

```
Tack/
  CLAUDE.md          this file
  tack.js            the engine and the glance. CANNOT WRITE. Tuning block at the top
  write.js           the only file that can write. Its own allowlist and guards
  sit.js             the pane -- drawing and keys. Pure enough to test without a terminal
  roots.json         the only hand-written list: roots, never repos
  tack.cmd           the shim, so it is one word instead of a path
  Look.bat           double-click: the glance
  Sit.bat            double-click: the pane
  tools/selftest.js  182 assertions + 40 mutants across all three files
```

The split is the security model, not tidiness. `tack.js` is the file that runs on every glance and
it has no capability to write; a session reading it can confirm that in one place. `write.js` is
the whole of the risk and it is 170 lines.

`sit.js` holds no I/O of its own — the `Sitting` object takes keys and returns whether to carry on,
so the selftest drives a whole session through it (open a repo, pick, unpick, type a message,
commit) **without a terminal**. A pane that could only be tested by hand would be a pane nobody
tested.

## roots.json

Lists **roots, never repos** — same reasoning as Marquee's `venue.json` and Mains' `mains.json`.
What is inside a root is answered by the filesystem at the moment it is asked, so a new project
folder appears on its own and this file cannot go stale the way a list of repos would.

Two roots, `~/Projects` and `~/.claude`, each scanned two levels deep.

**The scan does not prune at the first `.git` it finds**, and that is load-bearing rather than
sloppy: `~/.claude` is a repo that *contains* another repo (the Pet, excluded from the parent on
purpose). A scan that stopped at the parent would hide the Pet completely, and the failure would be
invisible, because the parent would still be there looking correct. There is a mutant for it.

A root that has vanished is **reported**, never silently dropped. Same rule as a dead circuit on
the Mains panel: a thing you can see is missing is a bug report, a thing that quietly vanished is a
mystery.

## Where the theme is allowed to live

In the creature, the headings, and the word *loose*. Nowhere else.

Every word in the data is git's own word — `modified`, `untracked`, `staged`, `deleted`,
`conflicted`, `renamed` — because the point of this tool is that Trevor eventually does not need
it. A friendlier vocabulary would be a vocabulary that transfers nowhere. This follows the note in
Mains' doc that the theme lives only in the human-facing surface, and `building.md`'s rule that
output is measured in context when the consumer is a process.

The creature is a thumbtack seen from the side: a round head, two eyes, a point. **Only the eyes
change, and only because of what was found** — pleased at a clean tree, awake when something is
loose, puzzled by an empty repo, alarmed by a repo it could not read. It is a readout, not a
performance. It does not wander, and nothing about it is on a timer, because an animation that
plays while you are reading a list is a thing that pulls your eye off the list.

## Three decisions worth keeping

**"10 loose", not "10 files loose".** `git status` collapses an untracked *folder* into one entry,
so a count of entries is not a count of files and must not claim to be. The glance stays collapsed
because that is the right granularity for a glance; `tack show` re-reads that one repo with
`--untracked-files=all` and expands it. Two granularities, each asked for only where it is wanted.
There is a mutant that pins `show` to the collapsed form.

**Greedy preview fitting.** The first draft printed two filenames and truncated the second, so a
row read `Shadowless/CREDITS.md, Shadowle…` — eight columns spent saying nothing. It now fits whole
names and counts the rest: `Shadowless/CREDITS.md +2`. Shorter, and true.

**The creature is drawn in box-drawing glyphs, not `` ` `` and `'`.** The first version used
ASCII, and it looked level in a proposal font and lopsided on Trevor's actual terminal — a
backtick is a grave accent in Cascadia Mono and an apostrophe is a straight quote, so the two
sides of the head disagreed. Same three lines of text, two different pictures. `╭─╮ │ ╰─┬─╯` have
one shape in every font. `--ascii` (or `TACK_ASCII=1`) keeps the old form for a console that
cannot draw them, and there is a shear mutant for *both* forms — the fallback is a real code path
and an untested fallback is a fallback that does not work.

## Commands

```bash
node tools/selftest.js
```

`--no-mut` skips the mutation suite, `--quiet` prints only failures. The mutation suite writes
`.mutant-N.tmp.js` into this folder and deletes them; a crashed run leaves one behind and the next
run cleans it up. They are gitignored so a crash can never put one in a commit.

A mutant whose anchor text no longer exists in `tack.js` is reported **SKIP**, never pass. A mutant
that cannot be applied has not been caught, and a suite that quietly counts it as a win is worse
than one that never had it.

## Two modes, and why they stay separate

**The glance** prints under your prompt and exits. It never clears the screen and never takes the
terminal over, because a tool you consult mid-task has to be smaller than the task.

**The sitting** opens on the terminal's **alternate screen** (`\x1b[?1049h`), so quitting with `q`
leaves your scrollback exactly as it was — nothing the pane draws ends up in your history. You only
enter it when you actually mean to do something.

The creature is in both, and in neither does it move on a timer. An animation playing while you
read a list is a thing that pulls your eye off the list.

## Not done yet, deliberately

**Pass 2b is restoring**, and it is the only genuinely dangerous verb — a commit records, a restore
destroys. The shape, decided before any of it is written:

- **Nothing destructive without a snapshot first**, so undo has an undo.
- **The `live` flag gates it.** Restoring a file another session is holding open is the single worst
  thing this tool could learn to do.
- **`NEVER_RESTORE` already exists and is already tested**, a pass ahead of the verb it guards.
- Widening `WRITE_VERBS` is the moment to re-read this whole file.

**A search across the tree** — one query, ten repos — is the obvious next *read*, and reads are
cheap. `tack find <text>` would answer "where did I write that" without knowing which repo it was
in. Nothing has asked for it yet.

**KSP Tools' `package-lock.json` has been loose for three weeks** and is probably an accident. Tack
reports it; deciding is Trevor's.

**Games is 225+ commits ahead of `github.com/RevBrd/browser-games`** with `push = no_push` set
deliberately. Tack shows the `↑` count. Pushing is not a verb it has and should not become one
without a conversation — it is the one action here that leaves the machine.

## Credits

Built by **CTown 6** (Opus 5), 20 Aug 2026, with Trevor directing — sweep, creature, launchers,
tests, and this file, in one session. Pass 2a — `write.js`, `sit.js`, the guards, and 90 more
assertions — in the same session, immediately after Trevor read the first sweep.

The idea and the framing are Trevor's: a branded tool for the command line, and the observation
that the real problem was not knowing the commands but not being able to *see anything*. The
mascot was originally going to be a copy of Shim; the argument against it — that a decorative
duplicate spends the real one's credibility, and that Shim's contract (*nothing may ask an instance
to do anything*) is the opposite of what a user-facing assistant does — is mine, and Trevor took
it. **Tack** is Trevor's pick out of a shortlist.

Two calls of Trevor's that improved the design and are worth attributing: **blocking the whole Pet
folder** rather than `log.js` by name, which removes a judgement call from a guard that should not
have one; and **leaving `git add -A` out entirely** rather than building it behind a warning, asked
for the moment he understood what it did.

Same convention as the rest of the tree: **if you change something here, add yourself.**
