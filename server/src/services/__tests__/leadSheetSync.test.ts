import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { planSync, summarise, hasUsablePhone, leadDate, sheetArea, planSheetImport, sheetCar, type ExistingLead } from '../leadSheetSync.js';
import type { SheetLead } from '../leadSheetParser.js';

/**
 * What a sync decides, before it writes anything.
 *
 * The two failures worth guarding against pull in opposite directions: sending
 * an ASM a lead they already have, and silently dropping a customer nobody
 * else captured. Every case below is one or the other.
 */

const lead = (over: Partial<SheetLead> = {}): SheetLead => ({
    leadId: null,
    createdAt: '2026-09-20T10:00:00-05:00',
    name: 'Ravi Khetan',
    phone: '+919876543210',
    pincode: null,
    city: 'Jaipur',
    state: null,
    car: 'Thar',
    carYear: null,
    product: 'Seat Covers',
    platform: 'ig',
    rowNumber: 2,
    unmapped: {},
    ...over,
});

const existing = (over: Partial<ExistingLead> = {}): ExistingLead => ({
    id: 'existing-1',
    phone_key: '9876543210',
    raw_area: 'Jaipur',
    car_model: 'Thar',
    product: 'Seat Covers',
    ...over,
});

const CUTOFF = new Date('2026-09-01T00:00:00Z');

describe('a lead already captured on WhatsApp is not sent twice', () => {
    test('the same enquiry from the sheet is a duplicate', () => {
        const [d] = planSync([lead()], [existing()], CUTOFF);
        assert.equal(d.action, 'duplicate');
        assert.equal(d.existingId, 'existing-1');
    });

    // The sheet writes "+919876543210"; the lead row holds the last ten digits.
    test('the number being written differently does not hide the match', () => {
        const [d] = planSync([lead({ phone: 'p:+91 98765 43210' })], [existing()], CUTOFF);
        assert.equal(d.action, 'duplicate');
    });

    test('case and spacing do not hide the match', () => {
        const [d] = planSync(
            [lead({ city: ' JAIPUR ', car: 'thar' })],
            [existing()],
            CUTOFF,
        );
        assert.equal(d.action, 'duplicate');
    });
});

describe('a lead the WhatsApp path never saw is routed', () => {
    test('nothing matching it means a new lead', () => {
        const [d] = planSync([lead()], [], CUTOFF);
        assert.equal(d.action, 'route');
    });

    test('a different number entirely is a new lead', () => {
        const [d] = planSync([lead({ phone: '+919000000009' })], [existing()], CUTOFF);
        assert.equal(d.action, 'route');
    });
});

describe('the same number is not the same lead', () => {
    /* The case the rule exists for: one customer, two vehicles. Both are real
       enquiries and an ASM should hear about each. */
    test('same number, different vehicle, is routed', () => {
        const [d] = planSync([lead({ car: 'Creta' })], [existing()], CUTOFF);
        assert.equal(d.action, 'route');
    });

    test('same number, different city, is routed', () => {
        const [d] = planSync([lead({ city: 'Udaipur' })], [existing()], CUTOFF);
        assert.equal(d.action, 'route');
    });

    test('same number, different product, is routed', () => {
        const [d] = planSync([lead({ product: 'Mats' })], [existing()], CUTOFF);
        assert.equal(d.action, 'route');
    });
});

describe('the cutoff date', () => {
    /*
     * A first sync of the September export would otherwise send about 4,300
     * paid templates about enquiries going back to June.
     */
    test('a lead older than the cutoff is imported but never sent', () => {
        const [d] = planSync([lead({ createdAt: '2026-06-08T09:55:49-05:00' })], [], CUTOFF);
        assert.equal(d.action, 'import_silent');
    });

    test('a lead on or after the cutoff is routed', () => {
        const [d] = planSync([lead({ createdAt: '2026-09-20T10:00:00-05:00' })], [], CUTOFF);
        assert.equal(d.action, 'route');
    });

    test('an unreadable date is treated as old, never sent by surprise', () => {
        const [d] = planSync([lead({ createdAt: 'l:1066369266186348' })], [], CUTOFF);
        assert.equal(d.action, 'import_silent');
    });

    test('no cutoff set means everything routes', () => {
        const [d] = planSync([lead({ createdAt: '2026-06-08T09:55:49-05:00' })], [], null);
        assert.equal(d.action, 'route');
    });

    // The cutoff decides sending only; a duplicate stays a duplicate either way.
    test('the cutoff never turns a duplicate into an import', () => {
        const [d] = planSync(
            [lead({ createdAt: '2026-06-08T09:55:49-05:00' })],
            [existing()],
            CUTOFF,
        );
        assert.equal(d.action, 'duplicate');
    });
});

