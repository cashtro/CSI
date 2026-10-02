const express = require('express');
const logger = require('./utils/logger');
const router = express.Router();
const { getRange } = require('./utils/pagination');
const { createClient } = require('@supabase/supabase-js');
const upload = require('./utils/multerConfig');
const { checkAdmin } = require('./utils/auth-middleware');
const { parseQuantity } = require('./utils/quantity');
const { fulfillCheckoutSession } = require('./utils/fulfill');

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// --- ADD: Utility function to clean file names ---
function sanitizeFileName(filename) {
    return filename
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, '-')
        .replace(/[^a-zA-Z0-9.\-_]/g, '');
}

router.post('/', checkAdmin, upload.single('imageProduit'), async (req, res) => {
    // Never log raw bodies or files: they carry personal data.
    logger.debug('Create product request', logger.redact(req.body), { file: req.file?.originalname || null });

    const { nomProduit, price, shortDescription } = req.body;
    const imageFile = req.file;

    if (!nomProduit || !price || !shortDescription) {
        return res.status(400).json({ error: 'Missing required fields.' });
    }

    let imageUrl = null;
    if (imageFile) {
        // --- Use sanitized file name here! ---
        const originalName = imageFile.originalname;
        const sanitizedFileName = sanitizeFileName(originalName);
        const fileName = `shop-${Date.now()}-${sanitizedFileName}`;

        const { error: uploadError } = await supabase
            .storage
            .from('image-shop')
            .upload(fileName, imageFile.buffer, {
                contentType: imageFile.mimetype,
                upsert: false
            });
        if (uploadError) {
            logger.error("Supabase upload error:", uploadError); // log for debug
            return res.status(500).json({ error: 'Image upload failed.' });
        }
        const { data: { publicUrl } } = supabase
            .storage
            .from('image-shop')
            .getPublicUrl(fileName);
        imageUrl = publicUrl;
    }

    try {
        const { data, error } = await supabase
            .from('Achat')
            .insert([{
                title_item: nomProduit,
                price_item: Number(price),
                description_item: shortDescription,
                image_item: imageUrl
            }])
            .select()
            .single();

        if (error) throw error;
        res.status(201).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Add this GET route for fetching all shop items
router.get('/', async (req, res) => {
    try {
        const { from, to } = getRange(req.query, { defaultLimit: 100, maxLimit: 200 });
        const { data, error } = await supabase
            .from('Achat')
            .select('*')
            .range(from, to);

        if (error) {
            logger.error('Supabase error:', error);
            throw error;
        }
        
        logger.debug('achats rows:', Array.isArray(data) ? data.length : 0); // Debug log
        
        res.json(
            (data || []).map(item => ({
                id: item.id_item, // Use your primary key column
                nomProduit: item.title_item,
                price: item.price_item,
                shortDescription: item.description_item,
                imageProduit: item.image_item,
                createdAt: item.created_at
            }))
        );
    } catch (err) {
        logger.error('Route error:', err);
        res.status(500).json({ error: err.message });
    }
});

// DELETE an item by id_item
router.delete('/:id', checkAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const { error } = await supabase
            .from('Achat')
            .delete()
            .eq('id_item', id);
        if (error) {
            logger.error('Supabase delete error:', error);
            return res.status(500).json({ error: error.message });
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// UPDATE an item by id_item
router.put('/:id', checkAdmin, upload.single('imageProduit'), async (req, res) => {
    const { id } = req.params;
    const { nomProduit, price, shortDescription } = req.body;
    let updateFields = {
        title_item: nomProduit,
        price_item: Number(price),
        description_item: shortDescription
    };

    // Handle image update if provided
    if (req.file) {
        const originalName = req.file.originalname;
        const sanitizedFileName = sanitizeFileName(originalName);
        const fileName = `shop-${Date.now()}-${sanitizedFileName}`;
        const { error: uploadError } = await supabase
            .storage
            .from('image-shop')
            .upload(fileName, req.file.buffer, {
                contentType: req.file.mimetype,
                upsert: false
            });
        if (uploadError) {
            logger.error("Supabase upload error:", uploadError);
            return res.status(500).json({ error: 'Image upload failed.' });
        }
        const { data: { publicUrl } } = supabase
            .storage
            .from('image-shop')
            .getPublicUrl(fileName);
        updateFields.image_item = publicUrl;
    }

    try {
        const { data, error } = await supabase
            .from('Achat')
            .update(updateFields)
            .eq('id_item', id)
            .select()
            .single();
        if (error) {
            logger.error('Supabase update error:', error);
            return res.status(500).json({ error: error.message });
        }
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Add purchase endpoint for achats products
router.post('/purchase', async (req, res) => {
    try {
        const { productId, quantity, size } = req.body;
        
        if (!productId || !quantity) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Bound the client-supplied quantity (was passed straight to Stripe).
        const qty = parseQuantity(quantity, { max: 20 });
        if (qty === null) {
            return res.status(400).json({ error: 'Invalid quantity (must be between 1 and 20)' });
        }

        // Get product data from Achat table
        const { data: productData, error: productError } = await supabase
            .from('Achat')
            .select('*')
            .eq('id_item', productId)
            .single();

        if (productError || !productData) {
            return res.status(404).json({ error: 'Product not found' });
        }

        // Create Stripe session for achats product
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'cad',
                    product_data: {
                        name: `${productData.title_item} (Size: ${size || 'N/A'})`,
                        description: productData.description_item,
                        images: [productData.image_item],
                    },
                    unit_amount: Math.round(productData.price_item * 100),
                },
                quantity: qty,
            }],
            mode: 'payment',
            metadata: {
                type: 'achat',
                productId: String(productId),
                productName: productData.title_item,
                quantity: String(qty),
                size: size || 'N/A',
            },
            shipping_address_collection: {
                allowed_countries: ['US', 'CA', 'FR', 'GB', 'DE', 'IT', 'ES', 'NL', 'BE', 'CH', 'AU', 'NZ'],
            },
            shipping_options: [
                { shipping_rate: 'shr_1RYqvrArxZ3efRDTWikDVdRa' },
            ],
            success_url: `${process.env.APP_URL}/api/achats/verify-purchase?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.APP_URL}/achats`,
        });

        res.json({ id: session.id });

    } catch (error) {
        logger.error('Error in achats purchase:', error);
        res.status(400).json({ error: error.message });
    }
});

// success_url of an achats purchase. Fulfilment (bill + owner e-mail) goes
// through utils/fulfill: exactly once per Stripe session, shared with the
// signed webhook, so a reloaded success URL sends nothing twice and a buyer
// who closes the tab is still handled by the webhook.
router.get('/verify-purchase', async (req, res) => {
    const back = (query) => res.redirect(`${process.env.APP_URL}/achats?${query}`);
    try {
        const { session_id } = req.query;
        if (!session_id) return back('error=session_id_required');
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        const session = await stripe.checkout.sessions.retrieve(String(session_id));
        if (session.metadata?.type !== 'achat') return back('error=payment_failed');
        const result = await fulfillCheckoutSession(session);
        if (result.status === 'granted' || result.status === 'already_fulfilled') return back('success=purchase_completed');
        return back('error=payment_failed');
    } catch (error) {
        logger.error('Error in verify achats purchase:', error.message);
        return back('error=verification_failed');
    }
});

module.exports = router;
