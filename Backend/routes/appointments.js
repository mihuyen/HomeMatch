const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const ALLOWED_ROLES = ['sale', 'agent', 'manager'];
const BROKER_ROLES = ['broker', 'manager'];

function normalizeText(value) {
    if (value === undefined || value === null || value === '') return null;
    return String(value);
}

async function getAssignedSubmission(submissionId, userId) {
    const [rows] = await db.query(
        `SELECT ps.submission_id, ps.assigned_sales_id
         FROM property_submissions ps
         WHERE ps.submission_id = ? AND ps.assigned_sales_id = ?
         LIMIT 1`,
        [submissionId, userId]
    );
    return rows[0] || null;
}

async function getAppointmentForUser(appointmentId, userId) {
    const [rows] = await db.query(
        `SELECT ap.appointment_id, ap.submission_id, ap.appointment_type,
                ap.scheduled_time, ap.location, ap.status, ap.result_note, ap.created_at
         FROM appointments ap
         INNER JOIN property_submissions ps ON ps.submission_id = ap.submission_id
         WHERE ap.appointment_id = ? AND ps.assigned_sales_id = ?
         LIMIT 1`,
        [appointmentId, userId]
    );
    return rows[0] || null;
}

async function getAssignmentForBroker(assignmentId, brokerId) {
    const [rows] = await db.query(
        `SELECT assignment_id, tenant_id, sale_broker_id, status
         FROM staff_assignments
         WHERE assignment_id = ? AND sale_broker_id = ?
         LIMIT 1`,
        [assignmentId, brokerId]
    );
    return rows[0] || null;
}

// POST /api/appointments
// Tạo lịch hẹn từ trang brokerAppointmentDetail.html
router.post('/', requireAuth, requireRole(...ALLOWED_ROLES), async (req, res) => {
    try {
        const userId = req.user.user_id;
        const {
            submissionId,
            scheduledTime,
            location,
            note,
            appointmentType = 'xem nhà',
            status = 'scheduled'
        } = req.body;

        const parsedSubmissionId = Number(submissionId);

        if (!Number.isInteger(parsedSubmissionId)) {
            return res.status(400).json({ message: 'submissionId không hợp lệ' });
        }

        if (!scheduledTime || !location) {
            return res.status(400).json({ message: 'Vui lòng nhập thời gian và địa điểm lịch hẹn' });
        }

        const assignedSubmission = await getAssignedSubmission(parsedSubmissionId, userId);
        if (!assignedSubmission) {
            return res.status(404).json({ message: 'Không tìm thấy hồ sơ được phân công cho người dùng hiện tại' });
        }

        const [result] = await db.query(
            `INSERT INTO appointments (assignment_id, submission_id, appointment_type, scheduled_time, location, status, result_note)
             VALUES (NULL, ?, ?, ?, ?, ?, ?)`,
            [
                parsedSubmissionId,
                normalizeText(appointmentType),
                scheduledTime,
                location,
                normalizeText(status),
                normalizeText(note)
            ]
        );

        const appointment = await getAppointmentForUser(result.insertId, userId);

        res.status(201).json({
            message: 'Tạo lịch hẹn thành công',
            appointment
        });
    } catch (err) {
        console.error('appointments create error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// POST /api/appointments/viewings
// Bước 9: Môi giới tạo lịch dẫn khách xem nhà
router.post('/viewings', requireAuth, requireRole(...BROKER_ROLES), async (req, res) => {
    try {
        const brokerId = req.user.user_id;
        const { assignmentId, scheduledTime, location } = req.body;
        const parsedAssignmentId = Number(assignmentId);

        if (!Number.isInteger(parsedAssignmentId)) {
            return res.status(400).json({ message: 'assignmentId không hợp lệ' });
        }

        if (!scheduledTime || !location) {
            return res.status(400).json({ message: 'Vui lòng nhập thời gian và địa điểm lịch hẹn' });
        }

        const assignment = await getAssignmentForBroker(parsedAssignmentId, brokerId);
        if (!assignment) {
            return res.status(404).json({ message: 'Không tìm thấy phân công của môi giới hiện tại' });
        }

        const [result] = await db.query(
            `INSERT INTO appointments (assignment_id, submission_id, rental_contract_id, appointment_type, scheduled_time, location, status)
             VALUES (?, NULL, NULL, 'xem nhà', ?, ?, 'scheduled')`,
            [parsedAssignmentId, scheduledTime, location]
        );

        // Update staff assignment status to 'đang hoàn thiện'
        await db.query(
            `UPDATE staff_assignments SET status = 'đang hoàn thiện' WHERE assignment_id = ?`,
            [parsedAssignmentId]
        );

        res.status(201).json({
            message: 'Tạo lịch hẹn xem nhà thành công',
            appointment_id: result.insertId,
            assignment_id: parsedAssignmentId
        });
    } catch (err) {
        console.error('appointments viewing create error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// GET /api/appointments/:appointmentId
router.get('/:appointmentId', requireAuth, requireRole(...ALLOWED_ROLES), async (req, res) => {
    try {
        const userId = req.user.user_id;
        const appointmentId = Number(req.params.appointmentId);

        if (!Number.isInteger(appointmentId)) {
            return res.status(400).json({ message: 'appointmentId không hợp lệ' });
        }

        const appointment = await getAppointmentForUser(appointmentId, userId);
        if (!appointment) {
            return res.status(404).json({ message: 'Không tìm thấy lịch hẹn' });
        }

        res.json({ appointment });
    } catch (err) {
        console.error('appointments detail error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// PATCH /api/appointments/:appointmentId
router.patch('/:appointmentId', requireAuth, requireRole(...ALLOWED_ROLES), async (req, res) => {
    try {
        const userId = req.user.user_id;
        const appointmentId = Number(req.params.appointmentId);
        const { status, scheduledTime, location, note, appointmentType } = req.body;

        if (!Number.isInteger(appointmentId)) {
            return res.status(400).json({ message: 'appointmentId không hợp lệ' });
        }

        const existing = await getAppointmentForUser(appointmentId, userId);
        if (!existing) {
            return res.status(404).json({ message: 'Không tìm thấy lịch hẹn' });
        }

        await db.query(
            `UPDATE appointments
             SET status = COALESCE(?, status),
                 scheduled_time = COALESCE(?, scheduled_time),
                 location = COALESCE(?, location),
                 result_note = COALESCE(?, result_note),
                 appointment_type = COALESCE(?, appointment_type)
             WHERE appointment_id = ?`,
            [
                normalizeText(status),
                scheduledTime || null,
                location || null,
                normalizeText(note),
                normalizeText(appointmentType),
                appointmentId
            ]
        );

        const appointment = await getAppointmentForUser(appointmentId, userId);

        res.json({
            message: 'Cập nhật lịch hẹn thành công',
            appointment
        });
    } catch (err) {
        console.error('appointments update error:', err);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

module.exports = router;
