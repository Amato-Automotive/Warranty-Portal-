
import { useState } from "react";
import { Bell, Check, AlertTriangle, Info, ShieldCheck, Megaphone, Trash2, Video, Download, ExternalLink, PlayCircle, FileVideo, ChevronRight, Flag } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@/components/ui/popover";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNotifications } from "@/contexts/NotificationContext";
import { cn, optimizeCloudinaryUrl } from "@/lib/utils";
import { format } from "date-fns";
import { useIsMobile } from "@/hooks/use-mobile";

const formatTimeAgo = (dateStr: string) => {
    try {
        const date = new Date(dateStr);
        const now = new Date();
        const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

        if (diffInSeconds < 60) return "just now";
        if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}mins`;
        if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}hrs`;
        if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}days`;

        return format(date, 'MMM d');
    } catch (e) {
        return "now";
    }
};

const getIcon = (type: string) => {
    switch (type) {
        case 'product': return <Megaphone className="h-4 w-4 text-purple-600" />;
        case 'warranty': return <ShieldCheck className="h-4 w-4 text-blue-600" />;
        case 'alert': return <AlertTriangle className="h-4 w-4 text-amber-600" />;
        case 'posm': return <Flag className="h-4 w-4 text-orange-600" />;
        case 'system': return <ShieldCheck className="h-4 w-4 text-blue-600" />;
        default: return <Info className="h-4 w-4 text-gray-600" />;
    }
};

const getBgColor = (type: string) => {
    switch (type) {
        case 'product': return "bg-purple-50 text-purple-600 border-purple-100";
        case 'warranty': return "bg-blue-50 text-blue-600 border-blue-100";
        case 'alert': return "bg-amber-50 text-amber-600 border-amber-100";
        case 'posm': return "bg-orange-50 text-orange-600 border-orange-100";
        case 'system': return "bg-slate-50 text-slate-600 border-slate-100";
        default: return "bg-slate-50 text-slate-600 border-slate-100";
    }
};

const NotificationItem = ({ notification, onRead, onSelect }: { notification: any, onRead: (id: number) => void, onSelect: (n: any) => void }) => (
    <div
        className={cn(
            "flex gap-4 p-5 text-left transition-all border-b border-orange-50/30 hover:bg-orange-50/30 relative group cursor-pointer",
            !notification.is_read && "bg-orange-50/10"
        )}
        onClick={() => {
            if (!notification.is_read) onRead(notification.id);
            onSelect(notification);
        }}
    >
        <div className={cn(
            "h-10 w-10 rounded-xl flex items-center justify-center shrink-0 shadow-sm border transition-transform duration-300 group-hover:scale-105",
            getBgColor(notification.type)
        )}>
            {getIcon(notification.type)}
        </div>
        <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1">
                <p className={cn(
                    "text-sm tracking-tight truncate pr-2",
                    notification.is_read ? "font-semibold text-slate-500" : "font-black text-slate-900"
                )}>
                    {notification.title}
                </p>
                <span className="text-[10px] text-slate-400 font-bold whitespace-nowrap">
                    {formatTimeAgo(notification.created_at)}
                </span>
            </div>
            <p className={cn(
                "text-xs leading-relaxed line-clamp-2",
                notification.is_read ? "text-slate-400" : "text-slate-600 font-medium"
            )}>
                {notification.message}
            </p>

            {/* Media Preview in List */}
            {notification.metadata && (
                (Array.isArray(notification.metadata.images) && notification.metadata.images.length > 0) ||
                (Array.isArray(notification.metadata.videos) && notification.metadata.videos.length > 0)
            ) && (
                    <div className="mt-3 flex gap-2 overflow-hidden">
                        {Array.isArray(notification.metadata.images) && notification.metadata.images.slice(0, 3).map((img: string, i: number) => (
                            <div key={i} className="h-12 w-12 rounded-lg border border-slate-200 bg-white p-0.5 flex items-center justify-center overflow-hidden shrink-0 shadow-sm">
                                <img src={optimizeCloudinaryUrl(img, { width: 100 })} className="h-full w-full object-cover rounded-md" alt="" />
                            </div>
                        ))}
                        {Array.isArray(notification.metadata.videos) && notification.metadata.videos.length > 0 && (
                            <div className="h-12 w-20 rounded-lg border border-purple-100 bg-purple-50 flex items-center justify-center shrink-0 shadow-sm">
                                <Video className="h-4 w-4 text-purple-600" />
                            </div>
                        )}
                    </div>
                )}
        </div>

        {!notification.is_read && (
            <div className="absolute right-3 top-3">
                <div className="h-2 w-2 rounded-full bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.5)]" />
            </div>
        )}

        <div className="absolute right-3 bottom-3 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-1 group-hover:translate-y-0">
            <ChevronRight className="h-4 w-4 text-orange-400" />
        </div>
    </div>
);

export const NotificationPopover = ({ onNavigate, onLinkClick }: { onNavigate?: (module: any) => void; onLinkClick?: (link: string) => boolean }) => {
    const {
        notifications,
        unreadCount,
        markAsRead,
        markAllAsRead,
        clearAllNotifications
    } = useNotifications();
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const isMobile = useIsMobile();
    const [selectedNotification, setSelectedNotification] = useState<any>(null);

    const unreadNotifications = notifications.filter(n => !n.is_read);

    const NotificationListContent = () => (
        <Tabs defaultValue="all" className="w-full h-full flex flex-col">
            <div className={cn("flex items-center justify-between px-6 py-5 border-b border-orange-50/50 shrink-0", isMobile && "pr-14")}>
                <div className="flex flex-col">
                    <h3 className="font-black text-base text-slate-800 uppercase tracking-tight">Activity Center</h3>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Updates & Notices</p>
                </div>
                <div className="flex items-center gap-1.5">
                    {unreadCount > 0 && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 text-[9px] font-black uppercase tracking-widest text-orange-600 hover:bg-orange-50 px-2.5 rounded-lg border border-transparent hover:border-orange-100 transition-all"
                            onClick={(e) => {
                                e.stopPropagation();
                                markAllAsRead();
                            }}
                        >
                            Read All
                        </Button>
                    )}
                    {notifications.length > 0 && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                            onClick={(e) => {
                                e.stopPropagation();
                                if (window.confirm("Delete all notifications?")) {
                                    clearAllNotifications();
                                }
                            }}
                        >
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    )}
                </div>
            </div>

            <div className="px-6 py-3 border-b border-orange-50/20 bg-slate-50/30 shrink-0">
                <TabsList className="w-full bg-slate-100/50 p-1 h-10 rounded-xl border border-slate-200/50">
                    <TabsTrigger
                        value="all"
                        className="rounded-lg data-[state=active]:bg-white data-[state=active]:text-orange-600 data-[state=active]:shadow-sm text-[11px] font-bold text-slate-500 uppercase tracking-wider w-1/2 transition-all"
                    >
                        All
                    </TabsTrigger>
                    <TabsTrigger
                        value="unread"
                        className="rounded-lg data-[state=active]:bg-white data-[state=active]:text-orange-600 data-[state=active]:shadow-sm text-[11px] font-bold text-slate-500 uppercase tracking-wider w-1/2 transition-all"
                    >
                        Unread {unreadCount > 0 && `(${unreadCount})`}
                    </TabsTrigger>
                </TabsList>
            </div>

            <div className="flex-1 overflow-hidden">
                <TabsContent value="all" className="mt-0 h-full">
                    <ScrollArea className="h-full">
                        {notifications.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-[300px] text-center p-8 animate-in fade-in zoom-in duration-700">
                                <div className="h-20 w-20 rounded-full bg-slate-50 flex items-center justify-center mb-6 shadow-inner border border-slate-100">
                                    <Bell className="h-8 w-8 text-slate-200" />
                                </div>
                                <h4 className="text-sm font-black text-slate-400 border-b border-slate-100 pb-2 mb-2 uppercase tracking-widest">No Activity</h4>
                                <p className="text-[11px] font-bold text-slate-300 uppercase tracking-wider px-10">We'll notify you when something important happens.</p>
                            </div>
                        ) : (
                            <div className="divide-y divide-orange-50/10">
                                {notifications.map(n => <NotificationItem key={n.id} notification={n} onRead={markAsRead} onSelect={setSelectedNotification} />)}
                            </div>
                        )}
                    </ScrollArea>
                </TabsContent>

                <TabsContent value="unread" className="mt-0 h-full">
                    <ScrollArea className="h-full">
                        {unreadNotifications.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-[300px] text-center p-8 animate-in fade-in zoom-in duration-700">
                                <div className="h-20 w-20 rounded-full bg-orange-50 flex items-center justify-center mb-6 shadow-inner border border-orange-100">
                                    <Check className="h-8 w-8 text-orange-200" />
                                </div>
                                <h4 className="text-sm font-black text-orange-400 border-b border-orange-100 pb-2 mb-2 uppercase tracking-widest">All Caught Up</h4>
                                <p className="text-[11px] font-bold text-orange-300 uppercase tracking-wider px-10">You've read all your recent notifications.</p>
                            </div>
                        ) : (
                            <div className="divide-y divide-orange-50/10">
                                {unreadNotifications.map(n => <NotificationItem key={n.id} notification={n} onRead={markAsRead} onSelect={setSelectedNotification} />)}
                            </div>
                        )}
                    </ScrollArea>
                </TabsContent>
            </div>

            <div className="p-4 border-t border-orange-50/50 bg-slate-50/50 shrink-0">
                <Button
                    variant="ghost"
                    className="w-full h-11 text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 hover:text-orange-600 transition-all duration-300 hover:bg-orange-50 rounded-xl group"
                    onClick={() => {
                        setOpen(false);
                        if (onNavigate) {
                            onNavigate('news');
                        } else {
                            navigate('/news-alerts');
                        }
                    }}
                >
                    View All Activity Center <ChevronRight className="ml-2 h-3 w-3 transition-transform group-hover:translate-x-1" />
                </Button>
            </div>
        </Tabs>
    );

    const TriggerButton = (
        <Button variant="ghost" size="icon" className="relative group rounded-xl h-10 w-10 text-slate-500 hover:text-orange-600 transition-all duration-300 hover:bg-orange-50 bg-white shadow-sm border border-slate-100">
            <Bell className={cn("h-5 w-5 transition-transform duration-500 group-hover:scale-110 group-active:scale-95", unreadCount > 0 && "animate-tada")} />
            {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 bg-orange-500 rounded-full items-center justify-center border-2 border-white text-[8px] font-black text-white shadow-sm ring-2 ring-orange-500/10">
                    {unreadCount > 9 ? '9+' : unreadCount}
                </span>
            )}
        </Button>
    );

    return (
        <>
            {isMobile ? (
                <Dialog open={open} onOpenChange={setOpen}>
                    <DialogTrigger asChild>
                        {TriggerButton}
                    </DialogTrigger>
                    {/* The dialog is a grid whose implicit column grows to the widest line, and the
                        scroll area's viewport wraps its children in a display:table div that does
                        the same; pin both to the dialog's width so long titles wrap/truncate. */}
                    <DialogContent className="w-[92vw] max-w-[92vw] h-[80vh] p-0 rounded-[24px] overflow-hidden gap-0 grid-cols-[minmax(0,1fr)] [&>button:last-child]:hidden [&_[data-radix-scroll-area-viewport]>div]:!block">
                        <DialogDescription className="sr-only">Activity Center</DialogDescription>
                        <DialogTitle className="sr-only">Activity Center</DialogTitle>
                        <NotificationListContent />
                    </DialogContent>
                </Dialog>
            ) : (
                <Popover open={open} onOpenChange={setOpen}>
                    <PopoverTrigger asChild>
                        {TriggerButton}
                    </PopoverTrigger>
                    <PopoverContent
                        className="w-[min(calc(100vw-2rem),400px)] p-0 overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.1)] border-orange-100/50 bg-white/95 backdrop-blur-2xl rounded-[32px] animate-in fade-in zoom-in-95 duration-300 focus:outline-none ring-1 ring-black/5"
                        align="end"
                        sideOffset={15}
                        collisionPadding={16}
                    >
                        <div className="h-[550px]">
                            <NotificationListContent />
                        </div>
                    </PopoverContent>
                </Popover>
            )}

            {/* Detailed View Dialog */}
            <Dialog open={!!selectedNotification} onOpenChange={(open) => !open && setSelectedNotification(null)}>
                <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto p-0 gap-0 border-none shadow-2xl bg-white/95 backdrop-blur-xl">
                    <DialogDescription className="sr-only">Detailed view of the selected notification</DialogDescription>
                    {selectedNotification && (() => {
                        const bgColors = {
                            product: "bg-purple-100",
                            warranty: "bg-blue-100",
                            alert: "bg-amber-100",
                            system: "bg-blue-100",
                            default: "bg-gray-100"
                        } as any;
                        const textColors = {
                            product: "text-purple-600",
                            warranty: "text-blue-600",
                            alert: "text-amber-600",
                            system: "text-blue-600",
                            default: "text-gray-600"
                        } as any;

                        const type = selectedNotification.type || 'default';
                        const bg = bgColors[type] || bgColors.default;
                        const text = textColors[type] || textColors.default;

                        const handleDownload = async (url: string, filename: string) => {
                            try {
                                const response = await fetch(url);
                                const blob = await response.blob();
                                const blobUrl = window.URL.createObjectURL(blob);
                                const link = document.createElement('a');
                                link.href = blobUrl;
                                link.download = filename || 'download';
                                document.body.appendChild(link);
                                link.click();
                                document.body.removeChild(link);
                                window.URL.revokeObjectURL(blobUrl);
                            } catch (error) {
                                console.error('Download failed:', error);
                                window.open(url, '_blank');
                            }
                        };

                        return (
                            <div className="flex flex-col h-full border-none">
                                <DialogHeader className={cn("p-8 pb-6 border-b border-white/20 relative overflow-hidden", bg.replace("100", "500/10"))}>
                                    {/* Decorative Background Element */}
                                    <div className={cn("absolute -top-12 -right-12 h-40 w-40 rounded-full blur-3xl opacity-20 animate-pulse", bg.replace("100", "500"))} />

                                    <div className="flex items-start justify-between gap-4 relative z-10">
                                        <div className="flex items-center gap-4">
                                            <div className={cn(
                                                "h-12 w-12 rounded-2xl flex items-center justify-center shrink-0 border border-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] bg-white/80 backdrop-blur-md",
                                                text
                                            )}>
                                                {getIcon(selectedNotification.type)}
                                            </div>
                                            <div className="flex flex-col gap-1">
                                                <Badge variant="outline" className={cn("w-fit px-2 py-0 border-0 bg-white/60 text-[9px] font-black uppercase tracking-widest backdrop-blur-sm shadow-sm", text)}>
                                                    {selectedNotification.type}
                                                </Badge>
                                                <DialogTitle className="text-2xl font-black tracking-tight text-slate-900 leading-tight">
                                                    {selectedNotification.title}
                                                </DialogTitle>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 mt-4 text-slate-400 font-bold text-[10px] uppercase tracking-widest relative z-10">
                                        <div className="flex items-center gap-1 bg-white/40 px-2 py-1 rounded-md border border-white/20 backdrop-blur-sm">
                                            <span>{format(new Date(selectedNotification.created_at), 'PPP')}</span>
                                        </div>
                                        <span className="opacity-30">•</span>
                                        <div className="flex items-center gap-1 bg-white/40 px-2 py-1 rounded-md border border-white/20 backdrop-blur-sm text-orange-600">
                                            {format(new Date(selectedNotification.created_at), 'p')}
                                        </div>
                                    </div>
                                </DialogHeader>

                                <div className="p-8 space-y-8 bg-white/30">
                                    <div className="max-h-[300px] overflow-y-auto rounded-xl border border-slate-100 bg-slate-50/50 p-5">
                                        <div className="text-slate-600 leading-relaxed whitespace-pre-wrap text-base font-medium">
                                            {selectedNotification.message}
                                        </div>
                                    </div>

                                    {/* Media Gallery */}
                                    {selectedNotification.metadata && (
                                        <div className="space-y-6 pt-4 border-t">
                                            {selectedNotification.metadata.images && Array.isArray(selectedNotification.metadata.images) && selectedNotification.metadata.images.length > 0 && (
                                                <div className="space-y-3">
                                                    <h4 className="text-xs font-black uppercase tracking-wider text-muted-foreground">Attached Images</h4>
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                        {selectedNotification.metadata.images.map((img: string, i: number) => (
                                                            <div key={i} className="group relative aspect-video rounded-xl overflow-hidden border bg-muted shadow-sm hover:shadow-md transition-all duration-300">
                                                                <img src={optimizeCloudinaryUrl(img, { width: 600 })} loading="lazy" alt="" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />

                                                                {/* Image Hover Overlay */}
                                                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                                                                    <a
                                                                        href={img}
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                        className="h-10 w-10 rounded-full bg-white/20 backdrop-blur-md text-white flex items-center justify-center hover:bg-white/40 transition-colors"
                                                                        title="View Large"
                                                                    >
                                                                        <ExternalLink className="h-5 w-5" />
                                                                    </a>
                                                                    <button
                                                                        onClick={() => handleDownload(img, `image-${i + 1}.jpg`)}
                                                                        className="h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:scale-110 transition-transform"
                                                                        title="Download Image"
                                                                    >
                                                                        <Download className="h-5 w-5" />
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {selectedNotification.metadata.videos && Array.isArray(selectedNotification.metadata.videos) && selectedNotification.metadata.videos.length > 0 && (
                                                <div className="space-y-3">
                                                    <h4 className="text-xs font-black uppercase tracking-wider text-muted-foreground">Attached Videos</h4>
                                                    <div className="grid grid-cols-1 gap-2">
                                                        {selectedNotification.metadata.videos.map((vid: string, i: number) => (
                                                            <div
                                                                key={i}
                                                                className="flex items-center justify-between p-3 rounded-xl border bg-gradient-to-r from-muted/50 to-muted/30 hover:from-muted hover:to-muted/50 transition-all group"
                                                            >
                                                                <div className="flex items-center gap-4">
                                                                    <div className="h-12 w-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-300 shadow-sm">
                                                                        <FileVideo className="h-6 w-6" />
                                                                    </div>
                                                                    <div className="flex flex-col">
                                                                        <span className="text-sm font-semibold">Video Attachment {i + 1}</span>
                                                                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold">MP4 / WEBM Format</span>
                                                                    </div>
                                                                </div>

                                                                <div className="flex items-center gap-2">
                                                                    <a
                                                                        href={vid}
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                        className="h-9 px-3 rounded-lg border bg-background hover:bg-muted text-xs font-bold flex items-center gap-2 transition-colors"
                                                                    >
                                                                        <PlayCircle className="h-4 w-4" /> Watch
                                                                    </a>
                                                                    <Button
                                                                        size="sm"
                                                                        variant="ghost"
                                                                        className="h-9 w-9 p-0 rounded-lg hover:bg-primary/10 hover:text-primary transition-colors"
                                                                        onClick={() => handleDownload(vid, `video-${i + 1}.mp4`)}
                                                                    >
                                                                        <Download className="h-4 w-4" />
                                                                    </Button>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {selectedNotification.link && (
                                        <div className="pt-8 border-t border-slate-100 flex justify-end">
                                            <Button onClick={() => {
                                                setOpen(false);
                                                setSelectedNotification(null);
                                                const handled = onLinkClick?.(selectedNotification.link);
                                                if (!handled) navigate(selectedNotification.link);
                                            }} className="w-full sm:w-auto rounded-xl bg-slate-900 hover:bg-orange-600 text-white font-black uppercase tracking-widest text-[11px] h-12 px-8 transition-all duration-300 shadow-[0_10px_20px_rgba(0,0,0,0.1)] hover:shadow-orange-500/20 hover:-translate-y-0.5">
                                                View Associated Link
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })()}
                </DialogContent>
            </Dialog>
        </>
    );
};
