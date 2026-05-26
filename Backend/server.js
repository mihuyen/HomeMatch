const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const authRoutes = require('./routes/auth');
const consignmentRoutes = require('./routes/consignment');
const brokerRoutes = require('./routes/broker');

const app = express();
const PORT = 5000;


// Middleware
app.use(cors());
app.use(express.json());

// Phục vụ frontend tĩnh từ thư mục ../frontend
app.use(express.static(path.join(__dirname, '..', 'Frontend')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'Frontend', 'landingpage.html'));
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/consignments', consignmentRoutes);
app.use('/api/broker', brokerRoutes);

// Test endpoints
app.get('/api/health', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT 1 + 1 AS result');
        res.json({ status: 'ok', db_test: rows[0].result });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server dang chay tai http://localhost:${PORT}`);
    console.log(`Mo http://localhost:${PORT}/landingpage.html de bat dau`);
});