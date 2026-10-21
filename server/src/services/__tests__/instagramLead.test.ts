import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseLeadForm } from '../instagramLeadParser.js';
import { normaliseProduct } from '../productMatch.js';
import { extractPincode } from '../storeLocator.js';

/**
 * A false positive here routes an ordinary "hi" straight past the question
 * flow and sends an ASM an enquiry with no area. A false negative loses a paid
 * ad lead. The messages below are real ones, copied verbatim.
 */

describe('parseLeadForm — real messages', () => {
    test('reads a complete lead form', () => {
        const lead = parseLeadForm(
            `Hello! I filled in your form and would like to know more about your business.

For which car do you need the seat cover?: Verna Sedan
Full name: Kuldeep Sharma
Phone number: +917307388011
City: Mohali
Can you share the car model year?: 2024`
        );

        assert.equal(lead?.name, 'Kuldeep Sharma');
        assert.equal(lead?.city, 'Mohali');
        assert.equal(lead?.car, 'Verna Sedan');
        assert.equal(lead?.product, 'Seat Covers');
        assert.equal(lead?.phone, '+917307388011');
    });

    test('reads "Post code" and the car year — the October 2026 form', () => {
        // The first live lead on this form was filed "No valid pincode given":
        // "Post code" was not a pincode label, and the year was dropped.
        const lead = parseLeadForm(
            `Hello! I filled in your form and would like to know more about your business.

For which car do you need the seat cover?: Hyundai exter
Can you share the car model year?: 2025
Full name: Test Customer
Phone number: +919876543210
Post code: 143001`
        );
        assert.equal(lead?.pincode, '143001');
        assert.equal(lead?.car, 'Hyundai exter');
        assert.equal(lead?.carYear, '2025');
        assert.deepEqual(lead?.unmapped, {});
    });

    test('accepts "filled out", the other wording Meta sends', () => {
        // Both appear in real messages; only "filled in" was handled at first,
        // which silently dropped two of three leads.
        const lead = parseLeadForm(
            `Hello! I filled out your form and would like to know more about your business.

Full name: Mangesh Taware
City: Pune
For which car do you need the seat cover?: maruti swift`
        );
        assert.equal(lead?.name, 'Mangesh Taware');
        assert.equal(lead?.city, 'Pune');
    });

    test('finds the marker when text precedes the greeting', () => {
        // One real message opened with the sender's own name.
        const lead = parseLeadForm(
            `Gyan Prakash Dubey Hello! I filled out your form and would like to know more about your business.

Full name: gyanprakeshmdubey
City: Ahemdabadahemdabad .gujrat.`
        );
        assert.equal(lead?.city, 'Ahemdabadahemdabad .gujrat.');
    });

    test('field order does not matter', () => {
        const lead = parseLeadForm(
            `Hello! I filled in your form and would like to know more about your business.

City: Gurgaon
Can you share the car model year?: 2020-2023
Full name: Shekhar Kapoor
For which car do you need the seat cover?: Hatchback`
        );
        assert.equal(lead?.name, 'Shekhar Kapoor');
        assert.equal(lead?.city, 'Gurgaon');
        assert.equal(lead?.car, 'Hatchback');
    });
});

describe('parseLeadForm — the pincode, which forms ask for from late September 2026', () => {
    const FORM = (line: string) => `Hello! I filled out your form and would like to know more about your business.

Full name: Ravi Khetan
Phone number: +919839905800
${line}
For which car do you need the seat cover?: Toyota Etios`;

    test('a "Pincode" answer is read, and the city is left empty', () => {
        const lead = parseLeadForm(FORM('Pincode: 274304'));
        assert.equal(lead?.pincode, '274304');
        assert.equal(lead?.city, null);
        assert.deepEqual(lead?.unmapped, {});
    });

    for (const label of ['Pin code', 'PIN', 'Your pincode', 'Postal code', 'Area pincode', "What's your area pincode?"]) {
        test(`"${label}" is the pincode, never the city`, () => {
            const lead = parseLeadForm(FORM(`${label}: 274304`));
            assert.equal(lead?.pincode, '274304');
            assert.equal(lead?.city, null);
        });
    }

    test('the phone is never read as the pincode', () => {
        const lead = parseLeadForm(FORM('Pincode: 274304'));
        assert.equal(lead?.phone, '+919839905800');
    });
});

