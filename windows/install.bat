@echo off
title Cashflow IC Dashboard - Setup
echo.
echo  ============================================
echo   Cashflow IC Dashboard - Setup
echo  ============================================
echo.

cd /d "%~dp0\.."

echo  [STEP 1/6] Checking Node.js...
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

echo  [STEP 2/6] Configuring database connection...
echo.
echo  Make sure PostgreSQL is installed and running.
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

echo  [STEP 3/6] Creating database "%PG_DB%" if it does not exist...
set PGPASSWORD=%PG_PASS%
psql -h %PG_HOST% -p %PG_PORT% -U %PG_USER% -tc "SELECT 1 FROM pg_database WHERE datname='%PG_DB%'" 2>nul | findstr "1" >nul
if %errorlevel% neq 0 (
    psql -h %PG_HOST% -p %PG_PORT% -U %PG_USER% -c "CREATE DATABASE %PG_DB%;" 2>nul
    if %errorlevel% neq 0 (
        echo.
        echo  [WARNING] Could not auto-create database. Please create it manually:
        echo    1. Open Command Prompt
        echo    2. Run: psql -U %PG_USER%
        echo    3. Enter password when prompted
        echo    4. Run: CREATE DATABASE %PG_DB%;
        echo    5. Run: \q
        echo    6. Then run install.bat again
        echo.
        pause
        exit /b 1
    )
    echo  [OK] Database "%PG_DB%" created.
) else (
    echo  [OK] Database "%PG_DB%" already exists.
)
set PGPASSWORD=
echo.

echo  [STEP 4/6] Installing dependencies - this may take a few minutes...
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

echo  [STEP 5/6] Creating database tables...
node windows\sync-db.cjs
if exist "windows\.db-fail" goto INSTALL_DB_FAIL
echo  [OK] Database tables created.
echo.
goto INSTALL_SEED

:INSTALL_DB_FAIL
del "windows\.db-fail" >nul 2>nul
echo.
echo  [ERROR] Database table setup failed.
echo  Check that PostgreSQL is running and the database exists.
echo.
pause
exit /b 1

:INSTALL_SEED
echo  [STEP 6/6] Seeding default data...
call npx tsx -e "import 'dotenv/config'; import {seedDefaultRules,seedDefaultAdmin} from './server/seed'; (async()=>{await seedDefaultRules();await seedDefaultAdmin();console.log('Seed complete');process.exit(0)})()"
if %errorlevel% neq 0 (
    echo  [WARNING] Seed may have failed. The server will retry on startup.
) else (
    echo  [OK] Default admin user and reconciliation rules created.
)
echo.

echo  Building frontend...
call npx vite build >nul 2>nul
if exist "dist\public\index.html" goto INSTALL_BUILD_OK
echo  [WARNING] Frontend build had issues. It will be retried on first start.
echo.
goto INSTALL_DONE

:INSTALL_BUILD_OK
echo  [OK] Frontend built.
echo.

:INSTALL_DONE

echo  ============================================
echo   Setup Complete!
echo  ============================================
echo.
echo  To start the application:
echo    Double-click windows\start.bat
echo.
echo  Then open http://localhost:3000 in your browser.
echo.
echo  Default login:
echo    Username: admin
echo    Password: admin123
echo.
pause
