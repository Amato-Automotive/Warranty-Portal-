/**
 * Review & Feedback: a monthly form each franchise fills once, any day of
 * the month, final once sent. The admin keeps the questions, the form's
 * wording and the reminder (a pop-up for stores that have not filled it,
 * between two days of the month, every login or once a day).
 *
 * An answer keeps a copy of its question (label, type), so a month's
 * answers still read the same after the admin edits or removes a question.
 *
 * Free of any database import, so it is tested directly.
 */

export type QuestionType = 'rating' | 'scale' | 'yesno' | 'single' | 'multi' | 'text' | 'textarea' | 'number' | 'nps' | 'photo';
export const QUESTION_TYPES: QuestionType[] = ['rating', 'scale', 'yesno', 'single', 'multi', 'text', 'textarea', 'number', 'nps', 'photo'];

export interface FeedbackQuestion {
    id: string;
    label: string;
    help?: string;
    type: QuestionType;
    required: boolean;
    /** single, multi: the choices. */
    options?: string[];
    /** photo: how many. */
    max_files?: number;
    /** scale: from and to (e.g. 1–10), and the words at each end (Poor … Excellent). */
    scale_min?: number;
    scale_max?: number;
    low_label?: string;
    high_label?: string;
    active: boolean;
}

export interface FeedbackReminder {
    enabled: boolean;
    /** Shown from this day of the month to that one, both included (1–31). */
    from_day: number;
    to_day: number;
    /** 'login': each time the store signs in; 'day': once a day. */
    every: 'login' | 'day';
    title: string;
    message: string;
    button: string;
}

/**
 * When the form is open. auto off: the whole month while live. auto on:
 * from `start` to `end` (IST dates, both included), by itself; with
 * `repeat` the same days every month from then on (a day past a month's
 * end means its last day).
 */
export interface FeedbackSchedule {
    auto: boolean;
    start: string | null;
    end: string | null;
    repeat: boolean;
}

/**
 * Which franchises the form is for: all, those with a brand and/or in a
 * state (an empty list matches any), or the stores picked by hand.
 */
export interface FeedbackAudience {
    mode: 'all' | 'filter' | 'stores';
    brands: ('AF' | 'AC')[];
    states: string[];
    store_ids: string[];
}

/** A store, as the audience needs it. allowed_brands: 'AF', 'AC', 'AFAC'. */
export interface AudienceStore { id: string; state?: string | null; allowed_brands?: string | null }

export function inAudience(a: FeedbackAudience, s: AudienceStore): boolean {
    if (a.mode === 'stores') return a.store_ids.includes(s.id);
    if (a.mode === 'filter') {
        const brands = (s.allowed_brands || 'AF').toUpperCase();
        if (a.brands.length && !a.brands.some(b => brands.includes(b))) return false;
        if (a.states.length && !a.states.some(x => x.toLowerCase() === String(s.state ?? '').trim().toLowerCase())) return false;
    }
    return true;
}

export interface FeedbackSettings {
    /** Off (not live): the tab says it is closed and nobody is reminded. */
    enabled: boolean;
    schedule: FeedbackSchedule;
    audience: FeedbackAudience;
    title: string;
    intro: string;
    questions: FeedbackQuestion[];
    reminder: FeedbackReminder;
}

export const DEFAULT_FEEDBACK: FeedbackSettings = {
    enabled: false,
    schedule: { auto: false, start: null, end: null, repeat: true },
    audience: { mode: 'all', brands: [], states: [], store_ids: [] },
    title: 'Monthly review & feedback',
    intro: 'Tell us how this month went. It takes a few minutes and helps us support your store better.',
    questions: [],
    reminder: {
        enabled: true, from_day: 1, to_day: 31, every: 'day',
        title: 'Your monthly feedback is due',
        message: 'Please fill this month\'s review & feedback. It takes only a few minutes.',
        button: 'Fill it now',
    },
};

const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
const day = (v: unknown, d: number) => { const n = Math.floor(Number(v)); return n >= 1 && n <= 31 ? n : d; };
const date = (v: unknown) => { const s = String(v ?? ''); return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(`${s}T00:00:00Z`)) ? s : null; };
const strs = (v: unknown, max: number) => [...new Set((Array.isArray(v) ? v : []).map(x => str(x, 80)).filter(Boolean))].slice(0, max);

