import { Response } from 'express';
import db from '../config/database.js';
import { AuthRequest } from '../middleware/auth.js';
import { vendorRepository } from '../repositories/vendor.repository.js';
import { posmRepository } from '../repositories/posm.repository.js';
import { NotificationService } from '../services/notification.service.js';
import { ActivityLogService } from '../services/activity-log.service.js';
import {
    readCatalog, catalogProblem, storeBrands, storeCatalog, validateLines, requestSummary, applyDecisions, usageFrom,
    type PosmLine, type PosmCatalog, type Usage,
} from '../services/posmCatalog.js';
import { nextStatus, actionsFor, undoTarget, ACTION_TEXT, type HistoryEntry, type PosmAction } from '../services/posmFlow.js';
import { asmStore } from '../services/asmStores.js';

/** Who the signed-in user is on a ticket: the store, head office or the store's ASM. */
const roleOf = (req: AuthRequest): 'admin' | 'asm' | 'franchise' =>
    req.user?.role === 'admin' ? 'admin' : req.user?.role === 'asm' ? 'asm' : 'franchise';
import { applyLineAction, lineActionsFor, requestStatus, stepText, type LineAction } from '../services/posmLineFlow.js';

/** A step on some items: what changed, the items after it, or why it cannot be taken. */
function stepLines(lines: PosmLine[], action: LineAction, specs: { index: number; qty?: unknown; note?: unknown }[], input: { note?: unknown; dispatch?: unknown; by?: 'admin' | 'franchise' }):
    { lines: PosmLine[]; touched: number[] } | { error: string } {
    const out = lines.map(l => ({ ...l }));
    const touched: number[] = [];
    for (const sp of specs) {
        const i = Number(sp?.index);
        if (!Number.isInteger(i) || i < 0 || i >= out.length) return { error: 'An item ticked is not on this request' };
        if (touched.includes(i)) continue;
        const r = applyLineAction(out[i], action, { ...input, qty: sp.qty, ...(sp.note !== undefined ? { note: sp.note } : {}) });
        if ('error' in r) return r;
        out[i] = r.line;
        touched.push(i);
    }
    return { lines: out, touched };
}

/** What an edit changed on each item, in words. */
function editText(before: PosmLine[], after: PosmLine[], touched: number[]): string {
    const parts: string[] = [];
    for (const i of touched) {
        const b = before[i], a = after[i], bits: string[] = [];
        if ((b.approved_qty ?? null) !== (a.approved_qty ?? null)) bits.push(`quantity ${b.approved_qty ?? b.qty} → ${a.approved_qty}`);
        if ((b.note ?? null) !== (a.note ?? null)) bits.push(a.note ? `note: "${a.note.slice(0, 120)}"` : 'note removed');
        if (JSON.stringify(b.dispatch ?? null) !== JSON.stringify(a.dispatch ?? null) && a.dispatch) bits.push(`shipment: ${[a.dispatch.courier, a.dispatch.tracking].filter(Boolean).join(' · ')}`);
        if (bits.length) parts.push(`${a.item_name} ${bits.join(', ')}`);
    }
    return parts.join('; ');
}

/** A step for the timeline, by whoever is signed in. */
const step = (req: AuthRequest, e: Omit<HistoryEntry, 'at' | 'by_role' | 'by' | 'by_name'>): HistoryEntry => ({
    ...e, at: new Date().toISOString(),
    by_role: roleOf(req),
    by: req.user?.id ?? null, by_name: (req.user as any)?.name ?? null,
});

/** The item lists, as the admin last saved them (defaults until then). */
async function loadCatalog(): Promise<PosmCatalog> {
    const [rows]: any = await db.execute('SELECT catalog FROM posm_settings WHERE id = 1');
    const raw = rows[0]?.catalog;
    return readCatalog(typeof raw === 'string' ? JSON.parse(raw) : raw);
}

const fileUrl = (f: any) => f.path || f.secure_url || f.url;

/** What a store already has of each item this month and year, for the limits. */
async function storeUsage(franchiseId: string, exceptRequestId?: number): Promise<Usage> {
    const [rows]: any = await db.execute(
        `SELECT id, status, created_at, items FROM posm_requests
          WHERE franchise_id = ? AND items IS NOT NULL AND created_at >= NOW() - INTERVAL 400 DAY`,
        [franchiseId]
    );
    return usageFrom(rows
        .filter((r: any) => r.id !== exceptRequestId)
        .map((r: any) => ({ ...r, items: typeof r.items === 'string' ? JSON.parse(r.items) : r.items })));
}

/* What the store is told when its request moves on. */
const STATUS_NOTE: Record<string, string> = {
    approved: 'has been approved', in_production: 'is in production', dispatched: 'has been dispatched',
    delivered: 'is marked delivered', rejected: 'was not approved', closed: 'is closed', pending: 'is on hold', open: 'is reopened',
};

class POSMController {
    private async authorizeRequestAccess(req: AuthRequest, requestIdParam: string) {
        const requestId = Number.parseInt(requestIdParam, 10);
        if (!Number.isInteger(requestId) || requestId <= 0) {
            return { error: { status: 400, body: { success: false, error: 'Invalid ticket id' } } };
        }

        const request = await posmRepository.findRequest(requestId);
        if (!request) {
            return { error: { status: 404, body: { success: false, error: 'Ticket not found' } } };
        }

        if (req.user?.role === 'admin') {
            return { requestId, request };
        }

        const userId = req.user?.id;
        if (!userId) {
            return { error: { status: 401, body: { success: false, error: 'Unauthorized' } } };
        }

        // An ASM reaches the tickets of the stores under them, and no others.
        // Another ASM's ticket reads as missing, as their stores do.
        if (req.user?.role === 'asm') {
            return (await asmStore(userId, String(request.franchise_id)))
                ? { requestId, request }
                : { error: { status: 404, body: { success: false, error: 'Ticket not found' } } };
        }

        const vendor = await vendorRepository.findByUserId(userId);
        if (!vendor || String(vendor.id) !== String(request.franchise_id)) {
            return { error: { status: 403, body: { success: false, error: 'Access denied.' } } };
        }

        return { requestId, request };
    }

    /**
     * Generate unique sequential ticket ID (PO-0000001)
     */
    private async generateTicketId(): Promise<string> {
        const [rows]: any = await db.execute(
            `SELECT ticket_id FROM posm_requests
             WHERE ticket_id LIKE 'PO-%'
             ORDER BY ticket_id DESC
             LIMIT 1`
        );

        let nextNumber = 1;
        if (rows.length > 0) {
            const lastId: string = rows[0].ticket_id;
            const parts = lastId.split('-');
            const lastNum = parseInt(parts[1], 10);
            if (!isNaN(lastNum)) nextNumber = lastNum + 1;
        }

        const padded = String(nextNumber).padStart(7, '0');
        return `PO-${padded}`;
    }

