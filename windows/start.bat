@echo off
title Cashflow & IC Dashboard
echo ============================================
echo   Cashflow ^& IC Dashboard
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

for /f "tokens=*" %%a in ('node -v') do set NODE_VERSION=%%a
echo Node.js version: %NODE_VERSION%
echo.

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
    echo [ERROR] .env file not found. Run install.bat first.
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

if not exist "dist\index.cjs" (
    echo Building application...
    call npx tsx script/build.ts
    if %ERRORLEVEL% NEQ 0 (
        echo ERROR: Build failed.
        pause
        exit /b 1
    )
    echo.
)

if not exist "logs" mkdir logs

echo ============================================
echo   Open http://localhost:3000 in your browser
echo   Press Ctrl+C to stop the server
echo ============================================
echo.

node dist/index.cjs

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Server exited with an error. Check the output above.
    echo.
)
pause
