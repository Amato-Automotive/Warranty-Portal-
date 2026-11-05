import {
    readFeedback, feedbackProblem, validateAnswers, inAudience,
    type FeedbackAudience, type FeedbackAnswer, type FeedbackQuestion, type AudienceStore,
} from './feedbackForm.js';

export type FranchiseFormStatus = 'draft' | 'live' | 'offline';
export interface FranchiseForm {
    id: string;
    title: string;
    intro: string;
    banner_url: string | null;
    audience: FeedbackAudience;
    questions: FeedbackQuestion[];
    status: FranchiseFormStatus;
    created_at?: string;
    updated_at?: string;
}

const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const audience = (raw: any): FeedbackAudience => {
    const base = readFeedback({ audience: raw }).audience;
    return base;
};

export function readFranchiseForm(raw: any, id = str(raw?.id, 64)): FranchiseForm {
    const parsed = readFeedback({
        enabled: raw?.status === 'live',
        title: raw?.title,
        intro: raw?.intro,
        questions: raw?.questions,
        audience: raw?.audience,
    });
    return {
        id,
        title: parsed.title,
        intro: parsed.intro,
        banner_url: str(raw?.banner_url, 500) || null,
        audience: audience(raw?.audience),
        questions: parsed.questions,
        status: raw?.status === 'live' ? 'live' : raw?.status === 'offline' ? 'offline' : 'draft',
        ...(raw?.created_at ? { created_at: raw.created_at } : {}),
        ...(raw?.updated_at ? { updated_at: raw.updated_at } : {}),
    };
}

export function franchiseFormProblem(form: FranchiseForm): string | null {
    const feedback = readFeedback({ enabled: form.status === 'live', title: form.title, intro: form.intro, questions: form.questions, audience: form.audience });
    return feedbackProblem(feedback);
}

export { validateAnswers, inAudience };
export type { FeedbackAudience, FeedbackAnswer, FeedbackQuestion, AudienceStore };
