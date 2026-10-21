import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/database.js';
import { AuthRequest } from '../middleware/auth.js';
import { ActivityLogService } from '../services/activity-log.service.js';
import { NotificationService } from '../services/notification.service.js';
import {
    readFeedback, feedbackProblem, validateAnswers, reminderDue, summarize, monthOf, formState, inAudience,
    type FeedbackAnswer, type FeedbackSettings,
} from '../services/feedbackForm.js';

/** The form as the admin last saved it (off, with no questions, until then). */
async function loadForm(): Promise<FeedbackSettings> {
    const [rows]: any = await db.execute('SELECT settings FROM feedback_settings WHERE id = 1');
    const raw = rows[0]?.settings;
    return readFeedback(typeof raw === 'string' ? JSON.parse(raw) : raw);
}

const json = <T>(v: unknown, d: T): T => {
    if (v == null) return d;
    if (typeof v !== 'string') return v as T;
    try { return JSON.parse(v) as T; } catch { return d; }
};

async function storeOf(userId: string) {
    const [[s]]: any = await db.execute(
        'SELECT id, store_name, store_code, city, state, allowed_brands FROM vendor_details WHERE user_id = ? LIMIT 1', [userId]);
    return s ?? null;
}

/* A month as "2026-10", the default being this one (IST). */
const monthParam = (v: unknown) => (/^\d{4}-(0[1-9]|1[0-2])$/.test(String(v ?? '')) ? String(v) : monthOf());

class FeedbackController {
    /**
     * The store's form this month: the questions, its own answers once sent,
     * and whether to show the reminder now.
     * GET /api/feedback/current
     */
    current = async (req: AuthRequest, res: Response) => {
        try {
            const store = await storeOf(req.user!.id);
            if (!store) return res.status(403).json({ success: false, error: 'Only franchises fill the monthly feedback' });
            const form = await loadForm();
            const month = monthOf();
            const [[resp]]: any = await db.execute(
                'SELECT answers, submitted_at FROM feedback_responses WHERE store_id = ? AND month = ?', [store.id, month]);
            const submitted = !!resp;
            const state = formState(form, new Date(), store);
            return res.json({
                success: true,
                data: {
                    month, enabled: state.open, state, title: form.title, intro: form.intro,
                    questions: state.open ? form.questions.filter(q => q.active) : [],
                    response: resp ? { answers: json<FeedbackAnswer[]>(resp.answers, []), submitted_at: resp.submitted_at } : null,
                    reminder: reminderDue(form, submitted, new Date(), store)
                        ? { every: form.reminder.every, title: form.reminder.title, message: form.reminder.message, button: form.reminder.button }
                        : null,
                },
            });
        } catch (error) {
            console.error('Feedback current error:', error);
            return res.status(500).json({ success: false, error: 'Could not load the feedback form' });
        }
    }

