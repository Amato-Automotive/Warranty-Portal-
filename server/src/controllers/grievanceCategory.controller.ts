import { Response } from 'express';
import db from '../config/database.js';
import { v4 as uuidv4 } from 'uuid';
import { AuthRequest } from '../middleware/auth.js';
import { ActivityLogService } from '../services/activity-log.service.js';

/**
 * Grievance categories, managed by an admin rather than in code.
 *
 * A category used to be hardcoded in five places — the column enum, the
 * franchise form, the admin labels, the badge styling, and the routing table
 * that decides who receives the grievance. Adding one meant a deploy, and
 * missing the routing entry sent it silently to the wrong desk.
 *
 * `grievances.category` is now a varchar holding this table's `value`, so
 * adding a category is an ordinary insert.
 */

const SLUG = /^[a-z0-9_]+$/;

/** Kept in step with the icons the admin UI can render. */
const ALLOWED_ICONS = [
    'Package', 'Box', 'Wrench', 'Monitor', 'Zap', 'HelpCircle',
    'Car', 'Truck', 'Shield', 'Wallet', 'Users', 'Store',
];
const ALLOWED_COLORS = [
    'blue', 'emerald', 'amber', 'fuchsia', 'teal', 'slate',
    'rose', 'violet', 'indigo', 'orange', 'cyan', 'lime',
];

export class GrievanceCategoryController {

    /**
     * List categories.
     *
     * `?active=true` gives only the ones a store may pick; the admin screen
     * wants them all, so retired categories can be re-enabled.
     */
    static async list(req: AuthRequest, res: Response) {
        try {
            const activeOnly = req.query.active === 'true';
            const [rows]: any = await db.execute(
                `SELECT c.*,
                        (SELECT COUNT(*) FROM grievances g WHERE g.category = c.value) AS grievance_count
                 FROM grievance_categories c
                 ${activeOnly ? 'WHERE c.is_active = 1' : ''}
                 ORDER BY c.sort_order ASC, c.label ASC`
            );
            res.json({ success: true, categories: rows });
        } catch (error: any) {
            console.error('List grievance categories error:', error);
            res.status(500).json({ error: 'Failed to load categories' });
        }
    }

    /**
     * The active categories as a store's form shows them, for the ASM portal.
     * Names only: who each desk routes to is head office's business.
     */
    static async listForForm(_req: AuthRequest, res: Response) {
        try {
            const [rows]: any = await db.execute(
                `SELECT value, label FROM grievance_categories WHERE is_active = 1 ORDER BY sort_order ASC, label ASC`
            );
            res.json({ success: true, categories: rows });
        } catch (error: any) {
            console.error('List grievance categories for form error:', error);
            res.status(500).json({ error: 'Failed to load categories' });
        }
    }

    static async create(req: AuthRequest, res: Response) {
        try {
            const b = req.body || {};
            const label = String(b.label || '').trim();
            if (!label) return res.status(400).json({ error: 'Give the category a name' });

            // The value is what lands in grievances.category and is matched on
            // forever after, so it is derived once and never edited.
            const value = String(b.value || label)
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '_')
                .replace(/^_+|_+$/g, '')
                .slice(0, 60);

            if (!SLUG.test(value)) {
                return res.status(400).json({ error: 'That name has no letters or digits to build an id from' });
            }

            const [existing]: any = await db.execute(
                `SELECT id FROM grievance_categories WHERE value = ? LIMIT 1`, [value]
            );
            if (existing.length > 0) {
                return res.status(409).json({ error: `A category with the id "${value}" already exists` });
            }

            const email = String(b.assignee_email || '').trim();
            if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
                return res.status(400).json({ error: 'That assignee email does not look valid' });
            }

            const [[maxRow]]: any = await db.execute(
                `SELECT COALESCE(MAX(sort_order), 0) AS m FROM grievance_categories`
            );

