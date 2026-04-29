const axios = require('axios');
const Redis = require('ioredis');

// الإعدادات - تأكد من إضافة هذه المتغيرات في Vercel
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const FB_DB_URL = "https://davinci-a9db7-default-rtdb.firebaseio.com";
const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : null;

// دالة مساعدة لعمل طلبات لـ Facebook Graph API
async function makeRequest(path, method, body = null) {
    try {
        const url = `https://graph.facebook.com/v20.0${path}`;
        const response = await axios({
            method,
            url,
            data: body
        });
        return response.data;
    } catch (error) {
        console.error(`FB API Error (${path}):`, error.response ? error.response.data : error.message);
        throw error;
    }
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
    const body = { 
        reaction_type: 'LIKE',
        type: 'LIKE'
    };
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
    const senderId = from.id;
    if (senderId === process.env.FB_PAGE_ID) return;

    console.log(`💬 تعليق جديد من ${from.name}: ${message}`);

    let productDetails = {
        price: "سيتم تزويدك بالسعر لاحقاً",
        link: "https://da-vinci.ezone.ly",
        name: "منتج من دافينشي",
        stock: 0,
        cat: "",
        key: ""
    };

    try {
        const fbRes = await axios.get(`${FB_DB_URL}/store_master_v5/products.json`);
        const categories = fbRes.data || {};
        
        const postInfo = await makeRequest(`/${post_id}?fields=message,attachments&access_token=${PAGE_ACCESS_TOKEN}`);
        const postText = postInfo.message || "";
        
        let found = false;
        for (let catName in categories) {
            for (let prodKey in categories[catName]) {
                const p = categories[catName][prodKey];
                const skuToMatch = p.sku ? String(p.sku).toLowerCase() : "";
                // البحث في نص المنشور أو نص التعليق عن الكود
                if (skuToMatch && (postText.toLowerCase().includes(skuToMatch) || message.toLowerCase().includes(skuToMatch))) {
                    productDetails = {
                        ...p,
                        cat: catName,
                        key: prodKey,
                        price: `${p.price} د.ل`,
                        link: `https://da-vinci.ezone.ly/products/${p.sku}`
                    };
                    found = true;
                    break;
                }
            }
            if(found) break;
        }
    } catch (e) { console.error("Firebase Fetch Error:", e); }

    try {
        await likeComment(comment_id);
    } catch (e) { console.error("Like Error:", e); }

    const stockStatus = parseInt(productDetails.stock) > 0 ? "متوفر حالياً ✅" : "نفدت الكمية ❌";
    const publicReply = `أهلاً بك يا ${from.name}! 🌹 تفقد صندوق الرسائل الخاص بك، أرسلنا لك كافة التفاصيل والسعر.`;
    const privateMsg = `مرحباً بك! 👋
لقد استلمنا استفسارك بخصوص المنتج. تفضل كافة التفاصيل:
🔹 المنتج: ${productDetails.name}
🔹 السعر: ${productDetails.price}
🔹 حالة الحجز: ${stockStatus}

للحجز الفوري، أرسل كلمة "حجز" هنا في المسنجر وسأقوم بتسجيل طلبك فوراً! 📩`;

    if (redis) {
        const productToSave = {
            name: productDetails.name,
            price: productDetails.price,
            img: productDetails.img || (productDetails.media && productDetails.media[0] ? productDetails.media[0].url : ""),
            cat: productDetails.cat,
            key: productDetails.key,
            sku: productDetails.sku
        };
        await redis.set(`last_product:${senderId}`, JSON.stringify(productToSave), 'EX', 86400);
    }

    try {
        await replyToCommentPublicly(comment_id, publicReply);
        await sendPrivateReplyToComment(comment_id, privateMsg);
    } catch (e) { console.error("Reply Error:", e); }
}

// دالة للتحقق من كلمات الحجز
function isBookingKeyword(text) {
    const normalized = text.replace(/[^\u0621-\u064A\s]/g, '').trim();
    const keywords = ["حجز", "الحجز", "نبي نحجز", "اريد الحجز", "سجلني", "طلب"];
    return keywords.some(k => normalized.includes(k)) || normalized === "حجز";
}

// معالجة الرسائل الخاصة
async function handleMessage(event) {
    const senderId = event.sender.id;
    if (!event.message || !event.message.text) return;
    
    const messageText = event.message.text.trim();

    try {
        if (!redis) {
            console.error("Redis is not initialized");
            await sendMessage(senderId, "⚠️ النظام غير متصل بقاعدة البيانات حالياً. يرجى إبلاغ الإدارة.");
            return;
        }
        const stateKey = `user_state:${senderId}`;
        const orderKey = `order:${senderId}`;

        if (isBookingKeyword(messageText)) {
            await sendMessage(senderId, "ممتاز! سنقوم بتسجيل حجزك خطوة بخطوة 📝.\nأولاً، أرسل (الاسم الثلاثي):");
            await redis.set(stateKey, "ASKING_NAME");
            await redis.del(orderKey);
            return;
        }

        let currentState = await redis.get(stateKey);
        if (!currentState) return;

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
                const lastProdStr = await redis.get(`last_product:${senderId}`);
                let lastProd = lastProdStr ? JSON.parse(lastProdStr) : {};

                // --- تحديث المخزن في Firebase ---
                if (lastProd.cat && lastProd.key) {
                    try {
                        const stockRes = await axios.get(`${FB_DB_URL}/store_master_v5/products/${lastProd.cat}/${lastProd.key}/stock.json`);
                        const currentStock = parseInt(stockRes.data) || 0;
                        if (currentStock > 0) {
                            await axios.put(`${FB_DB_URL}/store_master_v5/products/${lastProd.cat}/${lastProd.key}/stock.json`, currentStock - 1);
                            console.log(`✅ تم إنقاص المخزون للمنتج ${lastProd.name}. الكمية الجديدة: ${currentStock - 1}`);
                        }
                    } catch (e) { console.error("Firebase Stock Update Error:", e); }
                }

                await redis.del(stateKey);
                await redis.del(orderKey);
                await redis.del(`last_product:${senderId}`);
                await sendMessage(senderId, "✅ تم استلام طلبك بنجاح! شكراً لثقتك بـ DaVinci Store. سيتم التواصل معك قريباً لتأكيد التوصيل. 😊");
                break;
        }
    } catch (error) {
        console.error("Error in handleMessage:", error);
    }
}

module.exports = async (req, res) => {
    if (req.method === 'GET') {
        let mode = req.query['hub.mode'];
        let token = req.query['hub.verify_token'];
        let challenge = req.query['hub.challenge'];
        if (mode && token === VERIFY_TOKEN) return res.status(200).send(challenge);
        return res.status(200).send("Hello, this is DaVinci webhook!");
    }

    if (req.method === 'POST') {
        let body = req.body;
        if (body.object === 'page') {
            for (const entry of body.entry) {
                if (entry.changes) {
                    for (const change of entry.changes) {
                        if (change.field === 'feed' && change.value.item === 'comment' && change.value.verb === 'add') {
                            await handleComment(change.value);
                        }
                    }
                }
                if (entry.messaging) {
                    for (const webhook_event of entry.messaging) {
                        if (webhook_event.message && webhook_event.message.text && !webhook_event.message.is_echo) {
                            await handleMessage(webhook_event);
                        }
                    }
                }
            }
            return res.status(200).send('EVENT_RECEIVED');
        }
        return res.status(404).send('Not Found');
    }
    return res.status(405).send("Method Not Allowed");
};
