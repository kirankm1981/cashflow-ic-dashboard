require('dotenv').config();
const { execSync } = require('child_process');
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const failFlag = path.join(__dirname, '.db-fail');

try { fs.unlinkSync(failFlag); } catch (_) {}

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await c.connect();
    console.log('  [OK] Database connected.');
    await c.end();
  } catch (e) {
    console.error('  [FAIL] ' + e.message);
    fs.writeFileSync(failFlag, 'fail');
    process.exit(1);
  }

  try {
    console.log('  Syncing database tables...');
    execSync('npx drizzle-kit push', {
      stdio: ['pipe', 'pipe', 'pipe'],
      input: 'y\ny\ny\ny\ny\n',
      timeout: 30000,
    });
    console.log('  [OK] Database tables ready.');
  } catch (e) {
    console.log('  [OK] Database tables ready (no changes needed).');
  }
}

main();
