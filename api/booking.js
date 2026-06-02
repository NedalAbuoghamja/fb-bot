const Redis = require('ioredis');

const redisUrl = process.env.REDIS_URL;
let redis = null;
if (redisUrl) {
    try {
        redis = new Redis(redisUrl);
    } catch (e) {
        console.error("Redis connection failed in booking:", e.message);
    }
}

module.exports = async (req, res) => {
    // Disable caching for all responses (HTML and API JSON)
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const action = req.query.action;

    if (action === 'list') {
        if (!redis) return res.status(500).json({ error: "Redis not connected" });
        try {
            const ids = await redis.smembers('all_invoice_ids');
            let invoices = [];
            if (ids && ids.length > 0) {
                const keys = ids.map(id => `invoice:${id}`);
                const data = await redis.mget(keys);
                invoices = data.filter(Boolean).map(JSON.parse);
            }
            invoices.sort((a, b) => new Date(b.date) - new Date(a.date));
            return res.status(200).json(invoices);
        } catch (err) {
            return res.status(500).json({ error: err.message });
        }
    }

    if (action === 'save') {
        if (!redis) return res.status(500).json({ error: "Redis not connected" });
        try {
            // Robust body parser handles buffers, strings, or unparsed request streams
            let invoice = req.body;
            if (typeof invoice === 'string') {
                invoice = JSON.parse(invoice);
            } else if (Buffer.isBuffer(invoice)) {
                invoice = JSON.parse(invoice.toString('utf8'));
            } else if (invoice === undefined) {
                const getBody = (r) => {
                    return new Promise((resolve, reject) => {
                        let b = '';
                        r.on('data', chunk => { b += chunk; });
                        r.on('end', () => { resolve(b); });
                        r.on('error', err => { reject(err); });
                    });
                };
                const rawBody = await getBody(req);
                invoice = JSON.parse(rawBody);
            }

            if (!invoice || !invoice.id) return res.status(400).json({ error: "Invalid invoice data" });
            
            await redis.set(`invoice:${invoice.id}`, JSON.stringify(invoice));
            await redis.sadd('all_invoice_ids', invoice.id);
            return res.status(200).json({ success: true });
        } catch (err) {
            return res.status(500).json({ error: err.message });
        }
    }

    if (action === 'delete') {
        if (!redis) return res.status(500).json({ error: "Redis not connected" });
        try {
            const id = req.query.id;
            if (!id) return res.status(400).json({ error: "Missing invoice ID" });
            await redis.del(`invoice:${id}`);
            await redis.srem('all_invoice_ids', id);
            return res.status(200).json({ success: true });
        } catch (err) {
            return res.status(500).json({ error: err.message });
        }
    }

    if (action === 'clear') {
        if (!redis) return res.status(500).json({ error: "Redis not connected" });
        try {
            const ids = await redis.smembers('all_invoice_ids');
            if (ids && ids.length > 0) {
                const keys = ids.map(id => `invoice:${id}`);
                await redis.del(keys);
                await redis.del('all_invoice_ids');
            }
            return res.status(200).json({ success: true });
        } catch (err) {
            return res.status(500).json({ error: err.message });
        }
    }

    // Serve HTML
    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>منظومة حجز وفواتير دافينشي - DaVinci Store</title>
    <!-- Google Fonts -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@300;400;600;700;800&family=Outfit:wght@300;400;600;700;800&display=swap" rel="stylesheet">
    <style>
/* Custom Variables & Theme Tokens */
:root {
    --bg-main: #0b0f19;
    --bg-surface: rgba(22, 30, 49, 0.7);
    --bg-surface-border: rgba(255, 255, 255, 0.08);
    --bg-sidebar: rgba(15, 23, 42, 0.85);
    
    --primary: #0ea5e9;
    --primary-hover: #0284c7;
    --primary-light: rgba(14, 165, 233, 0.1);
    
    --accent: #6366f1;
    --accent-hover: #4f46e5;
    
    --text-primary: #f8fafc;
    --text-secondary: #94a3b8;
    --text-muted: #64748b;
    --text-dark: #0f172a;
    
    --danger: #ef4444;
    --danger-hover: #dc2626;
    --danger-light: rgba(239, 68, 68, 0.1);
    
    --success: #10b981;
    --success-light: rgba(16, 185, 129, 0.15);
    
    --warning: #f59e0b;
    --warning-light: rgba(245, 158, 11, 0.15);
    
    --border-radius-sm: 8px;
    --border-radius-md: 14px;
    --border-radius-lg: 20px;
    
    --font-ar: 'Noto Kufi Arabic', system-ui, -apple-system, sans-serif;
    --font-en: 'Outfit', system-ui, -apple-system, sans-serif;
    
    --transition-fast: 0.2s ease;
    --transition-normal: 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    
    --shadow-premium: 0 20px 40px -15px rgba(0, 0, 0, 0.5);
    --shadow-glow: 0 0 20px rgba(14, 165, 233, 0.15);
}

/* Reset & Global Styles */
* {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
}

body {
    background-color: var(--bg-main);
    color: var(--text-primary);
    font-family: var(--font-ar);
    font-size: 15px;
    line-height: 1.6;
    overflow-x: hidden;
    height: 100vh;
}

/* Layout Framework */
.app-container {
    display: flex;
    height: 100vh;
    width: 100vw;
    position: relative;
    overflow: hidden;
}

/* Sidebar Styling (History List) */
.sidebar {
    width: 320px;
    height: 100%;
    background-color: var(--bg-sidebar);
    border-left: 1px solid var(--bg-surface-border);
    backdrop-filter: blur(20px);
    display: flex;
    flex-direction: column;
    z-index: 100;
    transition: transform var(--transition-normal);
    position: relative;
    flex-shrink: 0;
}

.sidebar.collapsed {
    transform: translateX(320px);
    position: absolute;
    right: -320px;
}

.sidebar-header {
    padding: 24px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--bg-surface-border);
}

.logo-area {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 700;
    font-size: 18px;
    letter-spacing: 0.5px;
}

.logo-icon {
    width: 28px;
    height: 28px;
    color: var(--primary);
    filter: drop-shadow(0 0 8px rgba(14, 165, 233, 0.4));
}

.toggle-sidebar-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: 24px;
    cursor: pointer;
    line-height: 1;
    transition: color var(--transition-fast);
}

.toggle-sidebar-btn:hover {
    color: var(--danger);
}

.search-box {
    padding: 16px 24px;
    position: relative;
    border-bottom: 1px solid var(--bg-surface-border);
}

.search-box input {
    width: 100%;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--bg-surface-border);
    border-radius: var(--border-radius-sm);
    padding: 10px 40px 10px 14px;
    color: var(--text-primary);
    font-family: var(--font-ar);
    font-size: 13px;
    transition: all var(--transition-fast);
}

.search-box input:focus {
    outline: none;
    border-color: var(--primary);
    background: rgba(255, 255, 255, 0.08);
    box-shadow: 0 0 10px rgba(14, 165, 233, 0.15);
}

.search-icon {
    position: absolute;
    right: 36px;
    top: 50%;
    transform: translateY(-50%);
    width: 16px;
    height: 16px;
    color: var(--text-secondary);
    pointer-events: none;
}

.invoice-list {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}

/* Custom Scrollbar for dark theme components */
.invoice-list::-webkit-scrollbar,
.form-panel::-webkit-scrollbar,
.preview-panel::-webkit-scrollbar {
    width: 6px;
}
.invoice-list::-webkit-scrollbar-thumb,
.form-panel::-webkit-scrollbar-thumb,
.preview-panel::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
}
.invoice-list::-webkit-scrollbar-thumb:hover,
.form-panel::-webkit-scrollbar-thumb:hover,
.preview-panel::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.25);
}

.empty-history {
    text-align: center;
    color: var(--text-muted);
    padding: 40px 20px;
    font-size: 13px;
    border: 2px dashed rgba(255, 255, 255, 0.04);
    border-radius: var(--border-radius-sm);
}

/* Individual Invoice Item in History Sidebar */
.history-item {
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid var(--bg-surface-border);
    border-radius: var(--border-radius-sm);
    padding: 12px;
    cursor: pointer;
    transition: all var(--transition-fast);
    position: relative;
    overflow: hidden;
}

.history-item:hover {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(14, 165, 233, 0.3);
}

.history-item.active {
    background: var(--primary-light);
    border-color: var(--primary);
    box-shadow: 0 0 10px rgba(14, 165, 233, 0.08);
}

.history-item-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
}

