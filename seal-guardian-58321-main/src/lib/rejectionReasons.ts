/**
 * Why head office rejects a Buy More Get More invoice. The admin picks one from a
 * list, and the store and the distributor both get the full message saved with
 * the invoice. Only the reason paragraphs differ between the messages.
 */

export const REJECTION_REASONS: { label: string; body: string[] }[] = [
    {
        label: "Billed at the old dealer price",
        body: [
            "Your purchase was billed at the old dealer price instead of the revised pricing introduced on 19th October 2026.",
            "As per company policy, additional purchase benefits are applicable only to eligible purchases billed at the revised dealer price.",
            "We kindly request you to coordinate with your distributor for future billing at the revised price to ensure eligibility for applicable company benefits.",
        ],
    },
    {
        label: "One Nation One Franchisee Programme",
        body: [
            "Your purchase was made under the One Nation One Franchisee Programme, which is excluded from additional company purchase benefits as per the applicable policy.",
            "As your purchase is already covered under this programme, it does not qualify for additional company benefits against the same billing.",
        ],
    },
    {
        label: "Plan Karo Save Karo Programme",
        body: [
            "Your purchase was made under the Plan Karo Save Karo Programme, which is excluded from additional company purchase benefits as per the applicable policy.",
            "Since your purchase is already covered under this programme, additional benefits cannot be extended against the same billing.",
        ],
    },
    {
        label: "Urgent Sets billed at old pricing",
        body: [
            "Your purchase includes Urgent Sets billed at old pricing, which are excluded from additional company purchase benefits until 30th November 2026.",
            "As these sets have already been billed at the previous dealer price, they are not eligible for additional company benefits.",
        ],
    },
];

const OPENING = [
    "Dear Franchisee Partner,",
    "Important Update – Purchase Benefit Eligibility",
    "Thank you for your continued trust and support.",
    "We regret to inform you that your submitted bill could not be approved for additional company purchase benefits.",
];
const REASON_HEADING = "Reason for Rejection:";
const CLOSING = [
    "Please note that this rejection applies only to additional company benefits and not to your actual purchase.",
    "We sincerely value your association and appreciate your understanding.",
    "Protect the Price. Strengthen the Brand. Reward the Growth.",
    "Thanks & Regards\nTeam AFAC",
];

/** The whole message for reason number `index`, paragraphs separated by a blank line. */
export function rejectionLetter(index: number): string {
    const r = REJECTION_REASONS[index];
    if (!r) return "";
    return [...OPENING, REASON_HEADING, ...r.body, ...CLOSING].join("\n\n");
}

/** A saved note is one of these messages when it opens the same way. A hand-written reason is not. */
export function splitRejectionNote(note: string): { isLetter: boolean; before: string; reason: string; after: string } {
    const text = note.trim();
    if (!text.startsWith(OPENING[0]) || !text.includes(REASON_HEADING)) return { isLetter: false, before: "", reason: text, after: "" };
    const from = text.indexOf(REASON_HEADING);
    const to = text.indexOf(CLOSING[0], from);
    const end = to === -1 ? text.length : to;
    return { isLetter: true, before: text.slice(0, from).trim(), reason: text.slice(from, end).trim(), after: text.slice(end).trim() };
}
