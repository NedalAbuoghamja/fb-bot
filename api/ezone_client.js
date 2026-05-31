const Redis = require('ioredis');

const EZONE_EMAIL = process.env.EZONE_EMAIL || "nedal_55555@yahoo.com";
const EZONE_PASSWORD = process.env.EZONE_PASSWORD || "1234567890";
const EZONE_SHOP_ID = parseInt(process.env.EZONE_SHOP_ID || "11977", 10);

let inMemoryToken = null;
let inMemoryExpires = 0;

// Normalize Arabic characters for matching
function normalizeArabic(text) {
    if (!text) return "";
    return text.toLowerCase()
        .replace(/(\p{L})(\p{N})/gu, '$1 $2') // letter to digit
        .replace(/(\p{N})(\p{L})/gu, '$1 $2') // digit to letter
        .replace(/[أإآ]/g, "ا")
        .replace(/ة/g, "ه")
        .replace(/ى/g, "ي")
        .replace(/[\s\-\,\.\_\/\#\(\)]+/g, " ")
        .trim();
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Headless login and select shop to get shop-scoped token
 */
async function fetchNewScopedToken() {
    try {
        console.log("[Ezone] Headless Login starting...");
        const loginRes = await fetch('https://my.ezone.ly/login', {
            method: 'POST',
            headers: {
                'next-action': '40d9e14828949c35a7c950d6aa5409a690e25394da',
                'Content-Type': 'text/plain;charset=UTF-8',
                'Accept': 'text/x-component',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            body: JSON.stringify([{ username: EZONE_EMAIL, password: EZONE_PASSWORD }])
        });

        const text = await loginRes.text();
        const match = text.match(/1:(\{.*\})/);
        if (!match) {
            throw new Error("Failed to parse Next.js login response: " + text);
        }

        const resObj = JSON.parse(match[1]);
        if (!resObj.success || !resObj.data || !resObj.data.accessToken) {
            throw new Error("Login response indicates failure: " + JSON.stringify(resObj));
        }

        const unscopedToken = resObj.data.accessToken;
        console.log("[Ezone] Unscoped token obtained. Selecting shop...");

        const selectRes = await fetch('https://my.ezone.ly/login', {
            method: 'POST',
            headers: {
                'next-action': '60ebebcdcf8f4ee64c9b95617eb70e7932d61ded20',
                'Content-Type': 'text/plain;charset=UTF-8',
                'Accept': 'text/x-component',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            body: JSON.stringify([EZONE_SHOP_ID, unscopedToken])
        });

        const selectText = await selectRes.text();
        const tokenMatch = selectText.match(/"initialSession"\s*:\s*\{\s*"accessToken"\s*:\s*"([^"]+)"/);
        if (!tokenMatch) {
            throw new Error("Failed to parse scoped token response: " + selectText);
        }

        const scopedToken = tokenMatch[1];
        console.log("[Ezone] Scoped token obtained successfully.");
        return scopedToken;
    } catch (e) {
        console.error("[Ezone] fetchNewScopedToken Error:", e.message);
        throw e;
    }
}

/**
 * Get cached or new scoped token
 */
async function getScopedToken(redis) {
    const cacheKey = "ezone_scoped_token";
    
    // 1. Try Redis cache
    if (redis) {
        try {
            const cached = await redis.get(cacheKey);
            if (cached) {
                console.log("[Ezone] Scoped token retrieved from Redis cache.");
                return cached;
            }
        } catch (e) {
            console.error("[Ezone] Redis read error:", e.message);
        }
    }

    // 2. Try In-memory cache
    if (inMemoryToken && Date.now() < inMemoryExpires) {
        console.log("[Ezone] Scoped token retrieved from in-memory cache.");
        return inMemoryToken;
    }

    // 3. Authenticate and get new token
    const scopedToken = await fetchNewScopedToken();

    // 4. Cache it
    if (redis) {
        try {
            // Cache for 12 hours
            await redis.set(cacheKey, scopedToken, 'EX', 12 * 3600);
            console.log("[Ezone] Scoped token cached in Redis.");
        } catch (e) {
            console.error("[Ezone] Redis write error:", e.message);
        }
    }

    inMemoryToken = scopedToken;
    inMemoryExpires = Date.now() + (12 * 3600 * 1000) - 300000; // 12 hours minus 5 minutes buffer
    return scopedToken;
}

/**
 * Find customer by phone number, or create if not found
 */
async function findOrCreateCustomer(token, name, phone, email) {
    try {
        console.log(`[Ezone] Searching for customer by phone: ${phone}...`);
        const searchRes = await fetch(`https://mapi.ezone.ly/customers/search?query=${phone}`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        
        if (searchRes.status === 200) {
            const searchJson = await searchRes.json();
            const items = searchJson.data && searchJson.data.items ? searchJson.data.items : [];
            const normSearchName = normalizeArabic(name);
            const exactMatch = items.find(item => {
                const matchPhone = (item.phoneNo === phone || item.phoneNo2 === phone);
                if (!matchPhone) return false;
                return normalizeArabic(item.name) === normSearchName;
            });
            if (exactMatch) {
                console.log(`[Ezone] Customer found: ID ${exactMatch.id} (Name: ${exactMatch.name})`);
                return exactMatch.id;
            }
        }

        // Customer not found, create new one
        console.log(`[Ezone] Customer not found. Creating new customer: ${name}...`);
        const nameParts = name.trim().split(/\s+/);
        let firstName = nameParts[0];
        let lastName = nameParts.slice(1).join(" ");
        if (!lastName) {
            lastName = "."; // Default lastName as required
        }

        const createRes = await fetch('https://mapi.ezone.ly/customers/new', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                firstName,
                lastName,
                phoneNo: phone,
                phoneNo2: null,
                email: email || ""
            })
        });

        if (createRes.status !== 200) {
            const errText = await createRes.text();
            throw new Error(`Failed to create customer: ${createRes.status} - ${errText}`);
        }

        const createJson = await createRes.json();
        const newCustomerId = createJson.data && createJson.data.id;
        if (!newCustomerId) {
            throw new Error("Create customer response has no ID: " + JSON.stringify(createJson));
        }

        console.log(`[Ezone] Created customer: ID ${newCustomerId}`);
        return newCustomerId;
    } catch (e) {
        console.error("[Ezone] findOrCreateCustomer Error:", e.message);
        throw e;
    }
}

/**
 * Find address matching location or create a new one
 */
async function findOrCreateAddress(token, customerId, locationLine, cityId = 1, subCityId = null) {
    try {
        console.log(`[Ezone] Querying addresses for customer ${customerId}...`);
        const listRes = await fetch(`https://mapi.ezone.ly/customers/${customerId}/address/list?PageNumber=1&PageSize=10`, {
            headers: { "Authorization": `Bearer ${token}` }
        });

        const cleanLine = locationLine.trim();
        const normLine = normalizeArabic(cleanLine);

        if (listRes.status === 200) {
            const listJson = await listRes.json();
            const items = listJson.data && listJson.data.items ? listJson.data.items : [];
            const exactMatch = items.find(addr => normalizeArabic(addr.addressLine) === normLine);
            if (exactMatch) {
                console.log(`[Ezone] Address matches existing address: ID ${exactMatch.id}`);
                return exactMatch.id;
            }
        }

        // Address not found or query failed, create new address
        console.log(`[Ezone] Creating new address: "${cleanLine}" (City: ${cityId}, Sub-city: ${subCityId})...`);
        const createRes = await fetch(`https://mapi.ezone.ly/customers/${customerId}/address/new`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                customerId: customerId,
                cityId: cityId,
                subCityId: subCityId,
                addressLine: cleanLine
            })
        });

        if (createRes.status !== 200) {
            const errText = await createRes.text();
            throw new Error(`Failed to create address: ${createRes.status} - ${errText}`);
        }

        const createJson = await createRes.json();
        const newAddressId = createJson.data && createJson.data.id;
        if (!newAddressId) {
            throw new Error("Create address response has no ID: " + JSON.stringify(createJson));
        }

        console.log(`[Ezone] Created address: ID ${newAddressId}`);
        return newAddressId;
    } catch (e) {
        console.error("[Ezone] findOrCreateAddress Error:", e.message);
        throw e;
    }
}

