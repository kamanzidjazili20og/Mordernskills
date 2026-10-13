@echo off
cd /d "%~dp0backend"
echo Freeing port 3001 if busy...
taskkill /F /IM node.exe >nul 2>&1
timeout /t 1 /nobreak >nul
echo Starting Modern Skills API server on http://localhost:3001 ...
node server.js
pause
