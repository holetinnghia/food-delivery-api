const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const sgMail = require('@sendgrid/mail');
require('dotenv').config();
const app = express();

app.use(cors());
app.use(express.json());

const otpStore = new Map();

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    ssl: {rejectUnauthorized: false},
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Kiểm tra kết nối DB đơn giản
pool.getConnection((err, connection) => {
    if (err) {
        console.error('Kết nối Database thất bại:', err.message);
    } else {
        console.log('Kết nối Database thành công');
        connection.release();
    }
});

app.get('/', (req, res) => {
    res.send('Server Food App đang chạy');
});

app.post('/api/otp/send', async (req, res) => {
    const {username, password, full_name, phone, email} = req.body;

    if (!username || !password || !email) {
        return res.status(400).json({message: "Thiếu thông tin bắt buộc", success: false});
    }

    try {
        const [users] = await pool.promise().query("SELECT * FROM users WHERE username = ? OR email = ?", [username, email]);

        if (users.length > 0) {
            return res.status(409).json({message: "Tài khoản hoặc Email đã tồn tại", success: false});
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        otpStore.set(email, {
            otp,
            data: {username, password, full_name, phone, email},
            expires: Date.now() + 5 * 60 * 1000
        });

        await sgMail.send({
            to: email,
            from: process.env.EMAIL_USER,
            subject: 'Mã xác thực Food App',
            text: `Mã OTP của bạn là: ${otp}. Mã này có hiệu lực trong 5 phút.`,
            html: `<strong>Mã OTP của bạn là: ${otp}</strong>. Mã này có hiệu lực trong 5 phút.`,
        });

        res.json({message: `Đã gửi OTP đến ${email}`, success: true});
    } catch (error) {
        res.status(500).json({message: "Gửi email thất bại", success: false, error});
    }
});

app.post('/api/otp/verify', async (req, res) => {
    const {email, otp} = req.body;

    if (!email || !otp) return res.status(400).json({message: "Thiếu thông tin", success: false});

    const storedOtpData = otpStore.get(email);

    if (!storedOtpData) return res.status(400).json({message: "Yêu cầu không hợp lệ", success: false});

    if (Date.now() > storedOtpData.expires) {
        otpStore.delete(email);
        return res.status(400).json({message: "OTP đã hết hạn", success: false});
    }

    if (storedOtpData.otp !== otp) {
        return res.status(400).json({message: "OTP không chính xác", success: false});
    }

    const {username, password, full_name, phone} = storedOtpData.data;

    try {
        await pool.promise().query(
            "INSERT INTO users (username, password, full_name, phone, email, role) VALUES (?, ?, ?, ?, ?, 'customer')",
            [username, password, full_name, phone, email]
        );
        otpStore.delete(email);
        res.json({message: "Đăng ký thành công", success: true});
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({message: "Tài khoản đã tồn tại", success: false});
        }
        res.status(500).json({error: err.message, success: false});
    }
});

app.post('/api/login', async (req, res) => {
    const {username, password} = req.body;

    try {
        const [results] = await pool.promise().query("SELECT * FROM users WHERE username = ? AND password = ?", [username, password]);
        if (results.length > 0) {
            const user = results[0];
            delete user.password;
            res.json({message: "Đăng nhập thành công", success: true, user});
        } else {
            res.status(401).json({message: "Sai tài khoản hoặc mật khẩu", success: false});
        }
    } catch (err) {
        res.status(500).json({error: err.message});
    }
});

app.get('/api/categories', async (req, res) => {
    try {
        const [results] = await pool.promise().query("SELECT * FROM categories");
        res.json(results);
    } catch (err) {
        res.status(500).json({error: err.message});
    }
});

app.get('/api/filter', async (req, res) => {
    const {category_id, page = 1, limit = 10} = req.query;
    const offset = (page - 1) * limit;

    if (!category_id) return res.status(400).json({message: "Thiếu category_id", success: false});

    try {
        const sql = "SELECT * FROM products WHERE category_id = ? AND is_active = 1 ORDER BY price ASC LIMIT ? OFFSET ?";
        // Lưu ý: limit và offset cần parse sang số nguyên để tránh lỗi syntax SQL
        const [results] = await pool.promise().query(sql, [category_id, parseInt(limit), parseInt(offset)]);
        res.json(results);
    } catch (err) {
        res.status(500).json({error: err.message});
    }
});

app.get('/api/profile/:id', async (req, res) => {
    try {
        const [results] = await pool.promise().query("SELECT * FROM users WHERE user_id = ?", [req.params.id]);
        if (results.length > 0) {
            const user = results[0];
            delete user.password;
            res.json({success: true, user});
        } else {
            res.status(404).json({message: "Không tìm thấy user", success: false});
        }
    } catch (err) {
        res.status(500).json({error: err.message, success: false});
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server đang chạy tại port ${PORT}`);
});
