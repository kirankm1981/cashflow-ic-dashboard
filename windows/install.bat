@echo off
setlocal enabledelayedexpansion
title Assetz Strata Platform - Setup

echo.
echo  ============================================
echo   Assetz Strata Platform - Setup
echo  ============================================
echo.

cd /d "%~dp0\.."
echo  Working directory: %CD%
echo.

if not exist "windows\logs" mkdir "windows\logs"
set "LOGFILE=windows\logs\install.log"
echo [%date% %time%] === Install started === > "%LOGFILE%"

REM -- STEP 1: Node.js ----------------------------------------------------
echo  [STEP 1/6] Checking Node.js...
echo [%date% %time%] STEP 1 - Node.js check >> "%LOGFILE%"
where node >nul 2>nul
if !errorlevel! neq 0 (
    echo  [ERROR] Node.js is not installed.
    echo  Please install Node.js v20 LTS from https://nodejs.org
    echo [%date% %time%] ERROR - Node.js not found >> "%LOGFILE%"
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do (
    echo  [OK] Node.js %%v detected.
    echo [%date% %time%] OK - Node.js %%v >> "%LOGFILE%"
)
echo.

REM -- STEP 2: npm install (skip if node_modules already complete) ---------
echo  [STEP 2/6] Checking dependencies...
echo [%date% %time%] STEP 2 - npm install >> "%LOGFILE%"
echo.
set "NODE_ENV="
if exist "node_modules\.bin\vite.cmd" (
    if exist "node_modules\express" (
        echo  [OK] Dependencies already installed. Skipping npm install.
        echo [%date% %time%] OK - Dependencies already present, skipping npm install >> "%LOGFILE%"
        goto :STEP2_DONE
    )
)
echo  Installing dependencies... This may take 2-5 minutes on first run.
echo  (npm output is logged to windows\logs\install.log)
echo.

set "NPM_ATTEMPT=1"
:NPM_RETRY
echo  Attempt !NPM_ATTEMPT! of 3...
echo [%date% %time%] npm install attempt !NPM_ATTEMPT! of 3... >> "%LOGFILE%"
cmd /c npm install --no-audit --no-fund >> "%LOGFILE%" 2>&1
set "NPM_EXIT=!errorlevel!"
echo [%date% %time%] npm install exited with code !NPM_EXIT! >> "%LOGFILE%"

if exist "node_modules\.bin\vite.cmd" (
    if exist "node_modules\express" (
        echo  [OK] npm install succeeded on attempt !NPM_ATTEMPT!.
        echo [%date% %time%] OK - npm install succeeded on attempt !NPM_ATTEMPT! >> "%LOGFILE%"
        goto :STEP2_DONE
    )
)

echo  [WARNING] npm install attempt !NPM_ATTEMPT! did not fully complete.
echo [%date% %time%] WARNING - key deps missing after attempt !NPM_ATTEMPT! >> "%LOGFILE%"

if !NPM_ATTEMPT! lss 3 (
    set /a "NPM_ATTEMPT+=1"
    echo  Retrying in 10 seconds...
    timeout /t 10 /nobreak >nul 2>nul
    goto :NPM_RETRY
)

echo.
echo  [ERROR] npm install failed after 3 attempts.
echo  Critical dependencies are missing from node_modules.
echo.
echo  Troubleshooting:
echo    1. Check your internet connection
echo    2. If behind a corporate proxy, run:
echo       npm config set proxy http://your-proxy:port
echo       npm config set https-proxy http://your-proxy:port
echo    3. Try running "npm install" manually from a command prompt
echo    4. Check windows\logs\install.log for detailed error messages
echo.
echo [%date% %time%] ERROR - npm install failed after 3 attempts >> "%LOGFILE%"
pause
exit /b 1

:STEP2_DONE
echo  [OK] Dependencies installed.
echo [%date% %time%] OK - Dependencies installed >> "%LOGFILE%"
echo.

REM -- STEP 3: Database configuration -------------------------------------
echo  [STEP 3/6] Database configuration...
echo [%date% %time%] STEP 3 - Database config >> "%LOGFILE%"
echo.
echo  Press ENTER to accept defaults shown in [brackets].
echo.

set "PG_HOST=localhost"
set "PG_PORT=5432"
set "PG_DB=cashflow_ic_dashboard"
set "PG_USER=postgres"

set /p "PG_HOST=  PostgreSQL Host [localhost]: "
if "!PG_HOST!"=="" set "PG_HOST=localhost"

set /p "PG_PORT=  PostgreSQL Port [5432]: "
if "!PG_PORT!"=="" set "PG_PORT=5432"

set /p "PG_DB=  Database Name [cashflow_ic_dashboard]: "
if "!PG_DB!"=="" set "PG_DB=cashflow_ic_dashboard"

set /p "PG_USER=  PostgreSQL Username [postgres]: "
if "!PG_USER!"=="" set "PG_USER=postgres"

:ASK_DB_PASS
set "PG_PASS="
set /p "PG_PASS=  PostgreSQL Password: "
if "!PG_PASS!"=="" (
    echo  [ERROR] Password cannot be empty.
    goto ASK_DB_PASS
)

echo [%date% %time%] DB: !PG_HOST!:!PG_PORT!/!PG_DB! user=!PG_USER! >> "%LOGFILE%"

REM URL-encode password via Node.js (safe for special chars)
cmd /c node -e "process.stdout.write(encodeURIComponent(process.env.PG_PASS))" > .tmp_encoded 2>nul
set /p PG_PASS_ENCODED=<.tmp_encoded
del .tmp_encoded >nul 2>nul
if "!PG_PASS_ENCODED!"=="" set "PG_PASS_ENCODED=!PG_PASS!"

REM Generate SESSION_SECRET via Node.js crypto
cmd /c node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))" > .tmp_secret 2>nul
set /p SESSION_SECRET=<.tmp_secret
del .tmp_secret >nul 2>nul
if "!SESSION_SECRET!"=="" set "SESSION_SECRET=Strata-%COMPUTERNAME%-%RANDOM%%RANDOM%%RANDOM%"

