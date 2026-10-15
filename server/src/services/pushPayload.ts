/**
 * Pure helpers for push notifications (push.service.ts), kept apart so the
 * node test runner can load them without a database.
 */

const BODY_MAX = 180;

/** Notification messages may hold announcement HTML; a phone shows plain text. */
export function pushBody(message: string): string {
  const text = String(message || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > BODY_MAX ? `${text.slice(0, BODY_MAX - 1).trimEnd()}…` : text;
}

/**
 * FCM error codes meaning the token will never work again — the app was
 * uninstalled, its data cleared, or the token is malformed. Those rows are
 * deleted; anything else (quota, outage) is transient and the token kept.
 */
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

export function deadTokens(
  tokens: string[],
  responses: { success: boolean; error?: { code?: string } }[]
): string[] {
  return tokens.filter((_, i) => {
    const r = responses[i];
    return r && !r.success && DEAD_TOKEN_CODES.has(r.error?.code || '');
  });
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
