import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type ModulePermissions = Record<string, { read: boolean; write: boolean }>;

interface PermissionModule {
    key: string;
    label: string;
    description: string;
}

const PERMISSION_GROUPS: { label: string; modules: PermissionModule[] }[] = [
    {
        label: "Insights",
        modules: [
            { key: "overview", label: "Overview", description: "Dashboard stats & charts" },
            { key: "analytics", label: "Deep Analytics", description: "Performance, geographic & fraud intelligence" },
        ]
    },
    {
        label: "Warranty Operations",
        modules: [
            { key: "warranties", label: "Warranties", description: "View & approve warranty registrations" },
            { key: "warranty_products", label: "Warranty Products", description: "Manage warranty product list" },
            { key: "uid_management", label: "UID Management", description: "Product UID allocation & tracking" },
            { key: "warranty_form", label: "New Registration", description: "Manual warranty registration" },
        ]
    },
    {
        label: "Network & Orders",
        modules: [
            { key: "vendors", label: "Franchises", description: "Franchise profiles & verification" },
            { key: "audits", label: "Audit & Compliance", description: "Store audit rounds, responses & chase list" },
            { key: "leads", label: "Lead Management", description: "Customer enquiries, ASM area coverage & store locator" },
            { key: "asms", label: "ASM Management", description: "ASM accounts & logins, their leads and expenses" },
            { key: "distributors", label: "Distributors", description: "Distributor network & franchise mapping" },
            { key: "order_management", label: "Order Management", description: "Order activity, allocation & fulfilment" },
            { key: "customers", label: "Customers", description: "Customer data & warranty history" },
            { key: "products", label: "Product Catalogue", description: "Product inventory management" },
        ]
    },
    {
        label: "Engagement & Content",
        modules: [
            { key: "announcements", label: "Announcements", description: "Broadcast messages to franchises" },
            { key: "grievances", label: "Grievances", description: "Support tickets & complaints" },
            { key: "posm", label: "POSM Requirements", description: "Marketing material requests" },
            { key: "ecatalogue", label: "E-Catalogue CMS", description: "Digital catalogue content" },
            { key: "terms", label: "Terms & Conditions", description: "Portal T&C management" },
            { key: "content_manager", label: "Form Content", description: "Warranty terms & disclaimer content" },
        ]
    },
    {
        label: "Administration",
        modules: [
            { key: "old_warranties", label: "Old Warranties", description: "Archived warranty records" },
            { key: "activity_logs", label: "Activity Logs", description: "System audit trail (read only)" },
        ]
    },
];

export const DEFAULT_PERMISSIONS: ModulePermissions = PERMISSION_GROUPS.reduce((acc, group) => {
    group.modules.forEach(m => {
        acc[m.key] = { read: false, write: false };
    });
    return acc;
}, {} as ModulePermissions);

interface AdminPermissionMatrixProps {
    value: ModulePermissions;
    onChange: (perms: ModulePermissions) => void;
    disabled?: boolean;
}

