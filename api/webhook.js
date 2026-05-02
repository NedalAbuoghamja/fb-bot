const axios = require('axios');
const Redis = require('ioredis');

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const FB_DB_URL = "https://davinci-a9db7-default-rtdb.firebaseio.com";
const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : null;

async function makeRequest(path, method, body = null) {
    try {
        const url = `https://graph.facebook.com/v20.0${path}`;
        const response = await axios({ method, url, data: body });
        return response.data;
    } catch (error) {
        console.error(`FB API Error (${path}):`, error.response ? error.response.data : error.message);
        throw error;
    }
}

async function replyToCommentPublicly(commentId, message) {
    return await makeRequest(`/${commentId}/comments?access_token=${PAGE_ACCESS_TOKEN}`, 'POST', { message });
}

async function likeComment(commentId) {
    return await makeRequest(`/${commentId}/reactions?access_token=${PAGE_ACCESS_TOKEN}`, 'POST', { reaction_type: 'LIKE', type: 'LIKE' });
}

async function sendMessage(psid, message) {
    return await makeRequest(`/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, 'POST', {
        messaging_type: 'RESPONSE',
        recipient: { id: psid },
        message: { text: message }
    });
}

// دالة البحث عن المنتج المحسنّة
function findProduct(categories, searchText, postText = "") {
    const searchLower = searchText.toLowerCase();
    const postLower = postText.toLowerCase();
    const fullText = searchLower + " " + postLower;
    
    let bestMatch = null;

    // دالة للبحث عن الكلمة ككلمة كاملة (Whole Word Match)
    // تمنع تداخل الأرقام مثل البحث عن "3" فيجد "35"
    const isWholeWordMatch = (target, text) => {
        if (!target) return false;
        // نستخدم regex للتأكد أن الرقم أو الكلمة محاطة بمسافات أو علامات ترقيم
        const escapedTarget = target.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const regex = new RegExp(`(^|\\s|[\\.,!\\?]|\\-|#)${escapedTarget}($|\\s|[\\.,!\\?]|\\-|#)`, 'i');
        return regex.test(text);
    };

    for (let catName in categories) {
        for (let prodKey in categories[catName]) {
            const p = categories[catName][prodKey];
            const sku = p.sku ? String(p.sku).toLowerCase() : "";
            const name = p.name ? String(p.name).toLowerCase() : "";

            // 1. الأولوية الأولى: تطابق الـ SKU ككلمة كاملة
            if (sku && isWholeWordMatch(sku, fullText)) {
                return { ...p, cat: catName, key: prodKey };
            }

            // 2. الأولوية الثانية: تطابق الاسم ككلمة كاملة
            if (name && isWholeWordMatch(name, fullText)) {
                bestMatch = { ...p, cat: catName, key: prodKey };
            }
        }
    }
    return bestMatch;
}

async function handleComment(event) {
    const { post_id, comment_id, from, message } = event;
    if (from.id === process.env.FB_PAGE_ID) return;

    try {
        const fbRes = await axios.get(`${FB_DB_URL}/store_master_v5/products.json`);
        const categories = fbRes.data || {};
        
        const postInfo = await makeRequest(`/${post_id}?fields=message&access_token=${PAGE_ACCESS_TOKEN}`);
        const postText = postInfo.message || "";
        
        const product = findProduct(categories, message, postText);

        if (product) {
            await likeComment(comment_id);
            const stockStatus = parseInt(product.stock) > 0 ? "متوفر ✅" : "نفد ❌";
            const msg = `مرحباً ${from.name}! 👋
المنتج: ${product.name}
الكود: ${product.sku}
السعر: ${product.price} د.ل
حالة المخزون: ${stockStatus}

للحجز، أرسل "حجز" في الخاص وسجل طلبك!`;
            
            const storeLink = `https://da-vinci.ezone.ly/products/${product.sku || product.id || product.key}`;
            await replyToCommentPublicly(comment_id, `تم الرد في الخاص! 🌹\nرابط المنتج: ${storeLink}`);
            await sendMessage(from.id, msg);

            if (redis) {
                await redis.set(`last_product:${from.id}`, JSON.stringify({
                    ...product,
                    price: `${product.price} د.ل`,
                    img: product.img || ""
                }), 'EX', 86400);
            }
        }
    } catch (e) { console.error("Comment Error:", e); }
}

async function handleMessage(event) {
    const senderId = event.sender.id;
    const messageText = event.message.text.trim();
    if (!redis) return;

    const stateKey = `user_state:${senderId}`;
    const orderKey = `order:${senderId}`;

    if (messageText.includes("حجز")) {
        await sendMessage(senderId, "نبدأ الحجز! 📝 أرسل اسمك الثلاثي:");
        await redis.set(stateKey, "ASKING_NAME");
        return;
    }

    let state = await redis.get(stateKey);
    if (!state) return;

    let order = JSON.parse(await redis.get(orderKey) || "{}");

    switch (state) {
        case "ASKING_NAME":
            order.name = messageText;
            await redis.set(orderKey, JSON.stringify(order));
            await redis.set(stateKey, "ASKING_PHONE");
            await sendMessage(senderId, "تمام، أرسل رقم هاتفك:");
            break;
        case "ASKING_PHONE":
            order.phone = messageText;
            await redis.set(orderKey, JSON.stringify(order));
            await redis.set(stateKey, "ASKING_LOCATION");
            await sendMessage(senderId, "وأخيراً، العنوان بالتفصيل:");
            break;
        case "ASKING_LOCATION":
            order.location = messageText;
            const lastProd = JSON.parse(await redis.get(`last_product:${senderId}`) || "{}");
            
            if (lastProd.cat && lastProd.key) {
                const stockRes = await axios.get(`${FB_DB_URL}/store_master_v5/products/${lastProd.cat}/${lastProd.key}/stock.json`);
                const currentStock = parseInt(stockRes.data) || 0;
                if (currentStock > 0) {
                    await axios.put(`${FB_DB_URL}/store_master_v5/products/${lastProd.cat}/${lastProd.key}/stock.json`, currentStock - 1);
                }
            }

            await redis.del(stateKey, orderKey, `last_product:${senderId}`);
            await sendMessage(senderId, "✅ تم تسجيل طلبك بنجاح! سنتصل بك قريباً.");
            break;
    }
}

module.exports = async (req, res) => {
    if (req.method === 'GET') {
        if (req.query['hub.verify_token'] === VERIFY_TOKEN) return res.status(200).send(req.query['hub.challenge']);
        return res.status(200).send("DaVinci Bot Active");
    }

    if (req.method === 'POST') {
        const body = req.body;
        if (body.object === 'page') {
            for (const entry of body.entry) {
                if (entry.changes) {
                    for (const ch of entry.changes) {
                        if (ch.field === 'feed' && ch.value.item === 'comment' && ch.value.verb === 'add') await handleComment(ch.value);
                    }
                }
                if (entry.messaging) {
                    for (const ev of entry.messaging) {
                        if (ev.message && !ev.message.is_echo) await handleMessage(ev);
                    }
                }
            }
            return res.status(200).send('OK');
        }
    }
    res.status(404).send();
};
