<#
  Puts Marquee in the Start menu.

    powershell -ExecutionPolicy Bypass -File tools\shortcut.ps1
    powershell -ExecutionPolicy Bypass -File tools\shortcut.ps1 -Remove

  It writes ONE file, to the current user's own Start menu:

    %APPDATA%\Microsoft\Windows\Start Menu\Programs\Marquee.lnk

  Nothing system-wide, nothing in the registry, no file associations, and
  nothing that needs an administrator. -Remove deletes exactly that one file
  and nothing else, so this is reversible by the same script that did it.

  The shortcut points straight at electron.exe rather than at Marquee.bat,
  because a .bat goes through cmd and flashes a console window on the way past.
#>

param([switch]$Remove)

$ErrorActionPreference = 'Stop'

$Root     = Split-Path -Parent $PSScriptRoot
$Electron = Join-Path $Root 'node_modules\electron\dist\electron.exe'
$Icon     = Join-Path $Root 'marquee.ico'
$Link     = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Marquee.lnk'

if ($Remove) {
  if (Test-Path $Link) { Remove-Item $Link -Force; Write-Output "removed $Link" }
  else { Write-Output "nothing to remove -- no shortcut at $Link" }
  return
}

# Refuse rather than make a shortcut to nothing. A Start menu entry that opens
# an error is worse than no Start menu entry, because it looks installed.
if (-not (Test-Path $Electron)) {
  Write-Error "Electron is not installed. Run ``npm install`` in $Root first, then run this again."
  exit 1
}
if (-not (Test-Path $Icon)) {
  Write-Error "marquee.ico is missing. Run ``node tools\icon.js`` in $Root first."
  exit 1
}

$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($Link)
$sc.TargetPath       = $Electron
$sc.Arguments        = '"' + $Root + '"'
$sc.WorkingDirectory = $Root
$sc.IconLocation     = $Icon + ',0'
$sc.Description      = 'Marquee -- the front door to the Claude Town tree'
$sc.WindowStyle      = 1
$sc.Save()

Write-Output "wrote $Link"
Write-Output "  target: $Electron"
Write-Output "  icon:   $Icon"
Write-Output ""
Write-Output "Press Start and type 'Marquee'. Right-click it there to pin it."
