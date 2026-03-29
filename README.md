# Cashflow IC Dashboard

Enterprise-grade platform for financial reconciliation and cash flow management.

## Modules

- **IC Recon** — 15-rule hybrid matching engine with confidence scoring, cheque matching, monthly aggregation, reversal detection, AI/ML insights
- **Cashflow Dashboard** — Trial balance compilation, cashflow mapping, charts, pivot table, past losses tracking
- **IC Matrix** — GL/company code mapping, intercompany balance matrix

---

## Prerequisites

Before you begin, install the following:

1. **Node.js v20 LTS** — Download from https://nodejs.org (choose LTS, not Current)
2. **PostgreSQL 14+** — Download from https://www.postgresql.org/download/windows/
   - During PostgreSQL install, **remember the password** you set for the `postgres` user
   - Keep the default port (5432) unless you have a reason to change it

---

## Installation (Windows — Step by Step)

### Step 1: Download the code

Download the ZIP from GitHub and extract it, or use git:
```
git clone https://github.com/kirankm1981/cashflow-ic-dashboard.git
cd cashflow-ic-dashboard
```

### Step 2: Create the database

Open **Command Prompt** and run:
```
psql -U postgres
```
Enter the password you set during PostgreSQL installation, then run:
```sql
CREATE DATABASE cashflow_ic_dashboard;
\q
```

> **If `psql` is not recognized**: Add PostgreSQL to your PATH.
> Go to System Properties > Environment Variables > Path > Edit > Add:
> `C:\Program Files\PostgreSQL\14\bin` (adjust the version number to match yours)

### Step 3: Run the installer

Double-click **`install.bat`** in the project folder.

It will:
1. Check that Node.js is installed
2. Ask for your PostgreSQL connection details (host, port, database, username, password)
3. Create a `.env` configuration file
4. Install all dependencies (`npm install`)
5. Create database tables (`drizzle-kit push`)
6. Seed default data (admin user + reconciliation rules)

### Step 4: Start the application

Double-click **`start.bat`**

The app will:
1. Verify dependencies are installed
2. Ensure database tables are up to date
3. Start the server
4. Display: `Open your browser to: http://localhost:3000`

### Step 5: Login

Open http://localhost:3000 in your browser.

```
Username: admin
Password: admin123
```

**Change the password immediately** after first login (click the key icon in the sidebar).

---

## Installation (Command Line — Any OS)

```bash
# 1. Clone the repository
git clone https://github.com/kirankm1981/cashflow-ic-dashboard.git
cd cashflow-ic-dashboard

# 2. Create .env file (copy and edit)
cp .env.example .env
# Edit .env with your PostgreSQL credentials

# 3. Install dependencies
npm install

# 4. Create database tables
npx drizzle-kit push

# 5. Start the server
npx tsx server/index.ts
```

Open http://localhost:3000

---

## Windows Scripts Reference

| Script | Description |
|--------|-------------|
| `install.bat` | First-time setup: configure database, install deps, create tables, seed data |
| `start.bat` | Start the app (shows console window with logs) |
| `start-hidden.vbs` | Start silently in background, opens browser automatically |
| `auto-start-install.bat` | Configure app to start automatically on Windows login |
| `auto-start-uninstall.bat` | Remove auto-start from Windows |

---

## Configuration

The `.env` file (created by `install.bat`) contains:

```env
DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/cashflow_ic_dashboard
SESSION_SECRET=your-random-secret-key
PORT=3000
```

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Secret key for session encryption (any random string) |
| `PORT` | Server port (default: 3000) |

---

## User Roles

| Role | Access |
|------|--------|
| Platform Admin | Manage users, define reconciliation rules, all data operations |
| Recon User | Upload files, run reconciliation, view dashboards |

---

## Password Recovery

If the admin forgets their password, open Command Prompt in the project folder and run:

```bash
npx tsx server/scripts/reset-admin-password.ts NewPasswordHere
```

