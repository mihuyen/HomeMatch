// Backend/routes/saved.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// Middleware xác thực (giống /api/auth/me) để biết ai đang thao tác
const authenticate = async (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ message: 'Chưa đăng nhập' });

    try {
        const [users] = await db.query('SELECT user_id FROM users WHERE token = ? AND token_expires_at > NOW()', [token]);
        if (users.length === 0) return res.status(401).json({ message: 'Token không hợp lệ hoặc đã hết hạn' });

        req.userId = users[0].user_id; // Lưu user_id vào request để dùng ở hàm sau
        next();
    } catch (err) {
        res.status(500).json({ message: 'Lỗi máy chủ' });
    }
};

// GET: Lấy danh sách listing_id mà user này đã lưu
router.get('/', authenticate, async (req, res) => {
    try {
        const [rows] = await db.query('SELECT listing_id FROM saved_listings WHERE user_id = ?', [req.userId]);
        // Trả về một mảng chứa toàn ID: [101, 103, ...]
        const savedIds = rows.map(row => row.listing_id);
        res.json(savedIds);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
});

// POST: Bấm nút lưu (Thêm mới hoặc Xóa nếu đã lưu)
router.post('/:listingId', authenticate, async (req, res) => {
    const listingId = req.params.listingId;
    const userId = req.userId;

    try {
        // Kiểm tra xem đã lưu chưa
        const [existing] = await db.query('SELECT id FROM saved_listings WHERE user_id = ? AND listing_id = ?', [userId, listingId]);

        if (existing.length > 0) {
            // Nếu đã lưu -> Thực hiện xóa (Bỏ tim)
            await db.query('DELETE FROM saved_listings WHERE id = ?', [existing[0].id]);
            res.json({ message: 'Đã bỏ lưu tin', isSaved: false });
        } else {
            // Nếu chưa lưu -> Thêm vào DB (Thả tim)
            await db.query('INSERT INTO saved_listings (user_id, listing_id) VALUES (?, ?)', [userId, listingId]);
            res.json({ message: 'Đã lưu tin', isSaved: true });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
});

module.exports = router;