describe('rows that cannot be acted on', () => {
    test('a lead with no usable phone is refused', () => {
        for (const phone of ['', 'p:<test>', '12345', null as any]) {
            const [d] = planSync([lead({ phone })], [], CUTOFF);
            assert.equal(d.action, 'unusable', `phone: ${JSON.stringify(phone)}`);
        }
    });

    test('a usable phone survives any formatting', () => {
        assert.equal(hasUsablePhone(lead({ phone: '+91 98765 43210' })), true);
        assert.equal(hasUsablePhone(lead({ phone: '09876543210' })), true);
        assert.equal(hasUsablePhone(lead({ phone: '919876543210' })), true);
    });
});

describe('the same enquiry appearing twice in one file', () => {
    test('the second copy is a duplicate of the first', () => {
        const rows = planSync([lead(), lead({ rowNumber: 99 })], [], CUTOFF);
        assert.equal(rows[0].action, 'route');
        assert.equal(rows[1].action, 'duplicate');
    });

    test('two different enquiries in one file are both routed', () => {
        const rows = planSync([lead(), lead({ car: 'Creta', rowNumber: 99 })], [], CUTOFF);
        assert.equal(rows[0].action, 'route');
        assert.equal(rows[1].action, 'route');
    });
});

describe('the state, once the campaign form asks for it', () => {
    /* The state is what routes. When the sheet carries one it identifies the
       lead, and the city stays in the message to the ASM. */
    test('the state is used in place of the city for matching', () => {
        const [d] = planSync(
            [lead({ state: 'Rajasthan' })],
            [existing({ raw_area: 'Rajasthan' })],
            CUTOFF,
        );
        assert.equal(d.action, 'duplicate');
    });
});

describe('the pincode, once the forms ask for it', () => {
    /* A store-locator lead records its pincode as the area, so a sheet row
       carrying the same pincode is the same enquiry and is not sent again. */
    test('a customer already served on WhatsApp is a duplicate by pincode', () => {
        const [d] = planSync(
            [lead({ pincode: '302 001', city: null })],
            [existing({ raw_area: '302001' })],
            CUTOFF,
        );
        assert.equal(d.action, 'duplicate');
    });

    test('same number, different pincode, is a new lead', () => {
        const [d] = planSync(
            [lead({ pincode: '302001', city: null })],
            [existing({ raw_area: '110001' })],
            CUTOFF,
        );
        assert.equal(d.action, 'route');
    });

    test('the pincode wins over city and state for matching', () => {
        assert.equal(sheetArea(lead({ pincode: '302001', city: 'Jaipur', state: 'Rajasthan' })), '302001');
        assert.equal(sheetArea(lead({ pincode: null, city: 'Jaipur 302001' })), '302001');
        assert.equal(sheetArea(lead({ pincode: 'near bus stand', city: 'Jaipur' })), 'Jaipur');
        assert.equal(sheetArea(lead({ pincode: null, city: 'Jaipur', state: 'Rajasthan' })), 'Rajasthan');
    });
});

describe('leadDate', () => {
    test('reads Meta timestamps with an offset', () => {
        assert.equal(leadDate(lead({ createdAt: '2026-06-08T09:55:49-05:00' }))?.toISOString(),
                     '2026-06-08T14:55:49.000Z');
    });

    test('returns null rather than guessing', () => {
        assert.equal(leadDate(lead({ createdAt: '' })), null);
        assert.equal(leadDate(lead({ createdAt: 'not a date' })), null);
    });
});

