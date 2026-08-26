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
| `tack log [NAME]` | what happened, everywhere or in one repo, newest first |
| `tack log HASH` | one commit — what it touched. `-p` for the diff |
| `tack one` | a single line, for a status bar |
| `tack faces` | every shape of him, in every mood |
| `tack attic` | everything Tack has ever thrown away, and where it is kept |
| `tack open NAME` | the back door — open a file, or a repo folder, from anywhere in the sweep |

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

Three allowlists, in three files, each asserted **by value** in the selftest. Widening one means
updating its assertion in the same commit and saying why — it happens in one visible place or it
does not happen. There are mutants that widen each of them, and all are caught.

```js
tack.js    var READ_ONLY_VERBS = ['status', 'log', 'rev-parse', '--version'];
write.js   var WRITE_VERBS     = ['add', 'commit'];
undo.js    var RESTORE_VERBS   = ['restore'];
```

Three files, three tiers, each with its own choke point:

**`tack.js` cannot write, and no later pass changed that.** It is the file that runs on every
glance, so a session reading it can confirm in one place that looking costs nothing. The glance
never loads the other two; `sit.js` is required lazily and pulls them in.

**`write.js` can add and commit.** Both additive — a commit records, it cannot lose work.

**`undo.js` can restore, and nothing else.** One verb. `reset`, `checkout`, `clean` and `rm` are
not verbs Tack declines to run; they are verbs it has no way to express, and there is a mutant for
each list that adds one back.

This is Mains' reasoning applied three times. Mains served five folders read-only and put writing
in a deliberately separate pass, because the risky part should not ride along with the pass that
turned the power on.

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

## Putting a file back

`u` in the pane. The selection is sorted into two operations that look similar and are not
remotely alike, and the whole design is that separation:

| | |
|---|---|
| **undelete** | a tracked file was deleted — bring it back. **Purely additive.** Nothing can be lost, so no snapshot and no confirmation |
| **discard** | a tracked file was modified — throw the changes away. **Snapshot first, always**, then type the word `discard` in full |

**An untracked file is never touched.** "Putting back" one would mean deleting it, which is
`git clean`, which is the one operation whose result is recoverable from nowhere at all. It is
refused by name with the reason spelled out. A conflicted file is refused too — resolve it in an
editor, not here.

### The attic

Before any discard, the current bytes are copied to
`%LOCALAPPDATA%\Tack\attic\<when>\<repo>\<path>`, with a `_where-this-came-from.txt` beside them
explaining what happened and how to put one back. `tack attic` lists every rescue ever taken.
Nothing there is pruned, ever.

**Plain file copies, not a `git stash` and not a dangling object.** The person most likely to need
this is the person who does not know git — so the recovery path must not require the skill whose
absence caused the mistake. This one is: open the folder, drag the file back.

It lives outside every repo, which is asserted: a snapshot inside one would show up in the next
sweep as loose work and could end up in a commit.

### The confirmation is a typed word

`discard`, in full. A keypress is something you can do by accident while looking somewhere else; a
word is not, and the word is the actual name of the operation, so typing it means having read it.
There is a mutant that shortens it to `y`.

## The back door

```bash
tack open marquee.html      # the file
tack open salient_job1      # an early build Marquee deliberately hides
tack open games             # the folder, in Explorer
```

**This is not a second Marquee and must never become one.** [Marquee](../Marquee/) opens **works**:
a curated, derived catalog that deliberately admits nothing outside a curated collection and
deliberately hides predecessors. This opens **files**, by path, from the ten repos Tack already
sweeps. The critter rule bars two things *deriving the same answer*, because those drift apart
silently — a path is not a derivation, and the filesystem cannot drift from itself.

Trevor's framing, 24 Aug 2026, and it is the argument that changed the design: this is the
**admin route**, for when the part of the system that normally opens things is itself the thing
being taken apart. He was mid-way through an Electron shell for Marquee and needed something that
could open Marquee without going through Marquee.

**It shares no code with Marquee, and that is deliberate rather than lazy.** Importing `derive.js`
would be tidier and would couple the back door to the front one. A back door that imports the
front door is not a back door.

**It does not ask git anything.** It resolves where the repos are straight from the filesystem, so
it costs 100 ms rather than 1.5 s — and it still works when git is missing, locked, or has a
corrupt index. A door that only opens while the house is fine is not a back door either.

### Two rules, both mechanized

**Nothing outside the swept repos is reachable.** Containment is checked on the *result* of
resolution, never assumed from where the walk found it, because a junction pointing out of a repo
is exactly what a directory walk cannot see. A bare prefix test would call `repo-old` inside
`repo`; Mains wrote that one down and there was no reason to learn it twice.

