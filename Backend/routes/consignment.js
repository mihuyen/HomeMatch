const express = require('express');
const db = require('../db');

const router = express.Router();

const VALID_ROLES_FOR_ASSIGNMENT = ['sale', 'agent'];

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone) {
    return /^(0|\+84)[0-9]{9}$/.test(String(phone || '').replace(/\s+/g, ''));
}

function normalizeNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(String(value).replace(/,/g, ''));
    return Number.isFinite(numeric) ? numeric : null;
}

function parseImages(imagesUploaded) {
    if (!imagesUploaded) return null;
    if (Array.isArray(imagesUploaded)) return JSON.stringify(imagesUploaded);
    if (typeof imagesUploaded === 'string') {
        const trimmed = imagesUploaded.trim();
        if (!trimmed) return null;
        try {
            const parsed = JSON.parse(trimmed);
            return JSON.stringify(parsed);
        } catch {
            return JSON.stringify(trimmed.split(',').map(item => item.trim()).filter(Boolean));
        }
    }
    return JSON.stringify(imagesUploaded);
}

async function getSubmissionOr404(submissionId) {
    const [rows] = await db.query('SELECT * FROM property_submissions WHERE submission_id = ?', [submissionId]);
    return rows[0] || null;
}

async function findOrCreateOwner({ fullName, phone, email, idCard }) {
    const [existingRows] = await db.query('SELECT user_id, full_name, phone, email, id_card, role FROM users WHERE email = ?', [email]);

    if (existingRows.length > 0) {
        const user = existingRows[0];
        await db.query(
            'UPDATE users SET full_name = ?, phone = ?, id_card = ? WHERE user_id = ?',
            [fullName, phone || null, idCard || null, user.user_id]
        );

        return user.user_id;
    }

    const [result] = await db.query(
        'INSERT INTO users (full_name, phone, email, id_card, password_hash, role) VALUES (?, ?, ?, ?, NULL, ?)',
        [fullName, phone || null, email, idCard || null, 'owner']
    );

    return result.insertId;
}

async function autoAssignSales(submissionId) {
    const [sales] = await db.query(
        `SELECT u.user_id,
                COUNT(ps.submission_id) AS active_count
         FROM users u
         LEFT JOIN property_submissions ps
           ON ps.assigned_sales_id = u.user_id
          AND ps.status IN ('draft', 'pending', 'surveyed', 'approved')
         WHERE u.role IN (?, ?)
         GROUP BY u.user_id
         ORDER BY active_count ASC, u.user_id ASC
         LIMIT 1`,
        VALID_ROLES_FOR_ASSIGNMENT
    );

    if (sales.length === 0) {
        return null;
    }

    const assignedSalesId = sales[0].user_id;
    await db.query(
        'UPDATE property_submissions SET assigned_sales_id = ? WHERE submission_id = ?',
        [assignedSalesId, submissionId]
    );

    return assignedSalesId;
}

async function buildSubmissionResponse(submissionId) {
    const [rows] = await db.query(
        `SELECT
            ps.*,
            u.user_id AS owner_user_id,
            u.full_name AS owner_full_name,
            u.phone AS owner_phone,
            u.email AS owner_email,
            u.id_card AS owner_id_card,
            u.role AS owner_role,
            s.user_id AS sales_user_id,
            s.full_name AS sales_full_name,
            s.phone AS sales_phone,
            s.email AS sales_email
         FROM property_submissions ps
         LEFT JOIN users u ON u.user_id = ps.owner_id
         LEFT JOIN users s ON s.user_id = ps.assigned_sales_id
         WHERE ps.submission_id = ?`,
        [submissionId]
    );

    const submission = rows[0];
    if (!submission) return null;

    let images = [];
    if (submission.images_uploaded) {
        try {
            images = JSON.parse(submission.images_uploaded);
        } catch {
            images = String(submission.images_uploaded)
                .split(',')
                .map(item => item.trim())
                .filter(Boolean);
        }
    }

    return {
        submission: {
            submission_id: submission.submission_id,
            owner_id: submission.owner_id,
            property_type: submission.property_type,
            area: submission.area,
            direction: submission.direction,
            num_bedrooms: submission.num_bedrooms,
            num_bathrooms: submission.num_bathrooms,
            address: submission.address,
            proposed_price: submission.proposed_price,
            images_uploaded: images,
            status: submission.status,
            submitted_at: submission.submitted_at,
            assigned_sales_id: submission.assigned_sales_id
        },
        owner: submission.owner_user_id ? {
            user_id: submission.owner_user_id,
            full_name: submission.owner_full_name,
            phone: submission.owner_phone,
            email: submission.owner_email,
            id_card: submission.owner_id_card,
            role: submission.owner_role
        } : null,
        assigned_sales: submission.sales_user_id ? {
            user_id: submission.sales_user_id,
            full_name: submission.sales_full_name,
            phone: submission.sales_phone,
            email: submission.sales_email
        } : null
    };
}

