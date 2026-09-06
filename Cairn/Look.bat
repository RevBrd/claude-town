@echo off
rem  Look.bat - the roll, on a double-click. Same reason as Test.bat: the .js
rem  next to it is not a runnable door on Windows.
cd /d "%~dp0"
node cairn.js
echo.
pause
