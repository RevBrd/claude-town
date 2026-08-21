@echo off
rem ===========================================================================
rem  tack.cmd - the shim, so the tool is one word instead of a path.
rem
rem  Put this folder on your PATH and `tack` works from any directory in any
rem  terminal. Until then, call it by its full path, or double-click Look.bat
rem  next to it.
rem
rem    tack                what is loose, everywhere
rem    tack show games     the file list for one repo
rem    tack one            a single line
rem ===========================================================================

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   node is not on PATH, so tack cannot run.
  echo.
  exit /b 1
)

node "%~dp0tack.js" %*
exit /b %errorlevel%
