@echo off
setlocal enabledelayedexpansion
title Assetz Strata - Auto-Start Setup
echo.
echo  ============================================
echo   Assetz Strata - Auto-Start Setup
echo  ============================================
echo.

cd /d "%~dp0\.."
set "PROJECT_ROOT=%CD%"

if not exist "windows\logs" mkdir "windows\logs"
set "LOGFILE=windows\logs\auto-start-install.log"
echo [%date% %time%] === Auto-Start Install started === > "%LOGFILE%"
echo [%date% %time%] Project root: %PROJECT_ROOT% >> "%LOGFILE%"

if not exist .env (
    echo  [ERROR] .env file not found. Run windows\install.bat first.
    echo [%date% %time%] ERROR - .env not found >> "%LOGFILE%"
    pause
    exit /b 1
)
echo [%date% %time%] OK - .env found >> "%LOGFILE%"

echo  This will configure the app to start automatically when Windows starts.
echo  Project: %PROJECT_ROOT%
echo.
set /p CONFIRM="Continue? (Y/N): "
echo [%date% %time%] User confirmed: %CONFIRM% >> "%LOGFILE%"
if /i not "%CONFIRM%"=="Y" (
    echo  Cancelled.
    pause
    exit /b 0
)

REM -- Check Node.js
echo.
echo  [STEP 1/4] Checking Node.js...
echo [%date% %time%] STEP 1 - Node.js check >> "%LOGFILE%"
where node >nul 2>nul
if !errorlevel! neq 0 (
    echo  [ERROR] Node.js is not installed.
    echo [%date% %time%] ERROR - Node.js not found >> "%LOGFILE%"
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do (
    echo  [OK] Node.js %%v
    echo [%date% %time%] OK - Node.js %%v >> "%LOGFILE%"
)
echo.

REM -- Check production build
echo  [STEP 2/4] Checking production build...
echo [%date% %time%] STEP 2 - Build check >> "%LOGFILE%"
if not exist "dist\index.cjs" (
    echo  [ERROR] Production build not found. Run windows\install.bat first.
    echo [%date% %time%] ERROR - dist\index.cjs not found >> "%LOGFILE%"
    pause
    exit /b 1
)
echo  [OK] Production build found.
echo [%date% %time%] OK - dist\index.cjs exists >> "%LOGFILE%"
echo.

REM -- Remove old auto-start entries
echo  [STEP 3/4] Cleaning up old auto-start entries...
echo [%date% %time%] STEP 3 - Cleanup old entries >> "%LOGFILE%"

set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "VBS_TARGET=!STARTUP_FOLDER!\AssetzStrata-AutoStart.vbs"

if exist "!VBS_TARGET!" (
    del "!VBS_TARGET!" >nul 2>nul
    echo  Removed old auto-start entry.
    echo [%date% %time%] Removed old VBS >> "%LOGFILE%"
) else (
    echo  No old entry found.
    echo [%date% %time%] No old VBS in Startup folder >> "%LOGFILE%"
)
if exist "!STARTUP_FOLDER!\start-hidden.vbs" (
    del "!STARTUP_FOLDER!\start-hidden.vbs" >nul 2>nul
    echo  Removed stale start-hidden.vbs.
    echo [%date% %time%] Removed stale start-hidden.vbs >> "%LOGFILE%"
)
echo.

REM -- Create self-contained auto-start VBS
echo  [STEP 4/4] Creating auto-start entry...
echo [%date% %time%] STEP 4 - Creating VBS >> "%LOGFILE%"
echo [%date% %time%] Startup folder: !STARTUP_FOLDER! >> "%LOGFILE%"
echo [%date% %time%] VBS target: !VBS_TARGET! >> "%LOGFILE%"

> "!VBS_TARGET!" (
    echo ' Assetz Strata Platform - Auto-Start Script
    echo ' Generated: %date% %time%
    echo ' Project: %PROJECT_ROOT%
    echo.
    echo On Error Resume Next
    echo.
    echo Set WshShell = CreateObject^("WScript.Shell"^)
    echo Set fso = CreateObject^("Scripting.FileSystemObject"^)
    echo.
    echo Dim strPath
    echo strPath = "%PROJECT_ROOT%"
    echo.
    echo ' Create logs folder
    echo Dim logFolder
    echo logFolder = strPath ^& "\windows\logs"
    echo If Not fso.FolderExists^(logFolder^) Then fso.CreateFolder^(logFolder^)
    echo.
    echo ' Log start
    echo Dim logFile
    echo Set logFile = fso.OpenTextFile^(logFolder ^& "\autostart.log", 8, True^)
    echo logFile.WriteLine "[" ^& Now ^& "] Auto-start VBS triggered"
    echo.
    echo ' Wait 3 minutes for system services to start after boot
    echo logFile.WriteLine "[" ^& Now ^& "] Waiting 3 minutes for system services..."
    echo WScript.Sleep 180000
    echo logFile.WriteLine "[" ^& Now ^& "] Wait complete, launching runner..."
    echo.
    echo ' Diagnostic - confirm node is reachable from this context
    echo Dim nodePathLog
    echo nodePathLog = logFolder ^& "\node-path.log"
    echo WshShell.Run "cmd /c where node ^> """ ^& nodePathLog ^& """ 2^>^&1", 0, True
    echo.
    echo ' Hand off everything to the Node runner - env load, DB retries,
    echo ' schema sync, server start, health check, browser. Fully logged.
    echo logFile.WriteLine "[" ^& Now ^& "] Running windows\autostart-runner.cjs"
    echo logFile.Close
    echo WshShell.Run "cmd /c cd /d """ ^& strPath ^& """ ^&^& node windows\autostart-runner.cjs", 0, False
)

if not exist "!VBS_TARGET!" (
    echo  [ERROR] Startup file was NOT created.
    echo  Expected: !VBS_TARGET!
    echo [%date% %time%] ERROR - VBS not found after write >> "%LOGFILE%"
    pause
    exit /b 1
)

findstr /c:"autostart-runner.cjs" "!VBS_TARGET!" >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Startup file was created but looks incomplete or corrupted.
    echo  File: !VBS_TARGET!
    echo  Please run this installer again.
    echo [%date% %time%] ERROR - VBS incomplete - missing runner handoff line >> "%LOGFILE%"
    pause
    exit /b 1
)

echo  [OK] Auto-start entry created and verified.
echo.
echo  File: !VBS_TARGET!
echo.
echo [%date% %time%] OK - VBS created and verified in Startup folder >> "%LOGFILE%"

echo  ============================================
echo   Auto-Start Setup Complete!
echo  ============================================
echo.
echo  The app will start automatically when you log into Windows.
echo.
echo  Log files:
echo    windows\logs\autostart.log  - Auto-start log
echo    windows\logs\server.log     - Server output
echo.
echo  To remove: Run windows\auto-start-uninstall.bat
echo.
echo [%date% %time%] === Auto-Start Install finished === >> "%LOGFILE%"
pause
endlocal
