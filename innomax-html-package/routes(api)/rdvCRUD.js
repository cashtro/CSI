const express = require('express');
const logger = require('./utils/logger');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { handleRDVPayment, createRendezvous } = require('./utils/stripe');
const { authenticateUser, checkAdmin } = require('./utils/auth-middleware');
const { createSupabaseAdmin } = require('./utils/supabaseUtil');



const supabaseUrl = process.env.SUPABASE_URL; 
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY; 
const supabase = createClient(supabaseUrl, supabaseAnonKey);
const supabaseAdmin = createSupabaseAdmin();

async function isAdmin(userId) {
  const { data } = await supabaseAdmin.from('Users').select('isAdmin').eq('userId', userId).single();
  return Boolean(data && data.isAdmin);
}

// A rendez-vous may be changed by its student, the teacher who owns the slot,
// or an admin. Resolves to the row when allowed, null when not, and throws a
// 404 marker when it does not exist.
async function rdvForManager(userId, rdvId) {
  const { data: rdv } = await supabaseAdmin
    .from('rendez_vous')
    .select('id, id_eleve, disponibilite_id')
    .eq('id', rdvId)
    .single();
  if (!rdv) return { notFound: true };
  if (rdv.id_eleve === userId) return { rdv };
  const { data: slot } = await supabaseAdmin
    .from('disponibilites')
    .select('id_prof')
    .eq('id', rdv.disponibilite_id)
    .single();
  if (slot && slot.id_prof === userId) return { rdv };
  return (await isAdmin(userId)) ? { rdv } : { forbidden: true };
}

// Listing someone else's rendez-vous is admin-only.
async function listTarget(req, res) {
  const target = req.query.userId || req.user.id;
  if (target !== req.user.id && !(await isAdmin(req.user.id))) {
    res.status(403).json({ message: 'Forbidden' });
    return null;
  }
  return target;
}


//redv creation after sucess
router.post('/create',
  authenticateUser, //Authentication middleware
  handleRDVPayment, //Payment handling
    //was then cre...Database insertion
  //(req, res) => res.status(200)//Final response
);


router.get('/verify-payment', createRendezvous, async (req, res) => { 
  res.redirect('/')
  //res.status(201).json(res.rendezvous) 
})


// Update (all info)
router.put('/update/:id', authenticateUser, async (req, res) => {
  const { id } = req.params;
  const { date, heure, duree } = req.body;

  try {
    const access = await rdvForManager(req.user.id, id);
    if (access.notFound) return res.status(404).json({ message: 'Rendez-vous not found' });
    if (access.forbidden) return res.status(403).json({ message: 'Forbidden' });

    const { data, error } = await supabaseAdmin
      .from('rendez_vous')
      .update({ date, heure, duree })
      .eq('id', id);

    if (error) {
      return res.status(400).json({ message: error.message });
    }

    res.status(200).json({ message: 'Rendez-vous updated successfully', data });
  } catch (err) {
    res.status(500).json({ message: 'Error while updating rendez-vous' });
  }
});

// cancel
router.delete('/cancel/:id', authenticateUser, async (req, res) => {
  const { id } = req.params;

  try {
    const access = await rdvForManager(req.user.id, id);
    if (access.notFound) return res.status(404).json({ message: 'Rendez-vous not found' });
    if (access.forbidden) return res.status(403).json({ message: 'Forbidden' });

    const { data : rdv , error } = await supabaseAdmin
      .from('rendez_vous')
      .delete()
      .eq('id', id)
      .single(); //nrmlm good since we provide the rdv id

      //await stripe.refunds.create({ payment_intent: rdv.payment_id });
    if (error) {
      return res.status(400).json({ message: error.message });
    }

    res.status(200).json({ message: 'Rendez-vous canceled successfully', rdv });
  } catch (err) {
    res.status(500).json({ message: 'Error while canceling rendez-vous' });
  }
});

//get all rendez-vous for a user (buyer or seller)
router.get('/all', authenticateUser, async (req, res) => {
  try {
    const userId = await listTarget(req, res); // student or teacher id
    if (!userId) return;
    const { data, error } = await supabase.rpc('get_all_rendez_vous', { user_id: userId });
    // await supabase
      //.from('rendez_vous')
      //.select('*,disponibilites:disponibilite_id (id_prof)')
      //.or(`id_eleve.eq.${userId},disponibilites.id_prof.eq.${userId}`);

    if (error) {
      return res.status(400).json({ message: error });
    }
    
    res.status(200).json({ data });
  } catch (err) {
    res.status(500).json({ message: 'Error fetching rendez-vous' });
  }
});



// test
router.get('/allRdv', authenticateUser, async (req, res) => {
  try {
    const userId = await listTarget(req, res); // élève ou prof
    if (!userId) return;
    const { data, error } = await supabase.rpc('get_all_rendez_vous', { user_id: userId });

    if (error) {
      return res.status(400).json({ message: error.message });
    }

    // Compte le nombre total de rendez-vous
    const totalAppointments = data.length;

    res.status(200).json({ total: totalAppointments, data });
  } catch (err) {
    res.status(500).json({ message: 'Error fetching rendez-vous' });
  }
});

//test 2
router.get('/total-rdv', authenticateUser, async (req, res) => {

  
    try {
        const { data, count, error } = await supabase
            .from('rendez_vous')
            .select('*', { count: 'exact' })
            .eq('id_eleve',req.user.id);

        if (error) {
            logger.error("ERREUR Supabase détaillée:", {
                message: error.message,
                code: error.code,
                details: error.details
            });
            throw error;
        }

        res.json({ total: count });

    } catch (error) {
        logger.error("ERREUR COMPLETE:", {
            name: error.name,
            message: error.message,
            stack: error.stack
        });
        res.status(500).json({ error: "Échec du comptage" });
    }
});

router.get('/monthly-appointments', authenticateUser, async (req, res) => {
  try {
      const { data } = await supabase
          .from('rendez_vous')
          .select('created_at')
          .eq('id_eleve', req.user.id);

      // Grouper par mois
      const monthly = data.reduce((acc, rdv) => {
          const month = new Date(rdv.created_at).getMonth();
          acc[month] = (acc[month] || 0) + 1;
          return acc;
      }, {});

      res.json(monthly);
  } catch (error) {
      res.status(500).json({ error: error.message });
  }
});

module.exports = router;
