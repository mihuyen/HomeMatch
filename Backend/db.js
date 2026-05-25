const mysql = require('mysql2');

const pool = mysql.createPool({
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: 'Quan@134',   // ← thay bằng mật khẩu MySQL của bạn
    database: 'property_schema',
    waitForConnections: true,
    connectionLimit: 10
});

module.exports = pool.promise();