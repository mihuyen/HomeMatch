const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const VALID_ROLES_FOR_ASSIGNMENT = ['sale', 'agent'];

const STATUS_LABELS = {
    draft: 'Bản nháp',
    pending: 'Chờ xử lý',
    surveyed: 'Đã khảo sát',
    approved: 'Đã phê duyệt',
    active: 'Đang hoạt động',
    cancelled: 'Đã hủy',
    rejected: 'Đã từ chối',
    listed: 'Đã lên tin',
    rented: 'Đã cho thuê',
    expired: 'Hết hạn'
};

function toRequestCode(submissionId) {
    const n = Number(submissionId);
    if (!Number.isFinite(n)) return 'KG-00000';
    return `KG-${String(n).padStart(5, '0')}`;
}

function toStatusLabel(status) {
    return STATUS_LABELS[status] || status || 'Chưa xác định';
}

function buildTrackingSteps(data) {
    const hasSurvey = data.survey_count > 0;
    const hasContract = data.contract_count > 0;
    const hasDeposit = data.deposit_count > 0;
    const hasListing = data.listing_count > 0;
    const isDone = data.listing_status === 'rented';

    return [
        {
            key: 'received',
            label: 'Đã nhận yêu cầu',
            state: 'done',
            at: data.submitted_at
        },
        {
            key: 'survey',
            label: 'Khảo sát bất động sản',
            state: hasSurvey ? 'done' : (data.next_survey_time ? 'current' : 'pending'),
            at: hasSurvey ? data.last_survey_completed_at : data.next_survey_time
        },
        {
            key: 'contract',
            label: 'Hợp đồng ký gửi',
            state: hasContract ? 'done' : 'pending',
            at: data.latest_contract_signed_at
        },
        {
            key: 'deposit',
            label: 'Đối soát tiền đảm bảo',
            state: hasDeposit ? 'done' : 'pending',
            at: data.latest_deposit_verified_at
        },
        {
            key: 'listing',
            label: 'Đăng tin & xử lý thuê',
            state: isDone ? 'done' : (hasListing ? 'current' : 'pending'),
            at: data.latest_listing_activated_at
        }
    ];
}

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

async function getOwnerTrackingList(ownerId, { status, search, limit = 20, offset = 0 }) {
    const conditions = ['ps.owner_id = ?'];
    const params = [ownerId];

    if (status) {
        conditions.push('ps.status = ?');
        params.push(status);
    }

    if (search) {
        conditions.push('(ps.address LIKE ? OR ps.property_type LIKE ? OR CAST(ps.submission_id AS CHAR) LIKE ?)');
        const keyword = `%${search}%`;
        params.push(keyword, keyword, keyword);
    }

    const [rows] = await db.query(
        `SELECT
            ps.submission_id,
            ps.owner_id,
            ps.property_type,
            ps.address,
            ps.area,
            ps.direction,
            ps.num_bedrooms,
            ps.num_bathrooms,
            ps.proposed_price,
            ps.status,
            ps.submitted_at,
            ps.assigned_sales_id,
            s.full_name AS assigned_sales_full_name,
            s.email AS assigned_sales_email,
            s.phone AS assigned_sales_phone,
            COUNT(DISTINCT sr.survey_id) AS survey_count,
            MAX(sr.completed_at) AS last_survey_completed_at,
            COUNT(DISTINCT sc.submission_contract_id) AS contract_count,
            MAX(sc.signed_at) AS latest_contract_signed_at,
            COUNT(DISTINCT dt.transaction_id) AS deposit_count,
            MAX(dt.verified_at) AS latest_deposit_verified_at,
            COUNT(DISTINCT pl.listing_id) AS listing_count,
            MAX(pl.activated_at) AS latest_listing_activated_at,
            MAX(pl.status) AS listing_status,
            MIN(CASE WHEN ap.status IN ('scheduled', 'Đã đặt') AND ap.appointment_type = 'khảo sát' THEN ap.scheduled_time END) AS next_survey_time
         FROM property_submissions ps
         LEFT JOIN users s ON s.user_id = ps.assigned_sales_id
         LEFT JOIN survey_records sr ON sr.submission_id = ps.submission_id
         LEFT JOIN submission_contracts sc ON sc.submission_id = ps.submission_id
         LEFT JOIN deposit_transactions dt ON dt.submission_contract_id = sc.submission_contract_id
         LEFT JOIN property_listings pl ON pl.submission_id = ps.submission_id
         LEFT JOIN appointments ap ON ap.submission_id = ps.submission_id
         WHERE ${conditions.join(' AND ')}
         GROUP BY ps.submission_id, s.user_id
         ORDER BY ps.submitted_at DESC, ps.submission_id DESC
         LIMIT ? OFFSET ?`,
        [...params, Number(limit), Number(offset)]
    );

    return rows.map(row => ({
        request_code: toRequestCode(row.submission_id),
        submission_id: row.submission_id,
        owner_id: row.owner_id,
        property_type: row.property_type,
        address: row.address,
        area: row.area,
        direction: row.direction,
        num_bedrooms: row.num_bedrooms,
        num_bathrooms: row.num_bathrooms,
        proposed_price: row.proposed_price,
        status: row.status,
        status_label: toStatusLabel(row.status),
        submitted_at: row.submitted_at,
        assigned_sales: row.assigned_sales_id ? {
            user_id: row.assigned_sales_id,
            full_name: row.assigned_sales_full_name,
            email: row.assigned_sales_email,
            phone: row.assigned_sales_phone
        } : null,
        next_survey_time: row.next_survey_time,
        steps: buildTrackingSteps(row)
    }));
}

