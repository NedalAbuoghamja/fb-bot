const axios = require('axios');
const Redis = require('ioredis');
const ezoneClient = require('./ezone_client');

// Fallback Tokens & Config
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || "EAAR90m9nfb4BRVbicflguLQadazJxXTfgrxyhnIXcPqJzF8YIsxvJGoQlo3niCQMNrk2ZAEJlrderf17cRDuiIVZAhh5pK8ZCd6KXfipFz8U8ZAzzRoLXLZBQXIsS4GZB8TFSvuxPTZB8TcGNQdpdY34o2KYrmHZA56tavAMZCHKYuk3qFGAJAmzM8zNfNKrWe36HnzIlXCxNle8RXKpK3wsPEimp";
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "davinci_token_2024";
const FB_PAGE_ID = process.env.FB_PAGE_ID || "110508451733432";
const FB_DB_URL = "https://davinci-a9db7-default-rtdb.firebaseio.com";

const WELCOME_MESSAGE = `أهلاً بك في DaVinci Store! 🌸
يسعدنا تواصلك معنا. أنا المساعد التلقائي للمتجر، ويمكنني مساعدتك في:

1️⃣ لمعرفة تفاصيل أي منتج أو حجه تلقائياً:
👈 يرجى كتابة كود المنتج (مثلاً: 51 أو 18) أو إرسال رابط منشور المنتج.

2️⃣ للحجز السريع لآخر منتج شاهدته:
👈 أرسل كلمة "حجز".

3️⃣ للاستفسارات الأخرى أو إرسال صورة:
👈 أرسل رسالتك وسيقوم أحد موظفينا بالرد عليك في أقرب وقت! 🌹`;

const API_KEY = "AIzaSyAcP3Ud60BC-RKD7bYVBx8bcro--L4mkLQ";
const EMAIL = "nedal@davinci.com";
const PASSWORD = "111111";

let cachedToken = null;
let tokenExpiresAt = 0;

async function getFirebaseAuthToken() {
    if (cachedToken && Date.now() < tokenExpiresAt) {
        return cachedToken;
    }
    try {
        console.log("Signing in to Firebase Auth...");
        const res = await axios.post(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
            email: EMAIL,
            password: PASSWORD,
            returnSecureToken: true
        });
        cachedToken = res.data.idToken;
        const expiresIn = parseInt(res.data.expiresIn) || 3600;
        tokenExpiresAt = Date.now() + (expiresIn * 1000) - 300000;
        return cachedToken;
    } catch (e) {
        console.error("Firebase Auth failed:", e.response ? e.response.data : e.message);
        throw e;
    }
}

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
        const errObj = error.response ? error.response.data : error.message;
        console.error(`FB API Error (${path}):`, errObj);
        if (redis) {
            const apiName = path.includes('private_replies') ? 'private_replies' : 'messages';
            await redis.set(`debug_error:${apiName}`, JSON.stringify(errObj));
        }
        return null; // Return null instead of throwing to keep the loop running
    }
}

async function replyToCommentPublicly(commentId, message) {
    return await makeRequest(`/${commentId}/comments?access_token=${PAGE_ACCESS_TOKEN}`, 'POST', { message });
}

async function likeComment(commentId) {
    return await makeRequest(`/${commentId}/reactions?access_token=${PAGE_ACCESS_TOKEN}`, 'POST', { reaction_type: 'LIKE', type: 'LIKE' });
}

