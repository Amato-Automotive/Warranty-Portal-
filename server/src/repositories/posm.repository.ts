import { BaseRepository } from './base.repository.js';
import type { RowDataPacket, ResultSetHeader, PoolConnection } from 'mysql2/promise';
import { ownStages } from '../services/posmLineFlow.js';
import { heldFrom } from '../services/posmFlow.js';

export interface POSMRequest {
    id: number;
    ticket_id: string;
    franchise_id: string;
    requirement: string;
    created_by_role?: 'franchise' | 'admin' | 'asm';
    created_by?: string | null;
    status: 'open' | 'under_review' | 'approved' | 'in_production' | 'pending' | 'dispatched' | 'delivered' | 'closed' | 'rejected';
    internal_notes?: string | null;
    /** Item lines (posmCatalog.PosmLine[]); null on the older free-text requests. */
    items?: any[] | null;
    /** { courier, tracking, date } once dispatched. */
    dispatch?: Record<string, unknown> | null;
    /** { by: 'franchise' | 'admin', at, photos[] } once delivered. */
    delivery?: Record<string, unknown> | null;
    /** Each step taken (posmFlow.HistoryEntry[]); null on requests from before it. */
    history?: any[] | null;
    created_at?: Date;
    updated_at?: Date;
}

export interface POSMMessage {
    id: number;
    request_id: number;
    sender_id: string;
    sender_role: 'admin' | 'franchise' | 'asm';
    message: string | null;
    attachments: any | null; // JSON string or parsed object
    created_at?: Date;
}

export class POSMRepository extends BaseRepository<POSMRequest> {
    constructor() {
        super('posm_requests', 'id');
    }

