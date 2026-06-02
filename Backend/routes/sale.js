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

function toSearchableText(value) {
    const lower = String(value || '').toLowerCase();
    return lower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function mapSurveyToSubmissionStatus(surveyStatus) {
    const text = toSearchableText(surveyStatus);
    if (text.includes('draft') || text.includes('nháp')) return null;
    if (text.includes('khong dat') || text.includes('fail') || text.includes('reject')) return 'rejected';
    if (text.includes('dat') || text.includes('pass') || text.includes('complete') || text.includes('hoan tat')) return 'surveyed';
    return 'surveyed';
}

function isFailedSurveyStatus(surveyStatus) {
    const text = toSearchableText(surveyStatus);
    return text.includes('khong dat') || text.includes('fail') || text.includes('reject');
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

async function getAssignedSubmission(submissionId, saleId) {
    const [rows] = await db.query(
        `SELECT ps.*, u.full_name AS owner_name, u.phone AS owner_phone, u.email AS owner_email
         FROM property_submissions ps
         LEFT JOIN users u ON u.user_id = ps.owner_id
         WHERE ps.submission_id = ? AND ps.assigned_sales_id = ?
         LIMIT 1`,
        [submissionId, saleId]
    );
    return rows[0] || null;
}

async function getAssignedSubmissionContractDraft(submissionId, saleId) {
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
        [submissionId, saleId]
    );
    return rows[0] || null;
}

async function getLatestSubmissionContract(submissionId, saleId) {
    const [rows] = await db.query(
        `SELECT sc.submission_contract_id, sc.contract_code, sc.contract_type, sc.signed_scan_url AS contract_scan_url,
            sc.status, sc.signed_at, u.full_name AS owner_full_name
         FROM submission_contracts sc
         INNER JOIN property_submissions ps ON ps.submission_id = sc.submission_id
         LEFT JOIN users u ON u.user_id = ps.owner_id
         WHERE sc.submission_id = ? AND ps.assigned_sales_id = ?
         ORDER BY sc.submission_contract_id DESC
         LIMIT 1`,
        [submissionId, saleId]
    );
    return rows[0] || null;
}

// GET /api/sale/assignments
// Danh sách hồ sơ được phân công cho sale hiện tại
router.get('/assignments', requireAuth, requireRole('sale', 'agent', 'manager'), async (req, res) => {
    try {
        const { status, search, limit = 20, offset = 0 } = req.query;
        const saleId = req.user.user_id;

        const conditions = ['ps.assigned_sales_id = ?'];
        const params = [saleId];

        if (status) {
            if (status === 'surveyed') {
                conditions.push("ps.status IN ('surveyed', 'approved')");
            } else {
                conditions.push('ps.status = ?');
                params.push(status);
            }
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
                sc.contract_type,
                sc.status AS contract_status,
                cla.status AS legal_status,
                cla.review_comment AS legal_review_comment,
                cla.reviewed_at AS legal_reviewed_at,
                MAX(ap.scheduled_time) AS latest_appointment_time,
                SUBSTRING_INDEX(GROUP_CONCAT(ap.status ORDER BY ap.scheduled_time DESC SEPARATOR ','), ',', 1) AS latest_appointment_status,
                MAX(sr.completed_at) AS latest_survey_time,
                SUBSTRING_INDEX(GROUP_CONCAT(sr.survey_status ORDER BY sr.completed_at DESC SEPARATOR ','), ',', 1) AS latest_survey_status,
                ce.extension_id,
                ce.status AS extension_status,
                ce.extension_months
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
             LEFT JOIN contract_extensions ce 
               ON ce.submission_contract_id = sc.submission_contract_id 
              AND ce.status = 'pending'
             WHERE ${whereSql}
             GROUP BY ps.submission_id, u.user_id, sc.submission_contract_id, sc.contract_type, sc.status, cla.status, cla.review_comment, cla.reviewed_at, ce.extension_id, ce.status, ce.extension_months
             ORDER BY ps.submitted_at DESC, ps.submission_id DESC
             LIMIT ? OFFSET ?`,
            [...params, Number(limit), Number(offset)]
        );

        res.json({
            sale_id: saleId,
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
                contract_type: row.contract_type,
                contract_status: row.contract_status,
                legal_status: row.legal_status,
                legal_review_comment: row.legal_review_comment,
                legal_reviewed_at: row.legal_reviewed_at,
                extension_id: row.extension_id,
                extension_status: row.extension_status,
                extension_months: row.extension_months,
                request_type: (row.extension_id && row.extension_status === 'pending') ? 'Gia hạn' : 'Đăng ký',
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
        console.error('sale assignments error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// GET /api/sale/contracts/:submissionId/legal-response
// Lay phan hoi tu bo phan phap ly cho ho so hop dong moi nhat
router.get('/contracts/:submissionId/legal-response', requireAuth, requireRole('sale', 'agent', 'manager'), async (req, res) => {
    try {
        const saleId = req.user.user_id;
        const submissionId = Number(req.params.submissionId);

        if (!Number.isInteger(submissionId)) {
            return res.status(400).json({ message: 'submissionId khong hop le' });
        }

        const assignedSubmission = await getAssignedSubmission(submissionId, saleId);
        if (!assignedSubmission) {
            return res.status(404).json({ message: 'Khong tim thay ho so duoc phan cong cho sale hien tai' });
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
        console.error('sale legal response error:', err);
        res.status(500).json({ message: 'Loi server: ' + err.message });
    }
});

// GET /api/sale/appointments
// Danh sách lịch khảo sát của sale hiện tại
router.get('/appointments', requireAuth, requireRole('sale', 'agent', 'manager'), async (req, res) => {
    try {
        const { submissionId, status, search, from, to, limit = 30, offset = 0 } = req.query;
        const saleId = req.user.user_id;

        const conditions = [
            'ps.assigned_sales_id = ?',
            "ap.appointment_type = 'khảo sát'"
        ];
        const params = [saleId];

        if (submissionId) {
            conditions.push('ap.submission_id = ?');
            params.push(Number(submissionId));
        }

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
            sale_id: saleId,
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
        console.error('sale appointments error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// GET /api/sale/contracts/:submissionId
// Lấy dữ liệu khởi tạo hợp đồng cho hồ sơ được phân công
router.get('/contracts/:submissionId', requireAuth, requireRole('sale', 'agent', 'manager'), async (req, res) => {
    try {
        const saleId = req.user.user_id;
        const submissionId = Number(req.params.submissionId);

        if (!Number.isInteger(submissionId)) {
            return res.status(400).json({ message: 'submissionId không hợp lệ' });
        }

        // Truy vấn hợp đồng mới nhất từ SUBMISSION_CONTRACTS
        const [contracts] = await db.query(
            `SELECT sc.submission_contract_id, sc.contract_code, sc.contract_type, sc.signed_at,
                    sc.contract_duration_months,
                    ps.submission_id,
                    ps.address AS property_address,
                    ps.direction AS property_direction,
                    ps.proposed_price AS property_proposed_price,
                    u.full_name AS owner_full_name,
                    u.phone AS owner_phone,
                    u.id_card AS owner_id_card,
                    cla.status AS legal_status,
                    cla.special_terms_requested
             FROM submission_contracts sc
             INNER JOIN property_submissions ps ON ps.submission_id = sc.submission_id
             LEFT JOIN users u ON u.user_id = ps.owner_id
             LEFT JOIN contract_legal_approvals cla ON cla.submission_contract_id = sc.submission_contract_id
             WHERE sc.submission_id = ? AND ps.assigned_sales_id = ?
             ORDER BY sc.submission_contract_id DESC
             LIMIT 1`,
            [submissionId, saleId]
        );

        if (contracts.length > 0) {
            const contract = contracts[0];
            return res.json({
                submission_id: contract.submission_id,
                submission_contract_id: contract.submission_contract_id,
                contract_code: contract.contract_code,
                contract_type: contract.contract_type,
                contract_duration_months: contract.contract_duration_months,
                special_terms: contract.special_terms_requested,
                legal_status: contract.legal_status,
                owner: {
                    full_name: contract.owner_full_name,
                    phone: contract.owner_phone,
                    id_card: contract.owner_id_card,
                    address: null
                },
                property: {
                    address: contract.property_address,
                    direction: contract.property_direction,
                    proposed_price: contract.property_proposed_price
                }
            });
        }

        // Dự phòng: nếu chưa tạo hợp đồng, lấy thông tin nháp từ property_submissions & users
        const draft = await getAssignedSubmissionContractDraft(submissionId, saleId);
        if (!draft) {
            return res.status(404).json({ message: 'Không tìm thấy hồ sơ được phân công cho sale hiện tại' });
        }

        res.json({
            submission_id: draft.submission_id,
            contract_code: null,
            contract_type: null,
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
        console.error('sale contract draft error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// POST /api/sale/contracts
// Tạo hợp đồng ký gửi cho hồ sơ đã phân công
router.post('/contracts', requireAuth, requireRole('sale', 'agent', 'manager'), async (req, res) => {
    const connection = await db.getConnection();
    try {
        const saleId = req.user.user_id;
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

        const assignedSubmission = await getAssignedSubmission(parsedSubmissionId, saleId);
        if (!assignedSubmission) {
            return res.status(404).json({ message: 'Không tìm thấy hồ sơ được phân công cho sale hiện tại' });
        }

        if (['rejected', 'cancelled'].includes(String(assignedSubmission.status || '').toLowerCase())) {
            return res.status(400).json({ message: 'Hồ sơ đã bị từ chối/hủy, không thể lập hợp đồng' });
        }

        const [latestSurveyRows] = await db.query(
            `SELECT survey_status
             FROM survey_records
             WHERE submission_id = ?
             ORDER BY completed_at DESC, survey_id DESC
             LIMIT 1`,
            [parsedSubmissionId]
        );

        if (latestSurveyRows.length === 0) {
            return res.status(400).json({ message: 'Chưa có kết quả khảo sát, không thể lập hợp đồng' });
        }

        if (isFailedSurveyStatus(latestSurveyRows[0].survey_status)) {
            return res.status(400).json({ message: 'Kết quả khảo sát không đạt, hồ sơ không được phép lập hợp đồng' });
        }

        if (String(assignedSubmission.status || '').toLowerCase() !== 'surveyed') {
            return res.status(400).json({ message: 'Hồ sơ chưa ở trạng thái đã khảo sát đạt, không thể lập hợp đồng' });
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
        console.error('sale create contract error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    } finally {
        connection.release();
    }
});

// GET /api/sale/contracts/:submissionId/summary
// Lấy thông tin tóm tắt hợp đồng cho bước 2
router.get('/contracts/:submissionId/summary', requireAuth, requireRole('sale', 'agent', 'manager'), async (req, res) => {
    try {
        const saleId = req.user.user_id;
        const submissionId = Number(req.params.submissionId);

        if (!Number.isInteger(submissionId)) {
            return res.status(400).json({ message: 'submissionId không hợp lệ' });
        }

        const contract = await getLatestSubmissionContract(submissionId, saleId);
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
        console.error('sale contract summary error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// PATCH /api/sale/contracts/:submissionId
// Cập nhật loại hợp đồng (ky gui/gia han)
router.patch('/contracts/:submissionId', requireAuth, requireRole('sale', 'agent', 'manager'), async (req, res) => {
    try {
        const saleId = req.user.user_id;
        const submissionId = Number(req.params.submissionId);
        let { contractType } = req.body;

        if (!Number.isInteger(submissionId)) {
            return res.status(400).json({ message: 'submissionId không hợp lệ' });
        }

        if (contractType === 'Ký gửi') contractType = 'consignment';
        if (contractType === 'Gia hạn') contractType = 'renewal';

        if (!['consignment', 'renewal'].includes(contractType)) {
            return res.status(400).json({ message: 'Loại hợp đồng không hợp lệ' });
        }

        const contract = await getLatestSubmissionContract(submissionId, saleId);
        if (!contract) {
            return res.status(404).json({ message: 'Không tìm thấy hợp đồng cho hồ sơ này' });
        }

        await db.query(
            'UPDATE submission_contracts SET contract_type = ? WHERE submission_contract_id = ?',
            [contractType, contract.submission_contract_id]
        );

        res.json({ message: 'Cập nhật loại hợp đồng thành công' });
    } catch (err) {
        console.error('sale update contract type error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// POST /api/sale/contracts/:submissionId/scan
// Upload file scan hợp đồng và cập nhật trạng thái hồ sơ
router.post('/contracts/:submissionId/scan', requireAuth, requireRole('sale', 'agent', 'manager'), async (req, res) => {
    const fs = require('fs');
    const path = require('path');

    try {
        const saleId = req.user.user_id;
        const submissionId = Number(req.params.submissionId);
        const { fileName, mimeType, fileDataBase64 } = req.body;

        if (!Number.isInteger(submissionId)) {
            return res.status(400).json({ message: 'submissionId không hợp lệ' });
        }

        if (!fileDataBase64) {
            return res.status(400).json({ message: 'Thiếu dữ liệu tệp tin' });
        }

        const contract = await getLatestSubmissionContract(submissionId, saleId);
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
        console.error('sale upload contract scan error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// PATCH /api/sale/contracts/:submissionId/deposit
// Xac nhan thanh toan coc va cap nhat giao dich
router.patch('/contracts/:submissionId/deposit', requireAuth, requireRole('sale', 'agent', 'manager'), async (req, res) => {
    try {
        const saleId = req.user.user_id;
        const submissionId = Number(req.params.submissionId);
        const { status, paymentMethod } = req.body;

        if (!Number.isInteger(submissionId)) {
            return res.status(400).json({ message: 'submissionId khong hop le' });
        }

        const contract = await getLatestSubmissionContract(submissionId, saleId);
        if (!contract) {
            return res.status(404).json({ message: 'Khong tim thay hop dong cho ho so nay' });
        }

        const [rows] = await db.query(
            `SELECT transaction_id
             FROM deposit_transactions
             WHERE submission_contract_id = ?
             ORDER BY transaction_id DESC
             LIMIT 1`,
            [contract.submission_contract_id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Khong tim thay giao dich coc' });
        }

        const transactionId = rows[0].transaction_id;
        const nextStatus = status ? String(status).trim() : 'Completed';
        const nextPaymentMethod = paymentMethod ? String(paymentMethod).trim() : 'Chuyen khoan / VietQR';
        const shouldStamp = ['completed', 'verified'].includes(nextStatus.toLowerCase());

        await db.query(
            `UPDATE deposit_transactions
             SET status = ?,
                 payment_method = ?,
                 verified_at = CASE WHEN ? THEN NOW() ELSE verified_at END
             WHERE transaction_id = ?`,
            [nextStatus, nextPaymentMethod, shouldStamp, transactionId]
        );

        if (shouldStamp) {
            // Đồng bộ trạng thái hợp đồng sang 'active'
            await db.query(
                `UPDATE submission_contracts
                 SET status = 'active'
                 WHERE submission_contract_id = ?`,
                [contract.submission_contract_id]
            );

            // Đồng bộ trạng thái hồ sơ ký gửi sang 'approved'
            await db.query(
                `UPDATE property_submissions
                 SET status = 'approved'
                 WHERE submission_id = ?`,
                [submissionId]
            );
        }

        const [updatedRows] = await db.query(
            `SELECT transaction_id, status, payment_method, verified_at
             FROM deposit_transactions
             WHERE transaction_id = ?`,
            [transactionId]
        );

        res.json({
            message: 'Da cap nhat giao dich coc',
            transaction: updatedRows[0] || null
        });
    } catch (err) {
        console.error('sale update deposit error:', err);
        res.status(500).json({ message: 'Loi server: ' + err.message });
    }
});

// POST /api/sale/appointments
// Tạo lịch khảo sát cho 1 hồ sơ đã được phân công
router.post('/appointments', requireAuth, requireRole('sale', 'agent', 'manager'), async (req, res) => {
    try {
        const saleId = req.user.user_id;
        const { submissionId, scheduledTime, location, note } = req.body;
        const parsedSubmissionId = Number(submissionId);

        if (!Number.isInteger(parsedSubmissionId)) {
            return res.status(400).json({ message: 'submissionId không hợp lệ' });
        }

        if (!scheduledTime || !location) {
            return res.status(400).json({ message: 'Vui lòng nhập thời gian và địa điểm lịch hẹn' });
        }

        const assignedSubmission = await getAssignedSubmission(parsedSubmissionId, saleId);
        if (!assignedSubmission) {
            return res.status(404).json({ message: 'Không tìm thấy hồ sơ được phân công cho sale hiện tại' });
        }

        const [result] = await db.query(
            `INSERT INTO appointments (assignment_id, submission_id, appointment_type, scheduled_time, location, status, result_note)
             VALUES (NULL, ?, 'khảo sát', ?, ?, 'Đã đặt', ?)`,
            [parsedSubmissionId, scheduledTime, location, note || null]
        );

        res.status(201).json({
            message: 'Tạo lịch hẹn khảo sát thành công',
            appointment_id: result.insertId,
            submission_id: parsedSubmissionId
        });
    } catch (err) {
        console.error('sale create appointment error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// PATCH /api/sale/appointments/:appointmentId
// Cập nhật trạng thái lịch hẹn khảo sát
router.patch('/appointments/:appointmentId', requireAuth, requireRole('sale', 'agent', 'manager'), async (req, res) => {
    try {
        const saleId = req.user.user_id;
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
            [appointmentId, saleId]
        );

        if (existingRows.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy lịch hẹn của sale hiện tại' });
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
        console.error('sale update appointment error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// POST /api/sale/surveys
// Ghi nhận kết quả khảo sát
router.post('/surveys', requireAuth, requireRole('sale', 'agent', 'manager'), async (req, res) => {
    try {
        const saleId = req.user.user_id;
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
        const parsedAppointmentId = Number(appointmentId);
        const submissionStatus = mapSurveyToSubmissionStatus(surveyStatus);

        if (!Number.isInteger(parsedSubmissionId)) {
            return res.status(400).json({ message: 'submissionId không hợp lệ' });
        }

        if (!surveyStatus) {
            return res.status(400).json({ message: 'Vui lòng nhập trạng thái khảo sát' });
        }

        const assignedSubmission = await getAssignedSubmission(parsedSubmissionId, saleId);
        if (!assignedSubmission) {
            return res.status(404).json({ message: 'Không tìm thấy hồ sơ được phân công cho sale hiện tại' });
        }

        if (!Number.isInteger(parsedAppointmentId)) {
            return res.status(400).json({ message: 'appointmentId là bắt buộc và phải hợp lệ' });
        }

        const [appointmentRows] = await db.query(
            `SELECT ap.appointment_id
             FROM appointments ap
             INNER JOIN property_submissions ps ON ps.submission_id = ap.submission_id
             WHERE ap.appointment_id = ?
               AND ap.submission_id = ?
               AND ps.assigned_sales_id = ?
               AND ap.appointment_type = 'khảo sát'`,
            [parsedAppointmentId, parsedSubmissionId, saleId]
        );

        if (appointmentRows.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy lịch khảo sát phù hợp cho hồ sơ này' });
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
                saleId,
                parsedAppointmentId,
                normalizeTextField(infrastructureChecklist),
                normalizeTextField(areaChecklist),
                normalizeTextField(legalChecklist),
                normalizeTextField(imageChecklist),
                surveyNotes || null,
                surveyStatus
            ]
        );

        if (submissionStatus) {
            await db.query(
                `UPDATE appointments
                 SET status = 'hoàn tất',
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
        console.error('sale submit survey error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// GET /api/sale/surveys/:submissionId
// Lấy lịch sử khảo sát của hồ sơ được phân công
router.get('/surveys/:submissionId', requireAuth, requireRole('sale', 'agent', 'manager'), async (req, res) => {
    try {
        const saleId = req.user.user_id;
        const submissionId = Number(req.params.submissionId);

        if (!Number.isInteger(submissionId)) {
            return res.status(400).json({ message: 'submissionId không hợp lệ' });
        }

        const assignedSubmission = await getAssignedSubmission(submissionId, saleId);
        if (!assignedSubmission) {
            return res.status(404).json({ message: 'Không tìm thấy hồ sơ được phân công cho sale hiện tại' });
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
        console.error('sale survey history error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// POST /api/sale/sepay-webhook
// Nhận webhook từ SePay khi có biến động số dư chuyển khoản đặt cọc
router.post('/sepay-webhook', async (req, res) => {
    try {
        const fs = require('fs');
        const path = require('path');
        const logMsg = `[${new Date().toLocaleString()}] Payload: ${JSON.stringify(req.body)}\n`;
        fs.appendFileSync(path.join(__dirname, '..', 'sepay_webhook.log'), logMsg);

        const desc = req.body.transferDesc || req.body.content || req.body.code || '';
        
        // Loại bỏ khoảng trắng và dấu gạch ngang để tương thích với cả nội dung viết liền
        const cleanDesc = String(desc).replace(/[\s-]/g, '').toUpperCase();
        
        // Hỗ trợ cả định dạng HD-XXXXX-XXXX (khi bỏ dấu là HDXXXXXXXXX)
        const match = cleanDesc.match(/HD\d{5}\d{4}/);
        
        if (!match) {
            return res.status(400).json({ message: 'Không tìm thấy mã hợp đồng hợp lệ trong nội dung chuyển khoản' });
        }

        const rawCode = match[0];
        // Khôi phục lại định dạng ban đầu có dấu gạch ngang: HD-XXXXX-XXXX
        const contractCode = `HD-${rawCode.substring(2, 7)}-${rawCode.substring(7, 11)}`;
        
        // 1. Kiểm tra hợp đồng tồn tại
        const [contracts] = await db.query(
            'SELECT submission_contract_id, submission_id FROM submission_contracts WHERE contract_code = ? LIMIT 1',
            [contractCode]
        );

        if (contracts.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy hợp đồng khớp với mã này' });
        }

        const contractId = contracts[0].submission_contract_id;
        const submissionId = contracts[0].submission_id;

        // 2. Đối chiếu số tiền (Cố định phí cọc là 10.000đ, SePay gửi số tiền qua trường transferAmount)
        const amountReceived = Number(req.body.transferAmount || req.body.amount || 0);
        if (Number.isNaN(amountReceived) || amountReceived < 10000) {
            return res.status(400).json({ message: 'Số tiền thanh toán không đủ 10.000đ' });
        }

        // 3. Tìm giao dịch cọc Pending mới nhất
        const [depositRows] = await db.query(
            'SELECT transaction_id, status FROM deposit_transactions WHERE submission_contract_id = ? ORDER BY transaction_id DESC LIMIT 1',
            [contractId]
        );

        if (depositRows.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy giao dịch đặt cọc' });
        }

        const transactionId = depositRows[0].transaction_id;

        // 4. Cập nhật trạng thái sang Completed và lưu mã giao dịch thực tế từ SePay
        // Ưu tiên referenceCode (mã giao dịch ngân hàng của SePay) hoặc id (mã giao dịch SePay)
        const sepayCode = req.body.referenceCode || req.body.id || req.body.code || `PAY-SEPAY-${Date.now()}`;
        await db.query(
            `UPDATE deposit_transactions
             SET status = 'Completed', 
                 verified_at = NOW(), 
                 payment_method = ?,
                 transaction_code = ?
             WHERE transaction_id = ?`,
            ['Chuyển khoản / VietQR', String(sepayCode), transactionId]
        );

        // 5. Cập nhật trạng thái hợp đồng ký gửi sang 'active'
        await db.query(
            `UPDATE submission_contracts
             SET status = 'active'
             WHERE submission_contract_id = ?`,
            [contractId]
        );

        // 6. Cập nhật trạng thái hồ sơ ký gửi sang 'approved'
        await db.query(
            `UPDATE property_submissions
             SET status = 'approved'
             WHERE submission_id = ?`,
            [submissionId]
        );

        // 5. Phát tín hiệu real-time qua Socket.io
        if (global.io) {
            global.io.to(contractCode).emit('paymentCompleted', {
                contractCode,
                status: 'Completed',
                amount: amountReceived,
                verifiedAt: new Date()
            });
            console.log(`[Socket.io] Real-time completed notification sent to room: ${contractCode}`);
        }

        res.json({
            status: 'success',
            message: 'Giao dịch đặt cọc đã được đối soát & xác thực thành công'
        });
    } catch (err) {
        console.error('sepay webhook error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// GET /api/sale/extensions/:extensionId
// Lấy chi tiết yêu cầu gia hạn
router.get('/extensions/:extensionId', requireAuth, requireRole('sale', 'agent', 'manager'), async (req, res) => {
    try {
        const extensionId = Number(req.params.extensionId);
        if (!Number.isInteger(extensionId)) {
            return res.status(400).json({ message: 'extensionId không hợp lệ' });
        }

        const [rows] = await db.query(
            `SELECT ce.*, sc.contract_code, sc.contract_type AS old_contract_type, ps.submission_id, ps.address
             FROM contract_extensions ce
             INNER JOIN submission_contracts sc ON sc.submission_contract_id = ce.submission_contract_id
             INNER JOIN property_submissions ps ON ps.submission_id = sc.submission_id
             WHERE ce.extension_id = ? LIMIT 1`,
            [extensionId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy yêu cầu gia hạn' });
        }

        res.json(rows[0]);
    } catch (err) {
        console.error('get extension detail error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// POST /api/sale/contracts/:submissionId/extend/:extensionId/complete
// Tải lên scan hợp đồng gia hạn và hoàn tất quy trình gia hạn (không cần cọc)
router.post('/contracts/:submissionId/extend/:extensionId/complete', requireAuth, requireRole('sale', 'agent', 'manager'), async (req, res) => {
    const fs = require('fs');
    const path = require('path');
    const connection = await db.getConnection();

    try {
        const saleId = req.user.user_id;
        const submissionId = Number(req.params.submissionId);
        const extensionId = Number(req.params.extensionId);
        const { fileName, mimeType, fileDataBase64 } = req.body;

        if (!Number.isInteger(submissionId) || !Number.isInteger(extensionId)) {
            return res.status(400).json({ message: 'Tham số không hợp lệ' });
        }

        if (!fileDataBase64) {
            return res.status(400).json({ message: 'Thiếu dữ liệu tệp tin scan hợp đồng' });
        }

        // Lấy chi tiết yêu cầu gia hạn
        const [extensions] = await connection.query(
            `SELECT ce.*, sc.submission_contract_id, sc.contract_duration_months, sc.contract_code
             FROM contract_extensions ce
             INNER JOIN submission_contracts sc ON sc.submission_contract_id = ce.submission_contract_id
             INNER JOIN property_submissions ps ON ps.submission_id = sc.submission_id
             WHERE ce.extension_id = ? AND ps.assigned_sales_id = ? AND ce.status = 'pending' LIMIT 1`,
            [extensionId, saleId]
        );

        if (extensions.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy yêu cầu gia hạn đang chờ xử lý của sale này' });
        }

        const ext = extensions[0];

        // Xử lý lưu file scan đính kèm tương tự upload scan gốc
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

        const fileId = `extend_${submissionId}-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
        const storedFileName = `contract_${fileId}${safeExt}`;
        const storedPath = path.join(uploadDir, storedFileName);

        await fs.promises.writeFile(storedPath, Buffer.from(dataBase64, 'base64'));

        const publicUrl = `/uploads/contracts/${storedFileName}`;

        // Bắt đầu transaction
        await connection.beginTransaction();

        // 1. Cập nhật bảng contract_extensions thành completed
        await connection.query(
            `UPDATE contract_extensions 
             SET status = 'completed',
                 processed_by = ?,
                 notes = 'Đã tải lên scan hợp đồng gia hạn và hoàn tất.'
             WHERE extension_id = ?`,
            [saleId, extensionId]
        );

        // 2. Cập nhật hợp đồng gốc: cộng thêm thời hạn, cập nhật scan mới, giữ trạng thái active
        const newDuration = ext.contract_duration_months + ext.extension_months;
        await connection.query(
            `UPDATE submission_contracts 
             SET contract_duration_months = ?,
                 signed_scan_url = ?,
                 status = 'active',
                 signed_at = NOW()
             WHERE submission_contract_id = ?`,
            [newDuration, publicUrl, ext.submission_contract_id]
        );

        // 3. Đảm bảo trạng thái hồ sơ ký gửi cũng là approved
        await connection.query(
            `UPDATE property_submissions 
             SET status = 'approved'
             WHERE submission_id = ?`,
            [submissionId]
        );

        await connection.commit();

        res.json({
            message: 'Đã hoàn tất quy trình gia hạn hợp đồng thành công! Không cần đặt cọc.',
            contract_scan_url: publicUrl,
            new_duration_months: newDuration
        });

    } catch (err) {
        await connection.rollback();
        console.error('complete extension error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    } finally {
        connection.release();
    }
});

module.exports = router;