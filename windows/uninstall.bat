@echo off
title Cashflow & IC Dashboard - Uninstall
echo ============================================
echo   Cashflow ^& IC Dashboard - Uninstall
echo ============================================
echo.

:: Navigate to project root (parent of windows folder)
cd /d "%~dp0.."

:: Stop server
echo Stopping server...
if exist "windows\stop-server.vbs" (
    wscript "%~dp0stop-server.vbs"
    timeout /t 2 /nobreak >nul
)

:: Kill any stray node processes using our PID file
if exist "windows\server.pid" (
    set /p PID=<"windows\server.pid"
    taskkill /F /PID %PID% >nul 2>&1
    del "windows\server.pid"
)

:: Remove startup shortcut
set "SHORTCUT=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\CashflowICDashboard.lnk"
if exist "%SHORTCUT%" (
    del "%SHORTCUT%"
    echo [OK] Auto-start removed
) else (
    :: Check old name too
    set "OLD_SHORTCUT=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\ICRecon.lnk"
    if exist "%OLD_SHORTCUT%" (
        del "%OLD_SHORTCUT%"
        echo [OK] Auto-start removed (old shortcut)
    ) else (
        echo [OK] No auto-start entry found
    )
)

echo.
echo Uninstall complete.
echo.
echo Note: The PostgreSQL database has NOT been removed.
echo To remove the database, run:
echo   psql -U postgres -c "DROP DATABASE cashflow_ic_dashboard"
echo.
echo The application files remain in this folder.
echo You can delete this folder to fully remove the app.
echo.
pause
