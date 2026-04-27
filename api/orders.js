const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL;
let redis;
if (REDIS_URL) {
    redis = new Redis(REDIS_URL);
}

module.exports = async (req, res) => {
    if (!redis) {
        return res.status(500).send("قاعدة البيانات غير متصلة");
    }

    // جلب جميع مفاتيح الطلبات
    const keys = await redis.keys('final_order:*');
    
    let ordersHTML = '';
    
    if (keys.length === 0) {
        ordersHTML = `<tr><td colspan="5" style="text-align: center; padding: 20px;">لا توجد طلبات حجز حالياً</td></tr>`;
    } else {
        // جلب تفاصيل كل طلب
        for (const key of keys) {
            const dataStr = await redis.get(key);
            if (dataStr) {
                const order = JSON.parse(dataStr);
                const dateObj = new Date(order.date);
                const dateStr = dateObj.toLocaleDateString('ar-LY') + ' ' + dateObj.toLocaleTimeString('ar-LY');
                
                ordersHTML += `
                <tr>
                    <td>${order.name || '-'}</td>
                    <td><a href="tel:${order.phone || ''}" style="color: #2563eb;">${order.phone || '-'}</a></td>
                    <td>${order.details || '-'}</td>
                    <td>${order.location || '-'}</td>
                    <td>${dateStr}</td>
                </tr>`;
            }
        }
    }

    const html = `
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>طلبات متجر دافينشي - DaVinci</title>
        <style>
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background-color: #f3f4f6;
                margin: 0;
                padding: 20px;
                color: #1f2937;
            }
            .container {
                max-width: 1000px;
                margin: 0 auto;
                background-color: white;
                border-radius: 10px;
                box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
                overflow: hidden;
            }
            .header {
                background-color: #111827;
                color: white;
                padding: 20px;
                text-align: center;
            }
            .header h1 {
                margin: 0;
                font-size: 24px;
            }
            .table-container {
                padding: 20px;
                overflow-x: auto;
            }
            table {
                width: 100%;
                border-collapse: collapse;
                text-align: right;
            }
            th, td {
                padding: 12px 15px;
                border-bottom: 1px solid #e5e7eb;
            }
            th {
                background-color: #f9fafb;
                font-weight: 600;
                color: #4b5563;
            }
            tr:hover {
                background-color: #f9fafb;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>📦 لوحة تحكم حجوزات DaVinci Store</h1>
            </div>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>الاسم الثلاثي</th>
                            <th>رقم الهاتف</th>
                            <th>كود المنتج والتفاصيل</th>
                            <th>العنوان بالكامل</th>
                            <th>وقت الحجز</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${ordersHTML}
                    </tbody>
                </table>
            </div>
        </div>
    </body>
    </html>
    `;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
};
