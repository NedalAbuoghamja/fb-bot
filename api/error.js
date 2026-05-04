const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL;
let redis;
if (REDIS_URL) {
    redis = new Redis(REDIS_URL);
}

module.exports = async (req, res) => {
    if (!redis) return res.status(500).send("No redis");
    const keys = await redis.keys('debug_error:*');
    const errors = {};
    for (const key of keys) {
        const val = await redis.get(key);
        errors[key] = val;
    }
    res.status(200).json({ errors });
};