describe('extractPincode — the digits inside what was typed', () => {
    const cases: Array<[string | null, string | null]> = [
        ['274304', '274304'],
        ['274 304', '274304'],
        ['274-304', '274304'],
        ['Pin- 302001', '302001'],
        ['Sector 62 Noida 201301', '201301'],
        ['  110085 ', '110085'],
        ['+919839905800', null],     // a phone number's tail is not a pincode
        ['12345', null],
        ['1234567', null],
        ['012345', null],            // pincodes never start with 0
        ['Padrauna', null],
        ['', null],
        [null, null],
    ];
    for (const [input, expected] of cases) {
        test(`${JSON.stringify(input)} -> ${expected}`, () => assert.equal(extractPincode(input), expected));
    }
});

describe('parseLeadForm — the year is not the car', () => {
    test('"car model year" does not fill the car field', () => {
        const lead = parseLeadForm(
            `Hello! I filled in your form and would like to know more about your business.

Can you share the car model year?: 2020
For which car do you need the seat cover?: Creta
City: Delhi`
        );
        assert.equal(lead?.car, 'Creta');
    });

    test('the year is read into its own field, not left unmapped', () => {
        const lead = parseLeadForm(
            `Hello! I filled in your form and would like to know more about your business.

City: Delhi
Can you share the car model year?: 2020`
        );
        assert.equal(lead?.carYear, '2020');
        assert.deepEqual(lead?.unmapped, {});
    });
});

describe('parseLeadForm — the product comes from the question', () => {
    const cases: Array<[string, string | null]> = [
        ['For which car do you need the seat cover?: Swift', 'Seat Covers'],
        ['For which car do you need the car mats?: Swift', 'Mats'],
        ['Which accessories do you need?: Lights', 'Accessories'],
    ];

    for (const [line, expected] of cases) {
        test(`"${line.slice(0, 40)}…" -> ${expected}`, () => {
            const lead = parseLeadForm(
                `Hello! I filled in your form and would like to know more about your business.\n\n${line}\nCity: Pune`
            );
            assert.equal(lead?.product, expected);
        });
    }
});

describe('parseLeadForm — label wording can vary', () => {
    const cases: Array<[string, keyof NonNullable<ReturnType<typeof parseLeadForm>>, string]> = [
        ['Which city are you in?: Jaipur', 'city', 'Jaipur'],
        ['Location: Indore', 'city', 'Indore'],
        ['Your name: Amit', 'name', 'Amit'],
        ['Mobile number: 9812345678', 'phone', '9812345678'],
    ];

    for (const [line, field, expected] of cases) {
        test(`"${line}" fills ${String(field)}`, () => {
            const lead = parseLeadForm(
                `Hello! I filled in your form and would like to know more about your business.\n\n${line}`
            );
            assert.equal(lead?.[field], expected);
        });
    }
});

describe('parseLeadForm — ordinary messages fall through', () => {
    /*
     * Checked against all 181 message_received events we had recorded: not one
     * was a false positive. These are the shapes that matter.
     */
    const notForms = [
        'hi',
        'hello',
        'Approve Installation',
        'None',
        'Same design for swift 24 IH',
        'I want to fill your form',        // similar words, not the marker
        'Hello! I filled in the form',      // "the", not "your"
        '',
    ];

    for (const message of notForms) {
        test(`"${message}" is not a lead form`, () => {
            assert.equal(parseLeadForm(message), null);
        });
    }
});

