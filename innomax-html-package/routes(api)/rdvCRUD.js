const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { handleRDVPayment, createRendezvous } = require('./utils/stripe');
const { authenticateUser, checkAdmin } = require('./utils/auth-middleware');



const supabaseUrl = process.env.SUPABASE_URL; 
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY; 
const supabase = createClient(supabaseUrl, supabaseAnonKey);


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
    const { data, error } = await supabase
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
    const { data : rdv , error } = await supabase
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
router.get('/all', async (req, res) => {
  const { userId } = req.query; //Can be buyer or seller ID

  try {
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
router.get('/allRdv', async (req, res) => {
  const { userId } = req.query; // Peut être l'élève ou le prof

  try {
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
            console.error("ERREUR Supabase détaillée:", {
                message: error.message,
                code: error.code,
                details: error.details
            });
            throw error;
        }

        res.json({ total: count });

    } catch (error) {
        console.error("ERREUR COMPLETE:", {
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
