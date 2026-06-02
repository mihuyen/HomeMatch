const mysql = require('mysql2/promise');

async function test() {
    const connection = await mysql.createConnection({
        host: '127.0.0.1',
        port: 3306,
        user: 'root',
        password: 'socnhi123',
        database: 'homematch'
    });

    try {
        console.log("=== RENTAL_CONTRACTS ===");
        const [contracts] = await connection.query("SELECT rental_contract_id, broker_id, status FROM rental_contracts");
        console.log(contracts);

        console.log("\n=== RENTAL_CONTRACT_APPROVALS ===");
        const [approvals] = await connection.query("SELECT approval_id, rental_contract_id, status, submitted_by, approved_by, approved_commission FROM rental_contract_approvals");
        console.log(approvals);

        console.log("\n=== BROKER_PAYMENTS ===");
        const [payments] = await connection.query("SELECT * FROM broker_payments");
        console.log(payments);
    } catch (err) {
        console.error(err);
    } finally {
        await connection.end();
    }
}

test();
