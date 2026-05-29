const db = require('./db');
const bcrypt = require('bcryptjs');

async function seed() {
    try {
        // 1. Create Owner User
        const ownerEmail = 'owner@test.com';
        let ownerId = null;

        const [existingOwner] = await db.query('SELECT user_id FROM users WHERE email = ?', [ownerEmail]);
        if (existingOwner.length > 0) {
            ownerId = existingOwner[0].user_id;
            console.log('Owner already exists with ID:', ownerId);
        } else {
            const passwordHash = await bcrypt.hash('123456', 10);
            const [ownerResult] = await db.query(
                `INSERT INTO users (full_name, email, phone, password_hash, role)
                 VALUES (?, ?, ?, ?, ?)`,
                ['Chủ nhà Test', ownerEmail, '0912345678', passwordHash, 'owner']
            );
            ownerId = ownerResult.insertId;
            console.log('Created Owner with ID:', ownerId);
        }

        // 2. Create Property Submission
        const [submissionResult] = await db.query(
            `INSERT INTO PROPERTY_SUBMISSIONS (owner_id, property_type, area, direction, num_bedrooms, num_bathrooms, address, proposed_price, status)
             VALUES (?, 'penthouse', 320.00, 'Đông Nam', 4, 4, 'Penthouse Vinhomes Central Park, Bình Thạnh, TP. Hồ Chí Minh', 45500000000.00, 'approved')`,
            [ownerId]
        );
        const submissionId = submissionResult.insertId;
        console.log('Created Property Submission with ID:', submissionId);

        // 3. Link Property Listing 1 to this Submission
        await db.query(
            `UPDATE PROPERTY_LISTINGS SET submission_id = ? WHERE listing_id = 1`,
            [submissionId]
        );
        console.log('Linked Property Listing 1 to Submission', submissionId);

        // 4. Create Submission Contract
        const [subContractResult] = await db.query(
            `INSERT INTO SUBMISSION_CONTRACTS (submission_id, contract_code, final_price, contract_duration_months, contract_type, status, signed_at)
             VALUES (?, 'HD-SUB-001', 45500000000.00, 12, 'standard', 'signed', NOW())`,
            [submissionId]
        );
        const subContractId = subContractResult.insertId;
        console.log('Created Submission Contract with ID:', subContractId);

        // 5. Create Deposit Transaction of 1,000,000 VND
        const [depositResult] = await db.query(
            `INSERT INTO DEPOSIT_TRANSACTIONS (submission_contract_id, amount, payment_method, status, transaction_code, verified_at)
             VALUES (?, 1000000.00, 'bank_transfer', 'verified', 'DEP-TEST-001', NOW())`,
            [subContractId]
        );
        console.log('Created Deposit Transaction of 1,000,000 VND with ID:', depositResult.insertId);

        console.log('Successfully completed financial seeding!');
        process.exit(0);
    } catch (err) {
        console.error('Financial seeding error:', err);
        process.exit(1);
    }
}
seed();
