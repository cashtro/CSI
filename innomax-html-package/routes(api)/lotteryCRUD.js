const express = require('express');
const router = express.Router();
const { getRange } = require('./utils/pagination');
const { createClient } = require('@supabase/supabase-js');
const upload = require('./utils/multerConfig'); // Chemin corrigé
const { handleLotteryPayment, verifyStripePayment, handleProductPurchase, verifyProductPurchase } = require('./utils/stripe');
//check if admin or connected
const {createSupabaseAdmin, createSupabaseClientWithAuth} = require('./utils/supabaseUtil')
const { checkAdmin, authenticateUser } = require('./utils/auth-middleware');
const rateLimit = require('express-rate-limit');
const { sanitizeRequestBody } = require('./utils/validation-middleware');

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const supabaseAdmin = createSupabaseAdmin();

// Rate limiting for payment attempts
const paymentLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50, // limit each IP to 5 requests per windowMs
    message: 'Too many payment attempts, please try again later'
});

// Input validation middleware
const validatePaymentInput = (req, res, next) => {
    const { lotteryId, entryQuantity } = req.body;
    
    if (!lotteryId || !entryQuantity) {
        return res.status(400).json({
            success: false,
            error: 'Missing required fields'
        });
    }

    if (isNaN(entryQuantity) || entryQuantity <= 0 || entryQuantity > 100) {
        return res.status(400).json({
            success: false,
            error: 'Invalid entry quantity'
        });
    }

    next();
};

//STRIPE Pour Entries----------------------------------------------------------------------------

router.post('/create-payment-session', 
    paymentLimiter, 
    sanitizeRequestBody,  // Add sanitization
    validatePaymentInput, 
    authenticateUser,  // Add authentication middleware
    handleLotteryPayment
);
router.get('/verify-payment', verifyStripePayment);

// Product Purchase Routes
router.post('/create-purchase-product-session',
    paymentLimiter,
    sanitizeRequestBody,
    handleProductPurchase
);

router.get('/verify-purchase', verifyProductPurchase);

//ADMIN----------------------------------------------------------------------------

//POST INFORMATION POUR lottery
router.post('/lotteryData',checkAdmin, upload.single('imageProduit'), async (req, res) => {
    const { nomProduit, lotteryTime, entrieCost, shortDescription, fullDescription, buyable, if_size, price, minimumEntryNeeded } = req.body;
    const imageFile = req.file; 
    // Utilisation de req.file avec Multer

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

        // 2. Validation des données requises
        if (!nomProduit || !lotteryTime || !entrieCost || !shortDescription || !fullDescription || !imageFile) {
            return res.status(400).json({ error: 'Information manquante pour la lottery' });
        }

        if (isNaN(entrieCost) || !Number.isInteger(Number(entrieCost))) {
            return res.status(400).json({ error: "Le coût du ticket doit être un nombre entier" });
        }

        if (isNaN(minimumEntryNeeded) || !Number.isInteger(Number(minimumEntryNeeded))) {
            return res.status(400).json({ error: "Le nombre minimum d'entrées nécessaires doit être un nombre entier" });
        }

        // 3. Création de l'entrée loterie sans image
        const { data: lotteryData, error: insertError } = await supabase
            .from('Lottery')
            .insert([{
                nomProduit,
                lotteryTime,
                entrieCost: Number(entrieCost),
                created_by: req.user.id,
                shortDescription,
                fullDescription,
                buyable: buyable === 'true' || buyable === true,
                if_size: if_size === 'true' || if_size === true,
                price: price ? Number(price) : null,
                minimumEntryNeeded: minimumEntryNeeded
            }])
            .select()
            .single();

        if (insertError) throw insertError;

        const lotteryId = lotteryData.lotteryId;

        // 4. Traitement de l'image si fournie
        if (imageFile) {
            const fileName = `lottery-${nomProduit}`;
            const fileBuffer = imageFile.buffer;
            const fileMimeType = imageFile.mimetype;

            // Upload vers Supabase Storage
            const { error: uploadError } = await supabase.storage
                .from('image-lottery')
                .upload(fileName, fileBuffer, {
                    contentType: fileMimeType,
                    upsert: false,
                    cacheControl: '3600'
                });

            if (uploadError) {
                console.error('Erreur d\'upload:', uploadError);
                // Suppression de l'entrée loterie si l'upload échoue
                await supabase.from('Lottery').delete().eq('lotteryId', lotteryId);
                return res.status(500).json({ error: 'Échec de l\'upload de l\'image' });
            }

            // Récupération de l'URL publique
            const { data: { publicUrl } } = supabase.storage
                .from('image-lottery')
                .getPublicUrl(fileName);

            // Mise à jour de l'entrée avec l'URL de l'image
            const { error: updateError } = await supabase
                .from('Lottery')
                .update({ imageProduit: publicUrl })
                .eq('lotteryId', lotteryId);

            if (updateError) throw updateError;
        }

        // 5. Récupération des données finales
        const { data: finalData } = await supabase
            .from('Lottery')
            .select('*')
            .eq('lotteryId', lotteryId)
            .single();

        return res.status(201).json(finalData);

    } catch (err) {
        console.error('Erreur:', err);
        return res.status(500).json({ 
            error: 'Erreur interne du serveur',
            details: process.env.NODE_ENV === 'development' ? err.message : null
        });
    }
});

