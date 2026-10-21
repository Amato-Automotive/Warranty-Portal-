import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readCarAnswer } from '../carModels.js';
import { nextStep, menuStep, isRestart, isCancel, isIdle, startWord, MAX_TRIES, readVehicleAnswer, vehicleStep } from '../locatorConversation.js';
import { menuTapFromWebhook, productMenu, vehicleQuestion, vehicleTapFromWebhook, twoWheelerText, BUTTON_TITLE_MAX } from '../storeLocatorMessages.js';
import { CAR_RETRY, PINCODE_QUESTION, INVALID_PINCODE_TEXT, NO_PINCODE_END } from '../storeLocatorMessages.js';

describe('readCarAnswer — lenient, tidies known models', () => {
    // Real answers from our leads (Sept 2026), then the tricky ones.
    const cases: [string, string][] = [
        ['Creta', 'Hyundai Creta'], ['creat', 'Hyundai Creta'], ['Grand VITARA', 'Maruti Suzuki Grand Vitara'],
        ['Hyundai Grand i10 nios 2025', 'Hyundai Grand i10 Nios'], ['Hy cross', 'Toyota Innova Hycross'],
        ['Suzuki fronx', 'Maruti Suzuki Fronx'], ['I have a Vitara Brezza', 'Maruti Suzuki Brezza'],
        ['My car is a Honda City', 'Honda City'], ['City', 'Honda City'], ['Creta from Delhi', 'Hyundai Creta'],
        ['Mahindra XUV 700', 'Mahindra XUV700'], ['Swift Dzire', 'Maruti Suzuki Dzire'], ['BMW X1', 'BMW X1'],
    ];
    for (const [answer, car] of cases) {
        test(`"${answer}" → ${car}`, () => assert.deepEqual(readCarAnswer(answer), { ok: true, car, known: true }));
    }
    test('an unknown model is still accepted, as typed', () => {
        assert.deepEqual(readCarAnswer('Hyundai Xyzzy'), { ok: true, car: 'Hyundai Xyzzy', known: false });
    });
    test('not a car: numbers, greetings, places, sentences', () => {
        for (const a of ['6', '201301', 'ok', 'hi']) assert.equal((readCarAnswer(a) as any).why, 'junk', a);
        for (const a of ['West bengal', 'Delhi city', 'Noida']) assert.equal((readCarAnswer(a) as any).why, 'place', a);
        assert.equal((readCarAnswer('I want seat covers for my car please') as any).why, 'junk');
        assert.equal((readCarAnswer('') as any).why, 'empty');
    });
    test('a make alone asks which model', () => {
        assert.deepEqual(readCarAnswer('Toyota'), { ok: false, why: 'make-only', make: 'Toyota' });
        assert.deepEqual(readCarAnswer('Toyota car'), { ok: false, why: 'make-only', make: 'Toyota' });
    });
});

describe('nextStep — one chat step at a time', () => {
    const known = async () => true;
    const unknown = async () => false;

    test('a good car moves on to the pincode', async () => {
        assert.deepEqual(await nextStep({ stage: 'car', tries: 0 }, 'creat', known),
            { kind: 'car', car: 'Hyundai Creta', checked: true, reply: PINCODE_QUESTION });
    });
    test('a wrong car is asked again, saying what was wrong', async () => {
        assert.deepEqual(await nextStep({ stage: 'car', tries: 0 }, 'West bengal', known),
            { kind: 'retry', tries: 1, reply: CAR_RETRY.place });
        const which = await nextStep({ stage: 'car', tries: 0 }, 'Toyota', known) as any;
        assert.equal(which.kind, 'retry');
        assert.match(which.reply, /^Which Toyota\? .*Innova/);
    });
    test(`after ${MAX_TRIES} wrong cars the chat moves on, marked unchecked`, async () => {
        assert.deepEqual(await nextStep({ stage: 'car', tries: 1 }, '6', known),
            { kind: 'car', car: '6', checked: false, reply: PINCODE_QUESTION });
        assert.deepEqual(await nextStep({ stage: 'car', tries: 1 }, 'Toyota', known),
            { kind: 'car', car: 'Toyota', checked: false, reply: PINCODE_QUESTION });
    });
    test('a pincode inside a sentence is taken first time', async () => {
        assert.deepEqual(await nextStep({ stage: 'pincode', tries: 0 }, 'My pin code is : 201301', known),
            { kind: 'pincode', pincode: '201301', checked: true });
    });
    test('no pincode: asked again, then the chat ends politely', async () => {
        assert.deepEqual(await nextStep({ stage: 'pincode', tries: 0 }, 'Noida', known),
            { kind: 'retry', tries: 1, reply: INVALID_PINCODE_TEXT });
        assert.deepEqual(await nextStep({ stage: 'pincode', tries: 1 }, 'Noida', known),
            { kind: 'give-up', reply: NO_PINCODE_END });
    });
    test('a pincode we cannot place: one chance to fix, then it goes through', async () => {
        const first = await nextStep({ stage: 'pincode', tries: 0 }, '999999', unknown) as any;
        assert.equal(first.kind, 'retry');
        assert.match(first.reply, /999999/);
        assert.deepEqual(await nextStep({ stage: 'pincode', tries: 1 }, '999999', unknown),
            { kind: 'pincode', pincode: '999999', checked: false });
    });
});

