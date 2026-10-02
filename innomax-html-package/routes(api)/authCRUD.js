const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { authenticator } = require('otplib');
const qrcode = require('qrcode');
const { authenticateUser, setAuthCookies, clearAuthCookies, twoFaLimiter, authLimiter } = require('./utils/auth-middleware');
const { loginValidation, registrationValidation, validatePassword } = require('./utils/validation-middleware');
const { storeTempSession, getAndValidateSession } = require('./utils/supabaseSessionStore');
const { createSupabaseAdmin } = require('./utils/supabaseUtil');
const { sendEmail } = require('./utils/emailService');
const { encryptSecret, decryptSecret } = require('./utils/crypto2fa');
const crypto = require('crypto');

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);
const supabaseAdmin = createSupabaseAdmin();

router.get('/validateToken', async (req, res) => {
    try {
        // Disable caching to prevent 304 responses
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');

        let token = req.cookies.accessToken || req.headers.authorization?.split(' ')[1];
        // if (!token) throw new Error('Token manquant');

        // Step 1: Validate the access token
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);

        // Step 2: If access token is invalid but refreshToken exists, try refreshing
        if ((authError || !user) && req.cookies.refreshToken) {
            const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession({
                refresh_token: req.cookies.refreshToken
            });

            if (refreshError || !refreshed?.session) {
                // Clear invalid cookies and force re-login
                clearAuthCookies(res);
                return res.status(401).json({ 
                    success: false, 
                    error: 'Session expired. Please log in again.' 
                });
            }

            // Update cookies with new tokens
            setAuthCookies(res, refreshed.session.access_token, refreshed.session.refresh_token, true);
            
            // Return success with refreshed user data
            return res.status(200).json({ 
                success: true,
                message: 'Session refreshed',
                user: refreshed.user 
            });
        }

        // Step 3: If no refreshToken or refresh failed, reject
        if (authError || !user) {
            return res.status(401).json({ 
                success: false, 
                error: 'Token invalide' 
            });
        }

        // Step 4: Original token is valid
        res.status(200).json({
            success: true,
            message: 'Accès accordé, token valide',
            user: { id: user.id } // Only expose necessary user data
        });

    } catch (err) {
        console.error('Token validation error:', err);
        // Send JSON error (don't mix res.json() and res.redirect())
        res.status(401).json({ 
            success: false, 
            error: err.message || 'Erreur d’authentification' 
        });
    }
});
 
//TODO add validation (regex or express validator)
// Registration route - modified to log out after registration
router.post('/register', authLimiter, registrationValidation, async (req, res) => {
    const { username, email, age, password, confirmPassword } = req.body;
    const trimmedPassword = password ? password.trim() : '';

    // Validate password exists and meets length requirement
    if (!trimmedPassword || trimmedPassword.length < 8 || trimmedPassword.length > 64) {
        return res.status(400).json({
            message: "Password must be between 8 and 64 characters long"
        });
    }

    // Password complexity validation
    const passwordComplexityRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,64}$/;
    if (!passwordComplexityRegex.test(trimmedPassword)) {
        return res.status(400).json({
            message: "Password must contain at least one uppercase letter, one number, and one special character."
        });
    }

    // Validate password match
    if (trimmedPassword !== confirmPassword?.trim()) {
        return res.status(400).json({ message: "Passwords do not match" });
    }

    // Email validation
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ message: "Invalid email format" });
    }

    // Age validation
    if (age < 13) {
        return res.status(400).json({ message: "You must be at least 13 years old" });
    }

    try {
        // Check if email exists in Users table
        const { data: existingUser, error: checkError } = await supabase
            .from('Users')
            .select('*')
            .eq('email', email)
            .single();

        if (checkError && checkError.code !== 'PGRST116') { // PGRST116 is the error code for no rows found
            throw checkError;
        }

        if (existingUser) {
            if (existingUser.useProvider) {
                return res.status(409).json({ message: "This email is already registered. Please try logging in instead." });
            }
            return res.status(409).json({ message: "Email already in use" });
        }

        // Proceed with normal registration if email doesn't exist
        const { data, error } = await supabase.auth.signUp({
            email,
            password: trimmedPassword,
            options: {
                data: {
                    username,
                    age
                },
                emailRedirectTo: `${process.env.APP_URL}/email-confirmed-callback`
            }
        });

        if (error) throw error;

        // Insert into Users table
        const { error: insertError } = await supabase
            .from('Users')
            .insert([{
                userId: data.user.id,
                username,
                email,
                age
            }]);

        if (insertError) {
            console.error('Database Insert Error:', insertError);
            await supabase.auth.admin.deleteUser(data.user.id);
            throw insertError;
        }

        res.status(201).json({
            message: "Registration successful! Please check your email to verify your account.",
        });

    } catch (error) {
        console.error('Registration Error:', error);
        res.status(500).json({
            message: "Server error during registration",
            details: error.message
        });
    }
});

