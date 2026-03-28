# Cashflow & IC Dashboard Platform

## Overview
This project is an enterprise-grade platform designed to streamline financial reconciliation and cash flow management. It features three core modules:
1.  **IC Recon**: An intercompany reconciliation system with an advanced 15-rule matching engine, AI/ML capabilities, and a comprehensive audit trail. Its purpose is to automate and enhance the accuracy of intercompany transaction matching, significantly reducing manual effort and improving compliance.
2.  **Cashflow Dashboard**: A tool for compiling trial balance (TB) files, applying cash flow mapping, summarizing cash flow headers, and tracking past losses. This module aims to provide clear insights into an entity's cash movements and financial health.
3.  **IC Matrix**: A module for tracking intercompany balance matrices and positions, providing a centralized view of intercompany relationships and exposures.

The platform aims to provide financial professionals with powerful tools to manage complex intercompany transactions and gain deep insights into cash flow dynamics, ultimately improving financial reporting accuracy and operational efficiency.

## User Preferences
I want to prioritize a clear, concise, and efficient development process. Ensure that the codebase remains modular and well-documented to facilitate future enhancements. I prefer to be consulted before any major architectural changes or significant deviations from the established design patterns. All code should be clean, readable, and follow best practices for maintainability and scalability.

## System Architecture

### UI/UX Decisions
The platform features a consistent UI/UX across modules, with a sidebar for navigation and a header indicating the active module using color coding (blue for IC Recon, green for Cashflow, purple for IC Matrix). The design leverages `shadcn/ui` for a modern and responsive user experience, `Recharts` for data visualization, and `Wouter` for client-side routing.

### Technical Implementations
-   **Frontend**: Built with React, utilizing Vite for a fast development experience, TanStack Query for data fetching and state management, and Recharts for interactive data visualizations.
-   **Backend**: Developed using Express.js to provide a robust RESTful API.
-   **Database**: PostgreSQL is used for data persistence, managed through the Drizzle ORM with `pg` (node-postgres) driver. Connection via `DATABASE_URL` environment variable.
-   **File Processing**: `multer` handles file uploads, while `csv-parse` and `xlsx` (for Excel support) manage parsing various input file formats.

### Feature Specifications
-   **Global Upload Manager**: A central system (`UploadManagerProvider`) for all file uploads (GL dumps, TB files, mapping files), allowing background processing and user navigation without interruption. Progress notifications are displayed globally.
-   **Intercompany Reconciliation (IC Recon)**:
    -   Supports CSV/Excel file uploads for transactions.
    -   Automatic summarization of transactions by Company, Document No, and Counter Party.
    -   A 15-rule matching engine (IC-R1 to IC-R15) with configurable parameters for high-confidence `AUTO_MATCH`, `REVERSAL` detection, `REVIEW_MATCH` for probable matches, and `SUGGESTED_MATCH` for low-confidence suggestions.
    -   Advanced matching techniques including sign-flip, same-direction, net-off aggregation, same-entity auto-correction, M:M aggregation, reversal detection, and fuzzy narration matching.
    -   Dashboard with KPIs, pie charts, and rule breakdown.
    -   Dual-panel grid reconciliation workspace with manual matching capabilities.
    -   Configurable rule parameters and comprehensive audit trails.
-   **AI/ML Features**:
    -   **Smart Match Suggestions**: Identifies potential matches below the automatic threshold.
    -   **Confidence Scoring**: Multi-factor scoring for all matched lines.
    -   **Enhanced Narration Matching**: Uses a combination of TF-IDF, token overlap, and Levenshtein similarity.
    -   **Anomaly Detection**: Identifies statistical outliers, missing entries, potential duplicates, and weekend transactions.
    -   **Unmatched Classification**: Categorizes unmatched lines with reasoning.
    -   **Learning from Corrections**: Improves future matching accuracy based on manual interventions.
-   **Cashflow Dashboard**:
    -   Upload and process multiple TB files and cashflow mapping files.
    -   Provides four dashboard views: overall status, detailed cash flow pivot, and unmapped items report.
    -   Unified dataset merging TB data and past losses for comprehensive analysis.
-   **IC Matrix**:
    -   Upload and manage TB files and mapping files (IC-GL-Mapping, Company_Code sheets).
    -   Provides a dashboard with compiled TB data, KPIs, and mapping summaries.

### Authentication & User Management
-   **Session-based auth**: Uses `express-session` with `connect-pg-simple` for PostgreSQL session storage.
-   **Password hashing**: bcryptjs with salt rounds of 10.
-   **Two roles**: `platform_admin` (manage users + define rules) and `recon_user` (all data operations).
-   **Default admin**: Seeded on first startup (username: `admin`, password: `admin123`).
-   **Frontend auth**: `useAuth` hook in `client/src/hooks/use-auth.ts` provides auth state. `App.tsx` gates all routes behind login.
-   **User management**: Admin-only page at `/admin/users` for creating, editing, and disabling users.
-   **Password management**: All users can change their own password via sidebar key icon. Admins can reset any user's password via the user management page.
-   **Admin password recovery**: If the admin forgets their password, run: `npx tsx server/scripts/reset-admin-password.ts <new-password>` from the project root (Shell). Optionally specify a username as the first argument.
-   **Routes**: `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`, `/api/auth/change-password`, `/api/users` (CRUD, admin-only).
-   All `/api/*` routes (except `/api/auth/*`) require authentication via middleware.
-   **Rules management**: Only platform admins can view and manage reconciliation rules (both frontend sidebar link and all `/api/rules` endpoints are admin-only).

### System Design Choices
-   The application is structured into distinct modules, reflected in the URL routing (`/recon/*`, `/cashflow`, `/ic-matrix`, `/admin/*`).
-   Data persistence is handled by PostgreSQL, providing better concurrent access, performance, and production readiness.
-   Windows deployment is supported with scripts for installation, development, and background execution, ensuring ease of deployment for target users.

## External Dependencies
-   **Frontend Libraries**: React, Vite, TanStack Query, Wouter, Recharts, shadcn/ui.
-   **Backend Libraries**: Express.js, pg (node-postgres), Drizzle ORM, multer, csv-parse, xlsx, bcryptjs, express-session, connect-pg-simple.