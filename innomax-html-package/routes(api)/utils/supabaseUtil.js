// Import necessary libraries
const { createClient } = require('@supabase/supabase-js');

// Server-side clients must be stateless: never persist or auto-refresh an
// auth session on the shared module-level client. Otherwise sign-in/sign-out on
// one request can mutate the session used by concurrent requests (identity bleed
// across users). Every request supplies its own JWT explicitly.
const STATELESS_AUTH = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};

// Create a Supabase client with the anonymous key for public operations
const createSupabaseClient = () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  const supabase = createClient(supabaseUrl, supabaseAnonKey, STATELESS_AUTH);
  return supabase;
};

// Create a Supabase Admin client with the service role key for administrative tasks
const createSupabaseAdmin = () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_KEY;
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, STATELESS_AUTH);
  return supabaseAdmin;
};

const createSupabaseClientWithAuth = (headerToken) => {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    {
      ...STATELESS_AUTH,
      global: {
        headers: {
          Authorization: headerToken,
        },
      },
    }
  );
}


class SupabaseService {
  constructor() {
    this._client = null;
    this._admin = null;
  }
 
  get client() {
    if (!this._client) this._client = createSupabaseClient();
    return this._client;
  }
 
  get admin() {
    if (!this._admin) this._admin = createSupabaseAdmin();
    return this._admin;
  }
 
  createAuthenticatedClient(token) {
    if (!token) throw new Error('Token requis pour l\'authentification');
   
    const formattedToken = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
    return createSupabaseClientWithAuth(formattedToken);
  }

}





// Export both clients for use in your app
module.exports = { createSupabaseClient, createSupabaseAdmin, createSupabaseClientWithAuth, SupabaseService };
