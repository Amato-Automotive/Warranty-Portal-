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

/** The choices a new franchise picks from. */
export const BRAND_CHOICES: { value: Brand; label: string; note: string }[] = [
    { value: 'AF', label: 'Autoform', note: 'AF' },
    { value: 'AC', label: 'Autocruze', note: 'AC' },
    { value: 'AFAC', label: 'Both', note: 'AFAC' },
];
