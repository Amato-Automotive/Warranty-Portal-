/* eslint-disable @typescript-eslint/no-explicit-any -- stand-ins for the API's JSON, which the screens read untyped */
/**
 * The training store's data. Made up, generated fresh on every load relative to
 * today, so the home's "this week" and "this month" always have something in
 * them. Phone numbers look real so the forms accept them; TrainingPage stops
 * every Call / WhatsApp / email link, so nobody is ever rung. Emails are
 * @example.com.
 */

export type Mode = "franchise" | "distributor";

const DAY = 86_400_000;

/* A small fixed-seed generator, so every trainee sees the same store. */
function rng(seed: number) {
    return () => {
        seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export const iso = (ms: number) => new Date(ms).toISOString();
/** "YYYY-MM-DD" in IST. */
export const istDay = (ms: number) => new Date(ms + 5.5 * 3600_000).toISOString().slice(0, 10);
/** "YYYY-MM-DD HH:mm" in IST, as the leads list sends it. */
export const istStamp = (ms: number) => new Date(ms + 5.5 * 3600_000).toISOString().slice(0, 16).replace("T", " ");

export const FIRST_NAMES = ["Amit", "Priya", "Rohit", "Neha", "Vikas", "Sunita", "Arjun", "Kavita", "Manoj", "Pooja", "Sandeep", "Anjali", "Rakesh", "Deepa", "Imran", "Meena", "Harpreet", "Suresh", "Nisha", "Gaurav"];
export const LAST_NAMES = ["Verma", "Patel", "Singh", "Joshi", "Gupta", "Yadav", "Khan", "Mishra", "Chauhan", "Rathore", "Jain", "Agarwal", "Tiwari", "Saxena"];
const CARS: [string, string][] = [
    ["Maruti Suzuki", "Swift"], ["Maruti Suzuki", "Baleno"], ["Maruti Suzuki", "Ertiga"], ["Maruti Suzuki", "Brezza"],
    ["Hyundai", "Creta"], ["Hyundai", "i20"], ["Hyundai", "Venue"], ["Tata", "Nexon"], ["Tata", "Punch"],
    ["Mahindra", "XUV700"], ["Mahindra", "Scorpio-N"], ["Kia", "Seltos"], ["Kia", "Sonet"], ["Toyota", "Innova Crysta"],
    ["Honda", "City"], ["Tata", "Nexon EV"], ["MG", "ZS EV"],
];
const COLOURS = ["White", "Silver", "Grey", "Red", "Blue", "Black"];
const SEAT_COVERS: [string, string][] = [
    ["U-Sports (Signature)", "2+1 year"], ["U-Sports (Emporio)", "2+1 year"], ["U-Sports (Series)", "1+1 year"],
    ["U-FOCUS", "1+1 year"], ["U-BLADE (Signature)", "2 + 1 year"], ["D3", "1+1 year"],
];
const REJECT_REASONS = [
    "The invoice photo is blurred — please upload a clear photo where the date and amount can be read.",
    "The UID entered doesn't match the one on the packaging. Please check the sticker and correct it.",
    "Car photo doesn't show the number plate. Please upload a photo with the registration visible.",
];

export interface TrainingState {
    mode: Mode;
    seq: number;
    user: any;
    profile: any;
    warranties: any[];
    manpower: any[];
    leads: any[];
    schemes: any[];
    audits: any[];
    posmCatalog: any;
    posmRequests: any[];
    posmMessages: Record<number, any[]>;
    grievances: any[];          // customers' complaints about the store
    myGrievances: any[];        // ones the store raised
    remarks: Record<number, any[]>;
    grievanceCategories: any[];
    notifications: any[];
    orders: any[];              // the store's own orders to its distributor
    incoming: any[];            // distributor mode: orders from its franchises
    inventory: Record<string, number> | null; // distributor stock by product::variation
    distributor: any;
    franchises: any[];
    feedbackCurrent: any;
    feedbackPast: any[];
}

export const STORE_DETAILS_ID = "training-vd-1";

export function seed(mode: Mode): TrainingState {
    const r = rng(20261028);
    const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
    const now = Date.now();
    const name = () => `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
    const phone = (i: number) => `98${String(10000000 + i * 7919).slice(-8)}`;
    const reg = () => `MP09 ${String.fromCharCode(65 + Math.floor(r() * 26))}${String.fromCharCode(65 + Math.floor(r() * 26))} ${1000 + Math.floor(r() * 8999)}`;

    const distributor = mode === "distributor";
    const storeName = distributor ? "Practice Distributors" : "Practice Car Studio";
    const owner = "Ravi Kumar";

    const user = {
        id: "training-user", email: "store@training.example.com", name: owner, role: "vendor",
        phoneNumber: "9800000001", isValidated: true, isActive: true,
    };
    const profile = {
        id: STORE_DETAILS_ID, store_name: storeName, store_email: "store@training.example.com", store_code: "PRACTICE01",
        contact_number: "9800000001", address_line1: "12, MG Road, Near City Mall", address_line2: "", address_line: "12, MG Road, Near City Mall",
        city: "Indore", state: "Madhya Pradesh", postal_code: "452001", gst_number: "23ABCDE1234F1Z5",
        is_distributor: distributor, is_franchise: !distributor, allowed_brands: "AF", owner_name: owner,
    };

    /* ---------- staff ---------- */
    const staff = [
        { name: "Mohit Verma", type: "seat_cover" }, { name: "Salim Khan", type: "seat_cover" },
        { name: "Deepak Yadav", type: "seat_cover" }, { name: "Ajay Rathore", type: "ppf_spf" },
        { name: "Karan Joshi", type: "seat_cover" },
    ];
    const manpower: any[] = staff.map((s, i) => ({
        id: `mp-${i + 1}`, manpower_id: `PCS-${101 + i}`, name: s.name, phone_number: phone(100 + i),
        applicator_type: s.type, is_active: 1, is_approved: 1, request_status: null, request_type: null, request_reason: null,
        removed_at: null, removed_reason: null, created_at: iso(now - (200 - i * 20) * DAY),
    }));
    manpower.push({
        id: "mp-6", manpower_id: "PCS-106", name: "Vijay Chauhan", phone_number: phone(106), applicator_type: "seat_cover",
        is_active: 1, is_approved: 0, request_status: null, request_type: null, request_reason: null, removed_at: null, removed_reason: null,
        created_at: iso(now - 2 * DAY),
    });
    manpower[4] = { ...manpower[4], request_status: "pending", request_type: "remove", request_reason: "Left the job last week" };
    manpower.push(
        { id: "mp-7", manpower_id: "PCS-090", name: "Raju Patel", phone_number: phone(90), applicator_type: "seat_cover", is_active: 0, is_approved: 1,
          request_status: null, request_type: null, request_reason: null, removed_at: iso(now - 70 * DAY), removed_reason: "Moved to another city", created_at: iso(now - 400 * DAY) },
        { id: "mp-8", manpower_id: "PCS-091", name: "Sunil Mishra", phone_number: phone(91), applicator_type: "ppf_spf", is_active: 0, is_approved: 1,
          request_status: null, request_type: null, request_reason: null, removed_at: iso(now - 120 * DAY), removed_reason: "Resigned", created_at: iso(now - 380 * DAY) },
    );

    /* ---------- warranties ---------- */
    const warranties: any[] = [];
    if (!distributor) {
        const installers = manpower.filter(m => m.is_active && m.is_approved);
        // [days ago, status]; the newest first are waiting on the store.
        const plan: [number, string][] = [
            [0.1, "pending_vendor"], [0.4, "pending_vendor"], [1.2, "pending_vendor"], [2.5, "pending_vendor"], [3.1, "pending"],
            [4.2, "pending"], [5.5, "pending"], [6.3, "validated"], [8, "pending"], [9, "rejected"], [10, "validated"],
        ];
        for (let d = 11; d < 80; d += 1 + Math.floor(r() * 3)) plan.push([d + r(), r() < 0.08 ? "rejected" : "validated"]);
        plan.forEach(([ago, status], i) => {
            const created = now - ago * DAY - Math.floor(r() * 6) * 3600_000;
            const [make, model] = pick(CARS);
            const ppf = /EV|ZS/.test(model) || r() < 0.1;
            const mp = ppf ? installers.find(m => m.applicator_type === "ppf_spf") ?? installers[0] : pick(installers.filter(m => m.applicator_type === "seat_cover"));
            const customer = name();
            const uid = String(9100000000000 + i * 104729);
            const [product, term] = pick(SEAT_COVERS);
            const registration = reg();
            const photo = (f: string) => `${window.location.origin}/training/${f}`;
            const product_details = ppf ? {
                product: "Paint Protection Film (PPF)", rolls: [{ serial: `PPF-${24000 + i}`, sqft: 120, installArea: "Full body" }],
                manpowerId: mp.id, manpowerName: mp.name, storeName, storeEmail: profile.store_email, dealerMobile: profile.contact_number,
                customerAddress: "Indore", carRegistration: registration, installationDate: istDay(created), termsAccepted: true,
                photos: { lhs: photo("car.svg"), rhs: photo("car.svg"), frontReg: photo("car.svg"), backReg: photo("car.svg"), warranty: photo("invoice.svg") },
                submissionSource: "franchise",
            } : {
                uid, productName: product, storeName, storeEmail: profile.store_email, manpowerId: mp.id, manpowerName: mp.name,
                customerAddress: "N/A", invoiceFileName: photo("invoice.svg"),
                photos: { vehicle: photo("car.svg"), seatCover: photo("seat-cover.svg") }, submissionSource: i % 3 ? "public_qr" : "franchise",
            };
            warranties.push({
                uid: ppf ? `EV-${uid}` : uid, id: 5000 + i, user_id: `cust-${i}`, product_type: ppf ? "ev-products" : "seat-cover",
                customer_name: customer, customer_email: `${customer.split(" ")[0].toLowerCase()}${i}@example.com`, customer_phone: phone(300 + i),
                customer_address: "Indore", car_make: make, car_model: model, car_year: String(2019 + Math.floor(r() * 7)), car_colour: pick(COLOURS),
                registration_number: registration, purchase_date: istDay(created - DAY), installer_name: storeName, installer_contact: profile.store_email,
                product_details, manpower_id: mp.id, manpower_name_from_db: mp.name, status,
                validated_at: status === "validated" ? iso(created + 1.5 * DAY) : null,
                rejected_at: status === "rejected" ? iso(created + DAY) : null,
                vendor_approved_at: status !== "pending_vendor" ? iso(created + 0.3 * DAY) : null,
                rejection_reason: status === "rejected" ? pick(REJECT_REASONS) : null, rejected_by: status === "rejected" ? "admin" : null,
                created_at: iso(created), warranty_type: ppf ? "7 years" : term,
                vendor_phone_number: profile.contact_number, vendor_city: "Indore", vendor_store_name: storeName, vendor_state: "Madhya Pradesh",
                vendor_details_id: STORE_DETAILS_ID,
            });
        });
    }

    /* ---------- leads ---------- */
    const leadStatuses = ["closed_won", "closed_won", "follow_up", "closed_lost", "not_reachable", "pending", "closed_won", "follow_up"];
    const leads: any[] = distributor ? [] : Array.from({ length: 26 }, (_, i) => {
        const at = now - (i * 2.2 + r()) * DAY;
        const [make, model] = pick(CARS);
        const status = i < 3 ? "pending" : pick(leadStatuses);
        return {
            id: `lead-${i + 1}`, received: istStamp(at), customer_name: name(), customer_phone: phone(500 + i),
            product: pick(["Seat cover", "Seat cover", "PPF", "Floor mats", "Seat cover"]), car: `${make} ${model}`,
            pincode: `4520${10 + Math.floor(r() * 80)}`, state: "Madhya Pradesh", via: i % 3 ? "customer" : "autoform",
            status, status_at: status === "pending" ? null : istStamp(at + DAY),
        };
    });

    /* ---------- schemes ---------- */
    const month = (ago: number) => { const d = new Date(now); d.setDate(1); d.setMonth(d.getMonth() - ago); return d.toISOString().slice(0, 7); };
    const stamp = (ms: number, time: string) => `${istDay(ms)}T${time}`;
    const clubs = [
        { id: "c1", name: "Silver", min: 100, icon: "medal", color: "silver", reward: "₹2,000 voucher" },
        { id: "c2", name: "Gold", min: 250, icon: "trophy", color: "gold", reward: "₹6,000 voucher" },
        { id: "c3", name: "Platinum", min: 500, icon: "crown", color: "silver", reward: "Goa trip for two" },
    ];
    const products = [
        { id: "p1", name: "U-Sports (Signature)", points: 12 }, { id: "p2", name: "U-Sports (Emporio)", points: 10 },
        { id: "p3", name: "U-FOCUS", points: 6 }, { id: "p4", name: "Floor mats (set)", points: 3 },
    ];
    const line = (p: typeof products[number], qty: number) => ({ product_id: p.id, name: p.name, points: p.points, qty, subtotal: p.points * qty });
    const entry = (i: number, ago: number, status: string, lines: any[]) => ({
        id: `e${i}`, answers: { invoice_no: `INV-${2400 + i}`, distributor: "Practice Distributors" },
        files: { invoice: [{ name: `invoice-${2400 + i}.jpg`, url: `${window.location.origin}/training/invoice.svg`, size: 182_000, ext: "jpg" }] },
        score: status === "approved" ? lines.reduce((n: number, l: any) => n + l.subtotal, 0) : 0,
        lines: status === "approved" ? lines : null, claimed_lines: null, status,
        review_note: status === "rejected" ? "Invoice is from before the scheme started." : null, created_at: iso(now - ago * DAY),
        invoices: status === "approved" ? [{ invoice_no: `INV-${2400 + i}`, points: lines.reduce((n: number, l: any) => n + l.subtotal, 0), lines }] : null,
    });
    const schemes = distributor ? [] : [
        {
            id: "sch-1", title: "Festive Seat Cover Club", category: "sales",
            summary: "Earn points on every Autoform seat cover invoice this festive season and climb the clubs.",
            banner_url: null, instructions: "1. Join the scheme.\n2. After each sale, submit the invoice photo here.\n3. Our team checks it within 2 working days and adds your points.",
            terms: "Only invoices dated inside the scheme period count. Autoform's decision on points is final.",
            starts_on: istDay(now - 40 * DAY), ends_on: istDay(now + 35 * DAY),
            windows: [{ start: stamp(now - 40 * DAY, "00:00"), end: stamp(now + 35 * DAY, "23:59") }],
            open_window: { start: stamp(now - 40 * DAY, "00:00"), end: stamp(now + 35 * DAY, "23:59") }, next_window: null,
            fields: [
                { id: "invoice", label: "Invoice photo", type: "file", required: true, formats: ["image", "pdf"], max_files: 3, max_mb: 10 },
                { id: "invoice_no", label: "Invoice number", type: "text", required: true },
                { id: "distributor", label: "Bought from", type: "distributor", required: false },
            ],
            entries_per_store: "many", score_rule: { mode: "products", products }, rewards: { mode: "clubs" },
            leaderboard: { show: true, names: true }, clubs,
            contact: { name: "Scheme desk", role: "Head office", phone: "9800000099", email: "schemes@training.example.com" },
            status: "published", state: "live", joined: true,
            entries: [
                entry(1, 30, "approved", [line(products[0], 4), line(products[2], 3)]),
                entry(2, 21, "approved", [line(products[1], 5), line(products[3], 6)]),
                entry(3, 12, "approved", [line(products[0], 3)]),
                entry(4, 6, "rejected", []),
                entry(5, 1, "pending", []),
            ],
            months: [{ month: month(1), points: 66 }, { month: month(0), points: 104 }],
            leaderboard_rows: [
                { name: "Shree Auto Decor", score: 312 }, { name: "Royal Car Accessories", score: 241 },
                { name: "MY_STORE", score: 0 }, { name: "Speed Motors", score: 152 }, { name: "Car Zone", score: 98 }, { name: "AutoKraft", score: 61 },
            ],
        },
        {
            id: "sch-2", title: "Best Display Contest", category: "display",
            summary: "Send photos of your Autoform display wall. The best three displays in the state win.",
            banner_url: null, instructions: "Send two photos of your display wall during the window.", terms: "One entry per store.",
            starts_on: istDay(now + 6 * DAY), ends_on: istDay(now + 20 * DAY),
            windows: [{ start: stamp(now + 6 * DAY, "10:00"), end: stamp(now + 12 * DAY, "18:00") }],
            open_window: null, next_window: { start: stamp(now + 6 * DAY, "10:00"), end: stamp(now + 12 * DAY, "18:00") },
            fields: [{ id: "photos", label: "Display photos", type: "file", required: true, formats: ["image"], max_files: 2, max_mb: 10 }],
            entries_per_store: "one", score_rule: { mode: "none" },
            rewards: { mode: "rank", prizes: [{ from: 1, to: 1, reward: "₹10,000" }, { from: 2, to: 3, reward: "₹5,000" }] },
            leaderboard: { show: false, names: false }, clubs: [], contact: null,
            status: "published", state: "upcoming", joined: false, entries: [], months: [], leaderboard_rows: [],
        },
    ];

    /* ---------- audits ---------- */
    const audits = distributor ? [] : [
        {
            id: "aud-2", round_id: "r2", round_name: `Store audit · ${new Date(now - 13 * DAY).toLocaleDateString("en-IN", { month: "long" })}`, channel: "whatsapp",
            audit_date: istDay(now - 13 * DAY), submitted_at: iso(now - 13 * DAY), audited_by_name: null, review_status: "reviewed",
            signage_status: "installed_working", online_presence: "google,instagram,whatsapp_group", online_presence_other: null,
            footfall: "120", seat_covers_stock: "35", products_stocked: "seat_covers,mats,care_fragrance", last_month_business: "4.5 lakh",
            staff_training: "already_trained", warranty_registration: "yes", support_needed: "no", support_details: null,
        },
        {
            id: "aud-1", round_id: "r1", round_name: null, channel: "call",
            audit_date: istDay(now - 45 * DAY), submitted_at: iso(now - 45 * DAY), audited_by_name: "Audit team", review_status: "reviewed",
            signage_status: "installed_not_working", online_presence: "google", online_presence_other: null,
            footfall: "90", seat_covers_stock: "20", products_stocked: "seat_covers,mats", last_month_business: "3 lakh",
            staff_training: "training_required", warranty_registration: "yes", support_needed: "yes",
            support_details: "Signage light stopped working. Need a replacement board.",
        },
    ];

    /* ---------- POSM ---------- */
    const posmCatalog = {
        items: [
            { id: "standee", name: "Product standee", description: "6 ft roll-up standee for the shop front.", clipart: "banner", image: null, enabled: true,
              qty_mode: "number", limits: { max_request: 2, max_month: 2 },
              fields: [{ id: "design", label: "Design", type: "select", required: true, options: ["Seat covers", "PPF", "Floor mats"] }] },
            { id: "catalogue", name: "Printed catalogue", description: "Seat cover catalogue for the counter.", clipart: "catalogue", image: null, enabled: true,
              qty_mode: "number", limits: { max_request: 10, max_month: 20 }, fields: [] },
            { id: "tshirt", name: "Staff T-shirts", description: "Branded T-shirts for installers.", clipart: "tshirt", image: null, enabled: true,
              qty_mode: "sizes", limits: { max_request: 10 },
              fields: [{ id: "sizes", label: "Sizes", type: "sizes", required: true, options: ["S", "M", "L", "XL", "XXL"] }] },
            { id: "sticker", name: "Window stickers", description: "Autoform authorised dealer stickers.", clipart: "sticker", image: null, enabled: true,
              qty_mode: "number", limits: { max_request: 20 }, fields: [] },
        ],
    };
    const posmLine = (item: string, item_name: string, qty: number, stage: string, display: { label: string; value: string }[] = []) =>
        ({ item_id: item, item_name, qty, values: {}, display, approved_qty: stage === "pending" ? null : qty, line_status: stage, note: null });
    const posmRequests = distributor ? [] : [
        { id: 3, ticket_id: "POSM-TR-0003", requirement: "Need these before Diwali please.", created_by_role: "franchise", created_by_name: owner, status: "open",
          created_at: iso(now - 1 * DAY), updated_at: iso(now - 1 * DAY), items: [posmLine("standee", "Product standee", 1, "pending", [{ label: "Design", value: "Seat covers" }])],
          dispatch: null, delivery: null, history: [{ action: "sent", status: "open", at: iso(now - DAY), by_role: "franchise", by_name: owner }] },
        { id: 2, ticket_id: "POSM-TR-0002", requirement: "", created_by_role: "franchise", created_by_name: owner, status: "dispatched",
          created_at: iso(now - 9 * DAY), updated_at: iso(now - 3 * DAY), items: [posmLine("catalogue", "Printed catalogue", 10, "dispatched")],
          dispatch: { courier: "DTDC", tracking: "D1234567890", date: istDay(now - 3 * DAY) }, delivery: null,
          history: [
              { action: "sent", status: "open", at: iso(now - 9 * DAY), by_role: "franchise", by_name: owner },
              { action: "approve", status: "approved", at: iso(now - 8 * DAY), by_role: "admin", by_name: "Marketing team" },
              { action: "dispatch", status: "dispatched", at: iso(now - 3 * DAY), by_role: "admin", by_name: "Marketing team" },
          ] },
        { id: 1, ticket_id: "POSM-TR-0001", requirement: "", created_by_role: "franchise", created_by_name: owner, status: "delivered",
          created_at: iso(now - 40 * DAY), updated_at: iso(now - 30 * DAY), items: [posmLine("sticker", "Window stickers", 6, "delivered")],
          dispatch: { courier: "Blue Dart", tracking: "BD99887766", date: istDay(now - 34 * DAY) }, delivery: { by: "franchise", at: iso(now - 30 * DAY), photos: [] },
          history: [
              { action: "sent", status: "open", at: iso(now - 40 * DAY), by_role: "franchise", by_name: owner },
              { action: "approve", status: "approved", at: iso(now - 39 * DAY), by_role: "admin", by_name: "Marketing team" },
              { action: "dispatch", status: "dispatched", at: iso(now - 34 * DAY), by_role: "admin", by_name: "Marketing team" },
              { action: "received", status: "delivered", at: iso(now - 30 * DAY), by_role: "franchise", by_name: owner },
          ] },
    ];
    const posmMessages: Record<number, any[]> = {
        2: [{ id: 1, sender_role: "admin", sender_name: "Marketing team", message: "Sent by DTDC today. Should reach you in 3–4 days.", attachments: null, created_at: iso(now - 3 * DAY) }],
        3: [], 1: [],
    };

    /* ---------- complaints ---------- */
    const w = (i: number) => warranties[i]?.uid;
    const grievances = distributor ? [] : [
        { id: 902, ticket_id: "GRV-TR-0902", customer_name: name(), customer_email: "customer1@example.com", customer_phone: phone(800), category: "seat_cover",
          sub_category: null, subject: "Stitching coming loose on driver seat", description: "Installed last month. The stitching on the driver seat side bolster has started opening.",
          attachments: "[]", status: "submitted", franchise_remarks: null, admin_remarks: null, created_by_role: "customer", customer_rating: null,
          created_at: iso(now - 2 * DAY), resolved_at: null, warranty_id: w(12) },
        { id: 901, ticket_id: "GRV-TR-0901", customer_name: name(), customer_email: "customer2@example.com", customer_phone: phone(801), category: "accessories",
          sub_category: null, subject: "Floor mat size not matching", description: "The mats delivered don't fit the rear footwell.",
          attachments: "[]", status: "resolved", franchise_remarks: "Replaced with the correct size.", admin_remarks: "Closed after replacement.", created_by_role: "customer",
          customer_rating: 5, created_at: iso(now - 25 * DAY), resolved_at: iso(now - 20 * DAY), warranty_id: null },
    ];
    const myGrievances = distributor ? [] : [
        { id: 905, ticket_id: "GRV-TR-0905", customer_name: storeName, category: "software_issue", sub_category: null, subject: "QR code poster not printing clearly",
          description: "The QR poster from the portal prints blurred on our printer.", attachments: "[]", status: "in_progress", franchise_remarks: null,
          admin_remarks: "Sending you a high-resolution file.", created_by_role: "franchise", created_by_name: owner, customer_rating: null,
          created_at: iso(now - 5 * DAY), resolved_at: null, department_display: "IT" },
    ];
    const remarks: Record<number, any[]> = {
        901: [{ id: 1, grievance_id: 901, added_by: "franchise", added_by_name: storeName, added_by_id: "training-user", remark: "Replaced with the correct size.", created_at: iso(now - 21 * DAY) }],
        902: [], 905: [{ id: 2, grievance_id: 905, added_by: "admin", added_by_name: "Support team", added_by_id: "admin", remark: "Sending you a high-resolution file.", created_at: iso(now - 4 * DAY) }],
    };
    const grievanceCategories = [
        { value: "seat_cover", label: "Seat Cover" }, { value: "mats", label: "Mats" }, { value: "accessories", label: "Accessories" },
        { value: "software_issue", label: "Software/Portal Issue" }, { value: "ev_ppf", label: "EV & PPF" }, { value: "other", label: "Other" },
    ].map((c, i) => ({ id: i + 1, ...c, is_active: 1 }));

    /* ---------- notifications ---------- */
    const notifications = [
        { id: 6, title: "New launch: U-Sports Emporio", message: "Our new premium seat cover range is now available to order from your distributor.", type: "product", is_read: false, created_at: iso(now - 0.5 * DAY) },
        { id: 5, title: "Festive Seat Cover Club is live", message: "Join the scheme from Offers & Schemes and start earning points on every invoice.", type: "scheme", is_read: false, created_at: iso(now - 2 * DAY) },
        { id: 4, title: "Your POSM request was dispatched", message: "Printed catalogue — DTDC D1234567890.", type: "posm", is_read: true, created_at: iso(now - 3 * DAY) },
        { id: 3, title: "Portal maintenance on Sunday", message: "The portal may be slow between 2 and 4 am on Sunday.", type: "system", is_read: true, created_at: iso(now - 6 * DAY) },
        { id: 2, title: "Warranty photos: please read", message: "Make sure the car's number plate is visible in the car photo, or the warranty will be sent back for correction.", type: "alert", is_read: true, created_at: iso(now - 10 * DAY) },
        { id: 1, title: "Welcome to the franchise portal", message: "This is a training store. Everything you do here is practice.", type: "system", is_read: true, created_at: iso(now - 30 * DAY) },
    ].map(n => ({ ...n, link: null, metadata: null, is_cleared: false }));

    /* ---------- orders ---------- */
    const dist = { id: "dist-1", name: "Practice Distributors", city: "Indore", state: "Madhya Pradesh", phone_number: "9800000077", email: "distributor@training.example.com", allowed_brands: "AF" };
    const item = (n: number, product_name: string, variation_name: string | null, quantity: number, price: number) => ({ id: `oi-${n}`, product_name, variation_name, quantity, price });
    const order = (id: string, ago: number, status: string, items: any[], extra: any = {}) => ({
        id, status, total_amount: items.reduce((s, i) => s + i.quantity * i.price, 0),
        shipping_address: profile.address_line1, shipping_city: "Indore", shipping_state: "Madhya Pradesh", shipping_pincode: "452001",
        created_at: iso(now - ago * DAY), distributor_name: dist.name, distributor_phone: dist.phone_number, distributor_email: dist.email,
        client_store_name: storeName, client_store_email: profile.store_email, vendor_name: owner, vendor_phone: profile.contact_number,
        docket_id: null, distributor_confirmation_note: null, declined_by_role: null, decline_reason: null, declined_at: null,
        order_group_id: null, group_size: 1, items, ...extra,
    });
    const orders = distributor ? [] : [
        order("AFI-TR-1004", 0.3, "processing", [item(1, "U-Sports (Signature) Seat Cover", "Hatchback", 2, 6200)]),
        order("AFI-TR-1003", 4, "processing", [item(2, "U-FOCUS Seat Cover", "Sedan", 3, 3900), item(3, "3D Floor Mats", "Universal", 4, 1450)],
            { docket_id: "TRK778812", distributor_confirmation_note: "Dispatched by road transport." }),
        order("AFI-TR-1002", 15, "delivered", [item(4, "U-Sports (Emporio) Seat Cover", "SUV 7 seater", 2, 8400)]),
        order("AFI-TR-1001", 28, "cancelled", [item(5, "Steering Cover", "Black", 10, 450)],
            { declined_by_role: "distributor", decline_reason: "Out of stock — please reorder next week.", declined_at: iso(now - 27 * DAY) }),
    ];
    const franchiseRow = (i: number, n: string, city: string) => ({
        vendor_id: `fr-${i}`, store_name: n, store_email: `store${i}@example.com`, phone_number: phone(900 + i), city, state: "Madhya Pradesh",
    });
    const franchises = distributor ? [franchiseRow(1, "Shree Auto Decor", "Indore"), franchiseRow(2, "Royal Car Accessories", "Ujjain"), franchiseRow(3, "Speed Motors", "Dewas")] : [];
    const incomingOrder = (id: string, f: any, ago: number, status: string, items: any[], extra: any = {}) => ({
        ...order(id, ago, status, items, extra), client_store_name: f.store_name, client_store_email: f.store_email, vendor_name: name(),
        vendor_phone: f.phone_number, shipping_city: f.city, franchise_brand: "AF",
    });
    const incoming = distributor ? [
        incomingOrder("AFI-TR-2004", franchises[0], 0.2, "processing", [item(11, "U-Sports (Signature) Seat Cover", "Hatchback", 3, 6200)]),
        incomingOrder("AFI-TR-2003", franchises[1], 1, "pending", [item(12, "U-FOCUS Seat Cover", "Sedan", 4, 3900)],
            { distributor_confirmation_note: "Waiting for stock — expected Friday." }),
        incomingOrder("AFI-TR-2002", franchises[2], 6, "processing", [item(13, "3D Floor Mats", "Universal", 6, 1450)], { docket_id: "TRK551203" }),
        incomingOrder("AFI-TR-2001", franchises[0], 18, "delivered", [item(14, "U-Sports (Emporio) Seat Cover", "SUV 7 seater", 2, 8400)]),
    ] : [];

    /* ---------- feedback ---------- */
    const thisMonth = istDay(now).slice(0, 7);
    const lastMonth = month(1);
    const questions = [
        { id: "q1", label: "How happy are you with Autoform overall?", type: "rating", required: true, active: true },
        { id: "q2", label: "How likely are you to recommend Autoform to another store?", type: "nps", required: true, active: true },
        { id: "q3", label: "Did your orders arrive on time this month?", type: "yesno", required: true, active: true },
        { id: "q4", label: "Which product sold best this month?", type: "single", required: false, active: true, options: ["Seat covers", "Floor mats", "PPF", "Accessories"] },
        { id: "q5", label: "Anything we should improve?", type: "textarea", required: false, active: true },
    ];
    const feedbackCurrent = {
        month: thisMonth, enabled: !distributor, state: distributor ? { open: false, why: "not_for_you" } : { open: true }, title: "Monthly store feedback",
        intro: "Two minutes, once a month. Your answers go straight to the management team.", questions, response: null, reminder: null,
    };
    const feedbackPast = distributor ? [] : [{
        month: lastMonth, submitted_at: iso(now - 25 * DAY),
        answers: [
            { qid: "q1", label: questions[0].label, type: "rating", value: 4 },
            { qid: "q2", label: questions[1].label, type: "nps", value: 8 },
            { qid: "q3", label: questions[2].label, type: "yesno", value: true },
            { qid: "q4", label: questions[3].label, type: "single", value: "Seat covers" },
            { qid: "q5", label: questions[4].label, type: "textarea", value: "Faster dispatch for SUV sizes please." },
        ],
    }];

    return {
        mode, seq: 10_000, user, profile, warranties, manpower, leads, schemes, audits, posmCatalog, posmRequests, posmMessages,
        grievances, myGrievances, remarks, grievanceCategories, notifications, orders, incoming, inventory: distributor ? {} : null,
        distributor: dist, franchises, feedbackCurrent, feedbackPast,
    };
}
