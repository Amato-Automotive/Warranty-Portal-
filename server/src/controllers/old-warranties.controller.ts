import { Request, Response } from 'express';
import db from '../config/database.js';

/**
 * Old Warranties Controller
 * Handles archived warranty records (standalone, not connected to main system)
 */
export class OldWarrantiesController {

    /**
     * Get old seat cover warranties with search and pagination
     */
    static async getSeatCoverWarranties(req: Request, res: Response) {
        try {
            const {
                search = '',
                warranty_type,
                store_name,
                date_from,
                date_to,
                page = 1,
                limit = 50,
                sort_by = 'purchase_date',
                sort_order = 'DESC'
            } = req.query;

            const pageNum = parseInt(page as string) || 1;
            const limitNum = parseInt(limit as string) || 50;
            const offset = (pageNum - 1) * limitNum;

            // Validate sort columns to prevent SQL injection
            const allowedSortColumns = ['uid', 'customer_name', 'customer_email', 'store_name', 'purchase_date', 'warranty_type', 'created_at'];
            const sortColumn = allowedSortColumns.includes(sort_by as string) ? sort_by : 'purchase_date';
            const sortDir = (sort_order as string)?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

            let whereConditions: string[] = [];
            let params: any[] = [];

            // Full-text search across multiple columns
            if (search && (search as string).trim()) {
                const searchTerm = (search as string).trim();

                /* Full-text matches whole words; the LIKEs catch partial UIDs, phones
                   and emails. Boolean mode reads @ + - < > ( ) ~ " * as operators (an
                   email search failed with a syntax error), so the full-text side
                   gets only the words, every one required, each as a prefix; words
                   under 3 letters are left to the LIKEs (the index skips them). */
                const words = searchTerm.split(/[^\p{L}\p{N}_]+/u).filter(w => w.length >= 3).map(w => `+${w}*`).join(' ');
                whereConditions.push(`(
                    ${words ? 'MATCH(uid, customer_name, customer_email, customer_mobile, store_name) AGAINST(? IN BOOLEAN MODE) OR' : ''}
                    uid LIKE ?
                    OR customer_name LIKE ?
                    OR customer_email LIKE ?
                    OR customer_mobile LIKE ?
                    OR store_name LIKE ?
                )`);
                if (words) params.push(words);
                params.push(`%${searchTerm}%`);
                params.push(`%${searchTerm}%`);
                params.push(`%${searchTerm}%`);
                params.push(`%${searchTerm}%`);
                params.push(`%${searchTerm}%`);
            }

            // Filter by warranty type
            if (warranty_type && (warranty_type as string).trim()) {
                whereConditions.push('warranty_type = ?');
                params.push(warranty_type);
            }

            // Filter by store name (exact or partial)
            if (store_name && (store_name as string).trim()) {
                whereConditions.push('store_name LIKE ?');
                params.push(`%${store_name}%`);
            }

            // Filter by date range
            if (date_from) {
                whereConditions.push('purchase_date >= ?');
                params.push(date_from);
            }
            if (date_to) {
                whereConditions.push('purchase_date <= ?');
                params.push(date_to);
            }

            const whereClause = whereConditions.length > 0
                ? `WHERE ${whereConditions.join(' AND ')}`
                : '';

            // Get total count
            const [countResult]: any = await db.execute(
                `SELECT COUNT(*) as total FROM old_warranties_seatcovers ${whereClause}`,
                params
            );
            const totalCount = countResult[0].total;
            const totalPages = Math.ceil(totalCount / limitNum);

            // Get paginated results
            const [warranties]: any = await db.execute(
                `SELECT * FROM old_warranties_seatcovers 
                 ${whereClause}
                 ORDER BY ${sortColumn} ${sortDir}
                 LIMIT ? OFFSET ?`,
                [...params, limitNum, offset]
            );

            res.json({
                success: true,
                warranties,
                pagination: {
                    currentPage: pageNum,
                    totalPages,
                    totalCount,
                    limit: limitNum,
                    hasNextPage: pageNum < totalPages,
                    hasPrevPage: pageNum > 1
                }
            });
        } catch (error: any) {
            console.error('Get old seat cover warranties error:', error);
            res.status(500).json({ error: 'Failed to fetch old warranties' });
        }
    }

