@echo off
setlocal
title Assetz Strata - Reset Admin Password
echo.
echo  ============================================
echo   Assetz Strata - Reset Admin Password
echo  ============================================
echo.

cd /d "%~dp0\.."
echo  Working directory: %CD%
echo.

if not exist ".env" (
    echo  [ERROR] .env file not found.
    echo  Please run windows\install.bat first.
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo  [ERROR] node_modules not found.
    echo  Please run windows\install.bat first.
    echo.
    pause
    exit /b 1
)

:ASK_PASS
set "NEW_PASS="
set /p "NEW_PASS=  Enter new admin password: "
if "%NEW_PASS%"=="" (
    echo  [ERROR] Password cannot be empty.
    goto ASK_PASS
)

echo.
echo  Resetting admin password...
echo.

set "ADMIN_PASSWORD=%NEW_PASS%"
node windows\seed-admin.cjs 2>&1
set "ADMIN_PASSWORD="
set "NEW_PASS="

if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] Password reset failed.
    echo  Make sure the database is running and .env is configured correctly.
) else (
    echo.
    echo  You can now login with:
    echo    Username: admin
    echo    Password: (the password you just entered)
)
echo.
pause
endlocal
exit /b 0
