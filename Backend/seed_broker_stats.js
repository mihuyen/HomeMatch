const db = require('./db');
const bcrypt = require('bcryptjs');

async function seed() {
    try {
        console.log('=== STARTING SEED STATS SCRIPT ===');
        const passwordHash = await bcrypt.hash('123456', 10);

        // 1. Create or get Brokers
        const brokersToCreate = [
            { email: 'broker1@test.com', name: 'Broker A' },
            { email: 'broker2@test.com', name: 'Broker B' },
            { email: 'broker3@test.com', name: 'Broker C' }
        ];
        
        const brokerIds = {};

        for (const b of brokersToCreate) {
            const [rows] = await db.query('SELECT user_id FROM users WHERE email = ?', [b.email]);
            if (rows.length > 0) {
                brokerIds[b.name] = rows[0].user_id;
                console.log(`Found existing ${b.name} with ID:`, brokerIds[b.name]);
            } else {
                const [res] = await db.query(
                    `INSERT INTO users (full_name, email, phone, password_hash, role)
                     VALUES (?, ?, '0900000000', ?, 'broker')`,
                    [b.name, b.email, passwordHash]
                );
                brokerIds[b.name] = res.insertId;
                console.log(`Created ${b.name} with ID:`, brokerIds[b.name]);
            }
        }

        const brokerAId = brokerIds['Broker A'];
        const brokerBId = brokerIds['Broker B'];
        const brokerCId = brokerIds['Broker C'];

        // 2. Create or get Tenants for assignments
        const tenantEmails = [
            'tenant_a@test.com',
            'tenant_b@test.com',
            'tenant_c@test.com',
            'tenant_d@test.com',
            'tenant_e@test.com'
        ];
        const tenantIds = [];

        for (const email of tenantEmails) {
            const [rows] = await db.query('SELECT user_id FROM users WHERE email = ?', [email]);
            if (rows.length > 0) {
                tenantIds.push(rows[0].user_id);
            } else {
                const [res] = await db.query(
                    `INSERT INTO users (full_name, email, phone, password_hash, role)
                     VALUES (?, ?, '0800000000', ?, 'tenant')`,
                    [email.split('@')[0].toUpperCase(), email, passwordHash]
                );
                tenantIds.push(res.insertId);
                console.log(`Created Tenant ${email} with ID:`, res.insertId);
            }
        }

        // 3. Clean up existing records to make it idempotent
        console.log('Cleaning up old assignments, contracts, approvals, and payments...');
        
        await db.query(`DELETE FROM RENTAL_CONTRACT_APPROVALS`);
        await db.query(`DELETE FROM RENTAL_CONTRACTS`);
        await db.query(`DELETE FROM STAFF_ASSIGNMENTS`);
        await db.query(`DELETE FROM BROKER_PAYMENTS`);

        // 4. Seed Broker Payments (growth tracking)
        // Current month: May 2026
        // Previous month: April 2026
        console.log('Seeding Broker A payments...');
        await db.query(
            `INSERT INTO BROKER_PAYMENTS (broker_id, amount, payment_method, status, paid_at)
             VALUES (?, 45000000.00, 'bank_transfer', 'đã chi trả', '2026-05-15 10:00:00')`,
            [brokerAId]
        );
        await db.query(
            `INSERT INTO BROKER_PAYMENTS (broker_id, amount, payment_method, status, paid_at)
             VALUES (?, 39130435.00, 'bank_transfer', 'đã chi trả', '2026-04-15 10:00:00')`,
            [brokerAId]
        );

        // Ensure mock listing with ID 1 exists in PROPERTY_LISTINGS
        const [listingRows] = await db.query('SELECT listing_id FROM property_listings WHERE listing_id = 1');
        if (listingRows.length === 0) {
            await db.query(
                `INSERT INTO property_listings (listing_id, title, status, price_display)
                 VALUES (1, 'Penthouse Vinhomes Central Park', 'active', 45500000000.00)`
            );
            console.log('Created mock listing with ID 1');
        }

        // 5. Seed assignments & approved contracts
        // Targets:
        // Broker A: 20 assignments, 5 approved contracts (25.0% rate)
        // Broker B: 30 assignments, 9 approved contracts (30.0% rate)
        // Broker C: 50 assignments, 13 approved contracts (26.0% rate)
        
        const seedConfig = [
            { brokerId: brokerAId, totalAssignments: 20, approvedContracts: 5 },
            { brokerId: brokerBId, totalAssignments: 30, approvedContracts: 9 },
            { brokerId: brokerCId, totalAssignments: 50, approvedContracts: 13 }
        ];

        for (const config of seedConfig) {
            console.log(`Seeding stats for Broker ID ${config.brokerId}: ${config.totalAssignments} assignments, ${config.approvedContracts} contracts...`);
            
            // Insert assignments
            for (let i = 0; i < config.totalAssignments; i++) {
                const tenantId = tenantIds[i % tenantIds.length];
                const status = i < config.approvedContracts ? 'hoàn tất' : 'đang xử lý';
                const notes = `Yêu cầu xem nhà #${i + 1}`;
                await db.query(
                    `INSERT INTO STAFF_ASSIGNMENTS (tenant_id, sale_broker_id, status, notes, assigned_at)
                     VALUES (?, ?, ?, ?, DATE_SUB(NOW(), INTERVAL ? DAY))`,
                    [tenantId, config.brokerId, status, notes, i]
                );
            }

            // Insert contracts
            for (let i = 0; i < config.approvedContracts; i++) {
                const tenantId = tenantIds[i % tenantIds.length];
                await db.query(
                    `INSERT INTO RENTAL_CONTRACTS (listing_id, tenant_id, broker_id, agreed_price, lease_term_months, status, signed_at)
                     VALUES (1, ?, ?, 15000000.00, 12, 'Đã duyệt', DATE_SUB(NOW(), INTERVAL ? DAY))`,
                    [tenantId, config.brokerId, i]
                );
            }
        }

        console.log('=== DATABASE SEEDING FOR STATS SUCCESSFUL ===');
        process.exit(0);
    } catch (err) {
        console.error('Seeding stats error:', err);
        process.exit(1);
    }
}

seed();