/**
 * Resolves cityId and subCityId based on text description of location and landmark
 */
async function resolveCityAndSubCity(token, location, landmark) {
    let cityId = 1; // Default: طرابلس
    let subCityId = null; 

    try {
        const combinedText = `${location || ""} ${landmark || ""}`;
        const normText = normalizeArabic(combinedText);

        // 1. Fetch cities
        console.log("[Ezone] Resolving city ID from Ezone settings...");
        const citiesRes = await fetch("https://mapi.ezone.ly/lookup/countries/1/cities", {
            headers: { "Authorization": `Bearer ${token}` }
        });
        
        if (citiesRes.status === 200) {
            const citiesJson = await citiesRes.json();
            const cities = citiesJson.data || [];
            
            for (const city of cities) {
                const normCity = normalizeArabic(city.text);
                const regex = new RegExp(`(?:^|\\s)${escapeRegExp(normCity)}(?:$|\\s)`, "i");
                if (regex.test(normText)) {
                    cityId = city.id;
                    console.log(`[Ezone] Matched City: ${city.text} (ID: ${cityId})`);
                    break;
                }
            }
        }

        // 2. Fetch subcities for the matched city
        console.log(`[Ezone] Resolving sub-city ID for city ID ${cityId}...`);
        const subRes = await fetch(`https://mapi.ezone.ly/lookup/cities/${cityId}/subcities`, {
            headers: { "Authorization": `Bearer ${token}` }
        });

        if (subRes.status === 200) {
            const subJson = await subRes.json();
            const subcities = subJson.data || [];
            
            const sortedSubs = [...subcities].sort((a, b) => b.text.length - a.text.length);

            for (const sub of sortedSubs) {
                const normSub = normalizeArabic(sub.text);
                const regex = new RegExp(`(?:^|\\s)${escapeRegExp(normSub)}(?:$|\\s)`, "i");
                if (regex.test(normText)) {
                    subCityId = sub.id;
                    console.log(`[Ezone] Matched Sub-city: ${sub.text} (ID: ${subCityId})`);
                    break;
                }
            }
        }
    } catch (e) {
        console.error("[Ezone] resolveCityAndSubCity Error:", e.message);
    }

    return { cityId, subCityId };
}

