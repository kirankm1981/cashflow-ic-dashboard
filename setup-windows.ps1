Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host " IC Recon - Windows Setup" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

$ErrorActionPreference = "Stop"

$nodeVersion = $null
try {
    $nodeVersion = (node --version 2>$null)
} catch {}

if (-not $nodeVersion) {
    Write-Host "[ERROR] Node.js is not installed." -ForegroundColor Red
    Write-Host "Please install Node.js v20 LTS from https://nodejs.org" -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "Detected Node.js: $nodeVersion" -ForegroundColor Green

$majorVersion = [int]($nodeVersion -replace 'v(\d+)\..*', '$1')
if ($majorVersion -gt 22) {
    Write-Host ""
    Write-Host "[WARNING] You are running Node.js $nodeVersion" -ForegroundColor Yellow
    Write-Host "better-sqlite3 prebuilt binaries are only available for Node.js v18-v22." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "STRONGLY RECOMMENDED: Install Node.js v20 LTS from https://nodejs.org" -ForegroundColor Yellow
    Write-Host "Select 'LTS' (not 'Current') on the download page." -ForegroundColor Yellow
    Write-Host ""
    $continue = Read-Host "Continue anyway? (y/N)"
    if ($continue -ne "y" -and $continue -ne "Y") {
        exit 1
    }
}

Write-Host ""
Write-Host "Step 1: Configuring npm for corporate network..." -ForegroundColor Cyan
npm config set strict-ssl false 2>$null
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
Write-Host "  SSL verification disabled (required for corporate proxy)" -ForegroundColor Gray

Write-Host ""
Write-Host "Step 2: Installing dependencies..." -ForegroundColor Cyan
npm install 2>&1 | ForEach-Object { Write-Host "  $_" }

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[ERROR] npm install failed." -ForegroundColor Red
    Write-Host ""
    Write-Host "Most likely cause: better-sqlite3 native compilation failed." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Solutions:" -ForegroundColor Yellow
    Write-Host "  1. Install Node.js v20 LTS (recommended - has prebuilt binaries)" -ForegroundColor White
    Write-Host "     Download from: https://nodejs.org (choose LTS, not Current)" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  2. If you must use Node $nodeVersion, install Visual Studio Build Tools:" -ForegroundColor White
    Write-Host "     https://visualstudio.microsoft.com/visual-cpp-build-tools/" -ForegroundColor Gray
    Write-Host "     Select 'Desktop development with C++' workload" -ForegroundColor Gray
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host ""
Write-Host "Step 3: Building application..." -ForegroundColor Cyan
npx tsx script/build.ts 2>&1 | ForEach-Object { Write-Host "  $_" }

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[ERROR] Build failed." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host " Setup Complete!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "To start the application:" -ForegroundColor Cyan
Write-Host "  Double-click start-windows.bat" -ForegroundColor White
Write-Host ""
Write-Host "Or for development mode (with hot-reload):" -ForegroundColor Cyan
Write-Host "  Double-click dev-windows.bat" -ForegroundColor White
Write-Host ""
Write-Host "Then open http://localhost:5000 in your browser." -ForegroundColor White
Write-Host ""
Read-Host "Press Enter to exit"
