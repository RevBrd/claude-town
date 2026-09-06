@echo off
rem ===========================================================================
rem  cairn.cmd - who has come through here, from a prompt.
rem
rem    cairn                  the roll
rem    cairn ctown 6          one session
rem    cairn commits          the history, and what nobody has claimed
rem    cairn check            is every credit still where it was signed
rem
rem  Designations are declared in register.json, because an assignment is a
rem  speech act rather than a fact about the filesystem. Everything else here
rem  is derived from git and from the files the register points at.
rem ===========================================================================

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   node is not on PATH, so cairn cannot run.
  echo.
  exit /b 1
)

node "%~dp0cairn.js" %*
exit /b %errorlevel%
