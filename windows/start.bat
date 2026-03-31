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

if not exist node_modules goto INSTALL_DEPS
echo  [STEP 1/4] Dependencies already installed.
goto STEP2

:INSTALL_DEPS
echo  [STEP 1/4] Installing dependencies...
call npm install
if %errorlevel% neq 0 (
    echo  [ERROR] npm install failed.
    pause
    exit /b 1
)
echo  [OK] Dependencies installed.
echo.

:STEP2
echo  [STEP 2/4] Checking database and syncing tables...
if exist "windows\.db-fail" del "windows\.db-fail" >nul 2>nul
node windows\sync-db.cjs
if not exist "windows\.db-fail" goto DB_OK

del "windows\.db-fail" >nul 2>nul
echo.
echo  ============================================
echo   [ERROR] Database connection failed.
echo  ============================================
echo.
echo  Possible causes:
echo.
echo    1. PostgreSQL is not running
echo       - Open Services - Win+R, type services.msc
echo       - Find "postgresql" and make sure it says "Running"
echo.
echo    2. Database does not exist
echo       - Open Command Prompt and run:
echo         psql -U postgres
echo         CREATE DATABASE cashflow_ic_dashboard;
echo.
echo    3. Wrong password in .env file
echo       - Open .env in Notepad and check DATABASE_URL
echo.
pause
exit /b 1

:DB_OK
echo.

if exist "dist\public\index.html" goto SKIP_BUILD
echo  [STEP 3/4] Building frontend for first time...
call npx vite build >nul 2>nul
if exist "dist\public\index.html" goto BUILD_DONE
echo  [WARN] Frontend build issue - server will use Vite dev mode.
goto START_SERVER

:BUILD_DONE
echo  [OK] Frontend built.
echo.
goto START_SERVER

:SKIP_BUILD
echo  [STEP 3/4] Frontend build found.
echo.

:START_SERVER
echo  [STEP 4/4] Starting server...
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
