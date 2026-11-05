import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/database.js';
import { AuthRequest } from '../middleware/auth.js';
import { ActivityLogService } from '../services/activity-log.service.js';
import { NotificationService } from '../services/notification.service.js';
import { franchiseFormProblem, inAudience, readFranchiseForm, validateAnswers, type FranchiseForm, type FeedbackAnswer } from '../services/franchiseForm.js';

const json = <T>(v: unknown, d: T): T => { if (v == null) return d; if (typeof v !== 'string') return v as T; try { return JSON.parse(v) as T; } catch { return d; } };
const rowForm = (r: any) => readFranchiseForm({ ...r, ...json(r.settings, {}) }, String(r.id));
const storeOf = async (userId: string) => { const [[s]]: any = await db.execute('SELECT id, store_name, store_code, city, state, allowed_brands, user_id FROM vendor_details WHERE user_id = ? LIMIT 1', [userId]); return s ?? null; };
const load = async (id: string) => { const [[r]]: any = await db.execute('SELECT * FROM franchise_forms WHERE id = ? AND deleted_at IS NULL', [id]); return r ? rowForm(r) : null; };
const cleanForStore = (f: FranchiseForm) => ({ id: f.id, title: f.title, intro: f.intro, banner_url: f.banner_url, questions: f.questions.filter(q => q.active), status: f.status });

