import type { LucideIcon } from "lucide-react";
import {
    Activity,
    Archive,
    BellRing,
    BookOpen,
    ChartColumn,
    ClipboardCheck,
    FileText,
    Flag,
    Gift, MessageSquareHeart,
    HardHat,
    History,
    Layers,
    LayoutDashboard,
    MapPin,
    Megaphone,
    MessageSquareWarning,
    Package,
    PackageCheck,
    PenTool,
    QrCode,
    ShieldCheck,
    ShoppingCart,
    Store,
    UserCog,
    Users,
    Warehouse,
    Waypoints
} from "lucide-react";

export type AdminModule =
    | 'overview'
    | 'vendors'
    | 'portal-activity'
    | 'distributors'
    | 'manpower'
    | 'customers'
    | 'products'
    | 'warranty-products'
    | 'warranties'
    | 'old-warranties'
    | 'admins'
    | 'activity-logs'
    | 'grievances'
    | 'terms'
    | 'content-manager'
    | 'warranty-form'
    | 'announcements'
    | 'notification-settings'
    | 'posm'
    | 'feedback'
    | 'schemes'
    | 'uid-management'
    | 'ppf-rolls'
    | 'ecatalogue'
    | 'analytics'
    | 'order-management'
    | 'franchise-distributor-map'
    | 'audits'
    | 'leads'
    | 'profile';

// Maps sidebar module IDs to permission keys
const moduleToPermKey: Record<string, string> = {
    'overview': 'overview',
    'warranties': 'warranties',
    'warranty-products': 'warranty_products',
    'uid-management': 'uid_management',
    // Roll usage is warranty data, so it follows the warranties permission
    // rather than introducing a key nobody has been granted yet.
    'ppf-rolls': 'warranties',
    'warranty-form': 'warranty_form',
    'vendors': 'vendors',
    'portal-activity': 'vendors',
    'manpower': 'vendors',
    'customers': 'customers',
    'products': 'products',
    'announcements': 'announcements',
    'notification-settings': 'announcements',
    'grievances': 'grievances',
    'posm': 'posm',
    'feedback': 'feedback',
    'schemes': 'schemes',
    'ecatalogue': 'ecatalogue',
    'terms': 'terms',
    'old-warranties': 'old_warranties',
    'activity-logs': 'activity_logs',
    'admins': 'admins',   // Super Admin only
    'analytics': 'analytics',
    'distributors': 'distributors',
    'content-manager': 'content_manager',
    'order-management': 'order_management',
    'franchise-distributor-map': 'distributors',
    'audits': 'audits',
    'leads': 'leads',
    'profile': 'profile',  // Always visible
};

export interface AdminMenuItem {
    id: AdminModule;
    label: string;
    icon: LucideIcon;
    /** Extra words the command palette matches on, beyond the label. */
    keywords?: string[];
}

/*
 * The one list of admin modules. The sidebar renders it, the Ctrl+K command
 * palette searches it, and AdminLayout takes each page's heading from it. Each
 * used to keep its own copy: the palette fell a dozen modules behind and the
 * headings stopped matching the sidebar. A new module added here appears in
 * all three (it still needs a `case` in AdminLayout's render switch).
 */
