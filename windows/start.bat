@echo off
title Cashflow IC Dashboard
echo.
echo  ============================================
echo   Cashflow IC Dashboard
echo  ============================================
echo.

cd /d "%~dp0\.."

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
    echo  [ERROR] .env file not found. Run windows\install.bat first.
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

echo  [STEP 2/3] Syncing database tables...
call npx drizzle-kit push --force >"%TEMP%\drizzle_output.txt" 2>&1
set DB_RESULT=%errorlevel%

findstr /i "error refused ECONNREFUSED ENOTFOUND authentication password does not exist" "%TEMP%\drizzle_output.txt" >nul 2>nul
set HAS_REAL_ERROR=%errorlevel%

type "%TEMP%\drizzle_output.txt"
del "%TEMP%\drizzle_output.txt" >nul 2>nul

if %HAS_REAL_ERROR% equ 0 (
    echo.
    echo  ============================================
    echo   [ERROR] Database connection failed.
    echo  ============================================
    echo.
    echo  Possible causes:
    echo.
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
echo.
echo  ============================================
echo   Server is starting...
echo   Open your browser to: http://localhost:3000
echo  ============================================
echo.
echo  Press Ctrl+C to stop the server.
echo.

set NODE_ENV=development
call npx tsx server/index.ts

pause
