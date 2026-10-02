// Password strength validation with detailed feedback
const validatePassword = (password) => {
    // Precompile regex patterns for better performance
    const UPPER_CASE_REGEX = /[A-Z]/;
    const LOWER_CASE_REGEX = /[a-z]/;
    const NUMBER_REGEX = /\d/;
    const SPECIAL_CHAR_REGEX = /[!@#$%^&*(),.?":{}|<>]/;
    
    // Sanitize input first
    const cleanPassword = sanitizeInput.password(password);
    
    // Validate minimum length immediately
    if (typeof cleanPassword !== 'string' || cleanPassword.length < 8 || cleanPassword.length > 64) {
        return {
            isValid: false,
            message: 'Password must be at least 8 characters and maximum 64 characters'
        };
    }

    // Check password complexity requirements
    const requirements = {
        hasUpperCase: UPPER_CASE_REGEX.test(cleanPassword),
        hasLowerCase: LOWER_CASE_REGEX.test(cleanPassword),
        hasNumbers: NUMBER_REGEX.test(cleanPassword),
        hasSpecialChar: SPECIAL_CHAR_REGEX.test(cleanPassword),
    };

    // Build user-friendly error messages
    const messages = [];
    if (!requirements.hasUpperCase) messages.push('at least one uppercase letter (A-Z)');
    if (!requirements.hasLowerCase) messages.push('at least one lowercase letter (a-z)');
    if (!requirements.hasNumbers) messages.push('at least one number (0-9)');
    if (!requirements.hasSpecialChar) messages.push('at least one special character (!@#$...)');
    if (!requirements.notCommon) messages.push('not be a commonly used password');

    return {
        isValid: Object.values(requirements).every(req => req),
        message: messages.length > 0 
            ? `Password needs: ${messages.join(', ')}`
            : 'Password is valid'
    };
};


  // Enhanced sanitization utility functions
  const sanitizeInput = {
      // Sanitize string input with HTML purification and length limits
      string: (input) => {
          if (typeof input !== 'string') return '';
          // Limit input length first to prevent DoS
          const limitedInput = input.length > 10000 ? input.substring(0, 10000) : input;
          // Basic HTML tag removal (consider using DOMPurify for more robust protection)
          return limitedInput
              .replace(/<[^>]{0,1000}>/g, '') // Limited length HTML tag removal
              .replace(/[<>'"&]/g, '') // Remove potentially dangerous characters
              .replace(/\s+/g, ' ') // Collapse multiple spaces
              .trim();
      },
  
      // Sanitize email with strict validation
      email: (input) => {
          if (typeof input !== 'string') return '';
          // RFC 5322 compliant regex (simplified)
          const emailRegex = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;
          const cleanEmail = input
              .replace(/<[^>]*>/g, '') // Remove HTML tags
              .replace(/\s+/g, '') // Remove all whitespace
              .toLowerCase()
              .trim();
          
          // Additional length validation
          if (cleanEmail.length > 254) return '';
          return emailRegex.test(cleanEmail) ? cleanEmail : '';
      },
  
      // Sanitize number with range validation
      number: (input, min = -Infinity, max = Infinity) => {
          const num = Number(input);
          if (isNaN(num)) return null;
          return Math.min(Math.max(num, min), max);
      },
  
      // Sanitize lottery ID with strict format
      lotteryId: (input) => {
          if (typeof input !== 'string') return '';
          return input
              .replace(/[^a-zA-Z0-9-]/g, '')
              .substring(0, 50) // Length limit
              .trim();
      },
  
      // Secure password sanitization
      password: (input) => {
          if (typeof input !== 'string') return '';
          // Remove non-printable ASCII and limit length
          return input
              .replace(/[^\x20-\x7E]/g, '') // Only printable ASCII
              .substring(0, 256) // Reasonable length limit
              .trim();
      },
  
      // Username with strict requirements
      username: (input) => {
          if (typeof input !== 'string') return '';
          return input
              .replace(/[^a-zA-Z0-9_]/g, '')
              .substring(0, 30) // Length limit
              .trim();
      }
  };
  
  // Enhanced request body sanitization middleware
  const sanitizeRequestBody = (req, res, next) => {
      try {
          // First validate content length to prevent large payload attacks
          if (req.headers['content-length'] > 100000) {
              return res.status(413).json({ error: 'Payload too large' });
          }
  
          // Sanitize all fields in the request body
          Object.keys(req.body).forEach(key => {
              const value = req.body[key];
              
              if (typeof value === 'string') {
                  // Apply field-specific sanitization
                  if (key.toLowerCase().includes('email')) {
                      req.body[key] = sanitizeInput.email(value);
                  } else if (key.toLowerCase().includes('password')) {
                      req.body[key] = sanitizeInput.password(value);
                  } else if (key.toLowerCase().includes('username')) {
                      req.body[key] = sanitizeInput.username(value);
                  } else if (key.toLowerCase().includes('lotteryid')) {
                      req.body[key] = sanitizeInput.lotteryId(value);
                  } else if (!isNaN(value)) {
                      req.body[key] = sanitizeInput.number(value);
                  } else {
                      req.body[key] = sanitizeInput.string(value);
                  }
              } else if (typeof value === 'object' && value !== null) {
                  // Recursively sanitize nested objects
                  req.body[key] = sanitizeNestedObjects(value);
              }
          });
          
          next();
      } catch (error) {
          console.error('Sanitization error:', error);
          res.status(400).json({ error: 'Invalid input data' });
      }
  };
  
  // Helper for sanitizing nested objects
  const sanitizeNestedObjects = (obj) => {
      if (Array.isArray(obj)) {
          return obj.map(item => 
              typeof item === 'string' ? sanitizeInput.string(item) :
              typeof item === 'object' ? sanitizeNestedObjects(item) : item
          );
      }
      
      const sanitized = {};
      for (const key in obj) {
          const value = obj[key];
          sanitized[key] = typeof value === 'string' ? sanitizeInput.string(value) :
                          typeof value === 'object' ? sanitizeNestedObjects(value) : value;
      }
      return sanitized;
  };
  
  // Enhanced login validation
  function loginValidation(req, res, next) {
      // First sanitize the input
      sanitizeRequestBody(req, res, () => {
          const { email, password } = req.body;
  
          // Check if email and password are provided
          if (!email || !password) {
              return res.status(400).json({ 
                  error: 'Please enter both your email and password to log in.' 
              });
          }
  
          // Validate email format
          if (!sanitizeInput.email(email)) {
              return res.status(400).json({ 
                  error: 'Please enter a valid email address (e.g., yourname@example.com).' 
              });
          }
  
          // Check password strength (uncomment when needed)
          /*
          const passwordValidation = validatePassword(password);
          if (!passwordValidation.isValid) {
              return res.status(400).json({ 
                  error: 'Your password is incorrect. Please try again.' 
              });
          }
          */
  
          next();
      });
  }
  
  // Enhanced registration validation
  const registrationValidation = (req, res, next) => {
      // First sanitize the input
      sanitizeRequestBody(req, res, () => {
          const { username, email, password, confirmPassword } = req.body;
  
          // Basic validation
          if (!username || !email || !password || !confirmPassword) {
              return res.status(400).json({ 
                  error: 'Please fill in all required fields to create your account.' 
              });
          }
  
          // Username validation
          if (username.length < 3 || username.length > 30) {
              return res.status(400).json({ 
                  error: 'Your username should be between 3 and 30 characters long.' 
              });
          }
  
          // Email validation
          if (!sanitizeInput.email(email)) {
              return res.status(400).json({ 
                  error: 'Please enter a valid email address (e.g., yourname@example.com).' 
              });
          }
  
          // Password validation
          const passwordValidation = validatePassword(password);
          if (!passwordValidation.isValid) {
              const requirements = passwordValidation.missingRequirements.join(', ');
              return res.status(400).json({ 
                  error: `Your password needs to be stronger. Please include ${requirements}.` 
              });
          }
  
          // Password match
          if (password !== confirmPassword) {
              return res.status(400).json({ 
                  error: 'The passwords you entered do not match. Please try again.' 
              });
          }
  
          // Check if password contains username or email
          const emailUsername = email.split('@')[0];
          if (password.toLowerCase().includes(username.toLowerCase()) || 
              password.toLowerCase().includes(emailUsername.toLowerCase())) {
              return res.status(400).json({ 
                  error: 'For security reasons, your password cannot contain your username or email.' 
              });
          }
  
          next();
      });
  };
  
  module.exports = {
      loginValidation,
      registrationValidation,
      validatePassword,
      sanitizeInput,
      sanitizeRequestBody,
  };