    /**
     * Get warranty type options for filter dropdown
     */
    static async getWarrantyTypes(req: Request, res: Response) {
        try {
            const [types]: any = await db.execute(
                `SELECT DISTINCT warranty_type FROM old_warranties_seatcovers 
                 WHERE warranty_type IS NOT NULL AND warranty_type != ''
                 ORDER BY warranty_type`
            );
            res.json({
                success: true,
                warrantyTypes: types.map((t: any) => t.warranty_type)
            });
        } catch (error: any) {
            console.error('Get warranty types error:', error);
            res.status(500).json({ error: 'Failed to fetch warranty types' });
        }
    }

    /**
     * Get store name options for filter dropdown
     */
    static async getStoreNames(req: Request, res: Response) {
        try {
            const [stores]: any = await db.execute(
                `SELECT DISTINCT store_name FROM old_warranties_seatcovers 
                 WHERE store_name IS NOT NULL AND store_name != ''
                 ORDER BY store_name
                 LIMIT 500`  // Limit to prevent huge dropdown
            );
            res.json({
                success: true,
                storeNames: stores.map((s: any) => s.store_name)
            });
        } catch (error: any) {
            console.error('Get store names error:', error);
            res.status(500).json({ error: 'Failed to fetch store names' });
        }
    }

    /**
     * Get dashboard stats for old warranties
     */
    static async getStats(req: Request, res: Response) {
        try {
            const [stats]: any = await db.execute(`
                SELECT 
                    COUNT(*) as total_records,
                    COUNT(DISTINCT store_name) as unique_stores,
                    COUNT(DISTINCT customer_email) as unique_customers,
                    MIN(purchase_date) as earliest_date,
                    MAX(purchase_date) as latest_date
                FROM old_warranties_seatcovers
            `);

            res.json({
                success: true,
                stats: stats[0]
            });
        } catch (error: any) {
            console.error('Get old warranties stats error:', error);
            res.status(500).json({ error: 'Failed to fetch stats' });
        }
    }

    /**
     * Export warranties to CSV format
     */
    static async exportCSV(req: Request, res: Response) {
        try {
            const { search, warranty_type, store_name, date_from, date_to } = req.query;

            let whereConditions: string[] = [];
            let params: any[] = [];

            if (search && (search as string).trim()) {
                const searchTerm = (search as string).trim();
                whereConditions.push(`(
                    uid LIKE ? OR customer_name LIKE ? OR customer_email LIKE ? 
                    OR customer_mobile LIKE ? OR store_name LIKE ?
                )`);
                params.push(`%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`);
            }

            if (warranty_type) {
                whereConditions.push('warranty_type = ?');
                params.push(warranty_type);
            }

            if (store_name) {
                whereConditions.push('store_name LIKE ?');
                params.push(`%${store_name}%`);
            }

            if (date_from) {
                whereConditions.push('purchase_date >= ?');
                params.push(date_from);
            }

            if (date_to) {
                whereConditions.push('purchase_date <= ?');
                params.push(date_to);
            }

            const whereClause = whereConditions.length > 0
                ? `WHERE ${whereConditions.join(' AND ')}`
                : '';

            const [warranties]: any = await db.execute(
                `SELECT uid, customer_name, customer_email, customer_mobile, 
                        product_name, warranty_type, store_email, purchase_date, 
                        store_name, file_proof_url
                 FROM old_warranties_seatcovers 
                 ${whereClause}
                 ORDER BY purchase_date DESC
                 LIMIT 10000`,  // Safety limit
                params
            );

            res.json({
                success: true,
                data: warranties,
                count: warranties.length
            });
        } catch (error: any) {
            console.error('Export old warranties error:', error);
            res.status(500).json({ error: 'Failed to export warranties' });
        }
    }
}