// GET information sur la lottery (Image dans le storage, nom du produit, heure du tirage, participant sous forme de json?)
router.get('/lotteryData', async (req, res) => { 
    try {
        // 1. Récupération des paramètres de requête simples
        const { 
            sort = 'created_at', // Champ de tri par défaut
            order = 'desc' // Ordre par défaut
        } = req.query;

        // 2. Construction et exécution de la requête
        const { from, to } = getRange(req.query, { defaultLimit: 100, maxLimit: 200 });
        const { data, error } = await supabase
            .from('Lottery')
            .select('*')
            .order(sort, { ascending: order === 'asc' })
            .range(from, to)

        if (error) throw error;

        // 3. Réponse simplifiée
        return res.status(200).json(data);

    } catch (err) {
        console.error('Erreur:', err);
        return res.status(500).json({ 
            error: 'Erreur lors de la récupération des données' 
        });
    }
});

//GET ALL LOTTERIES INFO FOR DISPLAY IN /LUCKYDRAW
router.get('/lotteryDataluckydraw', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('Lottery')
            .select('imageProduit, nomProduit, lotteryTime, lotteryId')
            .gt('lotteryTime', new Date().toISOString()) /// changé le .eq('isActive', true) par cette ligne pour ne récupérer que les loteries à venir 
            

        if (error) throw error;

        return res.status(200).json(data);

    } catch (err) { 
        console.error('Erreur:', err);
        return res.status(500).json({ 
            error: 'Erreur lors de la récupération des données' 
        });
    }
});

// test
router.get('/achats', async (req, res) => {
    try {
      // Récupérer les données de loterie directement avec Supabase
      const { data: lotteries, error } = await supabase
        .from('Lottery')
        .select('*')
        .order('created_at', { ascending: false });
        
      if (error) throw error;
      
      res.render('achats', { 
        lotteries: lotteries,
        // ...autres variables nécessaires
      });
    } catch (error) {
      console.error('Erreur lors de la récupération des loteries', error);
      res.render('achats', { 
        lotteries: [], // Valeur par défaut en cas d'erreur
        // ...autres variables nécessaires
      });
    }
  });

