// server.js - Phiên bản Full cho nhóm Android
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const app = express();

app.use(cors()); // Cho phép gọi từ mọi nơi
app.use(express.json()); // Để đọc được JSON từ Body gửi lên

// --- 1. KẾT NỐI DATABASE (Aiven) ---
// Nhớ thay password của mày vào đây
const pool = mysql.createPool({
    host: 'demo-mysql-thang-ban.aivencloud.com', // Thay Host của mày
    user: 'avnadmin',                              // Thay User
    password: 'password_cua_may',                  // Thay Password
    database: 'food_delivery_db',                  // Tên DB
    port: 26379,                                   // Port
    ssl: { rejectUnauthorized: false },            // SSL
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// --- 2. CÁC API CHO APP ---

// [API 1] Lấy danh sách Categories (Cho trang Main - Cuộn ngang)
// GET /api/categories
app.get('/api/categories', (req, res) => {
    pool.query('SELECT * FROM categories', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// [API 2] Lấy sản phẩm theo Category + Phân trang + Giá tăng dần
// GET /api/filter?category_id=1&page=1&limit=10
app.get('/api/filter', (req, res) => {
    const category_id = req.query.category_id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    if (!category_id) return res.status(400).json({ message: "Thiếu category_id!" });

    const sql = `
        SELECT * FROM products 
        WHERE category_id = ? 
        ORDER BY price ASC 
        LIMIT ? OFFSET ?
    `;

    pool.query(sql, [category_id, limit, offset], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// [API 3] Đăng ký tài khoản
// POST /api/register
// Body: { "username": "...", "password": "...", "full_name": "...", "phone": "..." }
app.post('/api/register', (req, res) => {
    const { username, password, full_name, phone } = req.body;

    // Mặc định tạo user xong là 'pending' (chờ OTP), nhưng để test nhanh tao để luôn là active
    // Hoặc mày có thể sửa thành role customer mặc định
    const sql = "INSERT INTO users (username, password, full_name, phone, role) VALUES (?, ?, ?, ?, 'customer')";

    pool.query(sql, [username, password, full_name, phone], (err, result) => {
        if (err) {
            // Lỗi trùng username (Duplicate entry)
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({ message: "Tài khoản đã tồn tại!" });
            }
            return res.status(500).json({ error: err.message });
        }
        res.json({ message: "Đăng ký thành công! Vui lòng nhập OTP." });
    });
});

// [API 4] Xác thực OTP (Giả lập cho đứa làm UI OTP vui)
// POST /api/verify-otp
// Body: { "otp": "123456" }
app.post('/api/verify-otp', (req, res) => {
    const { otp } = req.body;
    // Vì không gửi SMS thật, nên mình quy định cứ nhập "123456" là đúng
    if (otp === "123456") {
        res.json({ message: "Kích hoạt thành công!", status: true });
    } else {
        res.status(400).json({ message: "OTP sai rồi bạn ơi (Nhập 123456 đi)", status: false });
    }
});

// [API 5] Đăng nhập
// POST /api/login
// Body: { "username": "...", "password": "..." }
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const sql = "SELECT * FROM users WHERE username = ? AND password = ?";

    pool.query(sql, [username, password], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });

        if (results.length > 0) {
            const user = results[0];
            res.json({
                message: "Đăng nhập thành công!",
                user: user // Trả về full info để hiển thị lên Header trang Main
            });
        } else {
            res.status(401).json({ message: "Sai tài khoản hoặc mật khẩu!" });
        }
    });
});

// [API 6] Lấy chi tiết user (Nếu cần load lại info ở trang Main)
// GET /api/users/1 (Số 1 là user_id)
app.get('/api/users/:id', (req, res) => {
    const userId = req.params.id;
    pool.query('SELECT * FROM users WHERE user_id = ?', [userId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length > 0) res.json(results[0]);
        else res.status(404).json({ message: "Không tìm thấy user" });
    });
});

// Khởi chạy server
app.listen(3000, () => {
    console.log('Server Full Option đang chạy tại port 3000');
});