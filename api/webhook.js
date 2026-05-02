const axios = require('axios');
const Redis = require('ioredis');

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || "EAAR90m9nfb4BRVbicflguLQadazJxXTfgrxyhnIXcPqJzF8YIsxvJGoQlo3niCQMNrk2ZAEJlrderf17cRDuiIVZAhh5pK8ZCd6KXfipFz8U8ZAzzRoLXLZBQXIsS4GZB8TFSvuxPTZB8TcGNQdpdY34o2KYrmHZA56tavAMZCHKYuk3qFGAJAmzM8zNfNKrWe36HnzIlXCxNle8RXKpK3wsPEimp";
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "davinci_token_2024";
const FB_PAGE_ID = process.env.FB_PAGE_ID || "110508451733432";
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
    console.log(`Received comment: "${message}" from ${from.name} (ID: ${from.id}) on post ${post_id}`);
    
    if (from.id === FB_PAGE_ID) {
        console.log("Ignored comment from the page itself.");
        return;
    }

    try {
        console.log("Fetching products from Firebase...");
        const fbRes = await axios.get(`${FB_DB_URL}/store_master_v5/products.json`);
        const categories = fbRes.data || {};
        
        console.log("Fetching post info...");
        let postText = "";
        try {
            const postInfo = await makeRequest(`/${post_id}?fields=message&access_token=${PAGE_ACCESS_TOKEN}`);
            postText = postInfo.message || "";
        } catch (postErr) {
            console.error("Could not fetch post info, proceeding with comment text only.");
        }
        
        console.log("Searching for product match...");
        const product = findProduct(categories, message, postText);

        if (product) {
            console.log(`Product found: ${product.name} (SKU: ${product.sku})`);
            await likeComment(comment_id);
            const stockStatus = parseInt(product.stock) > 0 ? "متوفر ✅" : "نفد ❌";
            const sizesStr = product.sizes ? `\nالمقاسات: ${product.sizes}` : "";
            const msg = `مرحباً ${from.name}! 👋
المنتج: ${product.name}
الكود: ${product.sku}
السعر: ${product.price} د.ل${sizesStr}
حالة المخزون: ${stockStatus}

للحجز، أرسل "حجز" في الخاص وسجل طلبك!`;
            
            const storeLink = `https://da-vinci.ezone.ly/products/${product.sku || product.id || product.key}`;
            console.log("Sending public reply...");
            await replyToCommentPublicly(comment_id, `تواصلنا معاك فالخاص! 🌹\nرابط المنتج: ${storeLink}`);
            
            console.log("Sending private message...");
            await sendMessage(from.id, msg);

            if (redis) {
                await redis.set(`last_product:${from.id}`, JSON.stringify({
                    ...product,
                    price: `${product.price} د.ل`,
                    img: product.img || ""
                }), 'EX', 86400);
            }
            console.log("Comment handling completed successfully.");
        } else {
            console.log("No matching product found for this comment/post.");
        }
    } catch (e) { 
        console.error("Critical Comment Handling Error:", e.response ? e.response.data : e.message); 
    }
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