// Déconnexion
router.post('/logout', authenticateUser, async (req, res) => {
    try {
        // Log out from Supabase
        const { error: logoutError } = await supabase.auth.signOut();
        if (logoutError) throw logoutError;

        // Clear cookies with the same attributes they were set with.
        clearAuthCookies(res);

        return res.status(200).json({ message: "Déconnexion réussie !" });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erreur lors de la déconnexion" });
    }
});

// Route pour la connexion
router.post('/login', authLimiter, loginValidation, async (req, res) => {
    const { email, password, rememberMe } = req.body;

    try {
        // 1. Authentification de base
        const { data: { user, session }, error: authError } =
            await supabase.auth.signInWithPassword({ email, password });
        

        if (authError) {
            if (authError.message.includes("Email not confirmed")) {
                return res.status(403).json({ message: "Please verify your email before logging in" });            }
            throw authError;
        }

        // 2. Vérifier le statut 2FA
        const { data: user2fa, error: user2faError } = await supabase
            .from('Users_2fa')
            .select('enabled, secret')
            .eq('userId', user.id)
            .single();



        // REQUIRED2FA (challenge): a 2FA row exists AND is enabled -> demand a TOTP code.
        // Previously this gated on `!user2fa.enabled`, which let fully-enabled 2FA
        // accounts skip the second factor entirely (auth bypass).
        if (user2fa && user2fa.enabled) {
            // Create temporary session reference
            const tempSessionId = crypto.randomBytes(32).toString('hex');
            await storeTempSession(
                tempSessionId, 
                user.id, 
                req, 
                req.body.rememberMe, // Store with session
                session.access_token, 
                session.refresh_token,
              );                    
            return res.status(200).json({
                requires2FA: true,
                tempSessionId,
                userId: user.id
            });
        }
        // REQUIRED2FASETUP-----------------------------------------------------------------
        if (!user2fa) {

            // 2FA jamais configuré → proposer le setup sans encore l'enregistrer
            const secret = authenticator.generateSecret();
            const otpauth = authenticator.keyuri(email, 'Pandora', secret);
            const qrCode = await qrcode.toDataURL(otpauth);

            const tempSessionId = crypto.randomBytes(32).toString('hex');
            await storeTempSession(
                tempSessionId, 
                user.id, 
                req, 
                req.body.rememberMe, // Store with session
                session.access_token, 
                session.refresh_token,
              );          

            return res.status(200).json({
                requires2FASetup: true,
                secret,
                qrCode,
                tempSessionId,
                userId: user.id
            });
        }


        // EVERYTHING IS GOOD, CONNEXION
        await setAuthCookies(res, session.access_token, session.refresh_token, rememberMe);
        return res.status(200).json({
            message: "Connexion réussie !",
            accessToken: session.access_token,
            refreshToken: session.refresh_token
        });

    } catch (error) {
        console.error('Login error:', error);
        return res.status(401).json({
            message: "Échec de l'authentification",
            error: error.message
        });
    }
});

