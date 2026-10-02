import { secureFetch, initializeCSRF } from './api.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabase = createClient(
    window.supabaseUrl,
    window.supabaseAnonKey
  );
// Make togglePassword globally accessible
window.togglePassword = function() {
    const passwordField = document.getElementById('password');
    const toggleIcon = document.querySelector('.password-toggle');
  
    if (passwordField.type === 'password') {
        passwordField.type = 'text';
        toggleIcon.classList.replace('bi-eye-slash', 'bi-eye');
    } else {
        passwordField.type = 'password';
        toggleIcon.classList.replace('bi-eye', 'bi-eye-slash');
    }
}

// Gestionnaire principal après chargement du DOM
document.addEventListener('DOMContentLoaded', async () => {
    await initializeCSRF(); // From your api.js

    // Éléments DOM
    const loginForm = document.getElementById('loginForm');
    const verificationModal = document.getElementById('verificationModal');
    const qrCodeModal = document.getElementById('qrCodeModal');
    const codeInputs = document.querySelectorAll('.code-input');
    const verifyBtn = document.querySelector('.btn-verify');
    const resendCodeBtn = document.getElementById('resendCode');
    const forgotPasswordLink = document.getElementById('forgotPasswordLink');
    const forgotPasswordForm = document.getElementById('forgotPasswordForm');
    const closeForgotPassword = document.getElementById('closeForgotPassword');
    
    


    // Gestionnaire de connexion
    loginForm.addEventListener('submit', handleLoginSubmit);

    // Gestion des entrées de code
    setupCodeInputs(codeInputs);

    // Gestion mot de passe oublié
    forgotPasswordLink.addEventListener('click', showForgotPasswordModal);
    closeForgotPassword.addEventListener('click', closeForgotPasswordModal);
    forgotPasswordForm.addEventListener('submit', handlePasswordReset);

  
});

function showError(message, action = null) {
    // Remove any existing error message
    const existingError = document.getElementById('loginError');
    if (existingError) {
        existingError.remove();
    }

    // Create new error message
    const errorDiv = document.createElement('div');
    errorDiv.id = 'loginError';
    errorDiv.style.cssText = 'background:rgba(255, 215, 0, 0.12); border:1.5px solid #D4AF37; color:#855e1b; border-radius:8px; padding:12px 16px; margin-bottom:18px; font-size:15px; font-weight:500; display:flex; align-items:center; gap:8px;';
    
    const icon = document.createElement('i');
    icon.className = 'bi bi-exclamation-triangle-fill';
    icon.style.cssText = 'color:#D4AF37; font-size:18px;';
    
    const messageSpan = document.createElement('span');
    messageSpan.id = 'loginErrorMsg';
    messageSpan.textContent = message;
    
    errorDiv.appendChild(icon);
    errorDiv.appendChild(messageSpan);

    // Add the action button if provided
    if (action) {
        const actionSpan = document.createElement('span');
        actionSpan.textContent = action.label;
        actionSpan.className = 'resend-link';
        actionSpan.onclick = action.onClick;
    
        // Add spacing before the link
        const spacer = document.createTextNode(' ');
        messageSpan.appendChild(spacer);
        messageSpan.appendChild(actionSpan);
    }
    
    
    const form = document.getElementById('loginForm');
    form.parentNode.insertBefore(errorDiv, form);
}

async function handleLoginSubmit(e) {
    e.preventDefault();
  
    // Clear previous errors
    const existingError = document.getElementById('loginError');
    if (existingError) existingError.remove();
  
    // Show loading state
    const submitButton = e.target.querySelector('button[type="submit"]');
    const originalButtonText = submitButton.textContent;
    submitButton.disabled = true;
    submitButton.innerHTML = '<span class="spinner"></span> Logging in...';

    let email; // Declare email here

    try {
        const formData = new FormData(e.target);
        email = formData.get('email'); // Assign email

        const result = await secureFetch('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({
                email: email,
                password: formData.get('password'),
                rememberMe: document.getElementById('rememberMe').checked
            })
        });

        const data = await result.json();

        if (data.requires2FASetup) {
            showQRCodeModal(data.secret, data.qrCode, data.tempSessionId);
        } else if (data.requires2FA) {
            show2FAModal(data.tempSessionId);
        } else {
            if (data.accessToken) sessionStorage.setItem('accessToken', data.accessToken);
            updateHeaderButtons();
            // Change this line:
            // window.location.href = '/';
            // To this:
            window.location.assign('/');
        }

    } catch (error) {
        console.error('Login error:', error);

        if (error instanceof Error) {
            const msg = error.message.toLowerCase();

            if (msg.includes('please verify your email before logging in')) {
                showError(
                    'Please verify your email address before logging in.',
                    {
                        label: 'Resend confirmation email',
                        onClick: () => resendConfirmationEmail(email)
                    }
                );
            } else if (msg.includes('csrf')) {
                showError('Security error. Please refresh the page.');
            } else {
                showError('Invalid email address or password. Please try again.');
            }
        } else {
            showError('An unexpected error occurred. Please try again.');
        }
    } finally {
        // Reset button state
        submitButton.disabled = false;
        submitButton.textContent = originalButtonText;
    }
}

  
function clearErrors() {
    document.querySelectorAll('.error-message').forEach(el => {
        el.textContent = '';
        el.style.display = 'none';
    });
    document.querySelectorAll('.form-control').forEach(input => {
        input.classList.remove('input-error');
    });
}

