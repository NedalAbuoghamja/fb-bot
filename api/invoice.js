const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL;
let redis = null;
if (REDIS_URL) {
    try {
        redis = new Redis(REDIS_URL);
    } catch (e) {
        console.error("Redis connection failed in invoice:", e.message);
    }
}

// Beautiful SVG Logo for DaVinci Store
const DAVINCI_LOGO_SVG = `
<svg width="60" height="60" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" style="display: block; margin: 0 auto;">
  <path d="M50 5C74.85 5 95 25.15 95 50C95 74.85 74.85 95 50 95C25.15 95 5 74.85 5 50C5 25.15 25.15 5 50 5Z" stroke="#800000" stroke-width="2" stroke-linecap="round"/>
  <path d="M50 12C70.99 12 88 29.01 88 50C88 71.01 70.99 88 50 88C29.01 88 12 71.01 12 50C12 29.01 29.01 12 50 12Z" stroke="#c5a880" stroke-width="1" stroke-dasharray="2 2"/>
  <text x="50" y="58" font-family="'Playfair Display', 'Times New Roman', serif" font-size="28" font-weight="bold" fill="#800000" text-anchor="middle" letter-spacing="1">D</text>
  <text x="50" y="74" font-family="'Outfit', sans-serif" font-size="8" font-weight="600" fill="#c5a880" text-anchor="middle" letter-spacing="3">EST. 2024</text>
  <path d="M42 32L50 22L58 32" stroke="#c5a880" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M45 42H55" stroke="#c5a880" stroke-width="1.5" stroke-linecap="round"/>
</svg>
`;

