import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    haversineKm,
    parseCoordinate,
    isInIndia,
    storesToOffer,
    distributorsToOffer,
    isTestAccount,
    formatDistance,
    isPincode,
    clampMinWarranties,
    clampRadiusKm,
    localPhone,
    RADIUS_KM,
    MAX_MIN_WARRANTIES,
    type LocatableStore,
} from '../storeLocator.js';

/**
 * Distances are checked against real places, so a sign or radian slip shows up
 * as Delhi being in the wrong city rather than as a subtly different number.
 */

const DELHI_CP = { lat: 28.6315, lng: 77.2167 };      // Connaught Place
const ROHINI = { lat: 28.7124, lng: 77.1330 };        // pincode 110085
const MUMBAI = { lat: 18.9359, lng: 72.8341 };
const JAIPUR = { lat: 26.9124, lng: 75.7873 };

/**
 * A point `km` due north of Rohini. One degree of latitude is 6371 x pi / 180
 * = 111.195 km on this sphere; rounding it to 111 put a "9.99 km" store past
 * the 10 km line, which is exactly the boundary these tests check.
 */
const KM_PER_DEGREE = (6371 * Math.PI) / 180;
const northOfRohini = (km: number) => ({ lat: ROHINI.lat + km / KM_PER_DEGREE, lng: ROHINI.lng });

const store = (name: string, p: { lat: number; lng: number }, warranties = 10, id = name): LocatableStore =>
    ({ id, store_name: name, warranties, ...p });

const RULES = { radiusKm: RADIUS_KM, minWarranties: 1 };
const names = (r: ReturnType<typeof storesToOffer>) => r.map(o => o.store.store_name);

describe('haversineKm', () => {
    test('the same point is zero', () => {
        assert.equal(haversineKm(DELHI_CP, DELHI_CP), 0);
    });

    test('Connaught Place to Rohini is about 12 km', () => {
        const d = haversineKm(DELHI_CP, ROHINI);
        assert.ok(d > 10 && d < 14, `got ${d}`);
    });

    test('Delhi to Mumbai is about 1,150 km', () => {
        const d = haversineKm(DELHI_CP, MUMBAI);
        assert.ok(d > 1100 && d < 1200, `got ${d}`);
    });

    test('Delhi to Jaipur is about 235 km', () => {
        const d = haversineKm(DELHI_CP, JAIPUR);
        assert.ok(d > 220 && d < 250, `got ${d}`);
    });

    test('the helper used below is calibrated', () => {
        const d = haversineKm(ROHINI, northOfRohini(5));
        assert.ok(d > 4.9 && d < 5.1, `got ${d}`);
    });
});

describe('storesToOffer — within 15 km', () => {
    test('the radius is 15 km', () => {
        assert.equal(RADIUS_KM, 15);
    });

    test('a store 5 km away is offered', () => {
        assert.deepEqual(names(storesToOffer(ROHINI, [store('Near', northOfRohini(5))], RULES)), ['Near']);
    });

    test('a store 12 km away is offered', () => {
        assert.equal(storesToOffer(ROHINI, [store('Twelve', northOfRohini(12))], RULES).length, 1);
    });

    test('a store 20 km away is not', () => {
        assert.deepEqual(storesToOffer(ROHINI, [store('Far', northOfRohini(20))], RULES), []);
    });

    // The boundary is inclusive: 15 km is within 15 km.
    test('the edge of the radius counts', () => {
        assert.equal(storesToOffer(ROHINI, [store('Edge', northOfRohini(14.99))], RULES).length, 1);
        assert.equal(storesToOffer(ROHINI, [store('Past', northOfRohini(15.05))], RULES).length, 0);
    });

    // No widening: nothing near means nothing, and the caller falls back.
    test('a store far away is never offered in place of none', () => {
        assert.deepEqual(storesToOffer(ROHINI, [store('Jaipur', JAIPUR)], RULES), []);
    });
});

