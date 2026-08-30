const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');
const { GoogleGenAI } = require('@google/genai');

// إعداد الذكاء الاصطناعي المجاني (Gemini)
// حط مفتاح الـ API الخاص بيك هنا أو كمتغير بيئة
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || 'YOUR_GEMINI_API_KEY' });

const db = new sqlite3.Database('./workshop.db', (err) => {
    if (err) console.error('خطأ في قاعدة البيانات:', err.message);
});

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

// الداشبورد
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
                .table-card { background: white; padding: 20px; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow-x: auto; }
                table { width: 100%; border-collapse: collapse; margin-top: 10px; text-align: right; }
                th { background: #f8f9fa; padding: 12px; border-bottom: 2px solid #dee2e6; font-size: 13px; }
                td { padding: 12px; border-bottom: 1px solid #dee2e6; font-size: 13px; }
                .badge { padding: 5px 10px; border-radius: 6px; font-size: 12px; font-weight: bold; }
                .badge-جديد { background: #e0f7fa; color: #006064; }
                .whatsapp-link { color: #25d366; text-decoration: none; font-weight: bold; }
            </style>
        </head>
        <body>
            <div class="main-content">
                <div class="stats-container">
                    <a href="/dashboard?tab=الكل" class="stat-card ${selectedTab === 'الكل' ? 'active-tab' : ''}"><h4>الكل</h4><span>${totalCount}</span></a>
                    <a href="/dashboard?tab=جديد" class="stat-card ${selectedTab === 'جديد' ? 'active-tab' : ''}"><h4>جديد</h4><span>${newCount}</span></a>
                </div>
                <div class="table-card">
                    <h3>الطلبات (${displayedRows.length})</h3>
                    <table>
                        <thead><tr><th>الحالة</th><th>التاريخ</th><th>الاسم ورقم الواتساب</th></tr></thead>
                        <tbody>`;
        
        if (displayedRows.length === 0) {
            html += `<tr><td colspan="3" style="text-align:center; color:#888;">لا توجد طلبات حالياً</td></tr>`;
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

        // استقبال الرسائل وتوجيهها للذكاء الاصطناعي
        sock.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const senderPhone = msg.key.remoteJid;
            const messageText = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
            if (!messageText) return;

            db.get(`SELECT * FROM bookings WHERE phone = ?`, [senderPhone], async (err, row) => {
                if (!row) {
                    // عميل جديد تماماً: نطلب منه الاسم ورقم التليفون
                    db.run(`INSERT INTO bookings (phone, name, status, step) VALUES (?, 'بدون اسم', 'جديد', 'waiting_info')`, [senderPhone]);
                    await sock.sendMessage(senderPhone, { text: 'أهلاً بك في ورشة الليزر! 🌟\nمن فضلك اكتب **اسمك** و**رقم تليفونك** في رسالة واحدة عشان نسجل طلبك.' });
                } else if (row.step === 'waiting_info') {
                    // استخدام الذكاء الاصطناعي لاستخراج الاسم والرقم من كلام العميل
                    try {
                        const response = await ai.models.generateContent({
                            model: 'gemini-2.5-flash',
                            contents: `استخرج من النص التالي اسم العميل ورقم تليفونه بدقة، واكتبهم بصيغة JSON فقط كالتالي: {"name": "الاسم", "phone_number": "الرقم"}. النص: "${messageText}"`
                        });
                        
                        let textRes = response.text.replace(/```json/g, '').replace(/```/g, '').trim();
                        let parsed = JSON.parse(textRes);

                        let clientName = parsed.name || messageText;
                        let clientPhone = parsed.phone_number || senderPhone;

                        db.run(`UPDATE bookings SET name = ?, step = 'done' WHERE phone = ?`, [clientName, senderPhone]);
                        await sock.sendMessage(senderPhone, { text: `شكراً يا ${clientName}! ✅ تم تسجيل طلبك بنجاح في قسم الطلبات الجديدة بالورشة.` });
                    } catch (e) {
                        // لو حصل أي خطأ في الذكاء الاصطناعي، نحفظ النص كاسم احتياطي
                        db.run(`UPDATE bookings SET name = ?, step = 'done' WHERE phone = ?`, [messageText, senderPhone]);
                        await sock.sendMessage(senderPhone, { text: `تم تسجيل طلبك يا ${messageText}! سنتواصل معك قريباً.` });
                    }
                } else {
                    // الرد على الثوابت أو الاستفسارات العامة بالذكاء الاصطناعي
                    let lowerMsg = messageText.toLowerCase();
                    if (lowerMsg.includes('عنوان') || lowerMsg.includes('مكان') || lowerMsg.includes('لوكيشن')) {
                        await sock.sendMessage(senderPhone, { text: '📍 عنوان الورشة: [اكتب عنوانك هنا بالتفصيل]' });
                    } else if (lowerMsg.includes('محفظة') || lowerMsg.includes('فودافون') || lowerMsg.includes('انستاباي') || lowerMsg.includes('instapay')) {
                        await sock.sendMessage(senderPhone, { text: '💳 الدفع متاح من خلال:\n- فودافون كاش على رقم: [رقمك]\n- إنستاباي (InstaPay): [حسابك]' });
                    } else {
                        await sock.sendMessage(senderPhone, { text: 'أهلاً بك مجدداً! طلبك مسجل عندنا ومتابعين معاك، لو محتاج العنوان أو أرقام الدفع اسألني وهرد عليك فورا.' });
                    }
                }
            });
        });
    } catch (e) {
        console.log('خطأ في البوت:', e);
    }
}

startBot();
