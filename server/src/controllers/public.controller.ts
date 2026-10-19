import { Request, Response } from 'express';
import db, { getISTTimestamp } from '../config/database.js';
import { verifyActionToken, signActionToken } from '../utils/actionToken.js';
import { EmailService } from '../services/email.service.js';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { geolocateIP, getClientIP } from '../utils/ipGeolocation.js';
import { calculateFraudScore } from '../utils/fraudScoring.js';
import { WhatsAppService } from '../services/whatsapp.service.js';
import { getMobileRegistrationUsage, normalizeCustomerMobile, matchFallbackUidSequence, resolveFallbackUid, FALLBACK_UID_YEAR } from '../utils/customerMobileLimits.js';
import { checkPurchaseDate } from '../services/purchaseDateWindow.service.js';
import { recordRegistrationEvent } from '../services/analyticsEvents.service.js';
import { parseRolls, reserveRolls, nextWarrantyUidForRoll, RollUnavailableError, withRollRetry, findSerialNotIssuedToStore } from '../services/ppfRoll.service.js';
import { withTransaction } from '../utils/transaction.js';
import { resolveWarrantyStore } from '../services/warrantyStore.js';

export class PublicController {
    static async getStores(req: Request, res: Response) {
        try {
            // Get only approved vendors with their store details
            const [stores]: any = await db.execute(`
        SELECT 
          vd.id as vendor_details_id,
          vd.store_name,
          vd.address,
          vd.city,
          vd.state,
          vd.pincode,
          vd.store_email,
          p.phone_number as phone,
          p.name as owner_name
        FROM vendor_details vd
        JOIN profiles p ON vd.user_id = p.id
        JOIN vendor_verification vv ON vd.user_id = vv.user_id
        WHERE vv.is_verified = TRUE 
        AND COALESCE(vv.is_active, TRUE) = TRUE
        ORDER BY vd.store_name ASC
      `);

            res.json({
                success: true,
                stores
            });
        } catch (error: any) {
            console.error('Get stores error:', error);
            res.status(500).json({ error: 'Failed to fetch stores' });
        }
    }

    /**
     * Get store details by store code (for QR registration)
     */
    static async getStoreByCode(req: Request, res: Response) {
        try {
            const { code } = req.params;

            if (!code) {
                return res.status(400).json({ error: 'Store code is required' });
            }

            // Fetch store by store_code
            const [stores]: any = await db.execute(`
                SELECT 
                    vd.id as vendor_details_id,
                    vd.store_name,
                    vd.store_code,
                    vd.address as address_line1,
                    vd.city,
                    vd.state,
                    vd.pincode,
                    vd.store_email,
                    p.phone_number as contact_number,
                    p.name as owner_name,
                    vd.user_id
                FROM vendor_details vd
                JOIN profiles p ON vd.user_id = p.id
                JOIN vendor_verification vv ON vd.user_id = vv.user_id
                WHERE vd.store_code = ? AND vv.is_verified = TRUE
                LIMIT 1
            `, [code]);

            if (stores.length === 0) {
                return res.status(404).json({ error: 'Store not found or not verified' });
            }

            // Also fetch installers/manpower for this store
            const [manpower]: any = await db.execute(
                // Only admin-approved staff can be picked as the installer.
                'SELECT id, name, manpower_id, applicator_type FROM manpower WHERE vendor_id = ? AND is_active = TRUE AND is_approved = TRUE ORDER BY name ASC',
                [stores[0].vendor_details_id]
            );

            res.json({
                success: true,
                store: stores[0],
                installers: manpower
            });
        } catch (error: any) {
            console.error('Get store by code error:', error);
            res.status(500).json({ error: 'Failed to fetch store details' });
        }
    }

    static async getStoreManpower(req: Request, res: Response) {
        try {
            const { vendorDetailsId } = req.params;

            if (!vendorDetailsId) {
                return res.status(400).json({ error: 'Vendor details ID is required' });
            }

            const [manpower]: any = await db.execute(
                // Only admin-approved staff can be picked as the installer.
                'SELECT id, name, manpower_id, applicator_type FROM manpower WHERE vendor_id = ? AND is_active = TRUE AND is_approved = TRUE ORDER BY name ASC',
                [vendorDetailsId]
            );

            res.json({
                success: true,
                manpower
            });
        } catch (error: any) {
            console.error('Get store manpower error:', error);
            res.status(500).json({ error: 'Failed to fetch manpower' });
        }
    }


