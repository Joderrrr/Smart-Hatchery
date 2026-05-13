import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

let authContextCache = null;
let authContextFetchedAt = 0;
const AUTH_CONTEXT_TTL_MS = 60 * 1000;

function waitForUser(timeoutMs = 5000) {
  const auth = getAuth();
  if (auth.currentUser) return Promise.resolve(auth.currentUser);

  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        unsubscribe();
        resolve(null);
      }
    }, timeoutMs);

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(user || null);
      }
    });
  });
}

export async function getAuthToken(forceRefresh = false) {
  const auth = getAuth();
  const user = auth.currentUser || await waitForUser();
  if (!user) return null;
  return user.getIdToken(forceRefresh);
}

export async function fetchWithAuth(url, options = {}) {
  const token = await getAuthToken();
  const headers = new Headers(options.headers || {});

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(url, {
    ...options,
    headers,
  });
}

export async function getAuthContext(forceRefresh = false) {
  const now = Date.now();
  const shouldUseCache = !forceRefresh && authContextCache && (now - authContextFetchedAt) < AUTH_CONTEXT_TTL_MS;
  if (shouldUseCache) return authContextCache;

  const response = await fetchWithAuth('/api/auth/context');
  if (!response.ok) {
    throw new Error(`Auth context failed: ${response.status}`);
  }

  authContextCache = await response.json();
  authContextFetchedAt = now;
  return authContextCache;
}

export function hasPermission(context, permission) {
  const perms = context?.permissions || [];
  return perms.includes(permission);
}
