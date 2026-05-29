const db = require('./db');
const bcrypt = require('bcryptjs');

async function seedAdmin() {
    try {
        console.log('--- Khởi chạy script tạo tài khoản Admin thử nghiệm ---');
        
        const email = 'admin@homematch.com';
        const password = 'admin123';
        
        // 1. Kiểm tra tài khoản đã tồn tại chưa
        const [existing] = await db.query('SELECT user_id FROM users WHERE email = ?', [email]);
        
        if (existing.length > 0) {
            console.log(`Tài khoản Admin (${email}) đã tồn tại trong hệ thống.`);
            process.exit(0);
        }

        // 2. Băm mật khẩu bằng bcryptjs
        const passwordHash = await bcrypt.hash(password, 10);

        // 3. Chèn vào database
        await db.query(
            `INSERT INTO users (full_name, email, phone, id_card, password_hash, role)
             VALUES (?, ?, ?, ?, ?, ?)`,
            ['Ban Quản Trị HomeMatch', email, '0909090909', '123456789012', passwordHash, 'admin']
        );

        console.log('----------------------------------------------------');
        console.log('TẠO TÀI KHOẢN ADMIN THÀNH CÔNG!');
        console.log(`Email đăng nhập: ${email}`);
        console.log(`Mật khẩu: ${password}`);
        console.log('----------------------------------------------------');
        process.exit(0);
    } catch (error) {
        console.error('Lỗi khi tạo tài khoản Admin:', error);
        process.exit(1);
    }
}

seedAdmin();
