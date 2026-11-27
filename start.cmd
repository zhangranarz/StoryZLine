@echo off
setlocal
cd /d "%~dp0"
title StoryZLine
if not defined PORT set PORT=5180

netstat -ano | findstr /r /c:"127.0.0.1:%PORT% .*LISTENING" >nul
if not errorlevel 1 (
  echo Port %PORT% is already in use - StoryZLine may already be running. Opening it.
  start "" http://127.0.0.1:%PORT%
  goto :end
)

rem Pick the first runtime this laptop allows: Node.js 18+, then Python 3.7+, then Windows PowerShell.
where node >nul 2>nul
if not errorlevel 1 (
  for /f "tokens=1 delims=v." %%v in ('node -v') do if %%v GEQ 18 goto :node
)

rem The version check also skips the Microsoft Store "python" shortcut, which is not a real Python.
set PYTHON=
python -c "import sys; sys.exit(0 if sys.version_info >= (3, 7) else 1)" >nul 2>nul
if not errorlevel 1 set PYTHON=python
if not defined PYTHON (
  py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 7) else 1)" >nul 2>nul
  if not errorlevel 1 set PYTHON=py -3
)
if defined PYTHON goto :python

echo Node.js 18+ and Python 3.7+ not found - using Windows PowerShell instead.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" -Open
if errorlevel 1 goto :fail
goto :end

:node
echo Starting StoryZLine with Node.js at http://127.0.0.1:%PORT% - close this window or press Ctrl+C to stop
start "" http://127.0.0.1:%PORT%
node server.js
if errorlevel 1 goto :fail
goto :end

:python
echo Starting StoryZLine with Python...
%PYTHON% server.py --open
if errorlevel 1 goto :fail
goto :end

:fail
echo.
echo StoryZLine stopped with an error. Copy the message above if you need help.
pause
:end
endlocal
