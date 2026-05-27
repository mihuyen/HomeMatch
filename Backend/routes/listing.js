// Backend/routes/listings.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// API: Lấy danh sách bất động sản đang hiển thị
router.get('/', async (req, res) => {
    try {
        const query = `
            SELECT 
                pl.listing_id AS id,
                pl.title,
                ps.property_type AS type,
                ps.address,
                pl.price_display AS price,
                ps.area,
                ps.num_bedrooms AS bedrooms,
                ps.num_bathrooms AS bathrooms,
                ps.images_uploaded,
                pl.activated_at AS postedAt,
                pl.description,
                u.full_name AS sale_name,
                u.phone AS sale_phone
            FROM property_listings pl
            JOIN property_submissions ps ON pl.submission_id = ps.submission_id
            JOIN users u ON ps.owner_id = u.user_id
            WHERE pl.status = 'active'
            ORDER BY pl.activated_at DESC
        `;

        const [rows] = await db.query(query);

        // Format lại dữ liệu trước khi gửi về frontend
        const formattedData = rows.map(row => {
            // Xử lý mảng hình ảnh lưu dưới dạng chuỗi JSON
            let images = [];
            try { images = JSON.parse(row.images_uploaded || '[]'); } catch (e) {}

            return {
                id: row.id,
                title: row.title,
                type: row.type || 'khac',
                address: row.address,
                price: parseFloat(row.price),
                area: parseFloat(row.area),
                bedrooms: row.bedrooms,
                bathrooms: row.bathrooms,
                image: images.length > 0 ? images[0] : 'https://placehold.co/600x400?text=No+Image', // Lấy ảnh đầu tiên
                postedAt: row.postedAt,
                description: row.description,
                sale: {
                    name: row.sale_name || 'Đang cập nhật',
                    phone: row.sale_phone || 'Đang cập nhật',
                    avatar: "https://lh3.googleusercontent.com/aida-public/AB6AXuBrYFnDt_cyjQAZI_u_dD80Nz4WyX8S1s7SRTHFxHu9_lrXXvvHSPbPuYnfMeUAr-KVOTapfqO7lSo2lJgI0xi1C3-_3xN5mr6-IK9It9XiFbKeFMHj2Y60B28EqzoCkPNOy12AiboPA_R4nGl3HbsRuu9OofxgDOF4AAo3N72g7sWDR-oOWHFF4hULhNvD8umCgXUMioe56KrzMeETQBFClXHpTy8v8vaBzxGzhzSCkdVT3vq58Wu_3J5V4pAwudpTJCTDeR-1f90" // Cứng avatar tạm thời vì DB chưa có
                }
            };
        });

        res.json(formattedData);
    } catch (err) {
        console.error('Lỗi lấy danh sách bài đăng:', err);
        res.status(500).json({ message: 'Lỗi server' });
    }
});

module.exports = router;