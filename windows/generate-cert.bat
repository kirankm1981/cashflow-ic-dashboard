@echo off
title Assetz Strata - Generate SSL Certificate
echo.
echo  ============================================
echo   Generate Self-Signed SSL Certificate
echo  ============================================
echo.

cd /d "%~dp0\.."

if not exist "certs" mkdir "certs"

where openssl >nul 2>nul
if %errorlevel% neq 0 (
    echo  [ERROR] OpenSSL not found in PATH.
    echo.
    echo  Install OpenSSL for Windows, or use mkcert:
    echo    https://github.com/FiloSottile/mkcert
    echo.
    echo  Then run:
    echo    mkcert -install
    echo    mkcert -key-file certs\server.key -cert-file certs\server.cert localhost 127.0.0.1
    echo.
    pause
    exit /b 1
)

echo  Generating self-signed certificate...
openssl req -x509 -newkey rsa:2048 -keyout certs\server.key -out certs\server.cert -days 3650 -nodes -subj "/CN=localhost/O=Assetz Strata" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" 2>nul

if %errorlevel% equ 0 (
    echo  [OK] Certificate generated.
    echo.
    echo  Files: certs\server.key, certs\server.cert
    echo  Server will use HTTPS on port 3443 automatically.
    echo  Access: https://localhost:3443
) else (
    echo  [ERROR] Generation failed. Use mkcert instead.
)
echo.
pause
