@echo off
title Cashflow IC Dashboard - Remove Auto-Start
echo.
echo  ============================================
echo   Remove Auto-Start
echo  ============================================
echo.

echo  Removing PM2 auto-start and stopping cashflow-ic process...
echo.
call pm2 delete cashflow-ic >nul 2>nul
call pm2 save >nul 2>nul
call pm2 unstartup >nul 2>nul

if %errorlevel% equ 0 (
    echo  [OK] Auto-start removed. Server will no longer start with Windows.
) else (
    echo  [OK] Auto-start configuration removed.
)
echo.
echo  Note: The application is now stopped. Run windows\start.bat to start manually.
echo.
pause