            const id = uuidv4();
            await db.execute(
                `INSERT INTO grievance_categories
                   (id, value, label, assignee_name, assignee_email, department, color, icon, sort_order, is_active)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    id, value, label,
                    String(b.assignee_name || '').trim() || null,
                    email || null,
                    String(b.department || '').trim() || label,
                    ALLOWED_COLORS.includes(b.color) ? b.color : 'slate',
                    ALLOWED_ICONS.includes(b.icon) ? b.icon : 'HelpCircle',
                    Number.isInteger(b.sort_order) ? b.sort_order : Number(maxRow.m) + 1,
                    b.is_active === false ? 0 : 1,
                ]
            );

            const admin = (req as any).user;
            await ActivityLogService.log({
                adminId: admin?.id, adminName: admin?.name, adminEmail: admin?.email,
                actionType: 'CREATE_GRIEVANCE_CATEGORY',
                targetType: 'GRIEVANCE_CATEGORY', targetId: id, targetName: label,
                details: { value, assignee_email: email },
                ipAddress: req.ip || req.socket?.remoteAddress
            });

            res.status(201).json({ success: true, message: `"${label}" added`, data: { id, value } });
        } catch (error: any) {
            console.error('Create grievance category error:', error);
            res.status(500).json({ error: 'Failed to add the category' });
        }
    }

    /**
     * Update a category.
     *
     * `value` is deliberately not editable: existing grievances store it, and
     * changing it would orphan every one of them.
     */
    static async update(req: AuthRequest, res: Response) {
        try {
            const { id } = req.params;
            const b = req.body || {};

            const [existing]: any = await db.execute(
                `SELECT * FROM grievance_categories WHERE id = ? LIMIT 1`, [id]
            );
            if (existing.length === 0) return res.status(404).json({ error: 'Category not found' });
            const current = existing[0];

            const updates: string[] = [];
            const values: any[] = [];

            if (b.label !== undefined) {
                const label = String(b.label).trim();
                if (!label) return res.status(400).json({ error: 'The name cannot be empty' });
                updates.push('label = ?'); values.push(label);
            }
            if (b.assignee_name !== undefined) {
                updates.push('assignee_name = ?'); values.push(String(b.assignee_name).trim() || null);
            }
            if (b.assignee_email !== undefined) {
                const email = String(b.assignee_email).trim();
                if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
                    return res.status(400).json({ error: 'That assignee email does not look valid' });
                }
                updates.push('assignee_email = ?'); values.push(email || null);
            }
            if (b.department !== undefined) {
                updates.push('department = ?'); values.push(String(b.department).trim() || null);
            }
            if (b.color !== undefined && ALLOWED_COLORS.includes(b.color)) {
                updates.push('color = ?'); values.push(b.color);
            }
            if (b.icon !== undefined && ALLOWED_ICONS.includes(b.icon)) {
                updates.push('icon = ?'); values.push(b.icon);
            }
            if (b.sort_order !== undefined && Number.isInteger(Number(b.sort_order))) {
                updates.push('sort_order = ?'); values.push(Number(b.sort_order));
            }
            if (b.is_active !== undefined) {
                updates.push('is_active = ?'); values.push(b.is_active ? 1 : 0);
            }

            if (updates.length === 0) {
                return res.status(400).json({ error: 'Nothing to update' });
            }

            values.push(id);
            await db.execute(
                `UPDATE grievance_categories SET ${updates.join(', ')} WHERE id = ?`, values
            );

            const admin = (req as any).user;
            await ActivityLogService.log({
                adminId: admin?.id, adminName: admin?.name, adminEmail: admin?.email,
                actionType: 'UPDATE_GRIEVANCE_CATEGORY',
                targetType: 'GRIEVANCE_CATEGORY', targetId: id, targetName: current.label,
                details: { changed: Object.keys(b) },
                ipAddress: req.ip || req.socket?.remoteAddress
            });

            res.json({ success: true, message: 'Category updated' });
        } catch (error: any) {
            console.error('Update grievance category error:', error);
            res.status(500).json({ error: 'Failed to update the category' });
        }
    }

    /**
     * Remove a category.
     *
     * Only when nothing uses it. A category with grievances behind it is
     * deactivated instead, so those tickets keep a label the admin screens can
     * still resolve — deleting it would leave them showing a raw slug.
     */
    static async remove(req: AuthRequest, res: Response) {
        try {
            const { id } = req.params;
            const [existing]: any = await db.execute(
                `SELECT * FROM grievance_categories WHERE id = ? LIMIT 1`, [id]
            );
            if (existing.length === 0) return res.status(404).json({ error: 'Category not found' });
            const cat = existing[0];

            const [[used]]: any = await db.execute(
                `SELECT COUNT(*) AS n FROM grievances WHERE category = ?`, [cat.value]
            );

            if (Number(used.n) > 0) {
                await db.execute(
                    `UPDATE grievance_categories SET is_active = 0 WHERE id = ?`, [id]
                );
                return res.json({
                    success: true,
                    deactivated: true,
                    message: `"${cat.label}" has ${used.n} grievance${used.n === 1 ? '' : 's'}, so it was turned off rather than deleted. Stores can no longer pick it.`,
                });
            }

            await db.execute(`DELETE FROM grievance_categories WHERE id = ?`, [id]);

            const admin = (req as any).user;
            await ActivityLogService.log({
                adminId: admin?.id, adminName: admin?.name, adminEmail: admin?.email,
                actionType: 'DELETE_GRIEVANCE_CATEGORY',
                targetType: 'GRIEVANCE_CATEGORY', targetId: id, targetName: cat.label,
                details: { value: cat.value },
                ipAddress: req.ip || req.socket?.remoteAddress
            });

            res.json({ success: true, message: `"${cat.label}" deleted` });
        } catch (error: any) {
            console.error('Delete grievance category error:', error);
            res.status(500).json({ error: 'Failed to delete the category' });
        }
    }
}

/**
 * Who a grievance in this category goes to.
 *
 * Falls back to "other", and then to a hardcoded desk, so a grievance is never
 * left unassigned because a category was mid-edit.
 */
export async function resolveCategoryAssignee(category: string): Promise<{ name: string; email: string }> {
    const [rows]: any = await db.execute(
        `SELECT assignee_name, assignee_email FROM grievance_categories
         WHERE value IN (?, 'other') ORDER BY value = ? DESC LIMIT 1`,
        [category, category]
    );
    const hit = rows[0];
    return {
        name: hit?.assignee_name || 'Ashish',
        email: hit?.assignee_email || 'ashish@autoformindia.com',
    };
}
