import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFeedback, feedbackProblem, validateAnswers, reminderDue, summarize, monthOf, formState, inAudience, DEFAULT_FEEDBACK } from '../feedbackForm.js';

const form = readFeedback({
    enabled: true,
    questions: [
        { id: 'new_1', label: 'Rate our product quality', type: 'rating', required: true },
        { id: 'new_2', label: 'Was stock on time?', type: 'yesno', required: true },
        { id: 'new_3', label: 'Support was', type: 'single', options: ['Good', 'Average', 'Poor'] },
        { id: 'new_4', label: 'What should we improve?', type: 'textarea' },
        { id: 'new_5', label: 'How likely to recommend us?', type: 'nps' },
        { id: 'new_6', label: 'Shop photo', type: 'photo', max_files: 2 },
        { id: 'old', label: 'Old question', type: 'text', required: true, active: false },
    ],
});
const ok = (r: ReturnType<typeof validateAnswers>) => { if ('error' in r) throw new Error(r.error); return r.answers; };

test('nothing saved: the form is off with no questions', () => {
    assert.deepEqual(readFeedback(null), DEFAULT_FEEDBACK);
    assert.equal(feedbackProblem(readFeedback(null)), null);
});

test('questions get ids from their label, types are checked', () => {
    assert.deepEqual(form.questions.map(q => q.id), ['rate_our_product_quality', 'was_stock_on_time', 'support_was', 'what_should_we_improve', 'how_likely_to_recommend_us', 'shop_photo', 'old']);
    assert.equal(readFeedback({ questions: [{ label: 'x', type: 'weird' }] }).questions[0].type, 'text');
});

test('problems are named', () => {
    assert.match(feedbackProblem(readFeedback({ enabled: true, questions: [] }))!, /at least one question/);
    assert.match(feedbackProblem(readFeedback({ questions: [{ label: 'Pick', type: 'single', options: ['A'] }] }))!, /two choices/);
    assert.match(feedbackProblem(readFeedback({ reminder: { from_day: 20, to_day: 5 } }))!, /starts after it ends/);
});

test('answers: required, ranges, choices; hidden questions are not asked', () => {
    const a = ok(validateAnswers({ rate_our_product_quality: 4, was_stock_on_time: 'yes', support_was: 'Good', how_likely_to_recommend_us: '9' }, form, { shop_photo: 1 }));
    assert.equal(a.length, 6, 'the hidden question is not in the answers');
    assert.deepEqual(a.map(x => x.value), [4, true, 'Good', null, 9, 1]);
    assert.match((validateAnswers({ was_stock_on_time: 'no' }, form) as any).error, /Rate our product quality.*required/);
    assert.match((validateAnswers({ rate_our_product_quality: 6, was_stock_on_time: 'no' }, form) as any).error, /1 to 5/);
    assert.match((validateAnswers({ rate_our_product_quality: 3, was_stock_on_time: 'maybe' }, form) as any).error, /yes or no/);
    assert.match((validateAnswers({ rate_our_product_quality: 3, was_stock_on_time: true, support_was: 'Great' }, form) as any).error, /choose from the list/);
    assert.match((validateAnswers({ rate_our_product_quality: 3, was_stock_on_time: true }, form, { shop_photo: 3 }) as any).error, /up to 2 photos/);
});

test('the reminder: on, within its days, only while not filled', () => {
    const f = readFeedback({ ...form, reminder: { enabled: true, from_day: 5, to_day: 20 } });
    const on = (d: string) => new Date(`${d}T06:00:00Z`);
    assert.equal(reminderDue(f, false, on('2026-10-10')), true);
    assert.equal(reminderDue(f, false, on('2026-10-04')), false, 'before its first day');
    assert.equal(reminderDue(f, false, on('2026-10-21')), false, 'after its last day');
    assert.equal(reminderDue(f, true, on('2026-10-10')), false, 'already filled');
    assert.equal(reminderDue({ ...f, enabled: false }, false, on('2026-10-10')), false, 'form off');
    assert.equal(reminderDue({ ...f, reminder: { ...f.reminder, enabled: false } }, false, on('2026-10-10')), false, 'reminder off');
    assert.equal(monthOf(new Date('2026-10-31T19:00:00Z')), '2026-11', 'the month is IST');
});

