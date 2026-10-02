const express = require('express');
const logger = require('./utils/logger');
const router = express.Router();
const { authenticator } = require('otplib');
const qrcode = require('qrcode');
const { authenticateUser, getValidUser, setAuthCookies, clearAuthCookies, setMfaProof, twoFaLimiter, authLimiter } = require('./utils/auth-middleware');
const { loginValidation, registrationValidation, validatePassword } = require('./utils/validation-middleware');
const { storeTempSession, getAndValidateSession } = require('./utils/supabaseSessionStore');
const { createSupabaseClient, createSupabaseAdmin } = require('./utils/supabaseUtil');
const { sendEmail } = require('./utils/emailService');
const { encryptSecret, decryptSecret } = require('./utils/crypto2fa');
const { signSetup, setupMode, get2fa, isPrivileged, secondFactorStep } = require('./utils/twofa');
const crypto = require('crypto');

// C4: access/refresh tokens are always set as httpOnly cookies. They are ALSO
// echoed in the JSON body for the current token-reading frontend. Setting
// OMIT_BODY_TOKENS=true stops echoing them (reduces XSS token-theft surface);
// enable it once the frontend authenticates via the cookies instead. Flag-gated
// and default-off so it's a zero-risk change until the frontend is migrated.
function tokenResponseFields(accessToken, refreshToken) {
  if (process.env.OMIT_BODY_TOKENS === 'true') return {};
  return { accessToken, refreshToken };
}

// Initialize stateless Supabase clients (see utils/supabaseUtil).
const supabase = createSupabaseClient();
const supabaseAdmin = createSupabaseAdmin();

// A fresh authenticator secret, its QR code and the token that lets verify-2fa
// accept it for this temp session only.
async function setupPayload(tempSessionId, email, mode) {
    const secret = authenticator.generateSecret();
    const qrCode = await qrcode.toDataURL(authenticator.keyuri(email, 'Pandora', secret));
    return { secret, qrCode, tempSessionId, setupToken: signSetup(tempSessionId, secret, mode) };
}

// The second-factor response for an authenticated user, or null when the
// policy in utils/twofa lets them in without one. Cookies are never set here.
async function secondFactorResponse(req, { userId, email, session, rememberMe }) {
    const step = await secondFactorStep(supabaseAdmin, userId);
    if (step === 'none') return null;
    const tempSessionId = crypto.randomBytes(32).toString('hex');
    await storeTempSession(tempSessionId, userId, req, rememberMe, session.access_token, session.refresh_token);
    if (step === 'challenge') return { requires2FA: true, tempSessionId, userId };
    return { requires2FASetup: true, ...(await setupPayload(tempSessionId, email, 'new')), userId };
}

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
        logger.error('Token validation error:', err);
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
            logger.error('Database Insert Error:', insertError);
            // Needs the service client; the anon client can never delete users.
            await supabaseAdmin.auth.admin.deleteUser(data.user.id);
            throw insertError;
        }

        res.status(201).json({
            message: "Registration successful! Please check your email to verify your account.",
        });

    } catch (error) {
        logger.error('Registration Error:', error);
        res.status(500).json({
            message: "Server error during registration",
            details: error.message
        });
    }
});

// Déconnexion. Always clears every auth cookie (including the 'mfa' 2FA
// proof), even when the session is already expired or invalid: refusing with
// 401 used to leave those cookies in the browser.
router.post('/logout', async (req, res) => {
    try {
        const { user, token } = await getValidUser(req, res);
        if (user && token) {
            // Revoke this session's refresh token. The stateless anon client holds
            // no session, so its signOut() was a no-op that left the token valid.
            const { error: logoutError } = await supabaseAdmin.auth.admin.signOut(token, 'local');
            if (logoutError) logger.warn('Logout revoke failed:', logoutError.message);
        }
    } catch (error) {
        logger.warn('Logout revoke failed:', error.message);
    }
    // Clear cookies with the same attributes they were set with.
    clearAuthCookies(res);
    res.set('Cache-Control', 'no-store');
    return res.status(200).json({ message: "Déconnexion réussie !" });
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

        // 2. Second factor (policy in utils/twofa).
        const secondFactor = await secondFactorResponse(req, { userId: user.id, email, session, rememberMe });
        if (secondFactor) return res.status(200).json(secondFactor);

        // EVERYTHING IS GOOD, CONNEXION
        await setAuthCookies(res, session.access_token, session.refresh_token, rememberMe);
        return res.status(200).json({
            message: "Connexion réussie !",
            ...tokenResponseFields(session.access_token, session.refresh_token)
        });

    } catch (error) {
        logger.error('Login error:', error);
        return res.status(401).json({
            message: "Échec de l'authentification",
            error: error.message
        });
    }
});

