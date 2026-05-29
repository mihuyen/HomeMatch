const db = require('./db');

async function checkUser() {
    try {
        const [rows] = await db.query('SELECT user_id, full_name, email, role FROM users WHERE email = ?', ['admin@homematch.com']);
        console.log('ACCOUNT IN DATABASE:', rows[0]);
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

checkUser();
