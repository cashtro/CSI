// api.js - Centralized request handler
let csrfToken;
let isInitializingCSRF = false;

// Session management
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
let lastActivity = Date.now();

// Track user activity
document.addEventListener('mousemove', updateLastActivity);
document.addEventListener('keydown', updateLastActivity);
document.addEventListener('click', updateLastActivity);
document.addEventListener('scroll', updateLastActivity);

function updateLastActivity() {
    lastActivity = Date.now();
}

// Read a cookie value by name (used for the double-submit CSRF token).
function readCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
}

// Check session timeout every minute
setInterval(() => {
    if (Date.now() - lastActivity > SESSION_TIMEOUT) {
        resetCSRF();
        // Redirect to login with timeout message
        window.location.href = '/login?timeout=true';
    }
}, 60000);

export async function initializeCSRF() {
  // Prevent multiple simultaneous initializations
  if (isInitializingCSRF) {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (!isInitializingCSRF) {
          clearInterval(checkInterval);
          resolve(csrfToken);
        }
      }, 100);
    });
  }
  
  isInitializingCSRF = true;
  
  try {
    const response = await fetch('/api/csrf-token', {
      credentials: 'include',
      cache: 'no-store',
      headers: {
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to get CSRF token: ${response.status}`);
    }
    
    const data = await response.json();
    if (!data.csrfToken || typeof data.csrfToken !== 'string') {
      throw new Error('Invalid CSRF token received');
    }
    
    csrfToken = data.csrfToken;
    return csrfToken;
  } catch (error) {
    console.error("CSRF Initialization Error:", error);
    throw new Error('Security system initialization failed. Please refresh the page.');
  } finally {
    isInitializingCSRF = false;
  }
}

export async function secureFetch(url, options = {}) {
  updateLastActivity();

  try {
    if (!csrfToken) {
      await initializeCSRF();
    }

    const headers = {
      'Content-Type': 'application/json',
      // Double-submit: echo the XSRF-TOKEN cookie (matches the unified csrfGuard);
      // fall back to the csurf token for backward compatibility.
      'X-CSRF-Token': readCookie('XSRF-TOKEN') || csrfToken,
      'X-Requested-With': 'XMLHttpRequest',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      ...options.headers
    };

    let response = await fetch(url, {
      ...options,
      credentials: 'include',
      cache: 'no-store',
      headers
    });

    if (response.status === 403) {
      console.debug("CSRF Token expired, refreshing...");
      await initializeCSRF();

      response = await fetch(url, {
        ...options,
        credentials: 'include',
        cache: 'no-store',
        headers: {
          ...headers,
          'X-CSRF-Token': readCookie('XSRF-TOKEN') || csrfToken
        }
      });
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Request failed with status ${response.status}`);
    }

    return response;
  } catch (error) {
    console.error('SecureFetch Error:', error);
    throw error;
  }
}

//FOR LOGGING out
export function resetCSRF() {
    csrfToken = null;
    // Clear any stored tokens or sensitive data
    document.cookie.split(";").forEach(function(c) { 
        document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/"); 
    });
}

// Enhanced logout function
export async function secureLogout() {
    try {
        // Clear CSRF token
        resetCSRF();
        
        // Clear all cookies
        document.cookie.split(";").forEach(function(c) { 
            document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/"); 
        });

        // Clear local storage
        localStorage.clear();
        sessionStorage.clear();

        // Make a logout request to the server
        await secureFetch('/api/auth/logout', {
            method: 'POST',
            credentials: 'include'
        });

        // Redirect to login page
        window.location.href = '/login?from=confirmation';
    } catch (error) {
        console.error('Logout failed:', error);
        // Still redirect to login even if logout request fails
        window.location.href = '/login?from=confirmation';
    }
}