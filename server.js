const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const nodemailer = require('nodemailer'); // Thêm nodemailer
require('dotenv').config();
const app = express();

// --- 1. CẤU HÌNH ---
app.use(cors());
app.use(express.json());

// --- KHO LƯU TRỮ OTP TẠM THỜI ---
// Key: email, Value: { otp, data, expires }
const otpStore = new Map();

// --- CẤU HÌNH GỬI EMAIL (NODEMAILER) ---
// Thử với port 587 và STARTTLS
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // `secure:false` vì port 587 sử dụng STARTTLS
    auth: {
        user: process.env.EMAIL_USER, // Lấy từ file .env
        pass: process.env.EMAIL_PASS  // Lấy từ file .env
    },
    connectionTimeout: 10000, // 10 seconds
    greetingTimeout: 10000,   // 10 seconds
    socketTimeout: 10000      // 10 seconds
});


// --- 2. KẾT NỐI DATABASE ---
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    ssl: { rejectUnauthorized: false },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

pool.getConnection((err, connection) => {
    if (err) {
        console.error('❌ Lỗi kết nối Database:', err.message);
    } else {
        console.log('✅ Đã kết nối Database thành công!');
        connection.release();
    }
});

// --- 3. CÁC API (ENDPOINTS) ---

app.get('/', (req, res) => {
    res.send('<h1 style="color:green; text-align:center">🚀 Server Food App đang chạy ngon lành!</h1>');
});

// [API 1] GỬI OTP ĐỂ XÁC THỰC ĐĂNG KÝ
// URL: /api/otp/send
// Body: { "username": "a", "password": "b", "full_name": "c", "phone": "d", "email": "e@mail.com" }
app.post('/api/otp/send', (req, res) => {
    const { username, password, full_name, phone, email } = req.body;

    // Validate
    if (!username || !password || !email) {
        return res.status(400).json({ message: "Thiếu username, password hoặc email!", success: false });
    }

    // 1. Kiểm tra xem username hoặc email đã tồn tại chưa
    const checkSql = "SELECT * FROM users WHERE username = ? OR email = ?";
    pool.query(checkSql, [username, email], (err, results) => {
        if (err) {
            return res.status(500).json({ error: err.message, success: false });
        }
        if (results.length > 0) {
            return res.status(409).json({ message: "Username hoặc Email đã được sử dụng!", success: false });
        }

        // 2. Tạo mã OTP ngẫu nhiên (6 chữ số)
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expirationTime = Date.now() + 5 * 60 * 1000; // Hết hạn sau 5 phút

        // 3. Lưu tạm thông tin
        otpStore.set(email, {
            otp: otp,
            data: { username, password, full_name, phone, email },
            expires: expirationTime
        });

        // 4. Gửi email
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Mã xác thực đăng ký tài khoản Food App',
            text: `Mã OTP của bạn là: ${otp}. Mã này có hiệu lực trong 5 phút.`
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error("Lỗi gửi email:", error);
                return res.status(500).json({ message: "Gửi email thất bại.", success: false });
            }
            res.json({ message: `Mã OTP đã được gửi đến ${email}.`, success: true });
        });
    });
});

// [API 2] XÁC THỰC OTP VÀ HOÀN TẤT ĐĂNG KÝ
// URL: /api/otp/verify
// Body: { "email": "e@mail.com", "otp": "123456" }
app.post('/api/otp/verify', (req, res) => {
    const { email, otp } = req.body;

    if (!email || !otp) {
        return res.status(400).json({ message: "Thiếu email hoặc OTP!", success: false });
    }

    const storedOtpData = otpStore.get(email);

    // Kiểm tra OTP có tồn tại không
    if (!storedOtpData) {
        return res.status(400).json({ message: "Xác thực thất bại. Vui lòng thử lại.", success: false });
    }

    // Kiểm tra OTP có hết hạn không
    if (Date.now() > storedOtpData.expires) {
        otpStore.delete(email); // Xóa OTP hết hạn
        return res.status(400).json({ message: "Mã OTP đã hết hạn!", success: false });
    }

    // Kiểm tra OTP có đúng không
    if (storedOtpData.otp !== otp) {
        return res.status(400).json({ message: "Mã OTP không chính xác!", success: false });
    }

    // Nếu mọi thứ đều đúng -> Tạo tài khoản
    const { username, password, full_name, phone } = storedOtpData.data;
    const sql = "INSERT INTO users (username, password, full_name, phone, email, role) VALUES (?, ?, ?, ?, ?, 'customer')";

    pool.query(sql, [username, password, full_name, phone, email], (err, result) => {
        if (err) {
            // Lỗi trùng lặp (phòng trường hợp race condition)
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({ message: "Tài khoản đã tồn tại!", success: false });
            }
            return res.status(500).json({ error: err.message, success: false });
        }

        // Xóa OTP đã sử dụng
        otpStore.delete(email);

        res.json({ message: "Đăng ký và xác thực thành công!", success: true });
    });
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
    const userId = req.params.id;

    if (!userId) return res.status(400).json({ message: "Thiếu User ID", success: false });

    const sql = "SELECT * FROM users WHERE user_id = ?";
    pool.query(sql, [userId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message, success: false });

        if (results.length > 0) {
            const user = results[0];
            delete user.password;

            res.json({
                success: true,
                user: user
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

setInterval(keepAlive, 5 * 60 * 1000);