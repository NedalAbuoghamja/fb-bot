const Redis = require('ioredis');
const ezoneClient = require('./ezone_client');
const axios = require('axios');

const REDIS_URL = process.env.REDIS_URL;
let redis = null;
if (REDIS_URL) {
    redis = new Redis(REDIS_URL);
}

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || "EAAR90m9nfb4BRVbicflguLQadazJxXTfgrxyhnIXcPqJzF8YIsxvJGoQlo3niCQMNrk2ZAEJlrderf17cRDuiIVZAhh5pK8ZCd6KXfipFz8U8ZAzzRoLXLZBQXIsS4GZB8TFSvuxPTZB8TcGNQdpdY34o2KYrmHZA56tavAMZCHKYuk3qFGAJAmzM8zNfNKrWe36HnzIlXCxNle8RXKpK3wsPEimp";
const FB_PAGE_ID = process.env.FB_PAGE_ID || "110508451733432";
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
                <code>/api/create-fb-post?id=71740&sku=34</code>
            </div>
        `);
    }

    if (!redis) {
        return res.status(500).send("Redis disconnected");
    }

    try {
        // 1. Scrape product storefront page for Name & Image
        console.log(`[FBPost] Scraping storefront details for Ezone product ${id}...`);
        const storeUrl = `https://da-vinci.ezone.ly/products/${id}`;
        let name = "منتج دافينشي الجديد";
        let img = "";

        try {
            const htmlRes = await axios.get(storeUrl, { timeout: 8000 });
            const html = htmlRes.data;

            const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
            if (titleMatch) {
                name = titleMatch[1].split('-')[0].split('|')[0].trim();
            }

            const ogImageMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
            if (ogImageMatch) {
                img = ogImageMatch[1];
            } else {
                const twitterImageMatch = html.match(/<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i);
                if (twitterImageMatch) img = twitterImageMatch[1];
            }
        } catch (scrapeErr) {
            console.error("[FBPost] Web scraping failed, using fallback:", scrapeErr.message);
        }

        const productImg = img || `https://da-vinci.ezone.ly/images/products/${id}.jpg`;

        // 2. Fetch Ezone variants (stock & price)
        console.log(`[FBPost] Querying Ezone variants for ${id}...`);
        const ezoneToken = await ezoneClient.getScopedToken(redis);
        const variants = await ezoneClient.getVariants(ezoneToken, id);

        if (!variants || variants.length === 0) {
            throw new Error(`لم نجد أي مقاسات متوفرة للمنتج ${id} في Ezone.`);
        }

        const totalStock = variants.reduce((sum, v) => sum + (v.quantity || 0), 0);
        const sizesList = variants.map(v => v.text.trim()).join("، ");
        const price = variants[0] ? variants[0].price : 120;

        // 3. Resolve category name & Save to Firebase
        let resolvedCategory = "ملابس أطفال";
        if (category) {
            const catLower = category.toLowerCase().trim();
            if (catLower === 'summer' || catLower.includes('صيف')) resolvedCategory = "ملابس صيفية";
            else if (catLower === 'girls' || catLower.includes('بنات')) resolvedCategory = "ملابس بناتي";
            else if (catLower === 'watches' || catLower.includes('ساع')) resolvedCategory = "الساعات";
            else resolvedCategory = category;
        }

        console.log(`[FBPost] Saving mapping in Firebase...`);
        const firebaseToken = await getFirebaseAuthToken();
        const savePayload = {
            name: name,
            sku: String(sku).trim(),
            stock: String(totalStock),
            price: String(price),
            sizes: sizesList,
            img: productImg
        };

        const dbUrl = `${FB_DB_URL}/store_master_v5/products/${resolvedCategory}/${id}.json?auth=${firebaseToken}`;
        await axios.put(dbUrl, savePayload);

        // 4. Construct promotional caption in Arabic
        const captionText = 
