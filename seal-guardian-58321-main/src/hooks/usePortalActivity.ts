import { useEffect, useRef } from "react";
import api from "@/lib/api";

/**
 * Tells the server what a franchise or distributor has open in their portal,
 * for the admin's Portal Activity screens:
 *
 *   open — once, when the portal loads
 *   page — each time a page (module) is opened
 *   beat — once a minute, only while the tab is visible and someone has
 *          touched it in the last five minutes, so a tab left open overnight
 *          does not count as time spent
 *
 * Fire-and-forget: a request that fails just leaves a gap, never an error.
 */
const IDLE_MS = 5 * 60_000;

const send = (kind: "open" | "page" | "beat", module = "") => {
    api.post("/vendor/activity", { kind, module }).catch(() => undefined);
};

export function usePortalActivity(module: string, enabled: boolean) {
    const current = useRef(module);
    current.current = module;

    useEffect(() => {
        if (enabled) send("open");
    }, [enabled]);

    useEffect(() => {
        if (enabled && module) send("page", module);
    }, [enabled, module]);

    useEffect(() => {
        if (!enabled) return;
        let lastUse = Date.now();
        const used = () => { lastUse = Date.now(); };
        const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "wheel"] as const;
        events.forEach(e => window.addEventListener(e, used, { passive: true, capture: true }));
        const timer = setInterval(() => {
            if (document.visibilityState === "visible" && Date.now() - lastUse < IDLE_MS) send("beat", current.current);
        }, 60_000);
        return () => {
            clearInterval(timer);
            events.forEach(e => window.removeEventListener(e, used, { capture: true }));
        };
    }, [enabled]);
}
