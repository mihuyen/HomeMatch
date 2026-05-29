const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/accountant/contracts/expired
// Lấy danh sách hợp đồng hết hạn cần hoàn cọc & các thông số thống kê
router.get('/contracts/expired', requireAuth, requireRole('accountant', 'manager'), async (req, res) => {
    try {
        // 1. Thống kê "Tổng yêu cầu hoàn tiền" (đã hết hạn & chưa hoàn cọc)
        const [totalReqRows] = await db.query(
            `SELECT COUNT(*) AS count
             FROM submission_contracts sc
             INNER JOIN deposit_transactions dt ON dt.submission_contract_id = sc.submission_contract_id
             LEFT JOIN deposit_returns dr ON dr.transaction_id = dt.transaction_id
             WHERE sc.status = 'active'
               AND dt.status = 'Completed'
               AND DATE_ADD(sc.signed_at, INTERVAL sc.contract_duration_months MONTH) <= NOW()
               AND dr.return_id IS NULL`
        );
        const totalRequests = Number(totalReqRows[0]?.count || 0);

        // 2. Thống kê "Hợp đồng sắp hết hạn" (còn <= 20 ngày nữa hết hạn & chưa hoàn cọc)
        const [upcomingRows] = await db.query(
            `SELECT COUNT(*) AS count
             FROM submission_contracts sc
             INNER JOIN deposit_transactions dt ON dt.submission_contract_id = sc.submission_contract_id
             LEFT JOIN deposit_returns dr ON dr.transaction_id = dt.transaction_id
             WHERE sc.status = 'active'
               AND dt.status = 'Completed'
               AND DATE_ADD(sc.signed_at, INTERVAL sc.contract_duration_months MONTH) > NOW()
               AND DATE_ADD(sc.signed_at, INTERVAL sc.contract_duration_months MONTH) <= DATE_ADD(NOW(), INTERVAL 20 DAY)
               AND dr.return_id IS NULL`
        );
        const upcomingExpiring = Number(upcomingRows[0]?.count || 0);

        // 3. Thống kê "Tỷ lệ hoàn tiền đã xử lý"
        // Tổng số hợp đồng đã hết hạn (gồm cả đã hoàn cọc và chưa hoàn cọc)
        const [expiredTotalRows] = await db.query(
            `SELECT COUNT(*) AS count
             FROM submission_contracts sc
             INNER JOIN deposit_transactions dt ON dt.submission_contract_id = sc.submission_contract_id
             WHERE dt.status = 'Completed'
               AND DATE_ADD(sc.signed_at, INTERVAL sc.contract_duration_months MONTH) <= NOW()`
        );
        const expiredTotal = Number(expiredTotalRows[0]?.count || 0);

        // Số lượng đã được xử lý hoàn cọc thành công
        const [refundedRows] = await db.query(
            `SELECT COUNT(*) AS count
             FROM submission_contracts sc
             INNER JOIN deposit_transactions dt ON dt.submission_contract_id = sc.submission_contract_id
             INNER JOIN deposit_returns dr ON dr.transaction_id = dt.transaction_id
             WHERE dt.status = 'Completed'
               AND DATE_ADD(sc.signed_at, INTERVAL sc.contract_duration_months MONTH) <= NOW()`
        );
        const refundedCount = Number(refundedRows[0]?.count || 0);

        let processRate = 100;
        if (expiredTotal > 0) {
            processRate = Math.round((refundedCount / expiredTotal) * 100);
        }

        // Lấy thêm tổng số tiền đã hoàn trả từ trước tới nay
        const [sumRefundedRows] = await db.query(
            `SELECT SUM(return_amount) AS total FROM deposit_returns`
        );
        const totalRefundedAmount = Number(sumRefundedRows[0]?.total || 0);

                // 4. Lấy chi tiết danh sách hợp đồng đã hết hạn (cả chưa hoàn cọc và đã hoàn cọc)
        const [contracts] = await db.query(
            `SELECT 
                sc.submission_contract_id,
                sc.contract_code,
                sc.signed_at,
                sc.contract_duration_months,
                DATE_ADD(sc.signed_at, INTERVAL sc.contract_duration_months MONTH) AS expired_at,
                ps.submission_id,
                ps.property_type,
                ps.address,
                u.full_name AS owner_name,
                u.email AS owner_email,
                u.phone AS owner_phone,
                dt.transaction_id,
                dt.amount AS deposit_amount,
                dt.transaction_code AS deposit_transaction_code,
                dr.return_id,
                dr.return_amount,
                dr.returned_at,
                dr.reason
             FROM submission_contracts sc
             INNER JOIN property_submissions ps ON ps.submission_id = sc.submission_id
             INNER JOIN users u ON u.user_id = ps.owner_id
             INNER JOIN deposit_transactions dt ON dt.submission_contract_id = sc.submission_contract_id
             LEFT JOIN deposit_returns dr ON dr.transaction_id = dt.transaction_id
             WHERE sc.status = 'active'
               AND dt.status = 'Completed'
               AND DATE_ADD(sc.signed_at, INTERVAL sc.contract_duration_months MONTH) <= NOW()
             ORDER BY dr.return_id ASC, expired_at ASC`
        );

        res.json({
            stats: {
                totalRequests,
                upcomingExpiring,
                processRate,
                totalRefundedAmount,
                expiredTotal,
                refundedCount
            },
            items: contracts.map(row => ({
                submission_contract_id: row.submission_contract_id,
                contract_code: row.contract_code,
                signed_at: row.signed_at,
                contract_duration_months: row.contract_duration_months,
                expired_at: row.expired_at,
                submission_id: row.submission_id,
                property_type: row.property_type,
                address: row.address,
                owner: {
                    full_name: row.owner_name,
                    email: row.owner_email,
                    phone: row.owner_phone
                },
                deposit_transaction: {
                    transaction_id: row.transaction_id,
                    amount: row.deposit_amount,
                    transaction_code: row.deposit_transaction_code
                },
                deposit_return: row.return_id ? {
                    return_id: row.return_id,
                    return_amount: row.return_amount,
                    returned_at: row.returned_at,
                    reason: row.reason
                } : null
            }))
        });
    } catch (err) {
        console.error('get expired contracts error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// POST /api/accountant/returns
// Ghi nhận thông tin hoàn cọc vào DB
router.post('/returns', requireAuth, requireRole('accountant', 'manager'), async (req, res) => {
    const { transaction_id, return_amount, reason, returned_at } = req.body;

    if (!transaction_id) {
        return res.status(400).json({ message: 'Thiếu mã giao dịch đặt cọc (transaction_id)' });
    }

    if (return_amount === undefined || return_amount === null || isNaN(Number(return_amount))) {
        return res.status(400).json({ message: 'Số tiền hoàn trả không hợp lệ' });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Kiểm tra xem giao dịch đặt cọc này có hợp lệ và đã hoàn thành cọc không
        const [transactions] = await connection.query(
            `SELECT dt.*, sc.signed_at, sc.contract_duration_months
             FROM deposit_transactions dt
             INNER JOIN submission_contracts sc ON sc.submission_contract_id = dt.submission_contract_id
             WHERE dt.transaction_id = ? AND dt.status = 'Completed' LIMIT 1`,
            [transaction_id]
        );

        if (transactions.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy giao dịch đặt cọc hợp lệ hoặc chưa hoàn tất thanh toán' });
        }

        // 2. Kiểm tra xem giao dịch này đã được hoàn cọc chưa
        const [existingReturns] = await connection.query(
            'SELECT return_id FROM deposit_returns WHERE transaction_id = ? LIMIT 1',
            [transaction_id]
        );

        if (existingReturns.length > 0) {
            return res.status(400).json({ message: 'Giao dịch đặt cọc này đã được xử lý hoàn cọc trước đó' });
        }

        // 3. Thực hiện thêm vào deposit_returns
        const returnDate = returned_at ? new Date(returned_at) : new Date();
        const [insertResult] = await connection.query(
            `INSERT INTO deposit_returns (transaction_id, return_amount, reason, returned_at, processed_by)
             VALUES (?, ?, ?, ?, ?)`,
            [
                transaction_id,
                Number(return_amount),
                reason || 'Hoàn trả tiền đặt cọc cho hợp đồng đã hết hạn.',
                returnDate,
                req.user.user_id
            ]
        );

        await connection.commit();

        res.status(201).json({
            message: 'Xử lý hoàn trả tiền đặt cọc thành công!',
            return_id: insertResult.insertId,
            transaction_id,
            return_amount: Number(return_amount),
            returned_at: returnDate
        });
    } catch (err) {
        await connection.rollback();
        console.error('Process deposit return error:', err);
        res.status(500).json({ message: 'Lỗi hệ thống: ' + err.message });
    } finally {
        connection.release();
    }
});

module.exports = router;
