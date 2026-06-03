const mysql = require('mysql2');

const dbName = process.env.DB_NAME || 'homematch';

console.log("Initializing database connection pool with password:", 'socnhi123');

const pool = mysql.createPool({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: 'Quan@134',
    database: 'property_schema',
    waitForConnections: true,
    connectionLimit: 10
});

module.exports = pool.promise();