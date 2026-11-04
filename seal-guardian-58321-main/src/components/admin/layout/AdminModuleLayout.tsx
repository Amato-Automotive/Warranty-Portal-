import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Menu, User } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AdminModuleLayoutProps {
    title: string;
    description?: string;
    children: ReactNode;
    actions?: ReactNode;
    onMenuToggle?: () => void;
    onProfileClick?: () => void;
    stickyHeader?: boolean;
}

export const AdminModuleLayout = ({ 
    title, 
    description, 
    children, 
    actions, 
    onMenuToggle, 
    onProfileClick,
    stickyHeader = true
}: AdminModuleLayoutProps) => {
    return (
        <div className="flex-1 min-h-0 flex flex-col min-w-0 relative bg-[#fffaf5]">
            <main
                className={cn(
                    "flex-1 min-h-0 bg-white md:border border-orange-100 rounded-none md:rounded-[40px] shadow-none md:shadow-[0_15px_50px_rgba(0,0,0,0.03)] relative md:mr-6 md:my-6 md:ml-6 flex flex-col overflow-hidden supports-[overflow:clip]:overflow-clip m-0"
                )}
            >
                <div className="flex-1 w-full h-full overflow-y-auto custom-scrollbar flex flex-col">
                    {/* Branding Header Area */}
                    <div className={cn(
                        "px-6 md:px-10 pt-8 md:pt-10 w-full shrink-0 pb-4 transition-all",
                        stickyHeader ? "sticky top-0 z-50 bg-white/95 backdrop-blur-sm" : "relative bg-white"
                    )}>
                        <div className="max-w-[1500px] mx-auto flex flex-col gap-4 md:gap-0">
                            <div className="flex flex-row items-start justify-between gap-4 md:gap-6">
                                <div className="flex flex-col gap-3 md:gap-4 flex-1 min-w-0">
                                    <div className="flex items-center gap-3 md:gap-4">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="md:hidden h-10 w-10 rounded-xl bg-orange-50 text-orange-600 border border-orange-100 shadow-sm shrink-0"
                                            onClick={onMenuToggle}
                                        >
                                            <Menu className="h-6 w-6" />
                                        </Button>
                                        <div className="flex flex-col">
                                            <h1 className="font-black tracking-tighter sm:tracking-tight leading-[0.95] text-lg sm:text-2xl md:text-4xl lg:text-5xl flex flex-col md:flex-row md:items-center">
                                                <span className="bg-gradient-to-r from-slate-800 to-slate-900 bg-clip-text text-transparent uppercase">Admin</span>
                                                <span className="bg-gradient-to-r from-orange-500 to-orange-600 bg-clip-text text-transparent md:ml-3 uppercase">Console</span>
                                            </h1>
                                            <div className="flex flex-col md:hidden leading-tight mt-1">
                                                <p className="text-[8px] font-black text-slate-400 uppercase tracking-[0.2em] leading-none opacity-80">
                                                    {title}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="hidden md:flex gap-3 items-center">
                                        <div className="h-1.5 w-12 bg-black rounded-full" />
                                        <p className="text-xs font-black text-slate-500 tracking-[0.2em] uppercase opacity-70">
                                            {title} <span>• {description || "System Control"}</span>
                                        </p>
                                        <div className="h-1.5 w-12 bg-gradient-to-r from-orange-500 to-orange-600 rounded-full" />
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 md:gap-4 shrink-0">
                                    {actions}
                                    <div className="h-10 md:h-12 border-l border-slate-100 pl-2 md:pl-4 flex items-center gap-1 md:gap-2">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-9 w-9 md:h-10 md:w-10 rounded-full bg-slate-50 hover:bg-slate-100 text-slate-600 hover:text-slate-900 transition-colors"
                                            onClick={onProfileClick}
                                        >
                                            <User className="h-5 w-5" />
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Module Content Area */}
                    <div className="flex-1 p-6 md:p-10 pt-8 md:pt-14">
                        <div className="max-w-[1500px] mx-auto animate-in fade-in slide-in-from-bottom-2 duration-700">
                            {children}
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
};
