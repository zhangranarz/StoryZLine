@echo off
cd /d "%~dp0"
if not exist .env copy .env.example .env >nul && echo Created .env - fill in BITBUCKET_BASE_URL and BITBUCKET_TOKEN, then run again. && notepad .env && exit /b
start "" http://127.0.0.1:5180
node server.js
