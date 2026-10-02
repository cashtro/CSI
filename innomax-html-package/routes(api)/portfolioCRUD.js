const express = require('express');
const logger = require('./utils/logger');
const router = express.Router();
const { getRange } = require('./utils/pagination');
const { createClient } = require('@supabase/supabase-js');
const upload = require('./utils/multerConfig'); // Multer config pour fichier
//check if admin or connected

const {authenticateUser, checkAdmin} = require('./utils/auth-middleware');

// Init Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);


// Route POST - Ajouter un projet au portfolio
router.post('/portfolio', checkAdmin, upload.single('file'), async (req, res) =>{
    const { title, genre, urlPortfolio } = req.body;
    const imageFile = req.file;
    const accessToken = req.accessToken; // Récupération du token d'accès de l'utilisateur connecté
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
      )
  

    try {
    

        // 2. Validation des données
        if (!title || !genre || !urlPortfolio) {
            return res.status(400).json({ error: 'Champs requis manquants' });
        }

        // 3. Création de l'entrée portfolio (sans image pour l’instant)
        const { data: portfolioData, error: insertError } = await supabase
            .from('Portfolio')
            .insert([{
                title,
                genre,
                urlPortfolio
            }])
            .select()
            .single();

        if (insertError) throw insertError;


        const portfolioId = portfolioData.id;


        // 4. Upload image si présente
        if (imageFile) {
              
            const fileName = `portfolio-${portfolioId}-${Date.now()}`;
            const fileBuffer = imageFile.buffer;
            const fileMimeType = imageFile.mimetype;

            const { error: uploadError } = await supabase.storage
                .from('portfolio-images')
                .upload(fileName, fileBuffer, {
                    contentType: fileMimeType,
                    upsert: false,
                    cacheControl: '3600'
                });

                if (uploadError) {
                    logger.error("Erreur Supabase upload:", uploadError.message, uploadError);
                    await supabase.from('Portfolio').delete().eq('id', portfolioId);
                    return res.status(500).json({ 
                      error: 'Échec de l\'upload de l\'image',
                      details: uploadError.message 
                    });
                  }

            // URL publique de l’image
            const { data: { publicUrl } } = supabase.storage
                .from('portfolio-images')
                .getPublicUrl(fileName);

            // Mise à jour de l'entrée
            const { error: updateError } = await supabase
                .from('Portfolio')
                .update({ image_portfolio: publicUrl })
                .eq('id', portfolioId);

            if (updateError) throw updateError;
        }

        // 5. Retour des données complètes
        const { data: finalData } = await supabase
            .from('Portfolio')
            .select('*')
            .eq('id', portfolioId)
            .single();

        return res.status(201).json(finalData);

    } catch (err) {
        logger.error('Erreur:', err);
        return res.status(500).json({
            error: 'Erreur interne du serveur',
        });
    }
});

// route pour get TOUT le portfolio
router.get('/portfolio', async (req, res) => {
    const { from, to } = getRange(req.query, { defaultLimit: 100, maxLimit: 200 });
    const { data, error } = await supabase.from('Portfolio').select('*').range(from, to);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });
  

// route pour get 1 portfolio
router.get('/portfolio/:id',authenticateUser, async (req, res) => {
    const { id } = req.params;


    const { data, error } = await supabase.from('Portfolio').select('*').eq('id', id).single();
    if (error) return res.status(404).json({ error: 'Portfolio non trouvé' });
    res.json(data);
  });
  

//route pour Update 1 portfolio
router.put('/portfolio/:id', checkAdmin, async (req, res) => {
    const { id } = req.params;
    const { title, genre, urlPortfolio } = req.body;
    const accessToken = req.accessToken; // Récupération du token d'accès de l'utilisateur connecté
    const supabase= createClient(
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
  
 
    const { data, error } = await supabase
      .from('Portfolio')
      .update({ title, genre, urlPortfolio })
      .eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, data });
  });
  

// route pour delete 1 portfolio
router.delete('/portfolio/:id', checkAdmin, async (req, res) => {
    const { id } = req.params;
    const accessToken = req.accessToken; // Récupération du token d'accès de l'utilisateur connecté
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
      )
  

    const { error } = await supabase.from('Portfolio').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });
  
  module.exports = router;
