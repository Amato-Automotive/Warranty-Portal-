import { Request, Response } from 'express';
import db, { getISTTimestamp } from '../config/database.js';
import { formatDateTimeIST } from '../utils/dateUtils.js';
import { EmailService } from '../services/email.service.js';
import { v4 as uuidv4 } from 'uuid';
import { NotificationService } from '../services/notification.service.js';
import { storeLeadView } from '../services/storeLeads.js';
import { loadLeadOptions } from '../services/leadOptionsStore.js';
import { storeGroupOf } from '../services/leadOptions.js';


export class VendorController {
  static async verifyVendor(req: Request, res: Response) {
    try {
      const { token } = req.query;

      if (!token) {
        return res.status(400).send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Invalid Token</title>
            <style>
              body { 
                font-family: Arial, sans-serif; 
                max-width: 600px; 
                margin: 50px auto; 
                padding: 20px; 
                text-align: center;
                background: #f5f5f5;
              }
              .card {
                background: white;
                padding: 40px;
                border-radius: 10px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
              }
              h1 { color: #dc3545; }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>❌ Invalid Verification Token</h1>
              <p>The verification link is invalid or has expired.</p>
            </div>
          </body>
          </html>
        `);
      }

      // Find vendor by token
      const [verifications]: any = await db.execute(
        'SELECT * FROM vendor_verification WHERE verification_token = ?',
        [String(token)]
      );

      if (verifications.length === 0) {
        return res.status(404).send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Token Not Found</title>
            <style>
              body { 
                font-family: Arial, sans-serif; 
                max-width: 600px; 
                margin: 50px auto; 
                padding: 20px; 
                text-align: center;
                background: #f5f5f5;
              }
              .card {
                background: white;
                padding: 40px;
                border-radius: 10px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
              }
              h1 { color: #dc3545; }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>❌ Verification Token Not Found</h1>
              <p>This verification link is invalid or has already been used.</p>
            </div>
          </body>
          </html>
        `);
      }

      const verification = verifications[0];

      // Check if already verified
      if (verification.is_verified) {
        return res.send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Already Verified</title>
            <style>
              body { 
                font-family: Arial, sans-serif; 
                max-width: 600px; 
                margin: 50px auto; 
                padding: 20px; 
                text-align: center;
                background: #f5f5f5;
              }
              .card {
                background: white;
                padding: 40px;
                border-radius: 10px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
              }
              h1 { color: #ffc107; }
            </style>
          </head>
          <body>
            <div class="card">
              <div style="font-size: 64px; margin-bottom: 20px;">⚠️</div>
              <h1>Already Verified</h1>
              <p>This vendor account has already been verified.</p>
            </div>
          </body>
          </html>
        `);
      }

      // Get vendor details BEFORE updating
      const [vendors]: any = await db.execute(
        'SELECT name, email FROM profiles WHERE id = ?',
        [verification.user_id]
      );

      if (vendors.length === 0) {
        return res.status(404).send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Vendor Not Found</title>
            <style>
              body { 
                font-family: Arial, sans-serif; 
                max-width: 600px; 
                margin: 50px auto; 
                padding: 20px; 
                text-align: center;
                background: #f5f5f5;
              }
              .card {
                background: white;
                padding: 40px;
                border-radius: 10px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
              }
              h1 { color: #dc3545; }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>❌ Vendor Not Found</h1>
              <p>Unable to find vendor details.</p>
            </div>
          </body>
          </html>
        `);
      }

      // Update verification status
      await db.execute(
        'UPDATE vendor_verification SET is_verified = TRUE, verified_at = ? WHERE verification_token = ?',
        [getISTTimestamp(), String(token)]
      );

      // Send confirmation email to vendor with login link
      await EmailService.sendVendorApprovalConfirmation(
        vendors[0].email,
        vendors[0].name
      );

      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Vendor Verified Successfully</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            body { 
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 20px;
            }
            .card {
              background: white;
              padding: 50px 40px;
              border-radius: 20px;
              box-shadow: 0 20px 60px rgba(0,0,0,0.3);
              max-width: 500px;
              width: 100%;
              text-align: center;
              animation: slideUp 0.5s ease-out;
            }
            @keyframes slideUp {
              from {
                opacity: 0;
                transform: translateY(30px);
              }
              to {
                opacity: 1;
                transform: translateY(0);
              }
            }
            .success-icon { 
              font-size: 80px; 
              margin-bottom: 20px;
              animation: bounce 1s ease infinite;
            }
            @keyframes bounce {
              0%, 100% { transform: translateY(0); }
              50% { transform: translateY(-10px); }
            }
            h1 { 
              color: #28a745; 
              margin-bottom: 15px;
              font-size: 28px;
            }
            .subtitle {
              color: #666;
              margin-bottom: 25px;
              font-size: 16px;
              line-height: 1.5;
            }
            .vendor-info {
              background: #f8f9fa;
              border-left: 4px solid #28a745;
              padding: 20px;
              border-radius: 8px;
              margin: 25px 0;
              text-align: left;
            }
            .vendor-info p {
              margin: 8px 0;
              color: #333;
            }
            .vendor-info strong {
              color: #28a745;
            }
            .info-box {
              background: #e7f5ff;
              border: 2px solid #1971c2;
              border-radius: 10px;
              padding: 20px;
              margin: 20px 0;
            }
            .info-box p {
              margin: 5px 0;
              color: #1971c2;
              font-weight: 500;
            }
            .checkmark {
              color: #28a745;
              font-size: 20px;
              margin-right: 8px;
            }
            .footer {
              margin-top: 30px;
              padding-top: 20px;
              border-top: 1px solid #eee;
              color: #999;
              font-size: 13px;
            }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="success-icon">✅</div>
            <h1>Vendor Verified Successfully!</h1>
            <p class="subtitle">The vendor account has been approved and activated</p>
            
            <div class="vendor-info">
              <p><strong>Vendor Name:</strong> ${vendors[0].name}</p>
              <p><strong>Email:</strong> ${vendors[0].email}</p>
              <p><strong>Verification Date:</strong> ${formatDateTimeIST()}</p>
            </div>

            <div class="info-box">
              <p><span class="checkmark">✓</span> Account activated successfully</p>
              <p><span class="checkmark">✓</span> Confirmation email sent to vendor</p>
              <p><span class="checkmark">✓</span> Login credentials are now active</p>
            </div>
            
            <div class="footer">
              <p>The vendor has been notified via email with login instructions.</p>
              <p style="margin-top: 10px;">You can safely close this window.</p>
            </div>
          </div>
        </body>
        </html>
      `);
    } catch (error: any) {
      console.error('Vendor verification error:', error);
      res.status(500).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Verification Error</title>
          <style>
            body { 
              font-family: Arial, sans-serif; 
              max-width: 600px; 
              margin: 50px auto; 
              padding: 20px; 
              text-align: center;
              background: #f5f5f5;
            }
            .card {
              background: white;
              padding: 40px;
              border-radius: 10px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            h1 { color: #dc3545; }
            .error-details {
              background: #fff3cd;
              border: 1px solid #ffc107;
              border-radius: 5px;
              padding: 15px;
              margin: 20px 0;
              font-size: 14px;
            }
          </style>
        </head>
        <body>
          <div class="card">
            <div style="font-size: 64px; color: #dc3545; margin-bottom: 20px;">❌</div>
            <h1>Verification Error</h1>
            <p>An error occurred during verification. Please try again later.</p>
            <p style="margin-top: 20px; font-size: 14px; color: #666;">
              If this problem persists, please contact support.
            </p>
          </div>
        </body>
        </html>
      `);
    }
  }

  static async getProfile(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;

      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      // Get vendor details
      const [vendorDetails]: any = await db.execute(
        `SELECT
          vd.id,
          vd.store_name,
          vd.store_email,
          vd.store_code,
          vd.address,
          vd.city,
          vd.state,
          vd.pincode as postal_code,
          -- Distributors keep GST on their own table; franchises on vendor_details.
          COALESCE(dist.gst_number, vd.gst_number) AS gst_number,
          vd.is_distributor,
          vd.is_franchise,
          CASE
            WHEN vd.is_distributor = 1 AND dist.allowed_brands IS NOT NULL
              THEN dist.allowed_brands
            ELSE COALESCE(vd.allowed_brands, 'AF')
          END as allowed_brands,
          p.phone_number as contact_number,
          p.name as owner_name
        FROM vendor_details vd
        JOIN profiles p ON vd.user_id = p.id
        LEFT JOIN distributors dist ON dist.profile_id = p.id
        WHERE vd.user_id = ?`,
        [userId]
      );

      if (vendorDetails.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Vendor details not found'
        });
      }

      // Map to expected format for frontend
      const profile = vendorDetails[0];
      res.json({
        success: true,
        vendorDetails: {
          id: profile.id,
          store_name: profile.store_name,
          store_email: profile.store_email,
          store_code: profile.store_code,
          contact_number: profile.contact_number,
          address_line1: profile.address || "",
          address_line2: "",
          city: profile.city,
          state: profile.state,
          postal_code: profile.postal_code,
          gst_number: profile.gst_number || null,
          is_distributor: Boolean(profile.is_distributor),
          is_franchise: profile.is_franchise === undefined ? true : Boolean(profile.is_franchise),
          allowed_brands: profile.allowed_brands || 'AF',
          owner_name: profile.owner_name // Included for default installer logic in vendor dashboard
        }
      });
    } catch (error: any) {
      console.error('Get vendor profile error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch vendor profile'
      });
    }
  }

  /**
   * The audits this store has submitted.
   *
   * The store answers on WhatsApp and then has no record of what it said; this
   * is that record. Scoped to the logged-in store from the session, never from
   * the request, so one franchise cannot read another's answers.
   *
   * Matched on the phone as well as the franchise id: a store whose portal
   * record carries a different number from the one it replied on would
   * otherwise see nothing.
   */
  /**
   * The store's own leads: those it was actually sent — the customer picked it
   * on WhatsApp, or the team sent it from Lead Management — with the auditor's
   * status. Never the auditor's reason or internal notes. Scoped by session:
   * a store can only ever read its own.
   */
  static async getOwnLeads(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: 'Not authenticated' });

      const [[store]]: any = await db.execute(
        'SELECT id, store_name FROM vendor_details WHERE user_id = ? LIMIT 1',
        [userId]
      );
      if (!store) return res.status(404).json({ error: 'Store not found' });

      /* Narrowed in SQL to the leads that name this store at all; storeLeadView
         then applies the exact rule, so the two can never disagree. */
      const [rows]: any = await db.execute(
        `SELECT id, customer_name, customer_phone, product, car_model, raw_area, state,
                store_id, store_sent_by, review_status, reviewed_at, raw_payload,
                DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') AS created_ist
           FROM leads
          WHERE store_id = ? COLLATE utf8mb4_0900_ai_ci
             OR JSON_CONTAINS(JSON_EXTRACT(raw_payload, '$.locator.notified'), JSON_QUOTE(?))
          ORDER BY created_at DESC
          LIMIT 1000`,
        [String(store.id), `store:${store.id}`]
      );

      // Each lead's group in My Leads (won, follow up, lost, no answer, not called), from the admin's outcomes.
      const options = await loadLeadOptions();
      const leads = rows
        .map((r: any) => storeLeadView(r, String(store.id)))
        .filter(Boolean)
        .map((l: any) => ({ ...l, group: storeGroupOf(options, l.status) }));

      res.json({ success: true, store: { id: store.id, name: store.store_name }, leads });
    } catch (error: any) {
      console.error('Get own leads error:', error);
      res.status(500).json({ error: 'Could not load your leads' });
    }
  }

  static async getOwnAudits(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: 'Not authenticated' });

      const [[store]]: any = await db.execute(
        `SELECT vd.id, vd.store_name, p.phone_number
         FROM vendor_details vd
         LEFT JOIN profiles p ON p.id = vd.user_id
         WHERE vd.user_id = ? LIMIT 1`,
        [userId]
      );
      if (!store) return res.status(404).json({ error: 'Store not found' });

      const last10 = String(store.phone_number || '').replace(/\D/g, '').slice(-10);

      const [audits]: any = await db.execute(
        `SELECT sa.id, sa.round_id, sa.channel, sa.audit_date, sa.submitted_at,
                sa.audited_by_name, sa.review_status,
                sa.signage_status, sa.online_presence, sa.online_presence_other,
                sa.footfall, sa.seat_covers_stock, sa.products_stocked,
                sa.last_month_business, sa.staff_training, sa.warranty_registration,
                sa.support_needed, sa.support_details,
                ar.name AS round_name, ar.first_sent_at AS round_sent_at
         FROM store_audits sa
         LEFT JOIN audit_rounds ar ON ar.id = sa.round_id
         WHERE sa.vendor_details_id = ?
            OR (? <> '' AND RIGHT(REGEXP_REPLACE(COALESCE(sa.submitted_phone, ''), '[^0-9]', ''), 10) = ?)
         ORDER BY sa.submitted_at DESC
         LIMIT 100`,
        [store.id, last10, last10]
      );

      // Whether an audit is currently being asked for, so a store that has not
      // answered is told there is one waiting rather than just shown an empty
      // list. Only open rounds count.
      const [[pending]]: any = await db.execute(
        `SELECT ar.name, ar.first_sent_at
         FROM audit_round_targets t
         JOIN audit_rounds ar ON ar.id = t.round_id
         WHERE ar.status = 'open'
           AND t.responded_at IS NULL
           AND (t.vendor_details_id = ? OR (? <> '' AND t.phone_key = ?))
         ORDER BY ar.first_sent_at DESC
         LIMIT 1`,
        [store.id, last10, last10]
      );

      res.json({
        success: true,
        audits,
        pending: pending
          ? { round_name: pending.name, sent_at: pending.first_sent_at }
          : null,
      });
    } catch (error: any) {
      console.error('Get own audits error:', error);
      res.status(500).json({ error: 'Failed to load your audits' });
    }
  }

  static async getManpower(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      const { active } = req.query; // 'true', 'false', or 'all'
      // approved: 'true' (default — only admin-approved staff), 'false' (pending
      // only, for the store's "awaiting approval" list), or 'all'.
      const approved = (req.query.approved as string) || 'true';
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 30;
      const offset = (page - 1) * limit;

      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      // Get vendor details id
      const [vendorDetails]: any = await db.execute(
        'SELECT id FROM vendor_details WHERE user_id = ?',
        [userId]
      );

      if (vendorDetails.length === 0) {
        return res.status(404).json({ error: 'Vendor details not found' });
      }

      const vendorId = vendorDetails[0].id;

      // Build WHERE clause based on active filter
      let whereClause = 'm.vendor_id = ?';
      const params: any[] = [vendorId];

      if (active === 'true') {
        whereClause += ' AND m.is_active = TRUE';
      } else if (active === 'false') {
        whereClause += ' AND m.is_active = FALSE';
      }

      // Pending staff are not usable until an admin approves them, so they are
      // excluded by default (e.g. from the installer picker on warranty forms).
      if (approved === 'true') {
        whereClause += ' AND m.is_approved = TRUE';
      } else if (approved === 'false') {
        whereClause += ' AND m.is_approved = FALSE';
      }

      // Get total count
      const [countResult]: any = await db.execute(
        `SELECT COUNT(*) as total FROM manpower m WHERE ${whereClause}`,
        params
      );
      const totalCount = countResult[0].total;
      const totalPages = Math.ceil(totalCount / limit);

      // Get manpower list with application count (optimized to avoid N+1 queries)
      const [manpower]: any = await db.execute(
        `
    SELECT
      m.*,
      COALESCE(SUM(CASE WHEN w.status = 'validated' THEN 1 ELSE 0 END), 0) AS validated_count,
      COALESCE(SUM(CASE WHEN w.status IN ('pending', 'pending_vendor') THEN 1 ELSE 0 END), 0) AS pending_count,
      COALESCE(SUM(CASE WHEN w.status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected_count,
      COUNT(w.id) AS total_count
    FROM manpower m
    LEFT JOIN warranty_registrations w ON w.manpower_id = m.id
    WHERE ${whereClause}
    GROUP BY m.id
    ORDER BY m.is_active DESC, m.name ASC
    LIMIT ? OFFSET ?
  `,
        [...params, limit, offset]
      );

      res.json({
        success: true,
        manpower,
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
      console.error('Get manpower error:', error);
      res.status(500).json({ error: 'Failed to fetch manpower list' });
    }
  }

  static async addManpower(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      const { name, phoneNumber, manpowerId, applicatorType } = req.body;

      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      if (!name || !phoneNumber || !applicatorType) {
        return res.status(400).json({ error: 'Name, phone number, and type are required' });
      }

      // Get vendor details id
      const [vendorDetails]: any = await db.execute(
        'SELECT id FROM vendor_details WHERE user_id = ?',
        [userId]
      );

      if (vendorDetails.length === 0) {
        return res.status(404).json({ error: 'Vendor details not found' });
      }

      const vendorId = vendorDetails[0].id;
      const id = uuidv4();

      // A phone number identifies one staff member across the whole system, so
      // reject it if any other ACTIVE manpower row already uses it.
      const [phoneClash]: any = await db.execute(
        `SELECT m.name, vd.store_name
         FROM manpower m
         LEFT JOIN vendor_details vd ON vd.id = m.vendor_id
         WHERE m.phone_number = ? AND m.is_active = TRUE
         LIMIT 1`,
        [phoneNumber]
      );
      if (phoneClash.length > 0) {
        return res.status(400).json({
          error: `This phone number is already registered to ${phoneClash[0].name}${phoneClash[0].store_name ? ` at ${phoneClash[0].store_name}` : ''}. Each staff member needs a unique phone number.`
        });
      }

      // Generate manpower_id if not provided
      let finalManpowerId = manpowerId;
      if (!finalManpowerId && name && phoneNumber) {
        const namePart = name.slice(0, 3).toUpperCase();
        const phonePart = phoneNumber.slice(-4);
        finalManpowerId = (namePart && phonePart) ? `${namePart}${phonePart}` : `MP-${Date.now()}`;
      }

      // New staff start PENDING (is_approved = 0). An admin approves them from
      // the franchise's Manpower tab before they become usable.
      await db.execute(
        `INSERT INTO manpower
        (id, vendor_id, name, phone_number, manpower_id, applicator_type, is_active, is_approved)
      VALUES(?, ?, ?, ?, ?, ?, TRUE, FALSE)`,
        [id, vendorId, name, phoneNumber, finalManpowerId, applicatorType]
      );

      res.status(201).json({
        success: true,
        message: 'Manpower added — awaiting admin approval',
        manpower: {
          id,
          vendor_id: vendorId,
          name,
          phone_number: phoneNumber,
          manpower_id: finalManpowerId,
          applicator_type: applicatorType,
          is_active: 1,
          is_approved: 0
        }
      });

      // Notify Admin about new manpower
      try {
        // Fetch Store Name for context
        const [store]: any = await db.execute('SELECT store_name FROM vendor_details WHERE id = ?', [vendorId]);
        const storeName = store[0]?.store_name || 'Vendor';

        await NotificationService.broadcast({
          title: 'New Staff Onboarded',
          message: `${storeName} has added a new ${applicatorType === 'seat_cover' ? 'Seat Cover Expert' : 'PPF Specialist'}: ${name} (${finalManpowerId})`,
          type: 'warranty',
          link: `/admin/users`, // Approximated link
          targetRole: 'admin'
        });
      } catch (e) {
        console.error("Failed to notify admin of new manpower", e);
      }
    } catch (error: any) {
      console.error('Add manpower error:', error);
      res.status(500).json({ error: 'Failed to add manpower' });
    }
  }

  static async removeManpower(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      const { id } = req.params;
      const { reason } = req.body; // Optional removal reason

      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      // Get vendor details id to ensure ownership
      const [vendorDetails]: any = await db.execute(
        'SELECT id FROM vendor_details WHERE user_id = ?',
        [userId]
      );

      if (vendorDetails.length === 0) {
        return res.status(404).json({ error: 'Vendor details not found' });
      }

      const vendorId = vendorDetails[0].id;

      // Removal is no longer immediate: the franchise RAISES A REQUEST with a
      // reason and an admin approves it. The member stays active meanwhile.
      if (!reason || !String(reason).trim()) {
        return res.status(400).json({ error: 'Please provide a reason for the removal request.' });
      }

      const [rows]: any = await db.execute(
        'SELECT id, name, is_active, request_status, request_type FROM manpower WHERE id = ? AND vendor_id = ?',
        [id, vendorId]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Manpower entry not found or unauthorized' });
      }
      const member = rows[0];

      if (!member.is_active) {
        return res.status(400).json({ error: `${member.name} is already removed from your team.` });
      }
      if (member.request_status === 'pending') {
        return res.status(400).json({
          error: `A ${member.request_type} request for ${member.name} is already awaiting admin review.`
        });
      }

      await db.execute(
        `UPDATE manpower
         SET request_type = 'remove', request_reason = ?, requested_at = NOW(),
             request_status = 'pending', request_reviewed_at = NULL,
             request_reviewed_by = NULL, request_review_note = NULL
         WHERE id = ? AND vendor_id = ?`,
        [String(reason).trim().substring(0, 500), id, vendorId]
      );

      res.json({
        success: true,
        message: `Removal request raised for ${member.name} — awaiting admin approval`
      });

      // Let admins know there's a removal request waiting for review.
      try {
        const [mp]: any = await db.execute('SELECT name, manpower_id, vendor_id FROM manpower WHERE id = ?', [id]);
        if (mp.length > 0) {
          const [store]: any = await db.execute('SELECT store_name FROM vendor_details WHERE id = ?', [mp[0].vendor_id]);
          const storeName = store[0]?.store_name || 'Vendor';

          await NotificationService.broadcast({
            title: 'Staff Removal Requested',
            message: `${storeName} has requested removal of ${mp[0].name} (${mp[0].manpower_id}). Reason: ${String(reason).trim()}`,
            type: 'warranty',
            targetRole: 'admin'
          });
        }
      } catch (e) {
        console.error("Failed to notify admin of manpower removal request", e);
      }
    } catch (error: any) {
      console.error('Remove manpower request error:', error);
      res.status(500).json({ error: 'Failed to raise removal request' });
    }
  }

  /**
   * Bring an archived (Ex-Team) staff member back onto the team.
   *
   * Restoring returns them as PENDING — an admin re-verifies before they can be
   * selected as an installer again. The phone-uniqueness rule still applies, so
   * a restore is blocked if someone else now uses that number.
   */
  static async restoreManpower(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      const { id } = req.params;
      const { reason } = req.body || {};

      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      // Admins can restore any store's staff; a vendor is scoped to their own.
      const isAdmin = (req as any).user?.role === 'admin';
      let vendorId: string | null = null;

      if (!isAdmin) {
        const [vendorDetails]: any = await db.execute(
          'SELECT id FROM vendor_details WHERE user_id = ?',
          [userId]
        );
        if (vendorDetails.length === 0) {
          return res.status(404).json({ error: 'Vendor details not found' });
        }
        vendorId = vendorDetails[0].id;
      }

      const [rows]: any = isAdmin
        ? await db.execute(
            'SELECT id, name, phone_number, is_active, vendor_id, request_status, request_type FROM manpower WHERE id = ?',
            [id]
          )
        : await db.execute(
            'SELECT id, name, phone_number, is_active, vendor_id, request_status, request_type FROM manpower WHERE id = ? AND vendor_id = ?',
            [id, vendorId]
          );
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Manpower entry not found or unauthorized' });
      }
      const member = rows[0];
      // For admins, act on the row's own store.
      if (isAdmin) vendorId = member.vendor_id;

      if (member.is_active) {
        return res.status(400).json({ error: `${member.name} is already on your team.` });
      }

      // Someone else may have taken this phone number while they were archived.
      const [clash]: any = await db.execute(
        `SELECT m.name, vd.store_name
         FROM manpower m
         LEFT JOIN vendor_details vd ON vd.id = m.vendor_id
         WHERE m.phone_number = ? AND m.is_active = TRUE AND m.id != ?
         LIMIT 1`,
        [member.phone_number, id]
      );
      if (clash.length > 0) {
        return res.status(400).json({
          error: `Cannot restore ${member.name}: their phone number is now used by ${clash[0].name}${clash[0].store_name ? ` at ${clash[0].store_name}` : ''}. Update the number first.`
        });
      }

      // An admin restores immediately; a franchise raises a request for review.
      if (isAdmin) {
        await db.execute(
          `UPDATE manpower
           SET is_active = TRUE, removed_at = NULL, removed_reason = NULL,
               is_approved = FALSE, approved_at = NULL, approved_by = NULL,
               request_type = NULL, request_reason = NULL, requested_at = NULL,
               request_status = NULL, request_reviewed_at = NULL,
               request_reviewed_by = NULL, request_review_note = NULL
           WHERE id = ? AND vendor_id = ?`,
          [id, vendorId]
        );
        res.json({ success: true, message: `${member.name} restored — awaiting approval to become selectable` });
        return;
      }

      if (member.request_status === 'pending') {
        return res.status(400).json({
          error: `A ${member.request_type} request for ${member.name} is already awaiting admin review.`
        });
      }

      if (!reason || !String(reason).trim()) {
        return res.status(400).json({ error: 'Please provide a reason for the restore request.' });
      }

      // A restore is logically "adding them back", so the member returns to the
      // team as NOT approved — landing in the normal pending-approval queue that
      // new staff use, rather than a separate request list. The reason is kept
      // so the reviewing admin can see why the store wants them back.
      await db.execute(
        `UPDATE manpower
         SET is_active = TRUE, removed_at = NULL, removed_reason = NULL,
             is_approved = FALSE, approved_at = NULL, approved_by = NULL,
             request_type = 'restore', request_reason = ?, requested_at = NOW(),
             request_status = NULL, request_reviewed_at = NULL,
             request_reviewed_by = NULL, request_review_note = NULL
         WHERE id = ? AND vendor_id = ?`,
        [String(reason).trim().slice(0, 500), id, vendorId]
      );

      res.json({
        success: true,
        message: `${member.name} moved back to your team — awaiting admin approval`
      });

      // Let admins know there's a restore request waiting.
      try {
        const [store]: any = await db.execute('SELECT store_name FROM vendor_details WHERE id = ?', [vendorId]);
        await NotificationService.broadcast({
          title: 'Staff Restore Requested',
          message: `${store[0]?.store_name || 'A store'} has requested to restore ${member.name} to their team. Reason: ${String(reason).trim()}`,
          type: 'warranty',
          targetRole: 'admin'
        });
      } catch (e) {
        console.error('Failed to notify admin of manpower restore', e);
      }
    } catch (error: any) {
      console.error('Restore manpower error:', error);
      res.status(500).json({ error: 'Failed to restore manpower' });
    }
  }

  static async updateManpower(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      const { id } = req.params;
      const { name, phoneNumber, applicatorType } = req.body;

      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      if (!name || !phoneNumber || !applicatorType) {
        return res.status(400).json({ error: 'Name, phone number, and applicator type are required' });
      }

      // Get vendor details id to ensure ownership
      const [vendorDetails]: any = await db.execute(
        'SELECT id FROM vendor_details WHERE user_id = ?',
        [userId]
      );

      if (vendorDetails.length === 0) {
        return res.status(404).json({ error: 'Vendor details not found' });
      }

      const vendorId = vendorDetails[0].id;

      // A phone number identifies one staff member across the whole system.
      // Exclude the row being edited so re-saving unchanged details is allowed.
      const [phoneClash]: any = await db.execute(
        `SELECT m.name, vd.store_name
         FROM manpower m
         LEFT JOIN vendor_details vd ON vd.id = m.vendor_id
         WHERE m.phone_number = ? AND m.is_active = TRUE AND m.id != ?
         LIMIT 1`,
        [phoneNumber, id]
      );
      if (phoneClash.length > 0) {
        return res.status(400).json({
          error: `This phone number is already registered to ${phoneClash[0].name}${phoneClash[0].store_name ? ` at ${phoneClash[0].store_name}` : ''}. Each staff member needs a unique phone number.`
        });
      }

      // Generate manpower_id if name or phone changed
      const namePart = name.slice(0, 3).toUpperCase();
      const phonePart = phoneNumber.slice(-4);
      const manpowerId = (namePart && phonePart) ? `${namePart}${phonePart}` : `MP-${Date.now()}`;

      // Update manpower entry ensuring it belongs to this vendor
      const [result]: any = await db.execute(
        `UPDATE manpower 
         SET name = ?, phone_number = ?, manpower_id = ?, applicator_type = ?
        WHERE id = ? AND vendor_id = ? `,
        [name, phoneNumber, manpowerId, applicatorType, id, vendorId]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Manpower entry not found or unauthorized' });
      }

      // Fetch updated manpower entry
      const [updated]: any = await db.execute(
        'SELECT * FROM manpower WHERE id = ?',
        [id]
      );

      res.json({
        success: true,
        message: 'Manpower updated successfully',
        manpower: updated[0]
      });
    } catch (error: any) {
      console.error('Update manpower error:', error);
      res.status(500).json({ error: 'Failed to update manpower' });
    }
  }

  static async getManpowerWarranties(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      const { manpowerId } = req.params;
      const { status } = req.query; // 'validated', 'pending', 'rejected', or 'all'
      // Same period vocabulary the manpower leaderboard uses, so opening a count
      // shows the warranties that count was actually describing.
      const period = (req.query.period as string) || 'all';
      const year = req.query.year as string;
      const month = req.query.month as string;
      const startDate = req.query.startDate as string;
      const endDate = req.query.endDate as string;

      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      /*
       * The route admits admins, but this used to resolve the caller's own
       * vendor_details row — which an admin does not have — so every admin
       * request 404'd. A store stays scoped to its own team; an admin may read
       * any member's warranties, the same split restoreManpower uses.
       */
      const isAdmin = (req as any).user?.role === 'admin';

      let manpowerCheck: any;
      if (isAdmin) {
        [manpowerCheck] = await db.execute(
          'SELECT id, name FROM manpower WHERE id = ?',
          [manpowerId]
        );
      } else {
        const [vendorDetails]: any = await db.execute(
          'SELECT id FROM vendor_details WHERE user_id = ?',
          [userId]
        );

        if (vendorDetails.length === 0) {
          return res.status(404).json({ error: 'Vendor details not found' });
        }

        [manpowerCheck] = await db.execute(
          'SELECT id, name FROM manpower WHERE id = ? AND vendor_id = ?',
          [manpowerId, vendorDetails[0].id]
        );
      }

      if (manpowerCheck.length === 0) {
        return res.status(403).json({ error: 'Unauthorized access to manpower' });
      }

      // Build WHERE clause
      let whereClause = 'w.manpower_id = ?';
      const params: any[] = [manpowerId];

      if (status && status !== 'all') {
        if (status === 'pending') {
          whereClause += " AND w.status IN ('pending', 'pending_vendor')";
        } else {
          whereClause += ' AND w.status = ?';
          params.push(status);
        }
      }

      // Mirrors getAllManpower's date clause, so the list and the tally agree.
      if (period === 'year') {
        whereClause += ' AND YEAR(w.created_at) = ?';
        params.push(year || String(new Date().getFullYear()));
      } else if (period === 'month') {
        whereClause += ' AND YEAR(w.created_at) = ? AND MONTH(w.created_at) = ?';
        params.push(year || String(new Date().getFullYear()), month || String(new Date().getMonth() + 1));
      } else if (period === 'week') {
        whereClause += ' AND DATE(w.created_at) >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)';
      } else if (period === 'custom' && startDate && endDate) {
        whereClause += ' AND DATE(w.created_at) >= ? AND DATE(w.created_at) <= ?';
        params.push(startDate, endDate);
      }

      // Fetch warranties for this manpower
      const [warranties]: any = await db.execute(
        `SELECT w.* FROM warranty_registrations w
         WHERE ${whereClause}
         ORDER BY w.created_at DESC`,
        params
      );

      // Parse product_details JSON
      const formattedWarranties = warranties.map((w: any) => ({
        ...w,
        product_details: typeof w.product_details === 'string'
          ? JSON.parse(w.product_details)
          : w.product_details
      }));

      res.json({
        success: true,
        warranties: formattedWarranties,
        manpower: manpowerCheck[0]
      });
    } catch (error: any) {
      console.error('Get manpower warranties error:', error);
      res.status(500).json({ error: 'Failed to fetch manpower warranties' });
    }
  }

  static async approveWarranty(req: Request, res: Response) {
    try {
      const { uid } = req.params;
      const userId = (req as any).user?.id;

      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      // Get vendor's vendor_details
      const [vendorDetails]: any = await db.execute(
        'SELECT id, store_name FROM vendor_details WHERE user_id = ?',
        [userId]
      );

      if (vendorDetails.length === 0) {
        return res.status(403).json({ error: 'Vendor details not found' });
      }

      const vendorId = vendorDetails[0].id;
      const storeName = vendorDetails[0].store_name;

      // First, fetch the warranty to check authorization
      const [warranty]: any = await db.execute(
        `SELECT wr.*, m.vendor_id as manpower_vendor_id 
         FROM warranty_registrations wr 
         LEFT JOIN manpower m ON wr.manpower_id = m.id 
         WHERE wr.uid = ? AND wr.status = 'pending_vendor'`,
        [uid]
      );

      if (warranty.length === 0) {
        return res.status(404).json({ error: 'Warranty not found or not in pending_vendor status' });
      }

      const w = warranty[0];

      // Only the store the warranty belongs to may approve or reject it — by
      // store id. Matching the store name let any store sharing that name
      // (three are "UMIYA CAR ACCESSORIES & SPA") act on another's warranty.
      const isOwnStore = !!w.vendor_details_id && w.vendor_details_id === vendorId;
      const isVendorSubmitter = !w.vendor_details_id && w.user_id === userId;

      if (!isOwnStore && !isVendorSubmitter) {
        console.log('Authorization failed:', {
          warrantyId: uid,
          manpowerVendorId: w.manpower_vendor_id,
          vendorId,
          warrantyUserId: w.user_id,
          userId,
          installerName: w.installer_name,
          storeName
        });
        return res.status(403).json({ error: 'Not authorized to approve this warranty' });
      }

      // Update the warranty status
      await db.execute(
        `UPDATE warranty_registrations SET status = 'pending', vendor_approved_at = NOW() WHERE uid = ?`,
        [uid]
      );

      // Log the action to the immutable analytics_events table
      try {
          await db.execute(
              `INSERT INTO analytics_events (warranty_id, action_type, performed_by) VALUES (?, ?, ?)`,
              [w.id, 'vendor_approved', storeName]
          );
      } catch (err) {
          console.error('Failed to log analytics event:', err);
      }

      console.log(`✓ Warranty ${uid} approved by vendor ${storeName}`);

      // Notify relevant parties
      try {
        // 1. Notify Admin
        await NotificationService.broadcast({
          title: 'Warranty Approved by Vendor',
          message: `Warranty ${uid} approved by Franchise. Pending Admin Review.`,
          type: 'warranty',
          link: `/admin/verifications?uid=${uid}`,
          targetUsers: [],
          targetRole: 'admin'
        });

        // 2. Notify Customer
        const [warrantyRows]: any = await db.execute('SELECT user_id FROM warranty_registrations WHERE uid = ?', [uid]);
        if (warrantyRows.length > 0 && warrantyRows[0].user_id) {
          await NotificationService.notify(warrantyRows[0].user_id, {
            title: 'Warranty Approved by Franchise',
            message: `Your warranty ${uid} has been approved by the franchise and is now pending final admin review.`,
            type: 'warranty',
            link: `/dashboard/customer`
          });
        }
      } catch (e) {
        console.error("Failed to send approval notifications", e);
      }

      res.json({ success: true, message: 'Warranty approved successfully' });
    } catch (error: any) {
      console.error('Approve warranty error:', error);
      res.status(500).json({ error: 'Failed to approve warranty' });
    }
  }

  static async rejectWarranty(req: Request, res: Response) {
    try {
      const { uid } = req.params;
      const { reason } = req.body;
      const userId = (req as any).user?.id;

      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      if (!reason) {
        return res.status(400).json({ error: 'Rejection reason is required' });
      }

      // Get vendor's vendor_details
      const [vendorDetails]: any = await db.execute(
        'SELECT id, store_name FROM vendor_details WHERE user_id = ?',
        [userId]
      );

      if (vendorDetails.length === 0) {
        return res.status(403).json({ error: 'Vendor details not found' });
      }

      const vendorId = vendorDetails[0].id;
      const storeName = vendorDetails[0].store_name;

      // First, fetch the warranty to check authorization
      const [warrantyCheck]: any = await db.execute(
        `SELECT wr.*, m.vendor_id as manpower_vendor_id 
         FROM warranty_registrations wr 
         LEFT JOIN manpower m ON wr.manpower_id = m.id 
         WHERE wr.uid = ? AND wr.status = 'pending_vendor'`,
        [uid]
      );

      if (warrantyCheck.length === 0) {
        return res.status(404).json({ error: 'Warranty not found or not in pending_vendor status' });
      }

      const w = warrantyCheck[0];

      // Only the store the warranty belongs to may approve or reject it — by
      // store id. Matching the store name let any store sharing that name
      // (three are "UMIYA CAR ACCESSORIES & SPA") act on another's warranty.
      const isOwnStore = !!w.vendor_details_id && w.vendor_details_id === vendorId;
      const isVendorSubmitter = !w.vendor_details_id && w.user_id === userId;

      if (!isOwnStore && !isVendorSubmitter) {
        console.log('Reject authorization failed:', {
          warrantyId: uid,
          manpowerVendorId: w.manpower_vendor_id,
          vendorId,
          warrantyUserId: w.user_id,
          userId,
          installerName: w.installer_name,
          storeName
        });
        return res.status(403).json({ error: 'Not authorized to reject this warranty' });
      }

      // Update the warranty status
      await db.execute(
        `UPDATE warranty_registrations SET status = 'rejected', rejection_reason = ?, rejected_at = NOW(), rejected_by = 'vendor' WHERE uid = ?`,
        [reason, uid]
      );

      // Log the action to the immutable analytics_events table
      try {
          await db.execute(
              `INSERT INTO analytics_events (warranty_id, action_type, performed_by) VALUES (?, ?, ?)`,
              [w.id, 'rejected', storeName]
          );
      } catch (err) {
          console.error('Failed to log analytics event:', err);
      }

      // Fetch details and send email to Customer
      const [warranty]: any = await db.execute(
        'SELECT * FROM warranty_registrations WHERE uid = ?',
        [uid]
      );

      if (warranty.length > 0) {
        const w = warranty[0];
        const productDetails = JSON.parse(w.product_details || '{}');

        // 1. Email Notification
        await EmailService.sendWarrantyRejectionToCustomer(
          w.customer_email,
          w.customer_name,
          w.uid,
          w.product_type,
          w.registration_number,
          reason,
          w.car_make,
          w.car_model,
          productDetails,
          w.warranty_type,
          w.installer_name,
          w.installer_address,
          w.installer_contact
        );

        // 2. Site Notification
        if (w.user_id) {
          await NotificationService.notify(w.user_id, {
            title: 'Warranty Rejected by Franchise',
            message: `Your warranty ${uid} was rejected by the franchise. Reason: ${reason}`,
            type: 'warranty',
            link: `/dashboard/customer`
          });
        }
      }

      res.json({ success: true, message: 'Warranty rejected successfully' });
    } catch (error: any) {
      console.error('Reject warranty error:', error);
      res.status(500).json({ error: 'Failed to reject warranty' });
    }
  }
}