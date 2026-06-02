const mysql = require('mysql2');

const dbName = process.env.DB_NAME || 'homematch';

const pool = mysql.createPool({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: 'socnhi123',
    database: 'homematch',
    waitForConnections: true,
    connectionLimit: 10
});

module.exports = pool.promise();