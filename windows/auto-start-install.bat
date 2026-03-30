@echo off
title Cashflow IC Dashboard - Auto-Start Setup
echo.
echo  ============================================
echo   Cashflow IC Dashboard - Auto-Start Setup
echo  ============================================
echo.

cd /d "%~dp0\.."

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

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT=%STARTUP%\CashflowICDashboard.lnk"

echo Set oWS = WScript.CreateObject("WScript.Shell") > "%TEMP%\create_shortcut.vbs"
echo Set oLink = oWS.CreateShortcut("%SHORTCUT%") >> "%TEMP%\create_shortcut.vbs"
echo oLink.TargetPath = "%~dp0start-hidden.vbs" >> "%TEMP%\create_shortcut.vbs"
echo oLink.WorkingDirectory = "%~dp0\.." >> "%TEMP%\create_shortcut.vbs"
echo oLink.Description = "Cashflow IC Dashboard" >> "%TEMP%\create_shortcut.vbs"
echo oLink.Save >> "%TEMP%\create_shortcut.vbs"
cscript //nologo "%TEMP%\create_shortcut.vbs"
del "%TEMP%\create_shortcut.vbs"

echo.
echo  [OK] Auto-start configured.
echo  The app will start automatically when you log into Windows.
echo.
echo  To remove auto-start, run windows\auto-start-uninstall.bat
echo.
pause
