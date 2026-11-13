import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    LIMITS,
    fit,
    rowId,
    parseRowId,
    replyFromWebhook,
    storeList,
    distributorList,
    storeDetailsText,
    distributorDetailsText,
    asmText,
    supportText,
    pageCount,
    formatPhone,
    ratingText,
    type ListStore,
    type InteractiveList,
} from '../storeLocatorMessages.js';

/**
 * WhatsApp refuses a list with any part over its limit, and the customer then
 * gets nothing at all — so every case below checks the whole message, not just
 * the part it is about.
 */

const LEAD = '0b6c1c9e-4f7a-4d51-9a55-2f1f3c7e8a10';
const STORE_ID = '7d2e5b3a-1c9f-4e8b-a6d4-5f0c2b9e1a37';

const store = (i: number, name = `Store ${String(i).padStart(2, '0')}`): ListStore => ({
    id: `${STORE_ID.slice(0, -2)}${String(i).padStart(2, '0')}`,
    store_name: name,
    city: 'PALANPUR',
    distance_label: `~${i}.0 km`,
});

function assertWithinLimits(msg: InteractiveList) {
    const { body, action } = msg.message;
    assert.ok(body.text.length <= LIMITS.body, 'body');
    assert.ok(action.button.length <= LIMITS.button, `button "${action.button}"`);
    const rows = action.sections.flatMap(s => s.rows);
    assert.ok(rows.length >= 1 && rows.length <= LIMITS.rows, `${rows.length} rows`);
    for (const s of action.sections) assert.ok(s.title.length <= LIMITS.sectionTitle, `section "${s.title}"`);
    for (const r of rows) {
        assert.ok(r.title.length <= LIMITS.rowTitle, `row title "${r.title}"`);
        assert.ok((r.description ?? '').length <= LIMITS.rowDescription, 'row description');
        assert.ok(r.id.length <= LIMITS.rowId, 'row id');
    }
    assert.equal(new Set(rows.map(r => r.id)).size, rows.length, 'row ids are unique');
}

/** Everything the customer can read in a list. */
const visibleText = (msg: InteractiveList) => [
    msg.message.body.text,
    msg.message.action.button,
    ...msg.message.action.sections.flatMap(s => [s.title, ...s.rows.flatMap(r => [r.title, r.description ?? ''])]),
].join('\n');

describe('store list', () => {
    test('a long store name is cut to fit, not refused', () => {
        const msg = storeList(LEAD, [store(1, 'UMIYA CAR ACCESSORIES AND SPARE PARTS PVT LTD')])!;
        assertWithinLimits(msg);
        assert.ok(msg.message.action.sections[0].rows[0].title.endsWith('…'));
    });

    test('no distance or range is shown — just the store and its city', () => {
        const msg = storeList(LEAD, [store(3)])!;
        assert.doesNotMatch(visibleText(msg), /km|range|within/i);
        assert.deepEqual(msg.message.action.sections[0].rows[0], {
            id: rowId(LEAD, 'store', store(3).id), title: 'Store 03', description: 'Palanpur',
        });
        assert.match(msg.message.body.text, /^Here are the Autoform stores near you/);
    });

    test('ten stores fit on one page with no "More" row', () => {
        const msg = storeList(LEAD, Array.from({ length: 10 }, (_, i) => store(i + 1)))!;
        assertWithinLimits(msg);
        const rows = msg.message.action.sections[0].rows;
        assert.equal(rows.length, 10);
        assert.ok(rows.every(r => parseRowId(r.id)?.kind === 'store'));
    });

    test('eleven stores: nine and "More stores", then the last two', () => {
        const stores = Array.from({ length: 11 }, (_, i) => store(i + 1));
        const first = storeList(LEAD, stores, 1)!;
        assertWithinLimits(first);
        const rows1 = first.message.action.sections[0].rows;
        assert.equal(rows1.length, 10);
        assert.equal(rows1[9].title, 'More stores');
        assert.deepEqual(parseRowId(rows1[9].id), { leadId: LEAD, kind: 'more', ref: '2' });

        const second = storeList(LEAD, stores, 2)!;
        assertWithinLimits(second);
        assert.deepEqual(second.message.action.sections[0].rows.map(r => r.title), ['Store 10', 'Store 11']);
        assert.equal(pageCount(11), 2);
    });

    test('every store is reachable across pages, once each', () => {
        for (const total of [1, 9, 10, 11, 19, 20, 27, 40]) {
            const stores = Array.from({ length: total }, (_, i) => store(i + 1));
            const seen: string[] = [];
            for (let page = 1; page <= pageCount(total); page++) {
                const msg = storeList(LEAD, stores, page)!;
                assertWithinLimits(msg);
                for (const r of msg.message.action.sections[0].rows) {
                    const tap = parseRowId(r.id)!;
                    if (tap.kind === 'store') seen.push(tap.ref);
                }
            }
            assert.deepEqual(seen, stores.map(s => s.id), `${total} stores`);
            assert.equal(storeList(LEAD, stores, pageCount(total) + 1), null);
        }
    });

    test('the list keeps the order it was given — alphabetical from the locator', () => {
        const msg = storeList(LEAD, [store(1, 'Alpha'), store(2, 'Beta'), store(3, 'Gamma')])!;
        assert.deepEqual(msg.message.action.sections[0].rows.map(r => r.title), ['Alpha', 'Beta', 'Gamma']);
    });
});

