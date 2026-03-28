@echo off
title Cashflow & IC Dashboard - Installation
echo ============================================
echo   Cashflow ^& IC Dashboard
echo   Windows Installation Script
echo ============================================
echo.

:: Navigate to project root (parent of windows folder)
cd /d "%~dp0.."
set "APP_DIR=%cd%"

:: ──────────────────────────────────────────────
:: STEP 0: Prerequisites Check
:: ──────────────────────────────────────────────

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed.
    echo Please download and install Node.js v20 LTS from:
    echo   https://nodejs.org/
    echo.
    echo After installing Node.js, run this script again.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo [OK] Node.js %NODE_VER% detected

:: Check PostgreSQL (psql)
where psql >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] PostgreSQL is not installed or not in PATH.
    echo.
    echo Please install PostgreSQL 16 from:
    echo   https://www.postgresql.org/download/windows/
    echo.
    echo During installation:
    echo   1. Remember the password you set for the 'postgres' user
    echo   2. Keep the default port 5432
    echo   3. Check "Add to PATH" or add manually:
    echo      Add C:\Program Files\PostgreSQL\16\bin to your system PATH
    echo.
    echo After installing, run this script again.
    pause
    exit /b 1
)

for /f "tokens=*" %%p in ('psql --version 2^>nul') do set PG_VER=%%p
echo [OK] %PG_VER% detected
echo [OK] App directory: %APP_DIR%

:: ──────────────────────────────────────────────
:: STEP 1: PostgreSQL Database Setup
:: ──────────────────────────────────────────────
echo.

:: Check if .env file exists with DATABASE_URL
if exist "%APP_DIR%\.env" (
    for /f "tokens=1,* delims==" %%a in ('findstr /i "DATABASE_URL" "%APP_DIR%\.env" 2^>nul') do set "EXISTING_DB_URL=%%b"
)

if defined EXISTING_DB_URL (
    echo [OK] DATABASE_URL already configured in .env
    echo     %EXISTING_DB_URL%
    echo.
    set /p RECONFIG="Do you want to reconfigure the database? (y/N): "
    if /i not "%RECONFIG%"=="y" goto :skip_db_setup
)

echo [STEP 1/5] Setting up PostgreSQL database...
echo.
echo Enter your PostgreSQL connection details:
echo (Press Enter to accept defaults shown in brackets)
echo.

set "PG_HOST=localhost"
set "PG_PORT=5432"
set "PG_USER=postgres"
set "PG_DB=cashflow_ic_dashboard"

set /p PG_HOST="  PostgreSQL Host [%PG_HOST%]: "
set /p PG_PORT="  PostgreSQL Port [%PG_PORT%]: "
set /p PG_USER="  PostgreSQL User [%PG_USER%]: "
set /p PG_PASS="  PostgreSQL Password: "
set /p PG_DB="  Database Name [%PG_DB%]: "

if "%PG_PASS%"=="" (
    echo [ERROR] Password cannot be empty.
    pause
    exit /b 1
)

:: Build DATABASE_URL
set "DATABASE_URL=postgresql://%PG_USER%:%PG_PASS%@%PG_HOST%:%PG_PORT%/%PG_DB%"

:: Test connection and create database if needed
echo.
echo Testing PostgreSQL connection...
set PGPASSWORD=%PG_PASS%

psql -h %PG_HOST% -p %PG_PORT% -U %PG_USER% -d postgres -c "SELECT 1" >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Cannot connect to PostgreSQL.
    echo.
    echo Please verify:
    echo   1. PostgreSQL service is running
    echo   2. Host, port, username and password are correct
    echo   3. pg_hba.conf allows local connections
    echo.
    echo To start PostgreSQL service:
    echo   net start postgresql-x64-16
    echo.
    pause
    exit /b 1
)
echo [OK] PostgreSQL connection successful

:: Create database if it doesn't exist
psql -h %PG_HOST% -p %PG_PORT% -U %PG_USER% -d postgres -tc "SELECT 1 FROM pg_database WHERE datname='%PG_DB%'" 2>nul | findstr "1" >nul
if %errorlevel% neq 0 (
    echo Creating database '%PG_DB%'...
    psql -h %PG_HOST% -p %PG_PORT% -U %PG_USER% -d postgres -c "CREATE DATABASE %PG_DB%" 2>nul
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to create database. Check permissions.
        pause
        exit /b 1
    )
    echo [OK] Database '%PG_DB%' created
) else (
    echo [OK] Database '%PG_DB%' already exists
)

:: Write .env file
echo DATABASE_URL=%DATABASE_URL%> "%APP_DIR%\.env"
echo SESSION_SECRET=cashflow-ic-dashboard-secret-%RANDOM%%RANDOM%>> "%APP_DIR%\.env"
echo PORT=3000>> "%APP_DIR%\.env"
echo NODE_ENV=production>> "%APP_DIR%\.env"
echo [OK] Configuration saved to .env

set PGPASSWORD=

:skip_db_setup

