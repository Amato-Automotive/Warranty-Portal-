import type { AxiosAdapter } from "axios";

/**
 * Training mode: the real franchise dashboard, on made-up data, for teaching
 * ASMs (and anyone an admin demos it to) without touching the live system.
 *
 * Decided once, from the address the tab was loaded at. A tab opened at
 * /training stays a training tab until it is closed or reloaded elsewhere, so
 * an in-app navigation can never switch the sandbox off halfway through. The
 * entry buttons open it in a new tab for the same reason: client-side routing
 * into /training would keep the live adapter.
 *
 * While it is on, nothing reaches the API: `api` answers from memory
 * (./mockApi), raw fetch and sendBeacon to the API are refused below, and the
 * notification socket is never opened. The only requests that leave are the
 * sign-in check in TrainingPage and anonymous reads of the public catalogue.
 */
export const TRAINING = typeof window !== "undefined" && /^\/training(\/|$)/.test(window.location.pathname);

/** Where Exit (or signing out of the training store) goes: the ASM portal or the admin panel. */
export const TRAINING_EXIT_KEY = "training_exit";

/** Loads the sandbox on first use, so a normal session never downloads it. */
export const trainingAdapter: AxiosAdapter = async (config) => (await import("./mockApi")).handle(config);

const API_HOST = "api.autoformindia.co.in";

const isApiUrl = (url: string, apiBase: string) => {
    try {
        const u = new URL(url, window.location.href);
        const base = new URL(apiBase, window.location.href);
        return u.host === base.host || u.host === API_HOST || (u.origin === window.location.origin && u.pathname.startsWith("/api/"));
    } catch {
        return false;
    }
};

/** Refuses every fetch / beacon to the API for the life of the tab. */
export function guardNetwork(apiBase: string) {
    if (!TRAINING) return;
    const realFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (isApiUrl(url, apiBase)) return Promise.reject(new TypeError("Not available in training mode"));
        return realFetch(input, init);
    };
    if (navigator.sendBeacon) {
        const realBeacon = navigator.sendBeacon.bind(navigator);
        navigator.sendBeacon = (url: string | URL, data?: BodyInit | null) => isApiUrl(String(url), apiBase) ? false : realBeacon(url, data);
    }
}