To reset a specific user's password:
```bash
npx tsx server/scripts/reset-admin-password.ts username NewPasswordHere
```

---

## Troubleshooting

### "psql is not recognized as an internal or external command"

PostgreSQL's `bin` folder is not in your system PATH.

**Fix:** Add PostgreSQL to PATH:
1. Open Start Menu, search "Environment Variables"
2. Click "Edit the system environment variables"
3. Click "Environment Variables"
4. Under "System variables", find `Path`, click Edit
5. Click "New" and add: `C:\Program Files\PostgreSQL\14\bin`
   (replace `14` with your actual PostgreSQL version number)
6. Click OK on all dialogs
7. **Restart Command Prompt** and try again

### "npm install" fails or hangs

**Behind a corporate proxy:**
```
npm config set proxy http://your-proxy:port
npm config set https-proxy http://your-proxy:port
```

**SSL certificate issues:**
```
npm config set strict-ssl false
```

### "Database setup failed" or "connection refused"

1. **Check PostgreSQL is running:**
   - Press `Win+R`, type `services.msc`, press Enter
   - Find "postgresql" in the list
   - Make sure Status says "Running"
   - If not, right-click > Start

2. **Check the database exists:**
   ```
   psql -U postgres -l
   ```
   Look for `cashflow_ic_dashboard` in the list. If missing:
   ```
   psql -U postgres -c "CREATE DATABASE cashflow_ic_dashboard;"
   ```

3. **Check your .env file:**
   Open `.env` in Notepad and verify:
   - Password matches what you set during PostgreSQL installation
   - No extra spaces around the `=` sign
   - Database name matches what you created

### "EADDRINUSE: address already in use :::3000"

Port 3000 is already being used by another app.

**Option 1:** Find and stop the other app:
```
netstat -ano | findstr :3000
taskkill /PID <number> /F
```

**Option 2:** Change the port in `.env`:
```
PORT=8080
```
Then access the app at http://localhost:8080

### Server starts but page is blank or shows errors

Make sure you started with `start.bat` (not `npm start`).
The `start.bat` runs in development mode which automatically compiles the frontend.

### "Cannot find module" errors

Dependencies may be incomplete. Run:
```
npm install
```
Then try `start.bat` again.

### Login page shows but login fails

The database may not have been seeded. Run:
```
npx drizzle-kit push --force
npx tsx server/index.ts
```
The server automatically seeds the default admin user on startup.

### Still stuck?

1. Delete `node_modules` folder and `.env` file
2. Run `install.bat` again from scratch
3. Run `start.bat`

---

## Project Structure

```
cashflow-ic-dashboard/
├── install.bat                  # Windows setup script
├── start.bat                    # Windows start script
├── start-hidden.vbs             # Background start script
├── auto-start-install.bat       # Windows auto-start setup
├── auto-start-uninstall.bat     # Remove auto-start
├── .env.example                 # Example configuration
├── client/                      # React frontend
│   └── src/
│       ├── pages/               # Dashboard, Upload, Workspace, etc.
│       ├── components/          # Shared UI components
│       └── lib/                 # Utilities
├── server/                      # Express.js backend
│   ├── index.ts                 # Server entry point
│   ├── routes.ts                # API routes
│   ├── storage.ts               # Database operations
│   ├── reconciliation-engine.ts # 15-rule matching engine
│   ├── ml-engine.ts             # AI/ML features
│   ├── seed.ts                  # Default data seeding
│   ├── db.ts                    # Database connection
│   └── scripts/                 # Admin utilities
│       └── reset-admin-password.ts
├── shared/
│   └── schema.ts                # Database schema (Drizzle ORM)
└── package.json
```

## Technology Stack

- **Frontend**: React, Vite, TanStack Query, Wouter, Recharts, shadcn/ui, Tailwind CSS
- **Backend**: Express.js, Drizzle ORM
- **Database**: PostgreSQL
- **Auth**: Session-based (express-session + connect-pg-simple)
- **File Processing**: csv-parse, xlsx
