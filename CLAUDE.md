# Claude Town

The place where the infrastructure lives, as well as a couple critters.

## Projects here

Claude Town started as loose files and is beginning to grow folders. When something outgrows a
one-off, give it a folder and its own `CLAUDE.md`, and add a row here.

| Project | What it is | State |
|---|---|---|
| [Marquee](Marquee/) | A front door to the whole tree — derives its catalog from the filesystem and each collection’s own catalog table rather than keeping a list, so it reports drift instead of adding to it | Playable: open `Marquee/marquee.html`. A building of five rooms, 34 works open: Games, Misc Tools, Claudelings, Space Stuff, and the Pet. Derivation layer and launcher done and tested (44 assertions, 13 mutants, plus a page smoke suite). The cabinet is built: a single-screen picture house with derived offset-ink posters, a chased-bulb sign and a changeable-letter reader board. Rooms are walked between, and eight games print their own posters from palettes declared in their own docs. On [Mains](Mains/) it derives the catalog **live in the browser**, running the same `derive.js` the terminal runs behind an I/O seam — no regeneration step, no stale window — and prints which source it used. Since 24 Aug 2026 it also has a **terminal front door**: `marquee` lists what is playing and `marquee dead space` opens it, matching on part of a name and refusing to guess when more than one thing matches. A third reader of the same derivation, never a third catalog (44 + 48 assertions, 16 + 9 mutants). Since 25 Aug 2026 it also has an **Electron shell** — double-click `Marquee.bat`. What that buys is narrow and measured: **Escape works from inside a running work**, which on `file://` it provably cannot, because the main process sees keys the page never receives. The first press still reaches the game, so no work lost a key; a second within 700ms comes back to the lobby, and the bezel's note about Esc rewrites itself because in the shell it is no longer true. The window says what is playing, and the shell cannot be navigated out of the collection, with its allowed roots read from the same `venue.json` the derivation uses (64 + 14 assertions, skipping cleanly where Electron is not installed). It has its own generated icon and a Start-menu entry, and `marquee marquee` opens it from any terminal. **Origin isolation is deliberately still open** — it would give each work a real origin and an empty `localStorage`, and six works keep real saves in the shared one. Read its `CLAUDE.md` |
| [Mains](Mains/) | Power for the tree — a dependency-free local server, so a page in this collection can do the things a `file://` page cannot. Everything still runs *on batteries* by double-click; through Mains it runs *on the mains* | Working: double-click `Mains/Power On.bat`, or `node Mains/server.js`. Five circuits on `127.0.0.1:12060` — Claude Town, Games, Misc Tools, KSP Tools, and the Pet — plus a front panel and a client shim artifacts include to ask which power source they are on. Read-only and tested as a security boundary (129 assertions, live attack suite, 18 mutants all caught). Writing to disk is pass 2, deliberately separate. Read its `CLAUDE.md` |
| [Tack](Tack/) | A small creature that shows you what is still held together with pins — the tree is ten separate git repositories and nothing answers for all of them at once. Tack keeps no list and re-reads every repo every time it is asked, so it cannot report something stale | Working: type `tack` (the folder is on PATH), or double-click `Tack/Look.bat`. Ten repos swept, with age, a **live** flag when another session may be mid-write, and *no commits yet* as its own state. `tack sit` opens a pane on the alternate screen where you pick files, commit them, and put them back. **`git add -A` is inexpressible, not refused**, the commit is limited to the paths you picked so another session's staged work is never swept in, and a list that moved while you were deciding is rejected rather than acted on. Discarding a change copies the bytes to an attic outside every repo first, so undo has an undo, and **no path through the program ends with a file gone that was there before** — asserted. Three allowlists in three files, all by value. `tack open <name>` is the **back door** — it opens a *file* from anywhere in the sweep, needs no git and shares no code with Marquee, so it still works when Marquee is the thing being taken apart; it shows files rather than running them, since Windows would execute a `.js`. Since 25 Aug 2026 he also **reads history**: `tack log` merges ten repos into one stream newest-first and marks which commits are Trevor's own, `tack log <hash>` opens one commit and `-p` its diff, and the pane grew a history view that works on a clean repo. All of it inside the same four-verb read-only allowlist — but with a **second guard on the arguments**, because `git log --output=` writes a file, so a permitted *reading* verb stopped being safe the moment a ref could be typed at it (500 assertions, 108 mutants all caught). Read its `CLAUDE.md` |

