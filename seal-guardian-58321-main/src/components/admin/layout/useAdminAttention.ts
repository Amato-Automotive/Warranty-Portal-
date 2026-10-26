import { useCallback, useEffect, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useNotifications } from "@/contexts/NotificationContext";

/**
 * Work waiting on admins, for the sidebar badges: grievances still
 * `submitted`, POSM requests still `open`, franchises awaiting approval,
 * and manpower awaiting approval or removal review. A module the admin can't read is
 * simply absent from the response.
 *
 * The server emits `admin:attention` whenever one is created or changes
 * status; the event carries no numbers, it just prompts this hook to re-fetch.
 * The poll is a fallback for when the socket has given up reconnecting.
 */
export interface AttentionCounts {
    grievances?: number;
    posm?: number;
    /** Registered stores not yet approved or rejected. */
    franchises?: number;
    /** Staff awaiting approval plus pending removal requests. */
    manpower?: number;
    /** ASM expense claims waiting for a decision. */
    asmExpenses?: number;
    /** Warranty claims the store has checked, waiting for head office. */
    claims?: number;
}

const POLL_MS = 60_000;

export function useAdminAttention(): AttentionCounts {
    const { user } = useAuth();
    const { socket } = useNotifications();
    const [counts, setCounts] = useState<AttentionCounts>({});
    const isAdmin = user?.role === "admin";

    const refresh = useCallback(async () => {
        try {
            const res = await api.get("/admin/attention");
            if (res.data?.success) setCounts(res.data.counts || {});
        } catch {
            // Badges are a nicety; a failed fetch keeps the last numbers.
        }
    }, []);

    useEffect(() => {
        if (!isAdmin) return;
        refresh();
        const timer = window.setInterval(refresh, POLL_MS);
        const onFocus = () => refresh();
        window.addEventListener("focus", onFocus);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener("focus", onFocus);
        };
    }, [isAdmin, refresh]);

    useEffect(() => {
        if (!isAdmin || !socket) return;
        socket.on("admin:attention", refresh);
        return () => {
            socket.off("admin:attention", refresh);
        };
    }, [isAdmin, socket, refresh]);

    return counts;
}
