/** Review & Feedback, as the server's feedbackForm defines it. */

export type QuestionType = "rating" | "scale" | "yesno" | "single" | "multi" | "text" | "textarea" | "number" | "nps" | "photo";

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
    rating: "Star rating (1–5)", scale: "Scale (e.g. 1–10, Poor → Excellent)", yesno: "Yes / No", single: "One choice", multi: "Several choices",
    text: "Short answer", textarea: "Long answer", number: "Number", nps: "Score 0–10", photo: "Photo",
};

export interface FeedbackQuestion {
    id: string; label: string; help?: string; type: QuestionType; required: boolean;
    options?: string[]; max_files?: number; active: boolean;
    scale_min?: number; scale_max?: number; low_label?: string; high_label?: string;
}

export interface FeedbackReminder {
    enabled: boolean; from_day: number; to_day: number; every: "login" | "day";
    title: string; message: string; button: string;
}

/**
 * auto: open from `start` to `end` (IST dates), by itself; with `repeat`
 * the same days every month from then on.
 */
export interface FeedbackSchedule { auto: boolean; start: string | null; end: string | null; repeat: boolean }

/** Which franchises the form is for (server: inAudience). */
export interface FeedbackAudience { mode: "all" | "filter" | "stores"; brands: ("AF" | "AC")[]; states: string[]; store_ids: string[] }
export interface AudienceStore { id: string; store_name: string; store_code?: string | null; city?: string | null; state?: string | null; allowed_brands?: string | null }

export function inAudience(a: FeedbackAudience, s: AudienceStore): boolean {
    if (a.mode === "stores") return a.store_ids.includes(s.id);
    if (a.mode === "filter") {
        const brands = (s.allowed_brands || "AF").toUpperCase();
        if (a.brands.length && !a.brands.some(b => brands.includes(b))) return false;
        if (a.states.length && !a.states.some(x => x.toLowerCase() === String(s.state ?? "").trim().toLowerCase())) return false;
    }
    return true;
}

export interface FeedbackSettings {
    enabled: boolean; schedule: FeedbackSchedule; audience: FeedbackAudience;
    title: string; intro: string; questions: FeedbackQuestion[]; reminder: FeedbackReminder;
}

/** Whether stores can fill it today; dates are "YYYY-MM-DD" (the server's formState decides; this mirrors it). */
export interface FormState {
    open: boolean;
    why?: "off" | "no_questions" | "not_yet" | "closed" | "ended" | "not_for_you";
    opens_on?: string;
    closes_on?: string | null;
}

const todayIST = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const dayIn = (month: string, dd: number) => {
    const [y, m] = month.split("-").map(Number);
    return `${month}-${String(Math.min(dd, new Date(Date.UTC(y, m, 0)).getUTCDate())).padStart(2, "0")}`;
};
const nextMonth = (month: string) => { const [y, m] = month.split("-").map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; };

export function formState(f: FeedbackSettings, today: string = todayIST()): FormState {
    if (!f.enabled) return { open: false, why: "off" };
    if (!f.questions.some(q => q.active)) return { open: false, why: "no_questions" };
    const sc = f.schedule;
    if (!sc?.auto || !sc.start || !sc.end) return { open: true, closes_on: null };
    if (today < sc.start) return { open: false, why: "not_yet", opens_on: sc.start };
    if (!sc.repeat) return today > sc.end ? { open: false, why: "ended" } : { open: true, closes_on: sc.end };
    const month = today.slice(0, 7);
    const from = dayIn(month, Number(sc.start.slice(8))), to = dayIn(month, Number(sc.end.slice(8)));
    if (today < from) return { open: false, why: "not_yet", opens_on: from };
    if (today > to) return { open: false, why: "closed", opens_on: dayIn(nextMonth(month), Number(sc.start.slice(8))) };
    return { open: true, closes_on: to };
}

/** "2026-11-05" → "5 Nov 2026". */
export const dateText = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** The schedule in words. */
export function scheduleText(sc: FeedbackSchedule): string {
    if (!sc.auto || !sc.start || !sc.end) return "Open the whole month";
    if (!sc.repeat) return `Open ${dateText(sc.start)} – ${dateText(sc.end)}, once`;
    return `Every month, the ${ordinal(Number(sc.start.slice(8)))} to the ${ordinal(Number(sc.end.slice(8)))} (from ${dateText(sc.start)})`;
}

/** 1 → "1st", 22 → "22nd". */
export const ordinal = (n: number) => {
    const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
    return `${n}${s}`;
};

export interface FeedbackAnswer {
    qid: string; label: string; type: QuestionType;
    value: string | number | boolean | string[] | null; files?: string[];
}

/** "2026-10" → "October 2026". */
export const monthName = (m: string) => {
    const [y, mo] = m.split("-").map(Number);
    return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
};

/** An answer in words. */
export function answerText(a: FeedbackAnswer): string {
    if (a.value === null || a.value === "") return "—";
    switch (a.type) {
        case "rating": return `${"★".repeat(Number(a.value))}${"☆".repeat(5 - Number(a.value))} (${a.value}/5)`;
        case "nps": return `${a.value} / 10`;
        case "scale": return `${a.value}`;
        case "yesno": return a.value ? "Yes" : "No";
        case "multi": return ([] as string[]).concat(a.value as string[]).join(", ");
        case "photo": return `${a.files?.length ?? a.value} photo${(a.files?.length ?? Number(a.value)) === 1 ? "" : "s"}`;
        default: return String(a.value);
    }
}