.history-item-id {
    font-family: var(--font-en);
    font-weight: 600;
    font-size: 13px;
    color: var(--primary);
}

.history-item-date {
    font-size: 11px;
    color: var(--text-muted);
    font-family: var(--font-en);
}

.history-item-name {
    font-weight: 600;
    font-size: 14px;
    color: var(--text-primary);
    margin-bottom: 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.history-item-phone {
    font-size: 12px;
    color: var(--text-secondary);
    font-family: var(--font-en);
    margin-bottom: 6px;
}

.history-item-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-top: 1px solid rgba(255, 255, 255, 0.04);
    padding-top: 8px;
    margin-top: 4px;
}

.history-item-total {
    font-weight: 700;
    font-size: 13px;
    color: var(--accent);
}

.status-badge {
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 20px;
    font-weight: 600;
}

.status-pending { background: rgba(245, 158, 11, 0.15); color: var(--warning); }
.status-confirmed { background: rgba(14, 165, 233, 0.15); color: var(--primary); }
.status-shipped { background: rgba(99, 102, 241, 0.15); color: var(--accent); }
.status-delivered { background: rgba(16, 185, 129, 0.15); color: var(--success); }
.status-cancelled { background: rgba(239, 68, 68, 0.15); color: var(--danger); }

.history-item-delete-btn {
    position: absolute;
    left: 8px;
    top: 8px;
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    opacity: 0;
    transition: opacity var(--transition-fast), color var(--transition-fast);
}

.history-item:hover .history-item-delete-btn {
    opacity: 1;
}

.history-item-delete-btn:hover {
    color: var(--danger);
}

.sidebar-footer {
    padding: 16px;
    border-top: 1px solid var(--bg-surface-border);
}

/* Sidebar Trigger Button */
.sidebar-trigger {
    position: fixed;
    right: 20px;
    bottom: 20px;
    width: 50px;
    height: 50px;
    border-radius: 50%;
    background-color: var(--bg-surface);
    border: 1px solid var(--bg-surface-border);
    backdrop-filter: blur(10px);
    color: var(--text-primary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 99;
    box-shadow: var(--shadow-premium);
    transition: all var(--transition-fast);
}

.sidebar-trigger svg {
    width: 22px;
    height: 22px;
}

.sidebar-trigger:hover {
    background-color: var(--primary);
    border-color: var(--primary);
    transform: scale(1.05);
}

.sidebar-trigger .badge {
    position: absolute;
    top: -5px;
    left: -5px;
    background: var(--danger);
    color: white;
    border-radius: 50%;
    font-size: 10px;
    padding: 2px 6px;
    font-weight: 700;
}

/* Main Workspace Styles */
.main-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    position: relative;
}

.main-header {
    height: 70px;
    padding: 0 32px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--bg-surface-border);
    background: rgba(11, 15, 25, 0.8);
    backdrop-filter: blur(10px);
    flex-shrink: 0;
}

.header-title h1 {
    font-size: 18px;
    font-weight: 700;
    color: var(--text-primary);
}

.header-title .subtitle {
    font-size: 12px;
    color: var(--text-secondary);
}

.workspace-grid {
    display: flex;
    flex: 1;
    overflow: hidden;
    height: calc(100vh - 70px);
}

/* Split Panels */
.form-panel {
    flex: 1.1;
    padding: 24px;
    overflow-y: auto;
    border-left: 1px solid var(--bg-surface-border);
}

.preview-panel {
    flex: 0.9;
    padding: 24px;
    overflow-y: auto;
    background: rgba(0, 0, 0, 0.2);
    display: flex;
    flex-direction: column;
    align-items: center;
}

/* Cards & Forms */
.card {
    background: var(--bg-surface);
    border: 1px solid var(--bg-surface-border);
    border-radius: var(--border-radius-md);
    box-shadow: var(--shadow-premium);
    overflow: hidden;
}

.card-header {
    padding: 20px 24px;
    border-bottom: 1px solid var(--bg-surface-border);
}

.card-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--primary);
}

.card-body {
    padding: 24px;
}

.form-group {
    margin-bottom: 20px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.form-row {
    display: flex;
    gap: 16px;
}

.col-6 {
    flex: 1;
}

label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-secondary);
}

.required {
    color: var(--danger);
}

input[type="text"],
input[type="tel"],
input[type="number"],
input[type="datetime-local"],
select,
textarea {
    width: 100%;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--bg-surface-border);
    border-radius: var(--border-radius-sm);
    padding: 12px 14px;
    color: var(--text-primary);
    font-family: var(--font-ar);
    font-size: 14px;
    transition: all var(--transition-fast);
}

input:focus,
select:focus,
textarea:focus {
    outline: none;
    border-color: var(--primary);
    background: rgba(255, 255, 255, 0.06);
    box-shadow: 0 0 10px rgba(14, 165, 233, 0.12);
}

input[readonly] {
    background: rgba(255, 255, 255, 0.01) !important;
    border-color: rgba(255, 255, 255, 0.03);
    color: var(--text-muted);
    cursor: not-allowed;
    font-family: var(--font-en);
}

/* Dropdown Select styles */
select {
    cursor: pointer;
    appearance: none;
    background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%2394a3b8' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m6 8 4 4 4-4'/%3E%3C/svg%3E");
    background-position: left 12px center;
    background-repeat: no-repeat;
    background-size: 18px;
    padding-left: 36px;
}

select optgroup {
    background: var(--bg-main);
    color: var(--text-primary);
    font-weight: 600;
}

select option {
    background: var(--bg-main);
    color: var(--text-primary);
    padding: 10px;
}

/* Buttons */
.btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    font-family: var(--font-ar);
    font-size: 14px;
    font-weight: 600;
    padding: 10px 18px;
    border-radius: var(--border-radius-sm);
    border: 1px solid transparent;
    cursor: pointer;
    transition: all var(--transition-fast);
}

.btn-icon {
    width: 18px;
    height: 18px;
}

.btn-icon-sm {
    width: 14px;
    height: 14px;
}

.btn-block {
    width: 100%;
}

.btn-primary {
    background-color: var(--primary);
    color: white;
}

.btn-primary:hover {
    background-color: var(--primary-hover);
    box-shadow: 0 0 15px rgba(14, 165, 233, 0.3);
}

.btn-primary-outline {
    background: transparent;
    border: 1px solid var(--primary);
    color: var(--primary);
}

.btn-primary-outline:hover {
    background: var(--primary-light);
}

.btn-secondary {
    background-color: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--bg-surface-border);
    color: var(--text-primary);
}

.btn-secondary:hover {
    background-color: rgba(255, 255, 255, 0.08);
    border-color: var(--text-secondary);
}

.btn-danger {
    background-color: var(--danger-light);
    border: 1px solid rgba(239, 68, 68, 0.2);
    color: var(--danger);
}

.btn-danger:hover {
    background-color: var(--danger);
    color: white;
    box-shadow: 0 0 15px rgba(239, 68, 68, 0.2);
}

.btn-sm {
    padding: 6px 12px;
    font-size: 12px;
}

.btn-lg {
    padding: 14px 28px;
    font-size: 16px;
    border-radius: var(--border-radius-md);
}

/* Dynamic Items List (Form) */
.items-section {
    margin-top: 24px;
    border-top: 1px solid var(--bg-surface-border);
    padding-top: 20px;
}

.section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
}

.section-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-secondary);
}

.items-list-container {
    max-height: 250px;
    overflow-y: auto;
    border: 1px solid var(--bg-surface-border);
    border-radius: var(--border-radius-sm);
    margin-bottom: 20px;
}

.form-items-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    text-align: right;
}

.form-items-table th {
    background: rgba(255, 255, 255, 0.02);
    color: var(--text-secondary);
    font-weight: 600;
    padding: 10px 12px;
    border-bottom: 1px solid var(--bg-surface-border);
}

.form-items-table td {
    padding: 8px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.03);
    vertical-align: middle;
}

.form-items-table tr:last-child td {
    border-bottom: none;
}

.form-items-table input {
    padding: 6px 8px;
    font-size: 12px;
}

.form-item-row-total {
    font-weight: 700;
    color: var(--primary);
    font-family: var(--font-en);
}

.delete-row-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    transition: all var(--transition-fast);
}

.delete-row-btn:hover {
    color: var(--danger);
    background: var(--danger-light);
}

.delete-row-btn svg {
    width: 16px;
    height: 16px;
}