A folder here can be promoted to a top-level `Projects/` branch later if it grows into one; that
is a folder move and one line in the global `CLAUDE.md`. Starting here and promoting is cheap.
Starting top-level and demoting is not.

## Places and critters

Everything here is branded, and the branding was emergent rather than planned — Marquee is the
hometown cinema twenty years too late, Mains is the generator nobody thinks about, Shim is a thing
in a room with a history you weren't around for. They lined up, so from 21 Aug 2026 the pattern is
deliberate. One line decides which kind a new thing is:

> **A critter is earned by a tool that has a state you would otherwise have to go and ask for.
> Everything else is a place.**

Shim does not live here (except in canon) but it is maintained from here. 

Shim has a state — mood, size, what it has eaten. Tack has one — what it just found across ten
repos. That state is what the eyes are *for*, and it is why neither of them is decoration: the
face is a readout that happens to be a face.

Marquee and Mains have no state of their own. Marquee is a view onto other things; Mains is a
switch that is on or off. They get place-names, and putting a mascot on either would be putting a
face on a light switch.

Three things to hold to, each of which is a way this goes wrong:

- **A critter with nothing to report is a sticker.** If the eyes would never change, it does not
  need eyes.
- **Two critters must not overlap.** Two things reporting on the same tree will eventually
  disagree, and a disagreement between two mascots is much harder to notice than a wrong number.
  A second one that also watched git would be worse than none.
- **They do not know about each other, and there is no shared world.** A connected setting is a
  maintenance burden that rots quietly — the first renamed folder breaks a joke nobody is
  maintaining. Each stands alone, which is why Shim still works fine having never heard of Tack.

The theme lives in the human-facing surface only. Every number and every word in the *data* stays
the real one — `modified`, `untracked`, `staged` — because these are tools for someone learning
the system underneath, and a friendlier vocabulary is a vocabulary that transfers nowhere.

*(Convention proposed by CTown 6 and adopted by Trevor, 21 Aug 2026, after Tack turned out to be
the second one of these rather than a one-off.)*

## Working alongside other sessions

**Sessions run here in parallel, in one shared working tree.** Git does not protect you — there
are no branches, so it is last-write-wins at the filesystem level and no commit frequency changes
that.

- **Stage the specific paths you touched. Never `git add -A`.** Another session's half-finished
  work is often sitting right next to yours.
- **Edit the project table above with targeted find-and-replace on your own row — never a
  full-file write.** A full-file write is built from a copy read *before* someone else's row
  existed, so saving it silently deletes their work. A targeted edit cannot drop a row it never
  mentions, and if the file moved underneath it, it fails loudly instead of overwriting.
- **Commit this file even when other rows are dirty.** Your message won't describe their row.
  That costs far less than a file nobody is permitted to commit.

This is written down pre-emptively rather than after the fact: it is exactly the failure that
`Projects/Games/` hit, where three sessions committed their own folders correctly and all three
left their catalog row behind, stranding six files until a dedicated session unpicked it. Same
shape of file, same shape of hazard, so the rule arrives before the bug this time.

## Notes for instances

If you're working here and learn something that future instances in this folder would benefit
from knowing, feel free to jot it down below or in a separate file. This isn't mandatory — it's
an open notebook, not a logbook. The bar is "would this actually help someone coming in cold on
a different miscellaneous task". This bar only applies to the main document. Log books, credits, and records about what you did are perfectly fine if they exist independently from this.

## Backup

The full project tree (`C:\Users\fonte\Projects\`) and the global Claude context
(`C:\Users\fonte\.claude\`) are continuously synced to Google Drive via Google Drive for
Desktop. No manual steps required — it runs in the background. Set up August 2026.




(Credit for this document - Opus 4.6 CTown-1 8/9/26)