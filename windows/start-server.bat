@echo off
:: Navigate to project root (parent of windows folder)
cd /d "%~dp0.."
if not exist logs mkdir logs

:: Load .env file
if exist ".env" (
    for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
        set "%%a=%%b"
    )
)

:: Single-instance guard: check if server.pid exists and process is alive
if exist "windows\server.pid" (
    set /p OLD_PID=<"windows\server.pid"
    tasklist /FI "PID eq %OLD_PID%" 2>nul | findstr /I "node" >nul
    if not errorlevel 1 (
        echo Server is already running (PID %OLD_PID%). Use stop-server.vbs to stop it first.
        exit /b 0
    )
    del "windows\server.pid"
)

:: Verify dist/index.cjs exists
if not exist "dist\index.cjs" (
    echo ERROR: dist\index.cjs not found. Run install.bat first to build the application.
    exit /b 1
)

:: Verify Node.js is available
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js not found in PATH. Install Node.js from https://nodejs.org
    exit /b 1
)

powershell -Command "$p = Start-Process -FilePath 'node' -ArgumentList 'dist\index.cjs' -WindowStyle Hidden -RedirectStandardOutput 'logs\server.log' -RedirectStandardError 'logs\server-error.log' -PassThru; $p.Id | Out-File -FilePath 'windows\server.pid' -Encoding ascii -NoNewline"
