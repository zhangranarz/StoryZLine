@echo off
cd /d "%~dp0"
rem Optional: presets go in .env (see .env.example). The login is entered in the web page.
start "" http://127.0.0.1:5180
node server.js
