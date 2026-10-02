const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);
const { sendFullPriceProductOwnerEmail, sendEmail } = require('./emailService');
const { slotWasClaimed, sumEntryCounts } = require('./booking');
const { claimFulfillment } = require('./fulfillment');

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

    const { data: tempStore, error: tempError } = await supabaseAuthed
      .from('temp_access_tokens')
      .insert({user_id:id_eleve, access_token:accessToken})
      .single();

    if(tempError) throw tempError;
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

const createRendezvous = async (req, res, next) => {
  try {
    
    //Verify payment success
    const session = await stripe.checkout.sessions.retrieve(req.query.session_id);
    if (session.payment_status !== 'paid') {
      throw new Error('Payment not completed');
    }



    const { data: temp_access_token, error: tempError } = await supabase
      .from('temp_access_tokens')
      .select('access_token')
      .eq('user_id', session.metadata.id_eleve)
      .single();
    const accessToken = temp_access_token.access_token; // Access token from metadata

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

    const dispoId = session.metadata.disponibilite_id;

    // Atomically claim the slot BEFORE creating the rendez-vous:
    // `UPDATE ... SET taken=true WHERE id=? AND taken=false` only affects a row
    // when the slot was still free, so exactly one concurrent payer can win it.
    const { data: claimedSlots, error: claimError } = await supabaseAuthed
      .from('disponibilites')
      .update({ taken: true })
      .eq('id', dispoId)
      .eq('taken', false)
      .select('id');

    if (claimError) throw claimError;

    if (!slotWasClaimed(claimedSlots)) {
      // Another payment already took this slot (double-booking). Do not create a
      // duplicate rendez-vous. This payment must be refunded out-of-band.
      console.error(`[rdv] slot ${dispoId} already booked; payment ${session.payment_intent} needs a refund.`);
      return res.status(409).json({
        error: 'Slot already booked',
        disponibilite_id: dispoId,
        payment_intent: session.payment_intent,
      });
    }

    //Create rendez-vous
    const { data, error } = await supabaseAuthed
      .from('rendez_vous')
      .insert([{
        disponibilite_id: dispoId,
        id_eleve: session.metadata.id_eleve,
        payment_id: session.payment_intent
      }]).select('*')
      .single();

    if (error) {
      // Roll back the claim so the slot isn't stuck as taken with no booking.
      await supabaseAuthed.from('disponibilites').update({ taken: false }).eq('id', dispoId);
      throw error;
    }
    // Insérer la facture dans la base de données
    const { data: billData, error: billError } = await supabaseAuthed
      .from('bills')
      .insert({
        user_id: session.metadata.id_eleve,
        source: `rendez_vous:${data.id}`,
        payment_data: session
      }).select('*');
    // Vérifier s'il y a eu une erreur lors de l'insertion
    if (billError) {
      console.error("Erreur lors de la création de la facture:", billError);
      return res.status(500).json({ error: "Échec de la création de la facture", details: billError.message });
    }
    res.rendezvous = data;
    next();
  } catch (error) {
    res.status(500).json({ message: error.message });
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

    const { data: tempStore, error: tempError } = await supabaseAuthed
    .from('temp_access_tokens')
    .insert({user_id:student_id, access_token:accessToken})
    .single();

    if(tempError) throw tempError;

    req.stripeSession = session;
    res.json({ id: session.id })
  } catch (error) {
    console.error(error)
    res.status(400).json({ message: error.message });
  }
};

