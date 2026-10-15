import { PushNotifications } from '@capacitor/push-notifications';
import api from './api';
import { isNativeApp } from './nativeSession';

// ---------------------------------------------------------------------------
// Push notifications in the native app (Firebase Cloud Messaging).
//
// After login the phone asks for permission once, gets an FCM token and
// registers it with the server (/api/push/register). From then on anything
// that reaches the user's bell is also pushed to the phone — see the server's
// push.service.ts. Logout removes the registration so the next person to log
// in on a shared phone doesn't receive the previous account's alerts.
// Does nothing on the web.
// ---------------------------------------------------------------------------

let currentToken: string | null = null;
let listenersAdded = false;

// Notification links are written server-side and not all are routes the app
// has (several name admin screens that exist only as modules). Only follow
// the ones that are real pages; otherwise opening the app is enough.
const ROUTABLE = ['/dashboard/', '/profile', '/product/', '/category/', '/catalogue'];

function openLink(link: string | undefined) {
  if (!link || !ROUTABLE.some((p) => link.startsWith(p))) return;
  if (window.location.pathname + window.location.search === link) return;
  // BrowserRouter follows popstate, so this navigates without a reload.
  window.history.pushState({}, '', link);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

async function addListeners() {
  if (listenersAdded) return;
  listenersAdded = true;

  await PushNotifications.addListener('registration', ({ value }) => {
    currentToken = value;
    api.post('/push/register', { token: value, platform: 'android' }).catch(() => undefined);
  });
  await PushNotifications.addListener('registrationError', () => undefined);
  await PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
    openLink(notification.data?.link);
  });
}

/** Call once a user is logged in. Safe to call again; asks for permission only once. */
export async function enablePush(): Promise<void> {
  if (!isNativeApp) return;
  try {
    // Without its own channel Android files these under "Miscellaneous"
    // at default importance — no heads-up banner.
    await PushNotifications.createChannel({
      id: 'default',
      name: 'Notifications',
      description: 'Approvals, orders and announcements',
      importance: 4,
      visibility: 1,
    });

    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== 'granted') return;

    await addListeners();
    await PushNotifications.register();
  } catch {
    // Push is an extra; the app works without it.
  }
}

/** Call before logging out, while the session is still valid. */
export async function disablePush(): Promise<void> {
  if (!isNativeApp || !currentToken) return;
  const token = currentToken;
  currentToken = null;
  await api.post('/push/unregister', { token }).catch(() => undefined);
}
