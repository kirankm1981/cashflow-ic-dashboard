@echo off
echo Starting Assetz Strata Platform (Production Mode)...
echo.
set NODE_ENV=production
set NODE_OPTIONS=--max-old-space-size=4096
node dist/index.cjs
