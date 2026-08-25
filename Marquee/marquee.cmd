@echo off
rem ===========================================================================
rem  marquee.cmd - the front door, from a prompt.
rem
rem    marquee              what is playing
rem    marquee dead space   open it
rem    marquee find sand    what matches, without opening anything
rem
rem  The catalog is derived fresh every run by the same code the page runs.
rem  There is no list in here to go stale.
rem ===========================================================================

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   node is not on PATH, so marquee cannot run.
  echo   marquee.html still opens by double-clicking.
  echo.
  exit /b 1
)

node "%~dp0marquee.js" %*
exit /b %errorlevel%
