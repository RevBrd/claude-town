#!/usr/bin/env node
/* The only file in Tack that changes anything OUTSIDE a git repository.
 *
 * Everything else here acts on repos, which git can answer for, or on the
 * attic, which is a folder of plain copies. This one touches two things that
 * neither git nor Tack can see: the user PATH, which lives in the registry,
 * and the PowerShell profile, which lives in Documents. Nothing sweeps them,
 * nothing backs them up, and there is no `git status` that would ever mention
 * them. So this gets its own file, the same as every other capability class.
 *
 * WHY IT EXISTS, and why it is bigger than the hotkey that prompted it.
 * Trevor's aim for this tree is that a friend who has never seen it can be
 * handed their own Tack, Marquee, Mains and Cairn and have them work. The
 * hotkey was the first thing that could not be done by copying a folder -- it
 * needs a line in a file that is per-machine, unversioned, and in a place a
 * beginner has no reason to know about. That is the shape of every remaining
 * setup step, so the answer is not a hotkey script; it is something that says
 * what it is about to do to your machine, and then does only that.
 *
 * TWO RULES, both mechanized below.
 *
 *   IT ONLY EVER ADDS. The user PATH is appended to and never replaced; the
 *   profile is appended to and never rewritten. There is no code path that
 *   removes either, which keeps the property the rest of Tack has: no path
 *   through this program ends with something gone that was there before.
 *
 *   IT REPORTS BY DEFAULT. `tack install` changes nothing. `tack install --do`
 *   is the one that acts, after printing the same list. The default is the
 *   safe one because the reader is, by assumption, somebody who does not yet
 *   know what any of this does.
 */
'use strict';

var fs   = require('fs');
var path = require('path');
var os   = require('os');
var cp   = require('child_process');
var U    = require('./undo.js');

/* The whole of this file's authority over the machine, by name. Anything not
 * on this list is not something install can touch, and the selftest asserts
 * the list by value like the other four. */
var MAY_CHANGE = ['user PATH', 'the PowerShell profile'];

/* The machine PATH is a different thing with a different blast radius: it
 * needs administrator rights and it changes the machine for everybody who uses
 * it. There is no argument anywhere in this file that selects a scope -- 'User'
 * is a literal at both the read and the write -- so this is not a setting that
 * could be passed wrongly. */
var PATH_SCOPE = 'User';

function loadConfig(file) {
  var cfg = JSON.parse(fs.readFileSync(file || path.join(__dirname, 'install.json'), 'utf8'));
  if (!cfg.chord || !cfg.marker) throw new Error('install.json is missing chord or marker');
  return cfg;
}

/* ------------------------------------------------------------------ asking */

/* THE USER PATH IS READ THROUGH .NET, NEVER BY PARSING TEXT, and that is not
 * fussiness -- it is a mistake made in this very session. The first version of
 * this check ran `reg query HKCU\Environment /v Path` and pulled the value out
 * with a regular expression. The expression did not match, the value came back
 * empty, and the check reported "Tack is not on your PATH" with complete
 * confidence while Tack was sitting on the PATH four entries down.
 *
 * That is the failure this tree keeps writing down: a signal that can be wrong
 * in the direction of "looks like it worked". Here it would have been worse
 * than wrong, because the fix it invites is to append an entry that is already
 * there. [Environment]::GetEnvironmentVariable returns the value or null and
 * has no formatting to misread. */
function readUserPath() {
  var r = cp.spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    "[Environment]::GetEnvironmentVariable('Path','" + PATH_SCOPE + "')"],
    { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  if (r.status !== 0) return null;   /* null is "could not tell", never "empty" */
  return String(r.stdout || '').replace(/\r?\n$/, '');
}

function writeUserPath(value) {
  var r = cp.spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    '[Environment]::SetEnvironmentVariable(' +
    "'Path', $env:TACK_NEW_PATH, '" + PATH_SCOPE + "')"],
    { encoding: 'utf8', windowsHide: true, timeout: 20000,
      env: Object.assign({}, process.env, { TACK_NEW_PATH: value }) });
  return r.status === 0;
}

/* `setx` is the other way to do this and is deliberately not used: it truncates
 * at 1024 characters without saying so, which on a PATH is a way to silently
 * delete somebody's tools. */

/* Where PowerShell would look for a profile. Asked of PowerShell rather than
 * assembled here, because the folder differs between Windows PowerShell and
 * PowerShell 7 and guessing would put the line in a file nothing reads. */
