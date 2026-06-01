module.exports = async (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>بوابة DaVinci المركزية - Ecosystem Hub</title>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&family=Noto+Kufi+Arabic:wght@400;600;700&display=swap" rel="stylesheet">
        <style>
            :root {
                --primary: #0f172a;
                --secondary: #1e293b;
                --accent: #3b82f6;
                --accent-hover: #2563eb;
                --text-main: #f8fafc;
                --text-muted: #94a3b8;
                --bg: #020617;
            }

            body {
                font-family: 'Noto Kufi Arabic', 'Outfit', sans-serif;
                background-color: var(--bg);
                background-image: 
                    radial-gradient(circle at 10% 20%, rgba(59, 130, 246, 0.05) 0%, transparent 40%),
                    radial-gradient(circle at 90% 80%, rgba(59, 130, 246, 0.05) 0%, transparent 40%);
                margin: 0;
                padding: 0;
                color: var(--text-main);
                min-height: 100vh;
                display: flex;
                flex-direction: column;
            }

            .container {
                max-width: 1100px;
                margin: 0 auto;
                padding: 60px 20px;
                flex: 1;
            }

            header {
                text-align: center;
                margin-bottom: 60px;
            }

            header h1 {
                font-size: 42px;
                font-weight: 700;
                margin-bottom: 10px;
                background: linear-gradient(to right, #ffffff, #94a3b8);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }

            header p {
                color: var(--text-muted);
                font-size: 18px;
            }

            .grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
                gap: 25px;
            }

            .card {
                background: rgba(30, 41, 59, 0.5);
                backdrop-filter: blur(10px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 24px;
                padding: 30px;
                text-decoration: none;
                color: inherit;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                display: flex;
                flex-direction: column;
                justify-content: space-between;
                position: relative;
                overflow: hidden;
            }

            .card::before {
                content: '';
                position: absolute;
                top: 0; left: 0; width: 100%; height: 100%;
                background: linear-gradient(45deg, transparent, rgba(255,255,255,0.03), transparent);
                transform: translateX(-100%);
                transition: 0.5s;
            }

            .card:hover::before {
                transform: translateX(100%);
            }

            .card:hover {
                transform: translateY(-10px);
                background: rgba(30, 41, 59, 0.8);
                border-color: var(--accent);
                box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2);
            }

            .card-icon {
                font-size: 40px;
                margin-bottom: 20px;
            }

            .card-title {
                font-size: 22px;
                font-weight: 600;
                margin-bottom: 12px;
                color: #fff;
            }

            .card-desc {
                color: var(--text-muted);
                font-size: 14px;
                line-height: 1.6;
                margin-bottom: 25px;
            }

            .card-link {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                color: var(--accent);
                font-weight: 600;
                font-size: 14px;
            }

            footer {
                text-align: center;
                padding: 40px;
                color: var(--text-muted);
                font-size: 14px;
                border-top: 1px solid rgba(255,255,255,0.05);
            }

            .badge {
                position: absolute;
                top: 20px;
                left: 20px;
                background: var(--accent);
                color: white;
                font-size: 10px;
                padding: 4px 10px;
                border-radius: 12px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 1px;
            }

            @media (max-width: 600px) {
                header h1 { font-size: 32px; }
                .grid { grid-template-columns: 1fr; }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <header>
                <h1>منظومة DaVinci المتكاملة</h1>
                <p>البوابة المركزية لإدارة كافة مشاريعك وأنظمتك الذكية</p>
            </header>

            <div class="grid">


                <!-- المتجر الإلكتروني -->
                <a href="https://da-vinci.ezone.ly" target="_blank" class="card">
                    <div class="card-icon">🛍️</div>
                    <div>
                        <div class="card-title">متجر DaVinci</div>
                        <div class="card-desc">واجهة العرض العامة للزبائن، استعراض المنتجات، والطلب المباشر من خلال الموقع.</div>
                    </div>
                    <div class="card-link">زيارة المتجر ⮕</div>
                </a>

                <!-- منظومة الشحن -->
                <a href="https://my.ezone.ly/" target="_blank" class="card">
                    <div class="card-icon">🚛</div>
                    <div>
                        <div class="card-title">بوابة E-Zone</div>
                        <div class="card-desc">النظام المركزي لخدمات E-Zone، إدارة الحسابات، ومتابعة العمليات اللوجستية الكبرى.</div>
                    </div>
                    <div class="card-link">الدخول للبوابة ⮕</div>
                </a>

                <!-- E-Zone Pay -->
                <a href="https://my.ezone.ly/ezone-pay/dashboard" target="_blank" class="card">
                    <div class="card-icon">💳</div>
                    <div>
                        <div class="card-title">E-Zone Pay</div>
                        <div class="card-desc">لوحة تحكم المدفوعات المالية، متابعة الرصيد، والتحويلات المالية الخاصة بالمتجر.</div>
                    </div>
                    <div class="card-link">فتح المحفظة ⮕</div>
                </a>

                <!-- إعدادات البوت -->
                <a href="https://nedalabuoghamja.github.io/DaVinci-shipments/" target="_blank" class="card">
                    <div class="card-icon">📦</div>
                    <div>
                        <div class="card-title">منظومة شحن DaVinci</div>
                        <div class="card-desc">تتبع الشحنات، إدارة كشوفات التوصيل، والربط المباشر مع شركات الشحن المحلية.</div>
                    </div>
                    <div class="card-link">فتح المنظومة ⮕</div>
                </a>

                <!-- إعدادات البوت -->
                <a href="https://developers.facebook.com/apps/" target="_blank" class="card">
                    <div class="card-icon">🤖</div>
                    <div>
                        <div class="card-title">إدارة Bot الفيسبوك</div>
                        <div class="card-desc">الوصول السريع لإعدادات فيسبوك، تحديث الرموز البرمجية، ومراقبة أداء الويب هوك.</div>
                    </div>
                    <div class="card-link">إعدادات المطورين ⮕</div>
                </a>
            </div>
        </div>

        <footer>
            &copy; 2026 DaVinci Ecosystem. جميع الحقوق محفوظة لشركة DaVinci.
        </footer>
    </body>
    </html>
    `;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
};
