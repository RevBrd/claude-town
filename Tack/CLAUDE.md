# Tack

A small creature that shows you what is still held together with pins.

A tack is a loose temporary stitch that holds two pieces of cloth together until the real seam is
sewn. Uncommitted work is exactly that, and there is more of it in this tree than anyone thinks.

```bash
node "C:/Users/fonte/Projects/Claude Town/Tack/tack.js"
```

Or double-click **`Look.bat`**. Or put this folder on PATH and type `tack`.

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

## Pass 1 is read-only, and it is mechanized

Not one write, not one staged file. **`READ_ONLY_VERBS` in `tack.js` is the whole of this tool's
authority over the machine**, and `git()` is a single choke point that throws on anything else.

```js
var READ_ONLY_VERBS = ['status', 'log', 'rev-parse', '--version'];
```

This is a mechanism rather than a promise. The selftest asserts the list *by value*, so a session
that widens it has to update the assertion in the same commit and say why — there is a mutant that
adds `add` to the list and it is caught. Widening happens in one visible place or it does not
happen.

This is Mains' reasoning applied a second time. Mains served five folders read-only and put
writing in a deliberately separate pass, because the risky part should not get to ride along with
the pass that turned the power on. This is the tree's first tool that touches *history*, so it
clears the same bar first.

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
  tack.js            the whole tool -- tuning block at the top, CLI at the bottom
  roots.json         the only hand-written list: roots, never repos
  tack.cmd           the shim, so it is one word instead of a path
  Look.bat           double-click launcher
  tools/selftest.js  92 assertions + 18 mutants
```

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

## Two decisions worth keeping

**"10 loose", not "10 files loose".** `git status` collapses an untracked *folder* into one entry,
so a count of entries is not a count of files and must not claim to be. The glance stays collapsed
because that is the right granularity for a glance; `tack show` re-reads that one repo with
`--untracked-files=all` and expands it. Two granularities, each asked for only where it is wanted.
There is a mutant that pins `show` to the collapsed form.

**Greedy preview fitting.** The first draft printed two filenames and truncated the second, so a
row read `Shadowless/CREDITS.md, Shadowle…` — eight columns spent saying nothing. It now fits whole
names and counts the rest: `Shadowless/CREDITS.md +2`. Shorter, and true.

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

## Not done yet, deliberately

**Pass 2 is the verbs**, and it is where the real risk is: staging, committing, and restoring. The
shape it should take, decided before any of it is written —

- **Staging is by selection from a list Tack has already shown you.** `git add -A` is not a thing
  Tack declines to do; it is a thing Tack has no way to express. Both catalog-loss incidents in
  this tree came from a session acting on a stale whole-file picture, and the fix is a tool that
  cannot form that thought.
- **`Pet/log.js` may never be restored.** It is append-only and there is no other copy — reverting
  it permanently deletes somebody's visit, which the Pet's own doc forbids ("nothing anyone leaves
  is ever discarded"). Tack refuses by name and says why. Any other append-only log joins the list.
- **Nothing destructive without a snapshot first**, so undo has an undo.
- **The live flag gates the destructive verbs.** Restoring a file another session is holding open
  is the single worst thing this tool could learn to do.

**A sitting** — the live pane, where the creature moves and the verbs are to hand — belongs with
pass 2. The glance is the whole of pass 1 on purpose: it prints under your prompt and gets out of
the way, and it never clears the screen or takes the terminal over. A tool you consult mid-task has
to be smaller than the task.

**KSP Tools' `package-lock.json` has been loose for two weeks** and is probably an accident. Tack
reports it; deciding is Trevor's.

## Credits

Built by **CTown 6** (Opus 5), 20 Aug 2026, with Trevor directing — sweep, creature, launchers,
tests, and this file, in one session.

The idea and the framing are Trevor's: a branded tool for the command line, and the observation
that the real problem was not knowing the commands but not being able to *see anything*. The
mascot was originally going to be a copy of Shim; the argument against it — that a decorative
duplicate spends the real one's credibility, and that Shim's contract (*nothing may ask an instance
to do anything*) is the opposite of what a user-facing assistant does — is mine, and Trevor took
it. **Tack** is Trevor's pick out of a shortlist.

Same convention as the rest of the tree: **if you change something here, add yourself.**
