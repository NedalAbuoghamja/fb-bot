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

    if (req.method === 'POST') {
        const { action, orderId, status, name, phone, details, location, landmark, notes } = req.body;

        if (action === 'update_status') {
            const dataStr = await redis.get(orderId);
            if (dataStr) {
                const order = JSON.parse(dataStr);
                order.status = status;
                await redis.set(orderId, JSON.stringify(order));
                return res.status(200).json({ success: true });
            }
        }

        if (action === 'delete') {
            await redis.del(orderId);
            return res.status(200).json({ success: true });
        }

        if (action === 'edit') {
            const dataStr = await redis.get(orderId);
            if (dataStr) {
                const order = JSON.parse(dataStr);
                order.name = name;
                order.phone = phone;
                order.details = details;
                order.location = location;
                order.landmark = landmark;
                order.notes = notes;
                await redis.set(orderId, JSON.stringify(order));
                return res.status(200).json({ success: true });
            }
        }

        return res.status(400).json({ error: 'Invalid action' });
    }

    const keys = await redis.keys('final_order:*');
    keys.sort((a, b) => b.split(':')[1].split('_')[0] - a.split(':')[1].split('_')[0]);

    let ordersHTML = '';
    let totalSales = 0;
    let successfulOrdersCount = 0;
    
    if (keys.length === 0) {
        ordersHTML = `<tr><td colspan="9" style="text-align: center; padding: 40px; color: #6b7280;">لا توجد طلبات حجز حالياً</td></tr>`;
    } else {
        for (const key of keys) {
            const dataStr = await redis.get(key);
            if (dataStr) {
                const order = JSON.parse(dataStr);
                const dateObj = order.date ? new Date(order.date) : new Date(parseInt(key.split(':')[1].split('_')[0]));
                const dateStr = dateObj.toLocaleDateString('ar-LY') + ' ' + dateObj.toLocaleTimeString('ar-LY');
                
                const status = order.status || 'جديد';
                let statusClass = 'status-new';
                if (status === 'في الطريق') statusClass = 'status-shipping';
                if (status === 'وصلت') statusClass = 'status-delivered';
                if (status === 'ملغي') statusClass = 'status-cancelled';

                const price = parseFloat(order.price) || 0;
                
                if (status !== 'ملغي') {
                    totalSales += price;
                    successfulOrdersCount++;
                }

                ordersHTML += `
                <tr id="row-${key.replace(/:/g, '_')}">
                    <td>
                        ${order.img ? `<img src="${order.img}" alt="product" class="order-img" onclick="window.open(this.src)">` : '<div class="no-img">❌</div>'}
                    </td>
                    <td class="font-medium">${order.name || '-'}</td>
                    <td><a href="tel:${order.phone || ''}" class="phone-link">${order.phone || '-'}</a></td>
                    <td>
                        <div style="font-size: 13px; margin-bottom: 5px;">${order.details || '-'}</div>
                    </td>
                    <td>
                        <div><strong>المدينة/المنطقة:</strong> ${order.location || '-'}</div>
                        <div style="color: #64748b; font-size: 12px; margin-top: 4px;"><strong>نقطة دالة:</strong> ${order.landmark || '-'}</div>
                    </td>
                    <td>
                        <div style="font-size: 13px; color: #475569; max-width: 150px; overflow-wrap: break-word;">${order.notes || 'لا يوجد'}</div>
                    </td>
                    <td>
                        <select class="status-select ${statusClass}" onchange="updateStatus('${key}', this.value)">
                            <option value="جديد" ${status === 'جديد' ? 'selected' : ''}>جديد 🆕</option>
                            <option value="في الطريق" ${status === 'في الطريق' ? 'selected' : ''}>في الطريق 🚚</option>
                            <option value="وصلت" ${status === 'وصلت' ? 'selected' : ''}>وصلت ✅</option>
                            <option value="ملغي" ${status === 'ملغي' ? 'selected' : ''}>ملغي ❌</option>
                        </select>
                    </td>
                    <td class="text-sm text-gray-500" style="white-space: nowrap;">${dateStr}</td>
                    <td class="actions">
                        <button onclick="editOrder('${key}', ${JSON.stringify(order).replace(/"/g, '&quot;')})" class="btn-edit">تعديل</button>
                        <button onclick="deleteOrder('${key}')" class="btn-delete">حذف</button>
                    </td>
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
        <title>إدارة حجوزات دافينشي - DaVinci</title>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600&family=Noto+Kufi+Arabic:wght@400;600;700&display=swap" rel="stylesheet">
        <style>
            :root {
                --primary: #111827;
                --accent: #2563eb;
                --success: #10b981;
                --warning: #f59e0b;
                --bg: #f8fafc;
                --card: #ffffff;
                --text: #1e293b;
            }
            body {
                font-family: 'Noto Kufi Arabic', 'Outfit', sans-serif;
                background-color: var(--bg);
                margin: 0;
                padding: 20px;
                color: var(--text);
            }
            .container {
                max-width: 1300px;
                margin: 0 auto;
                background-color: var(--card);
                border-radius: 16px;
                box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05);
                overflow: hidden;
            }
            .header {
                background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
                color: white;
                padding: 30px;
                display: flex;
                flex-direction: column;
                gap: 20px;
            }
            .header-top {
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .header h1 {
                margin: 0;
                font-size: 24px;
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .dashboard-stats {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 15px;
                margin-top: 10px;
            }
            .stat-card {
                background: rgba(255, 255, 255, 0.1);
                backdrop-filter: blur(10px);
                border: 1px solid rgba(255, 255, 255, 0.2);
                padding: 20px;
                border-radius: 12px;
                display: flex;
                flex-direction: column;
                gap: 5px;
            }
            .stat-card .label { font-size: 14px; color: #cbd5e1; }
            .stat-card .value { font-size: 28px; font-weight: 700; color: white; display: flex; align-items: baseline; gap: 5px; }
            .stat-card .value span { font-size: 16px; font-weight: 400; }
            
            .profit-control {
                display: flex;
                align-items: center;
                gap: 10px;
                background: rgba(0,0,0,0.2);
                padding: 10px 15px;
                border-radius: 8px;
                margin-top: 10px;
                width: max-content;
            }
            .profit-control input {
                width: 60px;
                padding: 5px;
                border-radius: 5px;
                border: 1px solid rgba(255,255,255,0.3);
                background: transparent;
                color: white;
                text-align: center;
                font-weight: bold;
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
            th {
                padding: 15px;
                background-color: #f1f5f9;
                font-weight: 600;
                color: #475569;
                border-bottom: 2px solid #e2e8f0;
                font-size: 14px;
            }
            td {
                padding: 15px;
                border-bottom: 1px solid #f1f5f9;
                vertical-align: middle;
            }
            tr:hover { background-color: #f8fafc; }
            .font-medium { font-weight: 600; color: #0f172a; }
            .order-img {
                width: 60px; height: 60px; object-fit: cover;
                border-radius: 8px; cursor: pointer; transition: transform 0.2s;
                border: 1px solid #e2e8f0;
            }
            .order-img:hover { transform: scale(1.1); }
            .phone-link { color: var(--accent); text-decoration: none; font-weight: 500; }
            .status-select {
                padding: 6px 12px; border-radius: 8px; border: 1px solid #e2e8f0;
                font-family: inherit; font-size: 13px; cursor: pointer; outline: none;
                transition: all 0.2s; font-weight: 600;
            }
            .status-new { background-color: #eff6ff; color: #1e40af; border-color: #bfdbfe; }
            .status-shipping { background-color: #fff7ed; color: #9a3412; border-color: #fed7aa; }
            .status-delivered { background-color: #f0fdf4; color: #166534; border-color: #bbf7d0; }
            .status-cancelled { background-color: #fef2f2; color: #991b1b; border-color: #fecaca; }
            
            .actions { display: flex; gap: 8px; flex-direction: column; }
            button {
                padding: 8px 12px; border-radius: 6px; border: none; font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.2s;
            }
            .btn-edit { background-color: #e2e8f0; color: #475569; }
            .btn-edit:hover { background-color: #cbd5e1; }
            .btn-delete { background-color: #fee2e2; color: #b91c1c; }
            .btn-delete:hover { background-color: #fecaca; }

            /* Modal Style */
            #editModal {
                display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(15, 23, 42, 0.7); backdrop-filter: blur(4px);
                justify-content: center; align-items: center; z-index: 1000;
            }
            .modal-content {
                background: white; padding: 30px; border-radius: 16px;
                width: 90%; max-width: 500px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25);
            }
            .modal-content h2 { margin-top: 0; margin-bottom: 20px; color: #0f172a; font-size: 22px; }
            .form-group { margin-bottom: 15px; }
            .form-group label { display: block; margin-bottom: 6px; font-size: 14px; color: #475569; font-weight: 600;}
            .form-group input, .form-group textarea {
                width: 100%; padding: 12px; border: 1px solid #cbd5e1; border-radius: 8px;
                box-sizing: border-box; font-family: inherit; transition: border-color 0.2s;
            }
            .form-group input:focus, .form-group textarea:focus { border-color: var(--accent); outline: none; }
            .modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 25px; }
            .btn-save { background-color: var(--accent); color: white; padding: 10px 20px; font-size: 14px; }
            .btn-cancel { background-color: #f1f5f9; color: #475569; padding: 10px 20px; font-size: 14px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="header-top">
                    <h1>📦 لوحة إدارة حجوزات DaVinci Store</h1>
                </div>
                
                <div class="dashboard-stats">
                    <div class="stat-card">
                        <div class="label">إجمالي الطلبات (الفعالة)</div>
                        <div class="value">${successfulOrdersCount} <span>طلب</span></div>
                    </div>
                    <div class="stat-card">
                        <div class="label">إجمالي المبيعات</div>
                        <div class="value" id="totalSalesVal">${totalSales.toFixed(2)} <span>د.ل</span></div>
                    </div>
                    <div class="stat-card">
                        <div class="label">صافي الأرباح المتوقعة</div>
                        <div class="value" id="totalProfitVal">0.00 <span>د.ل</span></div>
                    </div>
                </div>

                <div class="profit-control">
                    <label for="profitMargin">نسبة الربح (العمولة):</label>
                    <input type="number" id="profitMargin" value="30" min="0" max="100" oninput="calculateProfit()">
                    <span>%</span>
                </div>
            </div>
            
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>المنتج</th>
                            <th>الاسم</th>
                            <th>الهاتف</th>
                            <th>التفاصيل</th>
                            <th>العنوان والدالة</th>
                            <th>ملاحظات</th>
                            <th>الحالة</th>
                            <th>التاريخ</th>
                            <th>إجراءات</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${ordersHTML}
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Modal Edit -->
        <div id="editModal">
            <div class="modal-content">
                <h2>تعديل بيانات الحجز</h2>
                <input type="hidden" id="editOrderId">
                <div class="form-group">
                    <label>الاسم الثلاثي</label>
                    <input type="text" id="editName">
                </div>
                <div class="form-group">
                    <label>رقم الهاتف</label>
                    <input type="text" id="editPhone">
                </div>
                <div class="form-group">
                    <label>العنوان</label>
                    <input type="text" id="editLocation">
                </div>
                <div class="form-group">
                    <label>أقرب نقطة دالة</label>
                    <input type="text" id="editLandmark">
                </div>
                <div class="form-group">
                    <label>ملاحظات</label>
                    <textarea id="editNotes" rows="2"></textarea>
                </div>
                <div class="modal-actions">
                    <button class="btn-cancel" onclick="closeModal()">إلغاء</button>
                    <button class="btn-save" onclick="saveEdit()">حفظ التعديلات</button>
                </div>
            </div>
        </div>

        <script>
            const totalSales = ${totalSales};

            function calculateProfit() {
                const margin = parseFloat(document.getElementById('profitMargin').value) || 0;
                const profit = (totalSales * margin) / 100;
                document.getElementById('totalProfitVal').innerHTML = profit.toFixed(2) + ' <span>د.ل</span>';
            }

            // Calculate initially
            calculateProfit();

            async function updateStatus(orderId, newStatus) {
                const res = await fetch('/api/orders', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'update_status', orderId, status: newStatus })
                });
                if (res.ok) {
                    window.location.reload();
                } else {
                    alert('فشل في تحديث الحالة');
                }
            }

            async function deleteOrder(orderId) {
                if (!confirm('هل أنت متأكد من حذف هذا الحجز نهائياً؟')) return;
                const res = await fetch('/api/orders', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'delete', orderId })
                });
                if (res.ok) {
                    window.location.reload();
                }
            }

            function editOrder(orderId, orderData) {
                document.getElementById('editOrderId').value = orderId;
                document.getElementById('editName').value = orderData.name || '';
                document.getElementById('editPhone').value = orderData.phone || '';
                document.getElementById('editLocation').value = orderData.location || '';
                document.getElementById('editLandmark').value = orderData.landmark || '';
                document.getElementById('editNotes').value = orderData.notes || '';
                document.getElementById('editModal').style.display = 'flex';
            }

            function closeModal() {
                document.getElementById('editModal').style.display = 'none';
            }

            async function saveEdit() {
                const orderId = document.getElementById('editOrderId').value;
                const name = document.getElementById('editName').value;
                const phone = document.getElementById('editPhone').value;
                const location = document.getElementById('editLocation').value;
                const landmark = document.getElementById('editLandmark').value;
                const notes = document.getElementById('editNotes').value;
                
                // Assuming we don't allow editing product details here for simplicity
                // but we keep it intact by not overwriting them. The backend merges.

                const res = await fetch('/api/orders', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        action: 'edit', 
                        orderId, 
                        name, phone, location, landmark, notes
                    })
                });
                if (res.ok) {
                    window.location.reload();
                } else {
                    alert('فشل في حفظ التعديلات');
                }
            }
        </script>
    </body>
    </html>
    `;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
};
