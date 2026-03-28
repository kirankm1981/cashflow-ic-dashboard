#!/bin/bash
# Push IC Recon to GitHub
# Run this from the project root directory

set -e

echo "Preparing to push to GitHub..."

# Initialize git if needed
if [ ! -d ".git" ]; then
    git init
fi

# Set remote
git remote remove origin 2>/dev/null || true
git remote add origin https://github.com/kirankm1981/ic-recon.git

# Add all files
git add -A

# Commit
git commit -m "IC Recon - Intercompany Reconciliation Platform

Features:
- CSV/Excel upload for intercompany transactions
- Automatic summarization (Company + Document No + Counter Party)
- 10-rule automated matching engine
- Reversal transaction detection
- Reconciliation workspace with dual-panel grid
- Manual matching with amount validation
- Dashboard with KPIs and rule breakdown
- Windows-compatible (batch scripts for install/run)
- SQLite database (no server needed)" || echo "Nothing to commit"

# Push
git branch -M main
git push -u origin main

echo "Done! Repository: https://github.com/kirankm1981/ic-recon"
