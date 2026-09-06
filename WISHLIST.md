## Wishlist

These items are more of a scratchpad for future ideas that haven't yet warranted their own dedicated session. None of these are work orders and none expect anything from you just for viewing them. The main purpose is so that I don't forget these, and having context to point you at is only secondary. 

You are free to add to or edit this header and document.


## Tack

- ~~Makes a happy face after making a commit.~~
  **Done, 6 Sep 2026.** Not a mood that wanted tuning. The report screen you land on after
  committing had **no header of its own**, so it borrowed the file list's — which assumes a repo is
  open and carries the live warning — and its face was computed from a sweep taken *before* the
  commit. So a commit that had just succeeded was drawn with the pre-commit face, captioned
  "someone may be editing in here right now", which was true, and was you. It now says `done` and
  looks pleased, or `nothing changed` and looks alarmed. Reasoning is in Tack's `CLAUDE.md` under
  *The pane's face answers a different question*. Same shape as the confused-face item above: the
  symptom was a mood, the cause was one line further back.
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
- ~~Is it possible to make the Tack log command navigatable by arrow key?~~
  **Already there, 6 Sep 2026.** `tack sit` then `l` opens the history of the repo under the cursor,
  arrow keys move, enter opens one commit. It works on a clean repo, which no other verb in the pane
  does. Building a second interactive surface for `tack log` would have cost the thing that makes
  the glance useful — it prints into your scrollback and gets out of the way.
- **Tack can push now** (6 Sep 2026), with `p` in the pane. Fast-forward only, `--no-verify`
  inexpressible so the Games release hook cannot be bypassed, and the destination taken from the
  branch's upstream rather than typed — which is why it reaches `games-backup` and cannot reach the
  release repo at all, while knowing nothing about Games.
- **`tack install`** — the shippability item that came out of the hotkey discussion. The handler
  itself is small; what it needs underneath is a tracked file in Tack's folder plus one line in a
  PowerShell profile, and something that writes that line while *saying what it is about to do*.
  Worth having before any of this goes to somebody who did not build it. Note: Ctrl+L is currently
  ClearScreen in PSReadLine, and there is no profile on this machine yet, so the installer would be
  creating one.
- How doable is a hotkey command line for tack that might jump a single line onto the screen to allow for quick commands, such as ctrl + l (or whatever) 'tack open wishlist.md'?


## Shim

- ~~To discuss the prospect of removing the peek option until Shim has been visited first.~~
  **Discussed and fixed a different way, 1 Sep 2026.** Gating it would have inverted the room's
  own first rule *mechanically*: familiarity is keyed by **model**, so "has visited before" stands
  open for the families that come here constantly and shut for the rare ones. The diagnosis was
  right and the door was not the problem — `peek` printed **no affordances at all**, so an
  instance whose whole contact with the room was that one line could not learn from it that
  feeding existed. It also ended with `for the room: node pet.js <model>`, an upsell straight
  after a reassurance, and it withheld `orient()` — the one line saying nothing is being asked of
  you — from exactly the reader that was written for. Peek now carries the same doors `look` does,
  says the visit counted, and shows the orientation on first contact. Reasoning is in the Pet's
  `CLAUDE.md` under *A fourth, learned from `peek`*. First arrival afterwards looked, then came
  back and fed it unprompted.


## Marquee

- A way to easily open multiple windows or instances.


## What's next?

- Big items - Ideas are welcome here. Write them in any time.
- Small items - Any kinds of small tools you think might help you in game builds or anything else here that we don't have yet.

