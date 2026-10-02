const express = require('express');
const logger = require('./routes(api)/utils/logger');
// Route handlers are async; without this a rejected promise skips Express's
// error handling and an unhandled rejection takes the whole process down.
require('express-async-errors');
const path = require('path');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
// Boot-safety: validate env and install non-throwing sentinels BEFORE any route
// (and its SDK clients) is required, so a missing credential can't crash startup.
require('./routes(api)/utils/config');
const cookieParser = require('cookie-parser');
const csrf = require('csurf'); // ✅ Protection CSRF
const compression = require('compression');
const helmet = require('helmet');

//const swaggerUi = require('swagger-ui-express');
//const swaggerConfig = require('./swagger/swagger-config.js');
//const YAML = require('yamljs');

const app = express();
app.disable("x-powered-by");
// Real client IP behind the reverse proxy (rate limits, logs). See utils/trustProxy.
{
  const { parseTrustProxy } = require('./routes(api)/utils/trustProxy');
  const trust = parseTrustProxy(process.env.TRUST_PROXY);
  if (trust !== false) app.set('trust proxy', trust);
  else if (process.env.TRUST_PROXY === 'true') logger.warn('[config] TRUST_PROXY=true refused (spoofable); use the number of proxies, e.g. 1.');
}
const PORT = process.env.PORT || 3000; //le env à revoir pour le deploiement
// Pages that render API data call this server over loopback. The Host header
// is client-controlled, so building the URL from it allowed SSRF and let a
// forged Host crash the process.
const SELF_URL = `http://127.0.0.1:${PORT}`;

//const authroutes = require('./routes(api)/exempl'); //EXEMPLE
const authRoutes = require('./routes(api)/authCRUD.js'); // Adjust the path if necessary
const courseRoutes = require('./routes(api)/courseCRUD.js')
const lotteryRoutes = require('./routes(api)/lotteryCRUD.js');
const {performLotteryDraw} = require('./routes(api)/utils/lotteryServices.js');
const rdvRoutes = require('./routes(api)/rdvCRUD.js')
const portfolioRoutes = require('./routes(api)/portfolioCRUD.js')
const dispoRoutes = require('./routes(api)/dispoCRUD.js')
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./docs');
const achatRoutes = require('./routes(api)/achatsCRUD.js');
const teacherRoutes = require('./routes(api)/demandCRUD.js')
const agentsAdminRoutes = require('./routes(api)/agentsAdmin.js');
const agentsClientRoutes = require('./routes(api)/agentsClient.js');
const { healthHandler } = require('./agents/health');
const { createSupabaseAdmin } = require('./routes(api)/utils/supabaseUtil');


const { authenticateUser, setAuthCookies } = require('./routes(api)/utils/auth-middleware.js');
const { cookieSecure } = require('./routes(api)/utils/cookies');
// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);


app.use(compression());

// Security headers. Content-Security-Policy is disabled for now because the app
// relies on inline scripts and ~20 external CDNs; a tailored CSP is a follow-up.
// The remaining protections (HSTS, X-Content-Type-Options, frameguard,
// Referrer-Policy, etc.) apply safely and remove X-Powered-By.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));


// Liveness for monitoring: db ok/ko, queue sizes, last worker heartbeat.
// Nothing else (no error text, no config state).
let healthDb;
app.get('/healthz', healthHandler(() => (healthDb = healthDb || createSupabaseAdmin())));

