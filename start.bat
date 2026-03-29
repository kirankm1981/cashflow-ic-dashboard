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
        echo  [ERROR] npm install failed. See error above.
        pause
        exit /b 1
    )
    echo  [OK] Dependencies installed.
    echo.
) else (
    echo  [STEP 1/3] Dependencies already installed.
)

echo  [STEP 2/3] Setting up database tables...
call npx drizzle-kit push --force
if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] Database setup failed. Check your .env file:
    echo    - Is PostgreSQL running?
    echo    - Is the DATABASE_URL correct?
    echo    - Does the database exist?
    echo.
    echo  Your .env should contain:
    echo    DATABASE_URL=postgresql://postgres:PASSWORD@localhost:5432/cashflow_ic_dashboard
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
