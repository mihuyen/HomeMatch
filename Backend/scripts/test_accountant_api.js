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

async function runTests() {
    console.log('--- STARTING ACCOUNTANT API TESTS ---');
    
    // 1. Login
    console.log('1. Attempting login as accountant...');
    const loginRes = await makeRequest({
        hostname: 'localhost',
        port: 5050,
        path: '/api/auth/login',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    }, {
        email: 'accountant@homematch.com',
        password: 'password123'
    });
    
    if (loginRes.statusCode !== 200) {
        console.error('Login failed!', loginRes.body);
        process.exit(1);
    }
    
    const token = loginRes.body.token;
    console.log('Login successful! Token acquired.');

    // 2. Fetch initial expired contracts
    console.log('\n2. Fetching initial expired contracts...');
    let expiredRes = await makeRequest({
        hostname: 'localhost',
        port: 5050,
        path: '/api/accountant/contracts/expired',
        method: 'GET',
        headers: { 
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    console.log('Initial stats:', expiredRes.body.stats);
    console.log('Initial count of expired pending contracts:', expiredRes.body.items.length);
    
    if (expiredRes.body.items.length === 0) {
        console.error('No expired contract found to run test! Run prep_test_data.js first.');
        process.exit(1);
    }
    
    const targetTxId = expiredRes.body.items[0].deposit_transaction.transaction_id;
    const targetCode = expiredRes.body.items[0].contract_code;
    const targetAmount = expiredRes.body.items[0].deposit_transaction.amount;
    
    console.log(`Selected contract ${targetCode} with transaction ID ${targetTxId} and deposit amount ${targetAmount} for refund.`);

    // 3. Post a refund
    console.log('\n3. Processing refund via POST /api/accountant/returns...');
    const refundRes = await makeRequest({
        hostname: 'localhost',
        port: 5050,
        path: '/api/accountant/returns',
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    }, {
        transaction_id: targetTxId,
        return_amount: Number(targetAmount),
        reason: 'Automated test of deposit return for expired contract'
    });

    console.log('Refund Post Status:', refundRes.statusCode);
    console.log('Refund Post Response:', refundRes.body);
    
    if (refundRes.statusCode !== 201) {
        console.error('Refund processing failed!');
        process.exit(1);
    }

    // 4. Fetch expired contracts again to see if it's cleared and stats updated
    console.log('\n4. Fetching expired contracts again...');
    expiredRes = await makeRequest({
        hostname: 'localhost',
        port: 5050,
        path: '/api/accountant/contracts/expired',
        method: 'GET',
        headers: { 
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    console.log('Post-refund stats:', expiredRes.body.stats);
    console.log('Post-refund count of expired pending contracts:', expiredRes.body.items.length);

    // 5. Clean up refund entry so that manual testing is still possible
    const db = require('../db');
    console.log('\n5. Cleaning up test refund from database to keep manual test capability...');
    await db.query('DELETE FROM deposit_returns WHERE transaction_id = ?', [targetTxId]);
    console.log('Cleanup completed successfully!');

    console.log('\n--- ALL ACCOUNTANT API TESTS COMPLETED SUCCESSFULLY! ---');
    process.exit(0);
}

runTests().catch(err => {
    console.error('Test run failed with error:', err);
    process.exit(1);
});
