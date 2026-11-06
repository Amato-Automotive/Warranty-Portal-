import { isValidElement, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/** Puts text on the clipboard; falls back to a hidden textarea where the clipboard API is blocked. */
export async function copyText(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        try {
            const t = document.createElement("textarea");
            t.value = text;
            t.style.position = "fixed";
            t.style.opacity = "0";
            document.body.appendChild(t);
            t.select();
            const done = document.execCommand("copy");
            document.body.removeChild(t);
            return done;
        } catch {
            return false;
        }
    }
}

/** The plain text of something a screen shows, so a field made of tags and icons can be copied. */
export function nodeText(node: ReactNode): string {
    if (node === null || node === undefined || typeof node === "boolean") return "";
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(nodeText).join("");
    if (isValidElement(node)) return nodeText((node.props as { children?: ReactNode }).children);
    return "";
}

const blank = (t: string) => !t.trim() || t.trim() === "—";

/**
 * A small copy icon. Give it the `text` to copy, or `getText` to read it when
 * clicked (from the cell or row it sits in). It never opens the row beneath it.
 */
export const CopyBtn = ({ text, getText, title = "Copy", className }: {
    text?: string; getText?: (button: HTMLElement) => string; title?: string; className?: string;
}) => {
    const [done, setDone] = useState(false);
    return (
        <button type="button" title={title} aria-label={title} onClick={async e => {
            e.stopPropagation();
            const value = (getText ? getText(e.currentTarget) : text ?? "").trim();
            if (blank(value)) return;
            if (await copyText(value)) { setDone(true); setTimeout(() => setDone(false), 1400); }
        }}
            className={cn("inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-orange-700", done && "text-emerald-600", className)}>
            {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
    );
};

/** A table cell that shows a copy icon for its own text when hovered. */
export const CopyTd = ({ className, children }: { className?: string; children: ReactNode }) => (
    <td className={cn(className, "group relative pr-7")}>
        {children}
        <CopyBtn title="Copy" className="absolute right-0.5 top-1/2 -translate-y-1/2 opacity-0 focus:opacity-100 group-hover:opacity-100"
            getText={b => (b.closest("td")?.innerText ?? "").replace(/\s+/g, " ")} />
    </td>
);

const rowCells = (tr: HTMLTableRowElement) =>
    Array.from(tr.cells).slice(1).map(c => c.innerText.replace(/\s+/g, " ").trim().replace(/^—$/, ""));

/** One sheet row as tab-separated cells, which pastes into Excel as a row. */
export const rowText = (b: HTMLElement) => { const tr = b.closest("tr"); return tr ? rowCells(tr).join("\t") : ""; };

/** The whole sheet, header first, tab-separated. */
export const sheetText = (b: HTMLElement) => {
    const table = b.closest("table");
    return table ? Array.from(table.rows).map(rowCells).map(r => r.join("\t")).join("\n") : "";
};