function profilePath() {
  var r = cp.spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    '$PROFILE.CurrentUserCurrentHost'],
    { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  if (r.status !== 0) return null;
  var p = String(r.stdout || '').trim();
  return p || null;
}

function chordIsTaken(chord) {
  var r = cp.spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    "Import-Module PSReadLine -EA SilentlyContinue; " +
    "if ((Get-PSReadLineKeyHandler -Bound).Key -contains $env:TACK_CHORD) " +
    "{ 'taken' } else { 'free' }"],
    { encoding: 'utf8', windowsHide: true, timeout: 20000,
      env: Object.assign({}, process.env, { TACK_CHORD: chord }) });
  if (r.status !== 0) return null;
  return String(r.stdout || '').trim() === 'taken';
}

function has(dir) { try { return fs.existsSync(dir); } catch (e) { return false; } }

/* Is this folder already on that PATH? Compared entry by entry after
 * normalising, never as a substring -- `...\Tack` is a substring of
 * `...\Tack-old`, which is the same shape of bug open.js already carries a note
 * about and Mains learned before either of them. */
function pathHas(pathValue, dir) {
  if (pathValue === null || pathValue === undefined) return null;
  var want = path.resolve(dir).replace(/[\\\/]+$/, '').toLowerCase();
  return String(pathValue).split(';').some(function (e) {
    if (!e.trim()) return false;
    return path.resolve(e.trim()).replace(/[\\\/]+$/, '').toLowerCase() === want;
  });
}

/* ----------------------------------------------------------------- looking */

/* Everything install knows about this machine, gathered in one place and with
 * a word for each state. `unknown` is its own answer and never renders as
 * `no` -- a check that could not run has not found a problem. */
function inspect(opts) {
  opts = opts || {};
  var cfg     = opts.cfg || loadConfig(opts.configFile);
  var tackDir = opts.tackDir || __dirname;
  var userPath = opts.userPath !== undefined ? opts.userPath : readUserPath();
  var prof     = opts.profile  !== undefined ? opts.profile  : profilePath();

  var profileText = null;
  if (prof && has(prof)) {
    try { profileText = fs.readFileSync(prof, 'utf8'); } catch (e) { profileText = null; }
  }

  var git = cp.spawnSync('git', ['--version'],
    { encoding: 'utf8', windowsHide: true, timeout: 20000 });

  return {
    tackDir:  tackDir,
    chord:    cfg.chord,
    marker:   cfg.marker,
    node:     process.version,
    git:      git.status === 0 ? String(git.stdout || '').trim() : null,
    userPath: userPath,
    onPath:   pathHas(userPath, tackDir),
    profile:  prof,
    profileExists: prof ? has(prof) : false,
    hotkeyFile:    has(path.join(tackDir, 'hotkey.ps1')),
    hotkeyLinked:  profileText === null ? false
                   : profileText.split('\n').some(function (l) {
                       return l.indexOf(cfg.marker) !== -1; }),
    chordTaken: opts.chordTaken !== undefined ? opts.chordTaken : chordIsTaken(cfg.chord)
  };
}

/* THE LINE. One line, findable again by its marker, pointing at a tracked file.
 * Everything the hotkey actually does lives in hotkey.ps1 where it can be read,
 * reviewed and changed; what goes on somebody's machine is a pointer. */
function profileLine(state) {
  return state.marker + '\n' +
    '. "' + path.join(state.tackDir, 'hotkey.ps1') + '"\n';
}

/* --------------------------------------------------------------- the plan */

/* What would change, and what is already the way it should be. Pure, so the
 * renderer draws it and the suite drives it without a machine underneath. */
function plan(state) {
  var todo = [], done = [], cannot = [];

  if (state.git) done.push('git is on PATH — ' + state.git);
  else cannot.push('git is not on PATH. Tack needs it, and this cannot install it for you.');
  done.push('node is on PATH — ' + state.node);

  if (state.onPath === null) {
    cannot.push('could not read your user PATH, so `tack` from any folder is unchecked');
  } else if (state.onPath) {
    done.push('`tack` works from any folder — this folder is on your PATH');
  } else {
    todo.push({ id: 'path', what: 'add this folder to your user PATH',
                detail: state.tackDir,
                why: 'so that `tack` works from any folder, rather than only from here' });
  }

  if (!state.hotkeyFile) {
    cannot.push('hotkey.ps1 is missing from ' + state.tackDir);
  } else if (state.hotkeyLinked) {
    done.push('the ' + state.chord + ' hotkey is in your PowerShell profile');
  } else if (!state.profile) {
    cannot.push('could not ask PowerShell where your profile lives, so the hotkey is unchecked');
  } else {
    todo.push({ id: 'hotkey',
                what: (state.profileExists ? 'add one line to' : 'create') +
                      ' your PowerShell profile',
                detail: state.profile,
                why: state.chord + ' opens a tack line at your prompt' });
  }

  return { todo: todo, done: done, cannot: cannot,
           chordTaken: state.chordTaken, chord: state.chord };
}

