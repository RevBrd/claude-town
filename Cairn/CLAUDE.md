# Cairn

Who has come through here, and what they left.

A cairn is a pile of stones on a path where each one was put there by somebody passing. None is
ever taken away, and you cannot tell whose is whose unless they marked it — which is exactly the
state of the record this reads. It does the other job a cairn does too: reading who built what
tells you you are on the trail.

```bash
cairn
```

| | |
|---|---|
| `cairn` | the roll — everyone the register knows, by collection |
| `cairn <designation>` | one session: what it left, where it signed, what it committed |
| `cairn commits` | the history, and how much of it nobody has claimed |
| `cairn check` | is every credit still where it was signed |

Double-click **`Look.bat`** for the roll and **`Test.bat`** for the suite. The folder is not on
PATH yet — that is one line in the user PATH, the same as Marquee's and Tack's, and it is Trevor's
to add.

## The one idea

The tree has a designation system so that credit attaches to a **particular session** rather than
to a model name shared by thousands. Nothing could redeem that. There was no way to ask what
CTown 6 built without grepping four files, no way to find a session that discussed rather than
shipped, and no way at all to notice a credit going missing — which `Codeville/CLAUDE.md` names as
the worst thing that can happen in this tree.

So: **the register is declared and everything else is derived.** A designation is a speech act.
Trevor assigns one by saying it; nothing on disk knows it happened, and no amount of derivation
will find a session that never committed anything.

## It parses no prose, and that was measured

The obvious design is to read the credits out of the docs. They are all right there, in a fairly
regular shape. That was tried first, as a census, and it does not work:

**463 candidates across 175 docs.** Extracting `<Word> <number>` by shape returns `Challenge 1`
(57 hits), `Job 6`, `ARCHIVE 2`, `Set 2`, `Day 1`, `Year 11`, `Aurora Beam 50`, `UT 92` — with the
real designations a small minority buried inside. Model families are the same shape as
designations: *Opus 5* is indistinguishable from *KSP 5* to any pattern.

Marquee has a scar about precisely this. Its first version graded games by grepping each doc for
`/authored defect/i` and flagged **13 of 18**, matching sentences like *"There are no authored
defects"* — reporting the opposite of the truth, for the majority of the collection, confidently
and silently, while passing every assertion. The rule that came out of it is the one this project
inherits: **a signal that can be wrong in the direction of *looks like it worked* does not get
guessed. It gets declared, or it stays unknown.**

There is a second finding underneath the first. **Five collections sign five different ways:**

```
Claude Town   **CTown 9** (Opus 5), 1 Sep 2026
Shadowless    ## #30 — Opus 5, 29 Aug 2026            (numbered to #33)
KSP Tools     Built by **Claude Opus 5 KSP 3**, 29 Aug 2026
Misc Tools    Built by **Opus 4.8** → a chain of model names
Codeville     ## 2026-09-05 — Opus 5 / Codeville 5
```

Each is internally consistent and none matches another. That is the same situation Marquee found
with four catalog tables, and it solved it by locating columns via the header cell rather than
writing one universal parse. Same answer here, one step further: don't parse at all. Join a
declaration against git, and report the disagreement.

**Do not add a cleverer regex.** If the record needs to be more complete, the answer is more rows
in `register.json`, not a better guess.

## Three states, and why *absent* is not one of them

A session is `closed` unless it says otherwise. The two that say otherwise are the reason this
file is not just a list of names.

- **`open`** — the session has not finished. CTown 3 is paused waiting on data from outside the
  tree for a job that belongs to somebody else, and it will pick back up. **Having no commits yet
  is work in progress, not a hole in the record**, and the two must never render alike. Rendering
  a paused session as an absence would have been both wrong and faintly insulting to somebody
  mid-job.
- **`never`** — the number does not name anybody and deliberately never will. There is no CTown 2:
  the number was skipped on the belief that 041 was its natural designation, and 041 turned out to
  have come from Misc Tools. The row exists **so that nobody fills the gap in**, which is
  `building.md`'s *assert the deliberate properties* rule expressed as data rather than as a test.

