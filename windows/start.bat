@echo off
setlocal enabledelayedexpansion
title Assetz Strata Platform

echo.
echo  ============================================
echo   Assetz Strata Platform
echo  ============================================
echo.

cd /d "%~dp0\.."

if not exist "windows\logs" mkdir "windows\logs"
set "LOGFILE=windows\logs\start.log"
echo [%date% %time%] === Start initiated === > "%LOGFILE%"

where node >nul 2>nul
if !errorlevel! neq 0 (
    echo  [ERROR] Node.js is not installed.
    echo  Please install Node.js v20 LTS from https://nodejs.org
    echo [%date% %time%] ERROR - Node.js not found >> "%LOGFILE%"
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do echo  Node.js %%v
echo.

if not exist .env (
    echo  [ERROR] .env not found. Run windows\install.bat first.
    echo [%date% %time%] ERROR - .env not found >> "%LOGFILE%"
    pause
    exit /b 1
)

set "CHECK_SECRET="
for /f "tokens=2 delims==" %%V in ('findstr /i "SESSION_SECRET" .env') do set "CHECK_SECRET=%%V"
if "!CHECK_SECRET!"=="" (
    echo  [ERROR] SESSION_SECRET is empty in .env
    echo  Open .env in Notepad and add:
    echo    SESSION_SECRET=AssetzStrata2025SecureKeyChangeThis
    echo [%date% %time%] ERROR - SESSION_SECRET empty >> "%LOGFILE%"
    echo.
    pause
    exit /b 1
)

REM -- STEP 1: Dependencies ------------------------------------------------
if exist "node_modules\express" goto STEP1_OK
echo  [STEP 1/4] Installing dependencies...
echo [%date% %time%] STEP 1 - Installing dependencies >> "%LOGFILE%"
set "NODE_ENV="
cmd /c npm install --no-audit --no-fund >> "%LOGFILE%" 2>&1
if !errorlevel! neq 0 (
    echo  [ERROR] npm install failed. Check windows\logs\start.log for details.
    echo [%date% %time%] ERROR - npm install failed >> "%LOGFILE%"
    pause
    exit /b 1
)
if not exist "node_modules\express" (
    echo  [ERROR] npm install did not complete. Check windows\logs\start.log for details.
    echo [%date% %time%] ERROR - express not found after install >> "%LOGFILE%"
    pause
    exit /b 1
)
echo  [OK] Dependencies installed.
echo [%date% %time%] OK - Dependencies installed >> "%LOGFILE%"
echo.
goto STEP2

:STEP1_OK
echo  [STEP 1/4] Dependencies OK.
echo [%date% %time%] STEP 1 - Dependencies OK >> "%LOGFILE%"
echo.

:STEP2
REM -- STEP 2: Database ----------------------------------------------------
echo  [STEP 2/4] Checking database...
echo [%date% %time%] STEP 2 - sync-db >> "%LOGFILE%"
if exist "windows\.db-fail" del "windows\.db-fail" >nul 2>nul
cmd /c node windows\sync-db.cjs >> "%LOGFILE%" 2>&1
if not exist "windows\.db-fail" goto DB_OK

del "windows\.db-fail" >nul 2>nul
echo.
echo  ============================================
echo   [ERROR] Database connection failed.
echo  ============================================
echo.
echo  Check:
echo    1. PostgreSQL is running (Win+R, services.msc, find postgresql)
echo    2. Open .env and verify DATABASE_URL has correct password
echo    3. Database exists (create via pgAdmin or psql if needed)
echo.
echo  See windows\logs\start.log for details.
echo [%date% %time%] ERROR - Database connection failed >> "%LOGFILE%"
echo.
pause
exit /b 1

:DB_OK
echo  [OK] Database connected.
echo [%date% %time%] OK - Database ready >> "%LOGFILE%"
echo.

REM -- STEP 3: Build ------------------------------------------------------
set "NEED_BUILD=0"
if not exist "dist\index.cjs" set "NEED_BUILD=1"
if "!NEED_BUILD!"=="0" (
    REM Check if source code is newer than last build
    set "GIT_HASH="
    set "BUILD_HASH="
    for /f %%h in ('git rev-parse HEAD 2^>nul') do set "GIT_HASH=%%h"
    if exist "dist\.build-hash" (
        set /p BUILD_HASH=<"dist\.build-hash"
    ) else (
        set "NEED_BUILD=1"
    )
)
if "!NEED_BUILD!"=="0" (
    if not "!GIT_HASH!"=="" (
        if not "!GIT_HASH!"=="!BUILD_HASH!" (
            echo  [STEP 3/4] Source code updated, rebuilding...
            echo [%date% %time%] STEP 3 - Source updated, rebuilding >> "%LOGFILE%"
            set "NEED_BUILD=1"
        )
    )
)
if "!NEED_BUILD!"=="1" (
    echo  [STEP 3/4] Building application (30-60 seconds^)...
    echo [%date% %time%] STEP 3 - Building >> "%LOGFILE%"
    set "NODE_ENV="
    cmd /c node windows\build.cjs >> "%LOGFILE%" 2>&1
    if !errorlevel! neq 0 (
        echo  [ERROR] Build failed. Check windows\logs\start.log for details.
        echo [%date% %time%] ERROR - Build failed >> "%LOGFILE%"
        pause
        exit /b 1
    )
    echo  [OK] Build complete.
    echo [%date% %time%] OK - Build complete >> "%LOGFILE%"
    echo.
) else (
    echo  [STEP 3/4] Production build up to date.
    echo [%date% %time%] STEP 3 - Production build up to date >> "%LOGFILE%"
    echo.
)

if not exist "dist\streaming-xlsx-parser.cjs" goto FORCE_REBUILD
if not exist "dist\parse-gl-child.cjs" goto FORCE_REBUILD
goto START_SERVER

:FORCE_REBUILD
echo  [STEP 3/4] Runtime files missing, rebuilding...
echo [%date% %time%] STEP 3 - Runtime files missing, rebuilding >> "%LOGFILE%"
set "NODE_ENV="
cmd /c node windows\build.cjs >> "%LOGFILE%" 2>&1
if !errorlevel! neq 0 (
    echo  [ERROR] Build failed. Check windows\logs\start.log for details.
    echo [%date% %time%] ERROR - Rebuild failed >> "%LOGFILE%"
    pause
    exit /b 1
)
echo  [OK] Rebuild complete.
echo [%date% %time%] OK - Rebuild complete >> "%LOGFILE%"
echo.

:START_SERVER
REM -- Free port 3000 if occupied -----------------------------------------
echo  Checking port 3000...
echo [%date% %time%] Checking port 3000 >> "%LOGFILE%"
cmd /c node -e "try{const o=require('child_process').execSync('netstat -ano',{encoding:'utf8'});[...new Set(o.split('\n').filter(l=>l.includes(':3000 ')).map(l=>l.trim().split(/\s+/).pop()).filter(p=>p>0))].forEach(p=>{try{process.kill(+p);console.log('  Stopped PID '+p)}catch(e){}});}catch(e){}" 2>nul

REM -- STEP 4: Start server -----------------------------------------------
echo  [STEP 4/4] Starting server...
echo [%date% %time%] STEP 4 - Starting server >> "%LOGFILE%"
echo.
echo  ============================================
echo   Open browser to: http://localhost:3000
echo                 or: https://localhost:3443
echo   Press Ctrl+C to stop.
echo  ============================================
echo.

set NODE_ENV=production
set NODE_OPTIONS=--max-old-space-size=2048
echo [%date% %time%] Launching node dist/index.cjs >> "%LOGFILE%"
node dist\index.cjs >> "%LOGFILE%" 2>&1

echo.
echo [%date% %time%] Server exited with code !errorlevel! >> "%LOGFILE%"
echo  Server stopped.
echo  If unexpected, check windows\logs\start.log
echo.
pause
endlocal