router.post('/verify-2fa', twoFaLimiter, async (req, res) => {
    const { code, tempSessionId, isSetup, secret, setupToken } = req.body;
    
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
            logger.error('Invalid session in verify-2fa');
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
        const { data: user, error: userError } = await supabaseAdmin
            .from('Users')
            .select('userId, email')
            .eq('userId', session.userId)
            .single();

        if (userError) throw userError;
        
        // 2. Récupération du secret
        let verificationSecret;
        const current = await get2fa(supabaseAdmin, user.userId);

        if (isSetup) {
            // Only a secret this server minted for this temp session is accepted,
            // and a "new" setup may never overwrite an enabled authenticator.
            const mode = setupMode(tempSessionId, String(secret || '').trim(), setupToken);
            if (!mode) {
                return res.status(400).json({ error: 'Invalid 2FA setup' });
            }
            if (mode === 'new' && current && current.enabled) {
                return res.status(409).json({ error: '2FA is already enabled for this account' });
            }
            verificationSecret = secret;
        } else {
            if (!current || !current.enabled || !current.secret) {
                throw new Error("2FA not configured");
            }
            verificationSecret = decryptSecret(current.secret);
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
            logger.warn(`Invalid 2FA code attempt for user ${user.userId}`);
            return res.status(401).json({ error: 'Invalid 2FA code' });
        }

        // If setup, enable 2FA
        if (isSetup) {
            const { error: updateError } = await supabaseAdmin
                .from('Users_2fa')
                .upsert({
                    userId: user.userId,
                    email: user.email,
                    secret: encryptSecret(cleanSecret),
                    enabled: true,
                    updated_at: new Date()
                });

            if (updateError) {
                logger.error("2FA setup error:", updateError);
                throw updateError;
            }
        }

        // Set auth cookies, plus the proof that this browser passed 2FA.
        await setAuthCookies(res, accessToken, refreshToken, rememberMe);
        setMfaProof(res, user.userId, rememberMe);

        return res.status(200).json({
            success: true,
            message: "2FA verification successful",
            ...tokenResponseFields(accessToken, refreshToken)
        });

    } catch (error) {
        logger.error("2FA Verification Error:", error);
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
        if (!enable && await isPrivileged(supabaseAdmin, userId)) {
            return res.status(403).json({ message: "La 2FA est obligatoire pour les comptes administrateur et enseignant." });
        }

        // Require a valid TOTP code for BOTH enabling and disabling 2FA (proves
        // possession of the authenticator). Enabling without proof was possible
        // before, and a stolen bearer token could flip 2FA with no code.
        const { data: user2fa } = await supabaseAdmin
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

        const { error } = await supabaseAdmin
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
        logger.error("Toggle 2FA Error:", error.message);
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
            // Cookies come from check-2fa, after the second factor.
            return res.status(200).json({ message: 'User found', requires2FACheck: true });
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

        // Cookies come from check-2fa, after the second factor.
        res.status(201).json({ message: 'User created', requires2FACheck: true });

    } catch (err) {
        logger.error('Insert User Error:', err);
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
        logger.error('Error fetching user:', error.message);
        res.status(500).json({ error: 'Unable to fetch user' });
    }
});

