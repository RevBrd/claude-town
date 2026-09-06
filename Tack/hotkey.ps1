# ---------------------------------------------------------------------------
#  Tack's hotkey. One key opens a tack line at your prompt.
#
#  THIS FILE IS TRACKED, AND THAT IS THE POINT. A PowerShell profile lives in
#  Documents\, outside every repo in this tree -- nothing sweeps it, nothing
#  backs it up, and git has never seen it. A handler that lived there would work
#  on this machine, vanish on a rebuild, and leave nothing to look at when it
#  did. So the handler is here, in the repo, and the profile carries exactly one
#  line that points at it.
#
#  `tack install` writes that line. `tack install` on its own only reports.
#
#  To remove the hotkey: delete the one line from your profile. This file does
#  nothing on its own.
# ---------------------------------------------------------------------------

# PSReadLine is what makes a key binding possible at all. In a host that does
# not have it -- a script runner, a remoting session, the ISE -- there is
# nothing to bind to, and a profile must never fail loudly over a convenience.
if (-not (Get-Module -ListAvailable PSReadLine)) { return }
Import-Module PSReadLine -ErrorAction SilentlyContinue
if (-not ('Microsoft.PowerShell.PSConsoleReadLine' -as [type])) { return }

# The chord is declared in install.json, so this file and install.js cannot
# disagree about which key does what.
$tackHome = Split-Path -Parent $MyInvocation.MyCommand.Path
$tackChord = 'Alt+t'
try {
  $cfg = Get-Content (Join-Path $tackHome 'install.json') -Raw | ConvertFrom-Json
  if ($cfg.chord) { $tackChord = $cfg.chord }
} catch { }

Set-PSReadLineKeyHandler -Chord $tackChord -BriefDescription 'TackLine' `
  -Description 'Open a tack line, keeping whatever you had typed' -ScriptBlock {

  $line = $null
  $cursor = $null
  [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$line, [ref]$cursor)

  # WHATEVER YOU HAD TYPED IS NOT THROWN AWAY. It goes into history first, so
  # one press of Up brings it straight back after the tack command has run.
  #
  # The alternative -- a floating prompt that restores your line by itself --
  # needs a hook in the `prompt` function, which is a much larger thing to put
  # on somebody's machine for a convenience. This uses only documented
  # PSReadLine calls and cannot lose a keystroke. The fancier version can come
  # later without changing anything about how this is installed.
  if ($line -and $line.Trim()) {
    [Microsoft.PowerShell.PSConsoleReadLine]::AddToHistory($line)
  }

  [Microsoft.PowerShell.PSConsoleReadLine]::RevertLine()
  [Microsoft.PowerShell.PSConsoleReadLine]::Insert('tack ')
}
