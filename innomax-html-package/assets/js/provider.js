import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
const supabaseClient = createClient(
  window.supabaseUrl,
  window.supabaseAnonKey
); 

// Create error message element
const errorMessage = document.createElement('div');
errorMessage.className = 'oauth-error-message';
errorMessage.style.display = 'none';
errorMessage.style.color = 'red';
errorMessage.style.marginTop = '10px';
errorMessage.style.textAlign = 'center';
errorMessage.style.padding = '10px';
errorMessage.style.borderRadius = '5px';
errorMessage.style.backgroundColor = 'rgba(255, 0, 0, 0.1)';

// Add error message to the social login section
const socialLoginSection = document.querySelector('.social-login');
if (socialLoginSection) {
    socialLoginSection.appendChild(errorMessage);
}

export function signInWithProvider(provider) {
    // Hide any previous error message
    errorMessage.style.display = 'none';
    
    supabaseClient.auth.signInWithOAuth({
      provider: provider,
      options: {
        redirectTo: `${window.APP_URL}/oauth-callback`
      }
    }).then(({ error }) => {
      if (error) {
        console.error('OAuth error:', error);
        // Show error message to user
        errorMessage.textContent = `Erreur d'authentification: ${error.message}`;
        errorMessage.style.display = 'block';
      }
    });
}

// DOCUMENT -------------------------------------------------------------
document.getElementById('googleLogin').addEventListener('click', () => signInWithProvider('google'));