/**
 * Fetch variants dropdown for a product
 */
async function getVariants(token, productId) {
    try {
        console.log(`[Ezone] Querying variants for product: ${productId}...`);
        const res = await fetch(`https://mapi.ezone.ly/product/${productId}/variants/dropdown`, {
            headers: { "Authorization": `Bearer ${token}` }
        });

        if (res.status !== 200) {
            const errText = await res.text();
            throw new Error(`Failed to fetch variants: ${res.status} - ${errText}`);
        }

        const json = await res.json();
        return json.data || [];
    } catch (e) {
        console.error("[Ezone] getVariants Error:", e.message);
        throw e;
    }
}

/**
 * Match variant based on customer notes/messages
 */
function matchVariant(variants, notes, message) {
    if (!variants || variants.length === 0) return null;

    const combinedText = ((notes || "") + " " + (message || "")).trim();
    // Strip phone numbers to prevent digit mismatches
    const cleanedText = combinedText.replace(/09[1245]\d{7}/g, '').replace(/\+?218\d+/g, '');
    const normText = normalizeArabic(cleanedText);

    let bestVariant = null;
    let maxScore = -1;

    const wordMappings = {
        "1": ["1", "سنه", "سنة", "عام", "واحد"],
        "2": ["2", "سنتين", "سنتان", "اثنين", "تنين"],
        "3": ["3", "ثلاث", "تلات", "تلاتة", "ثلاثة"],
        "4": ["4", "اربع", "أربع", "اربعه", "أربعة"],
        "5": ["5", "خمس", "خمسه", "خمسة"],
        "6": ["6", "ست", "سته", "ستة"],
        "7": ["7", "سبع", "سبعه", "سبعة"],
        "8": ["8", "ثمان", "تمان", "ثمانيه", "تمانية"],
        "9": ["9", "تسع", "تسعه", "تسعة"],
        "10": ["10", "عشر", "عشره", "عشرة"]
    };

    for (const v of variants) {
        let score = 0;
        const vNorm = normalizeArabic(v.text);

        // 1. Whole-word match
        const escapedV = escapeRegExp(vNorm);
        const wordRegex = new RegExp(`(?:^|\\s)${escapedV}(?:$|\\s)`, "i");
        if (wordRegex.test(normText)) {
            score += 20;
        }

        // 2. Keyword/digit-based matches
        const digitMatch = v.text.match(/\d+/);
        if (digitMatch) {
            const digit = digitMatch[0];
            const keywords = wordMappings[digit] || [digit];
            
            for (const kw of keywords) {
                const normKw = normalizeArabic(kw);
                const regex = new RegExp(`(?:^|\\s)${escapeRegExp(normKw)}(?:$|\\s)`, "i");
                if (regex.test(normText)) {
                    score += 10;
                }
            }
        }

        if (score > maxScore) {
            maxScore = score;
            bestVariant = v;
        }
    }

    if (maxScore <= 0) {
        console.log("[Ezone] No keyword match found. Picking first in-stock variant fallback.");
        const withStock = variants.find(v => v.quantity > 0);
        bestVariant = withStock || variants[0];
    }

    return bestVariant;
}

