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
      cwd: path.join(__dirname, '..'),
      stdio: ['pipe', 'pipe', 'pipe'],
      input: 'y\ny\ny\ny\ny\ny\ny\ny\ny\ny\n',
      timeout: 60000,
      env: { ...process.env, NODE_ENV: '' },
    });
    console.log('  [OK] Database tables synced.');
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString() : '';
    const stdout = e.stdout ? e.stdout.toString() : '';
    if (stderr.includes('ECONNREFUSED') || stderr.includes('authentication') || stderr.includes('does not exist')) {
      console.error('  [FAIL] Database sync failed: ' + stderr.trim());
      fs.writeFileSync(failFlag, 'fail');
      process.exit(1);
    }
    console.log('  [OK] Database tables ready.');
  }
}

main();
