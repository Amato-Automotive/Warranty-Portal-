import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { useAuth } from "./AuthContext";
import { useToast } from "@/hooks/use-toast";
import api, { API_URL } from "@/lib/api";
import { getNativeToken } from '@/lib/nativeSession';
import { NOTIFICATIONS_STALE_EVENT } from '@/lib/nativeShell';

export interface Notification {
    id: number;
    title: string;
    message: string;
    type: 'product' | 'alert' | 'system' | 'posm' | 'order' | 'scheme' | 'warranty' | 'grievance';
    link?: string;
    metadata?: {
        images?: string[];
        videos?: string[];
    };
    is_read: boolean;
    is_cleared?: boolean;
    created_at: string;
}

interface NotificationContextType {
    notifications: Notification[];
    fullHistory: Notification[];
    unreadCount: number;
    loading: boolean;
    markAsRead: (id: number) => Promise<void>;
    markAllAsRead: () => Promise<void>;
    clearAllNotifications: () => Promise<void>;
    dismissNotification: (id: number) => Promise<void>;
    undoDismissNotification: (id: number) => Promise<void>;
    refreshNotifications: () => Promise<void>;
    fetchFullHistory: () => Promise<void>;
    /** The live connection, for components that listen to other events (e.g. admin:attention). Null until connected, and on backends without Socket.io. */
    socket: Socket | null;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [fullHistory, setFullHistory] = useState<Notification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [loading, setLoading] = useState(false);
    const [socket, setSocket] = useState<Socket | null>(null);

    const parseMetadata = (notifs: Notification[]) => {
        return notifs.map(n => {
            let parsedMetadata = n.metadata;
            if (typeof n.metadata === 'string') {
                try {
                    parsedMetadata = JSON.parse(n.metadata);
                } catch (e) {
                    console.error('Failed to parse metadata for notification:', n.id, e);
                    parsedMetadata = null;
                }
            }
            return {
                ...n,
                metadata: parsedMetadata as any
            };
        });
    };

