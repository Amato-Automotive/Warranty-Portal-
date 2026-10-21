import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Loader2, Paperclip, Send, Truck, X } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import api, { getErrorMessage } from "@/lib/api";
import { cn, formatToIST } from "@/lib/utils";
import {
    STATUS_LABEL, HISTORY_TEXT, progressOf, isDone,
    type Brand, type HistoryEntry, type PosmCatalog, type PosmLine, type Usage,
} from "@/lib/posm";
import { POSMLines, POSMTracker } from "@/components/posm/POSMLines";
import { POSMShop, requestForm } from "@/components/posm/POSMShop";

interface POSMRequest {
    id: number;
    ticket_id: string;
    requirement: string;
    created_by_role?: 'franchise' | 'admin' | 'asm';
    created_by_name?: string | null;
    status: string;
    created_at: string;
    updated_at: string;
    /* A request made of items; null on the older free-text ones. */
    items?: PosmLine[] | null;
    dispatch?: { courier?: string; tracking?: string; date?: string | null } | null;
    delivery?: { by?: string; at?: string; photos?: string[] } | null;
    history?: HistoryEntry[] | null;
}

interface Message {
    id: number;
    sender_role: 'admin' | 'franchise' | 'asm';
    /** Who wrote it; shown for an ASM's message. */
    sender_name?: string | null;
    message: string | null;
    attachments: string[] | null;
    created_at: string;
}

const STATUS_TONE: Record<string, string> = {
    open: "bg-blue-50 text-blue-700 border-blue-100", under_review: "bg-purple-50 text-purple-700 border-purple-100",
    approved: "bg-emerald-50 text-emerald-700 border-emerald-100", in_production: "bg-amber-50 text-amber-700 border-amber-100",
    pending: "bg-amber-50 text-amber-700 border-amber-100", dispatched: "bg-orange-50 text-orange-700 border-orange-100",
    delivered: "bg-emerald-50 text-emerald-700 border-emerald-100", closed: "bg-gray-100 text-gray-600 border-gray-200",
    rejected: "bg-red-50 text-red-700 border-red-100",
};
const StatusPill = ({ status }: { status: string }) => (
    <Badge variant="outline" className={cn("text-[10px] uppercase font-bold", STATUS_TONE[status] || "bg-gray-100 text-gray-600")}>
        {STATUS_LABEL[status] ?? status.replace('_', ' ')}
    </Badge>
);

const dmy = (d?: string | null) => (d ? d.split('-').reverse().join('/') : '');

