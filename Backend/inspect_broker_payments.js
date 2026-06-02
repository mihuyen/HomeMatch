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
        console.log("=== USERS IN SYSTEM ===");
        const [users] = await connection.query("SELECT user_id, full_name, email, role FROM users");
        console.log(users);

        console.log("\n=== BROKER_PAYMENTS COUNT ===");
        const [paymentsCount] = await connection.query("SELECT COUNT(*) AS count FROM broker_payments");
        console.log("Total rows in broker_payments:", paymentsCount[0].count);

        console.log("\n=== BROKER_PAYMENTS SAMPLES ===");
        const [payments] = await connection.query("SELECT * FROM broker_payments LIMIT 10");
        console.log(payments);

        console.log("\n=== RENTAL_CONTRACTS COUNT ===");
        const [contractsCount] = await connection.query("SELECT COUNT(*) AS count FROM rental_contracts");
        console.log("Total rows in rental_contracts:", contractsCount[0].count);

        console.log("\n=== RENTAL_CONTRACTS BY STATUS ===");
        const [contractsByStatus] = await connection.query("SELECT status, COUNT(*) AS count FROM rental_contracts GROUP BY status");
        console.log(contractsByStatus);

        console.log("\n=== BROKER PAYMENTS TOTAL GROUP BY STATUS ===");
        const [paymentsSum] = await connection.query("SELECT status, SUM(amount) AS total FROM broker_payments GROUP BY status");
        console.log(paymentsSum);

    } catch (err) {
        console.error(err);
    } finally {
        await connection.end();
    }
}

test();