function handleFormError(message) {
    const emailError = document.getElementById('emailError');
    const passwordError = document.getElementById('passwordError');
    const emailInput = document.querySelector('input[name="email"]');
    const passwordInput = document.querySelector('input[name="password"]');

    // Reset previous errors
    clearErrors();

    // Show error message for invalid login
    if (message.includes('email') || message.includes('password') || message.includes('login')) {
        emailError.textContent = 'Invalid email or password. Please try again.';
        passwordError.textContent = 'Invalid email or password. Please try again.';
        emailError.style.display = 'block';
        passwordError.style.display = 'block';
        emailInput.classList.add('input-error');
        passwordInput.classList.add('input-error');
    } else if (message.includes('enter both')) {
        emailError.textContent = 'Please enter your email';
        passwordError.textContent = 'Please enter your password';
        emailError.style.display = 'block';
        passwordError.style.display = 'block';
        emailInput.classList.add('input-error');
        passwordInput.classList.add('input-error');
    }
}

function showQRCodeModal(secret, qrCode, tempSessionId) {

    if (!secret || !tempSessionId) {
        console.error("Invalid 2FA setup parameters");
        window.location.href = '/login';
        return;
    }
    
    // Vérification des éléments DOM
    const modal = document.getElementById('qrCodeModal');
    if (!modal) {
        console.error("Modal QR Code non trouvé");
        return;
    }

    // Affichage du QR Code
    const qrContainer = modal.querySelector('.qr-code-container');
    if (qrCode.startsWith('<svg')) {
        qrContainer.innerHTML = qrCode;
    } else if (qrCode.startsWith('data:image')) {
        qrContainer.innerHTML = `<img src="${qrCode}" alt="QR Code">`;
    }

    // Affichage du code secret
    const manualCode = modal.querySelector('#manualCode');
    if (manualCode) manualCode.textContent = secret;

    // Configuration des inputs
    const codeInputs = modal.querySelectorAll('.code-input');
    setupCodeInputs(codeInputs);

    // Gestion de la vérification
    modal.querySelector('.btn-qr-verify').onclick = async () => {
        const code = Array.from(codeInputs).map(i => i.value).join('');
        
        if (!/^\d{6}$/.test(code)) {
            alert("Code 2FA incomplet");
            return;
        }
        
        try {
            const result = await verify2FACode(code, tempSessionId, true, secret);
            modal.style.display = 'none';
            
            window.location.href = '/';
        } catch (error) {
            alert("Code 2FA invalide");
            codeInputs.forEach(input => input.value = '');
            codeInputs[0].focus();
        }
    };

    // Affichage du modal
    modal.style.display = 'block';
    codeInputs[0]?.focus();
}

function show2FAModal(tempSessionId) {

    const modal = document.getElementById('codeModal');
    if (!modal) {
        console.error("Modal 2FA non trouvé");
        return;
    }

    const codeInputs = modal.querySelectorAll('.code-input');
    setupCodeInputs(codeInputs);

    // Gérer la soumission du code 2FA
    modal.querySelector('.btn-verify').onclick = async () => {
        const code = Array.from(codeInputs).map(i => i.value).join('');
        
        if (!/^\d{6}$/.test(code)) {
            alert("Code 2FA incomplet");
            return;
        }
        
        try {
            const result = await verify2FACode(code, tempSessionId, false, null);
            modal.style.display = 'none';
            window.location.href = '/'; 
        } catch (error) {
            alert("Code 2FA invalide");
            codeInputs.forEach(input => input.value = '');
            codeInputs[0].focus();
        }
    };

    // Gérer la régénération du QR code
    const regenerateBtn = modal.querySelector('.btn-regenerate');
    if (regenerateBtn) {
        regenerateBtn.onclick = async () => {
            try {
                const response = await secureFetch('/api/auth/regenerate-2fa', {
                    method: 'POST',
                    body: JSON.stringify({ tempSessionId })
                });

                if (!response.ok) {
                    throw new Error('Failed to regenerate 2FA');
                }

                const result = await response.json();
                
                // Hide the code modal and show the QR code modal
                modal.style.display = 'none';
                showQRCodeModal(result.secret, result.qrCode, result.tempSessionId);
                
            } catch (error) {
                console.error('Error regenerating 2FA:', error);
                alert('Failed to regenerate 2FA. Please try again.');
            }
        };
    }

    // Affichage du modal
    modal.style.display = 'block';
    codeInputs[0]?.focus();
}



