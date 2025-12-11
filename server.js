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


pool.getConnection((err, connection) => {
    if (err) {
        console.error('Lỗi kết nối Database:', err.message);
    } else {
        console.log('Đã kết nối Database thành công');
        connection.release();
    }
});


app.get('/', (req, res) => {
    res.send('Server Food App đang chạy ngon lành!');
});


app.post('/api/otp/send', async (req, res) => {
    console.log("--- [BẮT ĐẦU LUỒNG GỬI EMAIL - DÙNG SENDGRID API] ---");
    console.log("[1] Client yêu cầu gửi OTP với dữ liệu:", req.body);
    const {username, password, full_name, phone, email} = req.body;

    if (!username || !password || !email) {
        console.error("[LỖI] Dữ liệu không hợp lệ:", {username, password, email});
        return res.status(400).json({message: "Thiếu username, password hoặc email!", success: false});
    }

    try {
        const checkSql = "SELECT * FROM users WHERE username = ? OR email = ?";
        const [results] = await pool.promise().query(checkSql, [username, email]);

        if (results.length > 0) {
            console.warn("[CẢNH BÁO] Username hoặc Email đã tồn tại:", {username, email});
            return res.status(409).json({message: "Username hoặc Email đã được sử dụng!", success: false});
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expirationTime = Date.now() + 5 * 60 * 1000;
        otpStore.set(email, {
            otp: otp,
            data: {username, password, full_name, phone, email},
            expires: expirationTime
        });
        console.log(`[2] Đã tạo và lưu OTP: ${otp} cho email: ${email}`);

        const msg = {
            to: email,
            from: process.env.EMAIL_USER,
            subject: 'Mã xác thực đăng ký tài khoản Food App',
            text: `Mã OTP của bạn là: ${otp}. Mã này có hiệu lực trong 5 phút.`,
            html: `<strong>Mã OTP của bạn là: ${otp}</strong>. Mã này có hiệu lực trong 5 phút.`,
        };
        console.log("[3] Chuẩn bị gửi email đến SendGrid API với thông tin:", msg);

        const sendGridResponse = await sgMail.send(msg);

        console.log("[4B - THÀNH CÔNG] SendGrid API phản hồi thành công:", sendGridResponse[0].statusCode);
        console.log("--- [KẾT THÚC LUỒNG GỬI EMAIL - THÀNH CÔNG] ---");
        res.json({message: `Mã OTP đã được gửi đến ${email}.`, success: true});

    } catch (error) {
        console.error("[4A - LỖI] SendGrid API hoặc hệ thống báo lỗi:", error);
        if (error.response) {
            console.error("Chi tiết lỗi từ SendGrid:", error.response.body);
        }
        console.log("--- [KẾT THÚC LUỒNG GỬI EMAIL - THẤT BẠI] ---");
        res.status(500).json({message: "Gửi email thất bại.", success: false, error_details: error});
    }
});


app.post('/api/otp/verify', (req, res) => {
    const {email, otp} = req.body;

    if (!email || !otp) {
        return res.status(400).json({message: "Thiếu email hoặc OTP!", success: false});
    }

    const storedOtpData = otpStore.get(email);

    if (!storedOtpData) {
        return res.status(400).json({message: "Xác thực thất bại. Vui lòng thử lại.", success: false});
    }

    if (Date.now() > storedOtpData.expires) {
        otpStore.delete(email); // Xóa OTP hết hạn
        return res.status(400).json({message: "Mã OTP đã hết hạn!", success: false});
    }

    // Kiểm tra OTP có đúng không
    if (storedOtpData.otp !== otp) {
        return res.status(400).json({message: "Mã OTP không chính xác!", success: false});
    }

    const {username, password, full_name, phone} = storedOtpData.data;
    const sql = "INSERT INTO users (username, password, full_name, phone, email, role) VALUES (?, ?, ?, ?, ?, 'customer')";

    pool.query(sql, [username, password, full_name, phone, email], (err, result) => {
        if (err) {
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({message: "Tài khoản đã tồn tại!", success: false});
            }
            return res.status(500).json({error: err.message, success: false});
        }

        otpStore.delete(email);

        res.json({message: "Đăng ký và xác thực thành công!", success: true});
    });
});


app.post('/api/login', (req, res) => {
    const {username, password} = req.body;

    const sql = "SELECT * FROM users WHERE username = ? AND password = ?";

    pool.query(sql, [username, password], (err, results) => {
        if (err) return res.status(500).json({error: err.message});

        if (results.length > 0) {
            const user = results[0];
            delete user.password;

            res.json({
                message: "Đăng nhập thành công!",
                success: true,
                user: user
            });
        } else {
            res.status(401).json({message: "Sai tài khoản hoặc mật khẩu!", success: false});
        }
    });
});


app.get('/api/categories', (req, res) => {
    const sql = "SELECT * FROM categories";
    pool.query(sql, (err, results) => {
        if (err) return res.status(500).json({error: err.message});
        res.json(results);
    });
});


app.get('/api/filter', (req, res) => {
    const category_id = req.query.category_id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    if (!category_id) {
        return res.status(400).json({message: "Thiếu category_id!", success: false});
    }

    const sql = `
        SELECT *
        FROM products
        WHERE category_id = ?
          AND is_active = 1
        ORDER BY price ASC
        LIMIT ? OFFSET ?
    `;

    pool.query(sql, [category_id, limit, offset], (err, results) => {
        if (err) return res.status(500).json({error: err.message});
        res.json(results);
    });
});


app.get('/api/profile/:id', (req, res) => {
    const userId = req.params.id;

    if (!userId) return res.status(400).json({message: "Thiếu User ID", success: false});

    const sql = "SELECT * FROM users WHERE user_id = ?";
    pool.query(sql, [userId], (err, results) => {
        if (err) return res.status(500).json({error: err.message, success: false});

        if (results.length > 0) {
            const user = results[0];
            delete user.password;

            res.json({
                success: true,
                user: user
            });
        } else {
            res.status(404).json({message: "Không tìm thấy user này!", success: false});
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server đang chạy tại port ${PORT}`);
});
