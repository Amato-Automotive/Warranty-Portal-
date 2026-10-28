import { findState } from './indianStates.js';

/**
 * Reading the customer's answer to "Which car do you have?".
 *
 * Lenient on purpose: anything that looks like a car is accepted, and tidied
 * to "Make Model" when it matches a known one — so a new or rare model is
 * never blocked. Only answers that cannot be a car are sent back: a number, a
 * place, a greeting, a sentence about something else. Free of any database
 * import, so every rule is tested.
 *
 * Real answers this was written against (Sept 2026): "Creta", "creat",
 * "Hy cross", "Hyundai Grand i10 nios 2025", "I have a Vitara Brezza",
 * "Toyota", "West bengal", "6".
 */

export type CarAnswer =
    | { ok: true; car: string; known: boolean }
    | { ok: false; why: 'empty' | 'junk' | 'place' | 'make-only'; make?: string };

/* Make → models. The first spelling of each model is the one shown; the rest are
   how people type it. Short names (C3, X1, A4…) only match as a whole word. */
const MODELS: Record<string, string[][]> = {
    'Maruti Suzuki': [
        ['Swift'], ['Dzire', 'Swift Dzire', 'Desire'], ['Baleno'], ['Brezza', 'Vitara Brezza', 'Breza'], ['Grand Vitara'],
        ['Ertiga'], ['XL6'], ['Fronx'], ['Wagon R', 'WagonR', 'Wagnor'], ['Alto K10'], ['Alto'], ['Alto 800'], ['800'],
        ['Celerio'], ['S-Presso', 'Spresso'], ['Ignis'], ['Ciaz'], ['Jimny'], ['Invicto'], ['Eeco'], ['S-Cross', 'Scross'],
        ['Ritz'], ['Zen'], ['Estilo'], ['Gypsy'], ['Omni'], ['A-Star'], ['Esteem'],
    ],
    Hyundai: [
        ['Creta'], ['Venue'], ['Grand i10 Nios', 'Grand i10 Neos', 'i10 Nios'], ['Grand i10'], ['i10'], ['i20'],
        ['Elite i20'], ['Aura'], ['Verna'], ['Alcazar'], ['Tucson'], ['Exter'], ['Santro'], ['Xcent'], ['Eon'],
        ['Ioniq 5'], ['Kona'], ['Getz'], ['Accent'], ['Elantra'],
    ],
    Tata: [
        ['Nexon'], ['Punch'], ['Tiago'], ['Tigor'], ['Altroz'], ['Harrier'], ['Safari'], ['Curvv'], ['Hexa'],
        ['Nano'], ['Indica'], ['Indigo'], ['Sumo'], ['Zest'], ['Bolt'], ['Aria'],
    ],
    Mahindra: [
        ['Thar Roxx', 'Roxx'], ['Thar'], ['Scorpio N', 'ScorpioN'], ['Scorpio Classic'], ['Scorpio'],
        ['XUV 3XO', 'XUV3XO', '3XO'], ['XUV300', 'XUV 300'], ['XUV400', 'XUV 400'], ['XUV500', 'XUV 500'],
        ['XUV700', 'XUV 700'], ['Bolero Neo'], ['Bolero'], ['Marazzo'], ['KUV100', 'KUV 100'], ['TUV300', 'TUV 300'],
        ['BE 6', 'BE6'], ['XEV 9e', 'XEV9e'], ['Xylo'],
    ],
    Kia: [['Seltos'], ['Sonet'], ['Carens'], ['Carnival'], ['Syros'], ['EV6']],
    Toyota: [
        ['Innova Hycross', 'Hycross', 'Hy Cross'], ['Innova Crysta', 'Crysta'], ['Innova'], ['Fortuner'],
        ['Glanza'], ['Urban Cruiser Hyryder', 'Hyryder', 'Hyrider'], ['Urban Cruiser Taisor', 'Taisor'],
        ['Urban Cruiser'], ['Rumion'], ['Camry'], ['Corolla Altis', 'Corolla'], ['Etios Liva', 'Liva'], ['Etios'],
        ['Hilux'], ['Vellfire'], ['Qualis'],
    ],
    Honda: [
        ['City'], ['Amaze'], ['Elevate'], ['Jazz'], ['WR-V', 'WRV'], ['Civic'], ['Brio'], ['Mobilio'], ['CR-V', 'CRV'],
        ['Accord'],
    ],
    MG: [['Hector Plus'], ['Hector'], ['Astor'], ['Gloster'], ['ZS EV'], ['Comet'], ['Windsor']],
    Skoda: [['Kushaq'], ['Slavia'], ['Kylaq'], ['Kodiaq'], ['Octavia'], ['Superb'], ['Rapid'], ['Laura'], ['Fabia']],
    Volkswagen: [['Taigun'], ['Virtus'], ['Polo'], ['Vento'], ['Tiguan'], ['Ameo'], ['Jetta']],
    Renault: [['Kwid'], ['Kiger'], ['Triber'], ['Duster']],
    Nissan: [['Magnite'], ['Kicks'], ['Sunny'], ['Micra'], ['Terrano']],
    Jeep: [['Compass'], ['Meridian'], ['Wrangler']],
    Citroen: [['C3 Aircross'], ['C5 Aircross'], ['Basalt'], ['eC3'], ['C3']],
    Ford: [['EcoSport', 'Eco Sport'], ['Endeavour', 'Endeavor'], ['Figo Aspire', 'Aspire'], ['Figo'], ['Freestyle'], ['Ikon'], ['Fiesta']],
    BYD: [['Atto 3'], ['Seal'], ['eMAX 7', 'EMAX7']],
    Force: [['Gurkha'], ['Trax'], ['Traveller']],
    Isuzu: [['D-Max V-Cross', 'V-Cross', 'VCross'], ['D-Max', 'DMax'], ['MU-X', 'MUX']],
    'Mercedes-Benz': [['C-Class', 'C Class'], ['E-Class', 'E Class'], ['S-Class', 'S Class'], ['GLA'], ['GLC'], ['GLE'], ['GLS']],
    BMW: [['3 Series'], ['5 Series'], ['7 Series'], ['X1'], ['X3'], ['X5'], ['X7']],
    Audi: [['A4'], ['A6'], ['Q3'], ['Q5'], ['Q7']],
    Volvo: [['XC40'], ['XC60'], ['XC90']],
};

