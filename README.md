# IC Recon - Intercompany Reconciliation Platform

Enterprise-grade intercompany reconciliation platform with automated matching, manual reconciliation, and comprehensive audit trail.

## Features

- **CSV/Excel Upload** - Import intercompany transaction data
- **Automatic Summarization** - Transactions grouped by Company + Document No + Counter Party
- **10-Rule Matching Engine** - Automated reconciliation with configurable rules
- **Reconciliation Workspace** - Dual-panel grid with company pair selection
- **Manual Matching** - Select and match transactions with amount validation
- **Dashboard** - KPIs, charts, match rate breakdown by rule
- **Reversal Detection** - Identifies reversed entries within same company
- **CSV/Excel Export** - Export reconciliation results
- **Audit Trail** - Complete history of reconciliation actions

## Matching Rules (Priority Order)

| # | Rule | Type |
|---|------|------|
| 1 | Date & Amount Match (1:1) | Exact |
| 2 | Date & Amount Match (1:M / M:1) | Exact |
| 3 | Date Range +/-5 Days & Amount Match (1:1) | Exact |
| 4 | Date Range +/-5 Days & Amount Match (1:M / M:1) | Exact |
| 5 | Invoice Number in Narration & Amount Match | Exact |
| 6 | Date Range +/-35 Days & Amount Match (1:1) | Probable |
| 7 | Date Range +/-35 Days & Amount Match (1:M / M:1) | Probable |
| 8 | Date Range +/-300 Days & Amount Match (1:1) | Probable |
| 9 | Date Range +/-300 Days & Amount Match (1:M / M:1) | Probable |
| 10 | Reversal Transactions (+/-2 Days, Net Zero) | Reversal |

## Requirements

- **Node.js v20 LTS** (recommended) or v22 LTS
  - Download from https://nodejs.org/
  - During installation, check "Automatically install the necessary tools" if prompted

## Quick Start (Windows)

### Option 1: Full installation with auto-start (recommended)

1. Install [Node.js v20 LTS](https://nodejs.org/)
2. Download/extract this project
3. Open the `windows` folder
4. Right-click **`install.bat`** and select "Run as administrator"
5. The app will auto-start on Windows boot and run at http://localhost:3000

### Option 2: Quick start (console window stays open)

1. Install [Node.js v20 LTS](https://nodejs.org/)
2. Open the `windows` folder
3. Double-click **`start.bat`**
4. Open http://localhost:3000 in your browser

### Managing the service

| Action | File |
|--------|------|
| Install + auto-start | `windows\install.bat` |
| Start (visible console) | `windows\start.bat` |
| Start (hidden background) | `windows\start-hidden.vbs` |
| Stop server | `windows\stop-server.vbs` |
| Development mode | `windows\dev.bat` |
| Uninstall auto-start | `windows\uninstall.bat` |

## Quick Start (Any OS via command line)

```bash
npm install
npm run build
npm start
```

Open http://localhost:3000

## Development Mode

```bash
npm install
npm run dev
```

## CSV Format

The upload expects a CSV file with the following columns:

| Column | Field |
|--------|-------|
| A | Company |
| G | Net Amount (supports parenthesized negatives) |
| J | Document No |
| K | Doc Date |
| P | Narration |
| S | IC GL |
| T | Counter Party |

## Project Structure

```
ic-recon/
├── client/               # React frontend (Vite + shadcn/ui)
│   └── src/
│       ├── pages/        # Dashboard, Upload, Workspace, etc.
│       ├── components/   # Shared UI components
│       └── lib/          # Utilities
├── server/               # Express.js backend
│   ├── routes.ts         # API routes
│   ├── storage.ts        # Database operations
│   ├── reconciliation-engine.ts  # Matching logic
│   └── seed.ts           # Default rule configuration
├── shared/
│   └── schema.ts         # Database schema (Drizzle ORM)
├── windows/              # Windows scripts (all in one place)
│   ├── install.bat       # Full install with auto-start
│   ├── start.bat         # Quick start (console visible)
│   ├── start-hidden.vbs  # Start server in background
│   ├── start-server.bat  # Server launcher (called by VBS)
│   ├── stop-server.vbs   # Stop the server
│   ├── dev.bat           # Development mode
│   └── uninstall.bat     # Remove auto-start
└── data/                 # SQLite database (auto-created)
```

## Technology Stack

- **Frontend**: React, Vite, TanStack Query, Wouter, Recharts, shadcn/ui, Tailwind CSS
- **Backend**: Express.js, Drizzle ORM
- **Database**: SQLite (via better-sqlite3) - no database server required
- **File Processing**: csv-parse, xlsx

## Troubleshooting

### "Cannot find module better-sqlite3"
Run `npm install better-sqlite3` - this native module needs to be compiled for your OS.

### Port 3000 already in use
The app uses port 3000 by default. To change it, set the PORT environment variable before running:
```
set PORT=4000
node dist/index.cjs
```

### Node.js not found
Ensure Node.js is installed and added to your system PATH. Restart your terminal/command prompt after installing Node.js.

### Corporate proxy issues
If behind a corporate proxy, configure npm:
```bash
npm config set proxy http://your-proxy:port
npm config set https-proxy http://your-proxy:port
```

### Windows Defender / antivirus blocking
Some corporate antivirus may block `better-sqlite3` compilation. If `npm install` fails:
1. Temporarily whitelist the project folder
2. Or ask IT to allow Node.js native module compilation