async function getOwnerTrackingDetail(ownerId, submissionId) {
    const [baseRows] = await db.query(
        `SELECT
            ps.submission_id,
            ps.owner_id,
            ps.property_type,
            ps.address,
            ps.area,
            ps.direction,
            ps.num_bedrooms,
            ps.num_bathrooms,
            ps.proposed_price,
            ps.status,
            ps.images_uploaded,
            ps.submitted_at,
            ps.assigned_sales_id,
            s.full_name AS assigned_sales_full_name,
            s.email AS assigned_sales_email,
            s.phone AS assigned_sales_phone
         FROM property_submissions ps
         LEFT JOIN users s ON s.user_id = ps.assigned_sales_id
         WHERE ps.submission_id = ? AND ps.owner_id = ?
         LIMIT 1`,
        [submissionId, ownerId]
    );

    if (baseRows.length === 0) {
        return null;
    }

    const base = baseRows[0];

    const [surveyRows] = await db.query(
        'SELECT survey_id, survey_status, survey_notes, completed_at FROM survey_records WHERE submission_id = ? ORDER BY completed_at DESC, survey_id DESC',
        [submissionId]
    );

    const [appointmentRows] = await db.query(
        `SELECT appointment_id, appointment_type, scheduled_time, location, status, result_note, created_at
         FROM appointments
         WHERE submission_id = ?
         ORDER BY scheduled_time DESC, appointment_id DESC`,
        [submissionId]
    );

    const [contractRows] = await db.query(
        `SELECT submission_contract_id, contract_code, final_price, contract_duration_months,
                contract_type, status, signed_at
         FROM submission_contracts
         WHERE submission_id = ?
         ORDER BY signed_at DESC, submission_contract_id DESC`,
        [submissionId]
    );

    const [depositRows] = await db.query(
        `SELECT dt.transaction_id, dt.amount, dt.payment_method, dt.status, dt.transaction_code, dt.verified_at,
                dr.return_id, dr.return_amount, dr.reason, dr.returned_at
         FROM submission_contracts sc
         LEFT JOIN deposit_transactions dt ON dt.submission_contract_id = sc.submission_contract_id
         LEFT JOIN deposit_returns dr ON dr.transaction_id = dt.transaction_id
         WHERE sc.submission_id = ?
         ORDER BY dt.verified_at DESC, dt.transaction_id DESC`,
        [submissionId]
    );

    const [listingRows] = await db.query(
        `SELECT listing_id, title, description, price_display, status, view_count, activated_at, expired_at
         FROM property_listings
         WHERE submission_id = ?
         ORDER BY activated_at DESC, listing_id DESC`,
        [submissionId]
    );

    const [extensionRows] = await db.query(
        `SELECT ce.extension_id, ce.status, ce.extension_months, ce.requested_at
         FROM contract_extensions ce
         INNER JOIN submission_contracts sc ON sc.submission_contract_id = ce.submission_contract_id
         WHERE sc.submission_id = ? AND ce.status = 'pending'
         LIMIT 1`,
        [submissionId]
    );

    let images = [];
    if (base.images_uploaded) {
        try {
            images = JSON.parse(base.images_uploaded);
        } catch {
            images = String(base.images_uploaded)
                .split(',')
                .map(item => item.trim())
                .filter(Boolean);
        }
    }

    const timeline = [
        {
            type: 'submission',
            title: 'Đã nhận yêu cầu ký gửi',
            status: 'done',
            at: base.submitted_at,
            note: `Hồ sơ #${toRequestCode(base.submission_id)}`
        },
        ...appointmentRows.map(ap => ({
            id: ap.appointment_id,
            type: 'appointment',
            title: `Lịch ${ap.appointment_type || 'hẹn'}`,
            status: ap.status,
            at: ap.scheduled_time || ap.created_at,
            note: ap.location || ap.result_note || null
        })),
        ...surveyRows.map(sv => ({
            type: 'survey',
            title: 'Cập nhật khảo sát',
            status: sv.survey_status || 'done',
            at: sv.completed_at,
            note: sv.survey_notes || null
        })),
        ...contractRows.map(ct => ({
            type: 'contract',
            title: 'Hợp đồng ký gửi',
            status: ct.status || 'pending',
            at: ct.signed_at,
            note: ct.contract_code || null
        })),
        ...depositRows
            .filter(dp => dp.transaction_id)
            .map(dp => ({
                type: 'deposit',
                title: 'Đối soát tiền đảm bảo',
                status: dp.status || 'pending',
                at: dp.verified_at || dp.returned_at,
                note: dp.transaction_code || null
            })),
        ...listingRows.map(ls => ({
            type: 'listing',
            title: 'Cập nhật tin đăng',
            status: ls.status || 'pending',
            at: ls.activated_at || ls.expired_at,
            note: ls.title || null
        }))
    ].sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));

    return {
        request_code: toRequestCode(base.submission_id),
        has_pending_extension: extensionRows.length > 0,
        submission: {
            submission_id: base.submission_id,
            owner_id: base.owner_id,
            property_type: base.property_type,
            address: base.address,
            area: base.area,
            direction: base.direction,
            num_bedrooms: base.num_bedrooms,
            num_bathrooms: base.num_bathrooms,
            proposed_price: base.proposed_price,
            status: base.status,
            status_label: toStatusLabel(base.status),
            submitted_at: base.submitted_at,
            images_uploaded: images
        },
        assigned_sales: base.assigned_sales_id ? {
            user_id: base.assigned_sales_id,
            full_name: base.assigned_sales_full_name,
            email: base.assigned_sales_email,
            phone: base.assigned_sales_phone
        } : null,
        survey_records: surveyRows,
        appointments: appointmentRows,
        submission_contracts: contractRows,
        deposit_transactions: depositRows,
        property_listings: listingRows,
        timeline
    };
}