describe('restart, cancel, idle', () => {
    test('only the start word restarts; a "hi" to another message does not', () => {
        for (const t of ['Heyy', 'hey', 'HEYYYY!']) assert.equal(isRestart(t), true, t);
        for (const t of ['hi', 'Hello', 'Hyundai', 'hey creta']) assert.equal(isRestart(t), false, t);
    });
    test('greetings start the chat, with repeats, punctuation, emoji and a "sir"', () => {
        for (const t of ['Heyy', 'HEYYY!']) assert.deepEqual(startWord(t), { kind: 'heyy' }, t);
        for (const t of ['hi', 'Hiii!!', 'hello 🙏', 'Helloo', 'hlo', 'Hello sir', 'hi ji', 'Namaste', 'नमस्ते', 'नमस्कार जी', 'namaste ji',
            'price?', 'Enquiry', 'store near me', 'car', 'Dealer', 'hey sir']) {
            assert.deepEqual(startWord(t), { kind: 'word', product: null }, t);
        }
    });
    test('naming a product starts the chat at the car question', () => {
        const cases: [string, string][] = [
            ['seat', 'Seat Covers'], ['Seat covers', 'Seat Covers'], ['car seat cover', 'Seat Covers'],
            ['mats', 'Mats'], ['Car Mats!', 'Mats'], ['floor mat', 'Mats'],
            ['accessories', 'Accessories'], ['Car accessories', 'Accessories'],
        ];
        for (const [t, product] of cases) assert.deepEqual(startWord(t), { kind: 'word', product }, t);
    });
    test('longer messages and auto-replies do not start the chat', () => {
        for (const t of ['Hello! 👋 Welcome to KP Trading Company. Thank you for connecting',
            '*Auto reply* Hey there! I am using WhatAuto app.', 'hi i want to know about warranty',
            'Hyundai', 'Creta', 'approve installation', 'ok', 'thanks', '', '👍']) {
            assert.equal(startWord(t), null, t);
        }
    });
    test('stop and cancel end the chat', () => {
        assert.equal(isCancel('Stop'), true);
        assert.equal(isCancel('cancel.'), true);
        assert.equal(isCancel('stop by tomorrow'), false);
    });
    test('quiet for 30 minutes is over', () => {
        const now = Date.parse('2026-09-29T12:00:00Z');
        assert.equal(isIdle('2026-09-29T11:45:00Z', now), false);
        assert.equal(isIdle('2026-09-29T11:15:00Z', now), true);
        assert.equal(isIdle(null, now), true);
    });
});

describe('menuStep — the product menu, sent by our server', () => {
    test('a tap on a product chooses it', () => {
        assert.deepEqual(menuStep('product', 0, { tap: 'seat' }), { kind: 'chosen', product: 'Seat Covers', choice: 'Seat Covers' });
        assert.deepEqual(menuStep('product', 0, { tap: 'mats' }), { kind: 'chosen', product: 'Mats', choice: 'Car Mats' });
    });
    test('Other Products opens its menu, and Back returns', () => {
        assert.deepEqual(menuStep('product', 0, { tap: 'other' }), { kind: 'menu', menu: 'other', tries: 0, retry: false });
        assert.deepEqual(menuStep('product-other', 0, { tap: 'back' }), { kind: 'menu', menu: 'main', tries: 0, retry: false });
    });
    test('the Other Products rows count as Accessories, keeping the exact row', () => {
        assert.deepEqual(menuStep('product-other', 0, { tap: 'care' }), { kind: 'chosen', product: 'Accessories', choice: 'Care & Fragrance' });
        assert.deepEqual(menuStep('product-other', 0, { tap: 'audio' }), { kind: 'chosen', product: 'Accessories', choice: 'Audio & Security' });
    });
    test('typing works too', () => {
        assert.equal((menuStep('product', 0, { text: 'seat cover' }) as any).product, 'Seat Covers');
        assert.equal((menuStep('product', 0, { text: 'I need a car perfume' }) as any).choice, 'Care & Fragrance');
        assert.equal((menuStep('product', 0, { text: 'other products' }) as any).menu, 'other');
        assert.equal((menuStep('product-other', 0, { text: 'back' }) as any).menu, 'main');
    });
    test('not on the menu: asked once more, then the chat moves on', () => {
        assert.deepEqual(menuStep('product', 0, { text: 'price?' }), { kind: 'menu', menu: 'main', tries: 1, retry: true });
        assert.deepEqual(menuStep('product', 1, { text: 'price?' }), { kind: 'chosen', product: null, choice: 'price?' });
    });
});