    static async checkUniqueness(req: Request, res: Response) {
        try {
            const { phone, reg, type } = req.query;

            if (!type) {
                return res.status(400).json({ error: 'Product type is required' });
            }

            // Normalize type (frontend might send underscores or hyphens)
            const normalizedType = (type as string).replace('_', '-');

            if (reg) {
                if (reg === 'APPLIED-FOR') {
                    // Continue to phone check below if a phone number was supplied.
                } else {
                    const [existingReg]: any = await db.execute(
                        'SELECT uid, customer_name FROM warranty_registrations WHERE product_type = ? AND status != "rejected" AND registration_number = ? LIMIT 1',
                        [normalizedType, String(reg)]
                    );

                    if (existingReg.length > 0) {
                        const typeLabel = normalizedType === 'seat-cover' ? 'Seat Cover' : 'Paint Protection Film (PPF)';
                        return res.json({
                            success: true,
                            unique: false,
                            reason: 'registration_number',
                            message: `Vehicle ${reg} is already registered for ${typeLabel}.`
                        });
                    }
                }
            }

            if (phone) {
                const usage = await getMobileRegistrationUsage(phone as string);
                if (usage.usedCount >= usage.allowedCount) {
                    return res.json({
                        success: true,
                        unique: false,
                        reason: 'customer_phone',
                        usage,
                        message: usage.hasOverride
                            ? `Mobile number ${usage.mobileNumber} has already used all ${usage.allowedCount} allowed warranty submissions.`
                            : `Mobile number ${usage.mobileNumber} is already registered. Please contact the store owner to request admin approval for another submission.`
                    });
                }
            }

            res.json({
                success: true,
                unique: true
            });
        } catch (error: any) {
            console.error('Uniqueness check error:', error);
            res.status(500).json({ error: 'Uniqueness check failed' });
        }
    }

    /**
     * Check if a UID exists in the pre_generated_uids table and is available
     */
    static async checkUID(req: Request, res: Response) {
        try {
            const { uid, phone } = req.query;

            if (!uid || typeof uid !== 'string') {
                return res.status(400).json({ error: 'UID is required' });
            }

            // If the UID matches the fallback pattern (customer mobile + current
            // year), resolve it to the next unused sequence for this mobile —
            // this also covers repeat submissions where the customer keeps
            // typing the same base value and the system silently advances it
            // (e.g. ...01, ...02) as long as their mobile limit allows it.
            if (phone && typeof phone === 'string') {
                const resolved = await resolveFallbackUid(uid, phone, FALLBACK_UID_YEAR);
                if (resolved) {
                    return res.json({ success: true, valid: true, resolvedUid: resolved.uid });
                }

                if (matchFallbackUidSequence(uid, phone, FALLBACK_UID_YEAR) !== null) {
                    return res.json({
                        success: true,
                        valid: false,
                        reason: 'This mobile number has no remaining warranty submissions allowed. Please contact the store owner to request admin approval for another submission.'
                    });
                }
            }

            // Check pre_generated_uids table
            const [uidRows]: any = await db.execute(
                'SELECT uid, is_used, product_name FROM pre_generated_uids WHERE uid = ?',
                [uid]
            );

            if (uidRows.length === 0) {
                return res.json({
                    success: true,
                    valid: false,
                    reason: 'Invalid UID. This UID does not exist in our system. Please check the UID on your product packaging. If the UID is missing or unreadable, please contact the store where you purchased the product.'
                });
            }

            if (uidRows[0].is_used) {
                return res.json({
                    success: true,
                    valid: false,
                    reason: 'This UID has already been used for another warranty registration.'
                });
            }

            // Also check if it's already in warranty_registrations (belt and suspenders)
            const { excludeId } = req.query;
            let query = 'SELECT uid FROM warranty_registrations WHERE uid = ?';
            const params: any[] = [uid];

            if (excludeId) {
                query += ' AND id != ? AND uid != ?';
                params.push(excludeId, excludeId);
            }

            const [existingWarranty]: any = await db.execute(query, params);

            if (existingWarranty.length > 0) {
                return res.json({
                    success: true,
                    valid: false,
                    reason: 'This UID is already registered for a warranty.'
                });
            }

            res.json({
                success: true,
                valid: true,
                productName: uidRows[0].product_name || null
            });
        } catch (error: any) {
            console.error('UID check error:', error);
            res.status(500).json({ error: 'UID check failed' });
        }
    }

    static async checkVendorSchema(req: Request, res: Response) {
        try {
            const [columns]: any = await db.execute('SHOW COLUMNS FROM vendor_details');
            res.json({
                success: true,
                columns: columns.map((col: any) => ({
                    field: col.Field,
                    type: col.Type
                }))
            });
        } catch (error: any) {
            console.error('Schema check error:', error);
            res.status(500).json({ error: 'Schema check failed', details: 'An internal error occurred' });
        }
    }

