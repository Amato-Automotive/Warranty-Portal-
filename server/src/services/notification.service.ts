import db from '../config/database.js';
import { getISTTimestamp } from '../utils/dateUtils.js';
import { getIO } from '../socket.js';
import { pushInBackground } from './push.service.js';

// Simple in-memory cache for deduplication
// Stores hash(userId + title + message) -> timestamp
const notificationCache = new Map<string, number>();
const DEDUPLICATION_WINDOW = 5000; // 5 seconds

export class NotificationService {
    /**
     * Create and send a notification to a specific user
     */
    static async notify(userId: string | number, data: {
        title: string;
        message: string;
        type?: 'product' | 'alert' | 'system' | 'posm' | 'order' | 'scheme' | 'warranty';
        link?: string;
        metadata?: any;
    }) {
        try {
            // 0. Deduplication Check
            const cacheKey = `${userId}:${data.title}:${data.message}`;
            const now = Date.now();
            const lastSent = notificationCache.get(cacheKey);

            if (lastSent && (now - lastSent) < DEDUPLICATION_WINDOW) {
                console.log(`[Deduplication] Skipping duplicate notification for user ${userId}: ${data.title}`);
                return null;
            }
            notificationCache.set(cacheKey, now);

            // Clean up cache occasionally (simple approach)
            if (notificationCache.size > 1000) {
                const threshold = now - DEDUPLICATION_WINDOW;
                for (const [key, timestamp] of notificationCache.entries()) {
                    if (timestamp < threshold) notificationCache.delete(key);
                }
            }

            // 1. Save to Database
            const [result]: any = await db.execute(
                'INSERT INTO notifications (user_id, title, message, type, link, metadata) VALUES (?, ?, ?, ?, ?, ?)',
                [userId, data.title, data.message, data.type || 'system', data.link || null, data.metadata ? JSON.stringify(data.metadata) : null]
            );

            const notificationId = result.insertId;

            // 2. Fetch the created notification
            const [rows]: any = await db.execute('SELECT * FROM notifications WHERE id = ?', [notificationId]);
            const notification = rows[0];

            // Parse metadata before emitting
            if (notification.metadata && typeof notification.metadata === 'string') {
                try {
                    notification.metadata = JSON.parse(notification.metadata);
                } catch (e) {
                    console.error('Failed to parse metadata for socket emission:', e);
                }
            }

            // 3. Emit via Socket.io to the user's specific room
            const io = getIO();
            io.to(`user_${userId}`).emit('notification:new', notification);

            // 4. Phone push, for users with the app installed
            pushInBackground([userId], { title: data.title, message: data.message, link: data.link, type: data.type });

            return notification;
        } catch (error) {
            console.error('Failed to create notification:', error);
            throw error;
        }
    }

    /**
     * Broadcast a notification to all users (e.g., from Admin)
     */
    static async broadcast(data: {
        title: string;
        message: string;
        type?: 'product' | 'alert' | 'system' | 'posm' | 'order' | 'scheme' | 'warranty';
        link?: string;
        metadata?: any;
        targetUsers?: string[]; // Array of user IDs
        targetRole?: 'admin' | 'vendor' | 'customer';
    }) {
        try {
            // 0. Deduplication Check for Broadcasts
            const cacheKey = `broadcast:${data.targetRole || 'all'}:${data.title}:${data.message}`;
            const now = Date.now();
            const lastSent = notificationCache.get(cacheKey);

            if (lastSent && (now - lastSent) < DEDUPLICATION_WINDOW) {
                console.log(`[Deduplication] Skipping duplicate broadcast: ${data.title}`);
                return { success: true, count: 0, deduplicated: true };
            }
            notificationCache.set(cacheKey, now);

            let userIds: any[] = [];

            // 1. Get recipients
            if (data.targetUsers && data.targetUsers.length > 0) {
                userIds = data.targetUsers;
            } else if (data.targetRole === 'admin') {
                const [rows]: any = await db.execute(
                    'SELECT user_id FROM user_roles WHERE role = "admin"'
                );
                userIds = rows.map((r: any) => r.user_id);
            } else if (data.targetRole === 'customer') {
                const [rows]: any = await db.execute(
                    'SELECT user_id FROM user_roles WHERE role = "customer"'
                );
                userIds = rows.map((r: any) => r.user_id);
            } else if (data.targetRole === 'vendor') {
                const [rows]: any = await db.execute(
                    'SELECT user_id FROM user_roles WHERE role = "vendor"'
                );
                userIds = rows.map((r: any) => r.user_id);
            } else {
                console.warn(`[Broadcast] No valid target role or users specified for broadcast: ${data.title}`);
                return [];
            }

            if (userIds.length === 0) return [];

            // 2. Bulk Database Insert
            const metadataStr = data.metadata ? JSON.stringify(data.metadata) : null;
            const type = data.type || 'system';
            const link = data.link || null;

            const insertValues = userIds.map(id => [id, data.title, data.message, type, link, metadataStr]);

            // mysql2 supports bulk insert: INSERT INTO table (cols) VALUES (?,?,?), (?,?,?)
            const [result]: any = await db.query(
                'INSERT INTO notifications (user_id, title, message, type, link, metadata) VALUES ?',
                [insertValues]
            );

            const startId = result.insertId;

            // 3. Emit via Socket.io
            const io = getIO();
            userIds.forEach((userId, index) => {
                const userNotificationPayload = {
                    id: startId + index,
                    title: data.title,
                    message: data.message,
                    type,
                    link,
                    metadata: data.metadata,
                    created_at: getISTTimestamp(),
                    is_read: false
                };
                io.to(`user_${userId}`).emit('notification:new', userNotificationPayload);
            });

            // 4. Phone push, for users with the app installed
            pushInBackground(userIds, { title: data.title, message: data.message, link, type });

            return { success: true, count: userIds.length };
        } catch (error) {
            console.error('Broadcast failed:', error);
            throw error;
        }
    }

    static async getUnreadCount(userId: string | number) {
        const [rows]: any = await db.execute(
            'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = FALSE AND is_cleared = FALSE',
            [userId]
        );
        return rows[0].count;
    }

    static async markAsRead(notificationId: number, userId: string | number) {
        await db.execute(
            'UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?',
            [notificationId, userId]
        );
    }

    static async markAllAsRead(userId: string | number) {
        await db.execute(
            'UPDATE notifications SET is_read = TRUE WHERE user_id = ?',
            [userId]
        );
    }

    static async clearAll(userId: string | number) {
        await db.execute(
            'UPDATE notifications SET is_cleared = TRUE WHERE user_id = ?',
            [userId]
        );
    }

    static async clearById(notificationId: number, userId: string | number) {
        await db.execute(
            'UPDATE notifications SET is_cleared = TRUE WHERE id = ? AND user_id = ?',
            [notificationId, userId]
        );
    }

    static async restoreById(notificationId: number, userId: string | number) {
        await db.execute(
            'UPDATE notifications SET is_cleared = FALSE WHERE id = ? AND user_id = ?',
            [notificationId, userId]
        );
    }
}