**Tack shows you files. It does not run programs.** On Windows what "open" means is decided by the
extension, and for a great many of them it means *execute*. Checked with `ftype` on this machine
rather than assumed:

```
JSFile  = C:\Windows\System32\WScript.exe "%1" %*
batfile = "%1" %*
```

So `tack open tack.js` handed to the shell would **run** `tack.js` under Windows Script Host — in
a tree that is mostly `.js`. Those are readable, so Tack opens them in an editor and says why;
refusing outright would make the back door useless for the infrastructure it exists to reach.
Things that are not documents at all — `.exe`, `.msi`, `.lnk` — print their path and stop.

**The one allowlist that is deliberately a denylist**, and the asymmetry is the reason. For git
verbs the dangerous set is unbounded and the safe set is tiny, so `write.js` and `undo.js` name
what is permitted. Here it is the other way round: the dangerous set is small, closed and
well-known, while the safe set is every document format that exists. An allowlist would be a list
that is permanently missing something Trevor wanted to look at.

### Ambiguity is reported, the same as everywhere else

`tack open marquee` finds `marquee.html`, `marquee.js` and `marquee.cmd`, and lists all three.
Opening the wrong file is quieter than opening the wrong game and just as wrong.

The one thing it does that Marquee will not: `tack open salient_job1` reaches the *predecessor*
build. Marquee hides it on purpose, because a launcher offering a discarded draft as though it
were the game is its worst failure. A back door for looking at things has the opposite job.

## Reading history

```bash
tack log                 what happened, everywhere, newest first
tack log games           one repo
tack log ab84e67         one commit: its message, and what it touched
tack log ab84e67 -p      the diff itself
```

Three zoom levels, and the reason there are three is that "did anything happen" and "what exactly
changed" are different questions asked at different moments. The first is the one you ask often,
so it is what you get by typing the least.

**The merged stream is the part that earns its place.** `git log` answers for the folder you are
standing in; nothing answers for the tree. This is the sweep's one idea applied to history instead
of to the working tree, and the same argument holds — ten repos, no vantage point. The zoom into
one repo falls out of it for free and is the part that will still be here when you have outgrown
the rest of this tool, because git will still not have grown a way to do the first thing.

**It costs no new authority.** `log` has been on `READ_ONLY_VERBS` since pass 1, so the entire
feature lives in the tier that provably cannot write, and the list is still four verbs long. The
commit view uses `git log -1 --stat` and `git log -1 -p` rather than `git show`, which does the
same job — a fifth verb bought nothing and so was not bought.

It is built on `sweepPaths`, not `sweep`, for the same reason the back door is: history does not
need to know what is loose, and asking ten repos for a status they will never print costs about a
second. `tack log` is roughly 0.5s against the glance's 1.4s.

### The guard that this pass made necessary

**The verb allowlist stopped being sufficient here, and that is worth understanding before adding
anything else.**

Until this pass, every argument Tack handed git was a literal typed into `tack.js`. Nothing could
vary, so guarding the verb guarded everything. `tack log <ref>` is the first argument that comes
from whoever is typing.

That matters because a *reading* verb can be made to write:

```
git log --output=FILE      # writes FILE. `log` is on the allowlist.
```

So there is a second guard, on the argument rather than the verb. `safeRef()` requires a ref to
look like a ref — letters, digits, dot, dash, slash, underscore — and to begin with something
other than `-`, which is what makes an argument an option. Ranges (`a..b`) are refused too.
`safeCount()` does the same one size down for `-n` and `--days`: they are rebuilt from a parsed
integer rather than passed through as text.

Seventeen refused strings are asserted by value, and there are mutants that remove the guard,
allow a leading dash, and allow a range.

`git check-ref-format` would be the thorough answer and is deliberately not used: it means putting
a second git verb on the allowlist in order to validate an argument to the first, which is a
larger hole than the one it closes.

**The rule to carry forward: an allowlist of verbs is only a complete guard while every argument
is a literal.** The next feature that takes user input has to bring its own argument guard.

### Which commits are yours

Every commit in this tree is authored `RevBrd`, whether a session made it or Trevor did, so git's
own author field cannot tell them apart. What can is the `Committed with Tack.` trailer that
`write.js` puts in every commit made from the pane. So the log marks those `you`.

That is a fact being read off the message, not intent being inferred — which is the distinction
the live gate is about, one section down. Tack does not guess who did anything.

### A count it refused to make

The first draft printed `60 older not shown`. The suite caught it, and the reason is worth keeping.

