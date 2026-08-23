@echo off
rem ===========================================================================
rem  Sit.bat - double-click this to open the pane.
rem
rem  The glance (Look.bat) prints what is loose and gets out of the way. This
rem  is the other mode: pick files with the arrow keys and space, press c to
rem  commit them.
rem
rem  It opens on the terminal's alternate screen, so quitting with q leaves
rem  your window exactly as it was.
rem
rem  Tack can add and commit. It cannot restore, reset or check out anything -
rem  nothing in here can undo your work.
rem ===========================================================================

title Tack - the sitting

cd /d "%~dp0"
call "%~dp0tack.cmd" sit %*
