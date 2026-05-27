const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

function toRequestCode(submissionId) {
    const n = Number(submissionId);
    if (!Number.isFinite(n)) return 'KG-00000';
    return `KG-${String(n).padStart(5, '0')}`;
}

function normalizeTextField(value) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function mapSurveyToSubmissionStatus(surveyStatus) {
    const text = String(surveyStatus || '').toLowerCase();
    if (text.includes('draft') || text.includes('nháp')) return null;
    if (text.includes('không') || text.includes('fail') || text.includes('reject')) return 'cancelled';
    if (text.includes('đạt') || text.includes('pass') || text.includes('complete') || text.includes('hoàn tất')) return 'surveyed';
    return 'surveyed';
}

function generateContractCode(submissionId) {
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `HD-${String(submissionId).padStart(5, '0')}-${rand}`;
}

async function generateUniqueContractCode(connection, submissionId, maxAttempts = 10) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const code = generateContractCode(submissionId);
        const [rows] = await connection.query(
            'SELECT submission_contract_id FROM submission_contracts WHERE contract_code = ? LIMIT 1',
            [code]
        );
        if (rows.length === 0) return code;
    }
    throw new Error('Không thể tạo mã hợp đồng duy nhất');
}

async function getAssignedSubmission(submissionId, brokerId) {
    const [rows] = await db.query(
        `SELECT ps.*, u.full_name AS owner_name, u.phone AS owner_phone, u.email AS owner_email
         FROM property_submissions ps
         LEFT JOIN users u ON u.user_id = ps.owner_id
         WHERE ps.submission_id = ? AND ps.assigned_sales_id = ?
         LIMIT 1`,
        [submissionId, brokerId]
    );
    return rows[0] || null;
}

async function getAssignedSubmissionContractDraft(submissionId, brokerId) {
    const [rows] = await db.query(
        `SELECT
            ps.submission_id,
            ps.address AS property_address,
            ps.direction AS property_direction,
            ps.proposed_price AS property_proposed_price,
            u.full_name AS owner_full_name,
            u.phone AS owner_phone,
            u.id_card AS owner_id_card
         FROM property_submissions ps
         LEFT JOIN users u ON u.user_id = ps.owner_id
         WHERE ps.submission_id = ? AND ps.assigned_sales_id = ?
         LIMIT 1`,
        [submissionId, brokerId]
    );
    return rows[0] || null;
}

async function getLatestSubmissionContract(submissionId, brokerId) {
    const [rows] = await db.query(
        `SELECT sc.submission_contract_id, sc.contract_code, sc.contract_type, sc.signed_scan_url AS contract_scan_url,
            sc.status, sc.signed_at, u.full_name AS owner_full_name
         FROM submission_contracts sc
         INNER JOIN property_submissions ps ON ps.submission_id = sc.submission_id
         LEFT JOIN users u ON u.user_id = ps.owner_id
         WHERE sc.submission_id = ? AND ps.assigned_sales_id = ?
         ORDER BY sc.submission_contract_id DESC
         LIMIT 1`,
        [submissionId, brokerId]
    );
    return rows[0] || null;
}

