import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db, { getISTTimestamp } from '../config/database.js';
import { EmailService } from '../services/email.service.js';
import { AuthRequest } from '../middleware/auth.js';
import { WarrantyData } from '../types/index.js';
import { signActionToken } from '../utils/actionToken.js';
import { NotificationService } from '../services/notification.service.js';
import { ActivityLogService } from '../services/activity-log.service.js';
import { diffSubmission, summariseChanges } from '../services/warrantyDiff.js';
import { WhatsAppService } from '../services/whatsapp.service.js';
import { geolocateIP, getClientIP } from '../utils/ipGeolocation.js';
import { calculateFraudScore } from '../utils/fraudScoring.js';
import { matchFallbackUidSequence, resolveFallbackUid, FALLBACK_UID_YEAR } from '../utils/customerMobileLimits.js';
import { recordRegistrationEvent } from '../services/analyticsEvents.service.js';
import { checkPurchaseDate } from '../services/purchaseDateWindow.service.js';
import { parseRolls, reserveRolls, nextWarrantyUidForRoll, RollUnavailableError, withRollRetry } from '../services/ppfRoll.service.js';
import { withTransaction } from '../utils/transaction.js';
import { resolveWarrantyStore, vendorWarrantyScope } from '../services/warrantyStore.js';


// Extending WarrantyData interface locally if not updated in types file yet
interface ExtendedWarrantyData extends WarrantyData {
  manpowerId?: string;
  vendorDirect?: boolean;
  /**
   * The warranty being corrected, on a resubmission.
   *
   * PPF cannot be identified by its serial number any more — one roll is fitted
   * across several vehicles, so the serial names the roll rather than the
   * registration — and a correction has to say which registration it is
   * replacing.
   */
  warrantyId?: string;
}

