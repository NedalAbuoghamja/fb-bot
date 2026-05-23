const Redis = require('ioredis');
const ezoneClient = require('./ezone_client');
const axios = require('axios');

const REDIS_URL = process.env.REDIS_URL;
let redis = null;
if (REDIS_URL) {
    redis = new Redis(REDIS_URL);
}

async function testEndpoint(token, url) {
    try {
        console.log(`Testing URL: ${url}`);
        const res = await fetch(url, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (res.status === 200) {
            const json = await res.json();
            return { success: true, url, status: res.status, data: json };
        }
        return { success: false, url, status: res.status, error: await res.text() };
    } catch (e) {
        return { success: false, url, error: e.message };
    }
}

module.exports = async (req, res) => {
    if (!redis) {
        return res.status(500).send("Redis is not connected");
    }

    try {
        const token = await ezoneClient.getScopedToken(redis);
        const results = {};

        // Test different endpoints to discover Ezone product API structure
        results.products_default = await testEndpoint(token, "https://mapi.ezone.ly/products?PageNumber=1&PageSize=100");
        results.products_list = await testEndpoint(token, "https://mapi.ezone.ly/products/list?PageNumber=1&PageSize=100");
        results.products_search = await testEndpoint(token, "https://mapi.ezone.ly/products/search?query=48");
        results.lookup_products = await testEndpoint(token, "https://mapi.ezone.ly/lookup/products");
        results.products_all = await testEndpoint(token, "https://mapi.ezone.ly/products/all");

        res.status(200).json({
            message: "Ezone endpoints search completed",
            token_preview: token.substring(0, 15) + "...",
            results
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