/* Finance Fields Row */
.finance-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 16px;
    background: rgba(255, 255, 255, 0.01);
    padding: 16px;
    border-radius: var(--border-radius-sm);
    border: 1px solid var(--bg-surface-border);
    margin-bottom: 20px;
}

.form-actions-footer {
    display: flex;
    justify-content: flex-end;
}

.form-actions-footer button {
    width: 100%;
}

/* Preview Panel Header/Toolbar */
.preview-toolbar {
    width: 100%;
    max-width: 794px; /* Matches A4 width */
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
}

.preview-badge {
    background: var(--primary-light);
    color: var(--primary);
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 600;
}

/* ==========================================================================
   INVOICE PRINT PAGE A4 CSS (Used on screen for preview, and styled for print)
   ========================================================================== */
.invoice-paper {
    background: #ffffff;
    color: var(--text-dark);
    width: 76mm;
    max-width: 76mm;
    min-height: auto;
    padding: 1mm 1.5mm;
    box-shadow: var(--shadow-premium);
    border-radius: 6px;
    font-family: var(--font-ar);
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    transition: transform var(--transition-normal);
}

/* Invoice Typography & Components inside paper */
.invoice-print-header {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 4px;
    margin-bottom: 8px;
    width: 100%;
}

.brand-info {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
}

.brand-logo {
    width: 26px;
    height: 26px;
    background: var(--text-dark);
    color: #ffffff;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
}

.brand-logo svg {
    width: 15px;
    height: 15px;
}

.brand-text {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
}

.brand-name {
    font-size: 10pt;
    font-weight: 800;
    color: var(--text-dark);
    line-height: 1.1;
}

.brand-slogan {
    font-family: var(--font-en);
    font-size: 6.5pt;
    color: #000000; font-weight: 700;
    font-weight: 600;
    letter-spacing: 0.5px;
}

.invoice-title-block {
    text-align: center;
    width: 100%;
}

.print-title {
    font-size: 10pt;
    font-weight: 800;
    color: var(--text-dark);
    margin-bottom: 1px;
    letter-spacing: -0.5px;
}

.invoice-meta-item {
    font-size: 7.5pt;
    color: #475569;
    display: flex;
    justify-content: center;
    gap: 6px;
    margin-bottom: 1px;
}

.meta-label {
    font-weight: 600;
}

.meta-val {
    font-family: var(--font-en);
    font-weight: 600;
    color: var(--text-dark);
}

.divider {
    border: none;
    height: 1px;
    background: #000000;
    margin: 4px 0;
}

/* Client Details Print Grid */
.invoice-details-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 2px;
    margin-bottom: 6px;
}

.detail-section {
    display: flex;
    flex-direction: column;
    gap: 1px;
}

.left-align-desktop {
    border-right: none;
    border-bottom: 1px dashed #000000;
    padding-right: 0;
    padding-bottom: 3px;
    margin-bottom: 3px;
}

.detail-title {
    font-size: 8pt;
    font-weight: 700;
    color: #64748b;
    text-transform: uppercase;
    margin-bottom: 1px;
    border-bottom: 1px solid #000000;
    padding-bottom: 1px;
}

.detail-row {
    font-size: 7.5pt;
    display: flex;
    align-items: baseline;
    gap: 4px;
}

.detail-label {
    color: #64748b;
    font-weight: 600;
    min-width: 55px;
    flex-shrink: 0;
}

.detail-val {
    color: #0f172a;
    word-break: break-word;
}

.text-bold {
    font-weight: 700;
}

.status-pill-print {
    display: inline-block;
    font-size: 7pt;
    padding: 1px 3px;
    border-radius: 4px;
    font-weight: 700;
    border: 1px solid #cbd5e1;
    background: #f8fafc;
}

/* Printable Items Table */
.print-table-container {
    margin-bottom: 6px;
    flex: none;
}

.print-invoice-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 7.5pt;
}

.print-invoice-table th {
    background: #f1f5f9;
    color: #475569;
    font-weight: 700;
    padding: 2px 2px;
    border-top: 1px solid #000000;
    border-bottom: 1px solid #000000;
}

.print-invoice-table td {
    padding: 2px 2px;
    border-bottom: 1px solid #e2e8f0;
    color: #1e293b;
    vertical-align: middle;
}

.print-invoice-table tr:hover td {
    background: #f8fafc;
}

.empty-table-placeholder {
    text-align: center;
    color: #94a3b8;
    padding: 20px !important;
    font-style: italic;
}

/* Calculations Summary Block in Print */
.invoice-summary-block {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 4px 6px;
    background: #f8fafc;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    margin-bottom: 6px;
}

.summary-line {
    display: flex;
    justify-content: space-between;
    font-size: 7.5pt;
    color: #475569;
}

.summary-val {
    font-family: var(--font-en);
    font-weight: 600;
    color: #0f172a;
}

.text-danger-print .summary-val {
    color: #dc2626;
}

.grand-total {
    border-top: 1px dashed #cbd5e1;
    padding-top: 4px;
    margin-top: 2px;
    font-size: 8pt;
    font-weight: 800;
    color: #0f172a;
}

.grand-total .summary-val {
    font-size: 9.5pt;
    color: var(--accent-hover);
}

/* QR Code Section Styling */
.qr-codes-container {
    display: flex;
    justify-content: center;
    gap: 10px;
    margin: 4px 0;
    padding: 2px 0;
    border-top: 1px dashed #e2e8f0;
    border-bottom: 1px dashed #e2e8f0;
}

.qr-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    font-size: 6.5pt;
    font-weight: 700;
    color: #475569;
}

.qr-code-img {
    width: 38px;
    height: 38px;
    border: 1px solid #e2e8f0;
    padding: 1px;
    border-radius: 6px;
    background: #ffffff;
}

/* Invoice Footer / Printing guidelines */
.invoice-print-footer {
    border-top: 1px dashed #000000;
    padding-top: 4px;
    margin-top: 4px;
    text-align: right;
    width: 100%;
}

.thank-you-msg {
    font-size: 7.5pt;
    font-weight: 700;
    color: #0f172a;
    margin-bottom: 1px;
    text-align: right;
}

.terms-text {
    font-size: 6pt;
    color: #64748b;
    margin-bottom: 3px;
    max-width: 100%;
    margin-left: auto;
    margin-right: auto;
    line-height: 1.15;
    text-align: right;
}

.contact-info {
    display: flex;
    justify-content: flex-start;
    flex-wrap: wrap;
    gap: 4px;
    font-size: 6.5pt;
    color: #475569;
    font-weight: 600;
}

/* Utility classes */
.no-print {
    display: block;
}

/* Responsive Overrides (Screen only) */
@media (max-width: 1200px) {
    .workspace-grid {
        flex-direction: column;
        overflow-y: auto;
        height: auto;
    }
    
    .form-panel, .preview-panel {
        flex: none;
        width: 100%;
        overflow-y: visible;
        height: auto;
    }
    
    .sidebar {
        position: fixed;
        right: 0;
        top: 0;
        height: 100vh;
        box-shadow: -10px 0 30px rgba(0,0,0,0.5);
    }
}

/* Mobile responsive styling overrides */
@media (max-width: 768px) {
    body {
        font-size: 13px;
    }
    
    .main-header {
        padding: 0 16px;
        height: auto;
        padding-top: 15px;
        padding-bottom: 15px;
        flex-direction: column;
        gap: 12px;
        text-align: center;
    }
    
    .form-panel, .preview-panel {
        padding: 12px;
    }
    
    .invoice-paper {
        padding: 24px 16px;
        min-height: auto;
    }
    
    .invoice-print-header {
        flex-direction: column;
        align-items: center;
        gap: 16px;
        text-align: center;
    }
    
    .invoice-title-block {
        text-align: center;
    }
    
    .invoice-details-grid {
        grid-template-columns: 1fr;
        gap: 20px;
    }
    
    .left-align-desktop {
        border-right: none;
        border-bottom: 2px solid #f1f5f9;
        padding-right: 0;
        padding-bottom: 20px;
    }
    
    .invoice-summary-block {
        width: 100%;
        margin-right: 0;
    }
    
    .contact-info {
        flex-direction: column;
        gap: 8px;
    }
    
    .qr-codes-container {
        gap: 20px;
    }
    
    .qr-code-img {
        width: 70px;
        height: 70px;
    }
    
    .form-row {
        flex-direction: column;
        gap: 0;
    }
    
    .col-6 {
        width: 100%;
    }
}

/* ==========================================================================
   PRINTER SPECIFIC STYLES (Triggers automatically on window.print())
   ========================================================================== */