describe('storesToOffer — the customer\'s city first', () => {
    const list = [store('Alpha', northOfRohini(2)), store('Zeta', northOfRohini(3)), store('Mid', northOfRohini(4))];

    test('stores in the city come first, each part A to Z', () => {
        const r = storesToOffer(ROHINI, list, RULES, s => s.store_name !== 'Alpha');
        assert.deepEqual(names(r), ['Mid', 'Zeta', 'Alpha']);
    });

    test('without a city, the list stays A to Z', () => {
        assert.deepEqual(names(storesToOffer(ROHINI, list, RULES)), ['Alpha', 'Mid', 'Zeta']);
    });

    test('a store in the city but out of range is still left out', () => {
        const r = storesToOffer(ROHINI, [store('Far', northOfRohini(20))], RULES, () => true);
        assert.deepEqual(r, []);
    });
});

describe('storesToOffer — the warranty threshold', () => {
    test('a store below the minimum is left out', () => {
        const r = storesToOffer(ROHINI, [
            store('Busy', northOfRohini(2), 50),
            store('Quiet', northOfRohini(3), 0),
        ], { radiusKm: 10, minWarranties: 1 });
        assert.deepEqual(names(r), ['Busy']);
    });

    test('the minimum is inclusive', () => {
        const r = storesToOffer(ROHINI, [store('Exactly', northOfRohini(2), 5)], { radiusKm: 10, minWarranties: 5 });
        assert.equal(r.length, 1);
    });

    test('raising the minimum removes more stores', () => {
        const stores = [
            store('A', northOfRohini(1), 3),
            store('B', northOfRohini(2), 20),
            store('C', northOfRohini(3), 100),
        ];
        assert.equal(storesToOffer(ROHINI, stores, { radiusKm: 10, minWarranties: 1 }).length, 3);
        assert.equal(storesToOffer(ROHINI, stores, { radiusKm: 10, minWarranties: 10 }).length, 2);
        assert.equal(storesToOffer(ROHINI, stores, { radiusKm: 10, minWarranties: 50 }).length, 1);
    });

    test('zero means every store qualifies', () => {
        const r = storesToOffer(ROHINI, [store('New', northOfRohini(1), 0)], { radiusKm: 10, minWarranties: 0 });
        assert.equal(r.length, 1);
    });
});

describe('storesToOffer — alphabetical, not ranked', () => {
    /* The nearest store is not listed first on purpose: every qualifying store
       is offered on equal terms and the customer chooses. */
    test('ordered by name, whatever the distance', () => {
        const r = storesToOffer(ROHINI, [
            store('Zenith Motors', northOfRohini(1)),
            store('Auto World', northOfRohini(8)),
            store('Metro Cars', northOfRohini(4)),
        ], RULES);
        assert.deepEqual(names(r), ['Auto World', 'Metro Cars', 'Zenith Motors']);
    });

    test('case does not change the order', () => {
        const r = storesToOffer(ROHINI, [
            store('beta', northOfRohini(1)),
            store('ALPHA', northOfRohini(2)),
        ], RULES);
        assert.deepEqual(names(r), ['ALPHA', 'beta']);
    });

    test('leading spaces in a name do not move it', () => {
        const r = storesToOffer(ROHINI, [
            store('Beta', northOfRohini(1)),
            store('  Alpha', northOfRohini(2)),
        ], RULES);
        assert.deepEqual(names(r), ['  Alpha', 'Beta']);
    });

    // The same query must always give the same list.
    test('two stores with one name are ordered by id', () => {
        const r = storesToOffer(ROHINI, [
            store('Same', northOfRohini(1), 10, '20'),
            store('Same', northOfRohini(2), 10, '3'),
        ], RULES);
        assert.deepEqual(r.map(o => o.store.id), ['3', '20']);
    });

    // There is no top-5 any more: every qualifying store is offered.
    test('no cap on how many are offered', () => {
        const many = Array.from({ length: 12 }, (_, i) => store(`S${String(i).padStart(2, '0')}`, northOfRohini(i * 1.2)));
        assert.equal(storesToOffer(ROHINI, many, RULES).length, 12);
    });

    test('each store still carries its distance', () => {
        const r = storesToOffer(ROHINI, [store('Near', northOfRohini(5))], RULES);
        assert.ok(r[0].distanceKm > 4.9 && r[0].distanceKm < 5.1);
    });
});