REM Write .env file
echo DATABASE_URL=postgresql://!PG_USER!:!PG_PASS_ENCODED!@!PG_HOST!:!PG_PORT!/!PG_DB!> .env
echo SESSION_SECRET=!SESSION_SECRET!>> .env
echo PORT=3000>> .env
echo NODE_ENV=production>> .env

echo.
echo  [OK] .env file created.
echo [%date% %time%] OK - .env created >> "%LOGFILE%"
echo.

REM Try to create the database if psql is available
set PGPASSWORD=!PG_PASS!
where psql >nul 2>nul
if !errorlevel! equ 0 (
    psql -h !PG_HOST! -p !PG_PORT! -U !PG_USER! -tc "SELECT 1 FROM pg_database WHERE datname='!PG_DB!'" 2>nul | findstr "1" >nul
    if !errorlevel! neq 0 (
        echo  Creating database "!PG_DB!"...
        psql -h !PG_HOST! -p !PG_PORT! -U !PG_USER! -c "CREATE DATABASE !PG_DB!;" 2>nul
        if !errorlevel! equ 0 (
            echo  [OK] Database "!PG_DB!" created.
        ) else (
            echo  [WARNING] Could not auto-create database.
            echo  You may need to create it manually via pgAdmin or psql.
        )
    ) else (
        echo  [OK] Database "!PG_DB!" already exists.
    )
) else (
    echo  [NOTE] psql not in PATH - skipping auto-create.
    echo  Make sure the database "!PG_DB!" exists.
)
set PGPASSWORD=
echo [%date% %time%] OK - Database check done >> "%LOGFILE%"
echo.

REM -- STEP 4: Database tables --------------------------------------------
echo  [STEP 4/6] Creating database tables...
echo [%date% %time%] STEP 4 - sync-db >> "%LOGFILE%"
cmd /c node windows\sync-db.cjs >> "%LOGFILE%" 2>&1
if exist "windows\.db-fail" (
    del "windows\.db-fail" >nul 2>nul
    echo  [WARNING] Database not reachable yet. Tables will sync on first start.
    echo [%date% %time%] WARNING - sync-db failed >> "%LOGFILE%"
) else (
    echo  [OK] Database tables ready.
    echo [%date% %time%] OK - Tables synced >> "%LOGFILE%"
)
echo.

REM -- STEP 5: Admin password ---------------------------------------------
echo  [STEP 5/6] Setting admin password...
echo [%date% %time%] STEP 5 - Admin seed >> "%LOGFILE%"
echo.
:ASK_ADMIN_PASS
set "ADMIN_PASS="
set /p "ADMIN_PASS=  Admin Password (min 6 chars): "
if "!ADMIN_PASS!"=="" (
    echo  [ERROR] Password cannot be empty.
    goto ASK_ADMIN_PASS
)
cmd /c node -e "if(process.env.ADMIN_PASS.length<6){process.exit(1)}" 2>nul
if !errorlevel! neq 0 (
    echo  [ERROR] Must be at least 6 characters.
    goto ASK_ADMIN_PASS
)

set "ADMIN_PASSWORD=!ADMIN_PASS!"
echo [%date% %time%] Running seed... >> "%LOGFILE%"
cmd /c node windows\seed-admin.cjs >> "%LOGFILE%" 2>&1
set "SEED_EXIT=!errorlevel!"
set "ADMIN_PASSWORD="
set "ADMIN_PASS="
if !SEED_EXIT! neq 0 (
    echo  [NOTE] Seed will retry on first server start.
    echo [%date% %time%] WARNING - Seed may have failed >> "%LOGFILE%"
) else (
    echo  [OK] Admin user created.
    echo [%date% %time%] OK - Seed complete >> "%LOGFILE%"
)
echo.

REM -- STEP 6: Build ------------------------------------------------------
echo  [STEP 6/6] Building application (30-60 seconds)...
echo [%date% %time%] STEP 6 - Build >> "%LOGFILE%"
echo.
set "NODE_ENV="
cmd /c node windows\build.cjs >> "%LOGFILE%" 2>&1
if !errorlevel! neq 0 (
    echo  [WARNING] Build had issues. It will be retried on first start.
    echo  Check windows\logs\install.log for details.
    echo [%date% %time%] WARNING - Build had issues >> "%LOGFILE%"
) else (
    echo  [OK] Build complete.
    echo [%date% %time%] OK - Build complete >> "%LOGFILE%"
)
echo.

echo  ============================================
echo   Setup Complete!
echo  ============================================
echo.
echo  Run windows\start.bat to launch the app.
echo  Then open: http://localhost:3000
echo.
echo  Login:  admin / (password you just set)
echo.
echo  Full log: windows\logs\install.log
echo.
echo [%date% %time%] === Install finished === >> "%LOGFILE%"
pause
endlocal