describe('menuTapFromWebhook — reading a menu tap', () => {
    const tap = (id: string) => ({ message: JSON.stringify({ type: 'list_reply', list_reply: { id, title: 'x' } }) });
    test('our menu rows', () => {
        assert.deepEqual(menuTapFromWebhook(tap('pm:abc-123:seat')), { leadId: 'abc-123', key: 'seat' });
        assert.deepEqual(menuTapFromWebhook(tap('pm:abc-123:back')), { leadId: 'abc-123', key: 'back' });
    });
    test('store-list taps and anything else are not menu taps', () => {
        assert.equal(menuTapFromWebhook(tap('sl:abc-123:s:9')), null);
        assert.equal(menuTapFromWebhook(tap('pm:abc-123:nope')), null);
        assert.equal(menuTapFromWebhook({ message: 'Creta' }), null);
    });
});

describe('list bodies keep their line breaks', () => {
    test('the menu greeting reads as paragraphs, not one run-on line', () => {
        const body = productMenu('L').message.body.text;
        assert.match(body, /Autoform India\.\n\n🚘/);
        assert.ok(!/ {2}/.test(body));
    });
});

describe('4-wheeler or 2-wheeler — the first question', () => {
    test('typed answers are read', () => {
        for (const t of ['2', 'two', '2 wheeler', '2-wheeler', 'Two Wheeler', 'bike', 'Scooty', 'scooter', 'motorcycle', 'activa', '2W', 'its a bike']) {
            assert.equal(readVehicleAnswer(t), '2w', t);
        }
        for (const t of ['4', 'four', '4 wheeler', '4-Wheeler', 'car', 'SUV', 'Car 🚗', '4w']) {
            assert.equal(readVehicleAnswer(t), '4w', t);
        }
    });
    test('anything else is not an answer', () => {
        for (const t of ['2 seat covers', 'Creta', 'hello', '', '201301']) assert.equal(readVehicleAnswer(t), null, t);
    });
    test('one retry, then it goes on as a 4-wheeler, marked unchecked', () => {
        assert.deepEqual(vehicleStep(0, { text: 'what?' }), { kind: 'retry', tries: 1 });
        assert.deepEqual(vehicleStep(1, { text: 'what?' }), { kind: 'chosen', vehicle: '4w', checked: false });
        assert.deepEqual(vehicleStep(0, { tap: '2w' }), { kind: 'chosen', vehicle: '2w', checked: true });
    });
    test('the buttons fit WhatsApp and carry the lead id', () => {
        const q = vehicleQuestion('abc-123');
        assert.equal(q.message.action.buttons.length, 2);
        for (const b of q.message.action.buttons) assert.ok(b.reply.title.length <= BUTTON_TITLE_MAX, b.reply.title);
        assert.deepEqual(q.message.action.buttons.map(b => b.reply.id), ['vt:abc-123:4w', 'vt:abc-123:2w']);
    });
    test('a button tap is read back; other taps are not vehicle taps', () => {
        const tap = (id: string) => ({ message: JSON.stringify({ type: 'button_reply', button_reply: { id, title: 'x' } }) });
        assert.deepEqual(vehicleTapFromWebhook(tap('vt:abc-123:2w')), { leadId: 'abc-123', vehicle: '2w' });
        assert.equal(vehicleTapFromWebhook(tap('pm:abc-123:seat')), null);
        assert.equal(vehicleTapFromWebhook(tap('vt:abc-123:3w')), null);
        assert.equal(menuTapFromWebhook(tap('vt:abc-123:4w')), null);
    });
    test('the 2-wheeler reply gives the executive number; the menu after it does not greet again', () => {
        assert.match(twoWheelerText('917217014601'), /\+91 72170 14601/);
        assert.match(twoWheelerText(''), /call you shortly/);
        assert.ok(!/Hello/.test(productMenu('L', false).message.body.text));
        assert.match(productMenu('L').message.body.text, /Hello/);
    });
});
