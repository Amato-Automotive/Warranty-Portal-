import db from '../config/database.js';
import { leadPincode } from './leadRouting.js';
import { phoneKey } from './leadIdentity.js';
import { repeatInfo, firstLeadCampaign, type CampaignSend, type RepeatInfo, type RepeatLead } from './leadRepeat.js';

/*
 * `row.repeat` on every lead that is not its customer's first (same phone), and
 * on a first lead that came in reply to a campaign; null otherwise. Reads the
 * customers with more than one lead (a few hundred phones) over all time, so
 * the 2nd lead is recognised even when the 1st is outside the dates on screen,
 * and the campaigns sent to every number on screen, from Interakt's
 * message_campaign_sent events.
 */
export async function attachRepeats(rows: any[]): Promise<void> {
    for (const r of rows) r.repeat = null;
    if (!rows.length) return;

    const [history]: any = await db.execute(
        `SELECT l.id, l.created_at, l.source, l.product, l.car_model, l.customer_name, l.phone_key, l.raw_area,
                JSON_UNQUOTE(JSON_EXTRACT(l.raw_payload, '$.pincode')) AS payload_pincode
           FROM leads l
           JOIN (SELECT phone_key FROM leads WHERE phone_key IS NOT NULL AND CHAR_LENGTH(phone_key) = 10
                  GROUP BY phone_key HAVING COUNT(*) > 1) many ON many.phone_key = l.phone_key`
    );
    const leads: RepeatLead[] = history.map((h: any) => ({
        id: h.id, created_at: h.created_at, source: h.source, product: h.product, car_model: h.car_model,
        customer_name: h.customer_name, phone_key: h.phone_key,
        pincode: leadPincode({ pincode: h.payload_pincode }, h.raw_area),
    }));
    const leadsOf = new Map<string, number>();
    for (const l of leads) leadsOf.set(l.phone_key as string, (leadsOf.get(l.phone_key as string) ?? 0) + 1);

    const keyOf = (r: any) => r.phone_key || phoneKey(r.customer_phone);
    const phones = [...new Set([
        ...leadsOf.keys(),
        ...rows.map(keyOf).filter((k: string) => k && k.length === 10),
    ])] as string[];
    const campaigns = new Map<string, CampaignSend[]>();
    for (let i = 0; i < phones.length; i += 500) {
        const chunk = phones.slice(i, i + 500);
        const [sends]: any = await db.execute(
            `SELECT phone, received_at, campaign_name FROM webhook_events
              WHERE event_type = 'message_campaign_sent' AND campaign_name IS NOT NULL AND campaign_name <> ''
                AND phone IN (${chunk.map(() => '?').join(',')})`,
            chunk
        );
        for (const s of sends) {
            const list = campaigns.get(s.phone) ?? [];
            list.push({ phone: s.phone, at: s.received_at, name: s.campaign_name });
            campaigns.set(s.phone, list);
        }
    }

    const info: Map<string, RepeatInfo> = repeatInfo(leads, campaigns);
    for (const r of rows) {
        const key = keyOf(r);
        r.repeat = info.get(r.id) ?? null;
        if (r.repeat || !key || !campaigns.has(key)) continue;
        // The customer's first lead: tagged only when it answered a campaign.
        const first = firstLeadCampaign({ ...r, phone_key: key, pincode: null }, campaigns.get(key));
        if (first) r.repeat = { ...first, total: leadsOf.get(key) ?? 1 };
    }
}