describe('parseLeadForm — whitespace and formatting', () => {
    test('handles CRLF line endings', () => {
        const lead = parseLeadForm(
            'Hello! I filled in your form and would like to know more about your business.\r\n\r\nCity: Kochi\r\n'
        );
        assert.equal(lead?.city, 'Kochi');
    });

    test('handles a missing space after the colon', () => {
        const lead = parseLeadForm(
            'Hello! I filled in your form and would like to know more about your business.\n\nCity:Mumbai'
        );
        assert.equal(lead?.city, 'Mumbai');
    });

    test('skips a label with no value', () => {
        const lead = parseLeadForm(
            'Hello! I filled in your form and would like to know more about your business.\n\nCity: \nLocation: Surat'
        );
        assert.equal(lead?.city, 'Surat');
    });
});

describe('normaliseProduct', () => {
    const cases: Array<[string | null, string | null]> = [
        // The button labels, exactly as the workflow sends them.
        ['Car Seat Covers', 'Seat Covers'],
        ['Car Mats', 'Mats'],
        ['Car Accessories', 'Accessories'],

        // Typed instead of tapped.
        ['seat cover', 'Seat Covers'],
        ['seatcover', 'Seat Covers'],
        ['Seat-Cover', 'Seat Covers'],
        ['floor mats', 'Mats'],
        ['accessory', 'Accessories'],
        ['i want seat covers for my swift', 'Seat Covers'],

        // Seat covers win over mats when both appear: "car seat cover mat" is
        // a seat cover enquiry.
        ['car seat cover mat', 'Seat Covers'],

        // Nothing recognisable stays null rather than being guessed into a
        // line, which would quietly inflate that product's numbers.
        ['accident claim', null],
        ['hi', null],
        ['Delhi', null],
        ['', null],
        [null, null],
    ];

    for (const [input, expected] of cases) {
        test(`${JSON.stringify(input)} -> ${expected}`, () => {
            assert.equal(normaliseProduct(input), expected);
        });
    }
});

/*
 * Every ad words its questions its own way. Each label below must land in the
 * right field — including typos and the underscore style of Meta's sheet.
 */
describe('parseLeadForm — any wording of a question', () => {
    const form = (label: string, value: string) => parseLeadForm(
        `Hello! I filled in your form and would like to know more about your business.\n\n${label}: ${value}\nFull name: Test Customer`);

    for (const label of [
        'Post code', 'Postcode', 'post_code', 'POSTAL CODE', 'Pincode', 'Pin code', 'PIN', 'Pin Code?',
        'Your area pincode?', 'Enter your pin code', 'Zip', 'Zip code', 'Picode', 'Pincod', 'Area code', 'Pin no',
    ]) {
        test(`"${label}" is the pincode`, () => {
            const lead = form(label, '143001');
            assert.equal(lead?.pincode, '143001');
            assert.equal(lead?.city, null);
        });
    }

    for (const [label, field] of [
        ['Car model year', 'carYear'], ['Manufacturing year', 'carYear'], ['Model Year?', 'carYear'],
        ['Which vehicle do you drive?', 'car'], ['Car name', 'car'], ['Car Model', 'car'], ['Vehical', 'car'],
        ['Mobile No', 'phone'], ['WhatsApp number', 'phone'], ['Moblie number', 'phone'], ['Contact no', 'phone'],
        ['Which city are you in?', 'city'], ['Location', 'city'], ['District', 'city'], ['Your city', 'city'],
    ] as const) {
        test(`"${label}" is the ${field}`, () => {
            const lead = form(label, 'x');
            assert.equal(lead?.[field], 'x');
        });
    }

    test('"Your name" and "Name" are the name', () => {
        const lead = parseLeadForm(`Hello! I filled in your form and would like to know more about your business.\n\nYour name: A B`);
        assert.equal(lead?.name, 'A B');
    });

    test('a pincode under a label nobody planned for is still found', () => {
        const lead = form('Where should we reach you?', '143 001');
        assert.equal(extractPincode(lead?.pincode), '143001');
        assert.deepEqual(lead?.unmapped, {});
    });

    test('the phone number is never taken for a pincode', () => {
        const lead = parseLeadForm(`Hello! I filled in your form and would like to know more about your business.\n\nPhone number: +919876543210\nCity: Delhi`);
        assert.equal(lead?.pincode, null);
        assert.equal(lead?.phone, '+919876543210');
    });
});
