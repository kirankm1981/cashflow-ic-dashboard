@echo off
title Assetz Strata - Stop Server
echo.
echo  ============================================
echo   Assetz Strata - Stop Server
echo  ============================================
echo.
cd /d "%~dp0\.."
if not exist "windows\logs" mkdir "windows\logs"
set "LOGFILE=windows\logs\start.log"
echo  Stopping server...
echo [%date% %time%] Stop initiated >> "%LOGFILE%"

REM Kill any node process on port 3000
node -e "try{const o=require('child_process').execSync('netstat -ano',{encoding:'utf8'});const pids=[...new Set(o.split('\n').filter(l=>l.includes(':3000 ')&&l.includes('LISTENING')).map(l=>l.trim().split(/\s+/).pop()).filter(p=>p>0))];if(pids.length===0){console.log('  No server found on port 3000.')}else{pids.forEach(p=>{try{process.kill(+p);console.log('  Stopped process PID '+p)}catch(e){console.log('  PID '+p+' already stopped')}})}}catch(e){console.log('  Could not check port 3000')}" 2>nul

echo.
echo [%date% %time%] Stop complete >> "%LOGFILE%"
echo  Server stopped.
echo.
pause
exit /b 0
