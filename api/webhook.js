const https = require('https');
const Redis = require('ioredis');

// --- إعدادات البيئة ---
const PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const REDIS_URL = process.env.REDIS_URL;

let redis;
if (REDIS_URL) {
    redis = new Redis(REDIS_URL);
}

// دالة إرسال الطلبات لفيسبوك
function makeRequest(path, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        const postData = body ? JSON.stringify(body) : '';
        const options = {
            hostname: 'graph.facebook.com',
            port: 443,
            path: `/v25.0${path}`,
            method: method,
            headers: { 
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try { 
                    const parsed = JSON.parse(data);
                    if (parsed.error) console.error("FB API Error:", parsed.error);
                    resolve(parsed); 
                } catch (e) { resolve(data); }
            });
        });
        req.on('error', (error) => { 
            console.error("Request Error:", error);
            reject(error); 
        });
        if (body) req.write(postData);
        req.end();
    });
}

// إرسال رسالة خاصة لمعلق
async function sendPrivateReplyToComment(commentId, message) {
    const path = `/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
    const body = {
        messaging_type: 'RESPONSE',
        recipient: { comment_id: commentId },
        message: { text: message }
    };
    return await makeRequest(path, 'POST', body);
}

// الرد العام على التعليق
async function replyToCommentPublicly(commentId, message) {
    const path = `/${commentId}/comments?access_token=${PAGE_ACCESS_TOKEN}`;
    const body = { message: message };
    return await makeRequest(path, 'POST', body);
}

// عمل لايك للتعليق
async function likeComment(commentId) {
    const path = `/${commentId}/reactions?access_token=${PAGE_ACCESS_TOKEN}`;
    const body = { reaction_type: 'LIKE' }; // جربنا reaction_type، إذا فشل سنحاول إضافة type
    return await makeRequest(path, 'POST', body);
}

// إرسال رسالة عادية في الخاص (PSID)
async function sendMessage(psid, message) {
    const path = `/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
    const body = {
        messaging_type: 'RESPONSE',
        recipient: { id: psid },
        message: { text: message }
    };
    return await makeRequest(path, 'POST', body);
}

// معالجة التعليقات
async function handleComment(event) {
    const { post_id, comment_id, from, message } = event;
    if (from.id === process.env.FB_PAGE_ID) return; // تجاهل تعليقات الصفحة نفسها

    console.log(`💬 تعليق جديد من ${from.name}: ${message}`);

    // محاولة جلب معلومات المنتج المرتبط بالمنشور من قاعدة البيانات
    let productDetails = {
        price: "150 دينار", // افتراضي
        link: "https://da-vinci.ezone.ly",
        name: "منتج رائع من دافينشي"
    };

    if (redis) {
        const savedData = await redis.get(`post:${post_id}`);
        if (savedData) {
            productDetails = JSON.parse(savedData);
        }
    }

    // 1. عمل لايك والرد في العام (مع عزل الأخطاء لضمان عدم توقف الرسالة الخاصة)
    try {
        await likeComment(comment_id);
    } catch (e) { console.error("Like Error:", e); }

    try {
        await replyToCommentPublicly(comment_id, `أهلاً بك يا ${from.name} 🌹، تم إرسال التفاصيل كاملة في رسالة خاصة 📩.`);
    } catch (e) { console.error("Public Reply Error:", e); }

    // 2. إرسال السعر والتفاصيل في الخاص
    const privateMsg = `مرحباً بك في DaVinci Store! 🎨
المنتج الذي سألت عنه متوفر لدينا.
سعر المنتج: ${productDetails.price}
رابط المنتج: ${productDetails.link}

⚠️ تنبيه: هذه البضاعة بالحجز وليست متوفرة حالياً في المخزن.
للحجز المباشر عبر الرسائل دون الدخول للموقع، فقط أرسل كلمة "حجز".`;

    await sendPrivateReplyToComment(comment_id, privateMsg);
}

// دالة للتحقق من كلمات الحجز
function isBookingKeyword(text) {
    const normalized = text.replace(/[^\u0621-\u064A\s]/g, '').trim(); // إزالة الرموز
    const keywords = ["حجز", "الحجز", "نبي نحجز", "اريد الحجز", "سجلني", "طلب"];
    return keywords.some(k => normalized.includes(k)) || normalized === "حجز";
}

