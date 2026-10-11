const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

const getCafes = () => {
    const data = fs.readFileSync('cafes.json', 'utf8');
    return JSON.parse(data);
};

const saveCafes = (data) => {
    fs.writeFileSync('cafes.json', JSON.stringify(data, null, 2), 'utf8');
};

app.get('/', (req, res) => {
    res.redirect('/mangal');
});

app.get('/admin/:cafeSlug', (req, res) => {
    const cafes = getCafes();
    if (!cafes[req.params.cafeSlug]) return res.status(404).send('Kafe tapılmadı!');
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/:cafeSlug', (req, res) => {
    const cafes = getCafes();
    if (!cafes[req.params.cafeSlug]) return res.status(404).send('Kafe tapılmadı!');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/menu/:cafeSlug', (req, res) => {
    const cafes = getCafes();
    const cafe = cafes[req.params.cafeSlug];
    if (!cafe) return res.status(404).json({ error: 'Kafe tapılmadı' });
    res.json(cafe);
});

// 🖨️ Stol nömrəsinə uyğun QR Kod yaratmaq üçün API
app.get('/api/admin/qrcode/:cafeSlug', async (req, res) => {
    try {
        const cafeSlug = req.params.cafeSlug;
        const table = req.query.table || '1';
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const protocol = req.headers['x-forwarded-proto'] || 'http';
        
        const menuUrl = `${protocol}://${host}/${cafeSlug}?table=${table}`;

        const qrImage = await QRCode.toDataURL(menuUrl);
        res.json({ success: true, qrImage, menuUrl });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.put('/api/admin/banner/:cafeSlug', (req, res) => {
    const cafes = getCafes();
    const cafeSlug = req.params.cafeSlug;
    if (!cafes[cafeSlug]) return res.status(404).json({ success: false, error: 'Kafe tapılmadı' });

    const { active, text, link, image } = req.body;
    cafes[cafeSlug].adBanner = { active, text, link, image };
    saveCafes(cafes);

    res.json({ success: true, adBanner: cafes[cafeSlug].adBanner });
});

app.post('/api/admin/menu/:cafeSlug', (req, res) => {
    const cafes = getCafes();
    const cafeSlug = req.params.cafeSlug;
    if (!cafes[cafeSlug]) return res.status(404).json({ success: false, error: 'Kafe tapılmadı' });

    const { name, description, price, category, image, available } = req.body;
    if (!name || !price) return res.status(400).json({ success: false, error: 'Məlumatlar tam deyil!' });

    const newItem = {
        id: Date.now(),
        category: category || 'Ümumi',
        image: image || '',
        name,
        description: description || { az: '', ru: '', kk: '', en: '' },
        price: Number(price),
        available: available !== undefined ? available : true
    };

    cafes[cafeSlug].menu.push(newItem);
    saveCafes(cafes);

    res.json({ success: true, item: newItem });
});

app.put('/api/admin/menu/:cafeSlug/:id', (req, res) => {
    const cafes = getCafes();
    const cafeSlug = req.params.cafeSlug;
    const itemId = Number(req.params.id);

    if (!cafes[cafeSlug]) return res.status(404).json({ success: false, error: 'Kafe tapılmadı' });

    const { name, description, price, category, image, available } = req.body;
    const menu = cafes[cafeSlug].menu;
    const itemIndex = menu.findIndex(i => i.id === itemId);

    if (itemIndex === -1) return res.status(404).json({ success: false, error: 'Yemək tapılmadı' });

    if (name) menu[itemIndex].name = name;
    if (description) menu[itemIndex].description = description;
    if (price) menu[itemIndex].price = Number(price);
    if (category) menu[itemIndex].category = category;
    if (image !== undefined) menu[itemIndex].image = image;
    if (available !== undefined) menu[itemIndex].available = available;

    saveCafes(cafes);
    res.json({ success: true, item: menu[itemIndex] });
});

app.delete('/api/admin/menu/:cafeSlug/:id', (req, res) => {
    const cafes = getCafes();
    const cafeSlug = req.params.cafeSlug;
    const itemId = Number(req.params.id);

    if (!cafes[cafeSlug]) return res.status(404).json({ success: false, error: 'Kafe tapılmadı' });

    cafes[cafeSlug].menu = cafes[cafeSlug].menu.filter(i => i.id !== itemId);
    saveCafes(cafes);
    res.json({ success: true });
});

app.post('/api/order/:cafeSlug', async (req, res) => {
    try {
        const cafes = getCafes();
        const cafe = cafes[req.params.cafeSlug];
        if (!cafe) return res.status(404).json({ success: false, error: 'Kafe tapılmadı' });

        const tableNumber = req.body.tableNumber || 1;
        const { items, totalPrice } = req.body;
        
        // Səhv düzəldildi: \n əvəzinə * qoyuldu
        let itemsText = items.map(item => `• ${item.count}x ${item.name} (${item.price * item.count} KZT)`).join('\n');

        const message = `🔔 YENİ SİFARİŞ - ${cafe.name}!\n📍 Masa №${tableNumber}\n\nSifarişlər:\n${itemsText}\n\n💰 Cəmi: ${totalPrice} KZT`;

        const telegramResponse = await fetch(`https://api.telegram.org/bot${cafe.botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: cafe.chatId,
                text: message,
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '👨‍🍳 Hazırlanır', callback_data: 'status_preparing' },
                            { text: '✅ Hazırdır', callback_data: 'status_ready' }
                        ],
                        [
                            { text: '❌ Ləğv et', callback_data: 'status_cancel' }
                        ]
                    ]
                }
            })
        });

        const result = await telegramResponse.json();
        if (!result.ok) throw new Error(result.description);

        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server işləyir: http://localhost:${PORT}`);
});
