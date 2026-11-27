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

rem Use Node.js 18+ when it is installed, otherwise the built-in Windows PowerShell.
set USE_NODE=
where node >nul 2>nul
if not errorlevel 1 (
  for /f "tokens=1 delims=v." %%v in ('node -v') do if %%v GEQ 18 set USE_NODE=1
)

if defined USE_NODE (
  echo Starting StoryZLine with Node.js at http://127.0.0.1:%PORT% - close this window or press Ctrl+C to stop
  start "" http://127.0.0.1:%PORT%
  node server.js
) else (
  echo Node.js 18+ not found - using Windows PowerShell instead.
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" -Open
)
if errorlevel 1 goto :fail
goto :end

:fail
echo.
echo StoryZLine stopped with an error. Copy the message above if you need help.
pause
:end
endlocal