const enrollStudent = async (req, res, next) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.query.session_id);

    if (session.payment_status !== 'paid') {
      throw new Error('Payment not completed');
    }
    const { data: temp_access_token, error: tempError } = await supabase
    .from('temp_access_tokens')
    .select('access_token')
    .eq('user_id', session.metadata.student_id)
    .single();
    const accessToken = temp_access_token.access_token; // Access token from metadata

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

    // Add student to course
    const { data, error } = await supabaseAuthed
      .from('cours_students')
      .insert([{
        cours_id: session.metadata.course_id,
        student_id: session.metadata.student_id
      }])
      .select('*')
      .single();

    if (error) throw error;
    // Create bill
    await supabaseAuthed.from('bills').insert({
      user_id: session.metadata.student_id,
      source: `course:${data.id}`,
      payment_data: session
    });
    

    res.enrollment = data;
    next();
  } catch (error) {
    console.error("Error in enrollStudent: ", error)
    res.status(500).json({ message: error.message,error:error });
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

    
    const { data: tempStore, error: tempError } = await supabaseAuthed
      .from('temp_access_tokens')
      .insert({user_id:student_id, access_token:accessToken})
      .single();

    if(tempError) throw tempError;
    req.stripeSession = session;
    res.json({ id: session.id })
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const confirmSubscription = async (req, res, next) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.query.session_id);

    if (session.payment_status !== 'paid') {
      throw new Error('Initial subscription payment failed');
    }

    const subscription = await stripe.subscriptions.retrieve(session.subscription);

    const { data: temp_access_token, error: tempError } = await supabase
    .from('temp_access_tokens')
    .select('access_token')
    .eq('user_id', session.metadata.student_id)
    .single();
    const accessToken = temp_access_token.access_token; // Access token from metadata

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


    const { data: course, error: enrollmentError } = await supabaseAuthed
      .from('cours_students')
      .insert([{
        cours_id: session.metadata.course_id,
        student_id: session.metadata.student_id,
        
      }])
      .select('*')
      .single();

    if (enrollmentError) throw enrollmentError;

    await supabaseAuthed.from('bills').insert({
      user_id: session.metadata.student_id,
      source: `course:${course.id}`,
      payment_data: session
    });

    res.subscription = course;
    next();
  } catch (error) {
    res.status(500).json({ message: error.message });
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
            name: `Lottery Entries (${entryQuantity} tickets)`,
            description: `Entry for ${lotteryData.nomProduit}`
          },
          unit_amount: Math.round(entryCost * 100), // Convert to cents
        },
        quantity: parseInt(entryQuantity),
      }],
      mode: 'payment',
      metadata: {
        type: 'lottery_entry',
        lotteryId,
        userId,
        entryQuantity,
        entryCost,
        
      },
      success_url: `${process.env.APP_URL}/api/lottery/verify-payment?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_URL}/luckydraw`,
    });


    const { data: tempStore, error: tempError } = await supabaseAuthed
      .from('temp_access_tokens')
      .insert({user_id:userId, access_token:accessToken})
      .single();

    if(tempError) throw tempError;
    res.json({ id: session.id });

  } catch (error) {
    console.error('Error in handleLotteryPayment:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
};
const verifyStripePayment = async (req, res) => {
  try {
    const { session_id } = req.query;
    if (!session_id) {
      return res.status(400).json({ error: 'Session ID is required' });
    }

    // Verify the session
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['payment_intent']
    });


    if (session.payment_status !== 'paid') {
      return res.redirect(`${process.env.APP_URL}/luckydraw?error=payment_failed`);
    }

    // Verify the payment intent
    if (!session.payment_intent || session.payment_intent.status !== 'succeeded') {
      return res.redirect(`${process.env.APP_URL}/luckydraw?error=payment_verification_failed`);
    }

    const { data: temp_access_token, error: tempError } = await supabase
    .from('temp_access_tokens')
    .select('access_token')
    .eq('user_id', session.metadata.userId)
    .single();
    const accessToken = temp_access_token.access_token; // Access token from metadata

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

    const { lotteryId, userId, entryQuantity } = session.metadata;

    // Verify lottery is still active
    const { data: lottery, error: lotteryError } = await supabaseAuthed
      .from('Lottery')
      .select('lotteryTime, isActive')
      .eq('lotteryId', lotteryId)
      .single();

    if (lotteryError || !lottery) {
      return res.redirect(`${process.env.APP_URL}/luckydraw?error=lottery_not_found`);
    }

    if (!lottery.isActive || new Date(lottery.lotteryTime) <= new Date()) {
      return res.redirect(`${process.env.APP_URL}/luckydraw?error=lottery_closed`);
    }

    // Idempotency: dedupe replays of this verify redirect so a refreshed or
    // shared success URL can't grant the same paid entry twice. Best-effort —
    // if the ledger is unavailable we proceed (preserves prior behavior).
    const entryClaim = await claimFulfillment(`lottery_entry:${session.id}`, 'lottery_entry');
    if (entryClaim.alreadyProcessed) {
      return res.redirect(`${process.env.APP_URL}/luckydraw?success=true&lotteryId=${lotteryId}&note=already_processed`);
    }

    // Get existing entries
    const { data: existingEntry } = await supabaseAuthed
      .from('Entry')
      .select('entryCount')
      .match({ lotteryId, userId })
      .single();

    const newTotal = (existingEntry?.entryCount || 0) + parseInt(entryQuantity);

    // Update or insert entry
    let entryError;
    if (existingEntry) {
      const { error } = await supabaseAuthed
        .from('Entry')
        .update({ entryCount: newTotal })
        .match({ lotteryId, userId });
      entryError = error;
    } else {
      const { error } = await supabaseAuthed
        .from('Entry')
        .insert({ lotteryId, userId, entryCount: newTotal });
      entryError = error;
    }

    if (entryError) {
      console.error('Error updating Entry:', entryError);
      return res.redirect(`${process.env.APP_URL}/luckydraw?error=entry_update_failed`);
    }

    // Create bill record - updated to match your schema
    const { error: billError } = await supabaseAuthed.from('bills').insert({
      user_id: userId,
      source: `lottery:${lotteryId}`,
      payment_data: session,
    });

    if (billError) {
      console.error('Error inserting bill:', billError);
      return res.redirect(`${process.env.APP_URL}/luckydraw?error=bill_creation_failed`);
    }
 // Recompute the lottery's GLOBAL total from all entries. Previously this wrote
    // `newTotal` (a single user's cumulative count) as the lottery-wide total,
    // corrupting draw gating (minimumEntryNeeded). Sum every user's entryCount.
    const { data: allEntries, error: entriesSumError } = await supabaseAuthed
      .from('Entry')
      .select('entryCount')
      .eq('lotteryId', lotteryId);

    if (entriesSumError) {
      console.error('Error reading entries for total:', entriesSumError);
      return res.redirect(`${process.env.APP_URL}/luckydraw?error=total_entries_update_failed`);
    }

    const globalTotalEntries = sumEntryCounts(allEntries);
    const { error: updateLotteryError } = await supabaseAuthed
      .from('Lottery')
      .update({ totalEntries: globalTotalEntries })
      .eq('lotteryId', lotteryId);

    if (updateLotteryError) {
      console.error('Error updating totalEntries in Lottery:', updateLotteryError);
      return res.redirect(`${process.env.APP_URL}/luckydraw?error=total_entries_update_failed`);
    }


    // Send success response
    res.redirect(`${process.env.APP_URL}/luckydraw?success=true&lotteryId=${lotteryId}`);

  } catch (error) {
    console.error('Verification error:', error);
    res.redirect(`${process.env.APP_URL}/luckydraw?error=verification_error`);
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
    console.error('Error in handleProductPurchase:', error);
    res.status(400).json({ success: false, error: error.message });
  }
};

