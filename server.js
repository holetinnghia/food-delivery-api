// server.js - Backend chuẩn cho App Food Delivery
// Code by Gemini - For Student Project

const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const app = express();

// --- CẤU HÌNH ---
app.use(cors()); // Cho phép Android gọi API
app.use(express.json()); // Cho phép đọc JSON từ Body

// --- KẾT NỐI DATABASE (Aiven MySQL) ---
// ⚠️ QUAN TRỌNG: Thay thông tin của mày vào đây
const pool = mysql.createPool({
    host: 'demo-mysql-thang-ban.aivencloud.com', // 1. Host
    user: 'avnadmin',                              // 2. User
    password: 'password_cua_may',                  // 3. Password (Aiven)
    database: 'food_delivery_db',                  // 4. Tên DB
    port: 26379,                                   // 5. Port
    ssl: { rejectUnauthorized: false },            // Bắt buộc với Aiven
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Kiểm tra kết nối khi khởi động
pool.getConnection((err, connection) => {
    if (err) {
        console.error('❌ Lỗi kết nối Database:', err.message);
    } else {
        console.log('✅ Đã kết nối Database thành công!');
        connection.release();
    }
});

// --- CÁC API (Endpoints) ---

// 0. Trang chủ (Để kiểm tra Server sống hay chết)
app.get('/', (req, res) => {
    res.send(`
        <h1 style="color: green; text-align: center; margin-top: 20%;">
            🚀 Server Food App Đang Chạy Ngon Lành!
        </h1>
        <p style="text-align: center;">Base URL: <b>${req.protocol}://${req.get('host')}</b></p>
    `);
});

// 1. ĐĂNG KÝ (Register)
// Input: { "username": "...", "password": "...", "full_name": "...", "phone": "..." }
app.post('/api/register', (req, res) => {
    const { username, password, full_name, phone } = req.body;

    // Validate dữ liệu cơ bản
    if (!username || !password) {
        return res.status(400).json({ message: "Thiếu tài khoản hoặc mật khẩu!" });
    }

    // Role mặc định là 'customer'
    const sql = "INSERT INTO users (username, password, full_name, phone, role) VALUES (?, ?, ?, ?, 'customer')";

    pool.query(sql, [username, password, full_name, phone], (err, result) => {
        if (err) {
            // Lỗi trùng username (Duplicate entry)
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({ message: "Tài khoản này đã có người dùng!" });
            }
            return res.status(500).json({ error: "Lỗi Server: " + err.message });
        }
        res.json({ message: "Đăng ký thành công! Vui lòng xác thực OTP.", success: true });
    });
});

// 2. XÁC THỰC OTP (Giả lập)
// Input: { "otp": "123456" }
app.post('/api/verify-otp', (req, res) => {
    const { otp } = req.body;
    // Hard-code OTP là 123456 để test cho lẹ
    if (otp && otp === "123456") {
        res.json({ message: "Kích hoạt thành công!", success: true });
    } else {
        res.status(400).json({ message: "OTP sai! (Gợi ý: nhập 123456)", success: false });
    }
});

// 3. ĐĂNG NHẬP (Login)
// Input: { "username": "...", "password": "..." }
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    // ⚠️ Note cho dân ATTT: Ở đây đang so sánh plain text để demo.
    // Thực tế phải dùng bcrypt.compare(password, db_hash)
    const sql = "SELECT * FROM users WHERE username = ? AND password = ?";

    pool.query(sql, [username, password], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });

        if (results.length > 0) {
            const user = results[0];
            // Xóa password khỏi object trả về để bảo mật
            delete user.password;

            res.json({
                message: "Đăng nhập thành công!",
                success: true,
                user: user // Trả về thông tin user để lưu vào SharedPreferences trên Android
            });
        } else {
            res.status(401).json({ message: "Sai tài khoản hoặc mật khẩu!", success: false });
        }
    });
});

// 4. LẤY DANH MỤC (Cho trang Main - Horizontal List)
// Output: Danh sách [ {category_id, name, image_url}, ... ]
app.get('/api/categories', (req, res) => {
    const sql = "SELECT * FROM categories";
    pool.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// 5. LỌC SẢN PHẨM (Lazy Load + Sort Price ASC)
// Link: /api/filter?category_id=1&page=1&limit=10
app.get('/api/filter', (req, res) => {
    const category_id = req.query.category_id;

    // Xử lý phân trang (Pagination)
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    if (!category_id) {
        return res.status(400).json({ message: "Thiếu category_id!" });
    }

    // Logic: Lấy sản phẩm active -> Theo Cate -> Sắp xếp giá tăng dần -> Phân trang
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

// --- KHỞI CHẠY SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server đang chạy tại port ${PORT}`);
});