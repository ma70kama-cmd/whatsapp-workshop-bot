const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');

const db = new sqlite3.Database('./workshop.db', (err) => {
    if (err) console.error('خطأ في قاعدة البيانات:', err.message);
});

// إنشاء الجدول مع تتبع الخطوات
db.run(`CREATE TABLE IF NOT EXISTS bookings (
    phone TEXT PRIMARY KEY,
    name TEXT,
    status TEXT DEFAULT 'جديد',
    step TEXT DEFAULT 'new',
    date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

let globalSock = null;

app.get('/dashboard', (req, res) => {
    const selectedTab = req.query.tab || 'الكل';

    db.all(`SELECT * FROM bookings ORDER BY date DESC`, [], (err, rows) => {
        if (err) return res.status(500).send('خطأ في جلب البيانات');

        const totalCount = rows.length;
        const newCount = rows.filter(r => r.status === 'جديد').length;
        const designCount = rows.filter(r => r.status === 'جاري تصميم').length;
        const readyCount = rows.filter(r => r.status === 'جاهز').length;
        const deliveredCount = rows.filter(r => r.status === 'تم التسليم').length;
        const noReplyCount = rows.filter(r => r.status === 'لم يرد').length;

        const statuses = ['جديد', 'جاري تصميم', 'جاهز', 'تم التسليم', 'لم يرد'];

        let displayedRows = rows;
        if (selectedTab !== 'الكل') {
            displayedRows = rows.filter(r => r.status === selectedTab);
        }

        let html = `
        <html lang="ar" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <title>لوحة متابعة الأوردات - إدارة الورشة</title>
            <style>
                body { font-family: Tahoma, sans-serif; background: #f0f2f5; margin: 0; padding: 20px; direction: rtl; display: flex; gap: 20px; color: #333; }
                .main-content { flex: 1; display: flex; flex-direction: column; gap: 20px; max-width: calc(100% - 280px); }
                
                .stats-container { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 15px; }
                .stat-card { background: white; padding: 15px; border-radius: 10px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border-top: 4px solid #007bff; cursor: pointer; text-decoration: none; color: inherit; transition: transform 0.2s; display: block; }
                .stat-card:hover { transform: translateY(-3px); }
                .stat-card.active-tab { background: #e7f1ff; box-shadow: 0 0 0 2px #007bff; }
                .stat-card.all { border-top-color: #007bff; }
                .stat-card.new { border-top-color: #17a2b8; }
                .stat-card.design { border-top-color: #ffc107; }
                .stat-card.ready { border-top-color: #28a745; }
                .stat-card.delivered { border-top-color: #6f42c1; }
                .stat-card.noreply { border-top-color: #dc3545; }
                .stat-card h4 { margin: 0 0 5px 0; font-size: 13px; color: #666; }
                .stat-card span { font-size: 20px; font-weight: bold; color: #333; }

                .manual-box { background: #fff; padding: 15px 20px; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); display: flex; gap: 12px; align-items: center; flex-wrap: wrap; border-right: 5px solid #28a745; }
                .manual-box input, .manual-box select { padding: 9px 12px; border: 1px solid #ced4da; border-radius: 6px; font-family: Tahoma; font-size: 13px; flex: 1; min-width: 150px; }
                .manual-box button { background: #28a745; color: white; border: none; padding: 9px 20px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 13px; }
                .manual-box button:hover { background: #218838; }

                .table-card { background: white; padding: 20px; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow-x: auto; }
                table { width: 100%; border-collapse: collapse; margin-top: 10px; text-align: right; }
                th { background: #f8f9fa; color: #495057; padding: 12px; font-size: 13px; border-bottom: 2px solid #dee2e6; }
                td { padding: 12px; border-bottom: 1px solid #dee2e6; font-size: 13px; vertical-align: middle; }
                tr:hover { background: #f8f9fa; }
                
                .badge { padding: 5px 10px; border-radius: 6px; font-size: 12px; font-weight: bold; display: inline-block; text-align: center; }
                .badge-جديد { background: #e0f7fa; color: #006064; }
                .badge-جاري_تصميم { background: #fff8e1; color: #ff8f00; }
                .badge-جاهز { background: #e8f5e9; color: #2e7d32; }
                .badge-تم_التسليم { background: #ede7f6; color: #4527a0; }
                .badge-لم_يرد { background: #ffebee; color: #c62828; }

                .whatsapp-link { color: #25d366; text-decoration: none; font-weight: bold; display: inline-flex; align-items: center; gap: 4px; }
                .whatsapp-link:hover { text-decoration: underline; }
                .action-select { padding: 6px; border-radius: 6px; border: 1px solid #ced4da; background: #fff; font-family: Tahoma; font-size: 12px; cursor: pointer; }
                .delete-btn { background: #dc3545; color: white; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 12px; }
                .delete-btn:hover { background: #c82333; }

                .sidebar { width: 260px; background: white; padding: 20px; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); display: flex; flex-direction: column; gap: 10px; height: fit-content; }
                .sidebar h3 { text-align: center; color: #333; margin-bottom: 0; }
                .sidebar p { text-align: center; color: #888; font-size: 12px; margin-top: 2px; }
                .sidebar-btn { padding: 10px 15px; border-radius: 6px; border: none; background: #f8f9fa; color: #495057; text-align: right; font-weight: bold; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-size: 13px; }
                .sidebar-btn.active { background: #007bff; color: white; }
                .sidebar-btn.logout { background: #dc3545; color: white; text-align: center; justify-content: center; }
            </style>
        </head>
        <body>

            <div class="main-content">
                <div class="stats-container">
                    <a href="/dashboard?tab=الكل" class="stat-card all ${selectedTab === 'الكل' ? 'active-tab' : ''}">
                        <h4>إجمالي الحجوزات</h4><span>${totalCount}</span>
                    </a>
                    <a href="/dashboard?tab=جديد" class="stat-card new ${selectedTab === 'جديد' ? 'active-tab' : ''}">
                        <h4>الحجوزات الجديدة</h4><span>${newCount}</span>
                    </a>
                    <a href="/dashboard?tab=جاري تصميم" class="stat-card design ${selectedTab === 'جاري تصميم' ? 'active-tab' : ''}">
                        <h4>خلص التصميم</h4><span>${designCount}</span>
                    </a>
                    <a href="/dashboard?tab=جاهز" class="stat-card ready ${selectedTab === 'جاهز' ? 'active-tab' : ''}">
                        <h4>جاهزة</h4><span>${readyCount}</span>
                    </a>
                    <a href="/dashboard?tab=تم التسليم" class="stat-card delivered ${selectedTab === 'تم التسليم' ? 'active-tab' : ''}">
                        <h4>تم التسليم</h4><span>${deliveredCount}</span>
                    </a>
                    <a href="/dashboard?tab=لم يرد" class="stat-card noreply ${selectedTab === 'لم يرد' ? 'active-tab' : ''}">
                        <h4>لم يرد</h4><span>${noReplyCount}</span>
                    </a>
                </div>

                <form class="manual-box" action="/add-manual" method="POST">
                    <input type="text" name="name" placeholder="اسم العميل الجديد" required>
                    <input type="text" name="phone" placeholder="رقم التليفون (مثال: 010xxxxxxxx)" required>
                    <select name="status">
                        ${statuses.map(s => `<option value="${s}">${s}</option>`).join('')}
                    </select>
                    <button type="submit">➕ إضافة أوردر يدوي</button>
                </form>

                <div class="table-card">
                    <h3 style="margin-top:0; color:#333; font-size: 16px;">📦 الطلبات في قسم: <span style="color:#007bff;">${selectedTab}</span> (${displayedRows.length})</h3>
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

        if (displayedRows.length === 0) {
            html += `<tr><td colspan="5" style="text-align: center; color: #888; padding: 20px;">لا توجد أي أوردرات في هذا القسم حالياً</td></tr>`;
        } else {
            displayedRows.forEach(row => {
                let cleanPhone = row.phone.replace(/[^0-9]/g, '');
                let badgeClass = 'badge-' + row.status.replace(/\s+/g, '_');
                
                html += `<tr>
                            <td><span class="badge ${badgeClass}">${row.status}</span></td>
                            <td style="color: #6c757d; font-size: 12px;">${row.date}</td>
                            <td>
                                <div style="font-weight: bold; margin-bottom: 3px;">${row.name || 'بدون اسم'}</div>
                                <a href="https://wa.me/${cleanPhone}" target="_blank" class="whatsapp-link">💬 ${cleanPhone}</a>
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

            <div class="sidebar">
                <h3>لوحة الإدارة</h3>
                <p>tal5es v1</p>
                <hr style="border:0; border-top:1px solid #eee; margin:5px 0;">
                <button class="sidebar-btn">✏️ تعديل الاستمارة</button>
                <a href="/dashboard?tab=الكل" class="sidebar-btn active" style="text-decoration:none;">📊 الطلبات (${totalCount})</a>
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

app.post('/add-manual', (req, res) => {
    let { phone, name, status } = req.body;
    let formattedPhone = phone.includes('@') ? phone : phone + '@s.whatsapp.net';
    
    db.run(`INSERT OR REPLACE INTO bookings (phone, name, status, step) VALUES (?, ?, ?, 'done')`, [formattedPhone, name, status], (err) => {
        if (err) console.error('خطأ في الإضافة اليدوية:', err.message);
        res.redirect('/dashboard');
    });
});

app.post('/update-status', async (req, res) => {
    const { phone, status } = req.body;
    db.run(`UPDATE bookings SET status = ? WHERE phone = ?`, [status, phone], async (err) => {
        if (err) return res.status(500).send('خطأ في التحديث');

        if (globalSock) {
            try {
                let messageText = `مرحباً، تم تحديث حالة طلبك في الورشة لتصبح: *${status}*`;
                if (status === 'جاهز') {
                    messageText = `🎉 أوردرك أصبح *جاهزاً* الآن للاستلام من الورشة! في انتظار تشريفك.`;
                } else if (status === 'جاري تصميم') {
                    messageText = `🎨 جارٍ العمل على تصميم أوردرك الآن.`;
                } else if (status === 'تم التسليم') {
                    messageText = `✅ تم تسليم أوردرك بنجاح. شكراً لتعاملكم معنا!`;
                }
                await globalSock.sendMessage(phone, { text: messageText });
            } catch (e) {
                console.log('فشل إرسال الرسالة:', e);
            }
        }

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
    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
        const sock = makeWASocket({
            auth: state,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            browser: ["Ubuntu", "Chrome", "20.0.04"]
        });

        globalSock = sock;

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            if (qr) {
                const qrLink = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=` + encodeURIComponent(qr);
                console.log('\n==============================');
                console.log('رابط الـ QR Code الجديد:');
                console.log(qrLink);
                console.log('==============================\n');
            }
            if (connection === 'open') {
                console.log('✅ تم اتصال البوت بنجاح!');
            } else if (connection === 'close') {
                const shouldReconnect = (new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut);
                if (shouldReconnect) setTimeout(startBot, 5000);
            }
        });

        sock.ev.on('creds.update', saveCreds);

        // طلب الاسم ورقم التليفون خطوة بخطوة
        sock.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const senderPhone = msg.key.remoteJid;
            const messageText = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();

            if (!messageText) return;

            db.get(`SELECT * FROM bookings WHERE phone = ?`, [senderPhone], async (err, row) => {
                if (!row) {
                    // الخطوة 1: العميل جديد تماماً -> نسجله بحالة "جديد" ونطلب اسمه
                    db.run(`INSERT INTO bookings (phone, name, status, step) VALUES (?, 'بدون اسم', 'جديد', 'waiting_name')`, [senderPhone]);
                    await sock.sendMessage(senderPhone, { text: 'أهلاً بك في ورشة الليزر! 🌟\nمن فضلك اكتب **اسمك**:' });
                } else if (row.step === 'waiting_name') {
                    // الخطوة 2: حفظ الاسم، وطلب رقم التليفون
                    db.run(`UPDATE bookings SET name = ?, step = 'waiting_phone' WHERE phone = ?`, [messageText, senderPhone]);
                    await sock.sendMessage(senderPhone, { text: `أهلاً بك يا ${messageText} 🤝\nمن فضلك اكتب **رقم تليفونك** للتواصل:` });
                } else if (row.step === 'waiting_phone') {
                    // الخطوة 3: حفظ الرقم وتأكيد اكتمال التسجيل (يدخل في الداشبورد تحت خانة جديد بالاسم ورقمه)
                    // نقدر نخزن الرقم الإضافي أو نكتفي برقم الواتساب، وهنا هنأكد الطلب
                    db.run(`UPDATE bookings SET step = 'done' WHERE phone = ?`, [senderPhone]);
                    await sock.sendMessage(senderPhone, { text: '✅ تم تسجيل أوردرك بنجاح وهيوظهر في قائمة الطلبات الجديدة بالورشة. في انتظارك!' });
                } else {
                    // لو العميل مسجل ومخلص خطواته قبل كده
                    await sock.sendMessage(senderPhone, { text: 'أهلاً بك مجدداً، لقد تلقينا رسالتك وجارٍ متابعة طلبك في الورشة.' });
                }
            });
        });
    } catch (e) {
        console.log('خطأ في تشغيل البوت:', e);
    }
}

startBot();const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');

const db = new sqlite3.Database('./workshop.db', (err) => {
    if (err) console.error('خطأ في قاعدة البيانات:', err.message);
});

// إنشاء الجدول مع إضافة حقل للخطوة (step) لتتبع المحادثة
db.run(`CREATE TABLE IF NOT EXISTS bookings (
    phone TEXT PRIMARY KEY,
    name TEXT,
    status TEXT DEFAULT 'جديد',
    step TEXT DEFAULT 'new',
    date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

let globalSock = null;

app.get('/dashboard', (req, res) => {
    const selectedTab = req.query.tab || 'الكل';

    db.all(`SELECT * FROM bookings ORDER BY date DESC`, [], (err, rows) => {
        if (err) return res.status(500).send('خطأ في جلب البيانات');

        const totalCount = rows.length;
        const newCount = rows.filter(r => r.status === 'جديد').length;
        const designCount = rows.filter(r => r.status === 'جاري تصميم').length;
        const readyCount = rows.filter(r => r.status === 'جاهز').length;
        const deliveredCount = rows.filter(r => r.status === 'تم التسليم').length;
        const noReplyCount = rows.filter(r => r.status === 'لم يرد').length;

        const statuses = ['جديد', 'جاري تصميم', 'جاهز', 'تم التسليم', 'لم يرد'];

        let displayedRows = rows;
        if (selectedTab !== 'الكل') {
            displayedRows = rows.filter(r => r.status === selectedTab);
        }

        let html = `
        <html lang="ar" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <title>لوحة متابعة الأوردات - إدارة الورشة</title>
            <style>
                body { font-family: Tahoma, sans-serif; background: #f0f2f5; margin: 0; padding: 20px; direction: rtl; display: flex; gap: 20px; color: #333; }
                .main-content { flex: 1; display: flex; flex-direction: column; gap: 20px; max-width: calc(100% - 280px); }
                
                .stats-container { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 15px; }
                .stat-card { background: white; padding: 15px; border-radius: 10px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border-top: 4px solid #007bff; cursor: pointer; text-decoration: none; color: inherit; transition: transform 0.2s; display: block; }
                .stat-card:hover { transform: translateY(-3px); }
                .stat-card.active-tab { background: #e7f1ff; box-shadow: 0 0 0 2px #007bff; }
                .stat-card.all { border-top-color: #007bff; }
                .stat-card.new { border-top-color: #17a2b8; }
                .stat-card.design { border-top-color: #ffc107; }
                .stat-card.ready { border-top-color: #28a745; }
                .stat-card.delivered { border-top-color: #6f42c1; }
                .stat-card.noreply { border-top-color: #dc3545; }
                .stat-card h4 { margin: 0 0 5px 0; font-size: 13px; color: #666; }
                .stat-card span { font-size: 20px; font-weight: bold; color: #333; }

                .manual-box { background: #fff; padding: 15px 20px; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); display: flex; gap: 12px; align-items: center; flex-wrap: wrap; border-right: 5px solid #28a745; }
                .manual-box input, .manual-box select { padding: 9px 12px; border: 1px solid #ced4da; border-radius: 6px; font-family: Tahoma; font-size: 13px; flex: 1; min-width: 150px; }
                .manual-box button { background: #28a745; color: white; border: none; padding: 9px 20px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 13px; }
                .manual-box button:hover { background: #218838; }

                .table-card { background: white; padding: 20px; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow-x: auto; }
                table { width: 100%; border-collapse: collapse; margin-top: 10px; text-align: right; }
                th { background: #f8f9fa; color: #495057; padding: 12px; font-size: 13px; border-bottom: 2px solid #dee2e6; }
                td { padding: 12px; border-bottom: 1px solid #dee2e6; font-size: 13px; vertical-align: middle; }
                tr:hover { background: #f8f9fa; }
                
                .badge { padding: 5px 10px; border-radius: 6px; font-size: 12px; font-weight: bold; display: inline-block; text-align: center; }
                .badge-جديد { background: #e0f7fa; color: #006064; }
                .badge-جاري_تصميم { background: #fff8e1; color: #ff8f00; }
                .badge-جاهز { background: #e8f5e9; color: #2e7d32; }
                .badge-تم_التسليم { background: #ede7f6; color: #4527a0; }
                .badge-لم_يرد { background: #ffebee; color: #c62828; }

                .whatsapp-link { color: #25d366; text-decoration: none; font-weight: bold; display: inline-flex; align-items: center; gap: 4px; }
                .whatsapp-link:hover { text-decoration: underline; }
                .action-select { padding: 6px; border-radius: 6px; border: 1px solid #ced4da; background: #fff; font-family: Tahoma; font-size: 12px; cursor: pointer; }
                .delete-btn { background: #dc3545; color: white; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 12px; }
                .delete-btn:hover { background: #c82333; }

                .sidebar { width: 260px; background: white; padding: 20px; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); display: flex; flex-direction: column; gap: 10px; height: fit-content; }
                .sidebar h3 { text-align: center; color: #333; margin-bottom: 0; }
                .sidebar p { text-align: center; color: #888; font-size: 12px; margin-top: 2px; }
                .sidebar-btn { padding: 10px 15px; border-radius: 6px; border: none; background: #f8f9fa; color: #495057; text-align: right; font-weight: bold; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-size: 13px; }
                .sidebar-btn.active { background: #007bff; color: white; }
                .sidebar-btn.logout { background: #dc3545; color: white; text-align: center; justify-content: center; }
            </style>
        </head>
        <body>

            <div class="main-content">
                <div class="stats-container">
                    <a href="/dashboard?tab=الكل" class="stat-card all ${selectedTab === 'الكل' ? 'active-tab' : ''}">
                        <h4>إجمالي الحجوزات</h4><span>${totalCount}</span>
                    </a>
                    <a href="/dashboard?tab=جديد" class="stat-card new ${selectedTab === 'جديد' ? 'active-tab' : ''}">
                        <h4>الحجوزات الجديدة</h4><span>${newCount}</span>
                    </a>
                    <a href="/dashboard?tab=جاري تصميم" class="stat-card design ${selectedTab === 'جاري تصميم' ? 'active-tab' : ''}">
                        <h4>خلص التصميم</h4><span>${designCount}</span>
                    </a>
                    <a href="/dashboard?tab=جاهز" class="stat-card ready ${selectedTab === 'جاهز' ? 'active-tab' : ''}">
                        <h4>جاهزة</h4><span>${readyCount}</span>
                    </a>
                    <a href="/dashboard?tab=تم التسليم" class="stat-card delivered ${selectedTab === 'تم التسليم' ? 'active-tab' : ''}">
                        <h4>تم التسليم</h4><span>${deliveredCount}</span>
                    </a>
                    <a href="/dashboard?tab=لم يرد" class="stat-card noreply ${selectedTab === 'لم يرد' ? 'active-tab' : ''}">
                        <h4>لم يرد</h4><span>${noReplyCount}</span>
                    </a>
                </div>

                <form class="manual-box" action="/add-manual" method="POST">
                    <input type="text" name="name" placeholder="اسم العميل الجديد" required>
                    <input type="text" name="phone" placeholder="رقم التليفون (مثال: 010xxxxxxxx)" required>
                    <select name="status">
                        ${statuses.map(s => `<option value="${s}">${s}</option>`).join('')}
                    </select>
                    <button type="submit">➕ إضافة أوردر يدوي</button>
                </form>

                <div class="table-card">
                    <h3 style="margin-top:0; color:#333; font-size: 16px;">📦 الطلبات في قسم: <span style="color:#007bff;">${selectedTab}</span> (${displayedRows.length})</h3>
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

        if (displayedRows.length === 0) {
            html += `<tr><td colspan="5" style="text-align: center; color: #888; padding: 20px;">لا توجد أي أوردرات في هذا القسم حالياً</td></tr>`;
        } else {
            displayedRows.forEach(row => {
                let cleanPhone = row.phone.replace(/[^0-9]/g, '');
                let badgeClass = 'badge-' + row.status.replace(/\s+/g, '_');
                
                html += `<tr>
                            <td><span class="badge ${badgeClass}">${row.status}</span></td>
                            <td style="color: #6c757d; font-size: 12px;">${row.date}</td>
                            <td>
                                <div style="font-weight: bold; margin-bottom: 3px;">${row.name || 'بدون اسم'}</div>
                                <a href="https://wa.me/${cleanPhone}" target="_blank" class="whatsapp-link">💬 ${cleanPhone}</a>
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

            <div class="sidebar">
                <h3>لوحة الإدارة</h3>
                <p>tal5es v1</p>
                <hr style="border:0; border-top:1px solid #eee; margin:5px 0;">
                <button class="sidebar-btn">✏️ تعديل الاستمارة</button>
                <a href="/dashboard?tab=الكل" class="sidebar-btn active" style="text-decoration:none;">📊 الطلبات (${totalCount})</a>
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

app.post('/add-manual', (req, res) => {
    let { phone, name, status } = req.body;
    let formattedPhone = phone.includes('@') ? phone : phone + '@s.whatsapp.net';
    
    db.run(`INSERT OR REPLACE INTO bookings (phone, name, status, step) VALUES (?, ?, ?, 'done')`, [formattedPhone, name, status], (err) => {
        if (err) console.error('خطأ في الإضافة اليدوية:', err.message);
        res.redirect('/dashboard');
    });
});

app.post('/update-status', async (req, res) => {
    const { phone, status } = req.body;
    db.run(`UPDATE bookings SET status = ? WHERE phone = ?`, [status, phone], async (err) => {
        if (err) return res.status(500).send('خطأ في التحديث');

        if (globalSock) {
            try {
                let messageText = `مرحباً، تم تحديث حالة طلبك في الورشة لتصبح: *${status}*`;
                if (status === 'جاهز') {
                    messageText = `🎉 أوردرك أصبح *جاهزاً* الآن للاستلام من الورشة! في انتظار تشريفك.`;
                } else if (status === 'جاري تصميم') {
                    messageText = `🎨 جارٍ العمل على تصميم أوردرك الآن.`;
                } else if (status === 'تم التسليم') {
                    messageText = `✅ تم تسليم أوردرك بنجاح. شكراً لتعاملكم معنا!`;
                }
                await globalSock.sendMessage(phone, { text: messageText });
            } catch (e) {
                console.log('فشل إرسال الرسالة:', e);
            }
        }

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
    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
        const sock = makeWASocket({
            auth: state,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            browser: ["Ubuntu", "Chrome", "20.0.04"]
        });

        globalSock = sock;

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            if (qr) {
                const qrLink = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=` + encodeURIComponent(qr);
                console.log('\n==============================');
                console.log('رابط الـ QR Code الجديد:');
                console.log(qrLink);
                console.log('==============================\n');
            }
            if (connection === 'open') {
                console.log('✅ تم اتصال البوت بنجاح!');
            } else if (connection === 'close') {
                const shouldReconnect = (new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut);
                if (shouldReconnect) setTimeout(startBot, 5000);
            }
        });

        sock.ev.on('creds.update', saveCreds);

        // نظام الرد التفاعلي وطلب الاسم من العميل
        sock.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const senderPhone = msg.key.remoteJid;
            const messageText = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();

            if (!messageText) return;

            db.get(`SELECT * FROM bookings WHERE phone = ?`, [senderPhone], async (err, row) => {
                if (!row) {
                    // عميل جديد تماماً -> نسجله في خطوة "انتظار الاسم" ونطلب منه اسمه
                    db.run(`INSERT INTO bookings (phone, name, status, step) VALUES (?, 'بدون اسم', 'جديد', 'waiting_name')`, [senderPhone]);
                    await sock.sendMessage(senderPhone, { text: 'أهلاً بك في ورشة الليزر! 🌟\nمن فضلك اكتب **اسمك** عشان نسجل طلبك بشكل صحيح:' });
                } else if (row.step === 'waiting_name') {
                    // العميل رد بالاسم -> نحفظ الاسم ونحول خطوته إلى "منتهي" (done)
                    db.run(`UPDATE bookings SET name = ?, step = 'done' WHERE phone = ?`, [messageText, senderPhone]);
                    await sock.sendMessage(senderPhone, { text: `تشرفنا يا ${messageText}! 🤝\nتم تسجيل طلبك بنجاح وهنتواصل معاك في أقرب وقت.` });
                } else {
                    // العميل مسجل واسمه معروف من قبل
                    await sock.sendMessage(senderPhone, { text: 'أهلاً بك مجدداً، لقد تلقينا رسالتك وجارٍ متابعة طلبك في الورشة.' });
                }
            });
        });
    } catch (e) {
        console.log('خطأ في تشغيل البوت:', e);
    }
}

startBot();
