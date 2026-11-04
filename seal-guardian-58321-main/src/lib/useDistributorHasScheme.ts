import { useEffect, useState } from "react";
import api from "@/lib/api";

/** Whether a distributor-only store has a scheme open to it, so its Offers menu shows only when there is one. */
export function useDistributorHasScheme(isDistributorOnly: boolean) {
    const [has, setHas] = useState(false);
    useEffect(() => {
        if (!isDistributorOnly) { setHas(false); return; }
        let on = true;
        api.get("/schemes")
            .then(r => { if (on) setHas((r.data?.schemes ?? []).length > 0); })
            .catch(() => undefined);
        return () => { on = false; };
    }, [isDistributorOnly]);
    return has;
}
