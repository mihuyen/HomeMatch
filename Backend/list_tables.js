const db = require('./db');

(async () => {
  try {
    const [rows] = await db.query("SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY TABLE_NAME");
    console.log('Tables in current database:');
    rows.forEach(r => console.log('- ' + r.TABLE_NAME));
    process.exit(0);
  } catch (err) {
    console.error('Error listing tables:', err.message);
    process.exit(1);
  }
})();
