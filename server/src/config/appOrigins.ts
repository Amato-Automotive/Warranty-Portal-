import type { Request } from 'express';

/**
 * Origins of the native app (Capacitor). The Android build serves its bundled
 * pages from https://localhost, so every API call it makes is cross-origin
 * with that Origin header.
 *
 * Always allowed by CORS and Socket.io, on top of ALLOWED_ORIGINS, so a
 * production env that predates the app does not lock it out.
 *
 * The app cannot rely on the auth cookie: to the WebView it is a third-party
 * cookie on api.autoformindia.co.in, which Android may drop and iOS always
 * does. So login from one of these origins also returns the session token in
 * the response body, and the app sends it back as `Authorization: Bearer`.
 * The website never gets the token in a body — a browser will not let a page
 * on warranty2 send `Origin: https://localhost`, so script on the website
 * still cannot read the session (SBP-003).
 */
export const APP_ORIGINS = ['https://localhost'];

export const isAppRequest = (req: Request): boolean =>
  APP_ORIGINS.includes(String(req.headers.origin || ''));
