import { useEffect, useState } from "react";
import api from "@/lib/api";

/** Whether a distributor-only store has a scheme open to it, so its Offers menu shows only when there is one. */
export function useDistributorHasScheme(isDistributorOnly: boolean) {
    const [has, setHas] = useState(false);
    useEffect(() => {
        if (!isDistributorOnly) { setHas(false); return; }
        let on = true;
        Promise.all([api.get("/schemes"), api.get("/schemes/distributor").catch(() => null)])
            .then(([own, stores]) => { if (on) setHas((own.data?.schemes ?? []).length > 0 || (stores?.data?.schemes ?? []).length > 0); })
            .catch(() => undefined);
        return () => { on = false; };
    }, [isDistributorOnly]);
    return has;
}
