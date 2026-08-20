@echo off
rem ===========================================================================
rem  Power On.bat - energize Mains and open the front panel.
rem
rem  Double-click this. It starts the server in this window and opens the
rem  panel in your browser. Closing the window, or ctrl-c in it, cuts the
rem  power - at which point everything in the tree still works, opened
rem  straight from disk, on batteries.
rem
rem  Pin it to Start or the taskbar if you want it closer to hand.
rem ===========================================================================

title Mains - power for the tree

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   node is not on PATH, so Mains cannot start.
  echo   Everything in the tree still opens by double-clicking it.
  echo.
  pause
  exit /b 1
)

rem Give the server a moment to bind before the browser asks for the page.
start "" /b cmd /c "timeout /t 1 /nobreak >nul & start "" http://127.0.0.1:12060/"

node server.js %*

echo.
echo   Mains has stopped. The tree is on batteries.
echo.
pause