router.post('/verify-2fa', twoFaLimiter, async (req, res) => {
    const { code, tempSessionId, isSetup, secret } = req.body;
    
    try {
        // Input validation
        if (!code || !tempSessionId) {
            return res.status(400).json({ error: 'Invalid input' });
        }

        // Validate code format
        if (!/^\d{6}$/.test(code)) {
            return res.status(400).json({ error: 'Invalid code format' });
        }

        const session = await getAndValidateSession(tempSessionId, req);
        if (!session) {
            console.error('Invalid session in verify-2fa');
            return res.status(401).json({ error: 'Invalid or expired session' });
        }

        const rememberMe = session.rememberMe;
        const accessToken = session.accessToken;
        const refreshToken = session.refreshToken;

        // Set security headers
        res.set({
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Surrogate-Control': 'no-store'
        });

        // 1. Vérification de la session
        const { data: user, error: userError } = await supabase
            .from('Users')
            .select('*')
            .eq('userId', session.userId)
            .single();

        if (userError) throw userError;
        
        // 2. Récupération du secret
        let verificationSecret;

        if (isSetup) {
            // Nouveau setup : on utilise le secret fourni temporairement
            verificationSecret = secret;
        } else {
            // Cas classique : récupérer le secret enregistré
            const { data: user2fa, error: fetchError } = await supabase
                .from('Users_2fa')
                .select('secret')
                .eq('userId', user.userId)
                .single();
            if (fetchError || !user2fa) {
                throw new Error("2FA not configured");
            }
            verificationSecret = decryptSecret(user2fa.secret);
        }

        const cleanCode = String(code).trim();
        const cleanSecret = String(verificationSecret).trim();

        // Verify the code with a window of 1 to be more strict
        const isValid = authenticator.verify({
            token: cleanCode,
            secret: cleanSecret,
            window: 1
        });

        if (!isValid) {
            console.warn(`Invalid 2FA code attempt for user ${user.email}`);
            return res.status(401).json({ error: 'Invalid 2FA code' });
        }

        // If setup, enable 2FA
        if (isSetup) {
            const { error: updateError } = await supabase
                .from('Users_2fa')
                .upsert({
                    userId: user.userId,
                    email: user.email,
                    secret: encryptSecret(cleanSecret),
                    enabled: true,
                    updated_at: new Date()
                });

            if (updateError) {
                console.error("2FA setup error:", updateError);
                throw updateError;
            }
        }

        // Set auth cookies
        await setAuthCookies(res, accessToken, refreshToken, rememberMe);

        return res.status(200).json({
            success: true,
            message: "2FA verification successful",
            accessToken: accessToken,
            refreshToken: refreshToken
        });

    } catch (error) {
        console.error("2FA Verification Error:", error);
        return res.status(500).json({
            error: error.message || "Server error during 2FA verification"
        });
    }
});

router.post('/toggle-2fa', authenticateUser, async (req, res) => {
    const { enable, code } = req.body;
    // Authorization comes from the authenticated session, never the request body.
    const userId = req.user.id;

    try {
        // Require a valid TOTP code for BOTH enabling and disabling 2FA (proves
        // possession of the authenticator). Enabling without proof was possible
        // before, and a stolen bearer token could flip 2FA with no code.
        const { data: user2fa } = await supabase
            .from('Users_2fa')
            .select('secret')
            .eq('userId', userId)
            .single();

        if (!user2fa || !user2fa.secret) {
            return res.status(400).json({ message: "2FA n'est pas configuré. Utilisez d'abord la configuration." });
        }

        if (!code || !authenticator.verify({ token: String(code).trim(), secret: decryptSecret(user2fa.secret) })) {
            return res.status(401).json({ message: "Code 2FA invalide" });
        }

        const { error } = await supabase
            .from('Users_2fa')
            .upsert({
                userId,
                enabled: enable,
                updated_at: new Date()
            });

        if (error) throw error;

        return res.status(200).json({ 
            message: `2FA ${enable ? 'activé' : 'désactivé'} avec succès` 
        });

    } catch (error) {
        console.error("Toggle 2FA Error:", error.message);
        return res.status(500).json({ message: "Erreur lors de la modification du 2FA" });
    }
});

// In routes(api)/authCRUD.js
router.post('/UserProvider', async (req, res) => {
    const { session } = req.body;

    try {
        if (!session || !session.access_token) {
            return res.status(400).json({ message: 'Missing OAuth session' });
        }

        // Verify the token server-side and derive identity/provider from the
        // VERIFIED user — never trust fields on the client-supplied session.
        const { data: { user }, error } = await supabase.auth.getUser(session.access_token);
        if (error || !user) {
            return res.status(401).json({ message: 'Invalid token or user not found' });
        }
        const provider = user.app_metadata?.provider || null;


        // Check if user already exists
        const { data: existingUser, error: checkError } = await supabase
            .from('Users')
            .select('*')
            .eq('userId', user.id)
            .single();


        if (checkError && checkError.code !== 'PGRST116') { // PGRST116 is the error code for no rows found
            throw checkError;
        }

        if (existingUser) {
            // User exists, just set auth cookies and return success
            const rememberMe = true;
            setAuthCookies(res, session.access_token, null, rememberMe);
            return res.status(200).json({ message: 'User logged in successfully' });
        }

        // Insert new user
        const { error: insertError } = await supabase
            .from('Users')
            .insert({
                userId: user.id,
                username: user.user_metadata?.name,
                email: user.email,
                age: null,
                useProvider: true,
                provider: provider,
                providerId: user.id
            });
        
        
        if (insertError) throw insertError;

        // Set cookies for new user
        const rememberMe = true;
        setAuthCookies(res, session.access_token, null, rememberMe);

        res.status(201).json({ message: 'User created and logged in successfully' });

    } catch (err) {
        console.error('Insert User Error:', err);
        res.status(500).json({ message: 'Error processing user', error: err.message });
    }
});

