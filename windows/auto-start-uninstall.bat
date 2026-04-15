@echo off
setlocal enabledelayedexpansion
title Assetz Strata - Remove Auto-Start
echo.
echo  ============================================
echo   Assetz Strata - Remove Auto-Start
echo  ============================================
echo.

cd /d "%~dp0\.."
set "PROJECT_ROOT=%CD%"

if not exist "windows\logs" mkdir "windows\logs"
set "LOGFILE=windows\logs\auto-start-uninstall.log"
echo [%date% %time%] === Auto-Start Uninstall started === > "%LOGFILE%"
echo [%date% %time%] Project root: %PROJECT_ROOT% >> "%LOGFILE%"

REM -- Remove all Startup folder entries -----------------------------------
echo  Removing Startup folder entries...
echo [%date% %time%] Checking Startup folder >> "%LOGFILE%"

set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "REMOVED_ANY=0"

if exist "!STARTUP_FOLDER!\AssetzStrata-AutoStart.vbs" (
    del "!STARTUP_FOLDER!\AssetzStrata-AutoStart.vbs" >nul 2>nul
    set "REMOVED_ANY=1"
    echo  Removed: AssetzStrata-AutoStart.vbs
    echo [%date% %time%] Removed AssetzStrata-AutoStart.vbs >> "%LOGFILE%"
)

if exist "!STARTUP_FOLDER!\start-hidden.vbs" (
    del "!STARTUP_FOLDER!\start-hidden.vbs" >nul 2>nul
    set "REMOVED_ANY=1"
    echo  Removed: start-hidden.vbs (stale copy)
    echo [%date% %time%] Removed stale start-hidden.vbs >> "%LOGFILE%"
)

if !REMOVED_ANY! equ 0 (
    echo  [OK] No auto-start entries found in Startup folder.
    echo [%date% %time%] No entries found in Startup folder >> "%LOGFILE%"
) else (
    echo  [OK] Auto-start entries removed.
    echo [%date% %time%] OK - Entries removed from Startup folder >> "%LOGFILE%"
)

echo.
echo  ============================================
echo   Auto-Start Removed
echo  ============================================
echo.
echo  The application will no longer start with Windows.
echo  Run windows\start.bat to start manually.
echo.
echo  Full log: windows\logs\auto-start-uninstall.log
echo.
echo [%date% %time%] === Auto-Start Uninstall finished === >> "%LOGFILE%"
pause
endlocal
