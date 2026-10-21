import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { HI } from "@/lib/hindi";

/**
 * English or Hindi for the franchise side, chosen once in the top bar and
 * used on every page. Each browser remembers its own choice.
 *
 * Text is written in English as usual and wrapped in t("…"); in Hindi it is
 * looked up in lib/hindi.ts and falls back to the English when a line has no
 * translation yet, so nothing ever shows blank.
 */

export type Lang = "en" | "hi";

interface LanguageValue {
    lang: Lang;
    setLang: (l: Lang) => void;
    /** The Hindi of an English line (or the English itself). */
    t: (en: string) => string;
    /** For lines with numbers or names in them: pick the English or the Hindi. */
    tr: (en: string, hi: string) => string;
    /** For dates and numbers: "en-IN" or "hi-IN". */
    locale: string;
}

const KEY = "franchise_lang";
const OLD_KEY = "franchise_home_lang";

/* Hindi is switched off for now (7 Oct 2026): the switch is hidden and every
   page shows English, whatever a browser chose before. Set to true to bring
   it back, and put <LanguageSwitch /> back in ModuleLayout. */
const HINDI_ENABLED = false;

const readLang = (): Lang => {
    if (!HINDI_ENABLED) return "en";
    try {
        const v = localStorage.getItem(KEY) ?? localStorage.getItem(OLD_KEY);
        return v === "hi" ? "hi" : "en";
    } catch {
        return "en";
    }
};

const LanguageContext = createContext<LanguageValue>({
    lang: "en", setLang: () => undefined, t: s => s, tr: en => en, locale: "en-IN",
});

export function LanguageProvider({ children }: { children: ReactNode }) {
    const [lang, setLangState] = useState<Lang>(readLang);
    const setLang = useCallback((l: Lang) => {
        setLangState(l);
        try { localStorage.setItem(KEY, l); } catch { /* the choice just isn't remembered */ }
    }, []);
    const value = useMemo<LanguageValue>(() => ({
        lang,
        setLang,
        t: (en: string) => (lang === "hi" ? HI[en] ?? en : en),
        tr: (en: string, hi: string) => (lang === "hi" ? hi : en),
        locale: lang === "hi" ? "hi-IN" : "en-IN",
    }), [lang, setLang]);
    return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export const useLanguage = () => useContext(LanguageContext);

/** <Tx>English line</Tx> — the line in the chosen language. */
export function Tx({ children }: { children: string }) {
    return <>{useLanguage().t(children)}</>;
}

/** The small EN / हिं switch in the top bar. */
export function LanguageSwitch({ className }: { className?: string }) {
    const { lang, setLang } = useLanguage();
    return (
        <div className={cn("inline-flex rounded-full border border-slate-200 bg-white p-0.5 text-[11px] font-semibold", className)}
            role="group" aria-label="Language / भाषा">
            {(["en", "hi"] as Lang[]).map(l => (
                <button key={l} type="button" onClick={() => setLang(l)} aria-pressed={lang === l}
                    title={l === "en" ? "English" : "हिंदी"}
                    className={cn("h-7 min-w-[34px] rounded-full px-2 transition-colors",
                        lang === l ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-900")}>
                    {l === "en" ? "EN" : "हिं"}
                </button>
            ))}
        </div>
    );
}