export class FranchiseFormsController {
    async listAdmin(_req: AuthRequest, res: Response) {
        try { const [rows]: any = await db.execute('SELECT * FROM franchise_forms WHERE deleted_at IS NULL ORDER BY updated_at DESC, created_at DESC'); return res.json({ success: true, data: rows.map(rowForm) }); }
        catch (e) { console.error('[Forms] admin list', e); return res.status(500).json({ success: false, error: 'Could not load forms' }); }
    }
    async getAdmin(req: AuthRequest, res: Response) {
        try { const f = await load(req.params.id); return f ? res.json({ success: true, data: f }) : res.status(404).json({ success: false, error: 'Form not found' }); }
        catch (e) { console.error('[Forms] admin get', e); return res.status(500).json({ success: false, error: 'Could not load the form' }); }
    }
    async saveAdmin(req: AuthRequest, res: Response) {
        try {
            const id = String(req.params.id || '').trim() || uuidv4();
            const existing = await load(id);
            const source = req.body?.form ?? req.body ?? {};
            const incoming = readFranchiseForm({ ...source, id, status: existing?.status ?? 'draft', banner_url: source.banner_url ?? existing?.banner_url });
            const problem = franchiseFormProblem(incoming);
            if (incoming.status === 'live' && problem) return res.status(400).json({ success: false, error: problem });
            await db.execute(`INSERT INTO franchise_forms (id, settings, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE settings = VALUES(settings), updated_by = VALUES(updated_by), deleted_at = NULL`, [id, JSON.stringify({ ...incoming, status: existing?.status ?? 'draft' }), req.user?.id ?? null]);
            const saved = await load(id);
            await ActivityLogService.log({ adminId: req.user!.id, actionType: 'FRANCHISE_FORM_SAVED', targetType: 'FRANCHISE_FORM', targetId: id, targetName: incoming.title, details: { questions: incoming.questions.length } });
            return res.json({ success: true, data: saved });
        } catch (e) { console.error('[Forms] save', e); return res.status(500).json({ success: false, error: 'Could not save the form' }); }
    }
    async create(req: AuthRequest, res: Response) { return this.saveAdmin({ ...req, params: { ...req.params, id: uuidv4() } } as unknown as AuthRequest, res); }
    async banner(req: AuthRequest, res: Response) { return res.json({ success: true, url: (req as any).file?.publicUrl ?? (req as any).file?.path ?? null }); }
    async publish(req: AuthRequest, res: Response) {
        try {
            const f = await load(req.params.id); if (!f) return res.status(404).json({ success: false, error: 'Form not found' });
            const live = req.body?.live === true;
            if (live) { const problem = franchiseFormProblem({ ...f, status: 'live' }); if (problem) return res.status(400).json({ success: false, error: problem }); }
            await db.execute('UPDATE franchise_forms SET settings = JSON_SET(settings, "$.status", ?), updated_by = ? WHERE id = ?', [live ? 'live' : 'offline', req.user?.id ?? null, f.id]);
            let notified = 0;
            if (live && req.body?.notify === true) {
                const [rows]: any = await db.execute(`SELECT vd.id, vd.user_id, vd.state, vd.allowed_brands FROM vendor_details vd JOIN vendor_verification vv ON vv.user_id = vd.user_id AND vv.is_verified = 1 AND vv.is_active = 1 WHERE vd.is_franchise = 1 AND NOT EXISTS (SELECT 1 FROM franchise_form_responses r WHERE r.form_id = ? AND r.store_id = vd.id)`, [f.id]);
                const users = rows.filter((r: any) => inAudience(f.audience, r)).map((r: any) => r.user_id).filter(Boolean);
                if (users.length) { const n: any = await NotificationService.broadcast({ title: f.title, message: f.intro || 'A new form is ready in your portal.', type: 'system', targetUsers: users, metadata: { module: 'franchise_form', form_id: f.id } }); notified = Number(n?.count ?? users.length) || 0; }
            }
            return res.json({ success: true, data: { status: live ? 'live' : 'offline', notified } });
        } catch (e) { console.error('[Forms] publish', e); return res.status(500).json({ success: false, error: 'Could not change the form' }); }
    }
    async remove(req: AuthRequest, res: Response) { try { await db.execute('UPDATE franchise_forms SET deleted_at = NOW(), updated_by = ? WHERE id = ?', [req.user?.id ?? null, req.params.id]); return res.json({ success: true }); } catch { return res.status(500).json({ success: false, error: 'Could not delete the form' }); } }
    async stores(_req: AuthRequest, res: Response) { try { const [rows]: any = await db.execute(`SELECT vd.id, vd.store_name, vd.store_code, vd.city, vd.state, COALESCE(vd.allowed_brands, 'AF') AS allowed_brands FROM vendor_details vd JOIN vendor_verification vv ON vv.user_id = vd.user_id AND vv.is_verified = 1 AND vv.is_active = 1 WHERE vd.is_franchise = 1 ORDER BY vd.store_name`); return res.json({ success: true, data: rows }); } catch { return res.status(500).json({ success: false, error: 'Could not load stores' }); } }
    async current(req: AuthRequest, res: Response) { try { const store = await storeOf(req.user!.id); if (!store) return res.status(403).json({ success: false, error: 'Only franchises can fill these forms' }); const [rows]: any = await db.execute('SELECT * FROM franchise_forms WHERE deleted_at IS NULL ORDER BY updated_at DESC'); const out = []; for (const r of rows) { const f = rowForm(r); if (f.status !== 'live' || !inAudience(f.audience, store)) continue; const [[answer]]: any = await db.execute('SELECT answers, submitted_at FROM franchise_form_responses WHERE form_id = ? AND store_id = ?', [f.id, store.id]); out.push({ ...cleanForStore(f), submitted: Boolean(answer), response: answer ? { answers: json<FeedbackAnswer[]>(answer.answers, []), submitted_at: answer.submitted_at } : null }); } return res.json({ success: true, data: out }); } catch (e) { console.error('[Forms] current', e); return res.status(500).json({ success: false, error: 'Could not load forms' }); } }
    async submit(req: AuthRequest, res: Response) { try { const store = await storeOf(req.user!.id); if (!store) return res.status(403).json({ success: false, error: 'Only franchises can fill these forms' }); const f = await load(req.params.id); if (!f || f.status !== 'live' || !inAudience(f.audience, store)) return res.status(404).json({ success: false, error: 'Form not found' }); let raw: unknown; try { raw = JSON.parse(String(req.body?.answers ?? '{}')); } catch { return res.status(400).json({ success: false, error: 'The answers could not be read' }); } const files = (req.files as Express.Multer.File[]) ?? []; const counts: Record<string, number> = {}; for (const file of files) { const m = /^q_(.+)$/.exec(file.fieldname); if (m) counts[m[1]] = (counts[m[1]] ?? 0) + 1; } const checked = validateAnswers(raw, { enabled: true, title: f.title, intro: f.intro, audience: f.audience, questions: f.questions, schedule: { auto: false, start: null, end: null, repeat: false }, reminder: { enabled: false, from_day: 1, to_day: 31, every: 'day', title: '', message: '', button: '' } }, counts); if ('error' in checked) return res.status(400).json({ success: false, error: checked.error }); const answers = checked.answers.map(a => a.type === 'photo' ? { ...a, files: files.filter(file => file.fieldname === `q_${a.qid}`).map((file: any) => file.publicUrl ?? file.path) } : a); try { await db.execute('INSERT INTO franchise_form_responses (id, form_id, store_id, answers, submitted_by) VALUES (?, ?, ?, ?, ?)', [uuidv4(), f.id, store.id, JSON.stringify(answers), req.user!.id]); } catch (e: any) { if (e?.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, error: 'You have already submitted this form' }); throw e; } await ActivityLogService.log({ adminId: req.user!.id, actionType: 'FRANCHISE_FORM_SUBMITTED', targetType: 'FRANCHISE_FORM', targetId: f.id, targetName: store.store_name, details: {} }); return res.status(201).json({ success: true }); } catch (e) { console.error('[Forms] submit', e); return res.status(500).json({ success: false, error: 'Could not submit the form' }); } }
    async responses(req: AuthRequest, res: Response) { try { const f = await load(req.params.id); if (!f) return res.status(404).json({ success: false, error: 'Form not found' }); const [responses]: any = await db.execute(`SELECT r.id, r.store_id, r.answers, r.submitted_at, vd.store_name, vd.store_code, vd.city, vd.state FROM franchise_form_responses r JOIN vendor_details vd ON vd.id = r.store_id WHERE r.form_id = ? ORDER BY r.submitted_at DESC`, [f.id]); const [all]: any = await db.execute(`SELECT vd.id, vd.store_name, vd.store_code, vd.city, vd.state FROM vendor_details vd JOIN vendor_verification vv ON vv.user_id = vd.user_id AND vv.is_verified = 1 AND vv.is_active = 1 WHERE vd.is_franchise = 1 ORDER BY vd.store_name`); const pending = all.filter((s: any) => inAudience(f.audience, s) && !responses.some((r: any) => String(r.store_id) === String(s.id))); return res.json({ success: true, data: { form: cleanForStore(f), responses: responses.map((r: any) => ({ ...r, answers: json<FeedbackAnswer[]>(r.answers, []) })), pending } }); } catch (e) { console.error('[Forms] responses', e); return res.status(500).json({ success: false, error: 'Could not load responses' }); } }
}

export default new FranchiseFormsController();
