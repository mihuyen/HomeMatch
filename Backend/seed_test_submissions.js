const db = require('./db');
const bcrypt = require('bcryptjs');

async function seedTestData() {
    try {
        console.log('--- Khởi động script tạo dữ liệu thử nghiệm (Data Test) ---');

        const passwordHash = await bcrypt.hash('123456', 10);

        // 1. Tạo các môi giới / sale agents nếu chưa có
        const salesStaff = [
            { name: 'Trần Anh Tuấn', email: 'tuan.tran@homematch.com', phone: '0912345678' },
            { name: 'Nguyễn Minh Hoàng', email: 'hoang.nguyen@homematch.com', phone: '0987654321' },
            { name: 'Phạm Thanh Thảo', email: 'thao.pham@homematch.com', phone: '0901234567' },
            { name: 'Lý Gia Hân', email: 'han.ly@homematch.com', phone: '0933334444' }
        ];

        const saleIds = [];
        for (const staff of salesStaff) {
            const [existing] = await db.query('SELECT user_id FROM users WHERE email = ?', [staff.email]);
            if (existing.length > 0) {
                console.log(`Môi giới ${staff.name} đã tồn tại.`);
                saleIds.push(existing[0].user_id);
            } else {
                const [result] = await db.query(
                    `INSERT INTO users (full_name, email, phone, id_card, password_hash, role)
                     VALUES (?, ?, ?, ?, ?, 'sale')`,
                    [staff.name, staff.email, staff.phone, '123456789099', passwordHash]
                );
                console.log(`✅ Đã tạo môi giới: ${staff.name}`);
                saleIds.push(result.insertId);
            }
        }

        // 2. Tạo một số chủ sở hữu (owners)
        const owners = [
            { name: 'Lê Hoài Nam', email: 'nam.le@gmail.com', phone: '0944455566' },
            { name: 'Trần Thị Mai', email: 'mai.tran@gmail.com', phone: '0966677788' }
        ];

        const ownerIds = [];
        for (const owner of owners) {
            const [existing] = await db.query('SELECT user_id FROM users WHERE email = ?', [owner.email]);
            if (existing.length > 0) {
                ownerIds.push(existing[0].user_id);
            } else {
                const [result] = await db.query(
                    `INSERT INTO users (full_name, email, phone, id_card, password_hash, role)
                     VALUES (?, ?, ?, ?, ?, 'owner')`,
                    [owner.name, owner.email, owner.phone, '987654321012', passwordHash]
                );
                console.log(`✅ Đã tạo chủ nhà: ${owner.name}`);
                ownerIds.push(result.insertId);
            }
        }

        const primaryOwnerId = ownerIds[0] || 1;

        // 3. Tạo các bất động sản ký gửi thử nghiệm trùng khớp với ảnh mockup
        const testSubmissions = [
            {
                submission_id: 8421,
                property_type: 'Căn hộ chung cư',
                area: 85,
                direction: 'Đông Nam',
                num_bedrooms: 2,
                num_bathrooms: 2,
                address: 'Căn hộ Vinhome Grand Park, P. Long Thạnh Mỹ, Thủ Đức, TP. HCM',
                proposed_price: 12000000,
                status: 'pending',
                assigned_sales_id: null // Chờ phân công
            },
            {
                submission_id: 8422,
                property_type: 'Nhà phố',
                area: 120,
                direction: 'Nam',
                num_bedrooms: 3,
                num_bathrooms: 3,
                address: 'Nhà phố KĐT Sala, P. An Lợi Đông, Quận 2, TP. HCM',
                proposed_price: 35000000,
                status: 'assigned',
                assigned_sales_id: saleIds[1] // Nguyễn Minh Hoàng
            },
            {
                submission_id: 8425,
                property_type: 'Căn hộ chung cư',
                area: 76,
                direction: 'Tây Nam',
                num_bedrooms: 2,
                num_bathrooms: 1,
                address: 'Căn hộ Sun Avenue, 28 Mai Chí Thọ, Quận 2, TP. HCM',
                proposed_price: 16000000,
                status: 'pending',
                assigned_sales_id: null // Chờ phân công
            },
            {
                submission_id: 8430,
                property_type: 'Biệt thự',
                area: 250,
                direction: 'Đông',
                num_bedrooms: 4,
                num_bathrooms: 4,
                address: 'Biệt thự Chateau, P. Tân Phong, Quận 7, TP. HCM',
                proposed_price: 85000000,
                status: 'pending',
                assigned_sales_id: null // Chờ phân công
            }
        ];

        for (const sub of testSubmissions) {
            const [existing] = await db.query('SELECT submission_id FROM property_submissions WHERE submission_id = ?', [sub.submission_id]);
            if (existing.length > 0) {
                console.log(`Hồ sơ #${sub.submission_id} đã tồn tại, tiến hành cập nhật trạng thái...`);
                await db.query(
                    `UPDATE property_submissions 
                     SET status = ?, assigned_sales_id = ? 
                     WHERE submission_id = ?`,
                    [sub.status, sub.assigned_sales_id, sub.submission_id]
                );
            } else {
                await db.query(
                    `INSERT INTO property_submissions 
                        (submission_id, owner_id, property_type, area, direction, num_bedrooms, num_bathrooms, address, proposed_price, images_uploaded, status, assigned_sales_id)
                     VALUES 
                        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        sub.submission_id,
                        primaryOwnerId,
                        sub.property_type,
                        sub.area,
                        sub.direction,
                        sub.num_bedrooms,
                        sub.num_bathrooms,
                        sub.address,
                        sub.proposed_price,
                        JSON.stringify(['https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&q=80&w=600']),
                        sub.status,
                        sub.assigned_sales_id
                    ]
                );
                console.log(`✅ Đã tạo hồ sơ ký gửi #${sub.submission_id} - ${sub.address}`);
            }
        }

        console.log('--- Hoàn tất script tạo dữ liệu thử nghiệm thành công! ---');
        process.exit(0);
    } catch (error) {
        console.error('Lỗi khi chạy script seed test:', error);
        process.exit(1);
    }
}

seedTestData();
