import { z } from 'zod';

/**
 * Validation Schemas using Zod
 * Provides type-safe request validation with detailed error messages
 */

// Regex patterns (reused from auth.controller.ts)
const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const PINCODE_REGEX = /^\d{6}$/;

// Common field schemas
export const emailSchema = z.string()
    .min(1, 'Email is required')
    .trim()
    .toLowerCase()
    .regex(EMAIL_REGEX, 'Please enter a valid email address');

export const phoneSchema = z.string()
    .min(1, 'Phone number is required')
    .transform(val => val.replace(/[\s\-+]/g, '').replace(/^91/, '').replace(/^0/, ''))
    .refine(val => INDIAN_MOBILE_REGEX.test(val), {
        message: 'Please enter a valid 10-digit Indian mobile number (must start with 6-9)'
    });

export const pincodeSchema = z.string()
    .regex(PINCODE_REGEX, 'Pincode must be 6 digits');

// Manpower schema for vendor registration
export const manpowerSchema = z.object({
    name: z.string().min(1, 'Manpower name is required'),
    phoneNumber: z.string().min(10, 'Manpower phone is required'),
    manpowerId: z.string().min(1, 'Manpower ID is required'),
    applicatorType: z.string().min(1, 'Applicator type is required'),
});

// ===========================================
// AUTH SCHEMAS
// ===========================================

export const registerSchema = z.object({
    name: z.string().min(2, 'Name must be at least 2 characters'),
    email: emailSchema,
    phoneNumber: z.string().min(10, 'Phone number is required'),
    role: z.enum(['customer', 'vendor']),
    // Vendor-specific fields (optional, but required if role is vendor)
    storeName: z.string().optional(),
    address: z.string().optional(),
    state: z.string().optional(),
    city: z.string().optional(),
    pincode: z.string().optional(),
    /*
     * Declared even though the controller is what enforces it: this schema
     * strips keys it does not know, so an undeclared gstNumber never reached
     * the controller and every registration was refused for a GST the
     * franchise had in fact typed correctly.
     */
    gstNumber: z.string().optional(),
    /* The same trap: undeclared, the franchise's brand never reached the controller, which then refused it. */
    brand: z.string().optional(),
    manpower: z.array(manpowerSchema).optional(),
}).refine(
    data => {
        if (data.role === 'vendor') {
            return data.storeName && data.address && data.state && data.city && data.pincode;
        }
        return true;
    },
    { message: 'All vendor details are required for vendor registration', path: ['storeName'] }
);

export const loginSchema = z.object({
    // 'identifier' can be email (for admins) or mobile number (for users/vendors)
    // We accept 'email' as an alias for backward compatibility
    identifier: z.string().min(1, 'Email or Mobile Number is required').optional(),
    email: z.string().min(1).optional(),
    // 'asm' is used only by the ASM login page, which the main login never links to.
    role: z.enum(['customer', 'vendor', 'admin', 'asm']),
}).refine(data => data.identifier || data.email, {
    message: 'Email or Mobile Number is required',
    path: ['identifier'],
});

export const verifyOTPSchema = z.object({
    userId: z.string().min(1, 'User ID is required'),
    otp: z.string().length(6, 'OTP must be 6 digits'),
});

export const resendOTPSchema = z.object({
    userId: z.string().min(1, 'User ID is required'),
});

export const updateProfileSchema = z.object({
    name: z.string().min(2, 'Name must be at least 2 characters'),
    email: emailSchema,
    phoneNumber: z.string().min(10, 'Phone number is required'),
});

// ===========================================
// WARRANTY SCHEMAS
// ===========================================

// Seat Cover product details schema
const seatCoverDetailsSchema = z.object({
    uid: z.string().min(13, 'UID must be at least 13 digits').max(16, 'UID must be at most 16 digits'),
    productName: z.string().min(1, 'Product name is required'),
    storeName: z.string().optional(),
    storeEmail: emailSchema.optional().or(z.literal('')),
    manpowerId: z.string().optional(),
    manpowerName: z.string().optional(),
    customerAddress: z.string().optional(),
    invoiceFileName: z.string().optional().nullable(),
});

// EV Products (PPF) details schema
//
// This asked for a lotNumber and a rollNumber that the form has never sent, so
// every PPF submission failed this branch of the union and fell through to the
// permissive record fallback below — leaving PPF effectively unvalidated. It
// now describes what is actually submitted: the rolls drawn on, each with the
// area taken from it.
const ppfRollSchema = z.object({
    serial: z.string().min(1, 'Serial number is required'),
    sqft: z.coerce.number().positive('Area used must be greater than zero'),
    // Which part of the car this roll's film went on. Per roll rather than per
    // vehicle: film from two rolls goes on two different panels.
    installArea: z.string().min(1, 'Area of installation is required'),
});

const evProductDetailsSchema = z.object({
    product: z.string().min(1, 'Product is required'),
    rolls: z.array(ppfRollSchema).min(1, 'At least one serial number is required'),
    manpowerId: z.string().optional(),
    manpowerName: z.string().optional(),
    customerAddress: z.string().optional(),
    carRegistration: z.string().optional(),
    dealerAddress: z.string().optional(),
    photos: z.object({
        lhs: z.string().optional().nullable(),
        rhs: z.string().optional().nullable(),
        frontReg: z.string().optional().nullable(),
        backReg: z.string().optional().nullable(),
        warranty: z.string().optional().nullable(),
    }).optional(),
    termsAccepted: z.boolean().optional(),
    installationDate: z.string().optional(),
});

// Flexible product details that accepts either type (for multipart form parsing)
const productDetailsSchema = z.union([
    seatCoverDetailsSchema,
    evProductDetailsSchema,
    z.record(z.string(), z.any()), // Fallback for form parsing edge cases
]);

export const warrantySubmitSchema = z.object({
    productType: z.enum(['seat-cover', 'ev-products']),
    customerName: z.string().min(2, 'Customer name is required'),
    customerEmail: emailSchema.optional().or(z.literal('')),
    customerPhone: z.string().min(10, 'Customer phone is required'),
    customerAddress: z.string().min(1, 'Customer address is required'),
    carMake: z.string().optional(),
    carModel: z.string().optional(),
    carYear: z.string().length(4, 'Car year must be 4 digits'),
    registrationNumber: z.string().min(1, 'Vehicle registration number is required'),
    purchaseDate: z.string().min(1, 'Purchase date is required'),
    warrantyType: z.string().min(1, 'Warranty type is required'),
    installerName: z.string().optional(),
    installerContact: z.string().optional(),
    productDetails: productDetailsSchema,
    manpowerId: z.string().optional().nullable(),
});

// ===========================================
// ADMIN SCHEMAS
// ===========================================

export const updateWarrantyStatusSchema = z.object({
    status: z.enum(['validated', 'rejected']),
    rejectionReason: z.string().optional(),
}).refine(
    data => {
        if (data.status === 'rejected') {
            return data.rejectionReason && data.rejectionReason.length > 0;
        }
        return true;
    },
    { message: 'Rejection reason is required when rejecting a warranty', path: ['rejectionReason'] }
);

export const vendorVerificationSchema = z.object({
    is_verified: z.boolean(),
    rejection_reason: z.string().optional(),
});

export const createAdminSchema = z.object({
    name: z.string().min(2, 'Name is required'),
    email: emailSchema,
    phone: z.string().min(10, 'Phone number is required'),
});

// Export schema types for use in controllers
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type VerifyOTPInput = z.infer<typeof verifyOTPSchema>;
export type WarrantySubmitInput = z.infer<typeof warrantySubmitSchema>;
