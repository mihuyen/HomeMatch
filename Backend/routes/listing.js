// Backend/routes/listings.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

async function pickBrokerId() {
    const [rows] = await db.query(
        `SELECT u.user_id,
                COUNT(sa.assignment_id) AS active_count
         FROM users u
         LEFT JOIN staff_assignments sa
           ON sa.sale_broker_id = u.user_id
          AND sa.status IN ('chờ xử lý', 'đang hoàn thiện')
         WHERE u.role = 'broker'
         GROUP BY u.user_id
         ORDER BY active_count ASC, u.user_id ASC
         LIMIT 1`
    );

    return rows.length ? rows[0].user_id : null;
}


// ==========================================
// API TĂNG LƯỢT XEM (VIEW COUNT)
// ==========================================
router.post('/:id/view', async (req, res) => {
    try {
        const listingId = req.params.id;
        // Lệnh UPDATE: Lấy view_count hiện tại cộng thêm 1. Dùng COALESCE phòng trường hợp NULL.
        const query = `
            UPDATE property_listings 
            SET view_count = COALESCE(view_count, 0) + 1 
            WHERE listing_id = ?
        `;
        const [result] = await db.query(query, [listingId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Không tìm thấy bài đăng' });
        }
        res.json({ message: 'Tăng lượt xem thành công' });
    } catch (err) {
        console.error("Lỗi khi cập nhật lượt xem:", err);
        res.status(500).json({ message: 'Lỗi server' });
    }
});

// POST /api/listings/:listingId/request-view
// Bước 8: Khách thuê gửi yêu cầu xem nhà, tạo phân công môi giới
router.post('/:listingId/request-view', requireAuth, requireRole('tenant'), async (req, res) => {
    try {
        const tenantId = req.user.user_id;
        const listingId = Number(req.params.listingId);
        const { note } = req.body || {};

        if (!Number.isInteger(listingId)) {
            return res.status(400).json({ message: 'listingId không hợp lệ' });
        }

        const [listingRows] = await db.query(
            'SELECT listing_id, title FROM property_listings WHERE listing_id = ? LIMIT 1',
            [listingId]
        );

        if (listingRows.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy bài đăng' });
        }

        const brokerId = await pickBrokerId();
        if (!brokerId) {
            return res.status(409).json({ message: 'Hiện chưa có môi giới phù hợp để phân công' });
        }

    const listingTitle = listingRows[0].title || `Listing #${listingId}`;
    const assignmentNote = note || `Yêu cầu xem nhà: ${listingTitle}`;

        const [result] = await db.query(
            `INSERT INTO staff_assignments (tenant_id, sale_broker_id, status, notes)
             VALUES (?, ?, ?, ?)`,
            [tenantId, brokerId, 'chờ xử lý', assignmentNote]
        );

        res.status(201).json({
            message: 'Đã gửi yêu cầu xem nhà và phân công môi giới',
            assignment_id: result.insertId,
            broker_id: brokerId
        });
    } catch (err) {
        console.error('request view error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// API: Lấy danh sách bất động sản đang hiển thị
router.get('/', async (req, res) => {
    try {
        // 1. CHẠY LỆNH NÀY TRƯỚC ĐỂ TỰ ĐỘNG CHUYỂN TRẠNG THÁI TIN QUÁ HẠN
        await db.query(`
            UPDATE property_listings 
            SET status = 'expired' 
            WHERE status = 'active' AND expired_at < NOW()
        `);

        // 2. LẤY DANH SÁCH (Bao gồm cả tin đang hiển thị và tin vừa hết hạn)
        const query = `
            SELECT
                pl.listing_id, pl.title, pl.description, pl.price_display, 
                pl.activated_at, pl.expired_at, pl.view_count, pl.status, 
                ps.submission_id, ps.owner_id, ps.property_type, ps.area, 
                ps.direction, ps.num_bedrooms, ps.num_bathrooms, ps.address, 
                ps.images_uploaded, ps.proposed_price
            FROM property_listings pl
            JOIN property_submissions ps ON pl.submission_id = ps.submission_id
            WHERE pl.status IN ('active', 'expired')
            ORDER BY pl.activated_at DESC
        `;

        const [rows] = await db.query(query);
        res.json(rows);
    } catch (err) {
        console.error("Lỗi khi lấy danh sách BĐS:", err);
        res.status(500).json({ message: 'Lỗi server khi lấy dữ liệu' });
    }
});
// GET /api/listings/my-appointments
// Lấy danh sách yêu cầu xem nhà và lịch hẹn của Khách thuê
router.get('/my-appointments', requireAuth, async (req, res) => {
    try {
        const tenantId = req.user.user_id;
        const query = `
            SELECT 
                sa.assignment_id, 
                sa.status AS assignment_status, 
                sa.notes AS property_info,
                ap.appointment_id, 
                ap.scheduled_time, 
                ap.location, 
                ap.status AS appointment_status,
                u.full_name AS broker_name, 
                u.phone AS broker_phone
            FROM staff_assignments sa
            LEFT JOIN appointments ap ON sa.assignment_id = ap.assignment_id
            LEFT JOIN users u ON sa.sale_broker_id = u.user_id
            WHERE sa.tenant_id = ?
            ORDER BY sa.assignment_id DESC
        `;
        const [rows] = await db.query(query, [tenantId]);
        res.json(rows);
    } catch (err) {
        console.error("Lỗi lấy lịch hẹn:", err);
        res.status(500).json({ message: 'Lỗi server' });
    }
});
module.exports = router;