/** The rules for showing a rating. No database import, so they can be tested alone. */

export const DEFAULT_MIN_RATINGS = 1;

/** The fewest ratings an average may stand on: a whole number, 1 to 100; anything else is the default. */
export function cleanMinRatings(raw: unknown): number {
    const n = Math.round(Number(raw));
    if (raw === null || raw === undefined || raw === '' || !Number.isFinite(n)) return DEFAULT_MIN_RATINGS;
    return Math.min(100, Math.max(1, n));
}

/**
 * One decimal, rounded once from the exact average. A store shows 5.0 only if
 * every rating is a 5: 4.96 reads 4.9, because a perfect score should mean perfect.
 */
export function oneDecimal(avg: number): number {
    const a = Math.min(5, avg);
    const r = Math.round(a * 10) / 10;
    return r >= 5 && a < 5 ? 4.9 : r;
}

/** The average to show for a store, or null when it has too few ratings (or none). */
export function showableRating(avg: unknown, count: unknown, min: number): number | null {
    const a = Number(avg);
    const n = Number(count);
    if (!Number.isFinite(a) || !Number.isFinite(n) || n < min || a <= 0) return null;
    return oneDecimal(a);
}
