const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = {
  async storeTempSession(sessionId, userId, req, rememberMe, accessToken, refreshToken) {
    const { error } = await supabase
      .from('temp_sessions')
      .insert({
        id: sessionId,
        userId: userId,  // Id de l'utilisateur
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
        remember_me: rememberMe,  // Préférence de l'utilisateur
        access_token: accessToken,  // Enregistrement du token d'accès
        refresh_token: refreshToken,  // Enregistrement du token de rafraîchissement
        expires_at: new Date(Date.now() + 300000).toISOString(), // 5 minutes
        created_at: new Date().toISOString()
      });
  
    if (error) {
      console.error('Session storage error:', error);
      throw new Error('Session storage failed');
    }
  },
  

  async getAndValidateSession(sessionId, req) {
    try {
      const { data, error } = await supabase
        .rpc('validate_temp_session', {
          p_session_id: sessionId,
          p_ip: req.ip,
          p_user_agent: req.headers['user-agent']
        });
  
      if (error || !data) {
        console.warn('Invalid session attempt:', {
          sessionId,
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          error
        });
        return null;
      }
  
      return {
        userId: data.userId,
        rememberMe: data.remember_me,  // Préférence de l'utilisateur
        accessToken: data.access_token,  // Récupération du token d'accès
        refreshToken: data.refresh_token,  // Récupération du token de rafraîchissement
        ip: data.ip_address,
        userAgent: data.user_agent
      };
    } catch (err) {
      console.error('Session validation error:', err);
      return null;
    }
  },
  

  async cleanupExpiredSessions() {
    try {
      const { error } = await supabase
        .from('temp_sessions')
        .delete()
        .lt('expires_at', new Date().toISOString());
      
      if (error) console.error('Cleanup error:', error);
    } catch (err) {
      console.error('Cleanup failed:', err);
    }
  }
};