/**
 * Match multiple variants and allocate quantities based on customer notes/messages
 */
function matchMultipleVariants(variants, notes, message, requestedQty) {
    if (!variants || variants.length === 0) {
        return { allocated: [], error: null };
    }

    const combinedText = ((notes || "") + " " + (message || "")).trim();
    const cleanedText = combinedText.replace(/09[1245]\d{7}/g, '').replace(/\+?218\d+/g, '');
    const normText = normalizeArabic(cleanedText);

    const matches = [];
    const wordMappings = {
        "1": ["1", "سنه", "سنة", "عام", "واحد"],
        "2": ["2", "سنتين", "سنتان", "اثنين", "تنين"],
        "3": ["3", "ثلاث", "تلات", "تلاتة", "ثلاثة"],
        "4": ["4", "اربع", "أربع", "اربعه", "أربعة"],
        "5": ["5", "خمس", "خمسه", "خمسة"],
        "6": ["6", "ست", "سته", "ستة"],
        "7": ["7", "سبع", "سبعه", "سبعة"],
        "8": ["8", "ثمان", "تمان", "ثمانيه", "تمانية"],
        "9": ["9", "تسع", "تسعه", "تسعة"],
        "10": ["10", "عشر", "عشره", "عشرة"]
    };

    for (const v of variants) {
        let score = 0;
        const vNorm = normalizeArabic(v.text);

        // 1. Whole-word match
        const escapedV = escapeRegExp(vNorm);
        const wordRegex = new RegExp(`(?:^|\\s)${escapedV}(?:$|\\s)`, "i");
        if (wordRegex.test(normText)) {
            score += 20;
        }

        // 2. Keyword/digit-based matches
        const digitMatch = v.text.match(/\d+/);
        if (digitMatch) {
            const digit = digitMatch[0];
            const keywords = wordMappings[digit] || [digit];
            
            for (const kw of keywords) {
                const normKw = normalizeArabic(kw);
                const kwRegex = new RegExp(`(?:^|\\s)${escapeRegExp(normKw)}(?:$|\\s)`, "i");
                if (kwRegex.test(normText)) {
                    score += 10;
                }
            }
        }

        if (score > 0) {
            matches.push({ variant: v, score });
        }
    }

    // Sort matches by score descending
    matches.sort((a, b) => b.score - a.score);

    // If no explicit matches, use fallback (first in-stock variant)
    if (matches.length === 0) {
        const withStock = variants.find(v => v.quantity > 0) || variants[0];
        if (!withStock || withStock.quantity <= 0) {
            return {
                allocated: [],
                error: `❌ عذراً، هذا المنتج نفد من المخزون بالكامل ولا يمكن حجزه حالياً.`
            };
        }
        
        if (withStock.quantity < requestedQty) {
            return {
                allocated: [],
                error: `❌ عذراً، الكمية المطلوبة غير متوفرة. المتوفر في المخزون حالياً هو ${withStock.quantity} فقط.`
            };
        }

        return {
            allocated: [{ variant: withStock, quantity: requestedQty }],
            error: null
        };
    }

    // Validation 1: User requested fewer items than the matched sizes/variants
    if (matches.length > requestedQty) {
        const matchedNames = matches.map(m => m.variant.text.trim()).join(" و ");
        return {
            allocated: [],
            error: `⚠️ لقد حددت الكمية (${requestedQty}) ولكنك اخترت مقاسات أكثر (${matchedNames}). يرجى الحجز من جديد وتحديد الكمية الصحيحة لتطابق عدد المقاسات.`
        };
    }

    // Validation 2: Check if any explicitly matched variant is completely out of stock
    for (const m of matches) {
        if (m.variant.quantity <= 0) {
            return {
                allocated: [],
                error: `❌ عذراً، خيار/مقاس "${m.variant.text.trim()}" نفد من المخزون حالياً. يرجى اختيار مقاس آخر متوفر.`
            };
        }
    }

    // Allocate quantities
    const allocated = [];
    let remaining = requestedQty;
    const allocMap = new Map();

    for (const m of matches) {
        allocMap.set(m.variant.variantId, { variant: m.variant, quantity: 0 });
    }

    // Loop 1: Give 1 to each match
    for (const m of matches) {
        if (remaining > 0) {
            allocMap.get(m.variant.variantId).quantity += 1;
            remaining -= 1;
        }
    }

    // Loop 2: Distribute remaining quantity up to stock capacity
    if (remaining > 0) {
        for (const m of matches) {
            const currentAlloc = allocMap.get(m.variant.variantId);
            const availableSpace = m.variant.quantity - currentAlloc.quantity;
            if (availableSpace > 0 && remaining > 0) {
                const toAdd = Math.min(availableSpace, remaining);
                currentAlloc.quantity += toAdd;
                remaining -= toAdd;
            }
        }
    }

    // Validation 3: If there is still remaining quantity, it means stock is insufficient
    if (remaining > 0) {
        const matchedNames = matches.map(m => `${m.variant.text.trim()} (المتوفر: ${m.variant.quantity})`).join("، ");
        return {
            allocated: [],
            error: `❌ عذراً، الكمية المطلوبة غير متوفرة بالكامل في المقاسات المحددة. المتوفر حالياً: ${matchedNames}.`
        };
    }

    // Convert map to array of non-zero allocations
    for (const item of allocMap.values()) {
        if (item.quantity > 0) {
            allocated.push(item);
        }
    }

    return { allocated, error: null };
}

