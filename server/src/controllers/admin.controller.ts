import { Request, Response } from 'express';
import db, { getISTTimestamp } from '../config/database.js';
import { EmailService } from '../services/email.service.js';
import { ActivityLogService } from '../services/activity-log.service.js';
import { fieldChanges } from '../services/profileChanges.js';
import { listMonths, roundsInMonth, storesInMonth, allCampaignsInMonth } from '../services/auditMonth.service.js';
import { parseContacts, matchContacts, saveContacts, syncRoundTargets } from '../services/auditContacts.service.js';
import { NotificationService } from '../services/notification.service.js';
import { WhatsAppService } from '../services/whatsapp.service.js';
import { v4 as uuidv4 } from 'uuid';
import { invalidateSessionState } from '../middleware/auth.js';
import { getAttentionCounts } from '../services/adminAttention.service.js';
import { getRollCapacitySqft, issueSerials, parseRolls, reserveRolls } from '../services/ppfRoll.service.js';
import { withTransaction } from '../utils/transaction.js';
import {
    getMobileRegistrationUsage,
    normalizeCustomerMobile
} from '../utils/customerMobileLimits.js';
import {
    NOTIFICATION_TYPES,
    getNotificationSettings as loadNotificationSettings,
    saveNotificationSettings,
    getNotificationWindows as loadNotificationWindows,
    saveNotificationWindow,
    type NotificationWindow
} from '../services/notificationSettings.service.js';
import {
    getReminderSettings,
    saveReminderSettings,
    previewInitialRun,
    runReminderPass,
    getReminderProgress,
    abortReminderRun,
    sendTestReminder,
    preflightCheck,
    lastReminderFailure,
    countEverReminded
} from '../services/warrantyReminder.service.js';

/**
 * Run a promise-returning function with retries and exponential backoff
 */
