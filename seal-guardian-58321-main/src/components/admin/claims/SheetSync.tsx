import { useEffect, useState } from "react";
import api, { getErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Copy, Loader2, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Claims › Sheet sync: the plant's production sheets the portal reads every
 * 10 minutes (add, edit, switch off, remove, check, sync now), and who besides
 * the plant sees the claims they bring in.
 */

interface Report {
    at: string; applied: boolean; error?: string;
    rows: number; claims: number; added: number; updated: number; unchanged: number; store_found: number; skipped: string[];
}
interface Source { id: string; name: string; url: string; tab: string; active: boolean; last_sync_at: string | null; last_result: Report | null }
interface Seen { store: boolean; distributor: boolean }
type Draft = { id?: string; name: string; url: string; tab: string; active: boolean };

const when = (s: string | null) => (s ? new Date(s).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : null);

function ReportLine({ r }: { r: Report }) {
    if (r.error) return <p className="text-sm font-semibold text-rose-700">{r.error}</p>;
    return (
        <p className="text-sm text-gray-700">
            {r.rows} rows · <b>{r.added}</b> {r.applied ? "added" : "new"} · <b>{r.updated}</b> {r.applied ? "updated" : "changed"} · {r.unchanged} unchanged
            {r.skipped.length > 0 && <> · {r.skipped.length} left out</>} · store found for {r.store_found} of {r.claims}
        </p>
    );
}

export function SheetSync() {
    const { toast } = useToast();
    const [sources, setSources] = useState<Source[] | null>(null);
    const [seen, setSeen] = useState<Seen | null>(null);
    const [account, setAccount] = useState<string | null>(null);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [removing, setRemoving] = useState<Source | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [checked, setChecked] = useState<Record<string, Report>>({});

    const load = () => api.get("/claims/admin/sheets").then(r => {
        setSources(r.data.sources); setSeen(r.data.seen); setAccount(r.data.service_account);
    }).catch(e => toast({ variant: "destructive", title: "Could not load", description: getErrorMessage(e, "") }));
    useEffect(() => { load(); }, []);

    const save = async () => {
        if (!draft) return;
        setBusy("save");
        try {
            const body = { name: draft.name, url: draft.url, tab: draft.tab, active: draft.active };
            if (draft.id) await api.put(`/claims/admin/sheets/${draft.id}`, body); else await api.post("/claims/admin/sheets", body);
            toast({ title: draft.id ? "Saved" : "Sheet added", description: draft.id ? undefined : "Press Check to see what it would bring in." });
            setDraft(null); load();
        } catch (e) {
            toast({ variant: "destructive", title: "Not saved", description: getErrorMessage(e, "Try again") });
        } finally { setBusy(null); }
    };
    const sync = async (s: Source, apply: boolean) => {
        setBusy(`${apply ? "sync" : "check"}:${s.id}`);
        try {
            const r = await api.post(`/claims/admin/sheets/${s.id}/sync`, { apply });
            setChecked(c => ({ ...c, [s.id]: r.data.report }));
            if (apply) { toast({ title: "Synced", description: `${r.data.report.added} added, ${r.data.report.updated} updated` }); load(); }
        } catch (e: any) {
            const report = e?.response?.data?.report;
            if (report) setChecked(c => ({ ...c, [s.id]: report }));
            toast({ variant: "destructive", title: "Could not read the sheet", description: getErrorMessage(e, "") });
        } finally { setBusy(null); }
    };
    const toggle = async (s: Source, active: boolean) => {
        try { await api.put(`/claims/admin/sheets/${s.id}`, { active }); load(); }
        catch (e) { toast({ variant: "destructive", title: "Not changed", description: getErrorMessage(e, "") }); }
    };
    const remove = async () => {
        if (!removing) return;
        setBusy("remove");
        try { await api.delete(`/claims/admin/sheets/${removing.id}`); toast({ title: "Sheet removed", description: "Its claims stay in the portal." }); setRemoving(null); load(); }
        catch (e) { toast({ variant: "destructive", title: "Not removed", description: getErrorMessage(e, "") }); }
        finally { setBusy(null); }
    };
    const setSeenTo = async (k: keyof Seen, v: boolean) => {
        try { const r = await api.put("/claims/admin/sheets/seen", { [k]: v }); setSeen(r.data.seen); }
        catch (e) { toast({ variant: "destructive", title: "Not changed", description: getErrorMessage(e, "") }); }
    };

    if (!sources || !seen) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-orange-600" /></div>;

    return (
        <div className="space-y-5">
            {account && (
                <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-gray-200 bg-white p-4 text-sm">
                    <span className="text-gray-600">Share each sheet as a Viewer with</span>
                    <code className="rounded-md bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-900">{account}</code>
                    <Button variant="ghost" size="sm" className="h-9" onClick={() => { navigator.clipboard?.writeText(account); toast({ title: "Copied" }); }}><Copy className="h-4 w-4 mr-1" />Copy</Button>
                </div>
            )}

            <section className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                    <h2 className="text-lg font-extrabold text-gray-900">Sheets</h2>
                    <Button className="h-11 bg-orange-600 font-bold hover:bg-orange-700" onClick={() => setDraft({ name: "", url: "", tab: "ALTERATION", active: true })}><Plus className="h-4 w-4 mr-1.5" />Add a sheet</Button>
                </div>
                {!sources.length && <p className="rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">No sheet yet.</p>}
                {sources.map(s => {
                    const r = checked[s.id] ?? s.last_result;
                    return (
                        <div key={s.id} className={cn("space-y-3 rounded-2xl border bg-white p-4", s.active ? "border-gray-200" : "border-dashed border-gray-300 opacity-80")}>
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="font-bold text-gray-900">{s.name}</p>
                                    <p className="truncate text-xs text-gray-500">Tab "{s.tab}" · <a href={s.url} target="_blank" rel="noreferrer" className="underline">open the sheet</a></p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <label className="flex h-10 items-center gap-2 rounded-xl border border-gray-300 px-3 text-sm font-semibold">
                                        <Switch checked={s.active} onCheckedChange={v => toggle(s, v)} aria-label={`Sync ${s.name}`} />{s.active ? "On" : "Off"}
                                    </label>
                                    <Button variant="outline" className="h-10" disabled={busy !== null} onClick={() => sync(s, false)}>
                                        {busy === `check:${s.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4 mr-1" />}Check
                                    </Button>
                                    <Button variant="outline" className="h-10" disabled={busy !== null} onClick={() => sync(s, true)}>
                                        {busy === `sync:${s.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}Sync now
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-10 w-10" aria-label={`Edit ${s.name}`} onClick={() => setDraft({ ...s })}><Pencil className="h-4 w-4" /></Button>
                                    <Button variant="ghost" size="icon" className="h-10 w-10 text-rose-600" aria-label={`Remove ${s.name}`} onClick={() => setRemoving(s)}><Trash2 className="h-4 w-4" /></Button>
                                </div>
                            </div>
                            {r && (
                                <div className="rounded-xl bg-gray-50 px-3 py-2">
                                    <p className="text-xs font-bold text-gray-500">{r.applied ? `Last sync ${when(r.at)}` : `Check ${when(r.at)}: nothing written`}</p>
                                    <ReportLine r={r} />
                                    {r.skipped.length > 0 && (
                                        <details className="mt-1 text-xs text-gray-600"><summary className="cursor-pointer font-semibold">Rows left out</summary>
                                            <ul className="mt-1 list-disc pl-5">{r.skipped.map(x => <li key={x}>{x}</li>)}</ul></details>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </section>

            <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
                <h2 className="text-lg font-extrabold text-gray-900">Who sees sheet claims</h2>
                <p className="text-sm text-gray-500">The plant always does. These only view them; changes are made in the sheet.</p>
                {([["store", "The store on the claim"], ["distributor", "The store's distributors"]] as [keyof Seen, string][]).map(([k, label]) => (
                    <label key={k} className="flex min-h-[48px] items-center justify-between gap-3 border-t border-gray-100 pt-2 text-sm font-semibold text-gray-800">
                        {label}<Switch checked={seen[k]} onCheckedChange={v => setSeenTo(k, v)} aria-label={label} />
                    </label>
                ))}
            </section>

            <Dialog open={!!draft} onOpenChange={o => { if (!o && busy !== "save") setDraft(null); }}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{draft?.id ? "Edit sheet" : "Add a sheet"}</DialogTitle>
                        <DialogDescription>The portal reads it every 10 minutes while it is on.</DialogDescription>
                    </DialogHeader>
                    {draft && (
                        <div className="space-y-3">
                            <label className="block space-y-1"><span className="text-sm font-semibold">Name</span>
                                <Input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} maxLength={120} className="h-11" /></label>
                            <label className="block space-y-1"><span className="text-sm font-semibold">Google Sheet link</span>
                                <Input value={draft.url} onChange={e => setDraft({ ...draft, url: e.target.value })} className="h-11" /></label>
                            <label className="block space-y-1"><span className="text-sm font-semibold">Tab</span>
                                <Input value={draft.tab} onChange={e => setDraft({ ...draft, tab: e.target.value })} maxLength={120} className="h-11" /></label>
                        </div>
                    )}
                    <DialogFooter className="gap-2">
                        <Button variant="outline" className="h-11" onClick={() => setDraft(null)} disabled={busy === "save"}>Cancel</Button>
                        <Button className="h-11 bg-orange-600 font-bold hover:bg-orange-700" onClick={save} disabled={busy === "save"}>
                            {busy === "save" && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}{draft?.id ? "Save" : "Add"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={!!removing} onOpenChange={o => { if (!o && busy !== "remove") setRemoving(null); }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Remove "{removing?.name}"?</DialogTitle>
                        <DialogDescription>The portal stops reading it. The claims it brought in stay.</DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2">
                        <Button variant="outline" className="h-11" onClick={() => setRemoving(null)} disabled={busy === "remove"}>Cancel</Button>
                        <Button variant="destructive" className="h-11 font-bold" onClick={remove} disabled={busy === "remove"}>
                            {busy === "remove" && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Remove
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