test('dates: open from the first to the last, by itself; repeating keeps the days each month', () => {
    const at = (d: string) => new Date(`${d}T06:00:00Z`);
    const once = readFeedback({ ...form, schedule: { auto: true, start: '2026-10-25', end: '2026-11-05', repeat: false } });
    assert.deepEqual(formState(once, at('2026-10-24')), { open: false, why: 'not_yet', opens_on: '2026-10-25' });
    assert.deepEqual(formState(once, at('2026-11-02')), { open: true, closes_on: '2026-11-05' });
    assert.deepEqual(formState(once, at('2026-11-06')), { open: false, why: 'ended' });
    const rep = readFeedback({ ...form, schedule: { auto: true, start: '2026-10-05', end: '2026-10-31', repeat: true } });
    assert.deepEqual(formState(rep, at('2026-10-04')), { open: false, why: 'not_yet', opens_on: '2026-10-05' });
    assert.deepEqual(formState(rep, at('2027-02-27')), { open: true, closes_on: '2027-02-28' }, 'day 31 is the month\'s last day');
    const g = readFeedback({ ...form, schedule: { auto: true, start: '2026-10-01', end: '2026-10-10' } });
    assert.deepEqual(formState(g, at('2026-12-11')), { open: false, why: 'closed', opens_on: '2027-01-01' });
    assert.equal(reminderDue({ ...g, reminder: { ...g.reminder, enabled: true, from_day: 1, to_day: 31 } }, false, at('2026-10-15')), false, 'no reminder once closed');
    assert.deepEqual(formState({ ...g, enabled: false }, at('2026-10-05')), { open: false, why: 'off' });
    assert.deepEqual(formState(readFeedback(form), at('2026-10-25')), { open: true, closes_on: null }, 'no dates: open all month');
    assert.match(feedbackProblem(readFeedback({ ...form, schedule: { auto: true, start: '2026-10-20', end: '2026-10-05' } }))!, /opens after it closes/);
    assert.match(feedbackProblem(readFeedback({ ...form, schedule: { auto: true, start: '2026-10-25', end: '2026-11-05', repeat: true } }))!, /same month/);
    assert.match(feedbackProblem(readFeedback({ ...form, schedule: { auto: true } }))!, /first and last date/);
});

test('audience: all, by brand and state, or picked stores', () => {
    const at = new Date('2026-10-10T06:00:00Z');
    const af = { id: 's1', state: 'Punjab', allowed_brands: 'AF' }, both = { id: 's2', state: 'Delhi', allowed_brands: 'AFAC' }, none = { id: 's3', state: 'Goa', allowed_brands: null };
    const by = (audience: any) => readFeedback({ ...form, audience });
    assert.equal(formState(by({ mode: 'all' }), at, none).open, true);
    const ac = by({ mode: 'filter', brands: ['AC'] });
    assert.deepEqual([inAudience(ac.audience, af), inAudience(ac.audience, both), inAudience(ac.audience, none)], [false, true, false], 'no brand set means AF');
    const pb = by({ mode: 'filter', states: ['punjab'], brands: ['AF'] });
    assert.deepEqual([inAudience(pb.audience, af), inAudience(pb.audience, both)], [true, false]);
    assert.deepEqual(formState(by({ mode: 'stores', store_ids: ['s2'] }), at, af), { open: false, why: 'not_for_you' });
    assert.equal(reminderDue(by({ mode: 'stores', store_ids: ['s2'] }), false, at, af), false);
    assert.match(feedbackProblem(by({ mode: 'stores', store_ids: [] }))!, /at least one store/);
    assert.match(feedbackProblem(by({ mode: 'filter' }))!, /brand or a state/);
});

test('scale questions: their own range and end words; average and counts', () => {
    const f = readFeedback({ enabled: true, questions: [{ label: 'Product (SAM / EV)', type: 'scale', required: true, scale_min: 1, scale_max: 10 }] });
    const q = f.questions[0];
    assert.deepEqual([q.scale_min, q.scale_max, q.low_label, q.high_label], [1, 10, 'Poor', 'Excellent']);
    assert.match((validateAnswers({ product_sam_ev: 0 }, f) as any).error, /pick 1 to 10/);
    assert.match((validateAnswers({ product_sam_ev: 11 }, f) as any).error, /pick 1 to 10/);
    const r = (n: number, s: string) => ({ store_name: s, answers: ok(validateAnswers({ product_sam_ev: n }, f)) });
    const [sum] = summarize([r(8, 'A'), r(10, 'B'), r(6, 'C')], f.questions);
    assert.equal(sum.average, 8);
    assert.equal(Object.keys(sum.counts!).length, 10);
    assert.equal(sum.counts!['10'], 1);
    assert.equal(readFeedback({ questions: [{ label: 'x', type: 'scale', scale_min: 5, scale_max: 2 }] }).questions[0].scale_max, 10, 'a bad range falls back to 10');
});

test('summary: averages, yes/no, choices, NPS and comments', () => {
    const mk = (store: string, rate: number, stock: boolean, sup: string, nps: number, txt: string) => ({
        store_name: store,
        answers: ok(validateAnswers({ rate_our_product_quality: rate, was_stock_on_time: stock, support_was: sup, how_likely_to_recommend_us: nps, what_should_we_improve: txt }, form)),
    });
    const s = summarize([mk('A', 5, true, 'Good', 10, 'Faster delivery'), mk('B', 3, false, 'Poor', 4, ''), mk('C', 4, true, 'Good', 9, 'More stock')], form.questions);
    const by = (id: string) => s.find(x => x.qid === id)!;
    assert.equal(by('rate_our_product_quality').average, 4);
    assert.deepEqual(by('rate_our_product_quality').counts, { 1: 0, 2: 0, 3: 1, 4: 1, 5: 1 });
    assert.deepEqual(by('was_stock_on_time').counts, { yes: 2, no: 1 });
    assert.deepEqual(by('support_was').counts, { Good: 2, Average: 0, Poor: 1 });
    assert.equal(by('how_likely_to_recommend_us').nps, 33);
    assert.deepEqual(by('what_should_we_improve').texts, [{ store: 'A', text: 'Faster delivery' }, { store: 'C', text: 'More stock' }]);
});
