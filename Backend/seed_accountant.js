const db = require('./db');
const bcrypt = require('bcryptjs');

async function seed() {
    try {
        const email = 'accountant@test.com';
        const [existing] = await db.query('SELECT user_id FROM users WHERE email = ?', [email]);
        if (existing.length > 0) {
            console.log('Accountant test user already exists.');
            process.exit(0);
        }

        const passwordHash = await bcrypt.hash('123456', 10);
        await db.query(
            `INSERT INTO users (full_name, email, phone, password_hash, role)
             VALUES (?, ?, ?, ?, ?)`,
            ['Kế toán Test', email, '0987654321', passwordHash, 'accountant']
        );
        console.log('Successfully seeded accountant@test.com / 123456');
        process.exit(0);
    } catch (err) {
        console.error('Seeding error:', err);
        process.exit(1);
    }
}
seed();
