import axios from 'axios';
import { getNativeToken, isNativeApp, setNativeToken } from './nativeSession';

// ---------------------------------------------------------------------------
// API Base URL
// ---------------------------------------------------------------------------
const isProd = import.meta.env.PROD;
const isDev = import.meta.env.DEV;

const envUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim() || '';
const BACKEND_URL = 'https://api.autoformindia.co.in/api';

const resolveBase = () => {
  if (envUrl) return envUrl.endsWith('/api') ? envUrl : `${envUrl}/api`;
  if (isProd) return BACKEND_URL;
  return 'http://localhost:3000/api';
};

export const API_URL = resolveBase();

if (isDev) console.log('API Base URL:', API_URL);

// ---------------------------------------------------------------------------
// Axios Instance
// ---------------------------------------------------------------------------

const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

// ---------------------------------------------------------------------------
// Request — attach token from localStorage
// ---------------------------------------------------------------------------

api.interceptors.request.use((config) => {
  // If sending FormData, remove the default Content-Type so the browser
  // auto-sets multipart/form-data with the correct boundary
  if (config.data instanceof FormData) {
    delete config.headers['Content-Type'];
  }
  // The native app authenticates by header, not cookie — see nativeSession.ts.
  const nativeToken = getNativeToken();
  if (nativeToken) config.headers['Authorization'] = `Bearer ${nativeToken}`;
  if (isDev) console.log('API Request:', config.method?.toUpperCase(), config.url);
  return config;
});

// ---------------------------------------------------------------------------
// Response — redirect on session expiry
// ---------------------------------------------------------------------------

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const requestUrl = error.config?.url || '';
    const status = error.response?.status;

    const isAuthRoute =
      requestUrl.includes('/auth/login') ||
      requestUrl.includes('/auth/verify-otp') ||
      requestUrl.includes('/auth/register') ||
      requestUrl.includes('/auth/resend-otp') ||
      requestUrl.includes('/auth/me') ||
      requestUrl.includes('/auth/logout');

    // 401 = session expired / invalid token → force logout
    // 403 = insufficient permissions → let the component handle it (do NOT logout)
    if (status === 401 && !isAuthRoute) {
      if (isNativeApp) void setNativeToken(null);
      if (!window.location.pathname.startsWith('/login')) {
        const role = new URL(window.location.href).searchParams.get('role');
        window.location.href = role ? `/login?role=${role}` : '/login';
      }
    }

    if (error.response) {
      console.error(`[API Error] ${error.response.status} - ${error.response.config.url}:`, error.response.data);
    } else {
      console.error('[API Error] No response:', error.message);
    }
    return Promise.reject(error);
  }
);

// ---------------------------------------------------------------------------
// Error message extraction
//
// The backend returns errors in two shapes:
//   • inline controller errors → { error: "some string" }
//   • global error handler      → { error: { code, message } }
// Rendering the object form directly into JSX (e.g. a toast) crashes React
// with "Objects are not valid as a React child". This helper always returns a
// plain string, so call sites can safely do `getErrorMessage(err)`.
// ---------------------------------------------------------------------------

export function getErrorMessage(error: any, fallback = 'Something went wrong. Please try again.'): string {
  const data = error?.response?.data;

  const err = data?.error;
  if (typeof err === 'string' && err.trim()) return err;
  if (err && typeof err === 'object' && typeof err.message === 'string' && err.message.trim()) {
    return err.message;
  }

  if (typeof data?.message === 'string' && data.message.trim()) return data.message;
  if (typeof error?.message === 'string' && error.message.trim() && !error.response) {
    // network / no-response errors — surface axios message
    return error.message;
  }

  return fallback;
}

export default api;
