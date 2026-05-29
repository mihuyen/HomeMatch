const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/broker/assignments
// Danh sách khách hàng được phân công cho broker hiện tại
router.get('/assignments', requireAuth, requireRole('broker', 'manager'), async (req, res) => {
    try {
        const brokerId = req.user.user_id;
        const [rows] = await db.query(
            `SELECT sa.assignment_id,
                    sa.tenant_id,
                    sa.sale_broker_id,
                    sa.status,
                    sa.notes,
                    sa.assigned_at,
                    u.full_name AS tenant_name,
                    u.phone AS tenant_phone,
                    u.email AS tenant_email
             FROM staff_assignments sa
             LEFT JOIN users u ON u.user_id = sa.tenant_id
             WHERE sa.sale_broker_id = ?
             ORDER BY sa.assigned_at DESC, sa.assignment_id DESC`,
            [brokerId]
        );

        res.json({
            broker_id: brokerId,
            items: rows
        });
    } catch (err) {
        console.error('broker assignments error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// GET /api/broker/assignments/:id
// Lấy chi tiết một phân công
router.get('/assignments/:id', requireAuth, requireRole('broker', 'manager'), async (req, res) => {
    try {
        const brokerId = req.user.user_id;
        const assignmentId = req.params.id;
        
        const [rows] = await db.query(
            `SELECT sa.assignment_id,
                    sa.tenant_id,
                    sa.sale_broker_id,
                    sa.status,
                    sa.notes,
                    sa.assigned_at,
                    u.full_name AS tenant_name,
                    u.phone AS tenant_phone,
                    u.email AS tenant_email
             FROM staff_assignments sa
             LEFT JOIN users u ON u.user_id = sa.tenant_id
             WHERE sa.sale_broker_id = ? AND sa.assignment_id = ?`,
            [brokerId, assignmentId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy phân công' });
        }

        res.json(rows[0]);
    } catch (err) {
        console.error('broker assignment detail error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// GET /api/broker/assignments/:id/appointments
// Lấy danh sách lịch hẹn chưa hoàn thành liên kết với phân công này
router.get('/assignments/:id/appointments', requireAuth, requireRole('broker', 'manager'), async (req, res) => {
    try {
        const brokerId = req.user.user_id;
        const assignmentId = req.params.id;

        const [rows] = await db.query(
            `SELECT ap.appointment_id,
                    ap.appointment_type,
                    ap.scheduled_time,
                    ap.location,
                    ap.status
             FROM appointments ap
             INNER JOIN staff_assignments sa ON sa.assignment_id = ap.assignment_id
             WHERE sa.sale_broker_id = ? AND sa.assignment_id = ? AND ap.status != 'hoàn tất'`,
            [brokerId, assignmentId]
        );

        res.json(rows);
    } catch (err) {
        console.error('broker assignment appointments error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// GET /api/broker/appointments
// Danh sách lịch hẹn của broker
router.get('/appointments', requireAuth, requireRole('broker', 'manager'), async (req, res) => {
    try {
        const brokerId = req.user.user_id;
        const [rows] = await db.query(
            `SELECT ap.appointment_id,
                    ap.assignment_id,
                    ap.submission_id,
                    ap.rental_contract_id,
                    ap.appointment_type,
                    ap.scheduled_time,
                    ap.location,
                    ap.status,
                    ap.result_note,
                    ap.created_at,
                    sa.tenant_id,
                    u.full_name AS tenant_name
             FROM appointments ap
             INNER JOIN staff_assignments sa ON sa.assignment_id = ap.assignment_id
             LEFT JOIN users u ON u.user_id = sa.tenant_id
             WHERE sa.sale_broker_id = ?
             ORDER BY ap.scheduled_time ASC`,
            [brokerId]
        );

        res.json({
            broker_id: brokerId,
            items: rows
        });
    } catch (err) {
        console.error('broker appointments error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// POST /api/broker/contracts
// Tạo hợp đồng thuê cho phân công môi giới
router.post('/contracts', requireAuth, requireRole('broker', 'manager'), async (req, res) => {
    const connection = await db.getConnection();
    try {
        const brokerId = req.user.user_id;
        const { assignmentId, tenantId, agreedPrice, leaseTermMonths, listingId, appointmentId, resultNote, contractScanUrl } = req.body;

        const parsedAssignmentId = Number(assignmentId);
        const parsedTenantId = Number(tenantId);
        const parsedPrice = Number(agreedPrice);
        const parsedDuration = Number(leaseTermMonths);
        const parsedListingId = listingId ? Number(listingId) : 1; // Default to 1 if not provided

        if (!parsedAssignmentId || !parsedTenantId) {
            return res.status(400).json({ message: 'Thiếu thông tin phân công hoặc khách thuê' });
        }

        if (isNaN(parsedPrice) || parsedPrice <= 0) {
            return res.status(400).json({ message: 'Giá thỏa thuận không hợp lệ' });
        }

        if (isNaN(parsedDuration) || parsedDuration <= 0) {
            return res.status(400).json({ message: 'Thời hạn hợp đồng không hợp lệ' });
        }

        await connection.beginTransaction();

        // 1. Update appointment status & result note if provided
        if (appointmentId) {
            await connection.query(
                `UPDATE appointments SET status = 'hoàn tất', result_note = ? WHERE appointment_id = ?`,
                [resultNote || 'Chốt giao dịch thành công', Number(appointmentId)]
            );
        }

        // 2. Insert RENTAL_CONTRACTS
        const [contractResult] = await connection.query(
            `INSERT INTO RENTAL_CONTRACTS (listing_id, tenant_id, broker_id, agreed_price, lease_term_months, status, signed_at, contract_scan_url)
             VALUES (?, ?, ?, ?, ?, 'chờ duyệt', NOW(), ?)`,
            [parsedListingId, parsedTenantId, brokerId, parsedPrice, parsedDuration, contractScanUrl || null]
        );

        const rentalContractId = contractResult.insertId;

        // 3. Insert RENTAL_CONTRACT_APPROVALS
        await connection.query(
            `INSERT INTO RENTAL_CONTRACT_APPROVALS (rental_contract_id, submitted_by, status, approved_price, approved_commission)
             VALUES (?, ?, 'chờ duyệt', ?, ?)`,
            [rentalContractId, brokerId, parsedPrice, parsedPrice * 0.1] // Assume 10% commission
        );

        // 4. Update STAFF_ASSIGNMENTS status to completed (hoàn tất)
        await connection.query(
            `UPDATE STAFF_ASSIGNMENTS SET status = 'hoàn tất' WHERE assignment_id = ?`,
            [parsedAssignmentId]
        );

        await connection.commit();

        res.status(201).json({
            message: 'Tạo hợp đồng thuê thành công và đã gửi phê duyệt',
            rental_contract_id: rentalContractId
        });

    } catch (err) {
        await connection.rollback();
        console.error('broker create contract error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    } finally {
        connection.release();
    }
});

// GET /api/broker/dashboard-stats
// Tính toán doanh thu, số giao dịch, tỷ lệ chốt và các so sánh động
router.get('/dashboard-stats', requireAuth, requireRole('broker', 'manager'), async (req, res) => {
    try {
        const brokerId = req.user.user_id;

        // 1. Doanh thu tháng này và tháng trước (BROKER_PAYMENTS)
        const [currMonthRows] = await db.query(
            `SELECT IFNULL(SUM(amount), 0) AS total
             FROM BROKER_PAYMENTS
             WHERE broker_id = ? AND status = 'đã chi trả'
               AND YEAR(paid_at) = YEAR(CURRENT_DATE())
               AND MONTH(paid_at) = MONTH(CURRENT_DATE())`,
            [brokerId]
        );
        const currMonthRevenue = Number(currMonthRows[0].total);

        const [prevMonthRows] = await db.query(
            `SELECT IFNULL(SUM(amount), 0) AS total
             FROM BROKER_PAYMENTS
             WHERE broker_id = ? AND status = 'đã chi trả'
               AND YEAR(paid_at) = YEAR(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH))
               AND MONTH(paid_at) = MONTH(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH))`,
            [brokerId]
        );
        const prevMonthRevenue = Number(prevMonthRows[0].total);

        let revenueChangePercent = 0;
        if (prevMonthRevenue > 0) {
            revenueChangePercent = ((currMonthRevenue - prevMonthRevenue) / prevMonthRevenue) * 100;
        } else if (currMonthRevenue > 0) {
            revenueChangePercent = 100; // 100% growth if prev month was 0
        }

        // 2. Số giao dịch thành công (RENTAL_CONTRACTS)
        const [contractsRows] = await db.query(
            `SELECT COUNT(*) AS total
             FROM RENTAL_CONTRACTS
             WHERE broker_id = ? AND status = 'Đã duyệt'`,
            [brokerId]
        );
        const closedDeals = Number(contractsRows[0].total);

        // 3. Tỷ lệ chốt đơn của Broker (Successful contracts / Total assignments)
        const [assignRows] = await db.query(
            `SELECT COUNT(*) AS total
             FROM STAFF_ASSIGNMENTS
             WHERE sale_broker_id = ?`,
            [brokerId]
        );
        const totalAssignments = Number(assignRows[0].total);

        let brokerConversionRate = 0;
        if (totalAssignments > 0) {
            brokerConversionRate = (closedDeals / totalAssignments) * 100;
        }

        // 4. Tỷ lệ chốt đơn trung bình sàn (Toàn hệ thống)
        const [sysAssignRows] = await db.query(
            `SELECT COUNT(*) AS total FROM STAFF_ASSIGNMENTS`
        );
        const sysTotalAssignments = Number(sysAssignRows[0].total);

        const [sysContractsRows] = await db.query(
            `SELECT COUNT(*) AS total FROM RENTAL_CONTRACTS WHERE status = 'Đã duyệt'`
        );
        const sysClosedDeals = Number(sysContractsRows[0].total);

        let sysConversionRate = 0;
        if (sysTotalAssignments > 0) {
            sysConversionRate = (sysClosedDeals / sysTotalAssignments) * 100;
        }

        const rateDiff = brokerConversionRate - sysConversionRate;

        res.json({
            currMonthRevenue,
            prevMonthRevenue,
            revenueChangePercent: Number(revenueChangePercent.toFixed(1)),
            closedDeals,
            totalAssignments,
            brokerConversionRate: Number(brokerConversionRate.toFixed(1)),
            sysConversionRate: Number(sysConversionRate.toFixed(1)),
            rateDiff: Number(rateDiff.toFixed(1))
        });

    } catch (err) {
        console.error('broker dashboard stats error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

module.exports = router;
