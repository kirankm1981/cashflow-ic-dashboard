@echo off
title Cashflow IC Dashboard - Remove Auto-Start
echo.
echo  ============================================
echo   Remove Auto-Start
echo  ============================================
echo.

set "SHORTCUT=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\CashflowICDashboard.lnk"

if exist "%SHORTCUT%" (
    del "%SHORTCUT%"
    echo  [OK] Auto-start removed. The app will no longer start with Windows.
) else (
    echo  Auto-start was not configured.
)

echo.
pause
