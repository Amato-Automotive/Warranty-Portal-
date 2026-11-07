/* eslint-disable @typescript-eslint/no-explicit-any -- stand-ins for the API's JSON, which the screens read untyped */
import { istDay, iso } from "./seed";

/**
 * The smaller later features in the training store: Franchise Forms, the
 * distributor's cars and photos per product (with shop by car), and a warranty
 * registration that lands in the store's list.
 */

type On = (method: string, path: string, handler: (c: any) => any) => void;
interface Deps { fail: (status: number, message: string) => never; nextId: () => number; now: () => number; fileUrls: (form: FormData | null, match: (k: string) => boolean) => string[]; mode: string }

/* ---------- Franchise Forms ---------- */

export function seedForms(distributor: boolean): any[] {
    if (distributor) return [];
    const q = (id: string, label: string, type: string, extra: Record<string, unknown> = {}) => ({ id, label, type, required: false, active: true, ...extra });
    return [{
        id: "training-form-1", title: "Sell Online Registration Form",
        intro: "Tell us if you sell online, so head office can support you. This is a practice form: nothing you send here reaches head office.",
        banner_url: null, status: "live", audience: { mode: "all", brands: [], states: [], store_ids: [] },
        questions: [
            q("f1", "Do you sell seat covers online?", "yesno", { required: true }),
            q("f2", "Which platforms do you sell on?", "multi", { options: ["Amazon", "Flipkart", "Own website", "Instagram", "WhatsApp catalogue"] }),
            q("f3", "The name your online store goes by", "text", { required: true }),
            q("f4", "Orders you ship online in a month", "number"),
            q("f5", "A screenshot of your online store", "photo", { max_files: 2 }),
        ],
        submitted: false, response: null,
    }];
}

/* ---------- vehicles for shop by car ---------- */

const MODELS: Record<string, string[]> = {
    Hyundai: ["Creta", "Venue", "i20", "Verna", "Grand i10 Nios"], Kia: ["Seltos", "Sonet", "Carens"], Tata: ["Nexon", "Harrier", "Punch", "Safari"],
    Mahindra: ["XUV700", "Thar", "Scorpio-N", "Bolero"], Toyota: ["Innova Crysta", "Fortuner", "Hyryder"], Honda: ["City", "Amaze", "Elevate"],
};

/** Cars a few of the practice distributor's products fit, so the franchise's car chooser has something to show. */
export function demoFitment(index: number): { make: string; model: string; from: number | null; to: number | null }[] {
    if (index % 3 === 0) return [{ make: "Hyundai", model: "Creta", from: 2020, to: 2024 }, { make: "Kia", model: "Seltos", from: 2020, to: null }];
    if (index % 3 === 1) return [{ make: "Tata", model: "Nexon", from: 2018, to: null }];
    return [];
}

