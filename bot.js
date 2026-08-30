const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');

const db = new sqlite3.Database('./workshop.db', (err) => {
    if (err) console.error('خطأ في قاعدة البيانات', err.message);
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
        if (err) return res.status(500).send("خطأ في جلب البيانات");
        
        const statuses = ['جديد', 'خلص تصميم', 'جاهز', 'تم التسليم', 'لم يرد'];
        
        let html = `
        <html lang="ar" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <title>لوحة متابعة الأوردرات</title>
            <style>
                body { font-family: Tahoma, sans-serif; background: #f4f7f6; padding: 20px; direction: rtl; }
                h2 { text-align: center; color: #333; margin-bottom: 20px; }
                .board { display: flex; gap: 15px; overflow-x: auto; padding-bottom: 20px; }
                .column { background: #e9ecef; border-radius: 8px; width: 280px; min-width: 280px; padding: 15px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); display: flex; flex-direction: column; max-height: 80vh; overflow-y: auto; }
                .column h3 { text-align: center; background: #007bff; color: white; padding: 10px; border-radius: 6px; margin-top: 0; font-size: 16px; }
                .card { background: white; padding: 12px; border-radius: 6px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); font-size: 14px; }
                .card b { color: #333; }
                .card select { width: 100%; padding: 6px; margin: 8px 0; border-radius: 4px; font-family: Tahoma; border: 1px solid #ccc; cursor: pointer; background: #f8f9fa; }
                .card button { padding: 5px 10px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer; width: 100%; }
                .card button:hover { opacity: 0.9; }
            </style>
            <script>
                async function updateStatus(phone, selectElement) {
                    const newStatus = selectElement.value;
                    const response = await fetch('/update-status', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ phone, status: newStatus })
                    });
                    if (response.ok) {
                        location.reload();
                    } else {
                        alert('حدث خطأ أثناء التحديث');
                    }
                }
            </script>
        </head>
        <body>
            <h2>إدارة ومتابعة مراحل الأوردرات (نظام الأعمدة التلقائي)</h2>
            <div class="board">`;

        statuses.forEach(status => {
            const filteredRows = rows.filter(r => r.status === status);
            html += `
            <div class="column">
                <h3>${status} (${filteredRows.length})</h3>`;
            
            if (filteredRows.length === 0) {
                html += `<p style="text-align: center; color: #777; font-size: 13px;">لا توجد أوردرات</p>`;
            } else {
                filteredRows.forEach(row => {
                    html += `
                    <div class="card">
                        <div><b>الاسم:</b> ${row.name}</div>
                        <div style="font-size: 11px; color: #555; word-break: break-all;"><b>الهاتف:</b> ${row.phone}</div>
                        <div style="font-size: 11px; color: #666; margin-top: 4px;">التسجيل: ${row.date}</div>
                        
                        <select onchange="updateStatus('${row.phone}', this)">
                            <option value="جديد" ${row.status === 'جديد' ? 'selected' : ''}>جديد</option>
                            <option value="خلص تصميم" ${row.status === 'خلص تصميم' ? 'selected' : ''}>خلص تصميم</option>
                            <option value="جاهز" ${row.status === 'جاهز' ? 'selected' : ''}>جاهز</option>
                            <option value="تم التسليم" ${row.status === 'تم التسليم' ? 'selected' : ''}>تم التسليم</option>
                            <option value="لم يرد" ${row.status === 'لم يرد' ? 'selected' : ''}>لم يرد</option>
                        </select>

                        <form action="/delete-client" method="POST" style="margin-top: 6px;" onsubmit="return confirm('هل أنت متأكد من الحذف؟');">
                            <input type="hidden" name="phone" value="${row.phone}">
                            <button type="submit" class="delete-btn">حذف</button>
                        </form>
                    </div>`;
                });
            }
            html += `</div>`;
        });

        html += `</div></body></html>`;
        res.send(html);
    });
});

app.post('/update-status', async (req, res) => {
    const { phone, status } = req.body;

    db.run(`UPDATE bookings SET status = ? WHERE phone = ?`, [status, phone], async () => {
        if (status === 'جاهز' && globalSock) {
            try {
                const clientJid = phone.includes('@') ? phone : (phone.startsWith('2') ? phone + '@s.whatsapp.net' : '2' + phone + '@s.whatsapp.net');

                db.get(`SELECT name FROM bookings WHERE phone = ?`, [phone], async (err, row) => {
                    const clientName = row ? row.name : 'عميلنا العزيز';
                    const readyMessage = `أهلاً بك يا فندم (${clientName}) 🌟\n\nنحب نبلغك إن **أوردرك بقى جاهز تماماً** للإستلام! 🎉\n\nيسعدنا تشرفنا بالاستلام من المقر أو لو حابب نبعت لحضرتك مندوب لحد عندك، عرفنا برغبتك ونحن في الخدمة دائماً. 🤝`;
                    
                    await globalSock.sendMessage(clientJid, { text: readyMessage });
                });
            } catch (error) {
                console.error("خطأ أثناء إرسال رسالة التجهيز:", error);
            }
        }
        res.sendStatus(200);
    });
});

app.post('/delete-client', (req, res) => {
    const { phone } = req.body;
    db.run(`DELETE FROM bookings WHERE phone = ?`, [phone], () => {
        res.redirect('/dashboard');
    });
});

