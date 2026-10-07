import { Router, CookieOptions } from 'express';
import { AuthController } from '../controllers/auth.controller.js';
import { authenticateToken, authenticateAnySession } from '../middleware/auth.js';
import { otpResendLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import {
    registerSchema,
    loginSchema,
    verifyOTPSchema,
    resendOTPSchema,
    updateProfileSchema
} from '../utils/schemas.js';

const router = Router();

const getAuthCookieOptions = (): CookieOptions => {
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

    return {
        httpOnly: true,
        secure,
        sameSite,
        path: '/'
    };
};

// Apply validation middleware before controllers
router.post('/register', validate(registerSchema), AuthController.register);
router.post('/login', validate(loginSchema), AuthController.login);
router.post('/verify-otp', validate(verifyOTPSchema), AuthController.verifyOTP);
router.post('/resend-otp', otpResendLimiter, validate(resendOTPSchema), AuthController.resendOTP);
// Any session, ASMs included — the ASM pages restore their login from here.
router.get('/me', authenticateAnySession, AuthController.getCurrentUser);
router.put('/profile', authenticateToken, validate(updateProfileSchema), AuthController.updateProfile);

// SBP-006: Server-side logout — clears HttpOnly auth cookie
router.post('/logout', (req, res) => {
    res.clearCookie('auth_token', getAuthCookieOptions());
    res.json({ success: true, message: 'Logged out successfully' });
});

export default router;