describe('distributors, shown as stores', () => {
    const dist = { id: '12', name: 'HIMALAYAN AUTO DISTRIBUTORS', phone: '9876543210', city: 'DHARAMSHALA', distance_label: '~24 km' };

    test('the customer sees the same store list, never the word distributor or partner', () => {
        const msg = distributorList(LEAD, [dist])!;
        assertWithinLimits(msg);
        assert.equal(msg.message.action.button, 'View stores');
        // Our own wording only — the business's name may well say "Distributors".
        const ours = [msg.message.body.text, msg.message.action.button, msg.message.action.sections[0].title].join('\n');
        assert.doesNotMatch(ours, /distributor|partner|km/i);
        assert.equal(msg.message.body.text, storeList(LEAD, [store(1)])!.message.body.text);
    });

    test('but the tap still says it was a distributor, for us', () => {
        const msg = distributorList(LEAD, [dist])!;
        assert.deepEqual(parseRowId(msg.message.action.sections[0].rows[0].id), { leadId: LEAD, kind: 'distributor', ref: '12' });
    });

    test('a picked distributor gets the same details message as a store', () => {
        const t = distributorDetailsText(dist);
        assert.match(t, /^Thank you for choosing Autoform!/);
        assert.match(t, /🏪 \*HIMALAYAN AUTO DISTRIBUTORS\*\n📍 Dharamshala\n📞 \+91 98765 43210/);
    });
});

describe('reading a tap', () => {
    test('our row ids round-trip', () => {
        assert.deepEqual(parseRowId(rowId(LEAD, 'store', STORE_ID)), { leadId: LEAD, kind: 'store', ref: STORE_ID });
    });

    test("anyone else's ids are not ours", () => {
        // The existing workflow's product button, as stored from a real webhook.
        assert.equal(parseRowId('2c8bd88d-76c3-49f1-acd5-3c678c9b9a93'), null);
        assert.equal(parseRowId('sl:only:three'), null);
        assert.equal(parseRowId(`sl:${LEAD}:x:1`), null);
        assert.equal(parseRowId(''), null);
    });

    test('a list tap in a webhook, message given as a JSON string', () => {
        const message = {
            message_content_type: 'InteractiveListReply',
            message: JSON.stringify({ type: 'list_reply', list_reply: { id: rowId(LEAD, 'store', STORE_ID), title: 'SHIVAM AUTO MALL' } }),
        };
        assert.deepEqual(replyFromWebhook(message), { leadId: LEAD, kind: 'store', ref: STORE_ID });
    });

    test("the workflow's own button taps and plain text fall through", () => {
        const button = {
            message_content_type: 'InteractiveButtonReply',
            message: '{"type": "button_reply", "button_reply": {"id": "2c8bd88d-76c3-49f1-acd5-3c678c9b9a93", "title": "Car Seat Covers"}}',
        };
        assert.equal(replyFromWebhook(button), null);
        assert.equal(replyFromWebhook({ message_content_type: 'Text', message: '385001' }), null);
        assert.equal(replyFromWebhook({ message: '{not json' }), null);
        assert.equal(replyFromWebhook(undefined), null);
    });
});

