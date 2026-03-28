@echo off
title Cashflow & IC Dashboard (Dev Mode)
echo ============================================
echo   Cashflow ^& IC Dashboard - Dev Mode
echo ============================================
echo.

:: Navigate to project root (parent of windows folder)
cd /d "%~dp0.."

where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js is not installed or not in PATH.
    echo Please install Node.js v20 LTS from https://nodejs.org
    pause
    exit /b 1
)

:: Corporate SSL handling
set "NODE_TLS_REJECT_UNAUTHORIZED=0"
set "npm_config_strict_ssl=false"

:: Load .env file
if exist ".env" (
    for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
        set "%%a=%%b"
    )
    echo [OK] Environment loaded from .env
) else (
    echo [WARN] No .env file found. Run install.bat to configure database.
    echo        Or create .env manually with DATABASE_URL=postgresql://user:pass@localhost:5432/dbname
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo ERROR: Failed to install dependencies.
        echo Try running install.bat first for full corporate network setup.
        pause
        exit /b 1
    )
    echo.
)

echo Starting development server...
echo.
echo ============================================
echo   Open http://localhost:3000 in your browser
echo   Press Ctrl+C to stop
echo ============================================
echo.

set NODE_ENV=development
set PORT=3000
npx cross-env NODE_ENV=development tsx server/index.ts
pause
