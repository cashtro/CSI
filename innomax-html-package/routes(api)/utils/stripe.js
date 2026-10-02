const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const logger = require('./logger');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);
const { fulfillCheckoutSession } = require('./fulfill');

const handleRDVPayment = async (req, res, next) => {
  try {
    const id_eleve = req.user.id; // Assuming user ID is stored in req.user.id
    const { disponibilite_id } = req.body;

    const accessToken = req.accessToken;

    const supabaseAuthed = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      {
        global: {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      }
    )

    // 1.Get availability price
    const { data: disponibilite, error } = await supabaseAuthed
      .from('disponibilites')
      .select('price, id_prof, taken')
      .eq('id', disponibilite_id)
      .single();

    if (error) throw new Error('Invalid availability slot');

    // Reject up-front if the slot is already booked, so we never start a
    // checkout (and charge) for a slot that can't be fulfilled.
    if (disponibilite.taken) {
      return res.status(409).json({ message: 'This time slot is no longer available' });
    }

    // 2.Create Stripe session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'], //check maybe crypto and wtv (paypal?)
      line_items: [{
        price_data: {
          currency: 'cad',
          product_data: { name: 'Lesson Booking' },
          unit_amount: Math.round(disponibilite.price * 100),
        },
        quantity: 1,
      }],
      mode: 'payment',
      metadata: { disponibilite_id, id_eleve, id_prof: disponibilite.id_prof},
      success_url: `${process.env.APP_URL}/api/rdv/verify-payment?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_URL}/rendezvous/cancel`,
    });

    // 3.Store session reference
    req.stripeSession = session;
    req.accessToken = accessToken; 
    // Terminal response for the /create flow. Do NOT call next() after sending
    // a response (that was a double-response bug).
    res.json({ id: session.id });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// success_url handlers: confirm the session with Stripe, then fulfil it.
// Fulfilment is idempotent per session (utils/fulfill), so reloading or
// sharing a success URL grants nothing twice; the webhook does the same work
// when the buyer never comes back.
async function retrieveAndFulfill(sessionId) {
  if (!sessionId) return { status: 'missing_session' };
  const session = await stripe.checkout.sessions.retrieve(String(sessionId));
  return { session, ...(await fulfillCheckoutSession(session)) };
}

const FULFILLED = ['granted', 'already_fulfilled'];

const createRendezvous = async (req, res, next) => {
  try {
    const result = await retrieveAndFulfill(req.query.session_id);
    if (result.status === 'slot_taken') return res.status(409).json({ error: 'Slot already booked' });
    if (!FULFILLED.includes(result.status)) return res.status(402).json({ message: 'Payment not completed' });
    next();
  } catch (error) {
    logger.error('[rdv verify]', error);
    res.status(500).json({ message: 'Unable to confirm the booking' });
  }
};

const handleCoursePayment = async (req, res, next) => {
  try {
    const { course_id } = req.params;
    const student_id = req.user.id;


    const accessToken = req.accessToken;

    const supabaseAuthed = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      {
        global: {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      }
    )

    // 1. Get course price
    const { data: course, error } = await supabaseAuthed
      .from('cours')
      .select('prix, id_prof')
      .eq('id', course_id)
      .single();



    if (error) throw new Error('Course not found');

    // 2. Create Stripe session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'cad',
          product_data: { name: 'Course Enrollment' },
          unit_amount: Math.round(course.prix * 100),
        },
        quantity: 1,
      }],
      mode: 'payment',
      metadata: { 'course_id': course_id, 'student_id': student_id, 'id_prof': course.id_prof},
      success_url: `${process.env.APP_URL}/api/course/verify-payment?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_URL}/api/course/cancel`,
    });


    req.stripeSession = session;
    res.json({ id: session.id })
  } catch (error) {
    logger.error(error)
    res.status(400).json({ message: error.message });
  }
};

