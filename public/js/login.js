// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyDbn0lS8dyfa5_HLG_ePuDfSlt5B_4BLbk",
    authDomain: "test-29995-default-rtdb.firebaseapp.com",
    projectId: "test-29995",
    storageBucket: "test-29995.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abcdef",
    databaseURL: "https://test-29995-default-rtdb.asia-southeast1.firebasedatabase.app"
};

// Initialize Firebase
if (!firebase.apps || firebase.apps.length === 0) {
    firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();

// DOM Elements
const loginForm = document.getElementById('login-form');
const emailInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const rememberInput = document.getElementById('remember');
const togglePasswordBtn = document.getElementById('toggle-password');
const forgotPasswordLink = document.getElementById('forgot-password');
const loginBtn = document.getElementById('login-btn');
const btnText = document.getElementById('btn-text');
const btnLoading = document.getElementById('btn-loading');
const errorMessage = document.getElementById('error-message');
const errorText = document.getElementById('error-text');

// Show error message
function showError(message) {
    errorText.textContent = message;
    errorMessage.style.display = 'block';
    
    // Hide error after 5 seconds
    setTimeout(() => {
        errorMessage.style.display = 'none';
    }, 5000);
}

// Hide error message
function hideError() {
    errorMessage.style.display = 'none';
}

// Set loading state
function setLoading(loading) {
    loginBtn.disabled = loading;
    if (loading) {
        btnText.style.display = 'none';
        btnLoading.style.display = 'block';
    } else {
        btnText.style.display = 'block';
        btnLoading.style.display = 'none';
    }
}

function getEmailValue() {
    return (emailInput?.value || '').trim();
}

function getPasswordValue() {
    return passwordInput?.value || '';
}

function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

async function applyAuthPersistence() {
    const rememberMe = Boolean(rememberInput?.checked);
    const persistence = rememberMe
        ? firebase.auth.Auth.Persistence.LOCAL
        : firebase.auth.Auth.Persistence.SESSION;

    await auth.setPersistence(persistence);
}

// Handle form submission
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = getEmailValue();
    const password = getPasswordValue();
    
    // Basic validation
    if (!email || !password) {
        showError('Please enter both username and password');
        return;
    }
    
    // Email validation
    // Note: Username field is treated as the Firebase email.
    if (!isValidEmail(email)) {
        showError('Please enter a valid email address');
        return;
    }
    
    hideError();
    setLoading(true);
    
    try {
        await applyAuthPersistence();
        // Sign in with Firebase
        const userCredential = await auth.signInWithEmailAndPassword(email, password);
        
        console.log('Login successful:', userCredential.user);
        
        // Redirect to main dashboard
        window.location.href = 'index.html';
        
    } catch (error) {
        console.error('Login error:', error);
        
        // Handle specific Firebase errors
        let errorMessage = 'An error occurred during login';
        
        switch (error.code) {
            case 'auth/user-not-found':
                errorMessage = 'No account found with this email address';
                break;
            case 'auth/wrong-password':
            case 'auth/invalid-login-credentials':
                errorMessage = 'Invalid username or password';
                break;
            case 'auth/invalid-email':
                errorMessage = 'Invalid email address format';
                break;
            case 'auth/user-disabled':
                errorMessage = 'This account has been disabled';
                break;
            case 'auth/too-many-requests':
                errorMessage = 'Too many failed attempts. Please try again later';
                break;
            case 'auth/network-request-failed':
                errorMessage = 'Network error. Please check your connection';
                break;
            default:
                errorMessage = error.message || 'Login failed. Please try again';
        }
        
        showError(errorMessage);
    } finally {
        setLoading(false);
    }
});

// Clear error when user starts typing
emailInput?.addEventListener('input', hideError);
passwordInput?.addEventListener('input', hideError);

// Check if user is already logged in
auth.onAuthStateChanged((user) => {
    if (user) {
        console.log('User already logged in:', user.email);
        // Redirect to main dashboard
        window.location.href = 'index.html';
    }
});

// Handle Enter key in form
loginForm.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        loginForm.dispatchEvent(new Event('submit'));
    }
});

// Toggle password visibility
togglePasswordBtn?.addEventListener('click', () => {
    const isPassword = passwordInput.type === 'password';
    passwordInput.type = isPassword ? 'text' : 'password';
    togglePasswordBtn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
});

// Forgot password flow
forgotPasswordLink?.addEventListener('click', async (e) => {
    e.preventDefault();

    const email = getEmailValue();
    if (!email) {
        showError('Please enter your username (email) first');
        return;
    }

    if (!isValidEmail(email)) {
        showError('Please enter a valid email address');
        return;
    }

    hideError();
    setLoading(true);

    try {
        const resp = await fetch('/api/auth/forgot-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
        });

        const data = await resp.json().catch(() => ({}));

        if (!resp.ok) {
            showError(data?.error || 'Unable to process forgot password request.');
            return;
        }

        showError(data?.message || 'Temporary password sent to your email.');
    } catch (error) {
        console.error('Password reset error:', error);

        showError('Network error. Please check your connection.');
    } finally {
        setLoading(false);
    }
});
