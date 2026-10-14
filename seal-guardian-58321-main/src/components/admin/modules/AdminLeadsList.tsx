import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { downloadCSV } from "@/lib/utils";
import { getPhoneError, getCityError, cleanPlaceName } from "@/lib/validation";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from "@/components/ui/dialog";
import {
    Loader2, Search, RefreshCw, Inbox, AlertTriangle, Copy,
    Check, CheckCheck, XCircle, Pencil, Plus, MapPin, Download, CalendarDays,
    Store as StoreIcon, Send, X, SlidersHorizontal, ChevronDown
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * Every enquiry that reached us, and where it went.
 *
 * The list is deliberately led by what went wrong: an unmatched enquiry is a
 * customer nobody is calling back, and it is invisible unless something puts it
 * in front of an admin. Matched ones are just history.
 */

interface Lead {
    id: string;
    source: string;
    product: string | null;
    car_model: string | null;
    customer_name: string | null;
    customer_phone: string;
    raw_area: string | null;
    matched_area: string | null;
    asm_id: string | null;
    asm_name: string | null;
    asm_phone: string | null;
    status: "sent" | "failed" | "unmatched" | "duplicate" | "throttled" | "matched";
    failure_reason: string | null;
    created_at: string;
    sent_at: string | null;
    /* Live from Interakt's delivery webhook: whether the ASM's WhatsApp
       actually arrived, and whether they opened it. Null when no message was
       sent for this lead — unmatched, duplicate or throttled. */
    delivery_status: "sent" | "delivered" | "read" | "failed" | null;
    delivery_updated_at: string | null;
    /* The state the area resolved to — what actually decided the routing. */
    state: string | null;
    /* What an admin found calling the customer back. `lead_status` is still
       written by the API but no longer shown: forwarding is automatic, so
       there is nothing to record until somebody has actually made the call. */
    lead_status: Outcome | null;
    review_status: Outcome | null;
    review_reason: string | null;
    /* The auditor's own notes. Shown only in the Edit lead dialog: not in the
       table, the search or the export. */
    internal_notes: string | null;
    reviewed_at: string | null;
    /* The store an admin pointed this customer at, and whether the customer
       opened the message. Null until somebody sends one. */
    store_id: string | null;
    store_name: string | null;
    store_sent_at: string | null;
    store_msg_status: "sent" | "delivered" | "read" | "failed" | null;
    /* The pincode the customer gave (WhatsApp, Instagram), and the district
       it resolved to. Null for an area typed as words, as on IVR leads. */
    pincode: string | null;
    district: string | null;
    /* The area as typed, when it is more than the pincode. */
    area_text: string | null;
    /* Who set store_id: "customer" when they picked it from the WhatsApp
       list, otherwise the admin who sent it. */
    store_sent_by: string | null;
    /* The store's own "new lead" alert, sent when an admin gives an IVR or
       hand-added lead a store. */
    store_alert_status: Delivery | null;
    /* WhatsApp store-locator leads only: who the lead actually went to. */
    routing: LeadRouting | null;
    /* IVR leads only: the caller's calls, read by the server. */
    ivr: IvrSummary | null;
}

type Delivery = "sent" | "delivered" | "read" | "failed";

/* One WhatsApp a lead set off, as the server describes it. */
interface LeadMessage {
    at: string;
    updatedAt: string | null;
    to: "customer" | "store" | "asm" | "support" | "distributor" | "other";
    toName: string;
    phone: string | null;
    what: string;
    status: Delivery | null;
    error: string | null;
}

const MESSAGE_TO_LABEL: Record<LeadMessage["to"], string> = {
    customer: "Customer",
    store: "Store",
    asm: "ASM",
    support: "Support",
    distributor: "Distributor",
    other: "Other",
};

interface LeadRouting {
    outcome: "stores" | "distributor" | "asm" | "support" | "invalid-pincode";
    offered: number;
    held: boolean;
    recipients: { kind: "store" | "distributor" | "support"; id: string | null; name: string; delivery: Delivery | null }[];
    pickedOnly: string | null;
}

interface IvrSummary {
    status: "answered" | "missed" | "no-agent";
    calls: number;
    rings: number;
    answered: number;
    talkSeconds: number;
    lastCall: string | null;
    mobile: boolean;
    detail: {
        started: string | null;
        duration: number | null;
        rings: { group: string | null; to: string | null; answered: boolean; talked: number | null; at: string | null }[];
    }[];
}

/* The one IVR fact the team acts on: who is still waiting for a call back. */
const IVR_STATUS: Record<IvrSummary["status"], { label: string; tone: string }> = {
    missed: { label: "Missed call", tone: "bg-rose-50 text-rose-700 border-rose-200" },
    answered: { label: "Answered", tone: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    "no-agent": { label: "Left in menu", tone: "bg-slate-100 text-slate-500 border-slate-200" },
};

/** How far a WhatsApp alert got: Sent, Delivered, Read or Not delivered. */
const DeliveryLine = ({ status, title }: { status: Delivery | null; title?: string }) => {
    if (!status) return <div className="text-[11px] text-slate-400">No delivery record</div>;
    return (
        <div className={`text-[11px] mt-0.5 flex items-center gap-1 ${DELIVERY_TONE[status] || "text-slate-400"}`} title={title}>
            {status === "read"
                ? <CheckCheck className="h-3 w-3" />
                : status === "failed"
                    ? <XCircle className="h-3 w-3" />
                    : <Check className="h-3 w-3" />}
            {DELIVERY_LABEL[status]}
        </div>
    );
};

const RECIPIENT_LABEL: Record<string, string> = {
    store: "Store · customer's pick",
    distributor: "Distributor · customer's pick",
    support: "Customer support",
};

/**
 * Where a WhatsApp store-locator lead went. The locator offers stores within
 * 15 km, else alerts the ASM, else offers distributors, else alerts support —
 * and a store or distributor only hears of it once the customer picks one.
 * The ASM case is left to the caller, which already shows it.
 */
const LocatorForward = ({ routing }: { routing: LeadRouting }) => {
    if (routing.recipients.length) {
        return (
            <div className="space-y-1.5">
                {routing.recipients.map((r, i) => (
                    <div key={i}>
                        <div className="text-slate-800 font-medium truncate" title={r.name}>{r.name}</div>
                        <div className="text-[10px] uppercase tracking-wide text-slate-400">{RECIPIENT_LABEL[r.kind]}</div>
                        <DeliveryLine status={r.delivery} />
                    </div>
                ))}
            </div>
        );
    }
    if (routing.outcome === "invalid-pincode") {
        return (
            <span className="flex items-center gap-1.5 text-xs text-amber-600 font-medium">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                No valid pincode, asked again
            </span>
        );
    }
    if (routing.pickedOnly) {
        return (
            <>
                <div className="text-slate-800 font-medium truncate" title={routing.pickedOnly}>{routing.pickedOnly}</div>
                <div className="text-[11px] text-slate-400">Picked · not alerted (test mode)</div>
            </>
        );
    }
    if (routing.outcome === "support") {
        return (
            <>
                <div className="text-slate-800 font-medium">Customer support</div>
                <div className="text-[11px] text-amber-600">Not alerted{routing.held ? " (test mode)" : ""}</div>
            </>
        );
    }
    const what = routing.outcome === "distributor" ? "distributor" : "store";
    return (
        <>
            <div className="text-slate-600 text-xs">
                {routing.offered} {what}{routing.offered === 1 ? "" : "s"} offered
            </div>
            <div className="text-[11px] text-amber-600">Customer hasn't picked one yet</div>
        </>
    );
};

/** Everyone a lead was forwarded to, as one line: the ASM, or the stores,
    distributor or support a store-locator lead went to. */
const forwardedNames = (lead: Pick<Lead, "routing" | "asm_name" | "source" | "store_name" | "store_sent_by">) =>
    lead.routing && lead.routing.outcome !== "asm"
        ? lead.routing.recipients.map(r => r.name).join(", ")
        : lead.asm_name
            || (!AUTO_ROUTED.includes(lead.source) && lead.store_sent_by !== "customer" ? lead.store_name || "" : "");

/**
 * Where the customer is, in words: the district a pincode resolved to, or the
 * area as typed — never the bare pincode again, which has its own column.
 */
const placeOf = (lead: Pick<Lead, "area_text" | "district">) =>
    lead.area_text || lead.district;

/** "1m 12s", "45s". */
const formatSeconds = (s: number | null) => {
    if (s === null || s === undefined) return "—";
    const m = Math.floor(s / 60);
    return m ? `${m}m ${s % 60}s` : `${s}s`;
};

interface Store {
    id: string;
    store_name: string;
    store_code: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    phone_number: string | null;
    /* Within 15 km of the lead's pincode — or, with no pincode, the customer's
       own words point at this store's city. */
    near: boolean;
    /* "2.3 km", for stores found from the pincode. */
    distance_label?: string | null;
}

/* Counted by the server with every filter but the tile's own group, so a
   tile always matches the list it opens. */
interface Counts {
    total: number;
    stage: Record<Stage, number>;
    product: Record<string, number>;
    channel: Record<string, number>;
    review_pending: number;
    /* Leads in the date range and search, by vehicle — for the Vehicle filter. */
    vehicle?: Record<string, number>;
}

/*
 * Where a lead stands, in plain words — worked out by the server. Replaces the
 * routing statuses (unmatched, matched, throttled…), which described the
 * software: "Unmatched" read as a failure for every IVR lead that was simply
 * waiting for the auditor.
 */
type Stage = "answering" | "not-forwarded" | "no-pincode" | "choosing" | "forwarded" | "failed" | "repeat";

/*
 * Which filters each channel shows. The IVR never goes to an ASM and has no
 * store list to choose from; WhatsApp and Instagram route themselves, so who
 * got the lead is the question; website leads are entered by hand.
 */
const ALL_STAGES: Stage[] = ["answering", "not-forwarded", "no-pincode", "choosing", "forwarded", "failed", "repeat"];
const CHANNEL_FILTERS: Record<string, {
    stages: Stage[]; forwardedTo: boolean; ivrCall: boolean; asm: boolean; alert: boolean;
}> = {
    all: { stages: ALL_STAGES, forwardedTo: true, ivrCall: false, asm: true, alert: true },
    whatsapp: { stages: ALL_STAGES, forwardedTo: true, ivrCall: false, asm: true, alert: true },
    instagram: { stages: ALL_STAGES, forwardedTo: true, ivrCall: false, asm: true, alert: true },
    ivr: { stages: ["not-forwarded", "forwarded", "failed"], forwardedTo: false, ivrCall: true, asm: false, alert: true },
    website: { stages: ["not-forwarded", "forwarded", "failed"], forwardedTo: false, ivrCall: false, asm: false, alert: false },
    /* A WhatsApp enquiry the team added by hand: routed like IVR and website. */
    whatsapp_manual: { stages: ["not-forwarded", "forwarded", "failed"], forwardedTo: false, ivrCall: false, asm: false, alert: true },
};

/* A day as YYYY-MM-DD in the browser's own time — the team's, in India. */
const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };

/* The ranges people ask for, as [from, to], both inclusive. */
const DATE_PRESETS: { label: string; range: () => [string, string] }[] = [
    { label: "Today", range: () => [daysAgo(0), daysAgo(0)] },
    { label: "Yesterday", range: () => [daysAgo(1), daysAgo(1)] },
    { label: "Last 7 days", range: () => [daysAgo(6), daysAgo(0)] },
    { label: "This month", range: () => { const t = new Date(); return [ymd(new Date(t.getFullYear(), t.getMonth(), 1)), ymd(t)]; } },
];

const IVR_CALL_LABEL: Record<string, string> = {
    missed: "Missed call", answered: "Answered", "no-agent": "Left in menu",
};

const DELIVERY_FILTER_LABEL: Record<string, string> = {
    read: "Read", delivered: "Delivered", sent: "Sent only", failed: "Not delivered", none: "No alert sent",
};

const FORWARDED_TO_LABEL: Record<string, string> = {
    store: "Store", asm: "ASM", distributor: "Distributor", support: "Customer support", none: "Nobody yet",
};

const STAGE_LABEL: Record<Stage, string> = {
    answering: "Answering the bot",
    "not-forwarded": "Not forwarded yet",
    "no-pincode": "No valid pincode",
    choosing: "Choosing a store",
    forwarded: "Forwarded",
    failed: "Forwarding failed",
    repeat: "Repeat enquiry",
};

/*
 * The seven ways a lead conversation ends, as found when an admin calls the
 * customer back. Stored as an enum, so this list and the database must agree.
 */
const OUTCOMES = [
    { value: "no_response", label: "No response" },
    { value: "follow_up", label: "Follow up" },
    { value: "closed_won", label: "Closed won" },
    { value: "closed_lost", label: "Closed lost" },
    { value: "call_disconnected", label: "Call disconnected" },
    { value: "switched_off", label: "Switched off" },
    { value: "number_not_working", label: "Number not working" },
] as const;

type Outcome = (typeof OUTCOMES)[number]["value"];

const OUTCOME_LABEL: Record<string, string> =
    Object.fromEntries(OUTCOMES.map(o => [o.value, o.label]));

/* Only the two decided outcomes carry colour. The rest are states of not
   having reached anyone yet, and colouring five of seven would leave the
   column looking like a warning light. */
const OUTCOME_TONE: Record<string, string> = {
    closed_won: "bg-emerald-50 text-emerald-700 border-emerald-200",
    closed_lost: "bg-rose-50 text-rose-700 border-rose-200",
    follow_up: "bg-blue-50 text-blue-700 border-blue-200",
};

const CHANNEL_LABEL: Record<string, string> = {
    whatsapp: "WhatsApp",
    instagram: "Instagram",
    ivr: "IVR",
    website: "Website",
    whatsapp_manual: "WhatsApp (added)",
};

/* The channels that find their own ASM or store. The rest (IVR, website, and
   WhatsApp enquiries added by hand) wait for the auditor to forward them. */
const AUTO_ROUTED = ["whatsapp", "instagram"];

/* 2-wheelers are filed with "2-Wheeler" in the vehicle (the chat's first
   question, or Add Lead); everything else is a car. The model on its own,
   without that tag, for showing under the type. */
const isTwoWheeler = (car: string | null | undefined) => /2-Wheeler/i.test(car || "");
const modelOnly = (car: string | null | undefined) =>
    String(car || "").replace(/\s*\(2-Wheeler\)\s*$/i, "").replace(/^2-Wheeler$/i, "").trim();

/* What happened to the store's own alert after an admin sent a store. */
const STORE_ALERT_NOTE: Record<string, string> = {
    sent: " The store was alerted too.",
    already: " The store had already been alerted about this lead.",
    "not-live": " The store was not alerted: WhatsApp replies are not live.",
    "no-phone": " The store was not alerted: it has no phone number.",
    failed: " The store's alert could not be sent.",
};

const STATUS_STYLE: Record<string, string> = {
    sent: "bg-emerald-50 text-emerald-700 border-emerald-200",
    failed: "bg-rose-50 text-rose-700 border-rose-200",
    unmatched: "bg-amber-50 text-amber-700 border-amber-200",
    duplicate: "bg-slate-100 text-slate-500 border-slate-200",
    // Capped by the daily per-number limit — not a failure, but not sent either.
    throttled: "bg-slate-100 text-slate-500 border-slate-200",
    matched: "bg-blue-50 text-blue-700 border-blue-200",
};

/*
 * How far the ASM's message got.
 *
 * Deliberately quieter than the lead's own status badge: the lead being
 * forwarded is the headline, and whether it has been read yet is the detail
 * underneath it. Only 'failed' takes a loud colour, because that is the one
 * that needs somebody to act.
 */
const DELIVERY_LABEL: Record<string, string> = {
    sent: "Sent",
    delivered: "Delivered",
    read: "Read",
    failed: "Not delivered",
};

const DELIVERY_TONE: Record<string, string> = {
    sent: "text-slate-400",
    delivered: "text-slate-500",
    read: "text-emerald-600",
    failed: "text-rose-600",
};

const PRODUCT_STYLE: Record<string, string> = {
    "Seat Covers": "bg-orange-50 text-orange-700 border-orange-200",
    Mats: "bg-violet-50 text-violet-700 border-violet-200",
    Accessories: "bg-sky-50 text-sky-700 border-sky-200",
};

/**
 * One address line, without repeating the city or pincode.
 *
 * Most stored addresses already end with their own city and pincode —
 * "…TONK ROAD JAIPUR-302018" — so appending both again produced
 * "…JAIPUR-302018, JAIPUR, 302018" in a message a customer reads. Mirrors the
 * server exactly, so this preview is what actually gets sent.
 */
const buildAddress = (s: { address: string | null; city: string | null; pincode: string | null }) => {
    const base = String(s.address || "").trim().replace(/[,\s]+$/, "");
    const squashed = base.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const parts = [base];
    for (const extra of [s.city, s.pincode]) {
        const value = String(extra || "").trim();
        if (!value) continue;
        const key = value.toLowerCase().replace(/[^a-z0-9]+/g, "");
        if (key && !squashed.includes(key)) parts.push(value);
    }
    return parts.filter(Boolean).join(", ");
};

/** "10 Sep, 3:45 PM" — the same shape the ASM sees on WhatsApp. */
const formatWhen = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("en-IN", {
        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: true,
    });
};

