const mysql = require('mysql2');

const dbName = process.env.DB_NAME || 'homematch';

const pool = mysql.createPool({
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: 'socnhi123',
    database: 'homematch',
    waitForConnections: true,
    connectionLimit: 10
});

module.exports = pool.promise();