export const ADMIN_MENU_GROUPS: { label: string; items: AdminMenuItem[] }[] = [
    {
        label: "Overview",
        items: [
            { id: 'overview', label: "Overview", icon: LayoutDashboard, keywords: ['dashboard', 'home'] },
            { id: 'analytics', label: "Analytics", icon: ChartColumn, keywords: ['deep analytics', 'reports', 'charts', 'leaderboard'] },
        ]
    },
    {
        label: "Warranty",
        items: [
            { id: 'warranties', label: "Warranty Management", icon: ShieldCheck, keywords: ['warranties', 'claims', 'approve', 'reject', 'resubmission'] },
            { id: 'warranty-form', label: "New Registration", icon: PenTool, keywords: ['register', 'add warranty', 'form'] },
            { id: 'old-warranties', label: "Old Warranties", icon: Archive, keywords: ['legacy', 'archive'] },
        ]
    },
    {
        label: "Warranty Form Controls",
        items: [
            { id: 'warranty-products', label: "Warranty Products", icon: PackageCheck, keywords: ['form products'] },
            { id: 'uid-management', label: "UID Management", icon: QrCode, keywords: ['uid', 'codes'] },
            { id: 'ppf-rolls', label: "PPF Serials & Rolls", icon: Layers, keywords: ['serial number management', 'ppf', 'rolls', 'serials', 'sqft'] },
        ]
    },
    {
        label: "Franchise Network",
        items: [
            { id: 'vendors', label: "Franchises", icon: Store, keywords: ['vendors', 'stores', 'dealers'] },
            { id: 'portal-activity', label: "Portal Activity", icon: Activity, keywords: ['franchise activity', 'distributor activity', 'time spent', 'logins', 'usage', 'inactive'] },
            { id: 'manpower', label: "Manpower", icon: HardHat, keywords: ['staff', 'installers', 'team'] },
            { id: 'audits', label: "Store Audits", icon: ClipboardCheck, keywords: ['audit & compliance', 'compliance'] },
            { id: 'posm', label: "POSM Requests", icon: Flag, keywords: ['posm requirements', 'marketing material', 'branding'] },
            { id: 'schemes', label: "Offers & Schemes", icon: Gift, keywords: ['schemes', 'offers', 'incentives', 'leaderboard', 'contest', 'rewards'] },
            { id: 'feedback', label: "Review & Feedback", icon: MessageSquareHeart, keywords: ['feedback', 'review', 'survey', 'monthly questions', 'rating'] },
            { id: 'grievances', label: "Complaints", icon: MessageSquareWarning, keywords: ['complaints', 'tickets'] },
        ]
    },
    {
        label: "Orders & Supply",
        items: [
            { id: 'order-management', label: "Orders", icon: ShoppingCart, keywords: ['order management', 'b2b', 'invoices'] },
            { id: 'distributors', label: "Distributors", icon: Warehouse },
            { id: 'franchise-distributor-map', label: "Sourcing Map", icon: Waypoints, keywords: ['mapping', 'franchise distributor'] },
            { id: 'products', label: "Product Catalogue", icon: Package, keywords: ['products', 'categories'] },
            { id: 'ecatalogue', label: "E-Catalogue", icon: BookOpen, keywords: ['e-catalogue cms', 'flipbook'] },
        ]
    },
    {
        label: "Customers",
        items: [
            { id: 'customers', label: "Customers", icon: Users },
            { id: 'leads', label: "Leads", icon: MapPin, keywords: ['lead management', 'enquiries', 'asm', 'instagram'] },
        ]
    },
    {
        label: "Messaging",
        items: [
            { id: 'announcements', label: "Announcements", icon: Megaphone, keywords: ['broadcast', 'campaign'] },
            { id: 'notification-settings', label: "WhatsApp Settings", icon: BellRing, keywords: ['whatsapp messages', 'notifications', 'templates', 'reminders'] },
        ]
    },
    {
        label: "Administration",
        items: [
            { id: 'content-manager', label: "Form Content", icon: FileText, keywords: ['terms', 'conditions', 'disclaimer', 'claim process'] },
            { id: 'admins', label: "Admin Access", icon: UserCog, keywords: ['admin users', 'permissions'] },
            { id: 'activity-logs', label: "Activity Logs", icon: History, keywords: ['audit trail', 'history'] },
        ]
    }
];

/** Can this admin open the module? Shared by the sidebar and the command palette. */
export const canSeeAdminModule = (
    moduleId: AdminModule,
    user: { isSuperAdmin?: boolean } | null | undefined,
    hasPermission: (module: string, action: 'read' | 'write') => boolean
): boolean => {
    if (moduleId === 'profile') return true;      // always visible
    if (moduleId === 'admins') return !!user?.isSuperAdmin; // Super Admin only
    if (user?.isSuperAdmin) return true;          // super admin sees all
    const permKey = moduleToPermKey[moduleId];
    if (!permKey) return true;
    return hasPermission(permKey, 'read');
};

/** Pages that open from somewhere other than the sidebar. */
const EXTRA_TITLES: Partial<Record<AdminModule, string>> = {
    profile: 'My Profile',
    terms: 'Terms & Conditions',
};

/** The heading a module's page shows — the same name as its sidebar entry. */
export const adminModuleTitle = (id: AdminModule): string => {
    for (const group of ADMIN_MENU_GROUPS) {
        const item = group.items.find(i => i.id === id);
        if (item) return item.label;
    }
    return EXTRA_TITLES[id] ?? '';
};

/** The sidebar group a module belongs to, if any. */
export const adminModuleGroup = (id: AdminModule): string | undefined =>
    ADMIN_MENU_GROUPS.find(g => g.items.some(i => i.id === id))?.label;
