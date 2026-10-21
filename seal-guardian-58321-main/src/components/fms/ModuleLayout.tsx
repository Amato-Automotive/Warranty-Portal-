import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { HelpPopover } from "./HelpPopover";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useB2BCart } from "@/contexts/B2BCartContext";
import { useLanguage } from "@/contexts/LanguageContext";

interface ModuleLayoutProps {
    title: string;
    description?: string;
    children: ReactNode;
    actions?: ReactNode;
    isCollapsed?: boolean;
    onNavigate?: (module: any) => void;
    onLinkClick?: (link: string) => boolean;
    onMenuToggle?: () => void;
    /** Overrides the Franchise/Distributor label, e.g. "ASM" on the ASM portal. */
    roleLabel?: string;
}

export const ModuleLayout = ({ title, description, children, actions, onNavigate, onMenuToggle, roleLabel }: ModuleLayoutProps) => {
    const { isDistributor, isFranchise } = useB2BCart();
    const { t } = useLanguage();

    // Determine the role title dynamically
    let roleText = "Franchise";
    if (isDistributor && isFranchise) {
        roleText = "Distributor / Franchise";
    } else if (isDistributor) {
        roleText = "Distributor";
    }
    if (roleLabel) roleText = roleLabel;

    return (
        <div className="flex-1 min-h-0 flex flex-col min-w-0 relative bg-[#fffaf5]">
            <main
                className={cn(
                    "flex-1 min-h-0 bg-white md:border border-orange-100 rounded-none md:rounded-[40px] shadow-none md:shadow-[0_15px_50px_rgba(0,0,0,0.03)] relative md:mr-6 md:my-6 md:ml-6 flex flex-col overflow-hidden m-0"
                )}
            >
                <div id="main-dashboard-content-area" className="flex-1 w-full h-full overflow-y-auto custom-scrollbar flex flex-col">
                    {/* Branding Header Area - Exactly like Customer Side */}
                    <div className="px-6 md:px-10 py-4 md:pt-10 w-full shrink-0 sticky md:static top-0 z-40 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/60">
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
                                                <span className="bg-gradient-to-r from-slate-800 to-slate-900 bg-clip-text text-transparent uppercase">{t(roleText)}</span>
                                                <span className="bg-gradient-to-r from-orange-500 to-orange-600 bg-clip-text text-transparent md:ml-3 uppercase">{t("Dashboard")}</span>
                                            </h1>
                                            <p className="md:hidden text-[8px] font-black text-slate-400 uppercase tracking-[0.2em] mt-1 leading-none opacity-80">
                                                {t(title)}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="hidden md:flex gap-3 items-center">
                                        <div className="h-1.5 w-12 bg-black rounded-full" />
                                        <p className="text-xs font-black text-slate-500 tracking-[0.2em] uppercase opacity-70">
                                            {t(title)} <span>• {description || t("Management Suite")}</span>
                                        </p>
                                        <div className="h-1.5 w-12 bg-gradient-to-r from-orange-500 to-orange-600 rounded-full" />
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 md:gap-4 shrink-0">
                                    <img
                                        src="/favicon.png"
                                        alt="Autoform Logo"
                                        className="md:hidden h-12 sm:h-5 w-auto object-contain mr-2 opacity-100"
                                    />
                                    {actions}
                                    <div className="h-10 md:h-12 border-l border-slate-100 pl-2 md:pl-4 flex items-center gap-1 md:gap-2">
                                        {/* TODO: Re-enable notifications in Phase 2 */}
                                        {/* <NotificationPopover onNavigate={onNavigate} onLinkClick={onLinkClick} /> */}
                                        <HelpPopover onNavigate={onNavigate} />
                                    </div>
                                </div>
                            </div>

                        </div>
                    </div>

                    {/* Module Content Area */}
                    <div className="flex-1 p-5 md:p-10 pt-8 md:pt-14">
                        <div className="max-w-[1500px] mx-auto animate-in fade-in slide-in-from-bottom-2 duration-700">
                            {children}
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
};