    static async verifyVendorWarranty(req: Request, res: Response) {
        try {
            const { token } = req.query;

            if (!token) {
                return res.status(400).send('Invalid verification link');
            }

            // Verify token
            const decoded: any = verifyActionToken('warranty_vendor_action', String(token));
            if (!decoded) throw new Error('Invalid or expired franchise action link');

            if (!decoded.warrantyId) {
                return res.status(400).send('Invalid token payload');
            }

            // Update warranty status
            await db.execute(
                "UPDATE warranty_registrations SET status = 'pending' WHERE uid = ? AND status = 'pending_vendor'",
                [decoded.warrantyId]
            );

            // Auto-create/assign customer role so they appear in Admin Panel and can login
            try {
                const [warranties]: any = await db.execute(
                    'SELECT user_id FROM warranty_registrations WHERE uid = ?',
                    [decoded.warrantyId]
                );

                if (warranties.length > 0) {
                    const userId = warranties[0].user_id;
                    if (userId) {
                        // Check if they already have the role
                        const [roles]: any = await db.execute(
                            'SELECT role FROM user_roles WHERE user_id = ? AND role = "customer"',
                            [userId]
                        );

                        if (roles.length === 0) {
                            await db.execute(
                                'INSERT INTO user_roles (id, user_id, role) VALUES (?, ?, "customer")',
                                [uuidv4(), userId]
                            );
                            console.log(`✓ Assigned 'customer' role to user ${userId} after vendor confirmation`);
                        }
                    }
                }
            } catch (roleError) {
                console.error('Error assigning customer role during verification:', roleError);
            }

            // Optional: Send success email to Admin or Customer here if needed
            // For now, just show success page

            // Return simple success HTML
            res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Warranty Confirmed</title>
                    <style>
                        body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background-color: #f0f2f5; }
                        .card { background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); text-align: center; max-width: 400px; }
                        h1 { color: #2e7d32; margin-bottom: 10px; }
                        p { color: #555; }
                        .btn { display: inline-block; margin-top: 20px; padding: 10px 20px; background-color: #1976d2; color: white; text-decoration: none; border-radius: 4px; }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <h1>✅ Confirmed!</h1>
                        <p>The warranty registration has been successfully confirmed and submitted for admin approval.</p>
                        <p>You can close this window now.</p>
                    </div>
                </body>
                </html>
            `);

        } catch (error: any) {
            console.error('Warranty verification error:', error);
            res.status(400).send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Verification Failed</title>
                    <style>
                        body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background-color: #fff0f0; }
                        .card { background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); text-align: center; max-width: 400px; }
                        h1 { color: #d32f2f; margin-bottom: 10px; }
                        p { color: #555; }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <h1>Verification Failed</h1>
                        <p>The link is invalid or has expired.</p>
                        <p>An unexpected error occurred while processing your request.</p>
                    </div>
                </body>
                </html>
            `);
        }
    }

    static async rejectVendorWarranty(req: Request, res: Response) {
        try {
            const { token } = req.query;

            if (!token) {
                return res.status(400).send('Invalid rejection link');
            }

            // Verify token
            const decoded: any = verifyActionToken('warranty_vendor_action', String(token));
            if (!decoded) throw new Error('Invalid or expired franchise action link');

            if (!decoded.warrantyId) {
                return res.status(400).send('Invalid token payload');
            }

            // Update warranty status to rejected
            // We'll use a specific rejection reason
            const rejectionReason = "Installation rejected by Vendor/Franchise via email verification.";

            // See the webhook reject handler: rejected_at/rejected_by are what
            // let the reminder job tell an HO rejection from a dealer's own.
            await db.execute(
                `UPDATE warranty_registrations
                 SET status = 'rejected', rejection_reason = ?, rejected_at = NOW(), rejected_by = 'vendor'
                 WHERE uid = ? AND status = 'pending_vendor'`,
                [rejectionReason, decoded.warrantyId]
            );

            // Fetch warranty details to send rejection email to customer
            const [warranty]: any = await db.execute(
                'SELECT * FROM warranty_registrations WHERE uid = ?',
                [decoded.warrantyId]
            );

            if (warranty.length > 0) {
                const w = warranty[0];
                const productDetails = JSON.parse(w.product_details || '{}');

                // Send rejection email to customer
                await EmailService.sendWarrantyRejectionToCustomer(
                    w.customer_email,
                    w.customer_name,
                    w.uid,
                    w.product_type,
                    w.registration_number,
                    rejectionReason,
                    w.car_make,
                    w.car_model,
                    productDetails,
                    w.warranty_type,
                    w.installer_name,
                    w.installer_address, // These might be in w.installer_contact or need fetching from vendor_details if linked
                    w.installer_contact
                );
            }

            res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Warranty Rejected</title>
                    <style>
                        body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background-color: #f0f2f5; }
                        .card { background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); text-align: center; max-width: 400px; }
                        h1 { color: #d32f2f; margin-bottom: 10px; }
                        p { color: #555; }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <h1>❌ Rejection Confirmed</h1>
                        <p>The warranty registration has been rejected.</p>
                        <p>The customer will be notified.</p>
                        <p>You can close this window now.</p>
                    </div>
                </body>
                </html>
            `);

        } catch (error: any) {
            console.error('Warranty rejection error:', error);
            res.status(400).send('Rejection failed or token invalid.');
        }
    }

    /**
     * Submit warranty from public QR flow
     * Auto-creates user if not exists, then creates warranty
     */
    static async submitPublicWarranty(req: Request, res: Response) {
        try {
            const warrantyData = req.body;

            // Parse productDetails if it's a string
            if (typeof warrantyData.productDetails === 'string') {
                try {
                    warrantyData.productDetails = JSON.parse(warrantyData.productDetails);
                } catch (e) {
                    console.error('Failed to parse productDetails string:', e);
                    return res.status(400).json({ error: 'Invalid productDetails format' });
                }
            }

            // Handle uploaded files (same logic as WarrantyController)
            const files = req.files as Express.Multer.File[];
            if (files && files.length > 0) {
                files.forEach(file => {
                    if (file.fieldname === 'invoiceFile') {
                        warrantyData.productDetails.invoiceFileName = file.path;
                    } else if (['lhsPhoto', 'rhsPhoto', 'frontRegPhoto', 'backRegPhoto', 'warrantyPhoto', 'vehiclePhoto', 'seatCoverPhoto'].includes(file.fieldname)) {
                        if (!warrantyData.productDetails.photos) {
                            warrantyData.productDetails.photos = {};
                        }
                        let key = file.fieldname.replace('Photo', '');
                        if (file.fieldname === 'frontRegPhoto') key = 'frontReg';
                        if (file.fieldname === 'backRegPhoto') key = 'backReg';
                        if (file.fieldname === 'seatCoverPhoto') key = 'seatCover';
                        warrantyData.productDetails.photos[key] = file.path;
                    }
                });
            }

            // --- FRAUD DETECTION: EXIF data from frontend ---
            let exifData = { lat: null as number | null, lng: null as number | null, timestamp: null as Date | null, deviceMake: null as string | null, deviceModel: null as string | null, deviceFingerprint: null as string | null };
            if (warrantyData.productDetails.exifData) {
                const feExif = warrantyData.productDetails.exifData;
                exifData = {
                    lat: feExif.lat || null,
                    lng: feExif.lng || null,
                    timestamp: feExif.timestamp ? new Date(feExif.timestamp) : null,
                    deviceMake: feExif.deviceMake || null,
                    deviceModel: feExif.deviceModel || null,
                    deviceFingerprint: feExif.deviceFingerprint || null
                };
            } else if (warrantyData.productDetails.deviceFingerprint) {
                exifData.deviceFingerprint = (warrantyData.productDetails as any).deviceFingerprint;
            }
            console.log('[FraudDetection] Received exifData from frontend:', warrantyData.productDetails.exifData || 'NONE', '-> parsed:', exifData);

            // --- FRAUD DETECTION: IP Geolocation ---
            const clientIP = getClientIP(req);
            let ipGeo = { city: null as string | null, region: null as string | null, country: null as string | null, lat: null as number | null, lng: null as number | null };
            try {
                const ipResult = await geolocateIP(clientIP);
                ipGeo = { city: ipResult.city, region: ipResult.region, country: ipResult.country, lat: ipResult.lat, lng: ipResult.lng };
                console.log('[FraudDetection] IP geolocation:', { ip: clientIP, city: ipGeo.city, region: ipGeo.region });
            } catch (err) {
                console.warn('[FraudDetection] IP geolocation failed:', err);
            }

            // Validate required fields (customerEmail is now optional)
            const requiredFields = [
                'productType', 'customerName', 'customerPhone', 
                'registrationNumber', 'carYear', 'purchaseDate', 'warrantyType'
            ];
            const missingFields = requiredFields.filter(field => !warrantyData[field as keyof any]);

            if (missingFields.length > 0) {
                return res.status(400).json({ 
                    error: `Missing required fields: ${missingFields.join(', ')}`,
                    missingFields 
                });
            }

            // The form greys out older dates, but that is presentation only —
            // enforce the window here too. This route is public, so there is no
            // admin exemption to consider.
            const dateCheck = await checkPurchaseDate(warrantyData.purchaseDate, false);
            if (!dateCheck.ok) {
                return res.status(400).json({ error: dateCheck.error });
            }

            // UID required for seat-cover
            if (warrantyData.productType === 'seat-cover' && !warrantyData.productDetails?.uid) {
                return res.status(400).json({ error: 'UID is required for seat-cover products' });
            }

            /*
             * PPF declares which roll(s) it drew on and how much of each it used.
             * Parsed up front so a bad submission is refused before it creates a
             * customer profile, and so every later branch can ask one question
             * rather than re-deriving the product type.
             */
            const isPPF = warrantyData.productType === 'ev-products';
            const rolls = isPPF ? parseRolls(warrantyData.productDetails) : [];
            if (isPPF && rolls.length === 0) {
                return res.status(400).json({
                    error: 'Please enter at least one serial number and the area used.'
                });
            }

            /*
             * A serial an admin issued belongs to one store.
             *
             * This route is open to anyone holding the link, so a serial read
             * off someone else's paperwork would otherwise draw down their roll.
             * Only issued serials are checked — one an installer typed himself
             * was never tied to a store and stays as it was.
             *
             * The message says nothing about which store: the customer filling
             * this in cannot act on that, and it would confirm to anybody
             * guessing that the number is real.
             */
            if (isPPF) {
                const wrongSerial = await findSerialNotIssuedToStore(
                    rolls.map(r => r.serial),
                    warrantyData.storeCode
                );
                if (wrongSerial) {
                    console.warn(
                        `[PPF] serial ${wrongSerial} is issued to another store — ` +
                        `refused for store ${warrantyData.storeCode}`
                    );
                    return res.status(400).json({
                        error: `Serial number ${wrongSerial} is not valid. Please contact the admin.`
                    });
                }
            }

            // ===== UID Pre-Validation for Seat Covers (against pre_generated_uids table) =====
            let uid = warrantyData.productDetails?.uid || null;
            let isCustomerAddedUid = false;
            if (warrantyData.productType === 'seat-cover' && uid) {
                // If the UID matches the fallback pattern (customer mobile + current
                // year), resolve it to the next unused sequence for this mobile —
                // this transparently handles repeat submissions where the customer
                // re-enters the same base value.
                const isFallbackPattern = matchFallbackUidSequence(uid, warrantyData.customerPhone, FALLBACK_UID_YEAR) !== null;

                if (isFallbackPattern) {
                    const resolved = await resolveFallbackUid(uid, warrantyData.customerPhone, FALLBACK_UID_YEAR);

                    if (!resolved) {
                        return res.status(400).json({
                            error: 'This mobile number has no remaining warranty submissions allowed. Please contact the store owner to request admin approval for another submission.'
                        });
                    }

                    uid = resolved.uid;
                    warrantyData.productDetails.uid = resolved.uid;
                    isCustomerAddedUid = true;
                } else {
                    const [uidRows]: any = await db.execute(
                        'SELECT uid, is_used FROM pre_generated_uids WHERE uid = ?',
                        [uid]
                    );

                    if (uidRows.length === 0) {
                        return res.status(400).json({
                            error: 'Invalid UID. This UID does not exist in our system. Please check the UID on your product packaging, or enter your mobile number followed by the current year if the UID is missing/unreadable.'
                        });
                    }

                    if (uidRows[0].is_used) {
                        return res.status(400).json({
                            error: 'This UID has already been used for another warranty registration.'
                        });
                    }
                }
            }

            const customerEmail = warrantyData.customerEmail ? warrantyData.customerEmail.toLowerCase().trim() : null;
            const customerPhone = warrantyData.customerPhone.trim();
            const normalizedCustomerPhone = normalizeCustomerMobile(customerPhone);
            const customerName = warrantyData.customerName.trim();

            // Step 1: Find or create customer user (Phone-Number Centric)
            let userId: string;
            let isNewUser = false;

            // 1. Try to find existing user by Phone Number (Priority)
            let cleanedPhone = normalizedCustomerPhone;

            let [existingUsers]: any = await db.execute(
                'SELECT id, email FROM profiles WHERE phone_number = ?',
                [cleanedPhone]
            );

            // Deliberately NO email fallback. Stores commonly enter their own
            // address for a walk-in customer, so matching on email attached the
            // warranty to whoever owned that inbox — 284 customers ended up with
            // no profile of their own that way. The phone is the customer; the
            // email is optional and often is not theirs.

            if (existingUsers.length > 0) {
                // Existing user found
                userId = existingUsers[0].id;

                // Fetch all roles for this user
                const [roles]: any = await db.execute(
                    'SELECT role FROM user_roles WHERE user_id = ?',
                    [userId]
                );

                const userRoles = roles.map((r: any) => r.role);

                // If the user is an admin or vendor, prevent using this account as a customer
                if (userRoles.includes('admin') || userRoles.includes('vendor')) {
                    const matchedBy = 'phone number';
                    return res.status(400).json({ 
                        error: `This ${matchedBy} is registered as a franchise or admin account and cannot be used as a customer profile.` 
                    });
                }

                // Ensure they have the 'customer' role
                if (!userRoles.includes('customer')) {
                    await db.execute(
                        'INSERT INTO user_roles (id, user_id, role) VALUES (?, ?, "customer")',
                        [uuidv4(), userId]
                    );
                }

                // If email was provided but DB email is null/empty, add it — only when no
                // other profile has it. profiles.email is UNIQUE and stores reuse one
                // address across customers; claiming a taken one failed the whole
                // submission for returning customers. It stays on the warranty either way.
                if (customerEmail && (!existingUsers[0].email)) {
                    const [emailTaken]: any = await db.execute(
                        'SELECT id FROM profiles WHERE email = ? AND id <> ? LIMIT 1',
                        [customerEmail, userId]
                    );
                    if (emailTaken.length === 0) {
                        await db.execute('UPDATE profiles SET email = ? WHERE id = ?', [customerEmail, userId]);
                    }
                }
            } else {
                // Create new customer user
                isNewUser = true;

                // Generate random password (user will use OTP login)
                const tempPassword = uuidv4().substring(0, 12);
                const hashedPassword = await bcrypt.hash(tempPassword, 10);

                // profiles.email is UNIQUE, and stores often reuse one address
                // across many customers. Claim it only if free; otherwise leave
                // it null so the registration still succeeds. The address stays
                // on the warranty record either way.
                let profileEmail: string | null = customerEmail || null;
                if (profileEmail) {
                    const [emailTaken]: any = await db.execute(
                        'SELECT id FROM profiles WHERE email = ? LIMIT 1',
                        [profileEmail]
                    );
                    if (emailTaken.length > 0) {
                        console.log(`[Customer] "${profileEmail}" already belongs to another profile — creating ${cleanedPhone} without an email.`);
                        profileEmail = null;
                    }
                }

                const newUserId = uuidv4();
                await db.execute(
                    `INSERT INTO profiles (id, name, email, phone_number, password) VALUES (?, ?, ?, ?, ?)`,
                    [newUserId, customerName, profileEmail, cleanedPhone, hashedPassword]
                );
                
                await db.execute(
                    'INSERT INTO user_roles (id, user_id, role) VALUES (?, ?, "customer")',
                    [uuidv4(), newUserId]
                );

                userId = newUserId;
                console.log(`✓ Auto-created public customer profile for phone: ${cleanedPhone}`);
            }

            // Step 2: Check UID/Serial duplication AND conditional uniqueness (phone/reg)
            //
            // A PPF roll is deliberately registered more than once — it is fitted
            // across several vehicles — so a repeated serial is expected there and
            // the roll ledger decides whether it may be used. Every other product
            // keeps the identifier check exactly as it was.
            const checkId = isPPF
                ? null
                : (warrantyData.productDetails.uid || warrantyData.productDetails.serialNumber);
            if (checkId) {
                const [existingWarranty]: any = await db.execute(
                    'SELECT uid FROM warranty_registrations WHERE uid = ?',
                    [checkId]
                );
                if (existingWarranty.length > 0) {
                    return res.status(400).json({
                        error: `This ${warrantyData.productDetails.uid ? 'UID' : 'Serial Number'} is already registered.`
                    });
                }
            }

            const mobileUsage = await getMobileRegistrationUsage(cleanedPhone);
            if (mobileUsage.usedCount >= mobileUsage.allowedCount) {
                return res.status(400).json({
                    error: mobileUsage.hasOverride
                        ? `This mobile number has already used all ${mobileUsage.allowedCount} allowed warranty submissions.`
                        : 'This mobile number is already registered. Please ask the store owner to contact admin for another submission.',
                    reason: 'customer_phone_limit_reached',
                    usage: mobileUsage
                });
            }


            // Check if vehicle registration is already registered for this product type
            if (warrantyData.registrationNumber !== 'APPLIED-FOR') {
                const [existingReg]: any = await db.execute(
                    'SELECT uid FROM warranty_registrations WHERE registration_number = ? AND product_type = ? AND status != "rejected"',
                    [warrantyData.registrationNumber, warrantyData.productType]
                );
                if (existingReg.length > 0) {
                    return res.status(400).json({
                        error: `The vehicle ${warrantyData.registrationNumber} is already registered for a ${warrantyData.productType === 'seat-cover' ? 'Seat Cover' : 'Paint Protection Film (PPF)'} warranty.`
                    });
                }
            }

            // Step 3: Insert warranty
            // For public submissions, it goes to pending_vendor (Franchise needs to verify)
            const initialStatus = 'pending_vendor';
            // PPF gets its id inside the transaction below, where the roll's draw
            // count is read under lock; a serial alone no longer identifies one
            // warranty now that a roll covers several vehicles.
            let warrantyId = isPPF
                ? ''
                : (warrantyData.productDetails.uid || warrantyData.productDetails.serialNumber || uuidv4());

            // The store this warranty belongs to, by id — see services/warrantyStore.ts.
            const storeResolution = await resolveWarrantyStore({
                manpowerId: warrantyData.manpowerId,
                installerContact: warrantyData.installerContact,
                storeCode: warrantyData.storeCode,
            });
            if (!storeResolution.ok) {
                return res.status(400).json({ error: storeResolution.error });
            }
            const storeId = storeResolution.storeId;

            // --- FRAUD DETECTION: Calculate fraud score ---
            let fraudScore = 0;
            let fraudFlags = {};

            // Lookup store location for comparison
            let storeLocation = { lat: null as number | null, lng: null as number | null, city: null as string | null, state: null as string | null };
            if (storeId) {
                try {
                    const [storeRows]: any = await db.execute(
                        'SELECT latitude, longitude, city, state FROM vendor_details WHERE id = ?',
                        [storeId]
                    );
                    if (storeRows.length > 0) {
                        storeLocation = {
                            lat: storeRows[0].latitude ? parseFloat(storeRows[0].latitude) : null,
                            lng: storeRows[0].longitude ? parseFloat(storeRows[0].longitude) : null,
                            city: storeRows[0].city || null,
                            state: storeRows[0].state || null,
                        };
                    }
                } catch (err) {
                    console.warn('[FraudDetection] Store location lookup failed:', err);
                }
            }

            try {
                const result = calculateFraudScore(
                    {
                        source: 'customer',
                        exif_lat: exifData.lat,
                        exif_lng: exifData.lng,
                        exif_timestamp: exifData.timestamp,
                        ip_city: ipGeo.city,
                        ip_region: ipGeo.region,
                        ip_lat: ipGeo.lat,
                        ip_lng: ipGeo.lng,
                        submission_time: new Date(),
                        userAgent: req.headers['user-agent'] || '',
                        all_exif_data: warrantyData.productDetails.allExifData
                    },
                    storeLocation
                );
                fraudScore = result.trust_percentage;
                fraudFlags = result.flags;
                console.log('[FraudDetection] Fraud trust score:', fraudScore, '% Flags:', fraudFlags);
            } catch (err) {
                console.warn('[FraudDetection] Fraud scoring failed:', err);
            }

            // Inject submission source for UI display
            warrantyData.productDetails.submissionSource = 'QR Scan';

            /*
             * The warranty row and the roll draws it creates have to land
             * together. Charging a roll for a warranty that then fails to insert
             * would quietly consume area no vehicle ever used, and inserting the
             * warranty without the draw would let the roll be spent twice.
             *
             * Seat covers declare no rolls, so `rolls` is empty, reserveRolls is
             * never called, and the statement executed is the one that always was
             * -- only the connection it runs on differs.
             */
            const { insertResult, warrantyId: insertedWarrantyId } = await withRollRetry(() => withTransaction(async (conn) => {
                let uidForInsert = warrantyId;

                if (isPPF) {
                    // Numbered by draw on the first roll, read under the same lock
                    // reserveRolls takes, so two submissions cannot pick one id.
                    uidForInsert = await nextWarrantyUidForRoll(conn, rolls[0].serial);
                }

                const [ins]: any = await conn.execute(
                `INSERT INTO warranty_registrations
                (uid, user_id, product_type, customer_name, customer_email, customer_phone, 
                 customer_address, registration_number, car_make, car_model, car_year, car_colour,
                 purchase_date, installer_name, installer_contact, product_details, manpower_id, warranty_type, status,
                 exif_lat, exif_lng, exif_timestamp, exif_device, device_fingerprint, submission_ip, ip_city, ip_region, ip_lat, ip_lng, fraud_score, fraud_flags,
                 seat_cover_photo_url, car_outer_photo_url, vendor_details_id) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    uidForInsert,
                    userId,
                    warrantyData.productType,
                    customerName,
                    customerEmail,
                    customerPhone,
                    warrantyData.customerAddress || '',
                    warrantyData.registrationNumber,
                    warrantyData.carMake || null,
                    warrantyData.carModel || null,
                    warrantyData.carYear,
                    warrantyData.carColour || null,
                    warrantyData.purchaseDate,
                    warrantyData.installerName || null,
                    warrantyData.installerContact || null,
                    JSON.stringify(warrantyData.productDetails),
                    (warrantyData.manpowerId && warrantyData.manpowerId !== 'owner') ? warrantyData.manpowerId : null,
                    warrantyData.warrantyType,
                    initialStatus,
                    exifData.lat,
                    exifData.lng,
                    exifData.timestamp,
                    exifData.deviceMake ? `${exifData.deviceMake} ${exifData.deviceModel || ''}`.trim() : null,
                    exifData.deviceFingerprint,
                    clientIP,
                    ipGeo.city,
                    ipGeo.region,
                    ipGeo.lat,
                    ipGeo.lng,
                    fraudScore,
                    JSON.stringify(fraudFlags),
                    warrantyData.productDetails?.photos?.seatCover || null,
                    warrantyData.productDetails?.photos?.carOuter || null,
                    storeId
                ]
                );

                if (isPPF) {
                    const check = await reserveRolls(conn, rolls, uidForInsert);
                    if (!check.ok) {
                        // Unwinds the warranty insert above with it.
                        throw new RollUnavailableError(check.error!, check.failedSerial);
                    }
                }

                return { insertResult: ins, warrantyId: uidForInsert };
            }));

            // PPF's id was only decided inside the transaction; everything below
            // (notifications, the response, the certificate) refers to this one.
            warrantyId = insertedWarrantyId;

            // The trend chart counts registrations from analytics_events, so a
            // warranty that never lands an event is invisible on that graph even
            // though it exists everywhere else.
            await recordRegistrationEvent(insertResult.insertId, customerName);

            // UID is checked but NOT marked as used until Admin approves it.

            // Register customer-added fallback UID so it shows up in UID Management
            // and so the admin-approval flow (which only UPDATEs pre_generated_uids)
            // has a row to flip is_used on.
            if (isCustomerAddedUid) {
                await db.execute(
                    'INSERT INTO pre_generated_uids (uid, is_used, source) VALUES (?, FALSE, ?) ON DUPLICATE KEY UPDATE source = source',
                    [warrantyId, 'customer_added']
                );
            }

            // Step 4: Franchise Verify Notification (pending_vendor only)
            if (initialStatus === 'pending_vendor' && warrantyData.installerContact) {
                let vendorEmail = warrantyData.installerContact;
                if (vendorEmail.includes('|')) {
                    vendorEmail = vendorEmail.split('|')[0].trim();
                }

                // Try WhatsApp first
                let franchiseWaSent = false;
                if (process.env.ENABLE_WHATSAPP === 'true') {
                    try {
                        const [vendorProfile]: any = await db.execute(
                            `SELECT p.phone_number FROM profiles p
                             JOIN vendor_details vd ON vd.user_id = p.id
                             WHERE vd.id = ?`,
                            [storeId]
                        );
                        if (vendorProfile.length > 0 && vendorProfile[0].phone_number) {
                            const productName = warrantyData.productDetails?.productName
                                || warrantyData.productDetails?.product
                                || warrantyData.productType;
                            franchiseWaSent = await WhatsAppService.sendFranchiseVerifyAction(
                                vendorProfile[0].phone_number,
                                warrantyData.installerName || 'Franchise Partner',
                                warrantyData.customerName,
                                warrantyData.customerPhone,
                                productName,
                                warrantyId,
                                warrantyId
                            );
                        }
                    } catch (err) {
                        console.error('[WhatsApp] Franchise verify action failed:', err);
                    }
                }

                // Email fallback
                if (!franchiseWaSent) {
                    try {
                        const token = signActionToken(
                            'warranty_vendor_action',
                            { warrantyId: warrantyId, vendorEmail: warrantyData.installerContact },
                            '7d'
                        );
                        await EmailService.sendVendorConfirmationEmail(
                            vendorEmail,
                            warrantyData.installerName || 'Partner',
                            customerName,
                            token,
                            warrantyData.productType,
                            warrantyData.productDetails,
                            warrantyData.registrationNumber,
                            warrantyData.carMake,
                            warrantyData.carModel
                        );
                    } catch (err) {
                        console.error('[Email] Franchise verify fallback email failed:', err);
                    }
                }
            }

            // Step 5: Customer Submission Notification
            // Try WhatsApp first
            let customerWaSent = false;
            if (process.env.ENABLE_WHATSAPP === 'true' && warrantyData.customerPhone) {
                try {
                    const productName = warrantyData.productDetails?.productName
                        || warrantyData.productDetails?.product
                        || warrantyData.productType;
                    customerWaSent = await WhatsAppService.sendWarrantySubmitted(
                        warrantyData.customerPhone,
                        warrantyData.customerName,
                        productName,
                        warrantyId,
                        warrantyData.productType,
                        warrantyData.purchaseDate,
                        warrantyId
                    );
                } catch (err) {
                    console.error('[WhatsApp] Customer submission notification failed:', err);
                }
            }

            // Email fallback for confirmation
            if (!customerWaSent && customerEmail && customerEmail.trim()) {
                try {
                    await EmailService.sendWarrantyConfirmation(
                        customerEmail,
                        customerName,
                        warrantyId,
                        warrantyData.productType,
                        warrantyData.productDetails,
                        warrantyData.registrationNumber,
                        warrantyData.carMake,
                        warrantyData.carModel
                    );
                } catch (err) {
                    console.error('[Email] Customer submission fallback email failed:', err);
                }
            }

            // Step 6: Send welcome email for completely new users
            if (isNewUser && customerEmail && customerEmail.trim()) {
                try {
                    await EmailService.sendPublicRegistrationWelcome(
                        customerEmail,
                        customerName,
                        warrantyId
                    );
                } catch (err) {
                    console.error('[Email] Public registration welcome failed:', err);
                }
            }

            res.json({
                success: true,
                warrantyId,
                uid: warrantyId,
                message: 'Warranty submitted successfully. Awaiting store verification.',
                isNewUser
            });

        } catch (error: any) {
            // A roll that cannot cover the area asked of it is the installer's
            // to correct, not an internal fault — it has to keep its own message
            // and status rather than becoming a generic failure.
            if (error instanceof RollUnavailableError) {
                return res.status(400).json({ error: error.message, failedSerial: error.failedSerial });
            }
            console.error('Public warranty submission error:', error);
            res.status(500).json({ error: 'Failed to submit warranty', details: 'An internal error occurred while processing your request.' });
        }
    }
}

