import { Router, Response } from 'express';
import db from '../config/database.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';

/**
 * The Android app registers its FCM token here after login and removes it on
 * logout (see push.service.ts). A token belongs to one phone; if another
 * account logs in on that phone it moves to them.
 */
const router = Router();
router.use(authenticateToken);

const validToken = (t: unknown): t is string =>
  typeof t === 'string' && t.length >= 20 && t.length <= 512 && /^[\x21-\x7e]+$/.test(t);

router.post('/register', async (req: AuthRequest, res: Response) => {
  const { token, platform } = req.body || {};
  if (!validToken(token)) return res.status(400).json({ error: 'Invalid device token' });
  try {
    await db.execute(
      `INSERT INTO push_devices (token, user_id, platform) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), platform = VALUES(platform), updated_at = CURRENT_TIMESTAMP`,
      [token, req.user!.id, platform === 'ios' ? 'ios' : 'android']
    );
    res.json({ success: true });
  } catch (error) {
    console.error('[Push] Register failed:', error);
    res.status(500).json({ error: 'Could not register device' });
  }
});

router.post('/unregister', async (req: AuthRequest, res: Response) => {
  const { token } = req.body || {};
  if (!validToken(token)) return res.status(400).json({ error: 'Invalid device token' });
  try {
    await db.execute('DELETE FROM push_devices WHERE token = ? AND user_id = ?', [token, req.user!.id]);
    res.json({ success: true });
  } catch (error) {
    console.error('[Push] Unregister failed:', error);
    res.status(500).json({ error: 'Could not unregister device' });
  }
});

export default router;
