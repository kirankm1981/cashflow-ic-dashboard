@echo off
echo Starting Assetz Strata Platform (Development Mode)...
echo.
set NODE_ENV=development
set NODE_OPTIONS=--max-old-space-size=4096
npx tsx server/index.ts
