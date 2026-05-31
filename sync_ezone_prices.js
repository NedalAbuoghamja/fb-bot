const axios = require('axios');
const Redis = require('ioredis');
const ezoneClient = require('./api/ezone_client');

const REDIS_URL = "redis://default:YaafRSQn1HDAKT9jMluNTBr1GmCGxpcC@redis-13073.c11.us-east-1-2.ec2.cloud.redislabs.com:13073";
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

async function run() {
    const redis = new Redis(REDIS_URL);
    try {
        console.log("Fetching Firebase token...");
        const fbToken = await getFirebaseAuthToken();
        
        console.log("Fetching products from Firebase...");
        const fbRes = await axios.get(`${FB_DB_URL}/store_master_v5/products.json?auth=${fbToken}`);
        const categories = fbRes.data || {};
        
        console.log("Fetching Ezone token...");
        const ezoneToken = await ezoneClient.getScopedToken(redis);
        
        console.log("Fetching active product list from Ezone...");
        const listRes = await axios.get("https://mapi.ezone.ly/product/list?PageNumber=1&PageSize=100", {
            headers: { "Authorization": `Bearer ${ezoneToken}` }
        });
        const allEzoneProducts = listRes.data.data ? (listRes.data.data.items || []) : [];
        console.log(`Retrieved ${allEzoneProducts.length} total products from Ezone.`);
        
        // Filter Ezone active products (status === 2 / "معروض")
        const activeEzoneProducts = allEzoneProducts.filter(p => p.status === 2);
        console.log(`Active (معروض) products count: ${activeEzoneProducts.length}`);
        
        const activeEzoneMap = new Map();
        activeEzoneProducts.forEach(p => activeEzoneMap.set(String(p.id), p));
        
        // Map to keep track of product categories in Firebase
        const productFirebaseCategory = new Map();
        for (const catName in categories) {
            for (const prodKey in categories[catName]) {
                productFirebaseCategory.set(String(prodKey), catName);
            }
        }
        
        // 1. Delete hidden/inactive products from Firebase
        console.log("\nChecking for hidden/inactive products to delete from Firebase...");
        for (const catName in categories) {
            // Skip "الساعات" category completely (demo watches)
            if (catName === "الساعات") continue;
            
            for (const prodId in categories[catName]) {
                if (!/^\d+$/.test(prodId)) continue; // skip non-numeric keys
                
                if (!activeEzoneMap.has(String(prodId))) {
                    console.log(`Product ID ${prodId} (SKU: ${categories[catName][prodId].sku}, Name: ${categories[catName][prodId].name}) is NOT active. Deleting from Firebase...`);
                    await axios.delete(`${FB_DB_URL}/store_master_v5/products/${catName}/${prodId}.json?auth=${fbToken}`);
                    console.log(`Successfully deleted ID ${prodId} from Firebase.`);
                }
            }
        }
        
        // 2. Synchronize active products
        console.log("\nSynchronizing active products to Firebase...");
        for (const ezoneProd of activeEzoneProducts) {
            const productId = String(ezoneProd.id);
            const sku = ezoneProd.sku;
            const name = ezoneProd.name;
            const price = ezoneProd.salePrice;
            
            console.log(`\nProcessing active product ID: ${productId} | SKU: ${sku} | Name: ${name} | Price: ${price}`);
            
            // Fetch variants details to get sizes and stock
            let totalStock = 0;
            let sizesList = "عام";
            try {
                const variants = await ezoneClient.getVariants(ezoneToken, productId);
                totalStock = variants.reduce((sum, v) => sum + (v.quantity || 0), 0);
                const sizes = variants.map(v => v.text.trim());
                if (sizes.length > 0) {
                    sizesList = sizes.join(", ");
                }
            } catch (err) {
                console.warn(`Failed to fetch variants for product ${productId}:`, err.message);
                totalStock = ezoneProd.quantity || 0;
            }
            
            // Check existing category or default to "ملابس أطفال"
            let catName = productFirebaseCategory.get(productId) || "ملابس أطفال";
            
            const payload = {
                name: name,
                sku: sku,
                stock: String(totalStock),
                price: String(price), // Use Ezone's salePrice!
                sizes: sizesList,
                img: ezoneProd.coverImage || ""
            };
            
            console.log(`Saving product to Firebase under category "${catName}"...`);
            await axios.put(`${FB_DB_URL}/store_master_v5/products/${catName}/${productId}.json?auth=${fbToken}`, payload);
            console.log(`Saved SKU ${sku} price as ${price} LYD, stock: ${totalStock}`);
        }
        
        console.log("\nSynchronization completed successfully!");
    } catch (e) {
        console.error("Sync failed:", e.message);
    } finally {
        redis.disconnect();
    }
}

run();