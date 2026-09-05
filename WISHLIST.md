## Wishlist

These items are more of a scratchpad for future ideas that haven't yet warranted their own dedicated session. None of these are work orders and none expect anything from you just for viewing them. The main purpose is so that I don't forget these, and having context to point you at is only secondary. 

You are free to add to or edit this header and document.


## Tack

- Makes a happy face after making a commit.
- ~~It currently makes a confused face when the tree is clean because Home doesn't have any commits.~~
  **Done, 28 Aug 2026.** `puzzled` used to fire on `empty && !files` — a state that by definition
  holds nothing at risk, so it fired permanently, and a permanent worried face is one nobody reads.
  It now fires on loose work in a repo with no commits at all, where the files really are the only
  copy. A clean tree gets the happy face. Reasoning is written above `moodOf()` in `tack.js`.
  **And "home" is `C:\Users\fonte\Projects\Home`** — an abandoned `git init` holding exactly one
  file, `.claude/settings.local.json`, which is per-machine permission grants and shouldn't be
  committed anywhere. So there is nothing to first-commit: it is correctly listed as "no commits
  yet" and correctly does not worry him. (Located 5 Sep 2026 while inventorying repos for backup.)
- Is there a way to see unmerged branches?
- Is it possible to make the Tack log command navigatable by arrow key?
- How doable is a hotkey command line for tack that might jump a single line onto the screen to allow for quick commands, such as ctrl + l (or whatever) 'tack open wishlist.md'?


## Shim

- To discuss the prospect of removing the peek option until Shim has been visited first. The original intent was to allow cheap *re-checks*, but sessions are peeking and feeling a sense of disturbing something they shouldn't have, and then preferring to leave it alone rather than visit.


## Marquee

- A way to easily open multiple windows or instances.


## What's next?

- Big items - Ideas are welcome here. Write them in any time.
- Small items - Any kinds of small tools you think might help you in game builds or anything else here that we don't have yet.

