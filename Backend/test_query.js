const db = require('./db');

async function main() {
    try {
        const saleId = 36;
        const submissionId = 8433;

        const conditions = [
            'ps.assigned_sales_id = ?',
            "ap.appointment_type = 'khảo sát'"
        ];
        const params = [saleId];

        if (submissionId) {
            conditions.push('ap.submission_id = ?');
            params.push(Number(submissionId));
        }

        const [rows] = await db.query(
            `SELECT ap.appointment_id, ap.appointment_type, ap.status, ap.scheduled_time
             FROM appointments ap
             INNER JOIN property_submissions ps ON ps.submission_id = ap.submission_id
             WHERE ` + conditions.join(' AND '),
            params
        );

        console.log('QueryResult:', rows);
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
main();