/* How people name the make on its own. */
const MAKES: Record<string, string[]> = {
    'Maruti Suzuki': ['maruti suzuki', 'maruti', 'suzuki'],
    Hyundai: ['hyundai', 'hundai', 'huyndai'],
    Tata: ['tata'],
    Mahindra: ['mahindra', 'mahindra and mahindra'],
    Kia: ['kia'],
    Toyota: ['toyota', 'toyta'],
    Honda: ['honda'],
    MG: ['mg', 'morris garages'],
    Skoda: ['skoda'],
    Volkswagen: ['volkswagen', 'vw', 'volks wagen'],
    Renault: ['renault', 'renualt'],
    Nissan: ['nissan'],
    Jeep: ['jeep'],
    Citroen: ['citroen'],
    Ford: ['ford'],
    BYD: ['byd'],
    Force: ['force'],
    Isuzu: ['isuzu'],
    'Mercedes-Benz': ['mercedes', 'mercedes benz', 'benz'],
    BMW: ['bmw'],
    Audi: ['audi'],
    Volvo: ['volvo'],
};

/* The best-known models, to suggest when only the make was given. */
const EXAMPLES: Record<string, string[]> = {
    /* No Maruti Suzuki model names in our messages (compliance); customers can still type them. */
    'Maruti Suzuki': [],
    Hyundai: ['Creta', 'Venue', 'i20'],
    Tata: ['Nexon', 'Punch', 'Tiago'],
    Mahindra: ['Thar', 'Scorpio', 'XUV700'],
    Kia: ['Seltos', 'Sonet', 'Carens'],
    Toyota: ['Innova', 'Fortuner', 'Glanza'],
    Honda: ['City', 'Amaze', 'Elevate'],
    MG: ['Hector', 'Astor', 'Windsor'],
};

/**
 * Every make with its models, for the claim screens to pick from. A customer
 * gets no Maruti Suzuki models (compliance) and types the model instead.
 */
export function modelList(forCustomer: boolean): Record<string, string[]> {
    return Object.fromEntries(Object.entries(MODELS).map(([make, ms]) =>
        [make, forCustomer && make === 'Maruti Suzuki' ? [] : ms.map(m => m[0]).sort((a, b) => a.localeCompare(b))]));
}

