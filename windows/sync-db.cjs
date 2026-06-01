require('dotenv').config();
const dns = require('dns');
const { execSync } = require('child_process');
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Windows + Node 17+ resolves `localhost` to IPv6 (::1) first; default PostgreSQL
// only listens on IPv4 (127.0.0.1), causing ECONNREFUSED even when it is running.
if (typeof dns.setDefaultResultOrder === 'function') dns.setDefaultResultOrder('ipv4first');
function normalizeDbHost(url) { return url ? url.replace(/@localhost([:/])/i, '@127.0.0.1$1') : url; }

const failFlag = path.join(__dirname, '.db-fail');

try { fs.unlinkSync(failFlag); } catch (_) {}

async function main() {
  const dbUrl = normalizeDbHost(process.env.DATABASE_URL);
  const safeTarget = dbUrl ? dbUrl.replace(/\/\/[^@]*@/, '//***@') : '(DATABASE_URL not set)';
  const c = new Client({ connectionString: dbUrl });
  try {
    await c.connect();
    console.log('  [OK] Database connected. (' + safeTarget + ')');
    await c.end();
  } catch (e) {
    console.error('  [FAIL] ' + e.message + ' (target: ' + safeTarget + ')');
    fs.writeFileSync(failFlag, 'fail');
    process.exit(1);
  }

  try {
    console.log('  Syncing database tables...');
    const drizzleKitBin = path.join(__dirname, '..', 'node_modules', '.bin', process.platform === 'win32' ? 'drizzle-kit.cmd' : 'drizzle-kit');
    const cmd = require('fs').existsSync(drizzleKitBin) ? drizzleKitBin + ' push' : 'npx drizzle-kit push';
    execSync(cmd, {
      cwd: path.join(__dirname, '..'),
      stdio: ['pipe', 'pipe', 'pipe'],
      input: 'y\ny\ny\ny\ny\ny\ny\ny\ny\ny\n',
      timeout: 60000,
      env: { ...process.env, NODE_ENV: '', DATABASE_URL: dbUrl },
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
