const mysql = require('mysql2/promise');

async function truncateTables() {
  console.log('\n===============================================');
  console.log('  TRUNCATING MYSQL TABLES');
  console.log('===============================================\n');

  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'root',
    database: 'live_attendance',
  });

  try {
    // Disable foreign key checks
    await connection.execute('SET FOREIGN_KEY_CHECKS = 0');
    console.log('[1] Foreign key checks disabled');

    // Get all tables except 'device'
    const [allTables] = await connection.execute(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = 'live_attendance' AND TABLE_NAME != 'device'`
    );

    const tables = allTables.map((t) => t.TABLE_NAME);
    console.log(`Found ${tables.length} tables to truncate\n`);

    // Truncate each table
    for (const table of tables) {
      try {
        await connection.execute(`TRUNCATE TABLE ${table}`);
        console.log(`✓ Truncated: ${table}`);
      } catch (err) {
        console.log(`⊘ Skipped ${table}: ${err.message}`);
      }
    }

    // Re-enable foreign key checks
    await connection.execute('SET FOREIGN_KEY_CHECKS = 1');
    console.log('\n[2] Foreign key checks re-enabled');

    // Show table row counts
    console.log('\n[3] Verifying truncation:');
    const [rows] = await connection.execute(
      `SELECT TABLE_NAME, TABLE_ROWS FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = 'live_attendance' AND TABLE_NAME != 'device'
       ORDER BY TABLE_NAME`
    );

    rows.forEach((row) => {
      console.log(`  ${row.TABLE_NAME}: ${row.TABLE_ROWS} rows`);
    });

    console.log('\n===============================================');
    console.log('  MYSQL TRUNCATION COMPLETE');
    console.log('===============================================\n');
  } catch (err) {
    console.error('✗ Error:', err.message);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

truncateTables();
