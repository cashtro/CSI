const express = require('express');
const router = express.Router();
const { getRange } = require('./utils/pagination');
const { createClient } = require('@supabase/supabase-js');
const upload = require('./utils/multerConfig');
const { checkAdmin } = require('./utils/auth-middleware');
const { parseQuantity } = require('./utils/quantity');

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
    console.log('BODY:', req.body);
    console.log('FILE:', req.file);

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
            console.error("Supabase upload error:", uploadError); // log for debug
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
            console.error('Supabase error:', error);
            throw error;
        }
        
        console.log('Raw achats data:', data); // Debug log
        
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
        console.error('Route error:', err);
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
            console.error('Supabase delete error:', error);
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
            console.error("Supabase upload error:", uploadError);
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
            console.error('Supabase update error:', error);
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
        console.error('Error in achats purchase:', error);
        res.status(400).json({ error: error.message });
    }
});

// Add verification endpoint for achats purchases
router.get('/verify-purchase', async (req, res) => {
    try {
        const { session_id } = req.query;
        if (!session_id) {
            return res.redirect(`${process.env.APP_URL}/achats?error=session_id_required`);
        }

        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        
        // Retrieve the Stripe session
        const session = await stripe.checkout.sessions.retrieve(session_id, {
            expand: ['customer', 'shipping.address']
        });

        if (session.payment_status !== 'paid') {
            return res.redirect(`${process.env.APP_URL}/achats?error=payment_failed`);
        }

        const { productId, productName, quantity, size } = session.metadata;
        const buyerEmail = session.customer_details?.email;
        const shippingAddress = session.shipping_details?.address;

        // Get product data
        const { data: productData, error: productError } = await supabase
            .from('Achat')
            .select('*')
            .eq('id_item', productId)
            .single();

        if (productError || !productData) {
            throw new Error('Product not found during verification');
        }

        // Send email to owner with purchase details
        const { sendFullPriceProductOwnerEmail } = require('./utils/emailService');
        await sendFullPriceProductOwnerEmail(
            process.env.OWNER_EMAIL,
            'Pandora Brand Achat Product Purchase',
            `
            <div style="font-family: 'Poppins', sans-serif; background-color: #0e0e0e; padding: 40px; border-radius: 24px; max-width: 600px; margin: auto; color: #855e1b; box-shadow: 0 15px 50px rgba(0, 0, 0, 0.3), 0 0 60px rgba(230, 195, 115, 0.2);">
                <h1 style="font-family: 'Cinzel', serif; font-size: 28px; margin-bottom: 20px; color: #855e1b;">New Achat Product Purchase</h1>
                
                <p style="font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
                    The product <strong>${productData.title_item}</strong> has been purchased.
                </p>
        
                <h3 style="font-size: 20px; margin-top: 30px; color: #D4AF37;">Order Details:</h3>
                <p><strong>Quantity:</strong> ${quantity}</p>
                <p><strong>Size:</strong> ${size || 'N/A'}</p>
                <p><strong>Price:</strong> $${productData.price_item}</p>
        
                <h3 style="font-size: 20px; margin-top: 30px; color: #D4AF37;">Buyer Information:</h3>
                <p><strong>Email:</strong> ${buyerEmail || 'Not provided'}</p>
        
                <h3 style="font-size: 20px; margin-top: 30px; color: #D4AF37;">Shipping Address:</h3>
                ${
                    shippingAddress?.line1
                        ? `
                            <p>${shippingAddress.line1}</p>
                            ${shippingAddress.line2 ? `<p>${shippingAddress.line2}</p>` : ''}
                            <p>${shippingAddress.city}, ${shippingAddress.state} ${shippingAddress.postal_code}</p>
                            <p>${shippingAddress.country}</p>
                        `
                        : '<p>No shipping address provided.</p>'
                }
        
                <p style="margin-top: 40px; font-size: 14px; color: #E6C373;">Please prepare the item for delivery.</p>
            </div>
            `
        );
        
        res.redirect(`${process.env.APP_URL}/achats?success=purchase_completed`);
        
    } catch (error) {
        console.error('Error in verify achats purchase:', error);
        res.redirect(`${process.env.APP_URL}/achats?error=verification_failed`);
    }
});

module.exports = router;
