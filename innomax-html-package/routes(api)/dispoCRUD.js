const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { authenticateUser } = require('./utils/auth-middleware');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

// Create Availability
router.post('/disponibilite',authenticateUser, async (req, res) => {
    const accessToken = req.accessToken
    const id_prof = req.user.id

    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY,
        {
            global:{
                headers:{
                    Authorization: `Bearer ${accessToken}`
                }
            }
        }
    )
    
    const { start_time, end_time, price, commission_rate } = req.body;

    try {
        const { data, error } = await supabase
            .from('disponibilites')
            .insert([{ id_prof, start_time, end_time, price, commission_rate }])
            .single();

       
        if (error) throw error;

        res.status(201).json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Read All Availability for user id
router.get('/disponibilite', async (req, res) => {
    const { user_id } = req.query
    try {
        const { data, error } = await supabase
            .from('disponibilites')
            .select('*, Users: id_prof(username)')
            .eq('id_prof',user_id);

        if (error) throw error;

        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Read Availability by ID
router.get('/disponibilite/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const { data, error } = await supabase
            .from('disponibilites')
            .select('*')
            .eq('id', id)
            .single();

        if (error) throw error;

        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update Availability
router.put('/disponibilite/:id', authenticateUser, async (req, res) => {
    const { id } = req.params;
    //const { date, start_time, end_time } = req.body;
    const accessToken = req.accessToken

    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY,
        {
            global:{
                headers:{
                    Authorization: `Bearer ${accessToken}`
                }
            }
        }
    )

    try {
        const { data, error } = await supabase
            .from('disponibilites')
            .update(req.body )
            .eq('id', id)
            .single();

        if (error) throw error;

        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/disponibilite/:id', authenticateUser, async (req, res) => {
    const { id } = req.params;
    const accessToken = req.accessToken;

    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY,
        {
            global:{
                headers:{
                    Authorization: `Bearer ${accessToken}`
                }
            }
        }
    )

    try {
        const { error } = await supabase
            .from('disponibilites')
            .delete()
            .eq('id', id);

        if (error) throw error;

        res.status(204).end(); 
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;