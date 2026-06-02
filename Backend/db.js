const mysql = require('mysql2');

const dbName = process.env.DB_NAME || 'homematch';

const pool = mysql.createPool({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
<<<<<<< HEAD
    password: '100420',
    database: 'homematch',
=======
    password: 'Quan@134',
    database: 'property_schema',
>>>>>>> a6f5d2fe0d3ec5bc8643a3427dbd40723a4a0d45
    waitForConnections: true,
    connectionLimit: 10
});

module.exports = pool.promise();