// POST /api/consignments/step-1
// Tạo/cập nhật chủ nhà và tạo hồ sơ ký gửi đầy đủ thông tin ban đầu
router.post('/step-1', async (req, res) => {
    try {
        const {
            fullName,
            phone,
            email,
            idCard,
            propertyType,
            area,
            direction,
            bedrooms,
            bathrooms,
            address,
            proposedPrice,
            imagesUploaded
        } = req.body;

        if (
            !fullName || !phone || !email || !idCard ||
            !propertyType || area === undefined || area === null || area === '' ||
            !direction || bedrooms === undefined || bedrooms === null || bedrooms === '' ||
            bathrooms === undefined || bathrooms === null || bathrooms === '' ||
            !address || proposedPrice === undefined || proposedPrice === null || proposedPrice === '' ||
            imagesUploaded === undefined || imagesUploaded === null || imagesUploaded === ''
        ) {
            return res.status(400).json({
                message: 'Vui lòng nhập đầy đủ thông tin chủ nhà và thông tin bất động sản ký gửi'
            });
        }

        if (!isValidEmail(email)) {
            return res.status(400).json({ message: 'Email không hợp lệ' });
        }

        if (!isValidPhone(phone)) {
            return res.status(400).json({ message: 'Số điện thoại không hợp lệ' });
        }

        const ownerId = await findOrCreateOwner({ fullName, phone, email, idCard });

        const normalizedArea = normalizeNumber(area);
        const normalizedPrice = normalizeNumber(proposedPrice);
        const normalizedBedrooms = Number(bedrooms);
        const normalizedBathrooms = Number(bathrooms);
        const normalizedImages = parseImages(imagesUploaded);

        if (normalizedArea === null || normalizedArea <= 0) {
            return res.status(400).json({ message: 'Diện tích không hợp lệ' });
        }

        if (normalizedPrice === null || normalizedPrice <= 0) {
            return res.status(400).json({ message: 'Giá đề xuất không hợp lệ' });
        }

        if (!Number.isFinite(normalizedBedrooms) || normalizedBedrooms < 0) {
            return res.status(400).json({ message: 'Số phòng ngủ không hợp lệ' });
        }

        if (!Number.isFinite(normalizedBathrooms) || normalizedBathrooms < 0) {
            return res.status(400).json({ message: 'Số phòng tắm không hợp lệ' });
        }

        if (!normalizedImages) {
            return res.status(400).json({ message: 'Vui lòng tải lên ít nhất 1 ảnh bất động sản' });
        }

        const [result] = await db.query(
            `INSERT INTO property_submissions
                (owner_id, property_type, area, direction, num_bedrooms, num_bathrooms, address, proposed_price, images_uploaded, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
            [
                ownerId,
                propertyType,
                normalizedArea,
                direction,
                normalizedBedrooms,
                normalizedBathrooms,
                address,
                normalizedPrice,
                normalizedImages
            ]
        );

        const assignedSalesId = await autoAssignSales(result.insertId);

        const submission = await buildSubmissionResponse(result.insertId);

        res.status(201).json({
            message: 'Đã tạo hồ sơ ký gửi và tự động phân công khảo sát',
            auto_assigned_sales_id: assignedSalesId,
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

// GET /api/consignments/owner/me/tracking
// Danh sách theo dõi cho owner đang đăng nhập
router.get('/owner/me/tracking', requireAuth, requireRole('owner'), async (req, res) => {
    try {
        const { status, search, limit = 20, offset = 0 } = req.query;
        const items = await getOwnerTrackingList(req.user.user_id, { status, search, limit, offset });

        res.json({
            owner_id: req.user.user_id,
            items
        });
    } catch (err) {
        console.error('owner tracking list error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// GET /api/consignments/owner/me/tracking/:submissionId
// Chi tiết tiến trình 1 hồ sơ cho owner
router.get('/owner/me/tracking/:submissionId', requireAuth, requireRole('owner'), async (req, res) => {
    try {
        const submissionId = Number(req.params.submissionId);

        if (!Number.isInteger(submissionId)) {
            return res.status(400).json({ message: 'submissionId không hợp lệ' });
        }

        const detail = await getOwnerTrackingDetail(req.user.user_id, submissionId);
        if (!detail) {
            return res.status(404).json({ message: 'Không tìm thấy hồ sơ ký gửi của owner hiện tại' });
        }

        res.json(detail);
    } catch (err) {
        console.error('owner tracking detail error:', err);
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

        // Tự động kiểm tra và khởi tạo deposit_transactions 10.000đ nếu đã có hợp đồng nhưng chưa có giao dịch cọc
        if (contractRows.length > 0) {
            const latestContract = contractRows[0];
            const [existingDeposits] = await db.query(
                'SELECT transaction_id FROM deposit_transactions WHERE submission_contract_id = ? LIMIT 1',
                [latestContract.submission_contract_id]
            );
            if (existingDeposits.length === 0) {
                const randCode = Math.floor(100000 + Math.random() * 900000);
                const txCode = `PAY-2026-${randCode}`;
                await db.query(
                    `INSERT INTO deposit_transactions 
                        (submission_contract_id, amount, payment_method, status, transaction_code) 
                     VALUES (?, 10000.00, ?, ?, ?)`,
                    [latestContract.submission_contract_id, 'Chuyển khoản / VietQR', 'Pending', txCode]
                );
            }
        }

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
router.patch('/:submissionId/status', requireAuth, async (req, res) => {
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

        if (req.user.role === 'owner' && Number(existingSubmission.owner_id) !== Number(req.user.user_id)) {
            return res.status(403).json({ message: 'Owner chỉ được cập nhật hồ sơ của chính mình' });
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

// POST /api/consignments/:submissionId/extend
// Tạo yêu cầu gia hạn hợp đồng ký gửi (Owner)
router.post('/:submissionId/extend', requireAuth, requireRole('owner'), async (req, res) => {
    try {
        const submissionId = Number(req.params.submissionId);
        const { extensionMonths = 12, notes } = req.body;
        const ownerId = req.user.user_id;

        if (!Number.isInteger(submissionId)) {
            return res.status(400).json({ message: 'submissionId không hợp lệ' });
        }

        const submission = await getSubmissionOr404(submissionId);
        if (!submission) {
            return res.status(404).json({ message: 'Không tìm thấy hồ sơ ký gửi' });
        }

        if (Number(submission.owner_id) !== Number(ownerId)) {
            return res.status(403).json({ message: 'Bạn không có quyền thực hiện yêu cầu này' });
        }

        // Lấy hợp đồng active mới nhất
        const [contracts] = await db.query(
            'SELECT * FROM submission_contracts WHERE submission_id = ? AND status = ? ORDER BY submission_contract_id DESC LIMIT 1',
            [submissionId, 'active']
        );

        if (contracts.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy hợp đồng đang hoạt động nào để thực hiện gia hạn' });
        }

        const activeContract = contracts[0];

        // Kiểm tra xem đã có yêu cầu pending nào chưa
        const [existingExtensions] = await db.query(
            'SELECT * FROM contract_extensions WHERE submission_contract_id = ? AND status = ? LIMIT 1',
            [activeContract.submission_contract_id, 'pending']
        );

        if (existingExtensions.length > 0) {
            return res.status(400).json({ message: 'Đã có yêu cầu gia hạn đang chờ xử lý cho hợp đồng này' });
        }

        // Tính ngày hết hạn cũ: signed_at + duration_months
        const signedDate = new Date(activeContract.signed_at);
        const oldExpiredAt = new Date(signedDate.setMonth(signedDate.getMonth() + activeContract.contract_duration_months));

        // Tính ngày hết hạn mới: oldExpiredAt + extensionMonths
        const tempDate = new Date(oldExpiredAt);
        const newExpiredAt = new Date(tempDate.setMonth(tempDate.getMonth() + Number(extensionMonths)));

        const processedBy = submission.assigned_sales_id || null;

        await db.query(
            `INSERT INTO contract_extensions 
                (submission_contract_id, old_expired_at, extension_months, new_expired_at, extension_fee, status, processed_by, notes)
             VALUES (?, ?, ?, ?, 0.00, 'pending', ?, ?)`,
            [
                activeContract.submission_contract_id,
                oldExpiredAt,
                Number(extensionMonths),
                newExpiredAt,
                processedBy,
                notes || 'Chủ sở hữu yêu cầu gia hạn hợp đồng.'
            ]
        );

        res.status(201).json({
            message: 'Đã gửi yêu cầu gia hạn thành công và phân công cho Sales phụ trách',
            extension_months: extensionMonths,
            new_expired_at: newExpiredAt
        });

    } catch (err) {
        console.error('create extension error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

module.exports = router;