// POST /api/consignments/step-1
// Tạo/cập nhật chủ nhà và tạo hồ sơ ký gửi bản nháp
router.post('/step-1', async (req, res) => {
    try {
        const { fullName, phone, email, idCard } = req.body;

        if (!fullName || !phone || !email || !idCard) {
            return res.status(400).json({ message: 'Vui lòng nhập đầy đủ họ tên, số điện thoại, email và CCCD/CMND' });
        }

        if (!isValidEmail(email)) {
            return res.status(400).json({ message: 'Email không hợp lệ' });
        }

        if (!isValidPhone(phone)) {
            return res.status(400).json({ message: 'Số điện thoại không hợp lệ' });
        }

        const ownerId = await findOrCreateOwner({ fullName, phone, email, idCard });

        const [result] = await db.query(
            `INSERT INTO property_submissions
                (owner_id, status)
             VALUES (?, 'draft')`,
            [ownerId]
        );

        const submission = await buildSubmissionResponse(result.insertId);

        res.status(201).json({
            message: 'Đã tạo hồ sơ ký gửi bản nháp',
            ...submission
        });
    } catch (err) {
        console.error('consignment step-1 error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// POST /api/consignments/:submissionId/step-2
// Cập nhật thông tin bất động sản
router.post('/:submissionId/step-2', async (req, res) => {
    try {
        const submissionId = Number(req.params.submissionId);
        const { propertyType, area, direction, bedrooms, bathrooms, address, proposedPrice } = req.body;

        if (!Number.isInteger(submissionId)) {
            return res.status(400).json({ message: 'submissionId không hợp lệ' });
        }

        const existingSubmission = await getSubmissionOr404(submissionId);
        if (!existingSubmission) {
            return res.status(404).json({ message: 'Không tìm thấy hồ sơ ký gửi' });
        }

        if (!propertyType || !area || !address || proposedPrice === undefined || proposedPrice === null || proposedPrice === '') {
            return res.status(400).json({ message: 'Vui lòng nhập đầy đủ loại BĐS, diện tích, địa chỉ và giá đề xuất' });
        }

        const normalizedArea = normalizeNumber(area);
        const normalizedPrice = normalizeNumber(proposedPrice);

        if (normalizedArea === null || normalizedArea <= 0) {
            return res.status(400).json({ message: 'Diện tích không hợp lệ' });
        }

        if (normalizedPrice === null || normalizedPrice <= 0) {
            return res.status(400).json({ message: 'Giá đề xuất không hợp lệ' });
        }

        await db.query(
            `UPDATE property_submissions
             SET property_type = ?, area = ?, direction = ?, num_bedrooms = ?, num_bathrooms = ?, address = ?, proposed_price = ?
             WHERE submission_id = ?`,
            [
                propertyType,
                normalizedArea,
                direction || null,
                bedrooms === '' || bedrooms === undefined || bedrooms === null ? null : Number(bedrooms),
                bathrooms === '' || bathrooms === undefined || bathrooms === null ? null : Number(bathrooms),
                address,
                normalizedPrice,
                submissionId
            ]
        );

        const submission = await buildSubmissionResponse(submissionId);

        res.json({
            message: 'Đã cập nhật thông tin tài sản',
            ...submission
        });
    } catch (err) {
        console.error('consignment step-2 error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// POST /api/consignments/:submissionId/step-3
// Lưu ảnh và chốt hồ sơ để chuyển sang xử lý nội bộ
router.post('/:submissionId/step-3', async (req, res) => {
    try {
        const submissionId = Number(req.params.submissionId);
        const { imagesUploaded, status = 'pending', assignSales = true } = req.body;

        if (!Number.isInteger(submissionId)) {
            return res.status(400).json({ message: 'submissionId không hợp lệ' });
        }

        const existingSubmission = await getSubmissionOr404(submissionId);
        if (!existingSubmission) {
            return res.status(404).json({ message: 'Không tìm thấy hồ sơ ký gửi' });
        }

        const normalizedImages = parseImages(imagesUploaded);

        await db.query(
            `UPDATE property_submissions
             SET images_uploaded = ?, status = ?
             WHERE submission_id = ?`,
            [normalizedImages, status, submissionId]
        );

        let assignedSalesId = existingSubmission.assigned_sales_id;
        if (assignSales && !assignedSalesId) {
            assignedSalesId = await autoAssignSales(submissionId);
        }

        const submission = await buildSubmissionResponse(submissionId);

        res.json({
            message: 'Đã lưu ảnh và xác nhận hồ sơ',
            auto_assigned_sales_id: assignedSalesId,
            ...submission
        });
    } catch (err) {
        console.error('consignment step-3 error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// GET /api/consignments
// Danh sách hồ sơ ký gửi
router.get('/', async (req, res) => {
    try {
        const { ownerId, status, limit = 20, offset = 0 } = req.query;

        const conditions = [];
        const params = [];

        if (ownerId) {
            conditions.push('ps.owner_id = ?');
            params.push(Number(ownerId));
        }

        if (status) {
            conditions.push('ps.status = ?');
            params.push(status);
        }

        const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        const [rows] = await db.query(
            `SELECT ps.submission_id, ps.owner_id, ps.property_type, ps.area, ps.direction,
                    ps.num_bedrooms, ps.num_bathrooms, ps.address, ps.proposed_price,
                    ps.status, ps.submitted_at, ps.assigned_sales_id,
                    u.full_name AS owner_full_name, u.email AS owner_email,
                    s.full_name AS assigned_sales_full_name, s.email AS assigned_sales_email
             FROM property_submissions ps
             LEFT JOIN users u ON u.user_id = ps.owner_id
             LEFT JOIN users s ON s.user_id = ps.assigned_sales_id
             ${whereClause}
             ORDER BY ps.submitted_at DESC, ps.submission_id DESC
             LIMIT ? OFFSET ?`,
            [...params, Number(limit), Number(offset)]
        );

        res.json({ items: rows });
    } catch (err) {
        console.error('consignment list error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// GET /api/consignments/:submissionId
// Đọc ngược toàn bộ dữ liệu hồ sơ
router.get('/:submissionId', async (req, res) => {
    try {
        const submissionId = Number(req.params.submissionId);

        if (!Number.isInteger(submissionId)) {
            return res.status(400).json({ message: 'submissionId không hợp lệ' });
        }

        const submission = await buildSubmissionResponse(submissionId);
        if (!submission) {
            return res.status(404).json({ message: 'Không tìm thấy hồ sơ ký gửi' });
        }

        const [surveyRows] = await db.query(
            'SELECT * FROM survey_records WHERE submission_id = ? ORDER BY completed_at DESC, survey_id DESC',
            [submissionId]
        );

        const [contractRows] = await db.query(
            'SELECT * FROM submission_contracts WHERE submission_id = ? ORDER BY signed_at DESC, submission_contract_id DESC',
            [submissionId]
        );

        const [depositRows] = await db.query(
            `SELECT dt.*, dr.return_id, dr.return_amount, dr.reason, dr.returned_at, dr.processed_by
             FROM submission_contracts sc
             LEFT JOIN deposit_transactions dt ON dt.submission_contract_id = sc.submission_contract_id
             LEFT JOIN deposit_returns dr ON dr.transaction_id = dt.transaction_id
             WHERE sc.submission_id = ?
             ORDER BY dt.verified_at DESC, dt.transaction_id DESC`,
            [submissionId]
        );

        const [listingRows] = await db.query(
            'SELECT * FROM property_listings WHERE submission_id = ? ORDER BY activated_at DESC, listing_id DESC',
            [submissionId]
        );

        res.json({
            ...submission,
            survey_records: surveyRows,
            submission_contracts: contractRows,
            deposit_transactions: depositRows,
            property_listings: listingRows
        });
    } catch (err) {
        console.error('consignment detail error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// PATCH /api/consignments/:submissionId/status
router.patch('/:submissionId/status', async (req, res) => {
    try {
        const submissionId = Number(req.params.submissionId);
        const { status } = req.body;

        if (!Number.isInteger(submissionId)) {
            return res.status(400).json({ message: 'submissionId không hợp lệ' });
        }

        if (!status) {
            return res.status(400).json({ message: 'Thiếu trạng thái mới' });
        }

        const existingSubmission = await getSubmissionOr404(submissionId);
        if (!existingSubmission) {
            return res.status(404).json({ message: 'Không tìm thấy hồ sơ ký gửi' });
        }

        await db.query('UPDATE property_submissions SET status = ? WHERE submission_id = ?', [status, submissionId]);
        const submission = await buildSubmissionResponse(submissionId);

        res.json({
            message: 'Đã cập nhật trạng thái hồ sơ',
            ...submission
        });
    } catch (err) {
        console.error('consignment status error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

module.exports = router;