/* ---------------------------------------------------------------- the doing */

/* A copy of anything about to be changed goes to the attic first -- the same
 * attic a discarded file goes to, because "everything Tack has ever thrown
 * away" should include the profile it edited. `tack attic` lists it with no
 * changes needed: it walks <stamp>/<label>/ and this writes <stamp>/machine/. */
function keepACopy(state, now) {
  var dir = path.join(U.atticRoot(), U.stampNow(now), 'machine');
  var saved = [];
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (state.profile && state.profileExists) {
      fs.copyFileSync(state.profile, path.join(dir, path.basename(state.profile)));
      saved.push(state.profile);
    }
    if (state.userPath !== null && state.userPath !== undefined) {
      fs.writeFileSync(path.join(dir, 'user-PATH-before.txt'),
        'Your user PATH as it was before `tack install --do` changed it.\n\n' +
        'To put it back, paste this value into the user Path variable under\n' +
        'Settings > System > About > Advanced system settings > Environment\n' +
        'Variables. Nothing here is ever deleted automatically.\n\n' +
        state.userPath + '\n');
      saved.push('user PATH');
    }
  } catch (e) {
    return { dir: dir, saved: saved, error: e.message };
  }
  return { dir: dir, saved: saved, error: null };
}

/* io is injected so the suite can drive every branch of this without a
 * registry or a Documents folder underneath it. realIo() is the one that
 * touches the machine, and it is three lines long on purpose. */
function realIo() {
  return {
    readUserPath: readUserPath,
    writeUserPath: writeUserPath,
    writeFile: function (p, text) {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.appendFileSync(p, text);
    }
  };
}

function apply(state, thePlan, io, now) {
  io = io || realIo();
  var kept = keepACopy(state, now);
  var did = [], failed = [];

  thePlan.todo.forEach(function (step) {
    if (step.id === 'path') {
      /* Re-read at the moment of writing rather than trusting the value the
       * screen was drawn from. Same contract as committing: a PATH edited in
       * another window between the report and the confirmation is a stale
       * picture, and appending to the stale one would delete the difference. */
      var current = io.readUserPath();
      if (current === null) { failed.push('could not re-read your PATH, so it was left alone'); return; }
      if (pathHas(current, state.tackDir)) { did.push('PATH already had it'); return; }

      /* APPEND, NEVER REPLACE. The new value must begin with everything the
       * old one held -- asserted here rather than only in the suite, because
       * this is the line that could delete somebody's tools. */
      var next = current.replace(/;+$/, '');
      next = (next ? next + ';' : '') + state.tackDir;
      if (next.indexOf(current.replace(/;+$/, '')) !== 0) {
        failed.push('refused to write a PATH that did not contain the old one');
        return;
      }
      if (io.writeUserPath(next)) did.push('added to your user PATH: ' + state.tackDir);
      else failed.push('could not write your user PATH');

    } else if (step.id === 'hotkey') {
      try {
        /* Appended. A profile is somebody's own file and may hold anything;
         * rewriting it is not a thing this is allowed to do. */
        io.writeFile(state.profile, '\n' + profileLine(state));
        did.push('added one line to ' + state.profile);
      } catch (e) {
        failed.push('could not write your profile: ' + e.message);
      }
    }
  });

  return { did: did, failed: failed, attic: kept };
}

module.exports = {
  MAY_CHANGE: MAY_CHANGE, PATH_SCOPE: PATH_SCOPE,
  loadConfig: loadConfig, readUserPath: readUserPath, writeUserPath: writeUserPath,
  profilePath: profilePath, chordIsTaken: chordIsTaken, pathHas: pathHas,
  inspect: inspect, profileLine: profileLine, plan: plan,
  keepACopy: keepACopy, realIo: realIo, apply: apply
};
