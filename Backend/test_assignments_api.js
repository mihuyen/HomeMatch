const http = require('http');

const options = {
    hostname: 'localhost',
    port: 5050,
    path: '/api/admin/assignments?status=pending',
    method: 'GET',
    headers: {
        'Content-Type': 'application/json'
    }
};

// Disable require login check or pass a valid admin token. Since we are querying locally, let's bypass auth if we run it as a test or login first.
// Wait, we can just use the auth token of 'admin@homematch.com'!
// Let's first log in and get the token.
const loginData = JSON.stringify({
    email: 'admin@homematch.com',
    password: 'admin123'
});

const loginOptions = {
    hostname: 'localhost',
    port: 5050,
    path: '/api/auth/login',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': loginData.length
    }
};

const reqLogin = http.request(loginOptions, (resLogin) => {
    let body = '';
    resLogin.on('data', chunk => body += chunk);
    resLogin.on('end', () => {
        try {
            const data = JSON.parse(body);
            const token = data.token;
            console.log('LOGGED IN! Token:', token);

            // Now query assignments
            const opt = {
                ...options,
                headers: {
                    ...options.headers,
                    'Authorization': `Bearer ${token}`
                }
            };
            const req = http.request(opt, (res) => {
                let resBody = '';
                res.on('data', chunk => resBody += chunk);
                res.on('end', () => {
                    console.log('ASSIGNMENTS BODY:', resBody);
                    process.exit(0);
                });
                req.on('error', e => reject(e));
                if (postData) {
                    req.write(JSON.stringify(postData));
                }
                req.end();
            });
        };

        // 2. Log in as tenant_a@test.com
        console.log('Logging in as tenant_a@test.com...');
        const tenantLoginRes = await makeRequest({
            hostname: 'localhost',
            port: 5050,
            path: '/api/auth/login',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, {
            email: 'tenant_a@test.com',
            password: '123456'
        });

        if (tenantLoginRes.statusCode !== 200) {
            console.error('Tenant login failed:', tenantLoginRes.body);
            process.exit(1);
        }
        const tenantToken = tenantLoginRes.body.token;
        console.log('Tenant logged in successfully.');

        // 3. Call request-view API as tenant
        console.log(`Requesting view for listing #${listingId}...`);
        const requestViewRes = await makeRequest({
            hostname: 'localhost',
            port: 5050,
            path: `/api/listings/${listingId}/request-view`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${tenantToken}`
            }
        }, {
            note: 'Verification test view request'
        });

        if (requestViewRes.statusCode !== 201) {
            console.error('Request-view API failed:', requestViewRes.body);
            process.exit(1);
        }
        const assignmentId = requestViewRes.body.assignment_id;
        console.log(`Request-view created assignment ID: ${assignmentId}`);

        // 4. Verify assignment status in the DB is 'chờ xử lý'
        const [dbRows] = await db.query("SELECT * FROM staff_assignments WHERE assignment_id = ?", [assignmentId]);
        console.log('New assignment in DB:', dbRows[0]);
        if (dbRows[0].status !== 'chờ xử lý') {
            console.error(`Verification Failed: New assignment has status '${dbRows[0].status}' but expected 'chờ xử lý'.`);
            process.exit(1);
        }
        console.log("Success: Status is 'chờ xử lý' in DB.");

        // 5. Log in as admin@homematch.com
        console.log('Logging in as admin@homematch.com...');
        const adminLoginRes = await makeRequest({
            hostname: 'localhost',
            port: 5050,
            path: '/api/auth/login',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, {
            email: 'admin@homematch.com',
            password: 'admin123'
        });

        if (adminLoginRes.statusCode !== 200) {
            console.error('Admin login failed:', adminLoginRes.body);
            process.exit(1);
        }
        const adminToken = adminLoginRes.body.token;
        console.log('Admin logged in successfully.');

        // 6. Query pending broker assignments as admin and make sure our new assignment is returned
        console.log('Fetching pending assignments as admin...');
        const getAssignmentsRes = await makeRequest({
            hostname: 'localhost',
            port: 5050,
            path: '/api/admin/broker-assignments?status=pending',
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${adminToken}`
            }
        });

        if (getAssignmentsRes.statusCode !== 200) {
            console.error('Failed to get assignments as admin:', getAssignmentsRes.body);
            process.exit(1);
        }
        const pendingItems = getAssignmentsRes.body.items || [];
        const found = pendingItems.find(item => item.assignment_id === assignmentId);
        if (!found) {
            console.error(`Verification Failed: Assignment #${assignmentId} not found in pending assignments list!`);
            process.exit(1);
        }
        console.log('Success: Found new assignment in admin pending list.');

        // 7. Perform reassignment to broker 27 (Broker B)
        console.log(`Reassigning assignment #${assignmentId} to broker 27 (Broker B)...`);
        const assignRes = await makeRequest({
            hostname: 'localhost',
            port: 5050,
            path: `/api/admin/broker-assignments/${assignmentId}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${adminToken}`
            }
        }, {
            assignedBrokerId: 27
        });

        if (assignRes.statusCode !== 200) {
            console.error('Admin broker assignment failed:', assignRes.body);
            process.exit(1);
        }
        console.log('Success: Reassign API responded with 200 ok:', assignRes.body.message);

        // 8. Verify the updated broker and status in the DB
        const [updatedDbRows] = await db.query("SELECT * FROM staff_assignments WHERE assignment_id = ?", [assignmentId]);
        console.log('Updated assignment in DB:', updatedDbRows[0]);
        if (updatedDbRows[0].sale_broker_id !== 27) {
            console.error(`Verification Failed: DB has sale_broker_id = ${updatedDbRows[0].sale_broker_id} but expected 27.`);
            process.exit(1);
        }
        if (updatedDbRows[0].status !== 'đang xử lý') {
            console.error(`Verification Failed: DB status = '${updatedDbRows[0].status}' but expected 'đang xử lý'.`);
            process.exit(1);
        }
        console.log('Success: DB has updated broker and status.');

        // 9. Log in as Broker B (broker2@test.com)
        console.log('Logging in as Broker B...');
        const brokerLoginRes = await makeRequest({
            hostname: 'localhost',
            port: 5050,
            path: '/api/auth/login',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, {
            email: 'broker2@test.com',
            password: '123456'
        });

        if (brokerLoginRes.statusCode !== 200) {
            console.error('Broker login failed:', brokerLoginRes.body);
            process.exit(1);
        }
        const brokerToken = brokerLoginRes.body.token;
        console.log('Broker B logged in successfully.');

        // 10. Fetch broker B assignments and verify assignment is shown
        console.log('Fetching Broker B assignments...');
        const getBrokerAssignmentsRes = await makeRequest({
            hostname: 'localhost',
            port: 5050,
            path: '/api/broker/assignments',
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${brokerToken}`
            }
        });

        if (getBrokerAssignmentsRes.statusCode !== 200) {
            console.error('Failed to get assignments as Broker B:', getBrokerAssignmentsRes.body);
            process.exit(1);
        }
        const brokerAssignments = getBrokerAssignmentsRes.body.items || [];
        const brokerFound = brokerAssignments.find(item => item.assignment_id === assignmentId);
        if (!brokerFound) {
            console.error(`Verification Failed: Assignment #${assignmentId} not found in Broker B dashboard! Response was:`, getBrokerAssignmentsRes.body);
            process.exit(1);
        }
        console.log('Success: Found assignment in Broker B dashboard.');

        // 11. Test 24-hour edit lock restriction
        console.log('Testing 24-hour edit lock restriction...');
        const pastDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
        await db.query("UPDATE staff_assignments SET assigned_at = ? WHERE assignment_id = ?", [pastDate, assignmentId]);
        console.log('Updated assigned_at to 25 hours ago in DB.');

        console.log(`Attempting to reassign expired assignment #${assignmentId} to broker 27 (should fail)...`);
        const failedAssignRes = await makeRequest({
            hostname: 'localhost',
            port: 5050,
            path: `/api/admin/broker-assignments/${assignmentId}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${adminToken}`
            }
        }, {
            assignedBrokerId: 27
        });

        if (failedAssignRes.statusCode !== 400) {
            console.error(`Verification Failed: Expected status code 400, but got ${failedAssignRes.statusCode}`);
            process.exit(1);
        }
        if (!failedAssignRes.body || failedAssignRes.body.message !== 'Không thể thay đổi phân công môi giới sau 24 giờ kể từ thời điểm gửi yêu cầu.') {
            console.error(`Verification Failed: Unexpected error message:`, failedAssignRes.body);
            process.exit(1);
        }
        console.log('Success: Reassigning expired assignment correctly returned 400 with expected error message.');

        // Cleanup test assignment
        await db.query("DELETE FROM staff_assignments WHERE assignment_id = ?", [assignmentId]);
        console.log('Test assignment cleaned up.');
        console.log('--- ALL VERIFICATION TESTS PASSED SUCCESSFULLY! ---');
        process.exit(0);
    } catch (e) {
        console.error('Verification failed due to error:', e);
        process.exit(1);
    }
}

test();