/** A stored form, cleaned: unknown types become text, ids are unique and stay as they were. */
export function readFeedback(stored: unknown): FeedbackSettings {
    const s = (stored && typeof stored === 'object' ? stored : {}) as Partial<FeedbackSettings>;
    const seen = new Set<string>();
    const questions = (Array.isArray(s.questions) ? s.questions : []).map((q: any, i): FeedbackQuestion => {
        const raw = str(q?.id, 40);
        let id = (/^new_\d+$/.test(raw) || !raw ? slug(str(q?.label, 80)) : slug(raw)) || `q_${i + 1}`;
        while (seen.has(id)) id = `${id.slice(0, 37)}_2`;
        seen.add(id);
        const type = (QUESTION_TYPES as string[]).includes(q?.type) ? q.type as QuestionType : 'text';
        return {
            id, label: str(q?.label, 300) || `Question ${i + 1}`, type,
            required: !!q?.required, active: q?.active !== false,
            ...(str(q?.help, 300) ? { help: str(q.help, 300) } : {}),
            ...(type === 'single' || type === 'multi' ? { options: (Array.isArray(q?.options) ? q.options : []).map((o: unknown) => str(o, 120)).filter(Boolean) } : {}),
            ...(type === 'photo' ? { max_files: Math.min(5, Math.max(1, Math.floor(Number(q?.max_files)) || 1)) } : {}),
            ...(type === 'scale' ? (() => {
                const lo = Math.floor(Number(q?.scale_min));
                const min = lo === 0 || lo === 1 ? lo : 1;
                const hi = Math.floor(Number(q?.scale_max));
                const max = hi >= 3 && hi <= 10 && hi > min ? hi : 10;
                return { scale_min: min, scale_max: max, low_label: str(q?.low_label, 40) || 'Poor', high_label: str(q?.high_label, 40) || 'Excellent' };
            })() : {}),
        };
    });
    const r = (s.reminder ?? {}) as Partial<FeedbackReminder>;
    const sc = (s.schedule ?? {}) as Partial<FeedbackSchedule>;
    const au = (s.audience ?? {}) as Partial<FeedbackAudience>;
    return {
        enabled: !!s.enabled,
        schedule: { auto: sc.auto === true, start: date(sc.start), end: date(sc.end), repeat: sc.repeat !== false },
        audience: {
            mode: au.mode === 'filter' || au.mode === 'stores' ? au.mode : 'all',
            brands: strs(au.brands, 2).filter((b): b is 'AF' | 'AC' => b === 'AF' || b === 'AC'),
            states: strs(au.states, 60),
            store_ids: strs(au.store_ids, 2000),
        },
        title: str(s.title, 120) || DEFAULT_FEEDBACK.title,
        intro: s.intro === undefined ? DEFAULT_FEEDBACK.intro : str(s.intro, 1000),
        questions,
        reminder: {
            enabled: r.enabled !== false,
            from_day: day(r.from_day, 1), to_day: day(r.to_day, 31),
            every: r.every === 'login' ? 'login' : 'day',
            title: str(r.title, 120) || DEFAULT_FEEDBACK.reminder.title,
            message: str(r.message, 500) || DEFAULT_FEEDBACK.reminder.message,
            button: str(r.button, 40) || DEFAULT_FEEDBACK.reminder.button,
        },
    };
}

/** What would stop the form from working, in words; null when it is fine. */
export function feedbackProblem(f: FeedbackSettings): string | null {
    if (f.enabled && !f.questions.some(q => q.active)) return 'Add at least one question before turning the form on';
    for (const q of f.questions) {
        if ((q.type === 'single' || q.type === 'multi') && (q.options?.length ?? 0) < 2) return `"${q.label}": give at least two choices`;
    }
    if (f.reminder.from_day > f.reminder.to_day) return 'The reminder starts after it ends: check its days';
    const sc = f.schedule;
    if (sc.auto) {
        if (!sc.start || !sc.end) return 'Pick the first and last date the form is open';
        if (sc.start > sc.end) return 'The form opens after it closes: check its dates';
        if (sc.repeat && sc.start.slice(0, 7) !== sc.end.slice(0, 7)) return 'To repeat every month, pick both dates in the same month';
    }
    if (f.audience.mode === 'filter' && !f.audience.brands.length && !f.audience.states.length) return 'Pick a brand or a state, or choose All franchises';
    if (f.audience.mode === 'stores' && !f.audience.store_ids.length) return 'Pick at least one store, or choose All franchises';
    return null;
}

