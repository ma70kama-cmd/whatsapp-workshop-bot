const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');

const db = new sqlite3.Database('./workshop.db', (err) => {
    if (err) console.error('خطأ في قاعدة البيانات:', err.message);
});

db.run(`CREATE TABLE IF NOT EXISTS bookings (
    phone TEXT PRIMARY KEY,
    name TEXT,
    status TEXT DEFAULT 'جديد',
    date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

let globalSock = null;

app.get('/dashboard', (req, res) => {
    db.all(`SELECT * FROM bookings ORDER BY date DESC`, [], (err, rows) => {
        if (err) return res.status(500).send('خطأ في جلب البيانات');

        const totalCount = rows.length;
        const newCount = rows.filter(r => r.status === 'جديد').length;
        const designCount = rows.filter(r => r.status === 'جاري تصميم').length;
        const readyCount = rows.filter(r => r.status === 'جاهز').length;
        const deliveredCount = rows.filter(r => r.status === 'تم التسليم').length;
        const noReplyCount = rows.filter(r => r.status === 'لم يرد').length;

        const statuses = ['جديد', 'جاري تصميم', 'جاهز', 'تم التسليم', 'لم يرد'];

        let html = `
        <html lang="ar" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <title>لوحة متابعة الأوردات - إدارة الورشة</title>
            <style>
                body { font-family: Tahoma, sans-serif; background: #f4f7f6; margin: 0; padding: 20px; direction: rtl; display: flex; gap: 20px; }
                .main-content { flex: 1; display: flex; flex-direction: column; gap: 20px; }
                
                /* الإحصائيات العلوية */
                .stats-container { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 15px; }
                .stat-card { background: white; padding: 15px; border-radius: 12px; text-align: center; box-shadow: 0 2px 5px rgba(0,0,0,0.05); border-top: 4px solid #007bff; }
                .stat-card.new { border-top-color: #17a2b8; }
                .stat-card.design { border-top-color: #ffc107; }
                .stat-card.ready { border-top-color: #28a745; }
                .stat-card.delivered { border-top-color: #6f42c1; }
                .stat-card h4 { margin: 0 0 5px 0; font-size: 13px; color: #666; }
                .stat-card span { font-size: 22px; font-weight: bold; color: #333; }

                /* جدول البيانات الرئيسي */
                .table-card { background: white; padding: 20px; border-radius: 12px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); }
                table { width: 100%; border-collapse: collapse; margin-top: 15px; text-align: right; }
                th { background: #007bff; color: white; padding: 12px; font-size: 14px; }
                td { padding: 12px; border-bottom: 1px solid #eee; font-size: 14px; color: #333; }
                tr:hover { background: #f8f9fa; }
                
                .badge { padding: 5px 10px; border-radius: 20px; font-size: 12px; color: white; font-weight: bold; display: inline-block; }
                .badge-جديد { background: #17a2b8; }
                .badge-جاري_تصميم { background: #ffc107; color: #333; }
                .badge-جاهز { background: #28a745; }
                .badge-تم_التسليم { background: #6f42c1; }
                .badge-لم_يرد { background: #dc3545; }

                .whatsapp-btn { background: #25d366; color: white; padding: 5px 10px; border-radius: 6px; text-decoration: none; font-size: 13px; display: inline-flex; align-items: center; gap: 5px; }
                .action-select { padding: 6px; border-radius: 6px; border: 1px solid #ccc; background: #fff; font-family: Tahoma; }
                .delete-btn { background: #dc3545; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; }

                /* القائمة الجانبية */
                .sidebar { width: 260px; background: white; padding: 20px; border-radius: 12px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); display: flex; flex-direction: column; gap: 15px; height: fit-content; }
                .sidebar h3 { text-align: center; color: #333; margin-bottom: 0; }
                .sidebar p { text-align: center; color: #888; font-size: 12px; margin-top: 2px; }
                .sidebar-btn { padding: 12px; border-radius: 8px; border: none; background: #f8f9fa; color: #333; text-align: right; font-weight: bold; cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
                .sidebar-btn.active { background: #007bff; color: white; }
                .sidebar-btn.logout { background: #dc3545; color: white; text-align: center; justify-content: center; }
            </style>
        </head>
        <body>

            <!-- محتوى لوحة التحكم الرئيسي -->
            <div class="main-content">
                
                <!-- مربعات الإحصائيات -->
                <div class="stats-container">
                    <div class="stat-card">
                        <h4>إجمالي الحجوزات</h4>
                        <span>${totalCount}</span>
                    </div>
                    <div class="stat-card new">
                        <h4>الحجوزات الجديدة</h4>
                        <span>${newCount}</span>
                    </div>
                    <div class="stat-card design">
                        <h4>خلص التصميم</h4>
                        <span>${designCount}</span>
                    </div>
                    <div class="stat-card ready">
                        <h4>جاهزة</h4>
                        <span>${readyCount}</span>
                    </div>
                    <div class="stat-card delivered">
                        <h4>تم التسليم</h4>
                        <span>${deliveredCount}</span>
                    </div>
                    <div class="stat-card" style="border-top-color: #dc3545;">
                        <h4>لم يرد</h4>
                        <span>${noReplyCount}</span>
                    </div>
                </div>

                <!-- جدول الطلبات -->
                <div class="table-card">
                    <h3 style="margin-top:0; color:#333;">📦 طلبات وتفاصيل حجز الزوار</h3>
                    <table>
                        <thead>
                            <tr>
                                <th>الحالة</th>
                                <th>التاريخ والوقت</th>
                                <th>البيانات الأساسية</th>
                                <th>الإجراء الإداري</th>
                                <th>حذف</th>
                            </tr>
                        </thead>
                        <tbody>`;

        if (rows.length === 0) {
            html += `<tr><td colspan="5" style="text-align: center; color: #888;">لا توجد أي أوردرات مسجلة حتى الآن</td></tr>`;
        } else {
            rows.forEach(row => {
                let cleanPhone = row.phone.replace(/[^0-9]/g, '');
                let badgeClass = 'badge-' + row.status.replace(/\s+/g, '_');
                
                html += `<tr>
                            <td><span class="badge ${badgeClass}">${row.status}</span></td>
                            <td>${row.date}</td>
                            <td>
                                <b>${row.name || 'بدون اسم'}</b><br>
                                <a href="https://wa.me/${cleanPhone}" target="_blank" class="whatsapp-btn">💬 واتساب (${cleanPhone})</a>
                            </td>
                            <td>
                                <select class="action-select" onchange="updateStatus('${row.phone}', this.value)">`;
                statuses.forEach(s => {
                    html += `<option value="${s}" ${row.status === s ? 'selected' : ''}>${s}</option>`;
                });
                html += `</select>
                            </td>
                            <td>
                                <button class="delete-btn" onclick="deleteBooking('${row.phone}')">حذف</button>
                            </td>
                         </tr>`;
            });
        }

        html += `       </tbody>
                    </table>
                </div>

            </div>

            <!-- القائمة الجانبية (Sidebar) -->
            <div class="sidebar">
                <h3>لوحة الإدارة</h3>
                <p>tal5es v1</p>
                <hr style="border:0; border-top:1px solid #eee; margin:5px 0;">
                <button class="sidebar-btn">✏️ تعديل الاستمارة</button>
                <button class="sidebar-btn active">📊 الطلبات (${totalCount})</button>
                <button class="sidebar-btn">📂 الأقسام الإضافية</button>
                <button class="sidebar-btn">⚙️ بيانات المدير</button>
                <br>
                <button class="sidebar-btn" style="background:#17a2b8; color:white; justify-content:center;" onclick="location.reload()">🔄 تحديث السيرفر</button>
                <button class="sidebar-btn logout">🚪 تسجيل الخروج</button>
            </div>

            <script>
                async function updateStatus(phone, newStatus) {
                    await fetch('/update-status', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ phone, status: newStatus })
                    });
                    location.reload();
                }

                async function deleteBooking(phone) {
                    if (confirm('هل أنت متأكد من حذف هذا الأوردر؟')) {
                        await fetch('/delete-booking', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ phone })
                        });
                        location.reload();
                    }
                }
            </script>
        </body>
        </html>`;

        res.send(html);
    });
});

app.post('/update-status', (req, res) => {
    const { phone, status } = req.body;
    db.run(`UPDATE bookings SET status = ? WHERE phone = ?`, [status, phone], (err) => {
        if (err) return res.status(500).send('خطأ في التحديث');
        res.sendStatus(200);
    });
});

app.post('/delete-booking', (req, res) => {
    const { phone } = req.body;
    db.run(`DELETE FROM bookings WHERE phone = ?`, [phone], (err) => {
        if (err) return res.status(500).send('خطأ في الحذف');
        res.sendStatus(200);
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'info' }),
        printQRInTerminal: false,
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    globalSock = sock;

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            const qrLink = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=` + encodeURIComponent(qr);
            console.log('\n==============================');
            console.log('اضغط على الرابط لفتح الـ QR Code الجديد:');
            console.log(qrLink);
            console.log('==============================\n');
        }

        if (connection === 'open') {
            console.log('✅ تم اتصال البوت بالواتساب وثبات الجلسة بنجاح!');
        } else if (connection === 'close') {
            const shouldReconnect = (new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('⚠️ انقطع الاتصال، جاري إعادة المحاولة:', shouldReconnect);
            if (shouldReconnect) {
                setTimeout(startBot, 5000);
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const senderPhone = msg.key.remoteJid;
        const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text;

        if (!messageText) return;

        db.get(`SELECT * FROM bookings WHERE phone = ?`, [senderPhone], async (err, row) => {
            if (!row) {
                db.run(`INSERT INTO bookings (phone, name, status) VALUES (?, ?, 'جديد')`, [senderPhone, messageText.trim()]);
                await sock.sendMessage(senderPhone, { text: 'أهلاً بك! تم تسجيل طلبك بنجاح وهنتواصل معاك قريباً.' });
            } else {
                await sock.sendMessage(senderPhone, { text: 'أهلاً بك مجدداً، لقد تلقينا رسالتك بالفعل وسيتم متابعتها.' });
            }
        });
    });
}

startBot();const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');

const db = new sqlite3.Database('./workshop.db', (err) => {
    if (err) console.error('خطأ في قاعدة البيانات:', err.message);
});

db.run(`CREATE TABLE IF NOT EXISTS bookings (
    phone TEXT PRIMARY KEY,
    name TEXT,
    status TEXT DEFAULT 'جديد',
    date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

let globalSock = null;

app.get('/dashboard', (req, res) => {
    db.all(`SELECT * FROM bookings ORDER BY date DESC`, [], (err, rows) => {
        if (err) return res.status(500).send('خطأ في جلب البيانات');

        const statuses = ['جديد', 'جاري تصميم', 'جاهز', 'تم التسليم', 'لم يرد'];

        let html = `
        <html lang="ar" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <title>لوحة متابعة الأوردات</title>
            <style>
                body { font-family: Tahoma, sans-serif; background: #f4f7f6; padding: 20px; direction: rtl; }
                h2 { text-align: center; color: #333; margin-bottom: 10px; }
                .manual-form { background: white; padding: 15px; border-radius: 8px; max-width: 500px; margin: 0 auto 20px auto; box-shadow: 0 2px 5px rgba(0,0,0,0.05); display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
                .manual-form input, .manual-form select { padding: 8px; border: 1px solid #ccc; border-radius: 4px; font-family: Tahoma; flex: 1; min-width: 120px; }
                .manual-form button { padding: 8px 15px; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer; }
                .manual-form button:hover { opacity: 0.9; }
                .board { display: flex; gap: 15px; overflow-x: auto; padding-bottom: 20px; }
                .column { background: #fff; border-radius: 8px; width: 280px; min-width: 280px; padding: 15px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); display: flex; flex-direction: column; max-height: 75vh; overflow-y: auto; }
                .column h3 { text-align: center; background: #007bff; color: white; padding: 10px; border-radius: 6px; margin-top: 0; font-size: 16px; }
                .card { background: white; padding: 12px; border-radius: 6px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); font-size: 14px; }
                .card b { color: #333; }
                .card select { width: 100%; padding: 6px; margin: 8px 0; border-radius: 4px; border: 1px solid #ccc; font-family: Tahoma; background: #f8f9fa; }
                .card button { padding: 5px 10px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer; width: 100%; margin-top: 5px; }
                .card button:hover { opacity: 0.9; }
            </style>
        </head>
        <body>
            <h2>إدارة ورشة الليزر - متابعة الأوردرات</h2>
            
            <!-- نموذج إضافة أوردر يدوي -->
            <form class="manual-form" action="/add-manual" method="POST">
                <input type="text" name="name" placeholder="اسم العميل" required>
                <input type="text" name="phone" placeholder="رقم التليفون" required>
                <select name="status">
                    ${statuses.map(s => `<option value="${s}">${s}</option>`).join('')}
                </select>
                <button type="submit">➕ إضافة أوردر</button>
            </form>

            <div class="board">`;

        statuses.forEach(status => {
            const filteredRows = rows.filter(r => r.status === status);
            html += `<div class="column">
                        <h3>${status} (${filteredRows.length})</h3>`;
            
            filteredRows.forEach(row => {
                let cleanPhone = row.phone.replace(/[^0-9]/g, '');
                
                html += `<div class="card">
                            <b>${row.name || 'بدون اسم'}</b><br>
                            📞 ${cleanPhone}<br>
                            🕒 ${row.date}
                            <select onchange="updateStatus('${row.phone}', this.value)">`;
                statuses.forEach(s => {
                    html += `<option value="${s}" ${row.status === s ? 'selected' : ''}>${s}</option>`;
                });
                html += `</select>
                         <button onclick="deleteBooking('${row.phone}')">حذف الأوردر</button>
                         </div>`;
            });

            html += `</div>`;
        });

        html += `</div>
            <script>
                async function updateStatus(phone, newStatus) {
                    await fetch('/update-status', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ phone, status: newStatus })
                    });
                    location.reload();
                }

                async function deleteBooking(phone) {
                    if (confirm('هل أنت متأكد من حذف هذا الأوردر؟')) {
                        await fetch('/delete-booking', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ phone })
                        });
                        location.reload();
                    }
                }
            </script>
        </body>
        </html>`;

        res.send(html);
    });
});

// مسار استقبال الأوردر اليدوي
app.post('/add-manual', (req, res) => {
    let { phone, name, status } = req.body;
    // التأكد من حفظ الرقم بصيغة مميزة ومنظمة
    let formattedPhone = phone.includes('@') ? phone : phone + '@s.whatsapp.net';
    
    db.run(`INSERT OR REPLACE INTO bookings (phone, name, status) VALUES (?, ?, ?)`, [formattedPhone, name, status], (err) => {
        if (err) console.error('خطأ في الإضافة اليدوية:', err.message);
        res.redirect('/dashboard');
    });
});

app.post('/update-status', (req, res) => {
    const { phone, status } = req.body;
    db.run(`UPDATE bookings SET status = ? WHERE phone = ?`, [status, phone], (err) => {
        if (err) return res.status(500).send('خطأ في التحديث');
        res.sendStatus(200);
    });
});

app.post('/delete-booking', (req, res) => {
    const { phone } = req.body;
    db.run(`DELETE FROM bookings WHERE phone = ?`, [phone], (err) => {
        if (err) return res.status(500).send('خطأ في الحذف');
        res.sendStatus(200);
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'info' }),
        printQRInTerminal: false,
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    globalSock = sock;

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            const qrLink = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=` + encodeURIComponent(qr);
            console.log('\n==============================');
            console.log('اضغط على الرابط لفتح الـ QR Code الجديد:');
            console.log(qrLink);
            console.log('==============================\n');
        }

        if (connection === 'open') {
            console.log('✅ تم اتصال البوت بالواتساب وثبات الجلسة بنجاح!');
        } else if (connection === 'close') {
            const shouldReconnect = (new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('⚠️ انقطع الاتصال، جاري إعادة المحاولة:', shouldReconnect);
            if (shouldReconnect) {
                setTimeout(startBot, 5000);
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const senderPhone = msg.key.remoteJid;
        const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text;

        if (!messageText) return;

        db.get(`SELECT * FROM bookings WHERE phone = ?`, [senderPhone], async (err, row) => {
            if (!row) {
                db.run(`INSERT INTO bookings (phone, name, status) VALUES (?, ?, 'جديد')`, [senderPhone, messageText.trim()]);
                await sock.sendMessage(senderPhone, { text: 'أهلاً بك! تم تسجيل طلبك بنجاح وهنتواصل معاك قريباً.' });
            } else {
                await sock.sendMessage(senderPhone, { text: 'أهلاً بك مجدداً، لقد تلقينا رسالتك بالفعل وسيتم متابعتها.' });
            }
        });
    });
}

startBot();
