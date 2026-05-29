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

server.listen(PORT, () => {
    console.log(`Server dang chay tai http://localhost:${PORT}`);
    console.log(`Mo http://localhost:${PORT}/landingpage.html de bat dau`);
});