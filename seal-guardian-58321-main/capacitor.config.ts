import type { CapacitorConfig } from '@capacitor/cli';

// The app bundles the same `dist/` the website ships; `npm run build:android`
// builds it and copies it into android/. The app's own origin is
// https://localhost, so every API call is cross-origin to
// api.autoformindia.co.in — the server's CORS allowlist must include it.
const config: CapacitorConfig = {
  appId: 'in.co.autoformindia.fms',
  appName: 'AFAC INDIA',
  webDir: 'dist',
  // Capacitor logs every plugin call and its result to logcat, which would
  // print the saved session token (nativeSession.ts) where any USB-connected
  // PC or bug report can read it. Off in every build, debug included.
  loggingBehavior: 'none',
  android: {
    // Uploads go to the API over https only; no cleartext to anywhere.
    allowMixedContent: false,
  },
};

export default config;
