# Cashflow IC Dashboard

Enterprise-grade platform for financial reconciliation and cash flow management with three core modules.

## Modules

### IC Recon
- 15-rule hybrid matching engine with confidence scoring
- Cheque number cross-matching, monthly aggregation, reversal detection
- AI/ML features: smart match suggestions, anomaly detection, narration matching
- Reconciliation workspace with dual-panel grid and manual matching
- Comprehensive audit trail and CSV/Excel export

### Cashflow Dashboard
- Trial balance file compilation with cashflow mapping
- Interactive charts, pivot table, and unmapped items report
- Past losses tracking

### IC Matrix
- GL and company code mapping
- Intercompany balance matrix outputs

## Prerequisites

- **Node.js v20 LTS** or higher ([download](https://nodejs.org/))
- **PostgreSQL 14+** ([download](https://www.postgresql.org/download/))

## Setup

### 1. Create the database

```bash
psql -U postgres
CREATE DATABASE cashflow_ic_dashboard;
\q
```

### 2. Configure environment

Create a `.env` file in the project root:

```
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/cashflow_ic_dashboard
SESSION_SECRET=your-secret-key-here
```

### 3. Install and run

```bash
npm install
npm run dev
```

Open http://localhost:3000 in your browser.

### 4. Default login

- **Username**: `admin`
- **Password**: `admin123`
- Change the password immediately after first login.

## Windows Setup

1. Install Node.js v20 LTS and PostgreSQL
2. Create the database (see above)
3. Double-click **`install.bat`** and follow the prompts to configure the database connection
4. Double-click **`start.bat`** to launch the app

### Windows Scripts

| Script                    | Description                                  |
|---------------------------|----------------------------------------------|
| install.bat               | First-time setup (database config + npm install) |
| start.bat                 | Start with console window                    |
| start-hidden.vbs          | Start silently in background, opens browser  |
| auto-start-install.bat    | Configure app to start with Windows login    |
| auto-start-uninstall.bat  | Remove auto-start                            |

## Password Recovery

If the admin forgets their password:

```bash
npx tsx server/scripts/reset-admin-password.ts NewPasswordHere
```

Or specify a username:

```bash
npx tsx server/scripts/reset-admin-password.ts johndoe NewPasswordHere
```

## User Roles

| Role | Capabilities |
|------|-------------|
| Platform Admin | Manage users, define reconciliation rules, all data operations |
| Recon User | Upload files, run reconciliation, view dashboards |

## Project Structure

```
├── client/                 # React frontend (Vite + shadcn/ui)
│   └── src/
│       ├── pages/          # Dashboard, Upload, Workspace, etc.
│       ├── components/     # Shared UI components
│       └── lib/            # Utilities
├── server/                 # Express.js backend
│   ├── routes.ts           # API routes
│   ├── storage.ts          # Database operations (PostgreSQL)
│   ├── reconciliation-engine.ts  # 15-rule matching engine
│   ├── ml-engine.ts        # AI/ML features
│   ├── seed.ts             # Default rule configuration
│   └── scripts/            # Admin utilities
├── shared/
│   └── schema.ts           # Database schema (Drizzle ORM + PostgreSQL)
└── dist-windows/           # Windows deployment scripts
```

## Technology Stack

- **Frontend**: React, Vite, TanStack Query, Wouter, Recharts, shadcn/ui, Tailwind CSS
- **Backend**: Express.js, Drizzle ORM, PostgreSQL
- **Authentication**: Session-based (express-session + connect-pg-simple)
- **File Processing**: csv-parse, xlsx

## Production Build

```bash
npm run build
npm start
```

## Troubleshooting

### Port 3000 already in use
Set the PORT environment variable:
```bash
PORT=8080 npm run dev
```

### Database connection refused
Ensure PostgreSQL is running and the `DATABASE_URL` in `.env` is correct.

### Corporate proxy issues
```bash
npm config set proxy http://your-proxy:port
npm config set https-proxy http://your-proxy:port
```