export class WarrantyController {
  static async submitWarranty(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      // Handle FormData: req.body might need parsing if it came as JSON string in a field
      // But usually with multer, non-file fields are in req.body
      let warrantyData: ExtendedWarrantyData = req.body;

      // If productDetails is a string (from FormData), parse it
      if (typeof warrantyData.productDetails === 'string') {
        try {
          warrantyData.productDetails = JSON.parse(warrantyData.productDetails);
        } catch (e) {
          console.error('Failed to parse productDetails string:', e);
          return res.status(400).json({ error: 'Invalid productDetails format' });
        }
      }

      // SBP-DB: Trim string lengths to prevent database overflow (Data Too Long) edge cases
      if (warrantyData.customerName) warrantyData.customerName = String(warrantyData.customerName).substring(0, 255);
      if (warrantyData.customerEmail) warrantyData.customerEmail = String(warrantyData.customerEmail).substring(0, 255);
      if (warrantyData.customerPhone) warrantyData.customerPhone = String(warrantyData.customerPhone).substring(0, 20);
      if (warrantyData.installerName) warrantyData.installerName = String(warrantyData.installerName).substring(0, 255);
      if (warrantyData.installerContact) warrantyData.installerContact = String(warrantyData.installerContact).substring(0, 255);
      if (warrantyData.registrationNumber) warrantyData.registrationNumber = String(warrantyData.registrationNumber).substring(0, 50);
      if (warrantyData.carMake) warrantyData.carMake = String(warrantyData.carMake).substring(0, 100);
      if (warrantyData.carModel) warrantyData.carModel = String(warrantyData.carModel).substring(0, 100);
      if (warrantyData.carYear) warrantyData.carYear = String(warrantyData.carYear).substring(0, 4);

      // Staff must be admin-approved before they can be credited as the installer.
      // The picker already hides pending staff; this is the server-side guard.
      // 'owner' is the store-owner sentinel, not a manpower row, so it's exempt.
      if (warrantyData.manpowerId && warrantyData.manpowerId !== 'owner') {
        const [mpRows]: any = await db.execute(
          'SELECT is_approved, is_active, name FROM manpower WHERE id = ?',
          [warrantyData.manpowerId]
        );
        if (mpRows.length > 0 && !mpRows[0].is_approved) {
          return res.status(400).json({
            error: `${mpRows[0].name} is still awaiting admin approval and cannot be selected as the installer yet.`
          });
        }
      }
      if (warrantyData.warrantyType) warrantyData.warrantyType = String(warrantyData.warrantyType).substring(0, 50);

      // Handle uploaded files
      const files = req.files as Express.Multer.File[];
      if (files && files.length > 0) {
        // Map files to their respective fields in productDetails
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

            (warrantyData.productDetails.photos as any)[key] = file.path;
          }
        });
      }

      // --- FRAUD DETECTION: EXIF data from frontend ---
      let exifData = { lat: null as number | null, lng: null as number | null, timestamp: null as Date | null, deviceMake: null as string | null, deviceModel: null as string | null, deviceFingerprint: null as string | null };
      if ((warrantyData.productDetails as any).exifData) {
        const feExif = (warrantyData.productDetails as any).exifData;
        exifData = {
          lat: feExif.lat || null,
          lng: feExif.lng || null,
          timestamp: feExif.timestamp ? new Date(feExif.timestamp) : null,
          deviceMake: feExif.deviceMake || null,
          deviceModel: feExif.deviceModel || null,
          deviceFingerprint: feExif.deviceFingerprint || null
        };
      } else if ((warrantyData.productDetails as any).deviceFingerprint) {
         exifData.deviceFingerprint = (warrantyData.productDetails as any).deviceFingerprint;
      }

      // --- FRAUD DETECTION: IP Geolocation ---
      const clientIP = getClientIP(req);
      let ipGeo = { city: null as string | null, region: null as string | null, country: null as string | null, lat: null as number | null, lng: null as number | null };
      try {
        const ipResult = await geolocateIP(clientIP);
        ipGeo = { city: ipResult.city, region: ipResult.region, country: ipResult.country, lat: ipResult.lat, lng: ipResult.lng };
      } catch (err) {
        console.warn('[FraudDetection] IP geolocation failed:', err);
      }

      // Validate required fields
      const requiredFields = [
        'productType', 'customerName', 'customerPhone', 'customerAddress', 
        'registrationNumber', 'carYear', 'purchaseDate', 'warrantyType'
      ];
      const missingFields = requiredFields.filter(field => !warrantyData[field as keyof ExtendedWarrantyData]);

      if (missingFields.length > 0) {
        return res.status(400).json({ 
          error: `Missing required fields: ${missingFields.join(', ')}`,
          missingFields 
        });
      }

      // Enforce the purchase-date window server-side; the form only greys out
      // older dates. Admins get the wider window, since they file on a store's
      // behalf long after the sale.
      const dateCheck = await checkPurchaseDate(
        warrantyData.purchaseDate,
        req.user?.role === 'admin'
      );
      if (!dateCheck.ok) {
        return res.status(400).json({ error: dateCheck.error });
      }

      // Customer email is required for customers, optional for vendors
      /* 
      if (req.user.role === 'customer' && !warrantyData.customerEmail) {
        return res.status(400).json({ error: 'Customer email is required' });
      }
      */

      // UID is only required for seat-cover products
      if (warrantyData.productType === 'seat-cover' && !warrantyData.productDetails?.uid) {
        return res.status(400).json({ error: 'UID is required for seat-cover products' });
      }

      /*
       * PPF declares which roll(s) it drew on and how much of each it used.
       * Parsed up front so every later branch asks one question rather than
       * re-deriving the product type.
       */
      const isPPF = warrantyData.productType === 'ev-products';
      const rolls = isPPF ? parseRolls(warrantyData.productDetails) : [];
      if (isPPF && rolls.length === 0) {
        return res.status(400).json({
          error: 'Please enter at least one serial number and the area used.'
        });
      }

      // Role-based validation: Customers can only register warranties under their own email
      if (req.user.role === 'customer') {
        const customerEmail = (warrantyData.customerEmail || '').trim().toLowerCase();
        const userEmail = (req.user.email || '').trim().toLowerCase();
        
        if (customerEmail !== userEmail) {
          return res.status(403).json({
            error: 'Customers can only register warranties under their own account'
          });
        }
      }

      let uid = warrantyData.productDetails.uid || null;
      let isCustomerAddedUid = false;

      // If the UID matches the fallback pattern (customer mobile + current
      // year), resolve it to the next unused sequence for this mobile before
      // any resubmission/duplicate checks run — otherwise a repeat customer
      // re-entering the same base value would collide with their own prior
      // (already-approved) warranty instead of getting a fresh UID.
      if (warrantyData.productType === 'seat-cover' && uid) {
        const isFallbackPattern = matchFallbackUidSequence(uid, warrantyData.customerPhone, FALLBACK_UID_YEAR) !== null;

        if (isFallbackPattern) {
          const resolved = await resolveFallbackUid(uid, warrantyData.customerPhone, FALLBACK_UID_YEAR);

          if (!resolved) {
            return res.status(400).json({
              error: 'This mobile number has no remaining warranty submissions allowed. Please contact admin to raise the limit.'
            });
          }

          uid = resolved.uid;
          warrantyData.productDetails.uid = resolved.uid;
          isCustomerAddedUid = true;
        }
      }

      // ===== UID Pre-Validation for Seat Covers =====
      // --- RESUBMISSION DETECTION (must run BEFORE is_used check) ---
      let isResubmission = false;
      /*
       * What identifies the warranty being filed.
       *
       * A seat cover is its UID. PPF used to be its serial number, but a roll is
       * now fitted across several vehicles, so the serial identifies the roll and
       * no longer one registration — the warranty carries its own id instead
       * (the serial plus which draw from that roll it was). A correction sends
       * that id back, so it is what a resubmission is matched on; a fresh PPF
       * submission has none yet and must not match anything.
       */
      const checkId = isPPF
        ? (warrantyData.warrantyId || warrantyData.productDetails.warrantyUid || null)
        : (uid || warrantyData.productDetails.serialNumber);
      let existingStoreId: string | null = null;
      if (checkId) {
        const [existingWarranty]: any = await db.execute(
          'SELECT uid, user_id, status, product_details, manpower_id, installer_name, installer_contact, vendor_details_id FROM warranty_registrations WHERE uid = ?',
          [checkId]
        );

        if (existingWarranty.length > 0) {
          const existing = existingWarranty[0];
          existingStoreId = existing.vendor_details_id || null;

          // Authorization check: Only allow resubmission if user owns it, is admin, or is a linked vendor
          let isAuthorized = req.user.role === 'admin' || existing.user_id === req.user.id;

          // A franchise may resubmit its own store's warranty — by store id,
          // never by name, which another store can share.
          if (!isAuthorized && req.user.role === 'vendor' && existing.vendor_details_id) {
            const [vendorDetails]: any = await db.execute(
              'SELECT id FROM vendor_details WHERE user_id = ?',
              [req.user.id]
            );
            if (vendorDetails.length > 0 && vendorDetails[0].id === existing.vendor_details_id) {
              isAuthorized = true;
            }
          }

          if (existing.status === 'rejected' && isAuthorized) {
            let existingDetails: any = {};
            try {
              existingDetails = typeof existing.product_details === 'string'
                ? JSON.parse(existing.product_details)
                : existing.product_details || {};
            } catch (e) {
              console.error("Error parsing existing product_details", e);
            }

            const currentRetryCount = existingDetails.retryCount || 0;
            // Increment retry count for audit tracking (no limit enforced)
            warrantyData.productDetails.retryCount = currentRetryCount + 1;

            // Merge logic: Preserve old photos if new ones are not provided
            if (existingDetails.photos) {
              if (!warrantyData.productDetails.photos) {
                warrantyData.productDetails.photos = {};
              }
              const oldPhotos = existingDetails.photos;
              Object.keys(oldPhotos).forEach(key => {
                if (!(warrantyData.productDetails.photos as any)[key] && oldPhotos[key]) {
                  (warrantyData.productDetails.photos as any)[key] = oldPhotos[key];
                }
              });
            }
            
            // Also preserve invoice if missing
            if (!warrantyData.productDetails.invoiceFileName && existingDetails.invoiceFileName) {
              warrantyData.productDetails.invoiceFileName = existingDetails.invoiceFileName;
            }

            // Preserve all other top-level fields (like allExifData) if omitted from the new request
            Object.keys(existingDetails).forEach(key => {
              if (key !== 'photos' && key !== 'invoiceFileName' && key !== 'retryCount') {
                if ((warrantyData.productDetails as any)[key] == null) {
                  (warrantyData.productDetails as any)[key] = existingDetails[key];
                }
              }
            });

            // Mark as resubmission (do NOT delete original)
            isResubmission = true;
            console.log(`[Resubmission] Detected resubmission for UID: ${checkId}`);
            console.log(`[Resubmission] Files received in request:`, files?.map(f => f.fieldname));
            console.log(`[Resubmission] Post-merge productDetails keys preserved:`, Object.keys(warrantyData.productDetails));
            console.log(`[Resubmission] Final merged photos:`, JSON.stringify(warrantyData.productDetails.photos));
          } else {
            return res.status(400).json({
              error: `This ${uid ? 'UID' : 'Serial Number'} is already registered.`
            });
          }
        }
      }

      // Check if the UID exists in the pre_generated_uids table and is available
      // SKIP this check for resubmissions (UID was already validated on original submission)
      // SKIP for customer-added fallback UIDs (already resolved to a fresh, unused sequence above)
      if (warrantyData.productType === 'seat-cover' && uid && !isResubmission && !isCustomerAddedUid) {
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

      // Check if registration number already exists for this product category
      if (warrantyData.registrationNumber !== 'APPLIED-FOR') {
        const categoryQuery = `SELECT uid, customer_name FROM warranty_registrations WHERE registration_number = ? AND product_type = ? AND status != 'rejected' AND uid != ?`;
        const categoryParams = [warrantyData.registrationNumber, warrantyData.productType, checkId || ''];

        const [existingCategoryData]: any = await db.execute(categoryQuery, categoryParams);

        if (existingCategoryData.length > 0) {
          return res.status(400).json({
            error: `A registration for this ${warrantyData.productType === 'seat-cover' ? 'Seat Cover' : 'Paint Protection Film (PPF)'} already exists with the same vehicle registration number.`
          });
        }
      }

      // For customer submissions, set status to 'pending_vendor' (needs franchise verification)
      // For vendor/admin submissions, go directly to 'pending_review' (admin review) for resubmissions, otherwise 'pending'
      const baseStatus = req.user.role === 'customer' ? 'pending_vendor' : 'pending';
      // Resubmissions ALWAYS go to 'pending_review' in the staging table
      // (the staging table enum only supports: pending_review, approved, rejected)
      let initialStatus = isResubmission ? 'pending_review' : baseStatus;

      // Use provided UID (for seat covers), Serial Number (for EV products),
      // original checkId (for edits), or generate a new UUID (fallback)
      //
      // A fresh PPF warranty has no id until the transaction below reads its
      // roll's draw count under lock. A PPF resubmission keeps the id the
      // original was filed under, like every other resubmission.
      let warrantyId = isResubmission
        ? checkId
        : (isPPF ? '' : (warrantyData.productDetails.uid || warrantyData.productDetails.serialNumber || uuidv4()));

      // The store this warranty belongs to, by id — see services/warrantyStore.ts.
      const storeResolution = await resolveWarrantyStore({
        manpowerId: warrantyData.manpowerId,
        installerContact: warrantyData.installerContact,
        submitterUserId: req.user.role === 'vendor' ? req.user.id : null,
      });
      if (!storeResolution.ok) {
        return res.status(400).json({ error: storeResolution.error });
      }
      // A correction keeps its store when the form carries nothing to resolve.
      const storeId = storeResolution.storeId ?? existingStoreId;

      // --- FRAUD DETECTION: Calculate fraud score ---
      let fraudScore = 0;
      let fraudFlags = {};
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
            source: req.user.role === 'customer' ? 'customer' : 'franchise',
            exif_lat: exifData.lat, 
            exif_lng: exifData.lng, 
            exif_timestamp: exifData.timestamp, 
            ip_city: ipGeo.city, 
            ip_region: ipGeo.region, 
            ip_lat: ipGeo.lat, 
            ip_lng: ipGeo.lng, 
            submission_time: new Date(),
            userAgent: req.headers['user-agent'] || '',
            all_exif_data: (warrantyData.productDetails as any).allExifData
          },
          storeLocation
        );
        fraudScore = result.trust_percentage;
        fraudFlags = result.flags;
      } catch (err) {
        console.warn('[FraudDetection] Fraud scoring failed:', err);
      }

      // Determine user_id: If vendor/admin is submitting, we ensure a customer profile exists
      let finalUserId = req.user.id;
      
      // For vendor/admin submissions, ensure a customer profile exists (based on mandatory Phone Number)
      if (req.user.role !== 'customer') {
        try {
          const customerPhone = warrantyData.customerPhone.trim();
          const customerEmail = warrantyData.customerEmail ? warrantyData.customerEmail.toLowerCase().trim() : null;
          
          // Prevent franchise from using their own email as customer email
          if (customerEmail && customerEmail === req.user.email.toLowerCase().trim()) {
            return res.status(400).json({ error: "You cannot use your franchise email address as the customer's email. Please use the actual customer's email address." });
          }

          // 1. Try to find existing user by Phone Number (Priority)
          let [existingUsers]: any = await db.execute(
            'SELECT id, email FROM profiles WHERE phone_number = ?',
            [customerPhone]
          );

          // Deliberately NO email fallback — see public.controller.ts. A shared
          // store email would otherwise link this warranty to a different person.

          if (existingUsers.length > 0) {
            finalUserId = existingUsers[0].id;
            
            // Fetch all roles for this user
            const [roles]: any = await db.execute(
              'SELECT role FROM user_roles WHERE user_id = ?',
              [finalUserId]
            );
            
            const userRoles = roles.map((r: any) => r.role);
            
            // Any account that is not purely a customer — admin, franchise,
            // ASM — must not become one. See public.controller.ts.
            if (userRoles.some((r: string) => r !== 'customer')) {
              const matchedBy = 'phone number';
              return res.status(400).json({
                error: `This ${matchedBy} is registered as a franchise or staff account and cannot be used as a customer profile.`
              });
            }

            // Ensure they have the 'customer' role
            if (!userRoles.includes('customer')) {
              await db.execute(
                'INSERT INTO user_roles (id, user_id, role) VALUES (?, ?, "customer")',
                [uuidv4(), finalUserId]
              );
            }
            
            // If email was provided but DB email is null/empty, add it — only when no
            // other profile has it. profiles.email is UNIQUE and stores reuse one
            // address across customers; claiming a taken one failed the whole
            // submission for returning customers. It stays on the warranty either way.
            if (customerEmail && (!existingUsers[0].email)) {
              const [emailTaken]: any = await db.execute(
                'SELECT id FROM profiles WHERE email = ? AND id <> ? LIMIT 1',
                [customerEmail, finalUserId]
              );
              if (emailTaken.length === 0) {
                await db.execute('UPDATE profiles SET email = ? WHERE id = ?', [customerEmail, finalUserId]);
              }
            }
          } else {
            // Create new customer profile based on Phone (and Email if provided)
            // profiles.email is UNIQUE and store emails are shared across many
            // customers, so claim the address only if it is free. See
            // public.controller.ts for the reasoning.
            let profileEmail: string | null = customerEmail || null;
            if (profileEmail) {
              const [emailTaken]: any = await db.execute(
                'SELECT id FROM profiles WHERE email = ? LIMIT 1',
                [profileEmail]
              );
              if (emailTaken.length > 0) {
                console.log(`[Customer] "${profileEmail}" already belongs to another profile — creating ${customerPhone} without an email.`);
                profileEmail = null;
              }
            }

            const newCustomerId = uuidv4();
            await db.execute(
              'INSERT INTO profiles (id, name, email, phone_number) VALUES (?, ?, ?, ?)',
              [newCustomerId, warrantyData.customerName, profileEmail, customerPhone]
            );
            await db.execute(
              'INSERT INTO user_roles (id, user_id, role) VALUES (?, ?, "customer")',
              [uuidv4(), newCustomerId]
            );
            finalUserId = newCustomerId;
            console.log(`✓ Auto-created customer profile for phone: ${customerPhone}`);
          }
        } catch (profileError) {
          console.error('Error auto-creating customer profile:', profileError);
          // Continue with original user_id if profile creation fails to avoid blocking the submission
        }
      }
      
      // Inject submission source for UI display
      warrantyData.productDetails.submissionSource = req.user.role === 'customer' ? 'Customer Dashboard' : 'Franchise Dashboard';

      if (isResubmission) {
        // Use ON DUPLICATE KEY UPDATE for resubmissions to handle subsequent edits before approval
        await db.execute(
          `INSERT INTO warranty_resubmissions 
          (original_uid, user_id, product_type, customer_name, customer_email, customer_phone, 
           customer_address, registration_number, car_make, car_model, car_year, car_colour,
           purchase_date, installer_name, installer_contact, product_details, manpower_id, warranty_type, status,
           exif_lat, exif_lng, exif_timestamp, exif_device, device_fingerprint, submission_ip, ip_city, ip_region, ip_lat, ip_lng, fraud_score, fraud_flags,
           seat_cover_photo_url, car_outer_photo_url, vendor_details_id) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            vendor_details_id = VALUES(vendor_details_id),
            customer_name = VALUES(customer_name),
            customer_email = VALUES(customer_email),
            customer_phone = VALUES(customer_phone),
            customer_address = VALUES(customer_address),
            registration_number = VALUES(registration_number),
            car_make = VALUES(car_make),
            car_model = VALUES(car_model),
            car_year = VALUES(car_year),
            purchase_date = VALUES(purchase_date),
            installer_name = VALUES(installer_name),
            installer_contact = VALUES(installer_contact),
            product_details = VALUES(product_details),
            manpower_id = VALUES(manpower_id),
            status = VALUES(status),
            exif_lat = VALUES(exif_lat),
            exif_lng = VALUES(exif_lng),
            exif_timestamp = VALUES(exif_timestamp),
            exif_device = VALUES(exif_device),
            device_fingerprint = VALUES(device_fingerprint),
            submission_ip = VALUES(submission_ip),
            fraud_score = VALUES(fraud_score),
            fraud_flags = VALUES(fraud_flags),
            seat_cover_photo_url = VALUES(seat_cover_photo_url),
            car_outer_photo_url = VALUES(car_outer_photo_url),
            created_at = CURRENT_TIMESTAMP()`,
          [
            warrantyId, finalUserId, warrantyData.productType, warrantyData.customerName, warrantyData.customerEmail,
            warrantyData.customerPhone, warrantyData.customerAddress, warrantyData.registrationNumber,
            warrantyData.carMake || null, warrantyData.carModel || null, warrantyData.carYear,
            warrantyData.carColour || null, warrantyData.purchaseDate,
            warrantyData.installerName || null, warrantyData.installerContact || null, JSON.stringify(warrantyData.productDetails),
            (warrantyData.manpowerId && warrantyData.manpowerId !== 'owner') ? warrantyData.manpowerId : null,
            warrantyData.warrantyType, initialStatus, exifData.lat, exifData.lng, exifData.timestamp,
            exifData.deviceMake ? `${exifData.deviceMake} ${exifData.deviceModel || ''}`.trim() : null,
            exifData.deviceFingerprint, clientIP, ipGeo.city, ipGeo.region, ipGeo.lat, ipGeo.lng, fraudScore,
            JSON.stringify(fraudFlags), (warrantyData.productDetails as any)?.photos?.seatCover || null,
            (warrantyData.productDetails as any)?.photos?.vehicle || (warrantyData.productDetails as any)?.photos?.carOuter || null,
            storeId
          ]
        );

        /*
         * Record what the resubmission changed.
         *
         * This is the path a store or customer takes through the form itself,
         * as opposed to updateWarranty which the dashboards use — both end in
         * a warranty waiting to be looked at again, so both have to say what
         * was corrected or the review screen shows a rejection with nothing
         * under it.
         *
         * The rejection reason is copied on because the original row keeps it
         * only until the warranty moves on.
         */
        try {
          const [priorRows]: any = await db.execute(
            `SELECT customer_name, customer_email, customer_phone, customer_address,
                    registration_number, car_make, car_model, car_year, car_colour,
                    purchase_date, installer_name, installer_contact, warranty_type,
                    product_details, product_type, rejection_reason, rejected_by
               FROM warranty_registrations WHERE uid = ? LIMIT 1`,
            [warrantyId]
          );
          const prior = priorRows?.[0];

          if (prior) {
            const changes = diffSubmission(
              prior,
              {
                customer_name: warrantyData.customerName,
                customer_email: warrantyData.customerEmail,
                customer_phone: warrantyData.customerPhone,
                customer_address: warrantyData.customerAddress,
                registration_number: warrantyData.registrationNumber,
                car_make: warrantyData.carMake,
                car_model: warrantyData.carModel,
                car_year: warrantyData.carYear,
                car_colour: warrantyData.carColour,
                purchase_date: warrantyData.purchaseDate,
                installer_name: warrantyData.installerName,
                installer_contact: warrantyData.installerContact,
                warranty_type: warrantyData.warrantyType,
                product_details: warrantyData.productDetails,
              },
              prior.product_type
            );

            const who = req.user?.role === 'customer' ? 'The customer' : 'The franchise';

            await ActivityLogService.log({
              adminId: req.user?.id || finalUserId || 'unknown',
              adminName: req.user?.name || undefined,
              adminEmail: req.user?.email || undefined,
              actionType: 'WARRANTY_RESUBMITTED',
              targetType: 'WARRANTY',
              targetId: warrantyId,
              targetName: `${warrantyData.customerName} (${warrantyId})`,
              details: {
                summary: summariseChanges(changes, who),
                rejectionReason: prior.rejection_reason || null,
                rejectedBy: prior.rejected_by || null,
                resubmittedBy: req.user?.role || 'unknown',
                changes,
              },
              ipAddress: clientIP
            });
          }
        } catch (err: any) {
          // Never let the record-keeping fail the correction itself.
          console.error('[Resubmission] Could not log the change set:', err?.message);
        }
      } else {
        /*
         * The warranty row and the roll draws it creates have to land together:
         * charging a roll for a warranty that then fails to insert would consume
         * area no vehicle ever used, and the reverse would let a roll be spent
         * twice.
         *
         * A resubmission never reaches here — it goes to the staging table
         * above and draws nothing, because the original already charged the
         * roll and is still holding that area.
         *
         * Seat covers declare no rolls, so reserveRolls is never called and the
         * statement below is the one that always ran; only its connection
         * differs.
         */
        const { insertResult, warrantyId: insertedWarrantyId } = await withRollRetry(() => withTransaction(async (conn) => {
          let uidForInsert = warrantyId;

          if (isPPF) {
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
            uidForInsert, finalUserId, warrantyData.productType, warrantyData.customerName, warrantyData.customerEmail,
            warrantyData.customerPhone, warrantyData.customerAddress, warrantyData.registrationNumber,
            warrantyData.carMake || null, warrantyData.carModel || null, warrantyData.carYear,
            warrantyData.carColour || null, warrantyData.purchaseDate,
            warrantyData.installerName || null, warrantyData.installerContact || null, JSON.stringify(warrantyData.productDetails),
            (warrantyData.manpowerId && warrantyData.manpowerId !== 'owner') ? warrantyData.manpowerId : null,
            warrantyData.warrantyType, initialStatus, exifData.lat, exifData.lng, exifData.timestamp,
            exifData.deviceMake ? `${exifData.deviceMake} ${exifData.deviceModel || ''}`.trim() : null,
            exifData.deviceFingerprint, clientIP, ipGeo.city, ipGeo.region, ipGeo.lat, ipGeo.lng, fraudScore,
            JSON.stringify(fraudFlags), (warrantyData.productDetails as any)?.photos?.seatCover || null,
            (warrantyData.productDetails as any)?.photos?.vehicle || (warrantyData.productDetails as any)?.photos?.carOuter || null,
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
        // refers to this one.
        warrantyId = insertedWarrantyId;

        // Log the action to the immutable analytics_events table. Shared with the
        // QR path so both registration routes record the event the same way.
        await recordRegistrationEvent(insertResult.insertId, warrantyData.customerName);
      }

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

      // ── Franchise Verify Notification (pending_vendor only) ────────────────
      if (initialStatus === 'pending_vendor' && warrantyData.installerContact) {
        let vendorEmail = warrantyData.installerContact;
        if (vendorEmail.includes('|')) {
          vendorEmail = vendorEmail.split('|')[0].trim();
        }

        // 1. Try WhatsApp first (with Approve/Reject buttons)
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

        // 2. Email fallback — only if WhatsApp didn't send
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
              warrantyData.customerName,
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

      // ── Customer Submission Notification ──────────────────────────────────
      // WhatsApp first; email only as fallback
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

      // Email fallback — send if WhatsApp didn't fire
      if (!customerWaSent && warrantyData.customerEmail && warrantyData.customerEmail.trim()) {
        try {
          await EmailService.sendWarrantyConfirmation(
            warrantyData.customerEmail,
            warrantyData.customerName,
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

      // ── Admin Notification ────────────────────────────────────────────────
      try {
        await NotificationService.broadcast({
          title: `New Warranty Registration`,
          message: `New ${warrantyData.productType} warranty registered by ${warrantyData.installerName || warrantyData.customerName}`,
          type: 'warranty',
          link: `/admin/verifications?uid=${uid}`,
          targetUsers: [],
          targetRole: 'admin'
        });
      } catch (err) {
        console.error('Failed to send admin notification', err);
      }

      // Notify Vendor/Franchise if warranty was registered through their store
      try {
        let vendorUserId: string | null = null;
        let storeName: string | null = null;

        if (storeId) {
          const [store]: any = await db.execute(
            'SELECT user_id, store_name FROM vendor_details WHERE id = ?',
            [storeId]
          );
          if (store.length > 0) {
            vendorUserId = store[0].user_id;
            storeName = store[0].store_name;
          }
        }

        // Send notification if vendor was found
        if (vendorUserId) {
          await NotificationService.notify(vendorUserId, {
            title: 'New Warranty Registration',
            message: `A new ${warrantyData.productType} warranty has been registered through your store for ${warrantyData.customerName}.`,
            type: 'warranty',
            link: `/dashboard/vendor`
          });
          console.log(`✓ Notified vendor ${storeName} about new warranty`);
        }
      } catch (err) {
        console.error('Failed to send vendor notification', err);
      }

      res.status(201).json({
        success: true,
        message: 'Warranty registration submitted successfully',
        // `uid` is the seat cover's pre-printed identifier and is null for PPF,
        // whose identifier is the warranty id decided at insert. Falling back to
        // it lets both products report what was actually registered.
        uid: uid || warrantyId,
        registrationNumber: uid || warrantyId,
        warrantyId
      });
    } catch (error: any) {
      // A roll that cannot cover the area asked of it is the installer's to
      // correct, not an internal fault — it keeps its own message and status.
      if (error instanceof RollUnavailableError) {
        return res.status(400).json({ error: error.message, failedSerial: error.failedSerial });
      }
      console.error('Warranty submission error:', error);
      res.status(500).json({ error: 'Failed to submit warranty registration' });
    }
  }

  static async getWarranties(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      // Pagination parameters
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 30;
      const offset = (page - 1) * limit;

      // Extract Filters from Query
      const { status, search, product_type, make, date_from, date_to } = req.query;

      let conditions: string[] = [];
      let params: any[] = [];

      // 1. Role-based Security Filters (Base Filters)
      if (req.user.role === 'customer') {
        conditions.push('w.user_id = ?');
        params.push(req.user.id);
      }
      else if (req.user.role === 'vendor') {
        // The store's warranties by store id — never by name, which another
        // store can share. See services/warrantyStore.ts.
        const scope = await vendorWarrantyScope(req.user.id, 'w');
        conditions.push(scope.sql);
        params.push(...scope.params);
      }
      else if (req.user.role !== 'admin') {
        // Default deny. Only admins are meant to read unscoped; any other role
        // falling through used to mean "no WHERE clause", i.e. the whole table.
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      // 2. Apply Dynamic Filters

      // Status Mapping (Frontend Tab -> DB Status)
      if (status && status !== 'all') {
        if (status === 'pending') {
          conditions.push("(w.status = 'pending_vendor' OR w.status = 'pending')");
        } else if (status === 'pending_ho') {
          conditions.push("w.status = 'pending'");
        } else {
          conditions.push('w.status = ?');
          params.push(status);
        }
      }

      // Product Type
      if (product_type && product_type !== 'all') {
        conditions.push('w.product_type = ?');
        params.push(product_type);
      }

      // Car Make
      if (make && make !== 'all') {
        conditions.push('w.car_make = ?');
        params.push(make);
      }

      // Car Model (New)
      const { model } = req.query;
      if (model && model !== 'all') {
        conditions.push('w.car_model = ?');
        params.push(model);
      }

      // Search (Multi-column)
      if (search) {
        const searchTerm = `%${search}%`;
        conditions.push(`(
          w.customer_name LIKE ? OR 
          w.customer_phone LIKE ? OR 
          w.uid LIKE ? OR 
          w.registration_number LIKE ? OR 
          w.car_make LIKE ? OR 
          w.car_model LIKE ?
        )`);
        params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
      }

      // Date Range
      if (date_from && date_to) {
        conditions.push('w.created_at BETWEEN ? AND ?');
        params.push(new Date(date_from as string), new Date(date_to as string));
      }

      // 3. Build & Execute Queries
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Count Query (Matches Filtes)
      const countQuery = `SELECT COUNT(*) as total FROM warranty_registrations w ${whereClause}`;
      const [countResult]: any = await db.execute(countQuery, params);
      const totalCount = countResult[0].total;
      const totalPages = Math.ceil(totalCount / limit);

      // Data Query (Matches Filters + Pagination)
      const baseQuery = `
        SELECT 
            w.*, 
            m.name as manpower_name_from_db,
            vp.phone_number as vendor_phone_number,
            vd.city as vendor_city,
            vd.store_name as vendor_store_name,
            vd.state as vendor_state
        FROM warranty_registrations w 
        LEFT JOIN manpower m ON w.manpower_id = m.id
        LEFT JOIN vendor_details vd ON vd.id = w.vendor_details_id
        LEFT JOIN profiles vp ON vd.user_id = vp.id
        ${whereClause}
        ORDER BY w.created_at DESC 
        LIMIT ? OFFSET ?
      `; // Limit/Offset added via params

      const mainParams = [...params, limit, offset];
      const [warranties]: any = await db.execute(baseQuery, mainParams);

      // Parse JSON product_details
      const formattedWarranties = warranties.map((warranty: any) => ({
        ...warranty,
        product_details: JSON.parse(warranty.product_details)
      }));

      res.json({
        success: true,
        warranties: formattedWarranties,
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
      console.error('Get warranties error:', error);
      res.status(500).json({ error: 'Failed to fetch warranties' });
    }
  }

  static async getDashboardStats(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      let conditions: string[] = [];
      let params: any[] = [];

      // 1. Role-based Security (Access Control)
      if (req.user.role === 'customer') {
        conditions.push('user_id = ?');
        params.push(req.user.id);
      } else if (req.user.role === 'vendor') {
        const scope = await vendorWarrantyScope(req.user.id);
        conditions.push(scope.sql);
        params.push(...scope.params);
      }
      else if (req.user.role !== 'admin') {
        // Default deny — see getWarranties.
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      // 2. Build Where Clause
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // 3. Execute Count Query with Group By Status
      const query = `
        SELECT 
          status, 
          COUNT(*) as count 
        FROM warranty_registrations 
        ${whereClause} 
        GROUP BY status
      `;

      const [rows]: any = await db.execute(query, params);

      // 4. Format Result
      const stats = {
        pending_vendor: 0,
        pending: 0,
        validated: 0,
        rejected: 0
      };

      rows.forEach((row: any) => {
        if (stats.hasOwnProperty(row.status)) {
          (stats as any)[row.status] = row.count;
        }
      });

      /* For the franchise home: registered this calendar month and last, and
         each day since the start of last month (the home's today / this week /
         this month switch compares against the same days before). created_at
         already reads in IST (the pool's session zone), so no conversion. */
      const [[months]]: any = await db.execute(
        `SELECT
           COALESCE(SUM(created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')), 0) AS this_month,
           COALESCE(SUM(created_at >= DATE_FORMAT(CURDATE() - INTERVAL 1 MONTH, '%Y-%m-01')
                    AND created_at < DATE_FORMAT(CURDATE(), '%Y-%m-01')), 0) AS last_month
         FROM warranty_registrations ${whereClause}`,
        params
      );
      const [days]: any = await db.execute(
        `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day, COUNT(*) AS n
           FROM warranty_registrations ${whereClause ? `${whereClause} AND` : 'WHERE'} created_at >= DATE_FORMAT(CURDATE() - INTERVAL 1 MONTH, '%Y-%m-01')
          GROUP BY day ORDER BY day`,
        params
      );

      res.json({
        success: true,
        stats: {
          ...stats,
          this_month: Number(months?.this_month ?? 0),
          last_month: Number(months?.last_month ?? 0),
          daily: days.map((d: any) => ({ day: d.day, n: Number(d.n) })),
        }
      });

    } catch (error: any) {
      console.error('Get dashboard stats error:', error);
      res.status(500).json({ error: 'Failed to fetch dashboard stats' });
    }
  }

  static async getWarrantyById(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const { uid } = req.params;

      let query = 'SELECT * FROM warranty_registrations WHERE (uid = ? OR id = ?)';
      let params: any[] = [uid, uid];

      // If customer, ensure they own this warranty
      if (req.user.role === 'customer') {
        query += ' AND user_id = ?';
        params.push(req.user.id);
      } else if (req.user.role === 'vendor') {
        // SBP-004: a franchise reads its own store's warranties, plus any that a
        // grievance assigned to its store points at (the grievance screen opens
        // them through this route). Anything else answers 404, not 403, so the
        // response does not confirm that another store's warranty exists.
        const scope = await vendorWarrantyScope(req.user.id);
        query += ` AND (${scope.sql} OR uid IN (
          SELECT g.warranty_uid FROM grievances g
          JOIN vendor_details vd ON vd.id = g.franchise_id
          WHERE vd.user_id = ? AND g.warranty_uid IS NOT NULL))`;
        params.push(...scope.params, req.user.id);
      } else if (req.user.role !== 'admin') {
        // Default deny — an unrecognised role must never read unscoped.
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const [warranties]: any = await db.execute(query, params);

      if (warranties.length === 0) {
        return res.status(404).json({ error: 'Warranty not found' });
      }

      const warranty = {
        ...warranties[0],
        product_details: JSON.parse(warranties[0].product_details)
      };

      res.json({
        success: true,
        warranty
      });
    } catch (error: any) {
      console.error('Get warranty by UID error:', error);
      res.status(500).json({ error: 'Failed to fetch warranty' });
    }
  }

  static async updateWarranty(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const { uid } = req.params;

      // Handle FormData
      let warrantyData: ExtendedWarrantyData = req.body;
      if (typeof warrantyData.productDetails === 'string') {
        try {
          warrantyData.productDetails = JSON.parse(warrantyData.productDetails);
        } catch (e) {
          console.error('Failed to parse productDetails string:', e);
          return res.status(400).json({ error: 'Invalid productDetails format' });
        }
      }

      // Handle uploaded files
      const files = req.files as Express.Multer.File[];
      if (files && files.length > 0) {
        files.forEach(file => {
          if (file.fieldname === 'invoiceFile') {
            warrantyData.productDetails.invoiceFileName = file.path;
          } else if (['lhsPhoto', 'rhsPhoto', 'frontRegPhoto', 'backRegPhoto', 'warrantyPhoto', 'vehiclePhoto', 'seatCoverPhoto'].includes(file.fieldname)) {
            if (!warrantyData.productDetails.photos) {
              warrantyData.productDetails.photos = {};
            }
            const photoKey = file.fieldname.replace('Photo', '');
            let key = photoKey;
            if (file.fieldname === 'frontRegPhoto') key = 'frontReg';
            if (file.fieldname === 'backRegPhoto') key = 'backReg';

            (warrantyData.productDetails.photos as any)[key] = file.path;
          }
        });
      }

      // Validate required fields (same as submit)
      // Customer email is optional for vendors uploading on behalf of customers
      if (!warrantyData.productType || !warrantyData.customerName ||
        !warrantyData.customerPhone ||
        !warrantyData.customerAddress || !warrantyData.registrationNumber ||
        !warrantyData.carYear ||
        !warrantyData.purchaseDate || !warrantyData.warrantyType) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // Customer email is required for customers, optional for vendors
      /* 
      if (req.user.role === 'customer' && !warrantyData.customerEmail) {
        return res.status(400).json({ error: 'Customer email is required' });
      }
      */

      // Check if warranty exists and belongs to user (or user is admin/vendor linked)
      // For simplicity, we'll check ownership via user_id for now as per getWarrantyById logic
      // Support both uid (seat-cover, VARCHAR) and id (EV products, INT AUTO_INCREMENT) for lookup.
      //
      // IMPORTANT: `uid` is VARCHAR and `id` is INT. A naive `WHERE uid = ? OR id = ?`
      // makes MySQL coerce the VARCHAR `uid` column to a number when the param is
      // numeric — any non-numeric uid coerces to 0, so a numeric lookup could
      // silently match unrelated rows. That was the root cause of the "one edit
      // filled every entry" incident. We therefore match `id` ONLY when the
      // identifier is a pure integer, and always match `uid` as an exact string.
      const isNumericId = /^\d+$/.test(String(uid));
      let checkQuery: string;
      let checkParams: any[];
      if (isNumericId) {
        // Could be a seat-cover UID (numeric string) OR an EV numeric id.
        // Match uid as an exact string and id as an exact integer — no coercion.
        // Every field the resubmission diff compares against, not just the
        // ones the update itself needs: selecting eight columns left the
        // rest undefined, so a correction reported every field as having
        // been empty before it.
        checkQuery = 'SELECT id, uid, user_id, status, product_details, manpower_id, installer_name, installer_contact, customer_name, customer_email, customer_phone, customer_address, registration_number, car_make, car_model, car_year, car_colour, purchase_date, warranty_type, product_type, rejection_reason, rejected_by, vendor_details_id FROM warranty_registrations WHERE uid = CAST(? AS CHAR) OR id = ?';
        checkParams = [String(uid), Number(uid)];
      } else {
        // Non-numeric identifier can only be a uid/serial string.
        checkQuery = 'SELECT id, uid, user_id, status, product_details, manpower_id, installer_name, installer_contact, customer_name, customer_email, customer_phone, customer_address, registration_number, car_make, car_model, car_year, car_colour, purchase_date, warranty_type, product_type, rejection_reason, rejected_by, vendor_details_id FROM warranty_registrations WHERE uid = ?';
        checkParams = [String(uid)];
      }

      const [warranties]: any = await db.execute(checkQuery, checkParams);

      if (warranties.length === 0) {
        return res.status(404).json({ error: 'Warranty not found' });
      }

      // Defense in depth: the identifier must resolve to exactly one record.
      // If it somehow matches more than one, refuse rather than risk updating
      // multiple registrations from a single edit.
      if (warranties.length > 1) {
        console.error(`[Update Warranty] Ambiguous identifier "${uid}" matched ${warranties.length} rows. Aborting to prevent mass update.`);
        return res.status(409).json({ error: 'This identifier matches multiple registrations. Please contact support.' });
      }

      const warranty = warranties[0];

      // Authorization check: Only allow update if user owns it, is admin, or is a linked vendor
      let isAuthorized = req.user.role === 'admin' || warranty.user_id === req.user.id;

      // A franchise may edit its own store's warranty — by store id, never by
      // name, which another store can share.
      if (!isAuthorized && req.user.role === 'vendor' && warranty.vendor_details_id) {
        const [vendorDetails]: any = await db.execute(
          'SELECT id FROM vendor_details WHERE user_id = ?',
          [req.user.id]
        );
        if (vendorDetails.length > 0 && vendorDetails[0].id === warranty.vendor_details_id) {
          isAuthorized = true;
        }
      }

      if (!isAuthorized) {
        return res.status(403).json({ error: 'Not authorized to update this warranty' });
      }

      // Only allow updating if status is 'rejected' for non-admins
      if (req.user.role !== 'admin' && warranty.status !== 'rejected') {
        return res.status(400).json({ error: 'Only rejected warranties can be edited' });
      }

      // Only allow updating if status is 'rejected' (or maybe 'pending' if we want to allow corrections before approval)
      // For now, let's allow it for rejected and pending.
      if (warranty.status === 'validated') {
        return res.status(400).json({ error: 'Cannot update a validated warranty' });
      }

      // Merge existing product details with new ones to preserve existing photos if not re-uploaded
      const existingProductDetails = JSON.parse(warranty.product_details || '{}');

      // If new photos are uploaded, they are already in warrantyData.productDetails via the file handling above
      // But if NOT uploaded, we want to keep existing ones.
      // However, warrantyData.productDetails might be incomplete if we just parsed it from a partial update?
      // Actually, the frontend usually sends the full object.
      // But for files, they are null in the JSON if not re-uploaded.

      if (warrantyData.productType === 'ev-products') {
        if (!warrantyData.productDetails.photos) warrantyData.productDetails.photos = {};

        // Helper to preserve existing photo if new one is not provided (which means it's null/undefined in the upload)
        // But wait, if it's not in req.files, we didn't update it above.
        // So we just need to make sure we don't overwrite with null if the frontend sent null for "no change"

        const photoKeys = ['lhs', 'rhs', 'frontReg', 'backReg', 'warranty'];
        photoKeys.forEach(key => {
          // If we didn't get a new file for this key (so it's not in warrantyData.productDetails.photos from the file loop)
          // AND the frontend didn't send a string value (which it shouldn't for files),
          // Then we should probably keep the old value.
          // But the frontend might send the OLD filename as a string if it's just passing data back?
          // Let's assume frontend sends null for no change, or the old filename.

          // If it's in the file loop, it's updated.
          // If not, check if we have it in existing.
          if (!(warrantyData.productDetails.photos as any)[key] && existingProductDetails.photos?.[key]) {
            (warrantyData.productDetails.photos as any)[key] = existingProductDetails.photos[key];
          }
        });
      } else {
        // Seat cover
        if (!warrantyData.productDetails.photos) warrantyData.productDetails.photos = {};
          
        if (!warrantyData.productDetails.invoiceFileName && existingProductDetails.invoiceFileName) {
          warrantyData.productDetails.invoiceFileName = existingProductDetails.invoiceFileName;
        }
        
        // Ensure seat-cover internal photos are preserved! This caused the UI corruption earlier!
        const seatCoverKeys = ['vehicle', 'seatCover', 'carOuter'];
        seatCoverKeys.forEach(key => {
          if (!(warrantyData.productDetails.photos as any)[key] && existingProductDetails.photos?.[key]) {
             (warrantyData.productDetails.photos as any)[key] = existingProductDetails.photos[key];
          }
        });
      }

      // Preserve all other top-level fields (like allExifData, exifData) if omitted from the new request
      console.log(`[Update Warranty] Pre-merge incoming keys:`, Object.keys(warrantyData.productDetails));
      console.log(`[Update Warranty] Pre-merge existing keys:`, Object.keys(existingProductDetails));
      
      Object.keys(existingProductDetails).forEach(key => {
        if (key !== 'photos' && key !== 'invoiceFileName') {
          if ((warrantyData.productDetails as any)[key] == null) {
            (warrantyData.productDetails as any)[key] = existingProductDetails[key];
          }
        }
      });

      console.log(`[Update Warranty] Post-merge final keys:`, Object.keys(warrantyData.productDetails));
      console.log(`[Update Warranty] Final merged photos:`, JSON.stringify(warrantyData.productDetails.photos));

      // Update warranty details
      // Determine status based on who is updating and current status
      // If it's already pending or validated, preserve the status. 
      // Only transition to pending if it was previously rejected.
      let updatedStatus = warranty.status;
      let clearRejectionReason = false;

      if (warranty.status === 'rejected') {
        // If customer edits, go back to franchise review (pending_vendor)
        // If franchise/vendor edits, go straight to admin review (pending)
        updatedStatus = req.user.role === 'customer' ? 'pending_vendor' : 'pending';
        clearRejectionReason = true;
      }

      // Use the warranty's actual id from the found record for update
      const warrantyRecordId = warranty.id;

      // CRITICAL SAFETY CHECK: Ensure we have a valid ID before updating to prevent mass update
      if (!warrantyRecordId) {
        console.error('CRITICAL: warrantyRecordId is null/undefined during update! Aborting to prevent mass update.');
        return res.status(500).json({ error: 'Internal error: Warranty ID not found for update' });
      }

      // Re-resolve the store from what the edit now says, keeping the current
      // one when the form carries nothing that names a store.
      const effectiveManpowerId = (warrantyData.manpowerId && warrantyData.manpowerId !== 'owner')
        ? warrantyData.manpowerId
        : (warranty.manpower_id && warranty.manpower_id !== 'owner' ? warranty.manpower_id : null);
      const storeResolution = await resolveWarrantyStore({
        manpowerId: effectiveManpowerId,
        installerContact: warrantyData.installerContact,
        submitterUserId: req.user.role === 'vendor' ? req.user.id : null,
      });
      if (!storeResolution.ok) {
        return res.status(400).json({ error: storeResolution.error });
      }
      const storeId = storeResolution.storeId ?? warranty.vendor_details_id ?? null;

      await db.execute(
        `UPDATE warranty_registrations SET
         vendor_details_id = ?,
         product_type = ?, customer_name = ?, customer_email = ?, customer_phone = ?,
         customer_address = ?, registration_number = ?, car_make = ?, car_model = ?, car_year = ?,
         car_colour = ?, purchase_date = ?, installer_name = ?,
         installer_contact = ?, product_details = ?, manpower_id = ?, warranty_type = ?,
         seat_cover_photo_url = ?, car_outer_photo_url = ?,
         status = ?, rejection_reason = ${clearRejectionReason ? 'NULL' : 'rejection_reason'}
         WHERE id = ?`,
        [
          storeId,
          warrantyData.productType,
          warrantyData.customerName,
          warrantyData.customerEmail,
          warrantyData.customerPhone,
          warrantyData.customerAddress,
          warrantyData.registrationNumber,
          warrantyData.carMake || null,
          warrantyData.carModel || null,
          warrantyData.carYear,
          warrantyData.carColour || null,
          warrantyData.purchaseDate,
          warrantyData.installerName || null,
          warrantyData.installerContact || null,
          JSON.stringify(warrantyData.productDetails),
          (warrantyData.manpowerId && warrantyData.manpowerId !== 'owner') ? warrantyData.manpowerId : (warranty.manpower_id && warranty.manpower_id !== 'owner' ? warranty.manpower_id : null),
          warrantyData.warrantyType,
          (warrantyData.productDetails.photos as any)?.seatCover || null,
          (warrantyData.productDetails.photos as any)?.vehicle || (warrantyData.productDetails.photos as any)?.carOuter || null,
          updatedStatus,
          warrantyRecordId
        ]
      );

      /*
       * Record a resubmission, so the rejection and the fix read as one chain.
       *
       * Only when the warranty was rejected: an ordinary edit to a pending
       * warranty is not somebody answering an objection, and logging those
       * here would bury the ones that are.
       *
       * The rejection reason is copied onto this entry. The UPDATE above
       * clears it from the warranty row — correctly, it no longer applies —
       * so without carrying it here a reader would see what changed but not
       * what was asked for.
       */
      if (warranty.status === 'rejected') {
        try {
          const changes = diffSubmission(
            warranty,
            {
              customer_name: warrantyData.customerName,
              customer_email: warrantyData.customerEmail,
              customer_phone: warrantyData.customerPhone,
              customer_address: warrantyData.customerAddress,
              registration_number: warrantyData.registrationNumber,
              car_make: warrantyData.carMake,
              car_model: warrantyData.carModel,
              car_year: warrantyData.carYear,
              car_colour: warrantyData.carColour,
              purchase_date: warrantyData.purchaseDate,
              installer_name: warrantyData.installerName,
              installer_contact: warrantyData.installerContact,
              warranty_type: warrantyData.warrantyType,
              product_details: warrantyData.productDetails,
            },
            warranty.product_type
          );

          const who = req.user?.role === 'customer' ? 'The customer' : 'The franchise';

          await ActivityLogService.log({
            adminId: req.user?.id || 'unknown',
            adminName: req.user?.name || undefined,
            adminEmail: req.user?.email || undefined,
            actionType: 'WARRANTY_RESUBMITTED',
            targetType: 'WARRANTY',
            targetId: warranty.uid,
            targetName: `${warranty.customer_name} (${warranty.uid})`,
            details: {
              summary: summariseChanges(changes, who),
              rejectionReason: warranty.rejection_reason || null,
              rejectedBy: warranty.rejected_by || null,
              resubmittedBy: req.user?.role || 'unknown',
              changes,
            },
            ipAddress: req.ip || req.socket?.remoteAddress
          });
        } catch (err: any) {
          // Never let the record-keeping fail the correction itself.
          console.error('[Resubmission] Could not log the change set:', err?.message);
        }
      }

      // --- Notifications ---
      const warrantyUid = warranty.uid;

      // 1. Notify the Customer (Owner)
      try {
        if (warranty.user_id) {
          await NotificationService.notify(warranty.user_id, {
            title: 'Warranty Resubmitted',
            message: `Your warranty registration (${warrantyUid}) has been updated and resubmitted for review.`,
            type: 'warranty',
            link: `/warranty/view/${warrantyUid}`
          });
        }

        // Email Confirmation to Customer
        if (warrantyData.customerEmail && warrantyData.customerEmail.trim()) {
          await EmailService.sendWarrantyResubmittedConfirmation(
            warrantyData.customerEmail,
            warrantyData.customerName,
            warrantyUid,
            warrantyData.productType,
            warrantyData.registrationNumber,
            warrantyData.carMake,
            warrantyData.carModel,
            warrantyData.productDetails
          );
        }
      } catch (e) {
        console.error('Failed to notify customer of warranty update', e);
      }

      // 2. Notify Admin
      try {
        const resubmittedBy = req.user.role === 'customer' ? 'the customer' : 'the franchise';
        const awaitingReview = updatedStatus === 'pending_vendor' ? 'franchise' : 'admin';
        
        await NotificationService.broadcast({
          title: 'Warranty Resubmitted',
          message: `Warranty ${warrantyUid} has been resubmitted by ${resubmittedBy} (${warrantyData.customerName}) and is awaiting ${awaitingReview} review.`,
          type: 'warranty',
          link: `/admin/verifications?uid=${warrantyUid}`,
          targetUsers: [],
          targetRole: 'admin'
        });
      } catch (err) {
        console.error('Failed to send admin notification for update', err);
      }

      // 3. Notify Vendor/Franchise
      try {
        let vendorUserId: string | null = null;
        let storeName: string | null = null;

        if (storeId) {
          const [store]: any = await db.execute(
            'SELECT user_id, store_name FROM vendor_details WHERE id = ?',
            [storeId]
          );
          if (store.length > 0) {
            vendorUserId = store[0].user_id;
            storeName = store[0].store_name;
          }
        }

        if (vendorUserId && vendorUserId !== req.user.id) {
          // In-app notification
          await NotificationService.notify(vendorUserId, {
            title: 'Warranty Updated',
            message: `The warranty for ${warrantyData.customerName} (${warrantyUid}) has been resubmitted and requires your verification.`,
            type: 'warranty',
            link: `/dashboard/vendor`
          });

          // Email notification (Only if customer edited)
          if (req.user.role === 'customer') {
            const [vendorEmailInfo]: any = await db.execute(
              'SELECT store_email, store_name FROM vendor_details WHERE user_id = ?',
              [vendorUserId]
            );
            if (vendorEmailInfo.length > 0) {
              await EmailService.sendVendorResubmissionNotification(
                vendorEmailInfo[0].store_email,
                vendorEmailInfo[0].store_name,
                warrantyData.customerName,
                warrantyUid,
                warrantyData.productType,
                warrantyData.registrationNumber
              );
            }
          }
          console.log(`✓ Notified vendor ${storeName} about warranty update`);
        }
      } catch (err) {
        console.error('Failed to send vendor notification for update', err);
      }

      res.json({
        success: true,
        message: 'Warranty updated and resubmitted successfully'
      });


    } catch (error: any) {
      console.error('Update warranty error:', error);
      res.status(500).json({ error: 'Failed to update warranty' });
    }
  }
}