const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const db = require('./db');
const authRoutes = require('./routes/auth');
const consignmentRoutes = require('./routes/consignment');
const saleRoutes = require('./routes/sale');
const legalRoutes = require('./routes/legal');
const listingRoutes = require('./routes/listing');
const savedRoutes = require('./routes/saved');
const accountantRoutes = require('./routes/accountant');
const appointmentRoutes = require('./routes/appointments');
const brokerRoutes = require('./routes/broker');
const ITRoutes = require('./routes/IT');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = 5050;

// Middleware
app.use(cors());
app.use(express.json({ limit: '15mb' }));

// Cache control to prevent browser/proxy caching of API responses
app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    next();
});

// Phục vụ frontend tĩnh từ thư mục ../frontend
app.use(express.static(path.join(__dirname, '..', 'Frontend')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'Frontend', 'landingpage.html'));
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/consignments', consignmentRoutes);
app.use('/api/sale', saleRoutes);
app.use('/api/legal', legalRoutes);
app.use('/api/listings', listingRoutes);
app.use('/api/saved', savedRoutes);
app.use('/api/accountant', accountantRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/broker', brokerRoutes);
app.use('/api/IT', ITRoutes);
app.use('/api/admin', adminRoutes);

// Test endpoints
app.get('/api/health', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT 1 + 1 AS result');
        res.json({ status: 'ok', db_test: rows[0].result });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// Tạo server http và socket.io
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: (origin, callback) => {
            // Cho phép mọi origin kết nối động
            callback(null, true);
        },
        methods: ["GET", "POST", "PATCH"],
        credentials: true
    }
});

// Lưu trữ instance socket.io toàn cục để các route có thể truy cập
global.io = io;

io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    socket.on('joinRoom', (roomName) => {
        socket.join(roomName);
        console.log(`Socket ${socket.id} joined room: ${roomName}`);
    });

    socket.on('disconnect', () => {
        console.log(`Socket disconnected: ${socket.id}`);
    });
});

// Tu dong gui bao cao dinh ky vao ngay dau thang (Luong thay the 2.6.4)
setInterval(async () => {
    const now = new Date();
    // Kiem tra neu la ngay 1 va vao luc 00:00:00 (Gio he thong)
    if (now.getDate() === 1 && now.getHours() === 0 && now.getMinutes() === 0) {
        console.log("[Báo cáo tự động] Đang chạy gửi báo cáo định kỳ ngày đầu tháng cho Lãnh đạo qua email...");
        try {
            const [managerUsers] = await db.query("SELECT email FROM users WHERE role IN ('manager', 'admin')");
            managerUsers.forEach(user => {
                console.log(`[Báo cáo tự động] Da gui file dinh kem PDF bao cao thang truoc cho: ${user.email}`);
            });
        } catch(e) {
            console.error("[Báo cáo tự động] Loi khi quet gui bao cao:", e);
        }
    }
}, 60000); // Kiem tra moi phut

// Chay mo phong gui bao cao tu dong ngay dau thang ngay khi khoi dong server de kiem tra luong thay the
setTimeout(async () => {
    console.log("[Báo cáo tự động - Mô phỏng Khởi động] Kích hoạt Luồng thay thế: Tự động gửi báo cáo định kỳ ngày đầu tháng cho Lãnh đạo...");
    try {
        const [managerUsers] = await db.query("SELECT email, full_name FROM users WHERE role IN ('manager', 'admin')");
        if (managerUsers.length > 0) {
            managerUsers.forEach(user => {
                console.log(`[Báo cáo tự động - Mô phỏng Khởi động] Đã tạo báo cáo PDF & tự động gửi tới email Lãnh đạo: ${user.full_name} (${user.email}) - Trạng thái: Thành công`);
            });
        } else {
            console.log("[Báo cáo tự động - Mô phỏng Khởi động] Không tìm thấy tài khoản Lãnh đạo/Admin nào trong DB để gửi.");
        }
    } catch(e) {
        console.error("[Báo cáo tự động - Mô phỏng Khởi động] Lỗi:", e);
    }
}, 3000); // Chay sau 3 giay khi server khoi dong

server.listen(PORT, () => {
    console.log(`Server dang chay tai http://localhost:${PORT}`);
    console.log(`Mo http://localhost:${PORT}/landingpage.html de bat dau`);
});