export const AdminPermissionMatrix = ({ value, onChange, disabled = false }: AdminPermissionMatrixProps) => {
    const handleToggle = (moduleKey: string, action: 'read' | 'write', checked: boolean) => {
        const current = value[moduleKey] ?? { read: false, write: false };
        let updated = { ...current, [action]: checked };

        // write implies read
        if (action === 'write' && checked) updated.read = true;
        // unchecking read also revokes write
        if (action === 'read' && !checked) updated.write = false;

        onChange({ ...value, [moduleKey]: updated });
    };

    const handleSelectAllRead = () => {
        const updated = { ...value };
        PERMISSION_GROUPS.forEach(group =>
            group.modules.forEach(m => {
                updated[m.key] = { ...updated[m.key], read: true };
            })
        );
        onChange(updated);
    };

    const handleSelectAllWrite = () => {
        const updated = { ...value };
        PERMISSION_GROUPS.forEach(group =>
            group.modules.forEach(m => {
                updated[m.key] = { read: true, write: true };
            })
        );
        onChange(updated);
    };

    const handleClearAll = () => {
        onChange({ ...DEFAULT_PERMISSIONS });
    };

    if (disabled) {
        return (
            <div className="space-y-4">
                {PERMISSION_GROUPS.map(group => (
                    <div key={group.label}>
                        <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 mb-2">{group.label}</p>
                        <div className="space-y-1.5">
                            {group.modules.map(mod => {
                                const perm = value[mod.key] ?? { read: false, write: false };
                                return (
                                    <div key={mod.key} className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-slate-50/50 border border-slate-100">
                                        <span className="text-xs font-semibold text-slate-600">{mod.label}</span>
                                        <div className="flex gap-2">
                                            <Badge variant="outline" className={cn("text-[10px] px-2 py-0", perm.read ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-slate-50 text-slate-400 border-slate-200")}>
                                                Read
                                            </Badge>
                                            <Badge variant="outline" className={cn("text-[10px] px-2 py-0", perm.write ? "bg-orange-50 text-orange-700 border-orange-200" : "bg-slate-50 text-slate-400 border-slate-200")}>
                                                Write
                                            </Badge>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Quick Action Buttons */}
            <div className="flex items-center gap-2 flex-wrap pb-2 border-b border-slate-100">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 mr-1">Quick:</span>
                <button
                    type="button"
                    onClick={handleSelectAllRead}
                    className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 transition-colors"
                >
                    All Read
                </button>
                <button
                    type="button"
                    onClick={handleSelectAllWrite}
                    className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-orange-50 text-orange-600 border border-orange-200 hover:bg-orange-100 transition-colors"
                >
                    All Read + Write
                </button>
                <button
                    type="button"
                    onClick={handleClearAll}
                    className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-slate-50 text-slate-500 border border-slate-200 hover:bg-slate-100 transition-colors"
                >
                    Clear All
                </button>
            </div>

            {/* Column Headers */}
            <div className="grid grid-cols-[1fr_80px_80px] gap-2 px-3">
                <div />
                <div className="text-center text-[10px] font-black uppercase tracking-widest text-blue-500">Read</div>
                <div className="text-center text-[10px] font-black uppercase tracking-widest text-orange-500">Write</div>
            </div>

            {/* Permission Groups */}
            {PERMISSION_GROUPS.map(group => (
                <div key={group.label}>
                    <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 mb-2 px-1">{group.label}</p>
                    <div className="space-y-1">
                        {group.modules.map(mod => {
                            const perm = value[mod.key] ?? { read: false, write: false };
                            return (
                                <div
                                    key={mod.key}
                                    className={cn(
                                        "grid grid-cols-[1fr_80px_80px] gap-2 items-center px-3 py-2.5 rounded-xl border transition-colors",
                                        perm.write
                                            ? "bg-orange-50/40 border-orange-100"
                                            : perm.read
                                                ? "bg-blue-50/30 border-blue-100"
                                                : "bg-slate-50/40 border-slate-100 hover:border-slate-200"
                                    )}
                                >
                                    <div>
                                        <p className="text-xs font-bold text-slate-700">{mod.label}</p>
                                        <p className="text-[10px] text-slate-400 leading-tight">{mod.description}</p>
                                    </div>
                                    <div className="flex justify-center">
                                        <Switch
                                            checked={perm.read}
                                            onCheckedChange={checked => handleToggle(mod.key, 'read', checked)}
                                            className="data-[state=checked]:bg-blue-500 scale-75"
                                        />
                                    </div>
                                    <div className="flex justify-center">
                                        <Switch
                                            checked={perm.write}
                                            onCheckedChange={checked => handleToggle(mod.key, 'write', checked)}
                                            className="data-[state=checked]:bg-orange-500 scale-75"
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
};