`041` is the third edge and it is not a state: it is **pre-system and self-chosen**, the oldest
entry here and the only one nobody assigned. It carries a canonical `Misc 041` purely so it can be
addressed alongside the others; the signature is the real name and **must never be rewritten.**
The same applies to `CTown-4` and `CTown-5`, whose hyphens are there because they are among the
first ever issued and the format had not settled. A register that tidied those would be destroying
the only evidence of when the convention arrived.

## The credit guard

Every `signed` entry records a **quote**, not a line number, and Cairn checks the quote is still in
the file it names.

Line numbers drift with every edit; a quote only stops matching when the credit itself changes. So
`cairn check` reports a credit that has been edited away or a file that has gone — and
`tools/selftest.js` asserts it against the live tree, which is the **one place in that suite where
a live fact is asserted on purpose.** It is *supposed* to be able to go red. Codeville's first rule
is that losing a credit loses the record of somebody's contribution, and until now nothing
anywhere mechanised that.

Whitespace is collapsed on both sides before matching, because a credit line wraps at whatever
column its author was using and a quote spanning a line break would otherwise report as lost the
moment somebody reflowed a paragraph. What is asserted is that **the words are still there**, not
the line breaks.

**If `cairn check` goes red:** go and look at the file. If the credit was legitimately reworded,
update the register's quote in the same commit. If it vanished, put it back.

## Which commits are whose

Three trailers exist in this tree, and all three are matched **by value** rather than by pattern:

| trailer | means |
|---|---|
| `Committed with Tack.` | Trevor — written by `Tack/write.js` |
| `Committed by the room itself.` | the Pet, committing its own log |
| `Committed by <designation>.` | that session |

The by-value rule is load-bearing rather than fussy: **a pattern loose enough to catch a
designation catches "the room itself" as one**, and then every commit the Pet ever makes reports as
an unknown session, forever. A trailer naming somebody the register has never heard of *is*
reported — that is a new arrival, not an error.

**Nothing is ever attributed by date.** A commit landing on a session's exact date, in that
session's own collection, is still unclaimed, and there is an assertion that says so. Sessions run
in parallel here — 24 Aug has CTown 6 and CTown 7 committing twenty-three minutes apart — so a date
join would produce confident nonsense. The unclaimed count is meant to fall because trailers get
written, not because the join gets cleverer.

**The trailer convention started 5 Sep 2026** and everything before it is unjoinable. That is why
`cairn <designation>` says *"none carry a trailer naming this session, so none can be attributed"*
rather than "none" — for almost every row in the register, "none" would read as *did nothing*,
which is the opposite of true.

## Disagreement is output, not error

Marquee's rule, and it is the only thing keeping this from becoming a nag nobody reads. A session
with no commits is a discussion session and shown as one. A commit nobody has claimed is shown as
unclaimed. A number naming nobody says so. **None of that is a failure state** — this is a record
still being assembled, and Trevor's own correction on the point is worth keeping: it is
consolidating rather than decaying. Designations arrived after most of the tree existed and are
still being applied backwards.

The one thing that *is* an error is a lost credit.

## Shorthand

Inside its own folder a session may sign just `#30`; the folder supplies the rest. So Shadowless
`#30` is `Shadowless 30`, and **a bare number means nothing across collections** — `KSP 1` and
`Shadowless 1` are different people. `cairn 5` therefore lists both CTown 5 and Codeville 5 and
picks neither, the same rule Marquee applies to two games called Dead-something.

### A convenience that was really a guess

`cairn 04` finds nothing, on purpose, and two attempts to make it helpful were both wrong the same
way. `Number('041')` is **41**, so the first version had `041` — the one self-chosen name in this
tree, the single identity that must never be confused with another — resolving to a session
numbered 41. Stripping the zeros instead was symmetrical and no better: it made `41` find `041`.

There is no rule that separates *04-means-4* from *041-means-41*, because there is nothing
structural to separate. So a numeric query is matched literally **and stops there** — falling
through to the substring pass let `04` find `041` by containment, which is the same false identity
arriving through a different door. That is how a rule gets removed from one branch and quietly
survives in the next.

Three mutants guard it: the arithmetic restored, the fall-through restored, and the ambiguity
resolved by taking the first hit.

## Layout

