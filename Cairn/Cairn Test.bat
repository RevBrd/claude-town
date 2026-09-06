@echo off
rem ===========================================================================
rem  Test.bat - the suite, on a double-click.
rem
rem  This exists because A .JS FILE CANNOT BE DOUBLE-CLICKED on Windows.
rem  Windows hands it to Windows Script Host, which is not node and understands
rem  none of this, and the failure is "Invalid character", line 1, char 1 --
rem  which reads exactly like a corrupt file rather than like the wrong program
rem  having opened it. Same hazard Marquee's Test.bat and Tack's back door are
rem  built around.
rem ===========================================================================
cd /d "%~dp0"
node tools\selftest.js
echo.
pause