    /**
     * Submit a new POSM request (Franchise only)
     * POST /api/posm
     */
    submitRequest = async (req: AuthRequest, res: Response) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }

            // Find franchise ID for this user
            const vendor = await vendorRepository.findByUserId(userId);
            if (!vendor) {
                return res.status(403).json({ success: false, error: 'Access denied. Only franchises can raise POSM requests.' });
            }

            const { requirement } = req.body;
            if (!requirement || requirement.trim().length === 0) {
                return res.status(400).json({ success: false, error: 'Requirement description is mandatory' });
            }

            // Get uploaded files from multer (Cloudinary/Local)
            const uploadedFiles = req.files as Express.Multer.File[];
            const attachmentUrls = uploadedFiles?.map((file: any) => file.path || file.secure_url || file.url) || [];

            const ticketId = await this.generateTicketId();

            // 1. Create the request
            const requestId = await posmRepository.createPOSMRequest({
                ticket_id: ticketId,
                franchise_id: vendor.id,
                requirement: requirement,
                created_by_role: 'franchise',
                created_by: userId,
                status: 'open',
                history: [step(req, { action: 'sent', status: 'open' })],
            });

            // 2. Add the first message if there's an attachment or just the requirement as message
            // Requirement is already in the request record, but we can also store it as the first message for the chat flow
            await posmRepository.createMessage({
                request_id: requestId,
                sender_id: userId,
                sender_role: 'franchise',
                message: requirement,
                attachments: attachmentUrls.length > 0 ? attachmentUrls : null
            });

            // 3. Log Activity
            await ActivityLogService.log({
                adminId: userId,
                actionType: 'CREATE_POSM_REQUEST',
                details: { ticketId, requestId }
            });

            // 4. Tell admins. Nothing did before, so a new request was only
            // found by opening the POSM screen.
            try {
                await NotificationService.broadcast({
                    title: `New POSM Request: ${ticketId}`,
                    message: `${vendor.store_name || 'A franchise'} raised a POSM request: ${String(requirement).slice(0, 140)}`,
                    type: 'posm',
                    targetRole: 'admin'
                });
            } catch (notifError) {
                console.error('Failed to notify admins of POSM request:', notifError);
            }

            return res.status(201).json({
                success: true,
                message: 'POSM request submitted successfully',
                data: { ticketId, requestId }
            });

        } catch (error: any) {
            console.error('Submit POSM request error:', error);
            return res.status(500).json({ success: false, error: 'Failed to submit POSM request' });
        }
    }

    /**
     * Raise a POSM request on a franchise's behalf (Admin only)
     * POST /api/posm/admin/on-behalf
     *
     * Requirements often arrive by phone or email rather than through the
     * portal. This records one against the named store so it enters the same
     * queue as a self-raised ticket. The franchise is named explicitly here
     * instead of taken from the session, so the caller is checked as admin at
     * the route and the target store is verified below.
     */
    submitRequestOnBehalf = async (req: AuthRequest, res: Response) => {
        try {
            const adminId = req.user?.id;
            if (!adminId) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }

            const { requirement, franchiseId } = req.body;

            if (!franchiseId) {
                return res.status(400).json({ success: false, error: 'Choose the franchise this request is for' });
            }
            if (!requirement || requirement.trim().length === 0) {
                return res.status(400).json({ success: false, error: 'Requirement description is mandatory' });
            }

            // The admin vendor list and vendor_details use different id spaces,
            // so accept either and store the resolved vendor_details.id — the
            // column posm_requests.franchise_id has a FK onto it.
            const [vendorRows]: any = await db.execute(
                `SELECT vd.id, vd.store_name
                 FROM vendor_details vd
                 WHERE vd.id = ? OR vd.user_id = ?
                 LIMIT 1`,
                [franchiseId, franchiseId]
            );

            if (!vendorRows.length) {
                return res.status(404).json({ success: false, error: 'Franchise not found' });
            }

            const franchise = vendorRows[0];

            const uploadedFiles = req.files as Express.Multer.File[];
            const attachmentUrls = uploadedFiles?.map((file: any) => file.path || file.secure_url || file.url) || [];

            const ticketId = await this.generateTicketId();

            const requestId = await posmRepository.createPOSMRequest({
                ticket_id: ticketId,
                franchise_id: franchise.id,
                requirement: requirement,
                created_by_role: 'admin',
                created_by: adminId,
                status: 'open',
                history: [step(req, { action: 'sent', status: 'open', note: 'Raised on the store\'s behalf' })],
            });

            // Logged as a franchise message so the ticket reads as the store's
            // requirement, which is whose it is. The admin who entered it is
            // recorded in the activity log below.
            await posmRepository.createMessage({
                request_id: requestId,
                sender_id: adminId,
                sender_role: 'franchise',
                message: requirement,
                attachments: attachmentUrls.length > 0 ? attachmentUrls : null
            });

            await ActivityLogService.log({
                adminId,
                adminName: (req.user as any)?.name,
                adminEmail: (req.user as any)?.email,
                actionType: 'CREATE_POSM_REQUEST_ON_BEHALF',
                targetType: 'POSM_REQUEST',
                targetId: String(requestId),
                targetName: franchise.store_name,
                details: { ticketId, requestId, franchiseId: franchise.id },
                ipAddress: req.ip || req.socket?.remoteAddress
            });

            return res.status(201).json({
                success: true,
                message: `POSM request raised for ${franchise.store_name}`,
                data: { ticketId, requestId }
            });

        } catch (error: any) {
            console.error('Submit POSM request on behalf error:', error);
            return res.status(500).json({ success: false, error: 'Failed to submit POSM request' });
        }
    }

    /**
     * The items a store can ask for, with the brands it sells.
     * GET /api/posm/catalog — the admin gets the lists to edit them.
     */
    getCatalog = async (req: AuthRequest, res: Response) => {
        try {
            const catalog = await loadCatalog();
            if (req.user?.role === 'admin') {
                const forStore = String(req.query.franchiseId ?? '').trim();
                if (!forStore) return res.json({ success: true, data: { catalog } });
                const [[st]]: any = await db.execute('SELECT id, allowed_brands FROM vendor_details WHERE id = ? OR user_id = ? LIMIT 1', [forStore, forStore]);
                if (!st) return res.status(404).json({ success: false, error: 'Franchise not found' });
                return res.json({ success: true, data: {
                    catalog: storeCatalog(catalog, storeBrands(st.allowed_brands)),
                    brands: storeBrands(st.allowed_brands),
                    usage: await storeUsage(st.id),
                } });
            }
            const vendor: any = req.user?.id ? await vendorRepository.findByUserId(req.user.id) : null;
            if (!vendor) return res.status(403).json({ success: false, error: 'Access denied.' });
            const [[row]]: any = await db.execute('SELECT allowed_brands FROM vendor_details WHERE id = ?', [vendor.id]);
            return res.json({ success: true, data: {
                catalog: storeCatalog(catalog, storeBrands(row?.allowed_brands)),
                brands: storeBrands(row?.allowed_brands),
                usage: await storeUsage(vendor.id),
            } });
        } catch (error: any) {
            console.error('Get POSM catalog error:', error);
            return res.status(500).json({ success: false, error: 'Failed to load the POSM items' });
        }
    }

    /**
     * Save the items, their fields and limits (Admin only)
     * PUT /api/posm/admin/catalog
     */
    saveCatalog = async (req: AuthRequest, res: Response) => {
        try {
            const catalog = readCatalog(req.body?.catalog);
            const problem = catalogProblem(catalog);
            if (problem) return res.status(400).json({ success: false, error: problem });
            await db.execute(
                `INSERT INTO posm_settings (id, catalog, updated_by) VALUES (1, ?, ?)
                 ON DUPLICATE KEY UPDATE catalog = VALUES(catalog), updated_by = VALUES(updated_by)`,
                [JSON.stringify(catalog), req.user?.id ?? null]
            );
            await ActivityLogService.log({
                adminId: req.user?.id!, adminName: (req.user as any)?.name, adminEmail: (req.user as any)?.email,
                actionType: 'UPDATE_POSM_CATALOG', targetType: 'POSM_SETTINGS', targetId: '1',
                details: { items: catalog.items.map(it => ({ id: it.id, name: it.name, enabled: it.enabled, limits: it.limits, fields: it.fields.length })) },
                ipAddress: req.ip || req.socket?.remoteAddress,
            });
            return res.json({ success: true, data: { catalog } });
        } catch (error: any) {
            console.error('Save POSM catalog error:', error);
            return res.status(500).json({ success: false, error: 'Failed to save the POSM items' });
        }
    }

    /**
     * A picture for an item's card (Admin only)
     * POST /api/posm/admin/catalog/image — one file, `image`.
     */
    uploadItemImage = async (req: AuthRequest, res: Response) => {
        const f = ((req.files as Express.Multer.File[]) ?? [])[0];
        if (!f) return res.status(400).json({ success: false, error: 'Choose a picture' });
        if (!/^image\//.test(f.mimetype) && !/\.(jpe?g|png|webp)$/i.test(f.originalname)) {
            return res.status(400).json({ success: false, error: 'The picture must be a JPG, PNG or WebP' });
        }
        return res.json({ success: true, data: { url: fileUrl(f) } });
    }

    /**
     * Checks the lines and files, and files the request for a store. Shared by
     * the store's own request and the admin's on its behalf; the admin may
     * set aside the item limits.
     */
    private async createItemRequest(req: AuthRequest, res: Response, opts: {
        franchiseId: string; byRole: 'franchise' | 'admin' | 'asm'; ignoreLimits?: boolean;
        /** For an ASM: their name, for the store's notification and the timeline. */
        asmName?: string;
    }) {
        const userId = req.user!.id;
        let raw: unknown;
        try { raw = JSON.parse(String(req.body?.items ?? '[]')); } catch { return res.status(400).json({ success: false, error: 'The items could not be read' }); }
        const [[store]]: any = await db.execute('SELECT store_name, allowed_brands, user_id FROM vendor_details WHERE id = ?', [opts.franchiseId]);
        if (!store) return res.status(404).json({ success: false, error: 'Franchise not found' });

        /* Files come as line_<n>_<field> for a line's file field, anything else is the note's. */
        const files = ((req.files as Express.Multer.File[]) ?? []);
        const fileCounts: Record<string, number> = {};
        for (const f of files) {
            const m = /^line_(\d+)_(.+)$/.exec(f.fieldname);
            if (m) fileCounts[`${m[1]}.${m[2]}`] = (fileCounts[`${m[1]}.${m[2]}`] ?? 0) + 1;
        }
        const catalog = await loadCatalog();
        const rules = opts.ignoreLimits
            ? { items: catalog.items.map(it => ({ ...it, limits: {} })) }
            : catalog;
        const checked = validateLines(raw, rules, storeBrands(store.allowed_brands), await storeUsage(opts.franchiseId), fileCounts);
        if ('error' in checked) return res.status(400).json({ success: false, error: checked.error });
        const lines: PosmLine[] = checked.lines.map(l => ({ ...l, line_status: 'pending', approved_qty: null }));

        const noteFiles: string[] = [];
        for (const f of files) {
            const m = /^line_(\d+)_(.+)$/.exec(f.fieldname);
            if (m && lines[Number(m[1])]) (lines[Number(m[1])].files ??= []).push(fileUrl(f));
            else noteFiles.push(fileUrl(f));
        }
        const note = String(req.body?.note ?? '').trim().slice(0, 1000);
        const summary = requestSummary(lines);

        const ticketId = await this.generateTicketId();
        const requestId = await posmRepository.createPOSMRequest({
            ticket_id: ticketId, franchise_id: opts.franchiseId, requirement: summary.slice(0, 2000),
            created_by_role: opts.byRole, created_by: userId, status: 'open', items: lines,
            history: [{
                ...step(req, {
                    action: 'sent', status: 'open',
                    note: opts.byRole === 'admin' ? "Raised on the store's behalf"
                        : opts.byRole === 'asm' ? `Raised by ${opts.asmName || 'the ASM'} (ASM) for the store` : null,
                }),
                // The session holds the name at login; an ASM may have corrected it since.
                ...(opts.byRole === 'asm' && opts.asmName ? { by_name: opts.asmName } : {}),
            }],
        });
        if (note || noteFiles.length) {
            await posmRepository.createMessage({
                request_id: requestId, sender_id: userId, sender_role: opts.byRole,
                message: note || null, attachments: noteFiles.length ? noteFiles : null,
            });
        }
        await ActivityLogService.log({
            adminId: userId, adminName: (req.user as any)?.name, adminEmail: (req.user as any)?.email,
            actionType: opts.byRole === 'admin' ? 'CREATE_POSM_REQUEST_ON_BEHALF'
                : opts.byRole === 'asm' ? 'CREATE_POSM_REQUEST_BY_ASM' : 'CREATE_POSM_REQUEST',
            targetType: 'POSM_REQUEST', targetId: String(requestId), targetName: store.store_name,
            details: { ticketId, requestId, items: lines.length, franchiseId: opts.franchiseId, ignoreLimits: !!opts.ignoreLimits },
            ipAddress: req.ip || req.socket?.remoteAddress,
        });
        try {
            if (opts.byRole === 'admin') {
                if (store.user_id) await NotificationService.notify(store.user_id, {
                    title: `POSM ${ticketId} raised for you`, message: `The Autoform team added: ${summary.slice(0, 140)}`, type: 'posm',
                });
            } else if (opts.byRole === 'asm') {
                // The store is told it was raised for it; head office gets it
                // like any new request, since it now needs their decision.
                if (store.user_id) await NotificationService.notify(store.user_id, {
                    title: `POSM ${ticketId} raised for you`,
                    message: `${opts.asmName || 'Your ASM'} (your ASM) asked for: ${summary.slice(0, 140)}`, type: 'posm',
                });
                await NotificationService.broadcast({
                    title: `New POSM Request: ${ticketId}`,
                    message: `${opts.asmName || 'An ASM'} (ASM) asked for ${store.store_name || 'a store'}: ${summary.slice(0, 140)}`,
                    type: 'posm', targetRole: 'admin',
                });
            } else {
                await NotificationService.broadcast({
                    title: `New POSM Request: ${ticketId}`,
                    message: `${store.store_name || 'A franchise'} asked for: ${summary.slice(0, 140)}`,
                    type: 'posm', targetRole: 'admin',
                });
            }
        } catch (notifError) {
            console.error('Failed to send the POSM request notification:', notifError);
        }
        return res.status(201).json({
            success: true, message: opts.byRole === 'franchise' ? 'POSM request sent' : `POSM request raised for ${store.store_name}`,
            data: { ticketId, requestId },
        });
    }

    /**
     * A request built from items (Franchise only)
     * POST /api/posm/items — multipart: `items` (JSON lines), `note`, files
     * `line_<n>_<field>` for a line's file field, others for the note.
     */
    submitItems = async (req: AuthRequest, res: Response) => {
        try {
            const userId = req.user?.id;
            if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
            const vendor: any = await vendorRepository.findByUserId(userId);
            if (!vendor) return res.status(403).json({ success: false, error: 'Access denied. Only franchises can raise POSM requests.' });
            return await this.createItemRequest(req, res, { franchiseId: String(vendor.id), byRole: 'franchise' });
        } catch (error: any) {
            console.error('Submit POSM items error:', error);
            return res.status(500).json({ success: false, error: 'Failed to send the POSM request' });
        }
    }

    /**
     * A request built from items, raised on a store's behalf (Admin only)
     * POST /api/posm/admin/on-behalf/items — as /items, plus `franchiseId`
     * and `ignore_limits` ('true' to set the item limits aside).
     */
    submitItemsOnBehalf = async (req: AuthRequest, res: Response) => {
        try {
            const id = String(req.body?.franchiseId ?? '').trim();
            if (!id) return res.status(400).json({ success: false, error: 'Choose the franchise this request is for' });
            const [[st]]: any = await db.execute('SELECT id FROM vendor_details WHERE id = ? OR user_id = ? LIMIT 1', [id, id]);
            if (!st) return res.status(404).json({ success: false, error: 'Franchise not found' });
            return await this.createItemRequest(req, res, {
                franchiseId: String(st.id), byRole: 'admin', ignoreLimits: String(req.body?.ignore_limits) === 'true',
            });
        } catch (error: any) {
            console.error('Submit POSM items on behalf error:', error);
            return res.status(500).json({ success: false, error: 'Failed to raise the POSM request' });
        }
    }

    /**
     * The item lists for one of the ASM's stores: what that store may order,
     * with its brands and what it has already had against the limits.
     * GET /api/asm-portal/stores/:id/posm-catalog
     */
    getCatalogForAsm = async (req: AuthRequest, res: Response) => {
        try {
            const store = await asmStore(req.user!.id, String(req.params.id));
            if (!store) return res.status(404).json({ success: false, error: 'Store not found' });
            const catalog = await loadCatalog();
            const [[row]]: any = await db.execute('SELECT allowed_brands FROM vendor_details WHERE id = ?', [store.id]);
            return res.json({ success: true, data: {
                catalog: storeCatalog(catalog, storeBrands(row?.allowed_brands)),
                brands: storeBrands(row?.allowed_brands),
                usage: await storeUsage(store.id),
            } });
        } catch (error: any) {
            console.error('Get POSM catalog for ASM error:', error);
            return res.status(500).json({ success: false, error: 'Failed to load the POSM items' });
        }
    }

    /**
     * An ASM raises a request for one of their stores, from the same items and
     * within the same limits the store itself would have.
     * POST /api/asm-portal/stores/:id/posm — as /posm/items.
     */
    submitItemsByAsm = async (req: AuthRequest, res: Response) => {
        try {
            const store = await asmStore(req.user!.id, String(req.params.id));
            if (!store) return res.status(404).json({ success: false, error: 'Store not found' });
            return await this.createItemRequest(req, res, { franchiseId: String(store.id), byRole: 'asm', asmName: store.asm_name });
        } catch (error: any) {
            console.error('Submit POSM items by ASM error:', error);
            return res.status(500).json({ success: false, error: 'Failed to raise the POSM request' });
        }
    }

    /**
     * The store confirms its request arrived, with photos (Franchise only)
     * POST /api/posm/:id/delivered
     */
    confirmDelivery = async (req: AuthRequest, res: Response) => {
        try {
            const access = await this.authorizeRequestAccess(req, req.params.id);
            if (access.error) return res.status(access.error.status).json(access.error.body);
            const lines = Array.isArray(access.request.items) && access.request.items.length ? access.request.items as PosmLine[] : null;
            const onWay = lines ? lines.map((l, index) => ({ index, l })).filter(x => x.l.line_status === 'dispatched') : [];
            if (lines ? !onWay.length : access.request.status !== 'dispatched') {
                return res.status(409).json({ success: false, error: 'Only a dispatched request can be marked as received' });
            }
            const photos = ((req.files as Express.Multer.File[]) ?? []).map(fileUrl);
            const delivery = { by: 'franchise', at: new Date().toISOString(), photos };
            if (lines) {
                const r = stepLines(lines, 'deliver', onWay.map(x => ({ index: x.index })), { by: 'franchise' });
                if ('error' in r) return res.status(409).json({ success: false, error: r.error });
                const status = requestStatus(r.lines, access.request.status);
                await posmRepository.updateRequest(access.requestId, {
                    status, items: r.lines, ...(status === 'delivered' ? { delivery } : {}),
                    history: [...(access.request.history ?? []), step(req, { action: 'received', status: status as HistoryEntry['status'], note: onWay.map(x => x.l.item_name).join(', '), lines: r.touched })],
                });
            } else {
                await posmRepository.updateRequest(access.requestId, {
                    status: 'delivered', delivery,
                    history: [...(access.request.history ?? []), step(req, { action: 'received', status: 'delivered' })],
                });
            }
            const extra = String(req.body?.note ?? '').trim().slice(0, 500);
            await posmRepository.createMessage({
                request_id: access.requestId, sender_id: req.user!.id, sender_role: 'franchise',
                message: 'Received the items.' + (extra ? ` ${extra}` : ''),
                attachments: photos.length ? photos : null,
            });
            try {
                await NotificationService.broadcast({
                    title: `POSM delivered: ${access.request.ticket_id}`,
                    message: `${(access.request as any).store_name || 'The store'} confirmed it received the items.`,
                    type: 'posm', targetRole: 'admin',
                });
            } catch (e) { console.error('Failed to notify admins of POSM delivery:', e); }
            return res.json({ success: true, data: { delivery } });
        } catch (error: any) {
            console.error('Confirm POSM delivery error:', error);
            return res.status(500).json({ success: false, error: 'Failed to confirm delivery' });
        }
    }

    /**
     * Get all requests for the logged-in franchise
     * GET /api/posm
     */
    getFranchiseRequests = async (req: AuthRequest, res: Response) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }

            const vendor = await vendorRepository.findByUserId(userId);
            if (!vendor) {
                return res.status(403).json({ success: false, error: 'Access denied.' });
            }

            // Without head office's internal notes, which the list used to carry.
            const requests = await posmRepository.getFranchiseRequests(vendor.id);
            return res.json({ success: true, data: requests.map(({ internal_notes, ...r }) => r) });

        } catch (error: any) {
            console.error('Get franchise requests error:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch requests' });
        }
    }

    /**
     * Get ticket details and message history
     * GET /api/posm/:id
     */
    getTicketDetails = async (req: AuthRequest, res: Response) => {
        try {
            const access = await this.authorizeRequestAccess(req, req.params.id);
            if (access.error) {
                return res.status(access.error.status).json(access.error.body);
            }

            const messages = await posmRepository.getMessages(access.requestId);

            /* For the admin deciding quantities: the store's other requests this
               month and year, against each item's limits. */
            let limits: Record<string, unknown> | undefined;
            if (req.user?.role === 'admin' && Array.isArray(access.request.items)) {
                const [catalog, usage] = await Promise.all([loadCatalog(), storeUsage(access.request.franchise_id, access.requestId)]);
                limits = Object.fromEntries((access.request.items as PosmLine[]).map(l => {
                    const it = catalog.items.find(x => x.id === l.item_id);
                    return [l.item_id, { ...(it?.limits ?? {}), used_month: usage[l.item_id]?.month ?? 0, used_year: usage[l.item_id]?.year ?? 0 }];
                }));
            }

            // Head office's internal notes are theirs alone: never to the store or its ASM.
            const { internal_notes, ...visible } = access.request as any;
            return res.json({
                success: true,
                data: {
                    ...(req.user?.role === 'admin' ? access.request : visible),
                    messages,
                    ...(limits ? { limits } : {}),
                    ...(req.user?.role === 'admin' ? { actions: actionsFor(access.request.status) } : {}),
                }
            });

        } catch (error: any) {
            console.error('Get ticket details error:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch ticket details' });
        }
    }

    /**
     * Send a new message in the chat
     * POST /api/posm/:id/messages
     */
    sendMessage = async (req: AuthRequest, res: Response) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }

            const { message } = req.body;

            const access = await this.authorizeRequestAccess(req, req.params.id);
            if (access.error) {
                return res.status(access.error.status).json(access.error.body);
            }

            // Uploaded files
            const uploadedFiles = req.files as Express.Multer.File[];
            const attachmentUrls = uploadedFiles?.map((file: any) => file.path || file.secure_url || file.url) || [];

            if (!message && attachmentUrls.length === 0) {
                return res.status(400).json({ success: false, error: 'Message or attachment is required' });
            }

            await posmRepository.createMessage({
                request_id: access.requestId,
                sender_id: userId,
                sender_role: roleOf(req),
                message: message || null,
                attachments: attachmentUrls.length > 0 ? attachmentUrls : null
            });

            return res.json({ success: true, message: 'Message sent' });

        } catch (error: any) {
            console.error('Send message error:', error);
            return res.status(500).json({ success: false, error: 'Failed to send message' });
        }
    }

    /**
     * Get all requests (Admin only)
     * GET /api/posm/admin/all
     */
    getAllRequests = async (req: AuthRequest, res: Response) => {
        try {
            if (req.user?.role !== 'admin') {
                return res.status(403).json({ success: false, error: 'Access denied.' });
            }

            const requests = await posmRepository.getAllRequests();
            return res.json({ success: true, data: requests });

        } catch (error: any) {
            console.error('Get all requests error:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch requests' });
        }
    }

    /**
     * Update request status or internal notes (Admin only)
     * PUT /api/posm/:id/status
     */
    /**
     * Save what is not a step: the internal note, the quantities while the
     * request waits for approval, the dispatch details once sent (to correct
     * them). The stage moves only through act().
     * PUT /api/posm/:id/status
     */
    updateRequest = async (req: AuthRequest, res: Response) => {
        try {
            if (req.user?.role !== 'admin') return res.status(403).json({ success: false, error: 'Access denied.' });
            const requestId = parseInt(req.params.id);
            const { internalNotes, decisions, dispatch, status } = req.body ?? {};
            const current = await posmRepository.findRequest(requestId);
            if (!current) return res.status(404).json({ success: false, error: 'Request not found' });
            if (status && status !== current.status) {
                return res.status(400).json({ success: false, error: 'Use the action buttons to move a request to another stage' });
            }

            const fields: Parameters<typeof posmRepository.updateRequest>[1] = {};
            if (internalNotes !== undefined) fields.internal_notes = internalNotes === null ? null : String(internalNotes).slice(0, 2000);
            let changedAfterApproval: string | null = null;
            if (decisions !== undefined) {
                if (!['open', 'under_review', 'pending', 'approved', 'in_production'].includes(current.status) || !Array.isArray(current.items)) {
                    return res.status(400).json({ success: false, error: 'Quantities can be changed only until the request is dispatched' });
                }
                /* Items that have moved on keep their stage: only a new quantity is
                   taken from them (the item steps are POST /:id/lines). */
                const before = current.items as PosmLine[];
                const moved = before.some(l => !['pending', 'approved', 'rejected'].includes(String(l.line_status)) || l.trail?.length);
                let applied: PosmLine[] | { error: string };
                if (moved) {
                    const specs = (Array.isArray(decisions) ? decisions : [])
                        .filter((d: any) => before[Number(d?.index)] && Number(d?.approved_qty) > 0 && Number(d.approved_qty) !== before[Number(d.index)].approved_qty
                            && before[Number(d.index)].line_status !== 'rejected')
                        .map((d: any) => ({ index: Number(d.index), qty: d.approved_qty }));
                    const r = stepLines(before, 'edit', specs, {});
                    applied = 'error' in r ? r : r.lines;
                } else {
                    applied = applyDecisions(before, decisions);
                }
                if (!Array.isArray(applied)) return res.status(400).json({ success: false, error: applied.error });
                if (['approved', 'in_production'].includes(current.status)) {
                    const ok = applied.filter(l => l.line_status === 'approved' && (l.approved_qty ?? 0) > 0).length;
                    if (!ok) return res.status(400).json({ success: false, error: 'Every item would be at 0: reject the request instead' });
                    const diff = applied.map((l, k) => (l.approved_qty ?? null) !== (before[k]?.approved_qty ?? null)
                        ? `${l.item_name} ${before[k]?.approved_qty ?? '-'} → ${l.approved_qty ?? '-'}` : null).filter(Boolean);
                    if (diff.length) changedAfterApproval = diff.join(', ');
                }
                fields.items = applied;
            }
            if (dispatch !== undefined && dispatch !== null) {
                if (!['dispatched', 'delivered'].includes(current.status)) {
                    return res.status(400).json({ success: false, error: 'Add the dispatch details when you dispatch the request' });
                }
                const d = this.readDispatch(dispatch);
                if ('error' in d) return res.status(400).json({ success: false, error: d.error });
                fields.dispatch = d;
            }
            if (changedAfterApproval) {
                fields.history = [...((current.history ?? []) as HistoryEntry[]), step(req, { action: 'update', status: current.status as HistoryEntry['status'], note: changedAfterApproval })];
            }
            await posmRepository.updateRequest(requestId, fields);
            const storeUser = (current as any).store_user_id;
            if (changedAfterApproval && storeUser) {
                try {
                    await NotificationService.notify(storeUser, { title: `POSM ${current.ticket_id}: quantities updated`, message: changedAfterApproval.slice(0, 200), type: 'posm' });
                } catch (e) { console.error('Failed to notify the store of a POSM quantity change:', e); }
            }
            await ActivityLogService.log({
                adminId: req.user.id, actionType: 'UPDATE_POSM_REQUEST', targetType: 'POSM_REQUEST', targetId: String(requestId),
                details: { internalNotes: internalNotes !== undefined, decisions: decisions !== undefined, dispatch: fields.dispatch },
            });
            return res.json({ success: true, message: 'Saved', data: await posmRepository.findRequest(requestId) });
        } catch (error: any) {
            console.error('Update POSM request error:', error);
            return res.status(500).json({ success: false, error: 'Failed to update request' });
        }
    }

    private readDispatch(d: any): { courier: string; tracking: string; date: string | null } | { error: string } {
        const courier = String(d?.courier ?? '').trim().slice(0, 80);
        const tracking = String(d?.tracking ?? '').trim().slice(0, 80);
        const date = /^\d{4}-\d{2}-\d{2}$/.test(String(d?.date ?? '')) ? String(d.date) : null;
        if (!courier) return { error: 'Enter how it was sent (courier, by hand, through the distributor…)' };
        return { courier, tracking, date };
    }

    /**
     * Move a request to its next stage (Admin only)
     * POST /api/posm/:id/action — { action, decisions?, dispatch?, reason?, note? }
     * The allowed moves are posmFlow's; each one goes on the timeline and the
     * store is told.
     */
    act = async (req: AuthRequest, res: Response) => {
        try {
            const requestId = parseInt(req.params.id);
            const { action, decisions, dispatch, reason, note } = req.body ?? {};
            const current = await posmRepository.findRequest(requestId);
            if (!current) return res.status(404).json({ success: false, error: 'Request not found' });
            const history = (current.history ?? []) as HistoryEntry[];
            const itemLines = Array.isArray(current.items) && current.items.length ? current.items as PosmLine[] : null;

            if (action === 'undo') {
                if (itemLines) return res.status(400).json({ success: false, error: 'Undo each item on its own' });
                const u = undoTarget(history);
                if ('error' in u) return res.status(409).json({ success: false, error: u.error });
                const h = history.map((e, i) => i === u.index ? { ...e, undone: true } : e);
                const undoFields: Parameters<typeof posmRepository.updateRequest>[1] = {
                    status: u.status,
                    history: [...h, step(req, { action: 'undo', status: u.status, note: `${ACTION_TEXT[u.undid.action]} undone` })],
                };
                if (u.undid.action === 'dispatch') undoFields.dispatch = null;
                if (u.undid.action === 'deliver' || u.undid.action === 'received') undoFields.delivery = null;
                await posmRepository.updateRequest(requestId, undoFields);
                await ActivityLogService.log({
                    adminId: req.user!.id, adminName: (req.user as any)?.name, adminEmail: (req.user as any)?.email,
                    actionType: 'POSM_ACTION', targetType: 'POSM_REQUEST', targetId: String(requestId), targetName: (current as any).store_name,
                    details: { action: 'undo', from: current.status, to: u.status, undid: u.undid.action },
                    ipAddress: req.ip || req.socket?.remoteAddress,
                });
                const storeUser = (current as any).store_user_id;
                if (storeUser && STATUS_NOTE[u.status]) {
                    try {
                        await NotificationService.notify(storeUser, { title: `POSM ${current.ticket_id} ${STATUS_NOTE[u.status]}`, message: `${ACTION_TEXT[u.undid.action]} was undone`, type: 'posm' });
                    } catch (e) { console.error('Failed to notify the store of a POSM undo:', e); }
                }
                const fresh = await posmRepository.findRequest(requestId);
                return res.json({ success: true, message: 'Step undone', data: { ...fresh, actions: actionsFor(u.status) } });
            }

            /* On a request with items the old steps apply to every item they
               fit; the items then decide the request's status. */
            if (itemLines && !['close', 'reopen'].includes(String(action))) {
                const a = String(action) as LineAction;
                if (!['approve', 'hold', 'reject', 'start', 'dispatch', 'deliver', 'resume'].includes(a)) {
                    return res.status(400).json({ success: false, error: 'Unknown action' });
                }
                let out = itemLines, touched: number[] = [];
                if (a === 'approve' && Array.isArray(decisions)) {
                    // Decided before Approve: a 0 or Reject is a rejection, the rest approve at the quantity set.
                    const no = decisions.filter((d: any) => d?.line_status === 'rejected' || Number(d?.approved_qty) === 0)
                        .map((d: any) => ({ index: Number(d.index) })).filter(x => itemLines[x.index]?.line_status === 'pending');
                    if (no.length) {
                        const r = stepLines(out, 'reject', no, { note: 'Not approved' });
                        if ('error' in r) return res.status(400).json({ success: false, error: r.error });
                        out = r.lines; touched = r.touched;
                    }
                }
                const qtyOf = (i: number) => Array.isArray(decisions) ? (decisions as any[]).find(d => Number(d?.index) === i)?.approved_qty : undefined;
                const fit = out.map((l, index) => ({ index, l })).filter(x => lineActionsFor(x.l).includes(a) && !(a === 'approve' && x.l.line_status === 'rejected'))
                    .map(x => ({ index: x.index, qty: a === 'approve' ? qtyOf(x.index) : undefined }));
                if (!fit.length && !touched.length) {
                    return res.status(409).json({ success: false, error: `No item on this request can be ${ACTION_TEXT[a as PosmAction].toLowerCase()} now` });
                }
                const r = stepLines(out, a, fit, { note: a === 'reject' ? reason : note, dispatch, by: 'admin' });
                if ('error' in r) return res.status(400).json({ success: false, error: r.error });
                const said = touched.length
                    ? [r.touched.length ? stepText('approve', r.touched.map(i => r.lines[i].item_name)) : '', stepText('reject', touched.map(i => r.lines[i].item_name))].filter(Boolean).join('; ')
                    : undefined;
                return this.saveLineStep(req, res, current, r.lines, a, [...touched, ...r.touched], String((a === 'reject' ? reason : note) ?? ''), said);
            }

            const moved = nextStatus(current.status, String(action), history);
            if ('error' in moved) return res.status(409).json({ success: false, error: moved.error, data: { actions: actionsFor(current.status) } });
            const a = String(action) as PosmAction;

            const fields: Parameters<typeof posmRepository.updateRequest>[1] = { status: moved.status };
            let stepNote = String(note ?? '').trim().slice(0, 500) || null;
            const lines = Array.isArray(current.items) && current.items.length ? current.items as PosmLine[] : null;

            if (a === 'approve' && lines) {
                let out = lines;
                if (decisions !== undefined) {
                    const applied = applyDecisions(out, decisions);
                    if (!Array.isArray(applied)) return res.status(400).json({ success: false, error: applied.error });
                    out = applied;
                }
                // Approving approves every line still undecided, at its asked quantity.
                out = out.map(l => !l.line_status || l.line_status === 'pending'
                    ? { ...l, line_status: 'approved' as const, approved_qty: l.approved_qty ?? l.qty } : l);
                out = out.map(l => l.line_status === 'approved' && !l.approved_qty ? { ...l, line_status: 'rejected' as const, approved_qty: 0 } : l);
                const ok = out.filter(l => l.line_status === 'approved').length;
                if (!ok) return res.status(400).json({ success: false, error: 'Every item is rejected: reject the request instead' });
                fields.items = out;
                stepNote = `${ok} of ${out.length} item${out.length === 1 ? '' : 's'} approved` + (stepNote ? ` · ${stepNote}` : '');
            }
            if (a === 'reject') {
                const why = String(reason ?? '').trim().slice(0, 1000);
                if (why.length < 3) return res.status(400).json({ success: false, error: 'Give the reason: the store sees it' });
                stepNote = why;
            }
            if (a === 'dispatch') {
                const d = this.readDispatch(dispatch);
                if ('error' in d) return res.status(400).json({ success: false, error: d.error });
                fields.dispatch = d;
                stepNote = [d.courier, d.tracking].filter(Boolean).join(' · ');
            }
            if (a === 'deliver') fields.delivery = { by: 'admin', at: new Date().toISOString(), photos: [] };
            if (a === 'reopen' && lines) {
                // Back to To approve: the decisions are made again.
                fields.items = lines.map(l => ({ ...l, line_status: 'pending' as const, approved_qty: null, note: null, dispatch: null, delivered_at: null, delivered_by: null, trail: [] }));
            }

            fields.history = [...history, step(req, { action: a, status: moved.status, note: stepNote, ...(a === 'hold' ? { from: current.status as HistoryEntry['status'] } : {}) })];
            await posmRepository.updateRequest(requestId, fields);

            // A rejection's reason, and any note, reach the store in the chat too.
            if ((a === 'reject' || (stepNote && String(note ?? '').trim())) && req.user?.id) {
                await posmRepository.createMessage({
                    request_id: requestId, sender_id: req.user.id, sender_role: 'admin',
                    message: a === 'reject' ? `Not approved: ${stepNote}` : String(note).trim().slice(0, 500), attachments: null,
                });
            }

            await ActivityLogService.log({
                adminId: req.user!.id, adminName: (req.user as any)?.name, adminEmail: (req.user as any)?.email,
                actionType: 'POSM_ACTION', targetType: 'POSM_REQUEST', targetId: String(requestId), targetName: (current as any).store_name,
                details: { action: a, from: current.status, to: moved.status, note: stepNote },
                ipAddress: req.ip || req.socket?.remoteAddress,
            });

            const storeUser = (current as any).store_user_id;
            const told = STATUS_NOTE[moved.status];
            if (storeUser && told) {
                try {
                    await NotificationService.notify(storeUser, {
                        title: `POSM ${current.ticket_id} ${a === 'resume' ? 'is moving again' : a === 'reopen' ? 'is reopened' : told}`,
                        message: stepNote || String(current.requirement || '').slice(0, 140),
                        type: 'posm',
                    });
                } catch (e) { console.error('Failed to notify the store of a POSM step:', e); }
            }

            const fresh = await posmRepository.findRequest(requestId);
            return res.json({ success: true, message: ACTION_TEXT[a], data: { ...fresh, actions: actionsFor(moved.status) } });
        } catch (error: any) {
            console.error('POSM action error:', error);
            return res.status(500).json({ success: false, error: 'Failed to update the request' });
        }
    }

    /**
     * A step on some items of a request (Admin only)
     * POST /api/posm/:id/lines — { action, items: [{ index, qty? }], note?, dispatch? }
     * Each item moves on its own (posmLineFlow); the request's status follows.
     */
    actOnLines = async (req: AuthRequest, res: Response) => {
        try {
            const requestId = parseInt(req.params.id);
            const { action, items, note, dispatch } = req.body ?? {};
            const current = await posmRepository.findRequest(requestId);
            if (!current) return res.status(404).json({ success: false, error: 'Request not found' });
            const lines = Array.isArray(current.items) && current.items.length ? current.items as PosmLine[] : null;
            if (!lines) return res.status(400).json({ success: false, error: 'This request has no items: use the steps above' });
            if (!Array.isArray(items) || !items.length) return res.status(400).json({ success: false, error: 'Tick at least one item' });
            const a = String(action) as LineAction;
            const r = stepLines(lines, a, items, { note, dispatch, by: 'admin' });
            if ('error' in r) return res.status(400).json({ success: false, error: r.error });
            if (a === 'edit') {
                const what = editText(lines, r.lines, r.touched);
                if (!what) return res.json({ success: true, message: 'Nothing changed', data: { ...current } });
                return this.saveLineStep(req, res, current, r.lines, a, r.touched, '', what);
            }
            return this.saveLineStep(req, res, current, r.lines, a, r.touched, String(note ?? ''));
        } catch (error: any) {
            console.error('POSM item step error:', error);
            return res.status(500).json({ success: false, error: 'Failed to update the items' });
        }
    }

    /** Saves a step on items: the lines, the request's status, the timeline; tells the store. */
    private async saveLineStep(req: AuthRequest, res: Response, current: any, lines: PosmLine[], a: LineAction, touched: number[], note: string, described?: string) {
        const requestId = current.id as number;
        const status = requestStatus(lines, current.status);
        let text = described ?? stepText(a, touched.map(i => lines[i].item_name), touched.map(i => lines[i]));
        const n = note.trim();
        if (!described && n && n !== 'Not approved') text += ` · ${n.slice(0, 200)}`;
        if (a === 'dispatch') {
            const d = lines[touched[0]]?.dispatch;
            if (d) text += ` · ${[d.courier, d.tracking].filter(Boolean).join(' · ')}`;
        }
        const fields: Parameters<typeof posmRepository.updateRequest>[1] = {
            items: lines,
            history: [...((current.history ?? []) as HistoryEntry[]), step(req, { action: 'item', status: status as HistoryEntry['status'], note: text, lines: touched })],
        };
        if (status !== current.status) fields.status = status;
        // The request-level shipment and delivery follow the latest item's, for the lists.
        const shipped = [...lines].reverse().find(l => l.dispatch?.courier);
        fields.dispatch = shipped?.dispatch ? { ...shipped.dispatch } : null;
        if (status === 'delivered' && !current.delivery) fields.delivery = { by: 'admin', at: new Date().toISOString(), photos: [] };
        if (!['delivered', 'closed'].includes(status) && current.delivery) fields.delivery = null;
        await posmRepository.updateRequest(requestId, fields);

        await ActivityLogService.log({
            adminId: req.user!.id, adminName: (req.user as any)?.name, adminEmail: (req.user as any)?.email,
            actionType: 'POSM_ITEM_ACTION', targetType: 'POSM_REQUEST', targetId: String(requestId), targetName: current.store_name,
            details: { action: a, items: touched, from: current.status, to: status, note: text },
            ipAddress: req.ip || req.socket?.remoteAddress,
        });
        const storeUser = current.store_user_id;
        if (storeUser) {
            try {
                await NotificationService.notify(storeUser, { title: `POSM ${current.ticket_id}: ${text}`.slice(0, 180), message: text.slice(0, 300), type: 'posm' });
            } catch (e) { console.error('Failed to notify the store of a POSM item step:', e); }
        }
        const fresh = await posmRepository.findRequest(requestId);
        return res.json({ success: true, message: text, data: { ...fresh, actions: actionsFor(status) } });
    }

    /**
     * Correct the note on a step of the timeline (Admin only)
     * PUT /api/posm/:id/history/:index — { note }
     */
    editHistoryNote = async (req: AuthRequest, res: Response) => {
        try {
            const requestId = parseInt(req.params.id);
            const index = Number(req.params.index);
            const current = await posmRepository.findRequest(requestId);
            if (!current) return res.status(404).json({ success: false, error: 'Request not found' });
            const history = (current.history ?? []) as HistoryEntry[];
            if (!Number.isInteger(index) || !history[index]) return res.status(404).json({ success: false, error: 'That step is not on this request' });
            if (history[index].by_role !== 'admin') return res.status(400).json({ success: false, error: 'Only the team’s own steps can be corrected' });
            const note = String(req.body?.note ?? '').trim().slice(0, 500);
            if (history[index].action === 'reject' && note.length < 3) return res.status(400).json({ success: false, error: 'Keep a reason for the store' });
            const h = history.map((e, i) => i === index ? { ...e, note: note || null, edited_at: new Date().toISOString(), edited_by_name: (req.user as any)?.name ?? null } : e);
            await posmRepository.updateRequest(requestId, { history: h });
            await ActivityLogService.log({
                adminId: req.user!.id, adminName: (req.user as any)?.name, adminEmail: (req.user as any)?.email,
                actionType: 'POSM_NOTE_EDITED', targetType: 'POSM_REQUEST', targetId: String(requestId), targetName: (current as any).store_name,
                details: { index, was: history[index].note ?? null, now: note || null },
                ipAddress: req.ip || req.socket?.remoteAddress,
            });
            return res.json({ success: true, message: 'Note corrected', data: await posmRepository.findRequest(requestId) });
        } catch (error: any) {
            console.error('Edit POSM history note error:', error);
            return res.status(500).json({ success: false, error: 'Failed to save the note' });
        }
    }
}

export default new POSMController();
