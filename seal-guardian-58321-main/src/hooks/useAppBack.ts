import { useEffect, useRef } from "react";
import { APP_BACK_EVENT } from "@/lib/nativeShell";

/**
 * Android back button, inside the app, checked before page history.
 * Return true from the handler when it did something (e.g. went back to the
 * dashboard's home section), so the app doesn't offer to exit.
 * Never fires on the web.
 */
export function useAppBack(handler: () => boolean) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const listener = (e: Event) => {
      if (ref.current()) e.preventDefault();
    };
    window.addEventListener(APP_BACK_EVENT, listener);
    return () => window.removeEventListener(APP_BACK_EVENT, listener);
  }, []);
}
