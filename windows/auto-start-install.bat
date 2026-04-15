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
    echo Dim logFolder
    echo logFolder = strPath ^& "\windows\logs"
    echo If Not fso.FolderExists^(logFolder^) Then fso.CreateFolder^(logFolder^)
    echo.
    echo Dim logFile
    echo Set logFile = fso.OpenTextFile^(logFolder ^& "\autostart.log", 8, True^)
    echo logFile.WriteLine "[" ^& Now ^& "] Auto-start triggered"
    echo.
    echo ' Wait 3 minutes for PostgreSQL and other services to start after boot
    echo logFile.WriteLine "[" ^& Now ^& "] Waiting 3 minutes for system services..."
    echo WScript.Sleep 180000
    echo logFile.WriteLine "[" ^& Now ^& "] Wait complete, proceeding..."
    echo.
    echo If Not fso.FolderExists^(strPath^) Then
    echo     logFile.WriteLine "[" ^& Now ^& "] ERROR - Project folder not found"
    echo     logFile.Close
    echo     WScript.Quit 1
    echo End If
    echo logFile.WriteLine "[" ^& Now ^& "] Project folder OK"
    echo.
    echo If Not fso.FileExists^(strPath ^& "\.env"^) Then
    echo     logFile.WriteLine "[" ^& Now ^& "] ERROR - .env not found"
    echo     logFile.Close
    echo     WScript.Quit 1
    echo End If
    echo.
    echo Set envFile = fso.OpenTextFile^(strPath ^& "\.env", 1^)
    echo Do While Not envFile.AtEndOfStream
    echo     Dim envLine
    echo     envLine = Trim^(envFile.ReadLine^)
    echo     If Len^(envLine^) ^> 0 And Left^(envLine, 1^) ^<^> "#" Then
    echo         Dim eqPos
    echo         eqPos = InStr^(envLine, "="^)
    echo         If eqPos ^> 0 Then
    echo             WshShell.Environment^("Process"^)^(Left^(envLine, eqPos - 1^)^) = Mid^(envLine, eqPos + 1^)
    echo         End If
    echo     End If
    echo Loop
    echo envFile.Close
    echo logFile.WriteLine "[" ^& Now ^& "] Environment loaded"
    echo.
    echo Dim portCheck
    echo portCheck = WshShell.Run^("cmd /c netstat -an ^| find ""0.0.0.0:3000""", 0, True^)
    echo If portCheck = 0 Then
    echo     logFile.WriteLine "[" ^& Now ^& "] Port 3000 in use - server already running"
    echo     logFile.Close
    echo     WshShell.Run "http://localhost:3000", 1, False
    echo     WScript.Quit 0
    echo End If
    echo.
    echo ' Try database connection up to 12 times
    echo Dim retries, dbOk
    echo retries = 0
    echo dbOk = False
    echo logFile.WriteLine "[" ^& Now ^& "] Checking database connection..."
    echo Do While retries ^< 12 And Not dbOk
    echo     Dim dbExit
    echo     dbExit = WshShell.Run^("cmd /c cd /d """ ^& strPath ^& """ ^&^& node windows\sync-db.cjs", 0, True^)
    echo     If dbExit = 0 Then
    echo         dbOk = True
    echo         logFile.WriteLine "[" ^& Now ^& "] Database connected on attempt " ^& ^(retries + 1^)
    echo     Else
    echo         retries = retries + 1
    echo         logFile.WriteLine "[" ^& Now ^& "] DB attempt " ^& retries ^& " failed, waiting 10s..."
    echo         WScript.Sleep 10000
    echo     End If
    echo Loop
    echo.
    echo If Not dbOk Then
    echo     logFile.WriteLine "[" ^& Now ^& "] ERROR - Database failed after 12 attempts"
    echo     logFile.Close
    echo     MsgBox "Database connection failed after 12 attempts." ^& vbCrLf ^& "Check that PostgreSQL is running.", vbCritical, "Assetz Strata"
    echo     WScript.Quit 1
    echo End If
    echo.
    echo Dim serverLog
    echo serverLog = strPath ^& "\windows\logs\server.log"
    echo logFile.WriteLine "[" ^& Now ^& "] Starting server..."
    echo WshShell.Run "cmd /c cd /d """ ^& strPath ^& """ ^&^& set NODE_ENV=production ^&^& set NODE_OPTIONS=--max-old-space-size=2048 ^&^& node dist\index.cjs ^>^> """ ^& serverLog ^& """ 2^>^&1", 0, False
    echo WScript.Sleep 3000
    echo.
    echo Dim attempts, serverUp
    echo attempts = 0
    echo serverUp = False
    echo Do While attempts ^< 30 And Not serverUp
    echo     Dim http
    echo     Set http = CreateObject^("MSXML2.XMLHTTP"^)
    echo     On Error Resume Next
    echo     http.Open "GET", "http://localhost:3000/api/health", False
    echo     http.Send
    echo     If Err.Number = 0 And http.Status = 200 Then
    echo         serverUp = True
    echo     End If
    echo     On Error GoTo 0
    echo     Set http = Nothing
    echo     If Not serverUp Then
    echo         attempts = attempts + 1
    echo         WScript.Sleep 2000
    echo     End If
    echo Loop
    echo.
    echo If serverUp Then
    echo     logFile.WriteLine "[" ^& Now ^& "] Server running on http://localhost:3000"
    echo Else
    echo     logFile.WriteLine "[" ^& Now ^& "] WARNING - Server did not respond after 60s"
    echo End If
    echo.
    echo logFile.Close
    echo WshShell.Run "http://localhost:3000", 1, False
)

if exist "!VBS_TARGET!" (
    echo  [OK] Auto-start entry created.
    echo.
    echo  File: !VBS_TARGET!
    echo.
    echo [%date% %time%] OK - VBS created in Startup folder >> "%LOGFILE%"
) else (
    echo  [ERROR] Could not write to Startup folder.
    echo [%date% %time%] ERROR - Failed to create VBS >> "%LOGFILE%"
    pause
    exit /b 1
)

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