const enrollStudent = async (req, res, next) => {
  try {
    const result = await retrieveAndFulfill(req.query.session_id);
    if (!FULFILLED.includes(result.status)) return res.status(402).json({ message: 'Payment not completed' });
    next();
  } catch (error) {
    logger.error('[course verify]', error);
    res.status(500).json({ message: 'Unable to confirm the enrollment' });
  }
};


const handleSubscriptionPayment = async (req, res, next) => {
  try {

    const { course_id } = req.params;
    const student_id = req.user.id;

    const accessToken = req.accessToken;

    const supabaseAuthed = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      {
        global: {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      }
    )

    const { data: course, error } = await supabaseAuthed
      .from('cours')
      .select('nom, prix, id_prof') // `nom` is the course-name column (title was wrong)
      .eq('id', course_id)
      .single();

    if (error) throw new Error('Course not found');

    const courseName = course.nom || 'Course';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'cad',
          product_data: {
            name: `${courseName} Subscription`,
            description: `Monthly subscription for ${courseName}`
          },
          unit_amount: Math.round(course.prix * 100 / 5),
          recurring: {
            interval: 'month',
            interval_count: 1
          },
        },
        quantity: 1,
      }],
      mode: 'subscription',
      metadata: { 'course_id': course_id, 'student_id': student_id, 'id_prof': course.id_prof},
      success_url: `${process.env.APP_URL}/api/course/verify-subsc-payment?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_URL}/course/subscription/cancel`,
    });

    
    req.stripeSession = session;
    res.json({ id: session.id })
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Recurring renewals and cancellations are not handled yet (no
// invoice/customer.subscription webhooks); this grants the first period.
const confirmSubscription = async (req, res, next) => {
  try {
    const result = await retrieveAndFulfill(req.query.session_id);
    if (!FULFILLED.includes(result.status)) return res.status(402).json({ message: 'Initial subscription payment failed' });
    next();
  } catch (error) {
    logger.error('[subscription verify]', error);
    res.status(500).json({ message: 'Unable to confirm the subscription' });
  }
};



// Middleware to handle lottery payment
const handleLotteryPayment = async (req, res) => {
  try {
    const { lotteryId, entryQuantity } = req.body;
    const userId = req.user.id;  // User ID is now available from the middleware

    const accessToken = req.accessToken;

    const supabaseAuthed = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      {
        global: {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      }
    )

    const { data: lotteryData, error } = await supabase
      .from('Lottery')
      .select('*')
      .eq('lotteryId', lotteryId)
      .single();

    if (error) throw new Error('Lottery not found');

    // Never charge for a draw that is closed: fulfilment would refuse the
    // entries afterwards and the payment would need a manual refund.
    if (!lotteryData.isActive || !(new Date(lotteryData.lotteryTime) > new Date())) {
      return res.status(409).json({ success: false, error: 'Ce tirage est terminé.' });
    }
    const quantity = parseInt(entryQuantity, 10);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      return res.status(400).json({ success: false, error: 'Invalid entry quantity' });
    }

    // Ensure entryCost is a valid number
    const entryCost = Number(lotteryData.entrieCost);
    if (isNaN(entryCost)) {
      throw new Error('Invalid entry cost in lottery data');
    }

    // Create Stripe session with correct quantity and unit amount
    
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'cad',
          product_data: { 
            name: `Lottery Entries (${quantity} tickets)`,
            description: `Entry for ${lotteryData.nomProduit}`
          },
          unit_amount: Math.round(entryCost * 100), // Convert to cents
        },
        quantity,
      }],
      mode: 'payment',
      metadata: {
        type: 'lottery_entry',
        lotteryId,
        userId,
        entryQuantity: String(quantity),
        entryCost,
        
      },
      success_url: `${process.env.APP_URL}/api/lottery/verify-payment?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_URL}/luckydraw`,
    });


    res.json({ id: session.id });

  } catch (error) {
    logger.error('Error in handleLotteryPayment:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
};
const verifyStripePayment = async (req, res) => {
  const back = (query) => res.redirect(`${process.env.APP_URL}/luckydraw?${query}`);
  try {
    if (!req.query.session_id) return res.status(400).json({ error: 'Session ID is required' });
    const result = await retrieveAndFulfill(req.query.session_id);
    const lotteryId = encodeURIComponent(result.session?.metadata?.lotteryId || '');
    if (result.status === 'granted') return back(`success=true&lotteryId=${lotteryId}`);
    if (result.status === 'already_fulfilled') return back(`success=true&lotteryId=${lotteryId}&note=already_processed`);
    if (result.status === 'lottery_closed') return back('error=lottery_closed');
    return back('error=payment_failed');
  } catch (error) {
    logger.error('Verification error:', error);
    return back('error=verification_error');
  }
};



// Middleware to handle product purchase
const handleProductPurchase = async (req, res) => {
  try {
    const { lotteryId, entryQuantity, size } = req.body;
    // Use a default userId for anonymous purchases
    const userId = req.user?.id || 'anonymous';

    // Use regular supabase client instead of authenticated one
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    if (!lotteryId || !entryQuantity) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const { data: lotteryData, error: lotteryError } = await supabase
      .from('Lottery')
      .select('*')
      .eq('lotteryId', lotteryId)
      .single();

    if (lotteryError || !lotteryData) {
      throw new Error('Product not found');
    }

    const unitAmount = Math.round((lotteryData.price || lotteryData.entrieCost) * 100);
    if (isNaN(unitAmount) || unitAmount <= 0) {
      throw new Error('Invalid product price');
    }

    const quantity = parseInt(entryQuantity);
    if (isNaN(quantity) || quantity <= 0) {
      throw new Error('Invalid quantity');
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'cad',
          product_data: {
           name: `${lotteryData.nomProduit} (Size: ${size || 'N/A'})`,
           description: lotteryData.shortDescription,
            images: [lotteryData.imageProduit],

          },
          unit_amount: unitAmount,
        },
        quantity: quantity,
      }],
      mode: 'payment',
      metadata: {
        type: 'product',
        lotteryId: String(lotteryId),
        productName: lotteryData.nomProduit,
        userId: String(userId),
        productPrice: String(lotteryData.price),
        quantity: String(quantity),
        size: size || 'N/A',
      },
      shipping_address_collection: {
        allowed_countries: ['US', 'CA', 'FR', 'GB', 'DE', 'IT', 'ES', 'NL', 'BE', 'CH', 'AU', 'NZ'],
      },
      shipping_options: [
      { shipping_rate: 'shr_1RYqvrArxZ3efRDTWikDVdRa' },
    ],
      success_url: `${process.env.APP_URL}/api/lottery/verify-purchase?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_URL}/achats`,
    });

    res.json({ id: session.id });

  } catch (error) {
    logger.error('Error in handleProductPurchase:', error);
    res.status(400).json({ success: false, error: error.message });
  }
};

const verifyProductPurchase = async (req, res) => {
  const back = (query) => res.redirect(`${process.env.APP_URL}/achats?${query}`);
  try {
    if (!req.query.session_id) return back('error=session_id_required');
    const result = await retrieveAndFulfill(req.query.session_id);
    if (FULFILLED.includes(result.status)) {
      return back(`success=true&orderId=${encodeURIComponent(result.session.metadata?.lotteryId || '')}`);
    }
    return back('error=payment_failed');
  } catch (error) {
    logger.error('Verification error:', error);
    return back('error=verification_error');
  }
};


module.exports = {
  handleRDVPayment,
  createRendezvous,
  handleCoursePayment,
  enrollStudent,
  handleLotteryPayment,
  verifyStripePayment,
  handleSubscriptionPayment,
  confirmSubscription,
  handleProductPurchase,
  verifyProductPurchase
};