export function exampleModels(make: string): string {
    return (EXAMPLES[make] ?? (MODELS[make] ?? []).slice(0, 3).map(m => m[0])).join(', ');
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/* Words that are an answer to something, but not to "which car". */
const NOT_A_CAR = new Set([
    'hi', 'hii', 'hello', 'hey', 'heyy', 'ok', 'okay', 'k', 'yes', 'no', 'ya', 'yeah', 'haan', 'nahi', 'thanks',
    'thank you', 'thankyou', 'hmm', 'na', 'car', 'my car', 'none', 'nothing', 'test', 'price', 'seat cover',
    'seat covers', 'mats', 'accessories',
]);

/** "I have a Vitara Brezza." → "Vitara Brezza" */
function cleanAnswer(text: string): string {
    return String(text ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^(?:(?:i\s+(?:have|own|drive|use)|i'?ve\s+got|my\s+car\s+is|my\s+car|car\s+is|car\s+model\s+is|model\s+is|it'?s|its|model|car)\b\s*(?:a|an|the)?\s*[:\-–]?\s*)+/i, '')
        .replace(/[.!?,;:]+$/, '')
        .replace(/\s+(?:car|gaadi|gadi)$/i, '')
        .trim();
}

/* Optimal string alignment distance — a typo, including two swapped letters ("creat"). */
function typoDistance(a: string, b: string): number {
    const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
    }
    return d[a.length][b.length];
}

interface Match { make: string; model: string; length: number; }

/* Models that are also everyday words: only a car when the answer is the model
   alone, or names the make — "Delhi city" is a place, "Honda City" a car. */
const EVERYDAY_WORDS: Record<string, string> = { city: 'honda', seal: 'byd' };

/* The best known model named in the answer: longest spelling wins, so "Grand i10
   Nios" beats "i10", and "Thar Roxx" beats "Thar". */
function findModel(answer: string): Match | null {
    const whole = squash(answer);
    const words = answer.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    // Single words and neighbouring pairs, for typos: "creat", "hy cross".
    const pieces = [...words, ...words.slice(1).map((w, i) => words[i] + w)];
    let best: Match | null = null;

    for (const [make, models] of Object.entries(MODELS)) {
        for (const spellings of models) {
            for (const spelling of spellings) {
                const key = squash(spelling);
                let hit = false;
                // Short names — C3, X1, City, Polo, Thar — only as a whole word,
                // so "Delhi city" is not a Honda City.
                if (key.length <= 4) hit = words.includes(key) || pieces.includes(key);
                if (hit && EVERYDAY_WORDS[key] && whole !== key && !words.includes(EVERYDAY_WORDS[key])) hit = false;
                else if (whole.includes(key)) hit = true;
                else if (key.length >= 5 && !/\d/.test(key)) {
                    const allowed = key.length >= 7 ? 2 : 1;
                    hit = pieces.some(p => Math.abs(p.length - key.length) <= allowed && typoDistance(p, key) <= allowed);
                }
                if (hit && (!best || key.length > best.length)) best = { make, model: spellings[0], length: key.length };
            }
        }
    }
    return best;
}

function findMake(answer: string): string | null {
    const words = ` ${answer.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
    for (const [make, names] of Object.entries(MAKES)) {
        if (names.some(n => words.includes(` ${n} `))) return make;
    }
    return null;
}

export function readCarAnswer(text: string): CarAnswer {
    const answer = cleanAnswer(text);
    if (!answer) return { ok: false, why: 'empty' };

    const model = findModel(answer);
    if (model) return { ok: true, car: `${model.make} ${model.model}`, known: true };

    const lower = answer.toLowerCase();
    if (!/[a-z]/i.test(answer) || NOT_A_CAR.has(lower)) return { ok: false, why: 'junk' };

    // A place and no car: "West bengal", "Delhi city". (A known model wins
    // above, so "Creta from Delhi" is still a car.)
    if (findState(answer)) return { ok: false, why: 'place' };

    const make = findMake(answer);
    if (make && squash(answer) === squash(MAKES[make].find(n => squash(n) === squash(answer)) ?? '')) {
        return { ok: false, why: 'make-only', make };
    }

    // Not a model we know. Accept it if it could be one — short, a few words —
    // so a new model is never turned away; a long sentence is something else.
    const wordCount = answer.split(/\s+/).length;
    if (answer.length > 40 || wordCount > 5) return { ok: false, why: 'junk' };
    const tidy = answer.replace(/\b[a-z]/g, c => c.toUpperCase());
    return { ok: true, car: make && !tidy.toLowerCase().startsWith(make.toLowerCase().split(' ')[0]) ? `${make} ${tidy}` : tidy, known: false };
}