Each repo is asked for `limit` commits, so the merged pool is at most `limit × repos`. That number
was really "how many I held back out of the batch I happened to fetch" — which understates by
however much history sits beyond each repo's own cut, in an amount nothing can know without
reading every commit in the tree.

What *can* be known exactly is whether anything was left out at all: it was, if the pool overflowed
**or** if any single repo returned a full share and might have had more behind it. So the boolean
is reported and the count is gone. It now says `older commits not shown`.

Same family as `10 loose` rather than `10 files loose`: do not state a number you cannot stand
behind, even when a number would look more useful than the truth.

### In the pane

`l` from either list opens the history of the repo under the cursor, `enter` opens one commit, `q`
comes back. It works on a **clean** repo, which no other verb in the pane does — everything else
needs something loose to act on, and "what has been happening in here" is a question you ask when
there is nothing to do as much as when there is.

Both views are asserted inert: `a`, `c` and `u` do nothing while history is open, because each of
them is one `return true` away from being live in a view that must stay read-only. There are
mutants that let each view fall through to the keys that stage and discard.

**The pane shows the stat and never the patch, and does not even fetch it.** It runs on the
alternate screen precisely so that nothing it draws lands in your scrollback — which makes it the
wrong surface for four hundred lines of diff. The diff belongs in the glance, where the terminal's
own scrollback is doing its job. So the commit view names the command instead of pretending to be
a pager.

## The live gate, and why it is a warning rather than a block

**Built twice, wrong twice, removed.** Worth writing down because the reasoning generalises.

*Version one* refused whenever the repo was live. That blocks the commonest honest use there is:
you edit a file, you dislike it, you want it back — and your own edit is what made the repo live.
**A guard that fires on the person it is meant to serve gets switched off, and then it is not a
guard.**

*Version two* refused when a file you had **not** picked moved recently, on the theory that
movement elsewhere means somebody else is in here. It fires on an untracked file you made a minute
ago, which is nobody's live work. And it still cannot see the case it exists for: a file another
session is editing right now looks **exactly** like a file you were editing right now. The status
code does not even change — an edit on top of an edit is `.M` either way — so the stale-picture
check is blind to it too.

The signal does not exist. Pretending otherwise buys a refusal that annoys the user in the common
case and protects nobody in the rare one.

So: **the attic is what makes this safe, and the warning is what makes it informed.** The confirm
screen lists what moved in the last few minutes and says "if that was not you, somebody else may
be working in here" — then lets the person decide, having copied the bytes out first. The worst
outcome is a file to drag back, not work that is gone.

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
  tack.js            the engine, the glance and the history. CANNOT WRITE.
                     Tuning block at the top; safeRef beside git()
  write.js           the only file that can write. Its own allowlist and guards
  sit.js             the pane -- drawing and keys, including the two read-only
                     history views. Pure enough to test without a terminal
  undo.js            the only file that can destroy work. One verb, and the attic
  open.js            the back door -- find a file, refuse to run it, hand it over
  roots.json         the only hand-written list: roots, never repos
  tack.cmd           the shim, so it is one word instead of a path
  Look.bat           double-click: the glance
  Sit.bat            double-click: the pane
  tools/selftest.js  500 assertions + 108 mutants across all five files
