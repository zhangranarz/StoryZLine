@echo off
setlocal
cd /d "%~dp0"
title StoryZLine

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed, or not on PATH.
  echo Install the LTS version from https://nodejs.org/ then open a NEW window and run start.cmd again.
  goto :fail
)

for /f "tokens=1 delims=v." %%v in ('node -v') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 18 (
  echo Node.js 18 or newer is needed. This laptop has:
  node -v
  echo Install the LTS version from https://nodejs.org/
  goto :fail
)

if not defined PORT set PORT=5180
netstat -ano | findstr /r /c:"127.0.0.1:%PORT% .*LISTENING" >nul
if not errorlevel 1 (
  echo Port %PORT% is already in use - StoryZLine may already be running. Opening it.
  start "" http://127.0.0.1:%PORT%
  goto :end
)

echo Starting StoryZLine at http://127.0.0.1:%PORT%  (close this window or press Ctrl+C to stop)
start "" http://127.0.0.1:%PORT%
node server.js
if errorlevel 1 goto :fail
goto :end

:fail
echo.
echo StoryZLine stopped with an error. Copy the message above if you need help.
pause
:end
endlocal
