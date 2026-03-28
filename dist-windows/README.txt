# Cashflow IC Dashboard
=============================================

## Prerequisites
  - Node.js v20 LTS (download from https://nodejs.org)
  - PostgreSQL 14 or higher (download from https://www.postgresql.org/download/windows/)

## First Time Setup
  1. Install PostgreSQL and remember the password you set
  2. Open pgAdmin or Command Prompt and create a database:
     psql -U postgres
     CREATE DATABASE cashflow_ic_dashboard;
     \q
  3. Double-click "install.bat" and follow the prompts
     - Enter your PostgreSQL host (usually localhost)
     - Enter your PostgreSQL port (usually 5432)
     - Enter the database name (cashflow_ic_dashboard)
     - Enter your PostgreSQL username (usually postgres)
     - Enter your PostgreSQL password

## How to Run

| Script                    | Description                                  |
|---------------------------|----------------------------------------------|
| start.bat                 | Start with console window (recommended)      |
| start-hidden.vbs          | Start silently in background, opens browser  |
| auto-start-install.bat    | Configure app to start with Windows          |
| auto-start-uninstall.bat  | Remove auto-start from Windows               |

## Default Login
  Username: admin
  Password: admin123
  (Change the password immediately after first login)

## Stopping the App
  - start.bat: Press Ctrl+C in the console window
  - start-hidden.vbs: Open Task Manager > find "node.exe" > End Task

## Password Recovery
  If the admin forgets their password, open Command Prompt in the project
  folder and run:
    npx tsx server/scripts/reset-admin-password.ts NewPasswordHere

## Port Conflict
  If port 5000 is in use, edit start.bat and change PORT=5000
  to another port (e.g., PORT=8080).
