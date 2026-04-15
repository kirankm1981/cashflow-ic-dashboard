require('dotenv').config();
const { Client } = require('pg');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('[FAIL] DATABASE_URL not set');
    process.exit(1);
  }
  const c = new Client({ connectionString: url });
  try {
    await c.connect();
    console.log('[OK] Database connected');
    await c.end();
    process.exit(0);
  } catch (e) {
    console.error('[FAIL] ' + e.message);
    process.exit(1);
  }
}

main();