async function verify2FACode(code, tempSessionId, isSetup = false, secret = null) {
    if (!/^\d{6}$/.test(code)) {
        throw new Error("Code must be 6 digits");
    }

    try {
        const response = await secureFetch('/api/auth/verify-2fa', {
            method: 'POST',
            body: JSON.stringify({
                code,
                tempSessionId,
                ...(isSetup && { isSetup: true, secret })
            })
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || "Verification failed");
        }

        const result = await response.json();
        if (result.accessToken) sessionStorage.setItem('accessToken', result.accessToken);
        updateHeaderButtons();
        // Change this line:
        // window.location.href = '/';
        // To this:
        window.location.assign('/');
    } catch (error) {
        console.error("2FA Error:", error.message);
        throw new Error("2FA verification failed. Please try again.");
    }
}

// Ajoutez cette fonction AVANT showQRCodeModal
function setupCodeInputs(inputs) {
    inputs.forEach((input, index) => {
        input.value = '';
        input.addEventListener('input', (e) => {
            input.value = input.value.replace(/\D/g, '');
            if (input.value.length === 1 && index < inputs.length - 1) {
                inputs[index + 1].focus();
            }
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !input.value && index > 0) {
                inputs[index - 1].focus();
            }
        });
    });
}
    // Start countdown timer for resending the code
function startCountdown() {
      let timer = 299;
      const countdownElement = document.getElementById('countdown');
    
      const interval = setInterval(() => {
        const minutes = Math.floor(timer / 60);
        const seconds = timer % 60;
        countdownElement.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    
        if (--timer < 0) {
          clearInterval(interval);
          resendCodeBtn.disabled = false;
        }
      }, 1000);
    }
    
    // Display success message after password reset
function showSuccessMessage() {
      const successElement = document.getElementById('resetSuccessMessage');
      successElement.style.display = 'block';
      setTimeout(() => successElement.style.display = 'none', 3000);
    }
  
  
    //RESET PASSWORD
    function showForgotPasswordModal(event) {
        event.preventDefault();
        const modal = document.getElementById('forgotPasswordModal');
        if (modal) {
            modal.style.display = 'block';
        } else {
            console.error("Le modal 'forgotPasswordModal' est introuvable");
        }
    }
    
    function closeForgotPasswordModal(event) {
        event.preventDefault();
        const modal = document.getElementById('forgotPasswordModal');
        if (modal) {
            modal.style.display = 'none';
        } else {
            console.error("Le modal 'forgotPasswordModal' est introuvable");
        }
    }
    
    async function handlePasswordReset(e) {
        e.preventDefault();
        const email = document.getElementById('forgotPasswordEmail').value;
    
        if (!email) {
            alert('Please enter your email address.');
            return;
        }
    
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin + '/reset-password'
        });
    
        if (error) {
            console.error('Error sending reset email:', error.message);
            alert('Error sending reset email: ' + error.message);
        } else {
            alert('Password reset link sent! Please check your email.');
            closeForgotPasswordModal(e);
        }
    }
    
// Resend confirmation email
async function resendConfirmationEmail(email) {

    try {
        const response = await fetch('/api/auth/resend-confirmation', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Failed to resend confirmation email.');
        }

        showSuccessMessage('Confirmation email has been sent. Please check your inbox.');
    } catch (err) {
        console.error('Resend confirmation failed:', err);
        showError('Failed to resend confirmation email. Please try again later.');
    }
}

// After successful login or 2FA, update both main and sticker headers if present
function updateHeaderButtons() {
    // Main header
    if (typeof checkAuthAndShowButtons === 'function') {
        checkAuthAndShowButtons();
    }
    // Sticker header (if it uses a different function, call it here)
    if (typeof checkAuthAndShowButtonsSticker === 'function') {
        checkAuthAndShowButtonsSticker();
    }
}


