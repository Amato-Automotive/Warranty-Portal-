import { createContext, useContext, useEffect } from "react";

/**
 * The store a customer has picked from a dropdown, passed up to the page so its
 * rating can sit in the top corner, as it does on the QR page. A form that picks
 * a store reports it here; a page that shows the rating provides the setter.
 */
export const SelectedStoreContext = createContext<((id: string | null) => void) | null>(null);

/** Reports the picked store (its portal id) while the form is open; forgets it when the form goes. */
export function useReportSelectedStore(storeId: string | null | undefined) {
    const report = useContext(SelectedStoreContext);
    useEffect(() => { report?.(storeId ? String(storeId) : null); }, [report, storeId]);
    useEffect(() => () => { report?.(null); }, [report]);
}
