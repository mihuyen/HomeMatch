const http = require('http');

function makeRequest(options, postData = null) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve({ statusCode: res.statusCode, body: parsed });
                } catch (e) {
                    resolve({ statusCode: res.statusCode, body: data });
                }
            });
        });
        
        req.on('error', (err) => { reject(err); });
        
        if (postData) {
            req.write(JSON.stringify(postData));
        }
        req.end();
    });
}

async function verify() {
    console.log('=== STARTING BROKER STATS VERIFICATION ===');
    
    // 1. Login
    console.log('Logging in as broker...');
    const loginRes = await makeRequest({
        hostname: 'localhost',
        port: 5050,
        path: '/api/auth/login',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    }, {
        email: 'broker1@test.com',
        password: '123456'
    });
    
    if (loginRes.statusCode !== 200) {
        console.error('❌ Login failed!', loginRes.body);
        process.exit(1);
    }
    const token = loginRes.body.token;
    console.log('Login successful! User info:', loginRes.body.user);

    // 2. Fetch stats
    console.log('Fetching broker stats...');
    const statsRes = await makeRequest({
        hostname: 'localhost',
        port: 5050,
        path: '/api/broker/dashboard-stats',
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    if (statsRes.statusCode !== 200) {
        console.error('❌ Stats query failed!', statsRes.body);
        process.exit(1);
    }

    const stats = statsRes.body;
    console.log('Broker API Response stats:', stats);

    if (stats.currMonthRevenue > 0) {
        console.log('✅ Success: currMonthRevenue is greater than zero.');
        process.exit(0);
    } else {
        console.error('❌ Failed: currMonthRevenue is zero.');
        process.exit(1);
    }
}

verify();
