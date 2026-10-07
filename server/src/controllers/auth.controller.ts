import { Request, Response, CookieOptions } from 'express';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import db, { executeWithRetry, isTransientDbError } from '../config/database.js';
import { EmailService } from '../services/email.service.js';
import { OTPService } from '../services/otp.service.js';
import { WhatsAppService } from '../services/whatsapp.service.js';
import { ActivityLogService } from '../services/activity-log.service.js';
import { NotificationService } from '../services/notification.service.js';
import { signalAdminAttention } from '../services/adminAttention.service.js';
import { RegisterData } from '../types/index.js';
import { canonicalState } from '../services/indianStates.js';
import dotenv from 'dotenv';

dotenv.config();

// Validation regex patterns
const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const PINCODE_REGEX = /^\d{6}$/;
/** Indian GSTIN: 2-digit state code, 10-character PAN, entity digit, 'Z', checksum. */
const GST_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

/**
 * Collapse whitespace and settle the casing of a typed place name.
 *
 * Only whitespace and casing: correcting spelling is guesswork, and a fixed
 * list would reject the three to five genuinely new towns that register each
 * month — Pampore, Abohar and Dehgam were all recent first-time entries.
 */
const titleCasePlace = (value: string): string =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());

const getRoleBasedCookieMaxAge = (role?: string): number => {
  const roleDefaults: Record<string, number> = {
    admin: 7 * 24 * 60 * 60 * 1000,
    customer: 7 * 24 * 60 * 60 * 1000,
    vendor: 30 * 24 * 60 * 60 * 1000,
    // In the field on their phones, like franchises.
    asm: 30 * 24 * 60 * 60 * 1000
  };

  const envOverride =
    role === 'admin'
      ? process.env.AUTH_COOKIE_MAX_AGE_ADMIN_MS
      : role === 'vendor'
        ? process.env.AUTH_COOKIE_MAX_AGE_VENDOR_MS
        : role === 'customer'
          ? process.env.AUTH_COOKIE_MAX_AGE_CUSTOMER_MS
          : role === 'asm'
            ? process.env.AUTH_COOKIE_MAX_AGE_ASM_MS
            : process.env.AUTH_COOKIE_MAX_AGE_MS;

  const parsed = Number(envOverride);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  return roleDefaults[role || 'customer'] || roleDefaults.customer;
};

const getAuthCookieOptions = (role?: string): CookieOptions => {
  const isProduction = process.env.NODE_ENV === 'production';
  const secure = process.env.SESSION_COOKIE_SECURE
    ? process.env.SESSION_COOKIE_SECURE === 'true'
    : isProduction;

  let sameSite = (process.env.SESSION_COOKIE_SAMESITE as 'lax' | 'strict' | 'none' | undefined)
    ?? (secure ? 'none' : 'lax');

  // Browsers reject SameSite=None cookies unless Secure is true.
  if (!secure && sameSite === 'none') {
    sameSite = 'lax';
  }

  const maxAgeMs = getRoleBasedCookieMaxAge(role);

  return {
    httpOnly: true,
    secure,
    sameSite,
    path: '/',
    maxAge: maxAgeMs
  };
};

