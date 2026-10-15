import { readFileSync } from 'fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import db from '../config/database.js';
import { chunk, deadTokens, pushBody } from './pushPayload.js';

/**
 * Push notifications to the Android app (Firebase Cloud Messaging).
 *
 * Rides on the bell: NotificationService.notify/broadcast call pushToUsers()
 * after saving and emitting, so anything that reaches a user's bell also
 * reaches their phone — but only phones that installed the app and allowed
 * notifications, which registered themselves in `push_devices`. Website-only
 * users have no rows and get nothing extra.
 *
 * Off unless FIREBASE_SERVICE_ACCOUNT_PATH points at the service-account key
 * (kept outside the repo — on production, ~/secrets/). Failures here are
 * logged and never fail the notification itself.
 */

let messaging: Messaging | null | undefined;

function client(): Messaging | null {
  if (messaging !== undefined) return messaging;
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!path) {
    console.warn('[Push] FIREBASE_SERVICE_ACCOUNT_PATH not set; push notifications are off.');
    return (messaging = null);
  }
  try {
    const app = initializeApp({ credential: cert(JSON.parse(readFileSync(path, 'utf8'))) }, 'push');
    messaging = getMessaging(app);
  } catch (error: any) {
    console.error('[Push] Could not load the Firebase service account:', error?.message);
    messaging = null;
  }
  return messaging;
}

// FCM accepts at most 500 tokens per multicast.
const FCM_BATCH = 500;

export async function pushToUsers(
  userIds: (string | number)[],
  data: { title: string; message: string; link?: string | null; type?: string }
): Promise<void> {
  const fcm = client();
  if (!fcm || userIds.length === 0) return;

  const ids = [...new Set(userIds.map(String))];
  const tokens: string[] = [];
  for (const part of chunk(ids, 1000)) {
    const [rows]: any = await db.query('SELECT token FROM push_devices WHERE user_id IN (?)', [part]);
    for (const r of rows) tokens.push(r.token);
  }
  if (tokens.length === 0) return;

  const body = pushBody(data.message);
  const dead: string[] = [];
  for (const batch of chunk(tokens, FCM_BATCH)) {
    const res = await fcm.sendEachForMulticast({
      tokens: batch,
      notification: { title: data.title, body },
      data: { link: data.link || '', type: data.type || '' },
      android: {
        priority: 'high',
        notification: { channelId: 'default', icon: 'ic_stat_notify', color: '#000000' },
      },
    });
    dead.push(...deadTokens(batch, res.responses));
  }

  if (dead.length > 0) {
    await db.query('DELETE FROM push_devices WHERE token IN (?)', [dead]);
  }
}

/** Fire-and-forget wrapper for the notification paths. */
export function pushInBackground(
  userIds: (string | number)[],
  data: { title: string; message: string; link?: string | null; type?: string }
): void {
  pushToUsers(userIds, data).catch((error) => console.error('[Push] Send failed:', error?.message || error));
}
