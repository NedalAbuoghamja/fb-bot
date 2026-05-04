const axios = require('axios');
const Redis = require('ioredis');

// Fallback Tokens & Config
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || "EAAR90m9nfb4BRVbicflguLQadazJxXTfgrxyhnIXcPqJzF8YIsxvJGoQlo3niCQMNrk2ZAEJlrderf17cRDuiIVZAhh5pK8ZCd6KXfipFz8U8ZAzzRoLXLZBQXIsS4GZB8TFSvuxPTZB8TcGNQdpdY34o2KYrmHZA56tavAMZCHKYuk3qFGAJAmzM8zNfNKrWe36HnzIlXCxNle8RXKpK3wsPEimp";
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "davinci_token_2024";
const FB_PAGE_ID = process.env.FB_PAGE_ID || "110508451733432";
const FB_DB_URL = "https://davinci-a9db7-default-rtdb.firebaseio.com";

// Redis with Error Handling
let redis = null;
if (process.env.REDIS_URL) {
    try {
        redis = new Redis(process.env.REDIS_URL);
        redis.on('error', (err) => console.error('Redis Error:', err.message));
    } catch (e) {
        console.error('Redis Init Failed:', e.message);
    }
}

async function makeRequest(path, method, body = null) {
    try {
        const url = `https://graph.facebook.com/v21.0${path}`;
        const response = await axios({ 
            method, 
            url, 
            data: body,
            timeout: 10000 // 10s timeout to prevent hanging
        });
        return response.data;
    } catch (error) {
        console.error(`FB API Error (${path}):`, error.response ? error.response.data : error.message);
        return null; // Return null instead of throwing to keep the loop running
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

function findProduct(categories, searchText, postText = "") {
    const searchLower = searchText.toLowerCase();
    const postLower = postText.toLowerCase();
    const fullText = searchLower + " " + postLower;
    
    let bestMatch = null;

    const isWholeWordMatch = (target, text) => {
        if (!target) return false;
        const escapedTarget = target.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const regex = new RegExp(`(^|\\s|[\\.,!\\?،]|\\-|#)${escapedTarget}($|\\s|[\\.,!\\?،]|\\-|#)`, 'i');
        return regex.test(text);
    };

    for (let catName in categories) {
        for (let prodKey in categories[catName]) {
            const p = categories[catName][prodKey];
            const sku = p.sku ? String(p.sku).toLowerCase() : "";
            const name = p.name ? String(p.name).toLowerCase() : "";

            if (sku && isWholeWordMatch(sku, fullText)) return { ...p, cat: catName, key: prodKey };
            if (name && fullText.includes(name)) bestMatch = { ...p, cat: catName, key: prodKey };
        }
    }
    return bestMatch;
}

async function handleComment(event) {
    const { post_id, comment_id, from, message } = event;
    if (!message || from.id === FB_PAGE_ID) return;

    try {
        const fbRes = await axios.get(`${FB_DB_URL}/store_master_v5/products.json`, { timeout: 5000 });
        const categories = fbRes.data || {};
        
        const postInfo = await makeRequest(`/${post_id}?fields=message&access_token=${PAGE_ACCESS_TOKEN}`, 'GET');
        const postText = postInfo ? (postInfo.message || "") : "";
        
        const product = findProduct(categories, message, postText);

        if (product) {
            await likeComment(comment_id);
            const stockStatus = parseInt(product.stock) > 0 ? "متوفر ✅" : "نفد ❌";
            const sizesStr = product.sizes ? `\n📏 المقاسات: ${product.sizes}` : "";
            const msg = `🌹 مرحباً ${from.name}
            
🏷️ المنتج: ${product.name}
🔢 الكود: ${product.sku}
💰 السعر: ${product.price} د.ل${sizesStr}
✅ حالة المخزون: ${stockStatus}

📝 للحجز، أرسل كلمة "حجز" هنا في الخاص وسجل طلبك!`;
            
            const productID = product.key || product.id || product.sku;
            const storeLink = `https://da-vinci.ezone.ly/products/${productID}`;
            console.log("Sending public reply...");
            await replyToCommentPublicly(comment_id, `ردينا عليك فالخاص! 🌹\nرابط المنتج: ${storeLink}`);
            console.log("Sending private reply...");
            await makeRequest(`/${comment_id}/private_replies?access_token=${PAGE_ACCESS_TOKEN}`, 'POST', { message: msg });

            if (redis) {
                try {
                    await redis.set(`last_product:${from.id}`, JSON.stringify({
                        ...product,
                        price: `${product.price} د.ل`,
                        img: product.img || ""
                    }), 'EX', 86400);
                } catch (re) { console.error("Redis Save Error:", re.message); }
            }
        }
    } catch (e) { console.error("Comment Error:", e.message); }
}

async function handleMessage(event) {
    const senderId = event.sender.id;
    const messageText = (event.message.text || "").trim();
    if (!messageText || !redis) return;

    try {
        const stateKey = `user_state:${senderId}`;
        const orderKey = `order:${senderId}`;

        if (messageText.toLowerCase().includes("حجز")) {
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
                await sendMessage(senderId, "العنوان بالتفصيل:");
                break;
            case "ASKING_LOCATION":
                order.location = messageText;
                await redis.set(orderKey, JSON.stringify(order));
                await redis.set(stateKey, "ASKING_LANDMARK");
                await sendMessage(senderId, "أقرب نقطة دالة:");
                break;
            case "ASKING_LANDMARK":
                order.landmark = messageText;
                await redis.set(orderKey, JSON.stringify(order));
                await redis.set(stateKey, "ASKING_NOTES");
                await sendMessage(senderId, "أي ملاحظات إضافية؟ (أو اكتب 'لا يوجد'):");
                break;
            case "ASKING_NOTES":
                order.notes = messageText;
                const lastProd = JSON.parse(await redis.get(`last_product:${senderId}`) || "{}");
                
                order.productName = lastProd.name || "غير محدد";
                order.productPrice = parseFloat(lastProd.price) || 0;
                order.productImg = lastProd.img || "";
                order.date = new Date().toISOString();
                order.status = "جديد";

                // Save final order
                await redis.set(`final_order:${Date.now()}_${senderId}`, JSON.stringify({
                    name: order.name,
                    phone: order.phone,
                    location: order.location,
                    landmark: order.landmark,
                    notes: order.notes,
                    details: `المنتج: ${order.productName} | السعر: ${order.productPrice}`,
                    price: order.productPrice,
                    img: order.productImg,
                    status: order.status,
                    date: order.date
                }));

                if (lastProd.cat && lastProd.key) {
                    try {
                        const stockRes = await axios.get(`${FB_DB_URL}/store_master_v5/products/${lastProd.cat}/${lastProd.key}/stock.json`);
                        const currentStock = parseInt(stockRes.data) || 0;
                        if (currentStock > 0) {
                            await axios.put(`${FB_DB_URL}/store_master_v5/products/${lastProd.cat}/${lastProd.key}/stock.json`, currentStock - 1);
                        }
                    } catch (stkErr) { console.error("Stock Update Error:", stkErr.message); }
                }

                await redis.del(stateKey, orderKey, `last_product:${senderId}`);
                await sendMessage(senderId, "✅ تم تسجيل طلبك بنجاح! سنتصل بك قريباً لتأكيد الطلب.");
                break;
        }
    } catch (e) { console.error("Message Error:", e.message); }
}

module.exports = async (req, res) => {
    try {
        if (req.method === 'GET') {
            if (req.query['hub.verify_token'] === VERIFY_TOKEN) return res.status(200).send(req.query['hub.challenge']);
            return res.status(200).send("DaVinci Bot Active - Ultra Stable Mode");
        }

        if (req.method === 'POST') {
            const body = req.body;
            if (body.object === 'page') {
                for (const entry of body.entry) {
                    if (entry.changes) {
                        for (const ch of entry.changes) {
                            if (ch.field === 'feed' && ch.value.item === 'comment' && ch.value.verb === 'add') {
                                await handleComment(ch.value);
                            }
                        }
                    }
                    if (entry.messaging) {
                        for (const ev of entry.messaging) {
                            if (ev.message && !ev.message.is_echo) {
                                await handleMessage(ev);
                            }
                        }
                    }
                }
                return res.status(200).send('OK');
            }
        }
        res.status(404).send();
    } catch (critical) {
        console.error("CRITICAL WEBHOOK ERROR:", critical.message);
        res.status(200).send('OK'); // Always return OK to FB to avoid subscription removal
    }
};
