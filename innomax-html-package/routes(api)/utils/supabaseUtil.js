// Import necessary libraries
const { createClient } = require('@supabase/supabase-js');

// Create a Supabase client with the anonymous key for public operations
const createSupabaseClient = () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  return supabase;
};

// Create a Supabase Admin client with the service role key for administrative tasks
const createSupabaseAdmin = () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_KEY;
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);
  return supabaseAdmin;
};

const createSupabaseClientWithAuth = (headerToken) => {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    {
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
