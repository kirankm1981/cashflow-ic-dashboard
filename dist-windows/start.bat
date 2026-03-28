@echo off
title IC Recon - Intercompany Reconciliation Platform
echo.
echo  ============================================
echo   IC Recon - Intercompany Reconciliation
echo  ============================================
echo.

cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js is not installed.
    echo  Please install Node.js v20 LTS from https://nodejs.org
    echo.
    pause
    exit /b 1
)

echo  Starting IC Recon server...
echo  Open your browser to: http://localhost:5000
echo.
echo  Press Ctrl+C to stop the server.
echo.

set PORT=5000
set NODE_ENV=production
node server.cjs

pause