export class AuthController {
  static async register(req: Request, res: Response) {
    try {
      let {
        name, email, phoneNumber, role,
        storeName, address, state, city, pincode, gstNumber, manpower
      }: RegisterData = req.body;

      // SBP-DB: Trim string lengths to prevent database overflow (Data Too Long) edge cases
      name = name?.substring(0, 100);
      gstNumber = gstNumber ? String(gstNumber).trim().toUpperCase().substring(0, 20) : undefined;
      email = email?.substring(0, 100);
      storeName = storeName?.substring(0, 255);
      /*
       * Collapse the whitespace and settle the casing before anything is stored.
       *
       * These arrived as free text and accumulated "Nasik ", "Madhay pradesh "
       * and "Jammu  Kashmir" — each stray space became its own entry in every
       * city and state filter. The state is additionally resolved to a canonical
       * spelling, which is what ASM lead-routing matches against.
       */
      city = city ? titleCasePlace(city).substring(0, 100) : city;
      state = state ? canonicalState(String(state)).substring(0, 100) : state;
      address = address?.substring(0, 1000);
      pincode = pincode?.substring(0, 20);

      // Validate input
      if (!name || !email || !phoneNumber || !role) {
        return res.status(400).json({ error: 'All fields are required' });
      }

      // SBP-001: Block admin self-registration — admins can only be created via admin endpoint
      if (role === 'admin') {
        return res.status(403).json({ error: 'Admin accounts cannot be created through public registration' });
      }

      // Validate email format
      if (!EMAIL_REGEX.test(email)) {
        return res.status(400).json({ error: 'Please enter a valid email address' });
      }

      // Validate Indian mobile number (clean it first)
      let cleanedPhone = phoneNumber.replace(/[\s\-+]/g, '');
      if (cleanedPhone.length === 12 && cleanedPhone.startsWith('91')) {
        cleanedPhone = cleanedPhone.substring(2);
      } else if (cleanedPhone.length === 11 && cleanedPhone.startsWith('0')) {
        cleanedPhone = cleanedPhone.substring(1);
      }
      if (!INDIAN_MOBILE_REGEX.test(cleanedPhone)) {
        return res.status(400).json({ error: 'Please enter a valid 10-digit Indian mobile number (must start with 6-9)' });
      }

      // Validate vendor specific fields
      if (role === 'vendor') {
        if (!storeName || !address || !state || !city || !pincode) {
          return res.status(400).json({ error: 'All vendor details are required' });
        }

        // Validate pincode
        if (!PINCODE_REGEX.test(pincode)) {
          return res.status(400).json({ error: 'Pincode must be 6 digits' });
        }

        /*
         * GST is required for new franchises.
         *
         * Existing stores are not held to this — about 39% registered before
         * the field existed, and they are edited through the admin screens,
         * which is why the rule lives here rather than in a shared validator.
         */
        if (!gstNumber) {
          return res.status(400).json({ error: 'GST number is required' });
        }
        if (!GST_REGEX.test(gstNumber)) {
          return res.status(400).json({ error: 'Please enter a valid 15-character GST number' });
        }
      }

      // Clean up expired pending registrations first
      await db.execute('DELETE FROM pending_registrations WHERE expires_at < NOW()');

      // Check if user already exists in ACTUAL profiles table (verified users only)
      // A store email must be unique too — it is how a warranty finds its
      // store when no installer was picked (services/warrantyStore.ts).
      const [existingUsers]: any = await db.execute(
        'SELECT id FROM profiles WHERE email = ? UNION SELECT id FROM vendor_details WHERE store_email = ?',
        [email, email]
      );

      if (existingUsers.length > 0) {
        return res.status(400).json({ error: 'Email already registered' });
      }

      // Check if phone number already exists
      const [existingPhones]: any = await db.execute(
        'SELECT id FROM profiles WHERE phone_number = ?',
        [cleanedPhone]
      );

      if (existingPhones.length > 0) {
        return res.status(400).json({ error: 'Phone number already registered' });
      }

      // Delete any existing pending registration with this email (allows re-registration)
      await db.execute('DELETE FROM pending_registrations WHERE email = ?', [email]);

      const pendingId = uuidv4();
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes expiry

      // Store manpower as JSON if vendor
      const manpowerJson = role === 'vendor' && manpower ? JSON.stringify(manpower) : null;

      // Insert into pending_registrations table
      await db.execute(
        `INSERT INTO pending_registrations 
         (id, name, email, phone_number, role, store_name, store_email, address, state, city, pincode, gst_number, manpower_data, expires_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          pendingId,
          name,
          email,
          phoneNumber,
          role,
          role === 'vendor' ? storeName : null,
          role === 'vendor' ? email : null,
          role === 'vendor' ? address : null,
          role === 'vendor' ? state : null,
          role === 'vendor' ? city : null,
          role === 'vendor' ? pincode : null,
          role === 'vendor' ? (gstNumber || null) : null,
          manpowerJson,
          expiresAt
        ]
      );

      // Generate OTP (using pending registration ID)
      const otp = await OTPService.createOTP(pendingId);

      let otpSentViaWhatsApp = false;
      if (process.env.ENABLE_WHATSAPP === 'true') {
        otpSentViaWhatsApp = await WhatsAppService.sendLoginOTP(phoneNumber, name, otp);
      }

      if (!otpSentViaWhatsApp) {
        await EmailService.sendOTP(email, name, otp);
      }

      res.status(201).json({
        success: true,
        message: otpSentViaWhatsApp 
          ? 'OTP sent to your WhatsApp. Please verify to complete registration.'
          : 'OTP sent to your email. Please verify to complete registration.',
        userId: pendingId,
        requiresOTP: true
      });
    } catch (error: any) {
      console.error('Registration error:', error);
      res.status(500).json({ error: 'Registration failed' });
    }
  }


  static async login(req: Request, res: Response) {
    try {
      const { identifier, email, role } = req.body;
      
      // Fallback for older clients that might still send 'email'
      const loginId = identifier || email;

      if (!loginId) {
        return res.status(400).json({ error: 'Email or Mobile Number is required' });
      }

      if (!role) {
        return res.status(400).json({ error: 'Role is required' });
      }

      let users: any = [];

      // Admins still use email, everyone else uses mobile number
      if (role === 'admin') {
        const [result]: any = await executeWithRetry(
          'SELECT * FROM profiles WHERE email = ?',
          [loginId]
        );
        users = result;
      } else {
        // Clean phone number (just in case)
        let cleanedPhone = loginId.replace(/[\s\-+]/g, '');
        // If the user pasted a number with country code like 919876543210 (12 digits) or 09876543210 (11 digits)
        if (cleanedPhone.length === 12 && cleanedPhone.startsWith('91')) {
          cleanedPhone = cleanedPhone.substring(2);
        } else if (cleanedPhone.length === 11 && cleanedPhone.startsWith('0')) {
          cleanedPhone = cleanedPhone.substring(1);
        }
        const [result]: any = await executeWithRetry(
          'SELECT * FROM profiles WHERE phone_number = ?',
          [cleanedPhone]
        );
        users = result;
      }

      if (users.length === 0) {
        return res.status(401).json({ error: 'User not found. Please register first.' });
      }

      const user = users[0];

      // Get user role
      const [roles]: any = await executeWithRetry(
        'SELECT role FROM user_roles WHERE user_id = ?',
        [user.id]
      );

      if (roles.length === 0) {
        return res.status(500).json({ error: 'User role not found' });
      }

      const userRole = roles[0].role;

      // The ASM login is a page we hand out, not one the main login links to,
      // so the main login must not point anyone at it: an ASM's number there
      // reads as unknown. The ASM page in turn takes only ASMs.
      if (userRole === 'asm' && role !== 'asm') {
        return res.status(401).json({ error: 'User not found. Please register first.' });
      }
      if (role === 'asm' && userRole !== 'asm') {
        return res.status(403).json({ error: 'This number is not registered as an ASM.' });
      }

      if (userRole === 'asm') {
        const [asmRows]: any = await executeWithRetry(
          'SELECT is_active FROM asms WHERE profile_id = ?',
          [user.id]
        );
        const activeVal = asmRows[0]?.is_active;
        if (!(activeVal === 1 || activeVal === true || activeVal === '1')) {
          return res.status(403).json({
            error: 'Your ASM access has been turned off. Please contact Autoform.'
          });
        }
      }

      if (userRole !== role) {
        return res.status(403).json({
          error: `This email is registered as a ${userRole}. Please use the ${userRole} login.`
        });
      }

      // Check vendor verification and activation status
      if (userRole === 'vendor') {
        const [verification]: any = await executeWithRetry(
          'SELECT is_verified, is_active FROM vendor_verification WHERE user_id = ?',
          [user.id]
        );

        if (verification.length === 0 || !verification[0].is_verified) {
          return res.status(403).json({
            error: 'Vendor account pending verification. Please wait for admin approval.'
          });
        }

        // Deactivated stores are refused here, before an OTP is spent. They
        // used to be let in on the promise that the frontend would show a
        // deactivation message; it never did, so a deactivated store kept full
        // access. authenticateToken now rejects them anyway, and this gives
        // them a reason instead of a login that bounces.
        const activeVal = verification[0].is_active;
        if (!(activeVal === 1 || activeVal === true || activeVal === '1')) {
          return res.status(403).json({
            error: 'This store account has been deactivated. Please contact Autoform support.'
          });
        }
      }

      // Invalidate any previous unused OTPs for this user before generating a new one
      await db.execute(
        'UPDATE otp_codes SET is_used = TRUE WHERE user_id = ? AND is_used = FALSE',
        [user.id]
      );

      // Generate OTP
      const otp = await OTPService.createOTP(user.id);

      let otpSentViaWhatsApp = false;
      // Admins should always receive OTPs via email, even if they have a phone number
      if (process.env.ENABLE_WHATSAPP === 'true' && user.phone_number && userRole !== 'admin') {
        otpSentViaWhatsApp = await WhatsAppService.sendLoginOTP(user.phone_number, user.name, otp);
      }

      if (!otpSentViaWhatsApp) {
        await EmailService.sendOTP(user.email, user.name, otp);
      }

      res.json({
        success: true,
        message: otpSentViaWhatsApp 
          ? 'OTP sent to your WhatsApp'
          : 'OTP sent to your email',
        userId: user.id,
        requiresOTP: true
      });
    } catch (error: any) {
      console.error('Login error:', error);
      if (isTransientDbError(error)) {
        return res.status(503).json({ error: 'Service temporarily unavailable. Please retry.' });
      }
      res.status(500).json({ error: 'Login failed' });
    }
  }

  static async verifyOTP(req: Request, res: Response) {
    try {
      const { userId, otp } = req.body;

      if (!userId || !otp) {
        return res.status(400).json({ error: 'User ID and OTP are required' });
      }

      // Verify OTP
      const otpResult = await OTPService.verifyOTP(userId, otp);

      if (!otpResult.valid) {
        if (otpResult.lockedOut) {
          // 401, not 429. This is not "slow down" — the code is genuinely dead
          // and retrying it will never work. Using 429 here also made the
          // lockout indistinguishable from a rate-limit block in the logs and
          // on screen, which is exactly the confusion we hit while testing.
          return res.status(401).json({
            error: 'Too many incorrect attempts. That code is no longer valid — please tap Resend OTP for a new one.'
          });
        }
        return res.status(401).json({ error: 'Invalid or expired OTP' });
      }

      // FIRST: Check if this is a pending registration (new user flow)
      const [pendingUsers]: any = await db.execute(
        'SELECT * FROM pending_registrations WHERE id = ? AND expires_at > NOW()',
        [userId]
      );

      if (pendingUsers.length > 0) {
        // This is a NEW REGISTRATION - move data from pending to actual tables
        const pending = pendingUsers[0];
        const newUserId = uuidv4(); // Generate new permanent user ID
        const allowedRoles = new Set(['customer', 'vendor']);

        // SBP-001: Reject unexpected roles in pending registrations (defense in depth)
        if (!allowedRoles.has(pending.role)) {
          await db.execute('DELETE FROM pending_registrations WHERE id = ?', [userId]);
          return res.status(403).json({ error: 'Invalid registration role' });
        }

        // Use transaction for atomic multi-table writes
        const connection = await db.getConnection();
        try {
          await connection.beginTransaction();

          // Insert into profiles table
          await connection.execute(
            'INSERT INTO profiles (id, name, email, phone_number) VALUES (?, ?, ?, ?)',
            [newUserId, pending.name, pending.email, pending.phone_number]
          );

          // Insert user role
          await connection.execute(
            'INSERT INTO user_roles (id, user_id, role) VALUES (?, ?, ?)',
            [uuidv4(), newUserId, pending.role]
          );

          // If vendor, create verification record and details
          if (pending.role === 'vendor') {
            const verificationToken = uuidv4();

            await connection.execute(
              "INSERT INTO vendor_verification (id, user_id, is_verified) VALUES (?, ?, ?)",
              [uuidv4(), newUserId, false]
            );

            // Insert vendor details
            const vendorDetailsId = uuidv4();
            await connection.execute(
              `INSERT INTO vendor_details 
               (id, user_id, store_name, store_email, address, state, city, pincode, gst_number) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [vendorDetailsId, newUserId, pending.store_name, pending.store_email, pending.address, pending.state, pending.city, pending.pincode, pending.gst_number || null]
            );

            // Insert manpower details if any
            if (pending.manpower_data) {
              const manpowerList = typeof pending.manpower_data === 'string'
                ? JSON.parse(pending.manpower_data)
                : pending.manpower_data;

              if (manpowerList && manpowerList.length > 0) {
                const seenPhones = new Set<string>();
                for (const m of manpowerList) {
                  const phone = String(m.phoneNumber || '').trim();

                  // A phone number identifies one staff member system-wide. Skip a
                  // clashing entry rather than aborting the whole registration —
                  // the vendor is still created and can add the person afterwards.
                  if (seenPhones.has(phone)) continue;
                  const [clash]: any = await connection.execute(
                    'SELECT id FROM manpower WHERE phone_number = ? AND is_active = TRUE LIMIT 1',
                    [phone]
                  );
                  if (clash.length > 0) {
                    console.warn(`[Register] Skipped manpower "${m.name}" — phone ${phone} already registered to another active staff member.`);
                    continue;
                  }
                  seenPhones.add(phone);

                  const namePart = String(m.name || '').slice(0, 3).toUpperCase();
                  const phonePart = phone.slice(-4);
                  const manpowerCode = m.manpowerId
                    || ((namePart && phonePart) ? `${namePart}${phonePart}` : `MP-${Date.now()}`);

                  // Staff added at registration also start PENDING — an admin
                  // approves them from the franchise's Manpower tab.
                  await connection.execute(
                    `INSERT INTO manpower
                     (id, vendor_id, name, phone_number, manpower_id, applicator_type, is_approved)
                     VALUES (?, ?, ?, ?, ?, ?, FALSE)`,
                    [uuidv4(), vendorDetailsId, m.name, phone, manpowerCode, m.applicatorType]
                  );
                }
              }
            }

            // Delete from pending registrations (inside transaction)
            await connection.execute('DELETE FROM pending_registrations WHERE id = ?', [userId]);

            // Commit the transaction
            await connection.commit();

            // A new store (and any staff it listed) is now waiting on an admin.
            // Signalled here rather than as route middleware: /verify-otp is
            // also every ordinary login.
            signalAdminAttention();
            try {
              await NotificationService.broadcast({
                title: `New Franchise Registration: ${pending.store_name}`,
                message: `${pending.store_name} (${[pending.city, pending.state].filter(Boolean).join(', ')}) registered and is waiting for approval.`,
                type: 'system',
                targetRole: 'admin'
              });
            } catch (notifErr) {
              console.error('Failed to notify admins of new franchise registration:', notifErr);
            }

            // Send emails AFTER successful commit (outside transaction)
            await EmailService.sendVendorVerificationRequest(
              pending.email,
              pending.name,
              pending.phone_number,
              newUserId,
              verificationToken
            );

            // ── Vendor Welcome: WhatsApp first, email fallback ──
            let vendorWelcomeWaSent = false;
            if (process.env.ENABLE_WHATSAPP === 'true' && pending.phone_number) {
              try {
                vendorWelcomeWaSent = await WhatsAppService.sendVendorWelcome(pending.phone_number, pending.name);
              } catch (waErr) {
                console.error('[WhatsApp] Failed to send vendor welcome:', waErr);
              }
            }
            if (!vendorWelcomeWaSent) {
              await EmailService.sendVendorRegistrationConfirmation(pending.email, pending.name);
            }

            // Vendor needs admin approval, don't provide token yet
            return res.json({
              success: true,
              message: 'Registration complete! Your vendor account is pending admin approval.',
              user: null
            });
          }

          // For customers - delete from pending (inside transaction)
          await connection.execute('DELETE FROM pending_registrations WHERE id = ?', [userId]);

          // Commit the transaction
          await connection.commit();

          // Generate JWT for customer
          const token = jwt.sign(
            {
              // Marks this as a login session, not one of the single-purpose
              // action tokens signed with the same secret (invoice download,
              // franchise verify link). See isSessionToken() in middleware/auth.
              typ: 'session',
              id: newUserId,
              email: pending.email,
              name: pending.name,
              role: pending.role
            },
            process.env.JWT_SECRET as string,
            { expiresIn: process.env.JWT_EXPIRES_IN || '24h' } as jwt.SignOptions
          );

          res.cookie('auth_token', token, getAuthCookieOptions(pending.role));

          return res.json({
            success: true,
            message: 'Registration successful!',
            user: {
              id: newUserId,
              email: pending.email,
              name: pending.name,
              role: pending.role,
              phoneNumber: pending.phone_number,
              isValidated: true
            }
          });
        } catch (transactionError) {
          // Rollback on any failure
          await connection.rollback();
          throw transactionError;
        } finally {
          connection.release();
        }
      }

      // SECOND: This is a LOGIN flow - user already exists in profiles
      const [users]: any = await db.execute(
        'SELECT id, email, name, phone_number FROM profiles WHERE id = ?',
        [userId]
      );

      if (users.length === 0) {
        return res.status(404).json({ error: 'User not found or registration expired. Please register again.' });
      }

      const user = users[0];

      // Get user role
      const [roles]: any = await db.execute(
        'SELECT role FROM user_roles WHERE user_id = ?',
        [userId]
      );

      const userRole = roles[0].role;

      // Get verification and activation status for vendors
      let isValidated = userRole === 'customer' || userRole === 'asm';
      let isActive = true;

      // Switched off between asking for the code and entering it.
      if (userRole === 'asm') {
        const [asmRows]: any = await db.execute(
          'SELECT is_active FROM asms WHERE profile_id = ?',
          [userId]
        );
        const activeVal = asmRows[0]?.is_active;
        if (!(activeVal === 1 || activeVal === true || activeVal === '1')) {
          return res.status(403).json({
            error: 'Your ASM access has been turned off. Please contact Autoform.'
          });
        }
      }

      if (userRole === 'vendor') {
        const [verification]: any = await db.execute(
          'SELECT is_verified, is_active FROM vendor_verification WHERE user_id = ?',
          [userId]
        );
        isValidated = verification[0]?.is_verified || false;
        // Fix: MySQL returns 0 for false, which !== false evaluates to true. 
        // We must check if it is 1 or true.
        const activeVal = verification[0]?.is_active;
        isActive = (activeVal === 1 || activeVal === true);

        // If vendor not validated, don't provide token
        if (!isValidated) {
          return res.json({
            success: true,
            message: 'OTP verified. Waiting for vendor approval.',
            user: null
          });
        }
      }

      // Fetch admin permissions if applicable
      let isSuperAdmin = false;
      let permissions = {};
      if (userRole === 'admin') {
        const [permRows]: any = await db.execute(
          'SELECT is_super_admin, permissions FROM admin_permissions WHERE admin_id = ?',
          [user.id]
        );
        if (permRows.length > 0) {
          isSuperAdmin = permRows[0].is_super_admin === 1 || permRows[0].is_super_admin === true;
          permissions = typeof permRows[0].permissions === 'string'
            ? JSON.parse(permRows[0].permissions)
            : (permRows[0].permissions || {});
        }
      }

      // Generate JWT (only for customers or verified vendors)
      const token = jwt.sign(
        {
          typ: 'session',
          id: user.id,
          email: user.email,
          name: user.name,
          role: userRole,
          ...(userRole === 'admin' && { isSuperAdmin, permissions })
        },
        process.env.JWT_SECRET as string,
        { expiresIn: process.env.JWT_EXPIRES_IN || '24h' } as jwt.SignOptions
      );

      res.cookie('auth_token', token, getAuthCookieOptions(userRole));

      res.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: userRole,
          phoneNumber: user.phone_number,
          isValidated,
          isActive,
          ...(userRole === 'admin' && { isSuperAdmin, permissions })
        }
      });

      // Log Admin Login
      if (userRole === 'admin') {
        await ActivityLogService.log({
          adminId: user.id,
          adminName: user.name,
          adminEmail: user.email,
          actionType: 'ADMIN_LOGIN',
          targetType: 'SYSTEM',
          ipAddress: req.ip || req.socket?.remoteAddress
        });
      }
    } catch (error: any) {
      console.error('OTP verification error:', error);
      res.status(500).json({ error: 'OTP verification failed' });
    }
  }

  static async resendOTP(req: Request, res: Response) {
    try {
      const { userId } = req.body;

      if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
      }

      let userEmail: string;
      let userName: string;
      let userPhone: string;

      let userRole = '';

      // FIRST: Check if this is a pending registration
      const [pendingUsers]: any = await db.execute(
        'SELECT email, name, phone_number, role FROM pending_registrations WHERE id = ? AND expires_at > NOW()',
        [userId]
      );

      if (pendingUsers.length > 0) {
        userEmail = pendingUsers[0].email;
        userName = pendingUsers[0].name;
        userPhone = pendingUsers[0].phone_number;
        userRole = pendingUsers[0].role;
      } else {
        // SECOND: Check profiles table (login flow)
        const [users]: any = await db.execute(
          'SELECT p.id, p.email, p.name, p.phone_number, ur.role FROM profiles p JOIN user_roles ur ON p.id = ur.user_id WHERE p.id = ?',
          [userId]
        );

        if (users.length === 0) {
          return res.status(404).json({ error: 'User not found or registration expired. Please register again.' });
        }

        userEmail = users[0].email;
        userName = users[0].name;
        userPhone = users[0].phone_number;
        userRole = users[0].role;
      }

      // Invalidate all existing unused OTPs for this user
      await db.execute(
        'UPDATE otp_codes SET is_used = TRUE WHERE user_id = ? AND is_used = FALSE',
        [userId]
      );

      // Generate new OTP
      const otp = await OTPService.createOTP(userId);

      let otpSentViaWhatsApp = false;
      // Admins should always receive OTPs via email, even if they have a phone number
      if (process.env.ENABLE_WHATSAPP === 'true' && userPhone && userRole !== 'admin') {
        otpSentViaWhatsApp = await WhatsAppService.sendLoginOTP(userPhone, userName, otp);
      }

      if (!otpSentViaWhatsApp) {
        await EmailService.sendOTP(userEmail, userName, otp);
      }

      res.json({
        success: true,
        message: otpSentViaWhatsApp 
          ? 'New OTP sent to your WhatsApp'
          : 'New OTP sent to your email'
      });
    } catch (error: any) {
      console.error('Resend OTP error:', error);
      res.status(500).json({ error: 'Failed to resend OTP' });
    }
  }

  static async getCurrentUser(req: Request, res: Response) {
    try {
      const authenticatedUser = (req as any).user;

      if (!authenticatedUser?.id) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      // Get user data
      const [users]: any = await db.execute(
        'SELECT id, email, name, phone_number FROM profiles WHERE id = ?',
        [authenticatedUser.id]
      );

      if (users.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const user = users[0];

      // Get user role
      const [roles]: any = await db.execute(
        'SELECT role FROM user_roles WHERE user_id = ?',
        [authenticatedUser.id]
      );

      const userRole = roles[0].role;

      // Get verification and activation status for vendors
      let isValidated = userRole === 'customer' || userRole === 'asm';
      let isActive = true;
      if (userRole === 'vendor') {
        const [verification]: any = await db.execute(
          'SELECT is_verified, is_active FROM vendor_verification WHERE user_id = ?',
          [authenticatedUser.id]
        );
        isValidated = verification[0]?.is_verified || false;

        // Fix: MySQL returns 0 for false.
        const activeVal = verification[0]?.is_active;

        isActive = (activeVal === 1 || activeVal === true || activeVal === '1');
      }

      // Fetch admin permissions for /auth/me refresh
      let isSuperAdmin = false;
      let permissions = {};
      if (userRole === 'admin') {
        const [permRows]: any = await db.execute(
          'SELECT is_super_admin, permissions FROM admin_permissions WHERE admin_id = ?',
          [authenticatedUser.id]
        );
        if (permRows.length > 0) {
          isSuperAdmin = permRows[0].is_super_admin === 1 || permRows[0].is_super_admin === true;
          permissions = typeof permRows[0].permissions === 'string'
            ? JSON.parse(permRows[0].permissions)
            : (permRows[0].permissions || {});
        }
      }

      res.json({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: userRole,
          phoneNumber: user.phone_number,
          isValidated,
          isActive,
          ...(userRole === 'admin' && { isSuperAdmin, permissions })
        }
      });
    } catch (error: any) {
      console.error('Get current user error:', error);
      if (isTransientDbError(error)) {
        return res.status(503).json({ error: 'Service temporarily unavailable. Please retry.' });
      }
      res.status(500).json({ error: 'Failed to fetch current user' });
    }
  }

  static async updateProfile(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      const { name } = req.body;
      let { email, phoneNumber } = req.body;

      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const [roleRecords]: any = await db.execute(
        'SELECT role FROM user_roles WHERE user_id = ?',
        [userId]
      );
      const currentRole = roleRecords[0]?.role;

      if (currentRole === 'vendor') {
        return res.status(403).json({ error: 'Franchise profiles can only be updated by administrators.' });
      }

      if (!name || !email || !phoneNumber) {
        return res.status(400).json({ error: 'All fields are required' });
      }

      // Check if email is being changed and if it's already taken
      const [currentUser]: any = await db.execute(
        'SELECT name, email, phone_number FROM profiles WHERE id = ?',
        [userId]
      );

      if (currentUser.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      // An admin's email is their login and their phone their contact of
      // record, so only a super admin may change them — their own included
      // (other admins' are changed from Admin Access). Anyone else can still
      // edit their name here.
      if (currentRole === 'admin' && !(req as any).user?.isSuperAdmin) {
        const sameEmail = String(currentUser[0].email || '').trim().toLowerCase() === String(email).trim().toLowerCase();
        const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '').slice(-10);
        const samePhone = digits(currentUser[0].phone_number) === digits(phoneNumber);
        if (!sameEmail || !samePhone) {
          return res.status(403).json({ error: 'Only a super admin can change an admin\'s email or phone number.' });
        }
        // Equal after normalising — keep the stored spelling exactly.
        email = currentUser[0].email;
        phoneNumber = currentUser[0].phone_number;
      }

      if (currentUser[0].email !== email) {
        const [existingUsers]: any = await db.execute(
          'SELECT id FROM profiles WHERE email = ? AND id != ?',
          [email, userId]
        );

        if (existingUsers.length > 0) {
          return res.status(400).json({ error: 'Email already in use by another account' });
        }
      }

      // Update profile
      await db.execute(
        'UPDATE profiles SET name = ?, email = ?, phone_number = ? WHERE id = ?',
        [name, email, phoneNumber, userId]
      );

      // Fetch updated user data to return
      const [updatedUsers]: any = await db.execute(
        'SELECT id, email, name, phone_number FROM profiles WHERE id = ?',
        [userId]
      );

      const updatedUser = updatedUsers[0];

      const userRole = currentRole;

      // Get verification status for vendors
      let isValidated = userRole === 'customer';
      if (userRole === 'vendor') {
        const [verification]: any = await db.execute(
          'SELECT is_verified FROM vendor_verification WHERE user_id = ?',
          [userId]
        );
        isValidated = verification[0]?.is_verified || false;
      }

      res.json({
        success: true,
        message: 'Profile updated successfully',
        user: {
          id: updatedUser.id,
          email: updatedUser.email,
          name: updatedUser.name,
          role: userRole,
          phoneNumber: updatedUser.phone_number,
          isValidated
        }
      });

      // Log Admin Profile Update
      if (userRole === 'admin') {
        await ActivityLogService.log({
          adminId: userId,
          adminName: updatedUser.name,
          adminEmail: updatedUser.email,
          actionType: 'ADMIN_PROFILE_UPDATED',
          targetType: 'ADMIN',
          targetId: userId,
          targetName: updatedUser.name,
          details: {
            changedFields: {
              name: name !== currentUser[0].name ? { from: currentUser[0].name, to: name } : undefined,
              email: email !== currentUser[0].email ? { from: currentUser[0].email, to: email } : undefined,
              phone: phoneNumber !== currentUser[0].phone_number ? { from: currentUser[0].phone_number, to: phoneNumber } : undefined
            }
          },
          ipAddress: req.ip || req.socket?.remoteAddress
        });
      }
    } catch (error: any) {
      console.error('Update profile error:', error);
      
      // Handle MySQL duplicate key errors gracefully
      if (error.code === 'ER_DUP_ENTRY') {
        const msg = error.message?.toLowerCase() || '';
        if (msg.includes('phone_number') || msg.includes('phone')) {
          return res.status(400).json({ error: 'Phone number already in use by another account' });
        }
        if (msg.includes('email')) {
          return res.status(400).json({ error: 'Email already in use by another account' });
        }
        return res.status(400).json({ error: 'This information is already in use by another account' });
      }
      
      res.status(500).json({ error: 'Failed to update profile' });
    }
  }
}
