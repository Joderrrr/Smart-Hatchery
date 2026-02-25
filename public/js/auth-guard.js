// Firebase Authentication Guard
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
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();

// Authentication check
auth.onAuthStateChanged((user) => {
    if (!user) {
        // User is not authenticated, redirect to login
        console.log('User not authenticated, redirecting to login...');
        window.location.href = 'login.html';
    } else {
        console.log('User authenticated:', user.email);
        // User is authenticated, allow access
        // Hide loading overlay if present
        const loadingOverlay = document.getElementById('auth-loading');
        if (loadingOverlay) {
            loadingOverlay.style.display = 'none';
        }
    }
});

// Logout function
function logout() {
    auth.signOut().then(() => {
        console.log('User signed out');
        sessionStorage.clear();
        Object.keys(localStorage || {}).forEach((key) => {
            if (key.startsWith('firebase:authUser')) {
                localStorage.removeItem(key);
            }
        });
        window.location.href = 'login.html';
    }).catch((error) => {
        console.error('Sign out error:', error);
    });
}

// Add logout to window for global access
window.logout = logout;
