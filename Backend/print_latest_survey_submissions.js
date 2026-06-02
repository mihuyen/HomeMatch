const db = require('./db');

async function main() {
    try {
        const [appts] = await db.query(`
            SELECT ap.*, ps.assigned_sales_id, ps.status as submission_status
            FROM appointments ap
            JOIN property_submissions ps ON ps.submission_id = ap.submission_id
            WHERE ap.appointment_type = 'khảo sát'
            ORDER BY ap.appointment_id DESC
        `);
        console.log("Appointments details:");
        console.log(appts);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

main();
