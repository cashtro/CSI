const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { authenticateUser, checkAdmin } = require('./utils/auth-middleware');




/*const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);*/

// =============== New Teacher Request ===============
router.post('/newRequest', authenticateUser, async (req, res) => {
    const { message } = req.body;
    const accessToken = req.accessToken;

    // Create authenticated Supabase client
    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY,
        {
            global: {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            }
        }
    );

    // Get current user's ID from token
    const {
        data: { user },
        error: userError
    } = await supabase.auth.getUser();

    if (userError || !user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const id_prof = user.id; //  Automatically set id_prof



    // Insert request with user ID
    const { data, error } = await supabase
        .from('teacher_requests')
        .insert([{ id_prof, message }])
        .select('*')
        .single();

    if (error) {
        return res.status(500).json({ error: error.message });
    }

    res.status(201).json(data);
});


router.post('/acceptRequest/:id', checkAdmin, async (req, res) => {
    const { id } = req.params;
    const accessToken = req.accessToken;

    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY,
        { 
            global: { headers: { Authorization: `Bearer ${accessToken}` } }
        }
    );

    try {
     
        const { data: request, error: requestError } = await supabase
            .from('teacher_requests')
            .select('*')
            .eq('id', id)
            .single();

            


        if (requestError || !request) {
            return res.status(404).json({ error: 'Request not found' });
        }

        
        const { data: existingUser, error: userFindError } = await supabase
            .from('Users')
            .select('userId, isTeacher')
            .eq('userId', request.id_prof) 
            .single();

        if (!existingUser || userFindError) {
            return res.status(404).json({ error: 'User not found' });
        }

     
        const { data: updatedUser, error: updateError } = await supabase
            .from('Users')
            .update({ isTeacher: true })
            .eq('userId', request.id_prof) 
            .select();

        if (updateError) {
            return res.status(500).json({ error: 'Update failed' });
        }

        // 4. Delete request
        const { error: deleteError } = await supabase
            .from('teacher_requests')
            .delete()
            .eq('id', id);

        if (deleteError) {
            return res.status(500).json({ error: 'Delete failed' });
        }

        res.status(200).json({ message: 'Success', user: updatedUser });

    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// =============== Refuse Request ===============
router.delete('/refuseRequest/:id', checkAdmin, async (req, res) => {
    const { id } = req.params;
    const accessToken = req.accessToken;

    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY,
        {
            global: {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            }
        }
    );
    //Del directe
    const { error } = await supabase
        .from('teacher_requests')
        .delete()
        .eq('id', id);

    if (error) {
        return res.status(500).json({ error: error.message });
    }

    res.status(200).json({ message: 'Request refused and deleted.' });
});

// =============== List Requests (for Admin) ===============
router.get('/requests', checkAdmin, async (req, res) => {
    const accessToken = req.accessToken;

    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY,
        {
            global: {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            }
        }
    );
    const { data, error } = await supabase
        .from('teacher_requests')
        .select('*, Users: id_prof (username)')
        .order('created_at', { ascending: false });

    if (error) {
        return res.status(500).json({ error: error.message });
    }

    res.status(200).json(data);
});

// =============== Get One Request ===============
router.get('/requests/:id', checkAdmin, async (req, res) => {
    const { id } = req.params;
    const accessToken = req.accessToken;

    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY,
        {
            global: {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            }
        }
    );
    const { data, error } = await supabase
        .from('teacher_requests')
        .select('*')
        .eq('id', id)
        .single();

    if (error) {
        return res.status(500).json({ error: error.message });
    }

    res.status(200).json(data);
});

// =============== Revoke Teacher Access ===============
router.post('/revokeTeacher/:id', checkAdmin, async (req, res) => {
    const { id } = req.params; // id should be userId
    const accessToken = req.accessToken;

    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY,
        {
            global: {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            }
        }
    );

    const { error } = await supabase
        .from('Users')
        .update({ isTeacher: false }) 
        .eq('userId', id); // CHANGED: use userId

    if (error) {
        return res.status(500).json({ error: error.message });
    }

    res.status(200).json({ message: 'Teacher access revoked' });
});

// =============== Get All Users / Only Teachers ===============
router.get('/users', checkAdmin, async (req, res) => {
    const { role } = req.query;
    const accessToken = req.accessToken;

    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY,
        {
            global: {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            }
        }
    );
    
    let query = supabase.from('Users').select('*');
    
    if (role === 'teacher') {
        query = query.eq('isTeacher', true);
    }

    const { data, error } = await query;

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// Removed unauthenticated GET /dev/users: it returned the entire Users table
// with no auth and had no frontend usage. Admins use GET /users (checkAdmin).

module.exports = router;