`🌸 ${name} 🌸

طقم صيفي ولادي كاجوال جديد ومميز متوفر الآن لدى DaVinci Store! ✨
تصميم أنيق وجودة عالية وخامة مريحة جداً لأطفالكم 🥰

💰 السعر: ${price} د.ل
📏 المقاسات المتوفرة: ${sizesList}

🔢 كود المنتج للحجز: ${sku}

📝 للحجز التلقائي والسريع:
👈 علّق بكتابة كلمة "حجز" على هذا المنشور أو أرسلها لنا في الخاص وسيتواصل معك البوت فوراً لإتمام طلبك! 🌹`;

        // 5. Publish to Facebook Page as a Photo Post
        console.log(`[FBPost] Publishing photo post to Facebook page ${FB_PAGE_ID}...`);
        const fbPublishUrl = `https://graph.facebook.com/v21.0/${FB_PAGE_ID}/photos`;
        
        const fbRes = await axios.post(fbPublishUrl, {
            url: productImg,
            caption: captionText,
            access_token: PAGE_ACCESS_TOKEN
        });

        const fbPostId = fbRes.data.id || fbRes.data.post_id;
        
        // 6. Update Facebook Post ID in Firebase product mapping
        if (fbPostId) {
            console.log(`[FBPost] Published successfully! Post ID: ${fbPostId}. Updating Firebase...`);
            const updateUrl = `${FB_DB_URL}/store_master_v5/products/${resolvedCategory}/${id}/fb_post_id.json?auth=${firebaseToken}`;
            // Facebook photo post ID is returned as photo_id, but the feed post ID is PAGEID_POSTID
            const formattedPostId = `${FB_PAGE_ID}_${fbPostId}`;
            await axios.put(updateUrl, JSON.stringify(formattedPostId));
        }

        res.status(200).send(`
            <div style="font-family: 'Segoe UI', sans-serif; max-width: 550px; margin: 40px auto; padding: 35px; border-radius: 16px; box-shadow: 0 4px 25px rgba(0,0,0,0.06); direction: rtl; border-top: 6px solid #800000; background-color: #fdfcfb;">
                <h2 style="color: #800000; margin-top: 0; text-align: center;">🎉 تم النشر والتفعيل بنجاح!</h2>
                <p style="text-align: center; color: #666; font-size: 14px;">تم تسجيل المنتج في Firebase ونشره كمنشور جديد على صفحة الفيسبوك.</p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 25px 0;">
                
                <h3 style="color: #c5a880; font-size: 16px;">📋 تفاصيل المنشور المنشور:</h3>
                <div style="background-color: #faf8f5; padding: 15px; border-radius: 8px; border-right: 4px solid #c5a880; font-size: 13px; line-height: 1.6; white-space: pre-wrap; color: #444;">${captionText}</div>
                
                <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-top: 25px;">
                    <tr style="border-bottom: 1px solid #eee;"><td style="padding: 10px 0; font-weight: bold; width: 150px;">معرف المنشور (FB Post ID):</td><td style="font-family: monospace;">${fbPostId || 'تحديث ناجح'}</td></tr>
                    <tr style="border-bottom: 1px solid #eee;"><td style="padding: 10px 0; font-weight: bold;">الرمز الترويجي (SKU):</td><td style="color: #800000; font-weight: bold;">${sku}</td></tr>
                    <tr style="border-bottom: 1px solid #eee;"><td style="padding: 10px 0; font-weight: bold;">معرف المنتج Ezone:</td><td>${id}</td></tr>
                </table>
                
                <div style="text-align: center; margin-top: 25px;"><img src="${productImg}" style="max-width: 200px; border-radius: 8px; border: 1px solid #eee; box-shadow: 0 4px 10px rgba(0,0,0,0.05);"></div>
                
                <p style="font-size: 13px; color: #16a34a; text-align: center; margin-top: 30px; font-weight: bold;">البوت جاهز تماماً الآن للرد التلقائي على التعليقات أو الرسائل الخاصة بهذا المنتج! 🚀</p>
            </div>
        `);

    } catch (err) {
        console.error("[FBPost] Critical Error:", err.response ? err.response.data : err.message);
        res.status(500).send(`
            <div style="font-family: sans-serif; padding: 20px; direction: rtl; text-align: center; color: #dc2626;">
                <h2>❌ فشل النشر أو التسجيل</h2>
                <p>${err.message}</p>
                <div style="font-size: 12px; margin-top: 15px; text-align: left; background: #fee2e2; padding: 10px; border-radius: 5px; font-family: monospace;">${JSON.stringify(err.response ? err.response.data : err.message)}</div>
            </div>
        `);
    }
};