export function registerExtraRoutes(on: On, S: any, d: Deps, catalogue: () => Promise<{ products: any[]; categories: any[] }>) {
    /* Franchise Forms */
    on("GET", "/franchise-forms", () => ({ success: true, data: S.forms }));
    on("POST", "/franchise-forms/:id", ({ p, body, form }: any) => {
        const f = S.forms.find((x: any) => x.id === p[0]) ?? d.fail(404, "Form not found");
        if (f.submitted) d.fail(400, "You've already sent this form.");
        let values: Record<string, any> = {};
        try { values = JSON.parse(body.answers || "{}"); } catch { d.fail(400, "The answers could not be read"); }
        const missing = f.questions.find((qq: any) => {
            if (!qq.required) return false;
            if (qq.type === "photo") return !d.fileUrls(form, k => k === `q_${qq.id}`).length;
            const v = values[qq.id];
            return v == null || v === "" || (Array.isArray(v) && !v.length);
        });
        if (missing) d.fail(400, `Please answer: ${missing.label}`);
        const answers = f.questions.map((qq: any) => ({
            qid: qq.id, label: qq.label, type: qq.type, value: values[qq.id] ?? null,
            ...(qq.type === "photo" ? { files: d.fileUrls(form, k => k === `q_${qq.id}`) } : {}),
        }));
        f.submitted = true;
        f.response = { answers, submitted_at: iso(d.now()) };
        return { success: true };
    });

    /* The distributor's cars and photos per product */
    on("GET", "/orders/vehicles", () => ({ success: true, models: MODELS }));
    on("GET", "/orders/distributor/products/:productId", async ({ p }: any) => {
        const { products } = await catalogue();
        const prod = products.find((x: any) => x.id === p[0]) ?? d.fail(404, "This product is not in your categories.");
        const info = (S.listings ??= {})[prod.id] ?? { fitment: [], images: [], own_images: false, stock_mode: "product", cars: [], updated_at: null };
        const variations = prod.variations?.length ? prod.variations.map((v: any) => ({ id: v.id, name: v.name })) : [{ id: null, name: "Default" }];
        return {
            success: true,
            product: { id: prod.id, name: prod.name, brand: prod.brand ?? "AF", autoform_images: prod.images ?? [] },
            variations, fitment: info.fitment, images: info.images, own_images: info.own_images, stock_mode: info.stock_mode, cars: info.cars, updated_at: info.updated_at,
        };
    });
    on("PUT", "/orders/distributor/products/:productId", async ({ p, body, form }: any) => {
        const { products } = await catalogue();
        const prod = products.find((x: any) => x.id === p[0]) ?? d.fail(404, "This product is not in your categories.");
        const parse = (v: unknown, fallback: any) => { try { return typeof v === "string" ? JSON.parse(v) : (v ?? fallback); } catch { return fallback; } };
        const year = (v: unknown) => (v === "" || v == null ? null : Number.isInteger(Number(v)) && Number(v) >= 1980 && Number(v) <= 2100 ? Number(v) : NaN);
        const fitment: any[] = [];
        for (const f of (Array.isArray(parse(body.fitment, [])) ? parse(body.fitment, []) : []).slice(0, 200)) {
            const make = String(f?.make ?? "").trim().slice(0, 60);
            const model = String(f?.model ?? "").trim().slice(0, 60);
            const from = year(f?.from), to = year(f?.to);
            if (!make) continue;
            if (Number.isNaN(from) || Number.isNaN(to)) d.fail(400, `${make} ${model}: a year must be between 1980 and 2100`);
            if (from !== null && to !== null && from > to) d.fail(400, `${make} ${model}: "from" year is after "to" year`);
            fitment.push({ make, model, from, to });
        }
        const prev = (S.listings ??= {})[prod.id] ?? { images: [] };
        const keep = (Array.isArray(parse(body.keep, prev.images)) ? parse(body.keep, prev.images) : prev.images).filter((u: string) => prev.images.includes(u));
        const added = d.fileUrls(form, k => k === "photos");
        const images = [...keep, ...added];
        if (images.length > 8) d.fail(400, "Up to 8 photos per product");
        const ownImages = (body.own_images === "true" || body.own_images === true) && images.length > 0;
        const stockMode = body.stock_mode === "car" ? "car" : "product";
        let cars: any[] = [];
        if (stockMode === "car") {
            const list = parse(body.cars, []);
            cars = (Array.isArray(list) ? list : []).slice(0, 300).map((c: any, i: number) => {
                const make = String(c?.make ?? "").trim().slice(0, 60);
                if (!make) d.fail(400, "Every car row needs a make");
                const stock = Number(c?.stock);
                if (!Number.isInteger(stock) || stock < 0) d.fail(400, `${make} ${c?.model ?? ""}: stock must be a whole number, 0 or more`);
                const photos = d.fileUrls(form, k => k === `car_${i}`);
                return { id: c?.id || `car-${d.nextId()}`, variation_id: c?.variation_id ?? null, make, model: String(c?.model ?? "").trim(), from: year(c?.from), to: year(c?.to), stock, images: [...(Array.isArray(c?.keep) ? c.keep : []), ...photos] };
            });
            if (!cars.length) d.fail(400, "Add at least one car, or keep the same stock for all cars");
            const seen = new Set<string>();
            fitment.length = 0;
            for (const c of cars) { const k = `${c.make}|${c.model}|${c.from}|${c.to}`; if (!seen.has(k)) { seen.add(k); fitment.push({ make: c.make, model: c.model, from: c.from, to: c.to }); } }
        }
        S.listings[prod.id] = { fitment, images, own_images: ownImages, stock_mode: stockMode, cars, updated_at: iso(d.now()) };
        return { success: true, fitment, images, own_images: ownImages, stock_mode: stockMode };
    });

    /* A warranty registered from the store lands in its list, waiting for approval. */
    const submit = ({ body }: any) => {
        const pd = (() => {
            if (typeof body.productDetails === "string") { try { return JSON.parse(body.productDetails); } catch { return {}; } }
            const flat: Record<string, any> = {};
            Object.entries(body).forEach(([k, v]) => { const m = /^productDetails\s*\[(.+?)\]$/.exec(k); if (m) flat[m[1]] = v; });
            return flat;
        })();
        const need = (v: unknown, what: string) => { if (!String(v ?? "").trim()) d.fail(400, `Enter ${what}`); };
        need(body.customerName, "the customer's name");
        need(body.customerPhone, "the customer's phone number");
        const ppf = body.productType === "ev-products";
        const id = d.nextId();
        const uid = String(pd.uid || `99${String(id).padStart(11, "0")}`);
        const mp = S.manpower.find((m: any) => String(m.id) === String(pd.manpowerId || body.manpowerId)) ?? S.manpower[0];
        S.warranties.unshift({
            uid: ppf ? `EV-${uid}` : uid, id, user_id: `cust-new-${id}`, product_type: ppf ? "ev-products" : "seat-cover",
            customer_name: body.customerName, customer_email: body.customerEmail || null, customer_phone: body.customerPhone,
            customer_address: body.customerAddress || "N/A", car_make: body.carMake || "Hyundai", car_model: body.carModel || "Creta", car_year: body.carYear || String(new Date().getFullYear()),
            car_colour: body.carColour || "White", registration_number: body.registrationNumber || null, purchase_date: body.purchaseDate || istDay(d.now()),
            installer_name: S.profile.store_name, installer_contact: S.profile.store_email,
            product_details: { ...pd, uid, productName: pd.productName || (ppf ? "Paint Protection Film (PPF)" : "Seat cover"), storeName: S.profile.store_name, manpowerId: mp?.id, manpowerName: mp?.name, photos: {} },
            manpower_id: mp?.id ?? null, manpower_name_from_db: mp?.name ?? null, status: "pending", validated_at: null, rejected_at: null, vendor_approved_at: iso(d.now()),
            rejection_reason: null, rejected_by: null, created_at: iso(d.now()), warranty_type: body.warrantyType || "1+1 year",
            vendor_phone_number: S.profile.contact_number, vendor_city: S.profile.city, vendor_store_name: S.profile.store_name, vendor_state: S.profile.state,
            vendor_details_id: S.profile.id,
        });
        return { success: true, uid, message: "Warranty registered. In the live portal head office approves it and the customer is told on WhatsApp.", isNewUser: false };
    };
    on("POST", "/warranty/submit", submit);
    on("POST", "/public/warranty/submit", submit);
}
