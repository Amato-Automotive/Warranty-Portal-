import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import api, { getErrorMessage } from "@/lib/api";
import { QuestionCard, isEmpty } from "./FeedbackModule";
import type { FranchiseForm } from "@/lib/franchiseForms";

export default function FranchiseFormsModule() {
    const { toast } = useToast();
    const [forms, setForms] = useState<FranchiseForm[]>([]);
    const [selected, setSelected] = useState<FranchiseForm | null>(null);
    const [values, setValues] = useState<Record<string, any>>({});
    const [files, setFiles] = useState<Record<string, File[]>>({});
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = async () => {
        setLoading(true); setError(null);
        try { const r = await api.get("/franchise-forms"); setForms(r.data.data || []); }
        catch (e) { setError(getErrorMessage(e, "Could not load forms")); }
        finally { setLoading(false); }
    };
    useEffect(() => { load(); }, []);
    const open = (f: FranchiseForm) => { setSelected(f); setValues({}); setFiles({}); };
    const submit = async () => {
        if (!selected) return;
        const missing = selected.questions.find(q => q.required && isEmpty(q, values[q.id], files[q.id] ?? []));
        if (missing) { toast({ title: "Please answer all required questions", description: missing.label, variant: "destructive" }); return; }
        setSending(true);
        try {
            const fd = new FormData(); fd.append("answers", JSON.stringify(values));
            Object.entries(files).forEach(([qid, fs]) => fs.forEach(file => fd.append(`q_${qid}`, file)));
            await api.post(`/franchise-forms/${selected.id}`, fd, { headers: { "Content-Type": "multipart/form-data" } });
            toast({ title: "Response submitted", description: "Thank you for completing the form." });
            await load();
            setSelected({ ...selected, submitted: true, response: { answers: [], submitted_at: new Date().toISOString() } } as FranchiseForm);
        } catch (e) { toast({ title: "Could not submit", description: getErrorMessage(e, "Try again"), variant: "destructive" }); }
        finally { setSending(false); }
    };
    if (loading) return <div className="flex justify-center p-12"><Loader2 className="h-7 w-7 animate-spin text-brand-orange" /></div>;
    if (error) return <div className="rounded-2xl border bg-white p-10 text-center text-sm text-slate-500">{error} <Button variant="link" onClick={load}>Try again</Button></div>;
    if (!selected) return <div className="space-y-5"><div><p className="text-xs font-bold uppercase tracking-widest text-orange-600">Targeted forms</p><h2 className="text-2xl font-black text-slate-900">Franchise Forms</h2><p className="mt-1 text-sm text-slate-500">Complete forms shared with your franchise.</p></div>{!forms.length ? <div className="rounded-2xl border border-dashed bg-white p-12 text-center text-sm text-slate-500">No forms are available right now.</div> : <div className="grid gap-4 sm:grid-cols-2">{forms.map(f => <button key={f.id} onClick={() => open(f)} className="overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">{f.banner_url ? <img src={f.banner_url} alt="" className="h-32 w-full object-cover" /> : <div className="h-4 bg-gradient-to-r from-orange-500 to-amber-400" />}<div className="p-4"><div className="flex items-start justify-between gap-2"><h3 className="font-black text-slate-900">{f.title}</h3>{f.submitted && <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />}</div><p className="mt-1 line-clamp-2 text-sm text-slate-500">{f.intro || "A form is waiting for your response."}</p><p className="mt-3 text-xs font-semibold text-orange-600">{f.submitted ? "Submitted" : `${f.questions.length} questions · Open form`}</p></div></button>)}</div>}</div>;
    if (selected.submitted) return <div className="space-y-5"><Button variant="ghost" onClick={() => setSelected(null)}><ArrowLeft className="mr-1.5 h-4 w-4" />All forms</Button><div className="rounded-2xl border bg-white p-10 text-center"><CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" /><h2 className="mt-3 text-xl font-black">Response submitted</h2><p className="mt-1 text-sm text-slate-500">Your response for “{selected.title}” has been recorded.</p></div></div>;
    return <div className="space-y-5"><Button variant="ghost" onClick={() => setSelected(null)}><ArrowLeft className="mr-1.5 h-4 w-4" />All forms</Button>{selected.banner_url ? <div className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-50"><img src={selected.banner_url} alt="" className="block max-h-[32rem] w-full object-contain" /></div> : null}<div className="rounded-3xl bg-gradient-to-br from-orange-500 to-amber-400 p-5 text-white"><h2 className="text-2xl font-black">{selected.title}</h2>{selected.intro && <p className="mt-1 whitespace-pre-line text-sm text-white/90">{selected.intro}</p>}</div><div className="space-y-3">{selected.questions.map((q, i) => <QuestionCard key={q.id} q={q} n={i + 1} value={values[q.id]} files={files[q.id] ?? []} onChange={v => setValues(x => ({ ...x, [q.id]: v }))} onFiles={v => setFiles(x => ({ ...x, [q.id]: v }))} />)}</div><Button className="w-full sm:w-auto" disabled={sending} onClick={submit}>{sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Submit response</Button></div>;
}
