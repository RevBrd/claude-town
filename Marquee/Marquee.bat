@echo off
REM Marquee -- opens the cinema in its own Electron window.
REM Requires `npm install` to have been run once (creates node_modules\).
REM Batteries mode still works by double-clicking marquee.html directly.
cd /d "%~dp0"
start "" "node_modules\electron\dist\electron.exe" .
