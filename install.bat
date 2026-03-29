@echo off
title Cashflow IC Dashboard - Setup
echo.
echo  ============================================
echo   Cashflow IC Dashboard - Setup
echo  ============================================
echo.

cd /d "%~dp0"

echo  [STEP 1/5] Checking Node.js...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js is not installed.
    echo  Please install Node.js v20 LTS from https://nodejs.org
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do echo  [OK] Node.js %%v detected.
echo.

echo  [STEP 2/5] Configuring database connection...
echo.
echo  Make sure PostgreSQL is installed and running.
echo  You need to create a database first:
echo    1. Open Command Prompt or pgAdmin
echo    2. Run: psql -U postgres
echo    3. Run: CREATE DATABASE cashflow_ic_dashboard;
echo    4. Run: \q
echo.

set /p PG_HOST="  PostgreSQL Host [localhost]: "
if "%PG_HOST%"=="" set PG_HOST=localhost

set /p PG_PORT="  PostgreSQL Port [5432]: "
if "%PG_PORT%"=="" set PG_PORT=5432

set /p PG_DB="  Database Name [cashflow_ic_dashboard]: "
if "%PG_DB%"=="" set PG_DB=cashflow_ic_dashboard

set /p PG_USER="  PostgreSQL Username [postgres]: "
if "%PG_USER%"=="" set PG_USER=postgres

set /p PG_PASS="  PostgreSQL Password: "
if "%PG_PASS%"=="" (
    echo.
    echo  [ERROR] Password is required.
    pause
    exit /b 1
)

echo DATABASE_URL=postgresql://%PG_USER%:%PG_PASS%@%PG_HOST%:%PG_PORT%/%PG_DB%> .env
echo SESSION_SECRET=cashflow-ic-prod-%RANDOM%%RANDOM%%RANDOM%>> .env
echo PORT=3000>> .env

echo.
echo  [OK] .env file created.
echo.

echo  [STEP 3/5] Installing dependencies (this may take a few minutes)...
call npm install
if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] npm install failed.
    echo  If behind a corporate proxy, try:
    echo    npm config set proxy http://your-proxy:port
    echo    npm config set https-proxy http://your-proxy:port
    echo  Then run install.bat again.
    echo.
    pause
    exit /b 1
)
echo  [OK] Dependencies installed.
echo.

echo  [STEP 4/5] Creating database tables...
call npx drizzle-kit push --force
if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] Database setup failed.
    echo  Check that:
    echo    - PostgreSQL service is running
    echo    - Database "%PG_DB%" exists
    echo    - Username and password are correct
    echo    - Host and port are correct
    echo.
    echo  To check PostgreSQL is running:
    echo    Open Services (Win+R, type services.msc)
    echo    Look for "postgresql" and ensure it says "Running"
    echo.
    pause
    exit /b 1
)
echo  [OK] Database tables created.
echo.

echo  [STEP 5/5] Seeding default data...
call npx tsx -e "import('dotenv/config').then(()=>import('./server/seed.ts').then(m=>{m.seedDefaultRules().then(()=>m.seedDefaultAdmin()).then(()=>{console.log('Seed complete');process.exit(0)})}))"
if %errorlevel% neq 0 (
    echo  [WARNING] Seed may not have completed. The server will retry on startup.
) else (
    echo  [OK] Default admin user and reconciliation rules created.
)
echo.

echo  ============================================
echo   Setup Complete!
echo  ============================================
echo.
echo  To start the application:
echo    Double-click start.bat
echo.
echo  Then open http://localhost:3000 in your browser.
echo.
echo  Default login:
echo    Username: admin
echo    Password: admin123
echo    (Change this immediately after first login)
echo.
pause
