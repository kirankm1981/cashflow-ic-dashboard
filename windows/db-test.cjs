require('dotenv').config();
const dns = require('dns');
const { Client } = require('pg');

// Windows + Node 17+ resolves `localhost` to IPv6 (::1) first; default PostgreSQL
// only listens on IPv4 (127.0.0.1), causing ECONNREFUSED even when it is running.
if (typeof dns.setDefaultResultOrder === 'function') dns.setDefaultResultOrder('ipv4first');
function normalizeDbHost(url) { return url ? url.replace(/@localhost([:/])/i, '@127.0.0.1$1') : url; }

async function main() {
  const url = normalizeDbHost(process.env.DATABASE_URL);
  if (!url) {
    console.error('[FAIL] DATABASE_URL not set');
    process.exit(1);
  }
  const safeTarget = url.replace(/\/\/[^@]*@/, '//***@');
  const c = new Client({ connectionString: url });
  try {
    await c.connect();
    console.log('[OK] Database connected (' + safeTarget + ')');
    await c.end();
    process.exit(0);
  } catch (e) {
    console.error('[FAIL] ' + e.message + ' (target: ' + safeTarget + ')');
    process.exit(1);
  }
}

main();
