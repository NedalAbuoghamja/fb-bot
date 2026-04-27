const https = require('https');

const PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
const PAGE_ID = process.env.FB_PAGE_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "my_secret_verify_token_123";
const REPLY_MESSAGE = "تعالو وزورو رابط متجرنا https://da-vinci.ezone.ly واطلبو مباشرة منه";
const PRIVATE_MESSAGE_TEXT = "مرحباً بك! يمكنك الطلب ورؤية جميع منتجاتنا مباشرة عبر الرابط التالي: https://da-vinci.ezone.ly";

function makeRequest(path, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'graph.facebook.com',
            port: 443,
            path: `/v20.0${path}`,
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve(data);
                }
            });
        });

        req.on('error', (error) => { reject(error); });
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

export default async function handler(req, res) {
    // Webhook verification (GET request)
    if (req.method === 'GET') {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];

        if (mode && token) {
            if (mode === 'subscribe' && token === VERIFY_TOKEN) {
                console.log('WEBHOOK_VERIFIED');
                return res.status(200).send(challenge);
            } else {
                return res.status(403).send('Forbidden');
            }
        }
        return res.status(400).send('Bad Request');
    }

    // Webhook event handling (POST request)
    if (req.method === 'POST') {
        const body = req.body;

        if (body.object === 'page') {
            for (const entry of body.entry) {
                const webhookEvent = entry.changes ? entry.changes[0] : null;
                
                if (webhookEvent && webhookEvent.field === 'feed') {
                    const value = webhookEvent.value;
                    
                    if (value.item === 'comment' && value.verb === 'add') {
                        const commentId = value.comment_id;
                        const message = value.message;
                        const senderId = value.from.id;

                        if (senderId !== PAGE_ID) {
                            console.log(`Received comment from ${value.from.name}: ${message}`);

                            try {
                                const replyPath = `/${commentId}/comments?message=${encodeURIComponent(REPLY_MESSAGE)}&access_token=${PAGE_ACCESS_TOKEN}`;
                                await makeRequest(replyPath, 'POST');
                                
                                const pmPath = `/${PAGE_ID}/messages?access_token=${PAGE_ACCESS_TOKEN}`;
                                const pmBody = {
                                    recipient: { comment_id: commentId },
                                    message: { text: PRIVATE_MESSAGE_TEXT }
                                };
                                await makeRequest(pmPath, 'POST', pmBody);
                                
                            } catch (e) {
                                console.error("Error sending replies:", e);
                            }
                        }
                    }
                }
            }
            return res.status(200).send('EVENT_RECEIVED');
        } else {
            return res.status(404).send('Not Found');
        }
    }
}