// GET /api/broker/assignments
// Danh sách hồ sơ được phân công cho broker/sale hiện tại
router.get('/assignments', requireAuth, requireRole('broker', 'sale', 'agent', 'manager'), async (req, res) => {
    try {
        const { status, search, limit = 20, offset = 0 } = req.query;
        const brokerId = req.user.user_id;

        const conditions = ['ps.assigned_sales_id = ?'];
        const params = [brokerId];

        if (status) {
            conditions.push('ps.status = ?');
            params.push(status);
        }

        if (search) {
            const keyword = `%${search}%`;
            conditions.push('(ps.address LIKE ? OR u.full_name LIKE ? OR CAST(ps.submission_id AS CHAR) LIKE ?)');
            params.push(keyword, keyword, keyword);
        }

        const whereSql = conditions.join(' AND ');

        const [totalRows] = await db.query(
            `SELECT COUNT(*) AS total
             FROM property_submissions ps
             LEFT JOIN users u ON u.user_id = ps.owner_id
             WHERE ${whereSql}`,
            params
        );

        const total = Number(totalRows[0]?.total || 0);

        const [rows] = await db.query(
            `SELECT
                ps.submission_id,
                ps.status,
                ps.address,
                ps.direction,
                ps.property_type,
                ps.area,
                ps.num_bedrooms,
                ps.num_bathrooms,
                ps.proposed_price,
                ps.submitted_at,
                ps.owner_id,
                u.full_name AS owner_name,
                u.phone AS owner_phone,
                sc.submission_contract_id,
                sc.status AS contract_status,
                cla.status AS legal_status,
                cla.review_comment AS legal_review_comment,
                cla.reviewed_at AS legal_reviewed_at,
                MAX(ap.scheduled_time) AS latest_appointment_time,
                SUBSTRING_INDEX(GROUP_CONCAT(ap.status ORDER BY ap.scheduled_time DESC SEPARATOR ','), ',', 1) AS latest_appointment_status,
                MAX(sr.completed_at) AS latest_survey_time,
                SUBSTRING_INDEX(GROUP_CONCAT(sr.survey_status ORDER BY sr.completed_at DESC SEPARATOR ','), ',', 1) AS latest_survey_status
             FROM property_submissions ps
             LEFT JOIN users u ON u.user_id = ps.owner_id
             LEFT JOIN submission_contracts sc
               ON sc.submission_id = ps.submission_id
              AND sc.submission_contract_id = (
                 SELECT MAX(sc2.submission_contract_id)
                 FROM submission_contracts sc2
                 WHERE sc2.submission_id = ps.submission_id
             )
                         LEFT JOIN contract_legal_approvals cla ON cla.submission_contract_id = sc.submission_contract_id
             LEFT JOIN appointments ap ON ap.submission_id = ps.submission_id AND ap.appointment_type = 'khảo sát'
             LEFT JOIN survey_records sr ON sr.submission_id = ps.submission_id
             WHERE ${whereSql}
                         GROUP BY ps.submission_id, u.user_id, sc.submission_contract_id, sc.status, cla.status, cla.review_comment, cla.reviewed_at
             ORDER BY ps.submitted_at DESC, ps.submission_id DESC
             LIMIT ? OFFSET ?`,
            [...params, Number(limit), Number(offset)]
        );

        res.json({
            broker_id: brokerId,
            total,
            items: rows.map(row => ({
                request_code: toRequestCode(row.submission_id),
                submission_id: row.submission_id,
                status: row.status,
                address: row.address,
                direction: row.direction,
                property_type: row.property_type,
                area: row.area,
                num_bedrooms: row.num_bedrooms,
                num_bathrooms: row.num_bathrooms,
                proposed_price: row.proposed_price,
                submitted_at: row.submitted_at,
                submission_contract_id: row.submission_contract_id,
                contract_status: row.contract_status,
                legal_status: row.legal_status,
                legal_review_comment: row.legal_review_comment,
                legal_reviewed_at: row.legal_reviewed_at,
                owner: {
                    user_id: row.owner_id,
                    full_name: row.owner_name,
                    phone: row.owner_phone
                },
                latest_appointment: row.latest_appointment_time ? {
                    scheduled_time: row.latest_appointment_time,
                    status: row.latest_appointment_status
                } : null,
                latest_survey: row.latest_survey_time ? {
                    completed_at: row.latest_survey_time,
                    status: row.latest_survey_status
                } : null
            }))
        });
    } catch (err) {
        console.error('broker assignments error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// GET /api/broker/contracts/:submissionId/legal-response
// Lay phan hoi tu bo phan phap ly cho ho so hop dong moi nhat
router.get('/contracts/:submissionId/legal-response', requireAuth, requireRole('broker', 'sale', 'agent', 'manager'), async (req, res) => {
    try {
        const brokerId = req.user.user_id;
        const submissionId = Number(req.params.submissionId);

        if (!Number.isInteger(submissionId)) {
            return res.status(400).json({ message: 'submissionId khong hop le' });
        }

        const assignedSubmission = await getAssignedSubmission(submissionId, brokerId);
        if (!assignedSubmission) {
            return res.status(404).json({ message: 'Khong tim thay ho so duoc phan cong cho broker hien tai' });
        }

        const [rows] = await db.query(
            `SELECT
                sc.submission_contract_id,
                sc.contract_code,
                sc.contract_type,
                sc.contract_duration_months,
                sc.final_price,
                ps.submission_id,
                ps.address,
                ps.property_type,
                ps.area,
                ps.direction,
                cla.status AS legal_status,
                cla.review_comment,
                cla.reviewed_at,
                cla.special_terms_requested,
                reviewer.user_id AS reviewer_id,
                reviewer.full_name AS reviewer_name,
                reviewer.email AS reviewer_email
             FROM submission_contracts sc
             INNER JOIN property_submissions ps ON ps.submission_id = sc.submission_id
             LEFT JOIN contract_legal_approvals cla ON cla.submission_contract_id = sc.submission_contract_id
             LEFT JOIN users reviewer ON reviewer.user_id = cla.reviewed_by
             WHERE sc.submission_id = ?
             ORDER BY sc.submission_contract_id DESC
             LIMIT 1`,
            [submissionId]
        );

        const row = rows[0];
        if (!row) {
            return res.status(404).json({ message: 'Khong tim thay hop dong cho ho so nay' });
        }

        res.json({
            submission_contract_id: row.submission_contract_id,
            submission_id: row.submission_id,
            contract_code: row.contract_code,
            contract_type: row.contract_type,
            contract_duration_months: row.contract_duration_months,
            final_price: row.final_price,
            property: {
                address: row.address,
                property_type: row.property_type,
                area: row.area,
                direction: row.direction
            },
            legal_response: {
                status: row.legal_status,
                review_comment: row.review_comment,
                reviewed_at: row.reviewed_at,
                special_terms_requested: row.special_terms_requested,
                reviewer: row.reviewer_id ? {
                    user_id: row.reviewer_id,
                    full_name: row.reviewer_name,
                    email: row.reviewer_email
                } : null
            }
        });
    } catch (err) {
        console.error('broker legal response error:', err);
        res.status(500).json({ message: 'Loi server: ' + err.message });
    }
});

// GET /api/broker/appointments
// Danh sách lịch khảo sát của broker hiện tại
router.get('/appointments', requireAuth, requireRole('broker', 'sale', 'agent', 'manager'), async (req, res) => {
    try {
        const { status, search, from, to, limit = 30, offset = 0 } = req.query;
        const brokerId = req.user.user_id;

        const conditions = [
            'ps.assigned_sales_id = ?',
            "ap.appointment_type = 'khảo sát'"
        ];
        const params = [brokerId];

        if (status) {
            conditions.push('ap.status = ?');
            params.push(status);
        }

        if (search) {
            const keyword = `%${search}%`;
            conditions.push('(ps.address LIKE ? OR u.full_name LIKE ? OR ap.location LIKE ?)');
            params.push(keyword, keyword, keyword);
        }

        if (from) {
            conditions.push('ap.scheduled_time >= ?');
            params.push(from);
        }

        if (to) {
            conditions.push('ap.scheduled_time <= ?');
            params.push(to);
        }

        const [rows] = await db.query(
            `SELECT
                ap.appointment_id,
                ap.assignment_id,
                ap.submission_id,
                ap.appointment_type,
                ap.scheduled_time,
                ap.location,
                ap.status,
                ap.result_note,
                ap.created_at,
                ps.address,
                ps.property_type,
                ps.proposed_price,
                ps.status AS submission_status,
                u.user_id AS owner_id,
                u.full_name AS owner_name,
                u.phone AS owner_phone
             FROM appointments ap
             INNER JOIN property_submissions ps ON ps.submission_id = ap.submission_id
             LEFT JOIN users u ON u.user_id = ps.owner_id
             WHERE ${conditions.join(' AND ')}
             ORDER BY ap.scheduled_time DESC, ap.appointment_id DESC
             LIMIT ? OFFSET ?`,
            [...params, Number(limit), Number(offset)]
        );

        res.json({
            broker_id: brokerId,
            items: rows.map(row => ({
                appointment_id: row.appointment_id,
                submission_id: row.submission_id,
                request_code: toRequestCode(row.submission_id),
                appointment_type: row.appointment_type,
                scheduled_time: row.scheduled_time,
                location: row.location,
                status: row.status,
                result_note: row.result_note,
                created_at: row.created_at,
                submission: {
                    status: row.submission_status,
                    address: row.address,
                    property_type: row.property_type,
                    proposed_price: row.proposed_price
                },
                owner: {
                    user_id: row.owner_id,
                    full_name: row.owner_name,
                    phone: row.owner_phone
                }
            }))
        });
    } catch (err) {
        console.error('broker appointments error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// GET /api/broker/contracts/:submissionId
// Lấy dữ liệu khởi tạo hợp đồng cho hồ sơ được phân công
router.get('/contracts/:submissionId', requireAuth, requireRole('broker', 'sale', 'agent', 'manager'), async (req, res) => {
    try {
        const brokerId = req.user.user_id;
        const submissionId = Number(req.params.submissionId);

        if (!Number.isInteger(submissionId)) {
            return res.status(400).json({ message: 'submissionId không hợp lệ' });
        }

        const draft = await getAssignedSubmissionContractDraft(submissionId, brokerId);
        if (!draft) {
            return res.status(404).json({ message: 'Không tìm thấy hồ sơ được phân công cho broker hiện tại' });
        }

        res.json({
            submission_id: draft.submission_id,
            owner: {
                full_name: draft.owner_full_name,
                phone: draft.owner_phone,
                id_card: draft.owner_id_card,
                address: null
            },
            property: {
                address: draft.property_address,
                direction: draft.property_direction,
                proposed_price: draft.property_proposed_price
            }
        });
    } catch (err) {
        console.error('broker contract draft error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// POST /api/broker/contracts
// Tạo hợp đồng ký gửi cho hồ sơ đã phân công
router.post('/contracts', requireAuth, requireRole('broker', 'sale', 'agent', 'manager'), async (req, res) => {
    const connection = await db.getConnection();
    try {
        const brokerId = req.user.user_id;
        const { submissionId, contractDurationMonths, contractType, specialTerms } = req.body;
        const parsedSubmissionId = Number(submissionId);
        const parsedDuration = Number(contractDurationMonths);

        if (!Number.isInteger(parsedSubmissionId)) {
            return res.status(400).json({ message: 'submissionId không hợp lệ' });
        }

        if (!Number.isFinite(parsedDuration) || parsedDuration <= 0) {
            return res.status(400).json({ message: 'Thời hạn hợp đồng không hợp lệ' });
        }

        if (!['standard', 'custom'].includes(contractType)) {
            return res.status(400).json({ message: 'Loại hợp đồng không hợp lệ' });
        }

        if (contractType === 'custom' && (!specialTerms || String(specialTerms).trim() === '')) {
            return res.status(400).json({ message: 'Vui lòng nhập điều khoản bổ sung' });
        }

        const assignedSubmission = await getAssignedSubmission(parsedSubmissionId, brokerId);
        if (!assignedSubmission) {
            return res.status(404).json({ message: 'Không tìm thấy hồ sơ được phân công cho broker hiện tại' });
        }

        await connection.beginTransaction();

        const contractCode = await generateUniqueContractCode(connection, parsedSubmissionId);
        const [contractResult] = await connection.query(
            `INSERT INTO submission_contracts (submission_id, contract_code, contract_duration_months, contract_type, status, signed_at)
             VALUES (?, ?, ?, ?, 'pending_documents', NOW())`,
            [parsedSubmissionId, contractCode, parsedDuration, contractType]
        );

        const submissionContractId = contractResult.insertId;

        if (contractType === 'custom') {
            await connection.query(
                `INSERT INTO contract_legal_approvals (submission_contract_id, special_terms_requested, status)
                 VALUES (?, ?, 'pending')`,
                [submissionContractId, String(specialTerms).trim()]
            );
        }

        await connection.commit();

        res.status(201).json({
            message: contractType === 'custom'
                ? 'Đã gửi cho bộ phận pháp lý phê duyệt điều khoản riêng'
                : 'Tạo hợp đồng thành công',
            submission_contract_id: submissionContractId,
            contract_code: contractCode
        });
    } catch (err) {
        await connection.rollback();
        console.error('broker create contract error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    } finally {
        connection.release();
    }
});

// GET /api/broker/contracts/:submissionId/summary
// Lấy thông tin tóm tắt hợp đồng cho bước 2
router.get('/contracts/:submissionId/summary', requireAuth, requireRole('broker', 'sale', 'agent', 'manager'), async (req, res) => {
    try {
        const brokerId = req.user.user_id;
        const submissionId = Number(req.params.submissionId);

        if (!Number.isInteger(submissionId)) {
            return res.status(400).json({ message: 'submissionId không hợp lệ' });
        }

        const contract = await getLatestSubmissionContract(submissionId, brokerId);
        if (!contract) {
            return res.status(404).json({ message: 'Không tìm thấy hợp đồng cho hồ sơ này' });
        }

        res.json({
            submission_contract_id: contract.submission_contract_id,
            contract_code: contract.contract_code,
            contract_type: contract.contract_type,
            images_uploaded: contract.images_uploaded,
            status: contract.status,
            signed_at: contract.signed_at,
            owner: {
                full_name: contract.owner_full_name
            }
        });
    } catch (err) {
        console.error('broker contract summary error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// PATCH /api/broker/contracts/:submissionId
// Cập nhật loại hợp đồng (ky gui/gia han)
router.patch('/contracts/:submissionId', requireAuth, requireRole('broker', 'sale', 'agent', 'manager'), async (req, res) => {
    try {
        const brokerId = req.user.user_id;
        const submissionId = Number(req.params.submissionId);
        const { contractType } = req.body;

        if (!Number.isInteger(submissionId)) {
            return res.status(400).json({ message: 'submissionId không hợp lệ' });
        }

        if (!['consignment', 'renewal'].includes(contractType)) {
            return res.status(400).json({ message: 'Loại hợp đồng không hợp lệ' });
        }

        const contract = await getLatestSubmissionContract(submissionId, brokerId);
        if (!contract) {
            return res.status(404).json({ message: 'Không tìm thấy hợp đồng cho hồ sơ này' });
        }

        await db.query(
            'UPDATE submission_contracts SET contract_type = ? WHERE submission_contract_id = ?',
            [contractType, contract.submission_contract_id]
        );

        res.json({ message: 'Cập nhật loại hợp đồng thành công' });
    } catch (err) {
        console.error('broker update contract type error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// POST /api/broker/contracts/:submissionId/scan
// Upload file scan hợp đồng và cập nhật trạng thái hồ sơ
router.post('/contracts/:submissionId/scan', requireAuth, requireRole('broker', 'sale', 'agent', 'manager'), async (req, res) => {
    const fs = require('fs');
    const path = require('path');

    try {
        const brokerId = req.user.user_id;
        const submissionId = Number(req.params.submissionId);
        const { fileName, mimeType, fileDataBase64 } = req.body;

        if (!Number.isInteger(submissionId)) {
            return res.status(400).json({ message: 'submissionId không hợp lệ' });
        }

        if (!fileDataBase64) {
            return res.status(400).json({ message: 'Thiếu dữ liệu tệp tin' });
        }

        const contract = await getLatestSubmissionContract(submissionId, brokerId);
        if (!contract) {
            return res.status(404).json({ message: 'Không tìm thấy hợp đồng cho hồ sơ này' });
        }

        let dataBase64 = fileDataBase64;
        let resolvedMime = mimeType || null;

        const dataUrlMatch = String(fileDataBase64).match(/^data:([^;]+);base64,(.*)$/);
        if (dataUrlMatch) {
            resolvedMime = resolvedMime || dataUrlMatch[1];
            dataBase64 = dataUrlMatch[2];
        }

        const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
        if (resolvedMime && !allowedTypes.includes(resolvedMime)) {
            return res.status(400).json({ message: 'Định dạng tệp tin không hợp lệ' });
        }

        const extMap = {
            'image/jpeg': '.jpg',
            'image/png': '.png',
            'application/pdf': '.pdf'
        };

        const fallbackExt = fileName ? path.extname(fileName) : '';
        const extension = resolvedMime ? extMap[resolvedMime] : fallbackExt || '.bin';
        const safeExt = extension.startsWith('.') ? extension : `.${extension}`;
        const uploadDir = path.join(__dirname, '..', 'uploads', 'contracts');

        await fs.promises.mkdir(uploadDir, { recursive: true });

        const fileId = `${submissionId}-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
        const storedFileName = `contract_${fileId}${safeExt}`;
        const storedPath = path.join(uploadDir, storedFileName);

        await fs.promises.writeFile(storedPath, Buffer.from(dataBase64, 'base64'));

        const publicUrl = `/uploads/contracts/${storedFileName}`;

        await db.query(
            `UPDATE submission_contracts
             SET signed_scan_url = ?, status = 'documents_submitted'
             WHERE submission_contract_id = ?`,
            [publicUrl, contract.submission_contract_id]
        );

        res.json({
            message: 'Tải hồ sơ hợp đồng thành công',
            contract_scan_url: publicUrl,
            status: 'documents_submitted'
        });
    } catch (err) {
        console.error('broker upload contract scan error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// POST /api/broker/appointments
// Tạo lịch khảo sát cho 1 hồ sơ đã được phân công
router.post('/appointments', requireAuth, requireRole('broker', 'sale', 'agent', 'manager'), async (req, res) => {
    try {
        const brokerId = req.user.user_id;
        const { submissionId, scheduledTime, location, note } = req.body;
        const parsedSubmissionId = Number(submissionId);

        if (!Number.isInteger(parsedSubmissionId)) {
            return res.status(400).json({ message: 'submissionId không hợp lệ' });
        }

        if (!scheduledTime || !location) {
            return res.status(400).json({ message: 'Vui lòng nhập thời gian và địa điểm lịch hẹn' });
        }

        const assignedSubmission = await getAssignedSubmission(parsedSubmissionId, brokerId);
        if (!assignedSubmission) {
            return res.status(404).json({ message: 'Không tìm thấy hồ sơ được phân công cho broker hiện tại' });
        }

        const [result] = await db.query(
            `INSERT INTO appointments (assignment_id, submission_id, appointment_type, scheduled_time, location, status, result_note)
             VALUES (NULL, ?, 'khảo sát', ?, ?, 'scheduled', ?)`,
            [parsedSubmissionId, scheduledTime, location, note || null]
        );

        res.status(201).json({
            message: 'Tạo lịch hẹn khảo sát thành công',
            appointment_id: result.insertId,
            submission_id: parsedSubmissionId
        });
    } catch (err) {
        console.error('broker create appointment error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// PATCH /api/broker/appointments/:appointmentId
// Cập nhật trạng thái lịch hẹn khảo sát
router.patch('/appointments/:appointmentId', requireAuth, requireRole('broker', 'sale', 'agent', 'manager'), async (req, res) => {
    try {
        const brokerId = req.user.user_id;
        const appointmentId = Number(req.params.appointmentId);
        const { status, resultNote, scheduledTime, location } = req.body;

        if (!Number.isInteger(appointmentId)) {
            return res.status(400).json({ message: 'appointmentId không hợp lệ' });
        }

        const [existingRows] = await db.query(
            `SELECT ap.appointment_id, ap.submission_id
             FROM appointments ap
             INNER JOIN property_submissions ps ON ps.submission_id = ap.submission_id
             WHERE ap.appointment_id = ?
               AND ps.assigned_sales_id = ?
               AND ap.appointment_type = 'khảo sát'`,
            [appointmentId, brokerId]
        );

        if (existingRows.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy lịch hẹn của broker hiện tại' });
        }

        await db.query(
            `UPDATE appointments
             SET status = COALESCE(?, status),
                 result_note = COALESCE(?, result_note),
                 scheduled_time = COALESCE(?, scheduled_time),
                 location = COALESCE(?, location)
             WHERE appointment_id = ?`,
            [status || null, resultNote || null, scheduledTime || null, location || null, appointmentId]
        );

        res.json({ message: 'Cập nhật lịch hẹn thành công' });
    } catch (err) {
        console.error('broker update appointment error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// POST /api/broker/surveys
// Ghi nhận kết quả khảo sát
router.post('/surveys', requireAuth, requireRole('broker', 'sale', 'agent', 'manager'), async (req, res) => {
    try {
        const brokerId = req.user.user_id;
        const {
            submissionId,
            appointmentId,
            infrastructureChecklist,
            areaChecklist,
            legalChecklist,
            imageChecklist,
            surveyNotes,
            surveyStatus
        } = req.body;

        const parsedSubmissionId = Number(submissionId);
        const parsedAppointmentId = appointmentId === undefined || appointmentId === null || appointmentId === ''
            ? null
            : Number(appointmentId);
        const submissionStatus = mapSurveyToSubmissionStatus(surveyStatus);

        if (!Number.isInteger(parsedSubmissionId)) {
            return res.status(400).json({ message: 'submissionId không hợp lệ' });
        }

        if (!surveyStatus) {
            return res.status(400).json({ message: 'Vui lòng nhập trạng thái khảo sát' });
        }

        const assignedSubmission = await getAssignedSubmission(parsedSubmissionId, brokerId);
        if (!assignedSubmission) {
            return res.status(404).json({ message: 'Không tìm thấy hồ sơ được phân công cho broker hiện tại' });
        }

        if (parsedAppointmentId !== null && !Number.isInteger(parsedAppointmentId)) {
            return res.status(400).json({ message: 'appointmentId không hợp lệ' });
        }

        if (parsedAppointmentId !== null) {
            const [appointmentRows] = await db.query(
                `SELECT ap.appointment_id
                 FROM appointments ap
                 INNER JOIN property_submissions ps ON ps.submission_id = ap.submission_id
                 WHERE ap.appointment_id = ?
                   AND ap.submission_id = ?
                   AND ps.assigned_sales_id = ?
                   AND ap.appointment_type = 'khảo sát'`,
                [parsedAppointmentId, parsedSubmissionId, brokerId]
            );

            if (appointmentRows.length === 0) {
                return res.status(404).json({ message: 'Không tìm thấy lịch khảo sát phù hợp cho hồ sơ này' });
            }
        }

        const [insertResult] = await db.query(
            `INSERT INTO survey_records (
                submission_id,
                surveyor_id,
                appointment_id,
                infrastructure_checklist,
                area_checklist,
                legal_checklist,
                image_checklist,
                survey_notes,
                survey_status,
                completed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [
                parsedSubmissionId,
                brokerId,
                parsedAppointmentId,
                normalizeTextField(infrastructureChecklist),
                normalizeTextField(areaChecklist),
                normalizeTextField(legalChecklist),
                normalizeTextField(imageChecklist),
                surveyNotes || null,
                surveyStatus
            ]
        );

        if (parsedAppointmentId !== null && submissionStatus) {
            await db.query(
                `UPDATE appointments
                 SET status = 'completed',
                     result_note = COALESCE(?, result_note)
                 WHERE appointment_id = ?`,
                [surveyNotes || null, parsedAppointmentId]
            );
        }

        if (submissionStatus) {
            await db.query(
                'UPDATE property_submissions SET status = ? WHERE submission_id = ?',
                [submissionStatus, parsedSubmissionId]
            );
        }

        res.status(201).json({
            message: 'Đã ghi nhận kết quả khảo sát',
            survey_id: insertResult.insertId,
            submission_id: parsedSubmissionId
        });
    } catch (err) {
        console.error('broker submit survey error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// GET /api/broker/surveys/:submissionId
// Lấy lịch sử khảo sát của hồ sơ được phân công
router.get('/surveys/:submissionId', requireAuth, requireRole('broker', 'sale', 'agent', 'manager'), async (req, res) => {
    try {
        const brokerId = req.user.user_id;
        const submissionId = Number(req.params.submissionId);

        if (!Number.isInteger(submissionId)) {
            return res.status(400).json({ message: 'submissionId không hợp lệ' });
        }

        const assignedSubmission = await getAssignedSubmission(submissionId, brokerId);
        if (!assignedSubmission) {
            return res.status(404).json({ message: 'Không tìm thấy hồ sơ được phân công cho broker hiện tại' });
        }

        const [rows] = await db.query(
            `SELECT survey_id, submission_id, surveyor_id, appointment_id,
                    infrastructure_checklist, area_checklist, legal_checklist, image_checklist,
                    survey_notes, survey_status, completed_at
             FROM survey_records
             WHERE submission_id = ?
             ORDER BY completed_at DESC, survey_id DESC`,
            [submissionId]
        );

        res.json({
            submission_id: submissionId,
            request_code: toRequestCode(submissionId),
            items: rows
        });
    } catch (err) {
        console.error('broker survey history error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

module.exports = router;