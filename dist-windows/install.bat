@echo off
title Cashflow IC Dashboard - Setup
echo.
echo  ============================================
echo   Cashflow IC Dashboard - Setup
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

echo  This will set up the database connection for the app.
echo.

set /p PG_HOST="PostgreSQL Host [localhost]: "
if "%PG_HOST%"=="" set PG_HOST=localhost

set /p PG_PORT="PostgreSQL Port [5432]: "
if "%PG_PORT%"=="" set PG_PORT=5432

set /p PG_DB="Database Name [cashflow_ic_dashboard]: "
if "%PG_DB%"=="" set PG_DB=cashflow_ic_dashboard

set /p PG_USER="PostgreSQL Username [postgres]: "
if "%PG_USER%"=="" set PG_USER=postgres

set /p PG_PASS="PostgreSQL Password: "
if "%PG_PASS%"=="" (
    echo  [ERROR] Password is required.
    pause
    exit /b 1
)

echo DATABASE_URL=postgresql://%PG_USER%:%PG_PASS%@%PG_HOST%:%PG_PORT%/%PG_DB%> .env
echo SESSION_SECRET=cashflow-ic-prod-secret-%RANDOM%%RANDOM%>> .env

echo.
echo  [OK] .env file created successfully.
echo.
echo  Installing dependencies...
call npm install
echo.
echo  [OK] Setup complete.
echo  Run start.bat to launch the application.
echo.
pause
