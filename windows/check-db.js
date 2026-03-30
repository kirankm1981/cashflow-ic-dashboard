require('dotenv').config();
const { Client } = require('pg');
const c = new Client({ connectionString: process.env.DATABASE_URL });
c.connect()
  .then(() => {
    console.log('  [OK] Database connected.');
    return c.end();
  })
  .then(() => {
    require('fs').writeFileSync(require('path').join(__dirname, '.db-ok'), 'ok');
    process.exit(0);
  })
  .catch(e => {
    console.error('  [FAIL] ' + e.message);
    try { require('fs').unlinkSync(require('path').join(__dirname, '.db-ok')); } catch(_) {}
    process.exit(1);
  });
