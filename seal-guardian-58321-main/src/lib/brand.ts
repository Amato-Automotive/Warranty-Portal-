/**
 * The two brands a store can carry, as the screens show them. A store that
 * carries both (AFAC) is shown as Autoform, as before.
 */
export type Brand = 'AF' | 'AC' | 'AFAC';

export interface BrandLook {
    key: 'AF' | 'AC';
    name: string;
    logo: string;
    /** A small square mark for tight spaces; Autocruze has none, so it shows its initials. */
    icon: string | null;
    initials: string;
    /** The word the loading screen spells out. */
    word: string;
}

const LOOKS: Record<'AF' | 'AC', BrandLook> = {
    AF: { key: 'AF', name: 'Autoform', logo: '/autoform-logo.png', icon: '/favicon.png', initials: 'AF', word: 'AUTOFORM' },
    AC: { key: 'AC', name: 'Autocruze', logo: '/autocruze-logo.png', icon: null, initials: 'AC', word: 'AUTOCRUZE' },
};

export const brandLook = (brand?: string | null): BrandLook => (brand === 'AC' ? LOOKS.AC : LOOKS.AF);

/** The store filter used wherever the admin picks stores: each brand on its own. */
export const STORE_BRAND_FILTER: { value: '' | Brand; label: string }[] = [
    { value: '', label: 'All' }, { value: 'AF', label: 'AF only' }, { value: 'AC', label: 'AC only' }, { value: 'AFAC', label: 'AFAC only' },
];
export const storeBrand = (b?: string | null): Brand => (b === 'AC' || b === 'AFAC' ? b : 'AF');

/**
 * The warranty products a store's forms list: its own brand's, and those for
 * both; a store with both brands (or none known) lists every one. The product
 * a warranty already has always stays, so an old warranty can still be edited.
 */
export function productsForBrand<T extends { name: string; brand?: string | null }>(products: T[], brand?: string | null, keep?: string | null): T[] {
    const b = String(brand ?? '').toUpperCase();
    if (b !== 'AF' && b !== 'AC') return products;
    return products.filter(p => {
        const pb = String(p.brand ?? 'AF').toUpperCase();
        return pb === b || pb === 'AFAC' || (keep && p.name === keep);
    });
}

/** The choices a new franchise picks from. */
export const BRAND_CHOICES: { value: Brand; label: string; note: string }[] = [
    { value: 'AF', label: 'Autoform', note: 'AF' },
    { value: 'AC', label: 'Autocruze', note: 'AC' },
    { value: 'AFAC', label: 'Both', note: 'AFAC' },
];
