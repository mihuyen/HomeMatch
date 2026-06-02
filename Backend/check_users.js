const db = require('./db');

async function main() {
    try {
        const [users] = await db.query("SELECT user_id, email, role, full_name FROM users");
        console.log("Users:");
        console.log(users);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

main();