    /**
     * Create a new POSM request and return the inserted ID
     */
    async createPOSMRequest(request: Omit<POSMRequest, 'id'>, connection?: PoolConnection): Promise<number> {
        const result = await this.execute(
            `INSERT INTO posm_requests (ticket_id, franchise_id, requirement, created_by_role, created_by, status, items, history)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [request.ticket_id, request.franchise_id, request.requirement,
             request.created_by_role || 'franchise', request.created_by ?? null,
             request.status || 'open', request.items ? JSON.stringify(request.items) : null,
             request.history ? JSON.stringify(request.history) : null],
            connection
        );
        return result.insertId;
    }

    /**
     * Get all requests for a specific franchise
     */
    async getFranchiseRequests(franchiseId: string, connection?: PoolConnection): Promise<POSMRequest[]> {
        const rows = await this.query<RowDataPacket[]>(
            `SELECT r.*, creator.name AS created_by_name
             FROM posm_requests r
             LEFT JOIN profiles creator ON creator.id = r.created_by
             WHERE r.franchise_id = ? ORDER BY r.created_at DESC`,
            [franchiseId],
            connection
        );
        return (rows as any[]).map(withJson) as POSMRequest[];
    }

    /** One request with its JSON columns read. */
    async findRequest(requestId: number, connection?: PoolConnection): Promise<POSMRequest | null> {
        const rows = await this.query<RowDataPacket[]>(
            `SELECT r.*, vd.store_name, vd.allowed_brands, vd.user_id AS store_user_id FROM posm_requests r
             LEFT JOIN vendor_details vd ON vd.id = r.franchise_id WHERE r.id = ?`,
            [requestId],
            connection
        );
        return rows.length ? withJson(rows[0]) as POSMRequest : null;
    }

    /** Set any of: status, internal notes, item lines, dispatch, delivery. */
    async updateRequest(requestId: number, fields: {
        status?: string; internal_notes?: string | null; items?: any[]; dispatch?: Record<string, unknown> | null;
        delivery?: Record<string, unknown> | null; history?: any[];
    }, connection?: PoolConnection): Promise<boolean> {
        const sets: string[] = [], params: any[] = [];
        for (const [col, v] of Object.entries(fields)) {
            if (v === undefined) continue;
            sets.push(`${col} = ?`);
            params.push(['items', 'dispatch', 'delivery', 'history'].includes(col) && v !== null ? JSON.stringify(v) : v);
        }
        if (!sets.length) return true;
        params.push(requestId);
        const result = await this.execute(`UPDATE posm_requests SET ${sets.join(', ')} WHERE id = ?`, params, connection);
        return result.affectedRows > 0;
    }

    /**
     * Get messages for a specific request
     */
    async getMessages(requestId: number, connection?: PoolConnection): Promise<POSMMessage[]> {
        const rows = await this.query<RowDataPacket[]>(
            // sender_name labels an ASM's message with who wrote it.
            `SELECT m.*, sender.name AS sender_name FROM posm_messages m
             LEFT JOIN profiles sender ON sender.id = m.sender_id
             WHERE m.request_id = ? ORDER BY m.created_at ASC`,
            [requestId],
            connection
        );

        return (rows as any[]).map(msg => ({
            ...msg,
            attachments: typeof msg.attachments === 'string' ? JSON.parse(msg.attachments) : msg.attachments
        })) as POSMMessage[];
    }

    /**
     * Create a new message
     */
    async createMessage(message: Omit<POSMMessage, 'id'>, connection?: PoolConnection): Promise<number> {
        const result = await this.execute(
            `INSERT INTO posm_messages (request_id, sender_id, sender_role, message, attachments) 
             VALUES (?, ?, ?, ?, ?)`,
            [
                message.request_id,
                message.sender_id,
                message.sender_role,
                message.message,
                message.attachments ? JSON.stringify(message.attachments) : null
            ],
            connection
        );
        return result.insertId;
    }

    /**
     * Update request status and optionally internal notes
     */
    async updateStatus(requestId: number, status: string, internalNotes?: string | null, connection?: PoolConnection): Promise<boolean> {
        let sql = `UPDATE posm_requests SET status = ?`;
        const params: any[] = [status];

        if (internalNotes !== undefined) {
            sql += `, internal_notes = ?`;
            params.push(internalNotes);
        }

        sql += ` WHERE id = ?`;
        params.push(requestId);

        const result = await this.execute(sql, params, connection);
        return result.affectedRows > 0;
    }

    /**
     * Get all requests for admin with franchise details
     */
    async getAllRequests(connection?: PoolConnection): Promise<any[]> {
        const rows = await this.query<RowDataPacket[]>(
            `SELECT 
                r.*,
                vd.store_name,
                vd.store_code,
                vd.address AS store_address,
                vd.city AS store_city,
                vd.state AS store_state,
                vd.pincode AS store_pincode,
                vd.allowed_brands,
                p.name as contact_name,
                p.email as contact_email,
                creator.name as created_by_name
             FROM posm_requests r
             JOIN vendor_details vd ON r.franchise_id = vd.id
             JOIN profiles p ON vd.user_id = p.id
             LEFT JOIN profiles creator ON creator.id = r.created_by
             ORDER BY r.created_at DESC`,
            [],
            connection
        );
        return (rows as any[]).map(withJson);
    }

    /**
     * Get total count of open requests for admin overview
     */
    async getOpenRequestsCount(connection?: PoolConnection): Promise<number> {
        return this.count("status != 'closed' AND status != 'rejected'", [], connection);
    }
}

/* mysql2 returns JSON columns parsed, but a string can still arrive (an older
   row written as text); either way the caller gets objects. */
function withJson(row: any) {
    for (const col of ['items', 'dispatch', 'delivery', 'history']) {
        if (typeof row[col] === 'string') {
            try { row[col] = JSON.parse(row[col]); } catch { row[col] = null; }
        }
    }
    // Requests from before items moved on their own: each item takes the request's stage.
    if (Array.isArray(row.items) && row.items.length) {
        row.items = ownStages(row.items, { status: row.status, dispatch: row.dispatch, delivery: row.delivery, heldFrom: heldFrom(row.history) });
    }
    return row;
}

export const posmRepository = new POSMRepository();