:: Create required directories
if not exist "%APP_DIR%\logs" mkdir "%APP_DIR%\logs"

:: ──────────────────────────────────────────────
:: STEP 2: Corporate network / SSL handling
:: ──────────────────────────────────────────────
echo.
echo [INFO] Configuring for corporate network compatibility...

set "NODE_TLS_REJECT_UNAUTHORIZED=0"
set "npm_config_strict_ssl=false"
set "npm_config_prefer_offline=true"

:: Check if the corporate cafile exists; if not, clear it to prevent ENOENT errors
for /f "tokens=*" %%c in ('npm config get cafile 2^>nul') do set "CAFILE=%%c"
if defined CAFILE (
    if not "%CAFILE%"=="null" (
        if not "%CAFILE%"=="" (
            if not exist "%CAFILE%" (
                echo [FIX] Corporate CA file "%CAFILE%" not found, clearing config...
                call npm config delete cafile 2>nul
                echo [OK] Cleared missing cafile reference
            )
        )
    )
)

for /f "tokens=*" %%c in ('npm config get node_gyp_cafile 2^>nul') do set "GYPCA=%%c"
if defined GYPCA (
    if not "%GYPCA%"=="null" (
        if not "%GYPCA%"=="" (
            if not exist "%GYPCA%" (
                call npm config delete node_gyp_cafile 2>nul
            )
        )
    )
)

echo [OK] Network configuration ready

:: ──────────────────────────────────────────────
:: STEP 3: Install npm dependencies
:: ──────────────────────────────────────────────
echo.
echo [STEP 2/5] Installing dependencies...
call npm install 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [WARN] Standard install failed. Retrying with legacy peer deps...
    call npm install --legacy-peer-deps 2>&1
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install dependencies.
        echo.
        echo Common fixes for corporate networks:
        echo   1. Run: npm config set strict-ssl false
        echo   2. Run: set NODE_TLS_REJECT_UNAUTHORIZED=0
        echo   3. Ask IT for the corporate root CA certificate path
        echo   4. Run: npm config set cafile "C:\path\to\your\corporate-cert.pem"
        echo.
        pause
        exit /b 1
    )
)
echo [OK] Dependencies installed

:: ──────────────────────────────────────────────
:: STEP 4: Push database schema
:: ──────────────────────────────────────────────
echo.
echo [STEP 3/5] Creating database tables...

:: Load DATABASE_URL from .env for drizzle-kit
for /f "tokens=1,* delims==" %%a in ('findstr /i "DATABASE_URL" "%APP_DIR%\.env"') do set "DATABASE_URL=%%b"

call npx drizzle-kit push --force 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Failed to create database tables.
    echo Please check your DATABASE_URL in .env
    pause
    exit /b 1
)
echo [OK] Database tables created

:: ──────────────────────────────────────────────
:: STEP 5: Build production bundle
:: ──────────────────────────────────────────────
echo.
echo [STEP 4/5] Building production bundle...
call npx tsx script/build.ts 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Build failed.
    pause
    exit /b 1
)
echo [OK] Production build complete

:: Reset SSL config back to normal
set "NODE_TLS_REJECT_UNAUTHORIZED="

:: ──────────────────────────────────────────────
:: STEP 6: Setup auto-start
:: ──────────────────────────────────────────────
echo.
echo [STEP 5/5] Setting up auto-start...

set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT=%STARTUP_DIR%\CashflowICDashboard.lnk"
set "VBS_PATH=%APP_DIR%\windows\start-hidden.vbs"

:: Create the VBS launcher if it doesn't exist
if not exist "%VBS_PATH%" (
    echo Set WshShell = CreateObject^("WScript.Shell"^)> "%VBS_PATH%"
    echo WshShell.CurrentDirectory = "%APP_DIR%">> "%VBS_PATH%"
    echo WshShell.Run "cmd /c windows\start-server.bat", 0, False>> "%VBS_PATH%"
)

powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT%'); $s.TargetPath = 'wscript.exe'; $s.Arguments = '\"%VBS_PATH%\"'; $s.WorkingDirectory = '%APP_DIR%'; $s.Description = 'Cashflow IC Dashboard Server'; $s.Save()" 2>nul

if exist "%SHORTCUT%" (
    echo [OK] Auto-start shortcut created in Startup folder
) else (
    echo [WARN] Could not create auto-start shortcut
    echo        You can manually run windows\start-hidden.vbs to start the server
)

echo.
echo ============================================
echo   Installation Complete!
echo ============================================
echo.
echo The application will:
echo   - Start automatically when Windows boots
echo   - Run silently in the background
echo   - Be accessible at http://localhost:3000
echo.
echo Quick commands:
echo   Start now:   Double-click windows\start-hidden.vbs
echo   Stop:        Double-click windows\stop-server.vbs
echo   Dev mode:    Double-click windows\dev.bat
echo   Uninstall:   Run windows\uninstall.bat
echo.
echo Server logs: logs\server.log
echo Database:    PostgreSQL (%PG_DB% on %PG_HOST%:%PG_PORT%)
echo.
pause