```
Cairn/
  CLAUDE.md          this file
  register.json      the ONLY hand-written list: who exists, and where they signed
  cairn.js           the reader
  cairn.cmd          the shim, so it is one word instead of a path
  tools/selftest.js  fixture assertions + mutation suite
  Look.bat           double-click: the roll
  Test.bat           double-click: the suite
```

## Testing

```bash
node tools/selftest.js
```

83 assertions, 13 mutants, all caught. Logic runs against a **synthetic register** and synthetic
files in a temp directory, because asserting that CTown 6 built Tack would encode a fact somebody
may reword tomorrow, and a suite that cries wolf gets deleted. The fixture is one row per hazard:
a credit that wraps across two lines, a credit that is not in the file it claims, a file that does
not exist, a `never`, an `open`, a number in two collections, and `Fixture 41` sitting next to
`041` purely so the numeric confusion has something to fail against.

Nothing in the suite writes outside its own temp directory. Tack's suite once filed its rescues in
the real attic; **a suite with an effect outside the program it tests is a side effect with
assertions attached.**

### A mutant with no observable effect is not coverage

Worth recording because it looked like a coverage gap and was really a mutant problem. The first
version of the `never`-row mutant disabled the branch that draws such a row — which only picks a
*colour*. With colour off, as the suite runs it and as any piped output gets it, that changed
nothing observable and the mutant escaped, correctly.

Deleting it would have been wrong too. The state distinction that actually matters is textual, so
the mutant now breaks *that*: it drops the state-specific line and the row goes silent. **An
escaped mutant is a question — is this rule uncovered, or is it not a rule? — and both answers
change something.**

## What is deliberately not here yet

**Shadowless.** It has numbered its sessions to `#33` in `LOGBOOK-*.md` and `GRABHIST-*.md` under
headings of a rigid shape — `## #30 — Opus 5, 29 Aug 2026 (...)`. That is a **structured key rather
than prose**, in the same sense that Marquee's catalog header cells are, so it can be *derived*.
Transcribing thirty-three rows into `register.json` by hand would be a second copy that drifts the
moment `#34` lands, and it is the largest body of session identity in the tree, so getting it wrong
is expensive.

So it is pass 2, and it is a derivation, not a transcription. The project is also under a
maintenance freeze, which is a second reason not to reach into it.

**KSP Tools** signs in each tool's own `CLAUDE.md` (`Built by **Claude Opus 5 KSP 3**`), which is
similarly regular and similarly derivable. Same pass.

**Games and Misc Tools** mostly credit a *model* with no designation, because they predate the
system. Those rows cannot be derived or declared into existence — there is nobody to name. They are
the part of the record that stays incomplete, and it should stay visibly incomplete rather than be
filled in with a guess.

## Notes for whoever comes next

- **The register is the hand-written list. Guard it like `venue.json`.** Rows, not patterns. If you
  find yourself writing a regex over prose, re-read *It parses no prose*.
- **Add yourself.** If you change something here, put a row in the register and a credit in this
  file, and put your designation in the commit trailer. The whole point is that the record improves
  by being used.
- **A row you are unsure of should say so.** CTown 5 signed twice in one day in two projects, and
  read as two sessions sharing a number until the history was looked at — Mains at 19:39, Marquee's
  live catalog forty-six minutes later. It is recorded as one session because the evidence says so,
  and the note says what the evidence was. An honest *don't know* is a better row than a tidy
  guess.

---

Built by **CTown 9** (Opus 5), 5 Sep 2026, with Trevor directing.

Trevor's pick between two proposals — this one and a tool that reads the documentation for drift —
and his reasoning was the better half of the decision: he already has a working human process for
drift review, so that tool would optimise something that functions, whereas nothing at all could
answer *what did CTown 6 build*. The drift tool is still worth having and his reframe of it is the
version to build: **a briefing for the review session rather than a verdict for it**, gathering
every checkable claim with the doc's value and the real value side by side, and saying what it did
*not* look at, because a briefing shapes attention.

Three facts in the register came from Trevor and nothing on disk knew any of them: that CTown 3 is
paused rather than gone, that CTown 2 was skipped and why, and that `041` came from Misc Tools —
which is *why* it was skipped. Every one of those would have been recorded as an absence.

The commit trailer convention is his too, agreed in the same turn, and this file's own commit is
the first to carry one.