/** The month a date falls in, in IST: "2026-10". */
export const monthOf = (d: Date = new Date()) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 7);
/** The day of the month in IST (1–31). */
export const dayOf = (d: Date = new Date()) => Number(new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(8, 10));

/** Today in IST: "2026-10-21". */
export const dateOf = (d: Date = new Date()) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
/** That day of a month ("2026-02"), or the month's last day when it is shorter. */
const dayIn = (month: string, dd: number) => {
    const [y, m] = month.split('-').map(Number);
    return `${month}-${String(Math.min(dd, new Date(Date.UTC(y, m, 0)).getUTCDate())).padStart(2, '0')}`;
};
const nextMonth = (month: string) => { const [y, m] = month.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };

/**
 * Whether stores can fill the form today, and why not; the dates are IST
 * "YYYY-MM-DD". closes_on null: open to the month's end. why 'ended': the
 * dates are over and do not repeat. 'not_for_you': the store isn't in the
 * audience (only when a store is given).
 */
export interface FormState {
    open: boolean;
    why?: 'off' | 'no_questions' | 'not_yet' | 'closed' | 'ended' | 'not_for_you';
    opens_on?: string;
    closes_on?: string | null;
}

export function formState(f: FeedbackSettings, now: Date = new Date(), store?: AudienceStore): FormState {
    if (!f.enabled) return { open: false, why: 'off' };
    if (!f.questions.some(q => q.active)) return { open: false, why: 'no_questions' };
    if (store && !inAudience(f.audience, store)) return { open: false, why: 'not_for_you' };
    const sc = f.schedule;
    if (!sc.auto || !sc.start || !sc.end) return { open: true, closes_on: null };
    const today = dateOf(now);
    if (today < sc.start) return { open: false, why: 'not_yet', opens_on: sc.start };
    if (!sc.repeat) return today > sc.end ? { open: false, why: 'ended' } : { open: true, closes_on: sc.end };
    const month = today.slice(0, 7);
    const from = dayIn(month, Number(sc.start.slice(8))), to = dayIn(month, Number(sc.end.slice(8)));
    if (today < from) return { open: false, why: 'not_yet', opens_on: from };
    if (today > to) return { open: false, why: 'closed', opens_on: dayIn(nextMonth(month), Number(sc.start.slice(8))) };
    return { open: true, closes_on: to };
}

/** Whether a store that has not filled this month's form should see the reminder today. */
export function reminderDue(f: FeedbackSettings, submitted: boolean, now: Date = new Date(), store?: AudienceStore): boolean {
    if (!formState(f, now, store).open || !f.reminder.enabled || submitted) return false;
    if (!f.questions.some(q => q.active)) return false;
    const d = dayOf(now);
    return d >= f.reminder.from_day && d <= f.reminder.to_day;
}

/** One answer, as stored: the question as it was asked, and what the store said. */
export interface FeedbackAnswer {
    qid: string;
    label: string;
    type: QuestionType;
    value: string | number | boolean | string[] | null;
    files?: string[];
}

const whole = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };

/**
 * Checks what a store sent against the active questions and returns the
 * answers to store, or the first problem in words. `fileCounts` is how many
 * photos came for each question; the caller adds the files.
 */
