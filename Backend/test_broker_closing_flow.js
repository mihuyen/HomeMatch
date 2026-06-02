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

function getRequest(url, headers) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const options = {
            hostname: u.hostname,
            port: u.port,
            path: u.pathname + (u.search || ''),
            method: 'GET',
            headers
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
        req.end();
    });
}

async function runTest() {
    console.log('=== STARTING INTEGRATION TEST FOR BROKER CLOSING FLOW ===');

    let brokerId, tenantId, accountantId;
    let assignmentId, appointmentId, rentalContractId, listingId;
    let brokerToken = 'test-token-broker-flow';
    let accountantToken = 'test-token-accountant-flow';

    try {
        // 1. Get or create Broker user
        console.log('1. Checking Broker user...');
        const [brokers] = await db.query("SELECT user_id FROM users WHERE role = 'broker' LIMIT 1");
        if (brokers.length === 0) {
            throw new Error('No broker user found. Please run seed script first.');
        }
        brokerId = brokers[0].user_id;
        console.log(`Found Broker ID: ${brokerId}`);

        // Update broker token
        await db.query("UPDATE users SET token = ?, token_expires_at = DATE_ADD(NOW(), INTERVAL 1 DAY) WHERE user_id = ?", [brokerToken, brokerId]);

        // 2. Get or create Tenant user
        console.log('2. Checking Tenant user...');
        const [tenants] = await db.query("SELECT user_id FROM users WHERE role = 'tenant' LIMIT 1");
        if (tenants.length === 0) {
            throw new Error('No tenant user found.');
        }
        tenantId = tenants[0].user_id;
        console.log(`Found Tenant ID: ${tenantId}`);

        // 3. Get or create Accountant user
        console.log('3. Checking Accountant user...');
        const [accountants] = await db.query("SELECT user_id FROM users WHERE role = 'accountant' LIMIT 1");
        if (accountants.length === 0) {
            throw new Error('No accountant user found.');
        }
        accountantId = accountants[0].user_id;
        console.log(`Found Accountant ID: ${accountantId}`);

        // Update accountant token
        await db.query("UPDATE users SET token = ?, token_expires_at = DATE_ADD(NOW(), INTERVAL 1 DAY) WHERE user_id = ?", [accountantToken, accountantId]);

        // 4. Find valid Listing ID
        const [listings] = await db.query("SELECT listing_id FROM property_listings WHERE status = 'available' LIMIT 1");
        if (listings.length === 0) {
            const [anyListings] = await db.query("SELECT listing_id FROM property_listings LIMIT 1");
            if (anyListings.length === 0) {
                throw new Error('No listing found. Please seed listing.');
            }
            listingId = anyListings[0].listing_id;
        } else {
            listingId = listings[0].listing_id;
        }
        console.log(`Using Listing ID: ${listingId}`);

        // 5. Create test Staff Assignment
        console.log('5. Creating test Staff Assignment...');
        const [assignResult] = await db.query(
            `INSERT INTO staff_assignments (tenant_id, sale_broker_id, status, notes)
             VALUES (?, ?, 'chờ xử lý', 'Integration test assignment')`,
            [tenantId, brokerId]
        );
        assignmentId = assignResult.insertId;
        console.log(`Created Assignment ID: ${assignmentId}`);

        // 6. Create test Appointment linked to the assignment
        console.log('6. Creating test Appointment...');
        const [aptResult] = await db.query(
            `INSERT INTO appointments (assignment_id, appointment_type, scheduled_time, location, status)
             VALUES (?, 'xem nhà', DATE_ADD(NOW(), INTERVAL 1 DAY), 'Test Apartment Location', 'scheduled')`,
            [assignmentId]
        );
        appointmentId = aptResult.insertId;
        console.log(`Created Appointment ID: ${appointmentId}`);

        // 7. Broker submits contract
        console.log('7. Broker submitting contract...');
        const submitRes = await postRequest(`${BASE_URL}/broker/contracts`, {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${brokerToken}`
        }, {
            assignmentId,
            tenantId,
            agreedPrice: 150000000,
            leaseTermMonths: 12,
            listingId,
            appointmentId,
            resultNote: 'Giao dịch thành công, khách đồng ý ký hợp đồng.',
            contractScanUrl: '/uploads/contracts/scan-original.pdf'
        });

        const submitData = await submitRes.json();
        console.log('Broker Submit Contract Response status:', submitRes.status);
        console.log('Broker Submit Contract Response body:', submitData);

        if (submitRes.status !== 201) {
            throw new Error(`Submit contract failed. Status: ${submitRes.status}`);
        }
        rentalContractId = submitData.rental_contract_id;
        console.log(`Submitted Contract ID: ${rentalContractId}`);

        // Verify status is 'Chờ kiểm duyệt' and assignment is 'đang hoàn thiện'
        const [c1] = await db.query("SELECT status FROM RENTAL_CONTRACTS WHERE rental_contract_id = ?", [rentalContractId]);
        const [a1] = await db.query("SELECT status FROM staff_assignments WHERE assignment_id = ?", [assignmentId]);
        console.log(`Contract status after submit: '${c1[0].status}' (Expected: 'Chờ kiểm duyệt')`);
        console.log(`Assignment status after submit: '${a1[0].status}' (Expected: 'đang hoàn thiện')`);
        if (c1[0].status !== 'Chờ kiểm duyệt' || a1[0].status !== 'đang hoàn thiện') {
            throw new Error('Initial contract/assignment status verify failed.');
        }

        // 8. Accountant rejects contract
        console.log('8. Accountant rejecting contract with reason...');
        const rejectRes = await postRequest(`${BASE_URL}/accountant/contracts/approve`, {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accountantToken}`
        }, {
            rental_contract_id: rentalContractId,
            status: 'từ chối',
            approved_price: 150000000,
            rejection_reason: 'Scan bị mờ, vui lòng upload bản rõ hơn.',
            reviewer_notes: 'Cần xem lại hình ảnh scan.'
        });

        const rejectData = await rejectRes.json();
        console.log('Accountant Reject Response status:', rejectRes.status);
        console.log('Accountant Reject Response body:', rejectData);

        if (rejectRes.status !== 200) {
            throw new Error(`Reject contract failed. Status: ${rejectRes.status}`);
        }

        // Verify status is 'Yêu cầu kiểm tra lại' and assignment status is 'yêu cầu kiểm tra lại'
        const [c2] = await db.query("SELECT status FROM RENTAL_CONTRACTS WHERE rental_contract_id = ?", [rentalContractId]);
        const [a2] = await db.query("SELECT status FROM staff_assignments WHERE assignment_id = ?", [assignmentId]);
        console.log(`Contract status after reject: '${c2[0].status}' (Expected: 'Yêu cầu kiểm tra lại')`);
        console.log(`Assignment status after reject: '${a2[0].status}' (Expected: 'yêu cầu kiểm tra lại')`);
        if (c2[0].status !== 'Yêu cầu kiểm tra lại' || a2[0].status !== 'yêu cầu kiểm tra lại') {
            throw new Error('Rejected contract/assignment status verify failed.');
        }

        // 9. Broker GET assignments contract details (check pre-fill data & rejection reason)
        console.log('9. Broker fetching contract for pre-fill check...');
        const getRes = await getRequest(`${BASE_URL}/broker/assignments/${assignmentId}/contract`, {
            'Authorization': `Bearer ${brokerToken}`
        });

        const getData = await getRes.json();
        console.log('Broker Get Contract Response status:', getRes.status);
        console.log('Broker Get Contract Response body:', getData);

        if (getRes.status !== 200) {
            throw new Error(`Get contract details failed. Status: ${getRes.status}`);
        }
        if (!getData.contract || getData.contract.rejection_reason !== 'Scan bị mờ, vui lòng upload bản rõ hơn.') {
            throw new Error(`Pre-fill check failed. Missing rejection reason or contract details. Got: ${JSON.stringify(getData)}`);
        }

        // 10. Broker resubmits contract (re-submitting updates the existing record)
        console.log('10. Broker resubmitting corrected contract...');
        const resubmitRes = await postRequest(`${BASE_URL}/broker/contracts`, {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${brokerToken}`
        }, {
            assignmentId,
            tenantId,
            agreedPrice: 160000000,
            leaseTermMonths: 12,
            listingId,
            appointmentId,
            resultNote: 'Giao dịch thành công, đã upload bản scan rõ nét.',
            contractScanUrl: '/uploads/contracts/scan-new.pdf'
        });

        const resubmitData = await resubmitRes.json();
        console.log('Broker Resubmit Contract Response status:', resubmitRes.status);
        console.log('Broker Resubmit Contract Response body:', resubmitData);

        if (resubmitRes.status !== 201) {
            throw new Error(`Resubmit contract failed. Status: ${resubmitRes.status}`);
        }
        if (resubmitData.rental_contract_id !== rentalContractId) {
            throw new Error(`Resubmission created a new record! Expected ID: ${rentalContractId}, got ID: ${resubmitData.rental_contract_id}`);
        }

        // Verify status back to 'Chờ kiểm duyệt' and assignment status to 'đang hoàn thiện'
        const [c3] = await db.query("SELECT status, agreed_price, contract_scan_url FROM RENTAL_CONTRACTS WHERE rental_contract_id = ?", [rentalContractId]);
        const [a3] = await db.query("SELECT status FROM staff_assignments WHERE assignment_id = ?", [assignmentId]);
        console.log(`Contract status after resubmit: '${c3[0].status}' (Expected: 'Chờ kiểm duyệt')`);
        console.log(`Contract price after resubmit: ${Number(c3[0].agreed_price)} (Expected: 160000000)`);
        console.log(`Contract scan URL after resubmit: '${c3[0].contract_scan_url}' (Expected: '/uploads/contracts/scan-new.pdf')`);
        console.log(`Assignment status after resubmit: '${a3[0].status}' (Expected: 'đang hoàn thiện')`);
        if (c3[0].status !== 'Chờ kiểm duyệt' || Number(c3[0].agreed_price) !== 160000000 || c3[0].contract_scan_url !== '/uploads/contracts/scan-new.pdf' || a3[0].status !== 'đang hoàn thiện') {
            throw new Error('Resubmitted contract/assignment status verify failed.');
        }

        // 11. Accountant approves contract
        console.log('11. Accountant approving contract...');
        const approveRes = await postRequest(`${BASE_URL}/accountant/contracts/approve`, {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accountantToken}`
        }, {
            rental_contract_id: rentalContractId,
            status: 'duyệt',
            approved_price: 160000000,
            reviewer_notes: 'Hợp đồng hoàn tất, bản scan rõ nét.'
        });

        const approveData = await approveRes.json();
        console.log('Accountant Approve Response status:', approveRes.status);
        console.log('Accountant Approve Response body:', approveData);

        if (approveRes.status !== 200) {
            throw new Error(`Approve contract failed. Status: ${approveRes.status}`);
        }

        // Verify contract is 'Đã phê duyệt' and assignment status is 'Đã chốt'
        const [c4] = await db.query("SELECT status FROM RENTAL_CONTRACTS WHERE rental_contract_id = ?", [rentalContractId]);
        const [a4] = await db.query("SELECT status FROM staff_assignments WHERE assignment_id = ?", [assignmentId]);
        console.log(`Contract status after approve: '${c4[0].status}' (Expected: 'Đã phê duyệt')`);
        console.log(`Assignment status after approve: '${a4[0].status}' (Expected: 'Đã chốt')`);
        if (c4[0].status !== 'Đã phê duyệt' || a4[0].status !== 'Đã chốt') {
            throw new Error('Approved contract/assignment status verify failed.');
        }

        // 12. Check commission payment recorded in broker_payments (10% of 160,000,000 = 16,000,000)
        console.log('12. Checking broker commission payment record...');
        const [payments] = await db.query("SELECT amount, status FROM broker_payments WHERE broker_id = ? ORDER BY paid_at DESC LIMIT 1", [brokerId]);
        if (payments.length === 0) {
            throw new Error('No broker payment recorded!');
        }
        const payment = payments[0];
        console.log(`Broker payment amount: ${Number(payment.amount)} (Expected: 16000000)`);
        console.log(`Broker payment status: '${payment.status}' (Expected: 'đã chi trả')`);
        if (Number(payment.amount) !== 16000000 || payment.status !== 'đã chi trả') {
            throw new Error('Broker payment verification failed.');
        }

        console.log('\n=== ALL INTEGRATION TESTS PASSED SUCCESSFULLY! ===\n');

    } catch (e) {
        console.error('\n=== INTEGRATION TEST FAILED! ===');
        console.error(e);
    } finally {
        // Cleanup all records created
        console.log('Cleaning up test records from database...');
        try {
            if (rentalContractId) {
                await db.query("DELETE FROM RENTAL_CONTRACT_APPROVALS WHERE rental_contract_id = ?", [rentalContractId]);
                await db.query("DELETE FROM RENTAL_CONTRACTS WHERE rental_contract_id = ?", [rentalContractId]);
            }
            if (appointmentId) {
                await db.query("DELETE FROM appointments WHERE appointment_id = ?", [appointmentId]);
            }
            if (assignmentId) {
                await db.query("DELETE FROM staff_assignments WHERE assignment_id = ?", [assignmentId]);
            }
            // Delete commission payments matching the exact test pattern
            if (brokerId) {
                await db.query("DELETE FROM broker_payments WHERE broker_id = ? AND amount = 16000000 AND status = 'đã chi trả'", [brokerId]);
            }
            console.log('Cleanup completed successfully.');
        } catch(cleanupErr) {
            console.error('Error during cleanup:', cleanupErr);
        }

        process.exit(0);
    }
}

runTest();
