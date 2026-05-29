const db = require('./db');

async function migrate() {
    try {
        console.log('--- Khởi động script cấu hình mở rộng dung lượng cột ảnh ---');
        
        // Cập nhật kiểu dữ liệu cột images_uploaded thành LONGTEXT
        console.log('Đang thay đổi kiểu dữ liệu cột "images_uploaded" trong bảng "property_submissions" thành LONGTEXT...');
        await db.query('ALTER TABLE property_submissions MODIFY COLUMN images_uploaded LONGTEXT');
        console.log('✅ Đã thay đổi thành công cột "images_uploaded" thành LONGTEXT!');
        
        // Kiểm tra xem có bảng survey_records hay các bảng khác lưu ảnh không để nâng cấp luôn tránh lỗi tương tự
        console.log('Kiểm tra bảng "survey_records" và "submission_contracts"...');
        try {
            await db.query('ALTER TABLE survey_records MODIFY COLUMN image_checklist LONGTEXT');
            console.log('✅ Đã thay đổi thành công cột "image_checklist" trong bảng "survey_records" thành LONGTEXT!');
        } catch (e) {
            console.log('Bảng survey_records hoặc cột image_checklist không tồn tại, bỏ qua.');
        }

        try {
            await db.query('ALTER TABLE submission_contracts MODIFY COLUMN signed_scan_url LONGTEXT');
            console.log('✅ Đã thay đổi thành công cột "signed_scan_url" trong bảng "submission_contracts" thành LONGTEXT!');
        } catch (e) {
            console.log('Bảng submission_contracts hoặc cột signed_scan_url không tồn tại, bỏ qua.');
        }
        
        console.log('--- Hoàn tất quá trình nâng cấp cơ sở dữ liệu! ---');
        process.exit(0);
    } catch (err) {
        console.error('Lỗi khi nâng cấp cơ sở dữ liệu:', err);
        process.exit(1);
    }
}

migrate();