// GET  USER NUMBER OF Entries
router.get('/lotteryUserData', async (req, res) => {
    try {
        let userId = null;
        let userEntriesMap = {};

        // 1. Tentative d'authentification
        const token = req.headers.authorization?.split(' ')[1];
        if (token) {
            try {
                const { data: { user }, error: authError } = await supabase.auth.getUser(token);
                if (authError) {
                    console.error('Erreur d\'authentification:', authError);
                    // Continue without authentication if token is invalid
                } else if (user) {
                    userId = user.id;
                    
                    // 2. Récupération des entrées uniquement si utilisateur valide
                    const { data: entries, error: entriesError } = await supabase
                        .from('Entry')
                        .select('lotteryId, entryCount')
                        .eq('userId', userId);
                    if (entriesError) {
                        console.error('Erreur lors de la récupération des entrées:', entriesError);
                    }
                    if (!entriesError && entries) {
                        userEntriesMap = {};
                        entries.forEach(entry => {
                          userEntriesMap[entry.lotteryId] = entry.entryCount;
                        });
                      }
                }
            } catch (error) {
                console.error('Erreur lors de la vérification du token:', error);
                // Continue without authentication if there's any error
            }
        }

        // 3. Récupération de toutes les lotteries
        const { sort = 'created_at', order = 'desc' } = req.query;

        const { data: lotteries, error: lotteryError } = await supabase
            .from('Lottery')
            .select('*')
            .order(sort, { ascending: order === 'asc' });

        if (lotteryError) {
            console.error('Erreur lors de la récupération des lotteries:', lotteryError);
            throw lotteryError;
        }

        // 4. Fusion des données avec fallback à 0
        const enhancedLotteries = lotteries.map(lottery => {
            const userEntryCount = userId ? (userEntriesMap[lottery.lotteryId] || 0) : 0;
            return {
                ...lottery,
                userEntries: userEntryCount,
                
            };
        });

        return res.status(200).json(enhancedLotteries);

    } catch (err) {
        console.error('Erreur:', err);
        return res.status(500).json({ 
            error: 'Erreur lors de la récupération des données',
            details: process.env.NODE_ENV === 'development' ? err.message : null
        });
    }
});

// GET 1 row d'information sur la lottery grâce à lotteryId
router.get('/lotteryData/:id', async (req, res) => {
    try {
    

    const supabaseUser = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      
    )
        
        // 1. Récupération du paramètre depuis l'URL
        const lotteryId = req.params.id;


        if (!lotteryId) {
            return res.status(400).json({ 
                success: false,
                error: "L'ID de la lottery est requis dans l'URL" 
            });
        }

        // 3. Requête sécurisée avec vérification de type
        const { data, error } = await supabaseUser
            .from('Lottery')
            .select('*')
            .eq('lotteryId', lotteryId)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return res.status(404).json({ 
                    success: false,
                    error: "Lottery introuvable" 
                });
            }
           console.error(`Erreur Supabase: ${error.message}`);
        }

        // 4. Vérification supplémentaire des données
        if (!data) {
            return res.status(404).json({
                success: false,
                error: "Données non trouvées"
            });
        }

        // 5. Réponse sécurisée
        return res.status(200).json({
            success: true,
            data: data
        });

    } catch (err) {
        console.error('Erreur serveur:', err);
        return res.status(500).json({ 
            success: false,
            error: 'Erreur interne du serveur',
            ...(process.env.NODE_ENV === 'development' && { 
                details: err.message,
                stack: err.stack 
            })
        });
    }
});

// PUT POUR MODIFIER LES INFORMATIONS DES LOTS
router.put('/lotteryData/:id',checkAdmin, upload.single('imageProduit'), async (req, res) => {
    const { id } = req.params;
    const { nomProduit, lotteryTime, shortDescription, fullDescription, entrieCost, buyable, if_size, price,minimumEntryNeeded } = req.body;
    const imageFile = req.file;

    try {


        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_ANON_KEY,
            
          )
        // 2. Vérifier que la loterie existe
        const { data: existingLottery, error: fetchError } = await supabase
            .from('Lottery')
            .select('*')
            .eq('lotteryId', id)
            .single();

        if (fetchError || !existingLottery) {
            return res.status(404).json({ error: 'Loterie non trouvée' });
        }

        // 3. Préparer les données de mise à jour
        const updateData = {
            nomProduit: nomProduit || existingLottery.nomProduit,
            lotteryTime: lotteryTime || existingLottery.lotteryTime,
            shortDescription: shortDescription || existingLottery.shortDescription,
            fullDescription: fullDescription || existingLottery.fullDescription,
            entrieCost: entrieCost || existingLottery.entrieCost,
            buyable: buyable === 'true' || buyable === true || (buyable === undefined && existingLottery.buyable),
            if_size: if_size === 'true' || if_size === true || (if_size === undefined && existingLottery.if_size),
            price: price ? Number(price) : existingLottery.price,
            minimumEntryNeeded: minimumEntryNeeded || existingLottery.minimumEntryNeeded
        };

        // 4. Gestion de l'image
        let imageUrl = existingLottery.imageProduit;
        
        if (imageFile) {
            const fileName = `lottery-${id}`;
            
            // Supprimer l'ancienne image si elle existe
            if (existingLottery.imageProduit) {
                await supabase.storage
                    .from('image-lottery')
                    .remove([fileName]);
            }

            // Uploader la nouvelle image
            const { error: uploadError } = await supabase.storage
                .from('image-lottery')
                .upload(fileName, imageFile.buffer, {
                    contentType: imageFile.mimetype,
                    upsert: true
                });

            if (uploadError) throw uploadError;

            // Récupérer la nouvelle URL
            const { data: { publicUrl } } = supabase.storage
                .from('image-lottery')
                .getPublicUrl(fileName);

            imageUrl = publicUrl;
            updateData.imageProduit = imageUrl;
        }

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
        // 5. Mettre à jour la base de données
        const { data: updatedData, error: updateError } = await supabaseAuthed
            .from('Lottery')
            .update(updateData)
            .eq('lotteryId', id)
            .select()
            .single();

        if (updateError) throw updateError;

        return res.status(200).json(updatedData);

    } catch (err) {
        console.error('Erreur:', err);
        return res.status(500).json({ 
            error: 'Erreur de mise à jour,',
            msg: err,
            details: process.env.NODE_ENV === 'development' ? err.message : null
        });
    }
});

