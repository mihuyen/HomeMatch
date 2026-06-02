const db = require('./db');

async function main() {
    try {
        console.log("Checking appointments...");
        const [appts] = await db.query("SELECT * FROM appointments ORDER BY appointment_id DESC LIMIT 5");
        console.log("Latest appointments:");
        console.log(appts);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

main();
