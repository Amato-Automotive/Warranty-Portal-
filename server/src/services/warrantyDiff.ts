/**
 * What changed when a rejected warranty was corrected and sent back.
 *
 * A resubmission was recorded nowhere. The status moved back to the queue, the
 * rejection reason was cleared from the row, and nothing said who fixed it or
 * what they touched — so the admin reviewing it a second time could see only
 * that it was waiting again, not whether the thing they objected to had been
 * addressed. That is how the same fault gets rejected twice.
 *
 * The shape matches what the admin edit path already writes, so one reader
 * renders both.
 *
 * Free of any database import: the comparison is the part worth testing.
 */

export interface FieldChange {
    before: string | null;
    after: string | null;
}

export type ChangeSet = Record<string, FieldChange>;

/**
 * The columns worth reporting, and what to call them.
 *
 * Only fields a person deliberately fills in. Timestamps, internal ids and
 * derived columns change on every save and would bury the two or three edits
 * that actually matter.
 *
 * car_year is deliberately absent for the same reason: the form defaults it to
 * the current year rather than leaving it blank, so it reads as a correction on
 * submissions where nobody touched it.
 */
const TRACKED: Array<[string, string]> = [
    ['customer_name', 'Customer Name'],
    ['customer_email', 'Customer Email'],
    ['customer_phone', 'Customer Phone'],
    ['customer_address', 'Customer Address'],
    ['registration_number', 'Registration Number'],
    ['car_make', 'Vehicle Make'],
    ['car_model', 'Vehicle Model'],
    ['car_colour', 'Vehicle Colour'],
    ['purchase_date', 'Purchase Date'],
    ['installer_name', 'Installer'],
    ['installer_contact', 'Installer Contact'],
    ['warranty_type', 'Warranty Type'],
];

/** The photos a submission carries, and what an admin calls each one. */
const PHOTO_LABELS: Record<string, string> = {
    lhs: 'Left Hand Side photo',
    rhs: 'Right Hand Side photo',
    frontReg: 'Front with Reg. No. photo',
    backReg: 'Back with Reg. No. photo',
    warranty: 'Invoice photo',
    mrpLabel: 'MRP sticker / Taffeta label photo',
    seatCover: 'Seat cover photo',
    vehicle: 'Vehicle photo',
    carOuter: 'Car exterior photo',
    invoiceFileName: 'Invoice file',
};

/**
 * A value as it should read in the log.
 *
 * Dates are the reason this exists. The same day is stored as a Date by one
 * path and an ISO string by another, and comparing those directly reports a
 * change on every save when nothing moved — which makes the whole record
 * useless, because the real edits are lost among the false ones.
 */
export function normaliseValue(value: unknown): string | null {
    if (value === null || value === undefined) return null;

    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
    }

    const text = String(value).trim();
    if (!text) return null;

    // An ISO timestamp for a field that only means a day.
    const iso = text.match(/^(\d{4}-\d{2}-\d{2})T/);
    if (iso) return iso[1];

    return text;
}

/**
 * Which tracked fields differ between two versions of a warranty.
 *
 * Compares on the normalised value, so a date arriving in a different shape is
 * not reported as an edit; anything genuinely different is.
 */
export function diffWarranty(before: Record<string, any>, after: Record<string, any>): ChangeSet {
    const changes: ChangeSet = {};

    for (const [column, label] of TRACKED) {
        // A field the caller did not send is one it is not changing, which is
        // different from a field it cleared.
        if (!(column in after)) continue;

        const was = normaliseValue(before?.[column]);
        const now = normaliseValue(after?.[column]);
        if (was !== now) changes[label] = { before: was, after: now };
    }

    return changes;
}

/** product_details, whichever way the column came back. */
function asObject(value: unknown): Record<string, any> {
    if (!value) return {};
    if (typeof value === 'object') return value as Record<string, any>;
    try {
        const parsed = JSON.parse(String(value));
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

/**
 * Which photos were replaced.
 *
 * Reported as "replaced" rather than by URL: the filename carries a timestamp
 * and tells a reader nothing, while the fact that the invoice photo is new is
 * the whole answer to "did they fix what I asked for?".
 *
 * A photo that was missing and is now present reads as "added", which is the
 * more common correction — the installer forgot one.
 */
export function diffPhotos(before: unknown, after: unknown): ChangeSet {
    const was = asObject(asObject(before).photos);
    const now = asObject(asObject(after).photos);
    const changes: ChangeSet = {};

    for (const key of new Set([...Object.keys(was), ...Object.keys(now)])) {
        const label = PHOTO_LABELS[key] || `${key} photo`;
        const had = String(was[key] ?? '').trim();
        const has = String(now[key] ?? '').trim();

        if (had === has) continue;
        if (!had && has) changes[label] = { before: null, after: 'added' };
        else if (had && !has) changes[label] = { before: 'present', after: null };
        else changes[label] = { before: 'previous photo', after: 'replaced' };
    }

    return changes;
}

/**
 * Everything that changed, fields and photos together.
 *
 * Also reports the serial or UID, which lives inside product_details rather
 * than a column of its own. Labelled by product type for the reason the admin
 * edit path gives: a seat cover carries a pre-printed UID and has no serial
 * number, so calling it "Serial Number" names a field that does not exist.
 */
export function diffSubmission(
    before: Record<string, any>,
    after: Record<string, any>,
    productType?: string | null
): ChangeSet {
    const changes: ChangeSet = {
        ...diffWarranty(before, after),
        ...diffPhotos(before?.product_details, after?.product_details),
    };

    const wasDetails = asObject(before?.product_details);
    const nowDetails = asObject(after?.product_details);

    const wasSerial = normaliseValue(wasDetails.serialNumber);
    const nowSerial = normaliseValue(nowDetails.serialNumber);
    if ('product_details' in after && wasSerial !== nowSerial) {
        const label = String(productType || '').includes('seat') ? 'UID' : 'Serial Number';
        changes[label] = { before: wasSerial, after: nowSerial };
    }

    return changes;
}

/**
 * One line naming what happened, for a reader who wants no more than that.
 *
 * Says how many fields moved rather than listing them, because the list is
 * already there underneath and a summary that repeats it is noise.
 */
export function summariseChanges(changes: ChangeSet, who: string): string {
    const count = Object.keys(changes).length;
    if (count === 0) return `${who} resubmitted this warranty without changing any details`;
    if (count === 1) return `${who} corrected ${Object.keys(changes)[0]}`;
    return `${who} corrected ${count} details`;
}