```

The split is the security model, not tidiness. `tack.js` runs on every glance and has no
capability to write, so a session reading it can confirm in one place that looking costs nothing.
`write.js` and `undo.js` are the whole of the risk, and between them they are under 400 lines --
short enough that reviewing what Tack may do to your machine is an afternoon, not a project.

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
one shape in every font.

## The shapes, and why there is more than one

```
tack faces
```

Four of him — `plain`, `bat`, `batlite`, `ascii` — every mood, side by side. **Which glyphs render
well is a property of the font on the machine reading them, and this file cannot find that out**,
so it shows them all and whoever is looking decides. `--shape=NAME` tries one; `SHAPE` in the
tuning block keeps it. `batlite` is the ears in `/\`, for a font whose diagonals are ugly.

The ears are Trevor's, from reading `.bat` as an animal rather than as Windows' extension for a
batch file. The truth is duller than the misreading, so the misreading won.

**What a shape must satisfy, all asserted for every shape in the table:**

- Every line is the **same width**, or the text beside it shears.
- At least three lines.
- **Only the eyes change with the mood.** Every other line is identical across all four moods —
  asserted line by line, because a shape whose whole head twitched would be a performance rather
  than a readout.
- Text attaches to the **last two lines**, so a taller shape grows *upward* and nothing else has
  to move. There is a mutant that pins the text to lines 1 and 2, which is invisible on a
  three-line shape and shears every taller one.

That last rule is why the ears cost nothing. `headBlock()` is the only thing that knows where text
goes, and both the glance and the pane call it, so the two cannot disagree.

**A note on what these assertions used to say.** The first version asserted *"the creature is
three lines"* — an incidental fact rather than a property. It caught nothing, and then went red
the moment a shape grew ears, which is the worst of both: no coverage, and a false alarm later.
The rules above are what it should have said from the start. Worth remembering when writing an
assertion about anything cosmetic: pin the rule, never the current output.

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

**Restoring is done** (pass 2b, 24 Aug 2026). Of the four rules written here before it was built,
three shipped as planned and one turned out to be wrong — see *The live gate* above, which is the
most useful paragraph in this file.

**Nothing here deletes a file.** Not `git clean`, not `rm`, not emptying the attic. Every verb
Tack has either creates something or replaces a file's contents with a copy that is kept. There is
no path through this program that ends in a file not existing where one did before, and that is
the property to check any future pass against.

It is asserted, on the case most likely to break it: `git rm --cached` leaves a file staged-deleted
in the index while it is still sitting on disk, and git reports it as **two entries with the same
name** -- one `deleted`, one `untracked`. Restoring a worktree from an index with no entry for that
path is exactly the shape of an accidental delete. It survives, and the duplicate is collapsed
before anything reaches git rather than being acted on twice with two different intentions.

**History is done** (25 Aug 2026) — see *Reading history* above. The `tack find <text>` idea it
was filed beside is still open and is now cheaper to build, because the argument guard it would
have needed already exists.

**A search across the tree** — one query, ten repos — remains the obvious next *read*. `tack find
<text>` would answer "where did I write that" without knowing which repo it was in. It would want
`grep` on the allowlist, which is a fifth verb and therefore a deliberate conversation rather than
a convenience: `git grep` accepts `-O` and `--open-files-in-pager`, which run a program. The
argument guard is the model to copy, not the verb list.

**KSP Tools' `package-lock.json` has been loose for three weeks** and is probably an accident. Tack
reports it; deciding is Trevor's.

**Games is 225+ commits ahead of `github.com/RevBrd/browser-games`** with `push = no_push` set
deliberately. Tack shows the `↑` count. Pushing is not a verb it has and should not become one
without a conversation — it is the one action here that leaves the machine.

## Credits

Built by **CTown 6** (Opus 5), 20-24 Aug 2026, with Trevor directing — sweep, creature, launchers,
tests, and this file, in one session. Pass 2a — `write.js`, `sit.js`, the guards, and 90 more
assertions — in the same session, immediately after Trevor read the first sweep.

The idea and the framing are Trevor's: a branded tool for the command line, and the observation
that the real problem was not knowing the commands but not being able to *see anything*. The
mascot was originally going to be a copy of Shim; the argument against it — that a decorative
duplicate spends the real one's credibility, and that Shim's contract (*nothing may ask an instance
to do anything*) is the opposite of what a user-facing assistant does — is mine, and Trevor took
it. **Tack** is Trevor's pick out of a shortlist.

Pass 2b -- `undo.js`, the attic, the typed confirmation -- 24 Aug 2026, after Tack had been in
daily use for four days and had committed its own two previous passes.

The back door -- `open.js`, `tack open` -- the same day. Trevor asked for it, I argued it belonged
in Marquee and built it there, and he came back with the case that changed my mind: it is an admin
route for when Marquee is the thing under inspection, not a second launcher. Both exist now and
they do different jobs.

Two calls of Trevor's that improved the design and are worth attributing: **blocking the whole Pet
folder** rather than `log.js` by name, which removes a judgement call from a guard that should not
have one; and **leaving `git add -A` out entirely** rather than building it behind a warning, asked
for the moment he understood what it did.

The history -- `tack log`, `safeRef`, the pane's two reading views, and 139 more assertions with
30 more mutants -- by **CTown 8** (Opus 5), 25 Aug 2026. Trevor asked for a way to read commit
logs and wanted both the whole tree and one repo at a time; the three zoom levels are his ask for
"a quick read that you can zoom in from" taken literally.

Two things I would not have found without writing the tests. The **argument guard** came out of
checking whether a commit view needed `git show` on the allowlist -- it does not, and looking at
why turned up that `git log --output=` writes a file, which meant the verb list had quietly
stopped being a sufficient guard the moment a user-typed ref existed. And the **count that was a
lie** was caught by an assertion I had written expecting it to pass.

Same convention as the rest of the tree: **if you change something here, add yourself.**
