import jwt from 'jsonwebtoken';
import axios from 'axios';

/**
 * Reading a Google Sheet as a service account.
 *
 * Google's own client library would do this too, but it brings in the whole
 * API surface for one read call. The exchange is a signed assertion for an
 * access token, then one HTTPS GET — jsonwebtoken and axios are already here,
 * so this needs no new dependency.
 *
 * The service account is granted Viewer on the sheet in Google Drive; nothing
 * here can write to it.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

/** Read-only. The token is refused for anything else even if asked. */
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

export interface ServiceAccount {
    client_email: string;
    private_key: string;
}

/**
 * The service account, from the environment.
 *
 * Accepts either the whole JSON blob in GOOGLE_SERVICE_ACCOUNT_JSON, or the
 * two fields it needs as separate variables — a pasted key loses its newlines
 * often enough that the escaped form has to work as well.
 */
export function readServiceAccount(env: NodeJS.ProcessEnv = process.env): ServiceAccount | null {
    const blob = env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (blob) {
        try {
            const parsed = JSON.parse(blob);
            if (parsed?.client_email && parsed?.private_key) {
                return {
                    client_email: String(parsed.client_email),
                    private_key: normaliseKey(String(parsed.private_key)),
                };
            }
        } catch {
            console.error('[Sheets] GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON');
        }
    }

    const email = env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const key = env.GOOGLE_PRIVATE_KEY;
    if (email && key) {
        return { client_email: email, private_key: normaliseKey(key) };
    }

    return null;
}

/**
 * A private key survives an .env file with its newlines escaped.
 *
 * PEM parsing fails on "\n" written as two characters, and the error names
 * neither the cause nor the variable, so it is worth handling here rather than
 * in whoever deploys it.
 */
export function normaliseKey(key: string): string {
    return key.includes('\\n') ? key.replace(/\\n/g, '\n') : key;
}

/**
 * Trade the service account for an access token.
 *
 * The assertion is signed with the account's private key and lasts an hour;
 * Google returns a token good for the same. Not cached across calls — a sync
 * runs occasionally, and a stale token is a worse failure than a second
 * round-trip.
 */
export async function getAccessToken(account: ServiceAccount): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const assertion = jwt.sign(
        {
            iss: account.client_email,
            scope: SCOPE,
            aud: TOKEN_URL,
            iat: now,
            exp: now + 3600,
        },
        account.private_key,
        { algorithm: 'RS256' },
    );

    const res = await axios.post(
        TOKEN_URL,
        new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion,
        }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 20_000 },
    );

    const token = res.data?.access_token;
    if (!token) throw new Error('Google returned no access token');
    return String(token);
}

/**
 * The spreadsheet id out of whatever the user pasted.
 *
 * Accepts a full edit URL or the bare id, because the thing to hand is always
 * the URL from the browser.
 */
export function spreadsheetId(urlOrId: string): string | null {
    const raw = String(urlOrId || '').trim();
    if (!raw) return null;
    const fromUrl = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (fromUrl) return fromUrl[1];
    return /^[a-zA-Z0-9-_]{20,}$/.test(raw) ? raw : null;
}

/**
 * The tab's real title for the name we were given: exact if there is one,
 * otherwise ignoring case and spaces. The October 2026 tab is "Ad New 1 ",
 * with a trailing space no one can see — asked for as "Ad New 1", Google
 * answered 400. Null when nothing matches.
 */
export function matchTabTitle(titles: string[], wanted: string): string | null {
    if (titles.includes(wanted)) return wanted;
    const norm = (s: string) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
    return titles.find(t => norm(t) === norm(wanted)) ?? null;
}

async function resolveTab(id: string, tabName: string, token: string): Promise<string> {
    const res = await axios.get(`${SHEETS_API}/${id}`, {
        params: { fields: 'sheets.properties.title' },
        headers: { Authorization: `Bearer ${token}` },
        timeout: 30_000,
    });
    const titles: string[] = (res.data?.sheets ?? []).map((s: any) => String(s?.properties?.title ?? ''));
    const title = matchTabTitle(titles, tabName);
    if (!title) throw new Error(`No tab named "${tabName}" — the sheet has: ${titles.map(t => `"${t}"`).join(', ')}`);
    return title;
}

/**
 * Every row of a tab, as a grid of strings.
 *
 * UNFORMATTED_VALUE with a string render keeps what the sheet holds rather than
 * what it displays: a date column returned as a locale-formatted string is not
 * something a parser can read back reliably.
 *
 * Google omits trailing empty cells, so rows come back ragged — the parser
 * reads by index, so they are padded to the width of the widest row here.
 */
export async function fetchSheetRows(
    urlOrId: string,
    tabName: string,
    token: string,
): Promise<string[][]> {
    const id = spreadsheetId(urlOrId);
    if (!id) throw new Error('That does not look like a Google Sheet link or id');

    const title = await resolveTab(id, tabName, token);
    // Quoted: a tab named like a cell ("AD1", Meta's own default) is otherwise
    // read as that cell, and Google answers with one empty value or a 400.
    const range = encodeURIComponent(`'${title.replace(/'/g, "''")}'`);
    const res = await axios.get(
        `${SHEETS_API}/${id}/values/${range}`,
        {
            params: {
                valueRenderOption: 'UNFORMATTED_VALUE',
                dateTimeRenderOption: 'FORMATTED_STRING',
            },
            headers: { Authorization: `Bearer ${token}` },
            timeout: 60_000,
        },
    );

    const values: unknown[][] = res.data?.values || [];
    const width = values.reduce((w, r) => Math.max(w, r.length), 0);

    return values.map(row => {
        const cells = row.map(c => (c === null || c === undefined ? '' : String(c)));
        while (cells.length < width) cells.push('');
        return cells;
    });
}

/**
 * Read a sheet end to end: credentials, token, rows.
 *
 * Throws with a message an admin can act on — a sync that fails silently is
 * the failure that costs leads.
 */
export async function readSheet(urlOrId: string, tabName: string): Promise<string[][]> {
    const account = readServiceAccount();
    if (!account) {
        throw new Error(
            'No Google service account configured — set GOOGLE_SERVICE_ACCOUNT_JSON',
        );
    }

    try {
        const token = await getAccessToken(account);
        return await fetchSheetRows(urlOrId, tabName, token);
    } catch (err: any) {
        const status = err?.response?.status;
        if (status === 403) {
            throw new Error(
                `Google refused access. Share the sheet with ${account.client_email} as a Viewer.`,
            );
        }
        if (status === 404) {
            throw new Error(`No sheet found at that link, or no tab named "${tabName}".`);
        }
        throw new Error(`Could not read the sheet: ${err?.message || 'unknown error'}`);
    }
}