    const fetchNotifications = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const [notifRes, countRes, historyRes] = await Promise.all([
                api.get("/notifications"),
                api.get("/notifications/unread-count"),
                api.get("/notifications?includeCleared=true")
            ]);
            if (notifRes.data.success) {
                setNotifications(parseMetadata(notifRes.data.notifications));
            }
            if (countRes.data.success) setUnreadCount(countRes.data.count);
            if (historyRes.data.success) {
                setFullHistory(parseMetadata(historyRes.data.notifications));
            }
        } catch (error) {
            console.error("Failed to fetch notifications:", error);
        } finally {
            setLoading(false);
        }
    }, [user]);

    const fetchFullHistory = async () => {
        if (!user) return;
        try {
            const res = await api.get("/notifications?includeCleared=true");
            if (res.data.success) setFullHistory(parseMetadata(res.data.notifications));
        } catch (error) {
            console.error("Failed to fetch full history:", error);
        }
    };

    useEffect(() => {
        if (user) {
            fetchNotifications();

            // Initialize Socket
            const apiUrl = API_URL;
            // Socket.io expects the root URL, not the /api path. Strip /api if present.
            const baseUrl = apiUrl.endsWith('/api') ? apiUrl.slice(0, -4) : apiUrl;

            // Skip socket connection for Vercel/serverless backends (they don't support Socket.io)
            const isVercelBackend = baseUrl.includes('vercel.app') || apiUrl.startsWith('/');

            if (isVercelBackend) {
                console.log("⚠️ Socket.io disabled for Vercel backend - using HTTP polling for notifications");
                // Don't initialize socket for Vercel - it doesn't support persistent connections
                return;
            }

            console.log("🔌 Initializing Socket.io connection to:", baseUrl);

            const newSocket = io(baseUrl, {
                withCredentials: true, // SBP-006: Sends HttpOnly cookie for auth
                // The native app has no usable cookie; the server falls back to this.
                ...(getNativeToken() && { auth: { token: getNativeToken() } }),
                transports: ['polling', 'websocket'],
                reconnectionAttempts: 3,
                reconnectionDelay: 2000
            });

            newSocket.on("connect", () => {
                console.log("📡 Connected to notification socket");
            });

            newSocket.on("connect_error", (error) => {
                console.warn("⚠️ Socket connection failed:", error.message);
            });

            newSocket.on("notification:new", (notification: Notification) => {
                const parsedNotif = {
                    ...notification,
                    metadata: notification.metadata ? (typeof notification.metadata === 'string' ? JSON.parse(notification.metadata) : notification.metadata) : null
                };

                setNotifications(prev => {
                    if (prev.some(n => n.id === parsedNotif.id)) return prev;
                    return [parsedNotif, ...prev];
                });

                setFullHistory(prev => {
                    if (prev.some(n => n.id === parsedNotif.id)) return prev;
                    return [parsedNotif, ...prev];
                });

                setUnreadCount(prev => prev + 1);

                toast({
                    title: parsedNotif.title,
                    description: parsedNotif.message,
                });

                // Play notification sound if desired
                try {
                    const audio = new Audio('/notification-sound.mp3');
                    audio.play();
                } catch (e) {
                    // Ignore sound errors
                }
            });

            setSocket(newSocket);

            return () => {
                newSocket.disconnect();
            };
        } else {
            setNotifications([]);
            setUnreadCount(0);
            if (socket) socket.disconnect();
        }
    }, [user, fetchNotifications]);

    // The live socket only covers the time it is connected. A backgrounded
    // tab, or the Android app while it isn't in front, drops the connection
    // (and gives up after three reconnect attempts), so anything sent
    // meanwhile never reaches the bell. Catch up from the server whenever the
    // page comes back, and reconnect if the socket is down.
    useEffect(() => {
        if (!user) return;
        const catchUp = () => {
            if (document.visibilityState !== 'visible') return;
            fetchNotifications();
            if (socket && !socket.connected) socket.connect();
        };
        document.addEventListener('visibilitychange', catchUp);
        window.addEventListener(NOTIFICATIONS_STALE_EVENT, catchUp);
        return () => {
            document.removeEventListener('visibilitychange', catchUp);
            window.removeEventListener(NOTIFICATIONS_STALE_EVENT, catchUp);
        };
    }, [user, socket, fetchNotifications]);

    const markAsRead = async (id: number) => {
        try {
            await api.patch(`/notifications/${id}/read`);
            setNotifications(prev =>
                prev.map(n => n.id === id ? { ...n, is_read: true } : n)
            );
            setFullHistory(prev =>
                prev.map(n => n.id === id ? { ...n, is_read: true } : n)
            );
            setUnreadCount(prev => Math.max(0, prev - 1));
        } catch (error) {
            console.error("Failed to mark notification as read:", error);
        }
    };

    const markAllAsRead = async () => {
        try {
            await api.patch("/notifications/read-all");
            setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
            setFullHistory(prev => prev.map(n => ({ ...n, is_read: true })));
            setUnreadCount(0);
        } catch (error) {
            console.error("Failed to mark all as read:", error);
        }
    };

    const clearAllNotifications = async () => {
        try {
            await api.delete("/notifications");
            setNotifications([]);
            setFullHistory([]);
            setUnreadCount(0);
            toast({
                title: "Notifications cleared",
                description: "All notifications have been removed.",
            });
        } catch (error) {
            console.error("Failed to clear notifications:", error);
            toast({
                title: "Error",
                description: "Failed to clear notifications.",
                variant: "destructive"
            });
        }
    };

    const dismissNotification = async (id: number) => {
        try {
            await api.delete(`/notifications/${id}`);
            // Optimistically update local state if needed, but we rely on fetchHistory usually
            // However for smooth UI we filtering here
            setNotifications(prev => prev.filter(n => n.id !== id));
            setFullHistory(prev => prev.filter(n => n.id !== id));
            setUnreadCount(prev => {
                const dismissed = notifications.find(n => n.id === id);
                return (dismissed && !dismissed.is_read) ? Math.max(0, prev - 1) : prev;
            });
        } catch (error) {
            console.error("Failed to dismiss notification:", error);
        }
    };

    const undoDismissNotification = async (id: number) => {
        try {
            await api.patch(`/notifications/${id}/restore`);
            fetchNotifications(); // Refresh to get it back
        } catch (error) {
            console.error("Failed to undo dismiss:", error);
        }
    };

    return (
        <NotificationContext.Provider value={{
            notifications,
            fullHistory,
            unreadCount,
            loading,
            markAsRead,
            markAllAsRead,
            clearAllNotifications,
            dismissNotification,
            undoDismissNotification,
            refreshNotifications: fetchNotifications,
            fetchFullHistory,
            socket
        }}>
            {children}
        </NotificationContext.Provider>
    );
};

export const useNotifications = () => {
    const context = useContext(NotificationContext);
    if (!context) throw new Error("useNotifications must be used within NotificationProvider");
    return context;
};