/**
 * Place the order on Ezone
 */
async function placeOrder(token, customerId, addressId, productId, variantId, quantity = 1) {
    try {
        let items = [];
        if (Array.isArray(productId)) {
            items = productId;
            console.log(`[Ezone] Submitting order for customer ${customerId}, address ${addressId} with ${items.length} items...`);
        } else {
            console.log(`[Ezone] Submitting order for customer ${customerId}, address ${addressId}, product ${productId}, variant ${variantId}...`);
            items = [
                {
                    productId: parseInt(productId, 10),
                    variantId: parseInt(variantId, 10),
                    quantity: quantity
                }
            ];
        }

        const payload = {
            customerId: customerId,
            addressId: addressId,
            paymentType: 1, // Cash on Delivery
            items: items.map(item => ({
                productId: parseInt(item.productId, 10),
                variantId: parseInt(item.variantId, 10),
                quantity: parseInt(item.quantity, 10)
            }))
        };

        const res = await fetch('https://mapi.ezone.ly/orders/new', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (res.status !== 200) {
            const errText = await res.text();
            throw new Error(`Failed to place order: ${res.status} - ${errText}`);
        }

        const json = await res.json();
        const orderId = json.data && json.data.orderId;
        if (!orderId) {
            throw new Error("Place order response has no orderId: " + JSON.stringify(json));
        }

        console.log(`[Ezone] Order placed successfully! Order ID: ${orderId}`);
        return orderId;
    } catch (e) {
        console.error("[Ezone] placeOrder Error:", e.message);
        throw e;
    }
}

module.exports = {
    getScopedToken,
    findOrCreateCustomer,
    findOrCreateAddress,
    resolveCityAndSubCity,
    getVariants,
    matchVariant,
    matchMultipleVariants,
    placeOrder,
    normalizeArabic
};
