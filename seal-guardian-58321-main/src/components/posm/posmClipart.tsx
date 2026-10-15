/**
 * Clip art for POSM item cards: small flat illustrations, one per kind of
 * item, in the portal's orange with a navy and warm neutrals. The admin picks
 * one per item in the item builder, or uploads a picture instead.
 */

const O = "#f26a1b";   // orange
const O2 = "#ffb27a";  // light orange
const N = "#1f2a44";   // navy
const N2 = "#3b4a6b";  // soft navy
const C = "#fff4ea";   // cream
const G = "#d9dee7";   // grey
const W = "#ffffff";

const ART: Record<string, { label: string; svg: JSX.Element }> = {
    kit: { label: "Box / kit", svg: (
        <>
            <path d="M24 30 60 16l36 14v32L60 76 24 62z" fill={O2} />
            <path d="M24 30 60 44l36-14v32L60 76 24 62z" fill={O} />
            <path d="M60 44v32L24 62V30z" fill="#e2580f" />
            <path d="M24 30 60 16l36 14-36 14z" fill="#ffd2b0" />
            <path d="M42 23l36 14v9l-6-2v-6L36 25z" fill={C} />
            <rect x="66" y="52" width="20" height="10" rx="2" transform="rotate(-21 76 57)" fill={W} opacity=".9" />
        </>
    ) },
    tshirt: { label: "T-shirt", svg: (
        <>
            <path d="M44 12 30 18 14 32l10 12 8-6v34h56V38l8 6 10-12-16-14-14-6c-2 6-8 10-16 10s-14-4-16-10z" fill={O} />
            <path d="M44 12c2 6 8 10 16 10s14-4 16-10l-5-2c-1 4-6 7-11 7s-10-3-11-7z" fill="#e2580f" />
            <rect x="48" y="38" width="24" height="14" rx="3" fill={W} />
            <path d="M52 45h16" stroke={O} strokeWidth="3" strokeLinecap="round" />
            <path d="M32 38v34h4V40z" fill="#e2580f" opacity=".5" />
        </>
    ) },
    vcard: { label: "Visiting card", svg: (
        <>
            <rect x="30" y="18" width="70" height="42" rx="5" fill={G} transform="rotate(8 65 39)" />
            <rect x="20" y="22" width="72" height="44" rx="5" fill={W} stroke={G} strokeWidth="2" />
            <rect x="20" y="22" width="72" height="12" rx="5" fill={N} />
            <rect x="20" y="30" width="72" height="4" fill={N} />
            <circle cx="36" cy="48" r="8" fill={O} />
            <rect x="50" y="42" width="32" height="4" rx="2" fill={N2} />
            <rect x="50" y="50" width="22" height="3" rx="1.5" fill={G} />
            <rect x="50" y="56" width="28" height="3" rx="1.5" fill={G} />
        </>
    ) },
    catalogue: { label: "Catalogue", svg: (
        <>
            <path d="M60 22c-10-6-24-8-38-6v50c14-2 28 0 38 6z" fill={W} stroke={G} strokeWidth="2" />
            <path d="M60 22c10-6 24-8 38-6v50c-14-2-28 0-38 6z" fill={C} stroke={G} strokeWidth="2" />
            <rect x="28" y="24" width="24" height="16" rx="2" fill={O} />
            <path d="M28 46h24M28 52h18M28 58h22" stroke={G} strokeWidth="3" strokeLinecap="round" />
            <rect x="68" y="24" width="24" height="22" rx="2" fill={N2} />
            <path d="M72 40l6-8 5 5 4-4 5 7z" fill={O2} />
            <path d="M68 54h22M68 60h16" stroke={G} strokeWidth="3" strokeLinecap="round" />
            <path d="M60 22v50" stroke={G} strokeWidth="2" />
        </>
    ) },
    certificate: { label: "Certificate", svg: (
        <>
            <rect x="18" y="12" width="84" height="54" rx="4" fill={C} />
            <rect x="24" y="18" width="72" height="42" rx="2" fill="none" stroke={O2} strokeWidth="2" />
            <rect x="38" y="24" width="44" height="5" rx="2.5" fill={N} />
            <path d="M34 36h52M40 43h40" stroke={G} strokeWidth="3" strokeLinecap="round" />
            <circle cx="78" cy="58" r="11" fill={O} />
            <circle cx="78" cy="58" r="6" fill="#ffd2b0" />
            <path d="M72 66l-4 12 8-4 2 0V68zM84 66l4 12-8-4-2 0V68z" fill="#e2580f" />
        </>
    ) },
    shadebook: { label: "Shade fan", svg: (
        <>
            {[["#7a2e2e", -54], ["#c2452d", -36], [O, -18], ["#e8b04a", 0], ["#c9b28a", 18], [N2, 36], [N, 54]].map(([c, a], i) => (
                <rect key={i} x="54" y="10" width="12" height="54" rx="3" fill={c as string} transform={`rotate(${a} 60 64)`} />
            ))}
            <circle cx="60" cy="64" r="5" fill={W} stroke={N} strokeWidth="2" />
        </>
    ) },
    frp: { label: "Seat cover (FRP)", svg: (
        <>
            <ellipse cx="60" cy="74" rx="34" ry="4" fill={N} opacity=".15" />
            <path d="M40 14c0-4 3-6 7-6h26c4 0 7 2 7 6l2 28H38z" fill={N} />
            <path d="M46 16h28l1 22H45z" fill={O} />
            <path d="M52 16v22M60 16v22M68 16v22" stroke="#e2580f" strokeWidth="2" />
            <path d="M34 44h52c4 0 6 3 6 6v8c0 3-2 6-6 6H34c-4 0-6-3-6-6v-8c0-3 2-6 6-6z" fill={N2} />
            <path d="M38 48h44v10H38z" fill={O2} />
            <rect x="40" y="64" width="6" height="8" fill={N} /><rect x="74" y="64" width="6" height="8" fill={N} />
            <rect x="50" y="4" width="20" height="5" rx="2.5" fill={N2} />
        </>
    ) },
    jacket: { label: "Jacket", svg: (
        <>
            <path d="M46 10 30 16 18 30l4 34h18V40l2 32h36l2-32v24h18l4-34-12-14-16-6-14 12z" fill={N} />
            <path d="M46 10l14 12 14-12-5-2-9 8-9-8z" fill={O} />
            <path d="M60 22v50" stroke={O2} strokeWidth="2.5" />
            <rect x="44" y="46" width="10" height="3" rx="1.5" fill={O} /><rect x="66" y="46" width="10" height="3" rx="1.5" fill={O} />
            <path d="M22 60h18v4H22zM80 60h18v4H80z" fill={O} />
        </>
    ) },
    artwork: { label: "Art board", svg: (
        <>
            <rect x="14" y="10" width="92" height="44" rx="3" fill={N} />
            <rect x="19" y="15" width="82" height="34" rx="2" fill={C} />
            <path d="M19 44l18-14 12 9 16-13 36 18v5H19z" fill={O} />
            <circle cx="86" cy="24" r="5" fill={O2} />
            <rect x="30" y="20" width="26" height="5" rx="2.5" fill={N2} />
            <path d="M36 54 28 76M84 54l8 22M60 54v22" stroke={N2} strokeWidth="4" strokeLinecap="round" />
        </>
    ) },
    sticker: { label: "Sticker", svg: (
        <>
            <circle cx="56" cy="42" r="28" fill={O} />
            <path d="M84 42a28 28 0 0 1-28 28V50a8 8 0 0 1 8-8z" fill="#ffd2b0" />
            <path d="M84 42H64a8 8 0 0 0-8 8v20" fill="none" stroke="#e2580f" strokeWidth="2" />
            <path d="M44 34l6 6 12-12" stroke={W} strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </>
    ) },
    banner: { label: "Banner / standee", svg: (
        <>
            <rect x="40" y="8" width="40" height="60" rx="2" fill={O} />
            <rect x="36" y="6" width="48" height="5" rx="2.5" fill={N} />
            <circle cx="60" cy="28" r="9" fill={W} />
            <path d="M48 44h24M52 52h16" stroke={W} strokeWidth="4" strokeLinecap="round" />
            <path d="M44 68h32l4 8H40z" fill={N} />
        </>
    ) },
    box: { label: "Other", svg: (
        <>
            <rect x="26" y="22" width="68" height="46" rx="6" fill={O2} />
            <rect x="26" y="22" width="68" height="14" rx="6" fill={O} />
            <rect x="52" y="22" width="16" height="46" fill="#ffd2b0" />
            <circle cx="60" cy="50" r="6" fill={W} />
        </>
    ) },
};

export const CLIPART_KEYS = Object.keys(ART);
export const clipartLabel = (k: string) => ART[k]?.label ?? k;

/** An item's picture: the uploaded image if there is one, else its clip art. */
export function PosmArt({ clipart, image, className }: { clipart?: string | null; image?: string | null; className?: string }) {
    if (image) return <img src={image} alt="" className={className} style={{ objectFit: "contain" }} />;
    const art = ART[clipart || "box"] ?? ART.box;
    return (
        <svg viewBox="0 0 120 80" className={className} role="img" aria-label={art.label}>
            {art.svg}
        </svg>
    );
}