const POSMModule: React.FC = () => {
    const { toast } = useToast();
    const [view, setView] = useState<'order' | 'mine'>('order');

    // Ordering
    const [catalog, setCatalog] = useState<PosmCatalog | null>(null);
    const [brands, setBrands] = useState<Brand[]>(['AF']);
    const [usage, setUsage] = useState<Usage>({});
    const [catalogError, setCatalogError] = useState<string | null>(null);

    // My requests
    const [requests, setRequests] = useState<POSMRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [listTab, setListTab] = useState<'active' | 'done'>('active');
    const [selected, setSelected] = useState<POSMRequest | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [reply, setReply] = useState('');
    const [replyFiles, setReplyFiles] = useState<File[]>([]);
    const [sendingReply, setSendingReply] = useState(false);
    const [deliveryOpen, setDeliveryOpen] = useState(false);
    const [deliveryPhotos, setDeliveryPhotos] = useState<File[]>([]);
    const [confirming, setConfirming] = useState(false);

    const loadCatalog = () => {
        setCatalogError(null);
        api.get('/posm/catalog')
            .then(r => {
                setCatalog(r.data.data.catalog);
                setBrands(r.data.data.brands?.length ? r.data.data.brands : ['AF']);
                setUsage(r.data.data.usage || {});
            })
            .catch(e => setCatalogError(getErrorMessage(e, 'Could not load the POSM items')));
    };

    const fetchRequests = async () => {
        try {
            setLoading(true);
            const response = await api.get('/posm');
            if (response.data.success) setRequests(response.data.data);
        } catch (error) {
            toast({ variant: "destructive", title: "Error", description: "Failed to load POSM requests" });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadCatalog(); fetchRequests(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const fetchTicketDetails = async (id: number) => {
        try {
            setLoadingMessages(true);
            const response = await api.get(`/posm/${id}`);
            if (response.data.success) {
                const { messages: msgs, ...ticket } = response.data.data;
                setMessages(msgs || []);
                setSelected(prev => prev && prev.id === id ? { ...prev, ...ticket } : prev);
            }
        } catch (error) {
            console.error('Error fetching ticket details:', error);
        } finally {
            setLoadingMessages(false);
        }
    };

    const send = async (lines: Parameters<typeof requestForm>[0], note: string) => {
        try {
            const r = await api.post('/posm/items', requestForm(lines, note), { headers: { 'Content-Type': 'multipart/form-data' } });
            toast({ title: `Request sent · ${r.data?.data?.ticketId ?? ''}`.trim(), description: 'Follow it under My requests.' });
            loadCatalog();
            await fetchRequests();
            setView('mine'); setListTab('active');
            return true;
        } catch (e) {
            toast({ variant: "destructive", title: "Request not sent", description: getErrorMessage(e, "Try again in a moment.") });
            return false;
        }
    };

    /* ---------- a request ---------- */
    const open = (r: POSMRequest) => { setSelected(r); setDeliveryOpen(false); setDeliveryPhotos([]); fetchTicketDetails(r.id); };

    const sendReply = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selected || (!reply.trim() && !replyFiles.length)) return;
        try {
            setSendingReply(true);
            const formData = new FormData();
            formData.append('message', reply.trim());
            replyFiles.forEach(f => formData.append('attachments', f));
            await api.post(`/posm/${selected.id}/messages`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
            setReply(''); setReplyFiles([]);
            fetchTicketDetails(selected.id);
        } catch (error) {
            toast({ variant: "destructive", title: "Message not sent", description: getErrorMessage(error, "Try again in a moment.") });
        } finally {
            setSendingReply(false);
        }
    };

    const confirmDelivery = async () => {
        if (!selected) return;
        try {
            setConfirming(true);
            const formData = new FormData();
            deliveryPhotos.forEach(f => formData.append('photos', f));
            await api.post(`/posm/${selected.id}/delivered`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
            toast({ title: "Thanks, marked as received" });
            setDeliveryOpen(false); setDeliveryPhotos([]);
            setSelected(prev => prev ? { ...prev, status: 'delivered' } : prev);
            fetchRequests();
            fetchTicketDetails(selected.id);
        } catch (error) {
            toast({ variant: "destructive", title: "Could not confirm", description: getErrorMessage(error, "Try again in a moment.") });
        } finally {
            setConfirming(false);
        }
    };

    /* Each step and each message, in time order. An older request has no
       steps saved; it starts on the day it was sent. */
    const feed = useMemo(() => {
        if (!selected) return [];
        const steps = (selected.history?.length ? selected.history
            : [{ action: 'sent', status: 'open', at: selected.created_at, by_role: selected.created_by_role ?? 'franchise' } as HistoryEntry])
            .map(h => ({ at: h.at, h, m: null as Message | null }));
        return [...steps, ...messages.map(m => ({ at: m.created_at, h: null as HistoryEntry | null, m }))]
            .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    }, [selected, messages]);

    const active = requests.filter(r => !isDone(r.status));
    const done = requests.filter(r => isDone(r.status));
    const shown = listTab === 'active' ? active : done;

    return (
        <div className="space-y-4 mb-6">
            {/* Order / My requests */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="inline-flex rounded-xl border border-gray-100 bg-white p-1 shadow-sm">
                    {([['order', 'Order POSM'], ['mine', `My requests${active.length ? ` (${active.length})` : ''}`]] as const).map(([v, label]) => (
                        <button key={v} type="button" onClick={() => { setView(v); if (v === 'mine') setSelected(null); }}
                            className={cn("px-4 py-2 rounded-lg text-sm font-bold transition-colors",
                                view === v ? "bg-gray-900 text-white" : "text-gray-500 hover:text-gray-800")}>
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            {view === 'order' ? (
                !catalog ? (
                    <div className="rounded-2xl border border-gray-100 bg-white p-10 text-center text-sm text-gray-500">
                        {catalogError ? <>{catalogError} <Button variant="link" onClick={loadCatalog}>Try again</Button></> : <Loader2 className="h-6 w-6 animate-spin text-brand-orange mx-auto" />}
                    </div>
                ) : (
                    <POSMShop items={catalog.items} brands={brands} usage={usage} onSend={send} />
                )
            ) : (
                <div className="grid md:grid-cols-[minmax(0,340px)_minmax(0,1fr)] gap-4 items-start">
                    {/* The list */}
                    <div className={cn("rounded-2xl border border-gray-100 bg-white overflow-hidden", selected && "hidden md:block")}>
                        <div className="p-3 flex gap-1 border-b border-gray-100">
                            {([['active', `Active (${active.length})`], ['done', `Done (${done.length})`]] as const).map(([t, label]) => (
                                <button key={t} type="button" onClick={() => setListTab(t)}
                                    className={cn("flex-1 rounded-lg py-1.5 text-xs font-bold", listTab === t ? "bg-orange-50 text-orange-700" : "text-gray-500 hover:bg-gray-50")}>
                                    {label}
                                </button>
                            ))}
                        </div>
                        {loading ? (
                            <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-brand-orange" /></div>
                        ) : shown.length === 0 ? (
                            <div className="p-8 text-center">
                                <p className="text-gray-500 text-sm">{listTab === 'active' ? 'No requests in progress.' : 'Nothing finished yet.'}</p>
                                <Button variant="link" onClick={() => setView('order')} className="text-brand-orange">Order POSM</Button>
                            </div>
                        ) : (
                            <div className="divide-y divide-gray-50 max-h-[70vh] overflow-y-auto">
                                {shown.map(r => (
                                    <button key={r.id} type="button" onClick={() => open(r)}
                                        className={cn("w-full text-left p-4 space-y-1.5 hover:bg-gray-50/80", selected?.id === r.id && "bg-orange-50/70")}>
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-xs font-mono text-gray-400">{r.ticket_id}</span>
                                            <StatusPill status={r.status} />
                                        </div>
                                        <p className="text-sm font-semibold text-gray-800 line-clamp-2">
                                            {r.items?.length ? r.items.map(l => `${l.item_name} ×${l.approved_qty ?? l.qty}`).join(', ') : r.requirement}
                                        </p>
                                        {r.status !== 'rejected' && (
                                            <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                                                <div className="h-full rounded-full bg-orange-500" style={{ width: `${Math.round(progressOf(r.status) * 100)}%` }} />
                                            </div>
                                        )}
                                        <p className="text-[11px] text-gray-400">
                                            Sent {formatToIST(r.created_at)}
                                            {r.status === 'dispatched' && r.dispatch?.courier ? ` · ${r.dispatch.courier}${r.dispatch.tracking ? ` ${r.dispatch.tracking}` : ''}` : ''}
                                            {r.created_by_role === 'admin' ? ' · added by Autoform' : r.created_by_role === 'asm' ? ` · raised by ${r.created_by_name || 'your ASM'} (your ASM)` : ''}
                                        </p>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* One request */}
                    {selected ? (
                        <div className="rounded-2xl border border-gray-100 bg-white p-4 sm:p-5 space-y-5 min-w-0">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="flex items-start gap-2 min-w-0">
                                    <Button variant="ghost" size="icon" className="md:hidden h-8 w-8 -ml-1" onClick={() => setSelected(null)} aria-label="Back to the list">
                                        <ChevronLeft className="h-5 w-5" />
                                    </Button>
                                    <div className="min-w-0">
                                        <p className="text-xs font-mono text-gray-400">{selected.ticket_id} · sent {formatToIST(selected.created_at)}</p>
                                        <h2 className="text-lg font-bold text-gray-800">
                                            {selected.status === 'dispatched' ? 'On its way' : selected.status === 'delivered' ? 'Delivered' : selected.status === 'rejected' ? 'Not approved' : STATUS_LABEL[selected.status] ?? 'Request'}
                                        </h2>
                                        {selected.created_by_role === 'admin' && (
                                            <p className="text-[11px] font-medium text-purple-600">Raised on your behalf by {selected.created_by_name || 'the Autoform team'}</p>
                                        )}
                                        {selected.created_by_role === 'asm' && (
                                            <p className="text-[11px] font-medium text-sky-700">Raised for you by {selected.created_by_name || 'your ASM'} (your ASM)</p>
                                        )}
                                    </div>
                                </div>
                                {selected.status === 'dispatched' && !deliveryOpen && (
                                    <Button onClick={() => setDeliveryOpen(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl">I received it</Button>
                                )}
                            </div>

                            {selected.items?.length ? <POSMTracker status={selected.status} /> : <StatusPill status={selected.status} />}

                            {deliveryOpen && (
                                <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 space-y-2">
                                    <p className="text-sm font-bold text-emerald-800">Confirm you received the items</p>
                                    <input id="posm-delivery-photos" type="file" accept="image/*" multiple className="hidden"
                                        onChange={e => { const fl = e.target.files; if (fl) setDeliveryPhotos(p => [...p, ...Array.from(fl)].slice(0, 5)); e.target.value = ''; }} />
                                    <label htmlFor="posm-delivery-photos" className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-emerald-200 bg-white p-3 text-xs text-emerald-700 cursor-pointer">
                                        <Paperclip className="h-4 w-4" /> Add photos of what arrived (optional, up to 5)
                                    </label>
                                    {deliveryPhotos.length > 0 && <p className="text-[11px] text-emerald-700">{deliveryPhotos.length} photo{deliveryPhotos.length === 1 ? '' : 's'} added</p>}
                                    <div className="flex justify-end gap-2">
                                        <Button variant="ghost" size="sm" onClick={() => { setDeliveryOpen(false); setDeliveryPhotos([]); }}>Cancel</Button>
                                        <Button size="sm" onClick={confirmDelivery} disabled={confirming} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                                            {confirming && <Loader2 className="h-4 w-4 animate-spin mr-1" />} Yes, received
                                        </Button>
                                    </div>
                                </div>
                            )}

                            {selected.dispatch?.courier && (
                                <div className="rounded-xl bg-gray-50 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <Truck className="h-5 w-5 text-orange-500 shrink-0" />
                                        <div className="min-w-0">
                                            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Shipment</p>
                                            <p className="font-bold text-gray-800 break-words">{selected.dispatch.courier}{selected.dispatch.tracking ? ` · ${selected.dispatch.tracking}` : ''}</p>
                                        </div>
                                    </div>
                                    {selected.dispatch.date && <span className="text-xs text-gray-500">Dispatched {dmy(selected.dispatch.date)}</span>}
                                </div>
                            )}

                            <div className="space-y-2">
                                <h3 className="text-sm font-bold text-gray-800">Items</h3>
                                {selected.items?.length
                                    ? <POSMLines lines={selected.items} items={catalog?.items} />
                                    : <p className="text-sm text-gray-600 whitespace-pre-wrap rounded-xl bg-gray-50 p-3">{selected.requirement}</p>}
                            </div>

                            <div className="space-y-2">
                                <h3 className="text-sm font-bold text-gray-800">Updates & messages</h3>
                                <div className="space-y-2 max-h-[45vh] overflow-y-auto pr-1">
                                    {loadingMessages ? (
                                        <div className="flex justify-center p-4"><Loader2 className="h-5 w-5 animate-spin text-brand-orange" /></div>
                                    ) : feed.map((f, k) => f.h ? (
                                        <p key={`s${k}`} className="text-center text-[11px] font-semibold text-gray-400">
                                            {formatToIST(f.h.at)} · {f.h.action === 'sent'
                                                ? (f.h.by_role === 'admin' ? 'Raised for you by Autoform'
                                                    : f.h.by_role === 'asm' ? `Raised for you by ${f.h.by_name || 'your ASM'} (your ASM)` : 'You sent the request')
                                                : f.h.action === 'received' ? 'You confirmed it arrived' : HISTORY_TEXT[f.h.action] ?? f.h.action}
                                            {f.h.note && f.h.action !== 'sent' && f.h.action !== 'reject' ? ` · ${f.h.note}` : ''}
                                        </p>
                                    ) : f.m && ((msg: Message) => (
                                        <div key={msg.id} className={cn("flex flex-col max-w-[85%]", msg.sender_role === 'franchise' ? "ml-auto items-end" : "mr-auto items-start")}>
                                            <div className={cn("px-3 py-2 rounded-2xl text-sm",
                                                msg.sender_role === 'franchise' ? "bg-brand-orange text-white rounded-br-md"
                                                    : msg.sender_role === 'asm' ? "bg-sky-50 text-gray-800 rounded-bl-md" : "bg-gray-100 text-gray-800 rounded-bl-md")}>
                                                {msg.message && <p className="whitespace-pre-wrap">{msg.message}</p>}
                                                {msg.attachments?.length ? (
                                                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                                                        {msg.attachments.map((url, i) => (
                                                            <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                                                                className={cn("inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold",
                                                                    msg.sender_role === 'franchise' ? "bg-white/20 text-white" : "bg-white text-gray-600")}>
                                                                <Paperclip className="h-3 w-3" /> File {i + 1}
                                                            </a>
                                                        ))}
                                                    </div>
                                                ) : null}
                                            </div>
                                            <span className="text-[10px] text-gray-400 mt-0.5">{msg.sender_role === 'franchise' ? 'You' : msg.sender_role === 'asm' ? `${msg.sender_name || 'Your ASM'} (your ASM)` : 'Autoform team'} · {formatToIST(msg.created_at)}</span>
                                        </div>
                                    ))(f.m))}
                                </div>
                                <form onSubmit={sendReply} className="space-y-2 pt-1">
                                    {replyFiles.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5">
                                            {replyFiles.map((f, i) => (
                                                <Badge key={i} variant="secondary" className="pr-1 gap-1 bg-orange-50 text-orange-700 border-orange-100">
                                                    <span className="truncate max-w-[140px]">{f.name}</span>
                                                    <X className="h-3 w-3 cursor-pointer" onClick={() => setReplyFiles(p => p.filter((_, j) => j !== i))} />
                                                </Badge>
                                            ))}
                                        </div>
                                    )}
                                    <div className="flex items-center gap-2">
                                        <input id="posm-reply-file" type="file" multiple className="hidden"
                                            onChange={e => { const fl = e.target.files; if (fl) setReplyFiles(p => [...p, ...Array.from(fl)].slice(0, 5)); e.target.value = ''; }} />
                                        <label htmlFor="posm-reply-file" className="p-2 text-gray-400 hover:text-brand-orange cursor-pointer" aria-label="Attach a file">
                                            <Paperclip className="h-5 w-5" />
                                        </label>
                                        <Input value={reply} onChange={e => setReply(e.target.value)} placeholder="Write a message…" className="rounded-xl" aria-label="Message" />
                                        <Button type="submit" size="icon" disabled={sendingReply || (!reply.trim() && !replyFiles.length)} className="bg-brand-orange hover:bg-brand-orange/90 text-white rounded-xl shrink-0" aria-label="Send">
                                            {sendingReply ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                        </Button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    ) : (
                        <div className="hidden md:grid rounded-2xl border border-dashed border-gray-200 bg-white/60 p-10 place-items-center text-center text-sm text-gray-400">
                            Pick a request to see its items, progress and messages.
                        </div>
                    )}
                </div>
            )}

        </div>
    );
};

export default POSMModule;
