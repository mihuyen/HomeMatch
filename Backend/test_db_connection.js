const mysql = require('mysql2/promise');

async function test() {
    const configs = [
        {
            name: "git-pulled config (property_schema / Quan@134)",
            host: '127.0.0.1',
            port: 3306,
            user: 'root',
            password: 'Quan@134',
            database: 'property_schema'
        },
        {
            name: "restored config (homematch / socnhi123)",
            host: '127.0.0.1',
            port: 3306,
            user: 'root',
            password: 'socnhi123',
            database: 'homematch'
        },
        {
            name: "alternative local config (homematch / Quan@134)",
            host: '127.0.0.1',
            port: 3306,
            user: 'root',
            password: 'Quan@134',
            database: 'homematch'
        }
    ];

    for (const config of configs) {
        console.log(`Testing ${config.name}...`);
        try {
            const connection = await mysql.createConnection({
                host: config.host,
                port: config.port,
                user: config.user,
                password: config.password,
                database: config.database
            });
            console.log(`  ✅ Connected successfully to ${config.database}!`);
            
            const [tables] = await connection.query("SHOW TABLES");
            console.log(`  Tables in ${config.database}:`, tables.map(t => Object.values(t)[0]));
            
            await connection.end();
        } catch (err) {
            console.log(`  ❌ Failed: ${err.message}`);
        }
    }
}

test();