@media print {
    /* Set page width to 76mm, height to 130mm, no margins */
    @page {
        size: 76mm 130mm;
        margin: 0 2mm;
    }

    /* Hide all workspace items and page scaffolding */
    html, body {
        background: #ffffff !important;
        color: #000000 !important;
        margin: 0 !important;
        padding: 0 !important;
        height: auto !important;
        width: 100% !important;
        overflow: visible !important;
        font-family: 'Noto Kufi Arabic', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif !important;
        font-size: 8.5pt !important;
        line-height: 1.3 !important;
        font-weight: 500 !important;
        direction: rtl !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }

    /* Force all text elements to pure black for thermal clarity */
    body, p, div, span, h1, h2, h3, h4, h5, h6, table, tr, td, th, label, strong, b {
        color: #000000 !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }
    
    .app-container {
        display: block !important;
        height: auto !important;
        width: 100% !important;
        overflow: visible !important;
    }

    .no-print, 
    .sidebar, 
    .sidebar-trigger, 
    .main-header, 
    .form-panel, 
    .preview-toolbar {
        display: none !important;
    }
    
    .main-content {
        margin: 0 !important;
        padding: 0 !important;
        height: auto !important;
        width: 100% !important;
        display: block !important;
        overflow: visible !important;
    }
    
    .workspace-grid {
        display: block !important;
        height: auto !important;
        overflow: visible !important;
        width: 100% !important;
    }
    
    .preview-panel {
        background: transparent !important;
        padding: 0 !important;
        margin: 0 !important;
        width: 100% !important;
        display: block !important;
        overflow: visible !important;
    }

    /* Target invoice paper specifically to fit 76mm roll precisely */
    .invoice-paper {
        border: none !important;
        box-shadow: none !important;
        width: 100% !important;
        max-width: 100% !important;
        min-height: 0 !important;
        padding: 1mm 0 !important;
        margin: 0 !important;
        background: #ffffff !important;
        color: #000000 !important;
        box-sizing: border-box !important;
        font-size: 8.5pt !important;
    }
    
    .brand-info {
        flex-direction: row !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 6px !important;
        width: 100% !important;
        margin-bottom: 2px !important;
    }

    .brand-logo {
        background: #000000 !important;
        color: #ffffff !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
        width: 26px !important;
        height: 26px !important;
        border-radius: 4px !important;
    }

    .brand-logo svg {
        width: 15px !important;
        height: 15px !important;
    }

    .brand-logo, .brand-logo * {
        color: #ffffff !important;
        fill: #ffffff !important;
    }

    .brand-text {
        align-items: flex-start !important;
    }

    .brand-name {
        font-size: 11pt !important;
        font-weight: 700 !important;
        line-height: 1.1 !important;
        color: #000000 !important;
    }

    .brand-slogan {
        font-size: 6.5pt !important;
        font-weight: 500 !important;
        color: #000000 !important;
    }

    .print-title {
        font-size: 11pt !important;
        font-weight: 700 !important;
        margin-bottom: 1px !important;
        color: #000000 !important;
    }

    .invoice-meta-item {
        font-size: 8pt !important;
        font-weight: 500 !important;
        margin-bottom: 1px !important;
        color: #000000 !important;
    }
    
    .divider {
        height: 1px !important;
        margin: 3px 0 !important;
        background: #000000 !important;
        border: none !important;
    }
    
    .status-pill-print {
        border: 1px solid #000000 !important;
        color: #000000 !important;
        background: #ffffff !important;
        padding: 1px 3px !important;
        font-size: 7.5pt !important;
        font-weight: 700 !important;
    }
    
    /* Client Details Grid */
    .invoice-details-grid {
        grid-template-columns: 1fr !important;
        gap: 1px !important;
        margin-bottom: 4px !important;
    }

    .detail-section {
        gap: 1px !important;
    }
    
    .left-align-desktop {
        border-right: none !important;
        border-bottom: 1px dashed #000000 !important;
        padding-right: 0 !important;
        padding-bottom: 2px !important;
        margin-bottom: 2px !important;
    }

    .detail-title {
        font-size: 8.5pt !important;
        font-weight: 700 !important;
        margin-bottom: 1px !important;
        padding-bottom: 1px !important;
        border-bottom: 1px solid #000000 !important;
        color: #000000 !important;
    }

    .detail-row {
        font-size: 8pt !important;
        font-weight: 500 !important;
        gap: 4px !important;
        color: #000000 !important;
    }

    .detail-label {
        min-width: 55px !important;
        font-weight: 600 !important;
    }

    .detail-val {
        font-weight: 700 !important;
    }
    
    /* Printable Items Table */
    .print-table-container {
        margin-bottom: 4px !important;
        flex: none !important;
    }

    .print-invoice-table th {
        background: transparent !important;
        color: #000000 !important;
        border-top: 1px solid #000000 !important;
        border-bottom: 1px solid #000000 !important;
        padding: 2px 2px !important;
        font-size: 8pt !important;
        font-weight: 700 !important;
    }
    
    .print-invoice-table td {
        border-bottom: 1px dashed #000000 !important;
        padding: 2px 2px !important;
        font-size: 8.5pt !important;
        font-weight: 600 !important;
        color: #000000 !important;
    }
    
    /* Calculations Summary */
    .invoice-summary-block {
        background: transparent !important;
        border: 1px dashed #000000 !important;
        padding: 3px 5px !important;
        margin-bottom: 4px !important;
    }

    .summary-line {
        font-size: 8.5pt !important;
        font-weight: 500 !important;
        color: #000000 !important;
    }

    .summary-label {
        font-weight: 600 !important;
    }

    .summary-val {
        font-weight: 700 !important;
    }

    .grand-total .summary-val {
        color: #000000 !important;
        font-weight: 900 !important;
        font-size: 10.5pt !important;
    }
    
    /* Footer */
    .invoice-print-footer {
        border-top: 1px dashed #000000 !important;
        padding-top: 4px !important;
        margin-top: 4px !important;
        text-align: center !important;
    }

    .thank-you-msg {
        font-size: 8pt !important;
        font-weight: 700 !important;
        text-align: center !important;
        color: #000000 !important;
        margin-bottom: 2px !important;
    }
}

</style>
</head>
<body>
    <!-- App Container -->
    <div class="app-container">
        <!-- Sidebar: History -->
        <aside class="sidebar no-print" id="sidebar">
            <div class="sidebar-header">
                <div class="logo-area">
                    <svg class="logo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                    </svg>
                    <span>سجل الفواتير</span>
                </div>
                <button class="toggle-sidebar-btn" id="toggle-sidebar-close" title="إغلاق السجل">×</button>
            </div>
            
            <div class="search-box">
                <input type="text" id="search-invoice" placeholder="بحث باسم الزبون أو رقم الهاتف...">
                <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
            </div>

            <div class="invoice-list" id="invoice-list">
                <!-- Dynamically loaded past invoices -->
                <div class="empty-history">لا توجد فواتير محفوظة بعد.</div>
            </div>
            
            <div class="sidebar-footer">
                <button class="btn btn-danger btn-block" id="clear-all-history">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="btn-icon">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                    مسح كافة السجلات
                </button>
            </div>
        </aside>

        <!-- Sidebar Trigger Button (when sidebar is closed) -->
        <button class="sidebar-trigger no-print" id="sidebar-trigger" title="عرض السجل">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="3" y1="12" x2="21" y2="12"></line>
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
            <span class="badge" id="history-badge">0</span>
        </button>

        <!-- Main Workspace -->
        <main class="main-content">
            <!-- Header -->
            <header class="main-header no-print">
                <div class="header-title">
                    <h1>منظومة الحجوزات والفواتير</h1>
                    <p class="subtitle">متجر دافينشي - DaVinci Store</p>
                </div>
                <div class="header-actions">
                    <button class="btn btn-secondary" id="btn-new-invoice">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="btn-icon">
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                        حجز جديد
                    </button>
                </div>
            </header>

            <div class="workspace-grid">
                <!-- Left Panel: Form Input (no-print) -->
                <section class="form-panel no-print">
                    <div class="card">
                        <div class="card-header">
                            <h2 class="card-title">بيانات الحجز والزبون</h2>
                        </div>
                        <div class="card-body">
                            <form id="invoice-form" autocomplete="off">
                                <!-- Order Metadata -->
                                <div class="form-row">
                                    <div class="form-group col-6">
                                        <label for="invoice-id">رقم الفاتورة</label>
                                        <input type="text" id="invoice-id" readonly>
                                    </div>
                                    <div class="form-group col-6">
                                        <label for="invoice-date">تاريخ الحجز</label>
                                        <input type="datetime-local" id="invoice-date" required>
                                    </div>
                                </div>

                                <!-- Customer Details -->
                                <div class="form-group">
                                    <label for="customer-name">اسم الزبون بالكامل <span class="required">*</span></label>
                                    <input type="text" id="customer-name" placeholder="أدخل اسم الزبون..." required>
                                </div>

                                <div class="form-row">
                                    <div class="form-group col-6">
                                        <label for="customer-phone">رقم الهاتف <span class="required">*</span></label>
                                        <input type="tel" id="customer-phone" placeholder="09XXXXXXXX" required pattern="[0-9]{9,10}">
                                    </div>
                                    <div class="form-group col-6">
                                        <label for="customer-city">المدينة <span class="required">*</span></label>
                                        <select id="customer-city" required>
                                            <option value="" disabled selected>اختر المدينة...</option>
                                            <optgroup label="المنطقة الغربية">
                                                <option value="طرابلس">طرابلس (توصيل 15 د.ل)</option>
                                                <option value="جنزور">جنزور (توصيل 15 د.ل)</option>
                                                <option value="الزاوية">الزاوية</option>
                                                <option value="صبراتة">صبراتة</option>
                                                <option value="صرمان">صرمان</option>
                                                <option value="الخمس">الخمس</option>
                                                <option value="زليتن">زليتن</option>
                                                <option value="مصراتة">مصراتة</option>
                                                <option value="غريان">غريان</option>
                                                <option value="ترهونة">ترهونة</option>
                                                <option value="مسلاتة">مسلاتة</option>
                                            </optgroup>
                                            <optgroup label="المنطقة الشرقية">
                                                <option value="بنغازي">بنغازي</option>
                                                <option value="البيضاء">البيضاء</option>
                                                <option value="طبرق">طبرق</option>
                                                <option value="اجدابيا">اجدابيا</option>
                                                <option value="درنة">درنة</option>
                                            </optgroup>
                                            <optgroup label="المنطقة الجنوبية">
                                                <option value="سبها">سبها</option>
                                                <option value="أوباري">أوباري</option>
                                                <option value="غـات">غـات</option>
                                            </optgroup>
                                        </select>
                                    </div>
                                </div>

                                <div class="form-group">
                                    <label for="customer-address">العنوان التفصيلي / ملاحظات التوصيل</label>
                                    <textarea id="customer-address" rows="2" placeholder="المنطقة، أقرب نقطة دالة، شارع..."></textarea>
                                </div>

                                <!-- Dynamic Items Area -->
                                <div class="items-section">
                                    <div class="section-header">
                                        <h3 class="section-title">تفاصيل الطلبية والمنتجات</h3>
                                        <button type="button" class="btn btn-sm btn-primary-outline" id="add-item-btn">
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="btn-icon-sm">
                                                <line x1="12" y1="5" x2="12" y2="19"></line>
                                                <line x1="5" y1="12" x2="19" y2="12"></line>
                                            </svg>
                                            إضافة منتج
                                        </button>
                                    </div>
                                    
                                    <div class="items-list-container">
                                        <table class="form-items-table" id="form-items-table">
                                            <thead>
                                                <tr>
                                                    <th>اسم المنتج</th>
                                                    <th style="width: 80px;">الكمية</th>
                                                    <th style="width: 120px;">السعر (د.ل)</th>
                                                    <th style="width: 110px;">الإجمالي</th>
                                                    <th style="width: 50px;"></th>
                                                </tr>
                                            </thead>
                                            <tbody id="form-items-tbody">
                                                <!-- Row template injected by JS -->
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                <!-- Finances -->
                                <div class="finance-grid">
                                    <div class="form-group">
                                        <label for="shipping-fee">قيمة التوصيل (د.ل)</label>
                                        <input type="number" id="shipping-fee" min="0" value="0">
                                    </div>
                                    <div class="form-group">
                                        <label for="discount">قيمة الخصم (د.ل)</label>
                                        <input type="number" id="discount" min="0" value="0">
                                    </div>
                                    <div class="form-group">
                                        <label for="order-status">حالة الحجز</label>
                                        <select id="order-status">
                                            <option value="قيد الانتظار">قيد الانتظار</option>
                                            <option value="تم التأكيد">تم التأكيد</option>
                                            <option value="تم الشحن">تم الشحن</option>
                                            <option value="تم التوصيل">تم التوصيل</option>
                                            <option value="ملغي">ملغي</option>
                                        </select>
                                    </div>
                                    <div class="form-group">
                                        <label for="payment-method">طريقة الدفع</label>
                                        <select id="payment-method">
                                            <option value="كاش" selected>كاش عند الاستلام</option>
                                            <option value="بطاقة">دفع بالبطاقة المصرفية</option>
                                            <option value="كاش + بطاقة">مبلغ كاش وباقيه بطاقة</option>
                                            <option value="حوالة مصرفية">حوالة مصرفية</option>
                                        </select>
                                    </div>
                                </div>

                                <!-- Cash + Card Details Row -->
                                <div class="form-row" id="mixed-payment-inputs" style="display: none; margin-bottom: 20px;">
                                    <div class="form-group col-6">
                                        <label for="payment-cash-part">القيمة الكاش (د.ل)</label>
                                        <input type="number" id="payment-cash-part" min="0" value="0">
                                    </div>
                                    <div class="form-group col-6">
                                        <label for="payment-card-part">القيمة بالبطاقة (د.ل)</label>
                                        <input type="number" id="payment-card-part" min="0" value="0">
                                    </div>
                                </div>

                                <!-- Submit Action buttons -->
                                <div class="form-actions-footer">
                                    <button type="submit" class="btn btn-primary btn-lg" id="btn-save-print">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="btn-icon">
                                            <polyline points="6 9 6 2 18 2 18 9"></polyline>
                                            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                                            <rect x="6" y="14" width="12" height="8"></rect>
                                        </svg>
                                        حفظ الفاتورة وطباعتها
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </section>

                <!-- Right Panel: Live Invoice Preview -->
                <section class="preview-panel">
                    <div class="preview-toolbar no-print">
                        <span class="preview-badge">معاينة مباشرة للفاتورة المطبوعة</span>
                        <button class="btn btn-sm btn-secondary" id="btn-full-preview" title="طباعة مباشرة">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="btn-icon-sm">
                                <polyline points="6 9 6 2 18 2 18 9"></polyline>
                                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                                <rect x="6" y="14" width="12" height="8"></rect>
                            </svg>
                            طباعة المعاينة
                        </button>
                    </div>

                    <!-- Printable A4 Area -->
                    <div class="invoice-paper" id="invoice-paper">
                        <!-- Invoice Header -->
                        <div class="invoice-print-header">
                            <div class="brand-info">
                                <div class="brand-logo">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                        <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5"></polygon>
                                        <line x1="12" y1="22" x2="12" y2="12"></line>
                                        <line x1="12" y1="12" x2="22" y2="8.5"></line>
                                        <line x1="12" y1="12" x2="2" y2="8.5"></line>
                                        <polyline points="22 8.5 12 5 2 8.5"></polyline>
                                        <polyline points="2 15.5 12 12 22 15.5"></polyline>
                                    </svg>
                                </div>
                                <div class="brand-text">
                                    <span class="brand-name">دافينشي ستور</span>
                                    <span class="brand-slogan">DaVinci Store</span>
                                </div>
                            </div>
                            <div class="invoice-title-block">
                                <h1 class="print-title">فاتورة مبيعات</h1>
                                <div class="invoice-meta-item">
                                    <span class="meta-label">رقم الفاتورة:</span>
                                    <span class="meta-val" id="prev-invoice-id">DV-00000</span>
                                </div>
                                <div class="invoice-meta-item">
                                    <span class="meta-label">تاريخ الإصدار:</span>
                                    <span class="meta-val" id="prev-invoice-date">--/--/----</span>
                                </div>
                            </div>
                        </div>

                        <hr class="divider">

                        <!-- Client Info & Order Metadata Grid -->
                        <div class="invoice-details-grid">
                            <div class="detail-section">
                                <h3 class="detail-title">المرسل إليه (الزبون)</h3>
                                <div class="detail-row">
                                    <span class="detail-label">الاسم:</span>
                                    <span class="detail-val" id="prev-customer-name">......................................................</span>
                                </div>
                                <div class="detail-row">
                                    <span class="detail-label">الهاتف:</span>
                                    <span class="detail-val" id="prev-customer-phone">......................................................</span>
                                </div>
                                <div class="detail-row">
                                    <span class="detail-label">المدينة:</span>
                                    <span class="detail-val text-bold" id="prev-customer-city">......................................................</span>
                                </div>
                                <div class="detail-row">
                                    <span class="detail-label">العنوان/ملاحظات:</span>
                                    <span class="detail-val" id="prev-customer-address">......................................................</span>
                                </div>
                            </div>
                            <div class="detail-section left-align-desktop">
                                <h3 class="detail-title">معلومات الدفع والتوصيل</h3>
                                <div class="detail-row">
                                    <span class="detail-label">نوع الطلب:</span>
                                    <span class="detail-val">شحن وتوصيل محلي</span>
                                </div>
                                <div class="detail-row">
                                    <span class="detail-label">طريقة الدفع:</span>
                                    <span class="detail-val text-bold" id="prev-payment-method">كاش عند الاستلام</span>
                                </div>
                                <div id="prev-payment-details"></div>
                                <div class="detail-row">
                                    <span class="detail-label">حالة الحجز:</span>
                                    <span class="status-pill-print" id="prev-order-status">قيد الانتظار</span>
                                </div>
                            </div>
                        </div>

                        <!-- Invoice Items Table -->
                        <div class="print-table-container">
                            <table class="print-invoice-table">
                                <thead>
                                    <tr>
                                        <th style="width: 6%;">#</th>
                                        <th style="text-align: right;">البيان (المنتج)</th>
                                        <th style="width: 12%; text-align: center;">الكمية</th>
                                        <th style="width: 20%; text-align: center;">السعر الفردي</th>
                                        <th style="width: 22%; text-align: left;">الإجمالي</th>
                                    </tr>
                                </thead>
                                <tbody id="prev-items-tbody">
                                    <!-- Items injected dynamically -->
                                    <tr>
                                        <td colspan="5" class="empty-table-placeholder">لم يتم تحديد أي منتجات بعد</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        <!-- Total Calculations Block -->
                        <div class="invoice-summary-block">
                            <div class="summary-line">
                                <span class="summary-label">المجموع الفرعي:</span>
                                <span class="summary-val" id="prev-subtotal">0.00 د.ل</span>
                            </div>
                            <div class="summary-line">
                                <span class="summary-label">قيمة التوصيل:</span>
                                <span class="summary-val" id="prev-shipping-fee">+ 0.00 د.ل</span>
                            </div>
                            <div class="summary-line text-danger-print" id="prev-discount-line" style="display: none;">
                                <span class="summary-label">الخصم الممنوح:</span>
                                <span class="summary-val" id="prev-discount">- 0.00 د.ل</span>
                            </div>
                            <div class="summary-line grand-total">
                                <span class="summary-label">إجمالي المطلوب دفعه:</span>
                                <span class="summary-val" id="prev-grand-total">0.00 د.ل</span>
                            </div>
                        </div>

                        <!-- Invoice Footer / Terms -->
                        <div class="invoice-print-footer">
                            <div class="thank-you-msg">شكراً لتسوقكم من دافينشي ستور - DaVinci Store!</div>
                            <div style="font-size: 8pt; font-weight: 700; text-align: center; margin-top: 3px; color: #000000 !important;">هاتف خدمة العملاء: 0924202921</div>
                        </div>
                    </div>
                </section>
            </div>
        </main>
    </div>

    <!-- Scripts -->
    <script>
// Application State & Database Sync Manager
const AppState = {
    invoices: [],
    currentInvoiceId: null,
    
    // Load invoices from database (syncing across devices)
    async loadInvoices() {
        try {
            const res = await fetch('/api/booking?action=list');
            if (res.ok) {
                this.invoices = await res.json();
                // Update local storage backup
                try {
                    localStorage.setItem('davinci_invoices', JSON.stringify(this.invoices));
                } catch (e) {}
            } else {
                throw new Error("Server responded with error status");
            }
        } catch (e) {
            console.warn('Database connection failed, falling back to localStorage:', e);
            // Fallback to local storage if server is down
            try {
                const data = localStorage.getItem('davinci_invoices');
                this.invoices = data ? JSON.parse(data) : [];
            } catch (err) {
                this.invoices = [];
            }
        }
        this.renderHistoryList();
    },
    
    // Save single invoice (Sync to database)
    async saveInvoice(invoice) {
        // Optimistic UI update: show in list immediately
        const index = this.invoices.findIndex(inv => inv.id === invoice.id);
        if (index > -1) {
            this.invoices[index] = invoice;
        } else {
            this.invoices.push(invoice);
        }
        this.renderHistoryList();

        // Local storage backup
        try {
            localStorage.setItem('davinci_invoices', JSON.stringify(this.invoices));
        } catch (e) {}

        // Send to remote database
        try {
            const res = await fetch('/api/booking?action=save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(invoice)
            });
            if (res.ok) {
                // Fetch fresh copy to ensure correct sorting and ID verification
                await this.loadInvoices();
            }
        } catch (e) {
            console.error('Error saving to server database:', e);
        }
    },
    
    // Delete single invoice (Sync to database)
    async deleteInvoice(id) {
        // Optimistic UI update
        this.invoices = this.invoices.filter(inv => inv.id !== id);
        this.renderHistoryList();

        // Local storage backup
        try {
            localStorage.setItem('davinci_invoices', JSON.stringify(this.invoices));
        } catch (e) {}

        try {
            const res = await fetch(\`/api/booking?action=delete&id=\${id}\`, {
                method: 'POST'
            });
            if (res.ok) {
                await this.loadInvoices();
            }
        } catch (e) {
            console.error('Error deleting from server database:', e);
        }
    },
    
    // Clear all history
    async clearAll() {
        this.invoices = [];
        this.renderHistoryList();

        try {
            localStorage.removeItem('davinci_invoices');
        } catch (e) {}

        try {
            const res = await fetch('/api/booking?action=clear', {
                method: 'POST'
            });
            if (res.ok) {
                await this.loadInvoices();
            }
        } catch (e) {
            console.error('Error clearing server database:', e);
        }
    },

    // Generate unique Invoice ID (DV-YYMMDD-XXXX)
    generateInvoiceId() {
        const date = new Date();
        const yy = String(date.getFullYear()).slice(-2);
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        const rand = String(Math.floor(1000 + Math.random() * 9000));
        return \`DV-\${yy}\${mm}\${dd}-\${rand}\`;
    },

    // Render Past Invoices List in Sidebar
    renderHistoryList(filterQuery = '') {
        const listContainer = document.getElementById('invoice-list');
        const badge = document.getElementById('history-badge');
        
        listContainer.innerHTML = '';
        
        // Filter invoices based on search query
        const query = filterQuery.trim().toLowerCase();
        const filtered = this.invoices.filter(inv => {
            return (
                inv.customerName.toLowerCase().includes(query) ||
                inv.customerPhone.includes(query) ||
                inv.id.toLowerCase().includes(query) ||
                inv.customerCity.toLowerCase().includes(query)
            );
        }).sort((a, b) => new Date(b.date) - new Date(a.date)); // Newest first

        badge.textContent = this.invoices.length;

        if (filtered.length === 0) {
            listContainer.innerHTML = filterQuery 
                ? '<div class="empty-history">لا توجد نتائج مطابقة للبحث.</div>'
                : '<div class="empty-history">لا توجد فواتير محفوظة بعد.</div>';
            return;
        }

        filtered.forEach(inv => {
            const item = document.createElement('div');
            item.className = \`history-item \${inv.id === this.currentInvoiceId ? 'active' : ''}\`;
            item.setAttribute('data-id', inv.id);
            
            // Format status badge class
            let statusClass = 'status-pending';
            if (inv.status === 'تم التأكيد') statusClass = 'status-confirmed';
            if (inv.status === 'تم الشحن') statusClass = 'status-shipped';
            if (inv.status === 'تم التوصيل') statusClass = 'status-delivered';
            if (inv.status === 'ملغي') statusClass = 'status-cancelled';

            // Format date for display
            const formattedDate = new Date(inv.date).toLocaleDateString('ar-LY', {
                year: 'numeric',
                month: 'numeric',
                day: 'numeric'
            });

            item.innerHTML = \`
                <button class="history-item-delete-btn" title="حذف الفاتورة" data-delete-id="\${inv.id}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
                <div class="history-item-header">
                    <span class="history-item-id">\${inv.id}</span>
                    <span class="history-item-date">\${formattedDate}</span>
                </div>
                <div class="history-item-name">\${inv.customerName}</div>
                <div class="history-item-phone">\${inv.customerPhone} - \${inv.customerCity}</div>
                <div class="history-item-footer">
                    <span class="history-item-total">\${Number(inv.grandTotal).toFixed(2)} د.ل</span>
                    <span class="status-badge \${statusClass}">\${inv.status}</span>
                </div>
            \`;
            
            // Click to load invoice
            item.addEventListener('click', (e) => {
                if (e.target.closest('.history-item-delete-btn')) return;
                this.loadInvoiceIntoForm(inv.id);
            });

            // Click delete button
            const delBtn = item.querySelector('.history-item-delete-btn');
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm(\`هل أنت متأكد من حذف الفاتورة \${inv.id}؟\`)) {
                    this.deleteInvoice(inv.id);
                    if (this.currentInvoiceId === inv.id) {
                        document.getElementById('btn-new-invoice').click();
                    }
                }
            });

            listContainer.appendChild(item);
        });
    },

    // Load invoice details into form and preview
    loadInvoiceIntoForm(id) {
        const inv = this.invoices.find(item => item.id === id);
        if (!inv) return;

        this.currentInvoiceId = id;
        
        document.getElementById('invoice-id').value = inv.id;
        document.getElementById('invoice-date').value = inv.date;
        document.getElementById('customer-name').value = inv.customerName;
        document.getElementById('customer-phone').value = inv.customerPhone;
        document.getElementById('customer-city').value = inv.customerCity;
        document.getElementById('customer-address').value = inv.customerAddress;
        document.getElementById('shipping-fee').value = inv.shippingFee;
        document.getElementById('discount').value = inv.discount;
        document.getElementById('order-status').value = inv.status;
        
        // Load payment inputs
        const payMethod = inv.paymentMethod || 'كاش';
        document.getElementById('payment-method').value = payMethod;
        document.getElementById('payment-cash-part').value = inv.paymentCashPart || 0;
        document.getElementById('payment-card-part').value = inv.paymentCardPart || 0;

        // Toggle visibility of mixed payment inputs based on selected method
        const mixedInputs = document.getElementById('mixed-payment-inputs');
        if (payMethod === 'كاش + بطاقة') {
            mixedInputs.style.display = 'flex';
        } else {
            mixedInputs.style.display = 'none';
        }

        // Clear existing product rows
        const tbody = document.getElementById('form-items-tbody');
        tbody.innerHTML = '';

        // Add saved product rows
        inv.items.forEach(item => {
            addProductRow(item.name, item.qty, item.price);
        });

        // Recalculate and update interface
        calculateAndSync();
        
        // Highlight active sidebar item
        document.querySelectorAll('.history-item').forEach(el => {
            el.classList.remove('active');
            if (el.getAttribute('data-id') === id) {
                el.classList.add('active');
            }
        });
    }
};

// Default delivery rates based on Libyan city selection
const shippingRates = {
    'طرابلس': 15,
    'جنزور': 15,
    'الزاوية': 25,
    'صبراتة': 25,
    'صرمان': 25,
    'الخمس': 25,
    'زليتن': 25,
    'مصراتة': 25,
    'غريان': 25,
    'ترهونة': 25,
    'مسلاتة': 25,
    'بنغازي': 25,
    'البيضاء': 25,
    'طبرق': 25,
    'اجدابيا': 25,
    'درنة': 25,
    'سبها': 25,
    'أوباري': 25,
    'غـات': 25
};

// Form Row Builder for dynamic products
function addProductRow(name = '', qty = 1, price = 0) {
    const tbody = document.getElementById('form-items-tbody');
    const tr = document.createElement('tr');
    tr.className = 'form-item-row';
    
    tr.innerHTML = \`
        <td>
            <input type="text" class="form-item-name" placeholder="مثال: ساعة ذكية..." value="\${name}" required>
        </td>
        <td>
            <input type="number" class="form-item-qty" min="1" value="\${qty}" required style="text-align: center;">
        </td>
        <td>
            <input type="number" class="form-item-price" min="0" value="\${price}" step="0.5" required style="text-align: center;">
        </td>
        <td>
            <span class="form-item-row-total">\${Number(qty * price).toFixed(2)}</span>
        </td>
        <td style="text-align: center;">
            <button type="button" class="delete-row-btn" title="حذف السطر">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        </td>
    \`;

    // Row input listeners for live row-totals
    const qtyInput = tr.querySelector('.form-item-qty');
    const priceInput = tr.querySelector('.form-item-price');
    const rowTotal = tr.querySelector('.form-item-row-total');
    const nameInput = tr.querySelector('.form-item-name');

    const updateRowTotal = () => {
        const q = parseFloat(qtyInput.value) || 0;
        const p = parseFloat(priceInput.value) || 0;
        rowTotal.textContent = Number(q * p).toFixed(2);
        calculateAndSync();
    };

    qtyInput.addEventListener('input', updateRowTotal);
    priceInput.addEventListener('input', updateRowTotal);
    nameInput.addEventListener('input', calculateAndSync);

    // Delete row event
    tr.querySelector('.delete-row-btn').addEventListener('click', () => {
        const rowCount = tbody.querySelectorAll('tr').length;
        if (rowCount > 1) {
            tr.remove();
            calculateAndSync();
        } else {
            alert('يجب أن تحتوي الفاتورة على منتج واحد على الأقل.');
        }
    });

    tbody.appendChild(tr);
}

// Calculate entire invoice amounts and synchronize inputs to Print Preview
function calculateAndSync() {
    // 1. Text Details
    const invoiceId = document.getElementById('invoice-id').value;
    const invoiceDateVal = document.getElementById('invoice-date').value;
    const name = document.getElementById('customer-name').value;
    const phone = document.getElementById('customer-phone').value;
    const city = document.getElementById('customer-city').value;
    const address = document.getElementById('customer-address').value;
    const status = document.getElementById('order-status').value;
    
    const paymentMethod = document.getElementById('payment-method').value;
    const cashPart = parseFloat(document.getElementById('payment-cash-part').value) || 0;
    const cardPart = parseFloat(document.getElementById('payment-card-part').value) || 0;

    // Set preview details, fallback to dotted placeholders if empty
    document.getElementById('prev-invoice-id').textContent = invoiceId || 'DV-00000';
    
    if (invoiceDateVal) {
        const formattedDate = new Date(invoiceDateVal).toLocaleString('ar-LY', {
            year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        document.getElementById('prev-invoice-date').textContent = formattedDate;
    } else {
        document.getElementById('prev-invoice-date').textContent = '--/--/----';
    }

    document.getElementById('prev-customer-name').textContent = name || '......................................................';
    document.getElementById('prev-customer-phone').textContent = phone || '......................................................';
    document.getElementById('prev-customer-city').textContent = city || '......................................................';
    document.getElementById('prev-customer-address').textContent = address || '......................................................';
    
    // Status text mapping inside preview
    const prevStatusEl = document.getElementById('prev-order-status');
    prevStatusEl.textContent = status;
    
    // Remove old classes and add current status representation for preview
    prevStatusEl.className = 'status-pill-print';
    if (status === 'قيد الانتظار') prevStatusEl.style.borderColor = 'var(--warning)';
    else if (status === 'تم التأكيد') prevStatusEl.style.borderColor = 'var(--primary)';
    else if (status === 'تم الشحن') prevStatusEl.style.borderColor = 'var(--accent)';
    else if (status === 'تم التوصيل') prevStatusEl.style.borderColor = 'var(--success)';
    else if (status === 'ملغي') prevStatusEl.style.borderColor = 'var(--danger)';

    // Update payment method view
    const prevPayMethod = document.getElementById('prev-payment-method');
    const prevPayDetails = document.getElementById('prev-payment-details');
    prevPayDetails.innerHTML = '';

    if (paymentMethod === 'كاش') {
        prevPayMethod.textContent = 'نقداً عند الاستلام (كاش)';
    } else if (paymentMethod === 'بطاقة') {
        prevPayMethod.textContent = 'دفع بالبطاقة المصرفية';
    } else if (paymentMethod === 'حوالة مصرفية') {
        prevPayMethod.textContent = 'حوالة مصرفية';
    } else if (paymentMethod === 'كاش + بطاقة') {
        prevPayMethod.textContent = 'دفع مختلط (كاش + بطاقة)';
        prevPayDetails.innerHTML = \`
            <div class="detail-row">
                <span class="detail-label">المدفوع كاش:</span>
                <span class="detail-val text-bold">\${cashPart.toFixed(2)} د.ل</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">بالبطاقة:</span>
                <span class="detail-val text-bold">\${cardPart.toFixed(2)} د.ل</span>
            </div>
        \`;
    }

    // 2. Products Lines Calculator
    const formRows = document.querySelectorAll('#form-items-tbody tr');
    const previewTbody = document.getElementById('prev-items-tbody');
    previewTbody.innerHTML = '';

    let subtotal = 0;
    let itemsCount = 0;

    formRows.forEach((row, idx) => {
        const prodName = row.querySelector('.form-item-name').value;
        const qty = parseFloat(row.querySelector('.form-item-qty').value) || 0;
        const price = parseFloat(row.querySelector('.form-item-price').value) || 0;
        const rowSum = qty * price;

        subtotal += rowSum;

        if (prodName) {
            itemsCount++;
            const tr = document.createElement('tr');
            tr.innerHTML = \`
                <td style="text-align: center; color: #64748b; font-family: var(--font-en);">\${idx + 1}</td>
                <td style="font-weight: 600;">\${prodName}</td>
                <td style="text-align: center; font-family: var(--font-en);">\${qty}</td>
                <td style="text-align: center; font-family: var(--font-en);">\${Number(price).toFixed(2)} د.ل</td>
                <td style="text-align: left; font-weight: 700; font-family: var(--font-en);">\${Number(rowSum).toFixed(2)} د.ل</td>
            \`;
            previewTbody.appendChild(tr);
        }
    });

    if (itemsCount === 0) {
        previewTbody.innerHTML = \`
            <tr>
                <td colspan="5" class="empty-table-placeholder">لم يتم إضافة منتجات أو تفاصيل بعد</td>
            </tr>
        \`;
    }

    // 3. Finances Details
    const shippingFee = parseFloat(document.getElementById('shipping-fee').value) || 0;
    const discount = parseFloat(document.getElementById('discount').value) || 0;
    const grandTotal = subtotal + shippingFee - discount;

    document.getElementById('prev-subtotal').textContent = \`\${Number(subtotal).toFixed(2)} د.ل\`;
    document.getElementById('prev-shipping-fee').textContent = \`+ \${Number(shippingFee).toFixed(2)} د.ل\`;
    
    const prevDiscountLine = document.getElementById('prev-discount-line');
    if (discount > 0) {
        document.getElementById('prev-discount').textContent = \`- \${Number(discount).toFixed(2)} د.ل\`;
        prevDiscountLine.style.display = 'flex';
    } else {
        prevDiscountLine.style.display = 'none';
    }
    
    document.getElementById('prev-grand-total').textContent = \`\${Number(grandTotal).toFixed(2)} د.ل\`;

    return {
        subtotal,
        shippingFee,
        discount,
        grandTotal
    };
}

// Reset form and generate fresh invoice state
function resetInvoiceForm() {
    const today = new Date();
    // Offset local timezone date
    const offset = today.getTimezoneOffset() * 60000;
    const localISODate = new Date(today.getTime() - offset).toISOString().slice(0, 16);

    AppState.currentInvoiceId = AppState.generateInvoiceId();
    document.getElementById('invoice-id').value = AppState.currentInvoiceId;
    document.getElementById('invoice-date').value = localISODate;
    document.getElementById('customer-name').value = '';
    document.getElementById('customer-phone').value = '';
    document.getElementById('customer-city').value = '';
    document.getElementById('customer-address').value = '';
    document.getElementById('shipping-fee').value = 0;
    document.getElementById('discount').value = 0;
    document.getElementById('order-status').value = 'قيد الانتظار';
    
    // Reset payment fields
    document.getElementById('payment-method').value = 'كاش';
    document.getElementById('payment-cash-part').value = 0;
    document.getElementById('payment-card-part').value = 0;
    document.getElementById('mixed-payment-inputs').style.display = 'none';

    // Clear dynamic products table and add one initial row
    document.getElementById('form-items-tbody').innerHTML = '';
    addProductRow('', 1, 0);
    
    calculateAndSync();

    // Remove active markers in history sidebar
    document.querySelectorAll('.history-item').forEach(el => el.classList.remove('active'));
}

// Event Listeners initialization on DOM Content Loaded
document.addEventListener('DOMContentLoaded', () => {
    // 1. Initial State Load
    AppState.loadInvoices();
    resetInvoiceForm();

    // 2. City Shipping rate triggers
    const citySelect = document.getElementById('customer-city');
    citySelect.addEventListener('change', () => {
        const selectedCity = citySelect.value;
        const suggestedFee = shippingRates[selectedCity] || 25;
        document.getElementById('shipping-fee').value = suggestedFee;
        calculateAndSync();
    });

    // 3. Payment Method triggers
    const paymentMethodSelect = document.getElementById('payment-method');
    paymentMethodSelect.addEventListener('change', () => {
        const method = paymentMethodSelect.value;
        const mixedInputs = document.getElementById('mixed-payment-inputs');
        if (method === 'كاش + بطاقة') {
            mixedInputs.style.display = 'flex';
        } else {
            mixedInputs.style.display = 'none';
        }
        calculateAndSync();
    });

    // 4. Live Form input bindings
    const bindableElements = [
        'customer-name', 'customer-phone', 'customer-address',
        'shipping-fee', 'discount', 'invoice-date', 'order-status',
        'payment-cash-part', 'payment-card-part'
    ];
    bindableElements.forEach(id => {
        document.getElementById(id).addEventListener('input', calculateAndSync);
    });

    // 5. Products table row builder triggers
    document.getElementById('add-item-btn').addEventListener('click', () => {
        addProductRow('', 1, 0);
        calculateAndSync();
    });

    // 6. Save and Print Form submit trigger
    const form = document.getElementById('invoice-form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        // Grab values and compute
        const financialData = calculateAndSync();
        
        // Items collection
        const items = [];
        document.querySelectorAll('#form-items-tbody tr').forEach(row => {
            const name = row.querySelector('.form-item-name').value;
            const qty = parseFloat(row.querySelector('.form-item-qty').value) || 0;
            const price = parseFloat(row.querySelector('.form-item-price').value) || 0;
            if (name) {
                items.push({ name, qty, price });
            }
        });

        if (items.length === 0) {
            alert('الرجاء كتابة اسم منتج واحد على الأقل.');
            return;
        }

        // Build invoice database payload
        const invoiceData = {
            id: document.getElementById('invoice-id').value,
            date: document.getElementById('invoice-date').value,
            customerName: document.getElementById('customer-name').value,
            customerPhone: document.getElementById('customer-phone').value,
            customerCity: document.getElementById('customer-city').value,
            customerAddress: document.getElementById('customer-address').value,
            shippingFee: financialData.shippingFee,
            discount: financialData.discount,
            status: document.getElementById('order-status').value,
            paymentMethod: document.getElementById('payment-method').value,
            paymentCashPart: parseFloat(document.getElementById('payment-cash-part').value) || 0,
            paymentCardPart: parseFloat(document.getElementById('payment-card-part').value) || 0,
            items: items,
            subtotal: financialData.subtotal,
            grandTotal: financialData.grandTotal
        };

        // Save to Database (Sync) and WAIT for the sync HTTP request to complete
        await AppState.saveInvoice(invoiceData);
        
        // Open print dialog
        window.print();
    });

    // 7. Print Only Toolbar Button
    document.getElementById('btn-full-preview').addEventListener('click', () => {
        window.print();
    });

    // 8. Reset Form / New Booking trigger
    document.getElementById('btn-new-invoice').addEventListener('click', () => {
        resetInvoiceForm();
    });

    // 9. Search History sidebar
    const searchInput = document.getElementById('search-invoice');
    searchInput.addEventListener('input', () => {
        AppState.renderHistoryList(searchInput.value);
    });

    // 10. Clear All History
    document.getElementById('clear-all-history').addEventListener('click', () => {
        if (confirm('هل أنت متأكد من مسح جميع الفواتير والحجوزات المحفوظة نهائياً؟ لا يمكن استرجاع البيانات!')) {
            AppState.clearAll();
            resetInvoiceForm();
        }
    });

    // 11. Sidebar visibility toggles
    const sidebar = document.getElementById('sidebar');
    const closeSidebarBtn = document.getElementById('toggle-sidebar-close');
    const openSidebarBtn = document.getElementById('sidebar-trigger');

    closeSidebarBtn.addEventListener('click', () => {
        sidebar.classList.add('collapsed');
    });

    openSidebarBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
    });
});

</script>
</body>
</html>

`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
};
