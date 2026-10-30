/**
 * Emails in the brand of the store they are about. A store that carries only
 * Autocruze (AC) gets the AutoCruze logo and wording; Autoform and stores with
 * both brands keep Autoform, as the portal does. The © line keeps the company
 * name, Autoform India.
 *
 * The caller says which store an email is about with withEmailBrand(); every
 * email sent inside it is rewritten as it leaves (see email.service.ts).
 */
import { AsyncLocalStorage } from 'async_hooks';

const scope = new AsyncLocalStorage<'AC'>();

/** Runs fn with its emails in the given brand (only AC changes anything); the brand may still be on its way. */
export async function withEmailBrand<T>(brand: string | null | undefined | Promise<string | null | undefined>, fn: () => Promise<T>): Promise<T> {
    const b = await brand;
    return String(b ?? '').toUpperCase() === 'AC' ? scope.run('AC', fn) : fn();
}

const AF_LOGO = 'https://res.cloudinary.com/dmwt4rg4m/image/upload/v1765531503/warranty-portal/autoform-logo.png';

/** The words that name the brand, and what they become for AutoCruze. Longest first. */
const WORDS: [RegExp, string][] = [
    [/Autoform India Warranty Portal/g, 'AutoCruze Warranty Portal'],
    [/Autoform Franchise Management System/g, 'AutoCruze Franchise Management System'],
    [/Autoform Warranty Portal/g, 'AutoCruze Warranty Portal'],
    [/Autoform India Team/g, 'AutoCruze Team'],
    [/Team Autoform India/g, 'Team AutoCruze'],
    [/Welcome to Autoform India/g, 'Welcome to AutoCruze'],
    [/\| Autoform India/g, '| AutoCruze'],
    [/alt="Autoform India"/g, 'alt="AutoCruze"'],
];

/** An email's text in AutoCruze words; the © line ("© 2026 Autoform India") is left as it is. */
export function toAutoCruze(text: string, acLogoUrl: string): string {
    let out = text.split(AF_LOGO).join(acLogoUrl);
    for (const [re, to] of WORDS) out = out.replace(re, to);
    return out;
}

/** The mail as it should leave: rewritten for AutoCruze inside withEmailBrand('AC'), untouched otherwise. */
export function brandMail<T extends { subject?: unknown; html?: unknown; text?: unknown }>(mail: T, acLogoUrl: string): T {
    if (scope.getStore() !== 'AC') return mail;
    const f = (v: unknown) => (typeof v === 'string' ? toAutoCruze(v, acLogoUrl) : v);
    return { ...mail, subject: f(mail.subject), html: f(mail.html), text: f(mail.text) };
}
