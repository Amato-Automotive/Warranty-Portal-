import { withEmailBrand } from '../services/emailBrand.js';
import { brandOfEmail, brandOfStore, brandOfUser, brandOfWarranty } from '../services/storeBrand.js';
import { Request, Response } from 'express';
import db, { getISTTimestamp } from '../config/database.js';
import { AuthRequest } from '../middleware/auth.js';
import { EmailService } from '../services/email.service.js';
import { NotificationService } from '../services/notification.service.js';
import { asmStore, asmOfProfile } from '../services/asmStores.js';
import { ActivityLogService } from '../services/activity-log.service.js';
import { resolveCategoryAssignee } from './grievanceCategory.controller.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Grievance Controller
 * Handles customer grievances/complaints
 */
class GrievanceController {

    /**
     * Category prefix map for ticket IDs
     */
    private readonly CATEGORY_PREFIXES: Record<string, string> = {
        'seat_cover': 'SC',
        'mats': 'MT',
        'accessories': 'AC',
        'software_issue': 'SW',
        'other': 'OT',
    };

    /**
     * Generate unique, sequential, category-scoped ticket ID
     * Format: GR-{PREFIX}-{6-digit padded number}
     * e.g.  GR-SC-000001, GR-MT-000042
     */
    private async generateTicketId(category: string): Promise<string> {
        const prefix = this.CATEGORY_PREFIXES[category] || 'OT';
        const likePattern = `GR-${prefix}-%`;

        // Find the highest existing number for this prefix
        const [rows]: any = await db.execute(
            `SELECT ticket_id FROM grievances
             WHERE ticket_id LIKE ?
             ORDER BY ticket_id DESC
             LIMIT 1`,
            [likePattern]
        );

        let nextNumber = 1;
        if (rows.length > 0) {
            // Extract the numeric part after the last dash
            const lastId: string = rows[0].ticket_id; // e.g. 'GR-SC-000042'
            const parts = lastId.split('-');
            const lastNum = parseInt(parts[parts.length - 1], 10);
            if (!isNaN(lastNum)) nextNumber = lastNum + 1;
        }

        const padded = String(nextNumber).padStart(6, '0');
        return `GR-${prefix}-${padded}`;
    }

    /**
     * Resolve the vendor_details.id for the authenticated vendor user.
     * Grievance ownership for franchise-facing tickets is scoped by this ID.
     */
    private async getVendorFranchiseId(userId: string): Promise<string | null> {
        const [vendorRows]: any = await db.execute(
            'SELECT id FROM vendor_details WHERE user_id = ? LIMIT 1',
            [userId]
        );

        return vendorRows.length > 0 ? vendorRows[0].id : null;
    }

    /**
     * Enforce object-level authorization for grievance reads/writes.
     * - Admins can access all grievances
     * - Customers can access only their own grievances
     * - Vendors can access grievances assigned to their franchise, plus grievances
     *   they personally submitted through the franchise grievance flow
     */
    private async authorizeGrievanceAccess(req: AuthRequest, grievanceId: string): Promise<{
        authorized: boolean;
        grievance?: any;
        reason?: 'not_found' | 'forbidden';
    }> {
        const user = req.user;
        if (!user?.id || !user.role) {
            return { authorized: false, reason: 'forbidden' };
        }

        const [rows]: any = await db.execute(
            `SELECT id, ticket_id, customer_id, franchise_id, source_type
             FROM grievances
             WHERE id = ?`,
            [grievanceId]
        );

        if (!rows || rows.length === 0) {
            return { authorized: false, reason: 'not_found' };
        }

        const grievance = rows[0];

        if (user.role === 'admin') {
            return { authorized: true, grievance };
        }

        if (user.role === 'customer') {
            return grievance.customer_id === user.id
                ? { authorized: true, grievance }
                : { authorized: false, reason: 'forbidden' };
        }

        // An ASM reaches both kinds of grievance of the stores under them:
        // customers' complaints about the store and the ones the store raised.
        // Anything else reads as missing.
        if (user.role === 'asm') {
            const ofStore = (await asmStore(user.id, grievance.franchise_id ?? ''))
                || (grievance.source_type === 'franchise' && await asmStore(user.id, grievance.customer_id ?? ''));
            return ofStore ? { authorized: true, grievance } : { authorized: false, reason: 'not_found' };
        }

        if (user.role === 'vendor') {
            const franchiseId = await this.getVendorFranchiseId(user.id);

            if (!franchiseId) {
                return { authorized: false, reason: 'forbidden' };
            }

            const isAssignedToVendorFranchise = grievance.franchise_id === franchiseId;
            const isOwnFranchiseSubmission =
                grievance.source_type === 'franchise' && grievance.customer_id === user.id;

            if (isAssignedToVendorFranchise || isOwnFranchiseSubmission) {
                return { authorized: true, grievance };
            }
        }

        return { authorized: false, reason: 'forbidden' };
    }

