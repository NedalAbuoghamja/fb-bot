const Redis = require('ioredis');
const ezoneClient = require('./ezone_client');
const axios = require('axios');

const REDIS_URL = process.env.REDIS_URL;
let redis = null;
if (REDIS_URL) {
    redis = new Redis(REDIS_URL);
}

const FB_DB_URL = "https://davinci-a9db7-default-rtdb.firebaseio.com";
const API_KEY = "AIzaSyAcP3Ud60BC-RKD7bYVBx8bcro--L4mkLQ";
const EMAIL = "nedal@davinci.com";
const PASSWORD = "111111";

async function getFirebaseAuthToken() {
    try {
        const res = await axios.post(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
            email: EMAIL,
            password: PASSWORD,
            returnSecureToken: true
        });
        return res.data.idToken;
    } catch (e) {
        throw new Error("Firebase auth failed: " + e.message);
    }
}

module.exports = async (req, res) => {
    const { id, sku, category } = req.query;

    if (!id || !sku) {
        return res.status(400).send(`
            <div style="font-family: sans-serif; padding: 20px; direction: rtl; text-align: center;">
                <h2>⚠️ خطأ في المعلمات</h2>
                <p>يرجى إرسال معرف المنتج (id) والكود (sku). مثال:</p>
                <code>/api/add-product?id=71740&sku=34</code>
            </div>
        `);
    }

    if (!redis) {
        return res.status(500).send("Redis disconnected");
    }

    try {
        // 1. Scrape product storefront page for Name & Image
        console.log(`[AddProduct] Scraping storefront details for Ezone product ${id}...`);
        const storeUrl = `https://da-vinci.ezone.ly/products/${id}`;
        let name = "منتج دافينشي";
        let img = "";

        try {
            const htmlRes = await axios.get(storeUrl, { timeout: 8000 });
            const html = htmlRes.data;

            // Extract title
            const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
            if (titleMatch) {
                // E.g. "طقم صيفي بتصميم أنيق - DaVinci Store" -> "طقم صيفي بتصميم أنيق"
                name = titleMatch[1].split('-')[0].split('|')[0].trim();
            }

            // Extract og:image
            const ogImageMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
            if (ogImageMatch) {
                img = ogImageMatch[1];
            } else {
                const twitterImageMatch = html.match(/<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i);
                if (twitterImageMatch) img = twitterImageMatch[1];
            }
        } catch (scrapeErr) {
            console.error("[AddProduct] Web scraping failed, using fallback:", scrapeErr.message);
        }

        // 2. Fetch scoped Ezone token and query variants
        console.log(`[AddProduct] Querying Ezone variants for ${id}...`);
        const ezoneToken = await ezoneClient.getScopedToken(redis);
        const variants = await ezoneClient.getVariants(ezoneToken, id);

        if (!variants || variants.length === 0) {
            throw new Error(`لم نجد أي مقاسات متوفرة للمنتج ${id} في Ezone. تأكد من صحة معرف المنتج.`);
        }

        // Calculate total stock and gather sizes list
        const totalStock = variants.reduce((sum, v) => sum + (v.quantity || 0), 0);
        const sizesList = variants.map(v => v.text.trim()).join("، ");
        const price = variants[0] ? variants[0].price : 120; // fallback price

        // 3. Resolve category name
        let resolvedCategory = "ملابس أطفال"; // default
        if (category) {
            const catLower = category.toLowerCase().trim();
            if (catLower === 'summer' || catLower.includes('صيف')) resolvedCategory = "ملابس صيفية";
            else if (catLower === 'girls' || catLower.includes('بنات')) resolvedCategory = "ملابس بناتي";
            else if (catLower === 'watches' || catLower.includes('ساع')) resolvedCategory = "الساعات";
            else resolvedCategory = category; // Custom category
        }

        // 4. Save mapping to Firebase
        console.log(`[AddProduct] Saving mapping in Firebase under ${resolvedCategory}...`);
        const firebaseToken = await getFirebaseAuthToken();
        const savePayload = {
            name: name,
            sku: String(sku).trim(),
            stock: String(totalStock),
            price: String(price),
            sizes: sizesList,
            img: img || `https://da-vinci.ezone.ly/images/products/${id}.jpg`
        };

        const dbUrl = `${FB_DB_URL}/store_master_v5/products/${resolvedCategory}/${id}.json?auth=${firebaseToken}`;
        await axios.put(dbUrl, savePayload);

        res.status(200).send(`
            <div style="font-family: 'Segoe UI', sans-serif; max-width: 500px; margin: 40px auto; padding: 30px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); direction: rtl; border-top: 5px solid #800000;">
                <h2 style="color: #800000; margin-top: 0;">✅ تم تسجيل المنتج بنجاح!</h2>
                <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                
                <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                    <tr style="border-bottom: 1px solid #f9f9f9;"><td style="padding: 10px 0; font-weight: bold; width: 120px;">اسم المنتج:</td><td>${name}</td></tr>
                    <tr style="border-bottom: 1px solid #f9f9f9;"><td style="padding: 10px 0; font-weight: bold;">الكود (SKU):</td><td style="color: #800000; font-weight: bold; font-size: 16px;">${sku}</td></tr>
                    <tr style="border-bottom: 1px solid #f9f9f9;"><td style="padding: 10px 0; font-weight: bold;">معرف Ezone:</td><td>${id}</td></tr>
                    <tr style="border-bottom: 1px solid #f9f9f9;"><td style="padding: 10px 0; font-weight: bold;">السعر:</td><td>${price} د.ل</td></tr>
                    <tr style="border-bottom: 1px solid #f9f9f9;"><td style="padding: 10px 0; font-weight: bold;">المخزون الإجمالي:</td><td>${totalStock} قطعة</td></tr>
                    <tr style="border-bottom: 1px solid #f9f9f9;"><td style="padding: 10px 0; font-weight: bold;">المقاسات المتاحة:</td><td>${sizesList}</td></tr>
                    <tr style="border-bottom: 1px solid #f9f9f9;"><td style="padding: 10px 0; font-weight: bold;">التصنيف:</td><td>${resolvedCategory}</td></tr>
                </table>
                
                ${img ? `<div style="text-align: center; margin-top: 20px;"><img src="${img}" style="max-width: 150px; border-radius: 8px; border: 1px solid #eee;"></div>` : ''}
                
                <p style="font-size: 12px; color: #666; text-align: center; margin-top: 25px;">البوت الآن يتعرف على الكود <strong>${sku}</strong> وسيوجه العملاء لحجزه مباشرة!</p>
            </div>
        `);

    } catch (err) {
        console.error("[AddProduct] Critical Error:", err.message);
        res.status(500).send(`
            <div style="font-family: sans-serif; padding: 20px; direction: rtl; text-align: center; color: #dc2626;">
                <h2>❌ فشل تسجيل المنتج</h2>
                <p>${err.message}</p>
            </div>
        `);
    }
};
