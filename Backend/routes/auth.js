const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');

const router = express.Router();

// Hàm tạo token ngẫu nhiên
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Hàm validate email cơ bản
function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ========================================
// MIDDLEWARE: Xác thực Token
// ========================================
const authenticateToken = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) {
            return res.status(401).json({ message: 'Chưa đăng nhập' });
        }

        // Lấy thông tin user (bao gồm cả password_hash để dùng cho đổi mật khẩu)
        const [rows] = await db.query(
            `SELECT user_id, full_name, email, phone, role, created_at, password_hash
             FROM users WHERE token = ? AND token_expires_at > NOW()`,
            [token]
        );

        if (rows.length === 0) {
            return res.status(401).json({ message: 'Token không hợp lệ hoặc đã hết hạn' });
        }

        // Lưu thông tin user vào request để các API phía sau sử dụng
        req.user = rows[0];
        next();
    } catch (err) {
        console.error('Auth middleware error:', err);
        res.status(500).json({ message: 'Lỗi server xác thực: ' + err.message });
    }
};

// ========================================
// POST /api/auth/register - Đăng ký tài khoản
// ========================================
router.post('/register', async (req, res) => {
    try {
        const { full_name, email, phone, id_card, password, role } = req.body;

        // Validation
        if (!full_name || !email || !password || !role) {
            return res.status(400).json({
                message: 'Vui lòng nhập đầy đủ họ tên, email, mật khẩu và vai trò'
            });
        }

        if (!isValidEmail(email)) {
            return res.status(400).json({ message: 'Email không hợp lệ' });
        }

        if (password.length < 6) {
            return res.status(400).json({ message: 'Mật khẩu phải có ít nhất 6 ký tự' });
        }

        const validRoles = ['owner', 'tenant', 'agent', 'broker', 'legal', 'accountant', 'manager', 'it'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({
                message: `Vai trò không hợp lệ. Chọn một trong: ${validRoles.join(', ')}`
            });
        }

        // Kiểm tra email đã tồn tại
        const [existing] = await db.query(
            'SELECT user_id FROM users WHERE email = ?',
            [email]
        );
        if (existing.length > 0) {
            return res.status(409).json({ message: 'Email này đã được đăng ký' });
        }

        // Băm mật khẩu
        const password_hash = await bcrypt.hash(password, 10);

        // Lưu vào DB
        const [result] = await db.query(
            `INSERT INTO users (full_name, email, phone, id_card, password_hash, role)
       VALUES (?, ?, ?, ?, ?, ?)`,
            [full_name, email, phone || null, id_card || null, password_hash, role]
        );

        res.status(201).json({
            message: 'Đăng ký thành công',
            user: {
                user_id: result.insertId,
                full_name,
                email,
                role
            }
        });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// ========================================
// POST /api/auth/login - Đăng nhập
// ========================================
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: 'Vui lòng nhập email và mật khẩu' });
        }

        // Tìm user
        const [rows] = await db.query(
            'SELECT user_id, full_name, email, password_hash, role FROM users WHERE email = ?',
            [email]
        );

        if (rows.length === 0) {
            return res.status(401).json({ message: 'Email hoặc mật khẩu không đúng' });
        }

        const user = rows[0];

        // So khớp mật khẩu
        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) {
            return res.status(401).json({ message: 'Email hoặc mật khẩu không đúng' });
        }

        // Tạo token mới, hết hạn sau 7 ngày
        const token = generateToken();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        await db.query(
            'UPDATE users SET token = ?, token_expires_at = ? WHERE user_id = ?',
            [token, expiresAt, user.user_id]
        );

        res.json({
            message: 'Đăng nhập thành công',
            token,
            user: {
                user_id: user.user_id,
                full_name: user.full_name,
                email: user.email,
                role: user.role
            }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// ========================================
// GET /api/auth/me - Lấy thông tin user hiện tại
// ========================================
router.get('/me', authenticateToken, async (req, res) => {
    // Đã qua middleware authenticateToken nên req.user chắc chắn có dữ liệu
    // Tách bỏ password_hash ra trước khi gửi về frontend để bảo mật
    const { password_hash, ...userInfo } = req.user;
    res.json({ user: userInfo });
});

// ========================================
// PUT /api/auth/update-profile - Cập nhật thông tin cá nhân
// ========================================
router.put('/update-profile', authenticateToken, async (req, res) => {
    const { full_name, phone } = req.body;

    if (!full_name) {
        return res.status(400).json({ message: 'Họ và tên không được để trống' });
    }

    try {
        await db.query(
            'UPDATE users SET full_name = ?, phone = ? WHERE user_id = ?',
            [full_name, phone, req.user.user_id]
        );
        res.json({ message: 'Cập nhật thông tin thành công!' });
    } catch (err) {
        console.error('Update profile error:', err);
        res.status(500).json({ message: 'Lỗi khi lưu dữ liệu cập nhật: ' + err.message });
    }
});

// ========================================
// PUT /api/auth/change-password - Đổi mật khẩu
// ========================================
router.put('/change-password', authenticateToken, async (req, res) => {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
        return res.status(400).json({ message: 'Vui lòng điền đầy đủ mật khẩu cũ và mới' });
    }

    if (new_password.length < 6) {
        return res.status(400).json({ message: 'Mật khẩu mới phải có ít nhất 6 ký tự' });
    }

    try {
        // So khớp mật khẩu hiện tại với mật khẩu trong DB
        const match = await bcrypt.compare(current_password, req.user.password_hash);
        if (!match) {
            return res.status(400).json({ message: 'Mật khẩu hiện tại không chính xác' });
        }

        // Băm mật khẩu mới và lưu
        const password_hash = await bcrypt.hash(new_password, 10);
        await db.query(
            'UPDATE users SET password_hash = ? WHERE user_id = ?',
            [password_hash, req.user.user_id]
        );

        res.json({ message: 'Thay đổi mật khẩu thành công!' });
    } catch (err) {
        console.error('Change password error:', err);
        res.status(500).json({ message: 'Lỗi khi xử lý đổi mật khẩu: ' + err.message });
    }
});

// ========================================
// POST /api/auth/logout - Đăng xuất
// ========================================
router.post('/logout', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');

        if (token) {
            await db.query(
                'UPDATE users SET token = NULL, token_expires_at = NULL WHERE token = ?',
                [token]
            );
        }

        res.json({ message: 'Đăng xuất thành công' });
    } catch (err) {
        console.error('Logout error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

module.exports = router;