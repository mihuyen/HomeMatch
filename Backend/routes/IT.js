const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const router = express.Router();

// Middleware kiểm tra quyền IT
const authenticateAdmin = async (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ message: 'Chưa đăng nhập' });
    try {
        const [users] = await db.query('SELECT user_id, role FROM users WHERE token = ?', [token]);
        if (users.length === 0) return res.status(401).json({ message: 'Token không hợp lệ' });

        // Tạm tắt kiểm tra role IT để bạn dễ test, khi nào code xong giao diện thì mở dòng dưới ra:
        // if (users[0].role !== 'it') return res.status(403).json({ message: 'Không có quyền truy cập' });

        req.user = users[0];
        next();
    } catch (err) {
        res.status(500).json({ message: 'Lỗi xác thực' });
    }
};

// ==========================================
// ĐÂY LÀ ROUTE ĐANG BỊ BÁO LỖI 404 NẾU THIẾU
// Lấy danh sách tất cả người dùng
// ==========================================
router.get('/users', authenticateAdmin, async (req, res) => {
    try {
        const [rows] = await db.query('SELECT user_id, full_name, email, phone, role, id_card FROM users ORDER BY user_id DESC');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ message: 'Lỗi khi lấy danh sách user' });
    }
});

// Thêm mới người dùng
router.post('/users', authenticateAdmin, async (req, res) => {
    const { full_name, email, phone, role, id_card, password } = req.body;
    if (!full_name || !email || !role || !password) {
        return res.status(400).json({ message: 'Vui lòng nhập đủ thông tin bắt buộc' });
    }
    try {
        const [existing] = await db.query('SELECT user_id FROM users WHERE email = ?', [email]);
        if (existing.length > 0) return res.status(409).json({ message: 'Email đã tồn tại' });

        const password_hash = await bcrypt.hash(password, 10);
        await db.query(
            'INSERT INTO users (full_name, email, phone, role, id_card, password_hash) VALUES (?, ?, ?, ?, ?, ?)',
            [full_name, email, phone || null, role, id_card || null, password_hash]
        );
        res.status(201).json({ message: 'Thêm mới thành công' });
    } catch (err) {
        res.status(500).json({ message: 'Lỗi khi thêm user' });
    }
});

// Cập nhật người dùng
router.put('/users/:id', authenticateAdmin, async (req, res) => {
    const { full_name, phone, role, id_card } = req.body;
    try {
        await db.query(
            'UPDATE users SET full_name = ?, phone = ?, role = ?, id_card = ? WHERE user_id = ?',
            [full_name, phone || null, role, id_card || null, req.params.id]
        );
        res.json({ message: 'Cập nhật thành công' });
    } catch (err) {
        res.status(500).json({ message: 'Lỗi khi cập nhật user' });
    }
});

// Xóa người dùng
router.delete('/users/:id', authenticateAdmin, async (req, res) => {
    try {
        await db.query('DELETE FROM users WHERE user_id = ?', [req.params.id]);
        res.json({ message: 'Xóa thành công' });
    } catch (err) {
        res.status(500).json({ message: 'Lỗi khi xóa user (có thể do ràng buộc dữ liệu)' });
    }
});

// ===============================================
// API CHO TAB "YÊU CẦU KÝ GỬI"
// ===============================================
router.get('/submissions', async (req, res) => {
    try {
        const query = `
            SELECT ps.*, u.full_name as owner_name 
            FROM property_submissions ps 
            LEFT JOIN users u ON ps.owner_id = u.user_id 
            ORDER BY ps.submitted_at DESC
        `;
        const [rows] = await db.query(query);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ message: 'Lỗi server' });
    }
});

// ===============================================
// API CHO TAB "QUẢN LÝ TIN ĐĂNG"
// ===============================================

// 1. Lấy tất cả tin đăng (cả active và inactive)
router.get('/listings', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM property_listings ORDER BY activated_at DESC');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ message: 'Lỗi server' });
    }
});

// 2. Tạo tin đăng mới (Từ Modal Xác nhận đăng tin)
router.post('/listings', async (req, res) => {
    try {
        const { submission_id, title, description, price_display, status } = req.body;
        const query = `
            INSERT INTO property_listings (submission_id, title, description, price_display, status, view_count, activated_at) 
            VALUES (?, ?, ?, ?, ?, 0, NOW())
        `;
        await db.query(query, [submission_id, title, description, price_display, status]);

        // Có thể bổ sung: Đổi trạng thái submission thành 'approved'
        await db.query(`UPDATE property_submissions SET status = 'approved' WHERE submission_id = ?`, [submission_id]);

        res.status(201).json({ message: 'Đăng tin thành công' });
    } catch (err) {
        res.status(500).json({ message: 'Lỗi server' });
    }
});

// 3. Ẩn / Hiện tin đăng (Đổi status)
router.patch('/listings/:id/status', async (req, res) => {
    try {
        const listingId = req.params.id;
        const { status } = req.body; // 'active' hoặc 'inactive'
        await db.query(`UPDATE property_listings SET status = ? WHERE listing_id = ?`, [status, listingId]);
        res.json({ message: 'Cập nhật trạng thái thành công' });
    } catch (err) {
        res.status(500).json({ message: 'Lỗi server' });
    }
});

// 4. Xóa tin đăng
router.delete('/listings/:id', async (req, res) => {
    try {
        const listingId = req.params.id;
        await db.query(`DELETE FROM property_listings WHERE listing_id = ?`, [listingId]);
        res.json({ message: 'Đã xóa tin đăng' });
    } catch (err) {
        res.status(500).json({ message: 'Lỗi server' });
    }
});
// 5. Cập nhật nội dung tin đăng (Sửa tin)
router.put('/listings/:id', async (req, res) => {
    try {
        const listingId = req.params.id;
        const { title, description, price_display } = req.body;

        const query = `
            UPDATE property_listings 
            SET title = ?, description = ?, price_display = ? 
            WHERE listing_id = ?
        `;
        await db.query(query, [title, description, price_display, listingId]);

        res.json({ message: 'Cập nhật tin đăng thành công' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server khi cập nhật tin đăng' });
    }
});

module.exports = router;