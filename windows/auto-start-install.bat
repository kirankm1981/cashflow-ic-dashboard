@echo off
title Cashflow IC Dashboard - Auto-Start Setup
echo.
echo  ============================================
echo   Cashflow IC Dashboard - Auto-Start Setup
echo  ============================================
echo.

cd /d "%~dp0\.."
set "PROJECT_ROOT=%CD%"

if not exist .env (
    echo  [ERROR] .env file not found. Run windows\install.bat first.
    pause
    exit /b 1
)

echo  This will configure the app to start automatically when Windows starts.
echo.
set /p CONFIRM="Continue? (Y/N): "
if /i not "%CONFIRM%"=="Y" (
    echo  Cancelled.
    pause
    exit /b 0
)

echo  Configuring PM2 startup and saving process list...
cd /d "%PROJECT_ROOT%"
call pm2 startup
call pm2 save

echo.
echo  [OK] Auto-start configured via PM2.
echo  The app will start automatically when you log into Windows.
echo  PM2 handles auto-restart on crash, logging, and process monitoring.
echo.
echo  Useful commands:
echo    pm2 status         - Check process status
echo    pm2 logs cashflow-ic - View server logs
echo    pm2 restart cashflow-ic - Restart the server
echo.
echo  To remove auto-start, run windows\auto-start-uninstall.bat
echo.
pause