// Configurer le moteur de template EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware pour les fichiers statiques
// Code (JS/CSS) is revalidated on every load via ETag so a deploy reaches
// browsers at once; media is cached for a year. Previously everything was
// cached a year with no ETag, so JS/CSS fixes never reached returning visitors.
const REVALIDATE = /\.(js|mjs|css|map|json|html)$/i;
app.use('/assets', express.static(path.join(__dirname, 'assets'), {
  etag: true,
  maxAge: '1y',
  setHeaders(res, filePath) {
    if (REVALIDATE.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
  },
}));



// Middleware to inject Pixel ID globally
app.use((req, res, next) => {
  res.locals.pixelId = process.env.FACEBOOK_PIXEL_ID; // Set your actual Pixel ID 
  next();
});

//ON MET SUREMENT LES ROUTES ICI
//app.use('/auth',authroutes); //DONC NORMALEMENT LES ROUTES DEVIENNET /auth/login PAR EXEMPLE, à voir comment faire un global pour /api
app.use(cookieParser());

// Stripe webhook must receive the RAW body for signature verification, so it is
// registered BEFORE the JSON body parser (which would otherwise consume it).
const { stripeWebhookHandler } = require('./routes(api)/webhook');
app.post('/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);
// Content-Security-Policy in report-only mode (never blocks; collects violation
// reports to build an enforcing policy later). Report sink accepts + drops.
const { cspReportOnly } = require('./routes(api)/utils/csp');
app.use(cspReportOnly);
app.post('/api/csp-report', express.json({ type: ['application/json', 'application/csp-report', 'application/reports+json'] }), (req, res) => res.sendStatus(204));
// Unified double-submit CSRF. issueCsrfCookie always sets a readable XSRF-TOKEN;
// csrfGuard only ENFORCES when CSRF_ENFORCE=true (safe dark rollout).
const { issueCsrfCookie, csrfGuard } = require('./routes(api)/utils/csrf');
app.use(issueCsrfCookie);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Site CMS: exposes content(key, fallback) to every template (utils/cms).
app.use(require('./routes(api)/utils/cms').middleware);

// Configurer le middleware CSRF avec les cookies
const csrfProtection = csrf({
  cookie: {
    httpOnly: true,
    sameSite: 'Strict',
    secure: cookieSecure(),
  }
});

app.get('/api/csrf-token', csrfProtection, (req, res) => {
  res.cookie('XSRF-TOKEN', req.csrfToken()); // Optional: set it as cookie
  res.json({ csrfToken: req.csrfToken() });
});



//const swaggerDocument = YAML.load('./swagger/swagger.yaml');

//app.use('/api',swaggerUi.serve, swaggerUi.setup(swaggerDocument));
// Route principale
//app.get('/', (req, res) => {
//  res.render('home4', {currentPage: '/'}); //ou pour user literallement l'objet user
//});

// // POUR ENLEVER LE CACHE POUR dashboard AFIN D'EVITER LES LEAK
// app.use(['/dashboard'], (req, res, next) => {
//   res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
//   res.setHeader('Pragma', 'no-cache');
//   res.setHeader('Expires', '0');
//   next();
// });


// app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec))
//ROUTE AUTHENTIFICATION authCRUD
// CSRF guard for all /api routes (no-op unless CSRF_ENFORCE=true).
app.use('/api', csrfGuard);
app.use('/api/auth', authRoutes);
app.use('/api/course', courseRoutes);
app.use('/api/lottery', lotteryRoutes);
app.use('/api/rdv', rdvRoutes)
app.use('/api/portfolio',portfolioRoutes )
app.use('/api/dispo',dispoRoutes )
app.use('/api/teacher',teacherRoutes)
app.use('/api/achats', achatRoutes);
// Agent engine (agents/, MOTEUR-AGENTS.md): admin + 2FA, and client read-only.
app.use('/api/admin/agents', agentsAdminRoutes);
app.use('/api/agents', agentsClientRoutes);
// Espace entreprises (client space) and the admin console. Each router checks
// membership / admin + 2FA on the server and requires the CSRF header.
app.use('/api/espace', require('./routes(api)/espaceCRUD.js'));
app.use('/api/admin', require('./routes(api)/adminCRUD.js'));
app.use(require('./routes(api)/espacePages.js'));
//swagger starts here to wait for all routes to start

//swaggerConfig(app);


app.get('/', async (req, res) => {
  try {
    const { data: courses, error: courseError } = await supabase
      .from('cours')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(3);

    const { data: lotteries, error: lotteryError } = await supabase
      .from('Lottery')
      .select('*')
      .gt('lotteryTime', new Date().toISOString())
      .order('created_at', { ascending: true })
      .limit(3);

  

    res.render('home4', {
      currentPage: '/',
      courses: courses || [],
      lotteries: lotteries || []
    });
  } catch (error) {
    logger.error('Error fetching data:', error);
    res.render('home4', {
      currentPage: '/',
      courses: [],
      lotteries: []
    });
  }
});

// Plus besoin d'utiliser :access_token
app.get('/reset-password', (req, res) => {
  res.render('reset-password', {
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
    currentPage: '/reset-password'
  });
});



app.get('/marketing', (req, res) => {
  res.render('marketing', { currentPage: '/marketing' });
});

app.get('/nft', (req, res) => {
  res.render('nft', { currentPage: '/nft' });
});

app.get('/education', async (req, res) => {
  try {
    const apiUrl = `${SELF_URL}/api/course/all-courses`;
    
    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }
    
    const courses = await response.json();
    
    res.render('education', { 
      currentPage: '/education',
      courses: courses,
      stripePublicKey: process.env.STRIPE_PUBLIC_KEY
    });
  } catch (error) {
    logger.error('Error fetching courses:', error);
    res.render('education', { 
      currentPage: '/education',
      courses: [],
      stripePublicKey: process.env.STRIPE_PUBLIC_KEY
    });
  }
});

app.get('/TechAi', (req, res) => {
  res.render('TechAndAi', { currentPage: '/TechAi' });
});

app.get('/login', (req, res) => {
  res.render('login', 
    { currentPage: '/login',
      APP_URL: process.env.APP_URL,
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY
    });
});

app.get('/signup', (req, res) => {
  res.render('signup', 
    {  
      APP_URL: process.env.APP_URL,
      supabaseUrl: process.env.SUPABASE_URL,
       supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
       currentPage: '/signup' });
});

app.get('/portfolio', async (req, res) => {

  const apiUrl = `${SELF_URL}/api/portfolio/portfolio`;


  const response = await fetch(apiUrl);
  const portfolioData = await response.json();

  res.render('portfolio', 
    {portfolioItems: portfolioData , 
    currentPage: '/portfolio'} );
});

app.get('/oauth-callback', (req, res) => {
  res.render('oauth-callback', { currentPage: '/oauth-callback' });
})

  app.get('/signup-callback', (req, res) => {
    res.render('signup-callback', { currentPage: '/signup-callback' });
  })

  app.get('/email-confirmed-callback', (req, res) => {
    res.render('email-confirmed-callback', { currentPage: '/email-confirmed-callback' });
  })

// Route dynamique pour afficher un cours spécifique
app.get('/course-details/:courseId', async (req, res) => {
  const courseId = req.params.courseId;
  const apiUrl = require('./routes(api)/utils/selfUrl').selfApiUrl(SELF_URL, '/api/course/course-details/', courseId);

  const response = await fetch(apiUrl);
  const course = await response.json();
  
  if (course) {
    res.render('course-details', { data: course, currentPage: '/education',  stripePublicKey: process.env.STRIPE_PUBLIC_KEY });
  } else {
    res.status(404).send("Cours non trouvé");
  }
});

// Route pour afficher tous les cours
app.get('/all-courses', async (req, res) => {
  const apiUrl = `${SELF_URL}/api/course/all-courses`;


  const response = await fetch(apiUrl);
  const courses = await response.json();

  


  res.render('all-courses', {
    data: { courses: courses },
    currentPage: '/education'
  });
});

// Côté Lottery
app.get('/luckydraw', async (req, res) => {
  try {
    // Create absolute URL using request's protocol and host
    const apiUrl = `${SELF_URL}/api/lottery/lotteryDataluckydraw`;

    // Fetch data using absolute URL
    const response = await fetch(apiUrl);
    const lotteries = await response.json();



    // Render the EJS template with the data
    res.render('lottery', {
      lotteries: lotteries,
      currentPage: '/luckydraw'
    });

  } catch (error) {
    logger.error(error);
    res.render('lottery', { lotteries: [], currentPage: '/luckydraw' });
  }
});

app.get('/Purchase-Lottery-Tickets', async (req, res) => {
  try {
    // Validation des paramètres obligatoires
    if (!req.query.lotteryId) {
      return res.status(400).json({
        success: false,
        error: 'Paramètres manquants: lotteryId requis'
      });
    }

    const lotteryId = req.query.lotteryId;

    // Get tokens
    const accessToken = req.headers.authorization?.split(' ')[1] || req.cookies.accessToken;
    const refreshToken = req.cookies.refreshToken;

    if (!accessToken && !refreshToken) {
      return res.redirect('/login');
    }

    let user;
    let token = accessToken;

    // First try with access token
    if (accessToken) {
      const { data: { user: accessUser }, error: authError } = await supabase.auth.getUser(accessToken);
      if (!authError && accessUser) {
        user = accessUser;
      }
    }

    // If access token failed or not present, try refresh token
    if (!user && refreshToken) {
      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession({
        refresh_token: refreshToken
      });

      if (!refreshError && refreshed?.session) {
        user = refreshed.session.user;
        token = refreshed.session.access_token;
        
        // Same attributes as every other auth cookie, so logout can clear them.
        setAuthCookies(res, refreshed.session.access_token, refreshed.session.refresh_token, true);
      }
    }

    // If both tokens failed
    if (!user) {
      return res.redirect('/login');
    }

    // Create authenticated Supabase client with the valid token
    const supabaseUser = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      {
        global: {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      }
    );

    // Fetch lottery data directly from Supabase
    const { data: lotteryData, error: lotteryError } = await supabaseUser
      .from('Lottery')
      .select('*')
      .eq('lotteryId', lotteryId)
      .single();

    if (lotteryError || !lotteryData) {
      return res.status(404).json({
        success: false,
        error: 'Lottery not found'
      });
    }

    // Fetch canvas data directly from Supabase
    const { data: canvasData, error: canvasError } = await supabaseUser
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
      .limit(1000);

    if (canvasError) {
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch canvas data'
      });
    }

    //get the stripe public key from the env
    const stripePublicKey = process.env.STRIPE_PUBLIC_KEY;

    res.render('lotteryPaiement', {
      lotteryData: { success: true, data: lotteryData },
      canvasData: { success: true, data: canvasData || [] },
      userId: user.id,
      stripePublicKey: stripePublicKey,
      currentPage: '/luckydraw'
    });

  } catch (error) {
    logger.error('Erreur:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

app.get('/contact', (req, res) => {
  res.render('contact', { currentPage: '/contact' });
});
// Route pour traiter la soumission du formulaire
app.post('/submit-contact', (req, res) => {
  const { name, email, phone, message } = req.body;



  // Rediriger vers la page de remerciement
  res.render('feedback.ejs');
});

app.get('/subscription', (req, res) => {
  res.render('subscription', { currentPage: '/education' , stripePublicKey: process.env.STRIPE_PUBLIC_KEY});
});

 //Route pour afficher les achats dans achats.ejs
  app.get('/achats', async (req, res) => {
  try {
    const apiUrl = `${SELF_URL}/api/achats`;
    const response = await fetch(apiUrl);
    if (!response.ok) throw new Error('Erreur lors de la récupération des produits');
      const productsData = await response.json();
    // Map API fields to those expected by the EJS template
    const products = (productsData || []).map(item => ({
      id: item.id,
      title: item.nomProduit,
      price: item.price,
      description: item.shortDescription,
      image: item.imageProduit
    }));

    const stripePublicKey = process.env.STRIPE_PUBLIC_KEY;

    res.render('achats', { 
      products, // send to EJS
      stripePublicKey: stripePublicKey,
      currentPage: '/achats'
    });
  } catch (error) {
    res.render('achats', { 
      products: [],
      stripePublicKey: process.env.STRIPE_PUBLIC_KEY,
      currentPage: '/achats',
      error: error.message
    });
  }
});



//removed authenticate user cuz actual get (visual) aka no href can give header (HTML 6 WHEN lol)
app.get('/dashboard', async (req, res) => {
  

    const token = req.headers.authorization?.split(' ')[1] || req.cookies.accessToken;
    if (!token) {
      return res.redirect('/login');
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user){
      res.clearCookie('accessToken')
      return res.redirect('/login');
    } 

  const { data: userData, error: userError } = await supabase
        .from('Users')
        .select('isAdmin')
        .eq('userId', user.id)
        .single();

    if (userError || !userData) return res.redirect('login');
       //no workey // no admin
      userData.isAdmin ? res.render('dashboard-admin') : res.render('dashboard-client')
  //res.render('dashboard-demo');
});

// app.get('/dashboard-admin', (req, res)=>{
//   res.render('dashboard-admin')
// })

// app.get('/dashboard-client', (req, res) => {
//   res.render('dashboard-client');
// });


/*
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');

const swaggerDocument = YAML.load(path.join(__dirname,'swagger','swagger.yaml'));
app.use('/api',swaggerUi.serve,swaggerUi.setup(swaggerDocument));
*/









// Importations nécessaires


// Route pour gérer les webhooks Stripe (recommandé pour la production)
// app.post('/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
//   const sig = req.headers['stripe-signature'];

//   try {
//     const event = stripe.webhooks.constructEvent(
//       req.body,
//       sig,
//       'whsec_votre_clé_webhook' // Remplacez par votre clé webhook Stripe
//     );

//     // Gérer différents types d'événements
//     switch (event.type) {
//       case 'payment_intent.succeeded':
//         const paymentIntent = event.data.object;
//         logger.info('PaymentIntent réussi:', paymentIntent.id);
//         // Logique pour traiter un paiement réussi
//         break;
//       case 'payment_intent.payment_failed':
//         const failedPaymentIntent = event.data.object;
//         logger.info('Échec de PaymentIntent:', failedPaymentIntent.id);
//         // Logique pour traiter un échec de paiement
//         break;
//       default:
//         logger.info(`Type d'événement non géré: ${event.type}`);
//     }

//     res.status(200).json({ received: true });
//   } catch (error) {
//     logger.error('Erreur lors du traitement du webhook:', error);
//     res.status(400).send(`Webhook Error: ${error.message}`);
//   }
// });


app.get('*', (req, res) => {
  res.status(404).render('404', { currentPage: req.originalUrl });
});

// Last-resort error handler: log server-side, never send stack traces.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error(`[error] ${req.method} ${req.originalUrl}:`, err);
  if (res.headersSent) return;
  const status = err.status || err.statusCode || 500;
  if (req.originalUrl.startsWith('/api/')) return res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
  res.status(status).send(status >= 500 ? 'Une erreur est survenue. Veuillez réessayer.' : err.message);
});

// Background work (lottery draws, timers) must not kill the web process either.
process.on('unhandledRejection', (reason) => {
  logger.error('[unhandledRejection]', reason);
});

// Démarrer le serveur sec change to ,'0.0.0.0'
app.listen(PORT, () => {
  logger.info(`Serveur démarré sur http://localhost:${PORT}`);
});

//----------------------------------------------------------------------------
//  Tirage toutes les 10 seconds =============================================
//----------------------------------------------------------------------------
let isDrawing = false;

setInterval(async () => {
  if (isDrawing) return;
  isDrawing = true;

  try {
    await performLotteryDraw();
  } catch (err) {
    logger.error("Draw error:", err.message);
  } finally {
    isDrawing = false;
  }
}, 10 * 1000);
//===========================================================================



