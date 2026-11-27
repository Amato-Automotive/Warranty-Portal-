/**
 * How a POSM request's items and the POSM dispatch lines follow each other.
 *
 *  - An approved request item becomes a dispatch line: FRP and Sample jacket
 *    go to the plant (the depot the admin picked), everything else to the
 *    Noida office.
 *  - The admin's steps on the item set the line's status, quantity and
 *    shipment; the plant's / Noida office's changes on the line set the
 *    item's step, quantity and shipment. A status the other side cannot
 *    express (Ready to dispatch, Out of stock) is kept as it is.
 *
 * Free of any database import, so it is tested directly.
 */
import type { LineStage } from './posmLineFlow.js';

export const PLANT_ITEMS = new Set(['frp', 'jacket']);
export const isPlantItem = (itemId: string) => PLANT_ITEMS.has(itemId);

/** The request catalog's items, named as the dispatch lines (and the sheets) name them. */
const ITEM_NAME: Record<string, string> = {
    frp: 'FRP', jacket: 'Sample Jacket', tshirt: 'T-Shirt', vcard: 'Visiting Card', cert: 'Franchise Certificate',
    shade: 'Swatch / Shade Book', catalogue: 'Catalogue', kit: 'POSM Kit', art: 'Art work',
};
export const dispatchItemName = (itemId: string, itemName: string) => ITEM_NAME[itemId] ?? itemName;

export const DISPATCH_TO_FIELD = 'dispatch_to';
export const DISPATCH_TO_OPTIONS = ['Direct dispatch to Distributor', 'Direct dispatch to Franchise'] as const;

/** The dispatch status an item's step means; null when it has no line (waiting, or not approved). */
export function statusForStage(stage: LineStage): string | null {
    switch (stage) {
        case 'approved': return 'Not updated';
        case 'in_production': return 'WIP';
        case 'on_hold': return 'On hold';
        case 'dispatched': return 'Dispatched';
        case 'delivered': return 'Delivered';
        default: return null;
    }
}

/** The item step a dispatch status means; null when it says nothing about the step (Return). */
export function stageForStatus(status: string): LineStage | null {
    switch (status) {
        case 'Not updated': return 'approved';
        case 'WIP': case 'Ready to dispatch': return 'in_production';
        case 'On hold': case 'Out of stock': return 'on_hold';
        case 'Dispatched': case 'In Transit': return 'dispatched';
        case 'Delivered': return 'delivered';
        default: return null;
    }
}

/**
 * The status to give a line after the admin's step: its current one when that
 * already means the same step (so the plant's "Ready to dispatch" survives an
 * unrelated change), else the step's own.
 */
export function nextLineStatus(current: string | null, stage: LineStage): string | null {
    const wanted = statusForStage(stage);
    if (!wanted) return null;
    if (current && stageForStatus(current) === stage) return current;
    return wanted;
}

/** FRP's design and colours, read from what the store's line shows. */
export function designOf(display: { label: string; value: string }[] | undefined) {
    const get = (re: RegExp) => display?.find(d => re.test(d.label))?.value?.trim() || null;
    return { design: get(/^design$/i), major_colour: get(/major/i), minor_colour: get(/minor/i), dispatch_to: get(/^dispatch to$/i) };
}
