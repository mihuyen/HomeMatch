const db = require('./db');
const http = require('http');

// Config
const BASE_URL = 'http://localhost:5050/api';

function postRequest(url, headers, body) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const options = {
            hostname: u.hostname,
            port: u.port,
            path: u.pathname,
            method: 'POST',
            headers: {
                ...headers,
                'Content-Length': Buffer.byteLength(JSON.stringify(body))
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve({
                        status: res.statusCode,
                        json: () => Promise.resolve(JSON.parse(data))
                    });
                } catch(e) {
                    resolve({
                        status: res.statusCode,
                        json: () => Promise.resolve({ message: data })
                    });
                }
            });
        });

        req.on('error', (e) => reject(e));
        req.write(JSON.stringify(body));
        req.end();
    });
}

async function runTest() {
    console.log('=== STARTING INTEGRATION TEST FOR BROKER CONTRACT FLOW ===');
    
    try {
        // 1. Get or create Broker user
        console.log('1. Checking Broker user...');
        const [brokers] = await db.query("SELECT user_id FROM users WHERE role = 'broker' LIMIT 1");
        if (brokers.length === 0) {
            throw new Error('No broker user found. Please run seed script first.');
        }
        const brokerId = brokers[0].user_id;
        console.log(`Found Broker ID: ${brokerId}`);

        // 2. Get or create Tenant user
        console.log('2. Checking Tenant user...');
        const [tenants] = await db.query("SELECT user_id FROM users WHERE role = 'tenant' LIMIT 1");
        if (tenants.length === 0) {
            throw new Error('No tenant user found.');
        }
        const tenantId = tenants[0].user_id;
        console.log(`Found Tenant ID: ${tenantId}`);

        // 3. Create a clean Staff Assignment for this test
        console.log('3. Creating test Staff Assignment...');
        const [assignResult] = await db.query(
            `INSERT INTO STAFF_ASSIGNMENTS (tenant_id, sale_broker_id, status, notes)
             VALUES (?, ?, 'đang xử lý', 'Test assignment notes')`,
            [tenantId, brokerId]
        );
        const assignmentId = assignResult.insertId;
        console.log(`Created Assignment ID: ${assignmentId}`);

        // 4. Create an Appointment linked to this assignment
        console.log('4. Creating test Appointment...');
        const [aptResult] = await db.query(
            `INSERT INTO APPOINTMENTS (assignment_id, appointment_type, scheduled_time, location, status)
             VALUES (?, 'xem nhà', DATE_ADD(NOW(), INTERVAL 1 DAY), 'Penthouse Vinhomes Central Park', 'scheduled')`,
            [assignmentId]
        );
        const appointmentId = aptResult.insertId;
        console.log(`Created Appointment ID: ${appointmentId}`);

        // 5. Simulate Broker Contract submission
        console.log('5. Executing contract submission transaction...');
        // To authenticate, let's get the token for Broker Test.
        const [tokenRows] = await db.query("SELECT token FROM users WHERE user_id = ?", [brokerId]);
        let token = tokenRows[0]?.token;
        if (!token) {
            token = 'test-token-broker-123';
            await db.query("UPDATE users SET token = ?, token_expires_at = DATE_ADD(NOW(), INTERVAL 1 DAY) WHERE user_id = ?", [token, brokerId]);
        }
        
        console.log('Firing POST /api/broker/contracts API request...');
        const response = await postRequest(`${BASE_URL}/broker/contracts`, {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        }, {
            assignmentId,
            tenantId,
            agreedPrice: 150000000,
            leaseTermMonths: 12,
            listingId: 1,
            appointmentId,
            resultNote: 'Thương lượng thành công, khách chốt thuê 150tr/tháng.',
            contractScanUrl: '/uploads/contracts/scan-test.pdf'
        });

        const resData = await response.json();
        console.log('API Response status:', response.status);
        console.log('API Response body:', resData);

        if (response.status !== 201) {
            throw new Error(`API returned status ${response.status}: ${resData.message}`);
        }

        const rentalContractId = resData.rental_contract_id;
        console.log(`Created Rental Contract ID: ${rentalContractId}`);

        // 6. Verification
        console.log('6. Verifying database modifications...');

        // Verify appointment status & result note
        const [aptRows] = await db.query("SELECT status, result_note FROM APPOINTMENTS WHERE appointment_id = ?", [appointmentId]);
        const apt = aptRows[0];
        console.log(`Appointment Status: ${apt.status} (Expected: hoàn tất)`);
        console.log(`Appointment Result Note: "${apt.result_note}" (Expected: Thương lượng thành công...)`);
        if (apt.status !== 'hoàn tất' || !apt.result_note.includes('Thương lượng')) {
            throw new Error('Appointment verification failed!');
        }

        // Verify RENTAL_CONTRACTS table
        const [contractRows] = await db.query("SELECT status, agreed_price, lease_term_months, contract_scan_url FROM RENTAL_CONTRACTS WHERE rental_contract_id = ?", [rentalContractId]);
        const contract = contractRows[0];
        console.log(`Rental Contract Status: ${contract.status} (Expected: chờ duyệt)`);
        console.log(`Rental Contract Agreed Price: ${Number(contract.agreed_price)} (Expected: 150000000)`);
        console.log(`Rental Contract Scan URL: ${contract.contract_scan_url} (Expected: /uploads/contracts/scan-test.pdf)`);
        if (contract.status !== 'chờ duyệt' || Number(contract.agreed_price) !== 150000000 || contract.contract_scan_url !== '/uploads/contracts/scan-test.pdf') {
            throw new Error('Rental Contract verification failed!');
        }

        // Verify RENTAL_CONTRACT_APPROVALS table
        const [approvalRows] = await db.query("SELECT status, submitted_by FROM RENTAL_CONTRACT_APPROVALS WHERE rental_contract_id = ?", [rentalContractId]);
        const approval = approvalRows[0];
        console.log(`Approval Status: ${approval.status} (Expected: chờ duyệt)`);
        console.log(`Approval Submitted By: ${approval.submitted_by} (Expected: ${brokerId})`);
        if (approval.status !== 'chờ duyệt' || approval.submitted_by !== brokerId) {
            throw new Error('Approval request verification failed!');
        }

        // Verify STAFF_ASSIGNMENTS status
        const [assignRows] = await db.query("SELECT status FROM STAFF_ASSIGNMENTS WHERE assignment_id = ?", [assignmentId]);
        const assignment = assignRows[0];
        console.log(`Assignment Status: ${assignment.status} (Expected: hoàn tất)`);
        if (assignment.status !== 'hoàn tất') {
            throw new Error('Staff Assignment status verification failed!');
        }

        console.log('=== INTEGRATION TEST PASSED SUCCESSFULLY! ===');
        
        // Clean up test data to keep DB tidy
        console.log('Cleaning up test records...');
        await db.query("DELETE FROM RENTAL_CONTRACT_APPROVALS WHERE rental_contract_id = ?", [rentalContractId]);
        await db.query("DELETE FROM RENTAL_CONTRACTS WHERE rental_contract_id = ?", [rentalContractId]);
        await db.query("DELETE FROM APPOINTMENTS WHERE appointment_id = ?", [appointmentId]);
        await db.query("DELETE FROM STAFF_ASSIGNMENTS WHERE assignment_id = ?", [assignmentId]);
        console.log('Cleanup completed.');

        process.exit(0);

    } catch (e) {
        console.error('=== INTEGRATION TEST FAILED! ===');
        console.error(e.message);
        process.exit(1);
    }
}

runTest();
