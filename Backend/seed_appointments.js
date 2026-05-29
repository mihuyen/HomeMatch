const db = require('./db');

async function seed() {
    try {
        console.log('--- Khởi động script tạo dữ liệu lịch hẹn thử nghiệm ---');
        
        // 1. Lấy tất cả submissions
        const [submissions] = await db.query('SELECT submission_id, address, assigned_sales_id, status FROM property_submissions');
        
        if (submissions.length === 0) {
            console.log('Không tìm thấy hồ sơ ký gửi nào trong database! Vui lòng tạo một hồ sơ trước.');
            process.exit(0);
        }

        console.log(`Đã tìm thấy ${submissions.length} hồ sơ ký gửi trong hệ thống.`);

        // 2. Tạo lịch hẹn khảo sát cho từng hồ sơ chưa có lịch hẹn
        for (const sub of submissions) {
            const [existingAppts] = await db.query(
                'SELECT appointment_id FROM appointments WHERE submission_id = ? AND appointment_type = "khảo sát"',
                [sub.submission_id]
            );

            if (existingAppts.length > 0) {
                console.log(`Hồ sơ #${sub.submission_id} đã có sẵn lịch hẹn khảo sát.`);
                continue;
            }

            // Gán sales nếu chưa có
            let salesId = sub.assigned_sales_id;
            if (!salesId) {
                const [salesUsers] = await db.query('SELECT user_id FROM users WHERE role IN ("sale", "agent") LIMIT 1');
                if (salesUsers.length > 0) {
                    salesId = salesUsers[0].user_id;
                    await db.query('UPDATE property_submissions SET assigned_sales_id = ? WHERE submission_id = ?', [salesId, sub.submission_id]);
                    console.log(`Đã tự động gán Môi giới #${salesId} cho hồ sơ #${sub.submission_id}`);
                }
            }

            // Tạo thời gian hẹn ngẫu nhiên (ví dụ ngày mai lúc 14:00)
            const scheduledTime = new Date();
            scheduledTime.setDate(scheduledTime.getDate() + 2); // 2 ngày tới
            scheduledTime.setHours(14, 0, 0, 0); // lúc 14:00

            const location = sub.address || 'Vinhomes Central Park, Park 7, Tầng 22, Căn 08, 720A Điện Biên Phủ, Phường 22, Quận Bình Thạnh, TP.HCM';

            // Insert vào bảng appointments
            const [insertResult] = await db.query(
                `INSERT INTO appointments 
                    (assignment_id, submission_id, appointment_type, scheduled_time, location, status, result_note) 
                 VALUES 
                    (NULL, ?, "khảo sát", ?, ?, "Đã đặt", "Lịch khảo sát thực địa được sale lên lịch")`,
                [sub.submission_id, scheduledTime, location]
            );

            console.log(`✅ Đã tạo thành công Lịch hẹn khảo sát SA-${insertResult.insertId} cho hồ sơ #${sub.submission_id} lúc ${scheduledTime.toLocaleString('vi-VN')}`);
        }

        console.log('--- Hoàn tất tạo dữ liệu lịch hẹn thử nghiệm! ---');
        process.exit(0);
    } catch (err) {
        console.error('Lỗi khi chạy script seed:', err);
        process.exit(1);
    }
}

seed();