module.exports = async (req, res) => {
    const orderId = req.query.id || req.query.orderId;
    const isMock = req.query.mock === 'true' || orderId === 'test';

    let order = null;
    let finalOrderId = orderId || 'test_invoice_1777846163181';

    if (isMock) {
        // Mock data matching the ZEVORA receipt screenshot for design testing
        order = {
            name: "نضال",
            phone: "0914202921",
            location: "قصر بن غشير",
            landmark: "بجانب مسجد الرحمن",
            notes: "الرجاء الاتصال قبل التوصيل بنصف ساعة",
            productName: "طقم صيفي ولادي كاجوال",
            sku: "SET-016",
            details: "المنتج: طقم صيفي ولادي كاجوال (عام) | الكمية الإجمالية: 1 | السعر الإجمالي: 94.00 د.ل",
            price: 94.00,
            img: "https://da-vinci.ezone.ly/images/products/set-016.jpg",
            status: "جديد",
            date: new Date().toISOString(),
            ezoneOrderId: "1777846163181",
            payMethodType: "MIXED", // Testing mixed payment (cash + card)
            paidAdvance: 0,
            cardAmount: 50.00,
            cashAmount: 44.00,
            productTotal: 69.00,
            totalDiscount: 0,
            deliveryFee: 25,
            items: [
                {
                    variantId: "99991",
                    sizeText: "عام",
                    quantity: 1,
                    price: 69.00,
                    originalPrice: 69.00
                }
            ]
        };
    } else {
        if (!orderId) {
            return res.status(400).send(`
                <div style="font-family: sans-serif; text-align: center; padding: 50px; direction: rtl;">
                    <h2>خطأ في الطلب ❌</h2>
                    <p>يرجى تزويد رقم معرف الفاتورة في الرابط (مثال: ?id=...).</p>
                </div>
            `);
        }

        if (!redis) {
            return res.status(500).send(`
                <div style="font-family: sans-serif; text-align: center; padding: 50px; direction: rtl;">
                    <h2>خطأ فني ❌</h2>
                    <p>قاعدة البيانات غير متصلة حالياً. يرجى المحاولة لاحقاً.</p>
                </div>
            `);
        }

        try {
            // Find key in redis (handle keys with/without prefix)
            let redisKey = orderId;
            if (!orderId.startsWith('final_order:')) {
                redisKey = `final_order:${orderId}`;
            }

            const dataStr = await redis.get(redisKey);
            if (!dataStr) {
                return res.status(404).send(`
                    <div style="font-family: sans-serif; text-align: center; padding: 50px; direction: rtl;">
                        <h2>عذراً، الفاتورة غير موجودة ❌</h2>
                        <p>لم نتمكن من العثور على هذا الطلب في النظام. قد يكون تم حذفه أو انتهت صلاحيته.</p>
                    </div>
                `);
            }
            order = JSON.parse(dataStr);
            finalOrderId = redisKey.replace('final_order:', '');
        } catch (err) {
            return res.status(500).send("حدث خطأ أثناء جلب الفاتورة: " + err.message);
        }
    }

    // Process variables for displaying
    const name = order.name || 'غير محدد';
    const phone = order.phone || 'غير محدد';
    const location = order.location || 'غير محدد';
    const landmark = order.landmark || '';
    const dateVal = order.date ? new Date(order.date) : new Date();
    
    // Format date like 2026/5/23
    const formattedDate = `${dateVal.getFullYear()}/${dateVal.getMonth() + 1}/${dateVal.getDate()}`;
    
    const displayOrderId = order.ezoneOrderId ? `ORD-${order.ezoneOrderId}` : `ORD-${finalOrderId.split('_')[0] || finalOrderId}`;
    const orderSysNum = order.ezoneOrderId ? `${order.ezoneOrderId} * #` : `${finalOrderId.split('_')[0] || '1'}#`;

    // Items list parsing (with fallback to string parser for older records)
    let displayItems = [];
    if (order.items && order.items.length > 0) {
        displayItems = order.items.map(item => {
            const price = parseFloat(item.price) || parseFloat(order.productPrice) || 0;
            const originalPrice = parseFloat(item.originalPrice) || price;
            return {
                name: order.productName || 'منتج دافينشي',
                sku: order.sku || 'SKU',
                variant: `مقاس: ${item.sizeText || 'عام'}`,
                quantity: item.quantity || 1,
                price: price,
                originalPrice: originalPrice
            };
        });
    } else {
        // Fallback parser for older orders stored as simple strings
        let size = 'عام';
        if (order.details) {
            const match = order.details.match(/\(([^)]+)\)/);
            if (match) size = match[1];
        }
        
        const priceVal = parseFloat(order.price) || 0;
        const feeVal = parseFloat(order.deliveryFee) || 25;
        const basePrice = Math.max(0, priceVal - feeVal);

        displayItems.push({
            name: order.productName || 'منتج دافينشي',
            sku: order.sku || 'SKU',
            variant: `مقاس: ${size}`,
            quantity: 1,
            price: basePrice,
            originalPrice: basePrice
        });
    }

    // Financial numbers
    const deliveryFee = typeof order.deliveryFee === 'number' ? order.deliveryFee : 25;
    
    // Subtotal of products
    let subtotal = 0;
    let totalDiscount = 0;
    displayItems.forEach(item => {
        subtotal += item.price * item.quantity;
        if (item.originalPrice > item.price) {
            totalDiscount += (item.originalPrice - item.price) * item.quantity;
        }
    });

    // If subtotal is 0 (older formats), recalculate
    if (subtotal === 0) {
        subtotal = (parseFloat(order.price) || 0) - deliveryFee;
    }
    if (totalDiscount === 0 && order.totalDiscount) {
        totalDiscount = order.totalDiscount;
    }

    const finalTotal = subtotal + deliveryFee - totalDiscount;

    // Payment breakdowns based on payMethodType
    const payType = order.payMethodType || 'CASH';
    let paymentBreakdownHTML = '';
    
    if (payType === 'CASH') {
        paymentBreakdownHTML = `
            <div class="summary-row">
                <span class="summary-label">طريقة الدفع:</span>
                <span class="summary-val font-bold">كاش عند الاستلام 💵</span>
            </div>
            <div class="summary-row text-highlight">
                <span class="summary-label">المطلوب عند الاستلام:</span>
                <span class="summary-val font-bold">${finalTotal.toFixed(2)} د.ل</span>
            </div>
        `;
    } else if (payType === 'CARD' || payType === 'TRANSFER') {
        const methodLabel = payType === 'CARD' ? 'بطاقة مصرفية 💳' : 'حوالة مصرفية 📲';
        const paid = order.paidAdvance || 0;
        const remaining = Math.max(0, finalTotal - paid);
        paymentBreakdownHTML = `
            <div class="summary-row">
                <span class="summary-label">طريقة الدفع:</span>
                <span class="summary-val font-bold">${methodLabel}</span>
            </div>
            <div class="summary-row">
                <span class="summary-label">المدفوع مقدماً:</span>
                <span class="summary-val font-bold text-success">-${paid.toFixed(2)} د.ل</span>
            </div>
            <div class="summary-row text-highlight">
                <span class="summary-label">المتبقي عند الاستلام:</span>
                <span class="summary-val font-bold">${remaining.toFixed(2)} د.ل</span>
            </div>
            <div class="payment-note">
                💡 تشمل القيمة المتبقية رسوم التوصيل (${deliveryFee} د.ل) تُدفع كاش للمندوب.
            </div>
        `;
    } else if (payType === 'MIXED') {
        const cardPart = order.cardAmount || 0;
        const cashPart = Math.max(0, finalTotal - cardPart);
        paymentBreakdownHTML = `
            <div class="summary-row">
                <span class="summary-label">طريقة الدفع:</span>
                <span class="summary-val font-bold">دفع مختلط (كاش + بطاقة) 🔄</span>
            </div>
            <div class="summary-row">
                <span class="summary-label">المدفوع بالبطاقة (مقدماً):</span>
                <span class="summary-val font-bold text-success">-${cardPart.toFixed(2)} د.ل</span>
            </div>
            <div class="summary-row text-highlight">
                <span class="summary-label">المتبقي كاش للمندوب:</span>
                <span class="summary-val font-bold">${cashPart.toFixed(2)} د.ل</span>
            </div>
            <div class="payment-note">
                💡 تشمل القيمة المتبقية رسوم التوصيل (${deliveryFee} د.ل) تُدفع كاش للمندوب.
            </div>
        `;
    } else if (payType === 'ADVANCE') {
        const paid = order.paidAdvance || 0;
        const remaining = Math.max(0, finalTotal - paid);
        paymentBreakdownHTML = `
            <div class="summary-row">
                <span class="summary-label">طريقة الدفع:</span>
                <span class="summary-val font-bold">عربون مقدماً 💸</span>
            </div>
            <div class="summary-row">
                <span class="summary-label">قيمة العربون المدفوع:</span>
                <span class="summary-val font-bold text-success">-${paid.toFixed(2)} د.ل</span>
            </div>
            <div class="summary-row text-highlight">
                <span class="summary-label">المتبقي عند الاستلام:</span>
                <span class="summary-val font-bold">${remaining.toFixed(2)} د.ل</span>
            </div>
            <div class="payment-note">
                💡 تشمل القيمة المتبقية رسوم التوصيل (${deliveryFee} د.ل) تُدفع كاش للمندوب.
            </div>
        `;
    }

    // HTML Output matching the ZEVORA receipt screenshot exactly
    const html = `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>فاتورة حجز - DaVinci Store</title>
    
    <!-- Premium Fonts -->
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&family=Noto+Kufi+Arabic:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,600;1,600&display=swap" rel="stylesheet">
    
    <style>
        :root {
            --primary-burgundy: #800000;
            --accent-gold: #c5a880;
            --text-dark: #1c1917;
            --bg-cream: #fdfcfb;
            --card-gray: #FAF7F2;
            --border-light: #e5e5e0;
        }

        body {
            font-family: 'Noto Kufi Arabic', sans-serif;
            background-color: #f5f5f3;
            margin: 0;
            padding: 15px;
            color: var(--text-dark);
            display: flex;
            justify-content: center;
            align-items: flex-start;
            min-height: 100vh;
        }

        /* Mobile Container Card */
        .invoice-card {
            width: 100%;
            max-width: 440px;
            background-color: var(--bg-cream);
            border-radius: 16px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.08);
            padding: 24px 20px;
            box-sizing: border-box;
            border: 1px solid var(--border-light);
        }

        /* Header Logo Section */
        .header-section {
            text-align: center;
            margin-bottom: 5px;
        }
        
        .brand-subtitle {
            color: var(--accent-gold);
            font-family: 'Outfit', sans-serif;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 2.5px;
            margin-top: 10px;
            margin-bottom: 0;
        }

        .gold-divider {
            height: 4px;
            background-color: var(--accent-gold);
            border: none;
            margin: 14px 0 20px 0;
            border-radius: 2px;
        }

        /* Title & Confirmation */
        .title-block {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }

        .badge-confirmed {
            background-color: var(--primary-burgundy);
            color: #ffffff;
            font-family: 'Outfit', sans-serif;
            font-size: 10px;
            font-weight: 700;
            padding: 7px 11px;
            border-radius: 5px;
            letter-spacing: 0.5px;
            display: inline-block;
        }

        .title-meta {
            text-align: left;
        }

        .invoice-title {
            font-family: 'Noto Kufi Arabic', sans-serif;
            font-size: 20px;
            font-weight: 700;
            color: var(--primary-burgundy);
            margin: 0;
        }

        .invoice-number-date {
            font-family: 'Outfit', sans-serif;
            font-size: 10px;
            color: #78716c;
            margin-top: 4px;
            direction: ltr;
        }

        /* Customer Details Info Box */
        .customer-card {
            background-color: var(--card-gray);
            border-radius: 12px;
            padding: 16px;
            margin-bottom: 24px;
            border: 1px solid rgba(197, 168, 128, 0.15);
        }

        .customer-card div {
            font-size: 13px;
            margin-bottom: 10px;
            line-height: 1.5;
            color: #44403c;
            display: flex;
        }

        .customer-card div:last-child {
            margin-bottom: 0;
        }

        .customer-card strong {
            color: var(--text-dark);
            width: 75px;
            flex-shrink: 0;
            font-weight: 600;
        }

        /* Items Section */
        .table-headers {
            display: flex;
            justify-content: space-between;
            color: var(--accent-gold);
            font-size: 12px;
            font-weight: 700;
            padding-bottom: 8px;
            margin-bottom: 0;
        }
        
        .header-item { width: 60%; }
        .header-qty { width: 15%; text-align: center; }
        .header-price { width: 25%; text-align: left; }

        .burgundy-divider {
            height: 3px;
            background-color: var(--primary-burgundy);
            border: none;
            margin: 0 0 16px 0;
        }

        .item-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 0;
            border-bottom: 1px solid #f2f0eb;
            margin-bottom: 16px;
        }

        .item-row:last-of-type {
            border-bottom: none;
            margin-bottom: 8px;
        }

        .item-details {
            width: 60%;
        }

        .item-title {
            font-size: 13px;
            font-weight: 700;
            color: var(--text-dark);
            margin-bottom: 3px;
        }

        .item-variant {
            font-size: 11px;
            color: #78716c;
        }

        .item-qty {
            width: 15%;
            text-align: center;
            font-family: 'Outfit', sans-serif;
            font-size: 15px;
            font-weight: 700;
            color: var(--text-dark);
        }

        .item-price {
            width: 25%;
            text-align: left;
            font-family: 'Outfit', 'Noto Kufi Arabic', sans-serif;
            font-size: 14px;
            font-weight: 700;
            color: var(--primary-burgundy);
        }

        /* Financial Breakdown */
        .financial-summary {
            padding: 8px 0;
            border-top: 1px dashed var(--border-light);
            margin-bottom: 20px;
        }

        .summary-row {
            display: flex;
            justify-content: space-between;
            font-size: 13px;
            margin-bottom: 10px;
            color: #57534e;
        }

        .summary-row.text-highlight {
            color: var(--text-dark);
            margin-top: 8px;
            padding-top: 8px;
            border-top: 1px solid #f2f0eb;
        }

        .summary-label {
            font-weight: 500;
        }

        .summary-val {
            font-family: 'Outfit', 'Noto Kufi Arabic', sans-serif;
            font-weight: 600;
        }
        
        .text-success { color: #16a34a; }
        .text-danger { color: #dc2626; }
        .font-bold { font-weight: 700; }

        .payment-note {
            font-size: 11px;
            color: #78716c;
            background-color: #fafaf9;
            padding: 8px 12px;
            border-radius: 6px;
            margin-top: 10px;
            border-right: 3px solid var(--accent-gold);
            line-height: 1.4;
        }

        /* Grand Total Big Highlight Bar */
        .grand-total-bar {
            background-color: var(--primary-burgundy);
            border-radius: 12px;
            padding: 16px 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            color: #ffffff;
            margin-bottom: 24px;
            box-shadow: 0 4px 15px rgba(128, 0, 0, 0.15);
        }

        .grand-total-label {
            font-size: 16px;
            font-weight: 700;
            letter-spacing: 0.5px;
        }

        .grand-total-val {
            font-family: 'Outfit', 'Noto Kufi Arabic', sans-serif;
            font-size: 24px;
            font-weight: 700;
            display: flex;
            align-items: baseline;
            gap: 4px;
        }

        .grand-total-val span {
            font-size: 14px;
            font-weight: 500;
        }

        /* Footer Branding */
        .footer-section {
            text-align: center;
            border-top: 1px dashed var(--border-light);
            padding-top: 20px;
        }

        .thanks-msg {
            color: var(--accent-gold);
            font-size: 14px;
            font-weight: 700;
            margin-bottom: 6px;
        }

        .footer-address {
            font-size: 12px;
            color: #44403c;
            margin-bottom: 6px;
            font-weight: 500;
        }

        .footer-contact {
            font-size: 13px;
            color: var(--text-dark);
            font-weight: 700;
        }

        .footer-watermark {
            font-family: 'Outfit', sans-serif;
            font-size: 9px;
            color: #a8a29e;
            margin-top: 24px;
            letter-spacing: 1.5px;
            text-transform: uppercase;
        }

        /* Print button styling */
        .print-actions {
            text-align: center;
            margin-top: 24px;
        }

        .btn-print {
            background-color: var(--primary-burgundy);
            color: white;
            border: none;
            padding: 12px 24px;
            font-family: 'Noto Kufi Arabic', sans-serif;
            font-size: 14px;
            font-weight: 700;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            box-shadow: 0 4px 12px rgba(128, 0, 0, 0.15);
            width: 100%;
            justify-content: center;
            box-sizing: border-box;
        }

        .btn-print:hover {
            background-color: #9c1c1c;
            transform: translateY(-1px);
        }

        @media print {
            body {
                background-color: #ffffff;
                padding: 0;
                margin: 0;
            }
            .invoice-card {
                box-shadow: none;
                border: none;
                max-width: 100%;
                padding: 0;
                margin: 0;
            }
            .print-actions {
                display: none !important;
            }
        }
    </style>
</head>
<body>

    <div class="invoice-card">
        <!-- Logo -->
        <div class="header-section">
            ${DAVINCI_LOGO_SVG}
            <h5 class="brand-subtitle">DaVinci Luxury Collection</h5>
        </div>

        <!-- Gold separator line -->
        <hr class="gold-divider">

        <!-- Title & Status -->
        <div class="title-block">
            <span class="badge-confirmed">CONFIRMED</span>
            <div class="title-meta">
                <h1 class="invoice-title">فاتورة مبيعات</h1>
                <div class="invoice-number-date">${formattedDate} • ${orderSysNum}</div>
            </div>
        </div>

        <!-- Customer info -->
        <div class="customer-card">
            <div><strong>الزبون:</strong> <span>${name}</span></div>
            <div><strong>الهاتف:</strong> <span>${phone}</span></div>
            <div><strong>العنوان:</strong> <span>${location} ${landmark ? `(${landmark})` : ''}</span></div>
        </div>

        <!-- Table headers -->
        <div class="table-headers">
            <span class="header-item">الصنف</span>
            <span class="header-qty">الكمية</span>
            <span class="header-price">السعر</span>
        </div>

        <!-- Burgundy Divider -->
        <hr class="burgundy-divider">

        <!-- Items list -->
        ${displayItems.map(item => `
            <div class="item-row">
                <div class="item-details">
                    <div class="item-title">${item.sku}</div>
                    <div class="item-variant">${item.variant}</div>
                </div>
                <div class="item-qty">${item.quantity}</div>
                <div class="item-price">${(item.price * item.quantity).toFixed(2)}</div>
            </div>
        `).join('')}

        <!-- Financial calculations -->
        <div class="financial-summary">
            <div class="summary-row">
                <span class="summary-label">إجمالي الأصناف:</span>
                <span class="summary-val">${subtotal.toFixed(2)} د.ل</span>
            </div>
            
            <div class="summary-row">
                <span class="summary-label">رسوم التوصيل:</span>
                <span class="summary-val text-success">+ ${deliveryFee.toFixed(2)} د.ل</span>
            </div>
            
            ${totalDiscount > 0 ? `
            <div class="summary-row">
                <span class="summary-label">خصم للزبون:</span>
                <span class="summary-val text-danger">- ${totalDiscount.toFixed(2)} د.ل</span>
            </div>
            ` : ''}

            ${paymentBreakdownHTML}
        </div>

        <!-- Grand Total Highlight Bar -->
        <div class="grand-total-bar">
            <div class="grand-total-val">${finalTotal.toFixed(2)} <span>د.ل</span></div>
            <div class="grand-total-label">الإجمالي النهائي</div>
        </div>

        <!-- Footer -->
        <div class="footer-section">
            <div class="thanks-msg">شكراً لاختياركم دافينشي • DAVINCI</div>
            <div class="footer-address">طرابلس - ليبيا</div>
            <div class="footer-contact">خدمة العملاء: 0912925662</div>
            <div class="footer-watermark">DAVINCI POS PREMIUM EDITION</div>
        </div>
        
        <!-- Print Action Button (Hidden on Printout) -->
        <div class="print-actions">
            <button onclick="window.print()" class="btn-print">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-left: 8px;"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/></svg>
                طباعة الفاتورة (للاصق الشحنة)
            </button>
        </div>
    </div>

</body>
</html>
    `;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
};
