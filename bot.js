const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
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
                h2 { text-align: center; color: #333; margin-bottom: 20px; }
                .board { display: flex; gap: 15px; overflow-x: auto; padding-bottom: 20px; }
                .column { background: #fff; border-radius: 8px; width: 280px; min-width: 280px; padding: 15px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); display: flex; flex-direction: column; max-height: 80vh; overflow-y: auto; }
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
            <div class="board">`;

        statuses.forEach(status => {
            const filteredRows = rows.filter(r => r.status === status);
            html += `<div class="column">
                        <h3>${status} (${filteredRows.length})</h3>`;
            
            filteredRows.forEach(row => {
                // استخراج الأرقام الحقيقية فقط بدون أي رموز أو حروف
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
        logger: pino({ level: 'silent' })
    });

    globalSock = sock;

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        
        if (qr) {
            const qrLink = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=` + encodeURIComponent(qr);
            console.log('\n==============================');
            console.log('اضغط على الرابط التالي لفتح الـ QR Code:');
            console.log(qrLink);
            console.log('==============================\n');
        }

        if (connection === 'open') {
            console.log('✅ تم اتصال البوت بالواتساب بنجاح!');
        } else if (connection === 'close') {
            console.log('⚠️ انقطع الاتصال، جاري إعادة المحاولة...');
            setTimeout(startBot, 3000);
        }
    });

    sock.ev.on('credes.update', saveCreds);

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

startBot();const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
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
                h2 { text-align: center; color: #333; margin-bottom: 20px; }
                .board { display: flex; gap: 15px; overflow-x: auto; padding-bottom: 20px; }
                .column { background: #fff; border-radius: 8px; width: 280px; min-width: 280px; padding: 15px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); display: flex; flex-direction: column; max-height: 80vh; overflow-y: auto; }
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
            <div class="board">`;

        statuses.forEach(status => {
            const filteredRows = rows.filter(r => r.status === status);
            html += `<div class="column">
                        <h3>${status} (${filteredRows.length})</h3>`;
            
            filteredRows.forEach(row => {
                // استخراج الأرقام الحقيقية فقط بدون أي رموز أو حروف
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
        logger: pino({ level: 'silent' })
    });

    globalSock = sock;

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        
        if (qr) {
            const qrLink = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=` + encodeURIComponent(qr);
            console.log('\n==============================');
            console.log('اضغط على الرابط التالي لفتح الـ QR Code:');
            console.log(qrLink);
            console.log('==============================\n');
        }

        if (connection === 'open') {
            console.log('✅ تم اتصال البوت بالواتساب بنجاح!');
        } else if (connection === 'close') {
            console.log('⚠️ انقطع الاتصال، جاري إعادة المحاولة...');
            setTimeout(startBot, 3000);
        }
    });

    sock.ev.on('credes.update', saveCreds);

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

startBot();const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
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
                h2 { text-align: center; color: #333; margin-bottom: 20px; }
                .board { display: flex; gap: 15px; overflow-x: auto; padding-bottom: 20px; }
                .column { background: #fff; border-radius: 8px; width: 280px; min-width: 280px; padding: 15px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); display: flex; flex-direction: column; max-height: 80vh; overflow-y: auto; }
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
        // تم إلغاء الوضع الصامت هنا عشان يظهر تفاصيل كل رسالة في السجلات
        logger: pino({ level: 'info' })
    });

    globalSock = sock;

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        
        if (qr) {
            const qrLink = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=` + encodeURIComponent(qr);
            console.log('\n==============================');
            console.log('اضغط على الرابط التالي لفتح الـ QR Code:');
            console.log(qrLink);
            console.log('==============================\n');
        }

        if (connection === 'open') {
            console.log('✅ تم اتصال البوت بالواتساب بنجاح!');
        } else if (connection === 'close') {
            console.log('⚠️ انقطع الاتصال، جاري إعادة المحاولة...');
            setTimeout(startBot, 3000);
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        console.log('📩 وصلت رسالة جديدة:', JSON.stringify(msg, null, 2));

        if (!msg.message || msg.key.fromMe) return;

        const senderPhone = msg.key.remoteJid;
        const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text;

        if (!messageText) return;

        db.get(`SELECT * FROM bookings WHERE phone = ?`, [senderPhone], async (err, row) => {
            if (!row) {
                db.run(`INSERT INTO bookings (phone, name, status) VALUES (?, ?, 'جديد')`, [senderPhone, messageText.trim()]);
                await sock.sendMessage(senderPhone, { text: 'أهلاً بك! تم تسجيل طلبك بنجاح وهنتواصل معاك قريباً.' });
                console.log(`✨ تم تسجيل أوردر جديد للرقم: ${senderPhone}`);
            } else {
                await sock.sendMessage(senderPhone, { text: 'أهلاً بك مجدداً، لقد تلقينا رسالتك بالفعل وسيتم متابعتها.' });
            }
        });
    });
}

startBot();const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
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
                h2 { text-align: center; color: #333; margin-bottom: 20px; }
                .board { display: flex; gap: 15px; overflow-x: auto; padding-bottom: 20px; }
                .column { background: #fff; border-radius: 8px; width: 280px; min-width: 280px; padding: 15px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); display: flex; flex-direction: column; max-height: 80vh; overflow-y: auto; }
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
            <div class="board">`;

        statuses.forEach(status => {
            const filteredRows = rows.filter(r => r.status === status);
            html += `<div class="column">
                        <h3>${status} (${filteredRows.length})</h3>`;
            
            filteredRows.forEach(row => {
                // استخراج الأرقام الحقيقية فقط بدون أي رموز أو حروف
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
        logger: pino({ level: 'silent' })
    });

    globalSock = sock;

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        
        if (qr) {
            const qrLink = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=` + encodeURIComponent(qr);
            console.log('\n==============================');
            console.log('اضغط على الرابط التالي لفتح الـ QR Code:');
            console.log(qrLink);
            console.log('==============================\n');
        }

        if (connection === 'open') {
            console.log('✅ تم اتصال البوت بالواتساب بنجاح!');
        } else if (connection === 'close') {
            console.log('⚠️ انقطع الاتصال، جاري إعادة المحاولة...');
            setTimeout(startBot, 3000);
        }
    });

    sock.ev.on('credes.update', saveCreds);

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