export const AdminLeadsList = () => {
    const { toast } = useToast();
    const [leads, setLeads] = useState<Lead[]>([]);
    const [counts, setCounts] = useState<Counts | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    /* A filter or search is fetching: the table stays, faded, until it lands. */
    const [updating, setUpdating] = useState(false);
    /* Only the first load blanks the screen. Swapping the whole page — tiles,
       filters, table — for a spinner on every filter click made each one feel
       like a reload, though the answer takes a fraction of a second. */
    const loadedOnce = useRef(false);
    /* Two quick clicks: only the answer to the last one is shown. */
    const latestRequest = useRef(0);
    const [search, setSearch] = useState("");
    /* What the server searches for: the box, a moment after typing stops. */
    const [searchQuery, setSearchQuery] = useState("");
    const [stage, setStage] = useState("all");
    /* How many leads matched, when more than the page shows. */
    const [matched, setMatched] = useState(0);
    /* Filters that only mean something for some channels — see CHANNEL_FILTERS. */
    const [forwardedTo, setForwardedTo] = useState("all");
    const [storeId, setStoreId] = useState("all");
    const [ivrCall, setIvrCall] = useState("all");
    const [storeOptions, setStoreOptions] = useState<{ id: string; name: string; count: number }[]>([]);
    const [stateFilter, setStateFilter] = useState("all");
    /* 4-wheeler or 2-wheeler: 2-wheelers go to the Customer Executive. */
    const [vehicleFilter, setVehicleFilter] = useState("all");
    const [stateOptions, setStateOptions] = useState<{ name: string; count: number }[]>([]);
    const [product, setProduct] = useState("all");
    const [delivery, setDelivery] = useState("all");
    const [asmId, setAsmId] = useState("all");
    const [channel, setChannel] = useState("all");
    const [review, setReview] = useState("all");
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    const [asmOptions, setAsmOptions] = useState<
        { id: string; name: string; is_active?: number; lead_count?: number }[]
    >([]);

    // Editing one lead: the audit, and corrections to what was captured.
    const [editing, setEditing] = useState<Lead | null>(null);
    const EMPTY_EDIT = {
        review_status: "", review_reason: "", internal_notes: "",
        customer_name: "", raw_area: "", car_model: "", pincode: "", product: "",
    };
    const [editForm, setEditForm] = useState(EMPTY_EDIT);
    /* The form as it opened, so a save sends only what the auditor changed —
       re-sending an untouched area used to re-resolve, and wipe, its state. */
    const [editBase, setEditBase] = useState(EMPTY_EDIT);
    /* Every WhatsApp this lead set off, for the history in Edit lead. */
    const [messages, setMessages] = useState<LeadMessage[] | null>(null);
    /* Where the store list was looked up for, as the server resolved it. */
    const [storesFor, setStoresFor] = useState<{
        state: string | null; pincode: string | null; district: string | null; message?: string;
    } | null>(null);
    const [saving, setSaving] = useState(false);

    // Choosing a store to give the customer, from inside the edit dialog.
    const [stores, setStores] = useState<Store[]>([]);
    const [loadingStores, setLoadingStores] = useState(false);
    const [storeSearch, setStoreSearch] = useState("");
    const [chosenStore, setChosenStore] = useState<string | null>(null);
    const [sendingStore, setSendingStore] = useState(false);

    // Adding a lead by hand, for IVR, website and WhatsApp enquiries.
    const [addOpen, setAddOpen] = useState(false);
    /* Stores for the area typed into the add form, loaded before any lead
       exists so the customer can be given one in the same step. */
    const [addStores, setAddStores] = useState<any[]>([]);
    const [addStore, setAddStore] = useState<string | null>(null);
    const [addStoreSearch, setAddStoreSearch] = useState("");
    const [loadingAddStores, setLoadingAddStores] = useState(false);

    const [addForm, setAddForm] = useState({
        name: "", phone: "", pincode: "", area: "", product: "", car: "", source: "ivr", internal_notes: "",
        /* 2w: goes to the Customer Executive, not a store — no pincode needed. */
        wheels: "4w" as "4w" | "2w",
    });
    const [addPreview, setAddPreview] = useState<{
        state: string | null; matched: boolean; asm_name: string | null; district?: string | null;
        /* With a pincode: where the chain lands — stores to pick from, or who gets it instead. */
        outcome?: "stores" | "asm" | "distributor" | "support"; store_count?: number; contact_name?: string | null;
    } | null>(null);
    const [previewing, setPreviewing] = useState(false);
    const [adding, setAdding] = useState(false);
    /* The same validators the public forms use. A lead with an unusable
       number is one nobody can ever call back, which is the whole point of
       capturing it. */
    const addPhoneError = getPhoneError(addForm.phone);
    /* The pincode is what lets a store be sent to the customer; the area is
       only for a customer who does not know theirs. One of the two is needed. */
    const addPinOk = /^[1-9]\d{5}$/.test(addForm.pincode);
    const addPinError = addForm.pincode && !addPinOk ? "A pincode is 6 digits, not starting with 0." : null;
    const addAreaError = addForm.area.trim() ? getCityError(addForm.area) : null;
    const addTwoWheeler = addForm.wheels === "2w";
    const addValid = Boolean(addForm.phone.trim()) && !addPhoneError && !addPinError && !addAreaError
        && (addTwoWheeler || addPinOk || Boolean(addForm.area.trim()));


    const fetchLeads = useCallback(async (silent = false) => {
        const request = ++latestRequest.current;
        if (silent) setRefreshing(true);
        else if (loadedOnce.current) setUpdating(true);
        else setLoading(true);
        try {
            const params: Record<string, string> = {};
            if (stage !== "all") params.stage = stage;
            if (searchQuery) params.q = searchQuery;
            if (forwardedTo !== "all") params.forwarded_to = forwardedTo;
            if (storeId !== "all") params.store = storeId;
            if (ivrCall !== "all") params.ivr_call = ivrCall;
            if (stateFilter !== "all") params.state = stateFilter;
            if (vehicleFilter !== "all") params.vehicle = vehicleFilter;
            if (product !== "all") params.product = product;
            if (delivery !== "all") params.delivery = delivery;
            if (asmId !== "all") params.asm_id = asmId;
            if (channel !== "all") params.source = channel;
            if (review !== "all") params.review = review;
            if (dateFrom) params.dateFrom = dateFrom;
            if (dateTo) params.dateTo = dateTo;

            const res = await api.get("/asm/leads/list", { params });
            if (request !== latestRequest.current) return;
            if (res.data.success) {
                setLeads(res.data.leads || []);
                setCounts(res.data.counts || null);
                setMatched(res.data.matched ?? (res.data.leads || []).length);
                setStoreOptions(res.data.stores || []);
                setStateOptions(res.data.states || []);
                /*
                 * The options are the full set regardless of the active filter
                 * — the server derives them from all leads, not the filtered
                 * page. Narrowing them to the current result would leave the
                 * dropdown holding only the ASM already selected, with no way
                 * back to the others.
                 */
                setAsmOptions(res.data.asms || []);
            }
        } catch (error: any) {
            if (request !== latestRequest.current) return;
            toast({
                title: "Could not load enquiries",
                description: getErrorMessage(error, "Please try again"),
                variant: "destructive",
            });
        } finally {
            if (request === latestRequest.current) {
                loadedOnce.current = true;
                setLoading(false);
                setRefreshing(false);
                setUpdating(false);
            }
        }
    }, [stage, searchQuery, forwardedTo, storeId, ivrCall, stateFilter, vehicleFilter, product, delivery, asmId, channel, review, dateFrom, dateTo, toast]);

    const clearFilters = () => {
        setSearch(""); setStage("all"); setProduct("all"); setChannel("all");
        setDelivery("all"); setAsmId("all"); setReview("all");
        setForwardedTo("all"); setStoreId("all"); setIvrCall("all"); setStateFilter("all"); setVehicleFilter("all");
        setDateFrom(""); setDateTo("");
    };

    /*
     * A channel shows only the filters that can mean something for it, and
     * switching drops any that no longer apply — a hidden filter still
     * narrowing the list is worse than no filter.
     */
    const shows = CHANNEL_FILTERS[channel] ?? CHANNEL_FILTERS.all;
    const pickChannel = (next: string) => {
        const allowed = CHANNEL_FILTERS[next] ?? CHANNEL_FILTERS.all;
        setChannel(next);
        if (!allowed.stages.includes(stage as Stage)) setStage("all");
        if (!allowed.forwardedTo) { setForwardedTo("all"); setStoreId("all"); }
        if (!allowed.ivrCall) setIvrCall("all");
        if (!allowed.asm) setAsmId("all");
        if (!allowed.alert) setDelivery("all");
    };

    /* Search on the server, over every lead in the range — not only the page
       on screen — once typing pauses. */
    useEffect(() => {
        const t = setTimeout(() => setSearchQuery(search.trim()), 350);
        return () => clearTimeout(t);
    }, [search]);

    useEffect(() => { fetchLeads(); }, [fetchLeads]);

    /*
     * Keep the delivery states current.
     *
     * A message goes sent → delivered → read over seconds or minutes, and those
     * changes arrive on Interakt's webhook rather than from anything the admin
     * does here — so without a poll the column would sit on whatever it said
     * when the page loaded.
     *
     * Thirty seconds, and silently: a refresh that emptied the table or moved
     * the scroll position while somebody was reading it would be worse than a
     * slightly stale label. Paused while the tab is hidden, since nobody is
     * watching and the query is not free.
     */
    useEffect(() => {
        const tick = () => {
            if (document.visibilityState === "visible") fetchLeads(true);
        };
        const id = setInterval(tick, 30_000);
        return () => clearInterval(id);
    }, [fetchLeads]);

    /*
     * Searching filters what is already loaded rather than asking the server.
     * The list is capped at a couple of hundred rows, so this is instant and
     * keeps typing responsive; the status and product filters go to the server
     * because they change which rows are in scope at all.
     */
    // Every filter, the search included, is applied by the server.
    const visible = leads;

    /*
     * Load the stores that could serve this lead when the dialog opens.
     *
     * Fetched per lead rather than held for the whole list: the set depends on
     * the lead's state, and most leads are never opened.
     */
    const loadStores = async (leadId: string, typed?: { pincode: string; area: string }) => {
        setLoadingStores(true);
        setStores([]);
        try {
            /* What the dialog has typed, so a new pincode shows its stores
               before anything is saved. */
            const res = await api.get(`/asm/leads/${leadId}/stores`, { params: typed });
            if (res.data.success) {
                setStores(res.data.stores || []);
                setStoresFor({
                    state: res.data.state ?? null, pincode: res.data.pincode ?? null,
                    district: res.data.district ?? null, message: res.data.message,
                });
            }
        } catch {
            /* The dialog is still useful without them; the empty state says so. */
        } finally {
            setLoadingStores(false);
        }
    };

    /*
     * Give the customer a store.
     *
     * This message goes to a member of the public and cannot be recalled, so
     * the admin confirms the store by name first — the button says who it is
     * about to reach.
     */
    const sendStore = async () => {
        if (!editing || !chosenStore) return;
        const store = stores.find(s => s.id === chosenStore);
        if (!store) return;

        const again = editing.store_sent_at
            ? `This customer was already sent store details on ${formatWhen(editing.store_sent_at)}.\n\n`
            : "";
        /* IVR and hand-added leads also alert the store, as a WhatsApp
           customer's own pick does. */
        const alertsStore = !AUTO_ROUTED.includes(editing.source);
        if (!window.confirm(
            `${again}Send ${store.store_name} to ${editing.customer_phone}?\n\n` +
            `This is a WhatsApp message to the customer and cannot be undone.` +
            (alertsStore ? `\n\n${store.store_name} will also get a "new lead" WhatsApp with this customer's number.` : "")
        )) return;

        setSendingStore(true);
        try {
            /* Whatever was typed above goes with it — a pincode entered to find
               this store should not be lost for want of pressing Save. */
            const changes = editChanges();
            if (Object.keys(changes).length) await api.put(`/asm/leads/${editing.id}`, changes);

            const res = await api.post(`/asm/leads/${editing.id}/send-store`, { store_id: chosenStore });
            if (res.data.success) {
                toast({
                    title: "Store details sent",
                    description: `${res.data.message}${STORE_ALERT_NOTE[res.data.store_alert] ?? ""}`,
                });
                setEditing(null);
                setChosenStore(null);
                fetchLeads(true);
            }
        } catch (error: any) {
            toast({
                title: "Could not send",
                description: getErrorMessage(error, "Please try again"),
                variant: "destructive",
            });
        } finally {
            setSendingStore(false);
        }
    };

    const openEdit = (lead: Lead) => {
        setEditing(lead);
        setChosenStore(lead.store_id || null);
        setStoreSearch("");
        setStoresFor(null);
        loadStores(lead.id);
        setMessages(null);
        api.get(`/asm/leads/${lead.id}/messages`)
            .then(res => setMessages(res.data.success ? res.data.messages : []))
            .catch(() => setMessages([]));
        const form = {
            review_status: lead.review_status || "",
            review_reason: lead.review_reason || "",
            internal_notes: lead.internal_notes || "",
            customer_name: lead.customer_name || "",
            /* The area as typed; a WhatsApp lead's bare pincode shows under
               Pincode instead, not twice. */
            raw_area: lead.area_text || "",
            car_model: lead.car_model || "",
            pincode: lead.pincode || "",
            product: lead.product || "",
        };
        setEditForm(form);
        setEditBase(form);
    };

    /* Only what the auditor changed. */
    const editChanges = () =>
        Object.fromEntries(
            Object.entries(editForm).filter(([k, v]) => v !== editBase[k as keyof typeof editBase])
        );

    /*
     * A pincode or area typed in the dialog re-finds the stores. A pincode
     * once it is six digits (or cleared); an area when the field is left.
     */
    const refindStores = (form: typeof editForm) => {
        if (!editing) return;
        const pin = form.pincode.trim();
        if (pin && !/^[1-9]\d{5}$/.test(pin)) return;
        loadStores(editing.id, { pincode: pin, area: form.raw_area.trim() });
    };

    const saveEdit = async () => {
        if (!editing) return;
        const changes = editChanges();
        if (!Object.keys(changes).length) {
            setEditing(null);
            return;
        }
        setSaving(true);
        try {
            const res = await api.put(`/asm/leads/${editing.id}`, changes);
            if (res.data.success) {
                toast({ title: "Lead updated", description: res.data.message });
                setEditing(null);
                fetchLeads(true);
            }
        } catch (error: any) {
            toast({
                title: "Could not save",
                description: getErrorMessage(error, "Please try again"),
                variant: "destructive",
            });
        } finally {
            setSaving(false);
        }
    };

    /*
     * Resolve the area before anything is sent.
     *
     * Saving this form puts a real WhatsApp on an ASM's phone, and a mistyped
     * area cannot be recalled — so the form says who it is about to reach, and
     * the admin confirms it.
     */
    const previewLead = async (form = addForm) => {
        // A 2-wheeler goes to the executive whatever the area: nothing to look up.
        if (form.wheels === "2w") return;
        const pinOk = /^[1-9]\d{5}$/.test(form.pincode);
        if (!pinOk && !form.area.trim()) return;
        setPreviewing(true);
        try {
            // The phone is not needed to see where the lead goes; a placeholder keeps the check happy.
            const res = await api.post("/asm/leads", { ...form, phone: form.phone || "9999999999", preview: true });
            if (res.data.success) {
                setAddPreview({
                    state: res.data.state,
                    matched: res.data.matched,
                    asm_name: res.data.asm_name,
                    district: res.data.district ?? null,
                    outcome: res.data.outcome,
                    store_count: res.data.store_count,
                    contact_name: res.data.contact_name ?? null,
                });
            }
        } catch {
            setAddPreview(null);
        } finally {
            setPreviewing(false);
        }
        loadAddStores(form.area, pinOk ? form.pincode : "");
    };

    /*
     * The stores that could serve this area, while the form is still open.
     *
     * Keyed on the typed area rather than a lead, since there is no lead yet.
     * A previously chosen store is cleared whenever the area changes — it
     * belonged to the old state, and silently sending it would be worse than
     * making the admin pick again.
     */
    const loadAddStores = async (area: string, pincode = "") => {
        const q = String(area || "").trim();
        setAddStore(null);
        setAddStoreSearch("");
        if (!q && !pincode) { setAddStores([]); return; }

        setLoadingAddStores(true);
        try {
            // By pincode: the stores near the customer, nearest first, as WhatsApp offers them.
            const res = await api.get("/asm/stores-for-area", { params: { area: q, ...(pincode ? { pincode } : {}) } });
            setAddStores(res.data?.success ? (res.data.stores || []) : []);
        } catch {
            /* The form still works without them; the empty state says so. */
            setAddStores([]);
        } finally {
            setLoadingAddStores(false);
        }
    };

    /*
     * Add the lead, and give the customer a store in the same step.
     *
     * A lead taken over the phone is the moment the customer is still on the
     * line, so the store list sits in the form itself rather than behind a
     * second dialog. The lead is created first regardless — if the send fails,
     * the lead is still saved and the store can go from the row like any other.
     */
    const submitLead = async () => {
        setAdding(true);
        try {
            // A picked store ends the chain: only the customer and that store are messaged.
            const res = await api.post("/asm/leads", { ...addForm, store_picked: !addTwoWheeler && Boolean(addStore) });
            if (!res.data.success) return;

            const created = res.data.id;
            let storeNote = "";

            if (!addTwoWheeler && addStore && created) {
                const store = addStores.find(s => s.id === addStore);
                try {
                    const sent = await api.post(`/asm/leads/${created}/send-store`, { store_id: addStore });
                    storeNote = sent.data.success
                        ? ` · ${store?.store_name} sent to the customer`
                        : "";
                } catch (err: any) {
                    // The lead exists either way; say so rather than implying
                    // the whole thing failed.
                    toast({
                        title: "Lead saved, store not sent",
                        description: getErrorMessage(err, "Send it from the lead row instead"),
                        variant: "destructive",
                    });
                }
            }

            toast({ title: "Lead added", description: res.data.message + storeNote });
            setAddOpen(false);
            setAddForm({ name: "", phone: "", pincode: "", area: "", product: "", car: "", source: "ivr", internal_notes: "", wheels: "4w" });
            setAddPreview(null);
            setAddStores([]);
            setAddStore(null);
            setAddStoreSearch("");
            fetchLeads(true);
        } catch (error: any) {
            toast({
                title: "Could not add the lead",
                description: getErrorMessage(error, "Please try again"),
                variant: "destructive",
            });
        } finally {
            setAdding(false);
        }
    };

    /*
     * Export exactly what is on screen.
     *
     * `visible` is the filtered, searched list, so a filtered export matches
     * the filtered table — an export that quietly returned everything would be
     * worse than none, because nobody checks the row count of a file they just
     * downloaded.
     *
     * Columns mirror the table, in the same order, with the codes spelled out:
     * a spreadsheet reading "closed_won" helps nobody.
     */
    const exportCsv = () => {
        if (!visible.length) {
            toast({ title: "Nothing to export", description: "No enquiries match the current filters." });
            return;
        }

        const rows = visible.map(lead => ({
            Date: formatWhen(lead.created_at),
            Customer: lead.customer_name || "",
            Phone: lead.customer_phone,
            Channel: CHANNEL_LABEL[lead.source] || lead.source,
            "IVR call": lead.ivr ? IVR_STATUS[lead.ivr.status].label : "",
            "IVR calls / rings": lead.ivr ? `${lead.ivr.calls} / ${lead.ivr.rings}` : "",
            "IVR talk time": lead.ivr ? formatSeconds(lead.ivr.talkSeconds) : "",
            Pincode: lead.pincode || "",
            Area: placeOf(lead) || "",
            State: lead.state || "",
            "Vehicle type": isTwoWheeler(lead.car_model) ? "2-Wheeler" : "4-Wheeler",
            Vehicle: modelOnly(lead.car_model),
            Product: lead.product || "",
            "Forwarded to": forwardedNames(lead),
            "ASM phone": lead.asm_phone || "",
            Forwarding: lead.status,
            Delivery: lead.delivery_status ? DELIVERY_LABEL[lead.delivery_status] : "",
            "Store sent": lead.store_sent_by !== "customer" && AUTO_ROUTED.includes(lead.source) ? lead.store_name || "" : "",
            "Store alert": lead.store_alert_status ? DELIVERY_LABEL[lead.store_alert_status] : "",
            "Store message": lead.store_msg_status ? DELIVERY_LABEL[lead.store_msg_status] : "",
            "Store sent at": lead.store_sent_at ? formatWhen(lead.store_sent_at) : "",
            Review: lead.review_status ? OUTCOME_LABEL[lead.review_status] : "",
            "Review reason": lead.review_reason || "",
            "Reviewed at": lead.reviewed_at ? formatWhen(lead.reviewed_at) : "",
        }));

        // The filters are in the filename, so a file found later still says
        // what it was a view of.
        const parts = ["leads"];
        if (status !== "all") parts.push(status);
        if (product !== "all") parts.push(product.replace(/\s+/g, "-").toLowerCase());
        if (delivery !== "all") parts.push(delivery);
        if (channel !== "all") parts.push(channel);
        if (review !== "all") parts.push(`review-${review}`);
        if (asmId !== "all") {
            const asm = asmOptions.find(a => a.id === asmId);
            if (asm) parts.push(asm.name.replace(/\s+/g, "-").toLowerCase());
        }
        if (dateFrom || dateTo) parts.push(`${dateFrom || "start"}-to-${dateTo || "today"}`);
        parts.push(new Date().toISOString().slice(0, 10));

        downloadCSV(rows, `${parts.join("_")}.csv`);
        toast({
            title: "Export started",
            description: `${rows.length} enquir${rows.length === 1 ? "y" : "ies"} downloaded`,
        });
    };

    /** Whether anything is narrowing the list — so an empty result can say why. */
    const anyFilter = Boolean(
        search.trim() || stage !== "all" || product !== "all" ||
        forwardedTo !== "all" || storeId !== "all" || ivrCall !== "all" || stateFilter !== "all" || vehicleFilter !== "all" ||
        delivery !== "all" || asmId !== "all" || channel !== "all" ||
        review !== "all" || dateFrom || dateTo
    );

    /*
     * Every filter in force, as a chip with its own ✕ — so what is narrowing
     * the list is always in plain sight, and each can be undone on its own.
     */
    const chip = (key: string, label: string, clear: () => void) => ({ key, label, clear });
    const activeChips = [
        search.trim() && chip("q", `Search: "${search.trim()}"`, () => setSearch("")),
        (dateFrom || dateTo) && chip("date",
            DATE_PRESETS.find(p => { const [f, t] = p.range(); return f === dateFrom && t === dateTo; })?.label
                ?? `${dateFrom || "…"} – ${dateTo || "…"}`,
            () => { setDateFrom(""); setDateTo(""); }),
        channel !== "all" && chip("ch", CHANNEL_LABEL[channel] || channel, () => pickChannel("all")),
        stage !== "all" && chip("st", STAGE_LABEL[stage as Stage] ?? stage, () => setStage("all")),
        product !== "all" && chip("pr", product === "none" ? "Product not given" : product, () => setProduct("all")),
        ivrCall !== "all" && chip("ivr", IVR_CALL_LABEL[ivrCall] ?? ivrCall, () => setIvrCall("all")),
        vehicleFilter !== "all" && chip("veh", vehicleFilter === "2w" ? "2-Wheeler" : "4-Wheeler", () => setVehicleFilter("all")),
        forwardedTo !== "all" && chip("fw", `Forwarded to: ${FORWARDED_TO_LABEL[forwardedTo] ?? forwardedTo}`, () => setForwardedTo("all")),
        storeId !== "all" && chip("store", `Store: ${storeOptions.find(s => s.id === storeId)?.name ?? "…"}`, () => setStoreId("all")),
        delivery !== "all" && chip("dl", `Alert: ${DELIVERY_FILTER_LABEL[delivery] ?? delivery}`, () => setDelivery("all")),
        review !== "all" && chip("rv", review === "pending" ? "Not reviewed" : `Review: ${OUTCOME_LABEL[review] ?? review}`, () => setReview("all")),
        asmId !== "all" && chip("asm", `ASM: ${asmOptions.find(a => a.id === asmId)?.name ?? "…"}`, () => setAsmId("all")),
        stateFilter !== "all" && chip("state", stateFilter === "none" ? "State not known" : stateFilter, () => setStateFilter("all")),
    ].filter(Boolean) as { key: string; label: string; clear: () => void }[];

    /* A filter as [value, label, count?] options — for the pills and the panel. */
    type FilterDef = { label: string; value: string; set: (v: string) => void; options: [string, string, number?][] };

    /* The three most used, up front as pills. */
    const pillFilters: FilterDef[] = [
        {
            label: "Channel", value: channel, set: pickChannel,
            options: [["all", "All"], ...Object.entries(CHANNEL_LABEL).map(([k, l]) => [k, l, counts?.channel[k]] as [string, string, number?])],
        },
        {
            label: "Stage", value: stage, set: setStage,
            options: [["all", "Any"], ...shows.stages.map(s => [s, STAGE_LABEL[s], counts?.stage[s]] as [string, string, number?])],
        },
        {
            label: "Product", value: product, set: setProduct,
            options: [
                ["all", "Any"],
                ...["Seat Covers", "Mats", "Accessories"].map(p => [p, p, counts?.product[p]] as [string, string, number?]),
                ["none", "Not given", counts?.product.none],
            ],
        },
        {
            label: "Vehicle", value: vehicleFilter, set: setVehicleFilter,
            options: [
                ["all", "Any"],
                ["4w", "4-Wheeler", counts?.vehicle?.["4w"]],
                ["2w", "2-Wheeler", counts?.vehicle?.["2w"]],
            ],
        },
    ];

    /* The rest, behind "Filters" — only those that mean something for the channel. */
    const panelFilters: FilterDef[] = [
        ...(shows.forwardedTo ? [{
            label: "Forwarded to", value: forwardedTo, set: setForwardedTo,
            options: [["all", "Anyone"], ...Object.entries(FORWARDED_TO_LABEL)] as [string, string][],
        }] : []),
        ...(shows.forwardedTo && storeOptions.length ? [{
            label: "Store", value: storeId, set: setStoreId,
            options: [["all", "All stores"], ...storeOptions.map(s => [s.id, `${s.name} · ${s.count}`])] as [string, string][],
        }] : []),
        ...(shows.ivrCall ? [{
            label: "IVR call", value: ivrCall, set: setIvrCall,
            options: [["all", "Any"], ...Object.entries(IVR_CALL_LABEL)] as [string, string][],
        }] : []),
        ...(shows.alert ? [{
            label: "Alert delivery", value: delivery, set: setDelivery,
            options: [["all", "Any"], ...Object.entries(DELIVERY_FILTER_LABEL)] as [string, string][],
        }] : []),
        {
            label: "Review", value: review, set: setReview,
            options: [["all", "Any"], ["pending", "Not reviewed"], ...OUTCOMES.map(o => [o.value, o.label])] as [string, string][],
        },
        ...(shows.asm && asmOptions.length ? [{
            label: "ASM", value: asmId, set: setAsmId,
            options: [["all", "All ASMs"], ...asmOptions.map(a => [a.id, `${a.name}${a.is_active ? "" : " (inactive)"}`])] as [string, string][],
        }] : []),
        ...(stateOptions.length ? [{
            label: "State", value: stateFilter, set: setStateFilter,
            options: [["all", "All states"], ...stateOptions.map(s => [s.name, `${s.name} · ${s.count}`]), ["none", "State not known"]] as [string, string][],
        }] : []),
    ];
    const panelCount = [forwardedTo, storeId, delivery, review, asmId, stateFilter, ivrCall].filter(v => v !== "all").length;

    /* "Last 7 days", or "12 Sept – 20 Sept" for a custom range. */
    const shortDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
    const dateLabel = !dateFrom && !dateTo
        ? "Any date"
        : DATE_PRESETS.find(p => { const [f, t] = p.range(); return f === dateFrom && t === dateTo; })?.label
            ?? `${dateFrom ? shortDay(dateFrom) : "…"} – ${dateTo ? shortDay(dateTo) : "…"}`;

    const copyPhone = (phone: string) => {
        navigator.clipboard?.writeText(phone)
            .then(() => toast({ title: "Number copied", description: phone }))
            .catch(() => { /* clipboard is blocked in some browsers — not worth an error */ });
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[400px] gap-3 text-slate-400">
                <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
                <span className="text-sm font-medium">Loading enquiries…</span>
            </div>
        );
    }

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h3 className="text-lg font-black tracking-tight text-slate-800 uppercase">Enquiries</h3>
                    <p className="text-sm text-slate-500 mt-0.5">
                        Every enquiry received, and the ASM it was forwarded to.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => fetchLeads(true)} disabled={refreshing}>
                        <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                    </Button>
                    {/* IVR and website enquiries arrive by phone or a form, so
                        somebody has to enter them. They route and send exactly
                        like an automatic lead once saved. */}
                    <Button
                        variant="outline" size="sm"
                        onClick={exportCsv}
                        disabled={!visible.length}
                        title="Export the enquiries currently shown"
                    >
                        <Download className="h-4 w-4 mr-1.5" />
                        Export{visible.length ? ` (${visible.length})` : ""}
                    </Button>
                    <Button size="sm" onClick={() => setAddOpen(true)} className="bg-orange-500 hover:bg-orange-600">
                        <Plus className="h-4 w-4 mr-1.5" /> Add Lead
                    </Button>
                </div>
            </div>

            {/* Total and where the enquiries came from, one row. Each tile
                filters the list to its channel, and clicking it again (or
                Total) clears that. Stage and product are filters at the top of
                the list, with their counts.

                Total adds up the channels, so it stays the same while one is
                picked. A channel with nothing in it is still shown: a campaign
                that has stopped producing leads is worth noticing. */}
            {counts && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                    {([
                        { label: "Total", value: Object.values(counts.channel).reduce((a, b) => a + (b || 0), 0), tone: "text-slate-800", key: "all" },
                        { label: "WhatsApp", value: counts.channel.whatsapp, tone: "text-emerald-700", key: "whatsapp" },
                        { label: "Instagram", value: counts.channel.instagram, tone: "text-pink-500", key: "instagram" },
                        { label: "IVR", value: counts.channel.ivr, tone: "text-indigo-600", key: "ivr" },
                        { label: "Website", value: counts.channel.website, tone: "text-cyan-600", key: "website" },
                        { label: "WhatsApp (added)", value: counts.channel.whatsapp_manual, tone: "text-teal-600", key: "whatsapp_manual" },
                    ] as const).map(s => {
                        const active = channel === s.key;
                        const empty = !s.value;
                        return (
                            <button
                                key={s.label}
                                type="button"
                                onClick={() => pickChannel(active || s.key === "all" ? "all" : s.key)}
                                className={`rounded-2xl border bg-white p-3.5 text-left transition-colors ${
                                    active
                                        ? "border-orange-300 ring-1 ring-orange-100"
                                        : "border-slate-100 hover:border-slate-200"
                                }`}
                            >
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 truncate">
                                    {s.label}
                                </p>
                                <p className={`text-2xl font-black tabular-nums mt-0.5 ${empty ? "text-slate-300" : s.tone}`}>
                                    {s.value ?? 0}
                                </p>
                            </button>
                        );
                    })}
                </div>
            )}

            {/* Filters, in three lines: search and when; the three filters
                people use most as labelled pills; then what is applied. The
                rest sit behind "Filters", so the card stays two short lines
                instead of a wall of identical dropdowns. */}
            <div className="rounded-2xl border border-slate-100 bg-white p-3 space-y-2.5">
                <div className="flex flex-wrap items-center gap-2">
                    <div className="relative flex-1 min-w-[220px]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Search name, phone, pincode, car, ASM or store…"
                            className="pl-9 h-9 rounded-lg border-slate-200 text-sm"
                        />
                    </div>

                    {/* When: one button. Presets fill in both dates, so a
                        custom range starts from whichever was picked. */}
                    <Popover>
                        <PopoverTrigger asChild>
                            <button
                                type="button"
                                className={`h-9 px-3 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${
                                    dateFrom || dateTo
                                        ? "border-orange-300 bg-orange-50 text-orange-800"
                                        : "border-slate-200 text-slate-600 hover:border-slate-300"
                                }`}
                            >
                                <CalendarDays className="h-3.5 w-3.5" />
                                {dateLabel}
                                <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                            </button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-64 p-2">
                            <div className="space-y-0.5">
                                {[{ label: "Any date", range: () => ["", ""] as [string, string] }, ...DATE_PRESETS].map(p => {
                                    const [from, to] = p.range();
                                    const on = dateFrom === from && dateTo === to;
                                    return (
                                        <button
                                            key={p.label}
                                            type="button"
                                            onClick={() => { setDateFrom(from); setDateTo(to); }}
                                            className={`w-full text-left h-8 px-2.5 rounded-md text-xs transition-colors ${
                                                on ? "bg-slate-800 text-white font-semibold" : "text-slate-600 hover:bg-slate-100"
                                            }`}
                                        >
                                            {p.label}
                                        </button>
                                    );
                                })}
                            </div>
                            {/* Compared in IST on the server: created_at is stored
                                UTC, so an enquiry at 1am IST would otherwise fall
                                on the day before. */}
                            <div className="border-t border-slate-100 mt-2 pt-2 space-y-1.5">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-0.5">Custom range</p>
                                <div className="grid grid-cols-2 gap-1.5">
                                    <input
                                        type="date" value={dateFrom} max={dateTo || undefined}
                                        onChange={e => setDateFrom(e.target.value)} aria-label="From"
                                        className="h-8 rounded-md border border-slate-200 px-2 text-xs text-slate-600"
                                    />
                                    <input
                                        type="date" value={dateTo} min={dateFrom || undefined}
                                        onChange={e => setDateTo(e.target.value)} aria-label="To"
                                        className="h-8 rounded-md border border-slate-200 px-2 text-xs text-slate-600"
                                    />
                                </div>
                            </div>
                        </PopoverContent>
                    </Popover>

                    {/* Everything else, labelled, two to a row. The button says
                        how many of them are in force. */}
                    <Popover>
                        <PopoverTrigger asChild>
                            <button
                                type="button"
                                className={`h-9 px-3 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${
                                    panelCount
                                        ? "border-orange-300 bg-orange-50 text-orange-800"
                                        : "border-slate-200 text-slate-600 hover:border-slate-300"
                                }`}
                            >
                                <SlidersHorizontal className="h-3.5 w-3.5" />
                                Filters
                                {panelCount > 0 && (
                                    <span className="rounded-full bg-orange-500 text-white text-[10px] font-bold min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center">
                                        {panelCount}
                                    </span>
                                )}
                            </button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-[min(92vw,440px)] p-3">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2.5">
                                {panelFilters.map(f => (
                                    <div key={f.label} className="space-y-1 min-w-0">
                                        <Label className="text-[11px] text-slate-500">{f.label}</Label>
                                        <Select value={f.value} onValueChange={f.set}>
                                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                {f.options.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                ))}
                            </div>
                            {panelCount > 0 && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setForwardedTo("all"); setStoreId("all"); setDelivery("all"); setReview("all");
                                        setAsmId("all"); setStateFilter("all"); setIvrCall("all");
                                    }}
                                    className="mt-3 text-xs font-semibold text-slate-500 hover:text-rose-600"
                                >
                                    Reset these filters
                                </button>
                            )}
                        </PopoverContent>
                    </Popover>
                </div>

                {/* The three filters used most, as "Label: value" pills — so
                    what is set reads at a glance, unlike a bare "IVR". */}
                <div className="flex flex-wrap items-center gap-1.5">
                    {pillFilters.map(f => (
                        <Select key={f.label} value={f.value} onValueChange={f.set}>
                            <SelectTrigger
                                className={`h-8 w-auto gap-1.5 rounded-full px-3 text-xs border transition-colors [&>svg]:h-3.5 [&>svg]:w-3.5 ${
                                    f.value !== "all"
                                        ? "border-orange-300 bg-orange-50 text-orange-800"
                                        : "border-slate-200 text-slate-600 hover:border-slate-300"
                                }`}
                            >
                                <SelectValue>
                                    <span className="text-slate-400">{f.label}:</span>{" "}
                                    <span className="font-medium">{f.options.find(([v]) => v === f.value)?.[1] ?? "Any"}</span>
                                </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                                {f.options.map(([v, l, n]) => (
                                    <SelectItem key={v} value={v}>
                                        {l}{n !== undefined && <span className="text-slate-400"> · {n}</span>}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    ))}
                    <span className="ml-auto text-xs text-slate-400 tabular-nums">
                        {matched > visible.length
                            ? `Newest ${visible.length} of ${matched} enquiries`
                            : `${visible.length} ${visible.length === 1 ? "enquiry" : "enquiries"}`}
                    </span>
                </div>

                {/* What is narrowing the list, each removable on its own. */}
                {activeChips.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2.5">
                        {activeChips.map(c => (
                            <span
                                key={c.key}
                                className="inline-flex items-center gap-1 h-7 pl-2.5 pr-1 rounded-full bg-orange-50 border border-orange-200 text-xs text-orange-800"
                            >
                                {c.label}
                                <button
                                    type="button" onClick={c.clear} aria-label={`Remove ${c.label}`}
                                    className="h-5 w-5 inline-flex items-center justify-center rounded-full hover:bg-orange-100"
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            </span>
                        ))}
                        <button
                            type="button" onClick={clearFilters}
                            className="ml-auto h-7 px-2 rounded-md text-xs font-semibold text-slate-500 hover:text-rose-600 hover:bg-rose-50"
                        >
                            Clear all
                        </button>
                    </div>
                )}
            </div>

            {visible.length === 0 ? (
                <div className="rounded-[28px] border border-dashed border-orange-200 bg-white/40 p-12 text-center">
                    <div className="h-16 w-16 bg-orange-50 rounded-3xl flex items-center justify-center mx-auto mb-5 border border-orange-100">
                        <Inbox className="h-7 w-7 text-orange-500 opacity-80" />
                    </div>
                    {/* Every filter counts here, not just the first three.
                        A list emptied by a date range while the message reads
                        "no enquiries yet" looks like the system is broken. */}
                    <h3 className="text-lg font-black tracking-tight text-slate-800 uppercase mb-2">
                        {anyFilter ? "Nothing matches that" : "No enquiries yet"}
                    </h3>
                    <p className="text-sm text-slate-500 max-w-md mx-auto leading-relaxed">
                        {anyFilter
                            ? "Try a different search, widen the dates, or clear the filters."
                            : "Enquiries arriving on WhatsApp will appear here once the workflow forwards them."}
                    </p>
                    {anyFilter && (
                        <Button
                            variant="outline" size="sm" className="mt-5"
                            onClick={clearFilters}
                        >
                            Clear all filters
                        </Button>
                    )}
                </div>
            ) : (
                /* A table rather than cards: these rows are read by comparing
                   them — which areas keep coming up, which ASM is taking the
                   volume, how many went unmatched — and a column of values
                   under one heading is what makes that scannable. */
                <Card className={`rounded-2xl border-slate-100 overflow-hidden transition-opacity ${updating ? "opacity-60" : ""}`}
                      aria-busy={updating}>
                    {/* The table scrolls in its own box, both ways, so the
                        horizontal scrollbar is always on screen instead of
                        under the last row, and the headings stay in view. */}
                    <div className="relative w-full overflow-auto max-h-[calc(100vh-240px)]">
                        <table className="w-full text-sm text-left table-fixed min-w-[1800px]">
                            <thead className="sticky top-0 z-10 bg-slate-50 text-slate-500 shadow-[0_1px_0_0_rgb(241,245,249)]">
                                <tr>
                                    <th className="px-3 py-3 w-[110px] font-semibold">Date</th>
                                    <th className="px-3 py-3 w-[160px] font-semibold">Customer</th>
                                    <th className="px-3 py-3 w-[100px] font-semibold">Channel</th>
                                    <th className="px-3 py-3 w-[140px] font-semibold">Call</th>
                                    <th className="px-3 py-3 w-[90px] font-semibold">Pincode</th>
                                    <th className="px-3 py-3 w-[180px] font-semibold">Area / State</th>
                                    <th className="px-3 py-3 w-[120px] font-semibold">Type</th>
                                    <th className="px-3 py-3 w-[130px] font-semibold">Vehicle</th>
                                    <th className="px-3 py-3 w-[120px] font-semibold">Product</th>
                                    <th className="px-3 py-3 w-[160px] font-semibold">Forwarded to</th>
                                    <th className="px-3 py-3 w-[150px] font-semibold">Store sent</th>
                                    <th className="px-3 py-3 w-[140px] font-semibold">Review</th>
                                    <th className="px-3 py-3 font-semibold">Review reason</th>
                                    <th className="px-3 py-3 w-[52px]"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 bg-white">
                                {visible.map(lead => (
                                    <tr
                                        key={lead.id}
                                        className="hover:bg-orange-50/40 transition-colors cursor-pointer"
                                        /* Anywhere on the row opens the lead — except its own
                                           buttons and links (copy number, the pencil), and a
                                           drag to select text, which is someone copying. */
                                        onClick={e => {
                                            if ((e.target as HTMLElement).closest("button, a, input, select, textarea, [role='button']")) return;
                                            if (window.getSelection()?.toString()) return;
                                            openEdit(lead);
                                        }}
                                    >
                                        <td className="px-3 py-3 align-top whitespace-nowrap text-xs text-slate-500 tabular-nums">
                                            {formatWhen(lead.created_at)}
                                        </td>

                                        <td className="px-3 py-3 align-top">
                                            <div className="text-slate-800 font-medium truncate" title={lead.customer_name || ""}>
                                                {lead.customer_name || <span className="text-slate-300 font-normal">Not shared</span>}
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => copyPhone(lead.customer_phone)}
                                                title="Copy number"
                                                className="flex items-center gap-1 text-xs font-mono text-slate-400 hover:text-orange-600"
                                            >
                                                {lead.customer_phone}
                                                <Copy className="h-2.5 w-2.5 opacity-50" />
                                            </button>
                                        </td>

                                        <td className="px-3 py-3 align-top">
                                            <span className="text-slate-600 text-xs">
                                                {CHANNEL_LABEL[lead.source] || lead.source}
                                            </span>
                                        </td>

                                        {/* The IVR call: whether anyone picked up, how
                                            often they rang, and how long we talked. */}
                                        <td className="px-3 py-3 align-top">
                                            {lead.ivr ? (
                                                <div
                                                    className="space-y-0.5"
                                                    title={`${lead.ivr.calls} call(s), ${lead.ivr.rings} ring(s) to an agent, ${lead.ivr.answered} answered`}
                                                >
                                                    <Badge
                                                        variant="outline"
                                                        className={`text-[10px] font-black uppercase whitespace-nowrap ${IVR_STATUS[lead.ivr.status].tone}`}
                                                    >
                                                        {IVR_STATUS[lead.ivr.status].label}
                                                    </Badge>
                                                    <div className="text-[11px] text-slate-400 tabular-nums whitespace-nowrap">
                                                        {lead.ivr.calls} call{lead.ivr.calls === 1 ? "" : "s"}
                                                        {" · "}{lead.ivr.rings} ring{lead.ivr.rings === 1 ? "" : "s"}
                                                    </div>
                                                    {lead.ivr.talkSeconds > 0 && (
                                                        <div className="text-[11px] text-slate-400 tabular-nums">
                                                            Talk {formatSeconds(lead.ivr.talkSeconds)}
                                                        </div>
                                                    )}
                                                </div>
                                            ) : (
                                                <span className="text-slate-300">—</span>
                                            )}
                                        </td>

                                        {/* WhatsApp and Instagram ask for a pincode;
                                            the IVR does not, so the auditor asks the
                                            caller where they are and types it in. */}
                                        <td className="px-3 py-3 align-top">
                                            {lead.pincode ? (
                                                <span className="font-mono text-slate-700 tabular-nums">{lead.pincode}</span>
                                            ) : (
                                                <span className="text-slate-300">—</span>
                                            )}
                                        </td>

                                        {/* Where they are: the district the pincode
                                            resolved to, or the area as typed — and the
                                            state, which is what decided the routing. */}
                                        <td className="px-3 py-3 align-top">
                                            {placeOf(lead) ? (
                                                <div className="text-slate-700 truncate" title={placeOf(lead) || ""}>
                                                    {placeOf(lead)}
                                                </div>
                                            ) : null}
                                            {lead.state ? (
                                                <span className="flex items-center gap-1 text-slate-500 text-xs">
                                                    <MapPin className="h-3 w-3 shrink-0 text-slate-300" />
                                                    <span className="truncate" title={lead.state}>{lead.state}</span>
                                                </span>
                                            ) : !placeOf(lead) ? (
                                                <span className="text-slate-300">—</span>
                                            ) : null}
                                        </td>

                                        <td className="px-3 py-3 align-top">
                                            <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide whitespace-nowrap ${
                                                isTwoWheeler(lead.car_model)
                                                    ? "bg-violet-50 border-violet-200 text-violet-700"
                                                    : "bg-slate-50 border-slate-200 text-slate-600"
                                            }`}>
                                                {isTwoWheeler(lead.car_model) ? "🏍️ 2-Wheeler" : "🚗 4-Wheeler"}
                                            </span>
                                        </td>

                                        <td className="px-3 py-3 align-top">
                                            <span className="text-slate-600 truncate block" title={modelOnly(lead.car_model)}>
                                                {modelOnly(lead.car_model) || <span className="text-slate-300">—</span>}
                                            </span>
                                        </td>

                                        <td className="px-3 py-3 align-top">
                                            {lead.product ? (
                                                <Badge
                                                    variant="outline"
                                                    className={`text-[10px] font-black uppercase whitespace-nowrap ${PRODUCT_STYLE[lead.product] || ""}`}
                                                >
                                                    {lead.product}
                                                </Badge>
                                            ) : (
                                                <span className="text-slate-300">—</span>
                                            )}
                                        </td>

                                        {/* The ASM, whether the forward itself worked,
                                            and how far the message got — one column,
                                            because they are one fact about one send.
                                            A store-locator lead may instead have gone
                                            to the stores the customer picked, a
                                            distributor, or customer support. */}
                                        <td className="px-3 py-3 align-top">
                                            {lead.routing && lead.routing.outcome !== "asm" ? (
                                                <LocatorForward routing={lead.routing} />
                                            ) : lead.asm_name ? (
                                                <>
                                                    <div className="text-slate-800 font-medium truncate">{lead.asm_name}</div>
                                                    <div className="text-xs text-slate-400 font-mono">{lead.asm_phone}</div>
                                                    {lead.delivery_status ? (
                                                        <div
                                                            className={`text-[11px] mt-0.5 flex items-center gap-1 ${DELIVERY_TONE[lead.delivery_status] || "text-slate-400"}`}
                                                            title={lead.delivery_updated_at
                                                                ? `Last updated ${formatWhen(lead.delivery_updated_at)}`
                                                                : undefined}
                                                        >
                                                            {lead.delivery_status === "read"
                                                                ? <CheckCheck className="h-3 w-3" />
                                                                : lead.delivery_status === "failed"
                                                                    ? <XCircle className="h-3 w-3" />
                                                                    : <Check className="h-3 w-3" />}
                                                            {DELIVERY_LABEL[lead.delivery_status]}
                                                        </div>
                                                    ) : (
                                                        <Badge
                                                            variant="outline"
                                                            className={`text-[10px] font-black uppercase mt-0.5 ${STATUS_STYLE[lead.status] || ""}`}
                                                        >
                                                            {lead.status}
                                                        </Badge>
                                                    )}
                                                </>
                                            ) : AUTO_ROUTED.includes(lead.source) ? (
                                                /* WhatsApp and Instagram route themselves, so
                                                   nobody here is a routing that failed. */
                                                <span className="flex items-center gap-1.5 text-xs text-amber-600 font-medium">
                                                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                                    No ASM
                                                </span>
                                            ) : lead.store_name && lead.store_sent_by !== "customer" ? (
                                                /* IVR and hand-added leads are forwarded by the
                                                   auditor after the call, by sending the customer
                                                   a store from Edit lead. */
                                                <>
                                                    <div className="text-slate-800 font-medium truncate" title={lead.store_name}>
                                                        {lead.store_name}
                                                    </div>
                                                    <div className="text-[10px] uppercase tracking-wide text-slate-400">
                                                        Store · sent by auditor
                                                    </div>
                                                    {/* Two messages: the store's details to the
                                                        customer, and the lead to the store. */}
                                                    <div className="flex items-center gap-1 text-[11px] text-slate-500">
                                                        <span className="w-[52px] shrink-0">Customer</span>
                                                        <DeliveryLine
                                                            status={lead.store_msg_status}
                                                            title={lead.store_sent_at ? `Sent ${formatWhen(lead.store_sent_at)}` : undefined}
                                                        />
                                                    </div>
                                                    <div className="flex items-center gap-1 text-[11px] text-slate-500">
                                                        <span className="w-[52px] shrink-0">Store</span>
                                                        {lead.store_alert_status
                                                            ? <DeliveryLine status={lead.store_alert_status} />
                                                            : <span className="text-[11px] text-slate-400">Not alerted</span>}
                                                    </div>
                                                </>
                                            ) : (
                                                /* Not forwarded yet: blank until the auditor does. */
                                                <span className="text-slate-300">—</span>
                                            )}
                                        </td>

                                        {/* Whether an admin sent the customer a store,
                                            and whether they opened it. The customer's
                                            own pick from the WhatsApp list is under
                                            Forwarded to, with the store's alert. */}
                                        <td className="px-3 py-3 align-top">
                                            {/* IVR and hand-added leads show the store under
                                                Forwarded to, so not twice. */}
                                            {lead.store_name && lead.store_sent_by !== "customer" && AUTO_ROUTED.includes(lead.source) ? (
                                                <>
                                                    <div className="text-slate-700 truncate" title={lead.store_name}>
                                                        {lead.store_name}
                                                    </div>
                                                    {lead.store_msg_status && (
                                                        <div className={`text-[11px] flex items-center gap-1 ${DELIVERY_TONE[lead.store_msg_status] || "text-slate-400"}`}>
                                                            {lead.store_msg_status === "read"
                                                                ? <CheckCheck className="h-3 w-3" />
                                                                : lead.store_msg_status === "failed"
                                                                    ? <XCircle className="h-3 w-3" />
                                                                    : <Check className="h-3 w-3" />}
                                                            {DELIVERY_LABEL[lead.store_msg_status]}
                                                        </div>
                                                    )}
                                                </>
                                            ) : (
                                                <span className="text-slate-300">—</span>
                                            )}
                                        </td>

                                        <td className="px-3 py-3 align-top">
                                            {lead.review_status ? (
                                                <Badge
                                                    variant="outline"
                                                    className={`text-[10px] font-black uppercase whitespace-nowrap ${OUTCOME_TONE[lead.review_status] || "bg-slate-50 text-slate-600 border-slate-200"}`}
                                                >
                                                    {OUTCOME_LABEL[lead.review_status]}
                                                </Badge>
                                            ) : (
                                                <span className="text-slate-300">—</span>
                                            )}
                                        </td>

                                        <td className="px-3 py-3 align-top">
                                            <span className="text-slate-600 text-xs line-clamp-2" title={lead.review_reason || ""}>
                                                {lead.review_reason || <span className="text-slate-300">—</span>}
                                            </span>
                                        </td>

                                        <td className="px-3 py-3 align-top">
                                            <Button
                                                variant="ghost" size="icon"
                                                onClick={() => openEdit(lead)}
                                                title="Edit lead"
                                                aria-label="Edit lead"
                                                className="h-8 w-8 text-slate-400 hover:text-orange-600"
                                            >
                                                <Pencil className="h-3.5 w-3.5" />
                                            </Button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Card>
            )}

            {/* Edit one lead: its outcome, the audit of it, and corrections
                to what was captured. */}
            <Dialog open={Boolean(editing)} onOpenChange={open => !open && setEditing(null)}>
                <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto overflow-x-hidden">
                    <DialogHeader>
                        <DialogTitle>Edit lead</DialogTitle>
                        <DialogDescription>
                            {editing?.customer_phone}
                            {editing && forwardedNames(editing) ? ` · forwarded to ${forwardedNames(editing)}` : " · not forwarded"}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-1 min-w-0">
                        {/* What was captured. Editable, but not the reason anybody
                            opened this — so it sits compact at the top rather than
                            taking a third of the dialog. */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 min-w-0">
                            <div className="space-y-1 min-w-0">
                                <Label htmlFor="e-name" className="text-xs font-semibold text-slate-700">Customer</Label>
                                <Input
                                    id="e-name" className="h-9 text-sm" placeholder="Not shared"
                                    value={editForm.customer_name}
                                    onChange={e => setEditForm({ ...editForm, customer_name: e.target.value })}
                                />
                            </div>
                            <div className="space-y-1 min-w-0">
                                <Label className="text-xs font-semibold text-slate-700">Product</Label>
                                <Select
                                    value={editForm.product || "none"}
                                    onValueChange={v => setEditForm({ ...editForm, product: v === "none" ? "" : v })}
                                >
                                    <SelectTrigger className="h-9 text-sm">
                                        <SelectValue placeholder="Not given" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">Not given</SelectItem>
                                        {Object.keys(PRODUCT_STYLE).map(p => (
                                            <SelectItem key={p} value={p}>{p}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1 min-w-0">
                                <Label htmlFor="e-car" className="text-xs font-semibold text-slate-700">Vehicle</Label>
                                <Input
                                    id="e-car" className="h-9 text-sm" placeholder="e.g. Creta"
                                    value={editForm.car_model}
                                    onChange={e => setEditForm({ ...editForm, car_model: e.target.value })}
                                />
                            </div>
                        </div>

                        {/* Where the customer is. The pincode finds the stores
                            within 15 km, as the WhatsApp locator does; the area is
                            what the caller said, for an IVR lead most of all. */}
                        <div className="grid grid-cols-1 sm:grid-cols-[150px_1fr] gap-3 min-w-0">
                            <div className="space-y-1 min-w-0">
                                <Label htmlFor="e-pin" className="text-xs font-semibold text-slate-700">Pincode</Label>
                                <Input
                                    id="e-pin" className="h-9 text-sm font-mono tabular-nums" placeholder="e.g. 201301"
                                    inputMode="numeric" maxLength={6}
                                    value={editForm.pincode}
                                    onChange={e => {
                                        const pincode = e.target.value.replace(/\D/g, "").slice(0, 6);
                                        const next = { ...editForm, pincode };
                                        setEditForm(next);
                                        if (pincode.length === 6 || !pincode) refindStores(next);
                                    }}
                                />
                            </div>
                            <div className="space-y-1 min-w-0">
                                <Label htmlFor="e-area" className="text-xs font-semibold text-slate-700">Area / State</Label>
                                <Input
                                    id="e-area" className="h-9 text-sm"
                                    placeholder={editing?.district ? `${editing.district}${editing.state ? `, ${editing.state}` : ""}` : "e.g. Rohini Delhi"}
                                    value={editForm.raw_area}
                                    onChange={e => setEditForm({ ...editForm, raw_area: e.target.value })}
                                    onBlur={() => editForm.raw_area !== editBase.raw_area && refindStores(editForm)}
                                />
                            </div>
                        </div>
                        <p className="text-[11px] text-slate-400">
                            {storesFor?.pincode ? (
                                <>
                                    Pincode <span className="font-mono text-slate-600">{storesFor.pincode}</span> is in{" "}
                                    <span className="font-semibold text-slate-600">
                                        {[storesFor.district, storesFor.state].filter(Boolean).join(", ") || "an unknown place"}
                                    </span>.
                                </>
                            ) : (
                                <>
                                    Routes by state: currently{" "}
                                    <span className="font-semibold text-slate-600">{storesFor?.state || editing?.state || "unresolved"}</span>.
                                </>
                            )}{" "}
                            Saving a new pincode or area can change who the lead belongs to.
                        </p>

                        {/* The audit. */}
                        <div className="rounded-xl border border-slate-200 p-3.5 space-y-3 min-w-0">
                            <p className="text-[11px] font-black uppercase tracking-widest text-slate-800">
                                Review
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-[190px_1fr] gap-3 min-w-0">
                                <div className="space-y-1 min-w-0">
                                    <Label className="text-xs font-semibold text-slate-700">Review status</Label>
                                    <Select
                                        value={editForm.review_status || "none"}
                                        onValueChange={v => setEditForm({ ...editForm, review_status: v === "none" ? "" : v })}
                                    >
                                        <SelectTrigger className="h-9 text-sm">
                                            <SelectValue placeholder="Not reviewed" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="none">Not reviewed</SelectItem>
                                            {OUTCOMES.map(o => (
                                                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1 min-w-0">
                                    <Label htmlFor="e-reason" className="text-xs font-semibold text-slate-700">Review reason</Label>
                                    <Input
                                        id="e-reason"
                                        className="h-9 text-sm"
                                        value={editForm.review_reason}
                                        onChange={e => setEditForm({ ...editForm, review_reason: e.target.value })}
                                        placeholder="Why — what the customer said"
                                    />
                                </div>
                            </div>
                            <div className="space-y-1 min-w-0">
                                <Label htmlFor="e-notes" className="text-xs font-semibold text-slate-700">
                                    Internal notes <span className="font-normal text-slate-400">· only the team sees these, here</span>
                                </Label>
                                <Textarea
                                    id="e-notes"
                                    className="text-sm min-h-[72px]"
                                    maxLength={2000}
                                    value={editForm.internal_notes}
                                    onChange={e => setEditForm({ ...editForm, internal_notes: e.target.value })}
                                    placeholder="Anything for the next person on this lead — call back after 6, spoke to the brother…"
                                />
                            </div>
                        </div>

                        {/* Every call this person made to the IVR, and each time an
                            agent's phone rang — who to ring back, and who already
                            spoke to them. */}
                        {editing?.ivr && (
                            <div className="rounded-xl border border-slate-200 p-3.5 space-y-2.5 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-[11px] font-black uppercase tracking-widest text-slate-800">
                                        IVR calls
                                    </p>
                                    <Badge
                                        variant="outline"
                                        className={`text-[10px] font-black uppercase ${IVR_STATUS[editing.ivr.status].tone}`}
                                    >
                                        {IVR_STATUS[editing.ivr.status].label}
                                    </Badge>
                                </div>
                                {!editing.ivr.mobile && (
                                    <p className="text-[11px] text-amber-600">Not a mobile number: call back only, no WhatsApp.</p>
                                )}
                                <div className="space-y-2">
                                    {editing.ivr.detail.map((call, i) => (
                                        <div key={i} className="text-xs">
                                            <div className="flex items-center gap-2 text-slate-700">
                                                <span className="font-medium tabular-nums">
                                                    {call.started ? formatWhen(call.started) : "—"}
                                                </span>
                                                <span className="text-slate-400">
                                                    on the line {formatSeconds(call.duration)}
                                                </span>
                                            </div>
                                            {call.rings.length ? (
                                                <ul className="mt-1 ml-3 space-y-0.5 border-l border-slate-100 pl-3">
                                                    {call.rings.map((r, j) => (
                                                        <li key={j} className="flex flex-wrap items-center gap-x-2 text-[11px]">
                                                            <span className={r.answered ? "text-emerald-600 font-semibold" : "text-rose-600 font-semibold"}>
                                                                {r.answered ? "Answered" : "Not answered"}
                                                            </span>
                                                            <span className="text-slate-500">{r.group || "Agent"}</span>
                                                            {r.to && <span className="font-mono text-slate-400">{r.to}</span>}
                                                            {r.answered && (
                                                                <span className="text-slate-400">talked {formatSeconds(r.talked)}</span>
                                                            )}
                                                        </li>
                                                    ))}
                                                </ul>
                                            ) : (
                                                <p className="mt-1 ml-3 pl-3 text-[11px] text-slate-400">
                                                    Hung up before reaching an agent
                                                </p>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Every WhatsApp this lead set off, oldest first: what the
                            customer was told, who else was alerted, and whether it
                            arrived — so nobody has to guess what already went out. */}
                        <div className="rounded-xl border border-slate-200 p-3.5 space-y-2.5 min-w-0">
                            <p className="text-[11px] font-black uppercase tracking-widest text-slate-800">
                                WhatsApp messages
                            </p>
                            {messages === null ? (
                                <p className="text-xs text-slate-400 flex items-center gap-1.5">
                                    <Loader2 className="h-3 w-3 animate-spin" /> Loading…
                                </p>
                            ) : messages.length === 0 ? (
                                <p className="text-xs text-slate-400">Nothing sent for this lead yet.</p>
                            ) : (
                                <ul className="space-y-2">
                                    {messages.map((m, i) => (
                                        <li key={i} className="text-xs min-w-0">
                                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                                <span className="font-medium tabular-nums text-slate-700">{formatWhen(m.at)}</span>
                                                <span className="text-[9px] font-black uppercase rounded border border-slate-200 bg-slate-50 px-1 text-slate-500">
                                                    {MESSAGE_TO_LABEL[m.to]}
                                                </span>
                                                <span className="text-slate-800 font-medium truncate" title={m.phone || ""}>{m.toName}</span>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-x-2 ml-0.5">
                                                <span className="text-slate-500">{m.what}</span>
                                                <DeliveryLine
                                                    status={m.status}
                                                    title={m.updatedAt ? `Last updated ${formatWhen(m.updatedAt)}` : undefined}
                                                />
                                            </div>
                                            {m.error && (
                                                <p className="text-[11px] text-rose-600 break-words">{m.error}</p>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>

                        {/* Give the customer a store.
                            Sent straight to them on WhatsApp, so the list carries
                            the address and phone that would actually go out — a
                            store picked from a name alone is picked blind. */}
                        <div className="rounded-xl border border-slate-200 p-3.5 space-y-3 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                                <p className="text-[11px] font-black uppercase tracking-widest text-slate-800 flex items-center gap-1.5">
                                    <StoreIcon className="h-3 w-3" />
                                    Send store details
                                </p>
                                {editing?.store_sent_at && (
                                    <span className="text-[11px] text-slate-400 shrink-0">
                                        Sent {formatWhen(editing.store_sent_at)}
                                        {editing.store_msg_status && ` · ${DELIVERY_LABEL[editing.store_msg_status]}`}
                                    </span>
                                )}
                            </div>

                            {loadingStores ? (
                                <p className="text-xs text-slate-400 flex items-center gap-1.5 py-1">
                                    <Loader2 className="h-3 w-3 animate-spin" /> Finding stores…
                                </p>
                            ) : stores.length === 0 ? (
                                <p className="text-xs text-slate-400 py-1">
                                    {storesFor?.message || "Enter a pincode or an area to find stores."}
                                </p>
                            ) : (
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 min-w-0">
                                    {/* List on the left, what the customer receives
                                        on the right — so picking and checking are one
                                        glance apart rather than one scroll. */}
                                    <div className="space-y-2 min-w-0">
                                        <Input
                                            value={storeSearch}
                                            onChange={e => setStoreSearch(e.target.value)}
                                            placeholder={`Search ${stores.length} stores${storesFor?.state ? ` in ${storesFor.state}` : ""}…`}
                                            className="h-8 text-xs"
                                        />
                                        <div className="h-52 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100 min-w-0">
                                            {stores
                                                .filter(s => {
                                                    const q = storeSearch.trim().toLowerCase();
                                                    if (!q) return true;
                                                    return (
                                                        s.store_name.toLowerCase().includes(q) ||
                                                        (s.city || "").toLowerCase().includes(q) ||
                                                        (s.pincode || "").includes(q)
                                                    );
                                                })
                                                .map(s => {
                                                    const picked = chosenStore === s.id;
                                                    return (
                                                        <button
                                                            key={s.id}
                                                            type="button"
                                                            onClick={() => setChosenStore(picked ? null : s.id)}
                                                            className={`w-full text-left px-2.5 py-2 transition-colors min-w-0 ${
                                                                picked
                                                                    ? "bg-orange-50 ring-1 ring-inset ring-orange-200"
                                                                    : "hover:bg-slate-50"
                                                            }`}
                                                        >
                                                            <div className="flex items-center gap-1.5 min-w-0">
                                                                <span className="text-xs font-semibold text-slate-800 truncate">
                                                                    {s.store_name}
                                                                </span>
                                                                {/* Marked, not filtered: an admin may know
                                                                    better than the customer's own words. */}
                                                                {s.near && (
                                                                    <span className="text-[9px] font-black uppercase text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1 shrink-0">
                                                                        Near
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="text-[11px] text-slate-500 truncate">
                                                                {[s.city, s.pincode].filter(Boolean).join(" ")}
                                                                {s.distance_label && (
                                                                    <span className="text-emerald-700 font-medium"> · {s.distance_label}</span>
                                                                )}
                                                            </div>
                                                            {!s.phone_number && (
                                                                <div className="text-[10px] text-amber-600">
                                                                    No phone — cannot be sent
                                                                </div>
                                                            )}
                                                        </button>
                                                    );
                                                })}
                                        </div>
                                    </div>

                                    {/* Exactly what will arrive on the customer's
                                        phone, shown before it goes, because the
                                        message cannot be recalled. */}
                                    <div className="min-w-0">
                                        {chosenStore ? (() => {
                                            const s = stores.find(x => x.id === chosenStore);
                                            if (!s) return null;
                                            return (
                                                <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-2 min-w-0">
                                                    <p className="text-[11px] font-black uppercase tracking-widest text-slate-800">
                                                        The customer receives
                                                    </p>
                                                    <p className="text-[11px] text-slate-600 whitespace-pre-line leading-relaxed break-words">
                                                        {`Thank you for your enquiry. Your nearest Autoform store is:\n\n` +
                                                         `${s.store_name}\n` +
                                                         `${buildAddress(s)}\n\n` +
                                                         `Call: ${s.phone_number || "—"}\n\n` +
                                                         `Our team there will be happy to help you.`}
                                                    </p>
                                                    <Button
                                                        size="sm"
                                                        onClick={sendStore}
                                                        disabled={sendingStore || !s.phone_number}
                                                        className="w-full h-8 text-xs bg-emerald-600 hover:bg-emerald-700"
                                                    >
                                                        {sendingStore
                                                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                            : <><Send className="h-3 w-3 mr-1.5" /> Send to {editing?.customer_phone}</>}
                                                    </Button>
                                                </div>
                                            );
                                        })() : (
                                            <div className="h-full min-h-[13rem] rounded-lg border border-dashed border-slate-200 grid place-items-center px-4">
                                                <p className="text-[11px] text-slate-400 text-center">
                                                    Pick a store to see what the customer will receive.
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                        <Button onClick={saveEdit} disabled={saving} className="bg-orange-500 hover:bg-orange-600">
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Add a lead by hand, for IVR and website enquiries. */}
            {/* Cancelling clears the store too: reopening the form with a
                store still picked from a previous area would send it. */}
            <Dialog open={addOpen} onOpenChange={open => {
                setAddOpen(open);
                if (!open) { setAddPreview(null); setAddStores([]); setAddStore(null); setAddStoreSearch(""); }
            }}>
                <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
                    <DialogHeader className="space-y-1">
                        <DialogTitle className="text-lg">Add a lead</DialogTitle>
                        <DialogDescription className="text-xs">
                            {addTwoWheeler
                                ? "A 2-wheeler enquiry goes to the Customer Executive, as on WhatsApp."
                                : "Forwarded to the ASM covering the area, exactly as an automatic enquiry would be."}
                        </DialogDescription>
                    </DialogHeader>

                    {/* Two columns on a desktop: the enquiry on the left, the store
                        and what the customer would receive on the right — so picking
                        and checking are one glance apart rather than one scroll.
                        Stacks on a narrow screen. */}
                    <div className="grid lg:grid-cols-2 gap-4 py-1 min-w-0">

                        {/* ── The enquiry ── */}
                        <div className="space-y-3.5 min-w-0">
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                                Enquiry
                            </p>

                            {/* 4-wheeler or 2-wheeler — the WhatsApp chat's first question too. */}
                            <div className="space-y-1.5 min-w-0">
                                <Label className="text-xs">Vehicle type</Label>
                                <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
                                    {([["4w", "🚗 4-Wheeler"], ["2w", "🏍️ 2-Wheeler"]] as const).map(([v, label]) => (
                                        <button
                                            key={v}
                                            type="button"
                                            onClick={() => {
                                                const next = { ...addForm, wheels: v };
                                                setAddForm(next);
                                                setAddPreview(null);
                                                if (v === "2w") { setAddStores([]); setAddStore(null); setAddStoreSearch(""); }
                                                else previewLead(next);
                                            }}
                                            className={`h-9 rounded-lg text-xs font-bold transition-colors ${
                                                addForm.wheels === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                                            }`}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-1.5 min-w-0">
                                <Label htmlFor="a-car" className="text-xs">Vehicle</Label>
                                <Input
                                    id="a-car"
                                    value={addForm.car}
                                    onChange={e => setAddForm({ ...addForm, car: e.target.value })}
                                    placeholder={addTwoWheeler ? "e.g. Activa" : "e.g. Creta"}
                                    className="h-9"
                                />
                            </div>

                            <div className="space-y-1.5 min-w-0">
                                <Label htmlFor="a-phone" className="text-xs">Phone *</Label>
                                <Input
                                    id="a-phone"
                                    inputMode="numeric"
                                    value={addForm.phone}
                                    /* Digits only, capped at 12 so a country code still
                                       fits. Anything else was never going to be dialled. */
                                    onChange={e => {
                                        setAddForm({ ...addForm, phone: e.target.value.replace(/\D/g, "").slice(0, 12) });
                                        setAddPreview(null);
                                    }}
                                    placeholder="9876543210"
                                    className={`h-9 ${addPhoneError ? "border-red-300 focus-visible:ring-red-200" : ""}`}
                                />
                                {addPhoneError && (
                                    <p className="text-[11px] text-red-600 leading-snug">{addPhoneError}</p>
                                )}
                            </div>

                            <div className="space-y-1.5 min-w-0">
                                <Label htmlFor="a-pin" className="text-xs">
                                    Pincode {addTwoWheeler ? <span className="text-slate-400 font-normal">(optional)</span> : "*"}
                                </Label>
                                <Input
                                    id="a-pin"
                                    inputMode="numeric"
                                    value={addForm.pincode}
                                    /* Six digits: the store list and the routing come from it,
                                       so the moment it is complete, they are looked up. */
                                    onChange={e => {
                                        const pincode = e.target.value.replace(/\D/g, "").slice(0, 6);
                                        const next = { ...addForm, pincode };
                                        setAddForm(next);
                                        setAddPreview(null);
                                        if (/^[1-9]\d{5}$/.test(pincode)) previewLead(next);
                                    }}
                                    placeholder="e.g. 122018"
                                    className={`h-9 ${addPinError ? "border-red-300 focus-visible:ring-red-200" : ""}`}
                                />
                                {addPinError && <p className="text-[11px] text-red-600 leading-snug">{addPinError}</p>}
                            </div>

                            <div className="space-y-1.5 min-w-0">
                                <Label htmlFor="a-area" className="text-xs">
                                    Area {addPinOk ? <span className="text-slate-400 font-normal">(optional)</span> : <span className="text-slate-400 font-normal">— only if the customer doesn't know the pincode</span>}
                                </Label>
                                <Input
                                    id="a-area"
                                    value={addForm.area}
                                    onChange={e => { setAddForm({ ...addForm, area: e.target.value }); setAddPreview(null); }}
                                    /* Tidied on leaving the field, not while typing —
                                       collapsing spaces mid-word fights the typist. */
                                    onBlur={e => {
                                        const tidy = cleanPlaceName(e.target.value);
                                        const next = { ...addForm, area: tidy };
                                        if (tidy !== addForm.area) setAddForm(next);
                                        previewLead(next);
                                    }}
                                    placeholder="e.g. Rohini Delhi"
                                    className={`h-9 ${addAreaError ? "border-red-300 focus-visible:ring-red-200" : ""}`}
                                />
                                {!addPinOk && addForm.area.trim() && !addAreaError && (
                                    <p className="text-[11px] text-amber-700 leading-snug">
                                        Without a pincode, stores are listed for the whole state, not by distance.
                                    </p>
                                )}
                            </div>

                            <div className="min-w-0 -mt-1.5">
                                {addAreaError ? (
                                    <p className="text-[11px] text-red-600 leading-snug">{addAreaError}</p>
                                ) : previewing ? (
                                    <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                                        <Loader2 className="h-3 w-3 animate-spin" /> Checking…
                                    </p>
                                ) : addPreview?.outcome ? (
                                    /* By pincode: the WhatsApp chain. Stores near → the
                                       auditor picks one; none → who gets it instead. */
                                    addPreview.outcome === "stores" ? (
                                        <p className="text-[11px] text-emerald-700 flex items-start gap-1">
                                            <Check className="h-3 w-3 mt-0.5 shrink-0" />
                                            <span>
                                                {[addPreview.district, addPreview.state].filter(Boolean).join(", ")} —{" "}
                                                <b>{addPreview.store_count} store{addPreview.store_count === 1 ? "" : "s"} nearby</b>.
                                                Pick one: the customer and the store get the message.
                                            </span>
                                        </p>
                                    ) : (
                                        <p className="text-[11px] text-amber-700 leading-snug">
                                            {[addPreview.district, addPreview.state].filter(Boolean).join(", ")} — no store nearby.
                                            {" "}On save it goes to <b>{addPreview.contact_name || "customer support"}</b>
                                            {addPreview.outcome === "asm" ? " (ASM)" : addPreview.outcome === "distributor" ? " (distributor)" : ""},
                                            and the customer gets their number — unless you pick a store.
                                        </p>
                                    )
                                ) : addPreview ? (
                                    /* Who this is about to reach. A mistyped area costs a
                                       real message to a real ASM, so it is shown before
                                       the send rather than discovered after it. */
                                    addPreview.matched ? (
                                        <p className="text-[11px] text-emerald-700 flex items-start gap-1">
                                            <Check className="h-3 w-3 mt-0.5 shrink-0" />
                                            <span>{[addPreview.district, addPreview.state].filter(Boolean).join(", ")} — goes to <b>{addPreview.asm_name}</b></span>
                                        </p>
                                    ) : (
                                        <p className="text-[11px] text-amber-700 leading-snug">
                                            {addPreview.state
                                                ? `${addPreview.state} — no ASM covers this state yet.`
                                                : "No state could be read from this."}
                                            {" "}Saved and queued as unmatched.
                                        </p>
                                    )
                                ) : null}
                            </div>

                            <div className="space-y-1.5 min-w-0">
                                <Label htmlFor="a-name" className="text-xs">Name</Label>
                                <Input
                                    id="a-name"
                                    value={addForm.name}
                                    onChange={e => setAddForm({ ...addForm, name: e.target.value })}
                                    placeholder="Optional"
                                    className="h-9"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-2.5 min-w-0">
                                <div className="space-y-1.5 min-w-0">
                                    <Label className="text-xs">Channel</Label>
                                    <Select value={addForm.source} onValueChange={v => setAddForm({ ...addForm, source: v })}>
                                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="ivr">IVR</SelectItem>
                                            <SelectItem value="website">Website</SelectItem>
                                            <SelectItem value="whatsapp_manual">WhatsApp</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5 min-w-0">
                                    <Label className="text-xs">Product</Label>
                                    <Select
                                        value={addForm.product || "none"}
                                        onValueChange={v => setAddForm({ ...addForm, product: v === "none" ? "" : v })}
                                    >
                                        <SelectTrigger className="h-9"><SelectValue placeholder="—" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="none">Not specified</SelectItem>
                                            <SelectItem value="Seat Covers">Seat Covers</SelectItem>
                                            <SelectItem value="Mats">Mats</SelectItem>
                                            <SelectItem value="Accessories">Accessories</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <div className="space-y-1.5 min-w-0">
                                <Label htmlFor="a-notes" className="text-xs">
                                    Internal notes <span className="font-normal text-slate-400">· only the team sees these</span>
                                </Label>
                                <Textarea
                                    id="a-notes"
                                    className="text-sm min-h-[64px]"
                                    maxLength={2000}
                                    value={addForm.internal_notes}
                                    onChange={e => setAddForm({ ...addForm, internal_notes: e.target.value })}
                                    placeholder="Anything for the next person on this lead — call back after 6, spoke to the brother…"
                                />
                            </div>
                        </div>

                        {/* ── The store, and what the customer would receive ── */}
                        {addTwoWheeler ? (
                            <div className="space-y-2 min-w-0 lg:border-l lg:border-slate-100 lg:pl-4">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Who gets it</p>
                                <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-4 space-y-2">
                                    <p className="text-sm font-bold text-slate-800">🏍️ Customer Executive</p>
                                    <p className="text-[12px] text-slate-600 leading-relaxed">
                                        2-wheeler enquiries don't go to a store. On save, the Customer Executive
                                        (the support number in Store Locator settings) gets the <b>New Support Lead</b> WhatsApp alert
                                        with this customer's number and "2-Wheeler" as the vehicle.
                                    </p>
                                    <p className="text-[12px] text-slate-600 leading-relaxed">
                                        The customer isn't messaged — give them the executive's number on the call.
                                    </p>
                                </div>
                            </div>
                        ) : (
                        <div className="space-y-2 min-w-0 lg:border-l lg:border-slate-100 lg:pl-4">
                            <div className="flex items-baseline gap-2">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                                    Store details
                                </p>
                                <span className="text-[10px] text-slate-300">optional</span>
                                {!loadingAddStores && addStores.length > 0 && (
                                    <span className="ml-auto text-[10px] font-semibold text-slate-400 shrink-0">
                                        {addStores.length} in {addPreview?.state}
                                    </span>
                                )}
                            </div>

                            {loadingAddStores ? (
                                <p className="text-xs text-slate-400 flex items-center gap-1.5 py-6 justify-center">
                                    <Loader2 className="h-3 w-3 animate-spin" /> Finding stores…
                                </p>
                            ) : addStores.length === 0 ? (
                                /* Nothing to show yet, but the column keeps its place so
                                   the dialog does not jump when the area is typed. */
                                <div className="rounded-xl border border-dashed border-slate-200 grid place-items-center px-4 py-10">
                                    <p className="text-[11px] text-slate-400 text-center leading-relaxed">
                                        {addPinOk || addForm.area.trim()
                                            ? `No verified franchise near ${addPinOk ? addForm.pincode : addPreview?.state || "that area"} yet.`
                                            : "Enter the pincode to see the stores nearest this customer."}
                                    </p>
                                </div>
                            ) : (() => {
                                const picked = addStores.find(s => s.id === addStore);
                                const q = addStoreSearch.trim().toLowerCase();
                                const shown = addStores.filter(s => !q
                                    || s.store_name.toLowerCase().includes(q)
                                    || (s.city || "").toLowerCase().includes(q)
                                    || (s.pincode || "").includes(q));

                                if (picked) {
                                    return (
                                        <div className="space-y-2 min-w-0">
                                            <div className="rounded-xl border border-orange-200 bg-orange-50/60 p-3 min-w-0">
                                                <div className="flex items-start gap-2 min-w-0">
                                                    <StoreIcon className="h-4 w-4 text-orange-600 shrink-0 mt-0.5" />
                                                    <div className="min-w-0 flex-1">
                                                        <p className="text-sm font-bold text-slate-800 truncate">
                                                            {picked.store_name}
                                                        </p>
                                                        <p className="text-[11px] text-slate-500 leading-snug">
                                                            {buildAddress(picked)}
                                                        </p>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => setAddStore(null)}
                                                        className="text-[11px] font-semibold text-slate-400 hover:text-slate-700 shrink-0"
                                                    >
                                                        Change
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Exactly what will arrive on the customer's
                                                phone, shown before it goes, because the
                                                message cannot be recalled. */}
                                            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-1.5 min-w-0">
                                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                                                    The customer receives
                                                </p>
                                                <p className="text-[11px] text-slate-600 whitespace-pre-line leading-relaxed break-words">
                                                    {`Thank you for your enquiry. Your nearest Autoform store is:\n\n` +
                                                     `${picked.store_name}\n` +
                                                     `${buildAddress(picked)}\n\n` +
                                                     `Call: ${picked.phone_number || "—"}\n\n` +
                                                     `Our team there will be happy to help you.`}
                                                </p>
                                            </div>

                                            {!picked.phone_number && (
                                                <p className="text-[11px] text-amber-700 leading-snug px-0.5">
                                                    This store has no phone on record, so the message would
                                                    name nobody to call. Pick another, or add the number first.
                                                </p>
                                            )}
                                        </div>
                                    );
                                }

                                return (
                                    <div className="space-y-2 min-w-0">
                                        <Input
                                            value={addStoreSearch}
                                            onChange={e => setAddStoreSearch(e.target.value)}
                                            placeholder="Search by store, city or pincode…"
                                            className="h-8 text-xs"
                                        />
                                        <div className="h-64 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100 min-w-0">
                                            {shown.length === 0 ? (
                                                <p className="text-xs text-slate-400 px-3 py-6 text-center">
                                                    No store matches that search.
                                                </p>
                                            ) : shown.map(s => (
                                                <button
                                                    key={s.id}
                                                    type="button"
                                                    onClick={() => setAddStore(s.id)}
                                                    className="w-full text-left px-3 py-2.5 hover:bg-orange-50/60 transition-colors min-w-0"
                                                >
                                                    <div className="flex items-center gap-1.5 min-w-0">
                                                        <span className="text-xs font-semibold text-slate-800 truncate">
                                                            {s.store_name}
                                                        </span>
                                                        {/* Advice, not a decision — the admin still picks. */}
                                                        {s.near && (
                                                            <span className="text-[9px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-50 px-1 py-0.5 rounded shrink-0">
                                                                Nearby
                                                            </span>
                                                        )}
                                                        {!s.phone_number && (
                                                            <span className="text-[9px] font-bold uppercase tracking-wide text-amber-700 bg-amber-50 px-1 py-0.5 rounded shrink-0">
                                                                No phone
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="text-[11px] text-slate-400 truncate mt-0.5">
                                                        {[s.city, s.pincode].filter(Boolean).join(" · ")}
                                                    </p>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                        )}
                    </div>

                    <DialogFooter className="border-t border-slate-100 pt-3">
                        {/* Everything about to happen, in words: an ASM messaged, a
                            customer messaged, or neither. Both are real WhatsApps
                            that cannot be recalled. */}
                        <p className="mr-auto text-[11px] text-slate-400 leading-snug hidden sm:block">
                            {(() => {
                                const store = addStores.find(s => s.id === addStore);
                                const who = addForm.phone || "the customer";
                                if (addTwoWheeler) return "The Customer Executive gets the lead alert · the customer is not messaged";
                                if (addPreview?.outcome) {
                                    if (store) return `${who} and ${store.store_name} get the message`;
                                    if (addPreview.outcome === "stores") return "Saved — pick a store to message the customer and the store.";
                                    return `${addPreview.contact_name || "Customer support"} gets the lead · ${who} gets their number`;
                                }
                                const parts = [];
                                if (addPreview?.matched) parts.push(`${addPreview.asm_name} is notified`);
                                if (store) parts.push(`${who} gets ${store.store_name}`);
                                return parts.length ? parts.join(" · ") : "Saved without notifying anyone.";
                            })()}
                        </p>
                        <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
                        <Button
                            onClick={() => submitLead()}
                            disabled={adding || !addValid}
                            className="bg-orange-500 hover:bg-orange-600"
                        >
                            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add lead"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {leads.length >= 200 && (
                <p className="text-xs text-slate-400 text-center">
                    Showing the 200 most recent enquiries.
                </p>
            )}
        </div>
    );
};