//get info for a User by user_id
router.get('/user/:userId', authenticateUser, async (req, res) => {
    try {
        const { userId } = req.params;

        // Authorization: a user may read only their own record, unless they are
        // an admin. Prevents IDOR (any logged-in user reading anyone's full row).
        if (req.user.id !== userId) {
            const { data: requester } = await supabase
                .from('Users')
                .select('isAdmin')
                .eq('userId', req.user.id)
                .single();
            if (!requester || !requester.isAdmin) {
                return res.status(403).json({ error: 'Forbidden' });
            }
        }

        // Return a minimal field set (never select('*') for user records).
        const { data, error } = await supabase
            .from('Users')
            .select('userId, username, email, age, isAdmin, isTeacher')
            .eq('userId', userId)
            .single();

        if (error) throw error;
        res.json(data);
    } catch (error) {
        console.error('Error fetching user:', error.message);
        res.status(500).json({ error: 'Unable to fetch user' });
    }
});

router.post('/regenerate-2fa', twoFaLimiter, async (req, res) => {
    const { tempSessionId } = req.body;
    
    try {
        // Get the session
        const session = await getAndValidateSession(tempSessionId, req);
        if (!session) return res.status(401).json({ error: 'Invalid session' });

        // Generate new secret
        const secret = authenticator.generateSecret();
        const otpauth = authenticator.keyuri(session.email, 'Pandora', secret);
        const qrCode = await qrcode.toDataURL(otpauth);

        // Update the secret in the database
        const { error: updateError } = await supabase
            .from('Users_2fa')
            .update({
                secret: encryptSecret(secret),
                enabled: false,
                updated_at: new Date()
            })
            .eq('userId', session.userId);

        if (updateError) throw updateError;

        return res.status(200).json({
            requires2FASetup: true,
            secret,
            qrCode,
            tempSessionId
        });

    } catch (error) {
        console.error('Regenerate 2FA error:', error);
        return res.status(500).json({
            message: "Erreur lors de la régénération du 2FA",
            error: error.message
        });
    }
});

// Check if email exists
router.post('/check-email', async (req, res) => {
    const { email } = req.body;
    
    try {
        const { data, error } = await supabase
            .from('Users')
            .select('email')
            .eq('email', email)
            .single();
            
        if (error && error.code !== 'PGRST116') { // PGRST116 is the error code for no rows found
            throw error;
        }
        
        res.json({ exists: !!data });
    } catch (error) {
        console.error('Error checking email:', error);
        res.status(500).json({ error: error.message });
    }
});

// Link OAuth account with existing password account
router.post('/link-account', async (req, res) => {
    const { email, password, session } = req.body;

    try {
        // 1. Verify the password identity.
        const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError) {
            return res.status(401).json({ error: 'Invalid password' });
        }

        // 2. Verify the OAuth session SERVER-SIDE and bind it to the same email.
        // Previously the OAuth providerId came straight from req.body.session,
        // so a user who knew a password could attach an arbitrary OAuth identity.
        if (!session || !session.access_token) {
            return res.status(400).json({ error: 'Missing OAuth session' });
        }
        const { data: { user: oauthUser }, error: oauthError } = await supabase.auth.getUser(session.access_token);
        if (oauthError || !oauthUser) {
            return res.status(401).json({ error: 'Invalid OAuth session' });
        }
        if ((oauthUser.email || '').toLowerCase() !== (email || '').toLowerCase()) {
            return res.status(403).json({ error: 'OAuth account email does not match this account' });
        }
        const provider = oauthUser.app_metadata?.provider || null;

        // 3. Link using the VERIFIED OAuth identity.
        const { error: updateError } = await supabase
            .from('Users')
            .update({
                useProvider: true,
                provider: provider,
                providerId: oauthUser.id
            })
            .eq('email', email);

        if (updateError) {
            throw updateError;
        }

        // 4. Set auth cookies with the verified OAuth session.
        setAuthCookies(res, session.access_token, session.refresh_token, true);

        res.json({ success: true, message: 'Accounts linked successfully' });
    } catch (error) {
        console.error('Error linking accounts:', error.message);
        res.status(500).json({ error: 'Unable to link accounts' });
    }
});