describe('storesToOffer — bad pins', () => {
    // A missing pin must not be read as 0,0 — which is nowhere near anyone.
    test('stores without a usable pin are left out', () => {
        const r = storesToOffer(ROHINI, [
            store('NoPin', { lat: NaN, lng: NaN }),
            store('Zero', { lat: 0, lng: 0 }),
            store('Real', northOfRohini(1)),
        ], RULES);
        assert.deepEqual(names(r), ['Real']);
    });

    test('no stores at all is empty, not an error', () => {
        assert.deepEqual(storesToOffer(ROHINI, [], RULES), []);
    });
});

describe('distributorsToOffer — the list when no store and no ASM', () => {
    const d = (name: string, p: { lat: number; lng: number }, id = name) => ({ id, name, ...p });

    // Alphabetical like the stores: the customer chooses, nearness does not.
    test('ordered by name, not by distance', () => {
        const r = distributorsToOffer(ROHINI, [
            d('Zeta Distributors', northOfRohini(5)),
            d('Alpha Traders', northOfRohini(300)),
            d('Metro Supply', northOfRohini(40)),
        ]);
        assert.deepEqual(r.map(x => x.distributor.name), ['Alpha Traders', 'Metro Supply', 'Zeta Distributors']);
    });

    // A distributor is the right business however far away: no radius.
    test('a distant distributor is still offered', () => {
        const r = distributorsToOffer(ROHINI, [d('Jaipur', JAIPUR)]);
        assert.equal(r.length, 1);
        assert.ok(r[0].distanceKm! > 200);
    });

    test('each carries its distance', () => {
        const r = distributorsToOffer(ROHINI, [d('Near', northOfRohini(8))]);
        assert.ok(r[0].distanceKm! > 7.9 && r[0].distanceKm! < 8.1);
    });

    /* Unlike a store, a distributor is not chosen for nearness, so one with no
       usable pin is still offered — it just shows no distance. */
    test('no usable pin keeps the distributor, without a distance', () => {
        const r = distributorsToOffer(ROHINI, [d('NoPin', { lat: NaN, lng: NaN }), d('Real', northOfRohini(3))]);
        assert.deepEqual(r.map(x => x.distributor.name), ['NoPin', 'Real']);
        assert.equal(r[0].distanceKm, null);
    });

    test('case does not change the order', () => {
        const r = distributorsToOffer(ROHINI, [d('beta', northOfRohini(1)), d('ALPHA', northOfRohini(2))]);
        assert.deepEqual(r.map(x => x.distributor.name), ['ALPHA', 'beta']);
    });

    test('none at all is empty', () => {
        assert.deepEqual(distributorsToOffer(ROHINI, []), []);
    });
});

describe('isTestAccount — never offered, never given a lead', () => {
    // The real test accounts in the live tables.
    test('the test accounts are caught', () => {
        assert.equal(isTestAccount('TestFranchise'), true);
        assert.equal(isTestAccount('Distributor_TEST'), true);
        assert.equal(isTestAccount('test store'), true);
    });

    // "test" inside another word is a real business.
    test('real names containing the letters are not', () => {
        for (const n of ['Latest Auto', 'Contest Motors', 'Protest Cars', 'ADITYA ENTERPRISES', '']) {
            assert.equal(isTestAccount(n), false, n);
        }
    });
});

