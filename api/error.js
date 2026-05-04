const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL;
let redis;
if (REDIS_URL) {
    redis = new Redis(REDIS_URL);
}

module.exports = async (req, res) => {
    if (!redis) return res.status(500).send("No redis");
    const err = await redis.get('debug_error:last_fb_api');
    res.status(200).json({ error: err ? JSON.parse(err) : null });
};