router.post('/regenerate-2fa', twoFaLimiter, async (req, res) => {
    const { tempSessionId, code } = req.body;

    try {
        const session = await getAndValidateSession(tempSessionId, req);
        if (!session) return res.status(401).json({ error: 'Invalid session' });

        // Nothing is written here: the new secret only replaces the old one once
        // verify-2fa sees a valid code for it. Replacing an enabled authenticator
        // requires its current code; a lost device goes through support. (This
        // endpoint used to reset enabled=false, which skipped 2FA on next login.)
        const current = await get2fa(supabaseAdmin, session.userId);
        let mode = 'new';
        if (current && current.enabled) {
            if (!code || !authenticator.verify({ token: String(code).trim(), secret: decryptSecret(current.secret) })) {
                return res.status(401).json({
                    error: 'Current 2FA code required',
                    message: "Entrez le code actuel de votre application pour générer un nouveau code QR. Si vous avez perdu l'accès, contactez le support."
                });
            }
            mode = 'rotate';
        }

        const { data: profile } = await supabaseAdmin
            .from('Users')
            .select('email')
            .eq('userId', session.userId)
            .single();

        return res.status(200).json({
            requires2FASetup: true,
            ...(await setupPayload(tempSessionId, profile?.email || 'Pandora', mode))
        });

    } catch (error) {
        logger.error('Regenerate 2FA error:', error);
        return res.status(500).json({ message: "Erreur lors de la régénération du 2FA" });
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
        logger.error('Error checking email:', error);
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

        // No cookies here: the client signs in again through check-2fa.
        res.json({ success: true, message: 'Accounts linked successfully', requires2FACheck: true });
    } catch (error) {
        logger.error('Error linking accounts:', error.message);
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
        logger.error('Error checking linked account:', error);
        res.status(500).json({ error: error.message });
    }
});

// Check if 2FA is required for a user
router.post('/check-2fa', async (req, res) => {
    const { session } = req.body;

    try {
        if (!session || !session.access_token) {
            return res.status(400).json({ message: 'Missing OAuth session' });
        }
        const { data: { user }, error: authError } = await supabase.auth.getUser(session.access_token);
        if (authError || !user) {
            return res.status(401).json({ message: 'Invalid session' });
        }

        const secondFactor = await secondFactorResponse(req, {
            userId: user.id, email: user.email, session, rememberMe: true
        });
        if (secondFactor) return res.status(200).json(secondFactor);

        // No second factor needed: the only place an OAuth sign-in gets cookies.
        setAuthCookies(res, session.access_token, session.refresh_token, true);
        return res.status(200).json({ requires2FA: false });

    } catch (error) {
        logger.error('Check 2FA Error:', error);
        return res.status(500).json({ message: 'Error checking 2FA status' });
    }
});

// EMAIL VERIFICATION
router.post('/check-confirmation', authLimiter, async (req, res) => {
    const { email } = req.body;
    
    try {
        // listUsers() only returns the first page (50 users), so past 50 sign-ups
        // most accounts were reported as missing. Resolve the id from Users
        // (written at registration), then read that one auth user.
        const { data: profile, error: profileError } = await supabaseAdmin
            .from('Users')
            .select('userId')
            .eq('email', String(email || '').trim())
            .maybeSingle();
        if (profileError) throw profileError;

        let user = null;
        if (profile) {
            const { data, error } = await supabaseAdmin.auth.admin.getUserById(profile.userId);
            if (error) throw error;
            user = data.user;
        }

        // Never leak the raw admin user object (PII / auth metadata).
        if (!user) {
            return res.json({ confirmed: false, exists: false });
        }

        // Proper confirmation check
        const isConfirmed = Boolean(user.email_confirmed_at) || user.user_metadata?.email_verified === true;

        res.json({ confirmed: isConfirmed, exists: true });

    } catch (error) {
        logger.error('Error checking confirmation:', error?.message);
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
        logger.error('Error resending confirmation:', error?.message);
        res.status(500).json({ error: 'Unable to resend confirmation email' });
    }
});

module.exports = router;