describe('summarise', () => {
    test('counts each outcome for the import report', () => {
        const decisions = planSync(
            [
                lead(),                                            // route
                lead({ car: 'Creta' }),                            // route
                lead({ createdAt: '2026-06-01T00:00:00-05:00', car: 'Nexon' }), // silent
                lead({ phone: 'bad' }),                            // unusable
                lead(),                                            // duplicate of the first
            ],
            [],
            CUTOFF,
        );
        assert.deepEqual(summarise(decisions), {
            total: 5, routed: 2, importedSilently: 1, duplicates: 1, unusable: 1,
        });
    });

    test('an empty sheet is not an error', () => {
        assert.deepEqual(summarise(planSync([], [], CUTOFF)), {
            total: 0, routed: 0, importedSilently: 0, duplicates: 0, unusable: 0,
        });
    });
});

describe('planSheetImport — the live sheet into Lead Management', () => {
    const none = () => ({ metaIds: new Set<string>(), instagramAt: new Map<string, Date[]>() });
    const at = (iso: string) => new Date(iso);

    test('a new row is filed; the same Meta lead id next pass is not', () => {
        const row = lead({ leadId: '1234567890123456', createdAt: '2026-09-29T10:00:00-05:00' });
        assert.equal(planSheetImport([row], none(), null)[0].action, 'insert');
        const known = { ...none(), metaIds: new Set(['1234567890123456']) };
        assert.equal(planSheetImport([row], known, null)[0].action, 'already-imported');
    });

    test('a customer who also messaged us on WhatsApp is not filed twice', () => {
        const row = lead({ leadId: '111', createdAt: '2026-09-29T10:00:00-05:00' });
        const known = { ...none(), instagramAt: new Map([['9876543210', [at('2026-09-29T16:00:00Z')]]]) };
        assert.equal(planSheetImport([row], known, null)[0].action, 'same-enquiry');
        // A month later it is a new enquiry.
        const later = lead({ leadId: '222', createdAt: '2026-10-29T10:00:00-05:00' });
        assert.equal(planSheetImport([later], known, null, at('2026-11-01T00:00:00Z'))[0].action, 'insert');
    });

    test('a different number is a different lead, even under the same name', () => {
        // Decided 6 Oct 2026: only the same number is the same enquiry.
        const row = lead({ leadId: '333', name: 'Mohd Sarwar', phone: '+919000008418', pincode: 'z:134116', createdAt: '2026-10-06T04:05:00-05:00' });
        const known = { ...none(), instagramAt: new Map([['9000002562', [at('2026-10-06T09:05:30Z')]]]) };
        assert.equal(planSheetImport([row], known, null, at('2026-10-07T00:00:00Z'))[0].action, 'insert');
    });

    test('a row under ten minutes old waits, so a WhatsApp copy can arrive first', () => {
        const row = lead({ leadId: '444', createdAt: '2026-10-06T05:58:00-05:00' });
        assert.equal(planSheetImport([row], none(), null, at('2026-10-06T11:03:00Z'))[0].action, 'wait');
        assert.equal(planSheetImport([row], none(), null, at('2026-10-06T11:09:00Z'))[0].action, 'insert');
    });

    test('two rows for one person days apart: the first is kept', () => {
        const a = lead({ leadId: 'a', createdAt: '2026-09-28T10:00:00-05:00' });
        const b = lead({ leadId: 'b', createdAt: '2026-09-29T10:00:00-05:00' });
        const plan = planSheetImport([b, a], none(), null);
        assert.deepEqual(plan.map(d => [d.lead.leadId, d.action]), [['a', 'insert'], ['b', 'same-enquiry']]);
    });

    test('no callable number, or before the start date, is not filed', () => {
        assert.equal(planSheetImport([lead({ phone: '12345' })], none(), null)[0].action, 'unusable');
        const old = lead({ createdAt: '2026-09-01T10:00:00-05:00' });
        assert.equal(planSheetImport([old], none(), at('2026-09-23T00:00:00Z'))[0].action, 'too-old');
    });

    test('the car reads as the team would say it', () => {
        assert.equal(sheetCar(lead({ car: 'SUV', carYear: '2022' })), 'SUV (2022)');
        assert.equal(sheetCar(lead({ car: 'Toyota', carYear: 'Etios cross 2015' })), 'Toyota Etios cross 2015');
        assert.equal(sheetCar(lead({ car: 'yes', carYear: 'kiger AMT' })), 'kiger AMT');
        assert.equal(sheetCar(lead({ car: null, carYear: null })), null);
    });
});
