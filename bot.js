const { default: makeWASocket, DisconnectReason, initAuthCreds } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');

const db = new sqlite3.Database('./workshop.db', (err) => {
    if (err) console.error('خطأ في قاعدة البيانات:', err.message);
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS bookings (
        phone TEXT PRIMARY KEY,
        name TEXT,
        status TEXT DEFAULT 'جديد',
        step TEXT DEFAULT 'new',
        date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`, () => {
        db.run(`ALTER TABLE bookings ADD COLUMN step TEXT DEFAULT 'new'`, (err) => {});
    });

    db.run(`CREATE TABLE IF NOT EXISTS auth_store (
        key TEXT PRIMARY KEY,
        value TEXT
    )`);
});

async function useSqliteAuthState() {
    const readData = async (key) => {
        return new Promise((resolve) => {
            db.get(`SELECT value FROM auth_store WHERE key = ?`, [key], (err, row) => {
                if (err || !row) return resolve(null);
                try {
                    resolve(JSON.parse(row.value, Buffer.JSON.reviver));
                } catch (e) {
                    resolve(null);
                }
            });
        });
    };

    const writeData = async (data, key) => {
        return new Promise((resolve) => {
            const serialized = JSON.stringify(data, Buffer.JSON.replacer);
            db.run(`INSERT OR REPLACE INTO auth_store (key, value) VALUES (?, ?)`, [key, serialized], () => {
                resolve();
            });
        });
    };

    const removeData = async (key) => {
        return new Promise((resolve) => {
            db.run(`DELETE FROM auth_store WHERE key = ?`, [key], () => resolve());
        });
    };

    const creds = (await readData('creds')) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    for (const id of ids) {
                        const value = await readData(`${type}-${id}`);
                        if (value) {
                            data[id] = value;
                        }
                    }
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category of Object.keys(data)) {
                        for (const id of Object.keys(data[category])) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            if (value) {
                                tasks.push(writeData(value, key));
                            } else {
                                tasks.push(removeData(key));
                            }
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: async () => {
            return writeData(state.creds, 'creds');
        }
    };
}

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

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

        let displayedRows = selectedTab === 'الكل' ? rows : rows.filter(r => r.status === selectedTab);

        let html = `
        <html lang="ar" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <title>لوحة متابعة الأوردات - الورشة</title>
            <style>
                body { font-family: Tahoma, sans-serif; background: #f0f2f5; margin: 0; padding: 20px; direction: rtl; display: flex; gap: 20px; color: #333; }
                .main-content { flex: 1; display: flex; flex-direction: column; gap: 20px; }
                .stats-container { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 15px; }
                .stat-card { background: white; padding: 15px; border-radius: 10px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border-top: 4px solid #007bff; text-decoration: none; color: inherit; display: block; }
                .stat-card.active-tab { background: #e7f1ff; box-shadow: 0 0 0 2px #007bff; }
                .stat-card h4 { margin: 0 0 5px 0; font-size: 14px; color: #555; }
                .stat-card span { font-size: 20px; font-weight: bold; color: #007bff; }
                .table-card { background: white; padding: 20px; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow-x: auto; }
                table { width: 100%; border-collapse: collapse; margin-top: 10px; text-align: right; }
                th { background: #f8f9fa; padding: 12px; border-bottom: 2px solid #dee2e6; font-size: 13px; }
                td { padding: 12px; border-bottom: 1px solid #dee2e6; font-size: 13px; }
                .badge { padding: 5px 10px; border-radius: 6px; font-size: 12px; font-weight: bold; display: inline-block; }
                .badge-جديد { background: #e0f7fa; color: #006064; }
                .badge-جاري تصميم { background: #fff3e0; color: #e65100; }
                .badge-جاهز { background: #e8f5e9; color: #2e7d32; }
                .badge-تم التسليم { background: #f3e5f5; color: #7b1fa2; }
                .badge-لم يرد { background: #ffebee; color: #c62828; }
                .whatsapp-link { color: #25d366; text-decoration: none; font-weight: bold; }
            </style>
        </head>
        <body>
            <div class="main-content">
                <div class="stats-container">
                    <a href="/dashboard?tab=الكل" class="stat-card ${selectedTab === 'الكل' ? 'active-tab' : ''}"><h4>الكل</h4><span>${totalCount}</span></a>
                    <a href="/dashboard?tab=جديد" class="stat-card ${selectedTab === 'جديد' ? 'active-tab' : ''}"><h4>جديد</h4><span>${newCount}</span></a>
                    <a href="/dashboard?tab=جاري تصميم" class="stat-card ${selectedTab === 'جاري تصميم' ? 'active-tab' : ''}"><h4>جاري تصميم</h4><span>${designCount}</span></a>
                    <a href="/dashboard?tab=جاهز" class="stat-card ${selectedTab === 'جاهز' ? 'active-tab' : ''}"><h4>جاهز</h4><span>${readyCount}</span></a>
                    <a href="/dashboard?tab=تم التسليم" class="stat-card ${selectedTab === 'تم التسليم' ? 'active-tab' : ''}"><h4>تم التسليم</h4><span>${deliveredCount}</span></a>
                    <a href="/dashboard?tab=لم يرد" class="stat-card ${selectedTab === 'لم يرد' ? 'active-tab' : ''}"><h4>لم يرد</h4><span>${noReplyCount}</span></a>
                </div>
                <div class="table-card">
                    <h3>الطلبات (${displayedRows.length})</h3>
                    <table>
                        <thead><tr><th>الحالة</th><th>التاريخ</th><th>الاسم ورقم الواتساب</th></tr></thead>
                        <tbody>`;
        
        if (displayedRows.length === 0) {
            html += `<tr><td colspan="3" style="text-align:center; color:#888;">لا توجد طلبات في هذا القسم حالياً</td></tr>`;
        } else {
            displayedRows.forEach(row => {
                let cleanPhone = row.phone.replace(/[^0-9]/g, '');
                html += `<tr>
                            <td><span class="badge badge-${row.status}">${row.status}</span></td>
                            <td>${row.date}</td>
                            <td><b>${row.name || 'بدون اسم'}</b><br><a href="https://wa.me/${cleanPhone}" target="_blank" class="whatsapp-link">${cleanPhone}</a></td>
                         </tr>`;
            });
        }

        html += `       </tbody>
                    </table>
                </div>
            </div>
        </body>
        </html>`;
        res.send(html);
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

async function startBot() {
    try {
        const { state, saveCreds } = await useSqliteAuthState();
        const sock = makeWASocket({
            auth: state,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            browser: ["Ubuntu", "Chrome", "20.0.04"]
        });

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            if (qr) {
                console.log('رابط QR Code الجديد: https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(qr));
            }
            if (connection === 'open') console.log('✅ تم اتصال البوت بنجاح!');
            if (connection === 'close') {
                if (new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut) {
                    setTimeout(startBot, 5000);
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const senderPhone = msg.key.remoteJid;
            const messageText = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
            if (!messageText) return;

            db.get(`SELECT * FROM bookings WHERE phone = ?`, [senderPhone], async (err, row) => {
                if (!row) {
                    db.run(`INSERT INTO bookings (phone, name, status, step) VALUES (?, 'بدون اسم', 'جديد', 'waiting_info')`, [senderPhone]);
                    await sock.sendMessage(senderPhone, { text: 'أهلاً بك في الورشة! 🌟\nمن فضلك اكتب **اسمك** و**رقم تليفونك** في رسالة واحدة عشان نسجل طلبك.' });
                } else if (row.step === 'waiting_info') {
                    db.run(`UPDATE bookings SET name = ?, step = 'done' WHERE phone = ?`, [messageText, senderPhone]);
                    await sock.sendMessage(senderPhone, { text: `شكراً يا ${messageText}! ✅ تم تسجيل طلبك بنجاح وهظهر في قسم الطلبات الجديدة.` });
                } else {
                    let lowerMsg = messageText.toLowerCase();
                    if (lowerMsg.includes('عنوان') || lowerMsg.includes('مكان') || lowerNavMsg => lowerMsg.includes('لوكيشن')) {
                        await sock.sendMessage(senderPhone, { text: '📍 عنوان الورشة: [اكتب عنوانك هنا بالتفصيل]' });
                    } else if (lowerMsg.includes('محفظة') || lowerMsg.includes('فودافون') || lowerMsg.includes('انستاباي') || lowerMsg.includes('instapay')) {
                        await sock.sendMessage(senderPhone, { text: '💳 الدفع عبر فودافون كاش أو إنستاباي على رقم: [رقمك]' });
                    } else if (lowerMsg.includes('بكام') || lowerMsg.includes('كام') || lowerMsg.includes('السعر') || lowerMsg.includes('تكلفة')) {
                        await sock.sendMessage(senderPhone, { text: 'الأسعار بتختلف حسب تفاصيل الشغل، وهخلي أستاذ محمود يتابع مع حضرتك بالسعر الدقيق في أقرب وقت.' });
                    } else if (lowerMsg.includes('استلم') || lowerMsg.includes('امت') || lowerMsg.includes('امتى') || lowerMsg.includes('وقت')) {
                        await sock.sendMessage(senderPhone, { text: 'المعتاد من 2 لـ 3 أيام حسب ضغط الشغل، وهنبعتلك أول ما يخلص.' });
                    } else {
                        await sock.sendMessage(senderPhone, { text: 'طلبك مسجل عندنا، ومتابعينه معاك يا فندم.' });
                    }
                }
            });
        });
    } catch (e) {
        console.log('خطأ في البوت:', e);
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

// إنشاء الجدول وتأكيد إضافة عمود step أوتوماتيك لو مش موجود
db.run(`CREATE TABLE IF NOT EXISTS bookings (
    phone TEXT PRIMARY KEY,
    name TEXT,
    status TEXT DEFAULT 'جديد',
    step TEXT DEFAULT 'new',
    date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`, () => {
    db.run(`ALTER TABLE bookings ADD COLUMN step TEXT DEFAULT 'new'`, (err) => {});
});

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

let globalSock = null;

// لوحة التحكم الكاملة والمظبوطة
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

        let displayedRows = selectedTab === 'الكل' ? rows : rows.filter(r => r.status === selectedTab);

        let html = `
        <html lang="ar" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <title>لوحة متابعة الأوردات - الورشة</title>
            <style>
                body { font-family: Tahoma, sans-serif; background: #f0f2f5; margin: 0; padding: 20px; direction: rtl; display: flex; gap: 20px; color: #333; }
                .main-content { flex: 1; display: flex; flex-direction: column; gap: 20px; }
                .stats-container { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 15px; }
                .stat-card { background: white; padding: 15px; border-radius: 10px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border-top: 4px solid #007bff; text-decoration: none; color: inherit; display: block; }
                .stat-card.active-tab { background: #e7f1ff; box-shadow: 0 0 0 2px #007bff; }
                .stat-card h4 { margin: 0 0 5px 0; font-size: 14px; color: #555; }
                .stat-card span { font-size: 20px; font-weight: bold; color: #007bff; }
                .table-card { background: white; padding: 20px; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow-x: auto; }
                table { width: 100%; border-collapse: collapse; margin-top: 10px; text-align: right; }
                th { background: #f8f9fa; padding: 12px; border-bottom: 2px solid #dee2e6; font-size: 13px; }
                td { padding: 12px; border-bottom: 1px solid #dee2e6; font-size: 13px; }
                .badge { padding: 5px 10px; border-radius: 6px; font-size: 12px; font-weight: bold; display: inline-block; }
                .badge-جديد { background: #e0f7fa; color: #006064; }
                .badge-جاري تصميم { background: #fff3e0; color: #e65100; }
                .badge-جاهز { background: #e8f5e9; color: #2e7d32; }
                .badge-تم التسليم { background: #f3e5f5; color: #7b1fa2; }
                .badge-لم يرد { background: #ffebee; color: #c62828; }
                .whatsapp-link { color: #25d366; text-decoration: none; font-weight: bold; }
            </style>
        </head>
        <body>
            <div class="main-content">
                <div class="stats-container">
                    <a href="/dashboard?tab=الكل" class="stat-card ${selectedTab === 'الكل' ? 'active-tab' : ''}"><h4>الكل</h4><span>${totalCount}</span></a>
                    <a href="/dashboard?tab=جديد" class="stat-card ${selectedTab === 'جديد' ? 'active-tab' : ''}"><h4>جديد</h4><span>${newCount}</span></a>
                    <a href="/dashboard?tab=جاري تصميم" class="stat-card ${selectedTab === 'جاري تصميم' ? 'active-tab' : ''}"><h4>جاري تصميم</h4><span>${designCount}</span></a>
                    <a href="/dashboard?tab=جاهز" class="stat-card ${selectedTab === 'جاهز' ? 'active-tab' : ''}"><h4>جاهز</h4><span>${readyCount}</span></a>
                    <a href="/dashboard?tab=تم التسليم" class="stat-card ${selectedTab === 'تم التسليم' ? 'active-tab' : ''}"><h4>تم التسليم</h4><span>${deliveredCount}</span></a>
                    <a href="/dashboard?tab=لم يرد" class="stat-card ${selectedTab === 'لم يرد' ? 'active-tab' : ''}"><h4>لم يرد</h4><span>${noReplyCount}</span></a>
                </div>
                <div class="table-card">
                    <h3>الطلبات (${displayedRows.length})</h3>
                    <table>
                        <thead><tr><th>الحالة</th><th>التاريخ</th><th>الاسم ورقم الواتساب</th></tr></thead>
                        <tbody>`;
        
        if (displayedRows.length === 0) {
            html += `<tr><td colspan="3" style="text-align:center; color:#888;">لا توجد طلبات في هذا القسم حالياً</td></tr>`;
        } else {
            displayedRows.forEach(row => {
                let cleanPhone = row.phone.replace(/[^0-9]/g, '');
                html += `<tr>
                            <td><span class="badge badge-${row.status}">${row.status}</span></td>
                            <td>${row.date}</td>
                            <td><b>${row.name || 'بدون اسم'}</b><br><a href="https://wa.me/${cleanPhone}" target="_blank" class="whatsapp-link">${cleanPhone}</a></td>
                         </tr>`;
            });
        }

        html += `       </tbody>
                    </table>
                </div>
            </div>
        </body>
        </html>`;
        res.send(html);
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// تشغيل بوت الواتساب
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
                console.log('رابط QR Code الجديد: https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(qr));
            }
            if (connection === 'open') console.log('✅ تم اتصال البوت بنجاح!');
            if (connection === 'close') {
                if (new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut) {
                    setTimeout(startBot, 5000);
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);

        // استقبال الرسائل والرد باختصار شديد
        sock.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const senderPhone = msg.key.remoteJid;
            const messageText = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
            if (!messageText) return;

            db.get(`SELECT * FROM bookings WHERE phone = ?`, [senderPhone], async (err, row) => {
                if (!row) {
                    // عميل جديد تماماً: نطلب منه الاسم والرقم
                    db.run(`INSERT INTO bookings (phone, name, status, step) VALUES (?, 'بدون اسم', 'جديد', 'waiting_info')`, [senderPhone]);
                    await sock.sendMessage(senderPhone, { text: 'أهلاً بك في الورشة! 🌟\nمن فضلك اكتب **اسمك** و**رقم تليفونك** في رسالة واحدة عشان نسجل طلبك.' });
                } else if (row.step === 'waiting_info') {
                    // حفظ النص المدخل كاسم للعميل وتسجيله في الداشبورد
                    db.run(`UPDATE bookings SET name = ?, step = 'done' WHERE phone = ?`, [messageText, senderPhone]);
                    await sock.sendMessage(senderPhone, { text: `شكراً يا ${messageText}! ✅ تم تسجيل طلبك بنجاح وهظهر في قسم الطلبات الجديدة.` });
                } else {
                    // الرد على الثوابت باختصار
                    let lowerMsg = messageText.toLowerCase();
                    if (lowerMsg.includes('عنوان') || lowerMsg.includes('مكان') || lowerMsg.includes('لوكيشن')) {
                        await sock.sendMessage(senderPhone, { text: '📍 عنوان الورشة: [اكتب عنوانك هنا بالتفصيل]' });
                    } else if (lowerMsg.includes('محفظة') || lowerMsg.includes('فودافون') || lowerMsg.includes('انستاباي') || lowerMsg.includes('instapay')) {
                        await sock.sendMessage(senderPhone, { text: '💳 الدفع عبر فودافون كاش أو إنستاباي على رقم: [رقمك]' });
                    } else if (lowerMsg.includes('بكام') || lowerMsg.includes('كام') || lowerMsg.includes('السعر') || lowerMsg.includes('تكلفة')) {
                        await sock.sendMessage(senderPhone, { text: 'الأسعار بتختلف حسب تفاصيل الشغل، وهخلي أستاذ محمود يتابع مع حضرتك بالسعر الدقيق في أقرب وقت.' });
                    } else if (lowerMsg.includes('استلم') || lowerMsg.includes('امت') || lowerMsg.includes('امتى') || lowerMsg.includes('وقت')) {
                        await sock.sendMessage(senderPhone, { text: 'المعتاد من 2 لـ 3 أيام حسب ضغط الشغل، وهنبعتلك أول ما يخلص.' });
                    } else {
                        await sock.sendMessage(senderPhone, { text: 'طلبك مسجل عندنا، ومتابعينه معاك يا فندم.' });
                    }
                }
            });
        });
    } catch (e) {
        console.log('خطأ في البوت:', e);
    }
}

startBot();
