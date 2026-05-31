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
    const convertArabicNumerals = (text) => {
        if (!text) return "";
        const easternNums = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
        return text.replace(/[٠-٩]/g, d => easternNums.indexOf(d));
    };

    let cleanSearch = convertArabicNumerals(searchText).toLowerCase();
    // Separate letters and digits for both English and Arabic unicode characters (e.g. كود51 -> كود 51)
    cleanSearch = cleanSearch
        .replace(/([\u0600-\u06FFa-zA-Z])(\d)/g, '$1 $2')
        .replace(/(\d)([\u0600-\u06FFa-zA-Z])/g, '$1 $2');

    let cleanPost = convertArabicNumerals(postText).toLowerCase();
    cleanPost = cleanPost
        .replace(/([\u0600-\u06FFa-zA-Z])(\d)/g, '$1 $2')
        .replace(/(\d)([\u0600-\u06FFa-zA-Z])/g, '$1 $2');

    const fullText = cleanSearch + " " + cleanPost;
    
    const isWholeWordMatch = (target, text) => {
        if (!target) return false;
        const escapedTarget = target.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const regex = new RegExp(`(^|\\s|[\\.,!\\?،]|\\-|#)${escapedTarget}($|\\s|[\\.,!\\?،]|\\-|#)`, 'i');
        return regex.test(text);
    };
    
    // First pass: strictly check the user's comment (cleanSearch)
    for (let catName in categories) {
        for (let prodKey in categories[catName]) {
            const p = categories[catName][prodKey];
            const sku = p.sku ? String(p.sku).toLowerCase() : "";
            if (sku && isWholeWordMatch(sku, cleanSearch)) return { ...p, cat: catName, key: prodKey };
        }
    }

    // Second pass: check the post text (for single-product posts where user just says "حجز")
    let bestMatch = null;
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
    if (from.id === FB_PAGE_ID) return;
    const userMessage = message || "";

    try {
        const token = await getFirebaseAuthToken();
        const fbRes = await axios.get(`${FB_DB_URL}/store_master_v5/products.json?auth=${token}`, { timeout: 5000 });
        const categories = fbRes.data || {};
        
        const postInfo = await makeRequest(`/${post_id}?fields=message&access_token=${PAGE_ACCESS_TOKEN}`, 'GET');
        const postText = postInfo ? (postInfo.message || "") : "";
        
        const product = findProduct(categories, userMessage, postText);

        // Handle collection post if user didn't specify a code
        if (!product && (postText.includes("تشكيلة مميزة") || postText.includes("كل صورة عليها كود"))) {
            await replyToCommentPublicly(comment_id, "تم الرد فالخاص! 🌸");
            
            const privateMsg = `مرحباً بك! يرجى تحديد كود المنتج الذي ترغب بحجزه (مثال: كود 58) لكي نقوم بمساعدتك وإتمام الحجز لك 🌸`;
            await makeRequest(`/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, 'POST', {
                recipient: { comment_id },
                message: { text: privateMsg }
            });
            return;
        }

        if (!product) {
            const generalReplyMsg = `أهلاً بك في DaVinci Store! 🌸\nيسعدنا تواصلك معنا. للحجز أو الاستفسار يرجى إرسال كود المنتج الذي ترغب به هنا في الخاص لكي نتمكن من مساعدتك 🌹`;
            await replyToCommentPublicly(comment_id, "تم الرد فالخاص 🌹");
            await makeRequest(`/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, 'POST', {
                recipient: { comment_id },
                message: { text: generalReplyMsg }
            });
            return;
        }

        if (product) {
            await likeComment(comment_id);
            
            let stockStatus = "نفد ❌";
            let livePrice = product.price;
            if (product.key) {
                try {
                    const ezoneToken = await ezoneClient.getScopedToken(redis);
                    const variants = await ezoneClient.getVariants(ezoneToken, product.key);
                    const totalStock = variants.reduce((sum, v) => sum + (v.quantity || 0), 0);
                    stockStatus = totalStock > 0 ? "متوفر ✅" : "نفد ❌";
                    if (variants[0] && typeof variants[0].price !== 'undefined') {
                        livePrice = variants[0].price;
                    }
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
💰 السعر: ${livePrice} د.ل${sizesStr}
✅ حالة المخزون: ${stockStatus}
 
📝 للحجز، أرسل كلمة "حجز" هنا في الخاص وسجل طلبك!`;
            
            const productID = product.key || product.id || product.sku;
            const storeLink = `https://da-vinci.ezone.ly/products/${productID}`;
            console.log("Sending public reply...");
            await replyToCommentPublicly(comment_id, `ردينا عليك فالخاص! 🌹\nرابط المنتج: ${storeLink}`);
            
            console.log("Sending private reply via Messages API...");
            await makeRequest(`/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, 'POST', {
                recipient: { comment_id },
                message: { text: msg }
            });

            if (redis) {
                try {
                    await redis.set(`last_product:${from.id}`, JSON.stringify({
                        ...product,
                        price: `${livePrice} د.ل`,
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

async function finishOrderCreation(senderId, redis, order, lastProd, stateKey, orderKey, host) {
    try {
        let ezoneOrderId = null;
        let variantText = "غير محدد";
        let totalQty = 0;
        let cityId = 1;

        if (order.items && order.items.length > 0) {
            totalQty = order.items.reduce((sum, item) => sum + item.quantity, 0);
        } else {
            totalQty = 1;
        }

        // 1. Automate Ezone order creation
        if (order.items && order.items.length > 0) {
            try {
                console.log(`[Webhook] Automating order creation on Ezone...`);
                const ezoneToken = await ezoneClient.getScopedToken(redis);
                
                // Clean the phone number (just in case)
                const rawPhone = order.phone || "";
                const easternNums = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
                let cleanedPhone = rawPhone.replace(/[٠-٩]/g, d => easternNums.indexOf(d));
                cleanedPhone = cleanedPhone.replace(/\D/g, ''); 

                const ezoneCustomerId = await ezoneClient.findOrCreateCustomer(ezoneToken, order.name, cleanedPhone, '');
                const cityRes = await ezoneClient.resolveCityAndSubCity(ezoneToken, order.location, order.landmark);
                cityId = cityRes.cityId;
                const ezoneAddressId = await ezoneClient.findOrCreateAddress(ezoneToken, ezoneCustomerId, `${order.location} (${order.landmark ? 'نقطة دالة: ' + order.landmark : ''})`.trim(), cityId, cityRes.subCityId);
                
                const ezoneItems = order.items.map(item => ({
                    productId: item.productId,
                    variantId: item.variantId,
                    quantity: item.quantity
                }));

                const orderNotes = `نقطة دالة: ${order.landmark || 'غير محددة'} | ملاحظات: ${order.notes || 'لا يوجد'}`;
                ezoneOrderId = await ezoneClient.placeOrder(ezoneToken, ezoneCustomerId, ezoneAddressId, ezoneItems, null, 1, orderNotes);
            } catch (ezoneErr) {
                console.error("[Webhook] Ezone order integration failed:", ezoneErr.message);
            }
        }

        // 2. Fetch variants for accurate prices & discounts
        let productTotal = 0;
        let totalDiscount = 0;
        let itemsDetailsText = "";
        let structuredItems = [];

        try {
            const ezoneToken = await ezoneClient.getScopedToken(redis);
            
            // Group items by productId to fetch variants once
            const productIds = [...new Set(order.items.map(item => item.productId))];
            const productVariants = {};
            for (const pid of productIds) {
                try {
                    productVariants[pid] = await ezoneClient.getVariants(ezoneToken, pid);
                } catch (e) {
                    productVariants[pid] = [];
                }
            }
            
            if (order.items && order.items.length > 0) {
                itemsDetailsText = order.items.map(item => {
                    const vars = productVariants[item.productId] || [];
                    const v = vars.find(varObj => String(varObj.variantId) === String(item.variantId));
                    const price = v ? v.price : (parseFloat(item.price) || 0);
                    const originalPrice = v ? (v.originalPrice || v.price) : price;
                    
                    productTotal += price * item.quantity;
                    if (originalPrice > price) {
                        totalDiscount += (originalPrice - price) * item.quantity;
                    }

                    structuredItems.push({
                        productId: item.productId,
                        productName: item.productName || order.productName || "غير محدد",
                        sku: item.sku || order.sku || "",
                        variantId: item.variantId,
                        sizeText: item.sizeText,
                        quantity: item.quantity,
                        price: price,
                        originalPrice: originalPrice
                    });
                    
                    return `  - كود ${item.sku || order.sku} (مقاس: ${item.sizeText.trim()} | الكمية: ${item.quantity} | السعر: ${price} د.ل)`;
                }).join("\n");
                variantText = order.items.map(item => `كود ${item.sku || order.sku}: ${item.sizeText.trim()} (عدد: ${item.quantity})`).join(", ");
            }
        } catch (err) {
            console.error("[Webhook] Failed to calculate dynamic prices, using fallback:", err.message);
            const basePrice = parseFloat(lastProd.price) || 0;
            productTotal = basePrice * totalQty;
            itemsDetailsText = order.items ? order.items.map(item => `  - كود ${item.sku || order.sku} (مقاس: ${item.sizeText.trim()} | الكمية: ${item.quantity})`).join("\n") : "  - الكمية: 1";
            
            if (order.items && order.items.length > 0) {
                structuredItems = order.items.map(item => ({
                    productId: item.productId,
                    productName: item.productName || order.productName || "غير محدد",
                    sku: item.sku || order.sku || "",
                    variantId: item.variantId,
                    sizeText: item.sizeText,
                    quantity: item.quantity,
                    price: parseFloat(item.price) || basePrice,
                    originalPrice: parseFloat(item.price) || basePrice
                }));
            }
        }

        // 3. Delivery Fee (15 for Tripoli/Janzour, 25 for others)
        const deliveryFee = (cityId === 1 || cityId === 6) ? 15 : 25;

        // 4. Financial Calculations
        const finalTotal = productTotal + deliveryFee - totalDiscount;
        const payType = order.payMethodType;

        const orderNum = ezoneOrderId ? String(ezoneOrderId) : `AUTO-${Date.now().toString().substring(8)}`;
        const orderKeyId = `${Date.now()}_${senderId}`;
        const redisOrderKey = `final_order:${orderKeyId}`;

        const finalHost = host || "da-vinci.ezone.ly";
        const invoiceUrl = `https://${finalHost}/api/invoice?id=${orderKeyId}`;

        const invoiceMsg = `🧾 تم تأكيد حجز طلبك بنجاح في DaVinci Store! 🧾
----------------------------------------
رقم الطلب: ${orderNum}

📌 يمكنك استعراض وتحميل فاتورة الحجز الإلكترونية الأنيقة والملونة مباشرة عبر هذا الرابط 👇:
🔗 ${invoiceUrl}

🚚 سيتصل بك موظف التأكيد ومندوب التوصيل قريباً لتنسيق موعد ومكان الاستلام. شكراً لثقتك بنا! 🌸`;

        // 5. Save the final order in Redis with structured details
        const mainImg = (order.items && order.items[0]) ? order.items[0].img : (order.productImg || "");
        const mainName = (order.items && order.items.length > 0) 
            ? [...new Set(order.items.map(item => item.productName))].join(" + ")
            : (order.productName || "غير محدد");

        await redis.set(redisOrderKey, JSON.stringify({
            name: order.name,
            phone: order.phone,
            location: order.location,
            landmark: order.landmark,
            notes: order.notes,
            details: `المنتجات:\n${itemsDetailsText}\n| الكمية الإجمالية: ${totalQty} | السعر الإجمالي: ${finalTotal} د.ل`,
            price: finalTotal,
            img: mainImg,
            status: order.status,
            date: order.date,
            ezoneOrderId: ezoneOrderId,
            payMethodType: payType,
            paidAdvance: order.paidAdvance || 0,
            cardAmount: order.cardAmount || 0,
            cashAmount: order.cashAmount || 0,
            productTotal: productTotal,
            totalDiscount: totalDiscount,
            deliveryFee: deliveryFee,
            sku: (order.items && order.items[0]) ? order.items[0].sku : (lastProd.sku || ""),
            items: structuredItems
        }));

        // 6. Update Firebase Stock for all items
        if (order.items && order.items.length > 0) {
            try {
                const token = await getFirebaseAuthToken();
                const productQtys = {};
                order.items.forEach(item => {
                    productQtys[item.productId] = (productQtys[item.productId] || 0) + item.quantity;
                });
                
                for (const pid of Object.keys(productQtys)) {
                    // Search categories to find category name
                    const fbProdRes = await axios.get(`${FB_DB_URL}/store_master_v5/products.json?auth=${token}`);
                    const categories = fbProdRes.data || {};
                    let catName = null;
                    for (let c in categories) {
                        if (categories[c][pid]) {
                            catName = c;
                            break;
                        }
                    }
                    
                    if (catName) {
                        const stockRes = await axios.get(`${FB_DB_URL}/store_master_v5/products/${catName}/${pid}/stock.json?auth=${token}`);
                        const currentStock = parseInt(stockRes.data) || 0;
                        const qtyToDeduct = productQtys[pid];
                        if (currentStock >= qtyToDeduct) {
                            await axios.put(`${FB_DB_URL}/store_master_v5/products/${catName}/${pid}/stock.json?auth=${token}`, currentStock - qtyToDeduct);
                        }
                    }
                }
            } catch (stkErr) { console.error("Stock Update Error:", stkErr.message); }
        }

        // 7. Cleanup Redis states (except stateKey which we update to post-booking state)
        await redis.del(orderKey, `last_product:${senderId}`);

        // 8. Send Invoice
        await sendMessage(senderId, invoiceMsg);

        // 9. Send Post-Booking Menu
        const nextStepsMsg = `هل ترغب في القيام بأي شيء آخر؟ 👇`;
        const nextStepsReplies = [
            { title: "🛍️ حجز منتج آخر", payload: "NEXT_ACTION:NEW_BOOKING" },
            { title: "👤 التحدث مع موظف", payload: "NEXT_ACTION:TALK_AGENT" },
            { title: "🌐 زيارة المتجر", payload: "NEXT_ACTION:VISIT_STORE" }
        ];
        await sendMessage(senderId, nextStepsMsg, nextStepsReplies);
        await redis.set(stateKey, "AWAITING_POST_BOOKING_ACTION");

    } catch (criticalErr) {
        console.error("[Webhook] critical error in finishOrderCreation:", criticalErr.message);
        await sendMessage(senderId, "✅ تم تسجيل طلبك بنجاح! سيتصل بك موظف التأكيد لتأكيد الاستلام والدفع.");
        await redis.del(stateKey, orderKey, `last_product:${senderId}`);
    }
}

async function handleMessage(event, host) {
    const senderId = event.sender.id;
    const messageText = (event.message.text || "").trim();
    const quickReplyPayload = event.message.quick_reply ? event.message.quick_reply.payload : null;
    const hasAttachments = event.message.attachments && event.message.attachments.length > 0;
    if (!redis) return;
    if (!messageText && !quickReplyPayload && !hasAttachments) return;

    try {
        const stateKey = `user_state:${senderId}`;
        const orderKey = `order:${senderId}`;

        let state = await redis.get(stateKey);
        const isStartBookingTrigger = 
            (messageText.trim().toLowerCase() === "حجز") || 
            (quickReplyPayload === "START_BOOKING") || 
            (!state && (messageText.toLowerCase().includes("حجز") || messageText.toLowerCase().includes("الحجز")));

        if (isStartBookingTrigger) {
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
                let livePrice = matchedProduct.price;
                try {
                    const ezoneToken = await ezoneClient.getScopedToken(redis);
                    const variants = await ezoneClient.getVariants(ezoneToken, matchedProduct.key);
                    totalStock = variants.reduce((sum, v) => sum + (v.quantity || 0), 0);
                    stockStatus = totalStock > 0 ? "متوفر ✅" : "نفد ❌";
                    if (variants[0] && typeof variants[0].price !== 'undefined') {
                        livePrice = variants[0].price;
                    }
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
                    price: `${livePrice} د.ل`,
                    img: matchedProduct.img || ""
                }), 'EX', 86400);

                const sizesStr = matchedProduct.sizes ? `\n📏 المقاسات: ${matchedProduct.sizes}` : "";
                const msg = `🌸 أهلاً بك! تم تحديد المنتج:
                
🏷️ المنتج: ${matchedProduct.name}
🔢 الكود: ${matchedProduct.sku}
💰 السعر: dots ${livePrice} د.ل${sizesStr}
✅ حالة المخزون: ${stockStatus}

للبدء في الحجز، أرسل كلمة "حجز" أو اضغط على الزر أدناه 👇`.replace('\dots ', '');

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
            case "ASKING_PHONE": {
                const rawPhone = messageText.trim();
                const easternNums = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
                let cleanedPhone = rawPhone.replace(/[٠-٩]/g, d => easternNums.indexOf(d));
                cleanedPhone = cleanedPhone.replace(/\D/g, ''); 
                order.phone = cleanedPhone;
                await redis.set(orderKey, JSON.stringify(order));
                
                await redis.set(stateKey, "SELECTING_CITY");
                const cityQuickReplies = [
                    { title: "طرابلس", payload: "SELECT_CITY:1:طرابلس" },
                    { title: "بنغازي", payload: "SELECT_CITY:2:بنغازي" },
                    { title: "مصراتة", payload: "SELECT_CITY:4:مصراتة" },
                    { title: "الزاوية", payload: "SELECT_CITY:5:الزاوية" },
                    { title: "جنزور", payload: "SELECT_CITY:6:جنزور" },
                    { title: "تاجوراء", payload: "SELECT_CITY:14:تاجوراء" },
                    { title: "الخمس", payload: "SELECT_CITY:17:الخمس" },
                    { title: "زليتن", payload: "SELECT_CITY:18:زليتن" },
                    { title: "ترهونة", payload: "SELECT_CITY:21:ترهونة" },
                    { title: "غريان", payload: "SELECT_CITY:30:غريان" },
                    { title: "قصر بن غشير", payload: "SELECT_CITY:39:قصر بن غشير" },
                    { title: "سبها", payload: "SELECT_CITY:3:سبها" },
                    { title: "مدينة أخرى 🌍", payload: "SELECT_CITY:OTHER:مدينة أخرى" }
                ];
                await sendMessage(senderId, "يرجى اختيار مدينة التوصيل من القائمة 👇:", cityQuickReplies);
                break;
            }
            case "SELECTING_CITY": {
                let cityId = null;
                let cityName = "";
                if (quickReplyPayload && quickReplyPayload.startsWith("SELECT_CITY:")) {
                    const parts = quickReplyPayload.split(":");
                    cityId = parts[1];
                    cityName = parts[2];
                } else {
                    cityName = messageText.trim();
                    const citiesMap = {
                        "طرابلس": "1", "بنغازي": "2", "مصراتة": "4", "مصراته": "4",
                        "الزاوية": "5", "الزاويه": "5", "جنزور": "6", "تاجوراء": "14",
                        "الخمس": "17", "زليتن": "18", "ترهونة": "21", "ترهونه": "21",
                        "غريان": "30", "قصر بن غشير": "39", "قصربن غشير": "39", "سبها": "3"
                    };
                    const normCityName = ezoneClient.normalizeArabic(cityName);
                    for (const [nameKey, idVal] of Object.entries(citiesMap)) {
                        if (ezoneClient.normalizeArabic(nameKey) === normCityName) {
                            cityId = idVal;
                            cityName = nameKey;
                            break;
                        }
                    }
                }

                if (cityId === "OTHER") {
                    await redis.set(stateKey, "WRITING_CITY");
                    await sendMessage(senderId, "يرجى كتابة اسم مدينتك للتوصيل 🌍:");
                    return;
                }

                if (!cityId) {
                    order.city_name = cityName;
                    await redis.set(orderKey, JSON.stringify(order));
                    await redis.set(stateKey, "ASKING_DETAILED_ADDRESS");
                    await sendMessage(senderId, "يرجى كتابة العنوان بالتفصيل (مثل الحي أو الشارع) 👇:");
                    return;
                }

                order.city_id = cityId;
                order.city_name = cityName;
                await redis.set(orderKey, JSON.stringify(order));

                if (cityId === "1") {
                    await redis.set(stateKey, "SELECTING_REGION");
                    const tripoliRegions = [
                        { title: "السياحية", payload: "SELECT_REGION:101:السياحية" },
                        { title: "السراج", payload: "SELECT_REGION:115:السراج" },
                        { title: "غوط الشعال", payload: "SELECT_REGION:114:غوط الشعال" },
                        { title: "حي الأندلس", payload: "SELECT_REGION:102:حي الأندلس" },
                        { title: "قرقارش", payload: "SELECT_REGION:113:قرقارش" },
                        { title: "عين زارة", payload: "SELECT_REGION:150:عين زارة" },
                        { title: "سوق الجمعة", payload: "SELECT_REGION:138:سوق الجمعة" },
                        { title: "صلاح الدين", payload: "SELECT_REGION:126:صلاح الدين" },
                        { title: "أبوسليم", payload: "SELECT_REGION:119:أبوسليم" },
                        { title: "الفرناج", payload: "SELECT_REGION:129:الفرناج" },
                        { title: "الظهرة", payload: "SELECT_REGION:104:الظهرة" },
                        { title: "منطقة أخرى 📍", payload: "SELECT_REGION:WRITE_OTHER:منطقة أخرى" }
                    ];
                    await sendMessage(senderId, "الرجاء اختيار منطقة التوصيل في طرابلس 👇:", tripoliRegions);
                } else if (cityId === "2") {
                    await redis.set(stateKey, "SELECTING_REGION");
                    const benghaziRegions = [
                        { title: "وسط المدينة", payload: "SELECT_REGION:155:وسط المدينة" },
                        { title: "الليثي", payload: "SELECT_REGION:175:الليثي" },
                        { title: "السلماني", payload: "SELECT_REGION:167:السلماني" },
                        { title: "بلعون", payload: "SELECT_REGION:173:بلعون" },
                        { title: "الحدائق", payload: "SELECT_REGION:165:الحدائق" },
                        { title: "الماجوري", payload: "SELECT_REGION:162:الماجوري" },
                        { title: "الفويهات", payload: "SELECT_REGION:176:الفويهات" },
                        { title: "طابلينو", payload: "SELECT_REGION:171:طابلينو" },
                        { title: "بنينا", payload: "SELECT_REGION:182:بنينا" },
                        { title: "الهواري", payload: "SELECT_REGION:185:الهواري" },
                        { title: "الكيش", payload: "SELECT_REGION:188:الكيش" },
                        { title: "منطقة أخرى 📍", payload: "SELECT_REGION:WRITE_OTHER:منطقة أخرى" }
                    ];
                    await sendMessage(senderId, "الرجاء اختيار منطقة التوصيل في بنغازي 👇:", benghaziRegions);
                } else {
                    order.location = cityName;
                    await redis.set(orderKey, JSON.stringify(order));
                    await redis.set(stateKey, "ASKING_DETAILED_ADDRESS");
                    await sendMessage(senderId, "يرجى كتابة العنوان بالتفصيل (مثل الحي أو الشارع) 👇:");
                }
                break;
            }
            case "WRITING_CITY": {
                order.city_name = messageText.trim();
                await redis.set(orderKey, JSON.stringify(order));
                await redis.set(stateKey, "ASKING_DETAILED_ADDRESS");
                await sendMessage(senderId, "يرجى كتابة العنوان بالتفصيل (مثل الحي أو الشارع) 👇:");
                break;
            }
            case "SELECTING_REGION": {
                let regionId = null;
                let regionName = "";
                if (quickReplyPayload && quickReplyPayload.startsWith("SELECT_REGION:")) {
                    const parts = quickReplyPayload.split(":");
                    regionId = parts[1];
                    regionName = parts[2];
                } else {
                    regionName = messageText.trim();
                }

                if (regionId === "WRITE_OTHER" || !regionId) {
                    await redis.set(stateKey, "WRITING_REGION");
                    await sendMessage(senderId, "يرجى كتابة اسم منطقتك للتوصيل 👇:");
                    return;
                }

                order.sub_city_id = regionId;
                order.region_name = regionName;
                order.location = `${order.city_name} - ${regionName}`;
                await redis.set(orderKey, JSON.stringify(order));
                
                await redis.set(stateKey, "ASKING_LANDMARK");
                await sendMessage(senderId, "أقرب نقطة دالة لتسهيل التوصيل (مثلاً: بجانب جامع أو محطة وقود) 👇:");
                break;
            }
            case "WRITING_REGION": {
                const regName = messageText.trim();
                order.region_name = regName;
                order.location = `${order.city_name} - ${regName}`;
                await redis.set(orderKey, JSON.stringify(order));
                
                await redis.set(stateKey, "ASKING_LANDMARK");
                await sendMessage(senderId, "أقرب نقطة دالة لتسهيل التوصيل (مثلاً: بجانب جامع أو محطة وقود) 👇:");
                break;
            }
            case "ASKING_DETAILED_ADDRESS": {
                const detailedAddr = messageText.trim();
                order.detailed_address = detailedAddr;
                order.location = `${order.city_name || ""} - ${detailedAddr}`;
                await redis.set(orderKey, JSON.stringify(order));
                
                await redis.set(stateKey, "ASKING_LANDMARK");
                await sendMessage(senderId, "أقرب نقطة دالة لتسهيل التوصيل (مثلاً: بجانب جامع أو محطة وقود) 👇:");
                break;
            }
            case "ASKING_LANDMARK": {
                order.landmark = messageText.trim();
                order.items = []; // Initialize items array for the order
                await redis.set(orderKey, JSON.stringify(order));
                await sendSizeSelection(senderId, redis, lastProd, stateKey, true);
                break;
            }
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
                
                // Fetch dynamic price of variant to store in order items
                let itemPrice = parseFloat(lastProd.price) || 0;
                try {
                    const ezoneToken = await ezoneClient.getScopedToken(redis);
                    const variants = await ezoneClient.getVariants(ezoneToken, lastProd.key);
                    const cv = variants.find(v => String(v.variantId) === currentVarId);
                    if (cv && typeof cv.price !== 'undefined') {
                        itemPrice = cv.price;
                    }
                } catch (pe) {}

                order.items.push({
                    productId: lastProd.key,
                    productName: lastProd.name,
                    sku: lastProd.sku,
                    img: lastProd.img || "",
                    variantId: currentVarId,
                    sizeText: order.current_size_text,
                    quantity: selectedQty,
                    price: itemPrice,
                    originalPrice: itemPrice
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
                        await redis.set(stateKey, "ASKING_ADD_PRODUCT");
                        const addProductReplies = [
                            { title: "🛍️ نعم، إضافة منتج آخر", payload: "ADD_PRODUCT:YES" },
                            { title: "💳 لا، أكمل الطلب", payload: "ADD_PRODUCT:NO" }
                        ];
                        await sendMessage(senderId, "هل ترغب في إضافة منتج/موديل آخر للطلب؟ 👇", addProductReplies);
                    }
                } else if (addMore === "NO") {
                    await redis.set(stateKey, "ASKING_ADD_PRODUCT");
                    const addProductReplies = [
                        { title: "🛍️ نعم، إضافة منتج آخر", payload: "ADD_PRODUCT:YES" },
                        { title: "💳 لا، أكمل الطلب", payload: "ADD_PRODUCT:NO" }
                    ];
                    await sendMessage(senderId, "هل ترغب في إضافة منتج/موديل آخر للطلب؟ 👇", addProductReplies);
                } else {
                    const addMoreReplies = [
                        { title: "نعم، إضافة مقاس", payload: "ADD_MORE:YES" },
                        { title: "لا، أكمل الطلب", payload: "ADD_MORE:NO" }
                    ];
                    await sendMessage(senderId, "الرجاء اختيار أحد الخيارات: هل ترغب في إضافة مقاس آخر؟ 👇", addMoreReplies);
                }
                break;

            case "ASKING_ADD_PRODUCT":
                let addProduct = null;
                if (quickReplyPayload && quickReplyPayload.startsWith("ADD_PRODUCT:")) {
                    addProduct = quickReplyPayload.split(":")[1];
                } else {
                    const norm = ezoneClient.normalizeArabic(messageText);
                    if (norm.includes("نعم") || norm.includes("اضافه") || norm.includes("اضافة") || norm.includes("منتج")) {
                        addProduct = "YES";
                    } else if (norm.includes("لا") || norm.includes("اكمل") || norm.includes("كاف") || norm.includes("يكفي")) {
                        addProduct = "NO";
                    }
                }

                if (addProduct === "YES") {
                    await redis.set(stateKey, "AWAITING_ADDITIONAL_PRODUCT_CODE");
                    await sendMessage(senderId, "يرجى إرسال كود المنتج الآخر الذي ترغب في إضافته للطلب (مثال: كود 51) 👇");
                } else if (addProduct === "NO") {
                    await redis.set(stateKey, "ASKING_NOTES");
                    await sendMessage(senderId, "أي ملاحظات إضافية على الطلب؟ (أو اكتب 'لا يوجد'):");
                } else {
                    const addProductReplies = [
                        { title: "🛍️ نعم، إضافة منتج آخر", payload: "ADD_PRODUCT:YES" },
                        { title: "💳 لا، أكمل الطلب", payload: "ADD_PRODUCT:NO" }
                    ];
                    await sendMessage(senderId, "الرجاء اختيار أحد الخيارات: هل ترغب في إضافة منتج/موديل آخر للطلب؟ 👇", addProductReplies);
                }
                break;

            case "AWAITING_ADDITIONAL_PRODUCT_CODE":
                const normText = ezoneClient.normalizeArabic(messageText).trim();
                if (normText === "تخطي" || normText === "لا" || normText === "اكمل الطلب" || normText === "لا يوجد") {
                    await redis.set(stateKey, "ASKING_NOTES");
                    await sendMessage(senderId, "أي ملاحظات إضافية على الطلب؟ (أو اكتب 'لا يوجد'):");
                    return;
                }

                let nextProduct = null;
                try {
                    const token = await getFirebaseAuthToken();
                    const fbRes = await axios.get(`${FB_DB_URL}/store_master_v5/products.json?auth=${token}`, { timeout: 5000 });
                    const categories = fbRes.data || {};
                    
                    nextProduct = findProductByFBPostLink(categories, messageText);
                    if (!nextProduct) {
                        const cleanMsg = messageText.trim().toLowerCase();
                        let isPossibleSku = false;
                        if (/^\d+$/.test(cleanMsg)) {
                            isPossibleSku = true;
                        } else if (cleanMsg.includes("كود") || cleanMsg.includes("code")) {
                            isPossibleSku = true;
                        }
                        
                        if (isPossibleSku) {
                            nextProduct = findProduct(categories, messageText, "");
                        }
                    }
                } catch (e) {
                    console.error("Additional product search error:", e.message);
                }

                if (nextProduct) {
                    let stockStatus = "نفد ❌";
                    let totalStock = 0;
                    let livePrice = nextProduct.price;
                    try {
                        const ezoneToken = await ezoneClient.getScopedToken(redis);
                        const variants = await ezoneClient.getVariants(ezoneToken, nextProduct.key);
                        totalStock = variants.reduce((sum, v) => sum + (v.quantity || 0), 0);
                        stockStatus = totalStock > 0 ? "متوفر ✅" : "نفد ❌";
                        if (variants[0] && typeof variants[0].price !== 'undefined') {
                            livePrice = variants[0].price;
                        }
                    } catch (ezoneErr) {
                        stockStatus = parseInt(nextProduct.stock) > 0 ? "متوفر ✅" : "نفد ❌";
                        totalStock = parseInt(nextProduct.stock) || 0;
                    }

                    if (totalStock <= 0) {
                        await sendMessage(senderId, `❌ عذراً، منتج "${nextProduct.name}" (كود: ${nextProduct.sku}) نفدت كميته من المخزون حالياً. يرجى إرسال كود منتج آخر متوفر:`);
                        return;
                    }

                    await redis.set(`last_product:${senderId}`, JSON.stringify({
                        ...nextProduct,
                        price: `${livePrice} د.ل`,
                        img: nextProduct.img || ""
                    }), 'EX', 86400);

                    const sizesStr = nextProduct.sizes ? `\n📏 المقاسات: ${nextProduct.sizes}` : "";
                    await sendMessage(senderId, `🌸 تم تحديد المنتج الإضافي:\n🏷️ المنتج: ${nextProduct.name}\n🔢 الكود: dots ${nextProduct.sku}\n💰 السعر: ${livePrice} د.ل${sizesStr}\n✅ حالة المخزون: ${stockStatus}`.replace('\dots ', ''));
                    
                    await sendSizeSelection(senderId, redis, nextProduct, stateKey, true);
                } else {
                    await sendMessage(senderId, "⚠️ عذراً، لم نتمكن من تحديد هذا المنتج. يرجى إرسال كود منتج صحيح (مثال: كود 51) أو كتابة 'تخطي' للمتابعة:");
                }
                break;

            case "ASKING_NOTES":
                order.notes = messageText;
                order.date = new Date().toISOString();
                order.status = "جديد";
                order.productImg = lastProd.img || "";
                order.productName = lastProd.name || "غير محدد";
                order.productPrice = parseFloat(lastProd.price) || 0;
                await redis.set(orderKey, JSON.stringify(order));
                
                await redis.set(stateKey, "ASKING_PAYMENT_METHOD");
                await sendMessage(senderId, "الرجاء اختيار طريقة دفع قيمة المنتج 👇:", [
                    { title: "💵 كاش عند الاستلام", payload: "PAYMENT:CASH" },
                    { title: "💳 بطاقة مصرفية", payload: "PAYMENT:CARD" },
                    { title: "📲 حوالة مصرفية", payload: "PAYMENT:TRANSFER" },
                    { title: "🔄 كاش + بطاقة", payload: "PAYMENT:MIXED" },
                    { title: "💸 دفع جزء مقدماً", payload: "PAYMENT:ADVANCE" }
                ]);
                break;

            case "ASKING_PAYMENT_METHOD":
                let payMethod = null;
                if (quickReplyPayload && quickReplyPayload.startsWith("PAYMENT:")) {
                    payMethod = quickReplyPayload.split(":")[1];
                } else {
                    const norm = ezoneClient.normalizeArabic(messageText);
                    if (norm.includes("كاش") && norm.includes("بطاق")) payMethod = "MIXED";
                    else if (norm.includes("كاش")) payMethod = "CASH";
                    else if (norm.includes("بطاق")) payMethod = "CARD";
                    else if (norm.includes("حوال")) payMethod = "TRANSFER";
                    else if (norm.includes("جزء") || norm.includes("عربون") || norm.includes("مقدم")) payMethod = "ADVANCE";
                }

                if (!payMethod) {
                    await sendMessage(senderId, "⚠️ الرجاء اختيار أحد خيارات الدفع المتاحة من الأزرار 👇:", [
                        { title: "💵 كاش عند الاستلام", payload: "PAYMENT:CASH" },
                        { title: "💳 بطاقة مصرفية", payload: "PAYMENT:CARD" },
                        { title: "📲 حوالة مصرفية", payload: "PAYMENT:TRANSFER" },
                        { title: "🔄 كاش + بطاقة", payload: "PAYMENT:MIXED" },
                        { title: "💸 دفع جزء مقدماً", payload: "PAYMENT:ADVANCE" }
                    ]);
                    return;
                }

                order.payMethodType = payMethod;
                await redis.set(orderKey, JSON.stringify(order));

                if (payMethod === "CASH") {
                    order.paidAdvance = 0;
                    await finishOrderCreation(senderId, redis, order, lastProd, stateKey, orderKey, host);
                } else if (payMethod === "CARD" || payMethod === "TRANSFER") {
                    await redis.set(stateKey, "ASKING_ADVANCE_TYPE");
                    await sendMessage(senderId, "هل قمت بدفع أي قيمة مقدماً (عربون)؟ 👇", [
                        { title: "❌ لا، لا يوجد", payload: "ADVANCE:NONE" },
                        { title: "½ نصف القيمة", payload: "ADVANCE:HALF" },
                        { title: "💰 كامل القيمة", payload: "ADVANCE:FULL" },
                        { title: "💵 قيمة أخرى", payload: "ADVANCE:OTHER" }
                    ]);
                } else if (payMethod === "MIXED") {
                    await redis.set(stateKey, "ASKING_MIXED_CARD_AMOUNT");
                    await sendMessage(senderId, "يرجى كتابة القيمة المراد دفعها بالبطاقة (مثلاً: 50):");
                } else if (payMethod === "ADVANCE") {
                    await redis.set(stateKey, "ASKING_ADVANCE_AMOUNT");
                    await sendMessage(senderId, "يرجى كتابة قيمة العربون المدفوع مقدماً (مثلاً: 40):");
                }
                break;

            case "ASKING_ADVANCE_TYPE":
                let advType = null;
                if (quickReplyPayload && quickReplyPayload.startsWith("ADVANCE:")) {
                    advType = quickReplyPayload.split(":")[1];
                } else {
                    const norm = ezoneClient.normalizeArabic(messageText);
                    if (norm.includes("نصف") || norm.includes("نص")) advType = "HALF";
                    else if (norm.includes("كامل") || norm.includes("كل")) advType = "FULL";
                    else if (norm.includes("لا") || norm.includes("ما في") || norm.includes("لا يوجد")) advType = "NONE";
                    else if (norm.includes("اخر") || norm.includes("أخرى")) advType = "OTHER";
                }

                if (!advType) {
                    await sendMessage(senderId, "⚠️ الرجاء الاختيار من الأزرار 👇:", [
                        { title: "❌ لا، لا يوجد", payload: "ADVANCE:NONE" },
                        { title: "½ نصف القيمة", payload: "ADVANCE:HALF" },
                        { title: "💰 كامل القيمة", payload: "ADVANCE:FULL" },
                        { title: "💵 قيمة أخرى", payload: "ADVANCE:OTHER" }
                    ]);
                    return;
                }

                const prodPrice = parseFloat(lastProd.price) || 0;
                const itemsCount = (order.items || []).reduce((sum, item) => sum + item.quantity, 0) || 1;
                const prodTotal = prodPrice * itemsCount;

                if (advType === "NONE") {
                    order.paidAdvance = 0;
                    await finishOrderCreation(senderId, redis, order, lastProd, stateKey, orderKey, host);
                } else if (advType === "HALF") {
                    order.paidAdvance = prodTotal / 2;
                    await finishOrderCreation(senderId, redis, order, lastProd, stateKey, orderKey, host);
                } else if (advType === "FULL") {
                    order.paidAdvance = prodTotal;
                    await finishOrderCreation(senderId, redis, order, lastProd, stateKey, orderKey, host);
                } else if (advType === "OTHER") {
                    await redis.set(stateKey, "ASKING_ADVANCE_AMOUNT");
                    await sendMessage(senderId, "يرجى كتابة قيمة العربون المدفوع مقدماً (مثلاً: 30):");
                }
                break;

            case "ASKING_ADVANCE_AMOUNT":
                const advAmount = parseFloat(messageText);
                if (isNaN(advAmount) || advAmount < 0) {
                    await sendMessage(senderId, "⚠️ الرجاء إدخال رقم صحيح لقيمة العربون (مثلاً: 45):");
                    return;
                }
                order.paidAdvance = advAmount;
                await finishOrderCreation(senderId, redis, order, lastProd, stateKey, orderKey, host);
                break;

            case "ASKING_MIXED_CARD_AMOUNT":
                const cardAmount = parseFloat(messageText);
                if (isNaN(cardAmount) || cardAmount < 0) {
                    await sendMessage(senderId, "⚠️ الرجاء إدخال رقم صحيح للقيمة المدفوعة بالبطاقة (مثلاً: 50):");
                    return;
                }
                order.cardAmount = cardAmount;
                order.paidAdvance = 0; 
                await finishOrderCreation(senderId, redis, order, lastProd, stateKey, orderKey, host);
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
                    let livePrice = matchedProdAwaiting.price;
                    try {
                        const ezoneToken = await ezoneClient.getScopedToken(redis);
                        const variants = await ezoneClient.getVariants(ezoneToken, matchedProdAwaiting.key);
                        totalStock = variants.reduce((sum, v) => sum + (v.quantity || 0), 0);
                        stockStatus = totalStock > 0 ? "متوفر ✅" : "نفد ❌";
                        if (variants[0] && typeof variants[0].price !== 'undefined') {
                            livePrice = variants[0].price;
                        }
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
                        price: `${livePrice} د.ل`,
                        img: matchedProdAwaiting.img || ""
                    }), 'EX', 86400);

                    const sizesStr = matchedProdAwaiting.sizes ? `\n📏 المقاسات: dots ${matchedProdAwaiting.sizes}`.replace('\dots ', '') : "";
                    const msg = `🌸 تم تحديد المنتج بنجاح:
                    
🏷️ المنتج: ${matchedProdAwaiting.name}
🔢 الكود: ${matchedProdAwaiting.sku}
💰 السعر: ${livePrice} د.ل${sizesStr}
✅ حالة المخزون: dots ${stockStatus}`.replace('\dots ', '');

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

            case "AWAITING_POST_BOOKING_ACTION": {
                let nextAction = null;
                if (quickReplyPayload && quickReplyPayload.startsWith("NEXT_ACTION:")) {
                    nextAction = quickReplyPayload.split(":")[1];
                } else {
                    const norm = ezoneClient.normalizeArabic(messageText);
                    if (norm.includes("حجز") || norm.includes("منتج اخر") || norm.includes("منتج آخر") || norm.includes("اضافه") || norm.includes("اضافة")) {
                        nextAction = "NEW_BOOKING";
                    } else if (norm.includes("موظف") || norm.includes("دعم") || norm.includes("تحدث") || norm.includes("استفسار") || norm.includes("كلم")) {
                        nextAction = "TALK_AGENT";
                    } else if (norm.includes("متجر") || norm.includes("موقع") || norm.includes("رابط")) {
                        nextAction = "VISIT_STORE";
                    }
                }

                if (nextAction === "NEW_BOOKING") {
                    await redis.set(stateKey, "AWAITING_PRODUCT_INFO");
                    await sendMessage(senderId, "حاضر! 🌸 يرجى إرسال كود المنتج الجديد الذي ترغب في حجزه (مثال: كود 51) أو رابط المنشور:");
                } else if (nextAction === "TALK_AGENT") {
                    await redis.del(stateKey);
                    await sendMessage(senderId, "تفضل، سيقوم أحد موظفي الخدمة بالتواصل معك والرد على استفسارك هنا في أقرب وقت. يمكنك كتابة استفسارك مباشرة 👇");
                } else if (nextAction === "VISIT_STORE") {
                    await redis.del(stateKey);
                    await sendMessage(senderId, "تفضل بزيارة متجرنا الإلكتروني لمشاهدة كافة المنتجات الحالية: https://da-vinci.ezone.ly 🌸");
                } else {
                    await redis.del(stateKey);
                    return await handleMessage(event, host);
                }
                break;
            }
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
                                await handleMessage(ev, req.headers.host);
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