    /**
     * Send this month's answers, once.
     * POST /api/feedback — multipart: `answers` (JSON by question id), photos as `q_<question id>`.
     */
    submit = async (req: AuthRequest, res: Response) => {
        try {
            const store = await storeOf(req.user!.id);
            if (!store) return res.status(403).json({ success: false, error: 'Only franchises fill the monthly feedback' });
            const form = await loadForm();
            if (!formState(form, new Date(), store).open) return res.status(409).json({ success: false, error: 'The feedback form is closed right now' });
            const month = monthOf();

            let raw: unknown;
            try { raw = JSON.parse(String(req.body?.answers ?? '{}')); } catch { return res.status(400).json({ success: false, error: 'The answers could not be read' }); }
            const files = (req.files as Express.Multer.File[]) ?? [];
            const fileCounts: Record<string, number> = {};
            for (const f of files) { const m = /^q_(.+)$/.exec(f.fieldname); if (m) fileCounts[m[1]] = (fileCounts[m[1]] ?? 0) + 1; }
            const checked = validateAnswers(raw, form, fileCounts);
            if ('error' in checked) return res.status(400).json({ success: false, error: checked.error });
            const answers = checked.answers.map(a => a.type === 'photo'
                ? { ...a, files: files.filter(f => f.fieldname === `q_${a.qid}`).map((f: any) => f.path || f.url) } : a);

            try {
                await db.execute(
                    `INSERT INTO feedback_responses (id, store_id, month, answers, submitted_by) VALUES (?, ?, ?, ?, ?)`,
                    [uuidv4(), store.id, month, JSON.stringify(answers), req.user!.id]);
            } catch (e: any) {
                if (e?.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, error: 'This month\'s feedback is already sent' });
                throw e;
            }
            await ActivityLogService.log({ adminId: req.user!.id, actionType: 'FEEDBACK_SUBMITTED', targetType: 'FEEDBACK', targetName: store.store_name, details: { month } });
            return res.status(201).json({ success: true, message: 'Thank you, your feedback is sent' });
        } catch (error) {
            console.error('Feedback submit error:', error);
            return res.status(500).json({ success: false, error: 'Could not send the feedback' });
        }
    }

    /** The store's earlier months. GET /api/feedback/mine */
    mine = async (req: AuthRequest, res: Response) => {
        try {
            const store = await storeOf(req.user!.id);
            if (!store) return res.status(403).json({ success: false, error: 'Only franchises fill the monthly feedback' });
            const [rows]: any = await db.execute(
                'SELECT month, answers, submitted_at FROM feedback_responses WHERE store_id = ? ORDER BY month DESC LIMIT 24', [store.id]);
            return res.json({ success: true, data: rows.map((r: any) => ({ month: r.month, submitted_at: r.submitted_at, answers: json(r.answers, []) })) });
        } catch (error) {
            console.error('Feedback mine error:', error);
            return res.status(500).json({ success: false, error: 'Could not load your feedback' });
        }
    }

    /** GET /api/feedback/admin/settings */
    getSettings = async (_req: AuthRequest, res: Response) => {
        try {
            return res.json({ success: true, data: await loadForm() });
        } catch (error) {
            console.error('Feedback settings error:', error);
            return res.status(500).json({ success: false, error: 'Could not load the feedback settings' });
        }
    }

    /** PUT /api/feedback/admin/settings */
    saveSettings = async (req: AuthRequest, res: Response) => {
        try {
            const form = readFeedback(req.body?.settings);
            // Live or not is changed only by publish, so saving edits never opens or closes the form.
            form.enabled = (await loadForm()).enabled;
            const problem = feedbackProblem(form);
            if (problem) return res.status(400).json({ success: false, error: problem });
            await db.execute(
                `INSERT INTO feedback_settings (id, settings, updated_by) VALUES (1, ?, ?)
                 ON DUPLICATE KEY UPDATE settings = VALUES(settings), updated_by = VALUES(updated_by)`,
                [JSON.stringify(form), req.user?.id ?? null]);
            await ActivityLogService.log({
                adminId: req.user!.id, adminName: (req.user as any)?.name, adminEmail: (req.user as any)?.email,
                actionType: 'FEEDBACK_SETTINGS_UPDATED', targetType: 'FEEDBACK', targetId: '1',
                details: { enabled: form.enabled, questions: form.questions.length, reminder: form.reminder },
                ipAddress: req.ip || req.socket?.remoteAddress,
            });
            return res.json({ success: true, data: form });
        } catch (error) {
            console.error('Feedback save settings error:', error);
            return res.status(500).json({ success: false, error: 'Could not save the feedback settings' });
        }
    }

    /**
     * Put the form live for stores, or take it offline. Going live can also
     * tell every active franchise that has not answered this month, in its
     * portal notifications (no WhatsApp or SMS).
     * POST /api/feedback/admin/publish — { live: boolean, notify?: boolean }
     */
    publish = async (req: AuthRequest, res: Response) => {
        try {
            const live = req.body?.live === true;
            const form = await loadForm();
            if (live && !form.questions.some(q => q.active)) {
                return res.status(400).json({ success: false, error: 'Tick at least one question to use before going live' });
            }
            const next = { ...form, enabled: live };
            await db.execute(
                `INSERT INTO feedback_settings (id, settings, updated_by) VALUES (1, ?, ?)
                 ON DUPLICATE KEY UPDATE settings = VALUES(settings), updated_by = VALUES(updated_by)`,
                [JSON.stringify(next), req.user?.id ?? null]);

            let notified = 0;
            if (live && req.body?.notify === true && formState(next).open) {
                const month = monthOf();
                const [rows]: any = await db.execute(
                    `SELECT vd.id, vd.user_id, vd.state, vd.allowed_brands FROM vendor_details vd
                       JOIN vendor_verification vv ON vv.user_id = vd.user_id AND vv.is_verified = 1 AND vv.is_active = 1
                      WHERE vd.is_franchise = 1
                        AND NOT EXISTS (SELECT 1 FROM feedback_responses r WHERE r.store_id = vd.id AND r.month = ?)`, [month]);
                const users = rows.filter((r: any) => inAudience(next.audience, r)).map((r: any) => r.user_id).filter(Boolean);
                if (users.length) {
                    const r: any = await NotificationService.broadcast({
                        title: form.reminder.title || 'Your monthly feedback is due',
                        message: form.reminder.message || 'Please fill this month’s review & feedback.',
                        type: 'system', targetUsers: users, metadata: { module: 'feedback', month },
                    });
                    notified = Number(r?.count ?? users.length) || 0;
                }
            }
            await ActivityLogService.log({
                adminId: req.user!.id, adminName: (req.user as any)?.name, adminEmail: (req.user as any)?.email,
                actionType: live ? 'FEEDBACK_LIVE' : 'FEEDBACK_OFFLINE', targetType: 'FEEDBACK', targetId: '1',
                details: { questions: form.questions.filter(q => q.active).length, notified },
                ipAddress: req.ip || req.socket?.remoteAddress,
            });
            return res.json({ success: true, data: { enabled: live, notified } });
        } catch (error) {
            console.error('Feedback publish error:', error);
            return res.status(500).json({ success: false, error: 'Could not change the form' });
        }
    }

    /**
     * Every active franchise, for picking who the form is for.
     * GET /api/feedback/admin/stores
     */
    stores = async (_req: AuthRequest, res: Response) => {
        try {
            const [rows]: any = await db.execute(
                `SELECT vd.id, vd.store_name, vd.store_code, vd.city, vd.state, COALESCE(vd.allowed_brands, 'AF') AS allowed_brands
                   FROM vendor_details vd
                   JOIN vendor_verification vv ON vv.user_id = vd.user_id AND vv.is_verified = 1 AND vv.is_active = 1
                  WHERE vd.is_franchise = 1 ORDER BY vd.store_name`);
            return res.json({ success: true, data: rows });
        } catch (error) {
            console.error('Feedback stores error:', error);
            return res.status(500).json({ success: false, error: 'Could not load the stores' });
        }
    }

    /**
     * A month's answers for the admin: every store's, a summary per question,
     * the franchises that have not answered, and six months of averages.
     * GET /api/feedback/admin/responses?month=2026-10
     */
    responses = async (req: AuthRequest, res: Response) => {
        try {
            const month = monthParam(req.query.month);
            const form = await loadForm();
            const [rows]: any = await db.execute(
                `SELECT r.id, r.store_id, r.month, r.answers, r.submitted_at,
                        vd.store_name, vd.store_code, vd.city, vd.state, p.name AS contact_name, p.phone_number AS contact_phone
                   FROM feedback_responses r
                   JOIN vendor_details vd ON vd.id = r.store_id
                   LEFT JOIN profiles p ON p.id = vd.user_id
                  WHERE r.month = ? ORDER BY r.submitted_at DESC`, [month]);
            const responses = rows.map((r: any) => ({ ...r, answers: json<FeedbackAnswer[]>(r.answers, []) }));

            /* Questions this month was answered with: today's, then any the
               answers name that have since been removed, as they were asked. */
            const qs: { id: string; label: string; type: any; options?: string[]; scale_min?: number; scale_max?: number }[] =
                form.questions.map(q => ({ id: q.id, label: q.label, type: q.type, options: q.options, scale_min: q.scale_min, scale_max: q.scale_max }));
            for (const r of responses) for (const a of r.answers) if (!qs.some(q => q.id === a.qid)) qs.push({ id: a.qid, label: a.label, type: a.type });

            const [allPending]: any = await db.execute(
                `SELECT vd.id, vd.store_name, vd.store_code, vd.city, vd.state, vd.allowed_brands, p.name AS contact_name, p.phone_number AS contact_phone
                   FROM vendor_details vd
                   JOIN vendor_verification vv ON vv.user_id = vd.user_id AND vv.is_verified = 1 AND vv.is_active = 1
                   LEFT JOIN profiles p ON p.id = vd.user_id
                  WHERE vd.is_franchise = 1
                    AND NOT EXISTS (SELECT 1 FROM feedback_responses r WHERE r.store_id = vd.id AND r.month = ?)
                  ORDER BY vd.store_name`, [month]);
            // Only the stores the form is for are waiting on it.
            const pending = allPending.filter((s: any) => inAudience(form.audience, s));

            // Six months of averages for the rating, 0–10 and yes/no questions.
            const [hist]: any = await db.execute(
                `SELECT month, answers FROM feedback_responses
                  WHERE month BETWEEN DATE_FORMAT(DATE_SUB(STR_TO_DATE(CONCAT(?, '-01'), '%Y-%m-%d'), INTERVAL 5 MONTH), '%Y-%m') AND ?`,
                [month, month]);
            const months = [...new Set(hist.map((h: any) => h.month as string))].sort();
            const trend = qs.filter(q => ['rating', 'scale', 'nps', 'yesno'].includes(q.type)).map(q => ({
                qid: q.id, label: q.label, type: q.type, max: q.type === 'scale' ? q.scale_max ?? 10 : undefined,
                points: months.map(m => {
                    const vals = hist.filter((h: any) => h.month === m).flatMap((h: any) => json<FeedbackAnswer[]>(h.answers, []).filter(a => a.qid === q.id && a.value !== null));
                    if (!vals.length) return { month: m, value: null as number | null, answered: 0 };
                    const v = q.type === 'yesno'
                        ? Math.round(vals.filter((a: FeedbackAnswer) => a.value === true).length / vals.length * 100)
                        : Math.round(vals.reduce((n: number, a: FeedbackAnswer) => n + Number(a.value), 0) / vals.length * 10) / 10;
                    return { month: m, value: v, answered: vals.length };
                }),
            }));

            return res.json({
                success: true,
                data: {
                    month, responses, pending,
                    summary: summarize(responses.map((r: any) => ({ store_name: r.store_name, answers: r.answers })), qs),
                    trend,
                },
            });
        } catch (error) {
            console.error('Feedback responses error:', error);
            return res.status(500).json({ success: false, error: 'Could not load the feedback' });
        }
    }
}

export default new FeedbackController();
