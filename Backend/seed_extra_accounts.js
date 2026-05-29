const db = require('./db');
const bcrypt = require('bcryptjs');

async function seed() {
    try {
        console.log('--- Khởi chạy script tạo tài khoản Legal và Accountant ---');
        
        // 1. Tạo tài khoản Legal
        const legalEmail = 'legal@homematch.com';
        const legalPass = 'legal123';
        const [existingLegal] = await db.query('SELECT user_id FROM users WHERE email = ?', [legalEmail]);
        
        if (existingLegal.length > 0) {
            console.log(`Tài khoản Legal (${legalEmail}) đã tồn tại.`);
        } else {
            const legalHash = await bcrypt.hash(legalPass, 10);
            await db.query(
                `INSERT INTO users (full_name, email, phone, id_card, password_hash, role)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                ['Bộ Phận Pháp Lý HomeMatch', legalEmail, '0909090908', '123456789013', legalHash, 'legal']
            );
            console.log(`✅ Đã tạo thành công tài khoản Legal!`);
            console.log(`- Email: ${legalEmail}`);
            console.log(`- Mật khẩu: ${legalPass}`);
        }

        // 2. Tạo tài khoản Accountant
        const accEmail = 'accountant@homematch.com';
        const accPass = 'accountant123';
        const [existingAcc] = await db.query('SELECT user_id FROM users WHERE email = ?', [accEmail]);
        
        if (existingAcc.length > 0) {
            console.log(`Tài khoản Accountant (${accEmail}) đã tồn tại.`);
        } else {
            const accHash = await bcrypt.hash(accPass, 10);
            await db.query(
                `INSERT INTO users (full_name, email, phone, id_card, password_hash, role)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                ['Bộ Phận Kế Toán HomeMatch', accEmail, '0909090907', '123456789014', accHash, 'accountant']
            );
            console.log(`✅ Đã tạo thành công tài khoản Accountant!`);
            console.log(`- Email: ${accEmail}`);
            console.log(`- Mật khẩu: ${accPass}`);
        }

        console.log('---------------------------------------------------------');
        process.exit(0);
    } catch (error) {
        console.error('Lỗi khi chạy script seed tài khoản:', error);
        process.exit(1);
    }
}

seed();
