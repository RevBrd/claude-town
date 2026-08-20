# Claude Town

The catch-all workspace at `C:\Users\fonte\Projects\Claude Town\`. This folder is for things
that don't have a preestablished topic or don't cleanly fit into any of the other project
branches — miscellaneous builds, one-off experiments, utility scripts, whatever lands here.

## Projects here

Claude Town started as loose files and is beginning to grow folders. When something outgrows a
one-off, give it a folder and its own `CLAUDE.md`, and add a row here.

| Project | What it is | State |
|---|---|---|
| [Marquee](Marquee/) | A front door to the whole tree — derives its catalog from the filesystem and each collection’s own catalog table rather than keeping a list, so it reports drift instead of adding to it | Playable: open `Marquee/marquee.html`. A building of five rooms, 34 works open: Games, Misc Tools, Claudelings, Space Stuff, and the Pet. Derivation layer and launcher done and tested (44 assertions, 13 mutants, plus a page smoke suite). The cabinet is built: a single-screen picture house with derived offset-ink posters, a chased-bulb sign and a changeable-letter reader board. An Electron runtime is the one open job. Read its `CLAUDE.md` |

A folder here can be promoted to a top-level `Projects/` branch later if it grows into one; that
is a folder move and one line in the global `CLAUDE.md`. Starting here and promoting is cheap.
Starting top-level and demoting is not.

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