// GET POUR OBTENIR LES INFOS DU CANVAS
router.get('/lotteryCanvasData/:id', authenticateUser, async (req, res) => {
    try {
        const supabaseUser = createSupabaseClientWithAuth(req.headers.authorization);
        const lotteryId = req.params.id;

        if (!lotteryId) {
            return res.status(400).json({ 
                success: false,
                error: "ID de lottery requis" 
            });
        }

        // Optimize the query by:
        // 1. Only selecting needed fields
        // 2. Adding a limit to prevent large result sets
        // 3. Using a more efficient join
        const { data, error } = await supabaseUser
            .from('Entry')
            .select(`
                entryId,
                lotteryId,
                userId,
                entryCount,
                Users:userId (
                    username
                )
            `)
            .eq('lotteryId', lotteryId)
            .limit(1000); // Add a reasonable limit

        if (error) {
            console.error('Erreur Supabase:', error);
            return res.status(500).json({ 
                success: false,
                error: "Erreur de base de données" 
            });
        }

        // Return empty array if no data instead of null
        return res.status(200).json({
            success: true,
            data: data || []
        });

    } catch (err) {
        console.error('Erreur serveur:', err);
        return res.status(500).json({ 
            success: false,
            error: 'Erreur interne'
        });
    }
});

// GET LE USERNAME ET LE ID DU GAGNANT
router.get('/lotteryGagnant/:id', async (req, res) => {
    const lotteryId = req.params.id;

    try {
        // Récupérer la loterie avec la jointure sur l'utilisateur gagnant
        const { data: lottery, error: lotteryError } = await supabase
            .from('Lottery')
            .select(`
                lotteryId,
                idGagnant,
                Users!Lottery_idGagnant_fkey (username)
            `)
            .eq('lotteryId', lotteryId)
            .single();

        if (lotteryError) throw new Error(`Erreur Supabase: ${lotteryError.message}`);
        if (!lottery || !lottery.Users) {
            return res.status(404).json({ error: "Gagnant introuvable" });
        }

        const winner = {
            userId: lottery.idGagnant,
            username: lottery.Users.username
        };


        res.json({
            success: true,
            winner: {
                userId: winner.userId,
                name: winner.username,
                lotteryId: lottery.lotteryId
            },
        });

    } catch (error) {
        console.error(`[ERROR] Tirage ${lotteryId}:`, error.message);
        res.status(500).json({ 
            error: "Échec du tirage",
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});


// ROUTE DELETE Lottery
router.delete('/lotteryData/:id', checkAdmin, async (req, res) => {
    const { id } = req.params;
  
    try {
      const { data, error } = await supabaseAdmin
        .from('Lottery')
        .delete()
        .eq('lotteryId', id)
        .select(); // To check what was deleted
  
      if (error) {
        return res.status(500).json({ error: 'Erreur lors de la suppression' }); // Internal Server Error
      }
  
      if (!data || data.length === 0) {
        return res.status(404).json({ message: 'Aucune loterie trouvée à supprimer' }); // Not Found
      }
  
      return res.status(200).json({ message: 'Loterie supprimée avec succès' }); // Success
  
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur' }); // Internal Server Error
    }
  });
  


module.exports = router;
