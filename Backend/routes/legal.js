const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const VALID_STATUSES = ['Approved', 'Changes Requested', 'Rejected', 'Pending', 'pending'];

function normalizeStatus(status) {
    if (!status) return null;
    if (status === 'pending' || status === 'Pending') return 'Pending';
    if (status === 'Approved') return 'Approved';
    if (status === 'Changes Requested') return 'Changes Requested';
    if (status === 'Rejected') return 'Rejected';
    return null;
}

// GET /api/legal/approvals
// Danh sach ho so can tham dinh
router.get('/approvals', requireAuth, requireRole('legal', 'manager'), async (req, res) => {
    try {
        const { status, search, limit = 20, offset = 0 } = req.query;
        const conditions = [];
        const params = [];

        if (status) {
            conditions.push('cla.status = ?');
            params.push(status);
        }

        if (search) {
            const keyword = `%${search}%`;
            conditions.push('(sc.contract_code LIKE ? OR u.full_name LIKE ?)');
            params.push(keyword, keyword);
        }

        const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        const [totalRows] = await db.query(
            `SELECT COUNT(*) AS total
             FROM contract_legal_approvals cla
             INNER JOIN submission_contracts sc ON sc.submission_contract_id = cla.submission_contract_id
             INNER JOIN property_submissions ps ON ps.submission_id = sc.submission_id
             LEFT JOIN users u ON u.user_id = ps.assigned_sales_id
             ${whereSql}`,
            params
        );

        const total = Number(totalRows[0]?.total || 0);

        const [rows] = await db.query(
            `SELECT
                cla.submission_contract_id,
                cla.status AS legal_status,
                sc.contract_code,
                sc.contract_type,
                sc.contract_duration_months,
                sc.final_price,
                ps.submission_id,
                ps.assigned_sales_id,
                ps.submitted_at,
                u.full_name AS assigned_sales_name,
                u.email AS assigned_sales_email
             FROM contract_legal_approvals cla
             INNER JOIN submission_contracts sc ON sc.submission_contract_id = cla.submission_contract_id
             INNER JOIN property_submissions ps ON ps.submission_id = sc.submission_id
             LEFT JOIN users u ON u.user_id = ps.assigned_sales_id
             ${whereSql}
             ORDER BY ps.submitted_at DESC, sc.submission_contract_id DESC
             LIMIT ? OFFSET ?`,
            [...params, Number(limit), Number(offset)]
        );

        res.json({
            total,
            items: rows.map(row => ({
                submission_contract_id: row.submission_contract_id,
                contract_code: row.contract_code,
                contract_type: row.contract_type,
                contract_duration_months: row.contract_duration_months,
                final_price: row.final_price,
                legal_status: row.legal_status,
                submitted_at: row.submitted_at,
                assigned_sales: row.assigned_sales_id ? {
                    user_id: row.assigned_sales_id,
                    full_name: row.assigned_sales_name,
                    email: row.assigned_sales_email
                } : null
            }))
        });
    } catch (err) {
        console.error('legal approvals list error:', err);
        res.status(500).json({ message: 'Loi server: ' + err.message });
    }
});

// GET /api/legal/approvals/:submissionContractId
router.get('/approvals/:submissionContractId', requireAuth, requireRole('legal', 'manager'), async (req, res) => {
    try {
        const submissionContractId = Number(req.params.submissionContractId);

        if (!Number.isInteger(submissionContractId)) {
            return res.status(400).json({ message: 'submissionContractId khong hop le' });
        }

        const [rows] = await db.query(
            `SELECT
                cla.submission_contract_id,
                cla.status AS legal_status,
                cla.special_terms_requested,
                cla.review_comment,
                cla.reviewed_by,
                cla.reviewed_at,
                sc.contract_code,
                sc.contract_type,
                sc.contract_duration_months,
                sc.final_price,
                ps.submission_id,
                ps.assigned_sales_id,
                u.full_name AS assigned_sales_name,
                u.email AS assigned_sales_email
             FROM contract_legal_approvals cla
             INNER JOIN submission_contracts sc ON sc.submission_contract_id = cla.submission_contract_id
             INNER JOIN property_submissions ps ON ps.submission_id = sc.submission_id
             LEFT JOIN users u ON u.user_id = ps.assigned_sales_id
             WHERE cla.submission_contract_id = ?
             LIMIT 1`,
            [submissionContractId]
        );

        const row = rows[0];
        if (!row) {
            return res.status(404).json({ message: 'Khong tim thay ho so tham dinh' });
        }

        res.json({
            submission_contract_id: row.submission_contract_id,
            contract_code: row.contract_code,
            contract_type: row.contract_type,
            contract_duration_months: row.contract_duration_months,
            final_price: row.final_price,
            special_terms_requested: row.special_terms_requested,
            legal_status: row.legal_status,
            review_comment: row.review_comment,
            reviewed_by: row.reviewed_by,
            reviewed_at: row.reviewed_at,
            assigned_sales: row.assigned_sales_id ? {
                user_id: row.assigned_sales_id,
                full_name: row.assigned_sales_name,
                email: row.assigned_sales_email
            } : null
        });
    } catch (err) {
        console.error('legal approval detail error:', err);
        res.status(500).json({ message: 'Loi server: ' + err.message });
    }
});

// PATCH /api/legal/approvals/:submissionContractId
router.patch('/approvals/:submissionContractId', requireAuth, requireRole('legal', 'manager'), async (req, res) => {
    try {
        const submissionContractId = Number(req.params.submissionContractId);
        const { status, review_comment } = req.body;

        if (!Number.isInteger(submissionContractId)) {
            return res.status(400).json({ message: 'submissionContractId khong hop le' });
        }

        const normalizedStatus = normalizeStatus(status);
        if (!normalizedStatus) {
            return res.status(400).json({ message: 'Trang thai khong hop le' });
        }

        const [existingRows] = await db.query(
            'SELECT submission_contract_id FROM contract_legal_approvals WHERE submission_contract_id = ? LIMIT 1',
            [submissionContractId]
        );

        if (existingRows.length === 0) {
            return res.status(404).json({ message: 'Khong tim thay ho so tham dinh' });
        }

        await db.query(
            `UPDATE contract_legal_approvals
             SET status = ?, review_comment = ?, reviewed_by = ?, reviewed_at = NOW()
             WHERE submission_contract_id = ?`,
            [normalizedStatus, review_comment || null, req.user.user_id, submissionContractId]
        );

        res.json({ message: 'Cap nhat tham dinh thanh cong' });
    } catch (err) {
        console.error('legal approval update error:', err);
        res.status(500).json({ message: 'Loi server: ' + err.message });
    }
});

module.exports = router;
