@echo off
title Cashflow IC Dashboard
echo.
echo  ============================================
echo   Cashflow IC Dashboard
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

for /f "tokens=*" %%v in ('node -v') do echo  Node.js version: %%v
echo.

if not exist .env (
    echo  [ERROR] .env file not found. Run install.bat first.
    pause
    exit /b 1
)

for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
    set "%%a=%%b"
)

echo  Starting server...
echo  Open your browser to: http://localhost:5000
echo.
echo  Press Ctrl+C to stop the server.
echo.

set PORT=5000
set NODE_ENV=production
node server.cjs

pause
