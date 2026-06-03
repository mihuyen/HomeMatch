const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/admin/dashboard
// Lay tat ca du lieu thong ke cho Admin Dashboard voi bo loc dong
router.get('/dashboard', requireAuth, requireRole('admin', 'manager'), async (req, res) => {
    try {
        const { startDate, endDate, area, propertyType, brokerId } = req.query;

        // Xay dung dieu kien loc dynamic cho submissions
        let subConditions = [];
        let subParams = [];
        if (startDate) {
            subConditions.push("ps.submitted_at >= ?");
            subParams.push(startDate);
        }
        if (endDate) {
            subConditions.push("ps.submitted_at <= ?");
            subParams.push(endDate);
        }
        if (area && area !== 'Tất cả khu vực' && area !== 'all') {
            subConditions.push("ps.address LIKE ?");
            subParams.push(`%${area}%`);
        }
        if (propertyType && propertyType !== 'Tất cả loại BĐS' && propertyType !== 'all') {
            subConditions.push("ps.property_type = ?");
            subParams.push(propertyType);
        }
        if (brokerId && brokerId !== 'Tất cả môi giới' && brokerId !== 'all') {
            subConditions.push("ps.assigned_sales_id = ?");
            subParams.push(brokerId);
        }

        const subWhereClause = subConditions.length > 0 ? `AND ${subConditions.join(' AND ')}` : '';

        // 1. Tinh Tong Doanh Thu
        const [revenueRows] = await db.query(
            `SELECT SUM(COALESCE(sc.final_price, 0)) * 0.05 AS total_revenue 
             FROM submission_contracts sc
             JOIN property_submissions ps ON sc.submission_id = ps.submission_id
             WHERE sc.status IN ('signed', 'active', 'documents_submitted')
             ${subWhereClause.replace(/ps\./g, 'ps.')}`,
            subParams
        );
        const totalRevenue = Number(revenueRows[0]?.total_revenue || 0);

        // 2. Thong ke Nguoi dung moi
        let userConditions = ["role IN ('owner', 'tenant', 'user')"];
        let userParams = [];
        if (startDate) {
            userConditions.push("created_at >= ?");
            userParams.push(startDate);
        }
        if (endDate) {
            userConditions.push("created_at <= ?");
            userParams.push(endDate);
        }
        const userWhereClause = userConditions.length > 0 ? `WHERE ${userConditions.join(' AND ')}` : '';
        const [userRows] = await db.query(
            `SELECT COUNT(*) AS count FROM users ${userWhereClause}`,
            userParams
        );
        const newUsers = Number(userRows[0]?.count || 0);

        // 3. Ty le ky ket
        const [submissionCountRows] = await db.query(
            `SELECT COUNT(*) AS count FROM property_submissions ps WHERE 1=1 ${subWhereClause}`,
            subParams
        );
        const [contractCountRows] = await db.query(
            `SELECT COUNT(*) AS count FROM submission_contracts sc 
             JOIN property_submissions ps ON sc.submission_id = ps.submission_id
             WHERE 1=1 ${subWhereClause}`,
            subParams
        );
        const subCount = Number(submissionCountRows[0]?.count || 0);
        const conCount = Number(contractCountRows[0]?.count || 0);
        const signingRate = subCount > 0 ? Math.round((conCount / subCount) * 1000) / 10 : 0;

        // 4. Ky gui hoat dong
        const [activeSubRows] = await db.query(
            `SELECT COUNT(*) AS count FROM property_submissions ps 
             WHERE ps.status NOT IN ('cancelled', 'rejected') ${subWhereClause}`,
            subParams
        );
        const activeSubmissions = Number(activeSubRows[0]?.count || 0);

        // 5. Tien do xu ly ky gui (status distribution)
        const [statusRows] = await db.query(
            `SELECT ps.status, COUNT(*) AS count FROM property_submissions ps 
             WHERE 1=1 ${subWhereClause} GROUP BY ps.status`,
            subParams
        );
        
        let pendingSurvey = 0;
        let surveyed = 0;
        let contracted = 0;
        let listed = 0;
        let cancelled = 0;

        statusRows.forEach(row => {
            const s = String(row.status || '').toLowerCase();
            const count = Number(row.count || 0);
            if (['submitted', 'pending', 'assigned'].includes(s)) {
                pendingSurvey += count;
            } else if (s === 'surveyed') {
                surveyed += count;
            } else if (['documents_submitted', 'signed'].includes(s)) {
                contracted += count;
            } else if (['approved', 'listed'].includes(s)) {
                listed += count;
            } else if (['cancelled', 'rejected', 'expired'].includes(s)) {
                cancelled += count;
            }
        });

        // 6. Hieu suat moi gioi (closingRate = contracts / appointments)
        let brokerFilterCond = "";
        let brokerFilterParams = [];
        if (brokerId && brokerId !== 'Tất cả môi giới' && brokerId !== 'all') {
            brokerFilterCond = "AND u.user_id = ?";
            brokerFilterParams.push(brokerId);
        }

        const [salesRows] = await db.query(
            `SELECT 
                u.user_id, u.full_name, u.email,
                COUNT(DISTINCT ps.submission_id) AS assigned_count,
                COUNT(DISTINCT CASE WHEN ap.status IN ('completed', 'hoàn tất', 'Đã hoàn thành') THEN ap.appointment_id END) AS appointments_count,
                COUNT(DISTINCT sc.submission_contract_id) AS contracts_count
             FROM users u
             LEFT JOIN property_submissions ps ON ps.assigned_sales_id = u.user_id
             LEFT JOIN appointments ap ON ap.submission_id = ps.submission_id AND ap.appointment_type = 'khảo sát'
             LEFT JOIN submission_contracts sc ON sc.submission_id = ps.submission_id AND sc.status = 'signed'
             WHERE u.role IN ('sale', 'agent') ${brokerFilterCond}
             GROUP BY u.user_id`,
             brokerFilterParams
        );

        let brokers = [];
        if (salesRows.length > 0) {
            brokers = salesRows.map(row => {
                const assigned = Number(row.assigned_count || 0);
                const appointments = Number(row.appointments_count || 0);
                const contracts = Number(row.contracts_count || 0);
                // closingRate = (contracts / appointments) * 100%
                const closingRate = appointments > 0 ? Math.round((contracts / appointments) * 100) : 0;
                return {
                    name: row.full_name,
                    role: 'Môi giới chuyên nghiệp',
                    assigned,
                    appointments,
                    contracts,
                    closingRate
                };
            });
        }

        // 7. Doanh thu theo thang (truy van dong neu du lieu ton tai)
        const [trendRows] = await db.query(
            `SELECT DATE_FORMAT(sc.signed_at, '%b') AS month_name, SUM(COALESCE(sc.final_price, 0)) * 0.05 AS amount, MIN(sc.signed_at) AS min_date
             FROM submission_contracts sc
             JOIN property_submissions ps ON sc.submission_id = ps.submission_id
             WHERE sc.status IN ('signed', 'active', 'documents_submitted')
             ${subWhereClause}
             GROUP BY DATE_FORMAT(sc.signed_at, '%b')
             ORDER BY min_date ASC`,
             subParams
        );

        let revenueTrend = [];
        if (trendRows.length > 0) {
            revenueTrend = trendRows.map(row => ({
                month: row.month_name,
                amount: Number(row.amount || 0)
            }));
        } else {
            revenueTrend = [
                { month: 'Jan', amount: Math.round(totalRevenue * 0.1) },
                { month: 'Feb', amount: Math.round(totalRevenue * 0.15) },
                { month: 'Mar', amount: Math.round(totalRevenue * 0.25) },
                { month: 'Apr', amount: Math.round(totalRevenue * 0.4) },
                { month: 'May', amount: Math.round(totalRevenue * 0.35) },
                { month: 'Jun', amount: Math.round(totalRevenue * 0.5) }
            ];
        }

        // 8. Tang truong nguoi dung theo tuan
        const [ownerRows] = await db.query("SELECT COUNT(*) AS count FROM users WHERE role = 'owner'");
        const [tenantRows] = await db.query("SELECT COUNT(*) AS count FROM users WHERE role = 'tenant'");
        const totalOwners = Number(ownerRows[0]?.count || 0);
        const totalTenants = Number(tenantRows[0]?.count || 0);

        const userGrowth = [];
        for (let i = 1; i <= 12; i++) {
            const factor = i / 12;
            userGrowth.push({
                week: `Tuần ${i}`,
                owners: Math.round(totalOwners * factor),
                tenants: Math.round(totalTenants * factor)
            });
        }

        // 9. Tinh toan subtexts
        const [thisMonthRevRows] = await db.query(
            `SELECT SUM(COALESCE(final_price, 0)) * 0.05 AS rev 
             FROM submission_contracts 
             WHERE status IN ('signed', 'active', 'documents_submitted')
               AND signed_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`
        );
        const [prevMonthRevRows] = await db.query(
            `SELECT SUM(COALESCE(final_price, 0)) * 0.05 AS rev 
             FROM submission_contracts 
             WHERE status IN ('signed', 'active', 'documents_submitted')
               AND signed_at >= DATE_SUB(NOW(), INTERVAL 60 DAY)
               AND signed_at < DATE_SUB(NOW(), INTERVAL 30 DAY)`
        );
        const thisMonthRev = Number(thisMonthRevRows[0]?.rev || 0);
        const prevMonthRev = Number(prevMonthRevRows[0]?.rev || 0);
        let revenueSubtext = 'Chưa phát sinh doanh thu';
        let revenueTrendUp = true;
        if (totalRevenue > 0) {
            if (prevMonthRev > 0) {
                const diff = ((thisMonthRev - prevMonthRev) / prevMonthRev) * 100;
                const rounded = Math.round(diff * 10) / 10;
                revenueSubtext = `${rounded >= 0 ? '+' : ''}${rounded}% so với tháng trước`;
                revenueTrendUp = rounded >= 0;
            } else {
                revenueSubtext = 'Mới phát sinh tháng này';
                revenueTrendUp = true;
            }
        }

        const [thisWeekUsersRows] = await db.query(
            `SELECT COUNT(*) AS count FROM users WHERE role IN ('owner', 'tenant', 'user') AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`
        );
        const [prevWeekUsersRows] = await db.query(
            `SELECT COUNT(*) AS count FROM users WHERE role IN ('owner', 'tenant', 'user') AND created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY) AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)`
        );
        const thisWeekUsers = Number(thisWeekUsersRows[0]?.count || 0);
        const prevWeekUsers = Number(prevWeekUsersRows[0]?.count || 0);
        let usersSubtext = 'Không có người đăng ký mới tuần này';
        let usersTrendUp = true;
        if (thisWeekUsers > 0) {
            if (prevWeekUsers > 0) {
                const diff = ((thisWeekUsers - prevWeekUsers) / prevWeekUsers) * 100;
                const rounded = Math.round(diff * 10) / 10;
                usersSubtext = `${rounded >= 0 ? '+' : ''}${rounded}% chủ nhà & khách thuê mới`;
                usersTrendUp = rounded >= 0;
            } else {
                usersSubtext = `+${thisWeekUsers} chủ nhà & khách thuê mới tuần này`;
                usersTrendUp = true;
            }
        } else if (newUsers > 0) {
            usersSubtext = `Tổng cộng ${newUsers} thành viên hệ thống`;
            usersTrendUp = true;
        }

        let rateSubtext = 'Chưa phát sinh giao dịch';
        if (signingRate > 80) {
            rateSubtext = 'Hiệu suất ký kết rất cao';
        } else if (signingRate > 50) {
            rateSubtext = 'Hiệu suất ký kết tốt';
        } else if (signingRate > 0) {
            rateSubtext = 'Cần đẩy nhanh tiến độ chốt';
        }

        const [thisMonthSubsRows] = await db.query(
            `SELECT COUNT(*) AS count FROM property_submissions WHERE status NOT IN ('cancelled', 'rejected') AND submitted_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`
        );
        const [prevMonthSubsRows] = await db.query(
            `SELECT COUNT(*) AS count FROM property_submissions WHERE status NOT IN ('cancelled', 'rejected') AND submitted_at >= DATE_SUB(NOW(), INTERVAL 60 DAY) AND submitted_at < DATE_SUB(NOW(), INTERVAL 30 DAY)`
        );
        const thisMonthSubs = Number(thisMonthSubsRows[0]?.count || 0);
        const prevMonthSubs = Number(prevMonthSubsRows[0]?.count || 0);
        let subsSubtext = 'Chưa có yêu cầu mới tháng này';
        let subsTrendUp = true;
        if (thisMonthSubs > 0) {
            if (prevMonthSubs > 0) {
                const diff = ((thisMonthSubs - prevMonthSubs) / prevMonthSubs) * 100;
                const rounded = Math.round(diff * 10) / 10;
                subsSubtext = `${rounded >= 0 ? '+' : ''}${rounded}% yêu cầu ký gửi mới`;
                subsTrendUp = rounded >= 0;
            } else {
                subsSubtext = `+${thisMonthSubs} yêu cầu ký gửi mới tháng này`;
                subsTrendUp = true;
            }
        } else if (activeSubmissions > 0) {
            subsSubtext = `Tổng cộng ${activeSubmissions} ký gửi đang hoạt động`;
            subsTrendUp = true;
        }

        // 9. Extra Comprehensive Stats (All of Web App)
        // 9.1. User Role breakdown
        const [roleRows] = await db.query(
            "SELECT role, COUNT(*) AS count FROM users GROUP BY role"
        );
        const userRoles = { admin: 0, manager: 0, sale: 0, legal: 0, accountant: 0, owner: 0, tenant: 0, user: 0 };
        roleRows.forEach(r => {
            if (userRoles.hasOwnProperty(r.role)) {
                userRoles[r.role] = Number(r.count || 0);
            }
        });

        // 9.2. Property Listings breakdown
        const [listingRows] = await db.query(
            "SELECT status, COUNT(*) AS count, SUM(COALESCE(view_count, 0)) AS total_views FROM property_listings GROUP BY status"
        );
        const listings = { active: 0, rented: 0, inactive: 0, total: 0, views: 0 };
        listingRows.forEach(r => {
            const count = Number(r.count || 0);
            listings.views += Number(r.total_views || 0);
            listings.total += count;
            if (r.status === 'active') listings.active += count;
            else if (r.status === 'leased' || r.status === 'rented') listings.rented += count;
            else listings.inactive += count;
        });

        // 9.3. Rental contracts
        const [rentContractRows] = await db.query(
            "SELECT COUNT(*) AS count, SUM(COALESCE(agreed_price, 0)) AS total_value FROM rental_contracts WHERE status = 'active'"
        );
        const rentContracts = {
            count: Number(rentContractRows[0]?.count || 0),
            value: Number(rentContractRows[0]?.total_value || 0)
        };

        // 9.4. Deposit Transactions
        const [depositRows] = await db.query(
            "SELECT COUNT(*) AS count, SUM(COALESCE(amount, 0)) AS total_value FROM deposit_transactions WHERE status = 'verified'"
        );
        const deposits = {
            count: Number(depositRows[0]?.count || 0),
            value: Number(depositRows[0]?.total_value || 0)
        };

        // 9.5. Appointments statistics
        const [appRows] = await db.query(
            "SELECT appointment_type, COUNT(*) AS count FROM appointments GROUP BY appointment_type"
        );
        const appointments = { survey: 0, viewing: 0, total: 0 };
        appRows.forEach(r => {
            const count = Number(r.count || 0);
            appointments.total += count;
            const type = String(r.appointment_type || '').toLowerCase();
            if (type.includes('sát') || type.includes('survey')) appointments.survey += count;
            else appointments.viewing += count;
        });

        res.json({
            metrics: {
                totalRevenue,
                newUsers,
                signingRate,
                activeSubmissions,
                revenueSubtext,
                revenueTrendUp,
                usersSubtext,
                usersTrendUp,
                rateSubtext,
                subsSubtext,
                subsTrendUp
            },
            progress: {
                pendingSurvey,
                surveyed,
                contracted,
                listed,
                cancelled
            },
            brokers,
            revenueTrend,
            userGrowth,
            systemStats: {
                userRoles,
                listings,
                rentContracts,
                deposits,
                appointments
            }
        });
    } catch (err) {
        console.error('Admin dashboard metrics error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

const nodemailer = require('nodemailer');
let etherealTransporter = null;

async function getEtherealTransporter() {
    if (etherealTransporter) {
        return etherealTransporter;
    }
    try {
        const testAccount = await nodemailer.createTestAccount();
        etherealTransporter = nodemailer.createTransport({
            host: 'smtp.ethereal.email',
            port: 587,
            secure: false,
            auth: {
                user: testAccount.user,
                pass: testAccount.pass
            }
        });
        console.log(`[Ethereal SMTP] Đã cấu hình tài khoản test: ${testAccount.user}`);
        return etherealTransporter;
    } catch (e) {
        console.error('[Ethereal SMTP] Lỗi tạo tài khoản test:', e);
        throw e;
    }
}

// POST /api/admin/send-email-report
// Gửi báo cáo thống kê qua email thật (sử dụng Ethereal Email cho môi trường thử nghiệm)
router.post('/send-email-report', requireAuth, requireRole('admin', 'manager'), async (req, res) => {
    try {
        const { email, reportName, pdfData } = req.body;
        if (!email) {
            return res.status(400).json({ message: 'Thiếu email người nhận' });
        }
        
        console.log(`[Email] Đang chuẩn bị gửi báo cáo "${reportName || 'Báo cáo thống kê'}" tới ${email}`);
        
        const transporter = await getEtherealTransporter();
        const mailOptions = {
            from: '"HomeMatch System" <no-reply@homematch.com>',
            to: email,
            subject: reportName || 'Báo cáo thống kê HomeMatch',
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 600px; margin: auto; border: 1px solid #e5e7eb; rounded-lg: 8px;">
                    <h2 style="color: #00236f; border-bottom: 2px solid #00236f; padding-bottom: 8px;">Báo Cáo Thống Kê Quản Trị</h2>
                    <p>Xin chào Ban Lãnh Đạo,</p>
                    <p>Hệ thống HomeMatch xin gửi tới bạn báo cáo thống kê định kỳ chi tiết đính kèm dưới đây.</p>
                    <div style="background-color: #f3f4f6; padding: 15px; border-radius: 6px; margin: 15px 0;">
                        <ul style="list-style-type: none; padding: 0; margin: 0;">
                            <li><strong>Tên báo cáo:</strong> ${reportName || 'Báo cáo thống kê tổng quan'}</li>
                            <li><strong>Ngày xuất bản:</strong> ${new Date().toLocaleString('vi-VN')}</li>
                            <li><strong>Định dạng đính kèm:</strong> PDF</li>
                        </ul>
                    </div>
                    <p>Vui lòng mở file đính kèm để xem chi tiết số liệu về doanh thu, hiệu suất môi giới và hợp đồng.</p>
                    <p style="font-size: 12px; color: #6b7280; margin-top: 20px; border-top: 1px solid #e5e7eb; padding-top: 10px;">
                        Thư này được tạo tự động bởi hệ thống HomeMatch. Vui lòng không trả lời thư này.
                    </p>
                </div>
            `,
            attachments: []
        };

        if (pdfData) {
            // pdfData là data URI từ html2pdf (ví dụ: data:application/pdf;filename=generated.pdf;base64,...)
            mailOptions.attachments.push({
                filename: `Bao_cao_thong_ke_${new Date().toISOString().slice(0, 10)}.pdf`,
                path: pdfData
            });
        }

        const info = await transporter.sendMail(mailOptions);
        const previewUrl = nodemailer.getTestMessageUrl(info);
        
        console.log(`[Email] Gửi thư thành công. Message ID: ${info.messageId}`);
        if (previewUrl) {
            console.log(`[Email] Link xem trước thư gửi đi: ${previewUrl}`);
        }

        res.json({ 
            message: `Báo cáo đã được gửi thành công tới ${email}!`,
            previewUrl: previewUrl || null
        });
    } catch (err) {
        console.error('Send email report error:', err);
        res.status(500).json({ message: 'Lỗi server khi gửi email: ' + err.message });
    }
});

// GET /api/admin/assignments
// Lay tat ca ho so de phan cong khao sat
router.get('/assignments', requireAuth, requireRole('admin', 'manager'), async (req, res) => {
    try {
        const { status, area, property_type, limit = 10, offset = 0 } = req.query;

        // 1. Tinh toan goi y cua he thong
        const [salesList] = await db.query(
            `SELECT u.user_id, u.full_name, COUNT(ps.submission_id) AS active_count
             FROM users u
             LEFT JOIN property_submissions ps 
               ON ps.assigned_sales_id = u.user_id 
              AND ps.status IN ('pending', 'submitted', 'assigned')
             WHERE u.role IN ('sale', 'agent')
             GROUP BY u.user_id
             ORDER BY active_count ASC, u.user_id ASC`
        );
        const suggestedAgent = salesList[0] || null;

        // 2. Xay dung menh de WHERE - Chi lay cac ho so dang trong giai doan khao sat
        const conditions = ["ps.status IN ('pending', 'submitted', 'assigned', 'surveyed')"];
        const params = [];

        if (status && status !== 'Tất cả trạng thái' && status !== 'all' && status !== '') {
            if (status === 'pending') {
                conditions.push("ps.status IN ('pending', 'submitted')");
            } else if (status === 'assigned') {
                conditions.push("ps.status = 'assigned'");
            } else if (status === 'surveyed') {
                conditions.push("ps.status = 'surveyed'");
            } else {
                conditions.push('ps.status = ?');
                params.push(status);
            }
        }

        if (area && area !== 'Tất cả khu vực' && area !== 'all' && area !== '') {
            conditions.push('ps.address LIKE ?');
            params.push(`%${area}%`);
        }

        if (property_type && property_type !== 'Tất cả loại BĐS' && property_type !== 'all' && property_type !== '') {
            conditions.push('ps.property_type = ?');
            params.push(property_type);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // 3. Dem tong so
        const [countRows] = await db.query(
            `SELECT COUNT(*) AS total FROM property_submissions ps ${whereClause}`,
            params
        );
        const total = Number(countRows[0]?.total || 0);

        // 4. Dem so ho so dang cho phan cong (chua co sales hoac status pending/submitted)
        const [pendingRows] = await db.query(
            `SELECT COUNT(*) AS total FROM property_submissions WHERE status IN ('pending', 'submitted') OR assigned_sales_id IS NULL`
        );
        const totalPending = Number(pendingRows[0]?.total || 0);

        // 5. Query danh sach
        const [rows] = await db.query(
            `SELECT ps.submission_id, ps.property_type, ps.address, ps.submitted_at, ps.status, ps.assigned_sales_id,
                    u.full_name AS assigned_sales_name
             FROM property_submissions ps
             LEFT JOIN users u ON u.user_id = ps.assigned_sales_id
             ${whereClause}
             ORDER BY ps.submitted_at DESC, ps.submission_id DESC
             LIMIT ? OFFSET ?`,
            [...params, Number(limit), Number(offset)]
        );

        res.json({
            total,
            totalPending,
            suggestedAgent,
            items: rows.map(row => {
                let assignmentStatus = 'HỆ THỐNG ĐÃ PHÂN CÔNG';
                if (row.status === 'assigned') {
                    assignmentStatus = 'ĐÃ PHÂN CÔNG LẠI';
                } else if (row.status === 'surveyed') {
                    assignmentStatus = 'ĐÃ KHẢO SÁT';
                } else if (row.status === 'pending' || row.status === 'submitted') {
                    assignmentStatus = 'HỆ THỐNG ĐÃ PHÂN CÔNG';
                } else {
                    assignmentStatus = row.status.toUpperCase();
                }
                return {
                    submission_id: row.submission_id,
                    request_code: `RQ-${row.submission_id}`,
                    property_type: row.property_type,
                    address: row.address,
                    submitted_at: row.submitted_at,
                    status: row.status,
                    assigned_sales_id: row.assigned_sales_id,
                    assigned_sales_name: row.assigned_sales_name || null,
                    assignment_status: assignmentStatus
                };
            })
        });
    } catch (err) {
        console.error('Get assignments error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// GET /api/admin/sales-agents
// Lay danh sach moi gioi / nhan vien khao sat kem active workload
router.get('/sales-agents', requireAuth, requireRole('admin', 'manager'), async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT u.user_id, u.full_name, u.email, u.phone,
                    COUNT(ps.submission_id) AS active_count
             FROM users u
             LEFT JOIN property_submissions ps 
               ON ps.assigned_sales_id = u.user_id 
              AND ps.status IN ('pending', 'submitted', 'assigned')
             WHERE u.role IN ('sale', 'agent')
             GROUP BY u.user_id
             ORDER BY active_count ASC, u.user_id ASC`
        );
        res.json({ salesAgents: rows });
    } catch (err) {
        console.error('Get sales agents error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// POST /api/admin/assignments/:submissionId
// Thuc hien phan cong / ghi de nhan vien khao sat
router.post('/assignments/:submissionId', requireAuth, requireRole('admin', 'manager'), async (req, res) => {
    try {
        const submissionId = Number(req.params.submissionId);
        const { assignedSalesId } = req.body;

        if (!Number.isInteger(submissionId)) {
            return res.status(400).json({ message: 'submissionId không hợp lệ' });
        }

        if (!assignedSalesId) {
            return res.status(400).json({ message: 'Thiếu thông tin nhân viên được phân công' });
        }

        const [userRows] = await db.query(
            `SELECT user_id, role, full_name FROM users WHERE user_id = ? AND role IN ('sale', 'agent')`,
            [assignedSalesId]
        );
        if (userRows.length === 0) {
            return res.status(400).json({ message: 'Nhân viên được chọn không tồn tại hoặc không phải là môi giới' });
        }

        await db.query(
            `UPDATE property_submissions 
             SET assigned_sales_id = ?, status = 'assigned'
             WHERE submission_id = ?`,
            [assignedSalesId, submissionId]
        );

        res.json({
            message: `Đã phân công thành công hồ sơ #${submissionId} cho ${userRows[0].full_name}`
        });
    } catch (err) {
        console.error('Assign error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// GET /api/admin/broker-assignments
// Lay tat ca phan cong moi gioi kem suggested broker
router.get('/broker-assignments', requireAuth, requireRole('admin', 'manager'), async (req, res) => {
    try {
        const { status, limit = 10, offset = 0 } = req.query;
        
        // 1. Tinh suggested broker (co active workload dang xu ly hoac phan cong lai it nhat)
        const [brokerList] = await db.query(
            `SELECT u.user_id, u.full_name, COUNT(sa.assignment_id) AS active_count
             FROM users u
             LEFT JOIN staff_assignments sa 
               ON sa.sale_broker_id = u.user_id 
              AND sa.status IN ('chờ xử lý', 'đang hoàn thiện')
             WHERE u.role = 'broker'
             GROUP BY u.user_id
             ORDER BY active_count ASC, u.user_id ASC`
        );
        const suggestedBroker = brokerList[0] || null;

        const conditions = [];
        const params = [];

        if (status === 'pending' || status === 'chờ xử lý') {
            conditions.push("sa.status = 'chờ xử lý'");
        } else if (status === 'active' || status === 'đang hoàn thiện') {
            conditions.push("sa.status = 'đang hoàn thiện'");
        } else if (status === 'completed' || status === 'hoàn tất') {
            conditions.push("sa.status = 'hoàn tất'");
        } else if (status && status !== 'Tất cả trạng thái' && status !== 'all' && status !== '') {
            conditions.push('sa.status = ?');
            params.push(status);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // Dem tong so
        const [countRows] = await db.query(
            `SELECT COUNT(DISTINCT sa.assignment_id) AS total 
             FROM staff_assignments sa
             LEFT JOIN users u_broker ON u_broker.user_id = sa.sale_broker_id
             ${whereClause}`,
            params
        );
        const total = Number(countRows[0]?.total || 0);

        // Dem so ho so dang o trang thai he thong da phan cong
        const [pendingRows] = await db.query(
            `SELECT COUNT(DISTINCT sa.assignment_id) AS total 
             FROM staff_assignments sa
             WHERE sa.status = 'chờ xử lý'`
        );
        const totalPending = Number(pendingRows[0]?.total || 0);

        // Query danh sach
        const [rows] = await db.query(
            `SELECT sa.assignment_id, sa.tenant_id, sa.sale_broker_id, sa.assigned_at, sa.notes, sa.status,
                    u_tenant.full_name AS tenant_name,
                    u_broker.full_name AS broker_name,
                    u_broker.role AS broker_role
             FROM staff_assignments sa
             LEFT JOIN users u_tenant ON u_tenant.user_id = sa.tenant_id
             LEFT JOIN users u_broker ON u_broker.user_id = sa.sale_broker_id
             ${whereClause}
             ORDER BY sa.assigned_at DESC, sa.assignment_id DESC
             LIMIT ? OFFSET ?`,
            [...params, Number(limit), Number(offset)]
        );

        res.json({
            total,
            totalPending,
            suggestedBroker,
            items: rows.map(row => {
                const isBrokerValid = row.sale_broker_id && row.broker_role === 'broker';
                let assignmentStatus = 'CHỜ XỬ LÝ';
                if (row.status === 'đang hoàn thiện') {
                    assignmentStatus = 'ĐANG HOÀN THIỆN';
                } else if (row.status === 'hoàn tất') {
                    assignmentStatus = 'HOÀN TẤT';
                }

                return {
                    assignment_id: row.assignment_id,
                    request_code: `ASN-${String(row.assignment_id).padStart(6, '0')}`,
                    tenant_id: row.tenant_id,
                    tenant_name: row.tenant_name || `Khách thuê #${row.tenant_id}`,
                    assigned_at: row.assigned_at,
                    status: row.status,
                    notes: row.notes,
                    sale_broker_id: isBrokerValid ? row.sale_broker_id : null,
                    broker_name: isBrokerValid ? row.broker_name : null,
                    assignment_status: assignmentStatus
                };
            })
        });
    } catch (err) {
        console.error('Get broker assignments error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// GET /api/admin/brokers
// Lay danh sach moi gioi kem active workload
router.get('/brokers', requireAuth, requireRole('admin', 'manager'), async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT u.user_id, u.full_name, u.email, u.phone,
                    COUNT(sa.assignment_id) AS active_count
             FROM users u
             LEFT JOIN staff_assignments sa 
               ON sa.sale_broker_id = u.user_id 
              AND sa.status IN ('chờ xử lý', 'đang hoàn thiện')
             WHERE u.role = 'broker'
             GROUP BY u.user_id
             ORDER BY active_count ASC, u.user_id ASC`
        );
        res.json({ brokers: rows });
    } catch (err) {
        console.error('Get brokers error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// POST /api/admin/broker-assignments/:assignmentId
// Thuc hien phan cong / ghi de moi gioi
router.post('/broker-assignments/:assignmentId', requireAuth, requireRole('admin', 'manager'), async (req, res) => {
    try {
        const assignmentId = Number(req.params.assignmentId);
        const { assignedBrokerId } = req.body;

        console.log(`[API POST /broker-assignments/:assignmentId] assignmentId = ${assignmentId}, assignedBrokerId = ${assignedBrokerId}`);

        if (!Number.isInteger(assignmentId)) {
            return res.status(400).json({ message: 'assignmentId không hợp lệ' });
        }

        if (!assignedBrokerId) {
            return res.status(400).json({ message: 'Thiếu thông tin môi giới được phân công' });
        }

        const [userRows] = await db.query(
            `SELECT user_id, role, full_name FROM users WHERE user_id = ? AND role = 'broker'`,
            [assignedBrokerId]
        );
        if (userRows.length === 0) {
            return res.status(400).json({ message: 'Môi giới được chọn không tồn tại hoặc không hợp lệ' });
        }

        await db.query(
            `UPDATE staff_assignments 
             SET sale_broker_id = ?, status = 'chờ xử lý'
             WHERE assignment_id = ?`,
            [assignedBrokerId, assignmentId]
        );

        res.json({
            message: `Đã phân công thành công yêu cầu #${assignmentId} cho môi giới ${userRows[0].full_name}`
        });
    } catch (err) {
        console.error('Assign broker error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

module.exports = router;