describe('parseCoordinate — the store table stores these as text', () => {
    // Real values from vendor_details.
    test('a trailing comma is not part of the number', () => {
        assert.equal(parseCoordinate('16.710065296605027,'), 16.710065296605027);
    });

    test('surrounding space is not part of the number', () => {
        assert.equal(parseCoordinate(' 72.86845064991218'), 72.86845064991218);
        assert.equal(parseCoordinate('17.235626360014862 '), 17.235626360014862);
    });

    test('nothing usable is null, never zero', () => {
        for (const v of [null, undefined, '', '   ', ',', 'abc', '0', 0]) {
            assert.equal(parseCoordinate(v), null, JSON.stringify(v));
        }
    });
});

describe('isInIndia', () => {
    test('Indian cities are inside', () => {
        for (const p of [DELHI_CP, MUMBAI, JAIPUR, { lat: 8.5, lng: 76.9 }, { lat: 34.1, lng: 74.8 }]) {
            assert.equal(isInIndia(p.lat, p.lng), true, JSON.stringify(p));
        }
    });

    test('bad pins are outside', () => {
        assert.equal(isInIndia(0, 0), false);
        assert.equal(isInIndia(77.2, 28.6), false);
        assert.equal(isInIndia(null, 77.2), false);
    });
});

describe('clampMinWarranties — what an admin can set', () => {
    test('whole numbers pass through', () => {
        assert.equal(clampMinWarranties(5), 5);
        assert.equal(clampMinWarranties('20'), 20);
    });

    test('never negative', () => {
        assert.equal(clampMinWarranties(-3), 0);
    });

    test('fractions round down', () => {
        assert.equal(clampMinWarranties(4.9), 4);
    });

    // A stray extra zero must not empty every list in the country.
    test('capped', () => {
        assert.equal(clampMinWarranties(99999), MAX_MIN_WARRANTIES);
    });

    test('rubbish is zero', () => {
        for (const v of [null, undefined, '', 'abc', NaN]) {
            assert.equal(clampMinWarranties(v), 0, JSON.stringify(v));
        }
    });
});

describe('formatDistance', () => {
    test('very close', () => assert.equal(formatDistance(0.4), '< 1 km'));
    test('one decimal otherwise', () => assert.equal(formatDistance(3.24), '~3.2 km'));
});

describe('isPincode', () => {
    test('six digits, not starting with 0', () => {
        assert.equal(isPincode('110085'), true);
        assert.equal(isPincode(' 400001 '), true);
    });

    test('anything else is refused', () => {
        for (const v of ['011008', '11008', '1100855', 'abcdef', '', null, '110 085']) {
            assert.equal(isPincode(v), false, JSON.stringify(v));
        }
    });
});

describe('clampRadiusKm — the radius an admin can set', () => {
    test('whole kilometres, as given', () => {
        assert.equal(clampRadiusKm(15), 15);
        assert.equal(clampRadiusKm('25'), 25);
        assert.equal(clampRadiusKm(7.6), 8);
    });
    test('held between 1 and 100 km', () => {
        assert.equal(clampRadiusKm(0), 1);
        assert.equal(clampRadiusKm(-5), 1);
        assert.equal(clampRadiusKm(5000), 100);
    });
    test('anything unreadable is the 15 km default', () => {
        assert.equal(clampRadiusKm(undefined), 15);
        assert.equal(clampRadiusKm(null), 15);
        assert.equal(clampRadiusKm(''), 15);
        assert.equal(clampRadiusKm('abc'), 15);
    });
});

describe('localPhone — the customer number the team reads', () => {
    test('the WhatsApp country code is dropped', () => {
        assert.equal(localPhone('918517813281'), '8517813281');
        assert.equal(localPhone('+91 85178 13281'), '8517813281');
        assert.equal(localPhone('08517813281'), '8517813281');
        assert.equal(localPhone('8517813281'), '8517813281');
    });
    test('a number from elsewhere is left whole', () => {
        assert.equal(localPhone('14155552671'), '14155552671');
        assert.equal(localPhone(''), '');
    });
});
