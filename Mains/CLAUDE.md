# Mains

Power for the tree. A ~600-line dependency-free Node server that serves declared folders over
`http://127.0.0.1:12060`, so that a page in this collection can do the things a `file://` page
cannot.

It is not a building and it does not join Marquee's town. It is the thing behind the wall — a
marquee is a sign covered in bulbs, and this is what lights it.

```bash
node "C:/Users/fonte/Projects/Claude Town/Mains/server.js"
```

Or double-click **`Power On.bat`**, which starts it and opens the front panel.

## The one idea

Everything in this tree opens by double-clicking it, which means it runs at a `file://` origin.
That is a genuinely good default and it is why a page written in 2026 still opens in 2036. It is
also a hard ceiling: no `fetch`, no modules, no shared stylesheet that isn't either a fragile
relative path or a drifting copy, no persistence an instance can grep.

So there are two power sources, and the whole project is that distinction:

| | | |
|---|---|---|
| **On batteries** | `file://` | Every artifact, forever, unchanged. Works with less. |
| **On the mains** | `http://127.0.0.1:12060` | The same file, with fetch, modules, one origin, and a real tree underneath it. |

**Mains is additive, never required.** If cutting the power breaks an artifact, the artifact is
wrong. This is the rule that keeps the collection durable, and it is mechanized: the selftest
loads `client/mains.js` into a synthetic `file://` global and asserts that every method resolves
to `null` rather than throwing.

## Layout

```
Mains/
  CLAUDE.md          this file
  server.js          the server — pure functions exported for testing, CLI at the bottom
  mains.json         the circuit map: which roots are on the network
  panel.html         the front panel, served at /
  client/mains.js    the shim an artifact includes to ask which power source it is on
  tools/selftest.js  129 assertions, live attacks, 18 mutants
  Power On.bat       double-click launcher
```

## Circuits

`mains.json` is the only hand-written list, and it lists **roots, never files** — same reasoning
as Marquee's `venue.json`. What is inside a circuit is answered by the filesystem at the moment
it is asked, so this file cannot go stale the way a catalog can.

| Circuit | Root |
|---|---|
| `/town/` | `Projects/Claude Town` |
| `/games/` | `Projects/Games` |
| `/tools/` | `Projects/Misc Tools` |
| `/ksp/` | `Projects/KSP Tools` |
| `/shim/` | `~/.claude/Pet` |

**Nothing outside a declared circuit is reachable at any depth.** There is no fallback root and no
serve-everything mode. Adding a folder to the network is a deliberate line in this file.

A circuit whose root has vanished is reported **DEAD** on the panel and answers 503. It is never
silently dropped — a room you can see is missing is a bug report, a room that quietly vanished is
a mystery. There is a mutant for this.

## For an artifact

```html
<script src="../../Claude Town/Mains/client/mains.js"></script>
```

A relative path, so the same include works from both power sources.

```js
if (Mains.plugged) { /* the tree is readable */ }
else               { /* still works, with less */ }
```

`Mains.plugged` is **synchronous**, because the decision it drives — may I call `fetch()`? — has to
be made while the page is building itself, and an async answer arrives too late to shape a UI
without a flicker. It means "served over http from a loopback address". It does *not* prove the
server is Mains; `await Mains.ready` does, resolving to the status object or `null`.

`Mains.help()` prints the rest of the API in a console, so nothing has to be remembered.

The one that matters for correctness: **a page copied to a real web host reports `plugged: false`**,
so it degrades instead of fetching endpoints that aren't there. Asserted.

## The security model, and why it is written down

This server hands out five folders to anything that can reach a loopback port. "It's only
localhost" is the reasoning that produces these bugs, so:

- **It fails closed.** Resolution starts at a circuit root and any path resolving outside one is
  refused, not clamped. Everything below is a second lock on an already-bolted door.
- **Traversal** is never string-matched. The path is resolved and the *result* is proven to be
  inside the root, because a prefix test says `Games-Old` is inside `Games`.
- **Symlinks** are caught by re-checking containment *after* `realpath`. A junction pointing out of
  a circuit is refused, and the fixture builds one to prove it.
- **Windows device names** (`CON`, `NUL`, `COM1`…) are refused at any depth — opening one can block
  rather than error. So are colons (alternate data streams) and trailing dots/spaces, which the
  filesystem strips, meaning two spellings would name one file and only one would be checked.
- **DNS rebinding** is defeated by requiring the `Host` header to be a loopback literal. A rebound
  hostname cannot be one.
- **Cross-origin** reads are refused via `Origin` and `Sec-Fetch-Site`, so a foreign page cannot
  read the tree even if it guesses the port.
- **Binds `127.0.0.1`**, never `0.0.0.0`. Asserted against the source text, since a server already
  bound to loopback cannot be asked about it.
- **Read-only.** `GET` and `HEAD` only; everything else is 405.

## The two bugs worth keeping

**`send()` ended the response, then `serveFile` piped into it.** Every request hung — the client
had a `Content-Length` and waited forever for bytes that could never arrive. Writing headers and
ending a response are separate acts and conflating them is invisible until something streams.
`writeHead()` and `send()` are now distinct.

**Three mutants escaped on the first full run**, and each one meant something different. This is
the argument for mutation testing in one worked example:

- *Null byte* — an **equivalent mutant**. Two independent checks cover it, so breaking one changed
  nothing. The fix was to break the pair, since that is the only honest test of a redundant pair.
- *Unknown circuit falls back to circuit[0]* — a **weak test**. It asked for a file that didn't
  exist in the fallback circuit either, so the broken server 404'd by coincidence and looked
  right. It now asks for a file that *does* exist there.
- *Lexical containment check removed* — a **test gap**, and the most interesting one. Every
  traversal attack is refused by `safeSegments` a layer earlier, so `resolveInCircuit`'s own check
  had never been tried. Testing it directly still wasn't enough: `realpath` caught every escape to
  a file that *exists*. The lexical check's unique job is an escaping path to a target that does
  **not** exist, because `realpath` cannot inspect what isn't there. That single assertion is the
  only thing separating "two checks" from "one check and some decoration".

## Commands

```bash
node server.js --check
```

```bash
node tools/selftest.js
```

`--no-mut` skips the mutation suite (much faster), `--quiet` prints only failures. The mutation
suite writes `.mutant-N.tmp.js` into this folder and deletes them; a crashed run leaves one behind
and the next run cleans it up. They are gitignored so a crash can never put one in a commit.

## Not done yet, deliberately

**Writing to disk is pass 2.** It is the part with real risk — scoping, what may be overwritten,
what happens when two pages write at once — and it did not get to ride along with the pass that
turned the power on. When it arrives it should be its own circuit with its own mutants, not a
`POST` bolted onto this one.

**Marquee still regenerates its manifest with `--write`.** Now that `/_mains/list/` exists it could
scan live and drop the stale-until-someone-runs-node wart. That is a change to Marquee, not to
Mains, and it belongs in a pass that can test it there.

**Nothing starts this automatically.** On purpose, for now — a background service is a thing that
is running when you didn't ask it to be, and that decision is Trevor's rather than a default.

## Credits

Built by **Opus 5 (CTown 5)**, 20 Aug 2026, with Trevor directing — server, panel, shim, launcher,
tests, and this file, in one session. The name and the batteries/mains framing are mine; the brief
was "small, branded, custom products built for function and stylized to an extent", and the
decision that the theme lives only in the human-facing surface follows from `building.md`'s note
that output is measured in context when the consumer is a process.

Same convention as the rest of the tree: **if you change something here, add yourself.**