describe('text replies', () => {
    test('store details: thanks, name, address once, phone, help line', () => {
        const t = storeDetailsText({
            store_name: 'SHIVAM AUTO MALL ', address: 'Near Bus Stand, Palanpur 385001', city: 'PALANPUR',
            pincode: '385001', phone: '919876543210',
        });
        assert.equal(t, [
            'Thank you for choosing Autoform! 🙏',
            '',
            "Here are your store's details:",
            '',
            '🏪 *SHIVAM AUTO MALL*',
            '📍 Near Bus Stand, Palanpur 385001',
            '📞 +91 98765 43210',
            '',
            'Feel free to call or visit — the team will be happy to help you choose the right products for your car. 🚗',
            '',
            'Looking for a store somewhere else? Just send us that pincode.',
        ].join('\n'));
    });

    test('a store with no phone on record drops that line, not the message', () => {
        const t = storeDetailsText({ store_name: 'X', address: 'Main Road', city: null, pincode: null, phone: null });
        assert.doesNotMatch(t, /📞/);
        assert.match(t, /📍 Main Road/);
    });

    test('the ASM is presented as a store contact', () => {
        const t = asmText({ id: 'a1', name: 'Rahul Sharma', phone: '9876543210' });
        assert.match(t, /Autoform store contact nearest to you/);
        assert.match(t, /🏪 \*Rahul Sharma\*\n📞 \+91 98765 43210/);
        assert.doesNotMatch(t, /area manager|ASM|km/i);
    });

    test('support with a number, and without one', () => {
        const withPhone = supportText({ id: null, name: 'Autoform Customer Support', phone: '9876543210' });
        assert.match(withPhone, /🏪 \*Autoform Customer Support\*\n📞 \+91 98765 43210/);
        const without = supportText({ id: null, name: 'Autoform Customer Support', phone: null });
        assert.match(without, /Our team will get in touch with you shortly/);
        assert.doesNotMatch(without, /📞/);
    });

    test('phones are shown the same way however they are stored', () => {
        for (const p of ['9876543210', '919876543210', '+91 98765-43210']) assert.equal(formatPhone(p), '+91 98765 43210');
    });

    test('fit cuts on a word where it can', () => {
        assert.equal(fit('Shree Ganesh Car Accessories', 24), 'Shree Ganesh Car…');
        assert.equal(fit('short', 24), 'short');
    });
});

describe('ratings', () => {
    test('a row shows the average after the city, never a count', () => {
        const msg = storeList(LEAD, [{ ...store(1), rating: 4.6 }, store(2)])!;
        const rows = msg.message.action.sections[0].rows;
        assert.equal(rows[0].description, 'Palanpur · ★ 4.6');
        assert.equal(rows[1].description, 'Palanpur');
        assertWithinLimits(msg);
    });
    test('the details card carries the average on its own line', () => {
        const t = storeDetailsText({ store_name: 'Sharma Car Decor', address: 'Karol Bagh', city: 'Delhi', pincode: '110005', phone: '9811111111', rating: 4.6 });
        assert.match(t, /🏪 \*Sharma Car Decor\*\n⭐ 4\.6\n/);
        assert.doesNotMatch(storeDetailsText({ store_name: 'X', address: null, city: null, pincode: null, phone: null }), /⭐/);
    });
    test('ratingText shows one decimal, and nothing for no rating', () => {
        assert.equal(ratingText(4), '★ 4.0');
        assert.equal(ratingText(null), '');
        assert.equal(ratingText(0), '');
        assert.equal(ratingText(undefined), '');
    });
});
