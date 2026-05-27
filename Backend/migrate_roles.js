const pool = require('./db');

async function migrate() {
  try {
    console.log('Connecting to DB and checking counts...');

    const [beforeRows] = await pool.query("SELECT COUNT(*) AS brokers FROM users WHERE role='broker';");
    const brokersBefore = beforeRows[0] ? beforeRows[0].brokers : 0;

    const [salesBeforeRows] = await pool.query("SELECT COUNT(*) AS sales FROM users WHERE role='sale';");
    const salesBefore = salesBeforeRows[0] ? salesBeforeRows[0].sales : 0;

    console.log(`Before: brokers=${brokersBefore}, sales=${salesBefore}`);

    if (brokersBefore === 0) {
      console.log('No users with role=broker found. Nothing to do.');
      await pool.end();
      return;
    }

    const [result] = await pool.query("UPDATE users SET role='sale' WHERE role='broker';");
    // result.affectedRows for mysql2
    const affected = result && (result.affectedRows ?? result.affectedRows === 0 ? result.affectedRows : result.affectedRows);

    console.log(`UPDATE affected rows: ${affected}`);

    const [afterRows] = await pool.query("SELECT COUNT(*) AS sales_after FROM users WHERE role='sale';");
    const salesAfter = afterRows[0] ? afterRows[0].sales_after : 0;

    console.log(`After: sales=${salesAfter}`);

    await pool.end();
    console.log('Migration completed.');
  } catch (err) {
    console.error('Migration failed:', err.message || err);
    try { await pool.end(); } catch (e) {}
    process.exitCode = 1;
  }
}

migrate();