async function sendMessage(psid, message, quickReplies = null) {
    const payload = {
        messaging_type: 'RESPONSE',
        recipient: { id: psid },
        message: { text: message }
    };
    if (quickReplies && quickReplies.length > 0) {
        payload.message.quick_replies = quickReplies.map(qr => ({
            content_type: 'text',
            title: qr.title.substring(0, 20),
            payload: qr.payload
        }));
    }
    return await makeRequest(`/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, 'POST', payload);
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

function findProductByFBPostLink(categories, text) {
    if (!text) return null;
    const matches = text.match(/\d{8,}/g);
    if (!matches) return null;
    for (const num of matches) {
        for (let catName in categories) {
            for (let prodKey in categories[catName]) {
                const p = categories[catName][prodKey];
                if (p.fb_post_id) {
                    const parts = p.fb_post_id.split('_');
                    const postPart = parts[1] || parts[0];
                    if (postPart === num) {
                        return { ...p, cat: catName, key: prodKey };
                    }
                }
            }
        }
    }
    return null;
}

async function handleComment(event) {
    const { post_id, comment_id, from, message } = event;
    if (!message || from.id === FB_PAGE_ID) return;

    try {
        const token = await getFirebaseAuthToken();
        const fbRes = await axios.get(`${FB_DB_URL}/store_master_v5/products.json?auth=${token}`, { timeout: 5000 });
        const categories = fbRes.data || {};
        
        const postInfo = await makeRequest(`/${post_id}?fields=message&access_token=${PAGE_ACCESS_TOKEN}`, 'GET');
        const postText = postInfo ? (postInfo.message || "") : "";
        
        const product = findProduct(categories, message, postText);

        if (product) {
            await likeComment(comment_id);
            
            let stockStatus = "نفد ❌";
            if (product.key) {
                try {
                    const ezoneToken = await ezoneClient.getScopedToken(redis);
                    const variants = await ezoneClient.getVariants(ezoneToken, product.key);
                    const totalStock = variants.reduce((sum, v) => sum + (v.quantity || 0), 0);
                    stockStatus = totalStock > 0 ? "متوفر ✅" : "نفد ❌";
                } catch (ezoneErr) {
                    console.error("[Webhook] Ezone stock check failed for comment:", ezoneErr.message);
                    stockStatus = parseInt(product.stock) > 0 ? "متوفر ✅" : "نفد ❌";
                }
            } else {
                stockStatus = parseInt(product.stock) > 0 ? "متوفر ✅" : "نفد ❌";
            }

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
            
            console.log("Sending private reply via Messages API...");
            let pReply = await makeRequest(`/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, 'POST', {
                recipient: { comment_id },
                message: { text: msg }
            });

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

async function sendSizeSelection(senderId, redis, lastProd, stateKey, isFirstTime = true, excludedVariantIds = []) {
    if (!lastProd || !lastProd.key) {
        await sendMessage(senderId, "⚠️ حدث خطأ في استعادة بيانات المنتج. الرجاء الحجز من جديد:");
        await redis.del(stateKey);
        return false;
    }
    
    try {
        const ezoneToken = await ezoneClient.getScopedToken(redis);
        const variants = await ezoneClient.getVariants(ezoneToken, lastProd.key);
        
        // Filter out of stock and already selected variants
        const availableVariants = variants.filter(v => v.quantity > 0 && !excludedVariantIds.includes(String(v.variantId)));
        
        if (availableVariants.length === 0) {
            if (isFirstTime) {
                await sendMessage(senderId, `❌ عذراً، هذا المنتج نفد من المخزون بالكامل ولا يمكن حجزه حالياً.`);
            }
            return false;
        }
        
        // Build quick reply buttons
        const quickReplies = availableVariants.map(v => ({
            title: v.text.trim(),
            payload: `SELECT_SIZE:${v.variantId}:${v.text.trim()}`
        }));
        
        const textMsg = isFirstTime 
            ? "الرجاء اختيار المقاس المطلوب 👇:" 
            : "الرجاء اختيار المقاس الإضافي المطلوب 👇:";
            
        await sendMessage(senderId, textMsg, quickReplies);
        await redis.set(stateKey, "SELECTING_SIZE");
        return true;
    } catch (err) {
        console.error("[Webhook] Failed to send size selection:", err.message);
        await sendMessage(senderId, "⚠️ حدث خطأ أثناء جلب المقاسات من النظام. الرجاء المحاولة مجدداً بكتابة 'حجز':");
        await redis.del(stateKey);
        return false;
    }
}

async function handleMessage(event) {
    const senderId = event.sender.id;
    const messageText = (event.message.text || "").trim();
    const quickReplyPayload = event.message.quick_reply ? event.message.quick_reply.payload : null;
    if (!redis) return;
    if (!messageText && !quickReplyPayload) return;

    try {
        const stateKey = `user_state:${senderId}`;
        const orderKey = `order:${senderId}`;

        if (messageText.toLowerCase().includes("حجز")) {
            const lastProd = JSON.parse(await redis.get(`last_product:${senderId}`) || "{}");
            if (!lastProd.key) {
                await redis.set(stateKey, "AWAITING_PRODUCT_INFO");
                await sendMessage(senderId, "حاضر، من عيوني! 🌸 لم نتمكن من تحديد المنتج المطلوب تلقائياً.\n\nيرجى إرسال أحد الخيارات التالية:\n1️⃣ كود المنتج (مثال: 51)\n2️⃣ رابط منشور المنتج على الفيسبوك\n3️⃣ صورة للمنتج (وسنتواصل معك يدوياً)");
                return;
            }

            try {
                console.log(`[Webhook] Checking Ezone stock for product ${lastProd.key}...`);
                const ezoneToken = await ezoneClient.getScopedToken(redis);
                const variants = await ezoneClient.getVariants(ezoneToken, lastProd.key);
                const totalStock = variants.reduce((sum, v) => sum + (v.quantity || 0), 0);

                if (totalStock <= 0) {
                    await sendMessage(senderId, `❌ عذراً، منتج "${lastProd.name}" نفدت كميته بالكامل من المخزون حالياً ولا يمكن حجزه.`);
                    return;
                }
            } catch (err) {
                console.error("[Webhook] Ezone stock check failed at booking initiation:", err.message);
                const fbStock = parseInt(lastProd.stock) || 0;
                if (fbStock <= 0) {
                    await sendMessage(senderId, `❌ عذراً، هذا المنتج غير متوفر حالياً.`);
                    return;
                }
            }

            await sendMessage(senderId, "نبدأ الحجز! 📝 أرسل اسمك الثلاثي:");
            await redis.set(stateKey, "ASKING_NAME");
            return;
        }

        let state = await redis.get(stateKey);
        if (!state) {
            // Check if user sent an image attachment
            if (event.message.attachments && event.message.attachments.some(att => att.type === 'image')) {
                await sendMessage(senderId, "تم استلام الصورة بنجاح! 📸\nسيتواصل معك أحد موظفي الخدمة لتأكيد المنتج وإتمام الحجز يدوياً في أقرب وقت. 🌸");
                return;
            }

            // Check if user sent a SKU or FB link
            let matchedProduct = null;
            if (messageText) {
                try {
                    const token = await getFirebaseAuthToken();
                    const fbRes = await axios.get(`${FB_DB_URL}/store_master_v5/products.json?auth=${token}`, { timeout: 5000 });
                    const categories = fbRes.data || {};
                    
                    matchedProduct = findProductByFBPostLink(categories, messageText);
                    if (!matchedProduct) {
                        const cleanMsg = messageText.trim().toLowerCase();
                        let isPossibleSku = false;
                        if (/^\d+$/.test(cleanMsg)) {
                            isPossibleSku = true;
                        } else if (cleanMsg.includes("كود") || cleanMsg.includes("code")) {
                            isPossibleSku = true;
                        }
                        
                        if (isPossibleSku) {
                            matchedProduct = findProduct(categories, messageText, "");
                        }
                    }
                } catch (e) {
                    console.error("No-state product search error:", e.message);
                }
            }

            if (matchedProduct) {
                let stockStatus = "نفد ❌";
                let totalStock = 0;
                try {
                    const ezoneToken = await ezoneClient.getScopedToken(redis);
                    const variants = await ezoneClient.getVariants(ezoneToken, matchedProduct.key);
                    totalStock = variants.reduce((sum, v) => sum + (v.quantity || 0), 0);
                    stockStatus = totalStock > 0 ? "متوفر ✅" : "نفد ❌";
                } catch (ezoneErr) {
                    stockStatus = parseInt(matchedProduct.stock) > 0 ? "متوفر ✅" : "نفد ❌";
                    totalStock = parseInt(matchedProduct.stock) || 0;
                }

                if (totalStock <= 0) {
                    await sendMessage(senderId, `❌ عذراً، منتج "${matchedProduct.name}" (كود: ${matchedProduct.sku}) نفدت كميته من المخزون حالياً.`);
                    return;
                }

                await redis.set(`last_product:${senderId}`, JSON.stringify({
                    ...matchedProduct,
                    price: `${matchedProduct.price} د.ل`,
                    img: matchedProduct.img || ""
                }), 'EX', 86400);

                const sizesStr = matchedProduct.sizes ? `\n📏 المقاسات: ${matchedProduct.sizes}` : "";
                const msg = `🌸 أهلاً بك! تم تحديد المنتج:
                
🏷️ المنتج: ${matchedProduct.name}
🔢 الكود: ${matchedProduct.sku}
💰 السعر: ${matchedProduct.price} د.ل${sizesStr}
✅ حالة المخزون: ${stockStatus}

للبدء في الحجز، أرسل كلمة "حجز" أو اضغط على الزر أدناه 👇`;

                await sendMessage(senderId, msg, [
                    { title: "حجز المنتج", payload: "START_BOOKING" }
                ]);
                await redis.set(stateKey, "START_OR_NOT");
                return;
            }
            // If no product is matched, check if it's a greeting
            if (messageText) {
                const normMsg = ezoneClient.normalizeArabic(messageText).trim();
                const greetings = ["سلام", "مرحبا", "اهلان", "اهلا", "صباح الخير", "مساء الخير", "يا هلا", "مرحبتين", "hello", "hi", "hey"];
                const isGreeting = greetings.some(g => {
                    const normG = ezoneClient.normalizeArabic(g).trim();
                    return normMsg === normG || normMsg.startsWith(normG + " ") || normMsg.endsWith(" " + normG) || normMsg.includes(" " + normG + " ");
                });

                if (isGreeting) {
                    await sendMessage(senderId, WELCOME_MESSAGE);
                    return;
                }
            }
            return;
        }

        let order = JSON.parse(await redis.get(orderKey) || "{}");
        const lastProd = JSON.parse(await redis.get(`last_product:${senderId}`) || "{}");

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
                order.items = []; // Initialize items array for the order
                await redis.set(orderKey, JSON.stringify(order));
                await sendSizeSelection(senderId, redis, lastProd, stateKey, true);
                break;
            case "SELECTING_SIZE":
                let variantId = null;
                let sizeText = "";

                if (quickReplyPayload && quickReplyPayload.startsWith("SELECT_SIZE:")) {
                    const parts = quickReplyPayload.split(":");
                    variantId = parts[1];
                    sizeText = parts[2];
                } else {
                    try {
                        const ezoneToken = await ezoneClient.getScopedToken(redis);
                        const variants = await ezoneClient.getVariants(ezoneToken, lastProd.key);
                        const excludedIds = (order.items || []).map(item => String(item.variantId));
                        const availableVariants = variants.filter(v => v.quantity > 0 && !excludedIds.includes(String(v.variantId)));
                        
                        const matched = ezoneClient.matchVariant(availableVariants, messageText, messageText);
                        if (matched && matched.quantity > 0) {
                            variantId = String(matched.variantId);
                            sizeText = matched.text.trim();
                        }
                    } catch (err) {
                        console.error("[Webhook] Text matching failed in SELECTING_SIZE:", err.message);
                    }
                }

                if (!variantId) {
                    await sendMessage(senderId, "⚠️ لم نتمكن من مطابقة المقاس المطلوب. الرجاء الاختيار من الأزرار التالية:");
                    const excludedIds = (order.items || []).map(item => String(item.variantId));
                    await sendSizeSelection(senderId, redis, lastProd, stateKey, (order.items || []).length === 0, excludedIds);
                    return;
                }

                order.current_variant_id = variantId;
                order.current_size_text = sizeText;
                await redis.set(orderKey, JSON.stringify(order));

                let maxQty = 5;
                try {
                    const ezoneToken = await ezoneClient.getScopedToken(redis);
                    const variants = await ezoneClient.getVariants(ezoneToken, lastProd.key);
                    const matchV = variants.find(v => String(v.variantId) === variantId);
                    if (matchV) {
                        maxQty = Math.min(5, matchV.quantity);
                    }
                } catch (e) {
                    console.error("[Webhook] Qty stock check failed, default to 5:", e.message);
                }

                await redis.set(stateKey, "SELECTING_QTY");
                const qtyReplies = [];
                for (let i = 1; i <= maxQty; i++) {
                    qtyReplies.push({
                        title: String(i),
                        payload: `SELECT_QTY:${i}`
                    });
                }
                await sendMessage(senderId, `الرجاء اختيار الكمية المطلوبة لمقاس (${sizeText}) 👇:`, qtyReplies);
                break;

            case "SELECTING_QTY":
                let selectedQty = null;
                if (quickReplyPayload && quickReplyPayload.startsWith("SELECT_QTY:")) {
                    selectedQty = parseInt(quickReplyPayload.split(":")[1], 10);
                } else {
                    selectedQty = parseInt(messageText, 10);
                }

                let availableStock = 5;
                const currentVarId = order.current_variant_id;
                try {
                    const ezoneToken = await ezoneClient.getScopedToken(redis);
                    const variants = await ezoneClient.getVariants(ezoneToken, lastProd.key);
                    const currentV = variants.find(v => String(v.variantId) === currentVarId);
                    if (currentV) {
                        availableStock = currentV.quantity;
                    }
                } catch (e) {
                    console.error("[Webhook] Stock check failed at SELECTING_QTY:", e.message);
                }

                if (isNaN(selectedQty) || selectedQty <= 0 || selectedQty > availableStock) {
                    await sendMessage(senderId, `⚠️ الرجاء اختيار كمية صحيحة (رقم بين 1 و ${Math.min(5, availableStock)}):`);
                    const qtyReplies = [];
                    for (let i = 1; i <= Math.min(5, availableStock); i++) {
                        qtyReplies.push({ title: String(i), payload: `SELECT_QTY:${i}` });
                    }
                    await sendMessage(senderId, `الرجاء اختيار الكمية المطلوبة لمقاس (${order.current_size_text}) 👇:`, qtyReplies);
                    return;
                }

                if (!order.items) order.items = [];
                order.items = order.items.filter(item => String(item.variantId) !== currentVarId);
                order.items.push({
                    variantId: currentVarId,
                    sizeText: order.current_size_text,
                    quantity: selectedQty
                });

                delete order.current_variant_id;
                delete order.current_size_text;
                await redis.set(orderKey, JSON.stringify(order));

                await redis.set(stateKey, "ASKING_ADD_MORE");
                const addMoreReplies = [
                    { title: "نعم، إضافة مقاس", payload: "ADD_MORE:YES" },
                    { title: "لا، أكمل الطلب", payload: "ADD_MORE:NO" }
                ];
                await sendMessage(senderId, "هل ترغب في إضافة مقاس آخر من نفس المنتج؟ 👇", addMoreReplies);
                break;

            case "ASKING_ADD_MORE":
                let addMore = null;
                if (quickReplyPayload && quickReplyPayload.startsWith("ADD_MORE:")) {
                    addMore = quickReplyPayload.split(":")[1];
                } else {
                    const norm = ezoneClient.normalizeArabic(messageText);
                    if (norm.includes("نعم") || norm.includes("اضافه") || norm.includes("اضافة")) {
                        addMore = "YES";
                    } else if (norm.includes("لا") || norm.includes("اكمل") || norm.includes("لا يوجد")) {
                        addMore = "NO";
                    }
                }

                if (addMore === "YES") {
                    const excludedIds = (order.items || []).map(item => String(item.variantId));
                    const sent = await sendSizeSelection(senderId, redis, lastProd, stateKey, false, excludedIds);
                    if (!sent) {
                        await sendMessage(senderId, "لا توجد مقاسات إضافية متوفرة حالياً.");
                        await redis.set(stateKey, "ASKING_NOTES");
                        await sendMessage(senderId, "أي ملاحظات إضافية على الطلب؟ (أو اكتب 'لا يوجد'):");
                    }
                } else if (addMore === "NO") {
                    await redis.set(stateKey, "ASKING_NOTES");
                    await sendMessage(senderId, "أي ملاحظات إضافية على الطلب؟ (أو اكتب 'لا يوجد'):");
                } else {
                    const addMoreReplies = [
                        { title: "نعم، إضافة مقاس", payload: "ADD_MORE:YES" },
                        { title: "لا، أكمل الطلب", payload: "ADD_MORE:NO" }
                    ];
                    await sendMessage(senderId, "الرجاء اختيار أحد الخيارات: هل ترغب في إضافة مقاس آخر؟ 👇", addMoreReplies);
                }
                break;

            case "ASKING_NOTES":
                order.notes = messageText;
                order.productName = lastProd.name || "غير محدد";
                order.productPrice = parseFloat(lastProd.price) || 0;
                order.productImg = lastProd.img || "";
                order.date = new Date().toISOString();
                order.status = "جديد";

                let ezoneOrderId = null;
                let variantText = "غير محدد";
                let totalQty = 0;

                if (order.items && order.items.length > 0) {
                    totalQty = order.items.reduce((sum, item) => sum + item.quantity, 0);
                    variantText = order.items.map(item => `${item.sizeText.trim()} (عدد: ${item.quantity})`).join(", ");
                } else {
                    totalQty = 1;
                }

                if (lastProd.key && order.items && order.items.length > 0) {
                    try {
                        console.log(`[Webhook] Automating order creation on Ezone for product ${lastProd.key}...`);
                        const ezoneToken = await ezoneClient.getScopedToken(redis);
                        
                        const ezoneCustomerId = await ezoneClient.findOrCreateCustomer(ezoneToken, order.name, order.phone, '');
                        const { cityId, subCityId } = await ezoneClient.resolveCityAndSubCity(ezoneToken, order.location, order.landmark);
                        const addressLine = `${order.location} (${order.landmark ? 'نقطة دالة: ' + order.landmark : ''})`.trim();
                        const ezoneAddressId = await ezoneClient.findOrCreateAddress(ezoneToken, ezoneCustomerId, addressLine, cityId, subCityId);
                        
                        const ezoneItems = order.items.map(item => ({
                            productId: lastProd.key,
                            variantId: item.variantId,
                            quantity: item.quantity
                        }));

                        ezoneOrderId = await ezoneClient.placeOrder(ezoneToken, ezoneCustomerId, ezoneAddressId, ezoneItems);
                    } catch (ezoneErr) {
                        console.error("[Webhook] Ezone order integration failed:", ezoneErr.message);
                    }
                }

                const totalPrice = order.productPrice * totalQty;
                
                await redis.set(`final_order:${Date.now()}_${senderId}`, JSON.stringify({
                    name: order.name,
                    phone: order.phone,
                    location: order.location,
                    landmark: order.landmark,
                    notes: order.notes,
                    details: `المنتج: ${order.productName} (${variantText}) | الكمية الإجمالية: ${totalQty} | السعر الإجمالي: ${totalPrice} د.ل`,
                    price: totalPrice,
                    img: order.productImg,
                    status: order.status,
                    date: order.date,
                    ezoneOrderId: ezoneOrderId
                }));

                if (lastProd.cat && lastProd.key) {
                    try {
                        const token = await getFirebaseAuthToken();
                        const stockRes = await axios.get(`${FB_DB_URL}/store_master_v5/products/${lastProd.cat}/${lastProd.key}/stock.json?auth=${token}`);
                        const currentStock = parseInt(stockRes.data) || 0;
                        if (currentStock >= totalQty) {
                            await axios.put(`${FB_DB_URL}/store_master_v5/products/${lastProd.cat}/${lastProd.key}/stock.json?auth=${token}`, currentStock - totalQty);
                        }
                    } catch (stkErr) { console.error("Stock Update Error:", stkErr.message); }
                }

                await redis.del(stateKey, orderKey, `last_product:${senderId}`);
                
                if (ezoneOrderId) {
                    await sendMessage(senderId, `✅ تم تسجيل طلبك بنجاح برقم: ${ezoneOrderId}! سنتصل بك قريباً لتأكيد الطلب.`);
                } else {
                    await sendMessage(senderId, "✅ تم تسجيل طلبك بنجاح! سنتصل بك قريباً لتأكيد الطلب.");
                }
                break;
            case "AWAITING_PRODUCT_INFO":
                if (event.message.attachments && event.message.attachments.some(att => att.type === 'image')) {
                    await sendMessage(senderId, "تم استلام الصورة بنجاح! 📸\nسيتواصل معك أحد موظفي الخدمة لتأكيد المنتج وإتمام الحجز يدوياً في أقرب وقت. 🌸");
                    await redis.del(stateKey);
                    return;
                }

                let matchedProdAwaiting = null;
                try {
                    const token = await getFirebaseAuthToken();
                    const fbRes = await axios.get(`${FB_DB_URL}/store_master_v5/products.json?auth=${token}`, { timeout: 5000 });
                    const categories = fbRes.data || {};

                    matchedProdAwaiting = findProductByFBPostLink(categories, messageText);
                    if (!matchedProdAwaiting) {
                        matchedProdAwaiting = findProduct(categories, messageText, "");
                    }
                } catch (e) {
                    console.error("AWAITING_PRODUCT_INFO search error:", e.message);
                }

                if (matchedProdAwaiting) {
                    let stockStatus = "نفد ❌";
                    let totalStock = 0;
                    try {
                        const ezoneToken = await ezoneClient.getScopedToken(redis);
                        const variants = await ezoneClient.getVariants(ezoneToken, matchedProdAwaiting.key);
                        totalStock = variants.reduce((sum, v) => sum + (v.quantity || 0), 0);
                        stockStatus = totalStock > 0 ? "متوفر ✅" : "نفد ❌";
                    } catch (ezoneErr) {
                        stockStatus = parseInt(matchedProdAwaiting.stock) > 0 ? "متوفر ✅" : "نفد ❌";
                        totalStock = parseInt(matchedProdAwaiting.stock) || 0;
                    }

                    if (totalStock <= 0) {
                        await sendMessage(senderId, `❌ عذراً، منتج "${matchedProdAwaiting.name}" (كود: ${matchedProdAwaiting.sku}) نفدت كميته من المخزون حالياً ولا يمكن حجزه.`);
                        await redis.del(stateKey);
                        return;
                    }

                    await redis.set(`last_product:${senderId}`, JSON.stringify({
                        ...matchedProdAwaiting,
                        price: `${matchedProdAwaiting.price} د.ل`,
                        img: matchedProdAwaiting.img || ""
                    }), 'EX', 86400);

                    const sizesStr = matchedProdAwaiting.sizes ? `\n📏 المقاسات: ${matchedProdAwaiting.sizes}` : "";
                    const msg = `🌸 تم تحديد المنتج بنجاح:
                    
🏷️ المنتج: ${matchedProdAwaiting.name}
🔢 الكود: ${matchedProdAwaiting.sku}
💰 السعر: ${matchedProdAwaiting.price} د.ل${sizesStr}
✅ حالة المخزون: ${stockStatus}

هل ترغب في البدء في إجراءات الحجز الآن؟ 👇`;

                    await sendMessage(senderId, msg, [
                        { title: "نعم، ابدأ الحجز", payload: "START_BOOKING" }
                    ]);
                    await redis.set(stateKey, "START_OR_NOT");
                } else {
                    await sendMessage(senderId, "⚠️ لم نتمكن من تحديد المنتج. يرجى إرسال الكود الصحيح (مثلاً: 51) أو رابط المنشور أو صورة للمنتج:");
                }
                break;

            case "START_OR_NOT":
                let startBooking = false;
                if (quickReplyPayload === "START_BOOKING") {
                    startBooking = true;
                } else {
                    const norm = ezoneClient.normalizeArabic(messageText);
                    if (norm.includes("نعم") || norm.includes("حجز") || norm.includes("ابدا") || norm.includes("ابدأ") || norm.includes("ايه")) {
                        startBooking = true;
                    }
                }

                if (startBooking) {
                    await sendMessage(senderId, "نبدأ الحجز! 📝 أرسل اسمك الثلاثي:");
                    await redis.set(stateKey, "ASKING_NAME");
                } else {
                    await sendMessage(senderId, "تم إلغاء العملية. يمكنك دائماً كتابة \"حجز\" أو إرسال كود منتج آخر للبدء من جديد. 🌸");
                    await redis.del(stateKey);
                }
                break;
        }
    } catch (e) { console.error("Message Error:", e.message); }
}

async function handlePostback(event) {
    const senderId = event.sender.id;
    const payload = event.postback.payload;
    if (payload === "GET_STARTED") {
        await sendMessage(senderId, WELCOME_MESSAGE);
    }
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
                            } else if (ev.postback) {
                                await handlePostback(ev);
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