// معالجة الرسائل الخاصة (مسار الحجز الذكي)
async function handleMessage(event) {
    const senderId = event.sender.id;
    if (!event.message || !event.message.text) return;
    
    const messageText = event.message.text.trim();

    // --- اختبار فوري للتأكد من عمل الويب هوك ---
    console.log(`Attempting to send test message to ${senderId}`);
    const testResult = await sendMessage(senderId, "✅ استلمت رسالتك: " + messageText); 
    console.log("Test Message Result:", JSON.stringify(testResult));

    try {
        if (!redis) {
            console.error("Redis is not initialized");
            await sendMessage(senderId, "⚠️ النظام غير متصل بقاعدة البيانات حالياً. يرجى إبلاغ الإدارة.");
            return;
        }
        const stateKey = `user_state:${senderId}`;
        const orderKey = `order:${senderId}`;

        // التحقق من الكلمات المفتاحية بشكل مبسط جداً
        const isBooking = isBookingKeyword(messageText);
        
        if (isBooking) {
            // نرسل الرسالة أولاً لضمان سرعة الرد
            await sendMessage(senderId, "ممتاز! سنقوم بتسجيل حجزك خطوة بخطوة 📝.\nأولاً، أرسل (الاسم الثلاثي):");
            
            // ثم نحاول تحديث الحالة في قاعدة البيانات
            try {
                await redis.set(stateKey, "ASKING_NAME");
                await redis.del(orderKey);
            } catch (e) {
                console.error("Redis Set Error:", e);
            }
            return;
        }

        let currentState = await redis.get(stateKey);

        if (!currentState) {
            if (messageText.length < 20) {
                 await sendMessage(senderId, "مرحباً بك في DaVinci Store! 🎨\nلتسجيل حجز جديد، أرسل كلمة (حجز).");
            }
            return;
        }

        // آلة الحالات (State Machine)
        let currentOrder = await redis.get(orderKey);
        currentOrder = currentOrder ? JSON.parse(currentOrder) : {};

    switch (currentState) {
        case "ASKING_NAME":
            currentOrder.name = messageText;
            await redis.set(orderKey, JSON.stringify(currentOrder));
            await redis.set(stateKey, "ASKING_PHONE");
            await sendMessage(senderId, `أهلاً بك يا ${messageText} 🌹.\nثانياً، أرسل (رقم الهاتف):`);
            break;

        case "ASKING_PHONE":
            currentOrder.phone = messageText;
            await redis.set(orderKey, JSON.stringify(currentOrder));
            await redis.set(stateKey, "ASKING_DETAILS");
            await sendMessage(senderId, "تم تسجيل الرقم.\nثالثاً، أرسل (تفاصيل الطلب: كود المنتج، المقاس، واللون المفضل):");
            break;

        case "ASKING_DETAILS":
            currentOrder.details = messageText;
            await redis.set(orderKey, JSON.stringify(currentOrder));
            await redis.set(stateKey, "ASKING_LOCATION");
            await sendMessage(senderId, "رائع.\nأخيراً، أرسل (العنوان بالكامل: المدينة والمنطقة):");
            break;

        case "ASKING_LOCATION":
            currentOrder.location = messageText;
            currentOrder.date = new Date().toISOString();
            currentOrder.status = "جديد";
            
            // حفظ الطلب النهائي في قائمة الطلبات
            await redis.set(`final_order:${Date.now()}_${senderId}`, JSON.stringify(currentOrder));
            
            // إضافة الطلب إلى سجل الطلبات العام (اختياري لسهولة الجلب)
            await redis.lpush('all_orders', JSON.stringify(currentOrder));

            // إعادة ضبط الحالة
            await redis.del(stateKey);
            await redis.del(orderKey);

            await sendMessage(senderId, "🎉 تم تسجيل حجزك بنجاح! سيقوم فريقنا بالتواصل معك قريباً لتأكيد الطلب وترتيب التوصيل. شكراً لثقتك بمتجر DaVinci 🎨.");
            break;
        }
    } catch (error) {
        console.error("Error in handleMessage:", error);
        try {
            await sendMessage(senderId, "⚠️ حدث خطأ بسيط، يرجى المحاولة مرة أخرى أو كتابة كلمة 'حجز' للبدء من جديد.");
        } catch (e) {
            console.error("Failed to send error message:", e);
        }
    }
}

module.exports = async (req, res) => {
    if (req.method === 'GET') {
        let mode = req.query['hub.mode'];
        let token = req.query['hub.verify_token'];
        let challenge = req.query['hub.challenge'];
        
        if (mode && token) {
            if (mode === 'subscribe' && token === VERIFY_TOKEN) {
                console.log('WEBHOOK_VERIFIED');
                return res.status(200).send(challenge);
            } else {
                return res.status(403).send('Forbidden');
            }
        }
        return res.status(200).send("Hello, this is DaVinci webhook!");
    }

    if (req.method === 'POST') {
        console.log("Incoming Webhook Event:", JSON.stringify(req.body));
        let body = req.body;
        
        if (body.object === 'page') {
            for (const entry of body.entry) {
                // 1. التقاط التعليقات
                if (entry.changes) {
                    for (const change of entry.changes) {
                        if (change.field === 'feed' && change.value.item === 'comment' && change.value.verb === 'add') {
                            await handleComment(change.value);
                        }
                    }
                }
                
                // 2. التقاط الرسائل الخاصة
                if (entry.messaging) {
                    for (const webhook_event of entry.messaging) {
                        if (webhook_event.message && webhook_event.message.text && !webhook_event.message.is_echo) {
                            await handleMessage(webhook_event);
                        }
                    }
                }
            }
            return res.status(200).send('EVENT_RECEIVED');
        } else {
            return res.status(404).send('Not Found');
        }
    }

    return res.status(405).send("Method Not Allowed");
};
