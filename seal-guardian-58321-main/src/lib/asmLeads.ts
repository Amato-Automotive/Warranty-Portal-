/** A lead as the ASM portal sees it. Read-only: ASMs do not record outcomes. */
export interface AsmLead {
    id: string;
    created_at: string;
    source: string | null;
    customer_name: string | null;
    customer_phone: string | null;
    product: string | null;
    car_model: string | null;
    state: string | null;
    raw_area: string | null;
    matched_area: string | null;
    pincode: string | null;
}

/** The customer's number as 10 digits, for tel: and WhatsApp links. */
export const phoneTail = (raw: string | null) => (raw || "").replace(/\D/g, "").slice(-10);

/** Products arrive already labelled ("Seat Covers", "Mats", "Accessories"). */
export const PRODUCTS = ["Seat Covers", "Mats", "Accessories"] as const;

export const SOURCE_LABEL: Record<string, string> = {
    whatsapp: "WhatsApp", instagram: "Instagram", ivr: "Phone call", website: "Website", sheet: "Lead sheet",
};
