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
                    u.email AS tenant_email,
                    (SELECT COUNT(*) FROM appointments WHERE assignment_id = sa.assignment_id) AS appointment_count
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

// GET /api/broker/assignments/:id/contract
// Lấy thông tin hợp đồng hiện tại và lý do từ chối (nếu có) của phân công này
router.get('/assignments/:id/contract', requireAuth, requireRole('broker', 'manager'), async (req, res) => {
    try {
        const brokerId = req.user.user_id;
        const assignmentId = req.params.id;

        // 1. Get assignment to find the tenant_id
        const [assignments] = await db.query(
            `SELECT tenant_id FROM staff_assignments WHERE assignment_id = ? AND sale_broker_id = ? LIMIT 1`,
            [assignmentId, brokerId]
        );
        if (assignments.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy phân công' });
        }
        const tenantId = assignments[0].tenant_id;

        // 2. Get the latest contract and its rejection reason (if any)
        const [contracts] = await db.query(
            `SELECT rc.*, rca.rejection_reason 
             FROM RENTAL_CONTRACTS rc
             LEFT JOIN RENTAL_CONTRACT_APPROVALS rca ON rca.rental_contract_id = rc.rental_contract_id AND rca.status = 'từ chối'
             WHERE rc.tenant_id = ? AND rc.broker_id = ?
             ORDER BY rc.rental_contract_id DESC LIMIT 1`,
            [tenantId, brokerId]
        );

        if (contracts.length === 0) {
            return res.json({ contract: null });
        }

        res.json({ contract: contracts[0] });
    } catch (err) {
        console.error('get contract for assignment error:', err);
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
                    sa.status AS assignment_status,
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

        if (!contractScanUrl || typeof contractScanUrl !== 'string' || contractScanUrl.trim() === '') {
            return res.status(400).json({ message: 'Vui lòng tải file scan/ảnh hợp đồng lên hệ thống trước khi chốt giao dịch.' });
        }

        // Check if there is at least one appointment created for this assignment
        const [existingAppointments] = await connection.query(
            `SELECT appointment_id FROM appointments WHERE assignment_id = ? LIMIT 1`,
            [parsedAssignmentId]
        );
        if (existingAppointments.length === 0) {
            return res.status(400).json({ message: 'Không thể chốt giao dịch khi chưa tạo lịch hẹn nào.' });
        }

        await connection.beginTransaction();

        // 1. Update appointment status & result note if provided (temporarily done later since we need rentalContractId)
        // 2. Insert or Update RENTAL_CONTRACTS
        const [existingContracts] = await connection.query(
            `SELECT rental_contract_id FROM RENTAL_CONTRACTS 
             WHERE tenant_id = ? AND broker_id = ? AND status = 'Yêu cầu kiểm tra lại' LIMIT 1`,
            [parsedTenantId, brokerId]
        );

        let rentalContractId;
        if (existingContracts.length > 0) {
            rentalContractId = existingContracts[0].rental_contract_id;
            await connection.query(
                `UPDATE RENTAL_CONTRACTS 
                 SET listing_id = ?, agreed_price = ?, lease_term_months = ?, status = 'Chờ kiểm duyệt', signed_at = NOW(), contract_scan_url = ?
                 WHERE rental_contract_id = ?`,
                [parsedListingId, parsedPrice, parsedDuration, contractScanUrl || null, rentalContractId]
            );
        } else {
            const [contractResult] = await connection.query(
                `INSERT INTO RENTAL_CONTRACTS (listing_id, tenant_id, broker_id, agreed_price, lease_term_months, status, signed_at, contract_scan_url)
                 VALUES (?, ?, ?, ?, ?, 'Chờ kiểm duyệt', NOW(), ?)`,
                [parsedListingId, parsedTenantId, brokerId, parsedPrice, parsedDuration, contractScanUrl || null]
            );
            rentalContractId = contractResult.insertId;
        }

        // 1b. Link appointment if provided
        if (appointmentId) {
            await connection.query(
                `UPDATE appointments SET status = 'hoàn tất', result_note = ?, rental_contract_id = ? WHERE appointment_id = ?`,
                [resultNote || 'Chốt giao dịch thành công', rentalContractId, Number(appointmentId)]
            );
        }

        // 3. Insert RENTAL_CONTRACT_APPROVALS
        await connection.query(
            `INSERT INTO RENTAL_CONTRACT_APPROVALS (rental_contract_id, submitted_by, status, approved_price, approved_commission)
             VALUES (?, ?, 'chờ duyệt', ?, ?)`,
            [rentalContractId, brokerId, parsedPrice, parsedPrice * 0.1] // Assume 10% commission
        );

        // 4. Update STAFF_ASSIGNMENTS status to completed (đang hoàn thiện)
        await connection.query(
            `UPDATE STAFF_ASSIGNMENTS SET status = 'đang hoàn thiện' WHERE assignment_id = ?`,
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
             WHERE broker_id = ? AND status IN ('Đã phê duyệt', 'Đã duyệt')`,
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
            `SELECT COUNT(*) AS total FROM RENTAL_CONTRACTS WHERE status IN ('Đã phê duyệt', 'Đã duyệt')`
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

// POST /api/broker/contracts/upload-scan
// Cho phép broker upload file scan hợp đồng (pdf, png, jpeg) dưới dạng base64
router.post('/contracts/upload-scan', requireAuth, requireRole('broker', 'manager'), async (req, res) => {
    const fs = require('fs');
    const path = require('path');

    try {
        const { fileName, mimeType, fileDataBase64 } = req.body;

        if (!fileDataBase64) {
            return res.status(400).json({ message: 'Thiếu dữ liệu tệp tin' });
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

        const fileId = `broker-${req.user.user_id}-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
        const storedFileName = `contract_${fileId}${safeExt}`;
        const storedPath = path.join(uploadDir, storedFileName);

        await fs.promises.writeFile(storedPath, Buffer.from(dataBase64, 'base64'));

        const publicUrl = `/uploads/contracts/${storedFileName}`;

        res.json({
            message: 'Tải file scan hợp đồng thành công',
            contract_scan_url: publicUrl
        });
    } catch (err) {
        console.error('broker upload contract scan error:', err);
        res.status(500).json({ message: 'Lỗi server upload: ' + err.message });
    }
});

// GET /api/broker/commission-notifications
// Lấy danh sách thông báo hoa hồng sau khi được kế toán phê duyệt
router.get('/commission-notifications', requireAuth, requireRole('broker', 'manager'), async (req, res) => {
    try {
        const brokerId = req.user.user_id;

        const [rows] = await db.query(
            `SELECT rca.rental_contract_id,
                    rca.approved_price,
                    rca.approved_commission,
                    rca.approved_at,
                    rc.tenant_id,
                    u_tenant.full_name AS tenant_name,
                    pl.title AS listing_title
             FROM RENTAL_CONTRACT_APPROVALS rca
             INNER JOIN RENTAL_CONTRACTS rc ON rc.rental_contract_id = rca.rental_contract_id
             LEFT JOIN property_listings pl ON pl.listing_id = rc.listing_id
             LEFT JOIN users u_tenant ON u_tenant.user_id = rc.tenant_id
             WHERE rc.broker_id = ? AND rca.status IN ('duyệt', 'Đã phê duyệt', 'Đã duyệt') AND rc.status IN ('Đã phê duyệt', 'Đã duyệt')
             ORDER BY rca.approved_at DESC
             LIMIT 10`,
            [brokerId]
        );

        res.json(rows);
    } catch (err) {
        console.error('broker commission notifications error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

module.exports = router;
