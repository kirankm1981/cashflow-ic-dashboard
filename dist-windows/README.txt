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
  1. Double-click "start.bat"
  2. Open http://localhost:5000 in your browser
  3. Login with default admin credentials:
     Username: admin
     Password: admin123
     (Change the password immediately after first login)

## Stopping the App
  Press Ctrl+C in the console window

## Password Recovery
  If the admin forgets their password, run from the project folder:
    npx tsx server/scripts/reset-admin-password.ts NewPasswordHere

## Port Conflict
  If port 5000 is in use, edit start.bat and change PORT=5000
  to another port (e.g., PORT=8080).