app.listen(3000, () => {
    console.log('لوحة التحكم تعمل على: http://localhost:3000/dashboard');
});

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const userSteps = {};
const pendingTimers = {}; 

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const sock = makeWASocket({ auth: state, printQRInTerminal: false, logger: pino({ level: 'silent' }) });
    
    globalSock = sock; 

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (update) => {
        if (update.qr) qrcode.generate(update.qr, { small: true });
        if (update.connection === 'open') console.log('البوت متصل بنجاح على الواتساب! 🚀');
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const senderJid = m.key.remoteJid;
        const identifier = senderJid; 
        const messageText = (m.message.conversation || m.message.extendedTextMessage?.text || '').trim();
        if (!messageText) return;

        db.get(`SELECT * FROM bookings WHERE phone = ?`, [identifier], async (err, client) => {
            
            // 1. لو العميل حالته "جديد" -> تجاهل رسالته تماماً
            if (client && client.status === 'جديد' && !userSteps[senderJid]) {
                return; 
            }

            // 2. لو العميل حالته قديمة (خلص تصميم، جاهز، إلخ) أو في خطوة تسجيل أوردر جديد بعد الـ 8 ساعات
            if ((client && client.status !== 'جديد') || userSteps[senderJid]) {
                
                // لو البوت فتح له خطوة استقبال الاسم (سواء يدوياً أو بعد الـ 8 ساعات)
                if (userSteps[senderJid]) {
                    if (userSteps[senderJid].step === 'WAITING_NAME') {
                        const clientName = messageText;
                        userSteps[senderJid] = { step: 'WAITING_PHONE', name: clientName };
                        
                        await delay(2000);
                        await sock.sendMessage(senderJid, { 
                            text: `أهلاً بك يا ${clientName} 🤝\nمن فضلك اكتب **رقم تليفونك الصحيح** لتأكيد الطلب الجديد:` 
                        });
                        return;
                    }

                    if (userSteps[senderJid].step === 'WAITING_PHONE') {
                        const clientName = userSteps[senderJid].name;
                        const clientPhone = messageText;

                        db.run(`INSERT OR REPLACE INTO bookings (phone, name, status, date) VALUES (?, ?, 'جديد', CURRENT_TIMESTAMP)`, 
                            [identifier, clientName], async (dbErr) => {
                                if (!dbErr) {
                                    delete userSteps[senderJid];
                                    if (pendingTimers[senderJid]) {
                                        clearTimeout(pendingTimers[senderJid]);
                                        delete pendingTimers[senderJid];
                                    }
                                    
                                    await delay(2000);
                                    await sock.sendMessage(senderJid, { 
                                        text: `✅ شكراً يا ${clientName}!\nتم تسجيل طلبك الجديد برقم (${clientPhone}) وهو الآن في حالة (جديد).` 
                                    });
                                    
                                    await sock.sendMessage('201225958543@s.whatsapp.net', { 
                                        text: `🔔 أوردر جديد!\n👤 الاسم: ${clientName}\n📞 الهاتف المكتوب: ${clientPhone}` 
                                    });
                                }
                            });
                        return;
                    }
                }

                // لو العميل بيسأل أسئلة عادية وهو في حالة قديمة -> نشغل مؤقت الـ 8 ساعات صمت
                if (pendingTimers[senderJid]) {
                    clearTimeout(pendingTimers[senderJid]); 
                }

                const EIGHT_HOURS = 8 * 60 * 60 * 1000; 

                pendingTimers[senderJid] = setTimeout(async () => {
                    try {
                        const autoReply = `أهلاً بحضرتك يا فندم 🌟\nعذراً على التأخير في الرد، نتشرف باستفسارك ونحب نوضح لك إننا بنراجع كل التفاصيل والأسعار ونكون مع حضرتك فوراً.\n\nلو حابب تسجل أوردر جديد، من فضلك اكتبلي **اسمك الكريم** دلوقتي:`;
                        
                        // بعد الـ 8 ساعات نفتح له خطوة تسجيل الأوردر الجديد أوتوماتيك
                        userSteps[senderJid] = { step: 'WAITING_NAME' };
                        
                        await sock.sendMessage(senderJid, { text: autoReply });
                        delete pendingTimers[senderJid];
                    } catch (e) {
                        console.error("خطأ في إرسال الرد المتأخر:", e);
                    }
                }, EIGHT_HOURS);

                return; 
            }

            // 3. الخطوات الاعتيادية للعميل الجديد تماماً
            if (userSteps[senderJid] && userSteps[senderJid].step === 'WAITING_PHONE') {
                const clientName = userSteps[senderJid].name;
                const clientPhone = messageText;

                db.run(`INSERT OR REPLACE INTO bookings (phone, name, status) VALUES (?, ?, 'جديد')`, 
                    [identifier, clientName], async (dbErr) => {
                        if (!dbErr) {
                            delete userSteps[senderJid];
                            
                            await delay(2000);
                            await sock.sendMessage(senderJid, { 
                                text: `✅ شكراً يا ${clientName}!\nتم تسجيل طلبك بنجاح وهو الآن في حالة (جديد).` 
                            });
                            
                            await sock.sendMessage('201225958543@s.whatsapp.net', { 
                                text: `🔔 أوردر جديد!\n👤 الاسم: ${clientName}\n📞 الهاتف المكتوب: ${clientPhone}` 
                            });
                        }
                    });
                return;
            }

            if (userSteps[senderJid] && userSteps[senderJid].step === 'WAITING_NAME') {
                const clientName = messageText;
                userSteps[senderJid] = { step: 'WAITING_PHONE', name: clientName };
                
                await delay(2000);
                await sock.sendMessage(senderJid, { 
                    text: `أهلاً بك يا ${clientName} 🤝\nمن فضلك اكتب **رقم تليفونك الصحيح** لتأكيد الطلب:` 
                });
                return;
            }

            userSteps[senderJid] = { step: 'WAITING_NAME' };
            await delay(2000);
            await sock.sendMessage(senderJid, { 
                text: 'أهلاً بك في الورشة! 🌟\nمن فضلك، اكتب **اسمك الكريم**:' 
            });
        });
    });
}

connectToWhatsApp();