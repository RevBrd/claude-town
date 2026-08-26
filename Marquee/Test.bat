@echo off
REM Marquee -- run every suite and keep the window open to read the result.
REM
REM This exists because the .js files in tools\ CANNOT be double-clicked. On
REM Windows a .js file is handed to Windows Script Host, which is not node and
REM does not understand any of this -- it fails with "Invalid character" on
REM line 1, char 1, which looks like a broken file and is not one. Tack's back
REM door refuses to run .js for exactly this reason and opens it in an editor
REM instead. This is the door for RUNNING them.
cd /d "%~dp0"

echo.
echo ================================================================
echo  derive.js  -- the derivation layer, against a synthetic fixture
echo ================================================================
call node tools\selftest.js --quiet

echo.
echo ================================================================
echo  frontdoor.js  -- the terminal front door, `marquee dead space`
echo ================================================================
call node tools\frontdoor.js

echo.
echo ================================================================
echo  smoke.js  -- does the page boot and draw? (on batteries)
echo ================================================================
call node tools\smoke.js

echo.
echo ================================================================
echo  agree.js  -- do the two readers agree? (skips without Mains)
echo ================================================================
call node tools\agree.js

echo.
echo ================================================================
echo  shell.js  -- the Electron runtime (skips without node_modules)
echo ================================================================
echo  A window may flicker. That is the suite driving a real one.
call node tools\shell.js

echo.
echo ================================================================
echo  Done. Anything that says FAIL is worth telling somebody about.
echo ================================================================
pause
