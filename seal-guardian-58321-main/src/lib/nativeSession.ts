import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

// ---------------------------------------------------------------------------
// Session token for the native app
//
// On the website the session is an HttpOnly cookie and this module does
// nothing. Inside the Android/iOS app the cookie is a third-party cookie on
// api.autoformindia.co.in and can't be relied on, so the server returns the
// token from /auth/verify-otp (only to the app's origin — see the server's
// config/appOrigins.ts). It is kept in app-private storage and sent as
// `Authorization: Bearer` on every request.
//
// Held in memory once loaded so the axios interceptor can attach it
// synchronously; loadNativeSession() must finish before the first request.
// ---------------------------------------------------------------------------

export const isNativeApp = Capacitor.isNativePlatform();

const KEY = 'auth_token';
let token: string | null = null;

export async function loadNativeSession(): Promise<void> {
  if (!isNativeApp) return;
  try {
    token = (await Preferences.get({ key: KEY })).value;
  } catch {
    token = null;
  }
}

export function getNativeToken(): string | null {
  return token;
}

export async function setNativeToken(value: string | null | undefined): Promise<void> {
  if (!isNativeApp) return;
  token = value || null;
  try {
    if (token) await Preferences.set({ key: KEY, value: token });
    else await Preferences.remove({ key: KEY });
  } catch {
    // Storage failing only costs a re-login next launch.
  }
}
