# IC Recon - Intercompany Reconciliation Platform
=============================================

## Prerequisites
  Node.js v20 LTS (download from https://nodejs.org)
  That's it - nothing else to install.

## How to Run
  1. Double-click "start.bat" (shows console window)
     OR
     Double-click "start-silent.vbs" (runs silently, opens browser)

  2. Open http://localhost:5000 in your browser

  No internet connection required. No npm install required.
  Everything is pre-bundled and ready to go.

## Auto-Start with Windows
  1. Press Win+R, type: shell:startup, press Enter
  2. Copy "start-silent.vbs" (or a shortcut) into that folder

## Stopping the App
  - start.bat: Press Ctrl+C in the console
  - start-silent.vbs: Task Manager > find "node.exe" > End Task

## Data & Backup
  All data is in the "data" folder (created on first run).
  - Backup: Copy the "data" folder
  - Reset: Delete the "data" folder and restart

## Port Conflict
  If port 5000 is in use, edit start.bat and change PORT=5000
  to another port (e.g., PORT=8080).

## Node.js Version
  This package includes prebuilt binaries for Node.js v20 (LTS).
  If you use a different Node.js version, you may need to rebuild
  the database driver by running: npm install better-sqlite3
