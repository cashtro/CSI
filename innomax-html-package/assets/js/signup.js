import { secureFetch, initializeCSRF } from './api.js';




window.togglePassword = function(icon, inputId){
    const input = document.getElementById(inputId);
    if(input.type === 'password'){
        input.type = 'text';
        icon.classList.toggle('bi-eye');
        icon.classList.toggle('bi-eye-slash');
    }
    else{
        input.type = 'password';
        icon.classList.toggle('bi-eye-slash');
        icon.classList.toggle('bi-eye');
    }
}

// Rate limiting configuration
const SIGNUP_RATE_LIMIT = {
    MAX_ATTEMPTS: 5,
    TIME_WINDOW: 15 * 60 * 1000, // 15 minutes
    MIN_INTERVAL: 2000 // 2 seconds between attempts
};

// State for rate limiting
let signupAttempts = [];
let lastSignupAttemptTime = 0;

// Gestionnaire principal après chargement du DOM
document.addEventListener('DOMContentLoaded', async () => {
    await initializeCSRF(); // From your api.js

    // Éléments DOM
    const signUpForm = document.getElementById('signUpForm');
    const togglePasswordForm = document.getElementById('togglePassword');
    const toggleConfirmPasswordForm = document.getElementById('toggleConfirmPassword');

    // Gestionnaires d'événements
    if (signUpForm) {
        signUpForm.addEventListener('submit', handleSignUpSubmit);
    }
    if (togglePasswordForm) {
        togglePasswordForm.addEventListener('click', togglePassword);
    }
    if (toggleConfirmPasswordForm) {
        toggleConfirmPasswordForm.addEventListener('click', toggleConfirmPassword);
    }
});

async function handleSignUpSubmit(e) {
    e.preventDefault();
    
    // Rate limiting checks
    const now = Date.now();
    
    if (now - lastSignupAttemptTime < SIGNUP_RATE_LIMIT.MIN_INTERVAL) {
        showError('Please wait a moment before trying again');
        return;
    }
    
    // Clean up old attempts
    signupAttempts = signupAttempts.filter(time => 
        now - time < SIGNUP_RATE_LIMIT.TIME_WINDOW
    );
    
    // Check max attempts
    if (signupAttempts.length >= SIGNUP_RATE_LIMIT.MAX_ATTEMPTS) {
        showError('Too many attempts. Please try again later.');
        return;
    }
    
    // Record attempt
    signupAttempts.push(now);
    lastSignupAttemptTime = now;
    
    // Clear previous errors
    clearErrors();

    // Get and sanitize form data
    const formData = new FormData(e.target);
    const { 
        username: rawUsername, 
        email: rawEmail, 
        password,
        confirmPassword,
        age: rawAge 
    } = Object.fromEntries(formData.entries());

    const username = sanitizeUsername(rawUsername);
    const email = sanitizeEmail(rawEmail);
    const age = parseInt(sanitizeInput(rawAge));

    // Validate all inputs
    const validation = validateAllFields(username, email, password, confirmPassword, age);
    if (!validation.valid) {
        showError(validation.message);
        return;
    }

    // Check terms agreement
    if (!document.getElementById('termsAgree').checked) {
        showError('You must agree to the terms & conditions.');
        return;
    }

    // Submit to server
    try {
        const response = await secureFetch('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            username,
            email,
            password,
            confirmPassword,
            age
          })
        });
      
        // If no error thrown, success
        sessionStorage.setItem('signupInfo', email);
        window.location.href = '/signup-callback';      
      } catch (error) {
        if (error instanceof Error) {
          const message = error.message.toLowerCase();
      
          if (message.includes('email')) {
            showError('Invalid or already used email.');
          } else if (message.includes('password')) {
            showError('Password does not meet requirements or does not match.');
          } else if (message.includes('username')) {
            showError('Username is taken or invalid.');
          } else if (message.includes('age')) {
            showError('You must meet the age requirement.');
          } else if (message.includes('csrf')) {
            showError('Security error. Please refresh the page and try again.');
          } else {
            showError('Signup failed. Please try again.');
          }
        } else {
          showError('Unexpected error. Please try again later.');
        }
      }
      
}