// Check if account is already linked with a provider
router.post('/check-linked', async (req, res) => {
    const { email, providerId } = req.body;
    
    try {
        const { data, error } = await supabase
            .from('Users')
            .select('useProvider, providerId')
            .eq('email', email)
            .single();
            
        if (error && error.code !== 'PGRST116') { // PGRST116 is the error code for no rows found
            throw error;
        }
        
        // Check if the account is linked and the providerId matches
        const isLinked = data && data.useProvider && data.providerId === providerId;
        
        res.json({ isLinked });
    } catch (error) {
        console.error('Error checking linked account:', error);
        res.status(500).json({ error: error.message });
    }
});

// Check if 2FA is required for a user
router.post('/check-2fa', async (req, res) => {
    const { userId, session } = req.body;

    try {
        // First verify the session and get the user
        const { data: { user }, error: authError } = await supabase.auth.getUser(session.access_token);
        if (authError || !user) {
            throw new Error('Invalid session');
        }

        // Then check if 2FA is enabled for the user
        const { data: user2fa, error: user2faError } = await supabase
            .from('Users_2fa')
            .select('enabled, secret')
            .eq('userId', user.id)
            .single();

        if (user2faError && user2faError.code !== 'PGRST116') {
            throw user2faError;
        }

        // REQUIRED2FA (challenge): a 2FA row exists AND is enabled -> demand a TOTP code.
        // Fixed inverted gate that previously let enabled-2FA accounts through.
        if (user2fa && user2fa.enabled) {
            // Create temporary session reference
            const tempSessionId = crypto.randomBytes(32).toString('hex');
            await storeTempSession(
                tempSessionId, 
                user.id, 
                req, 
                true, // Store with session
                session.access_token, 
                session.refresh_token,
            );                    
            return res.status(200).json({
                requires2FA: true,
                tempSessionId,
                userId: user.id
            });
        }

        // REQUIRED2FASETUP-----------------------------------------------------------------
        if (!user2fa) {
            // 2FA never configured → propose setup without saving yet
            const secret = authenticator.generateSecret();
            const otpauth = authenticator.keyuri(user.email, 'Pandora', secret);
            const qrCode = await qrcode.toDataURL(otpauth);

            const tempSessionId = crypto.randomBytes(32).toString('hex');
            await storeTempSession(
                tempSessionId, 
                user.id, 
                req, 
                true, // Store with session
                session.access_token, 
                session.refresh_token,
            );          

            return res.status(200).json({
                requires2FASetup: true,
                secret,
                qrCode,
                tempSessionId,
                userId: user.id
            });
        }

        // If 2FA is already enabled, return success
        return res.status(200).json({
            requires2FA: false
        });

    } catch (error) {
        console.error('Check 2FA Error:', error);
        return res.status(500).json({
            message: 'Error checking 2FA status',
            error: error.message
        });
    }
});

// EMAIL VERIFICATION
router.post('/check-confirmation', authLimiter, async (req, res) => {
    const { email } = req.body;
    
    try {
        // Get user by email (admin API)
        const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers();
        
        if (error) throw error;

        // Find our specific user
        const user = users.find(u => u.email === email);

        // Never leak the raw admin user object (PII / auth metadata).
        if (!user) {
            return res.json({ confirmed: false, exists: false });
        }

        // Proper confirmation check
        const isConfirmed = user.user_metadata?.email_verified === true;

        res.json({ confirmed: isConfirmed, exists: true });

    } catch (error) {
        console.error('Error checking confirmation:', error?.message);
        res.status(500).json({ error: 'Unable to check confirmation status' });
    }
});

// RESEND CONFIRMATION EMAIL
router.post('/resend-confirmation', authLimiter, async (req, res) => {
    const { email } = req.body;

    try {
        // Use the correct method name and parameters
        const { data, error } = await supabaseAdmin.auth.admin.generateLink({
            type: 'signup', // Changed to correct type
            email: email,
            options: {
                redirectTo: `${process.env.APP_URL}/email-confirmed-callback`  // Add your confirmation redirect URL
            }
        });

        if (error) throw error;
        // Send confirmation email - note the updated property access
        await sendEmail(
            email,
            'Confirm your email',
            `Click here to confirm your email: <a href="${data.properties.action_link}">${data.properties.action_link}</a>`
        );

        res.json({ success: true, message: 'Confirmation email sent' });
    } catch (error) {
        // NOTE: previously logged `error.body.errors`, which threw a TypeError when
        // `error.body` was undefined, masking the real failure.
        console.error('Error resending confirmation:', error?.message);
        res.status(500).json({ error: 'Unable to resend confirmation email' });
    }
});

module.exports = router;