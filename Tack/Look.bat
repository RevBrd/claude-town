@echo off
rem ===========================================================================
rem  Look.bat - double-click this.
rem
rem  Runs the sweep once, holds the window open so you can read it, and exits
rem  on any key. Nothing is written, staged, or committed - the glance only
rem  looks. To actually commit something, use Sit.bat next to this.
rem
rem  Pin it to Start or the taskbar if you want it closer to hand.
rem ===========================================================================

title Tack - what is still held together with pins

cd /d "%~dp0"
call "%~dp0tack.cmd" %*

echo.
echo   Sit.bat opens the pane, where you pick files and commit them.
echo.
pause