// Enhanced sanitization functions
function sanitizeInput(input) {
    if (input == null) return '';
    return input
        .toString()
        .trim()
        .replace(/[<>'"&\\]/g, '') // Remove special chars
        .replace(/\s+/g, ' ');     // Normalize whitespace
}

function sanitizeUsername(username) {
    return sanitizeInput(username)
        .substring(0, 20); // Length limit
}

function sanitizeEmail(email) {
    return sanitizeInput(email)
        .toLowerCase()
        .substring(0, 254); // RFC email length limit
}

function validateAllFields(username, email, password, confirmPassword, age) {
    const usernameValidation = validateUsername(username);
    if (!usernameValidation.valid) {
        return {
            valid: false,
            message: usernameValidation.message
        };
    }

    if (!validateEmail(email)) {
        return {
            valid: false,
            message: 'Please enter a valid email address'
        };
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
        return {
            valid: false,
            message: passwordValidation.message
        };
    }

    if (password !== confirmPassword) {
        return {
            valid: false,
            message: 'Passwords do not match'
        };
    }

    if (!validateAge(age)) {
        return {
            valid: false,
            message: 'You must be between 13 and 120 years old to register'
        };
    }

    return { valid: true };
}


function validateUsername(username) {
    // Mots interdits
    const blockedPatterns = ['script', 'alert', 'eval', 'document', 'window', 'admin', 'root', 'system'];
    if (blockedPatterns.some(pattern => username.toLowerCase().includes(pattern))) {
        return {
            valid: false,
            message: 'Username contains a restricted word'
        };
    }

    return { valid: true };
}



function validateEmail(email) {
    // RFC 5322 compliant regex (simplified)
    const emailRegex = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
    
    return emailRegex.test(email) && 
           email.length <= 254 &&
           email.split('@')[0].length <= 64;
}

function validatePassword(password) {
    // Minimum requirements
    const hasMinLength = password.length >= 8;
    const hasUpper = /[A-Z]/.test(password);
    const hasLower = /[a-z]/.test(password);
    const hasNumber = /\d/.test(password);
    const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);

    if (!hasMinLength) return { valid: false, message: 'Password must be at least 8 characters' };
    if (!hasUpper) return { valid: false, message: 'Password needs at least one uppercase letter' };
    if (!hasLower) return { valid: false, message: 'Password needs at least one lowercase letter' };
    if (!hasNumber) return { valid: false, message: 'Password needs at least one number' };
    if (!hasSpecial) return { valid: false, message: 'Password needs at least one special character' };

    // Check against common passwords
    if (isCommonPassword(password)) {
        return { valid: false, message: 'This password is too common. Please choose a stronger one.' };
    }

    return { valid: true };
}

function isCommonPassword(password) {
    const commonPasswords = [
        'password', '123456', '12345678', '123456789', '12345',
        'qwerty', 'abc123', 'letmein', 'admin', 'welcome',
        'monkey', 'password1', '123123', 'sunshine', 'iloveyou'
    ];
    return commonPasswords.includes(password.toLowerCase());
}

function validateAge(age) {
    return !isNaN(age) && age >= 13 && age <= 120;
}

function showError(message) {
    // Remove any existing error message
    const existingError = document.getElementById('signupError');
    if (existingError) {
        existingError.remove();
    }

    // Create new error message
    const errorDiv = document.createElement('div');
    errorDiv.id = 'signupError';
    errorDiv.style.cssText = 'background:rgba(255, 215, 0, 0.12); border:1.5px solid #D4AF37; color:#855e1b; border-radius:8px; padding:12px 16px; margin-bottom:18px; font-size:15px; font-weight:500; display:flex; align-items:center; gap:8px;';
    
    const icon = document.createElement('i');
    icon.className = 'bi bi-exclamation-triangle-fill';
    icon.style.cssText = 'color:#D4AF37; font-size:18px;';
    
    const messageSpan = document.createElement('span');
    messageSpan.id = 'signupErrorMsg';
    messageSpan.textContent = escapeHtml(message);
    
    errorDiv.appendChild(icon);
    errorDiv.appendChild(messageSpan);
    
    const form = document.getElementById('signUpForm');
    form.parentNode.insertBefore(errorDiv, form);
}

function clearErrors() {
    const existingError = document.getElementById('signupError');
    if (existingError) existingError.remove();
}

function escapeHtml(unsafe) {
    return unsafe
        // .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// document.getElementById('togglePassword').addEventListener('click', function () {
//     const passwordField = document.getElementById('password');
//     const isPassword = passwordField.type === 'password';
  
//     passwordField.type = isPassword ? 'text' : 'password';
//     this.classList.toggle('bi-eye');
//     this.classList.toggle('bi-eye-slash');
//   });
  
//   document.getElementById('toggleConfirmPassword').addEventListener('click', function () {
//     const confirmPasswordField = document.getElementById('confirmPassword');
//     const isPassword = confirmPasswordField.type === 'password';
  
//     confirmPasswordField.type = isPassword ? 'text' : 'password';
//     this.classList.toggle('bi-eye');
//     this.classList.toggle('bi-eye-slash');
//   });
  



// CSRF protection
function getCSRFToken() {
    return document.querySelector('meta[name="csrf-token"]')?.content || '';
}