    /**
     * Get remarks history for a grievance
     * GET /api/grievance/:id/remarks
     */
    getRemarks = async (req: AuthRequest, res: Response) => {
        try {
            const { id } = req.params;
            const access = await this.authorizeGrievanceAccess(req, id);

            if (!access.authorized) {
                return res.status(access.reason === 'not_found' ? 404 : 403).json({
                    success: false,
                    error: access.reason === 'not_found' ? 'Grievance not found' : 'Access denied'
                });
            }

            const [remarks] = await db.execute(
                'SELECT * FROM grievance_remarks WHERE grievance_id = ? ORDER BY created_at ASC',
                [id]
            );

            return res.json({ success: true, data: remarks });
        } catch (error: any) {
            console.error('Get remarks error:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch remarks history' });
        }
    }

    /**
     * Submit a new grievance (Customer only)
     * POST /api/grievance
     */
    submitGrievance = async (req: AuthRequest, res: Response) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }

            const {
                franchiseId,
                warrantyUid,
                category,
                subCategory,
                subject,
                description
            } = req.body;

            // Get uploaded files from multer (Cloudinary)
            const uploadedFiles = req.files as Express.Multer.File[];
            const attachmentUrls = uploadedFiles?.map((file: any) => file.path || file.secure_url || file.url) || [];

            // Validate required fields
            if (!category || !subject || !description) {
                return res.status(400).json({
                    success: false,
                    error: 'Category, subject, and description are required'
                });
            }

            // Check if attachment is required for this category
            const attachmentRequiredCategories = ['product_issue', 'billing_issue'];
            if (attachmentRequiredCategories.includes(category)) {
                if (!uploadedFiles || uploadedFiles.length === 0) {
                    return res.status(400).json({
                        success: false,
                        error: 'Attachment is required for product or billing issues'
                    });
                }
            }

            const ticketId = await this.generateTicketId(category || 'other');



            const [result] = await db.execute(
                `INSERT INTO grievances 
         (ticket_id, customer_id, franchise_id, warranty_uid, category, sub_category, subject, description, attachments, source_type, created_by_role, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'customer', 'customer', ?)`,
                [
                    ticketId,
                    userId,
                    franchiseId || null,
                    warrantyUid || null,
                    category,
                    subCategory || null,
                    subject,
                    description,
                    JSON.stringify(attachmentUrls),
                    userId
                ]
            );

            // Send confirmation email
            try {
                // Fetch customer details
                const [userRows]: any = await db.execute('SELECT name, email FROM profiles WHERE id = ?', [userId]);
                const customerName = userRows[0]?.name || 'Customer';
                const customerEmail = userRows[0]?.email || req.user?.email;

                // Fetch store name if franchiseId is present
                let storeName: string | undefined;
                if (franchiseId) {
                    const [storeRows]: any = await db.execute('SELECT store_name FROM vendor_details WHERE id = ?', [franchiseId]);
                    storeName = storeRows[0]?.store_name;
                }

                // Send email asynchronously
                withEmailBrand(brandOfStore(franchiseId), () => EmailService.sendGrievanceConfirmationEmail(
                    customerEmail,
                    customerName,
                    {
                        ticket_id: ticketId,
                        category,
                        subject,
                        description,
                        store_name: storeName,
                        created_at: getISTTimestamp()
                    }
                )).catch((err: any) => console.error('Failed to send grievance confirmation email:', err));

            } catch (emailError) {
                console.error('Error preparing grievance email:', emailError);
                // Don't fail the request if email fails
            }



            // Notifications
            try {
                // 1. Notify Admins
                await NotificationService.broadcast({
                    title: `New Grievance: ${ticketId}`,
                    message: `A new grievance has been submitted by a customer. Subject: ${subject}`,
                    type: 'warranty',
                    link: `/admin/grievances/${ticketId}`,
                    targetRole: 'admin'
                });

                // 2. Notify Franchise if applicable
                if (franchiseId) {
                    // Find user_id for this franchise
                    const [vendorRows]: any = await db.execute(
                        'SELECT user_id FROM vendor_details WHERE id = ?',
                        [franchiseId]
                    );
                    if (vendorRows.length > 0) {
                        await NotificationService.notify(vendorRows[0].user_id, {
                            title: `New Grievance Assigned: ${ticketId}`,
                            message: `A customer has registered a grievance against your store. Details: ${subject}`,
                            type: 'warranty',
                            link: `/dashboard/vendor`
                        });
                    }
                }
            } catch (notifError) {
                console.error('Failed to send grievance submission notifications:', notifError);
            }

            return res.status(201).json({
                success: true,
                message: 'Grievance submitted successfully',
                data: { ticketId }
            });

        } catch (error: any) {
            console.error('Submit grievance error:', error.message, error.code, error.sqlMessage);
            return res.status(500).json({
                success: false,
                error: 'Failed to submit grievance. An internal error occurred.'
            });
        }
    }

    /**
     * Get customer's grievances
     * GET /api/grievance
     */
    getMyGrievances = async (req: AuthRequest, res: Response) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }

            const [grievances] = await db.execute(
                `SELECT g.*, vd.store_name as franchise_name
         FROM grievances g
         LEFT JOIN vendor_details vd ON g.franchise_id = vd.id
         WHERE g.customer_id = ?
         ORDER BY g.created_at DESC`,
                [userId]
            );

            // Sanitization: Remove admin_notes
            const sanitizedGrievances = (grievances as any[]).map(g => {
                const { admin_notes, ...rest } = g;
                return rest;
            });

            return res.json({ success: true, data: sanitizedGrievances });

        } catch (error: any) {
            console.error('Get grievances error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch grievances'
            });
        }
    }

    /**
     * Submit a new grievance (Franchise/Vendor, or an admin on their behalf)
     * POST /api/grievance/franchise
     *
     * An admin may pass franchiseId to file on a store's behalf, for grievances
     * that arrive by phone or email. Everything downstream — auto-assignment,
     * emails, the assignment record — is deliberately shared with the
     * self-raised path so both kinds of ticket behave identically.
     */
    submitFranchiseGrievance = async (req: AuthRequest, res: Response) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }

            const { department, departmentDetails, category, subject, description, franchiseId } = req.body;

            // Only an admin or the store's ASM may name a store; a vendor
            // session is always scoped to its own, so it can never target
            // another one. An ASM is held to their own stores below.
            const actingAsAdmin = req.user?.role === 'admin';
            const actingAsAsm = req.user?.role === 'asm';
            const onBehalf = actingAsAdmin || actingAsAsm;
            if (franchiseId && !onBehalf) {
                return res.status(403).json({ success: false, error: 'Access denied.' });
            }
            if (onBehalf && !franchiseId) {
                return res.status(400).json({ success: false, error: 'Choose the franchise this grievance is for' });
            }
            const asmOwn = actingAsAsm ? await asmStore(userId, String(franchiseId)) : null;
            if (actingAsAsm && !asmOwn) {
                return res.status(404).json({ success: false, error: 'Store not found' });
            }

            // Get uploaded files from multer (Cloudinary)
            const uploadedFiles = req.files as Express.Multer.File[];
            const attachmentUrls = uploadedFiles?.map((file: any) => file.path || file.secure_url || file.url) || [];

            // Validation
            if (!category || !subject || !description) {
                return res.status(400).json({
                    success: false,
                    error: 'Category, subject, and description are required'
                });
            }

            // Optional: Department validation (if provided)
            const validDepartments = ['plant', 'distributor', 'asm'];
            if (department && !validDepartments.includes(department.toLowerCase())) {
                // We'll still allow it but maybe clean it up or just accept what comes
            }

            // No longer forcing details

            // Get franchise details. For an admin the store is named explicitly,
            // and either id space is accepted since the admin vendor list returns
            // profiles.id while vendor_details has its own id.
            const [vendorRows]: any = onBehalf
                ? await db.execute(
                    'SELECT id, store_name, store_email as email, user_id FROM vendor_details WHERE id = ? OR user_id = ? LIMIT 1',
                    [asmOwn ? asmOwn.id : franchiseId, asmOwn ? asmOwn.id : franchiseId]
                )
                : await db.execute(
                    'SELECT id, store_name, store_email as email, user_id FROM vendor_details WHERE user_id = ?',
                    [userId]
                );

            if (vendorRows.length === 0) {
                return res.status(403).json({
                    success: false,
                    error: 'Franchise account not found'
                });
            }

            const vendor = vendorRows[0];
            const ticketId = await this.generateTicketId(category);

            // Auto-Assignment Mapping
            // Who receives this comes from grievance_categories, so an admin can
            // change the desk without a deploy. Falls back to "other".
            const assignee = await resolveCategoryAssignee(category);

            // Insert grievance
            const [insertResult]: any = await db.execute(
                `INSERT INTO grievances 
                (ticket_id, customer_id, source_type, created_by_role, created_by, department, department_details, category, subject, description, attachments, status, created_at, status_updated_at, assigned_to)
                VALUES (?, ?, 'franchise', ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?, ?)`,
                [
                    ticketId,
                    onBehalf ? (vendor.user_id || userId) : userId,
                    actingAsAdmin ? 'admin' : actingAsAsm ? 'asm' : 'franchise',
                    userId,
                    department ? department.toLowerCase() : null,
                    departmentDetails || null,
                    category,
                    subject,
                    description,
                    JSON.stringify(attachmentUrls),
                    getISTTimestamp(),
                    getISTTimestamp(),
                    assignee.name
                ]
            );

            const newGrievanceId = insertResult.insertId;

            // Create Initial grievance assignment record
            const updateToken = uuidv4();
            await db.execute(
                `INSERT INTO grievance_assignments 
                 -- sent_by holds a user id (varchar UUID); an auto-assignment has no
                 -- acting user, so it is NULL and sent_by_name carries the label.
                 (grievance_id, assignee_name, assignee_email, remarks, assignment_type, sent_by, sent_by_name, status, update_token, email_sent_at)
                 VALUES (?, ?, ?, ?, 'initial', NULL, 'System Auto-Assign', 'pending', ?, ?)`,
                [newGrievanceId, assignee.name, assignee.email, 'Auto-assigned based on category', updateToken, getISTTimestamp()]
            );

            // Send Email to Assignee with Magic Link
            try {
                // Fetch the grievance we just created with relationships needed for the email
                const [gRows]: any = await db.execute(
                    `SELECT g.*,
                     p.name as customer_name,
                     p.email as customer_email,
                     vd.store_name as franchise_name,
                     vd.address as franchise_address,
                     vd.city as franchise_city
                     FROM grievances g
                     LEFT JOIN profiles p ON g.customer_id = p.id
                     LEFT JOIN vendor_details vd ON g.customer_id = vd.user_id
                     WHERE g.id = ?`,
                    [newGrievanceId]
                );

                if (gRows.length > 0) {
                    const gData = gRows[0];
                    await EmailService.sendGrievanceAssignmentEmail(
                        assignee.email,
                        assignee.name,
                        {
                            ticket_id: gData.ticket_id,
                            category: gData.category,
                            sub_category: gData.sub_category,
                            subject: gData.subject,
                            description: gData.description,
                            source_type: gData.source_type,
                            department: gData.department,
                            department_details: gData.department_details,
                            customer_name: gData.customer_name,
                            customer_email: gData.customer_email,
                            franchise_name: gData.franchise_name,
                            franchise_address: gData.franchise_address,
                            franchise_city: gData.franchise_city,
                            attachments: gData.attachments,
                            created_at: gData.created_at,
                            estimated_completion_date: undefined
                        },
                        'Auto-assigned based on category',
                        updateToken
                    );
                }
            } catch (assignNotifErr) {
                console.error('Failed to send auto-assignment email:', assignNotifErr);
            }

            // Notify admins — unless an admin raised it on the store's behalf.
            //
            // This used to INSERT with type 'warning', which is not in the live
            // notifications.type ENUM; under STRICT_TRANS_TABLES every insert
            // failed into the catch below, so no admin was ever told about a
            // franchise grievance. It also bypassed the socket. 'warranty' is
            // what the customer-grievance path uses.
            if (actingAsAsm && vendor.user_id) {
                try {
                    await NotificationService.notify(vendor.user_id, {
                        title: `Grievance ${ticketId} raised for you`,
                        message: `${asmOwn!.asm_name} (your ASM) raised it: ${String(subject).slice(0, 140)}`,
                        type: 'warranty',
                    });
                } catch (notifError) {
                    console.error('Failed to tell the store about its ASM grievance:', notifError);
                }
            }
            if (!actingAsAdmin) {
                try {
                    await NotificationService.broadcast({
                        title: `🏪 Franchise Grievance: ${ticketId}`,
                        message: actingAsAsm
                            ? `${asmOwn!.asm_name} (ASM) raised a grievance for "${vendor.store_name}". Subject: ${subject}`
                            : `Franchise "${vendor.store_name}" submitted a grievance to ${department}. Subject: ${subject}`,
                        type: 'warranty',
                        link: `/admin/grievances/${ticketId}`,
                        targetRole: 'admin'
                    });
                } catch (notifError) {
                    console.error('Failed to send franchise grievance notification:', notifError);
                }
            }

            // Send confirmation email to franchise
            try {
                await withEmailBrand(brandOfEmail(vendor.email), () => EmailService.sendFranchiseGrievanceConfirmationEmail(
                    vendor.email,
                    vendor.store_name,
                    {
                        ticket_id: ticketId,
                        category,
                        subject,
                        department,
                        department_details: departmentDetails
                    }
                ));
            } catch (emailError) {
                console.error('Failed to send franchise grievance confirmation email:', emailError);
            }

            if (actingAsAsm) {
                await ActivityLogService.log({
                    adminId: userId, adminName: asmOwn!.asm_name, adminEmail: req.user?.email,
                    actionType: 'CREATE_GRIEVANCE_BY_ASM', targetType: 'GRIEVANCE', targetId: String(newGrievanceId),
                    targetName: vendor.store_name, details: { ticketId, franchiseId: vendor.id, category },
                    ipAddress: req.ip || req.socket?.remoteAddress,
                });
            }

            return res.status(201).json({
                success: true,
                message: onBehalf ? `Grievance raised for ${vendor.store_name}` : 'Grievance submitted successfully',
                data: { ticketId }
            });

        } catch (error: any) {
            console.error('Submit franchise grievance error:', error.message, error.code, error.sqlMessage);
            return res.status(500).json({
                success: false,
                error: 'Failed to submit grievance. An internal error occurred.'
            });
        }
    }

    /**
     * Get franchise's submitted grievances
     * GET /api/grievance/franchise/submitted
     */
    getFranchiseSubmittedGrievances = async (req: AuthRequest, res: Response) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }

            // Pagination parameters
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 30;
            const offset = (page - 1) * limit;

            // Get total count
            const [countResult]: any = await db.execute(
                'SELECT COUNT(*) as total FROM grievances WHERE customer_id = ? AND source_type = "franchise"',
                [userId]
            );
            const totalCount = countResult[0].total;
            const totalPages = Math.ceil(totalCount / limit);

            const [grievances] = await db.execute(
                `SELECT g.*, 
                    CASE 
                        WHEN g.department = 'plant' THEN 'Plant'
                        WHEN g.department = 'distributor' THEN CONCAT('Distributor: ', COALESCE(g.department_details, 'N/A'))
                        WHEN g.department = 'asm' THEN CONCAT('ASM: ', COALESCE(g.department_details, 'N/A'))
                        ELSE g.department
                    END as department_display,
                    creator.name as created_by_name
                FROM grievances g
                LEFT JOIN profiles creator ON creator.id = g.created_by
                WHERE g.customer_id = ? AND g.source_type = 'franchise'
                ORDER BY g.created_at DESC
                LIMIT ? OFFSET ?`,
                [userId, limit, offset]
            );

            return res.json({
                success: true,
                data: grievances,
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
            console.error('Get franchise submitted grievances error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch submitted grievances'
            });
        }
    }

    /**
     * Get grievances for a franchise (Vendor)
     * GET /api/grievance/vendor
     */
    getVendorGrievances = async (req: AuthRequest, res: Response) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }

            // Get vendor's franchise ID
            const [vendorRows]: any = await db.execute(
                'SELECT id FROM vendor_details WHERE user_id = ?',
                [userId]
            );

            if (!vendorRows || vendorRows.length === 0) {
                return res.status(404).json({ success: false, error: 'Vendor not found' });
            }

            const franchiseId = vendorRows[0].id;

            // Pagination parameters
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 30;
            const offset = (page - 1) * limit;

            // Get total count
            const [countResult]: any = await db.execute(
                'SELECT COUNT(*) as total FROM grievances WHERE franchise_id = ?',
                [franchiseId]
            );
            const totalCount = countResult[0].total;
            const totalPages = Math.ceil(totalCount / limit);

            const [grievances] = await db.execute(
                `SELECT g.*, p.name as customer_name, p.email as customer_email, p.phone_number as customer_phone
         FROM grievances g
         LEFT JOIN profiles p ON g.customer_id = p.id
         WHERE g.franchise_id = ?
         ORDER BY g.created_at DESC
         LIMIT ? OFFSET ?`,
                [franchiseId, limit, offset]
            );

            // Sanitization: Remove admin_notes
            const sanitizedGrievances = (grievances as any[]).map(g => {
                const { admin_notes, ...rest } = g;
                rest.attachments = typeof g.attachments === 'string' ? JSON.parse(g.attachments) : g.attachments;
                return rest;
            });

            return res.json({
                success: true,
                data: sanitizedGrievances,
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
            console.error('Get vendor grievances error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch grievances'
            });
        }
    }

    /**
     * Get all grievances (Admin)
     * GET /api/grievance/admin
     */
    getAllGrievances = async (req: AuthRequest, res: Response) => {
        try {
            const userRole = req.user?.role;
            if (userRole !== 'admin') {
                return res.status(403).json({ success: false, error: 'Admin access required' });
            }

            const [grievances] = await db.execute(
                `SELECT g.*, 
                CASE 
                    WHEN g.source_type = 'franchise' THEN vd_franchise.store_name
                    ELSE p.name 
                END as customer_name,
                
                CASE 
                    WHEN g.source_type = 'franchise' THEN vd_franchise.store_email
                    ELSE p.email 
                END as customer_email,

                CASE 
                    WHEN g.source_type = 'franchise' THEN 
                        CASE 
                            WHEN g.department IS NOT NULL AND g.department != '' THEN
                                CONCAT(UPPER(g.department), COALESCE(CONCAT(' - ', g.department_details), ''))
                            ELSE
                                'Head Office'
                        END
                    ELSE vd_customer.store_name 
                END as franchise_name,
                
                COALESCE(vd_customer.address, vd_franchise.address) as franchise_address,
                COALESCE(vd_customer.city, vd_franchise.city) as franchise_city,
                creator.name as created_by_name
         FROM grievances g
         LEFT JOIN profiles p ON g.customer_id = p.id
         LEFT JOIN profiles creator ON creator.id = g.created_by
         LEFT JOIN vendor_details vd_customer ON g.franchise_id = vd_customer.id
         LEFT JOIN vendor_details vd_franchise ON g.source_type = 'franchise' AND g.customer_id = vd_franchise.user_id
         ORDER BY 
            g.updated_at DESC,
            CASE g.priority 
              WHEN 'urgent' THEN 1 
              WHEN 'high' THEN 2 
              ELSE 3 
            END,
            g.created_at DESC`
            );

            return res.json({ success: true, data: grievances });

        } catch (error: any) {
            console.error('Get all grievances error:', error.message, error.code, error.sqlMessage);
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch grievances. An internal error occurred.'
            });
        }
    }

    /**
     * Get single grievance by ID
     * GET /api/grievance/:id
     */
    getGrievanceById = async (req: AuthRequest, res: Response) => {
        try {
            const { id } = req.params;
            const userRole = req.user?.role;
            const access = await this.authorizeGrievanceAccess(req, id);

            if (!access.authorized) {
                return res.status(access.reason === 'not_found' ? 404 : 403).json({
                    success: false,
                    error: access.reason === 'not_found' ? 'Grievance not found' : 'Access denied'
                });
            }

            const [rows]: any = await db.execute(
                `SELECT g.*, 
                p.name as customer_name, 
                p.email as customer_email,
                p.phone_number as customer_phone,
                vd.store_name as franchise_name,
                vd.address as franchise_address,
                vd.city as franchise_city,
                creator.name as created_by_name
         FROM grievances g
         LEFT JOIN profiles p ON g.customer_id = p.id
         LEFT JOIN vendor_details vd ON g.franchise_id = vd.id
         LEFT JOIN profiles creator ON creator.id = g.created_by
         WHERE g.id = ?`,
                [id]
            );

            const grievance = rows[0];

            // Sanitization: Remove admin_notes if not admin
            if (userRole !== 'admin') {
                delete grievance.admin_notes;
            }

            return res.json({ success: true, data: grievance });

        } catch (error: any) {
            console.error('Get grievance by ID error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch grievance'
            });
        }
    }

    /**
     * Assign grievance to someone (Admin only)
     * PUT /api/grievance/:id/assign
     */
    assignGrievance = async (req: AuthRequest, res: Response) => {
        try {
            const { id } = req.params;
            const { assignedTo } = req.body;
            const userRole = req.user?.role;

            if (userRole !== 'admin') {
                return res.status(403).json({ success: false, error: 'Access denied' });
            }

            await db.execute(
                'UPDATE grievances SET assigned_to = ? WHERE id = ?',
                [assignedTo || null, id]
            );

            // Fetch ticket_id for logging
            const [gRows]: any = await db.execute('SELECT ticket_id FROM grievances WHERE id = ?', [id]);
            const ticketId = gRows[0]?.ticket_id || id;

            // Log activity
            const admin = req.user!;
            await ActivityLogService.log({
                adminId: admin.id,
                adminName: admin.name || 'Admin',
                adminEmail: admin.email,
                actionType: 'GRIEVANCE_ASSIGNED',
                targetType: 'GRIEVANCE',
                targetId: id,
                targetName: ticketId,
                details: { assignedTo },
                ipAddress: req.ip || req.socket?.remoteAddress
            });

            return res.json({ success: true, message: 'Grievance assigned successfully' });

        } catch (error: any) {
            console.error('Assign grievance error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to assign grievance'
            });
        }
    }

    /**
     * Update grievance status (Vendor/Admin)
     * PUT /api/grievance/:id/status
     */
    updateStatus = async (req: AuthRequest, res: Response) => {
        try {
            const { id } = req.params;
            const { status, priority } = req.body;
            const userRole = req.user?.role;

            if (!['vendor', 'admin'].includes(userRole || '')) {
                return res.status(403).json({ success: false, error: 'Access denied' });
            }

            const access = await this.authorizeGrievanceAccess(req, id);
            if (!access.authorized) {
                return res.status(access.reason === 'not_found' ? 404 : 403).json({
                    success: false,
                    error: access.reason === 'not_found' ? 'Grievance not found' : 'Access denied'
                });
            }

            const validStatuses = ['submitted', 'under_review', 'in_progress', 'resolved', 'rejected'];
            if (status && !validStatuses.includes(status)) {
                return res.status(400).json({ success: false, error: 'Invalid status' });
            }

            const updates: string[] = [];
            const values: any[] = [];

            if (status) {
                updates.push('status = ?');
                values.push(status);

                if (status === 'resolved' || status === 'rejected') {
                    updates.push('resolved_at = ?');
                    values.push(getISTTimestamp());
                }
            }

            if (priority) {
                updates.push('priority = ?');
                values.push(priority);
            }

            if (updates.length === 0) {
                return res.status(400).json({ success: false, error: 'No updates provided' });
            }

            values.push(id);

            await db.execute(
                `UPDATE grievances SET ${updates.join(', ')} WHERE id = ?`,
                values
            );

            // Notify User (Franchise/Customer) about status update
            let ticketId = access.grievance.ticket_id || id;
            try {
                const grievance = access.grievance;
                await NotificationService.notify(grievance.customer_id, {
                    title: `Grievance Updated: ${grievance.ticket_id}`,
                    message: `Status changed to ${status}. Details available in portal.`,
                    type: 'warranty',
                    link: `/grievance/view/${id}`
                });
                await NotificationService.broadcast({
                    title: `Grievance ${grievance.ticket_id} Status Updated`,
                    message: `Grievance ${grievance.ticket_id} status changed to ${status}.`,
                    type: 'warranty',
                    link: `/admin/grievances/${grievance.ticket_id}?id=${id}`,
                    targetUsers: [],
                    targetRole: 'admin'
                });
            } catch (e) {
                console.error("Failed to notify user of grievance update", e);
            }

            // Log activity if admin
            if (userRole === 'admin') {
                const admin = req.user!;
                await ActivityLogService.log({
                    adminId: admin.id,
                    adminName: admin.name || 'Admin', // Fallback if name missing (shouldn't be now)
                    adminEmail: admin.email,
                    actionType: 'GRIEVANCE_STATUS_UPDATED',
                    targetType: 'GRIEVANCE',
                    targetId: id,
                    targetName: ticketId, // Use fetched ticketId
                    details: {
                        newStatus: status,
                        newPriority: priority
                    },
                    ipAddress: req.ip || req.socket?.remoteAddress
                });
            }

            return res.json({ success: true, message: 'Status updated successfully' });

        } catch (error: any) {
            console.error('Update status error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to update status'
            });
        }
    }

    /**
     * Add remarks (Vendor/Admin)
     * PUT /api/grievance/:id/remarks
     */
    addRemarks = async (req: AuthRequest, res: Response) => {
        try {
            const { id } = req.params;
            const { remarks } = req.body;
            const userRole = req.user?.role;

            if (!remarks) {
                return res.status(400).json({ success: false, error: 'Remarks are required' });
            }

            const access = await this.authorizeGrievanceAccess(req, id);
            if (!access.authorized) {
                return res.status(access.reason === 'not_found' ? 404 : 403).json({
                    success: false,
                    error: access.reason === 'not_found' ? 'Grievance not found' : 'Access denied'
                });
            }

            if (userRole === 'asm') {
                return this.addAsmRemark(req, res, access.grievance, String(remarks));
            }

            let field: string;
            if (userRole === 'admin') {
                field = 'admin_remarks';
            } else if (userRole === 'vendor') {
                field = 'franchise_remarks';
            } else {
                return res.status(403).json({ success: false, error: 'Access denied' });
            }

            await db.execute(
                `UPDATE grievances SET ${field} = ? WHERE id = ?`,
                [remarks, id]
            );

            // Add to remarks history
            try {
                let userName = userRole === 'admin' ? 'Administrator' : 'Franchise';
                const userId = req.user?.id || 'unknown';

                if (userRole === 'vendor') {
                    const [vendorRows]: any = await db.execute(
                        'SELECT store_name FROM vendor_details WHERE user_id = ?',
                        [userId]
                    );
                    if (vendorRows.length > 0) {
                        userName = vendorRows[0].store_name;
                    }
                }

                await db.execute(
                    `INSERT INTO grievance_remarks (grievance_id, added_by, added_by_name, added_by_id, remark)
                     VALUES (?, ?, ?, ?, ?)`,
                    [id, userRole === 'admin' ? 'admin' : 'franchise', userName, userId, remarks]
                );
            } catch (historyError) {
                console.error('Failed to log remark history:', historyError);
                // Continue as the main update succeeded
            }

            // Notify Customer about new remarks
            let ticketId = access.grievance.ticket_id || id;
            try {
                const grievance = access.grievance;
                await NotificationService.notify(grievance.customer_id, {
                    title: `Update on Grievance: ${grievance.ticket_id}`,
                    message: `${userRole === 'admin' ? 'Admin' : 'Franchise'} has added remarks to your ticket.`,
                    type: 'warranty',
                    link: `/grievance/view/${id}`
                });
            } catch (notifError) {
                console.error('Failed to notify customer of remarks:', notifError);
            }

            // Log activity if admin
            if (userRole === 'admin') {
                const admin = req.user!;
                await ActivityLogService.log({
                    adminId: admin.id,
                    adminName: admin.name || 'Admin',
                    adminEmail: admin.email,
                    actionType: 'GRIEVANCE_REMARK_ADDED',
                    targetType: 'GRIEVANCE',
                    targetId: id,
                    targetName: ticketId,
                    details: { remarks },
                    ipAddress: req.ip || req.socket?.remoteAddress
                });
            }

            return res.json({ success: true, message: 'Remarks added successfully' });

        } catch (error: any) {
            console.error('Add remarks error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to add remarks'
            });
        }
    }

    /**
     * An ASM's reply on a grievance their store raised. Kept in the remarks
     * history under the ASM's own name; the store's and head office's latest
     * remarks (franchise_remarks / admin_remarks) are theirs and stay as they
     * are. Not on a customer's complaint: that reply would reach the customer
     * as if from the store, so the store answers its own customers.
     */
    private async addAsmRemark(req: AuthRequest, res: Response, grievance: any, remark: string) {
        if (grievance.source_type !== 'franchise') {
            return res.status(403).json({ success: false, error: "Only the store can reply on a customer's complaint" });
        }
        const text = remark.trim().slice(0, 2000);
        if (!text) return res.status(400).json({ success: false, error: 'Remarks are required' });
        const asm = await asmOfProfile(req.user!.id);
        if (!asm) return res.status(403).json({ success: false, error: 'Your ASM account was not found' });

        await db.execute(
            `INSERT INTO grievance_remarks (grievance_id, added_by, added_by_name, added_by_id, remark)
             VALUES (?, 'asm', ?, ?, ?)`,
            [grievance.id, asm.name, req.user!.id, text]
        );
        try {
            // customer_id on a store-raised grievance is the store's own login.
            await NotificationService.notify(grievance.customer_id, {
                title: `Update on Grievance: ${grievance.ticket_id}`,
                message: `${asm.name} (your ASM) added a remark to your ticket.`,
                type: 'warranty',
                link: `/grievance/view/${grievance.id}`
            });
        } catch (notifError) {
            console.error('Failed to notify the store of the ASM remark:', notifError);
        }
        return res.json({ success: true, message: 'Remark added' });
    }

    /**
     * Admin update (Status, Remarks, Internal Notes)
     * PUT /api/grievance/:id/admin-update
     */
    adminUpdateGrievance = async (req: AuthRequest, res: Response) => {
        try {
            const { id } = req.params;
            const { status, admin_remarks, admin_notes } = req.body;
            const userRole = req.user?.role;

            if (userRole !== 'admin') {
                return res.status(403).json({ success: false, error: 'Access denied' });
            }

            const updates: string[] = [];
            const values: any[] = [];

            if (status) {
                updates.push('status = ?');
                values.push(status);
                updates.push('status_updated_at = ?');
                values.push(getISTTimestamp());
                if (status === 'resolved' || status === 'rejected') {
                    updates.push('resolved_at = ?');
                    values.push(getISTTimestamp());
                }
            }

            if (admin_remarks !== undefined) {
                updates.push('admin_remarks = ?');
                values.push(admin_remarks);
            }

            if (admin_notes !== undefined) {
                updates.push('admin_notes = ?');
                values.push(admin_notes);
            }

            if (updates.length > 0) {
                updates.push('updated_at = ?');
                values.push(getISTTimestamp());

                values.push(id);
                await db.execute(
                    `UPDATE grievances SET ${updates.join(', ')} WHERE id = ?`,
                    values
                );

                // Add to remarks history if admin_remarks were provided
                if (admin_remarks) {
                    try {
                        const userName = 'Administrator';
                        const userId = req.user?.id || 'admin';

                        await db.execute(
                            `INSERT INTO grievance_remarks (grievance_id, added_by, added_by_name, added_by_id, remark)
                             VALUES (?, ?, ?, ?, ?)`,
                            [id, 'admin', userName, userId, admin_remarks]
                        );
                    } catch (historyError) {
                        console.error('Failed to log admin remark history:', historyError);
                    }
                }
            }

            // Notify Customer about admin update
            let ticketId = id;
            try {
                const [rows]: any = await db.execute('SELECT customer_id, ticket_id FROM grievances WHERE id = ?', [id]);
                if (rows.length > 0) {
                    ticketId = rows[0].ticket_id;
                    await NotificationService.notify(rows[0].customer_id, {
                        title: `Update on Grievance: ${rows[0].ticket_id}`,
                        message: `Admin has updated your grievance details.`,
                        type: 'warranty',
                        link: `/grievance/view/${id}`
                    });
                }
            } catch (notifError) {
                console.error('Failed to notify customer of admin update:', notifError);
            }

            // Log activity
            const admin = req.user!;
            await ActivityLogService.log({
                adminId: admin.id,
                adminName: admin.name || 'Admin',
                adminEmail: admin.email,
                actionType: 'GRIEVANCE_UPDATED',
                targetType: 'GRIEVANCE',
                targetId: id,
                targetName: ticketId,
                details: {
                    status,
                    hasRemarks: !!admin_remarks,
                    hasNotes: !!admin_notes
                },
                ipAddress: req.ip || req.socket?.remoteAddress
            });

            return res.json({ success: true, message: 'Grievance updated successfully' });


        } catch (error: any) {
            console.error('Admin update error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to update grievance'
            });
        }
    }

    /**
     * Add customer rating (after resolution)
     * PUT /api/grievance/:id/rating
     */
    addRating = async (req: AuthRequest, res: Response) => {
        try {
            const { id } = req.params;
            const { rating, feedback } = req.body;
            const userId = req.user?.id;

            // Validate rating
            if (!rating || rating < 1 || rating > 5) {
                return res.status(400).json({ success: false, error: 'Rating must be between 1 and 5' });
            }

            // Check if grievance belongs to user and is resolved
            const [rows]: any = await db.execute(
                'SELECT customer_id, status FROM grievances WHERE id = ?',
                [id]
            );

            if (!rows || rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Grievance not found' });
            }

            if (rows[0].customer_id !== userId) {
                return res.status(403).json({ success: false, error: 'Access denied' });
            }

            if (rows[0].status !== 'resolved' && rows[0].status !== 'rejected') {
                return res.status(400).json({
                    success: false,
                    error: 'Can only rate resolved or rejected grievances'
                });
            }

            await db.execute(
                'UPDATE grievances SET customer_rating = ?, customer_feedback = ? WHERE id = ?',
                [rating, feedback || null, id]
            );

            return res.json({ success: true, message: 'Rating submitted successfully' });

        } catch (error: any) {
            console.error('Add rating error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to submit rating'
            });
        }
    }

    /**
     * Send grievance assignment email to external team member
     * POST /api/grievance/:id/send-assignment-email
     */
    sendAssignmentEmail = async (req: AuthRequest, res: Response) => {
        try {
            const { id } = req.params;
            const { assigneeName, assigneeEmail, remarks } = req.body;
            const userRole = req.user?.role;

            // Admin only
            if (userRole !== 'admin') {
                return res.status(403).json({ success: false, error: 'Admin access required' });
            }

            // Validate inputs
            if (!assigneeName || !assigneeEmail) {
                return res.status(400).json({
                    success: false,
                    error: 'Assignee name and email are required'
                });
            }

            // Basic email format validation
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(assigneeEmail)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid email format'
                });
            }

            // Fetch grievance with all required data, handling both Customer and Franchise sources
            const [rows]: any = await db.execute(
                `SELECT g.*,
                p.name as customer_name,
                p.email as customer_email,
                
                -- Determine specific details based on source type
                CASE 
                    WHEN g.source_type = 'franchise' THEN COALESCE(vd_owner.store_name, 'Unknown Franchise')
                    ELSE COALESCE(vd_target.store_name, 'Unknown Store')
                END as franchise_name,
                
                CASE 
                    WHEN g.source_type = 'franchise' THEN vd_owner.address
                    ELSE vd_target.address 
                END as franchise_address,
                
                CASE 
                    WHEN g.source_type = 'franchise' THEN vd_owner.city
                    ELSE vd_target.city 
                END as franchise_city

             FROM grievances g
             LEFT JOIN profiles p ON g.customer_id = p.id
             -- For Customer Grievances: Join on franchise_id (the target franchise)
             LEFT JOIN vendor_details vd_target ON g.franchise_id = vd_target.id
             -- For Franchise Grievances: Join on customer_id (the franchise owner)
             LEFT JOIN vendor_details vd_owner ON g.source_type = 'franchise' AND g.customer_id = vd_owner.user_id
             WHERE g.id = ?`,
                [id]
            );

            if (!rows || rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Grievance not found' });
            }

            const grievance = rows[0];

            // Update assigned_to field
            await db.execute(
                'UPDATE grievances SET assigned_to = ? WHERE id = ?',
                [assigneeName, id]
            );

            // Save assignment record with Target Date and Token
            const assignmentType = req.body.assignmentType || 'initial';
            const adminName = 'Admin';
            const estimatedCompletionDate = req.body.estimatedCompletionDate || null;
            const updateToken = uuidv4();

            await db.execute(
                `INSERT INTO grievance_assignments 
                 (grievance_id, assignee_name, assignee_email, remarks, assignment_type, sent_by, sent_by_name, estimated_completion_date, update_token, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
                [
                    id,
                    assigneeName,
                    assigneeEmail,
                    remarks || null,
                    assignmentType,
                    req.user?.id,
                    adminName,
                    estimatedCompletionDate,
                    updateToken
                ]
            );

            // Send Email with Link
            const { EmailService } = await import('../services/email.service.js');
            const emailSent = await EmailService.sendGrievanceAssignmentEmail(
                assigneeEmail,
                assigneeName,
                {
                    ticket_id: grievance.ticket_id,
                    category: grievance.category,
                    sub_category: grievance.sub_category,
                    subject: grievance.subject,
                    description: grievance.description,
                    source_type: grievance.source_type, // 'customer' or 'franchise'
                    department: grievance.department,
                    department_details: grievance.department_details,
                    customer_name: grievance.customer_name,
                    customer_email: grievance.customer_email,
                    franchise_name: grievance.franchise_name,
                    franchise_address: grievance.franchise_address,
                    franchise_city: grievance.franchise_city,
                    attachments: grievance.attachments,
                    created_at: grievance.created_at,
                    estimated_completion_date: estimatedCompletionDate
                },
                remarks || undefined,
                updateToken // Pass token for the external link
            );

            return res.json({
                success: true,
                message: `Email sent successfully to ${assigneeEmail}`
            });

        } catch (error: any) {
            console.error('Send assignment email error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to send assignment email'
            });
        }
    }

    /**
     * Get assignment history for a grievance
     * GET /api/grievance/:id/assignments
     */
    getAssignmentHistory = async (req: AuthRequest, res: Response) => {
        try {
            const { id } = req.params;
            const userRole = req.user?.role;

            // Only admin can view assignment history
            if (userRole !== 'admin') {
                return res.status(403).json({ success: false, error: 'Admin access required' });
            }

            const [assignments] = await db.execute(
                `SELECT id, assignee_name, assignee_email, remarks, completion_remarks, assignment_type, status,
                        email_sent_at, sent_by, sent_by_name
                 FROM grievance_assignments 
                 WHERE grievance_id = ?
                 ORDER BY email_sent_at DESC`,
                [id]
            );

            return res.json({ success: true, data: assignments });

        } catch (error: any) {
            console.error('Get assignment history error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch assignment history'
            });
        }
    }
    /**
     * Get assignment details by token (Public)
     * GET /api/grievance/assignment/details/:token
     */
    getAssignmentByToken = async (req: Request, res: Response) => {
        try {
            const { token } = req.params;

            const [rows]: any = await db.execute(
                `SELECT ga.*, g.ticket_id, g.category, g.subject, g.description
                 FROM grievance_assignments ga
                 JOIN grievances g ON ga.grievance_id = g.id
                 WHERE ga.update_token = ?`,
                [token]
            );

            if (!rows || rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Invalid or expired assignment token' });
            }

            const assignment = rows[0];

            // SBP-007: Expiry check (estimated_completion_date + 48 hours buffer)
            const now = new Date().getTime();
            const fortyEightHours = 48 * 60 * 60 * 1000;

            if (assignment.estimated_completion_date) {
                const deadline = new Date(assignment.estimated_completion_date).getTime();
                if (!Number.isNaN(deadline) && now > deadline + fortyEightHours) {
                    return res.status(403).json({ success: false, error: 'Assignment link has expired (past resolution deadline)' });
                }
            } else {
                // Fallback: if no deadline set, use email_sent_at + 7 days
                const sentAt = new Date(assignment.email_sent_at).getTime();
                const sevenDays = 7 * 24 * 60 * 60 * 1000;
                if (!Number.isNaN(sentAt) && now - sentAt > sevenDays) {
                    return res.status(403).json({ success: false, error: 'Assignment link has expired' });
                }
            }

            // SBP-007: One-time use check (if already completed)
            if (assignment.status === 'completed') {
                return res.status(403).json({ success: false, error: 'This assignment has already been completed' });
            }

            // If already completed, maybe don't allow further updates or just show status
            // For now, let's just return the data

            return res.json({ success: true, data: assignment });
        } catch (error: any) {
            console.error('Get assignment by token error:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch assignment details' });
        }
    }


    /**
     * Update assignment by token (Public)
     * POST /api/grievance/assignment/update/:token
     */
    updateAssignmentByToken = async (req: Request, res: Response) => {
        try {
            const { token } = req.params;
            const { status, remarks } = req.body;

            if (!status) {
                return res.status(400).json({ success: false, error: 'Status is required' });
            }

            // 1. Find assignment
            const [gaRows]: any = await db.execute(
                'SELECT id, grievance_id, assignee_name, status, email_sent_at, estimated_completion_date FROM grievance_assignments WHERE update_token = ?',
                [token]
            );

            if (!gaRows || gaRows.length === 0) {
                return res.status(404).json({ success: false, error: 'Invalid or expired assignment token' });
            }

            const assignment = gaRows[0];
            // SBP-007: Expiry check (estimated_completion_date + 48 hours buffer)
            const now = new Date().getTime();
            const fortyEightHours = 48 * 60 * 60 * 1000;

            if (assignment.estimated_completion_date) {
                const deadline = new Date(assignment.estimated_completion_date).getTime();
                if (!Number.isNaN(deadline) && now > deadline + fortyEightHours) {
                    return res.status(403).json({ success: false, error: 'Assignment link has expired (past resolution deadline)' });
                }
            } else {
                // Fallback: if no deadline set, use email_sent_at + 7 days
                const sentAt = new Date(assignment.email_sent_at).getTime();
                const sevenDays = 7 * 24 * 60 * 60 * 1000;
                if (!Number.isNaN(sentAt) && now - sentAt > sevenDays) {
                    return res.status(403).json({ success: false, error: 'Assignment link has expired' });
                }
            }

            // SBP-007: One-time use check
            if (assignment.status === 'completed') {
                return res.status(403).json({ success: false, error: 'This assignment has already been completed' });
            }

            // 2. Update all assignment history records for this token
            await db.execute(
                `UPDATE grievance_assignments 
                 SET status = ?, completion_remarks = ?, updated_at = ?
                 WHERE update_token = ?`,
                [status, remarks || null, getISTTimestamp(), token]
            );

            // 3. Add to grievance remarks history
            const [gRows]: any = await db.execute('SELECT ticket_id FROM grievances WHERE id = ?', [assignment.grievance_id]);
            const ticketId = gRows[0]?.ticket_id || assignment.grievance_id;

            // History only — a logging failure must not abort the update. It used to
            // throw after the assignment status had already been written, leaving the
            // assignment "completed" while the grievance stayed "submitted".
            try {
                const remark = `Status Update [${status}]: ${remarks || 'No remarks provided'}`;
                // The emailed link stays usable until the job is completed, so a
                // reopened link can send the same update twice. Skip an exact
                // repeat of this assignee's last update within ten minutes.
                const [recent]: any = await db.execute(
                    `SELECT 1 FROM grievance_remarks
                      WHERE grievance_id = ? AND added_by = 'assignee' AND added_by_name <=> ?
                        AND remark = ? AND created_at >= NOW() - INTERVAL 10 MINUTE
                      LIMIT 1`,
                    [assignment.grievance_id, assignment.assignee_name, remark]
                );
                if (!recent.length) {
                    await db.execute(
                        `INSERT INTO grievance_remarks (grievance_id, added_by, added_by_name, added_by_id, remark)
                         VALUES (?, 'assignee', ?, 'external', ?)`,
                        [assignment.grievance_id, assignment.assignee_name, remark]
                    );
                }
            } catch (historyError) {
                console.error('Failed to log assignee remark history:', historyError);
            }

            // 4. Update main grievance status based on assignee progress
            let mainGrievanceStatus = null;
            if (status === 'completed') {
                mainGrievanceStatus = 'resolved';
            } else if (status === 'in_progress') {
                mainGrievanceStatus = 'under_review';
            }

            if (mainGrievanceStatus) {
                await db.execute(
                    "UPDATE grievances SET status = ?, updated_at = ?, status_updated_at = ? WHERE id = ?",
                    [mainGrievanceStatus, getISTTimestamp(), getISTTimestamp(), assignment.grievance_id]
                );
            } else {
                // Just update the timestamp if status didn't change automatically
                await db.execute(
                    "UPDATE grievances SET updated_at = ?, status_updated_at = ? WHERE id = ?",
                    [getISTTimestamp(), getISTTimestamp(), assignment.grievance_id]
                );
            }

            // 5. Notify Admin
            try {
                const { NotificationService } = await import('../services/notification.service.js');
                await NotificationService.broadcast({
                    title: `Assignment Update: ${ticketId}`,
                    message: `${assignment.assignee_name} updated assignment to ${status}.`,
                    type: 'system',
                    link: `/admin/grievances/${ticketId}`,
                    targetRole: 'admin'
                });
            } catch (notifError) {
                console.error('Failed to notify admin of assignment update:', notifError);
            }

            return res.json({ success: true, message: 'Assignment updated successfully' });
        } catch (error: any) {
            console.error('Update assignment by token error:', error);
            return res.status(500).json({ success: false, error: 'Failed to update assignment' });
        }
    }
}

export default new GrievanceController();
