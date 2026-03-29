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

if not exist node_modules (
    echo  [STEP 1/3] Installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo  [ERROR] npm install failed.
        pause
        exit /b 1
    )
    echo  [OK] Dependencies installed.
    echo.
) else (
    echo  [STEP 1/3] Dependencies already installed.
)

echo  [STEP 2/3] Checking database tables...
call npx drizzle-kit push --force 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] Database setup failed.
    echo.
    echo  Common causes:
    echo    1. PostgreSQL is not running
    echo       - Open Services (Win+R, type services.msc)
    echo       - Find "postgresql" and make sure it says "Running"
    echo.
    echo    2. Database does not exist
    echo       - Open Command Prompt and run:
    echo         psql -U postgres
    echo         CREATE DATABASE cashflow_ic_dashboard;
    echo         \q
    echo.
    echo    3. Wrong password in .env file
    echo       - Open .env in Notepad and check DATABASE_URL
    echo.
    pause
    exit /b 1
)
echo  [OK] Database tables ready.
echo.

echo  [STEP 3/3] Starting server...
echo  Open your browser to: http://localhost:3000
echo.
echo  Press Ctrl+C to stop the server.
echo.

set NODE_ENV=development
call npx tsx server/index.ts

pause