async function runWithRetry<T>(
    fn: () => Promise<T>,
    retries = 3,
    initialDelay = 5000,
    description = 'operation'
): Promise<T> {
    let lastError: any;
    let delay = initialDelay;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (error: any) {
            lastError = error;
            console.warn(`[Retry] Attempt ${attempt} failed for ${description}. Error: ${error?.message || error}`);
            if (attempt < retries) {
                console.log(`[Retry] Waiting ${delay}ms before next attempt...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 3; // Exponential backoff: 5s, 15s, 45s...
            }
        }
    }
    console.error(`[Retry] All ${retries} attempts failed for ${description}. Final error:`, lastError);
    throw lastError;
}

/**
 * Image slots an admin may replace.
 *
 * Seat covers carry vehicle/seatCover/carOuter; PPF and SPF carry the four
 * corner shots. Keeping this an allow-list means a bad `field` cannot write an
 * arbitrary key into product_details.
 */
const REPLACEABLE_PHOTO_FIELDS = new Set([
    'invoiceFileName',
    'vehicle', 'seatCover', 'carOuter',
    'lhs', 'rhs', 'frontReg', 'backReg', 'warranty',
]);

export class AdminController {
    /**
     * Sidebar badge counts — grievances still `submitted`, POSM requests still
     * `open`. Only modules this admin can read are included, using the
     * permissions authenticateToken just resolved from the database.
     */
    static async getAttentionCounts(req: Request, res: Response) {
        try {
            const user = (req as any).user || {};
            res.json({ success: true, counts: await getAttentionCounts(user) });
        } catch (error: any) {
            console.error('Attention counts error:', error);
            res.status(500).json({ success: false, error: 'Failed to load counts' });
        }
    }

    static async getDashboardStats(_req: Request, res: Response) {
        try {
            // The overview is the first admin screen. Keep its independent aggregates
            // concurrent and combine warranty status counts in one table scan.
            const [summaryResult, activeFranchisesResult, customersResult, monthlyStatsResult]: any = await Promise.all([
                db.execute(`
                    SELECT
                        COUNT(*) AS total_warranties,
                        COALESCE(SUM(status = 'pending'), 0) AS pending_approvals,
                        COALESCE(SUM(status = 'pending_vendor'), 0) AS pending_vendor_approvals,
                        COALESCE(SUM(status = 'validated'), 0) AS validated_warranties,
                        COALESCE(SUM(status = 'rejected'), 0) AS rejected_warranties
                    FROM warranty_registrations
                `),
                db.execute(`
                    SELECT COUNT(DISTINCT vd.id) AS count
                    FROM vendor_details vd
                    JOIN user_roles ur ON ur.user_id = vd.user_id AND ur.role = 'vendor'
                    JOIN (
                        -- Warranty activity, by the store id each warranty
                        -- carries (services/warrantyStore.ts), plus a franchise's
                        -- own submissions that have no store yet.
                        SELECT wr.vendor_details_id AS franchise_id
                        FROM warranty_registrations wr
                        WHERE wr.vendor_details_id IS NOT NULL

                        UNION

                        SELECT vd_direct.id AS franchise_id
                        FROM warranty_registrations wr
                        JOIN vendor_details vd_direct ON vd_direct.user_id = wr.user_id
                        WHERE wr.vendor_details_id IS NULL

                        UNION

                        SELECT franchise_id
                        FROM posm_requests
                        WHERE franchise_id IS NOT NULL

                        UNION

                        -- A grievance can be assigned to a franchise or submitted by it.
                        SELECT franchise_id
                        FROM grievances
                        WHERE franchise_id IS NOT NULL

                        UNION

                        SELECT vd_grievance.id AS franchise_id
                        FROM grievances g
                        JOIN vendor_details vd_grievance
                          ON g.source_type = 'franchise'
                         AND g.customer_id = vd_grievance.user_id
                    ) activity ON activity.franchise_id = vd.id
                    WHERE COALESCE(vd.is_franchise, TRUE) = TRUE
                `),
                // Registered customers plus unique guest warranty registrations.
                // Keep email and phone lookups separate: the previous OR join made
                // MySQL scan the entire customer set for every guest registration.
                db.execute(`
                    SELECT COUNT(*) AS count
                    FROM (
                        SELECT p.name AS customer_name, p.email, p.phone_number
                        FROM profiles p
                        JOIN user_roles ur ON ur.user_id = p.id AND ur.role = 'customer'
                        WHERE p.email NOT IN (
                            SELECT vendor_profile.email
                            FROM profiles vendor_profile
                            JOIN user_roles vendor_role
                              ON vendor_role.user_id = vendor_profile.id
                             AND vendor_role.role = 'vendor'
                        )

                        UNION

                        SELECT guest.customer_name, guest.customer_email AS email, guest.customer_phone AS phone_number
                        FROM (
                            SELECT customer_name, customer_email, customer_phone
                            FROM warranty_registrations
                            GROUP BY customer_name, customer_email, customer_phone
                        ) guest
                        WHERE NOT EXISTS (
                            SELECT 1
                            FROM profiles customer_email_profile
                            JOIN user_roles customer_email_role
                              ON customer_email_role.user_id = customer_email_profile.id
                             AND customer_email_role.role = 'customer'
                            WHERE customer_email_profile.email = guest.customer_email
                        )
                        AND NOT EXISTS (
                            SELECT 1
                            FROM profiles customer_phone_profile
                            JOIN user_roles customer_phone_role
                              ON customer_phone_role.user_id = customer_phone_profile.id
                             AND customer_phone_role.role = 'customer'
                            WHERE customer_phone_profile.phone_number = guest.customer_phone
                        )
                        AND NOT EXISTS (
                            SELECT 1
                            FROM profiles vendor_profile
                            JOIN user_roles vendor_role
                              ON vendor_role.user_id = vendor_profile.id
                             AND vendor_role.role = 'vendor'
                            WHERE vendor_profile.email = guest.customer_email
                              AND vendor_profile.name = guest.customer_name
                        )
                        AND (
                            (guest.customer_email IS NOT NULL AND guest.customer_email != '' AND guest.customer_email != 'N/A')
                            OR
                            (guest.customer_phone IS NOT NULL AND guest.customer_phone != '' AND guest.customer_phone != 'N/A')
                        )
                    ) combined
                `),
                db.execute(`
                SELECT 
                    DATE_FORMAT(created_at, '%Y-%m') as month,
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'validated' THEN 1 ELSE 0 END) as approved,
                    SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
                    SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_admin,
                    SUM(CASE WHEN status = 'pending_vendor' THEN 1 ELSE 0 END) as pending_vendor
                FROM warranty_registrations 
                WHERE created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
                GROUP BY DATE_FORMAT(created_at, '%Y-%m')
                ORDER BY month ASC
                `)
            ]);

            const summary = summaryResult[0][0];
            const activeFranchises = Number(activeFranchisesResult[0][0]?.count || 0);
            const totalCustomers = Number(customersResult[0][0]?.count || 0);
            const monthlyStats = monthlyStatsResult[0];

            res.json({
                success: true,
                stats: {
                    totalWarranties: Number(summary.total_warranties || 0),
                    activeFranchises,
                    totalCustomers,
                    pendingApprovals: Number(summary.pending_approvals || 0),
                    pendingVendorApprovals: Number(summary.pending_vendor_approvals || 0),
                    validatedWarranties: Number(summary.validated_warranties || 0),
                    rejectedWarranties: Number(summary.rejected_warranties || 0),
                    monthlyStats
                }
            });
        } catch (error: any) {
            console.error('Get dashboard stats error:', error);
            res.status(500).json({ error: 'Failed to fetch dashboard stats' });
        }
    }

    static async getAllVendors(req: Request, res: Response) {
        try {
            const { startDate, endDate, dateField } = req.query as { startDate?: string; endDate?: string; dateField?: string };
            const hasRange = Boolean(startDate && endDate);
            const rangeColumn = dateField === 'purchase_date' ? 'u.purchase_date' : 'u.created_at';

            // Warranty attribution (manpower / installer match / user_id) is computed
            // once via a UNION of three indexed join paths (deduped per vendor+uid),
            // then aggregated in a single GROUP BY — instead of re-evaluating an
            // un-indexable triple-OR condition in 12 correlated subqueries per vendor.
            // When no date range is given, in_range is 1 so range_* equal the totals,
            // matching the old behaviour.
            const inRangeExpr = hasRange
                ? `CASE WHEN ${rangeColumn} BETWEEN ? AND ? THEN 1 ELSE 0 END`
                : '1';
            const queryParams = hasRange ? [`${startDate} 00:00:00`, `${endDate} 23:59:59`] : [];

            const query = `
                SELECT
                    p.id,
                    p.name as contact_name,
                    p.email,
                    p.phone_number,
                    vd.store_name,
                    vd.store_email,
                    vd.city,
                    vd.state,
                    vd.address as full_address,
                    vd.pincode,
                    vd.latitude,
                    vd.longitude,
                    dist.id as distributor_id,
                    COALESCE(vv.is_verified, false) as is_verified,
                    COALESCE(vv.is_active, true) as is_active,
                    COALESCE(vd.is_distributor, false) as is_distributor,
                    COALESCE(vd.is_franchise, true) as is_franchise,
                    vv.verified_at,
                    vv.rejection_reason,
                    COALESCE(mp.manpower_count, 0) as manpower_count,
                    mp.manpower_names,
                    COALESCE(wagg.total_warranties, 0) as total_warranties,
                    COALESCE(wagg.validated_warranties, 0) as validated_warranties,
                    COALESCE(wagg.pending_warranties, 0) as pending_warranties,
                    COALESCE(wagg.rejected_warranties, 0) as rejected_warranties,
                    COALESCE(wagg.range_total_warranties, 0) as range_total_warranties,
                    COALESCE(wagg.range_validated_warranties, 0) as range_validated_warranties,
                    COALESCE(wagg.range_pending_warranties, 0) as range_pending_warranties,
                    COALESCE(wagg.range_rejected_warranties, 0) as range_rejected_warranties,
                    COALESCE(oa.order_pending_count, 0) as order_pending_count,
                    COALESCE(oa.order_confirmed_count, 0) as order_confirmed_count,
                    COALESCE(oa.order_declined_count, 0) as order_declined_count,
                    COALESCE(oa.order_total_count, 0) as order_total_count,
                    cats.allowed_category_names,
                    COALESCE(dist.allowed_brands, 'AF') as distributor_allowed_brands,
                    COALESCE(vd.allowed_brands, 'AF') as franchise_allowed_brands
                FROM profiles p
                JOIN user_roles ur ON p.id = ur.user_id
                LEFT JOIN vendor_details vd ON p.id = vd.user_id
                LEFT JOIN vendor_verification vv ON p.id = vv.user_id
                LEFT JOIN distributors dist ON dist.profile_id = p.id
                LEFT JOIN (
                    SELECT vendor_id,
                           COUNT(*) as manpower_count,
                           GROUP_CONCAT(name SEPARATOR ', ') as manpower_names
                    FROM manpower
                    GROUP BY vendor_id
                ) mp ON mp.vendor_id = vd.id
                LEFT JOIN (
                    SELECT t.vkey,
                           COUNT(*) as total_warranties,
                           SUM(CASE WHEN t.status = 'validated' THEN 1 ELSE 0 END) as validated_warranties,
                           SUM(CASE WHEN t.status IN ('pending', 'pending_vendor') THEN 1 ELSE 0 END) as pending_warranties,
                           SUM(CASE WHEN t.status = 'rejected' THEN 1 ELSE 0 END) as rejected_warranties,
                           SUM(t.in_range) as range_total_warranties,
                           SUM(CASE WHEN t.in_range = 1 AND t.status = 'validated' THEN 1 ELSE 0 END) as range_validated_warranties,
                           SUM(CASE WHEN t.in_range = 1 AND t.status IN ('pending', 'pending_vendor') THEN 1 ELSE 0 END) as range_pending_warranties,
                           SUM(CASE WHEN t.in_range = 1 AND t.status = 'rejected' THEN 1 ELSE 0 END) as range_rejected_warranties
                    FROM (
                        SELECT u.vkey, u.status, ${inRangeExpr} as in_range
                        FROM (
                            -- Each warranty counts once, for the store id it carries
                            -- (services/warrantyStore.ts); one with no store yet
                            -- counts for the franchise account that submitted it.
                            SELECT vd2.user_id as vkey, wr.uid, wr.status, wr.created_at, wr.purchase_date
                            FROM warranty_registrations wr
                            JOIN vendor_details vd2 ON vd2.id = wr.vendor_details_id
                            UNION ALL
                            SELECT wr.user_id, wr.uid, wr.status, wr.created_at, wr.purchase_date
                            FROM warranty_registrations wr
                            WHERE wr.vendor_details_id IS NULL
                        ) u
                    ) t
                    GROUP BY t.vkey
                ) wagg ON wagg.vkey = p.id
                LEFT JOIN (
                    SELECT distributor_id,
                           SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as order_pending_count,
                           SUM(CASE WHEN status IN ('processing', 'shipped', 'delivered') THEN 1 ELSE 0 END) as order_confirmed_count,
                           SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as order_declined_count,
                           COUNT(*) as order_total_count
                    FROM store_orders
                    GROUP BY distributor_id
                ) oa ON oa.distributor_id = dist.id
                LEFT JOIN (
                    SELECT dac.distributor_id,
                           GROUP_CONCAT(sc.name ORDER BY sc.name SEPARATOR ', ') as allowed_category_names
                    FROM distributor_allowed_categories dac
                    JOIN store_categories sc ON sc.id = dac.category_id
                    GROUP BY dac.distributor_id
                ) cats ON cats.distributor_id = dist.id
                WHERE ur.role = 'vendor'
                ORDER BY p.created_at DESC
            `;

            const [vendorsList]: any = await db.execute(query, queryParams);

            console.log(`[Admin] Fetched ${vendorsList.length} vendors`);

            res.json({
                success: true,
                vendors: vendorsList
            });
        } catch (error: any) {
            console.error('Get all vendors error:', error);
            res.status(500).json({ error: 'Failed to fetch vendors' });
        }
    }

    static async getVendorDetails(req: Request, res: Response) {
        try {
            const { id } = req.params;

            // Get vendor profile and details
            const [vendor]: any = await db.execute(`
                SELECT 
                    p.id AS user_id,
                    p.name AS contact_name,
                    p.email,
                    p.phone_number,
                    dist.id AS distributor_id,
                    vd.id AS vendor_details_id,
                    vd.store_name,
                    vd.store_email,
                    vd.store_code,
                    vd.address,
                    vd.city,
                    vd.state,
                    vd.pincode,
                    vd.latitude,
                    vd.longitude,
                    -- A franchise has no distributors row, so dist.gst_number is always
                    -- NULL for one. Fall back to the franchise's own column.
                    COALESCE(dist.gst_number, vd.gst_number) AS gst_number,
                    dist.area_head_name,
                    vv.is_verified,
                    COALESCE(vv.is_active, true) as is_active,
                    vv.verified_at,
                    vv.rejection_reason,
                    COALESCE(dist.allowed_brands, 'AF') as distributor_allowed_brands,
                    COALESCE(vd.allowed_brands, 'AF') as franchise_allowed_brands
                FROM profiles p
                LEFT JOIN vendor_details vd ON p.id = vd.user_id
                LEFT JOIN vendor_verification vv ON p.id = vv.user_id
                LEFT JOIN distributors dist ON dist.profile_id = p.id
                WHERE p.id = ?
            `, [id]);

            if (vendor.length === 0) {
                return res.status(404).json({ error: 'Vendor not found' });
            }

            const vendorData = vendor[0];
            // This store's warranties are the ones carrying its store id (see
            // services/warrantyStore.ts), plus anything its account submitted that
            // has no store yet — the same rule as the franchise's own dashboard.
            // Never by name: stores share names, and matching on one showed
            // Patan's warranties under Kalol and Kadi (Sept 2026).
            const storeScope = vendorData.vendor_details_id
                ? { sql: '(wr.vendor_details_id = ? OR (wr.vendor_details_id IS NULL AND wr.user_id = ?))', params: [vendorData.vendor_details_id, vendorData.user_id] }
                : { sql: 'wr.user_id = ?', params: [vendorData.user_id] };

            // Get manpower using vendor_details_id with points system
            let manpower: any[] = [];
            if (vendorData.vendor_details_id) {
                const [manpowerResult]: any = await db.execute(`
                    SELECT 
                        m.*,
                        (SELECT COUNT(*) FROM warranty_registrations w WHERE w.manpower_id = m.id) as total_applications,
                        (SELECT COUNT(*) FROM warranty_registrations w 
                         WHERE w.manpower_id = m.id AND w.status = 'validated') as points,
                        (SELECT COUNT(*) FROM warranty_registrations w 
                         WHERE w.manpower_id = m.id AND w.status IN ('pending', 'pending_vendor')) as pending_points,
                        (SELECT COUNT(*) FROM warranty_registrations w 
                         WHERE w.manpower_id = m.id AND w.status = 'rejected') as rejected_points
                    FROM manpower m 
                    WHERE m.vendor_id = ?
                    ORDER BY points DESC, m.name ASC
                `, [vendorData.vendor_details_id]);
                manpower = manpowerResult;

                // Check for "Store Owner" (Default) submissions
                const [ownerStats]: any = await db.execute(`
                    SELECT 
                        COUNT(*) as total_applications,
                        SUM(CASE WHEN status = 'validated' THEN 1 ELSE 0 END) as points,
                        SUM(CASE WHEN status IN ('pending', 'pending_vendor') THEN 1 ELSE 0 END) as pending_points,
                        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected_points
                    FROM warranty_registrations wr
                    WHERE (wr.manpower_id IS NULL OR wr.manpower_id = '' OR wr.manpower_id LIKE 'owner%')
                      AND ${storeScope.sql}
                `, storeScope.params);

                if (ownerStats[0].total_applications > 0) {
                    manpower.push({
                        id: 'owner',
                        vendor_id: vendorData.vendor_details_id,
                        name: `${vendorData.contact_name} (Store Owner)`,
                        phone: vendorData.phone_number,
                        is_active: 1,
                        // The owner is not a manpower record and has nothing to
                        // approve. Without this the UI reads !undefined as true
                        // and files them under "Pending Approval", offering an
                        // Approve button that has no row to update.
                        is_approved: 1,
                        total_applications: ownerStats[0].total_applications,
                        points: ownerStats[0].points || 0,
                        pending_points: ownerStats[0].pending_points || 0,
                        rejected_points: ownerStats[0].rejected_points || 0,
                        is_virtual: true
                    });
                }
            }

            const [warrantyList]: any = await db.execute(`
                SELECT wr.*, 
                       p.name as submitted_by_name, 
                       p.email as submitted_by_email,
                       m.name as manpower_name_from_db,
                       vd_s.store_name as vendor_store_name,
                       vd_s.store_email as vendor_store_email,
                       vd_s.city as vendor_city,
                       vp.phone_number as vendor_phone_number,
                       vd_s.latitude as store_lat,
                       vd_s.longitude as store_lng
                FROM warranty_registrations wr
                LEFT JOIN profiles p ON wr.user_id = p.id
                LEFT JOIN manpower m ON wr.manpower_id = m.id
                LEFT JOIN vendor_details vd_s ON vd_s.id = wr.vendor_details_id
                LEFT JOIN profiles vp ON vd_s.user_id = vp.id
                WHERE ${storeScope.sql}
                ORDER BY wr.created_at DESC
            `, storeScope.params);

            res.json({
                success: true,
                vendor: vendorData,
                manpower,
                warranties: warrantyList
            });
        } catch (error: any) {
            console.error('Get vendor details error:', error);
            res.status(500).json({ error: 'Failed to fetch vendor details' });
        }
    }

    static async updateVendorVerification(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { is_verified, rejection_reason } = req.body;

            if (typeof is_verified !== 'boolean') {
                return res.status(400).json({ error: 'is_verified must be a boolean' });
            }

            // Get vendor details for email
            const [vendor]: any = await db.execute(
                'SELECT name, email FROM profiles WHERE id = ?',
                [id]
            );

            if (vendor.length === 0) {
                return res.status(404).json({ error: 'Vendor not found' });
            }

            const vendorData = vendor[0];

            // Update verification status.
            // The reason was previously only emailed and written to the activity
            // log, so the admin screens had nothing to show. Store it, and clear
            // it on approval so an old reason cannot linger on a verified store.
            await db.execute(
                'UPDATE vendor_verification SET is_verified = ?, verified_at = ?, rejection_reason = ? WHERE user_id = ?',
                [
                    is_verified,
                    getISTTimestamp(),
                    is_verified ? null : (rejection_reason ? String(rejection_reason).trim() : null),
                    id
                ]
            );
            invalidateSessionState(id);

            // Send email notification
            try {
                if (is_verified) {
                    // Send approval email
                    await EmailService.sendVendorApprovalConfirmation(
                        vendorData.email,
                        vendorData.name
                    );
                    console.log(`âœ“ Vendor approval email sent to ${vendorData.email}`);
                } else {
                    // Send rejection email
                    await EmailService.sendVendorRejectionNotification(
                        vendorData.email,
                        vendorData.name,
                        rejection_reason
                    );
                    console.log(`âœ“ Vendor rejection email sent to ${vendorData.email}`);
                }
            } catch (emailError: any) {
                console.error('Email sending error:', emailError);
                // Don't fail the request if email fails
            }

            // Send real-time notification
            try {
                await NotificationService.notify(id, {
                    title: is_verified ? 'Store Approved! âœ“' : 'Store Verification Update',
                    message: is_verified
                        ? 'Congratulations! Your store has been verified and approved.'
                        : `Your store verification was not successful. Reason: ${rejection_reason}`,
                    type: is_verified ? 'system' : 'alert',
                    link: '/profile'
                });
            } catch (notifError) {
                console.error('Failed to send vendor verification notification:', notifError);
            }

            // Log the activity
            const admin = (req as any).user;
            await ActivityLogService.log({
                adminId: admin.id,
                adminName: admin.name,
                adminEmail: admin.email,
                actionType: is_verified ? 'VENDOR_APPROVED' : 'VENDOR_REJECTED',
                targetType: 'VENDOR',
                targetId: id,
                targetName: vendorData.name,
                details: { rejection_reason: rejection_reason || null },
                ipAddress: req.ip || req.socket?.remoteAddress
            });

            res.json({
                success: true,
                message: `Vendor ${is_verified ? 'approved' : 'rejected'} successfully`
            });
        } catch (error: any) {
            console.error('Update vendor verification error:', error);
            res.status(500).json({ error: 'Failed to update vendor verification' });
        }
    }

    /**
     * All manpower across every franchise — powers the admin Manpower module
     * (leaderboard + per-franchise drill-down).
     *
     * Returns one row per staff member with their store, approval/active state and
     * warranty tallies, so the client can rank them and group by franchise without
     * N+1 requests.
     */
    static async getAllManpower(req: Request, res: Response) {
        try {
            // Optional period filter — narrows the WARRANTY TALLIES only. Staff
            // themselves are always all returned, so the roster/approval view is
            // unaffected; only the leaderboard numbers change.
            const period = (req.query.period as string) || 'all';
            const year = req.query.year as string;
            const month = req.query.month as string;
            const startDate = req.query.startDate as string;
            const endDate = req.query.endDate as string;

            let dateClause = '';
            const dateParams: any[] = [];
            if (period === 'year') {
                dateClause = 'AND YEAR(created_at) = ?';
                dateParams.push(year || String(new Date().getFullYear()));
            } else if (period === 'month') {
                dateClause = 'AND YEAR(created_at) = ? AND MONTH(created_at) = ?';
                dateParams.push(year || String(new Date().getFullYear()), month || String(new Date().getMonth() + 1));
            } else if (period === 'week') {
                dateClause = 'AND DATE(created_at) >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)';
            } else if (period === 'custom' && startDate && endDate) {
                dateClause = 'AND DATE(created_at) >= ? AND DATE(created_at) <= ?';
                dateParams.push(startDate, endDate);
            }

            const [rows]: any = await db.execute(`
                SELECT
                    m.id, m.name, m.phone_number, m.manpower_id, m.applicator_type,
                    m.is_active, m.is_approved, m.approved_at, m.created_at,
                    m.removed_at, m.removed_reason,
                    m.request_type, m.request_reason, m.requested_at,
                    m.request_status, m.request_reviewed_at, m.request_review_note,
                    vd.id            AS vendor_details_id,
                    vd.user_id       AS franchise_user_id,
                    vd.store_name,
                    vd.store_code,
                    vd.city, vd.state,
                    COALESCE(w.total_applications, 0) AS total_applications,
                    COALESCE(w.points, 0)            AS points,
                    COALESCE(w.pending_points, 0)    AS pending_points,
                    COALESCE(w.rejected_points, 0)   AS rejected_points
                FROM manpower m
                JOIN vendor_details vd ON vd.id = m.vendor_id
                /*
                 * A rejected store's staff have no business on this screen.
                 * Rejection means the store was found not to be ours at all —
                 * one such member was even approved, so they read as a real
                 * installer sitting in the leaderboard. The rows stay in the
                 * table (warranty history still points at them); they are just
                 * not offered as current staff.
                 *
                 * NULL is treated as rejected too: every live franchise has a
                 * verification row, so a missing one is an anomaly, and showing
                 * an unverifiable store is the worse failure.
                 */
                JOIN vendor_verification vv
                  ON vv.user_id = vd.user_id AND vv.is_verified = 1
                LEFT JOIN (
                    SELECT manpower_id,
                           COUNT(*) AS total_applications,
                           SUM(status = 'validated') AS points,
                           SUM(status IN ('pending','pending_vendor')) AS pending_points,
                           SUM(status = 'rejected') AS rejected_points
                    FROM warranty_registrations
                    WHERE manpower_id IS NOT NULL AND manpower_id <> ''
                    ${dateClause}
                    GROUP BY manpower_id
                ) w ON w.manpower_id = m.id
                ORDER BY points DESC, m.name ASC
            `, dateParams);

            res.json({ success: true, manpower: rows, period });
        } catch (error: any) {
            console.error('Get all manpower error:', error);
            res.status(500).json({ error: 'Failed to fetch manpower list' });
        }
    }

    /**
     * List the controllable WhatsApp message types with their current on/off
     * state and live traffic stats, for the admin notification settings screen.
     *
     * Interakt exposes no template-listing API, so the type list comes from the
     * code registry and the health picture is derived from message_logs.
     */
    static async getNotificationSettings(req: Request, res: Response) {
        try {
            const settings = await loadNotificationSettings(true);
            const windows = await loadNotificationWindows(true);

            // 30-day traffic per context, so the admin can see what each toggle
            // actually controls before flipping it.
            const [stats]: any = await db.execute(
                `SELECT context,
                        COUNT(*) AS total,
                        SUM(status = 'failed') AS failed,
                        SUM(status IN ('delivered', 'read')) AS delivered,
                        MAX(created_at) AS last_sent
                 FROM message_logs
                 WHERE channel = 'whatsapp'
                   AND created_at >= NOW() - INTERVAL 30 DAY
                 GROUP BY context`
            );
            const byContext = new Map<string, any>(stats.map((r: any) => [r.context, r]));

            // Interakt returns this exact wording when a template isn't approved
            // yet — surface it so a dead toggle is obvious rather than silent.
            const [tmplErrors]: any = await db.execute(
                `SELECT DISTINCT context
                 FROM message_logs
                 WHERE channel = 'whatsapp'
                   AND status = 'failed'
                   AND error_message LIKE '%No approved template found%'
                   AND created_at >= NOW() - INTERVAL 30 DAY`
            );
            const unapproved = new Set(tmplErrors.map((r: any) => r.context));

            const types = NOTIFICATION_TYPES.map(t => {
                const s = byContext.get(t.context);
                return {
                    ...t,
                    enabled: settings[t.key] !== false,
                    stats: {
                        total: Number(s?.total || 0),
                        failed: Number(s?.failed || 0),
                        delivered: Number(s?.delivered || 0),
                        lastSent: s?.last_sent || null
                    },
                    templateApproved: !unapproved.has(t.context),
                    // Only meaningful when supportsDateWindow is set; present as
                    // null rather than omitted so the client never has to
                    // distinguish "not configured" from "field absent".
                    window: t.supportsDateWindow ? (windows[t.key] || null) : null
                };
            });

            res.json({
                success: true,
                masterEnabled: process.env.ENABLE_WHATSAPP === 'true',
                types
            });
        } catch (error: any) {
            console.error('Get notification settings error:', error);
            res.status(500).json({ error: 'Failed to load notification settings' });
        }
    }

    /** Flip one or more message-type toggles. Takes effect within ~30s. */
    static async updateNotificationSettings(req: Request, res: Response) {
        try {
            const { updates } = req.body || {};
            if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
                return res.status(400).json({ error: 'updates must be an object of { key: boolean }' });
            }

            const validKeys = new Set(NOTIFICATION_TYPES.map(t => t.key));
            const unknown = Object.keys(updates).filter(k => !validKeys.has(k));
            if (unknown.length > 0) {
                return res.status(400).json({ error: `Unknown notification type(s): ${unknown.join(', ')}` });
            }

            const admin = (req as any).user;
            const saved = await saveNotificationSettings(updates, admin?.email || 'admin');

            res.json({ success: true, settings: saved });

            try {
                await ActivityLogService.log({
                    adminId: admin?.id,
                    adminName: admin?.name,
                    adminEmail: admin?.email,
                    actionType: 'SYSTEM_SETTING_UPDATED',
                    targetType: 'SYSTEM_SETTING',
                    targetId: 'whatsapp_notifications',
                    targetName: 'WhatsApp Notification Toggles',
                    details: { updates },
                    ipAddress: req.ip || req.socket?.remoteAddress
                });
            } catch (logErr) {
                console.error('Failed to log notification settings change', logErr);
            }
        } catch (error: any) {
            console.error('Update notification settings error:', error);
            res.status(500).json({ error: 'Failed to update notification settings' });
        }
    }

    /** Reminder schedule plus a preview of what the one-time catch-up would send. */
    static async getWarrantyReminderSettings(_req: Request, res: Response) {
        try {
            const [settings, preview, preflight, lastFailure, everReminded] = await Promise.all([
                getReminderSettings(),
                previewInitialRun(),
                preflightCheck(),
                lastReminderFailure(),
                countEverReminded()
            ]);
            res.json({
                success: true, settings, preview, preflight, lastFailure,
                // Whether the catch-up genuinely happened, as opposed to having
                // merely recorded itself. The UI needs this to decide between
                // "done" and "still available".
                everReminded,
                progress: getReminderProgress()
            });
        } catch (error: any) {
            console.error('Get warranty reminder settings error:', error);
            res.status(500).json({ error: 'Failed to load reminder settings' });
        }
    }

    static async updateWarrantyReminderSettings(req: Request, res: Response) {
        try {
            const updates = req.body || {};
            const admin = (req as any).user;
            const saved = await saveReminderSettings(updates, admin?.email || 'admin');

            res.json({ success: true, settings: saved });

            try {
                await ActivityLogService.log({
                    adminId: admin?.id,
                    adminName: admin?.name,
                    adminEmail: admin?.email,
                    actionType: 'SYSTEM_SETTING_UPDATED',
                    targetType: 'SYSTEM_SETTING',
                    targetId: 'warranty_reminders',
                    targetName: 'Warranty Rejection Reminders',
                    details: { updates },
                    ipAddress: req.ip || req.socket?.remoteAddress
                });
            } catch (logErr) {
                console.error('Failed to log reminder settings change', logErr);
            }
        } catch (error: any) {
            console.error('Update warranty reminder settings error:', error);
            res.status(500).json({ error: 'Failed to update reminder settings' });
        }
    }

    /**
     * Fire the one-time catch-up over the existing backlog.
     *
     * Deliberately a deliberate act. This is the only path that messages every
     * outstanding rejection at once, so it is never triggered by a deploy or a
     * timer — an admin has to ask for it, having seen the preview counts, and
     * it refuses to run twice.
     */
    static async runInitialWarrantyReminders(req: Request, res: Response) {
        try {
            const settings = await getReminderSettings();

            // A recorded run only counts if it actually reminded something. An
            // earlier version marked itself done even when every send was
            // refused, which consumed the one-time action and stranded the
            // backlog; if nothing has ever been reminded, let it run again.
            if (settings.initialRunAt) {
                const reminded = await countEverReminded();
                if (reminded > 0) {
                    return res.status(409).json({
                        error: `The one-time catch-up already ran on ${new Date(settings.initialRunAt).toLocaleString('en-IN')}. Ongoing reminders are handled by the schedule.`
                    });
                }
                console.warn('[WarrantyReminder] Previous catch-up delivered nothing — allowing another attempt.');
            }

            // Refuse rather than burn the run against switched-off message types.
            const preflight = await preflightCheck();
            if (!preflight.ok) {
                return res.status(400).json({
                    error: `Nothing would be delivered: ${preflight.problems.join(' ')}`,
                    problems: preflight.problems
                });
            }

            const existing = getReminderProgress();
            if (existing && existing.status === 'running') {
                return res.status(409).json({ error: 'A reminder run is already in progress.', progress: existing });
            }

            const preview = await previewInitialRun();
            if (preview.warranties === 0) {
                return res.status(400).json({ error: 'Nothing is due a reminder.' });
            }

            // Answer immediately; the pass reports through the progress endpoint.
            res.json({ success: true, message: `Sending reminders for ${preview.warranties} warranties.`, preview });

            const admin = (req as any).user;
            void runReminderPass('initial').then(result => {
                ActivityLogService.log({
                    adminId: admin?.id,
                    adminName: admin?.name,
                    adminEmail: admin?.email,
                    actionType: 'SYSTEM_SETTING_UPDATED',
                    targetType: 'SYSTEM_SETTING',
                    targetId: 'warranty_reminders',
                    targetName: 'Warranty Reminder Catch-Up',
                    details: { sent: result.sent, failed: result.failed, skipped: result.skipped, status: result.status },
                    ipAddress: req.ip || req.socket?.remoteAddress
                }).catch(e => console.error('Failed to log catch-up run', e));
            });
        } catch (error: any) {
            console.error('Run initial warranty reminders error:', error);
            res.status(500).json({ error: 'Failed to start the reminder run' });
        }
    }

    static async getWarrantyReminderProgress(_req: Request, res: Response) {
        res.json({ success: true, progress: getReminderProgress() });
    }

    /**
     * Send both reminder messages for one real warranty to a nominated phone.
     * The only way to see the finished message without messaging a customer.
     */
    static async testWarrantyReminder(req: Request, res: Response) {
        try {
            const { phone, uid } = req.body || {};
            if (!phone || !/^\+?[0-9\s-]{10,15}$/.test(String(phone))) {
                return res.status(400).json({ error: 'A valid mobile number is required.' });
            }

            const result = await sendTestReminder(String(phone).trim(), uid ? String(uid).trim() : undefined);

            res.json({
                success: result.customerSent || result.storeSent,
                result,
                message: result.customerSent && result.storeSent
                    ? `Both messages sent to ${phone}, using warranty ${result.uid}.`
                    : result.customerSent || result.storeSent
                        ? `Partly sent for warranty ${result.uid} — check WhatsApp Messages for the failure.`
                        : 'Neither message was accepted by Interakt. The template is most likely still awaiting approval.'
            });
        } catch (error: any) {
            console.error('Test warranty reminder error:', error);
            res.status(400).json({ error: error?.message || 'Failed to send the test message' });
        }
    }

    static async abortWarrantyReminders(_req: Request, res: Response) {
        const stopped = abortReminderRun();
        res.json({
            success: stopped,
            message: stopped ? 'Stopping after the current warranty.' : 'No reminder run is in progress.'
        });
    }

    /**
     * Set or clear the send-date window for one message type.
     *
     * Only types with `supportsDateWindow` accept one — a window on a type with
     * no natural "as of" date would be silently ignored by the sender, which is
     * worse than rejecting the request here.
     */
    static async updateNotificationWindow(req: Request, res: Response) {
        try {
            const { key } = req.params;
            const type = NOTIFICATION_TYPES.find(t => t.key === key);
            if (!type) {
                return res.status(400).json({ error: `Unknown notification type: ${key}` });
            }
            if (!type.supportsDateWindow) {
                return res.status(400).json({ error: `"${type.label}" does not support a date window` });
            }

            const { startDate, endDate } = req.body || {};
            const isIsoDate = (v: unknown) => v === null || v === undefined || /^\d{4}-\d{2}-\d{2}$/.test(String(v));
            if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
                return res.status(400).json({ error: 'startDate and endDate must be YYYY-MM-DD or null' });
            }
            if (startDate && endDate && String(startDate) > String(endDate)) {
                return res.status(400).json({ error: 'startDate must not be after endDate' });
            }

            const admin = (req as any).user;
            // Both ends absent means "remove the window" rather than store an
            // empty one — an empty NotificationWindow and no window at all
            // already mean the same thing (send regardless of date), so there is
            // no reason to keep a row around for it.
            const windowValue: NotificationWindow | null =
                (startDate || endDate) ? { startDate: startDate || null, endDate: endDate || null } : null;

            const saved = await saveNotificationWindow(key, windowValue, admin?.email || 'admin');

            res.json({ success: true, windows: saved });

            try {
                await ActivityLogService.log({
                    adminId: admin?.id,
                    adminName: admin?.name,
                    adminEmail: admin?.email,
                    actionType: 'SYSTEM_SETTING_UPDATED',
                    targetType: 'SYSTEM_SETTING',
                    targetId: 'whatsapp_notification_windows',
                    targetName: `${type.label} — Send Window`,
                    details: { key, startDate: startDate || null, endDate: endDate || null },
                    ipAddress: req.ip || req.socket?.remoteAddress
                });
            } catch (logErr) {
                console.error('Failed to log notification window change', logErr);
            }
        } catch (error: any) {
            console.error('Update notification window error:', error);
            res.status(500).json({ error: 'Failed to update the send window' });
        }
    }

    /**
     * Decide a franchise's pending REMOVAL request.
     *
     *   approve -> the member is actually removed (is_active = 0) and the
     *              original reason is kept as removed_reason.
     *   reject  -> the member stays on the team; the request is closed with the
     *              admin's note so the store can see why.
     */
    static async reviewManpowerRemoval(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { approve, note } = req.body;
            const admin = (req as any).user;

            if (typeof approve !== 'boolean') {
                return res.status(400).json({ error: 'approve must be a boolean' });
            }

            const [rows]: any = await db.execute(
                `SELECT m.id, m.name, m.manpower_id, m.vendor_id, m.request_status, m.request_type,
                        m.request_reason, vd.user_id AS franchise_user_id, vd.store_name
                 FROM manpower m
                 JOIN vendor_details vd ON vd.id = m.vendor_id
                 WHERE m.id = ?`,
                [id]
            );
            if (rows.length === 0) {
                return res.status(404).json({ error: 'Manpower entry not found' });
            }
            const member = rows[0];

            if (member.request_status !== 'pending' || member.request_type !== 'remove') {
                return res.status(400).json({ error: `There is no pending removal request for ${member.name}.` });
            }

            if (approve) {
                await db.execute(
                    `UPDATE manpower
                     SET is_active = FALSE, removed_at = NOW(), removed_reason = ?,
                         request_status = 'approved', request_reviewed_at = NOW(),
                         request_reviewed_by = ?, request_review_note = ?
                     WHERE id = ?`,
                    [member.request_reason, admin.id, note ? String(note).substring(0, 500) : null, id]
                );
            } else {
                await db.execute(
                    `UPDATE manpower
                     SET request_status = 'rejected', request_reviewed_at = NOW(),
                         request_reviewed_by = ?, request_review_note = ?
                     WHERE id = ?`,
                    [admin.id, note ? String(note).substring(0, 500) : null, id]
                );
            }

            // Tell the store what was decided.
            try {
                await NotificationService.notify(member.franchise_user_id, {
                    title: approve ? 'Removal Approved' : 'Removal Request Declined',
                    message: approve
                        ? `${member.name} has been removed from your team as requested.`
                        : `Your request to remove ${member.name} was declined${note ? `: ${note}` : '.'} They remain on your team.`,
                    type: 'system'
                });
            } catch (e) {
                console.error('Failed to notify franchise of removal decision', e);
            }

            res.json({
                success: true,
                message: approve
                    ? `${member.name} removed from ${member.store_name}`
                    : `Removal request for ${member.name} declined`
            });
        } catch (error: any) {
            console.error('Review manpower removal error:', error);
            res.status(500).json({ error: 'Failed to review removal request' });
        }
    }

    /**
     * Delete a staff member outright, whatever state they are in.
     *
     * The franchise-request flow above is the ordinary way a member leaves a
     * team, and it is deliberately reversible. This is the other case: a record
     * that should never have existed — staff of a store that turned out not to
     * be ours, or a duplicate — where leaving a soft-deleted row behind is
     * itself the problem.
     *
     * There are no foreign keys on `manpower`, so the database will happily
     * delete a member whose warranties then point at nothing. That check lives
     * here instead: a member with history is refused, because losing the
     * installer on a live warranty is worse than keeping a row nobody wants.
     */
    static async deleteManpower(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const admin = (req as any).user;

            const [rows]: any = await db.execute(
                `SELECT m.id, m.name, m.manpower_id, m.phone_number, m.vendor_id,
                        vd.store_name, vd.user_id AS franchise_user_id
                   FROM manpower m
                   JOIN vendor_details vd ON vd.id = m.vendor_id
                  WHERE m.id = ?`,
                [id]
            );
            if (!rows.length) return res.status(404).json({ error: 'Staff member not found' });
            const member = rows[0];

            const [[{ used }]]: any = await db.execute(
                'SELECT COUNT(*) AS used FROM warranty_registrations WHERE manpower_id = ?',
                [id]
            );
            if (used > 0) {
                return res.status(409).json({
                    error:
                        `${member.name} has ${used} warrant${used === 1 ? 'y' : 'ies'} on record and ` +
                        `cannot be deleted. Remove them from the team instead — their history stays intact.`,
                });
            }

            await db.execute('DELETE FROM manpower WHERE id = ?', [id]);

            // Logged because a delete leaves nothing behind to inspect later.
            try {
                await ActivityLogService.log({
                    adminId: admin?.id,
                    adminName: admin?.name,
                    adminEmail: admin?.email,
                    actionType: 'MANPOWER_DELETED',
                    targetType: 'MANPOWER',
                    targetId: id,
                    targetName: member.name,
                    details: {
                        manpower_id: member.manpower_id,
                        phone_number: member.phone_number,
                        store_name: member.store_name,
                    },
                    ipAddress: req.ip || req.socket?.remoteAddress,
                });
            } catch (e) {
                console.error('Failed to log manpower deletion', e);
            }

            res.json({ success: true, message: `${member.name} deleted from ${member.store_name}` });
        } catch (error: any) {
            console.error('Delete manpower error:', error);
            res.status(500).json({ error: 'Failed to delete the staff member' });
        }
    }

    /**
     * Approve (or send back to pending) a franchise's manpower entry.
     *
     * Stores add staff themselves, but a staff member only becomes usable once an
     * admin approves them from the franchise's Manpower tab. Approval can be
     * revoked by passing is_approved = false.
     */
    static async updateManpowerApproval(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { is_approved } = req.body;

            if (typeof is_approved !== 'boolean') {
                return res.status(400).json({ error: 'is_approved must be a boolean' });
            }

            const [rows]: any = await db.execute(
                `SELECT m.id, m.name, m.manpower_id, m.is_approved, m.vendor_id,
                        vd.store_name, vd.user_id AS franchise_user_id
                 FROM manpower m
                 LEFT JOIN vendor_details vd ON vd.id = m.vendor_id
                 WHERE m.id = ?`,
                [id]
            );

            if (rows.length === 0) {
                return res.status(404).json({ error: 'Manpower entry not found' });
            }
            const member = rows[0];

            const admin = (req as any).user;

            // Approving closes out any restore request that put them here, so the
            // "Restore Requested" badge doesn't linger once they're back on the team.
            await db.execute(
                `UPDATE manpower
                 SET is_approved = ?, approved_at = ?, approved_by = ?,
                     request_status = CASE WHEN ? AND request_type = 'restore' THEN 'approved' ELSE request_status END,
                     request_reviewed_at = CASE WHEN ? AND request_type = 'restore' THEN NOW() ELSE request_reviewed_at END,
                     request_reviewed_by = CASE WHEN ? AND request_type = 'restore' THEN ? ELSE request_reviewed_by END
                 WHERE id = ?`,
                [is_approved, is_approved ? new Date() : null, is_approved ? admin.id : null,
                 is_approved, is_approved, is_approved, admin.id, id]
            );

            // Tell the store their staff member is now usable (or no longer is).
            if (member.franchise_user_id) {
                try {
                    await NotificationService.notify(member.franchise_user_id, {
                        title: is_approved ? 'Staff Approved' : 'Staff Approval Revoked',
                        message: is_approved
                            ? `${member.name} has been approved and can now be selected for warranty registrations.`
                            : `${member.name} is pending approval again and cannot be selected for warranty registrations.`,
                        type: is_approved ? 'system' : 'alert'
                    });
                } catch (notifyError) {
                    console.error('Failed to notify franchise of manpower approval:', notifyError);
                }
            }

            await ActivityLogService.log({
                adminId: admin.id,
                adminName: admin.name,
                adminEmail: admin.email,
                actionType: is_approved ? 'MANPOWER_APPROVED' : 'MANPOWER_APPROVAL_REVOKED',
                targetType: 'VENDOR',
                targetId: id,
                targetName: `${member.name} (${member.store_name || 'Unknown store'})`,
                details: { manpower_id: member.manpower_id, store_name: member.store_name },
                ipAddress: req.ip || req.socket?.remoteAddress
            });

            res.json({
                success: true,
                message: is_approved
                    ? `${member.name} approved successfully`
                    : `${member.name} moved back to pending`
            });
        } catch (error: any) {
            console.error('Update manpower approval error:', error);
            res.status(500).json({ error: 'Failed to update manpower approval' });
        }
    }

    /**
     * Toggle vendor activation status
     */
    static async toggleVendorActivation(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { is_active } = req.body;

            if (typeof is_active !== 'boolean') {
                return res.status(400).json({ error: 'is_active must be a boolean' });
            }

            // Get vendor details
            const [vendor]: any = await db.execute(
                'SELECT name, email FROM profiles WHERE id = ?',
                [id]
            );

            if (vendor.length === 0) {
                return res.status(404).json({ error: 'Vendor not found' });
            }

            const vendorData = vendor[0];

            // Update activation status
            await db.execute(
                'UPDATE vendor_verification SET is_active = ? WHERE user_id = ?',
                [is_active, id]
            );
            invalidateSessionState(id);

            // Send real-time notification
            try {
                await NotificationService.notify(id, {
                    title: is_active ? 'Store Activated' : 'Store Deactivated',
                    message: is_active
                        ? 'Your store has been activated. You can now access your account.'
                        : 'Your store has been deactivated. Please contact admin for assistance.',
                    type: is_active ? 'system' : 'alert'
                });
            } catch (notifError) {
                console.error('Failed to send vendor activation notification:', notifError);
            }

            // Log the activity
            const admin = (req as any).user;
            await ActivityLogService.log({
                adminId: admin.id,
                adminName: admin.name,
                adminEmail: admin.email,
                actionType: is_active ? 'VENDOR_ACTIVATED' : 'VENDOR_DEACTIVATED',
                targetType: 'VENDOR',
                targetId: id,
                targetName: vendorData.name,
                ipAddress: req.ip || req.socket?.remoteAddress
            });

            res.json({
                success: true,
                message: `Franchise ${is_active ? 'activated' : 'deactivated'} successfully`
            });
        } catch (error: any) {
            console.error('Toggle vendor activation error:', error);
            res.status(500).json({ error: 'Failed to toggle vendor activation' });
        }
    }

    /**
     * Update allowed_brands for a vendor (franchise or distributor)
     */
    static async updateVendorAllowedBrands(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { allowed_brands, target } = req.body;

            if (!['AF', 'AC', 'AFAC'].includes(allowed_brands)) {
                return res.status(400).json({ error: 'allowed_brands must be AF, AC, or AFAC' });
            }

            if (target === 'distributor') {
                const { distributor_id } = req.body;
                let result: any;
                if (distributor_id) {
                    [result] = await db.execute(
                        `UPDATE distributors SET allowed_brands = ? WHERE id = ?`,
                        [allowed_brands, distributor_id]
                    ) as any;
                } else {
                    [result] = await db.execute(
                        `UPDATE distributors SET allowed_brands = ? WHERE profile_id = ?`,
                        [allowed_brands, id]
                    ) as any;
                }
                if (result.affectedRows === 0) {
                    return res.status(404).json({ error: 'Distributor record not found. Ensure distributor status is enabled first.' });
                }
            } else {
                const [result]: any = await db.execute(
                    `UPDATE vendor_details SET allowed_brands = ? WHERE user_id = ?`,
                    [allowed_brands, id]
                );
                if (result.affectedRows === 0) {
                    return res.status(404).json({ error: 'Franchise record not found.' });
                }
            }

            res.json({ success: true, message: `Brand assignment updated to ${allowed_brands}` });
        } catch (error: any) {
            console.error('Update allowed_brands error:', error);
            res.status(500).json({ error: 'Failed to update brand assignment' });
        }
    }

    /**
     * Update vendor distributor status (toggles is_distributor and maps to distributors table)
     */
    static async updateVendorDistributorStatus(req: Request, res: Response) {
        const connection = await db.getConnection();
        try {
            const { id } = req.params;
            const { is_distributor } = req.body;

            if (typeof is_distributor !== 'boolean') {
                return res.status(400).json({ error: 'is_distributor must be a boolean' });
            }

            await connection.beginTransaction();

            // Check if vendor exists
            const [vendor]: any = await connection.execute(
                `SELECT p.name, p.email, p.phone_number, vd.store_name, vd.store_email, vd.address, vd.city, vd.state, vd.pincode
                 FROM profiles p
                 JOIN vendor_details vd ON p.id = vd.user_id
                 WHERE p.id = ?`,
                [id]
            );

            if (vendor.length === 0) {
                await connection.rollback();
                return res.status(404).json({ error: 'Vendor details not found' });
            }

            const vendorData = vendor[0];

            // 1. Update is_distributor in vendor_details
            await connection.execute(
                'UPDATE vendor_details SET is_distributor = ? WHERE user_id = ?',
                [is_distributor, id]
            );

            if (is_distributor) {
                // Check if a distributor record already exists for this vendor profile
                const [existingDist]: any = await connection.execute(
                    'SELECT id FROM distributors WHERE profile_id = ?',
                    [id]
                );

                if (existingDist.length === 0) {
                    // Create new distributor record linked to this profile
                    const newDistId = uuidv4();
                    await connection.execute(
                        `INSERT INTO distributors (id, name, email, phone_number, address, city, state, pincode, profile_id)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            newDistId,
                            vendorData.store_name,
                            vendorData.store_email || vendorData.email,
                            vendorData.phone_number || '0000000000',
                            vendorData.address || '',
                            vendorData.city || '',
                            vendorData.state || '',
                            vendorData.pincode || '',
                            id
                        ]
                    );
                    console.log(`[Admin] Created distributor record for vendor ${id} with id ${newDistId}`);
                }
            } else {
                // Find the distributor record before disassociating
                const [distRecord]: any = await connection.execute(
                    'SELECT id FROM distributors WHERE profile_id = ?',
                    [id]
                );

                if (distRecord.length > 0) {
                    const distId = distRecord[0].id;
                    // Unmap any vendor_details currently assigned to this distributor
                    await connection.execute(
                        'UPDATE vendor_details SET distributor_id = NULL WHERE distributor_id = ?',
                        [distId]
                    );
                    console.log(`[Admin] Unmapped all franchises from distributor ${distId}`);
                }

                // If revoking distributor status, set profile_id = NULL for their linked distributor record
                // This keeps historical order linkages intact but disassociates the franchise from managing it.
                await connection.execute(
                    'UPDATE distributors SET profile_id = NULL WHERE profile_id = ?',
                    [id]
                );
                console.log(`[Admin] Disassociated distributor record from profile ${id}`);
            }

            await connection.commit();

            // Log the activity
            const admin = (req as any).user;
            await ActivityLogService.log({
                adminId: admin.id,
                adminName: admin.name,
                adminEmail: admin.email,
                actionType: is_distributor ? 'VENDOR_PROMOTED_DISTRIBUTOR' : 'VENDOR_DEMOTED_DISTRIBUTOR',
                targetType: 'VENDOR',
                targetId: id,
                targetName: vendorData.store_name,
                ipAddress: req.ip || req.socket?.remoteAddress
            });

            res.json({
                success: true,
                message: `Franchise ${is_distributor ? 'promoted to distributor' : 'demoted from distributor'} successfully`
            });

        } catch (error: any) {
            await connection.rollback();
            console.error('Update vendor distributor status error:', error);
            res.status(500).json({ error: 'Failed to update vendor distributor status' });
        } finally {
            connection.release();
        }
    }

    /**
     * Update store code for QR generation
     */
    static async updateStoreCode(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { store_code } = req.body;

            // Validate store_code format (letters + numbers, 3-20 chars)
            if (!store_code || !/^[A-Za-z0-9]{3,20}$/.test(store_code)) {
                return res.status(400).json({
                    error: 'Invalid store code format. Use 3-20 alphanumeric characters (e.g., FGM168)'
                });
            }

            // Normalize to uppercase
            const normalizedCode = store_code.toUpperCase();

            // Check if store_code already exists for another vendor
            const [existing]: any = await db.execute(
                'SELECT id FROM vendor_details WHERE store_code = ? AND user_id != ?',
                [normalizedCode, id]
            );

            if (existing.length > 0) {
                return res.status(400).json({
                    error: 'This store code is already in use by another franchise'
                });
            }

            const [beforeCode]: any = await db.execute(
                'SELECT store_code FROM vendor_details WHERE user_id = ?',
                [id]
            );

            // Update store_code
            await db.execute(
                'UPDATE vendor_details SET store_code = ? WHERE user_id = ?',
                [normalizedCode, id]
            );

            // Log the activity
            const admin = (req as any).user;
            const [vendor]: any = await db.execute(
                'SELECT store_name FROM vendor_details WHERE user_id = ?',
                [id]
            );

            await ActivityLogService.log({
                adminId: admin.id,
                adminName: admin.name,
                adminEmail: admin.email,
                actionType: 'STORE_CODE_UPDATED',
                targetType: 'VENDOR',
                targetId: id,
                targetName: vendor[0]?.store_name || 'Unknown',
                details: { changes: fieldChanges(beforeCode[0] || {}, { store_code: normalizedCode }) },
                ipAddress: req.ip || req.socket?.remoteAddress
            });

            res.json({
                success: true,
                store_code: normalizedCode,
                message: 'Store code updated successfully'
            });
        } catch (error: any) {
            console.error('Update store code error:', error);
            res.status(500).json({ error: 'Failed to update store code' });
        }
    }

    /**
     * Update vendor location coordinates
     */
    static async updateVendorCoordinates(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { latitude, longitude } = req.body;

            const [beforePin]: any = await db.execute(
                'SELECT latitude, longitude FROM vendor_details WHERE user_id = ?',
                [id]
            );

            await db.execute(
                'UPDATE vendor_details SET latitude = ?, longitude = ? WHERE user_id = ?',
                [latitude || null, longitude || null, id]
            );

            const admin = (req as any).user;
            await ActivityLogService.log({
                adminId: admin.id,
                adminName: admin.name,
                adminEmail: admin.email,
                actionType: 'VENDOR_COORDINATES_UPDATED',
                targetType: 'VENDOR',
                targetId: id,
                targetName: undefined,
                details: { changes: fieldChanges(beforePin[0] || {}, { latitude, longitude }) },
                ipAddress: req.ip || req.socket?.remoteAddress
            });

            res.json({
                success: true,
                message: 'Coordinates updated successfully',
                coordinates: { latitude, longitude }
            });
        } catch (error: any) {
            console.error('Update coordinates error:', error);
            res.status(500).json({ error: 'Failed to update coordinates' });
        }
    }

    static async updateVendorProfile(req: Request, res: Response) {
        try {
            const { id } = req.params;
            let { store_name, contact_name, email, phone_number, address, city, state, pincode, gst_number, area_head_name } = req.body;

            // SBP-DB: Trim string lengths to prevent database overflow (Data Too Long) edge cases
            store_name = store_name?.substring(0, 255);
            contact_name = contact_name?.substring(0, 100);
            email = email?.substring(0, 100);
            phone_number = phone_number?.substring(0, 15);
            // Optional address/registration fields — normalize empty strings to null
            address = address ? String(address).substring(0, 500) : null;
            city = city ? String(city).substring(0, 100) : null;
            state = state ? String(state).substring(0, 100) : null;
            pincode = pincode ? String(pincode).substring(0, 10) : null;
            gst_number = gst_number ? String(gst_number).substring(0, 20) : null;
            area_head_name = area_head_name ? String(area_head_name).substring(0, 255) : null;

            if (!store_name || !contact_name || !email || !phone_number) {
                return res.status(400).json({ error: 'Store name, contact name, email and phone number are required' });
            }

            // This rewrites profiles.email/phone_number by id, so it must only
            // ever touch a franchise. It used to take any id: an admin with
            // Franchises edit access could point it at another admin — a super
            // admin included — and set their login email to one they control.
            // Every franchise and distributor login holds the vendor role and
            // no profile holds two roles (checked 24 Sept 2026).
            const [targetRoles]: any = await db.execute(
                'SELECT role FROM user_roles WHERE user_id = ?',
                [id]
            );
            const roles = targetRoles.map((r: any) => r.role);
            if (!roles.includes('vendor') || roles.includes('admin')) {
                return res.status(404).json({ error: 'Franchise not found' });
            }

            const connection = await db.getConnection();
            try {
                await connection.beginTransaction();

                // What the franchise looked like before this edit, so the log can
                // say what changed rather than only that something did.
                const [beforeRows]: any = await connection.execute(
                    `SELECT p.name AS contact_name, p.email, p.phone_number,
                            vd.store_name, vd.address, vd.city, vd.state, vd.pincode, vd.gst_number,
                            dist.area_head_name
                     FROM profiles p
                     LEFT JOIN vendor_details vd ON vd.user_id = p.id
                     LEFT JOIN distributors dist ON dist.profile_id = p.id
                     WHERE p.id = ?`,
                    [id]
                );
                const before = beforeRows[0] || {};

                const [existingEmail]: any = await connection.execute(
                    'SELECT id FROM profiles WHERE email = ? AND id != ?',
                    [email, id]
                );
                if (existingEmail.length > 0) {
                    return res.status(400).json({ error: 'Email already in use by another account' });
                }

                // The store email must stay unique as well: it is how a warranty
                // finds its store when no installer was picked.
                const [existingStoreEmail]: any = await connection.execute(
                    'SELECT id FROM vendor_details WHERE store_email = ? AND user_id != ?',
                    [email, id]
                );
                if (existingStoreEmail.length > 0) {
                    return res.status(400).json({ error: 'Email already in use by another store' });
                }

                const [existingPhone]: any = await connection.execute(
                    'SELECT id FROM profiles WHERE phone_number = ? AND id != ?',
                    [phone_number, id]
                );
                if (existingPhone.length > 0) {
                    return res.status(400).json({ error: 'Phone number already in use by another account' });
                }

                await connection.execute(
                    'UPDATE profiles SET name = ?, email = ?, phone_number = ? WHERE id = ?',
                    [contact_name, email, phone_number, id]
                );

                // gst_number lives on both tables: distributors already had it, and
                // franchises now do too, so a franchise's GST no longer has nowhere to go.
                await connection.execute(
                    'UPDATE vendor_details SET store_name = ?, store_email = ?, address = ?, city = ?, state = ?, pincode = ?, gst_number = ? WHERE user_id = ?',
                    [store_name, email, address, city, state, pincode, gst_number, id]
                );

                // Keep the distributor dashboard in sync with the updated profile.
                // The distributor-facing UI reads from the distributors table, so if we
                // only update profiles/vendor_details it will continue showing stale data.
                await connection.execute(
                    'UPDATE distributors SET name = ?, email = ?, phone_number = ?, address = ?, city = ?, state = ?, pincode = ?, gst_number = ?, area_head_name = ? WHERE profile_id = ?',
                    [store_name, email, phone_number, address, city, state, pincode, gst_number, area_head_name, id]
                );

                await connection.commit();

                const admin = (req as any).user;
                await ActivityLogService.log({
                    adminId: admin.id,
                    adminName: admin.name,
                    adminEmail: admin.email,
                    actionType: 'VENDOR_PROFILE_UPDATED',
                    targetType: 'VENDOR',
                    targetId: id,
                    targetName: store_name,
                    details: {
                        changes: fieldChanges(before, {
                            contact_name, email, phone_number, store_name,
                            address, city, state, pincode, gst_number,
                            // Only distributors carry an area head; a franchise
                            // has none, so don't log null → null noise for it.
                            ...(before.area_head_name != null || area_head_name ? { area_head_name } : {}),
                        }),
                    },
                    ipAddress: req.ip || req.socket?.remoteAddress
                });

                res.json({
                    success: true,
                    message: 'Vendor profile updated successfully'
                });
            } catch (transactionError: any) {
                await connection.rollback();
                throw transactionError;
            } finally {
                connection.release();
            }
        } catch (error: any) {
            console.error('Update vendor profile error:', error);
            res.status(500).json({ error: 'Failed to update vendor profile' });
        }
    }

    static async deleteVendor(req: Request, res: Response) {
        try {
            const { id } = req.params;

            // Delete from profiles - cascading should handle the rest
            const [user]: any = await db.execute('SELECT id FROM profiles WHERE id = ?', [id]);

            if (user.length === 0) {
                return res.status(404).json({ error: 'Vendor not found' });
            }

            await db.execute('DELETE FROM profiles WHERE id = ?', [id]);

            // Log the activity
            const admin = (req as any).user;
            await ActivityLogService.log({
                adminId: admin.id,
                adminName: admin.name,
                adminEmail: admin.email,
                actionType: 'VENDOR_DELETED',
                targetType: 'VENDOR',
                targetId: id,
                targetName: undefined,
                ipAddress: req.ip || req.socket?.remoteAddress
            });

            res.json({
                success: true,
                message: 'Vendor deleted successfully'
            });
        } catch (error: any) {
            console.error('Delete vendor error:', error);
            res.status(500).json({ error: 'Failed to delete vendor' });
        }
    }

    static async updateWarrantyStatus(req: Request, res: Response) {
        try {
            const { uid } = req.params;
            const { status, rejectionReason } = req.body;

            if (!['validated', 'rejected', 'pending'].includes(status)) {
                return res.status(400).json({ error: 'Invalid status' });
            }

            if (status === 'rejected' && !rejectionReason) {
                return res.status(400).json({ error: 'Rejection reason is required when rejecting a warranty' });
            }

            // Get warranty details for email (including store info)
            const [warranty]: any = await db.execute(
                `SELECT 
                    wr.id,
                    wr.uid,
                    wr.status,
                    wr.user_id,
                    wr.installer_name,
                    wr.customer_name, 
                    wr.customer_email, 
                    wr.customer_phone,
                    wr.customer_address,
                    wr.product_type,
                    wr.warranty_type,
                    wr.car_make,
                    wr.car_model,
                    wr.registration_number,
                    wr.product_details,
                    wr.purchase_date,
                    wr.created_at,
                    wr.manpower_id,
                    wr.vendor_details_id,
                    vd.store_name,
                    vd.store_email,
                    vd.address as store_address,
                    vd.city as store_city,
                    vd.state as store_state,
                    m.name as applicator_name,
                    m.phone_number as applicator_phone,
                    m.manpower_id as applicator_code,
                    m.is_active as applicator_active
                FROM warranty_registrations wr
                LEFT JOIN manpower m ON wr.manpower_id = m.id
                LEFT JOIN vendor_details vd ON vd.id = wr.vendor_details_id
                WHERE wr.uid = ? OR wr.id = ?`,
                [uid, uid]
            );

            if (warranty.length === 0) {
                return res.status(404).json({ error: 'Warranty not found' });
            }

            const warrantyData = warranty[0];
            let productDetails = {};
            try {
                productDetails = typeof warrantyData.product_details === 'string'
                    ? JSON.parse(warrantyData.product_details)
                    : warrantyData.product_details || {};
            } catch (e) {
                console.error("Error parsing product_details:", e);
                productDetails = {};
            }

            // Update status using the UID (actual primary key)
            // CRITICAL: Ensure we have a valid UID before updating
            if (!warrantyData.uid) {
                console.error('CRITICAL: warrantyData.uid is null/undefined! Aborting update to prevent mass update.');
                return res.status(500).json({ error: 'Internal error: Warranty UID not found' });
            }

            // SHIELD: Prevent invalid state transitions
            // Only allow moving back to pending from 'rejected' status
            if (status === 'pending' && warrantyData.status !== 'rejected') {
                return res.status(400).json({ error: `Cannot move to pending from ${warrantyData.status} status. Only rejected warranties can be overridden.` });
            }

            // Reversing an approval is a correction, not a routine rejection: the
            // customer has already been told their warranty is active. Require a
            // reason so the record says why it was undone.
            const isReversal = status === 'rejected' && warrantyData.status === 'validated';
            if (isReversal && !String(rejectionReason || '').trim()) {
                return res.status(400).json({
                    error: 'This warranty is already approved. Give a reason for reversing it.'
                });
            }
            if (isReversal) {
                console.log(`[SHIELD] REVERSING an approved warranty ${uid} — admin ${(req as any).user?.email || 'unknown'}`);
            }

            console.log(`[SHIELD] Updating warranty: uid=${uid}, current_status=${warrantyData.status}, new_status=${status}`);

            const connection = await db.getConnection();
            try {
                await connection.beginTransaction();

                // 1. Update the main registration status
                let timestampUpdates = '';
                if (status === 'validated') timestampUpdates = ', validated_at = NOW()';
                // rejected_by distinguishes this from a dealer's own rejection.
                // Only HO rejections are chased by the reminder job.
                //
                // The reminder counters reset here too: the attempt cap is meant
                // to stop us pestering someone about one rejection, not to exempt
                // a warranty for life. Without this, a warranty that used up its
                // reminders, was corrected, and was then rejected again would
                // never be chased about the second rejection.
                if (status === 'rejected') {
                    timestampUpdates = ", rejected_at = NOW(), rejected_by = 'admin'"
                        + ", reminder_count = 0, last_reminder_at = NULL";
                }
                
                await connection.execute(
                    `UPDATE warranty_registrations SET status = ?, rejection_reason = ? ${timestampUpdates} WHERE uid = ? LIMIT 1`,
                    [status, status === 'rejected' ? rejectionReason : null, warrantyData.uid]
                );

                // Log the action to the immutable analytics_events table
                await connection.execute(
                    `INSERT INTO analytics_events (warranty_id, action_type, performed_by) VALUES (?, ?, ?)`,
                    [warrantyData.id, status, 'system_admin']
                );

                // 2. UID Management Shield
                if (warrantyData.product_type === 'seat-cover') {
                    if (status === 'validated') {
                        const usedTimestamp = getISTTimestamp();
                        await connection.execute(
                            'UPDATE pre_generated_uids SET is_used = TRUE, used_at = ? WHERE uid = ?',
                            [usedTimestamp, warrantyData.uid]
                        );
                    } else if (status === 'rejected') {
                        await connection.execute(
                            'UPDATE pre_generated_uids SET is_used = FALSE, used_at = NULL WHERE uid = ?',
                            [warrantyData.uid]
                        );
                    } else if (status === 'pending' && warrantyData.status === 'rejected') {
                        // Re-reserve the UID if it was previously released during rejection
                        await connection.execute(
                            'UPDATE pre_generated_uids SET is_used = TRUE, used_at = ? WHERE uid = ?',
                            [getISTTimestamp(), warrantyData.uid]
                        );
                    }
                }

                await connection.commit();
            } catch (err) {
                await connection.rollback();
                throw err;
            } finally {
                connection.release();
            }

            // Return success response to admin immediately to prevent UI lag
            res.json({
                success: true,
                message: `Warranty ${status} successfully`
            });

            // Send notifications and log activities asynchronously in the background
            (async () => {
                try {
                    // Send email notification to customer only if email is provided
                    if (warrantyData.customer_email && warrantyData.customer_email.trim()) {
                        try {
                            // Prepare store address string
                            const storeFullAddress = [warrantyData.store_address, warrantyData.store_city, warrantyData.store_state]
                                .filter(Boolean).join(', ');

                            if (status === 'validated') {
                                // â”€â”€ Customer Approval: WhatsApp first, email fallback â”€â”€
                                let approvalWaSent = false;
                                if (process.env.ENABLE_WHATSAPP === 'true' && warrantyData.customer_phone) {
                                    try {
                                        const purchaseDate = (warrantyData.purchase_date || warrantyData.created_at)
                                            ? new Date(warrantyData.purchase_date || warrantyData.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                                            : 'N/A';
                                        const productName = (productDetails as any)?.product || (productDetails as any)?.productName || warrantyData.product_type || 'Autoform Product';
                                        approvalWaSent = await runWithRetry(
                                            () => WhatsAppService.sendWarrantyApprovedCustomer(
                                                warrantyData.customer_phone,
                                                warrantyData.customer_name,
                                                productName,
                                                warrantyData.registration_number || 'N/A',
                                                warrantyData.uid,
                                                warrantyData.store_name || warrantyData.installer_name || 'Autoform Store',
                                                'Active',
                                                purchaseDate,
                                                warrantyData.warranty_type || 'Standard'
                                            ),
                                            3,
                                            5000,
                                            `WhatsApp Customer Approval (${warrantyData.uid})`
                                        );
                                        console.log(`[WhatsApp] Warranty approval sent to customer: ${warrantyData.customer_phone}`);
                                    } catch (waErr) {
                                        console.error('[WhatsApp] Failed to send approval to customer:', waErr);
                                    }
                                }
                                // Send Email (always live alongside WhatsApp)
                                await runWithRetry(
                                    () => EmailService.sendWarrantyApprovalToCustomer(
                                        warrantyData.customer_email,
                                        warrantyData.customer_name,
                                        warrantyData.uid,
                                        warrantyData.product_type,
                                        warrantyData.registration_number,
                                        warrantyData.car_make,
                                        warrantyData.car_model,
                                        productDetails,
                                        warrantyData.warranty_type,
                                        warrantyData.store_name,
                                        storeFullAddress,
                                        warrantyData.store_email,
                                        warrantyData.applicator_name,
                                        (warrantyData.purchase_date || warrantyData.created_at)
                                            ? new Date(warrantyData.purchase_date || warrantyData.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                                            : 'N/A'
                                    ),
                                    3,
                                    5000,
                                    `Email Customer Approval (${warrantyData.uid})`
                                );
                                console.log(`âœ“ Warranty approval email sent to customer: ${warrantyData.customer_email}`);
                            } else if (status === 'rejected') {
                                // â”€â”€ Customer Rejection: WhatsApp first, email fallback â”€â”€
                                let rejectionWaSent = false;
                                if (process.env.ENABLE_WHATSAPP === 'true' && warrantyData.customer_phone) {
                                    try {
                                        const purchaseDate = (warrantyData.purchase_date || warrantyData.created_at)
                                            ? new Date(warrantyData.purchase_date || warrantyData.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                                            : 'N/A';
                                        const productName = (productDetails as any)?.product || (productDetails as any)?.productName || warrantyData.product_type || 'Autoform Product';
                                        rejectionWaSent = await runWithRetry(
                                            () => WhatsAppService.sendWarrantyRejectedCustomer(
                                                warrantyData.customer_phone,
                                                warrantyData.customer_name,
                                                productName,
                                                warrantyData.registration_number || 'N/A',
                                                warrantyData.uid,
                                                warrantyData.store_name || warrantyData.installer_name || 'Autoform Store',
                                                'Not Approved',
                                                purchaseDate,
                                                warrantyData.warranty_type || 'Standard',
                                                rejectionReason
                                            ),
                                            3,
                                            5000,
                                            `WhatsApp Customer Rejection (${warrantyData.uid})`
                                        );
                                        console.log(`[WhatsApp] Warranty rejection sent to customer: ${warrantyData.customer_phone}`);
                                    } catch (waErr) {
                                        console.error('[WhatsApp] Failed to send rejection to customer:', waErr);
                                    }
                                }
                                // Send Email (always live alongside WhatsApp)
                                await runWithRetry(
                                    () => EmailService.sendWarrantyRejectionToCustomer(
                                        warrantyData.customer_email,
                                        warrantyData.customer_name,
                                        warrantyData.uid,
                                        warrantyData.product_type,
                                        warrantyData.registration_number,
                                        rejectionReason,
                                        warrantyData.car_make,
                                        warrantyData.car_model,
                                        productDetails,
                                        warrantyData.warranty_type,
                                        warrantyData.store_name,
                                        storeFullAddress,
                                        warrantyData.store_email,
                                        warrantyData.applicator_name
                                    ),
                                    3,
                                    5000,
                                    `Email Customer Rejection (${warrantyData.uid})`
                                );
                                console.log(`âœ“ Warranty rejection email sent to customer: ${warrantyData.customer_email}`);
                            }
                        } catch (emailError: any) {
                            console.error('Customer email sending error:', emailError);
                        }
                    } else {
                        console.log(`â„¹ï¸ No customer email provided, skipping email notification for warranty ${warrantyData.uid}`);
                    }

                    // ── Installer (manpower) approval notice ──────────────────
                    // Deliberately outside the customer-email block above: whether
                    // the customer left an email has no bearing on telling the
                    // installer their work was approved.
                    // Gated by the 'manpower_warranty_approved' admin toggle inside
                    // the WhatsApp service, so no extra check is needed here.
                    //
                    // A franchise owner who fits the product themselves gets a real
                    // manpower row too (manpower_id like "owner-<hash>"), so this
                    // send site can't otherwise tell an owner apart from hired staff.
                    // Skipped on purpose: "installed by you... credited to your
                    // profile" reads as though someone else is crediting an
                    // employee, which is the wrong framing for the person who owns
                    // the store — and they already see the approval in their own
                    // dashboard.
                    const installerIsOwner = String(warrantyData.applicator_code || '').startsWith('owner-');

                    if (
                        status === 'validated' &&
                        process.env.ENABLE_WHATSAPP === 'true' &&
                        warrantyData.applicator_phone &&
                        warrantyData.applicator_active &&
                        !installerIsOwner
                    ) {
                        try {
                            // productName is a bare model code (e.g. "D3"); fall back to
                            // the product type on the ~0.1% of rows that lack it.
                            const rawProduct =
                                (productDetails as any)?.productName ||
                                (productDetails as any)?.product ||
                                (warrantyData.product_type === 'seat-cover' ? 'Seat Cover'
                                    : warrantyData.product_type === 'ev-products' ? 'Paint Protection Film'
                                        : warrantyData.product_type) ||
                                'Autoform Product';

                            // Running total for this installer. The status update is
                            // already committed above, so this count includes the
                            // warranty we're notifying about. Indexed on manpower_id.
                            //
                            // Bounded to the configured send window, when one is set,
                            // by created_at (when each warranty was REGISTERED) — the
                            // same date the send-gate in isWithinNotificationWindow
                            // judges. The scheme rewards installations done during the
                            // window, so the decision to message and the number in the
                            // message must describe the same set of warranties.
                            //
                            // Counting by validated_at instead answered a different
                            // question ("approved this month") than the gate asks
                            // ("registered this month"): an installer whose September
                            // work was approved in October would be messaged but
                            // counted as 0, and August work approved in September was
                            // counted without ever being messaged.
                            //
                            // Compared on the IST calendar date to match the gate
                            // exactly — created_at is stored UTC, so it is shifted
                            // before truncating, or a warranty registered between
                            // 00:00 and 05:30 IST lands on the previous day and the
                            // two rules disagree at the window's edges.
                            let totalApproved = 0;
                            let tallyFailed = false;
                            try {
                                const windows = await loadNotificationWindows();
                                const win = windows['manpower_warranty_approved'];

                                const params: any[] = [warrantyData.manpower_id];
                                let dateClause = '';
                                const istRegDate = "DATE(CONVERT_TZ(created_at, '+00:00', '+05:30'))";
                                if (win?.startDate) { dateClause += ` AND ${istRegDate} >= ?`; params.push(win.startDate); }
                                if (win?.endDate) { dateClause += ` AND ${istRegDate} <= ?`; params.push(win.endDate); }

                                const [tally]: any = await db.execute(
                                    `SELECT COUNT(*) AS n FROM warranty_registrations
                                     WHERE manpower_id = ? AND status = 'validated'${dateClause}`,
                                    params
                                );
                                totalApproved = Number(tally[0]?.n || 0);
                                // This request's own approval just committed, and the
                                // gate only let us get here for a warranty registered
                                // inside the window — the same condition this query
                                // filters on — so this row is always counted and a
                                // genuinely successful tally can never be < 1. A 0 here
                                // means the count and the gate have drifted apart
                                // again, so treat it as a failure and stay silent
                                // rather than send "Total approved installations: 0".
                                if (totalApproved < 1) tallyFailed = true;
                            } catch (tallyErr) {
                                console.error('[WhatsApp] Installer tally failed:', tallyErr);
                                tallyFailed = true;
                            }

                            // Skip only on a genuine failure — never send "Total
                            // approved installations: 0" right after telling them one
                            // was approved.
                            if (tallyFailed) {
                                console.warn(`[WhatsApp] Skipping installer notice for ${warrantyData.uid} — tally unavailable`);
                            } else {
                                await runWithRetry(
                                    () => WhatsAppService.sendManpowerWarrantyApproved(
                                        warrantyData.applicator_phone,
                                        warrantyData.applicator_name || 'Installer',
                                        String(rawProduct),
                                        warrantyData.customer_name || 'Customer',
                                        warrantyData.uid,
                                        totalApproved,
                                        // Registration date, not today's — the admin's
                                        // send window describes which warranties
                                        // qualify, not when this approval happened.
                                        warrantyData.created_at
                                    ),
                                    3,
                                    5000,
                                    `WhatsApp Installer Approval (${warrantyData.uid})`
                                );
                                console.log(`[WhatsApp] Installer approval sent to ${warrantyData.applicator_name} (total: ${totalApproved})`);
                            }
                        } catch (mpErr) {
                            console.error('[WhatsApp] Failed to notify installer:', mpErr);
                        }
                    }

                    // Send email + notification to franchise/vendor
                    // Strategy: try manpower lookup first, fall back to installer_name (store name)
                    try {
                        let vendorEmail: string | null = null;
                        let vendorName: string | null = warrantyData.store_name || null;
                        let vendorUserId: string | null = null;
                        let applicatorName: string | null = warrantyData.applicator_name || null;

                        // The warranty's own store, by id — never by name, which
                        // another store can share (services/warrantyStore.ts).
                        if (warrantyData.vendor_details_id) {
                            const [vendorInfo]: any = await db.execute(
                                `SELECT p.email as vendor_email, p.id as vendor_user_id, vd.store_name as vendor_name
                                 FROM vendor_details vd
                                 JOIN profiles p ON vd.user_id = p.id
                                 WHERE vd.id = ?`,
                                [warrantyData.vendor_details_id]
                            );
                            if (vendorInfo.length > 0) {
                                vendorEmail = vendorInfo[0].vendor_email;
                                vendorName = vendorInfo[0].vendor_name;
                                vendorUserId = vendorInfo[0].vendor_user_id;
                            }
                        }

                        // 3. Send vendor notification if we found one
                        if (vendorEmail && vendorName) {
                            if (status === 'validated') {
                                // Vendor approval: no WhatsApp template, email stays primary
                                await runWithRetry(
                                    () => EmailService.sendWarrantyApprovalToVendor(
                                        vendorEmail!,
                                        vendorName!,
                                        warrantyData.customer_name,
                                        warrantyData.customer_phone,
                                        warrantyData.product_type,
                                        warrantyData.registration_number,
                                        applicatorName ?? '',
                                        warrantyData.uid,
                                        warrantyData.car_make,
                                        warrantyData.car_model,
                                        productDetails,
                                        warrantyData.warranty_type
                                    ),
                                    3,
                                    5000,
                                    `Email Vendor Approval (${warrantyData.uid})`
                                );
                                console.log(`âœ“ Warranty approval email sent to vendor: ${vendorEmail}`);
                            } else if (status === 'rejected') {
                                // â”€â”€ Vendor Rejection: WhatsApp first, email fallback â”€â”€
                                let vendorRejWaSent = false;
                                if (process.env.ENABLE_WHATSAPP === 'true') {
                                    try {
                                        const [vendorPhone]: any = await db.execute(
                                            `SELECT p.phone_number FROM profiles p
                                             JOIN vendor_details vd ON vd.user_id = p.id
                                             WHERE p.email = ? LIMIT 1`,
                                            [vendorEmail]
                                        );
                                        if (vendorPhone.length > 0 && vendorPhone[0].phone_number) {
                                            const purchaseDate = warrantyData.created_at
                                                ? new Date(warrantyData.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                                                : 'N/A';
                                            const productName = (productDetails as any)?.product || (productDetails as any)?.productName || warrantyData.product_type || 'Autoform Product';
                                            vendorRejWaSent = await runWithRetry(
                                                () => WhatsAppService.sendVendorRejected(
                                                    vendorPhone[0].phone_number,
                                                    vendorName ?? 'Franchise Partner',
                                                    productName,
                                                    warrantyData.registration_number || 'N/A',
                                                    warrantyData.uid,
                                                    'Not Approved',
                                                    purchaseDate,
                                                    warrantyData.warranty_type || 'Standard',
                                                    rejectionReason
                                                ),
                                                3,
                                                5000,
                                                `WhatsApp Vendor Rejection (${warrantyData.uid})`
                                            );
                                            console.log(`[WhatsApp] Vendor rejection notice sent to: ${vendorPhone[0].phone_number}`);
                                        }
                                    } catch (waErr) {
                                        console.error('[WhatsApp] Failed to send vendor rejection notice:', waErr);
                                    }
                                }
                                // Send Email (always live alongside WhatsApp)
                                await runWithRetry(
                                    () => EmailService.sendWarrantyRejectionToVendor(
                                        vendorEmail!,
                                        vendorName!,
                                        warrantyData.customer_name,
                                        warrantyData.customer_phone,
                                        warrantyData.product_type,
                                        warrantyData.registration_number,
                                        applicatorName ?? '',
                                        rejectionReason,
                                        warrantyData.uid,
                                        warrantyData.car_make,
                                        warrantyData.car_model,
                                        productDetails,
                                        warrantyData.warranty_type
                                    ),
                                    3,
                                    5000,
                                    `Email Vendor Rejection (${warrantyData.uid})`
                                );
                                console.log(`âœ“ Warranty rejection email sent to vendor: ${vendorEmail}`);
                            }
                        } else {
                            console.log(`â„¹ï¸ No vendor email found for warranty ${warrantyData.uid}, skipping vendor email`);
                        }

                        // 4. Send real-time notification to vendor
                        if (vendorUserId) {
                            let title = 'Warranty Pending â³';
                            let message = `The warranty for ${warrantyData.customer_name} (${warrantyData.uid}) is pending review.`;

                            if (status === 'validated') {
                                title = 'Warranty Approved! âœ“';
                                message = `The warranty for ${warrantyData.customer_name} (${warrantyData.uid}) has been approved.`;
                            } else if (status === 'rejected') {
                                message = `The warranty for ${warrantyData.customer_name} (${warrantyData.uid}) has been rejected. Reason: ${rejectionReason}`;
                            }

                            await NotificationService.notify(vendorUserId, {
                                title,
                                message,
                                type: 'warranty',
                                link: `/dashboard/vendor`
                            });
                        }

                        // 5. Notify Customer
                        if (warrantyData.user_id) {
                            let title = 'Warranty Pending â³';
                            let message = `Your warranty for ${warrantyData.uid} is now under review by AutoForm.`;

                            if (status === 'validated') {
                                title = 'Warranty Validated! âœ“';
                                message = `Your warranty for ${warrantyData.uid} has been validated by AutoForm.`;
                            } else if (status === 'rejected') {
                                message = `Your warranty for ${warrantyData.uid} has been rejected. Reason: ${rejectionReason}`;
                            }

                            await NotificationService.notify(warrantyData.user_id, {
                                title,
                                message,
                                type: 'warranty',
                                link: `/dashboard/customer`
                            });
                        }
                    } catch (notifError: any) {
                        console.error('Failed to send vendor/customer notifications:', notifError);
                    }

                    // Log the activity
                    const admin = (req as any).user;
                    await ActivityLogService.log({
                        adminId: admin.id,
                        adminName: admin.name,
                        adminEmail: admin.email,
                        actionType: status === 'validated' ? 'WARRANTY_APPROVED' :
                            status === 'pending' ? 'WARRANTY_OVERRIDDEN' : 'WARRANTY_REJECTED',
                        targetType: 'WARRANTY',
                        targetId: warrantyData.uid,
                        targetName: warrantyData.uid,
                        details: {
                            customer_name: warrantyData.customer_name,
                            product_type: warrantyData.product_type,
                            rejection_reason: rejectionReason || null
                        },
                        ipAddress: req.ip || req.socket?.remoteAddress
                    });
                } catch (bgError) {
                    console.error('[Background] Failed to process background warranty notifications:', bgError);
                }
            })();
        } catch (error: any) {
            console.error('Update warranty status error:', error);
            res.status(500).json({ error: 'Failed to update warranty status' });
        }
    }

    static async updateWarrantyDetails(req: Request, res: Response) {
        try {
            const { uid } = req.params;
            const {
                customer_name, customer_email, customer_phone,
                car_make, car_model, car_colour,
                registration_number, product_name, warranty_type,
                purchase_date, new_uid, serial_number
            } = req.body;

            const [existingRows]: any = await db.execute(
                'SELECT * FROM warranty_registrations WHERE uid = ?',
                [uid]
            );

            if (existingRows.length === 0) {
                return res.status(404).json({ error: 'Warranty not found' });
            }

            const existing = existingRows[0];

            // Approved warranties were previously locked. Admins need to correct
            // genuine mistakes after approval, and this route is already
            // admin-only, so the edit is allowed and logged instead of refused.
            if (existing.status === 'validated') {
                console.log(`[Admin] Editing an APPROVED warranty ${uid} — admin ${(req as any).user?.email || 'unknown'}`);
            }

            // Determine the target UID. Admins may correct the UID (seat covers)
            // — validate and guard against collisions before we relink anything.
            const isSeatCover = existing.product_type === 'seat-cover';
            let targetUid = uid;
            if (new_uid !== undefined && String(new_uid).trim() !== '' && String(new_uid).trim() !== uid) {
                targetUid = String(new_uid).trim();

                const [clash]: any = await db.execute(
                    'SELECT id FROM warranty_registrations WHERE uid = ? AND id != ?',
                    [targetUid, existing.id]
                );
                if (clash.length > 0) {
                    return res.status(400).json({ error: 'That UID is already used by another warranty registration.' });
                }
            }

            // Update the JSON product_details to keep the frontend in sync
            let productDetails: any = {};
            try {
                productDetails = typeof existing.product_details === 'string'
                    ? JSON.parse(existing.product_details)
                    : (existing.product_details || {});
            } catch (e) {
                console.error('Failed to parse product_details', e);
            }

            if (customer_name !== undefined) productDetails.customerName = customer_name;
            if (customer_email !== undefined) productDetails.customerEmail = customer_email;
            if (customer_phone !== undefined) productDetails.customerPhone = customer_phone;
            if (registration_number !== undefined) productDetails.carRegistration = registration_number;
            if (product_name !== undefined) productDetails.productName = product_name;
            // PPF/EV warranties store the identifier as a serial number in JSON.
            if (serial_number !== undefined) productDetails.serialNumber = serial_number;
            // Keep the mirrored uid inside product_details in sync when the UID changes.
            if (targetUid !== uid) productDetails.uid = targetUid;

            const connection = await db.getConnection();
            try {
                await connection.beginTransaction();

                await connection.execute(
                    `UPDATE warranty_registrations SET
                        uid = ?,
                        customer_name = ?,
                        customer_email = ?,
                        customer_phone = ?,
                        car_make = ?,
                        car_model = ?,
                        car_colour = ?,
                        registration_number = ?,
                        warranty_type = ?,
                        purchase_date = ?,
                        product_details = ?
                     WHERE id = ?`,
                    [
                        targetUid,
                        customer_name !== undefined ? customer_name : existing.customer_name,
                        customer_email !== undefined ? customer_email : existing.customer_email,
                        customer_phone !== undefined ? customer_phone : existing.customer_phone,
                        car_make !== undefined ? car_make : existing.car_make,
                        car_model !== undefined ? car_model : existing.car_model,
                        car_colour !== undefined ? car_colour : existing.car_colour,
                        registration_number !== undefined ? registration_number : existing.registration_number,
                        warranty_type !== undefined ? warranty_type : existing.warranty_type,
                        purchase_date !== undefined ? purchase_date : existing.purchase_date,
                        JSON.stringify(productDetails),
                        existing.id
                    ]
                );

                // For seat covers the UID is drawn from pre_generated_uids stock.
                // When the admin corrects it, release the old pre-generated UID and
                // mark the new one as used (only if that new UID exists in stock).
                if (isSeatCover && targetUid !== uid) {
                    await connection.execute(
                        'UPDATE pre_generated_uids SET is_used = FALSE, used_at = NULL WHERE uid = ?',
                        [uid]
                    );
                    await connection.execute(
                        'UPDATE pre_generated_uids SET is_used = TRUE, used_at = NOW() WHERE uid = ?',
                        [targetUid]
                    );
                }

                /*
                 * PPF's equivalent: the roll ledger records its draws against the
                 * warranty id, so renaming the warranty without moving them would
                 * leave the rolls charged to an id that no longer exists — the film
                 * still consumed, but by nothing anyone can find.
                 */
                if (!isSeatCover && targetUid !== uid) {
                    await connection.execute(
                        'UPDATE ppf_roll_consumption SET warranty_uid = ? WHERE warranty_uid = ?',
                        [targetUid, uid]
                    );
                }

                await connection.commit();
            } catch (txErr) {
                await connection.rollback();
                throw txErr;
            } finally {
                connection.release();
            }

            const admin = (req as any).user;

            // Build a before/after diff for the audit trail
            const changes: Record<string, { before: any, after: any }> = {};
            const fieldMap: Record<string, string> = {
                customer_name: 'Customer Name',
                customer_email: 'Customer Email',
                customer_phone: 'Customer Phone',
                car_make: 'Car Make',
                car_model: 'Car Model',
                car_colour: 'Vehicle Colour',
                registration_number: 'Registration Number',
                warranty_type: 'Warranty Type',
                purchase_date: 'Purchase Date',
            };
            for (const [key, label] of Object.entries(fieldMap)) {
                const bodyVal = req.body[key];
                if (bodyVal !== undefined && String(bodyVal) !== String(existing[key] ?? '')) {
                    changes[label] = { before: existing[key] ?? null, after: bodyVal };
                }
            }
            if (product_name !== undefined && product_name !== productDetails.productName) {
                changes['Product Name'] = { before: productDetails.productName ?? null, after: product_name };
            }
            if (targetUid !== uid) {
                changes['UID'] = { before: uid, after: targetUid };
            }
            if (serial_number !== undefined) {
                // Compare against the serial number stored before this edit.
                let prevSerial: any = null;
                try {
                    const pd = typeof existing.product_details === 'string'
                        ? JSON.parse(existing.product_details)
                        : (existing.product_details || {});
                    prevSerial = pd.serialNumber ?? null;
                } catch { /* leave prevSerial null */ }
                if (String(serial_number) !== String(prevSerial ?? '')) {
                    /*
                     * The same input box means two different things.
                     *
                     * A seat cover carries a pre-printed UID and has no serial
                     * number at all; PPF carries a manufacturer serial read off
                     * the product. The spec sheet sends both as `serial_number`,
                     * so labelling every edit "Serial Number" told an admin that
                     * somebody had changed a seat cover's serial — a field that
                     * does not exist — when what they changed was the UID.
                     */
                    const identifierLabel =
                        existing.product_type === 'seat-cover' ? 'UID' : 'Serial Number';
                    // The UID may already have its own entry from the check above.
                    // Two changes under one key would silently discard the first.
                    if (!(identifierLabel in changes)) {
                        changes[identifierLabel] = { before: prevSerial, after: serial_number };
                    }
                }
            }

            await ActivityLogService.log({
                adminId: admin.id,
                adminName: admin.name,
                adminEmail: admin.email,
                actionType: 'WARRANTY_UPDATED',
                targetType: 'WARRANTY',
                targetId: targetUid,
                targetName: `${existing.customer_name} (${targetUid})`,
                details: {
                    summary: `Admin edited warranty details for ${existing.customer_name}`,
                    changes
                },
                ipAddress: req.ip || req.socket?.remoteAddress
            });

            res.json({
                success: true,
                message: 'Warranty details updated successfully'
            });

        } catch (error: any) {
            console.error('Update warranty details error:', error);
            res.status(500).json({ error: 'Failed to update warranty details' });
        }
    }

    /**
     * Replace a single warranty photo or the invoice.
     *
     * The customer/vendor resubmit route (PUT /warranty/:uid) needs the whole
     * form and is built for the store correcting its own entry. An admin fixing
     * one blurred photo should not have to resend every field, so this takes a
     * single file and swaps just that key.
     *
     * The previous URL is kept in the activity log rather than deleted from
     * disk: an image replaced by mistake is then still recoverable.
     */
    static async replaceWarrantyPhoto(req: Request, res: Response) {
        try {
            const { uid } = req.params;
            const { field } = req.body as { field?: string };
            const files = (req.files as Express.Multer.File[]) || [];
            const file = files[0];

            if (!file) {
                return res.status(400).json({ error: 'No file uploaded' });
            }
            if (!field || !REPLACEABLE_PHOTO_FIELDS.has(field)) {
                return res.status(400).json({
                    error: `field must be one of: ${[...REPLACEABLE_PHOTO_FIELDS].join(', ')}`
                });
            }

            // CAST(? AS CHAR) forces a string comparison. `uid` is VARCHAR, so a
            // numeric-looking parameter would otherwise make MySQL coerce the whole
            // column to a number — every non-numeric uid collapses to 0 and can
            // match unrelated rows. That was the cause of the earlier
            // "one edit filled every entry" incident; see updateWarranty.
            const [rows]: any = await db.execute(
                'SELECT id, uid, customer_name, product_details FROM warranty_registrations WHERE uid = CAST(? AS CHAR)',
                [String(uid)]
            );
            if (rows.length === 0) {
                return res.status(404).json({ error: 'Warranty not found' });
            }
            // Defence in depth: refuse rather than risk writing to the wrong record.
            if (rows.length > 1) {
                console.error(`[Replace Photo] Ambiguous uid "${uid}" matched ${rows.length} rows. Aborting.`);
                return res.status(409).json({ error: 'This identifier matches multiple registrations. Please contact support.' });
            }
            const existing = rows[0];

            let productDetails: any = {};
            try {
                productDetails = typeof existing.product_details === 'string'
                    ? JSON.parse(existing.product_details)
                    : (existing.product_details || {});
            } catch (e) {
                console.error('Failed to parse product_details', e);
            }

            // attachPublicUrls has already rewritten file.path to a public URL.
            const newUrl = (file as any).path;
            const previousUrl: string | null = field === 'invoiceFileName'
                ? (productDetails.invoiceFileName ?? null)
                : (productDetails.photos?.[field] ?? null);

            /*
             * Write only the one key, via JSON_SET, rather than serialising the
             * whole object back.
             *
             * Reading the JSON, editing it here and writing it all back would let
             * two admins working on the same warranty clobber each other: both
             * read the same snapshot, and whoever saves last silently reverts the
             * other's image. JSON_SET edits the stored document in place, so a
             * concurrent change to a different key survives.
             *
             * The path is built from REPLACEABLE_PHOTO_FIELDS, never raw input.
             */
            const jsonPath = field === 'invoiceFileName'
                ? '$.invoiceFileName'
                : `$.photos.${field}`;

            /*
             * JSON_SET silently does nothing when the PARENT path is absent —
             * setting $.photos.vehicle on a document with no "photos" key leaves
             * the document unchanged. Three live rows have no photos object, so
             * the inner JSON_SET creates it first when it is missing.
             */
            const [result]: any = await db.execute(
                `UPDATE warranty_registrations
                    SET product_details = JSON_SET(
                        JSON_SET(
                            COALESCE(product_details, JSON_OBJECT()),
                            '$.photos',
                            COALESCE(JSON_EXTRACT(product_details, '$.photos'), JSON_OBJECT())
                        ),
                        ?, ?
                    )
                  WHERE id = ?`,
                [jsonPath, newUrl, existing.id]
            );

            /*
             * seat_cover_photo_url and car_outer_photo_url mirror two of the JSON
             * photos. Nothing renders from them today — every screen reads
             * product_details.photos — but they are written on submit, and 7 rows
             * have already drifted out of step. Updating them here keeps the
             * mirror honest instead of widening that gap.
             */
            const MIRRORED_COLUMNS: Record<string, string> = {
                seatCover: 'seat_cover_photo_url',
                carOuter: 'car_outer_photo_url',
            };
            const mirrorColumn = MIRRORED_COLUMNS[field];
            if (mirrorColumn) {
                await db.execute(
                    `UPDATE warranty_registrations SET \`${mirrorColumn}\` = ? WHERE id = ?`,
                    [newUrl, existing.id]
                );
            }

            if (result.affectedRows !== 1) {
                console.error(`[Replace Photo] Expected to update 1 row, updated ${result.affectedRows} for uid ${uid}`);
                return res.status(500).json({ error: 'Image was not saved. Please try again.' });
            }

            const admin = (req as any).user;
            await ActivityLogService.log({
                adminId: admin.id,
                adminName: admin.name,
                adminEmail: admin.email,
                actionType: 'WARRANTY_UPDATED',
                targetType: 'WARRANTY',
                targetId: uid,
                targetName: `${existing.customer_name} (${uid})`,
                details: {
                    summary: `Admin replaced the ${field} image for ${existing.customer_name}`,
                    changes: { [field]: { before: previousUrl, after: newUrl } }
                },
                ipAddress: req.ip || req.socket?.remoteAddress
            });

            res.json({ success: true, field, url: newUrl, message: 'Image replaced successfully' });

        } catch (error: any) {
            console.error('Replace warranty photo error:', error);
            res.status(500).json({ error: 'Failed to replace image' });
        }
    }

    static async getAllWarranties(req: Request, res: Response) {
        try {
            // Keep the admin list page-sized.  A larger response is permitted only
            // for an explicit export request, never for the interactive screen.
            const page = Math.max(parseInt(req.query.page as string) || 1, 1);
            const requestedLimit = parseInt(req.query.limit as string) || 30;
            const isExport = req.query.export === 'true';
            const limit = Math.min(Math.max(requestedLimit, 1), isExport ? 10000 : 100);
            const offset = (page - 1) * limit;

            // Extract Filters
            const { status, search, product_type, make, date_from, date_to, model, resubmitted } = req.query;

            let conditions: string[] = [];
            let params: any[] = [];
            // Summary counts should respect the active search/advanced filters, but
            // deliberately ignore the selected status tab so its badge remains useful.
            let summaryConditions: string[] = [];
            let summaryParams: any[] = [];

            const addCondition = (condition: string, values: any[] = []) => {
                conditions.push(condition);
                params.push(...values);
                summaryConditions.push(condition);
                summaryParams.push(...values);
            };

            // 1. Dynamic Filters

            // Status Filtering. The API now uses the same status names as the UI.
            if (status && status !== 'all') {
                if (status === 'pending_ho') {
                    conditions.push("wr.status = 'pending'");
                } else if (status === 'quick_review') {
                    conditions.push("wr.status IN ('pending', 'pending_vendor')");
                } else {
                    conditions.push('wr.status = ?');
                    params.push(status);
                }
            }

            /*
             * Rejected once, corrected, and waiting again.
             *
             * There is no status for it: a resubmission returns the warranty to
             * whichever queue it came from, so what marks it out is rejected_at
             * surviving that move. Added through addCondition rather than the
             * status branch above, so it narrows whatever tab is open instead
             * of replacing it — "the resubmitted ones among the vendor's", not
             * "resubmitted instead of vendor".
             */
            if (resubmitted === 'true') {
                addCondition("wr.rejected_at IS NOT NULL AND wr.status IN ('pending', 'pending_vendor')");
            }

            // Product Type
            if (product_type && product_type !== 'all') {
                if (product_type === 'ppf') {
                    addCondition("(wr.product_type LIKE '%ppf%' OR wr.product_type LIKE '%ev%')");
                } else if (product_type === 'seat-cover') {
                    addCondition("(wr.product_type LIKE '%seat%' OR wr.product_type LIKE '%cover%')");
                } else {
                    addCondition('wr.product_type = ?', [product_type]);
                }
            }

            // Make
            if (make && make !== 'all') {
                addCondition('wr.car_make = ?', [make]);
            }

            // Model
            if (model && model !== 'all') {
                addCondition('wr.car_model = ?', [model]);
            }

            // Search
            if (search) {
                const searchTerm = `%${String(search).trim().slice(0, 100)}%`;
                const searchCondition = `(
                    wr.customer_name LIKE ? OR 
                    wr.customer_email LIKE ? OR
                    wr.customer_phone LIKE ? OR 
                    wr.uid LIKE ? OR 
                    wr.registration_number LIKE ? OR 
                    wr.product_details LIKE ? OR
                    wr.car_make LIKE ? OR 
                    wr.car_model LIKE ? OR
                    wr.installer_name LIKE ? OR
                    vd_s.store_name LIKE ? OR
                    vd_s.city LIKE ? OR
                    vd_s.store_code LIKE ?
                )`;
                const searchParams = Array(12).fill(searchTerm);
                addCondition(searchCondition, searchParams);
            }

            // Date Range
            if (date_from && date_to) {
                addCondition('wr.created_at BETWEEN ? AND ?', [
                    `${String(date_from)} 00:00:00`,
                    `${String(date_to)} 23:59:59`
                ]);
            }

            // 2. Build Query
            const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
            const summaryWhereClause = summaryConditions.length > 0 ? `WHERE ${summaryConditions.join(' AND ')}` : '';
            // The store is the one each warranty carries by id
            // (services/warrantyStore.ts) — never matched by name.
            const joins = `
                LEFT JOIN manpower m ON wr.manpower_id = m.id
                LEFT JOIN vendor_details vd_s ON vd_s.id = wr.vendor_details_id`;

            // Count Query (must include the same JOINs used in search conditions)
            const countQuery = `
                SELECT COUNT(*) as total
                FROM warranty_registrations wr
                ${joins}
                ${whereClause}
            `;
            const statusSummaryQuery = `
                SELECT wr.status, COUNT(*) as count
                FROM warranty_registrations wr
                ${joins}
                ${summaryWhereClause}
                GROUP BY wr.status
            `;

            const [[countResult], [statusSummaryResult], [makeResult], [modelResult]]: any = await Promise.all([
                db.execute(countQuery, params),
                db.execute(statusSummaryQuery, summaryParams),
                db.execute(`
                    SELECT DISTINCT car_make
                    FROM warranty_registrations
                    WHERE car_make IS NOT NULL AND car_make != ''
                    ORDER BY car_make ASC
                    LIMIT 250
                `),
                make && make !== 'all'
                    ? db.execute(`
                        SELECT DISTINCT car_model
                        FROM warranty_registrations
                        WHERE car_make = ? AND car_model IS NOT NULL AND car_model != ''
                        ORDER BY car_model ASC
                        LIMIT 250
                    `, [make])
                    : Promise.resolve([[]])
            ]);
            const totalCount = countResult[0].total;
            const totalPages = Math.ceil(totalCount / limit);
            const statusCounts = { validated: 0, pending: 0, pending_vendor: 0, rejected: 0 };
            statusSummaryResult.forEach((row: any) => {
                if (row.status in statusCounts) {
                    statusCounts[row.status as keyof typeof statusCounts] = Number(row.count);
                }
            });

            const allowedSortFields: Record<string, string> = {
                created_at: 'wr.created_at',
                purchase_date: 'wr.purchase_date',
                customer_name: 'wr.customer_name'
            };
            const sortBy = allowedSortFields[String(req.query.sort_by)] || allowedSortFields.created_at;
            const sortOrder = String(req.query.sort_order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

            // Get all warranties with user details including role (with pagination)
            const mainQuery = `
                SELECT 
                    wr.*,
                    p.name as submitted_by_name,
                    p.email as submitted_by_email,
                    (SELECT ur.role FROM user_roles ur WHERE ur.user_id = p.id LIMIT 1) as submitted_by_role,
                    m.name as manpower_name_from_db,
                    vd_s.store_name as vendor_store_name,
                    vd_s.store_email as vendor_store_email,
                    vd_s.store_code as vendor_store_code,
                    vd_s.city as vendor_city,
                    vd_s.state as vendor_state,
                    vd_s.latitude as store_lat,
                    vd_s.longitude as store_lng,
                    vp.phone_number as vendor_phone_number
                FROM warranty_registrations wr
                LEFT JOIN profiles p ON wr.user_id = p.id
                ${joins}
                LEFT JOIN profiles vp ON vd_s.user_id = vp.id
                ${whereClause}
                ORDER BY ${sortBy} ${sortOrder}, wr.id DESC
                LIMIT ? OFFSET ?
            `;

            const mainParams = [...params, limit, offset];
            const [warrantyList]: any = await db.query(mainQuery, mainParams);

            // Parse JSON product_details
            const formattedWarranties = warrantyList.map((warranty: any) => {
                let productDetails = {};
                try {
                    productDetails = typeof warranty.product_details === 'string'
                        ? JSON.parse(warranty.product_details)
                        : warranty.product_details || {};
                } catch {
                    // A malformed legacy record must not prevent the whole page loading.
                    productDetails = {};
                }
                return { ...warranty, product_details: productDetails };
            });

            res.json({
                success: true,
                warranties: formattedWarranties,
                statusCounts,
                filterOptions: {
                    makes: makeResult.map((row: any) => row.car_make),
                    models: modelResult.map((row: any) => row.car_model)
                },
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalCount,
                    limit,
                    hasNextPage: page < totalPages,
                    hasPrevPage: page > 1
                }
            });
        } catch (error: any) {
            console.error('Get all warranties error:', error);
            res.status(500).json({ error: 'Failed to fetch warranties' });
        }
    }

    static async getWarrantyById(req: Request, res: Response) {
        try {
            const { id } = req.params;

            // Try to find warranty by uid, id, or as a UUID in uid
            const query = `
                SELECT 
                    wr.*,
                    p.name as submitted_by_name,
                    p.email as submitted_by_email,
                    ur.role as submitted_by_role,
                    m.name as manpower_name_from_db,
                    vd.store_name as vendor_store_name,
                    vd.store_email as vendor_store_email,
                    vd.city as vendor_city,
                    vp.phone_number as vendor_phone_number
                FROM warranty_registrations wr
                LEFT JOIN profiles p ON wr.user_id = p.id
                LEFT JOIN user_roles ur ON p.id = ur.user_id
                LEFT JOIN manpower m ON wr.manpower_id = m.id
                LEFT JOIN vendor_details vd ON vd.id = wr.vendor_details_id
                LEFT JOIN profiles vp ON vd.user_id = vp.id
                WHERE wr.uid = ? OR wr.id = ?
                LIMIT 1
            `;

            const [result]: any = await db.execute(query, [id, id]);

            if (result.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Warranty not found'
                });
            }

            // Parse JSON product_details
            const warranty = {
                ...result[0],
                product_details: JSON.parse(result[0].product_details || '{}')
            };

            res.json({
                success: true,
                warranty
            });
        } catch (error: any) {
            console.error('Get warranty by ID error:', error);
            res.status(500).json({ error: 'Failed to fetch warranty' });
        }
    }

    static async getCustomers(req: Request, res: Response) {
        try {
            const exportAll = req.query.export === 'true';
            const requestedPage = Number(req.query.page || 1);
            const requestedPageSize = Number(req.query.pageSize || 10);
            const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
            const pageSize = Number.isInteger(requestedPageSize)
                ? Math.min(Math.max(requestedPageSize, 1), 100)
                : 10;
            const offset = (page - 1) * pageSize;
            const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
            const searchPattern = `%${search}%`;

            const sortColumns: Record<string, string> = {
                created_at: 'registered_at',
                first_warranty_date: 'registered_at',
                registered_at: 'registered_at',
                customer_name: 'customer_name',
                total_warranties: 'total_warranties',
                warranty_count: 'total_warranties'
            };
            const requestedSort = typeof req.query.sortField === 'string' ? req.query.sortField : 'registered_at';
            const sortColumn = sortColumns[requestedSort] || 'registered_at';
            const sortOrder = req.query.sortOrder === 'asc' ? 'ASC' : 'DESC';

            const paginationSql = exportAll ? '' : 'LIMIT ? OFFSET ?';
            const customerParams: any[] = [search, searchPattern, searchPattern, searchPattern];
            if (!exportAll) {
                customerParams.push(pageSize, offset);
            }

            const customersSql = `
                WITH customer_profiles AS (
                    SELECT p.id, p.name, p.email, p.phone_number, p.created_at
                    FROM profiles p
                    WHERE EXISTS (
                        SELECT 1
                        FROM user_roles ur
                        WHERE ur.user_id = p.id AND ur.role = 'customer'
                    )
                ),
                vendor_profiles AS (
                    SELECT p.id, p.name, p.email
                    FROM profiles p
                    WHERE EXISTS (
                        SELECT 1
                        FROM user_roles ur
                        WHERE ur.user_id = p.id AND ur.role = 'vendor'
                    )
                ),
                registered_customers AS (
                    SELECT
                        p.name AS customer_name,
                        p.email AS customer_email,
                        p.phone_number AS customer_phone,
                        NULL AS customer_address,
                        COUNT(wr.uid) AS total_warranties,
                        COALESCE(SUM(CASE WHEN wr.status = 'validated' THEN 1 ELSE 0 END), 0) AS validated_warranties,
                        COALESCE(SUM(CASE WHEN wr.status IN ('pending', 'pending_vendor') THEN 1 ELSE 0 END), 0) AS pending_warranties,
                        COALESCE(SUM(CASE WHEN wr.status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected_warranties,
                        MIN(wr.created_at) AS first_warranty_date,
                        MAX(wr.created_at) AS last_warranty_date,
                        p.created_at AS registered_at
                    FROM customer_profiles p
                    LEFT JOIN warranty_registrations wr ON wr.user_id = p.id
                    WHERE NOT EXISTS (
                        SELECT 1
                        FROM vendor_profiles vp
                        WHERE vp.id = p.id
                    )
                    GROUP BY p.id, p.name, p.email, p.phone_number, p.created_at
                ),
                guest_aggregates AS (
                    SELECT
                        customer_name,
                        customer_email,
                        customer_phone,
                        COUNT(uid) AS total_warranties,
                        SUM(CASE WHEN status = 'validated' THEN 1 ELSE 0 END) AS validated_warranties,
                        SUM(CASE WHEN status IN ('pending', 'pending_vendor') THEN 1 ELSE 0 END) AS pending_warranties,
                        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected_warranties,
                        MIN(created_at) AS first_warranty_date,
                        MAX(created_at) AS last_warranty_date
                    FROM warranty_registrations
                    WHERE (customer_email IS NOT NULL AND customer_email != '' AND customer_email != 'N/A')
                       OR (customer_phone IS NOT NULL AND customer_phone != '' AND customer_phone != 'N/A')
                    GROUP BY customer_name, customer_email, customer_phone
                ),
                guest_customers AS (
                    SELECT
                        guest.customer_name,
                        guest.customer_email,
                        guest.customer_phone,
                        NULL AS customer_address,
                        guest.total_warranties,
                        guest.validated_warranties,
                        guest.pending_warranties,
                        guest.rejected_warranties,
                        guest.first_warranty_date,
                        guest.last_warranty_date,
                        guest.first_warranty_date AS registered_at
                    FROM guest_aggregates guest
                    WHERE NOT EXISTS (
                        SELECT 1
                        FROM customer_profiles customer
                        WHERE guest.customer_email IS NOT NULL
                          AND guest.customer_email != ''
                          AND guest.customer_email != 'N/A'
                          AND customer.email = guest.customer_email
                    )
                    AND NOT EXISTS (
                        SELECT 1
                        FROM customer_profiles customer
                        WHERE guest.customer_phone IS NOT NULL
                          AND guest.customer_phone != ''
                          AND guest.customer_phone != 'N/A'
                          AND customer.phone_number = guest.customer_phone
                    )
                    AND NOT EXISTS (
                        SELECT 1
                        FROM vendor_profiles vendor
                        WHERE vendor.email = guest.customer_email
                          AND vendor.name = guest.customer_name
                    )
                ),
                combined AS (
                    SELECT * FROM registered_customers
                    UNION ALL
                    SELECT * FROM guest_customers
                )
                SELECT combined.*, COUNT(*) OVER() AS total_count
                FROM combined
                WHERE ? = ''
                   OR customer_name LIKE ?
                   OR customer_email LIKE ?
                   OR customer_phone LIKE ?
                ORDER BY ${sortColumn} ${sortOrder}, customer_email ASC, customer_phone ASC
                ${paginationSql}
            `;

            const timedQuery = async (label: string, operation: () => Promise<any>) => {
                const startedAt = Date.now();
                const result = await operation();
                const duration = Date.now() - startedAt;
                if (duration >= 250) {
                    console.info(`[Customers] ${label}: ${duration}ms`);
                }
                return result;
            };

            const [customerResult, phoneUsageResult, limitResult] = await Promise.all([
                timedQuery('main query', () => db.execute(customersSql, customerParams)),
                timedQuery('phone usage query', () => db.execute(`
                    SELECT customer_phone,
                           SUM(CASE WHEN status != 'rejected' THEN 1 ELSE 0 END) AS used_count,
                           COUNT(*) AS total_warranties,
                           SUM(CASE WHEN status = 'validated' THEN 1 ELSE 0 END) AS validated_warranties,
                           SUM(CASE WHEN status IN ('pending', 'pending_vendor') THEN 1 ELSE 0 END) AS pending_warranties,
                           SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected_warranties,
                           MIN(created_at) AS first_warranty_date,
                           MAX(created_at) AS last_warranty_date
                    FROM warranty_registrations
                    WHERE customer_phone IS NOT NULL
                      AND customer_phone != ''
                      AND customer_phone != 'N/A'
                    GROUP BY customer_phone
                `)),
                timedQuery('mobile limits query', () => db.execute(
                    // The reason an admin raised a number's limit, so the
                    // next admin can see why rather than guessing.
                    'SELECT mobile_number, allowed_registrations, reason, updated_by, updated_at FROM customer_mobile_limits'
                ))
            ]);

            const customerRows: any[] = customerResult[0];
            const phoneUsageRows: any[] = phoneUsageResult[0];
            const limitRows: any[] = limitResult[0];
            const total = Number(customerRows[0]?.total_count || 0);

            const mobileUsageMap = new Map<string, number>();
            // Warranty totals per phone, so the counts match the mobile limit
            // beside them. Counting through the profile link instead showed a
            // customer "0 warranties" next to "1 of 2 used" whenever a store had
            // filed their warranty under its own account.
            const phoneStatsMap = new Map<string, any>();
            phoneUsageRows.forEach((row: any) => {
                const mobileNumber = normalizeCustomerMobile(row.customer_phone);
                if (!mobileNumber) return;
                mobileUsageMap.set(mobileNumber, (mobileUsageMap.get(mobileNumber) || 0) + Number(row.used_count || 0));

                const prev = phoneStatsMap.get(mobileNumber);
                const merged = {
                    total_warranties: Number(row.total_warranties || 0) + Number(prev?.total_warranties || 0),
                    validated_warranties: Number(row.validated_warranties || 0) + Number(prev?.validated_warranties || 0),
                    pending_warranties: Number(row.pending_warranties || 0) + Number(prev?.pending_warranties || 0),
                    rejected_warranties: Number(row.rejected_warranties || 0) + Number(prev?.rejected_warranties || 0),
                    first_warranty_date: prev?.first_warranty_date && prev.first_warranty_date < row.first_warranty_date
                        ? prev.first_warranty_date : row.first_warranty_date,
                    last_warranty_date: prev?.last_warranty_date && prev.last_warranty_date > row.last_warranty_date
                        ? prev.last_warranty_date : row.last_warranty_date,
                };
                phoneStatsMap.set(mobileNumber, merged);
            });

            // Holds the whole override, not just the count: an admin looking at
            // a raised limit wants to know why it was raised and by whom.
            const mobileLimitMap = new Map<string, {
                allowed: number; reason: string | null; by: string | null; at: Date | null;
            }>();
            limitRows.forEach((row: any) => {
                const mobileNumber = normalizeCustomerMobile(row.mobile_number);
                if (!mobileNumber) return;
                mobileLimitMap.set(mobileNumber, {
                    allowed: Math.max(1, Number(row.allowed_registrations || 1)),
                    reason: row.reason || null,
                    by: row.updated_by || null,
                    at: row.updated_at || null,
                });
            });

            const customersWithLimits = customerRows.map((row: any) => {
                const { total_count: _totalCount, ...customer } = row;
                const mobileNumber = normalizeCustomerMobile(customer.customer_phone);
                const usedCount = mobileNumber ? (mobileUsageMap.get(mobileNumber) || 0) : 0;
                const override = mobileNumber ? mobileLimitMap.get(mobileNumber) : undefined;
                const hasOverride = Boolean(override);
                const allowedCount = override?.allowed ?? 1;

                // The phone is the customer, so its warranties are theirs even
                // when the registration was filed under another account.
                const phoneStats = mobileNumber ? phoneStatsMap.get(mobileNumber) : null;

                return {
                    ...customer,
                    ...(phoneStats ? {
                        total_warranties: phoneStats.total_warranties,
                        validated_warranties: phoneStats.validated_warranties,
                        pending_warranties: phoneStats.pending_warranties,
                        rejected_warranties: phoneStats.rejected_warranties,
                        first_warranty_date: phoneStats.first_warranty_date,
                        last_warranty_date: phoneStats.last_warranty_date,
                    } : {}),
                    mobile_allowed_registrations: allowedCount,
                    mobile_used_registrations: usedCount,
                    mobile_remaining_registrations: Math.max(allowedCount - usedCount, 0),
                    mobile_limit_override: hasOverride,
                    mobile_limit_reason: override?.reason ?? null,
                    mobile_limit_updated_by: override?.by ?? null,
                    mobile_limit_updated_at: override?.at ?? null
                };
            });

            res.json({
                success: true,
                customers: customersWithLimits,
                pagination: exportAll ? null : {
                    page,
                    pageSize,
                    total,
                    totalPages: Math.ceil(total / pageSize)
                }
            });
        } catch (error: any) {
            console.error('Get customers error:', error);
            res.status(500).json({ error: 'Failed to fetch customers' });
        }
    }

    static async getCustomerDetails(req: Request, res: Response) {
        try {
            // The route param is historically named "email" but customers without
            // an email (e.g. fallback-UID submissions) are looked up by phone instead.
            const identifier = req.params.email;
            const isPhoneLookup = /^\d{10,15}$/.test(identifier);

            // Get customer basic info from profiles OR guest info from registrations
            const [customerInfo]: any = await db.execute(`
                SELECT
                    customer_name,
                    customer_email,
                    customer_phone,
                    NULL as customer_address
                FROM (
                    -- Try profiles first
                    SELECT
                        p.name as customer_name,
                        p.email as customer_email,
                        p.phone_number as customer_phone
                    FROM profiles p
                    JOIN user_roles ur ON p.id = ur.user_id
                    WHERE (? = TRUE AND p.phone_number = ?) OR (? = FALSE AND p.email = ?) AND ur.role = 'customer'

                    UNION ALL

                    -- Fallback to guests from registrations
                    SELECT
                        wr.customer_name as customer_name,
                        wr.customer_email as customer_email,
                        wr.customer_phone as customer_phone
                    FROM warranty_registrations wr
                    LEFT JOIN profiles p INNER JOIN user_roles ur ON p.id = ur.user_id AND ur.role = 'customer' ON wr.customer_email = p.email
                    WHERE ((? = TRUE AND wr.customer_phone = ?) OR (? = FALSE AND wr.customer_email = ?)) AND ur.id IS NULL
                    LIMIT 1
                ) combined
                LIMIT 1
            `, [isPhoneLookup, identifier, isPhoneLookup, identifier, isPhoneLookup, identifier, isPhoneLookup, identifier]);

            if (customerInfo.length === 0) {
                return res.status(404).json({ error: 'Customer not found' });
            }

            // Get all warranties for this customer
            const [warrantyList]: any = await db.execute(`
                SELECT 
                    wr.*,
                    p.name as submitted_by_name,
                    p.email as submitted_by_email,
                    m.name as manpower_name_from_db,
                    vd_s.store_name as vendor_store_name,
                    vd_s.store_email as vendor_store_email,
                    vd_s.city as vendor_city,
                    vp.phone_number as vendor_phone_number,
                    vd_s.latitude as store_lat,
                    vd_s.longitude as store_lng
                FROM warranty_registrations wr
                LEFT JOIN profiles p ON wr.user_id = p.id
                LEFT JOIN manpower m ON wr.manpower_id = m.id
                LEFT JOIN vendor_details vd_s ON vd_s.id = wr.vendor_details_id
                LEFT JOIN profiles vp ON vd_s.user_id = vp.id
                WHERE (? = TRUE AND wr.customer_phone = ?) OR (? = FALSE AND wr.customer_email = ?)
                ORDER BY wr.created_at DESC
            `, [isPhoneLookup, identifier, isPhoneLookup, identifier]);

            res.json({
                success: true,
                customer: customerInfo[0],
                warranties: warrantyList
            });
        } catch (error: any) {
            console.error('Get customer details error:', error);
            res.status(500).json({ error: 'Failed to fetch customer details' });
        }
    }

    static async getCustomerMobileLimit(req: Request, res: Response) {
        try {
            const { phone } = req.params;
            const mobileNumber = normalizeCustomerMobile(phone);

            if (!/^[6-9]\d{9}$/.test(mobileNumber)) {
                return res.status(400).json({ error: 'Please enter a valid 10-digit Indian mobile number.' });
            }

            const usage = await getMobileRegistrationUsage(mobileNumber);
            res.json({
                success: true,
                limit: usage
            });
        } catch (error: any) {
            console.error('Get customer mobile limit error:', error);
            res.status(500).json({ error: 'Failed to fetch mobile limit' });
        }
    }

    static async updateCustomerMobileLimit(req: Request, res: Response) {
        try {
            const { phone } = req.params;
            const { allowedRegistrations, reason } = req.body;
            const mobileNumber = normalizeCustomerMobile(phone);
            const allowedCount = Number(allowedRegistrations);

            if (!/^[6-9]\d{9}$/.test(mobileNumber)) {
                return res.status(400).json({ error: 'Please enter a valid 10-digit Indian mobile number.' });
            }

            if (!Number.isInteger(allowedCount) || allowedCount < 1 || allowedCount > 50) {
                return res.status(400).json({ error: 'Allowed registrations must be a whole number between 1 and 50.' });
            }

            const admin = (req as any).user;
            await db.execute(
                `INSERT INTO customer_mobile_limits
                 (mobile_number, allowed_registrations, reason, created_by, updated_by)
                 VALUES (?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    allowed_registrations = VALUES(allowed_registrations),
                    reason = VALUES(reason),
                    updated_by = VALUES(updated_by),
                    updated_at = CURRENT_TIMESTAMP`,
                [
                    mobileNumber,
                    allowedCount,
                    reason || null,
                    admin?.email || admin?.id || null,
                    admin?.email || admin?.id || null
                ]
            );

            const usage = await getMobileRegistrationUsage(mobileNumber);

            await ActivityLogService.log({
                adminId: admin.id,
                adminName: admin.name,
                adminEmail: admin.email,
                actionType: 'CUSTOMER_MOBILE_LIMIT_UPDATED',
                targetType: 'CUSTOMER',
                targetId: mobileNumber,
                targetName: mobileNumber,
                details: { allowed_registrations: allowedCount, used_registrations: usage.usedCount, reason },
                ipAddress: req.ip || req.socket?.remoteAddress
            });

            res.json({
                success: true,
                message: 'Mobile submission limit updated successfully',
                limit: usage
            });
        } catch (error: any) {
            console.error('Update customer mobile limit error:', error);
            res.status(500).json({ error: 'Failed to update mobile limit' });
        }
    }

    static async deleteCustomer(req: Request, res: Response) {
        try {
            // The route param is historically named "email" but customers without
            // an email (e.g. fallback-UID submissions) are looked up by phone instead.
            const identifier = req.params.email;
            const isPhoneLookup = /^\d{10,15}$/.test(identifier);

            // Check if customer exists in profiles
            const [customer]: any = await db.execute(
                `SELECT p.id, p.email FROM profiles p
                 JOIN user_roles ur ON p.id = ur.user_id
                 WHERE ((? = TRUE AND p.phone_number = ?) OR (? = FALSE AND p.email = ?)) AND ur.role = 'customer'
                 LIMIT 1`,
                [isPhoneLookup, identifier, isPhoneLookup, identifier]
            );

            if (customer.length === 0) {
                return res.status(404).json({ error: 'Customer not found' });
            }

            // Get user ID to delete
            const user_id = customer[0].id;

            // Delete from profiles - cascading should handle warranty_registrations
            await db.execute('DELETE FROM profiles WHERE id = ?', [user_id]);

            // Log the activity
            const admin = (req as any).user;
            await ActivityLogService.log({
                adminId: admin.id,
                adminName: admin.name,
                adminEmail: admin.email,
                actionType: 'CUSTOMER_DELETED',
                targetType: 'CUSTOMER',
                targetId: identifier,
                targetName: identifier,
                ipAddress: req.ip || req.socket?.remoteAddress
            });

            res.json({
                success: true,
                message: 'Customer and all associated warranties deleted successfully'
            });
        } catch (error: any) {
            console.error('Delete customer error:', error);
            res.status(500).json({ error: 'Failed to delete customer' });
        }
    }

    // Admin Management Methods
    static async getAllAdmins(_req: Request, res: Response) {
        try {
            const query = `
                SELECT 
                    p.id,
                    p.name,
                    p.email,
                    p.phone_number,
                    p.created_at,
                    COALESCE(ap.is_super_admin, 0) as is_super_admin,
                    ap.permissions
                FROM profiles p
                JOIN user_roles ur ON p.id = ur.user_id
                LEFT JOIN admin_permissions ap ON p.id = ap.admin_id
                WHERE ur.role = 'admin'
                ORDER BY ap.is_super_admin DESC, p.created_at ASC
            `;

            const [admins]: any = await db.execute(query);

            // Parse permissions JSON for each admin
            const adminList = admins.map((admin: any) => ({
                ...admin,
                is_super_admin: admin.is_super_admin === 1 || admin.is_super_admin === true,
                permissions: admin.permissions
                    ? (typeof admin.permissions === 'string' ? JSON.parse(admin.permissions) : admin.permissions)
                    : {}
            }));

            res.json({
                success: true,
                admins: adminList
            });
        } catch (error: any) {
            console.error('Get all admins error:', error);
            res.status(500).json({ error: 'Failed to fetch admins' });
        }
    }

    static async createAdmin(req: Request, res: Response) {
        try {
            const { name, email, phone, permissions } = req.body;
            const invitedBy = (req as any).user;

            // Validate required fields
            if (!name || !email || !phone) {
                return res.status(400).json({
                    error: 'Name, email, and phone are required'
                });
            }

            // Check if email already exists
            const [existingEmail]: any = await db.execute(
                'SELECT id FROM profiles WHERE email = ?',
                [email]
            );

            if (existingEmail.length > 0) {
                return res.status(400).json({
                    error: 'An account with this email already exists'
                });
            }

            // Check if phone number already exists
            const [existingPhone]: any = await db.execute(
                'SELECT id FROM profiles WHERE phone_number = ?',
                [phone]
            );

            if (existingPhone.length > 0) {
                return res.status(400).json({
                    error: 'An account with this phone number already exists'
                });
            }

            // Generate UUID for new admin
            const { v4: uuidv4 } = await import('uuid');
            const userId = uuidv4();

            // Normalize permissions â€” default all to false if not provided
            const defaultPermissions = {
                // Must list every module the routes enforce. A key that is absent
                // is not "denied by default" in a recoverable way — the check
                // reads undefined and returns 403, and the permissions screen
                // has no switch to turn on something it cannot see.
                overview: { read: false, write: false },
                analytics: { read: false, write: false },
                warranties: { read: false, write: false },
                warranty_products: { read: false, write: false },
                uid_management: { read: false, write: false },
                warranty_form: { read: false, write: false },
                vendors: { read: false, write: false },
                audits: { read: false, write: false },
                leads: { read: false, write: false },
                asms: { read: false, write: false },
                distributors: { read: false, write: false },
                order_management: { read: false, write: false },
                customers: { read: false, write: false },
                products: { read: false, write: false },
                announcements: { read: false, write: false },
                grievances: { read: false, write: false },
                posm: { read: false, write: false },
                ecatalogue: { read: false, write: false },
                terms: { read: false, write: false },
                content_manager: { read: false, write: false },
                old_warranties: { read: false, write: false },
                activity_logs: { read: false, write: false },
            };
            const resolvedPermissions = permissions || defaultPermissions;

            // Create profile (no password needed for OTP-based auth)
            await db.execute(
                'INSERT INTO profiles (id, name, email, phone_number) VALUES (?, ?, ?, ?)',
                [userId, name, email, phone]
            );

            // Add admin role
            await db.execute(
                'INSERT INTO user_roles (id, user_id, role) VALUES (?, ?, ?)',
                [uuidv4(), userId, 'admin']
            );

            // Insert permissions row (is_super_admin = false for all invited admins)
            await db.execute(
                'INSERT INTO admin_permissions (id, admin_id, is_super_admin, permissions) VALUES (?, ?, 0, ?)',
                [uuidv4(), userId, JSON.stringify(resolvedPermissions)]
            );

            // Send invitation email
            try {
                await EmailService.sendAdminInvitation(
                    email,
                    name,
                    invitedBy.name || 'An Administrator'
                );
                console.log(`âœ“ Admin invitation email sent to: ${email}`);
            } catch (emailError: any) {
                console.error('Failed to send admin invitation email:', emailError);
                // Don't fail the request if email fails
            }

            // Log the activity
            await ActivityLogService.log({
                adminId: invitedBy.id,
                adminName: invitedBy.name,
                adminEmail: invitedBy.email,
                actionType: 'ADMIN_CREATED',
                targetType: 'ADMIN',
                targetId: userId,
                targetName: name,
                details: { email, phone },
                ipAddress: req.ip || req.socket?.remoteAddress
            });

            res.json({
                success: true,
                message: 'Admin created successfully and invitation email sent',
                admin: {
                    id: userId,
                    name,
                    email,
                    phone_number: phone,
                    is_super_admin: false,
                    permissions: resolvedPermissions
                }
            });
        } catch (error: any) {
            console.error('Create admin error:', error);
            res.status(500).json({ error: 'Failed to create admin' });
        }
    }

    static async updateAdminPermissions(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { permissions } = req.body;
            const actor = (req as any).user;

            if (!permissions || typeof permissions !== 'object') {
                return res.status(400).json({ error: 'permissions object is required' });
            }

            // Prevent modifying a Super Admin's permissions
            const [target]: any = await db.execute(
                'SELECT is_super_admin FROM admin_permissions WHERE admin_id = ?',
                [id]
            );

            if (target.length === 0) {
                return res.status(404).json({ error: 'Admin permissions record not found' });
            }

            const isSuperAdmin = target[0].is_super_admin === 1 || target[0].is_super_admin === true;
            if (isSuperAdmin) {
                return res.status(403).json({ error: 'Super Admin permissions cannot be modified' });
            }

            // Ensure write implies read for all modules
            const normalized: Record<string, { read: boolean; write: boolean }> = {};
            for (const [module, perm] of Object.entries(permissions as any)) {
                const p = perm as { read: boolean; write: boolean };
                normalized[module] = {
                    read: p.write ? true : p.read,   // write implies read
                    write: p.write
                };
            }

            await db.execute(
                'UPDATE admin_permissions SET permissions = ? WHERE admin_id = ?',
                [JSON.stringify(normalized), id]
            );
            invalidateSessionState(id);

            // Get admin name for log
            const [adminProfile]: any = await db.execute(
                'SELECT name FROM profiles WHERE id = ?',
                [id]
            );

            await ActivityLogService.log({
                adminId: actor.id,
                adminName: actor.name,
                adminEmail: actor.email,
                actionType: 'ADMIN_PERMISSIONS_UPDATED',
                targetType: 'ADMIN',
                targetId: id,
                targetName: adminProfile[0]?.name || 'Unknown',
                details: { permissions: normalized },
                ipAddress: req.ip || req.socket?.remoteAddress
            });

            res.json({
                success: true,
                message: 'Permissions updated successfully',
                permissions: normalized
            });
        } catch (error: any) {
            console.error('Update admin permissions error:', error);
            res.status(500).json({ error: 'Failed to update permissions' });
        }
    }

    /**
     * Change an admin's email and/or phone. Super admin only.
     *
     * An admin's email is their login, so this is the one place it can
     * change: admins can't edit their own (AuthController.updateProfile), and
     * the franchise profile endpoint refuses admin accounts.
     */
    static async updateAdminContact(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const actor = (req as any).user;

            // The route is already gated to the super-admin-only `admins`
            // module; checked again here because this is an account-takeover
            // lever if that gate ever loosens.
            if (!actor?.isSuperAdmin) {
                return res.status(403).json({ error: 'Only a super admin can change an admin\'s email or phone number.' });
            }

            const email = String(req.body?.email ?? '').trim();
            const phoneDigits = String(req.body?.phone ?? '').replace(/\D/g, '');
            const phone = phoneDigits.length === 12 && phoneDigits.startsWith('91') ? phoneDigits.slice(2) : phoneDigits;

            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 100) {
                return res.status(400).json({ error: 'Enter a valid email address' });
            }
            if (!/^\d{10}$/.test(phone)) {
                return res.status(400).json({ error: 'Enter a 10-digit mobile number' });
            }

            const [target]: any = await db.execute(
                `SELECT p.name, p.email, p.phone_number
                 FROM profiles p
                 JOIN user_roles ur ON ur.user_id = p.id AND ur.role = 'admin'
                 WHERE p.id = ?`,
                [id]
            );
            if (target.length === 0) {
                return res.status(404).json({ error: 'Admin not found' });
            }

            const [emailTaken]: any = await db.execute(
                'SELECT id FROM profiles WHERE email = ? AND id != ?',
                [email, id]
            );
            if (emailTaken.length > 0) {
                return res.status(400).json({ error: 'Email already in use by another account' });
            }
            const [phoneTaken]: any = await db.execute(
                'SELECT id FROM profiles WHERE phone_number = ? AND id != ?',
                [phone, id]
            );
            if (phoneTaken.length > 0) {
                return res.status(400).json({ error: 'Phone number already in use by another account' });
            }

            await db.execute(
                'UPDATE profiles SET email = ?, phone_number = ? WHERE id = ?',
                [email, phone, id]
            );

            await ActivityLogService.log({
                adminId: actor.id,
                adminName: actor.name,
                adminEmail: actor.email,
                actionType: 'ADMIN_CONTACT_UPDATED',
                targetType: 'ADMIN',
                targetId: id,
                targetName: target[0].name || 'Unknown',
                details: {
                    email: { from: target[0].email, to: email },
                    phone: { from: target[0].phone_number, to: phone }
                },
                ipAddress: req.ip || req.socket?.remoteAddress
            });

            res.json({ success: true, message: 'Contact details updated', admin: { id, email, phone_number: phone } });
        } catch (error: any) {
            console.error('Update admin contact error:', error);
            res.status(500).json({ error: 'Failed to update contact details' });
        }
    }

    static async deleteAdmin(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const actor = (req as any).user;

            // Cannot delete yourself
            if (id === actor.id) {
                return res.status(400).json({ error: 'You cannot delete your own admin account' });
            }

            // Cannot delete a Super Admin
            const [target]: any = await db.execute(
                'SELECT is_super_admin FROM admin_permissions WHERE admin_id = ?',
                [id]
            );

            if (target.length > 0) {
                const isSuperAdmin = target[0].is_super_admin === 1 || target[0].is_super_admin === true;
                if (isSuperAdmin) {
                    return res.status(403).json({ error: 'Super Admin account cannot be deleted' });
                }
            }

            // Get admin name for log
            const [adminProfile]: any = await db.execute(
                'SELECT name, email FROM profiles WHERE id = ?',
                [id]
            );

            if (adminProfile.length === 0) {
                return res.status(404).json({ error: 'Admin not found' });
            }

            // Delete â€” CASCADE handles admin_permissions row
            await db.execute('DELETE FROM profiles WHERE id = ?', [id]);
            invalidateSessionState(id);

            await ActivityLogService.log({
                adminId: actor.id,
                adminName: actor.name,
                adminEmail: actor.email,
                actionType: 'ADMIN_DELETED',
                targetType: 'ADMIN',
                targetId: id,
                targetName: adminProfile[0]?.name || 'Unknown',
                details: { email: adminProfile[0]?.email },
                ipAddress: req.ip || req.socket?.remoteAddress
            });

            res.json({
                success: true,
                message: 'Admin account removed successfully'
            });
        } catch (error: any) {
            console.error('Delete admin error:', error);
            res.status(500).json({ error: 'Failed to delete admin' });
        }
    }

    static async getActivityLogs(req: Request, res: Response) {
        try {
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 30;
            const offset = (page - 1) * limit;
            const adminId = req.query.adminId as string;
            const actionType = req.query.actionType as string;

            const result = await ActivityLogService.getLogs({
                limit,
                offset,
                adminId,
                actionType,
                search: req.query.search as string,
                dateFrom: req.query.dateFrom as string,
                dateTo: req.query.dateTo as string,
                sortField: req.query.sortField as any,
                sortOrder: req.query.sortOrder as any,
            });

            const totalPages = Math.ceil(result.total / limit);

            res.json({
                success: true,
                logs: result.logs,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalCount: result.total,
                    limit,
                    hasNextPage: page < totalPages,
                    hasPrevPage: page > 1
                }
            });
        } catch (error: any) {
            console.error('Get activity logs error:', error);
            res.status(500).json({ error: 'Failed to fetch activity logs' });
        }
    }

    /** One entry, with every other action recorded against the same target. */
    static async getActivityLogDetail(req: Request, res: Response) {
        try {
            const result = await ActivityLogService.getLogDetail(req.params.id);
            if (!result) return res.status(404).json({ error: 'Activity log entry not found' });
            res.json({ success: true, ...result });
        } catch (error: any) {
            console.error('Get activity log detail error:', error);
            res.status(500).json({ error: 'Failed to fetch the activity detail' });
        }
    }

    // â”€â”€ Resubmissions Staging Handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    static async getResubmissions(req: Request, res: Response) {
        try {
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 50;
            const offset = (page - 1) * limit;

            const [countResult]: any = await db.execute('SELECT COUNT(*) as total FROM warranty_resubmissions WHERE status = "pending_review"');
            const totalCount = countResult[0].total;
            const totalPages = Math.ceil(totalCount / limit);

            const [resubmissions]: any = await db.query(`
                SELECT 
                    wr.*,
                    p.name as submitted_by_name,
                    p.email as submitted_by_email,
                    m.name as manpower_name_from_db,
                    vd.store_name as vendor_store_name,
                    vd.store_email as vendor_store_email,
                    vd.city as vendor_city
                FROM warranty_resubmissions wr
                LEFT JOIN profiles p ON wr.user_id = p.id
                LEFT JOIN manpower m ON wr.manpower_id = m.id
                LEFT JOIN vendor_details vd ON vd.id = wr.vendor_details_id
                WHERE wr.status = 'pending_review'
                ORDER BY wr.created_at DESC
                LIMIT ? OFFSET ?
            `, [limit, offset]);

            const formatted = resubmissions.map((r: any) => ({
                ...r,
                product_details: JSON.parse(r.product_details),
                fraud_flags: r.fraud_flags ? JSON.parse(r.fraud_flags) : {},
                uid: r.original_uid // For frontend compatibility
            }));

            res.json({
                success: true,
                resubmissions: formatted,
                pagination: { currentPage: page, totalPages, totalCount, limit }
            });
        } catch (error) {
            console.error('Get resubmissions error:', error);
            res.status(500).json({ error: 'Failed to fetch resubmissions' });
        }
    }

    static async approveResubmission(req: Request, res: Response) {
        let connection;
        try {
            const { id } = req.params;
            const sql = 'SELECT * FROM warranty_resubmissions WHERE id = ? AND status = "pending_review"';
            const [rows]: any = await db.execute(sql, [id]);

            if (rows.length === 0) {
                return res.status(404).json({ error: 'Resubmission not found or already processed' });
            }

            const staging = rows[0];

            // Using a transaction to ensure atomic update of both tables
            connection = await db.getConnection();
            await connection.beginTransaction();

            // 1. Overwrite the main table data with the staging data and set status to approved
            await connection.execute(`
                UPDATE warranty_registrations SET
                    customer_name = ?, customer_email = ?, customer_phone = ?,
                    customer_address = ?, car_make = ?, car_model = ?, car_year = ?,
                    registration_number = ?, purchase_date = ?, installer_name = ?, 
                    installer_contact = ?, product_details = ?, manpower_id = ?,
                    status = 'validated', seat_cover_photo_url = ?, car_outer_photo_url = ?,
                    vendor_details_id = COALESCE(?, vendor_details_id),
                    validated_at = NOW()
                WHERE uid = ?
            `, [
                staging.customer_name, staging.customer_email, staging.customer_phone,
                staging.customer_address, staging.car_make, staging.car_model, staging.car_year,
                staging.registration_number, staging.purchase_date, staging.installer_name,
                staging.installer_contact, staging.product_details, staging.manpower_id,
                staging.seat_cover_photo_url, staging.car_outer_photo_url,
                staging.vendor_details_id || null,
                staging.original_uid
            ]);

            // 2. Mark staging as approved
            await connection.execute('UPDATE warranty_resubmissions SET status = "approved" WHERE id = ?', [id]);

            /*
             * 2b. Re-point the roll ledger at what was just approved.
             *
             * The update above replaces product_details wholesale, so a PPF
             * correction that changed a serial or a sq.ft figure would leave the
             * warranty saying one thing and the ledger another — and the ledger
             * is what decides whether a roll has room left. Redrawing it from the
             * approved details is the only way the two stay honest.
             *
             * Seat covers declare no rolls, so nothing here runs for them.
             */
            if (staging.product_type === 'ev-products') {
                let approvedDetails: any = {};
                try {
                    approvedDetails = typeof staging.product_details === 'string'
                        ? JSON.parse(staging.product_details || '{}')
                        : (staging.product_details || {});
                } catch {
                    approvedDetails = {};
                }

                const rolls = parseRolls(approvedDetails);
                if (rolls.length > 0) {
                    await connection.execute(
                        'DELETE FROM ppf_roll_consumption WHERE warranty_uid = ?',
                        [staging.original_uid]
                    );

                    const check = await reserveRolls(connection, rolls, staging.original_uid);
                    if (!check.ok) {
                        // The correction asks for more film than the roll still
                        // holds. Rolling back leaves the warranty rejected and the
                        // ledger as it was, which is the honest outcome — approving
                        // it would overdraw a roll on the admin's behalf.
                        await connection.rollback();
                        return res.status(400).json({
                            error: `Cannot approve: ${check.error}`,
                            failedSerial: check.failedSerial,
                        });
                    }
                }
            }

            // 3. Mark UID as used in pre_generated_uids if it's a seat cover
            if (staging.product_type === 'seat-cover') {
                const usedTimestamp = new Date().toISOString().slice(0, 19).replace('T', ' '); // Simple helper for YYYY-MM-DD HH:MM:SS
                await connection.execute(
                    'UPDATE pre_generated_uids SET is_used = TRUE, used_at = ? WHERE uid = ?',
                    [usedTimestamp, staging.original_uid]
                );
            }

            await connection.commit();

            // Send Email logic can be triggered here if needed, but keeping it simple for DB sync first

            const admin = (req as any).user;
            await ActivityLogService.log({
                adminId: admin.id,
                adminName: admin.name,
                adminEmail: admin.email,
                actionType: 'approve_resubmission',
                targetType: 'WARRANTY',
                targetId: staging.original_uid,
                targetName: staging.original_uid,
                details: { status: 'validated' }
            });

            res.json({ success: true, message: 'Resubmission approved successfully' });
        } catch (error) {
            if (connection) await connection.rollback();
            console.error('Approve resubmission error:', error);
            res.status(500).json({ error: 'Failed to approve resubmission' });
        } finally {
            if (connection) connection.release();
        }
    }

    static async rejectResubmission(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { notes } = req.body;

            const [rows]: any = await db.execute('SELECT original_uid FROM warranty_resubmissions WHERE id = ?', [id]);
            if (rows.length === 0) return res.status(404).json({ error: 'Resubmission not found' });

            await db.execute(
                'UPDATE warranty_resubmissions SET status = "rejected", admin_notes = ? WHERE id = ?',
                [notes || 'Rejected by admin', id]
            );

            const admin = (req as any).user;
            await ActivityLogService.log({
                adminId: admin.id,
                adminName: admin.name,
                adminEmail: admin.email,
                actionType: 'reject_resubmission',
                targetType: 'WARRANTY',
                targetId: rows[0].original_uid,
                targetName: rows[0].original_uid,
                details: { notes }
            });

            res.json({ success: true, message: 'Resubmission rejected' });
        } catch (error) {
            console.error('Reject resubmission error:', error);
            res.status(500).json({ error: 'Failed to reject resubmission' });
        }
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  GET ALL DISTRIBUTORS
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    static async getAllDistributors(_req: Request, res: Response) {
        try {
            // Franchise counts and order aggregates computed once via GROUP BY,
            // then joined in, instead of 5 correlated subqueries evaluated per distributor row.
            const query = `
                SELECT d.*,
                       COALESCE(fc.franchise_count, 0) as franchise_count,
                       COALESCE(oa.order_pending_count, 0) as order_pending_count,
                       COALESCE(oa.order_confirmed_count, 0) as order_confirmed_count,
                       COALESCE(oa.order_declined_count, 0) as order_declined_count,
                       COALESCE(oa.order_total_count, 0) as order_total_count
                FROM distributors d
                JOIN vendor_details vd ON vd.user_id = d.profile_id
                LEFT JOIN (
                    SELECT distributor_id, COUNT(*) as franchise_count
                    FROM vendor_details
                    WHERE is_franchise = TRUE
                    GROUP BY distributor_id
                ) fc ON fc.distributor_id = d.id
                LEFT JOIN (
                    SELECT distributor_id,
                           SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as order_pending_count,
                           SUM(CASE WHEN status IN ('processing', 'shipped', 'delivered') THEN 1 ELSE 0 END) as order_confirmed_count,
                           SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as order_declined_count,
                           COUNT(*) as order_total_count
                    FROM store_orders
                    GROUP BY distributor_id
                ) oa ON oa.distributor_id = d.id
                WHERE d.profile_id IS NOT NULL
                  AND vd.is_distributor = TRUE
                ORDER BY d.name ASC
            `;
            const [distributors]: any = await db.execute(query);
            res.json({ success: true, distributors });
        } catch (error: any) {
            console.error('Get all distributors error:', error);
            res.status(500).json({ error: 'Failed to fetch distributors' });
        }
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  CREATE DISTRIBUTOR
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    static async createDistributor(req: Request, res: Response) {
        const connection = await db.getConnection();
        try {
            const { name, email, phone_number, address, city, state, pincode, contact_name, gst_number, area_head_name, allowed_brands } = req.body;
            const brandValue = ['AF', 'AC', 'AFAC'].includes(allowed_brands) ? allowed_brands : 'AF';

            if (!name || !email || !phone_number) {
                return res.status(400).json({ error: 'Name, email, and phone number are required.' });
            }

            // Clean phone number
            let cleanedPhone = phone_number.replace(/[\s\-+]/g, '');
            if (cleanedPhone.length === 12 && cleanedPhone.startsWith('91')) {
                cleanedPhone = cleanedPhone.substring(2);
            } else if (cleanedPhone.length === 11 && cleanedPhone.startsWith('0')) {
                cleanedPhone = cleanedPhone.substring(1);
            }

            // Validate phone and email
            const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;
            if (!INDIAN_MOBILE_REGEX.test(cleanedPhone)) {
                return res.status(400).json({ error: 'Please enter a valid 10-digit Indian mobile number.' });
            }

            const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
            if (!EMAIL_REGEX.test(email)) {
                return res.status(400).json({ error: 'Please enter a valid email address.' });
            }

            await connection.beginTransaction();

            // Check if profile already exists for this email. A store email must
            // be unique too: it is how a warranty finds its store when no
            // installer was picked (services/warrantyStore.ts).
            const [existingEmail]: any = await connection.execute(
                'SELECT id FROM profiles WHERE email = ? UNION SELECT id FROM vendor_details WHERE store_email = ?',
                [email, email]
            );
            if (existingEmail.length > 0) {
                await connection.rollback();
                return res.status(400).json({ error: 'Email is already registered.' });
            }

            // Check if profile already exists for this phone number
            const [existingPhone]: any = await connection.execute(
                'SELECT id FROM profiles WHERE phone_number = ?',
                [cleanedPhone]
            );
            if (existingPhone.length > 0) {
                await connection.rollback();
                return res.status(400).json({ error: 'Phone number is already registered.' });
            }

            const profileId = uuidv4();
            const contactPersonName = contact_name || name;

            // 1. Create Profile
            await connection.execute(
                'INSERT INTO profiles (id, name, email, phone_number) VALUES (?, ?, ?, ?)',
                [profileId, contactPersonName, email, cleanedPhone]
            );

            // 2. Create User Role (vendor)
            await connection.execute(
                'INSERT INTO user_roles (id, user_id, role) VALUES (?, ?, ?)',
                [uuidv4(), profileId, 'vendor']
            );

            // 3. Create Vendor Verification (is_verified = true, is_active = true)
            await connection.execute(
                'INSERT INTO vendor_verification (id, user_id, is_verified, is_active, verified_at) VALUES (?, ?, ?, ?, NOW())',
                [uuidv4(), profileId, true, true]
            );

            // 4. Create Vendor Details (is_distributor = true, is_franchise = false)
            const vendorDetailsId = uuidv4();
            await connection.execute(
                `INSERT INTO vendor_details 
                 (id, user_id, store_name, store_email, address, city, state, pincode, is_distributor, is_franchise) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    vendorDetailsId,
                    profileId,
                    name,
                    email,
                    address || '',
                    city || '',
                    state || '',
                    pincode || '',
                    true,
                    false
                ]
            );

            // 5. Create Distributor record
            const distId = uuidv4();
            await connection.execute(
                `INSERT INTO distributors (id, name, email, phone_number, address, city, state, pincode, gst_number, area_head_name, profile_id, allowed_brands)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    distId,
                    name,
                    email,
                    cleanedPhone,
                    address || '',
                    city || '',
                    state || '',
                    pincode || '',
                    gst_number || null,
                    area_head_name || null,
                    profileId,
                    brandValue
                ]
            );

            await connection.commit();

            // Log activity
            const admin = (req as any).user;
            await ActivityLogService.log({
                adminId: admin.id,
                adminName: admin.name,
                adminEmail: admin.email,
                actionType: 'DISTRIBUTOR_CREATED',
                targetType: 'DISTRIBUTOR',
                targetId: distId,
                targetName: name,
                ipAddress: req.ip || req.socket?.remoteAddress
            });

            res.status(201).json({
                success: true,
                message: 'Distributor created successfully',
                distributorId: distId
            });
        } catch (error: any) {
            await connection.rollback();
            console.error('Create distributor error:', error);
            res.status(500).json({ error: 'Failed to create distributor' });
        } finally {
            connection.release();
        }
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  GET DISTRIBUTOR FRANCHISES
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    static async getDistributorFranchises(req: Request, res: Response) {
        try {
            const { id } = req.params; // Distributor ID

            // Order aggregates computed once per vendor via GROUP BY, then joined in,
            // instead of 4 correlated subqueries evaluated per franchise row.
            const query = `
                SELECT p.id as user_id,
                       vd.id as vendor_details_id,
                       vd.store_name,
                       vd.store_email,
                       vd.city,
                       vd.state,
                       p.phone_number,
                       COALESCE(vv.is_verified, false) as is_verified,
                       COALESCE(vv.is_active, true) as is_active,
                       vv.verified_at,
                       vv.rejection_reason,
                       COALESCE(oa.order_pending_count, 0) as order_pending_count,
                       COALESCE(oa.order_confirmed_count, 0) as order_confirmed_count,
                       COALESCE(oa.order_declined_count, 0) as order_declined_count,
                       COALESCE(oa.order_total_count, 0) as order_total_count,
                       COALESCE(vd.allowed_brands, 'AF') as allowed_brands
                FROM vendor_details vd
                JOIN profiles p ON vd.user_id = p.id
                LEFT JOIN vendor_verification vv ON p.id = vv.user_id
                LEFT JOIN (
                    SELECT vendor_id,
                           SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as order_pending_count,
                           SUM(CASE WHEN status IN ('processing', 'shipped', 'delivered') THEN 1 ELSE 0 END) as order_confirmed_count,
                           SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as order_declined_count,
                           COUNT(*) as order_total_count
                    FROM store_orders
                    WHERE distributor_id = ?
                    GROUP BY vendor_id
                ) oa ON oa.vendor_id = p.id
                WHERE vd.distributor_id = ? AND vd.is_franchise = TRUE
                ORDER BY vd.store_name ASC
            `;
            const [franchises]: any = await db.execute(query, [id, id]);
            res.json({ success: true, franchises });
        } catch (error: any) {
            console.error('Get distributor franchises error:', error);
            res.status(500).json({ error: 'Failed to fetch franchises' });
        }
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  MAP FRANCHISE TO DISTRIBUTOR
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    static async getFranchiseOrders(req: Request, res: Response) {
        try {
            const { vendorId } = req.params;

            const [orders]: any = await db.execute(
                `SELECT o.*,
                        d.name as distributor_name,
                        vd.store_name as franchise_name
                 FROM store_orders o
                 LEFT JOIN distributors d ON o.distributor_id = d.id
                 LEFT JOIN vendor_details vd ON o.vendor_id = vd.user_id
                 WHERE o.vendor_id = ?
                 ORDER BY o.created_at DESC`,
                [vendorId]
            );

            for (const order of orders) {
                const [items]: any = await db.execute(
                    `SELECT id, product_name, variation_name, quantity, price, needs_customization, customization_remarks
                     FROM store_order_items
                     WHERE order_id = ?
                     ORDER BY created_at ASC`,
                    [order.id]
                );
                order.items = items;
            }

            res.json({ success: true, orders });
        } catch (error: any) {
            console.error('Get franchise orders error:', error);
            res.status(500).json({ error: 'Failed to fetch franchise orders' });
        }
    }

    static async mapFranchiseToDistributor(req: Request, res: Response) {
        try {
            const { id } = req.params; // Distributor ID
            const { vendorId } = req.body; // Vendor's User Profile ID

            if (!vendorId) {
                return res.status(400).json({ error: 'Franchise vendorId is required' });
            }

            // Verify distributor exists
            const [dists]: any = await db.execute('SELECT name FROM distributors WHERE id = ?', [id]);
            if (dists.length === 0) {
                return res.status(404).json({ error: 'Distributor not found' });
            }

            // Verify vendor is a franchise
            const [vendors]: any = await db.execute('SELECT store_name, is_franchise FROM vendor_details WHERE user_id = ?', [vendorId]);
            if (vendors.length === 0) {
                return res.status(404).json({ error: 'Franchise store not found' });
            }
            if (!vendors[0].is_franchise) {
                return res.status(400).json({ error: 'Only franchise stores can be mapped to a distributor.' });
            }

            // Guard: brand compatibility â€” franchise and distributor must share at least one brand.
            // AF franchise â†’ needs AF or AFAC distributor
            // AC franchise â†’ needs AC or AFAC distributor
            // AFAC franchise â†’ any distributor is fine
            const [brandRows]: any = await db.execute(
                `SELECT d.allowed_brands as dist_brands, vd.allowed_brands as franchise_brands
                 FROM distributors d, vendor_details vd
                 WHERE d.id = ? AND vd.user_id = ?`,
                [id, vendorId]
            );
            if (brandRows.length > 0) {
                const distBrands: string = brandRows[0].dist_brands || 'AF';
                const franchiseBrands: string = brandRows[0].franchise_brands || 'AF';
                const compatible =
                    distBrands === 'AFAC' ||
                    franchiseBrands === 'AFAC' ||
                    distBrands === franchiseBrands;
                if (!compatible) {
                    return res.status(400).json({
                        error: `Brand mismatch: this franchise is assigned to "${franchiseBrands}" products but the distributor only carries "${distBrands}" products. Update one of them to be compatible before assigning.`
                    });
                }
            }

            // NOTE: no category-overlap restriction. A franchise may be connected to
            // as many distributors as needed (any brand) — the admin manages these
            // assignments manually. (Order routing resolves the distributor per
            // product's category/brand at order time.)

            // Record the mapping in the many-to-many table — a franchise can be
            // connected to several distributors. (This previously overwrote the single
            // vendor_details.distributor_id column, so mapping a 2nd distributor
            // silently replaced the 1st and the franchise's distributor selector,
            // which reads franchise_distributors, only ever showed one.)
            await db.execute(
                `INSERT INTO franchise_distributors (id, franchise_user_id, distributor_id)
                 VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE id = id`,
                [uuidv4(), vendorId, id]
            );

            // Keep the legacy single-FK pointing at a valid distributor for any older
            // queries that still read it (it can only hold one; the M2M table is the
            // source of truth).
            await db.execute(
                'UPDATE vendor_details SET distributor_id = ? WHERE user_id = ?',
                [id, vendorId]
            );

            // Log activity
            const admin = (req as any).user;
            const [vendor]: any = await db.execute('SELECT store_name FROM vendor_details WHERE user_id = ?', [vendorId]);

            await ActivityLogService.log({
                adminId: admin.id,
                adminName: admin.name,
                adminEmail: admin.email,
                actionType: 'FRANCHISE_MAPPED_DISTRIBUTOR',
                targetType: 'VENDOR',
                targetId: vendorId,
                targetName: vendor[0]?.store_name,
                details: { distributor_id: id, distributor_name: dists[0].name },
                ipAddress: req.ip || req.socket?.remoteAddress
            });

            res.json({
                success: true,
                message: `Successfully assigned ${vendor[0]?.store_name || 'franchise'} to ${dists[0].name}`
            });
        } catch (error: any) {
            console.error('Map franchise to distributor error:', error);
            res.status(500).json({ error: 'Failed to map franchise' });
        }
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  UNMAP FRANCHISE FROM DISTRIBUTOR
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    static async unmapFranchiseFromDistributor(req: Request, res: Response) {
        try {
            const { id, vendorId } = req.params; // Distributor ID and Vendor ID

            // Verify distributor exists
            const [dists]: any = await db.execute('SELECT name FROM distributors WHERE id = ?', [id]);
            if (dists.length === 0) {
                return res.status(404).json({ error: 'Distributor not found' });
            }

            // Remove the many-to-many mapping (the source of truth for which
            // distributors a franchise can order from).
            await db.execute(
                'DELETE FROM franchise_distributors WHERE franchise_user_id = ? AND distributor_id = ?',
                [vendorId, id]
            );

            // Clear the legacy single-FK only if it pointed at this distributor.
            await db.execute(
                'UPDATE vendor_details SET distributor_id = NULL WHERE user_id = ? AND distributor_id = ?',
                [vendorId, id]
            );

            // Log activity
            const admin = (req as any).user;
            const [vendor]: any = await db.execute('SELECT store_name FROM vendor_details WHERE user_id = ?', [vendorId]);

            await ActivityLogService.log({
                adminId: admin.id,
                adminName: admin.name,
                adminEmail: admin.email,
                actionType: 'FRANCHISE_UNMAPPED_DISTRIBUTOR',
                targetType: 'VENDOR',
                targetId: vendorId,
                targetName: vendor[0]?.store_name,
                details: { distributor_id: id, distributor_name: dists[0].name },
                ipAddress: req.ip || req.socket?.remoteAddress
            });

            res.json({
                success: true,
                message: `Successfully unassigned ${vendor[0]?.store_name || 'franchise'} from ${dists[0].name}`
            });
        } catch (error: any) {
            console.error('Unmap franchise from distributor error:', error);
            res.status(500).json({ error: 'Failed to unmap franchise' });
        }
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  GET ELIGIBLE FRANCHISES
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    static async getEligibleFranchises(_req: Request, res: Response) {
        try {
            const query = `
                SELECT p.id as user_id, 
                       vd.id as vendor_details_id, 
                       vd.store_name, 
                       vd.city, 
                       vd.state,
                       vd.distributor_id,
                       d.name as distributor_name
                FROM vendor_details vd
                JOIN profiles p ON vd.user_id = p.id
                JOIN vendor_verification vv ON p.id = vv.user_id
                LEFT JOIN distributors d ON vd.distributor_id = d.id
                WHERE vv.is_verified = TRUE AND vd.is_franchise = TRUE
                ORDER BY vd.store_name ASC
            `;
            const [franchises]: any = await db.execute(query);
            res.json({ success: true, franchises });
        } catch (error: any) {
            console.error('Get eligible franchises error:', error);
            res.status(500).json({ error: 'Failed to fetch eligible franchises' });
        }
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  GET DISTRIBUTOR ALLOWED CATEGORIES
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    static async getDistributorAllowedCategories(req: Request, res: Response) {
        try {
            const { id } = req.params; // Distributor ID

            const [categories]: any = await db.execute(
                `SELECT dac.category_id, sc.name as category_name
                 FROM distributor_allowed_categories dac
                 JOIN store_categories sc ON dac.category_id = sc.id
                 WHERE dac.distributor_id = ?
                 ORDER BY sc.name ASC`,
                [id]
            );
            res.json({ success: true, categories });
        } catch (error: any) {
            console.error('Get distributor allowed categories error:', error);
            res.status(500).json({ error: 'Failed to fetch allowed categories' });
        }
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  SET DISTRIBUTOR ALLOWED CATEGORIES (replaces full set)
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    static async setDistributorAllowedCategories(req: Request, res: Response) {
        const connection = await db.getConnection();
        try {
            const { id } = req.params; // Distributor ID
            const { categoryIds } = req.body; // string[]

            if (!Array.isArray(categoryIds)) {
                return res.status(400).json({ error: 'categoryIds must be an array' });
            }

            const [dists]: any = await connection.execute('SELECT name FROM distributors WHERE id = ?', [id]);
            if (dists.length === 0) {
                return res.status(404).json({ error: 'Distributor not found' });
            }

            await connection.beginTransaction();

            await connection.execute('DELETE FROM distributor_allowed_categories WHERE distributor_id = ?', [id]);

            for (const categoryId of categoryIds) {
                await connection.execute(
                    `INSERT INTO distributor_allowed_categories (id, distributor_id, category_id) VALUES (?, ?, ?)`,
                    [uuidv4(), id, categoryId]
                );
            }

            await connection.commit();

            const admin = (req as any).user;
            await ActivityLogService.log({
                adminId: admin.id,
                adminName: admin.name,
                adminEmail: admin.email,
                actionType: 'DISTRIBUTOR_CATEGORIES_UPDATED',
                targetType: 'DISTRIBUTOR',
                targetId: id,
                targetName: dists[0].name,
                details: { category_count: categoryIds.length },
                ipAddress: req.ip || req.socket?.remoteAddress
            });

            res.json({ success: true, message: `Updated allowed categories for ${dists[0].name}` });
        } catch (error: any) {
            await connection.rollback();
            console.error('Set distributor allowed categories error:', error);
            res.status(500).json({ error: 'Failed to update allowed categories' });
        } finally {
            connection.release();
        }
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  GET FRANCHISE'S ASSIGNED DISTRIBUTORS (many-to-many)
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    /**
     * Reverse hierarchy: every franchise with the distributors it buys from, and
     * the categories it can buy from each.
     *
     * The existing screens only go distributor -> franchises, which cannot answer
     * "who does this franchise buy from, and for what?" — the question that matters
     * when one franchise sources different categories from different distributors
     * (e.g. mats from one, seat covers from another).
     *
     * Category scope lives on the distributor (distributor_allowed_categories), so
     * what a franchise may buy from a given distributor is that distributor's
     * category list.
     */
    // ═══════════════════════════════════════════════════════════
    //  STORE AUDITS (WhatsApp Flow responses)
    // ═══════════════════════════════════════════════════════════
    /**
     * Audit submissions, newest first.
     *
     * Responses arrive from the WhatsApp Flow and are matched to a store by the
     * submitting phone number. A response that matches no store is kept rather
     * than dropped — silently discarding a real submission is worse than leaving
     * a small queue to reconcile by hand — so vendor_details_id may be null.
     */
    static async getStoreAudits(req: Request, res: Response) {
        try {
            const { status, search, from, to } = req.query as Record<string, string>;

            const where: string[] = [];
            const params: any[] = [];

            if (status && ['new', 'reviewed', 'follow_up'].includes(status)) {
                where.push('sa.review_status = ?');
                params.push(status);
            }
            const { channel } = req.query as Record<string, string>;
            if (channel && ['whatsapp', 'call'].includes(channel)) {
                where.push('sa.channel = ?');
                params.push(channel);
            }
            if (search) {
                // Search the contact sheet too, or a store that exists only
                // there could never be found by name.
                where.push(`(vd.store_name LIKE ? OR vd.store_code LIKE ? OR vd.city LIKE ?
                             OR ac.store_name LIKE ? OR ac.city LIKE ? OR ac.contact_person LIKE ?
                             OR sa.submitted_phone LIKE ?)`);
                const like = `%${search}%`;
                params.push(like, like, like, like, like, like, like);
            }
            if (from) { where.push('sa.submitted_at >= ?'); params.push(from); }
            if (to)   { where.push('sa.submitted_at <= ?'); params.push(`${to} 23:59:59`); }

            const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

            // Fall back to the uploaded contact sheet for a store the portal has
            // no franchise record for. Those stores were audited on purpose —
            // they are on the sheet precisely because they should be — so the
            // row must still say who they are. "Unmatched" then means only what
            // it says: this number is not in the franchise database.
            const [audits]: any = await db.execute(
                `SELECT sa.*,
                        COALESCE(vd.store_name, ac.store_name)   AS store_name,
                        vd.store_code,
                        COALESCE(vd.city,  ac.city)              AS city,
                        COALESCE(vd.state, ac.state)             AS state,
                        COALESCE(sa.contact_person, ac.contact_person) AS contact_person,
                        COALESCE(sa.asm,   ac.asm)               AS asm,
                        (ac.id IS NOT NULL)                      AS in_contact_sheet
                 FROM store_audits sa
                 LEFT JOIN vendor_details vd ON vd.id = sa.vendor_details_id
                 LEFT JOIN audit_contacts ac
                        ON ac.phone_key = RIGHT(REGEXP_REPLACE(COALESCE(sa.submitted_phone, ''), '[^0-9]', ''), 10)
                 ${whereSql}
                 ORDER BY sa.submitted_at DESC
                 LIMIT 500`,
                params
            );

            const [[counts]]: any = await db.execute(
                `SELECT COUNT(*) AS total,
                        SUM(review_status = 'new')       AS new_count,
                        SUM(review_status = 'reviewed')  AS reviewed_count,
                        SUM(review_status = 'follow_up') AS follow_up_count,
                        SUM(vendor_details_id IS NULL)   AS unmatched_count,
                        SUM(channel = 'whatsapp')        AS whatsapp_count,
                        SUM(channel = 'call')            AS call_count
                 FROM store_audits`
            );

            res.json({ success: true, audits, counts });
        } catch (error: any) {
            console.error('Get store audits error:', error);
            res.status(500).json({ error: 'Failed to load audits' });
        }
    }

    /**
     * Record an audit taken over the phone.
     *
     * Asks the same fields as Flow af_store_audit_2 so a phoned-in audit and a
     * WhatsApp one are directly comparable. Multi-selects are stored comma-joined
     * as option ids, matching what the Flow sends. The auditor comes from the
     * session, never the request body, so an audit cannot be filed under someone
     * else's name.
     */
    static async createCallAudit(req: Request, res: Response) {
        try {
            const b = req.body || {};
            if (!b.vendorDetailsId && !b.targetId) {
                return res.status(400).json({ error: 'Select the store this audit is for' });
            }

            // Two ways in. Normally a franchise record, but a chunk of every
            // round is stores that exist only in the uploaded contact sheet —
            // never matched to a franchise. They still have to be auditable, or
            // the round can never be completed, so a target row identifies the
            // store just as well and carries the same details.
            let v: any = null;

            if (b.vendorDetailsId) {
                // The admin vendors list returns profiles.id, not vendor_details.id, so
                // accept either rather than forcing every caller to know which is which.
                const [vendor]: any = await db.execute(
                    `SELECT vd.id, vd.user_id, vd.store_name, vd.city, vd.state,
                            p.phone_number, p.name AS contact_person
                     FROM vendor_details vd
                     LEFT JOIN profiles p ON p.id = vd.user_id
                     WHERE vd.id = ? OR vd.user_id = ?
                     LIMIT 1`,
                    [b.vendorDetailsId, b.vendorDetailsId]
                );
                if (vendor.length === 0) {
                    return res.status(404).json({ error: 'Store not found' });
                }
                v = vendor[0];
            } else {
                const [target]: any = await db.execute(
                    `SELECT t.id AS target_id, t.round_id, t.vendor_details_id,
                            COALESCE(t.store_name, ac.store_name) AS store_name,
                            COALESCE(t.sent_phone, ac.raw_phone)  AS phone_number,
                            ac.contact_person, ac.city, ac.state, ac.zone, ac.asm,
                            ac.brands, ac.category
                     FROM audit_round_targets t
                     LEFT JOIN audit_contacts ac ON ac.phone_key = t.phone_key
                     WHERE t.id = ?
                     LIMIT 1`,
                    [b.targetId]
                );
                if (target.length === 0) {
                    return res.status(404).json({ error: 'Store not found' });
                }
                const t = target[0];
                // A target may have been matched since the list was built; prefer
                // the franchise link when there is one so the audit still joins up.
                v = {
                    id: t.vendor_details_id,
                    store_name: t.store_name,
                    city: t.city,
                    state: t.state,
                    phone_number: t.phone_number,
                    contact_person: t.contact_person,
                    _targetId: t.target_id,
                    _roundId: t.round_id,
                    _zone: t.zone,
                    _asm: t.asm,
                    _brands: t.brands,
                    _category: t.category,
                };
            }

            // Multi-selects arrive as arrays from the form; the Flow sends them
            // comma-joined. Normalise so both channels store the same shape.
            const join = (x: any) => Array.isArray(x) ? x.join(', ') : (x || null);

            const admin = (req as any).user;
            const id = uuidv4();

            // A call is how a non-responder gets closed out, so it has to count
            // toward the same round the WhatsApp campaign opened. A call carries
            // no campaign id of its own, so it joins whichever round is still
            // open — the one being chased. Explicit roundId wins, for recording
            // a call against an earlier round after a newer one has opened.
            // A target already knows its round, which beats guessing.
            let roundId: string | null = b.roundId || v._roundId || null;
            if (!roundId) {
                const [openRound]: any = await db.execute(
                    `SELECT id FROM audit_rounds WHERE status = 'open'
                     ORDER BY COALESCE(first_sent_at, created_at) DESC LIMIT 1`
                );
                roundId = openRound.length > 0 ? openRound[0].id : null;
            }

            /*
             * The month a call belongs to.
             *
             * A call closes a store out for the month rather than for one
             * campaign — an admin ringing round does not care which reminder
             * the store ignored. Recorded independently of the round, so the
             * month view still counts the call when no round matches.
             */
            const auditMonth: string = b.month || new Date().toISOString().slice(0, 7);

            await db.execute(
                `INSERT INTO store_audits
                 (id, round_id, audit_month, vendor_details_id, submitted_phone, channel, audited_by, audited_by_name,
                  flow_id, flow_name, flow_version,
                  audit_date, franchise_name, store_contact_no, contact_person, city, state,
                  zone, asm, brands, category,
                  signage_status, online_presence, online_presence_other, footfall,
                  seat_covers_stock, products_stocked, last_month_business, staff_training,
                  warranty_registration, support_needed, support_details)
                 VALUES (?, ?, ?, ?, ?, 'call', ?, ?, NULL, 'call', NULL,
                         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    id, roundId, auditMonth, v.id, v.phone_number || '',
                    admin?.id || null, admin?.name || admin?.email || null,
                    new Date().toISOString().slice(0, 10),
                    v.store_name || null,
                    v.phone_number || null,
                    v.contact_person || null,
                    v.city || null,
                    v.state || null,
                    // zone / asm / brands / category have no column in vendor_details —
                    // the auditor supplies them on the call, falling back to the
                    // uploaded contact sheet, which is where they came from.
                    b.zone || v._zone || null,
                    b.asm || v._asm || null,
                    b.brands || v._brands || null,
                    b.category || v._category || null,
                    b.signage_status || null,
                    join(b.online_presence),
                    b.online_presence_other || null,
                    b.footfall || null,
                    b.seat_covers_stock || null,
                    join(b.products_stocked),
                    b.last_month_business || null,
                    b.staff_training || null,
                    b.warranty_registration || null,
                    b.support_needed || null,
                    b.support_details || null,
                ]
            );

            // Tick the store off the round's chase list. Without this the call
            // records the answers but the store stays outstanding, so the admin
            // would keep ringing someone who has already been audited — which
            // is the whole reason the call option exists.
            if (v._targetId) {
                // Audited straight from its chase-list row, so tick off exactly
                // that row. This is the only way to close out a store that was
                // never matched to a franchise: there is no vendor id to find it
                // by, and 83 of the 526 stores in a round are in that position.
                await db.execute(
                    `UPDATE audit_round_targets
                     SET store_audit_id = ?, responded_at = CURRENT_TIMESTAMP
                     WHERE id = ? AND responded_at IS NULL`,
                    [id, v._targetId]
                );
            } else if (roundId && v.id) {
                const [upd]: any = await db.execute(
                    `UPDATE audit_round_targets
                     SET store_audit_id = ?, responded_at = CURRENT_TIMESTAMP
                     WHERE round_id = ? AND vendor_details_id = ? AND responded_at IS NULL`,
                    [id, roundId, v.id]
                );
                // A store that was never on the list (the send events missed it)
                // still counts as done once audited by phone.
                if (upd.affectedRows === 0) {
                    await db.execute(
                        `INSERT INTO audit_round_targets (id, round_id, vendor_details_id, store_audit_id, responded_at)
                         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                         ON DUPLICATE KEY UPDATE
                            store_audit_id = COALESCE(store_audit_id, VALUES(store_audit_id)),
                            responded_at   = COALESCE(responded_at, VALUES(responded_at))`,
                        [uuidv4(), roundId, v.id, id]
                    );
                }
            }

            res.status(201).json({ success: true, id, message: 'Call audit recorded' });
        } catch (error: any) {
            console.error('Create call audit error:', error);
            res.status(500).json({ error: 'Failed to save the audit' });
        }
    }

    /** Mark an audit reviewed or flagged for follow-up, with an optional note. */
    static async updateStoreAuditReview(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { status, note } = req.body || {};

            if (!['new', 'reviewed', 'follow_up'].includes(status)) {
                return res.status(400).json({ error: 'status must be new, reviewed or follow_up' });
            }

            const admin = (req as any).user;
            const [result]: any = await db.execute(
                `UPDATE store_audits
                 SET review_status = ?, review_note = ?, reviewed_by = ?, reviewed_at = NOW()
                 WHERE id = ?`,
                [status, note ? String(note).slice(0, 500) : null, admin?.id || null, id]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({ error: 'Audit not found' });
            }
            res.json({ success: true, message: 'Audit updated' });
        } catch (error: any) {
            console.error('Update audit review error:', error);
            res.status(500).json({ error: 'Failed to update audit' });
        }
    }

    /** Attach an unmatched response to a store, when the phone did not resolve. */
    /**
     * Audit rounds.
     *
     * Audits repeat — monthly, or whenever the business asks — so submissions
     * are grouped into a named round. A round also carries the list of stores it
     * was sent to, which is what makes non-responders visible: without a target
     * list, a store that never audits is simply absent from the data rather than
     * outstanding.
     */
    /**
     * The admin's uploaded store list.
     *
     * A WhatsApp audit arrives with little more than the phone that sent it, so
     * a store the portal does not hold shows as "Unmatched". Uploading the list
     * the audit was sent to gives those responses a name, an area and a
     * territory, and links them to a franchise where one exists.
     */
    static async getAuditContacts(req: Request, res: Response) {
        try {
            const { search, matched } = req.query as Record<string, string>;
            const where: string[] = [];
            const params: any[] = [];

            if (search) {
                where.push('(ac.store_name LIKE ? OR ac.contact_person LIKE ? OR ac.city LIKE ? OR ac.phone_key LIKE ?)');
                const like = `%${search}%`;
                params.push(like, like, like, like);
            }
            if (matched === 'yes') where.push('ac.vendor_details_id IS NOT NULL');
            if (matched === 'no') where.push('ac.vendor_details_id IS NULL');

            const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

            const [contacts]: any = await db.execute(
                `SELECT ac.*, vd.store_name AS portal_store_name, vd.store_code
                 FROM audit_contacts ac
                 LEFT JOIN vendor_details vd ON vd.id = ac.vendor_details_id
                 ${whereSql}
                 ORDER BY ac.store_name ASC
                 LIMIT 1000`,
                params
            );

            const [[counts]]: any = await db.execute(
                `SELECT COUNT(*) AS total,
                        SUM(vendor_details_id IS NOT NULL) AS linked,
                        SUM(vendor_details_id IS NULL)     AS unlinked,
                        SUM(match_method = 'phone')        AS by_phone,
                        SUM(match_method = 'store_name')   AS by_name
                 FROM audit_contacts`
            );

            res.json({ success: true, contacts, counts });
        } catch (error: any) {
            console.error('Get audit contacts error:', error);
            res.status(500).json({ error: 'Failed to load the store list' });
        }
    }

    /**
     * Parse an uploaded CSV and report what it would do, without saving.
     *
     * The admin sees how many rows parsed, how many link to a franchise and how
     * many are new before anything is written — a list this size is not worth
     * committing blind.
     */
    static async previewAuditContacts(req: Request, res: Response) {
        try {
            const csvText = String(req.body?.csv || '');
            if (!csvText.trim()) {
                return res.status(400).json({ error: 'No CSV content received' });
            }

            const parsed = parseContacts(csvText);
            if (parsed.contacts.length === 0) {
                return res.status(400).json({
                    error: parsed.totalRows === 0
                        ? 'That file has no rows'
                        : `No usable phone numbers found in ${parsed.totalRows} rows. Check the phone column has not been saved as 9.19E+11 by Excel.`
                });
            }

            const matched = await matchContacts(parsed.contacts);
            const existingKeys = new Set<string>();
            const [rows]: any = await db.query(
                `SELECT phone_key FROM audit_contacts WHERE phone_key IN (?)`,
                [matched.map(m => m.phone_key)]
            );
            rows.forEach((r: any) => existingKeys.add(r.phone_key));

            res.json({
                success: true,
                summary: {
                    totalRows: parsed.totalRows,
                    usable: matched.length,
                    skippedNoPhone: parsed.skippedNoPhone,
                    duplicatePhones: parsed.duplicatePhones,
                    matchedByPhone: matched.filter(m => m.match_method === 'phone').length,
                    matchedByName: matched.filter(m => m.match_method === 'store_name').length,
                    unmatched: matched.filter(m => m.match_method === 'none').length,
                    willUpdate: matched.filter(m => existingKeys.has(m.phone_key)).length,
                    willInsert: matched.filter(m => !existingKeys.has(m.phone_key)).length,
                },
                sample: matched.slice(0, 15),
            });
        } catch (error: any) {
            console.error('Preview audit contacts error:', error);
            res.status(500).json({ error: 'Could not read that file' });
        }
    }

    /** Save the uploaded list, replacing any row held for the same number. */
    static async uploadAuditContacts(req: Request, res: Response) {
        try {
            const csvText = String(req.body?.csv || '');
            if (!csvText.trim()) {
                return res.status(400).json({ error: 'No CSV content received' });
            }

            const parsed = parseContacts(csvText);
            if (parsed.contacts.length === 0) {
                return res.status(400).json({ error: 'No usable phone numbers in that file' });
            }

            const matched = await matchContacts(parsed.contacts);
            const admin = (req as any).user;
            const result = await saveContacts(matched, {
                sourceFile: String(req.body?.fileName || '').slice(0, 255) || undefined,
                adminId: admin?.id,
                adminName: admin?.name || admin?.email,
            });

            await ActivityLogService.log({
                adminId: admin?.id,
                adminName: admin?.name,
                adminEmail: admin?.email,
                actionType: 'UPLOAD_AUDIT_CONTACTS',
                targetType: 'AUDIT_CONTACTS',
                details: { ...result, rows: parsed.totalRows, file: req.body?.fileName },
                ipAddress: req.ip || req.socket?.remoteAddress
            });

            // Bring the open round's chase list in line with what was just
            // uploaded, so the two do not describe different sets of stores.
            let synced = { added: 0, existing: 0 };
            const [openRound]: any = await db.execute(
                `SELECT id FROM audit_rounds WHERE status = 'open'
                 ORDER BY COALESCE(first_sent_at, created_at) DESC LIMIT 1`
            );
            if (openRound.length > 0) {
                synced = await syncRoundTargets(openRound[0].id);
            }

            res.json({
                success: true,
                message: `${result.inserted} added, ${result.updated} updated`
                    + (synced.added ? ` — ${synced.added} added to the chase list` : ''),
                data: {
                    ...result,
                    matchedByPhone: matched.filter(m => m.match_method === 'phone').length,
                    matchedByName: matched.filter(m => m.match_method === 'store_name').length,
                    unmatched: matched.filter(m => m.match_method === 'none').length,
                },
            });
        } catch (error: any) {
            console.error('Upload audit contacts error:', error);
            res.status(500).json({ error: 'Failed to save the store list' });
        }
    }

    /**
     * The months that have audit activity, for the year/month picker.
     */
    static async getAuditMonths(req: Request, res: Response) {
        try {
            res.json({ success: true, months: await listMonths() });
        } catch (error: any) {
            console.error('Get audit months error:', error);
            res.status(500).json({ error: 'Failed to load audit months' });
        }
    }

    /**
     * One month: its rounds, and one row per store across all of them.
     *
     * The consolidated list is the point. A store chased twice appears once,
     * counted done if it answered any round or was audited by phone, so the
     * admin working the list is not ringing stores that already replied.
     */
    static async getAuditMonth(req: Request, res: Response) {
        try {
            const month = String(req.params.month || '');
            if (!/^\d{4}-\d{2}$/.test(month)) {
                return res.status(400).json({ error: 'Month must look like 2026-09' });
            }
            const status = req.query.status as string | undefined;
            const [rounds, campaigns, stores] = await Promise.all([
                roundsInMonth(month),
                allCampaignsInMonth(month),
                storesInMonth(month, { status }),
            ]);
            const done = stores.filter((s: any) => s.done).length;
            res.json({
                success: true,
                month,
                summary: {
                    stores: stores.length,
                    done,
                    outstanding: stores.length - done,
                    compliance: stores.length ? Number(((done / stores.length) * 100).toFixed(1)) : 0,
                },
                rounds,
                campaigns,
                stores,
            });
        } catch (error: any) {
            console.error('Get audit month error:', error);
            res.status(500).json({ error: 'Failed to load the month' });
        }
    }

    /**
     * Tick a campaign in or out of the audit figures.
     *
     * Interakt sends campaigns that have nothing to do with auditing, and one
     * of them opened a round here. Rather than guess from the template name,
     * an admin says which campaigns count.
     */
    static async setRoundCounted(req: Request, res: Response) {
        try {
            const roundId = req.params.id;
            const counted = req.body?.include ? 1 : 0;
            const [round]: any = await db.execute(
                `SELECT id, name FROM audit_rounds WHERE id = ? LIMIT 1`, [roundId]
            );
            if (round.length === 0) return res.status(404).json({ error: 'Round not found' });

            await db.execute(
                `UPDATE audit_rounds SET include_in_stats = ? WHERE id = ?`, [counted, roundId]
            );

            const admin = (req as any).user;
            await ActivityLogService.log({
                adminId: admin?.id,
                adminName: admin?.name,
                adminEmail: admin?.email,
                actionType: 'AUDIT_ROUND_COUNTED',
                targetType: 'AUDIT_ROUND',
                targetId: roundId,
                targetName: round[0].name,
                details: { include_in_stats: counted },
                ipAddress: req.ip || req.socket?.remoteAddress,
            });

            res.json({ success: true, include_in_stats: counted });
        } catch (error: any) {
            console.error('Set round counted error:', error);
            res.status(500).json({ error: 'Failed to update the campaign' });
        }
    }

    static async getAuditRounds(req: Request, res: Response) {
        try {
            const [rounds]: any = await db.execute(
                `SELECT r.*,
                        (SELECT COUNT(*) FROM audit_round_targets t WHERE t.round_id = r.id) AS target_count,
                        (SELECT COUNT(*) FROM audit_round_targets t WHERE t.round_id = r.id AND t.responded_at IS NOT NULL) AS responded_count,
                        (SELECT COUNT(*) FROM audit_round_targets t WHERE t.round_id = r.id AND t.responded_at IS NULL) AS outstanding_count,
                        -- The delivery funnel, so a store that never received the
                        -- audit is distinguishable from one that ignored it.
                        (SELECT COUNT(*) FROM audit_round_targets t WHERE t.round_id = r.id AND t.sent_at IS NOT NULL) AS sent_count,
                        (SELECT COUNT(*) FROM audit_round_targets t WHERE t.round_id = r.id AND t.delivered_at IS NOT NULL) AS delivered_count,
                        (SELECT COUNT(*) FROM audit_round_targets t WHERE t.round_id = r.id AND t.read_at IS NOT NULL) AS read_count,
                        (SELECT COUNT(*) FROM audit_round_targets t WHERE t.round_id = r.id AND t.failed_at IS NOT NULL) AS failed_count,
                        (SELECT COUNT(*) FROM store_audits sa WHERE sa.round_id = r.id) AS audit_count
                 FROM audit_rounds r
                 ORDER BY COALESCE(r.first_sent_at, r.created_at) DESC`
            );
            res.json({ success: true, rounds });
        } catch (error: any) {
            console.error('Get audit rounds error:', error);
            res.status(500).json({ error: 'Failed to load audit rounds' });
        }
    }

    /**
     * Seed a round's target list by hand.
     *
     * Rounds normally build themselves: a campaign send creates the round and
     * records one target per recipient. This is the fallback for when those
     * events do not arrive — without a target list there is no way to tell who
     * has not responded, so it is better to seed from the franchise list than
     * to have no chase list at all.
     *
     * Existing targets are left alone, so seeding twice is safe and never
     * clears a store that has already responded.
     */
    static async seedAuditRoundTargets(req: Request, res: Response) {
        try {
            const roundId = req.params.id;
            const b = req.body || {};

            const [round]: any = await db.execute(
                `SELECT id, name FROM audit_rounds WHERE id = ? LIMIT 1`, [roundId]
            );
            if (round.length === 0) {
                return res.status(404).json({ error: 'Round not found' });
            }

            let targetIds: string[] = [];
            if (Array.isArray(b.vendorIds) && b.vendorIds.length > 0) {
                const [rows]: any = await db.query(
                    `SELECT id FROM vendor_details WHERE id IN (?) OR user_id IN (?)`,
                    [b.vendorIds, b.vendorIds]
                );
                targetIds = rows.map((r: any) => r.id);
            } else {
                // Every verified franchise — who an audit normally goes to.
                const [rows]: any = await db.execute(
                    `SELECT vd.id
                     FROM vendor_details vd
                     JOIN vendor_verification vv ON vv.user_id = vd.user_id
                     WHERE vv.is_verified = 1`
                );
                targetIds = rows.map((r: any) => r.id);
            }

            let added = 0;
            for (const vid of targetIds) {
                const [r]: any = await db.execute(
                    `INSERT IGNORE INTO audit_round_targets (id, round_id, vendor_details_id)
                     VALUES (?, ?, ?)`,
                    [uuidv4(), roundId, vid]
                );
                if (r.affectedRows > 0) added++;
            }

            const admin = (req as any).user;
            await ActivityLogService.log({
                adminId: admin?.id,
                adminName: admin?.name,
                adminEmail: admin?.email,
                actionType: 'SEED_AUDIT_ROUND_TARGETS',
                targetType: 'AUDIT_ROUND',
                targetId: roundId,
                targetName: round[0].name,
                details: { added, considered: targetIds.length },
                ipAddress: req.ip || req.socket?.remoteAddress
            });

            res.json({
                success: true,
                message: `${added} store${added === 1 ? '' : 's'} added to the chase list`,
                data: { added, considered: targetIds.length }
            });
        } catch (error: any) {
            console.error('Seed audit round targets error:', error);
            res.status(500).json({ error: 'Failed to seed the round' });
        }
    }

    /** Close a round, so late submissions no longer attach to it. */
    static async closeAuditRound(req: Request, res: Response) {
        try {
            const [r]: any = await db.execute(
                `UPDATE audit_rounds SET status = 'closed', closed_at = CURRENT_TIMESTAMP
                 WHERE id = ? AND status = 'open'`,
                [req.params.id]
            );
            if (r.affectedRows === 0) {
                return res.status(404).json({ error: 'Round not found, or already closed' });
            }
            res.json({ success: true, message: 'Round closed' });
        } catch (error: any) {
            console.error('Close audit round error:', error);
            res.status(500).json({ error: 'Failed to close the round' });
        }
    }

    /**
     * Delete a round and its target list.
     *
     * Test campaigns land here the same way real ones do — the webhook opens a
     * round for whatever Interakt sends — so there has to be a way to clear
     * them without a database session.
     *
     * Submissions are deliberately kept: a store's answers are the record, and
     * they outlive the round they arrived through. Their round_id is cleared so
     * nothing points at a row that no longer exists. Targets go with the round
     * (ON DELETE CASCADE) because they only describe who was messaged.
     */
    static async deleteAuditRound(req: Request, res: Response) {
        try {
            const roundId = req.params.id;

            const [[round]]: any = await db.execute(
                `SELECT id, name FROM audit_rounds WHERE id = ? LIMIT 1`,
                [roundId]
            );
            if (!round) return res.status(404).json({ error: 'Round not found' });

            const [[counts]]: any = await db.execute(
                `SELECT
                    (SELECT COUNT(*) FROM audit_round_targets WHERE round_id = ?) AS targets,
                    (SELECT COUNT(*) FROM store_audits WHERE round_id = ?) AS audits`,
                [roundId, roundId]
            );

            // Detaching keeps a real store's answers when a campaign is tidied
            // away. But a test round deleted to get rid of it left its
            // submissions behind under "All rounds", which is not what deleting
            // it meant — so the caller says which it wants.
            const alsoDeleteAudits = req.query.deleteAudits === 'true' || req.body?.deleteAudits === true;

            if (alsoDeleteAudits) {
                // Reopen any target these filled first; a target pointing at a
                // deleted audit would still read as done.
                await db.execute(
                    `UPDATE audit_round_targets SET responded_at = NULL, store_audit_id = NULL
                      WHERE store_audit_id IN (SELECT id FROM store_audits WHERE round_id = ?)`,
                    [roundId]
                );
                await db.execute(`DELETE FROM store_audits WHERE round_id = ?`, [roundId]);
            } else {
                await db.execute(`UPDATE store_audits SET round_id = NULL WHERE round_id = ?`, [roundId]);
            }

            await db.execute(`DELETE FROM audit_rounds WHERE id = ?`, [roundId]);

            res.json({
                success: true,
                message: `Deleted round "${round.name}"`,
                data: {
                    targetsRemoved: Number(counts.targets || 0),
                    auditsKept: alsoDeleteAudits ? 0 : Number(counts.audits || 0),
                    auditsDeleted: alsoDeleteAudits ? Number(counts.audits || 0) : 0,
                },
            });
        } catch (error: any) {
            console.error('Delete audit round error:', error);
            res.status(500).json({ error: 'Failed to delete the round' });
        }
    }

    /**
     * Delete one audit submission.
     *
     * Used to clear test entries. If the submission had filled a target, that
     * target is reopened so the store still reads as outstanding rather than
     * silently counting as done.
     */
    static async deleteStoreAudit(req: Request, res: Response) {
        try {
            const auditId = req.params.id;

            const [[audit]]: any = await db.execute(
                `SELECT id, round_id FROM store_audits WHERE id = ? LIMIT 1`,
                [auditId]
            );
            if (!audit) return res.status(404).json({ error: 'Audit not found' });

            await db.execute(
                `UPDATE audit_round_targets
                    SET responded_at = NULL, store_audit_id = NULL
                  WHERE store_audit_id = ?`,
                [auditId]
            );
            await db.execute(`DELETE FROM store_audits WHERE id = ?`, [auditId]);

            res.json({ success: true, message: 'Audit deleted' });
        } catch (error: any) {
            console.error('Delete store audit error:', error);
            res.status(500).json({ error: 'Failed to delete the audit' });
        }
    }

    /**
     * Which stores have and have not answered a round.
     *
     * The point of the whole round structure: outstanding stores are the ones
     * worth chasing, and they only exist as data because the target list does.
     */
    static async getAuditRoundTargets(req: Request, res: Response) {
        try {
            const { responded } = req.query as Record<string, string>;
            const where: string[] = ['t.round_id = ?'];
            const params: any[] = [req.params.id];

            if (responded === 'yes') where.push('t.responded_at IS NOT NULL');
            if (responded === 'no') where.push('t.responded_at IS NULL');

            const [targets]: any = await db.execute(
                `SELECT t.id, t.vendor_details_id, t.store_audit_id, t.responded_at,
                        t.sent_at, t.sent_phone,
                        -- A target may be a store known only from the uploaded
                        -- list, so fall back to its details when the portal
                        -- holds no franchise for it.
                        COALESCE(vd.store_name, t.store_name, ac.store_name) AS store_name,
                        vd.store_code,
                        COALESCE(vd.city, ac.city) AS city,
                        COALESCE(vd.state, ac.state) AS state,
                        COALESCE(p.phone_number, t.phone_key, ac.raw_phone) AS phone_number,
                        COALESCE(p.name, ac.contact_person) AS contact_person
                 FROM audit_round_targets t
                 LEFT JOIN vendor_details vd ON vd.id = t.vendor_details_id
                 LEFT JOIN profiles p ON p.id = vd.user_id
                 LEFT JOIN audit_contacts ac ON ac.phone_key = t.phone_key
                 WHERE ${where.join(' AND ')}
                 ORDER BY (t.responded_at IS NULL) DESC, vd.store_name ASC`,
                params
            );

            const [[counts]]: any = await db.execute(
                `SELECT COUNT(*) AS total,
                        SUM(responded_at IS NOT NULL) AS responded,
                        SUM(responded_at IS NULL)     AS outstanding
                 FROM audit_round_targets WHERE round_id = ?`,
                [req.params.id]
            );

            res.json({ success: true, targets, counts });
        } catch (error: any) {
            console.error('Get audit round targets error:', error);
            res.status(500).json({ error: 'Failed to load round targets' });
        }
    }

    static async assignStoreAudit(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { vendorDetailsId } = req.body || {};

            if (!vendorDetailsId) {
                return res.status(400).json({ error: 'vendorDetailsId is required' });
            }

            // Same as the call form: callers may pass profiles.id or vendor_details.id.
            const [vendor]: any = await db.execute(
                'SELECT id FROM vendor_details WHERE id = ? OR user_id = ? LIMIT 1',
                [vendorDetailsId, vendorDetailsId]
            );
            if (vendor.length === 0) {
                return res.status(404).json({ error: 'Store not found' });
            }

            const [result]: any = await db.execute(
                'UPDATE store_audits SET vendor_details_id = ? WHERE id = ?',
                [vendor[0].id, id]
            );
            if (result.affectedRows === 0) {
                return res.status(404).json({ error: 'Audit not found' });
            }
            res.json({ success: true, message: 'Audit linked to store' });
        } catch (error: any) {
            console.error('Assign audit error:', error);
            res.status(500).json({ error: 'Failed to link audit' });
        }
    }

    static async getFranchiseDistributorMap(req: Request, res: Response) {
        try {
            const search = (req.query.search as string || '').trim();
            const onlyMulti = req.query.onlyMulti === 'true';
            const unmappedOnly = req.query.unmapped === 'true';

            const params: any[] = [];
            let searchClause = '';
            if (search) {
                searchClause = ` AND (vd.store_name LIKE ? OR vd.store_code LIKE ? OR vd.city LIKE ?)`;
                const like = `%${search}%`;
                params.push(like, like, like);
            }

            // One row per franchise-distributor pair; franchises with no
            // distributor still appear (LEFT JOIN) so gaps are visible.
            const [rows]: any = await db.execute(
                `SELECT
                    vd.user_id            AS franchise_user_id,
                    vd.id                 AS franchise_id,
                    vd.store_name,
                    vd.store_code,
                    vd.city,
                    vd.state,
                    vd.is_distributor,
                    d.id                  AS distributor_id,
                    d.name                AS distributor_name,
                    d.city                AS distributor_city,
                    d.allowed_brands      AS distributor_brands,
                    -- Tag the brand: AF and AC categories share names, so the bare
                    -- name would render as an unexplained duplicate chip.
                    GROUP_CONCAT(DISTINCT CONCAT(sc.name, ' (', CASE WHEN sc.id LIKE '%-ac' THEN 'AC' ELSE 'AF' END, ')')
                                 ORDER BY sc.name SEPARATOR '||') AS category_names,
                    (fd.category_scope = 'selected') AS has_limit
                 FROM vendor_details vd
                 LEFT JOIN franchise_distributors fd ON fd.franchise_user_id = vd.user_id
                 LEFT JOIN distributors d           ON d.id = fd.distributor_id
                 -- Effective categories = distributor's list narrowed by any
                 -- per-franchise limit. No limit rows = inherit everything.
                 LEFT JOIN distributor_allowed_categories dac ON dac.distributor_id = d.id
                    AND (
                      fd.category_scope = 'all'
                      OR EXISTS (
                        SELECT 1 FROM franchise_distributor_categories fdc
                        WHERE fdc.franchise_user_id = vd.user_id AND fdc.distributor_id = d.id
                          AND fdc.category_id = dac.category_id
                      )
                    )
                 LEFT JOIN store_categories sc      ON sc.id = dac.category_id
                 WHERE vd.is_franchise = 1 ${searchClause}
                 GROUP BY vd.user_id, vd.id, vd.store_name, vd.store_code, vd.city, vd.state,
                          vd.is_distributor, d.id, d.name, d.city, d.allowed_brands, fd.category_scope
                 ORDER BY vd.store_name ASC, d.name ASC`,
                params
            );

            // Collapse the pair rows into one entry per franchise.
            const byFranchise = new Map<string, any>();
            for (const r of rows) {
                if (!byFranchise.has(r.franchise_user_id)) {
                    byFranchise.set(r.franchise_user_id, {
                        franchise_user_id: r.franchise_user_id,
                        franchise_id: r.franchise_id,
                        store_name: r.store_name,
                        store_code: r.store_code,
                        city: r.city,
                        state: r.state,
                        is_distributor: Boolean(r.is_distributor),
                        distributors: []
                    });
                }
                if (r.distributor_id) {
                    byFranchise.get(r.franchise_user_id).distributors.push({
                        id: r.distributor_id,
                        name: r.distributor_name,
                        city: r.distributor_city,
                        brands: r.distributor_brands,
                        categories: r.category_names ? String(r.category_names).split('||') : [],
                        hasLimit: Boolean(Number(r.has_limit))
                    });
                }
            }

            let franchises = Array.from(byFranchise.values());
            if (onlyMulti)     franchises = franchises.filter(f => f.distributors.length > 1);
            if (unmappedOnly)  franchises = franchises.filter(f => f.distributors.length === 0);

            res.json({
                success: true,
                franchises,
                summary: {
                    total: byFranchise.size,
                    mapped: Array.from(byFranchise.values()).filter(f => f.distributors.length > 0).length,
                    multiDistributor: Array.from(byFranchise.values()).filter(f => f.distributors.length > 1).length,
                    unmapped: Array.from(byFranchise.values()).filter(f => f.distributors.length === 0).length
                }
            });
        } catch (error: any) {
            console.error('Get franchise-distributor map error:', error);
            res.status(500).json({ error: 'Failed to load franchise-distributor mapping' });
        }
    }

    /**
     * Categories a specific franchise may buy from a specific distributor.
     *
     * Returns the distributor's full catalogue of categories, each flagged with
     * whether this franchise is allowed it. When no limit rows exist for the pair
     * the franchise inherits everything, so all come back selected and
     * `inherits` is true — that is the default for every existing mapping.
     */
    static async getFranchiseDistributorCategories(req: Request, res: Response) {
        try {
            const { vendorId, distributorId } = req.params;

            // Category names are NOT unique — the AF and AC brand trees carry the
            // same names (the AC twin has an '-ac' id suffix). Return the brand and
            // parent so the UI can tell otherwise-identical rows apart.
            const [categories]: any = await db.execute(
                `SELECT sc.id, sc.name, sc.parent_id,
                        parent.name AS parent_name,
                        CASE WHEN sc.id LIKE '%-ac' THEN 'AC' ELSE 'AF' END AS brand,
                        (SELECT COUNT(*) FROM store_products sp WHERE sp.category_id = sc.id) AS product_count,
                        EXISTS (
                          SELECT 1 FROM franchise_distributor_categories fdc
                          WHERE fdc.franchise_user_id = ?
                            AND fdc.distributor_id = ?
                            AND fdc.category_id = sc.id
                        ) AS is_allowed
                 FROM distributor_allowed_categories dac
                 JOIN store_categories sc ON sc.id = dac.category_id
                 LEFT JOIN store_categories parent ON parent.id = sc.parent_id
                 WHERE dac.distributor_id = ?
                 ORDER BY sc.name ASC, brand ASC`,
                [vendorId, distributorId, distributorId]
            );

            // 'all' = inherit the distributor's full range. 'selected' = only the
            // listed categories, which may legitimately be an empty list.
            const [scopeRows]: any = await db.execute(
                `SELECT category_scope FROM franchise_distributors
                 WHERE franchise_user_id = ? AND distributor_id = ? LIMIT 1`,
                [vendorId, distributorId]
            );
            const inherits = (scopeRows[0]?.category_scope ?? 'all') === 'all';

            res.json({
                success: true,
                inherits,
                categories: categories.map((c: any) => ({
                    id: c.id,
                    name: c.name,
                    parent_id: c.parent_id,
                    parentName: c.parent_name || null,
                    brand: c.brand,
                    productCount: Number(c.product_count || 0),
                    // While inheriting, everything is effectively allowed.
                    allowed: inherits ? true : Boolean(Number(c.is_allowed))
                }))
            });
        } catch (error: any) {
            console.error('Get franchise-distributor categories error:', error);
            res.status(500).json({ error: 'Failed to load category limits' });
        }
    }

    /**
     * Set which categories a franchise may buy from a distributor.
     *
     * Send `categoryIds: []` (or `inherit: true`) to clear the limit and go back
     * to inheriting the distributor's full list.
     */
    static async setFranchiseDistributorCategories(req: Request, res: Response) {
        const connection = await db.getConnection();
        try {
            const { vendorId, distributorId } = req.params;
            const { categoryIds, inherit } = req.body || {};

            if (!inherit && !Array.isArray(categoryIds)) {
                return res.status(400).json({ error: 'categoryIds must be an array, or pass inherit: true' });
            }

            // Only categories the distributor actually sells can be granted.
            const [valid]: any = await connection.execute(
                'SELECT category_id FROM distributor_allowed_categories WHERE distributor_id = ?',
                [distributorId]
            );
            const validIds = new Set(valid.map((r: any) => r.category_id));
            const requested: string[] = inherit ? [] : categoryIds.filter((id: string) => validIds.has(id));

            await connection.beginTransaction();
            await connection.execute(
                'DELETE FROM franchise_distributor_categories WHERE franchise_user_id = ? AND distributor_id = ?',
                [vendorId, distributorId]
            );

            for (const categoryId of requested) {
                await connection.execute(
                    `INSERT INTO franchise_distributor_categories (id, franchise_user_id, distributor_id, category_id)
                     VALUES (?, ?, ?, ?)`,
                    [uuidv4(), vendorId, distributorId, categoryId]
                );
            }

            // The scope flag is what distinguishes "buy everything" from "buy
            // nothing yet" — both of which have zero category rows. Without it an
            // empty selection would silently mean the opposite of what was chosen.
            await connection.execute(
                `UPDATE franchise_distributors SET category_scope = ?
                 WHERE franchise_user_id = ? AND distributor_id = ?`,
                [inherit ? 'all' : 'selected', vendorId, distributorId]
            );
            await connection.commit();

            res.json({
                success: true,
                inherits: Boolean(inherit),
                count: requested.length,
                message: inherit
                    ? 'Cleared — this store can buy everything this distributor sells.'
                    : requested.length === 0
                        ? 'Saved — this store cannot order anything from this distributor yet.'
                        : `Limited to ${requested.length} categor${requested.length === 1 ? 'y' : 'ies'}.`
            });

            try {
                const admin = (req as any).user;
                await ActivityLogService.log({
                    adminId: admin?.id,
                    adminName: admin?.name,
                    adminEmail: admin?.email,
                    actionType: 'SYSTEM_SETTING_UPDATED',
                    targetType: 'SYSTEM_SETTING',
                    targetId: `${vendorId}:${distributorId}`,
                    targetName: 'Franchise purchase categories',
                    details: { vendorId, distributorId, categoryIds: requested, inherit: requested.length === 0 },
                    ipAddress: req.ip || req.socket?.remoteAddress
                });
            } catch (logErr) {
                console.error('Failed to log category limit change', logErr);
            }
        } catch (error: any) {
            await connection.rollback();
            console.error('Set franchise-distributor categories error:', error);
            res.status(500).json({ error: 'Failed to save category limits' });
        } finally {
            connection.release();
        }
    }

    /**
     * What this store has been sent by an admin broadcast.
     *
     * message_logs records one row per recipient but keys on the phone number,
     * not the franchise, so the store's own number is the join. Done here rather
     * than by filtering the full history client-side: that table holds ~40k rows
     * and only a handful belong to any one store.
     */
    static async getFranchiseAnnouncements(req: Request, res: Response) {
        try {
            const { vendorId } = req.params; // Franchise user_id

            const [[store]]: any = await db.execute(
                `SELECT p.phone_number, vd.store_email
                 FROM vendor_details vd
                 LEFT JOIN profiles p ON p.id = vd.user_id
                 WHERE vd.user_id = ? LIMIT 1`,
                [vendorId]
            );
            if (!store) return res.status(404).json({ error: 'Franchise store not found' });

            const last10 = String(store.phone_number || '').replace(/\D/g, '').slice(-10);
            if (!last10) return res.json({ success: true, announcements: [] });

            // The activity log holds the title and body; message_logs holds who
            // it reached and what became of it. Joined on the campaign.
            const [rows]: any = await db.execute(
                `SELECT ml.id, ml.campaign_id, ml.channel, ml.status, ml.error_message,
                        ml.created_at, ml.updated_at,
                        al.details AS broadcast_details, al.admin_name
                 FROM message_logs ml
                 LEFT JOIN admin_activity_log al
                        ON al.action_type = 'BROADCAST_SENT'
                       AND JSON_UNQUOTE(JSON_EXTRACT(al.details, '$.campaignId')) = ml.campaign_id
                 WHERE ml.context = 'admin_broadcast'
                   AND (
                        RIGHT(REGEXP_REPLACE(COALESCE(ml.recipient_phone, ''), '[^0-9]', ''), 10) = ?
                        OR (? <> '' AND ml.recipient_email = ?)
                   )
                 ORDER BY ml.created_at DESC
                 LIMIT 100`,
                [last10, store.store_email || '', store.store_email || '']
            );

            const announcements = rows.map((r: any) => {
                let details: any = {};
                try {
                    details = typeof r.broadcast_details === 'string'
                        ? JSON.parse(r.broadcast_details)
                        : (r.broadcast_details || {});
                } catch { /* a malformed log entry must not hide the delivery row */ }
                return {
                    id: r.id,
                    campaign_id: r.campaign_id,
                    title: details.title || null,
                    message: details.message || null,
                    sent_by: r.admin_name || null,
                    channel: r.channel,
                    status: r.status,
                    error_message: r.error_message,
                    created_at: r.created_at,
                    updated_at: r.updated_at,
                };
            });

            res.json({ success: true, announcements });
        } catch (error: any) {
            console.error('Get franchise announcements error:', error);
            res.status(500).json({ error: 'Failed to fetch announcements for this store' });
        }
    }

    static async getFranchiseDistributors(req: Request, res: Response) {
        try {
            const { vendorId } = req.params; // Franchise user_id

            const [distributors]: any = await db.execute(
                `SELECT d.id, d.name, d.city, d.state,
                        GROUP_CONCAT(sc.name ORDER BY sc.name SEPARATOR ', ') as allowed_category_names
                 FROM franchise_distributors fd
                 JOIN distributors d ON fd.distributor_id = d.id
                 LEFT JOIN distributor_allowed_categories dac ON dac.distributor_id = d.id
                 LEFT JOIN store_categories sc ON sc.id = dac.category_id
                 WHERE fd.franchise_user_id = ?
                 GROUP BY d.id, d.name, d.city, d.state
                 ORDER BY d.name ASC`,
                [vendorId]
            );
            res.json({ success: true, distributors });
        } catch (error: any) {
            console.error('Get franchise distributors error:', error);
            res.status(500).json({ error: 'Failed to fetch franchise distributors' });
        }
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  ASSIGN DISTRIBUTOR TO FRANCHISE (many-to-many, with category-overlap guard)
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    static async assignDistributorToFranchise(req: Request, res: Response) {
        try {
            const { id } = req.params; // Distributor ID
            const { vendorId } = req.body; // Franchise user_id

            if (!vendorId) {
                return res.status(400).json({ error: 'Franchise vendorId is required' });
            }

            const [dists]: any = await db.execute('SELECT name FROM distributors WHERE id = ?', [id]);
            if (dists.length === 0) {
                return res.status(404).json({ error: 'Distributor not found' });
            }

            const [vendors]: any = await db.execute('SELECT store_name, is_franchise FROM vendor_details WHERE user_id = ?', [vendorId]);
            if (vendors.length === 0) {
                return res.status(404).json({ error: 'Franchise store not found' });
            }
            if (!vendors[0].is_franchise) {
                return res.status(400).json({ error: 'Only franchise stores can be assigned to a distributor.' });
            }

            // NOTE: no category-overlap restriction. A franchise may be connected to
            // as many distributors as needed (any brand) — the admin manages these
            // assignments manually.

            await db.execute(
                `INSERT INTO franchise_distributors (id, franchise_user_id, distributor_id)
                 VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE id = id`,
                [uuidv4(), vendorId, id]
            );

            const admin = (req as any).user;
            await ActivityLogService.log({
                adminId: admin.id,
                adminName: admin.name,
                adminEmail: admin.email,
                actionType: 'FRANCHISE_ASSIGNED_DISTRIBUTOR',
                targetType: 'VENDOR',
                targetId: vendorId,
                targetName: vendors[0].store_name,
                details: { distributor_id: id, distributor_name: dists[0].name },
                ipAddress: req.ip || req.socket?.remoteAddress
            });

            res.json({
                success: true,
                message: `Successfully assigned ${vendors[0].store_name} to ${dists[0].name}`
            });
        } catch (error: any) {
            console.error('Assign distributor to franchise error:', error);
            res.status(500).json({ error: 'Failed to assign distributor' });
        }
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  UNASSIGN DISTRIBUTOR FROM FRANCHISE (many-to-many)
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    static async unassignDistributorFromFranchise(req: Request, res: Response) {
        try {
            const { id, vendorId } = req.params; // Distributor ID, Franchise user_id

            const [dists]: any = await db.execute('SELECT name FROM distributors WHERE id = ?', [id]);
            if (dists.length === 0) {
                return res.status(404).json({ error: 'Distributor not found' });
            }

            await db.execute(
                'DELETE FROM franchise_distributors WHERE franchise_user_id = ? AND distributor_id = ?',
                [vendorId, id]
            );

            const admin = (req as any).user;
            const [vendor]: any = await db.execute('SELECT store_name FROM vendor_details WHERE user_id = ?', [vendorId]);

            await ActivityLogService.log({
                adminId: admin.id,
                adminName: admin.name,
                adminEmail: admin.email,
                actionType: 'FRANCHISE_UNASSIGNED_DISTRIBUTOR',
                targetType: 'VENDOR',
                targetId: vendorId,
                targetName: vendor[0]?.store_name,
                details: { distributor_id: id, distributor_name: dists[0].name },
                ipAddress: req.ip || req.socket?.remoteAddress
            });

            res.json({
                success: true,
                message: `Successfully unassigned ${vendor[0]?.store_name || 'franchise'} from ${dists[0].name}`
            });
        } catch (error: any) {
            console.error('Unassign distributor from franchise error:', error);
            res.status(500).json({ error: 'Failed to unassign distributor' });
        }
    }

    /**
     * Every PPF roll that has been drawn on, and how much of each is left.
     *
     * Installers are never told a roll's balance — it is what stops a serial
     * being probed for how much it can still absorb — but an admin needs it to
     * answer "why was this refused?" and to see a roll that is nearly spent.
     */
    static async getPPFRolls(req: Request, res: Response) {
        try {
            const search = String(req.query.search || '').trim();
            const status = String(req.query.status || 'all');
            const capacity = await getRollCapacitySqft();

            /*
             * Two kinds of serial sit side by side here, and both have to show.
             *
             * One was issued to a store ahead of the roll being fitted, and may
             * never have been used — it exists only in ppf_serials. The other
             * appeared the first time an installer typed it, and exists only in
             * ppf_rolls. A UNION over both, rather than a join from either side,
             * is what stops an issued-but-unused serial disappearing from the
             * screen it was created on.
             */
            const params: any[] = [];
            let searchClause = '';
            if (search) {
                searchClause = 'WHERE s.serial_number LIKE ?';
                params.push(`%${search}%`);
            }

            const [rows]: any = await db.execute(
                `SELECT s.serial_number,
                        MIN(s.seen_at) AS first_seen_at,
                        MAX(s.store_code) AS store_code,
                        MAX(s.store_name) AS store_name,
                        MAX(s.issued_at) AS issued_at,
                        COALESCE(SUM(CASE WHEN w.status != 'rejected' THEN c.sqft_used ELSE 0 END), 0) AS used_sqft,
                        COUNT(CASE WHEN w.status != 'rejected' THEN 1 END) AS draws,
                        COUNT(CASE WHEN w.status = 'rejected' THEN 1 END) AS rejected_draws
                   FROM (
                        SELECT serial_number, first_seen_at AS seen_at,
                               NULL AS store_code, NULL AS store_name, NULL AS issued_at
                          FROM ppf_rolls
                        UNION ALL
                        SELECT serial_number, issued_at AS seen_at,
                               store_code, store_name, issued_at
                          FROM ppf_serials
                   ) s
                   LEFT JOIN ppf_roll_consumption c ON c.roll_serial = s.serial_number
                   LEFT JOIN warranty_registrations w ON w.uid = c.warranty_uid
                   ${searchClause}
                  GROUP BY s.serial_number
                  ORDER BY first_seen_at DESC
                  LIMIT 500`,
                params
            );

            const rolls = rows.map((row: any) => {
                const used = Number(row.used_sqft);
                const draws = Number(row.draws);
                return {
                    serialNumber: row.serial_number,
                    firstSeenAt: row.first_seen_at,
                    storeCode: row.store_code,
                    storeName: row.store_name,
                    // Issued by an admin ahead of use, rather than first seen on
                    // a submission. The two are told apart so the screen can say
                    // which serials were handed out and never came back.
                    isIssued: row.issued_at !== null,
                    usedSqft: used,
                    remainingSqft: Math.max(0, capacity - used),
                    draws,
                    rejectedDraws: Number(row.rejected_draws),
                    status: draws === 0 ? 'available' : (used >= capacity ? 'spent' : 'partial'),
                };
            });

            const filtered = status === 'all'
                ? rolls
                : rolls.filter((roll: any) => roll.status === status);

            res.json({
                success: true,
                capacity,
                rolls: filtered,
                stats: {
                    total: rolls.length,
                    available: rolls.filter((r: any) => r.status === 'available').length,
                    partial: rolls.filter((r: any) => r.status === 'partial').length,
                    spent: rolls.filter((r: any) => r.status === 'spent').length,
                    issued: rolls.filter((r: any) => r.isIssued).length,
                },
            });
        } catch (error: any) {
            console.error('Get PPF rolls error:', error);
            res.status(500).json({ error: 'Failed to fetch PPF rolls' });
        }
    }

    /**
     * Stores that can be issued serial numbers.
     *
     * Its own endpoint rather than the public store list, which deliberately
     * does not carry store codes — that list feeds the public warranty form,
     * and widening a public payload to serve an admin screen is the wrong way
     * round. A store with no code cannot be issued a serial, since the code is
     * part of the number, so those are filtered out here rather than silently
     * producing a malformed serial.
     */
    static async getStoresForSerials(req: Request, res: Response) {
        try {
            const [stores]: any = await db.execute(`
                SELECT vd.store_code, vd.store_name, vd.city
                  FROM vendor_details vd
                  JOIN vendor_verification vv ON vd.user_id = vv.user_id
                 WHERE vv.is_verified = TRUE
                   AND COALESCE(vv.is_active, TRUE) = TRUE
                   AND vd.store_code IS NOT NULL
                   AND vd.store_code != ''
                 ORDER BY vd.store_name ASC
            `);

            res.json({ success: true, stores });
        } catch (error: any) {
            console.error('Get stores for serials error:', error);
            res.status(500).json({ error: 'Failed to fetch stores' });
        }
    }

    /**
     * Issue serial numbers to a store.
     *
     * The admin picks a store and a quantity; each number is stamped with
     * today's date, the store's code, and a counter that continues from that
     * store's last one. Handing these out with the rolls is what stops a
     * mistyped serial opening a roll that never existed.
     */
    static async generatePPFSerials(req: Request, res: Response) {
        try {
            const { storeCode, quantity } = req.body;
            const code = String(storeCode || '').trim().toUpperCase();
            const count = Number(quantity ?? 1);

            if (!code) {
                return res.status(400).json({ error: 'Please choose a store' });
            }
            if (!Number.isInteger(count) || count < 1 || count > 100) {
                return res.status(400).json({ error: 'Choose between 1 and 100 serial numbers' });
            }

            const [stores]: any = await db.execute(
                'SELECT store_name FROM vendor_details WHERE UPPER(store_code) = ? LIMIT 1',
                [code]
            );
            if (stores.length === 0) {
                return res.status(404).json({ error: 'That store code does not match any franchise' });
            }

            const admin = (req as any).user;
            const issued = await withTransaction((conn) =>
                issueSerials(conn, code, stores[0].store_name || null, count, admin?.email || null)
            );

            await ActivityLogService.log({
                adminId: admin?.id,
                adminName: admin?.name,
                adminEmail: admin?.email,
                actionType: 'PPF_SERIALS_GENERATED',
                targetType: 'PPF_SERIAL',
                targetId: code,
                targetName: stores[0].store_name,
                details: { count, serials: issued.map((s) => s.serialNumber) },
                ipAddress: req.ip || req.socket?.remoteAddress,
            });

            res.json({
                success: true,
                message: `Issued ${issued.length} serial number${issued.length === 1 ? '' : 's'} to ${stores[0].store_name}`,
                serials: issued,
            });
        } catch (error: any) {
            console.error('Generate PPF serials error:', error);
            res.status(500).json({ error: 'Failed to generate serial numbers' });
        }
    }

    /**
     * Where one roll's film went on a given warranty.
     *
     * The ledger records how much area a warranty took from a roll; the
     * warranty itself records which panel it went on. Older PPF records kept a
     * single area for the whole job, which is used when there is no per-roll
     * entry to read.
     */
    private static rollAreaFor(productDetails: any, serial: string): string {
        try {
            const pd = typeof productDetails === 'string'
                ? JSON.parse(productDetails || '{}')
                : (productDetails || {});
            const match = Array.isArray(pd.rolls)
                ? pd.rolls.find((r: any) => String(r?.serial || '').toUpperCase() === serial)
                : null;
            return match?.installArea || pd.installArea || '';
        } catch {
            return '';
        }
    }

    /**
     * What has happened to one warranty, in order.
     *
     * A rejection and the correction answering it are two entries in the
     * activity log, and nothing tied them together on screen. The rejection
     * reason is read from the log rather than the warranty row: resubmitting
     * clears it from the row, correctly, since it no longer applies — so the
     * row is the one place it is guaranteed not to be.
     */
    static async getWarrantyHistory(req: Request, res: Response) {
        try {
            const uid = String(req.params.uid || '').trim();
            if (!uid) return res.status(400).json({ error: 'A warranty id is required' });

            const [rows]: any = await db.execute(
                `SELECT id, admin_name, admin_email, action_type, details, created_at
                   FROM admin_activity_log
                  WHERE target_id = ?
                    AND action_type IN ('WARRANTY_REJECTED', 'WARRANTY_RESUBMITTED',
                                        'WARRANTY_APPROVED', 'WARRANTY_UPDATED',
                                        'WARRANTY_OVERRIDDEN')
                  ORDER BY created_at ASC`,
                [uid]
            );

            const history = rows.map((row: any) => {
                let details: any = {};
                try {
                    details = typeof row.details === 'string'
                        ? JSON.parse(row.details)
                        : (row.details || {});
                } catch { /* an entry written before this shape existed */ }

                return {
                    id: row.id,
                    action: row.action_type,
                    by: row.admin_name || row.admin_email || 'Unknown',
                    at: row.created_at,
                    summary: details.summary || null,
                    // Written as rejection_reason by the reject path and
                    // rejectionReason by the resubmission entry that carries it.
                    rejectionReason: details.rejection_reason || details.rejectionReason || null,
                    changes: details.changes || null,
                };
            });

            res.json({ success: true, uid, history });
        } catch (error: any) {
            console.error('[Warranty History] Failed:', error?.message);
            res.status(500).json({ error: 'Could not load this warranty history' });
        }
    }

    /**
     * Internal remarks on one warranty, oldest first.
     *
     * Admin-only notes for whoever reviews it next. Kept out of
     * warranty_registrations entirely so no customer or vendor query that
     * selects the row can ever carry them out.
     */
    static async getWarrantyRemarks(req: Request, res: Response) {
        try {
            const uid = String(req.params.uid || '').trim();
            if (!uid) return res.status(400).json({ error: 'A warranty id is required' });

            const [rows]: any = await db.execute(
                `SELECT id, admin_id, admin_name, remark, created_at
                   FROM warranty_remarks
                  WHERE warranty_uid = ?
                  ORDER BY created_at ASC, id ASC`,
                [uid]
            );

            res.json({ success: true, remarks: rows });
        } catch (error: any) {
            console.error('[Warranty Remarks] Load failed:', error?.message);
            res.status(500).json({ error: 'Could not load remarks' });
        }
    }

    static async addWarrantyRemark(req: Request, res: Response) {
        try {
            const uid = String(req.params.uid || '').trim();
            const remark = String(req.body?.remark ?? '').trim();
            if (!uid) return res.status(400).json({ error: 'A warranty id is required' });
            if (!remark) return res.status(400).json({ error: 'Remark cannot be empty' });
            if (remark.length > 2000) return res.status(400).json({ error: 'Remark is too long (2000 characters max)' });

            const [warranty]: any = await db.execute(
                'SELECT uid FROM warranty_registrations WHERE uid = ? LIMIT 1',
                [uid]
            );
            if (warranty.length === 0) return res.status(404).json({ error: 'Warranty not found' });

            const admin = (req as any).user;
            const adminName = admin.name || admin.email || null;
            const [result]: any = await db.execute(
                'INSERT INTO warranty_remarks (warranty_uid, admin_id, admin_name, remark) VALUES (?, ?, ?, ?)',
                [uid, admin.id, adminName, remark]
            );

            const [rows]: any = await db.execute(
                'SELECT id, admin_id, admin_name, remark, created_at FROM warranty_remarks WHERE id = ?',
                [result.insertId]
            );

            res.status(201).json({ success: true, remark: rows[0] });
        } catch (error: any) {
            console.error('[Warranty Remarks] Add failed:', error?.message);
            res.status(500).json({ error: 'Could not save remark' });
        }
    }

    /** Only the admin who wrote a remark, or a super admin, can remove it. */
    static async deleteWarrantyRemark(req: Request, res: Response) {
        try {
            const uid = String(req.params.uid || '').trim();
            const remarkId = Number(req.params.remarkId);
            if (!uid || !Number.isInteger(remarkId)) return res.status(400).json({ error: 'Invalid remark' });

            const [rows]: any = await db.execute(
                'SELECT id, admin_id FROM warranty_remarks WHERE id = ? AND warranty_uid = ?',
                [remarkId, uid]
            );
            if (rows.length === 0) return res.status(404).json({ error: 'Remark not found' });

            const admin = (req as any).user;
            if (String(rows[0].admin_id) !== String(admin.id) && !admin.isSuperAdmin) {
                return res.status(403).json({ error: 'You can only delete your own remarks' });
            }

            await db.execute('DELETE FROM warranty_remarks WHERE id = ?', [remarkId]);
            res.json({ success: true });
        } catch (error: any) {
            console.error('[Warranty Remarks] Delete failed:', error?.message);
            res.status(500).json({ error: 'Could not delete remark' });
        }
    }

    /**
     * The roll context for one warranty being reviewed.
     *
     * Nothing pre-registers a PPF roll: the serial the installer types is what
     * creates it, so a typo quietly opens a fresh roll with a full allowance
     * rather than drawing on the real one. The admin approving the registration
     * is the only thing standing between that and the ledger, so the review
     * screen has to say whether each serial has been seen before — a roll that
     * is brand new on a submission is the shape a typo takes.
     */
    static async getWarrantyRollContext(req: Request, res: Response) {
        try {
            const uid = String(req.params.uid || '').trim();
            if (!uid) return res.status(400).json({ error: 'Warranty id is required' });

            const [warranties]: any = await db.execute(
                'SELECT uid, product_details FROM warranty_registrations WHERE uid = ? LIMIT 1',
                [uid]
            );
            if (warranties.length === 0) {
                return res.status(404).json({ error: 'Warranty not found' });
            }

            const capacity = await getRollCapacitySqft();
            const [draws]: any = await db.execute(
                'SELECT roll_serial, sqft_used FROM ppf_roll_consumption WHERE warranty_uid = ?',
                [uid]
            );

            const rolls = [];
            for (const draw of draws) {
                // Everything else this roll has given out, this warranty aside.
                const [others]: any = await db.execute(
                    `SELECT COALESCE(SUM(c.sqft_used), 0) AS used,
                            COUNT(*) AS draws
                       FROM ppf_roll_consumption c
                       JOIN warranty_registrations w ON w.uid = c.warranty_uid
                      WHERE c.roll_serial = ?
                        AND c.warranty_uid != ?
                        AND w.status != 'rejected'`,
                    [draw.roll_serial, uid]
                );

                const usedElsewhere = Number(others[0]?.used ?? 0);
                const drawsElsewhere = Number(others[0]?.draws ?? 0);
                const thisDraw = Number(draw.sqft_used);

                rolls.push({
                    serialNumber: draw.roll_serial,
                    sqftUsed: thisDraw,
                    installArea: AdminController.rollAreaFor(warranties[0].product_details, draw.roll_serial),
                    // No other registration has ever drawn on this serial. Either
                    // a genuinely new roll or a mistyped one, and only the person
                    // holding the roll can tell which.
                    isFirstUse: drawsElsewhere === 0,
                    otherDraws: drawsElsewhere,
                    usedElsewhere,
                    remainingSqft: Math.max(0, capacity - usedElsewhere - thisDraw),
                });
            }

            res.json({ success: true, capacity, rolls });
        } catch (error: any) {
            console.error('Get warranty roll context error:', error);
            res.status(500).json({ error: 'Failed to fetch roll context' });
        }
    }

    /** The individual registrations a single roll's film went to. */
    static async getPPFRollDetail(req: Request, res: Response) {
        try {
            const serial = String(req.params.serial || '').trim().toUpperCase();
            if (!serial) {
                return res.status(400).json({ error: 'Serial number is required' });
            }

            const capacity = await getRollCapacitySqft();

            const [rows]: any = await db.execute(
                `SELECT c.warranty_uid,
                        c.sqft_used,
                        c.created_at,
                        w.status,
                        w.customer_name,
                        w.registration_number,
                        w.installer_name,
                        w.purchase_date,
                        w.product_details
                   FROM ppf_roll_consumption c
                   LEFT JOIN warranty_registrations w ON w.uid = c.warranty_uid
                  WHERE c.roll_serial = ?
                  ORDER BY c.created_at ASC`,
                [serial]
            );

            // A rejected draw is listed but does not count against the roll, the
            // same rule the availability check applies when a roll is used again.
            const used = rows
                .filter((row: any) => row.status !== 'rejected')
                .reduce((total: number, row: any) => total + Number(row.sqft_used), 0);

            res.json({
                success: true,
                serialNumber: serial,
                capacity,
                usedSqft: used,
                remainingSqft: Math.max(0, capacity - used),
                draws: rows.map((row: any) => ({
                    warrantyUid: row.warranty_uid,
                    sqftUsed: Number(row.sqft_used),
                    createdAt: row.created_at,
                    status: row.status,
                    customerName: row.customer_name,
                    registrationNumber: row.registration_number,
                    installerName: row.installer_name,
                    purchaseDate: row.purchase_date,
                    countsAgainstRoll: row.status !== 'rejected',
                    // Which panel this roll's film went on, read back out of the
                    // warranty: the ledger records how much was taken, the
                    // warranty records where it went.
                    installArea: AdminController.rollAreaFor(row.product_details, serial),
                })),
            });
        } catch (error: any) {
            console.error('Get PPF roll detail error:', error);
            res.status(500).json({ error: 'Failed to fetch roll detail' });
        }
    }
}

