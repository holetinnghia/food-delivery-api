const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
require('dotenv').config(); // Load biến môi trường từ .env
const app = express();

// --- 1. CẤU HÌNH ---
app.use(cors()); // Cho phép Android gọi vào
app.use(express.json()); // Để đọc JSON từ body request

// --- 2. KẾT NỐI DATABASE (AIVEN) ---
// ⚠️ QUAN TRỌNG: Thay thông tin của mày vào đây
const pool = mysql.createPool({
    host: process.env.DB_HOST, // 1. Host
    user: process.env.DB_USER,                              // 2. User
    password: process.env.DB_PASSWORD,                  // 3. Password (Aiven)
    database: process.env.DB_NAME,                  // 4. Tên DB
    port: process.env.DB_PORT,                                     // <-- Thay PORT (thường là 26379 hoặc số khác)
    ssl: { rejectUnauthorized: false },            // Bắt buộc với Aiven
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Test kết nối ngay khi chạy server
pool.getConnection((err, connection) => {
    if (err) {
        console.error('❌ Lỗi kết nối Database:', err.message);
    } else {
        console.log('✅ Đã kết nối Database thành công!');
        connection.release();
    }
});

// --- 3. CÁC API (ENDPOINTS) ---

// [API 0] Trang chủ (Để fix lỗi Cannot GET /)
app.get('/', (req, res) => {
    res.send('<h1 style="color:green; text-align:center">🚀 Server Food App đang chạy ngon lành!</h1>');
});

// [API 1] ĐĂNG KÝ
// URL: /api/register
// Body: { "username": "a", "password": "b", "full_name": "c", "phone": "d" }
app.post('/api/register', (req, res) => {
    const { username, password, full_name, phone } = req.body;

    // Validate
    if (!username || !password) {
        return res.status(400).json({ message: "Thiếu username hoặc password!", success: false });
    }

    // Insert vào bảng 'users'
    // Mặc định role là 'customer'
    const sql = "INSERT INTO users (username, password, full_name, phone, role) VALUES (?, ?, ?, ?, 'customer')";

    pool.query(sql, [username, password, full_name, phone], (err, result) => {
        if (err) {
            // Lỗi trùng username
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({ message: "Tài khoản đã tồn tại!", success: false });
            }
            return res.status(500).json({ error: err.message, success: false });
        }
        res.json({ message: "Đăng ký thành công! Vui lòng nhập OTP.", success: true });
    });
});

// [API 2] XÁC THỰC OTP (Giả lập)
// URL: /api/verify-otp
// Body: { "otp": "123456" }
app.post('/api/verify-otp', (req, res) => {
    const { otp } = req.body;
    if (otp === "123456") {
        res.json({ message: "Kích hoạt thành công!", success: true });
    } else {
        res.status(400).json({ message: "OTP sai! (Gợi ý: 123456)", success: false });
    }
});

// [API 3] ĐĂNG NHẬP
// URL: /api/login
// Body: { "username": "...", "password": "..." }
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    // Select từ bảng 'users'
    const sql = "SELECT * FROM users WHERE username = ? AND password = ?";

    pool.query(sql, [username, password], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });

        if (results.length > 0) {
            const user = results[0];
            // Xóa password trước khi trả về để bảo mật
            delete user.password;

            res.json({
                message: "Đăng nhập thành công!",
                success: true,
                user: user // Trả về object chứa user_id, full_name, role...
            });
        } else {
            res.status(401).json({ message: "Sai tài khoản hoặc mật khẩu!", success: false });
        }
    });
});

// [API 4] LẤY DANH MỤC
// URL: /api/categories
app.get('/api/categories', (req, res) => {
    const sql = "SELECT * FROM categories";
    pool.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// [API 5] LỌC SẢN PHẨM (Có Lazy Load + Sắp xếp giá)
// URL: /api/filter?category_id=1&page=1&limit=10
app.get('/api/filter', (req, res) => {
    const category_id = req.query.category_id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    if (!category_id) {
        return res.status(400).json({ message: "Thiếu category_id!", success: false });
    }

    // Query chuẩn với schema của mày:
    // - Lọc theo category_id
    // - Lọc is_active = 1 (chỉ lấy món đang bán)
    // - Sắp xếp price tăng dần (ASC)
    // - Phân trang (LIMIT, OFFSET)
    const sql = `
        SELECT * FROM products 
        WHERE category_id = ? AND is_active = 1
        ORDER BY price ASC 
        LIMIT ? OFFSET ?
    `;

    pool.query(sql, [category_id, limit, offset], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// --- [API MỚI] 6. LẤY THÔNG TIN PROFILE ---
// URL: /api/profile/1  (Số 1 là user_id)
app.get('/api/profile/:id', (req, res) => {
    const userId = req.params.id; // Lấy ID từ trên link

    if (!userId) return res.status(400).json({ message: "Thiếu User ID", success: false });

    const sql = "SELECT * FROM users WHERE user_id = ?";
    pool.query(sql, [userId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message, success: false });

        if (results.length > 0) {
            const user = results[0];
            delete user.password; // Bảo mật: Không trả về password

            res.json({
                success: true,
                user: user // Trả về object user
            });
        } else {
            res.status(404).json({ message: "Không tìm thấy user này!", success: false });
        }
    });
});

// --- 4. KHỞI CHẠY ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server đang chạy tại port ${PORT}`);
});

// --- 5. KEEP ALIVE (PING RENDER) ---
const https = require('https');

function keepAlive() {
    const url = 'https://food-delivery-api-4zc2.onrender.com';
    https.get(url, (res) => {
        console.log(`Ping sent to ${url} - Status: ${res.statusCode}`);
    }).on('error', (e) => {
        console.error(`Ping error: ${e.message}`);
    });
}

// Ping mỗi 5 phút (5 * 60 * 1000 ms)
setInterval(keepAlive, 5 * 60 * 1000);