const verifyProductPurchase = async (req, res) => {
  try {
    const { session_id } = req.query;
    if (!session_id) {
      return res.redirect(`${process.env.APP_URL}/achats?error=session_id_required`);
    }

    // Retrieve the Stripe session with expanded customer & shipping details
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['customer', 'shipping.address']
    });

    if (session.payment_status !== 'paid') {
      return res.redirect(`${process.env.APP_URL}/achats?error=payment_failed`);
    }

    const { data: temp_access_token, error: tempError } = await supabase
    .from('temp_access_tokens')
    .select('access_token')
    .eq('user_id', session.metadata.userId)
    .single();
    const accessToken = temp_access_token.access_token; // Access token from metadata

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

    const { lotteryId, userId, quantity, size, productPrice } = session.metadata;
    const buyerEmail = session.customer_details?.email;
    const shippingAddress = session.shipping_details?.address;

    // Fetch product data
    const { data: lotteryData, error: lotteryError } = await supabaseAuthed
      .from('Lottery')
      .select('*')
      .eq('lotteryId', lotteryId)
      .single();

    if (lotteryError || !lotteryData) {
      throw new Error('Product not found during verification');
    }

    // Create bill record
    const { error: billError } = await supabaseAuthed
      .from('bills')
      .insert([{
        user_id: userId,
        source: `product:${lotteryId}`,
        payment_data: session,
        created_at: new Date().toISOString()
      }]);

    if (billError) throw new Error('Bill creation failed');

    // Send email to owner (admin) with buyer details
    await sendEmail(
      process.env.OWNER_EMAIL,
      'Pandora Brand Product Purchase',
      `
        <div style="font-family: 'Poppins', sans-serif; background-color: #0e0e0e; padding: 40px; border-radius: 24px; max-width: 600px; margin: auto; color: #855e1b; box-shadow: 0 15px 50px rgba(0, 0, 0, 0.3), 0 0 60px rgba(230, 195, 115, 0.2);">
          <h1 style="font-family: 'Cinzel', serif; font-size: 28px; margin-bottom: 20px; color: #855e1b;">New Product Purchase</h1>
          
          <p style="font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
            The product <strong>${lotteryData.nomProduit}</strong> has been purchased at full price.
          </p>
    
          <h3 style="font-size: 20px; margin-top: 30px; color: #D4AF37;">Order Details:</h3>
          <p><strong>Quantity:</strong> ${quantity}</p>
          <p><strong>Size:</strong> ${size || 'N/A'}</p>
          <p><strong>Price:</strong> $${productPrice || lotteryData.price}</p>
    
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
    
    res.redirect(`${process.env.APP_URL}/achats?success=true&orderId=${lotteryId}`);

  } catch (error) {
    console.error('Verification error:', error);
    res.redirect(`${process.env.APP_URL}/achats?error=${encodeURIComponent(error.message)}`);
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