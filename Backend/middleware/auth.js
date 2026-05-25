const db = require('../db');

// Middleware kiểm tra đã đăng nhập chưa
async function requireAuth(req, res, next) {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');

        if (!token) {
            return res.status(401).json({ message: 'Vui lòng đăng nhập' });
        }

        const [rows] = await db.query(
            `SELECT user_id, full_name, email, role
       FROM users
       WHERE token = ? AND token_expires_at > NOW()`,
            [token]
        );

        if (rows.length === 0) {
            return res.status(401).json({ message: 'Phiên đăng nhập đã hết hạn' });
        }

        req.user = rows[0];
        next();
    } catch (err) {
        res.status(500).json({ message: 'Lỗi xác thực: ' + err.message });
    }
}

// Middleware kiểm tra vai trò
function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ message: 'Chưa đăng nhập' });
        }
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ message: 'Không có quyền truy cập' });
        }
        next();
    };
}

module.exports = { requireAuth, requireRole };