export function validateAnswers(raw: unknown, f: FeedbackSettings, fileCounts: Record<string, number> = {}): { answers: FeedbackAnswer[] } | { error: string } {
    const given = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const answers: FeedbackAnswer[] = [];
    for (const q of f.questions.filter(x => x.active)) {
        const v = given[q.id];
        const empty = v == null || v === '' || (Array.isArray(v) && !v.length);
        const need = (msg: string) => ({ error: `"${q.label}": ${msg}` });
        if (q.type === 'photo') {
            const n = fileCounts[q.id] ?? 0;
            if (q.required && !n) return need('add a photo');
            if (n > (q.max_files ?? 1)) return need(`up to ${q.max_files ?? 1} photo${(q.max_files ?? 1) === 1 ? '' : 's'}`);
            answers.push({ qid: q.id, label: q.label, type: q.type, value: n || null });
            continue;
        }
        if (empty) {
            if (q.required) return need('this is required');
            answers.push({ qid: q.id, label: q.label, type: q.type, value: null });
            continue;
        }
        let value: FeedbackAnswer['value'];
        switch (q.type) {
            case 'rating': { const n = whole(v); if (!(Number.isInteger(n) && n >= 1 && n <= 5)) return need('pick 1 to 5 stars'); value = n; break; }
            case 'scale': {
                const lo = q.scale_min ?? 1, hi = q.scale_max ?? 10;
                const n = whole(v); if (!(Number.isInteger(n) && n >= lo && n <= hi)) return need(`pick ${lo} to ${hi}`); value = n; break;
            }
            case 'nps': { const n = whole(v); if (!(Number.isInteger(n) && n >= 0 && n <= 10)) return need('pick 0 to 10'); value = n; break; }
            case 'number': { const n = whole(v); if (!Number.isFinite(n) || Math.abs(n) > 1e9) return need('enter a number'); value = n; break; }
            case 'yesno': {
                const b = v === true || v === 'yes' || v === 'true' ? true : v === false || v === 'no' || v === 'false' ? false : null;
                if (b === null) return need('answer yes or no');
                value = b; break;
            }
            case 'single': { const s = str(v, 120); if (!q.options?.includes(s)) return need('choose from the list'); value = s; break; }
            case 'multi': {
                const picked = [...new Set((Array.isArray(v) ? v : [v]).map(x => str(x, 120)))];
                if (!picked.every(p => q.options?.includes(p))) return need('choose from the list');
                value = picked; break;
            }
            case 'text': value = str(v, 300); break;
            default: value = str(v, 3000);
        }
        answers.push({ qid: q.id, label: q.label, type: q.type, value });
    }
    return { answers };
}

/** The numbers behind one question's summary, over the month's answers. */
export interface QuestionSummary {
    qid: string;
    label: string;
    type: QuestionType;
    answered: number;
    /** rating, nps, number: the average. */
    average?: number;
    /** rating 1–5, nps 0–10, yes/no, choices: how many said each. */
    counts?: Record<string, number>;
    /** nps: % promoters (9–10) − % detractors (0–6). */
    nps?: number;
    /** text: the latest answers with their store. */
    texts?: { store: string; text: string }[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function summarize(
    responses: { store_name: string; answers: FeedbackAnswer[] }[],
    questions: Pick<FeedbackQuestion, 'id' | 'label' | 'type' | 'options' | 'scale_min' | 'scale_max'>[],
): QuestionSummary[] {
    return questions.map(q => {
        const vals = responses.flatMap(r => r.answers.filter(a => a.qid === q.id && a.value !== null && a.value !== '').map(a => ({ store: r.store_name, a })));
        const out: QuestionSummary = { qid: q.id, label: q.label, type: q.type, answered: vals.length };
        const nums = vals.map(v => Number(v.a.value)).filter(n => Number.isFinite(n));
        if ((q.type === 'rating' || q.type === 'scale' || q.type === 'nps' || q.type === 'number') && nums.length) out.average = round1(nums.reduce((a, b) => a + b, 0) / nums.length);
        if (q.type === 'rating' || q.type === 'nps' || q.type === 'scale') {
            const lo = q.scale_min ?? 1, hi = q.scale_max ?? 10;
            const keys = q.type === 'rating' ? [1, 2, 3, 4, 5] : q.type === 'scale' ? Array.from({ length: hi - lo + 1 }, (_, k) => lo + k) : [...Array(11).keys()];
            out.counts = Object.fromEntries(keys.map(k => [String(k), nums.filter(n => n === k).length]));
            if (q.type === 'nps' && nums.length) out.nps = Math.round((nums.filter(n => n >= 9).length - nums.filter(n => n <= 6).length) / nums.length * 100);
        }
        if (q.type === 'yesno') out.counts = { yes: vals.filter(v => v.a.value === true).length, no: vals.filter(v => v.a.value === false).length };
        if (q.type === 'single' || q.type === 'multi') {
            const c: Record<string, number> = Object.fromEntries((q.options ?? []).map(o => [o, 0]));
            for (const v of vals) for (const p of ([] as string[]).concat(v.a.value as string | string[])) c[p] = (c[p] ?? 0) + 1;
            out.counts = c;
        }
        if (q.type === 'text' || q.type === 'textarea') out.texts = vals.map(v => ({ store: v.store, text: String(v.a.value) }));
        return out;
    });
}
