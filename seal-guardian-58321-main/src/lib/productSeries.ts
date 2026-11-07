/**
 * Which series each warranty seat-cover product belongs to, as given by the
 * team. A blank series means the product is in none of the four premium series
 * (it counts as "other"). The invoice reader looks a product up here first and
 * only falls back to the word in its name when it is not listed.
 */
const LIST = `
AC4|Velora
AC5|Velora
AMAZE|Velora
AMAZE DUO|Velora
AMAZE DUO +|Velora
AMAZE+|Velora
ARO DUNE|Emporio
ARO DUNE (Signature)|Signature
ARO LINE (DOBLE EMPORIO)|Emporio
ARO LINE (DOBLE)|Doble
ARO X (DOBLE)|Doble
ARROW CRYSTAL (DOBLE EMPORIO)|Emporio
ARROW CRYSTAL (DOBLE)|Doble
CHEER|Velora
D3|Velora
D3 (Emporio)|Emporio
D3 (Signature)|Signature
D4|Velora
D5|Velora
D5 (SIGNATURE)|Signature
DRIBBLE|Velora
DRIBLE|Velora
DRIFT (SIGNATURE)|Signature
E-CROSS|Velora
E1|Velora
E2|Velora
E4|Velora
E5|Velora
EXCLUSIVE|Signature
EXCLUSIVE+|Signature
FUSION|Velora
GRID (SIGNATURE)|Signature
H-CROSS|Velora
H-CROSS (EMPORIO)|Emporio
H-CROSS (Signature)|Signature
H-GRAND|Signature
H-Grand (Emporio)|Emporio
H-GRAND (Signature)|Signature
HAMMER|Velora
HUNK|Velora
HUNK (Signature)|Signature
HUNK GRILL|Velora
HUNK PERFO|Velora
INSPIRE|Velora
LE SERIES (Signature)|Signature
POLO|Signature
POLO (Signature)|Signature
Q-3|Signature
Q-CROSS|Velora
Q2|Velora
Q2 (Signature)|Signature
Riviera (Emporio)|Emporio
Riviera (Series)|Emporio
Riviera (Signature)|Signature
SPECTRA (SERIES)|Velora
SPECTRA (SIGNATURE)|Signature
SPLASH|
TRACK|Velora
U CROSS (Signature)|Signature
U- VOLT|Signature
U-ARROW|Velora
U-ARROW (EMPORIO)|Emporio
U-ARROW (SIGNATURE)|Signature
U-BLADE|Signature
U-BLADE (Signature)|Signature
U-CREST|Velora
U-FOCUS|Velora
U-FOCUS (EMPORIO)|Emporio
U-FOCUS (SIGNATURE)|Signature
U-HIGHWAY|Velora
U-Highway (Signature)|Signature
U-IMPRESS|Signature
U-IMPRESS (EMPORIO)|Emporio
U-Impress (SIGNATURE)|Signature
U-LADDER|Signature
U-LADDER (Signature)|Signature
U-NAVIGATION PLUS|Signature
U-NAVIGATION PLUS (EMPORIO)|Emporio
U-NAVIGATION PLUS (SIGNATURE)|Signature
U-Sports (Emporio)|Emporio
U-Sports (Series)|Signature
U-Sports (Signature)|Signature
U-SPORTS (UNICO)|
VECTOR (EMPORIO)|Emporio
VECTOR (SIGNATURE)|Signature
WAVE PERFO|Signature
X-CROSS|Signature
X-CROSS (Signature)|Signature
XPRESS|Velora
`;

/** Case and spacing do not matter: "U- VOLT" and "u-volt" are the same product. */
export const productKey = (name: string): string => String(name ?? "").toLowerCase().replace(/\s+/g, "");

const SERIES: Map<string, string> = new Map(
    LIST.split("\n").map(l => l.trim()).filter(Boolean).map(l => {
        const [name, series] = l.split("|");
        return [productKey(name), (series ?? "").trim().toLowerCase()] as [string, string];
    }),
);

/** The series the team gave this product: "velora" | "doble" | "signature" | "emporio", "" for none, or undefined when the product is not listed. */
export const seriesOfProduct = (name: string): string | undefined => SERIES.get(productKey(name));
