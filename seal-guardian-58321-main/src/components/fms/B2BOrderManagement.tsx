import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useB2BCart, type CartItem } from '@/contexts/B2BCartContext';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import api, { getErrorMessage } from '@/lib/api';
import { B2BOrderSpecSheet } from './B2BOrderSpecSheet';
import {
  ShoppingBag, Package, ClipboardList, RefreshCw, Minus, Plus, Trash2,
  Download, XCircle, Search, Building2, MapPin, Phone, Mail,
  CheckCircle2, Clock, Truck, AlertCircle, Ban, ChevronDown, ChevronUp, ChevronRight,
  ShoppingCart, FileText, Warehouse, TrendingUp, BarChart3, Info,
  Car, Settings, LayoutList, Lightbulb, Volume2, Wind, Eye, Send, ArrowLeft, Pencil, Upload, MessageSquare,
  Loader2
} from 'lucide-react';
import { cn, downloadCSV } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import type { Category } from '@/lib/catalogService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import {
  Tooltip, TooltipContent, TooltipTrigger
} from '@/components/ui/tooltip';

// â"€â"€â"€ Types â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

interface Order {
  id: string;
  status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'received';
  total_amount: number;
  shipping_address: string;
  shipping_city: string;
  shipping_state: string;
  shipping_pincode: string;
  created_at: string;
  distributor_name?: string;
  distributor_phone?: string | null;
  distributor_email?: string | null;
  client_store_name?: string | null;
  client_store_email?: string | null;
  vendor_name?: string | null;
  vendor_phone?: string | null;
  docket_id?: string | null;
  distributor_confirmation_note?: string | null;
  declined_by_role?: 'vendor' | 'distributor' | 'admin' | null;
  decline_reason?: string | null;
  declined_at?: string | null;
  order_group_id?: string | null;
  // How many distributor orders one checkout was split into.
  group_size?: number;
  items: {
    id: string;
    product_name: string;
    variation_name: string | null;
    quantity: number;
    price: number;
  }[];
}

// â"€â"€â"€ Status Badge â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

/* "On the way": the distributor has shared a docket but the order isn't
   received yet. Nothing in the app sets "shipped", so the docket is the sign. */
const StatusBadge = ({ status, isIncoming = false, docket }: { status: Order['status']; isIncoming?: boolean; docket?: string | null }) => {
  const config: Record<string, { label: string; icon: any; className: string }> = {
    pending:    isIncoming
      ? { label: 'On Hold',   icon: Clock,        className: 'bg-amber-50 text-amber-700 border-amber-200' }
      : { label: 'Pending',   icon: Clock,        className: 'bg-amber-50 text-amber-700 border-amber-200' },
    processing: { label: 'Active',     icon: CheckCircle2,  className: 'bg-blue-50 text-blue-700 border-blue-200' },
    shipped:    { label: 'Shipped',    icon: Truck,         className: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
    delivered:  { label: 'Completed',  icon: CheckCircle2,  className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    cancelled:  { label: 'Declined',   icon: Ban,           className: 'bg-rose-50 text-rose-700 border-rose-200' },
  };
  const onTheWay = status === 'processing' && Boolean(docket);
  const c = onTheWay
    ? { label: 'On the way', icon: Truck, className: 'bg-indigo-50 text-indigo-700 border-indigo-200' }
    : config[status] || config.pending;
  const Icon = c.icon;
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border', c.className)}>
      <Icon className="w-3 h-3" />
      {c.label}
    </span>
  );
};

const ReceivedBadge = () => (
  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border bg-emerald-50 text-emerald-700 border-emerald-200">
    <CheckCircle2 className="w-3 h-3" />
    Received
  </span>
);

const DeliveredBadge = () => (
  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border bg-emerald-50 text-emerald-700 border-emerald-200">
    <CheckCircle2 className="w-3 h-3" />
    Delivered
  </span>
);

const getDeclineSourceLabel = (role?: Order['declined_by_role']) => {
  switch (role) {
    case 'distributor':
      return 'Declined by Distributor';
    case 'admin':
      return 'Declined by Admin';
    case 'vendor':
      return 'Declined by Franchise';
    default:
      return 'Declined';
  }
};

const formatOrderId = (orderId: string) => (orderId?.startsWith('AFI') ? orderId : orderId.slice(0, 8).toUpperCase());

const DEFAULT_PRODUCT_THRESHOLD = 10;
const PRODUCT_THRESHOLDS_KEY = 'dist_product_thresholds';
const CATEGORY_THRESHOLDS_KEY = 'dist_category_thresholds';

// Per-item customization (the "Customization Details" confirmation step before
// adding to cart) is disabled for now in the order-punching flow. Flip this back
// to true to re-enable it — all the dialog/state/handler code stays intact below.
const ENABLE_ORDER_CUSTOMIZATION = false;

type PendingReplenishItem = {
  productId: string;
  variationId: string | null;
  productName: string;
  variationName: string | null;
  quantity: number;
  price: number;
  stockQuantity: number;
  sku?: string;
  needsCustomization: boolean;
  customizationRemarks: string;
  categoryId?: string;
  categoryName?: string;
  canCustomize: boolean;
  // Carried through so the order is placed with the distributor the item was
  // actually browsed from, not one re-derived from its category.
  distributorId?: string;
  distributorName?: string;
};

const hasMeaningfulOrderText = (value?: string | null) => {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  return normalized !== '' && normalized !== '0';
};

// â"€â"€â"€ Tab Button â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

const TabButton = ({
  active, onClick, icon: Icon, label, badge
}: { active: boolean; onClick: () => void; icon: any; label: string; badge?: number }) => (
  <button
    onClick={onClick}
    title={label}
    className={cn(
      'flex items-center gap-2 px-3 sm:px-4 py-3 rounded-2xl text-xs font-black uppercase tracking-wider transition-all duration-300 relative shrink-0',
      active
        ? 'bg-orange-500 text-white shadow-lg shadow-orange-200'
        : 'text-slate-500 hover:bg-slate-100 bg-white'
    )}
  >
    <Icon className="w-4 h-4 shrink-0" />
    <span className="hidden sm:inline">{label}</span>
    {badge !== undefined && badge > 0 && (
      <span className={cn(
        'h-5 min-w-[20px] flex items-center justify-center rounded-full text-[10px] font-black px-1',
        active ? 'bg-white text-orange-500' : 'bg-orange-500 text-white'
      )}>
        {badge}
      </span>
    )}
  </button>
);

// Filter Dropdown — custom styled, matches existing dropdowns in this file
type FilterOption = { value: string; label: string; activeBg: string; activeText: string; dot: string };
const ORDER_FILTER_OPTIONS: FilterOption[] = [
  { value: 'all',       label: 'All Orders', activeBg: 'bg-orange-50',  activeText: 'text-orange-600',  dot: 'bg-orange-400' },
  { value: 'active',    label: 'Active',      activeBg: 'bg-blue-50',   activeText: 'text-blue-600',    dot: 'bg-blue-500'   },
  { value: 'onhold',    label: 'On Hold',     activeBg: 'bg-amber-50',  activeText: 'text-amber-600',   dot: 'bg-amber-400'  },
  { value: 'completed', label: 'Completed',   activeBg: 'bg-emerald-50',activeText: 'text-emerald-600', dot: 'bg-emerald-500'},
  { value: 'declined',  label: 'Declined',    activeBg: 'bg-rose-50',   activeText: 'text-rose-600',    dot: 'bg-rose-500'   },
];

const FilterDropdown = ({
  value, onChange, options, counts, open, setOpen, dropdownRef,
}: {
  value: string;
  onChange: (v: string) => void;
  options: FilterOption[];
  counts: Record<string, number>;
  open: boolean;
  setOpen: (v: boolean) => void;
  dropdownRef: React.RefObject<HTMLDivElement>;
}) => {
  const active = options.find(o => o.value === value) || options[0];
  return (
    <div ref={dropdownRef} className="relative w-full sm:hidden mb-3">
      {/* Trigger button — matches invCat dropdown trigger style */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'w-full h-10 flex items-center justify-between gap-3 px-3.5 pr-3 rounded-xl border bg-white text-sm font-medium transition-colors',
          open ? 'border-orange-400 text-orange-600' : 'border-slate-200 text-slate-700'
        )}
      >
        <span className="flex items-center gap-2.5 min-w-0">
          <span className={cn('w-2 h-2 rounded-full shrink-0', active.dot)} />
          <span className={cn('font-bold truncate', open ? 'text-orange-600' : active.activeText)}>{active.label}</span>
          <span className={cn('text-xs font-black shrink-0', open ? 'text-orange-400' : 'text-slate-400')}>({counts[active.value] ?? 0})</span>
        </span>
        <ChevronDown className={cn('w-4 h-4 shrink-0 transition-transform text-slate-400', open && 'rotate-180 text-orange-500')} />
      </button>
      {/* Panel — matches franchise dropdown panel style */}
      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-50 w-full bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
          {options.map((opt, i) => {
            const isActive = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setOpen(false); }}
                className={cn(
                  'w-full flex items-center justify-between gap-3 px-4 py-3 text-sm text-left transition-colors',
                  i > 0 && 'border-t border-slate-100',
                  isActive ? cn(opt.activeBg, opt.activeText, 'font-bold') : 'text-slate-700 hover:bg-slate-50 font-medium'
                )}
              >
                <span className="flex items-center gap-2.5">
                  <span className={cn('w-2 h-2 rounded-full shrink-0', opt.dot)} />
                  {opt.label}
                </span>
                <span className={cn(
                  'text-xs font-black px-2 py-0.5 rounded-full',
                  isActive ? 'bg-white/70 ' + opt.activeText : 'bg-slate-100 text-slate-500'
                )}>
                  {counts[opt.value] ?? 0}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

// â"€â"€â"€ Quantity Stepper â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

const QuantityStepper = ({
  value, onChange, max
}: { value: number; onChange: (v: number) => void; max?: number }) => (
  <div className="flex items-center gap-0 rounded-xl overflow-hidden border border-slate-200 bg-white shadow-sm w-fit">
    <button
      onClick={() => onChange(Math.max(0, value - 1))}
      className="h-8 w-8 flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-orange-600 transition-colors"
    >
      <Minus className="w-3.5 h-3.5" />
    </button>
    <span className="w-10 text-center text-sm font-bold text-slate-800 select-none">{value}</span>
    <button
      onClick={() => onChange(max !== undefined ? Math.min(max, value + 1) : value + 1)}
      disabled={max !== undefined && value >= max}
      className="h-8 w-8 flex items-center justify-center text-slate-500 hover:bg-orange-50 hover:text-orange-600 transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-500"
    >
      <Plus className="w-3.5 h-3.5" />
    </button>
  </div>
);

// â"€â"€â"€ Main Component â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

const B2BOrderManagement: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const {
    cartItems, addToCart, removeFromCart, updateQuantity, updateCustomization, clearCart,
    distributorStock, distributorName, loadingStock, refreshStock, checkout,
    productImages, categoryMap, vendorProfile: franchiseProfile, loadingProfile
  } = useB2BCart();

  const [activeTab, setActiveTab] = useState<'replenish' | 'cart' | 'orders' | 'incoming' | 'inventory'>('replenish');

  // Rapid Replenishment state
  const [replenishQtys, setReplenishQtys] = useState<Record<string, number>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [allCategories, setAllCategories] = useState<Category[]>([]);
  const [mainCategories, setMainCategories] = useState<Category[]>([]);

  // Selected distributor for the order-punching view. A franchise can be
  // assigned to multiple distributors (split by product/brand), so the product
  // list, categories, and search are all scoped to the distributor chosen in the
  // selector below. Null = none selected yet → show nothing until one is picked.
  const [focusedDistId, setFocusedDistId] = useState<string | null>(null);

  // When the selected distributor carries BOTH brands (AFAC), the franchise picks
  // which brand to browse — otherwise AF and AC categories with the same name
  // (e.g. two "Accessories") would appear side by side. For single-brand
  // distributors this stays null and no picker is shown.
  const [selectedBrand, setSelectedBrand] = useState<'AF' | 'AC' | null>(null);

  // The catalogue narrowed to the selected distributor (and, for AFAC
  // distributors, the chosen brand). Everything the franchise browses for
  // ordering (products, category tabs, nav dropdowns) reads from this instead of
  // the full multi-distributor union in `distributorStock`.
  const visibleStock = useMemo(
    () => {
      if (!focusedDistId) return [];
      return distributorStock.filter((item: any) =>
        item.distributor_id === focusedDistId &&
        (!selectedBrand || (item.product_brand || 'AF') === selectedBrand)
      );
    },
    [distributorStock, focusedDistId, selectedBrand]
  );

  // An AFAC franchise carries products of BOTH brands, and the AF/AC category
  // trees are separate (e.g. two "Accessories"). So an AFAC franchise must pick a
  // brand to browse — otherwise both trees show at once. AF-/AC-only franchises
  // have a single brand, so no picker (and the backend already scopes their
  // catalogue to that one brand).
  const showBrandPicker = franchiseProfile?.allowed_brands === 'AFAC';

  // When the picker applies, default to AF; otherwise no brand scoping.
  useEffect(() => {
    if (showBrandPicker) {
      setSelectedBrand(prev => prev ?? 'AF');
    } else {
      setSelectedBrand(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBrandPicker]);

  // Product detail dialog (view-and-order)
  const [detailProductId, setDetailProductId] = useState<string | null>(null);
  const [detailImageIndex, setDetailImageIndex] = useState(0);
  const [detailVariationId, setDetailVariationId] = useState<string | null>(null);

  // Customization modal state
  const [customizationOpen, setCustomizationOpen] = useState(false);
  const [cartCustomizationOpen, setCartCustomizationOpen] = useState(false);
  const [editingCartItem, setEditingCartItem] = useState<CartItem | null>(null);
  const [cartCustomizationEnabled, setCartCustomizationEnabled] = useState(false);
  const [cartCustomizationDraft, setCartCustomizationDraft] = useState('');
  const [additionalRemarks, setAdditionalRemarks] = useState('');
  const [pendingItems, setPendingItems] = useState<PendingReplenishItem[]>([]);

  // Load the full category tree for the brand being browsed. We want the COMPLETE
  // brand catalogue here (not just what the distributor sells) so the nav can show
  // every category — the ones the distributor doesn't stock render as "Coming
  // Soon". For an AFAC distributor we scope to the brand the franchise picked
  // (selectedBrand) so the AF and AC trees don't both show (e.g. two "Accessories").
  useEffect(() => {
    const loadCategories = async () => {
      try {
        // effective brand: the picked brand (AFAC case) → else the franchise's own brand
        const effectiveBrand = selectedBrand || franchiseProfile?.allowed_brands;
        const params = (effectiveBrand === 'AF' || effectiveBrand === 'AC') ? `?brand=${effectiveBrand}` : '';
        const res = await api.get(`/catalog/categories${params}`);
        const cats = res.data.success ? res.data.categories : [];
        setAllCategories(cats);
      } catch (err) {
        console.error("Failed to load category hierarchy:", err);
      }
    };
    loadCategories();
  }, [franchiseProfile?.allowed_brands, selectedBrand]);

  // Only show parent categories that actually have at least one orderable
  // product (i.e. their own category or a descendant's has stock for this
  // franchise) — otherwise franchises see categories from the full catalogue
  // that their assigned distributor(s) aren't allowed to sell.
  useEffect(() => {
    if (allCategories.length === 0) {
      setMainCategories([]);
      return;
    }

    const getDescendantIds = (catId: string): string[] => {
      const directChildren = allCategories.filter(c => c.parentId === catId);
      const childIds = directChildren.map(c => c.id);
      const grandchildIds = directChildren.flatMap(c => getDescendantIds(c.id));
      return [catId, ...childIds, ...grandchildIds];
    };

    const priority = ["seat cover", "accessories", "mat"];
    // Show EVERY top-level brand category in the nav (whether or not the selected
    // distributor stocks it). Categories with no orderable products just render a
    // "Coming Soon" empty state in the product area when clicked — handled there,
    // NOT hidden or disabled here.
    const main = allCategories
      .filter(c => !c.parentId)
      .sort((a, b) => {
        const aName = a.name.toLowerCase();
        const bName = b.name.toLowerCase();
        const aIndex = priority.findIndex(p => aName.includes(p));
        const bIndex = priority.findIndex(p => bName.includes(p));
        if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
        if (aIndex !== -1) return -1;
        if (bIndex !== -1) return 1;
        return aName.localeCompare(bName);
      });
    setMainCategories(main);
  }, [allCategories, visibleStock]);

  const getCategoryIcon = (name: string) => {
    const lowerName = name.toLowerCase();
    if (lowerName.includes('seat')) return <Car className="h-4 w-4 inline mr-1.5 text-slate-500 group-hover:text-orange-500" />;
    if (lowerName.includes('accessori')) return <Settings className="h-4 w-4 inline mr-1.5 text-slate-500 group-hover:text-orange-500" />;
    if (lowerName.includes('mat')) return <LayoutList className="h-4 w-4 inline mr-1.5 text-slate-500 group-hover:text-orange-500" />;
    if (lowerName.includes('light')) return <Lightbulb className="h-4 w-4 inline mr-1.5 text-slate-500 group-hover:text-orange-500" />;
    if (lowerName.includes('audio') || lowerName.includes('security')) return <Volume2 className="h-4 w-4 inline mr-1.5 text-slate-500 group-hover:text-orange-500" />;
    if (lowerName.includes('care') || lowerName.includes('fragrance')) return <Wind className="h-4 w-4 inline mr-1.5 text-slate-500 group-hover:text-orange-500" />;
    return <LayoutList className="h-4 w-4 inline mr-1.5 text-slate-500 group-hover:text-orange-500" />;
  };

  const categoryHasVisibleProduct = (catId: string, allCats: Category[]): boolean => {
    const visibleCategoryIds = new Set(visibleStock.map((item: any) => item.category_id).filter(Boolean));
    if (visibleCategoryIds.has(catId)) return true;
    const directChildren = allCats.filter(c => c.parentId === catId);
    return directChildren.some(c => categoryHasVisibleProduct(c.id, allCats));
  };

  // Recursive component for multilevel dropdowns
  const NavDropdown = ({ category, allCats, level = 0 }: { category: Category, allCats: Category[], level?: number }) => {
    const children = allCats
      .filter(c => c.parentId === category.id)
      .filter(c => categoryHasVisibleProduct(c.id, allCats));
    const [isOpen, setIsOpen] = useState(false);
    const icon = level === 0 ? getCategoryIcon(category.name) : null;
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
          setIsOpen(false);
        }
      };
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const isCurrentSelected = category.id === 'all'
      ? selectedCategory === null
      : selectedCategory === category.id;

    return (
      <div
        ref={dropdownRef}
        className={`relative ${level === 0 ? 'group' : ''}`}
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
      >
        <div
          className={cn(
            "flex items-center justify-between text-xs font-black uppercase tracking-wider transition-all duration-200 whitespace-nowrap cursor-pointer select-none",
            level === 0
              ? isCurrentSelected
                ? 'text-orange-500 border-b-2 border-orange-500 py-1'
                : 'text-slate-600 hover:text-orange-500 py-1'
              : isCurrentSelected
                ? 'p-2 rounded-xl bg-orange-50 text-orange-600'
                : 'p-2 rounded-xl hover:bg-slate-50 text-slate-700 hover:text-orange-500'
          )}
          onClick={(e) => {
            // Click toggles selection
            setSelectedCategory(category.id === 'all' ? null : category.id);
            setIsOpen(false);
          }}
        >
          <span className="flex items-center flex-1 pr-1">
            {icon}
            {category.name}
          </span>

          {children.length > 0 && (
            <ChevronDown className={cn(
              "h-3 w-3 ml-1.5 transition-transform shrink-0",
              level > 0 && !isOpen && "-rotate-90",
              isOpen && "rotate-180"
            )} />
          )}
        </div>

        {children.length > 0 && (
          <div
            className={cn(
              "absolute bg-white border border-slate-100 rounded-3xl shadow-xl py-2.5 min-w-[220px] transition-all duration-200 z-[9999]",
              isOpen ? "opacity-100 visible translate-y-0" : "opacity-0 invisible -translate-y-2",
              level === 0 ? "top-full left-0 mt-2" : "left-full top-0 ml-2"
            )}
          >
            {children.map(child => (
              <NavDropdown key={child.id} category={child} allCats={allCats} level={level + 1} />
            ))}
          </div>
        )}
      </div>
    );
  };

  // Orders state
  const [orders, setOrders] = useState<Order[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [receivingOrderId, setReceivingOrderId] = useState<string | null>(null);
  const [orderFilter, setOrderFilter] = useState<'all' | 'active' | 'onhold' | 'completed' | 'declined'>('all');
  const [orderSearch, setOrderSearch] = useState('');
  const [orderDateFrom, setOrderDateFrom] = useState('');
  const [orderDateTo, setOrderDateTo] = useState('');
  const [orderDistributorId, setOrderDistributorId] = useState(''); // franchise: filter by distributor

  // Distributor incoming orders state
  const [incomingOrders, setIncomingOrders] = useState<any[]>([]);
  const [loadingIncomingOrders, setLoadingIncomingOrders] = useState(false);
  const [confirmingIncomingId, setConfirmingIncomingId] = useState<string | null>(null);
  const [cancellingIncomingId, setCancellingIncomingId] = useState<string | null>(null);
  const [incomingFilter, setIncomingFilter] = useState<'all' | 'active' | 'onhold' | 'completed' | 'declined'>('all');
  const [incomingSearch, setIncomingSearch] = useState('');
  const [incomingDateFrom, setIncomingDateFrom] = useState('');
  const [incomingDateTo, setIncomingDateTo] = useState('');
  const [incomingBrand, setIncomingBrand] = useState(''); // distributor: filter by franchise brand
  const [expandedIncomingId, setExpandedIncomingId] = useState<string | null>(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportDialogFor, setExportDialogFor] = useState<'orders' | 'incoming'>('orders');
  const [selectedOrderForSheet, setSelectedOrderForSheet] = useState<any | null>(null);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [confirmNoteInput, setConfirmNoteInput] = useState('');
  const [pendingConfirmIncomingId, setPendingConfirmIncomingId] = useState<string | null>(null);
  const [declineDialogOpen, setDeclineDialogOpen] = useState(false);
  const [declineReasonInput, setDeclineReasonInput] = useState('');
  const [pendingDeclineIncomingId, setPendingDeclineIncomingId] = useState<string | null>(null);
  const [holdDialogOpen, setHoldDialogOpen] = useState(false);
  const [holdReasonInput, setHoldReasonInput] = useState('');
  const [pendingHoldIncomingId, setPendingHoldIncomingId] = useState<string | null>(null);
  const [holdingIncomingId, setHoldingIncomingId] = useState<string | null>(null);
  const [resumingIncomingId, setResumingIncomingId] = useState<string | null>(null);

  // Distributor info state
  const [distributor, setDistributor] = useState<any>(null);
  const [myDistributors, setMyDistributors] = useState<any[]>([]);
  const [mappedFranchises, setMappedFranchises] = useState<any[]>([]);
  const [loadingMappedFranchises, setLoadingMappedFranchises] = useState(false);

  // Distributor's own inventory (self-service stock management)
  const [ownInventory, setOwnInventory] = useState<any[]>([]);
  const [loadingOwnInventory, setLoadingOwnInventory] = useState(false);
  const [stockDrafts, setStockDrafts] = useState<Record<string, string>>({});
  const [savingStockKey, setSavingStockKey] = useState<string | null>(null);
  const [savingAllStock, setSavingAllStock] = useState(false);
  const csvImportInputRef = useRef<HTMLInputElement>(null);

  // Inventory filters
  const [invSearch, setInvSearch] = useState('');
  const [invCategoryId, setInvCategoryId] = useState('');
  // Brand filter — an AFAC distributor stocks both AF and AC products, and the AF
  // and AC catalogues share product names (the AC range is a copy of the AF one),
  // so without this the list shows two same-named rows with no way to tell them
  // apart. Empty string = show all brands.
  const [invBrand, setInvBrand] = useState<'' | 'AF' | 'AC'>('');
  const [invBrandDropdownOpen, setInvBrandDropdownOpen] = useState(false);
  const invBrandDropdownRef = useRef<HTMLDivElement>(null);
  const [invShowLowStock, setInvShowLowStock] = useState(false);
  const [invCatDropdownOpen, setInvCatDropdownOpen] = useState(false);
  const [invCatExpandedParents, setInvCatExpandedParents] = useState<Set<string>>(new Set());
  const invCatDropdownRef = useRef<HTMLDivElement>(null);

  // Per-product and per-category thresholds in localStorage
  const [productThresholds, setProductThresholds] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem(PRODUCT_THRESHOLDS_KEY) || '{}'); } catch { return {}; }
  });
  const [categoryThresholds, setCategoryThresholds] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem(CATEGORY_THRESHOLDS_KEY) || '{}'); } catch { return {}; }
  });
  const [thresholdDialogOpen, setThresholdDialogOpen] = useState(false);
  // Dialog state: which scope is being edited ('category' | 'product'), drill-down selections, and drafts
  const [tdScope, setTdScope] = useState<'category' | 'product'>('category');
  const [tdParentCatId, setTdParentCatId] = useState('');
  const [tdSubCatId, setTdSubCatId] = useState('');
  const [tdProductId, setTdProductId] = useState('');
  const [tdDraft, setTdDraft] = useState<Record<string, string>>({});

  const [franchiseSearchQuery, setFranchiseSearchQuery] = useState('');
  const [selectedFranchiseVendorId, setSelectedFranchiseVendorId] = useState<string | null>(null);
  const [franchiseDropdownOpen, setFranchiseDropdownOpen] = useState(false);
  const franchiseDropdownRef = useRef<HTMLDivElement>(null);
  const [orderFilterDropdownOpen, setOrderFilterDropdownOpen] = useState(false);
  const orderFilterDropdownRef = useRef<HTMLDivElement>(null);
  const [incomingFilterDropdownOpen, setIncomingFilterDropdownOpen] = useState(false);
  const incomingFilterDropdownRef = useRef<HTMLDivElement>(null);
  const [franchiseTabDropdownOpen, setFranchiseTabDropdownOpen] = useState(false);
  const franchiseTabDropdownRef = useRef<HTMLDivElement>(null);
  const [distTabDropdownOpen, setDistTabDropdownOpen] = useState(false);
  const distTabDropdownRef = useRef<HTMLDivElement>(null);
  const [distFilterDropdownOpen, setDistFilterDropdownOpen] = useState(false);
  const distFilterDropdownRef = useRef<HTMLDivElement>(null);
  const [brandFilterDropdownOpen, setBrandFilterDropdownOpen] = useState(false);
  const brandFilterDropdownRef = useRef<HTMLDivElement>(null);
  const [distSelectorOpen, setDistSelectorOpen] = useState(false);
  const distSelectorRef = useRef<HTMLDivElement>(null);

  // Checkout dialog
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [shipping, setShipping] = useState({
    shippingAddress: '',
    shippingCity: '',
    shippingState: '',
    shippingPincode: '',
  });

  // Selection State
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  // Order-group collapse state (left list grouping for split B2B checkouts)
  const [collapsedOrderGroups, setCollapsedOrderGroups] = useState<Record<string, boolean>>({});

  // Docket ID State
  const [docketDialogOpen, setDocketDialogOpen] = useState(false);
  const [docketIdInput, setDocketIdInput] = useState('');
  const [sharingDocket, setSharingDocket] = useState(false);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (franchiseDropdownRef.current && !franchiseDropdownRef.current.contains(event.target as Node)) {
        setFranchiseDropdownOpen(false);
      }
      if (invCatDropdownRef.current && !invCatDropdownRef.current.contains(event.target as Node)) {
        setInvCatDropdownOpen(false);
      }
      if (invBrandDropdownRef.current && !invBrandDropdownRef.current.contains(event.target as Node)) {
        setInvBrandDropdownOpen(false);
      }
      if (orderFilterDropdownRef.current && !orderFilterDropdownRef.current.contains(event.target as Node)) {
        setOrderFilterDropdownOpen(false);
      }
      if (incomingFilterDropdownRef.current && !incomingFilterDropdownRef.current.contains(event.target as Node)) {
        setIncomingFilterDropdownOpen(false);
      }
      if (franchiseTabDropdownRef.current && !franchiseTabDropdownRef.current.contains(event.target as Node)) {
        setFranchiseTabDropdownOpen(false);
      }
      if (distTabDropdownRef.current && !distTabDropdownRef.current.contains(event.target as Node)) {
        setDistTabDropdownOpen(false);
      }
      if (distFilterDropdownRef.current && !distFilterDropdownRef.current.contains(event.target as Node)) {
        setDistFilterDropdownOpen(false);
      }
      if (distSelectorRef.current && !distSelectorRef.current.contains(event.target as Node)) {
        setDistSelectorOpen(false);
      }
      if (brandFilterDropdownRef.current && !brandFilterDropdownRef.current.contains(event.target as Node)) {
        setBrandFilterDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Base incoming — franchise/search/date/brand filters applied, NO status filter — used for tab counts
  const baseFilteredIncoming = incomingOrders
    .filter(order => {
      if (selectedFranchiseVendorId && String(order.vendor_id) !== String(selectedFranchiseVendorId)) return false;
      return true;
    })
    .filter(order => {
      if (!incomingSearch.trim()) return true;
      const q = incomingSearch.toLowerCase();
      return (
        order.id.toLowerCase().includes(q) ||
        (order.client_store_name || order.vendor_name || '').toLowerCase().includes(q) ||
        (order.docket_id || '').toLowerCase().includes(q)
      );
    })
    .filter((order: any) => {
      const d = new Date(order.created_at);
      if (incomingDateFrom && d < new Date(incomingDateFrom)) return false;
      if (incomingDateTo && d > new Date(incomingDateTo + 'T23:59:59')) return false;
      return true;
    })
    .filter((order: any) => {
      if (!incomingBrand) return true;
      const fb = order.franchise_brand || 'AF';
      if (incomingBrand === 'AF') return fb === 'AF' || fb === 'AFAC';
      if (incomingBrand === 'AC') return fb === 'AC' || fb === 'AFAC';
      if (incomingBrand === 'AFAC') return fb === 'AFAC';
      return true;
    });

  const filteredIncomingOrders = baseFilteredIncoming
    .filter(order => {
      if (incomingFilter === 'active') return order.status === 'processing' || order.status === 'shipped';
      if (incomingFilter === 'onhold') return order.status === 'pending';
      if (incomingFilter === 'completed') return order.status === 'delivered' || order.status === 'received';
      if (incomingFilter === 'declined') return order.status === 'cancelled';
      return true;
    })
    .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const handleShareDocket = async () => {
    if (!selectedOrderId || !docketIdInput.trim()) return;
    setSharingDocket(true);
    try {
      const res = await api.post(`/orders/${selectedOrderId}/messages`, {
        docketId: docketIdInput.trim()
      });
      if (res.data.success) {
        setDocketIdInput('');
        setDocketDialogOpen(false);
        toast({
          title: 'Docket Shared',
          description: `Docket ID ${res.data.docketId} has been linked and shared.`,
        });
        // Update local order lists docket_id so it reflects immediately in spec sheet and list card
        setOrders(prev => prev.map(o => o.id === selectedOrderId ? { ...o, docket_id: res.data.docketId } : o));
        setIncomingOrders(prev => prev.map(o => o.id === selectedOrderId ? { ...o, docket_id: res.data.docketId } : o));
      }
    } catch (err: any) {
      toast({
        title: 'Failed to share docket',
        description: getErrorMessage(err, 'Could not update docket ID.'),
        variant: 'destructive'
      });
    } finally {
      setSharingDocket(false);
    }
  };

  const selectedOrder = activeTab === 'orders'
    ? orders.find(o => o.id === selectedOrderId)
    : incomingOrders.find(o => o.id === selectedOrderId);


  // Load data on mount
  useEffect(() => {
    fetchOrders();
    fetchDistributorDetails();
    fetchMyDistributors();
  }, []);

  // franchiseProfile comes from the shared B2BCartContext (single source of
  // truth for is_distributor/is_franchise) — prefill shipping address once
  // it loads, and trigger distributor-only fetches.
  useEffect(() => {
    if (!franchiseProfile) return;

    setShipping({
      shippingAddress: franchiseProfile.address_line1 || '',
      shippingCity: franchiseProfile.city || '',
      shippingState: franchiseProfile.state || '',
      shippingPincode: franchiseProfile.postal_code || '',
    });

    if (franchiseProfile.is_distributor) {
      fetchIncomingOrders();
      fetchMappedFranchises();
      fetchOwnInventory();
      const isUserFranchise = franchiseProfile.is_franchise === undefined ? true : Boolean(franchiseProfile.is_franchise);
      if (!isUserFranchise) {
        setActiveTab('incoming');
      }
    }
  }, [franchiseProfile]);

  const fetchOwnInventory = async () => {
    setLoadingOwnInventory(true);
    try {
      const res = await api.get('/orders/distributor/inventory');
      if (res.data.success) setOwnInventory(res.data.inventory || []);
    } catch (err) {
      console.error('Failed to fetch own inventory', err);
    } finally {
      setLoadingOwnInventory(false);
    }
  };

  const stockKey = (productId: string, variationId: string | null) => `${productId}::${variationId}`;

  const handleSaveStock = async (productId: string, variationId: string | null) => {
    const key = stockKey(productId, variationId);
    const draftValue = stockDrafts[key];
    const stockQuantity = Number(draftValue);
    if (draftValue === undefined || Number.isNaN(stockQuantity) || stockQuantity < 0) {
      toast({ title: 'Invalid Quantity', description: 'Please enter a valid non-negative number.', variant: 'destructive' });
      return;
    }

    setSavingStockKey(key);
    try {
      const res = await api.put('/orders/distributor/inventory', { productId, variationId, stockQuantity });
      if (res.data.success) {
        setOwnInventory(prev => prev.map(item =>
          item.product_id === productId && item.variation_id === variationId
            ? { ...item, stock_quantity: stockQuantity }
            : item
        ));
        setStockDrafts(prev => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        toast({ title: 'Stock Updated', description: 'Your inventory has been updated.' });
      }
    } catch (err: any) {
      toast({
        title: 'Update Failed',
        description: getErrorMessage(err, 'Could not update stock.'),
        variant: 'destructive'
      });
    } finally {
      setSavingStockKey(null);
    }
  };

  // Priority: product-level → category-level → default
  const getProductThreshold = (item: any) =>
    productThresholds[item.product_id] ??
    categoryThresholds[item.category_id] ??
    categoryThresholds[item.category_parent_id] ??
    DEFAULT_PRODUCT_THRESHOLD;
  const isItemLowStock = (item: any) => Number(item.stock_quantity) <= getProductThreshold(item);
  const lowStockCount = ownInventory.filter(isItemLowStock).length;

  // Build two-level category tree from inventory items for the filter dropdown
  const invCategoryTree = (() => {
    // Only categories belonging to the selected brand — AF and AC have separate
    // (identically named) category trees, so without this the dropdown lists e.g.
    // "4 Wheeler Accessories" twice with no way to tell which brand it belongs to.
    const brandScopedInventory = invBrand
      ? ownInventory.filter((item: any) => (item.product_brand || 'AF') === invBrand)
      : ownInventory;

    // Collect all unique categories (with parent info)
    const catMap = new Map<string, { id: string; name: string; parentId: string | null; parentName: string | null }>();
    brandScopedInventory.forEach((item: any) => {
      if (!catMap.has(item.category_id)) {
        catMap.set(item.category_id, {
          id: item.category_id,
          name: item.category_name,
          parentId: item.category_parent_id || null,
          parentName: item.parent_category_name || null,
        });
      }
    });
    // Group: top-level cats that appear as parents, then sub-cats under them
    const all = Array.from(catMap.values());
    const topLevelIds = new Set(all.filter(c => c.parentId === null).map(c => c.id));
    // Also treat parents referenced by children but not in the map as virtual groups
    const parentGroupIds = new Set(all.filter(c => c.parentId !== null).map(c => c.parentId!));
    // Build groups: for each parent group, list children; standalone top-levels are their own group
    const groups: { parentId: string | null; parentName: string; children: { id: string; name: string }[] }[] = [];
    // First add parents that have children
    parentGroupIds.forEach(pid => {
      const children = all.filter(c => c.parentId === pid).sort((a, b) => a.name.localeCompare(b.name));
      if (children.length) {
        const parentName = children[0].parentName || pid;
        groups.push({ parentId: pid, parentName, children: children.map(c => ({ id: c.id, name: c.name })) });
      }
    });
    // Then add top-level cats that are NOT someone's parent (i.e. no children in inventory)
    all.filter(c => c.parentId === null && !parentGroupIds.has(c.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(c => groups.push({ parentId: null, parentName: c.name, children: [{ id: c.id, name: c.name }] }));
    // Sort groups alphabetically by parent name
    groups.sort((a, b) => a.parentName.localeCompare(b.parentName));
    return groups;
  })();

  // Brands actually present in this distributor's inventory — the brand filter is
  // only meaningful (and only shown) when they stock more than one.
  const invAvailableBrands = Array.from(
    new Set(ownInventory.map((item: any) => item.product_brand || 'AF'))
  ).sort();
  const showInvBrandFilter = invAvailableBrands.length > 1;

  // Switching brand invalidates a category picked from the other brand's tree
  // (AF and AC categories are different ids), so reset it rather than leave a
  // stale filter that matches nothing.
  useEffect(() => {
    if (!invCategoryId) return;
    const stillValid = ownInventory.some((item: any) =>
      item.category_id === invCategoryId &&
      (!invBrand || (item.product_brand || 'AF') === invBrand)
    );
    if (!stillValid) setInvCategoryId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invBrand]);

  const filteredInventory = ownInventory.filter((item: any) => {
    if (invShowLowStock && !isItemLowStock(item)) return false;
    if (invBrand && (item.product_brand || 'AF') !== invBrand) return false;
    if (invCategoryId && item.category_id !== invCategoryId) return false;
    if (invSearch) {
      const q = invSearch.toLowerCase();
      if (!item.product_name?.toLowerCase().includes(q) && !item.variation_name?.toLowerCase().includes(q) && !item.sku?.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const invCategoryLabel = (() => {
    if (!invCategoryId) return 'All Categories';
    for (const group of invCategoryTree) {
      const child = group.children.find(c => c.id === invCategoryId);
      if (child) return group.parentId ? `${group.parentName} › ${child.name}` : child.name;
    }
    return 'All Categories';
  })();

  const handleSaveAllStock = async () => {
    const entries = Object.entries(stockDrafts);
    if (entries.length === 0) return;

    setSavingAllStock(true);
    let successCount = 0;
    let failCount = 0;

    for (const [key, draftValue] of entries) {
      const stockQuantity = Number(draftValue);
      if (draftValue === undefined || Number.isNaN(stockQuantity) || stockQuantity < 0) {
        failCount++;
        continue;
      }
      const [productId, variationIdRaw] = key.split('::');
      const variationId = variationIdRaw === 'null' ? null : variationIdRaw;

      try {
        const res = await api.put('/orders/distributor/inventory', { productId, variationId, stockQuantity });
        if (res.data.success) {
          setOwnInventory(prev => prev.map(item =>
            item.product_id === productId && item.variation_id === variationId
              ? { ...item, stock_quantity: stockQuantity }
              : item
          ));
          setStockDrafts(prev => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
          successCount++;
        } else {
          failCount++;
        }
      } catch {
        failCount++;
      }
    }

    setSavingAllStock(false);
    toast({
      title: 'Bulk Update Complete',
      description: `${successCount} updated${failCount > 0 ? `, ${failCount} failed` : ''}.`,
      variant: failCount > 0 ? 'destructive' : 'default'
    });
  };

  const handleExportInventoryCSV = () => {
    // Export what's currently on screen (respects the brand/category/search filters)
    // so a brand-filtered export can be edited and re-imported without touching the
    // other brand's rows.
    if (filteredInventory.length === 0) {
      toast({ description: 'No inventory to export', variant: 'destructive' });
      return;
    }
    const exportData = filteredInventory.map((item: any) => ({
      'Product': item.product_name,
      'Brand': item.product_brand || 'AF',
      'Variation': item.variation_name || '',
      'SKU': item.sku || '',
      'Category': item.category_name || '',
      'Stock Quantity': item.stock_quantity
    }));
    const brandSuffix = invBrand ? `_${invBrand}` : '';
    downloadCSV(exportData, `inventory${brandSuffix}_${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const handleExportOrders = (scope: 'orders' | 'incoming', statusFilter: 'all' | 'active' | 'onhold' | 'completed' | 'declined') => {
    const statusMap: Record<string, string[]> = {
      all: [],
      active: ['processing', 'shipped'],
      onhold: ['pending'],
      completed: ['delivered', 'received'],
      declined: ['cancelled'],
    };
    const allowedStatuses = statusMap[statusFilter];
    const sourceList: any[] = scope === 'orders' ? baseFilteredOrders : baseFilteredIncoming;
    const rows = sourceList.filter(o => allowedStatuses.length === 0 || allowedStatuses.includes(o.status));
    if (rows.length === 0) {
      toast({ description: 'No orders match this selection', variant: 'destructive' });
      return;
    }
    const flat: Record<string, any>[] = [];
    rows.forEach(o => {
      const baseRow: Record<string, any> = {
        'Order ID': o.id,
        'Order Group': o.order_group_id || '',
        'Date': o.created_at ? new Date(o.created_at).toLocaleString() : '',
        'Status': o.status,
        'Docket Number': o.docket_id || '',
        ...(scope === 'orders'
          ? { 'Distributor': o.distributor_name || '', 'Distributor Email': o.distributor_email || '', 'Distributor Phone': o.distributor_phone || '', 'Distributor Brand': o.distributor_brand || '' }
          : { 'Franchise Store': o.client_store_name || '', 'Franchise Email': o.client_store_email || '', 'Franchise Name': o.vendor_name || '', 'Franchise Phone': o.vendor_phone || '', 'Franchise Brand': o.franchise_brand || '' }),
        'Shipping Address': o.shipping_address || '',
        'City': o.shipping_city || '',
        'State': o.shipping_state || '',
        'Pincode': o.shipping_pincode || '',
        'Total Amount': o.total_amount || '',
        'Notes / Remarks': o.additional_remarks || '',
        'Decline Reason': o.decline_reason || '',
        'Declined By': o.declined_by_role || '',
        'Declined At': o.declined_at ? new Date(o.declined_at).toLocaleString() : '',
      };
      const items: any[] = o.items || [];
      if (items.length === 0) {
        flat.push({ ...baseRow, 'Product': '', 'Variation': '', 'SKU': '', 'Qty': '', 'Unit Price': '', 'Line Total': '' });
      } else {
        items.forEach((item: any, idx: number) => {
          flat.push({
            ...(idx === 0 ? baseRow : Object.fromEntries(Object.keys(baseRow).map(k => [k, '']))),
            'Product': item.product_name || '',
            'Variation': item.variation_name || '',
            'SKU': item.sku || '',
            'Qty': item.quantity || '',
            'Unit Price': item.unit_price || '',
            'Line Total': item.total_price || '',
          });
        });
      }
    });
    const label = statusFilter === 'all' ? 'all' : statusFilter;
    downloadCSV(flat, `${scope === 'orders' ? 'orders' : 'incoming'}_${label}_${new Date().toISOString().slice(0, 10)}.csv`);
    setExportDialogOpen(false);
  };

  const handleImportInventoryCSV = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
      if (lines.length < 2) {
        toast({ title: 'Empty File', description: 'CSV must have a header row and at least one data row.', variant: 'destructive' });
        return;
      }

      const parseCsvLine = (line: string): string[] =>
        line.split(',').map(cell => cell.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));

      const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase());
      const skuIdx = headers.indexOf('sku');
      const qtyIdx = headers.indexOf('stock quantity');
      const productIdx = headers.indexOf('product');
      const brandIdx = headers.indexOf('brand');
      const variationIdx = headers.indexOf('variation');

      // Many products have no SKU, so SKU alone can't identify a row. We need
      // either a SKU or the Product name (plus Brand/Variation to disambiguate
      // the AF and AC copies, which share the same product name).
      if (qtyIdx === -1 || (skuIdx === -1 && productIdx === -1)) {
        toast({
          title: 'Invalid CSV Format',
          description: 'CSV must include "Stock Quantity" plus "Product" (and "Brand"/"Variation") or "SKU" — use Export CSV as a template.',
          variant: 'destructive'
        });
        return;
      }

      let updated = 0;
      let skipped = 0;
      let ambiguous = 0;

      const norm = (v: string | null | undefined) => String(v ?? '').trim().toLowerCase();

      for (const line of lines.slice(1)) {
        const cells = parseCsvLine(line);
        const sku = skuIdx === -1 ? '' : cells[skuIdx];
        const productName = productIdx === -1 ? '' : cells[productIdx];
        const brand = brandIdx === -1 ? '' : cells[brandIdx];
        const variation = variationIdx === -1 ? '' : cells[variationIdx];
        const qty = Number(cells[qtyIdx]);

        if (Number.isNaN(qty) || qty < 0 || (!sku && !productName)) {
          skipped++;
          continue;
        }

        // Prefer an exact SKU match; otherwise identify by product name, narrowed
        // by brand and variation when those columns are present.
        let candidates: any[] = [];
        if (sku) {
          candidates = ownInventory.filter((item: any) => norm(item.sku) === norm(sku));
        }
        if (candidates.length === 0 && productName) {
          candidates = ownInventory.filter((item: any) => norm(item.product_name) === norm(productName));
          if (brand) {
            candidates = candidates.filter((item: any) => norm(item.product_brand || 'AF') === norm(brand));
          }
          if (variation) {
            candidates = candidates.filter((item: any) => norm(item.variation_name) === norm(variation));
          }
        }

        if (candidates.length === 0) {
          skipped++;
          continue;
        }
        // Refuse to guess when a row still matches more than one product (e.g. the
        // AF and AC copies when the CSV has no Brand column) — updating the wrong
        // brand's stock silently would be worse than skipping.
        if (candidates.length > 1) {
          ambiguous++;
          skipped++;
          continue;
        }
        const matchedItem = candidates[0];

        try {
          const res = await api.put('/orders/distributor/inventory', {
            productId: matchedItem.product_id,
            variationId: matchedItem.variation_id,
            stockQuantity: qty
          });
          if (res.data.success) {
            setOwnInventory(prev => prev.map(item =>
              item.product_id === matchedItem.product_id && item.variation_id === matchedItem.variation_id
                ? { ...item, stock_quantity: qty }
                : item
            ));
            updated++;
          } else {
            skipped++;
          }
        } catch {
          skipped++;
        }
      }

      toast({
        title: 'CSV Import Complete',
        description: `${updated} updated${skipped > 0 ? `, ${skipped} skipped` : ''}${ambiguous > 0 ? ` — ${ambiguous} matched more than one product; add a "Brand" column to tell AF and AC apart` : ''}.`,
        variant: skipped > 0 && updated === 0 ? 'destructive' : 'default'
      });
    } catch (err) {
      toast({ title: 'Import Failed', description: 'Could not read the CSV file.', variant: 'destructive' });
    } finally {
      e.target.value = '';
    }
  };

  const fetchIncomingOrders = async () => {
    setLoadingIncomingOrders(true);
    try {
      const res = await api.get('/orders/distributor/incoming');
      if (res.data.success) setIncomingOrders(res.data.orders);
    } catch (err) {
      console.error('Failed to fetch incoming orders', err);
    } finally {
      setLoadingIncomingOrders(false);
    }
  };

  const handleConfirmIncoming = async (orderId: string) => {
    setConfirmingIncomingId(orderId);
    try {
      const res = await api.post(`/orders/distributor/incoming/${orderId}/confirm`);
      if (res.data.success) {
        toast({ title: 'Order Confirmed', description: res.data.message });
        setIncomingOrders(prev => prev.map(order =>
          order.id === orderId ? { ...order, status: res.data.status || 'processing' } : order
        ));
        setIncomingFilter('active');
        setSelectedOrderId(orderId);
        await fetchIncomingOrders();
        refreshStock();
        setOrders(prev => prev.map(order =>
          order.id === orderId ? { ...order, status: res.data.status || 'processing' } : order
        ));
      }
    } catch (err: any) {
      toast({
        title: 'Confirmation Failed',
        description: getErrorMessage(err, 'Could not confirm order.'),
        variant: 'destructive'
      });
    } finally {
      setConfirmingIncomingId(null);
    }
  };

  const handleOpenAddNote = (orderId: string) => {
    setPendingConfirmIncomingId(orderId);
    setConfirmNoteInput('');
    setConfirmDialogOpen(true);
  };

  const submitAddNote = async () => {
    if (!pendingConfirmIncomingId) return;
    const note = confirmNoteInput.trim();
    if (!note) {
      toast({ title: 'Note Required', description: 'Please write a note before sending.', variant: 'destructive' });
      return;
    }

    setConfirmingIncomingId(pendingConfirmIncomingId);
    try {
      const res = await api.post(`/orders/distributor/incoming/${pendingConfirmIncomingId}/note`, { note });
      if (res.data.success) {
        toast({ title: 'Note Sent', description: res.data.message });
        setIncomingOrders(prev => prev.map(order =>
          order.id === pendingConfirmIncomingId
            ? { ...order, distributor_confirmation_note: res.data.distributorConfirmationNote }
            : order
        ));
        setOrders(prev => prev.map(order =>
          order.id === pendingConfirmIncomingId
            ? { ...order, distributor_confirmation_note: res.data.distributorConfirmationNote }
            : order
        ));
        setConfirmDialogOpen(false);
        setPendingConfirmIncomingId(null);
        setConfirmNoteInput('');
      }
    } catch (err: any) {
      toast({
        title: 'Failed to Send Note',
        description: getErrorMessage(err, 'Could not send note.'),
        variant: 'destructive'
      });
    } finally {
      setConfirmingIncomingId(null);
    }
  };

  const handleCancelIncoming = async (orderId: string) => {
    setPendingDeclineIncomingId(orderId);
    setDeclineReasonInput('');
    setDeclineDialogOpen(true);
  };

  const submitIncomingDecline = async () => {
    if (!pendingDeclineIncomingId) return;
    if (!declineReasonInput.trim()) {
      toast({
        title: 'Decline Reason Required',
        description: 'Please add a reason before declining this order.',
        variant: 'destructive'
      });
      return;
    }

    setCancellingIncomingId(pendingDeclineIncomingId);
    try {
      const res = await api.post(`/orders/distributor/incoming/${pendingDeclineIncomingId}/cancel`, {
        declineReason: declineReasonInput.trim()
      });
      if (res.data.success) {
        toast({ title: 'Order Declined', description: res.data.message });
        await fetchIncomingOrders();
        refreshStock();
        setDeclineDialogOpen(false);
        setPendingDeclineIncomingId(null);
        setDeclineReasonInput('');
      }
    } catch (err: any) {
      toast({
        title: 'Decline Failed',
        description: getErrorMessage(err, 'Could not decline order.'),
        variant: 'destructive'
      });
    } finally {
      setCancellingIncomingId(null);
    }
  };

  const handleOpenHold = (orderId: string) => {
    setPendingHoldIncomingId(orderId);
    setHoldReasonInput('');
    setHoldDialogOpen(true);
  };

  const submitHold = async () => {
    if (!pendingHoldIncomingId) return;
    setHoldingIncomingId(pendingHoldIncomingId);
    try {
      const res = await api.post(`/orders/distributor/incoming/${pendingHoldIncomingId}/hold`, {
        holdReason: holdReasonInput.trim()
      });
      if (res.data.success) {
        toast({ title: 'Order On Hold', description: 'Order flagged as on hold. You can resume it any time.' });
        setIncomingOrders(prev => prev.map(o =>
          o.id === pendingHoldIncomingId ? { ...o, status: 'pending' } : o
        ));
        setIncomingFilter('onhold');
        setHoldDialogOpen(false);
        setPendingHoldIncomingId(null);
        setHoldReasonInput('');
      }
    } catch (err: any) {
      toast({
        title: 'Hold Failed',
        description: getErrorMessage(err, 'Could not put order on hold.'),
        variant: 'destructive'
      });
    } finally {
      setHoldingIncomingId(null);
    }
  };

  const handleResumeOrder = async (orderId: string) => {
    setResumingIncomingId(orderId);
    try {
      const res = await api.post(`/orders/distributor/incoming/${orderId}/confirm`);
      if (res.data.success) {
        toast({ title: 'Order Resumed', description: 'Order is now active again.' });
        setIncomingOrders(prev => prev.map(o =>
          o.id === orderId ? { ...o, status: 'processing' } : o
        ));
        setIncomingFilter('active');
        setSelectedOrderId(orderId);
      }
    } catch (err: any) {
      toast({
        title: 'Resume Failed',
        description: getErrorMessage(err, 'Could not resume order.'),
        variant: 'destructive'
      });
    } finally {
      setResumingIncomingId(null);
    }
  };

  const fetchOrders = async () => {
    setLoadingOrders(true);
    try {
      const res = await api.get('/orders/my-orders');
      if (res.data.success) setOrders(res.data.orders);
    } catch (err) {
      console.error('Failed to fetch orders', err);
    } finally {
      setLoadingOrders(false);
    }
  };

  const fetchDistributorDetails = async () => {
    try {
      const res = await api.get('/orders/distributor');
      if (res.data.success) setDistributor(res.data.distributor);
    } catch (err) {
      console.error('Failed to fetch distributor details', err);
    }
  };

  const fetchMyDistributors = async () => {
    try {
      const res = await api.get('/orders/my-distributors');
      if (res.data.success) setMyDistributors(res.data.distributors || []);
    } catch (err) {
      console.error('Failed to fetch assigned distributors', err);
    }
  };

  const fetchMappedFranchises = async () => {
    setLoadingMappedFranchises(true);
    try {
      const res = await api.get('/orders/distributor/franchises');
      if (res.data.success) {
        setMappedFranchises(res.data.franchises || []);
      }
    } catch (err) {
      console.error('Failed to fetch mapped franchises', err);
    } finally {
      setLoadingMappedFranchises(false);
    }
  };

  // â"€â"€ Rapid Replenishment helpers â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

  const replenishKey = (productId: string, variationId: string | null) => `${productId}::${variationId ?? ''}`;

  /* The product steppers change the cart directly — no separate "Add to cart"
     step, and nothing is lost on leaving the page (the cart is saved). */
  const cartQtyOf = (productId: string, variationId: string | null) =>
    cartItems.find(i => i.productId === productId && i.variationId === (variationId ?? null))?.quantity ?? 0;
  const setCartQty = (v: any, qty: number) => {
    const variationId = v.variation_id ?? null;
    if (cartItems.some(i => i.productId === v.product_id && i.variationId === variationId)) {
      updateQuantity(v.product_id, variationId, qty, true);
      return;
    }
    if (qty <= 0) return;
    addToCart({
      productId: v.product_id,
      variationId,
      productName: v.product_name,
      variationName: v.variation_name,
      price: v.price || 0,
      stockQuantity: v.stock_quantity,
      sku: v.sku,
      needsCustomization: false,
      customizationRemarks: '',
      distributorId: v.distributor_id,
      distributorName: v.distributor_name,
    }, qty, true);
  };
  /* Live stock for a cart line, from the distributor it was picked from (the
     saved cart's own stock figure is a placeholder). */
  const liveStockOf = (item: CartItem): number | undefined =>
    distributorStock.find((s: any) => s.product_id === item.productId && (s.variation_id ?? null) === item.variationId
      && (!item.distributorId || s.distributor_id === item.distributorId))?.stock_quantity;

  const getCategoryDescendants = (catId: string, allCats: Category[]): string[] => {
    const directChildren = allCats.filter(c => c.parentId === catId);
    const childIds = directChildren.map(c => c.id);
    const grandchildIds = directChildren.flatMap(c => getCategoryDescendants(c.id, allCats));
    return [catId, ...childIds, ...grandchildIds];
  };

  const isSeatCoverCategory = (categoryId?: string | null) => {
    if (!categoryId) return false;
    const seatCoverRoots = allCategories.filter(cat => cat.name.toLowerCase().includes('seat cover'));
    const seatCoverIds = new Set<string>();
    seatCoverRoots.forEach(root => {
      getCategoryDescendants(root.id, allCategories).forEach(id => seatCoverIds.add(id));
    });
    return seatCoverIds.has(categoryId);
  };

  const filteredStock = visibleStock.filter((item: any) => {
    if (selectedCategory) {
      const allowedCategories = getCategoryDescendants(selectedCategory, allCategories);
      if (!allowedCategories.includes(item.category_id)) {
        return false;
      }
    }
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      item.product_name?.toLowerCase().includes(q) ||
      item.variation_name?.toLowerCase().includes(q) ||
      item.sku?.toLowerCase().includes(q)
    );
  });

  // Group stock by product
  const grouped = filteredStock.reduce((acc: any, item: any) => {
    if (!acc[item.product_id]) {
      acc[item.product_id] = {
        product_id: item.product_id,
        product_name: item.product_name,
        product_description: item.product_description,
        additional_info: item.additional_info,
        category_id: item.category_id,
        variations: []
      };
    }
    acc[item.product_id].variations.push(item);
    return acc;
  }, {} as Record<string, { product_id: string; product_name: string; product_description?: string; additional_info?: string[]; category_id?: string; variations: any[] }>);
  /* Products with something in stock first; out-of-stock ones at the end. */
  const groupedEntries = Object.entries(grouped).sort(([, a]: [string, any], [, b]: [string, any]) =>
    Number(b.variations.some((v: any) => v.stock_quantity > 0)) - Number(a.variations.some((v: any) => v.stock_quantity > 0)));

  const addReplenishToCart = () => {
    const itemsToCustomize = [];
    for (const [key, qty] of Object.entries(replenishQtys)) {
      if (qty <= 0) continue;
      const [productId, variationPart] = key.split('::');
      const variationId = variationPart || null;
      // The same product appears once per distributor that sells its category,
      // so this must be scoped to the distributor currently being ordered from.
      // Without it, .find() returns whichever row comes first and the item gets
      // added — and later ordered — against the wrong distributor.
      const stockItem = distributorStock.find(
        (s: any) => s.product_id === productId && s.variation_id === variationId
          && (!focusedDistId || s.distributor_id === focusedDistId)
      );
      if (!stockItem) continue;
      const categoryId = stockItem.category_id || undefined;
      itemsToCustomize.push({
        productId,
        variationId,
        productName: stockItem.product_name,
        variationName: stockItem.variation_name,
        price: stockItem.price || 0,
        stockQuantity: stockItem.stock_quantity,
        sku: stockItem.sku,
        quantity: qty,
        needsCustomization: false,
        customizationRemarks: '',
        categoryId,
        categoryName: categoryId ? categoryMap[categoryId] : undefined,
        canCustomize: isSeatCoverCategory(categoryId),
        distributorId: stockItem.distributor_id,
        distributorName: stockItem.distributor_name
      });
    }
    
    if (itemsToCustomize.length === 0) {
      toast({ title: 'No Items Selected', description: 'Please select quantities before adding.', variant: 'destructive' });
      return;
    }

    if (!ENABLE_ORDER_CUSTOMIZATION) {
      // Customization step disabled — add straight to cart, same end result
      // as confirming the dialog with no customization selected.
      setPendingItems(itemsToCustomize);
      confirmCustomization(itemsToCustomize);
      return;
    }

    setPendingItems(itemsToCustomize);
    setCustomizationOpen(true);
  };

  const handleCustomizationDialogOpenChange = (open: boolean) => {
    setCustomizationOpen(open);
    if (!open) {
      setPendingItems([]);
    }
  };

  const confirmCustomization = (itemsOverride?: PendingReplenishItem[]) => {
    const items = itemsOverride || pendingItems;
    const itemCount = items.length;

    for (const item of items) {
      addToCart({
        productId: item.productId,
        variationId: item.variationId,
        productName: item.productName,
        variationName: item.variationName,
        price: item.price,
        stockQuantity: item.stockQuantity,
        sku: item.sku,
        needsCustomization: item.canCustomize && item.needsCustomization,
        customizationRemarks: item.canCustomize && item.needsCustomization ? item.customizationRemarks : '',
        distributorId: item.distributorId,
        distributorName: item.distributorName,
      }, item.quantity);
    }
    setReplenishQtys({});
    handleCustomizationDialogOpenChange(false);
    setActiveTab('cart');
    toast({
      title: 'Items Added',
      description: `${itemCount} item(s) added to cart`,
    });
  };

  const openCartCustomizationEditor = (item: CartItem) => {
    setEditingCartItem(item);
    setCartCustomizationEnabled(Boolean(item.needsCustomization));
    setCartCustomizationDraft(item.customizationRemarks || '');
    setCartCustomizationOpen(true);
  };

  const closeCartCustomizationEditor = () => {
    setCartCustomizationOpen(false);
    setEditingCartItem(null);
    setCartCustomizationEnabled(false);
    setCartCustomizationDraft('');
  };

  const saveCartCustomization = () => {
    if (!editingCartItem) return;

    updateCustomization(
      editingCartItem.productId,
      editingCartItem.variationId,
      cartCustomizationEnabled,
      cartCustomizationDraft.trim()
    );

    toast({
      title: 'Customization Updated',
      description: cartCustomizationEnabled
        ? 'Item customization details have been updated.'
        : 'Customization was removed from this item.',
    });
    closeCartCustomizationEditor();
  };

  const totalReplenishItems = Object.values(replenishQtys).reduce((s: number, v) => s + (v > 0 ? 1 : 0), 0);

  // â"€â"€ Checkout â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

  const handleCheckout = async () => {
    if (!shipping.shippingAddress || !shipping.shippingCity || !shipping.shippingState || !shipping.shippingPincode) {
      toast({ title: 'Incomplete Details', description: 'Please fill in all shipping details.', variant: 'destructive' });
      return;
    }
    setCheckingOut(true);
    const success = await checkout(shipping, additionalRemarks.trim());
    setCheckingOut(false);
    if (success) {
      setAdditionalRemarks('');
      setCheckoutOpen(false);
      setActiveTab('orders');
      await fetchOrders();
    }
  };

  const handleClearCart = () => {
    if (!confirm('Clear all items?')) return;
    clearCart();
    setAdditionalRemarks('');
    setCheckoutOpen(false);
  };

  // â"€â"€ Decline Order (admin-only legacy action) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

  const handleCancel = async (orderId: string) => {
    if (!confirm('Decline this order?')) return;
    setCancellingId(orderId);
    try {
      const res = await api.post(`/orders/${orderId}/cancel`);
      if (res.data.success) {
        toast({ title: 'Order Declined', description: res.data.message });
        await fetchOrders();
        refreshStock();
      }
    } catch (err: any) {
      toast({ title: 'Decline Failed', description: getErrorMessage(err, 'Could not decline'), variant: 'destructive' });
    } finally {
      setCancellingId(null);
    }
  };

  // â"€â"€ PDF Download â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

  const fetchInvoice = async (orderId: string, distributorName?: string) => {
    const res = await api.get(`/orders/${orderId}/pdf`, { responseType: 'blob' });
    const blob = new Blob([res.data], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // Name by distributor so a split order's invoices are tellable apart in the
    // downloads folder, where the order id alone means nothing.
    const safe = (distributorName || '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
    a.download = safe ? `Invoice-${safe}-${orderId}.pdf` : `Order-${orderId}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadPDF = async (orderId: string, distributorName?: string) => {
    try {
      await fetchInvoice(orderId, distributorName);
    } catch (err) {
      toast({ title: 'Download Failed', description: 'Could not download the invoice.', variant: 'destructive' });
    }
  };

  /**
   * One checkout across several distributors becomes one order each, so the
   * franchise would otherwise have to find every sibling row and download it
   * separately. Files stay separate — each invoice is addressed to a different
   * distributor with its own total, so merging them would muddle reconciliation.
   */
  const [downloadingGroup, setDownloadingGroup] = useState<string | null>(null);

  const handleDownloadGroup = async (orderId: string) => {
    setDownloadingGroup(orderId);
    try {
      const res = await api.get(`/orders/${orderId}/group`);
      const siblings: any[] = res.data.orders || [];
      if (siblings.length === 0) throw new Error('No invoices found');

      let failed = 0;
      for (const o of siblings) {
        try {
          await fetchInvoice(o.id, o.distributor_name);
          // Browsers drop rapid successive downloads; a short gap avoids it.
          await new Promise(r => setTimeout(r, 400));
        } catch { failed++; }
      }

      if (failed === 0) {
        toast({
          title: 'Invoices downloaded',
          description: `${siblings.length} invoice${siblings.length > 1 ? 's' : ''}, one per distributor.`
        });
      } else {
        toast({
          title: 'Some invoices failed',
          description: `${siblings.length - failed} of ${siblings.length} downloaded. Try the rest individually.`,
          variant: 'destructive'
        });
      }
    } catch (err: any) {
      toast({
        title: 'Download Failed',
        description: getErrorMessage(err, 'Could not download the invoices.'),
        variant: 'destructive'
      });
    } finally {
      setDownloadingGroup(null);
    }
  };

  // â"€â"€â"€ Stats computed â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

  const handleMarkReceived = async (orderId: string) => {
    if (!confirm('Are you sure you received this order?')) return;

    setReceivingOrderId(orderId);
    try {
      const res = await api.post(`/orders/${orderId}/received`);
      if (res.data.success) {
        setOrders(prev => prev.map(order => (
          order.id === orderId ? { ...order, status: 'delivered' } : order
        )));
        toast({
          title: 'Order Received',
          description: 'The distributor will now see this order as received.',
        });
      }
    } catch (err: any) {
      toast({
        title: 'Could not mark received',
        description: getErrorMessage(err, 'Please try again.'),
        variant: 'destructive',
      });
    } finally {
      setReceivingOrderId(null);
    }
  };

  const isUserDistributor = Boolean(franchiseProfile?.is_distributor);
  const isUserFranchise = franchiseProfile?.is_franchise === undefined ? true : Boolean(franchiseProfile?.is_franchise);

  const cartQty = cartItems.reduce((s, i) => s + i.quantity, 0);
  /* Open orders: placed and not yet received or declined. The same number in
     the header, the Orders tab badge and on each distributor chip. */
  const isOpenOrder = (o: { status: string }) => o.status === 'processing' || o.status === 'shipped' || o.status === 'pending';
  const pendingOrders = orders.filter(isOpenOrder).length;
  const selectedFranchise = mappedFranchises.find((franchise: any) => String(franchise.vendor_id) === String(selectedFranchiseVendorId)) || null;
  const filteredMappedFranchises = mappedFranchises.filter((franchise: any) => {
    if (!franchiseSearchQuery.trim()) return true;
    const q = franchiseSearchQuery.toLowerCase();
    return (
      franchise.store_name?.toLowerCase().includes(q) ||
      franchise.store_email?.toLowerCase().includes(q) ||
      franchise.city?.toLowerCase().includes(q) ||
      franchise.state?.toLowerCase().includes(q) ||
      String(franchise.phone_number || '').toLowerCase().includes(q)
    );
  });

  // Base orders — search/date/distributor applied, NO status filter — used for tab counts
  const baseFilteredOrders = orders
    .filter(order => {
      if (!orderSearch.trim()) return true;
      const q = orderSearch.toLowerCase();
      return (
        order.id.toLowerCase().includes(q) ||
        (order.distributor_name || '').toLowerCase().includes(q) ||
        (order.docket_id || '').toLowerCase().includes(q)
      );
    })
    .filter(order => {
      const d = new Date(order.created_at);
      if (orderDateFrom && d < new Date(orderDateFrom)) return false;
      if (orderDateTo && d > new Date(orderDateTo + 'T23:59:59')) return false;
      return true;
    })
    .filter(order => {
      if (orderDistributorId && (order as any).distributor_id !== orderDistributorId) return false;
      return true;
    });

  const filteredOrders = baseFilteredOrders
    .filter(order => {
      if (orderFilter === 'active') return order.status === 'processing' || order.status === 'shipped';
      if (orderFilter === 'onhold') return order.status === 'pending';
      if (orderFilter === 'completed') return order.status === 'delivered' || order.status === 'received';
      if (orderFilter === 'declined') return order.status === 'cancelled';
      return true;
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  /* Which order the details panel shows. On a wide screen, the first one in
     the list the store is looking at (search, dates, distributor and status
     all applied), kept across refreshes while it is still in that list. On a
     phone, none: the list and the details share the screen, so the store
     sees its list first and taps an order to open it. */
  const visibleOrderIds = (activeTab === 'orders' ? filteredOrders : activeTab === 'incoming' ? filteredIncomingOrders : [])
    .map((o: any) => o.id).join(',');
  useEffect(() => {
    if (activeTab !== 'orders' && activeTab !== 'incoming') { setSelectedOrderId(null); return; }
    const ids = visibleOrderIds ? visibleOrderIds.split(',') : [];
    const wide = typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches;
    setSelectedOrderId(prev => (prev && ids.includes(prev)) ? prev : (wide ? ids[0] ?? null : null));
  }, [activeTab, visibleOrderIds]);

  /* A store with a single distributor has nothing to choose: open on it. */
  const onlyDistributorId = myDistributors.length === 1 ? myDistributors[0]?.id
    : myDistributors.length === 0 && distributor?.id ? distributor.id : null;
  useEffect(() => {
    if (onlyDistributorId && !focusedDistId) setFocusedDistId(onlyDistributorId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyDistributorId]);

  // Groups a filtered order list by order_group_id for the left-panel list.
  // Singletons (null group id, or only one visible member) are returned as
  // standalone entries so they render exactly like a plain card.
  type OrderListEntry = { type: 'single'; order: any } | { type: 'group'; groupId: string; orders: any[] };
  const buildOrderListEntries = (list: any[]): OrderListEntry[] => {
    const groupOrder: string[] = [];
    const groups = new Map<string, any[]>();
    const singles: { order: any; index: number }[] = [];

    list.forEach((order, index) => {
      const gid = order.order_group_id;
      if (!gid) {
        singles.push({ order, index });
        return;
      }
      if (!groups.has(gid)) {
        groups.set(gid, []);
        groupOrder.push(gid);
      }
      groups.get(gid)!.push(order);
    });

    const entries: { entry: OrderListEntry; index: number }[] = [];
    singles.forEach(({ order, index }) => entries.push({ entry: { type: 'single', order }, index }));
    groupOrder.forEach(gid => {
      const members = groups.get(gid)!;
      const firstIndex = list.findIndex(o => o.order_group_id === gid);
      if (members.length === 1) {
        entries.push({ entry: { type: 'single', order: members[0] }, index: firstIndex });
      } else {
        entries.push({ entry: { type: 'group', groupId: gid, orders: members }, index: firstIndex });
      }
    });

    entries.sort((a, b) => a.index - b.index);
    return entries.map(e => e.entry);
  };

  const toggleOrderGroupCollapsed = (groupId: string) => {
    setCollapsedOrderGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  // â"€â"€â"€ Render â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  if (loadingProfile) {
    return (
      <div className="min-h-[60vh] bg-slate-50 flex items-center justify-center -mt-8 md:-mt-14">
        <RefreshCw className="w-8 h-8 animate-spin text-orange-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-orange-50/30 -mt-8 md:-mt-14">

      {/* â"€â"€ Header â"€â"€ */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        {isUserFranchise && (
          <div className="mb-6 bg-white border border-orange-100 rounded-3xl px-5 py-5 shadow-sm">

            {/* ── Top row: title + stat pills ── */}
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-black text-slate-900 tracking-tight">Order Management</h1>
                <p className="text-sm text-slate-500 mt-0.5">
                  {myDistributors.length > 1
                    ? <>Ordering across <span className="font-bold text-orange-600">{myDistributors.length} distributors</span></>
                    : <>Ordering from <span className="font-bold text-orange-600">{distributorName || 'your distributor'}</span></>
                  }
                </p>
              </div>

              {/* Mobile: compact cart icon button */}
              <button
                onClick={() => setActiveTab('cart')}
                className="sm:hidden relative flex items-center justify-center w-10 h-10 rounded-2xl bg-orange-50 border border-orange-100 text-orange-500 shrink-0 mt-0.5"
              >
                <ShoppingCart className="w-5 h-5" />
                {cartQty > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] bg-orange-500 text-white text-[10px] font-black rounded-full flex items-center justify-center px-1">
                    {cartQty}
                  </span>
                )}
              </button>

              {/* Desktop: full stat pills */}
              <div className="hidden sm:flex items-center gap-2 shrink-0">
                <div className="flex items-center gap-2.5 bg-orange-50 border border-orange-100 rounded-2xl px-4 py-2.5">
                  <ShoppingCart className="w-4 h-4 text-orange-500 shrink-0" />
                  <div>
                    <p className="text-[9px] font-black text-orange-500 uppercase tracking-widest leading-none">Cart</p>
                    <p className="text-xl font-black text-slate-800 leading-none mt-0.5">{cartQty} <span className="text-xs font-bold text-slate-400">units</span></p>
                  </div>
                </div>
                <div className="flex items-center gap-2.5 bg-amber-50 border border-amber-100 rounded-2xl px-4 py-2.5">
                  <Clock className="w-4 h-4 text-amber-500 shrink-0" />
                  <div>
                    <p className="text-[9px] font-black text-amber-500 uppercase tracking-widest leading-none">Open</p>
                    <p className="text-xl font-black text-slate-800 leading-none mt-0.5">{pendingOrders} <span className="text-xs font-bold text-slate-400">orders</span></p>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Distributor selector ── */}
            {(() => {
              const distList = myDistributors.length > 0 ? myDistributors : distributor ? [distributor] : [];
              if (distList.length === 0) return null;

              const pendingByDist: Record<string, number> = {};
              orders.forEach((o: any) => {
                if (isOpenOrder(o))
                  pendingByDist[o.distributor_id] = (pendingByDist[o.distributor_id] || 0) + 1;
              });

              const brandColor: Record<string, string> = { AF: 'bg-orange-500', AC: 'bg-blue-600', AFAC: 'bg-violet-600' };
              const focused = distList.find((d: any) => d.id === focusedDistId) || null;

              return (
                <div className="mt-4">
                  {/* Mobile — custom dropdown (same style as other dropdowns) */}
                  <div ref={distSelectorRef} className="relative sm:hidden mb-1">
                    <button
                      type="button"
                      onClick={() => setDistSelectorOpen(v => !v)}
                      className={cn(
                        'w-full h-11 flex items-center justify-between gap-3 px-4 rounded-xl border bg-white text-sm font-bold transition-colors',
                        distSelectorOpen ? 'border-orange-400 text-orange-600' : 'border-slate-200 text-slate-700'
                      )}
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        {focused ? (
                          <>
                            <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${focused.allowed_brands ? brandColor[focused.allowed_brands] || 'bg-slate-400' : 'bg-slate-400'}`} />
                            <span className="truncate">{focused.name}</span>
                            {focused.allowed_brands && (
                              <span className="text-[10px] font-black bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full shrink-0">{focused.allowed_brands}</span>
                            )}
                          </>
                        ) : (
                          <span className="text-slate-500">Select Distributor</span>
                        )}
                      </span>
                      <ChevronDown className={cn('w-4 h-4 shrink-0 text-slate-400 transition-transform', distSelectorOpen && 'rotate-180 text-orange-500')} />
                    </button>
                    {distSelectorOpen && (
                      <div className="absolute left-0 top-full mt-1.5 z-50 w-full bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
                        {focused && (
                          <button
                            type="button"
                            onClick={() => { setFocusedDistId(null); setDistSelectorOpen(false); }}
                            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-left text-slate-500 hover:bg-slate-50 border-b border-slate-100 font-medium"
                          >
                            <span className="text-xs">✕</span> Clear selection
                          </button>
                        )}
                        {distList.map((dist: any, i: number) => {
                          const isActive = focusedDistId === dist.id;
                          const pending = pendingByDist[dist.id] || 0;
                          return (
                            <button
                              key={dist.id}
                              type="button"
                              onClick={() => { setFocusedDistId(dist.id); setDistSelectorOpen(false); }}
                              className={cn(
                                'w-full flex items-center justify-between gap-3 px-4 py-3 text-sm text-left transition-colors',
                                i > 0 && 'border-t border-slate-100',
                                isActive ? 'bg-slate-900 text-white font-bold' : 'text-slate-700 hover:bg-slate-50 font-medium'
                              )}
                            >
                              <span className="flex items-center gap-2.5 min-w-0">
                                <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${dist.allowed_brands ? brandColor[dist.allowed_brands] || 'bg-slate-400' : 'bg-slate-400'}`} />
                                <span className="truncate">{dist.name}</span>
                              </span>
                              <span className="flex items-center gap-1.5 shrink-0">
                                {pending > 0 && (
                                  <span className={cn('text-[10px] font-black px-1.5 py-0.5 rounded-full', isActive ? 'bg-amber-400 text-slate-900' : 'bg-amber-100 text-amber-700')}>{pending}</span>
                                )}
                                {dist.allowed_brands && (
                                  <span className={cn('text-[10px] font-black px-1.5 py-0.5 rounded-full', isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500')}>{dist.allowed_brands}</span>
                                )}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  {/* Desktop — chips row */}
                  <div className="hidden sm:flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
                    {distList.map((dist: any) => {
                      const isActive = focusedDistId === dist.id;
                      const pending = pendingByDist[dist.id] || 0;
                      return (
                        <button
                          key={dist.id}
                          onClick={() => setFocusedDistId(isActive ? null : dist.id)}
                          className={`flex items-center gap-2 px-3.5 py-2 rounded-2xl border transition-all shrink-0 text-sm font-bold whitespace-nowrap ${
                            isActive
                              ? 'bg-slate-900 text-white border-slate-900 shadow-md'
                              : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'
                          }`}
                        >
                          <div className={`w-2 h-2 rounded-full shrink-0 ${dist.allowed_brands ? brandColor[dist.allowed_brands] || 'bg-slate-400' : 'bg-slate-400'}`} />
                          {dist.name}
                          {pending > 0 && (
                            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${isActive ? 'bg-amber-400 text-slate-900' : 'bg-amber-100 text-amber-700'}`}>
                              {pending}
                            </span>
                          )}
                          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isActive ? 'rotate-180 text-slate-400' : 'text-slate-300'}`} />
                        </button>
                      );
                    })}
                  </div>

                  {/* Expanded detail panel */}
                  {focused && (
                    <div className="mt-3 bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-4 relative overflow-hidden">
                      <div className="absolute -right-8 -top-8 w-32 h-32 rounded-full bg-white/5 pointer-events-none" />
                      <div className="absolute right-4 -bottom-6 w-20 h-20 rounded-full bg-orange-500/10 pointer-events-none" />
                      <div className="relative">
                        {/* Header row */}
                        <div className="flex items-center justify-between gap-2 mb-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-8 h-8 rounded-xl bg-orange-500/20 flex items-center justify-center shrink-0">
                              <Building2 className="w-4 h-4 text-orange-400" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-white font-black text-sm leading-tight">{focused.name}</p>
                              {focused.city && <p className="text-slate-400 text-[11px] leading-tight">{focused.city}{focused.state ? `, ${focused.state}` : ''}</p>}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {focused.allowed_brands && (
                              <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black text-white ${brandColor[focused.allowed_brands] || 'bg-slate-600'}`}>
                                {focused.allowed_brands}
                              </span>
                            )}
                            {pendingByDist[focused.id] > 0 && (
                              <span className="flex items-center gap-1 bg-amber-500/20 border border-amber-500/30 text-amber-300 text-[10px] font-black px-2 py-0.5 rounded-full">
                                <Clock className="w-2.5 h-2.5" />{pendingByDist[focused.id]} open
                              </span>
                            )}
                          </div>
                        </div>
                        {/* Contact row */}
                        <div className="flex flex-wrap gap-x-5 gap-y-1.5 mb-3">
                          {focused.phone_number && (
                            <a href={`tel:${focused.phone_number}`} className="flex items-center gap-1.5 text-slate-300 hover:text-white text-[11px] transition-colors">
                              <Phone className="w-3 h-3 shrink-0" />{focused.phone_number}
                            </a>
                          )}
                          {focused.email && (
                            <a href={`mailto:${focused.email}`} className="flex items-center gap-1.5 text-slate-300 hover:text-white text-[11px] transition-colors min-w-0">
                              <Mail className="w-3 h-3 shrink-0" /><span className="truncate">{focused.email}</span>
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── Tab strip: custom dropdown on mobile, pills on sm+ ── */}
            <div className="mt-4">
              {/* Mobile custom dropdown */}
              <div ref={franchiseTabDropdownRef} className="relative sm:hidden">
                {(() => {
                  const tabs = [
                    { value: 'replenish', label: 'Products', icon: Package,       badge: 0 },
                    { value: 'cart',      label: 'Cart',     icon: ShoppingCart,  badge: cartQty },
                    { value: 'orders',    label: 'Orders',   icon: ClipboardList, badge: pendingOrders },
                  ];
                  const current = tabs.find(t => t.value === activeTab) || tabs[0];
                  const Icon = current.icon;
                  return (
                    <>
                      <button
                        type="button"
                        onClick={() => setFranchiseTabDropdownOpen(v => !v)}
                        className={cn(
                          'w-full h-11 flex items-center justify-between gap-3 px-4 rounded-xl border bg-white text-sm font-bold transition-colors',
                          franchiseTabDropdownOpen ? 'border-orange-400 text-orange-600' : 'border-slate-200 text-slate-700'
                        )}
                      >
                        <span className="flex items-center gap-2.5">
                          <Icon className="w-4 h-4 shrink-0" />
                          <span>{current.label}</span>
                          {current.badge > 0 && (
                            <span className="text-xs font-black bg-orange-500 text-white px-2 py-0.5 rounded-full">{current.badge}</span>
                          )}
                        </span>
                        <ChevronDown className={cn('w-4 h-4 shrink-0 text-slate-400 transition-transform', franchiseTabDropdownOpen && 'rotate-180 text-orange-500')} />
                      </button>
                      {franchiseTabDropdownOpen && (
                        <div className="absolute left-0 top-full mt-1.5 z-50 w-full bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
                          {tabs.map((tab, i) => {
                            const TIcon = tab.icon;
                            const isActive = activeTab === tab.value;
                            return (
                              <button
                                key={tab.value}
                                type="button"
                                onClick={() => {
                                  if (tab.value === 'orders') { setOrderSearch(''); setOrderDateFrom(''); setOrderDateTo(''); setOrderDistributorId(''); }
                                  setActiveTab(tab.value as typeof activeTab);
                                  setFranchiseTabDropdownOpen(false);
                                }}
                                className={cn(
                                  'w-full flex items-center justify-between gap-3 px-4 py-3 text-sm text-left transition-colors',
                                  i > 0 && 'border-t border-slate-100',
                                  isActive ? 'bg-orange-50 text-orange-600 font-bold' : 'text-slate-700 hover:bg-slate-50 font-medium'
                                )}
                              >
                                <span className="flex items-center gap-2.5">
                                  <TIcon className="w-4 h-4 shrink-0" />
                                  {tab.label}
                                </span>
                                {tab.badge > 0 && (
                                  <span className={cn('text-xs font-black px-2 py-0.5 rounded-full', isActive ? 'bg-white/70 text-orange-500' : 'bg-slate-100 text-slate-500')}>{tab.badge}</span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
              {/* Desktop pill strip */}
              <div className="hidden sm:flex items-center gap-2 bg-slate-50 rounded-3xl p-1.5 w-fit border border-slate-100">
                <TabButton active={activeTab === 'replenish'} onClick={() => setActiveTab('replenish')} icon={Package} label="Products" />
                <TabButton active={activeTab === 'cart'} onClick={() => setActiveTab('cart')} icon={ShoppingCart} label="Cart" badge={cartQty} />
                <TabButton active={activeTab === 'orders'} onClick={() => { setActiveTab('orders'); setOrderSearch(''); setOrderDateFrom(''); setOrderDateTo(''); setOrderDistributorId(''); }} icon={ClipboardList} label="Orders" badge={pendingOrders} />
              </div>
            </div>
          </div>
        )}

        {isUserDistributor && !isUserFranchise && (
          <div className="mb-6 bg-white border border-orange-100 rounded-3xl px-5 py-4 shadow-sm">
            <div>
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">Distributor Dashboard</h1>
              <p className="text-sm text-slate-500 mt-0.5">Manage your inventory and incoming franchise orders</p>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mt-4">
              <div className="flex-1 min-w-0">
                {/* Mobile custom dropdown */}
                <div ref={distTabDropdownRef} className="relative sm:hidden">
                  {(() => {
                    const pendingCount = incomingOrders.filter((o: any) => o.status === 'pending').length;
                    const tabs = [
                      { value: 'inventory', label: 'Inventory', icon: Warehouse,     badge: 0 },
                      { value: 'incoming',  label: 'Incoming Orders', icon: ClipboardList, badge: pendingCount },
                    ];
                    const current = tabs.find(t => t.value === activeTab) || tabs[0];
                    const Icon = current.icon;
                    return (
                      <>
                        <button
                          type="button"
                          onClick={() => setDistTabDropdownOpen(v => !v)}
                          className={cn(
                            'w-full h-11 flex items-center justify-between gap-3 px-4 rounded-xl border bg-white text-sm font-bold transition-colors',
                            distTabDropdownOpen ? 'border-orange-400 text-orange-600' : 'border-slate-200 text-slate-700'
                          )}
                        >
                          <span className="flex items-center gap-2.5">
                            <Icon className="w-4 h-4 shrink-0" />
                            <span>{current.label}</span>
                            {current.badge > 0 && (
                              <span className="text-xs font-black bg-orange-500 text-white px-2 py-0.5 rounded-full">{current.badge}</span>
                            )}
                          </span>
                          <ChevronDown className={cn('w-4 h-4 shrink-0 text-slate-400 transition-transform', distTabDropdownOpen && 'rotate-180 text-orange-500')} />
                        </button>
                        {distTabDropdownOpen && (
                          <div className="absolute left-0 top-full mt-1.5 z-50 w-full bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
                            {tabs.map((tab, i) => {
                              const TIcon = tab.icon;
                              const isActive = activeTab === tab.value;
                              return (
                                <button
                                  key={tab.value}
                                  type="button"
                                  onClick={() => {
                                    if (tab.value === 'incoming') { setIncomingSearch(''); setIncomingDateFrom(''); setIncomingDateTo(''); setIncomingBrand(''); }
                                    setActiveTab(tab.value as typeof activeTab);
                                    setDistTabDropdownOpen(false);
                                  }}
                                  className={cn(
                                    'w-full flex items-center justify-between gap-3 px-4 py-3 text-sm text-left transition-colors',
                                    i > 0 && 'border-t border-slate-100',
                                    isActive ? 'bg-orange-50 text-orange-600 font-bold' : 'text-slate-700 hover:bg-slate-50 font-medium'
                                  )}
                                >
                                  <span className="flex items-center gap-2.5">
                                    <TIcon className="w-4 h-4 shrink-0" />
                                    {tab.label}
                                  </span>
                                  {tab.badge > 0 && (
                                    <span className={cn('text-xs font-black px-2 py-0.5 rounded-full', isActive ? 'bg-white/70 text-orange-500' : 'bg-slate-100 text-slate-500')}>{tab.badge}</span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
                {/* Desktop pill strip */}
                <div className="hidden sm:flex items-center gap-2 bg-slate-50 rounded-3xl p-1.5 w-fit border border-slate-100">
                  <TabButton active={activeTab === 'inventory'} onClick={() => setActiveTab('inventory')} icon={Warehouse} label="Inventory" />
                  <TabButton active={activeTab === 'incoming'} onClick={() => { setActiveTab('incoming'); setIncomingSearch(''); setIncomingDateFrom(''); setIncomingDateTo(''); setIncomingBrand(''); }} icon={ClipboardList} label="Incoming Orders" badge={incomingOrders.filter((o: any) => o.status === 'pending').length} />
                </div>
              </div>
              {activeTab === 'inventory' && (
                <button
                  onClick={() => { setTdParentCatId(''); setTdSubCatId(''); setTdProductId(''); setTdDraft({}); setThresholdDialogOpen(true); }}
                  className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl border border-slate-200 bg-white hover:border-orange-300 hover:bg-orange-50 transition-all group text-slate-500 hover:text-orange-500 w-full sm:w-auto justify-center sm:justify-start shrink-0"
                >
                  <div className="w-6 h-6 rounded-lg bg-rose-50 group-hover:bg-orange-100 flex items-center justify-center transition-colors shrink-0">
                    <AlertCircle className="w-3.5 h-3.5 text-rose-500 group-hover:text-orange-500 transition-colors" />
                  </div>
                  <div className="text-left">
                    <p className="text-[10px] font-black uppercase tracking-wider leading-none">Stock Alerts</p>
                    <p className="text-[10px] text-slate-400 group-hover:text-orange-400 mt-0.5 leading-none">Set per-product thresholds</p>
                  </div>
                  <span className="text-[9px] text-slate-300 group-hover:text-orange-300 ml-1">⚙</span>
                </button>
              )}
            </div>
          </div>
        )}

        {activeTab === 'inventory' && isUserDistributor && (
          <div>
            {/* Low-stock threshold dialog */}
            {thresholdDialogOpen && (() => {
              // ── shared data ──────────────────────────────────────────────
              // Scope to the brand selected in the inventory filter — AF and AC have
              // separate, identically-named category trees, so an unscoped list would
              // show every category twice with no way to tell them apart.
              const tdInventory = invBrand
                ? ownInventory.filter((i: any) => (i.product_brand || 'AF') === invBrand)
                : ownInventory;

              const parentFromSubs = Array.from(new Map(tdInventory
                .filter((i: any) => i.category_parent_id)
                .map((i: any) => [i.category_parent_id, { id: i.category_parent_id, name: i.parent_category_name }])
              ).values());
              const topLevelCats = Array.from(new Map(tdInventory
                .filter((i: any) => !i.category_parent_id)
                .map((i: any) => [i.category_id, { id: i.category_id, name: i.category_name }])
              ).values());
              const allParents = Array.from(new Map([...topLevelCats, ...parentFromSubs].map(p => [p.id, p])).values())
                .sort((a, b) => a.name.localeCompare(b.name));

              const subCats = tdParentCatId ? Array.from(new Map(tdInventory
                .filter((i: any) => i.category_parent_id === tdParentCatId)
                .map((i: any) => [i.category_id, { id: i.category_id, name: i.category_name }])
              ).values()).sort((a, b) => a.name.localeCompare(b.name)) : [];

              const parentIsLeaf = tdParentCatId && subCats.length === 0;
              const activeCatId = parentIsLeaf ? tdParentCatId : tdSubCatId;

              const productsInCat = activeCatId ? Array.from(new Map(tdInventory
                .filter((i: any) => i.category_id === activeCatId)
                .map((i: any) => [i.product_id, { id: i.product_id, name: i.product_name }])
              ).values()).sort((a, b) => a.name.localeCompare(b.name)) : [];

              // ── save handler ─────────────────────────────────────────────
              const saveScope = () => {
                if (tdScope === 'category' && activeCatId) {
                  const v = parseInt(tdDraft['__cat__'] ?? '', 10);
                  const updCat = { ...categoryThresholds };
                  if (!isNaN(v) && v >= 1) updCat[activeCatId] = v;
                  else delete updCat[activeCatId];
                  setCategoryThresholds(updCat);
                  localStorage.setItem(CATEGORY_THRESHOLDS_KEY, JSON.stringify(updCat));
                } else if (tdScope === 'product' && tdProductId) {
                  const v = parseInt(tdDraft['__prod__'] ?? '', 10);
                  const updProd = { ...productThresholds };
                  if (!isNaN(v) && v >= 1) updProd[tdProductId] = v;
                  else delete updProd[tdProductId];
                  setProductThresholds(updProd);
                  localStorage.setItem(PRODUCT_THRESHOLDS_KEY, JSON.stringify(updProd));
                }
                toast({ title: 'Threshold Saved', description: 'Stock alert threshold has been updated.' });
                setThresholdDialogOpen(false);
              };

              const resetNav = () => { setTdParentCatId(''); setTdSubCatId(''); setTdProductId(''); setTdDraft({}); };

              // ── what step are we on ───────────────────────────────────────
              // step 0: choose scope (category vs product)
              // step 1: pick parent cat
              // step 2: pick sub-cat (if exists) — for category scope: also show set-threshold panel
              // step 3 (product scope only): pick product → set threshold
              const atScopeSelect = !tdParentCatId;
              const atThreshold = !!activeCatId;
              const atProductPick = tdScope === 'product' && activeCatId && !tdProductId;
              const atProductThreshold = tdScope === 'product' && !!tdProductId;

              const selectedProduct = tdProductId ? productsInCat.find(p => p.id === tdProductId) : null;
              const catThresholdCurrent = activeCatId ? (categoryThresholds[activeCatId] ?? null) : null;
              const prodThresholdCurrent = tdProductId ? (productThresholds[tdProductId] ?? null) : null;

              return (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) setThresholdDialogOpen(false); }}>
                  <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">

                    {/* Header */}
                    <div className="bg-gradient-to-br from-orange-500 to-amber-500 px-6 py-5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
                            <AlertCircle className="w-5 h-5 text-white" />
                          </div>
                          <div>
                            <h3 className="text-white font-black text-base">Stock Alert Thresholds</h3>
                            <p className="text-orange-100 text-xs mt-0.5">Product overrides win over category · default is {DEFAULT_PRODUCT_THRESHOLD} units</p>
                          </div>
                        </div>
                        <button onClick={() => setThresholdDialogOpen(false)} className="text-white/60 hover:text-white text-xl leading-none ml-4">×</button>
                      </div>
                    </div>

                    <div className="px-6 py-5 space-y-4">

                      {/* Scope toggle — always visible */}
                      <div className="flex gap-2 bg-slate-100 rounded-xl p-1">
                        {(['category', 'product'] as const).map(s => (
                          <button key={s} onClick={() => { setTdScope(s); setTdParentCatId(''); setTdSubCatId(''); setTdProductId(''); setTdDraft({}); }}
                            className={`flex-1 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all ${tdScope === s ? 'bg-white text-orange-500 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                            {s === 'category' ? '🗂 By Category' : '📦 By Product'}
                          </button>
                        ))}
                      </div>

                      {/* Breadcrumb */}
                      {tdParentCatId && (
                        <div className="flex items-center gap-1.5 text-xs flex-wrap">
                          <button onClick={resetNav} className="text-orange-500 font-bold hover:underline">All</button>
                          <span className="text-slate-300">›</span>
                          <button onClick={() => { setTdSubCatId(''); setTdProductId(''); setTdDraft({}); }} className={`font-bold transition-colors ${tdSubCatId || tdProductId ? 'text-orange-500 hover:underline' : 'text-slate-700'}`}>
                            {allParents.find(p => p.id === tdParentCatId)?.name}
                          </button>
                          {tdSubCatId && <><span className="text-slate-300">›</span><button onClick={() => { setTdProductId(''); setTdDraft({}); }} className={`font-bold transition-colors ${tdProductId ? 'text-orange-500 hover:underline' : 'text-slate-700'}`}>{subCats.find(s => s.id === tdSubCatId)?.name}</button></>}
                          {tdProductId && <><span className="text-slate-300">›</span><span className="font-bold text-slate-700 truncate max-w-[140px]">{selectedProduct?.name}</span></>}
                        </div>
                      )}

                      {/* STEP 1 — pick parent category */}
                      {atScopeSelect && (
                        <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">Select Category</p>
                          <div className="space-y-1 max-h-60 overflow-y-auto">
                            {allParents.map(cat => {
                              const hasCatRule = categoryThresholds[cat.id] !== undefined;
                              return (
                                <button key={cat.id} onClick={() => { setTdParentCatId(cat.id); setTdSubCatId(''); setTdProductId(''); setTdDraft({}); }}
                                  className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl border border-slate-100 hover:border-orange-300 hover:bg-orange-50 text-sm font-bold text-slate-700 transition-all group">
                                  <span>{cat.name}</span>
                                  <div className="flex items-center gap-2">
                                    {hasCatRule && <span className="text-[10px] text-orange-500 font-bold bg-orange-50 border border-orange-100 px-1.5 py-0.5 rounded-full">{categoryThresholds[cat.id]}u</span>}
                                    <ChevronDown className="w-4 h-4 text-slate-300 group-hover:text-orange-400 -rotate-90" />
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* STEP 2 — pick sub-category (when parent has children) */}
                      {tdParentCatId && !parentIsLeaf && !tdSubCatId && (
                        <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">Select Sub-Category</p>
                          <div className="space-y-1 max-h-60 overflow-y-auto">
                            {subCats.map(sub => {
                              const hasCatRule = categoryThresholds[sub.id] !== undefined;
                              return (
                                <button key={sub.id} onClick={() => { setTdSubCatId(sub.id); setTdProductId(''); setTdDraft({}); }}
                                  className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl border border-slate-100 hover:border-orange-300 hover:bg-orange-50 text-sm font-bold text-slate-700 transition-all group">
                                  <span>{sub.name}</span>
                                  <div className="flex items-center gap-2">
                                    {hasCatRule && <span className="text-[10px] text-orange-500 font-bold bg-orange-50 border border-orange-100 px-1.5 py-0.5 rounded-full">{categoryThresholds[sub.id]}u</span>}
                                    <ChevronDown className="w-4 h-4 text-slate-300 group-hover:text-orange-400 -rotate-90" />
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* STEP 3a — CATEGORY scope: show threshold input for the selected category */}
                      {atThreshold && tdScope === 'category' && (
                        <div className="space-y-3">
                          <div className="bg-orange-50 border border-orange-100 rounded-xl px-4 py-4">
                            <p className="text-[10px] font-black text-orange-600 uppercase tracking-wider mb-1">Alert threshold for this category</p>
                            <p className="text-[11px] text-slate-500 mb-3">All products in this category will use this limit unless a product-level override exists.</p>
                            <div className="flex items-center gap-2">
                              <div className="relative flex-1">
                                <Input
                                  type="number" min={1} max={9999} autoFocus
                                  placeholder={catThresholdCurrent !== null ? String(catThresholdCurrent) : `Default ${DEFAULT_PRODUCT_THRESHOLD}`}
                                  value={tdDraft['__cat__'] ?? (catThresholdCurrent !== null ? String(catThresholdCurrent) : '')}
                                  onChange={e => setTdDraft({ __cat__: e.target.value })}
                                  className="h-11 text-lg font-black text-center rounded-xl border-orange-200 focus-visible:ring-orange-500 bg-white pr-14"
                                />
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">units</span>
                              </div>
                              {catThresholdCurrent !== null && (
                                <button onClick={() => {
                                  const upd = { ...categoryThresholds }; delete upd[activeCatId!];
                                  setCategoryThresholds(upd); localStorage.setItem(CATEGORY_THRESHOLDS_KEY, JSON.stringify(upd));
                                  setTdDraft({});
                                  toast({ title: 'Threshold Reset', description: 'Category alert threshold reverted to default.' });
                                }} className="h-11 px-3 rounded-xl border border-rose-200 text-rose-400 hover:bg-rose-50 text-xs font-bold transition-colors whitespace-nowrap">
                                  Reset
                                </button>
                              )}
                            </div>
                            {catThresholdCurrent !== null && !tdDraft['__cat__'] && (
                              <p className="text-[10px] text-orange-500 font-bold mt-2">Currently set to {catThresholdCurrent} units</p>
                            )}
                          </div>
                        </div>
                      )}

                      {/* STEP 3b — PRODUCT scope: pick a product from the active category */}
                      {atProductPick && (
                        <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">Select Product</p>
                          <div className="space-y-1 max-h-56 overflow-y-auto">
                            {productsInCat.map(prod => {
                              const hasProdRule = productThresholds[prod.id] !== undefined;
                              return (
                                <button key={prod.id} onClick={() => { setTdProductId(prod.id); setTdDraft({}); }}
                                  className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl border border-slate-100 hover:border-orange-300 hover:bg-orange-50 text-sm font-bold text-slate-700 transition-all group">
                                  <span className="truncate text-left">{prod.name}</span>
                                  <div className="flex items-center gap-2 shrink-0">
                                    {hasProdRule && <span className="text-[10px] text-orange-500 font-bold bg-orange-50 border border-orange-100 px-1.5 py-0.5 rounded-full">{productThresholds[prod.id]}u</span>}
                                    <ChevronDown className="w-4 h-4 text-slate-300 group-hover:text-orange-400 -rotate-90" />
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* STEP 4 — PRODUCT scope: set threshold for selected product */}
                      {atProductThreshold && (
                        <div className="space-y-3">
                          <div className="bg-orange-50 border border-orange-100 rounded-xl px-4 py-4">
                            <p className="text-[10px] font-black text-orange-600 uppercase tracking-wider mb-1">Alert threshold for this product</p>
                            <p className="text-[11px] text-slate-500 mb-3">Overrides any category-level rule for <span className="font-bold text-slate-700">{selectedProduct?.name}</span>.</p>
                            <div className="flex items-center gap-2">
                              <div className="relative flex-1">
                                <Input
                                  type="number" min={1} max={9999} autoFocus
                                  placeholder={prodThresholdCurrent !== null ? String(prodThresholdCurrent) : `Default ${DEFAULT_PRODUCT_THRESHOLD}`}
                                  value={tdDraft['__prod__'] ?? (prodThresholdCurrent !== null ? String(prodThresholdCurrent) : '')}
                                  onChange={e => setTdDraft({ __prod__: e.target.value })}
                                  className="h-11 text-lg font-black text-center rounded-xl border-orange-200 focus-visible:ring-orange-500 bg-white pr-14"
                                />
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">units</span>
                              </div>
                              {prodThresholdCurrent !== null && (
                                <button onClick={() => {
                                  const upd = { ...productThresholds }; delete upd[tdProductId];
                                  setProductThresholds(upd); localStorage.setItem(PRODUCT_THRESHOLDS_KEY, JSON.stringify(upd));
                                  setTdDraft({});
                                  toast({ title: 'Threshold Reset', description: 'Product alert threshold reverted to default.' });
                                }} className="h-11 px-3 rounded-xl border border-rose-200 text-rose-400 hover:bg-rose-50 text-xs font-bold transition-colors whitespace-nowrap">
                                  Reset
                                </button>
                              )}
                            </div>
                            {prodThresholdCurrent !== null && !tdDraft['__prod__'] && (
                              <p className="text-[10px] text-orange-500 font-bold mt-2">Currently set to {prodThresholdCurrent} units</p>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Footer */}
                      <div className="flex gap-2 pt-1">
                        <button onClick={() => setThresholdDialogOpen(false)}
                          className="flex-1 h-10 rounded-xl border border-slate-200 text-sm font-bold text-slate-500 hover:bg-slate-50 transition-colors">
                          Close
                        </button>
                        {((tdScope === 'category' && activeCatId && tdDraft['__cat__']) ||
                          (tdScope === 'product' && tdProductId && tdDraft['__prod__'])) && (
                          <button onClick={saveScope}
                            className="flex-1 h-10 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-black transition-colors">
                            Save
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-2">
              {/* Title + low stock pill */}
              <h2 className="font-black text-slate-800 text-base flex items-center gap-2 flex-wrap">
                Your Inventory ({filteredInventory.length}{filteredInventory.length !== ownInventory.length ? ` of ${ownInventory.length}` : ''})
                {lowStockCount > 0 && (
                  <button
                    onClick={() => setInvShowLowStock(v => !v)}
                    className={`text-[10px] font-bold px-2 py-1 rounded-full border transition-colors ${invShowLowStock ? 'bg-rose-600 text-white border-rose-600' : 'text-rose-600 bg-rose-50 border-rose-100 hover:bg-rose-100'}`}
                  >
                    {lowStockCount} low stock{invShowLowStock ? ' ×' : ''}
                  </button>
                )}
              </h2>
              {/* Action buttons — icon+label on sm+, icon-only on mobile */}
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={handleExportInventoryCSV}
                  className="h-9 px-3 text-xs font-bold rounded-xl border-slate-200"
                  title="Export CSV"
                >
                  <Download className="w-3.5 h-3.5 sm:mr-2" />
                  <span className="hidden sm:inline">Export CSV</span>
                </Button>
                <Button
                  variant="outline"
                  onClick={() => csvImportInputRef.current?.click()}
                  className="h-9 px-3 text-xs font-bold rounded-xl border-slate-200"
                  title="Import CSV"
                >
                  <Upload className="w-3.5 h-3.5 sm:mr-2" />
                  <span className="hidden sm:inline">Import CSV</span>
                </Button>
                <input ref={csvImportInputRef} type="file" accept=".csv" className="hidden" onChange={handleImportInventoryCSV} />
                {Object.keys(stockDrafts).length > 0 && (
                  <Button
                    onClick={handleSaveAllStock}
                    disabled={savingAllStock}
                    className="bg-orange-500 hover:bg-orange-600 text-white rounded-xl h-9 px-3 sm:px-4 text-xs font-black"
                  >
                    {savingAllStock ? <RefreshCw className="w-3.5 h-3.5 animate-spin sm:mr-2" /> : null}
                    <span className="hidden sm:inline">Save All ({Object.keys(stockDrafts).length})</span>
                    <span className="sm:hidden">{Object.keys(stockDrafts).length}</span>
                  </Button>
                )}
                <button
                  onClick={fetchOwnInventory}
                  disabled={loadingOwnInventory}
                  className="flex items-center gap-2 px-3 sm:px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 text-xs font-bold hover:bg-slate-50 transition-all"
                  title="Refresh"
                >
                  <RefreshCw className={cn('w-4 h-4', loadingOwnInventory && 'animate-spin')} />
                  <span className="hidden sm:inline">Refresh</span>
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-xl px-4 py-2.5 mb-4 text-blue-700 text-xs font-medium">
              <Info className="w-4 h-4 shrink-0" />
              You can only stock products from categories your admin has assigned to you. New products are added by the admin; you manage quantity only.
            </div>

            {/* Search + category filters */}
            {ownInventory.length > 0 && (
              <div className="flex flex-col sm:flex-row gap-2 mb-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    value={invSearch}
                    onChange={e => setInvSearch(e.target.value)}
                    placeholder="Search products, variations, SKU..."
                    className="pl-9 rounded-xl border-slate-200 focus-visible:ring-orange-500 h-9 text-sm"
                  />
                </div>
                {/* Brand filter — only for distributors stocking more than one brand */}
                {showInvBrandFilter && (
                  <div ref={invBrandDropdownRef} className="relative">
                    <button
                      type="button"
                      onClick={() => setInvBrandDropdownOpen(v => !v)}
                      className={`h-9 flex items-center gap-2 rounded-xl border px-3 pr-2.5 bg-white text-sm font-medium transition-colors w-full sm:min-w-[130px] ${invBrand ? 'border-orange-400 text-orange-600' : 'border-slate-200 text-slate-700'}`}
                    >
                      <span className="flex-1 text-left truncate">
                        {invBrand === 'AF' ? 'Autoform (AF)' : invBrand === 'AC' ? 'Autocruze (AC)' : 'All Brands'}
                      </span>
                      <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${invBrandDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {invBrandDropdownOpen && (
                      <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-lg min-w-[160px] py-1">
                        <button
                          type="button"
                          onClick={() => { setInvBrand(''); setInvBrandDropdownOpen(false); }}
                          className={`w-full text-left px-4 py-2 text-sm transition-colors ${!invBrand ? 'bg-orange-50 text-orange-600 font-bold' : 'text-slate-700 hover:bg-slate-50'}`}
                        >
                          All Brands
                        </button>
                        {(['AF', 'AC'] as const)
                          .filter(b => invAvailableBrands.includes(b))
                          .map(b => (
                            <button
                              key={b}
                              type="button"
                              onClick={() => { setInvBrand(b); setInvBrandDropdownOpen(false); }}
                              className={`w-full text-left px-4 py-2 text-sm transition-colors ${invBrand === b ? 'bg-orange-50 text-orange-600 font-bold' : 'text-slate-700 hover:bg-slate-50'}`}
                            >
                              {b === 'AF' ? 'Autoform (AF)' : 'Autocruze (AC)'}
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                )}
                {/* Custom collapsible category dropdown */}
                <div ref={invCatDropdownRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setInvCatDropdownOpen(v => !v)}
                    className={`h-9 flex items-center gap-2 rounded-xl border px-3 pr-2.5 bg-white text-sm font-medium transition-colors w-full sm:min-w-[200px] ${invCategoryId ? 'border-orange-400 text-orange-600' : 'border-slate-200 text-slate-700'}`}
                  >
                    <span className="flex-1 text-left truncate">{invCategoryLabel}</span>
                    <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${invCatDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {invCatDropdownOpen && (
                    <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-lg min-w-[220px] py-1 max-h-72 overflow-y-auto">
                      {/* All Categories option */}
                      <button
                        type="button"
                        onClick={() => { setInvCategoryId(''); setInvCatDropdownOpen(false); }}
                        className={`w-full text-left px-4 py-2 text-sm transition-colors ${!invCategoryId ? 'bg-orange-50 text-orange-600 font-bold' : 'text-slate-700 hover:bg-slate-50'}`}
                      >
                        All Categories
                      </button>
                      <div className="border-t border-slate-100 my-1" />
                      {invCategoryTree.map(group => (
                        group.children.length === 1 && group.parentId === null ? (
                          // Standalone — no expand needed
                          <button
                            key={group.children[0].id}
                            type="button"
                            onClick={() => { setInvCategoryId(group.children[0].id); setInvCatDropdownOpen(false); }}
                            className={`w-full text-left px-4 py-2 text-sm transition-colors ${invCategoryId === group.children[0].id ? 'bg-orange-50 text-orange-600 font-bold' : 'text-slate-700 hover:bg-slate-50'}`}
                          >
                            {group.parentName}
                          </button>
                        ) : (
                          // Parent with subcategories — collapsible
                          <div key={group.parentId ?? group.parentName}>
                            <button
                              type="button"
                              onClick={() => setInvCatExpandedParents(prev => {
                                const next = new Set(prev);
                                const key = group.parentId ?? group.parentName;
                                next.has(key) ? next.delete(key) : next.add(key);
                                return next;
                              })}
                              className="w-full text-left px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50 flex items-center justify-between transition-colors"
                            >
                              <span>{group.parentName}</span>
                              <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${invCatExpandedParents.has(group.parentId ?? group.parentName) ? 'rotate-180' : ''}`} />
                            </button>
                            {invCatExpandedParents.has(group.parentId ?? group.parentName) && (
                              <div className="border-l-2 border-orange-100 ml-4">
                                {group.children.map(child => (
                                  <button
                                    key={child.id}
                                    type="button"
                                    onClick={() => { setInvCategoryId(child.id); setInvCatDropdownOpen(false); }}
                                    className={`w-full text-left px-4 py-2 text-sm transition-colors ${invCategoryId === child.id ? 'bg-orange-50 text-orange-600 font-bold' : 'text-slate-600 hover:bg-slate-50'}`}
                                  >
                                    {child.name}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      ))}
                    </div>
                  )}
                </div>
                {(invSearch || invCategoryId || invShowLowStock) && (
                  <button
                    onClick={() => { setInvSearch(''); setInvCategoryId(''); setInvShowLowStock(false); }}
                    className="h-9 px-3 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-500 hover:bg-slate-50 whitespace-nowrap"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            )}

            {loadingOwnInventory ? (
              <div className="flex items-center justify-center py-20">
                <RefreshCw className="w-8 h-8 animate-spin text-orange-400" />
              </div>
            ) : ownInventory.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400 bg-white border border-slate-100 rounded-2xl shadow-sm">
                <Warehouse className="w-16 h-16 mb-4 opacity-30" />
                <p className="font-bold text-lg text-slate-600">No allowed products yet</p>
                <p className="text-sm mt-1">Ask your admin to assign product categories to your account.</p>
              </div>
            ) : filteredInventory.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400 bg-white border border-slate-100 rounded-2xl shadow-sm">
                <Search className="w-12 h-12 mb-3 opacity-30" />
                <p className="font-bold text-base text-slate-600">No products match your filters</p>
                <button onClick={() => { setInvSearch(''); setInvCategoryId(''); setInvShowLowStock(false); }} className="mt-3 text-xs text-orange-500 font-bold hover:underline">Clear filters</button>
              </div>
            ) : (
              <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 border-b border-slate-100 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                    <tr>
                      <th className="px-5 py-3">Product</th>
                      {showInvBrandFilter && <th className="px-5 py-3">Brand</th>}
                      <th className="px-5 py-3">Variation</th>
                      <th className="px-5 py-3">Category</th>
                      <th className="px-5 py-3 text-center">Current Stock</th>
                      <th className="px-5 py-3 text-right">Update Stock</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredInventory.map((item: any) => {
                      const key = stockKey(item.product_id, item.variation_id);
                      const draft = stockDrafts[key];
                      const isSaving = savingStockKey === key;
                      const threshold = getProductThreshold(item);
                      const isLowStock = Number(item.stock_quantity) <= threshold;
                      return (
                        <tr key={key} className="hover:bg-slate-50/50">
                          <td className="px-5 py-3 font-bold text-slate-800">{item.product_name}</td>
                          {showInvBrandFilter && (
                            <td className="px-5 py-3">
                              <Badge className={cn(
                                'border text-[10px] font-black',
                                (item.product_brand || 'AF') === 'AC'
                                  ? 'bg-blue-50 text-blue-700 hover:bg-blue-50 border-blue-200'
                                  : 'bg-orange-50 text-orange-700 hover:bg-orange-50 border-orange-200'
                              )}>
                                {item.product_brand || 'AF'}
                              </Badge>
                            </td>
                          )}
                          <td className="px-5 py-3 text-slate-600">{item.variation_name}</td>
                          <td className="px-5 py-3">
                            <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-100 border-slate-200">{item.category_name}</Badge>
                          </td>
                          <td className="px-5 py-3 text-center">
                            <span className={cn('font-bold', isLowStock ? 'text-rose-600' : 'text-slate-800')}>
                              {item.stock_quantity}
                            </span>
                            {isLowStock && (
                              <Badge className="ml-2 bg-rose-50 text-rose-600 hover:bg-rose-50 border-rose-100 text-[9px] px-1.5 py-0">
                                Low
                              </Badge>
                            )}
                          </td>
                          <td className="px-5 py-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Input
                                type="number"
                                min={0}
                                value={draft !== undefined ? draft : ''}
                                placeholder={String(item.stock_quantity)}
                                onChange={e => setStockDrafts(prev => ({ ...prev, [key]: e.target.value }))}
                                className="w-24 h-9 rounded-xl border-slate-200 text-right"
                              />
                              <Button
                                size="sm"
                                disabled={isSaving || draft === undefined}
                                onClick={() => handleSaveStock(item.product_id, item.variation_id)}
                                className="bg-orange-500 hover:bg-orange-600 text-white rounded-xl h-9 px-3 text-xs font-black"
                              >
                                {isSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : 'Save'}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
        {/* TAB 1: RAPID REPLENISHMENT GRID                           */}
        {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
        {activeTab === 'replenish' && isUserFranchise && (
          <div>
            {/* Toolbar */}
            <div className="flex flex-row items-center justify-between gap-2 mb-5">
              <div className="relative flex-1 min-w-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search products..."
                  className="pl-9 rounded-xl border-slate-200 focus-visible:ring-orange-500"
                />
              </div>
              {isUserFranchise && (
                <div className="flex items-center shrink-0">
                  <Button
                    onClick={() => setActiveTab('cart')}
                    disabled={cartItems.length === 0}
                    className="bg-orange-500 hover:bg-orange-600 text-white rounded-xl px-3 sm:px-5 py-2.5 text-xs font-black"
                  >
                    <ShoppingCart className="w-4 h-4 mr-1.5 sm:mr-2" />
                    <span className="hidden sm:inline">View cart{cartItems.length ? ` (${cartItems.length})` : ''}</span>
                    <span className="sm:hidden">{cartItems.length || ''}</span>
                  </Button>
                </div>
              )}
            </div>

            {/* Category selector */}
            {mainCategories.length > 0 && (
              <>
                {/* Mobile — horizontal scrollable chips */}
                <div className="sm:hidden flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 mb-4">
                  <button
                    onClick={() => setSelectedCategory(null)}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-black uppercase tracking-wider whitespace-nowrap shrink-0 border transition-all',
                      selectedCategory === null
                        ? 'bg-orange-500 text-white border-orange-500 shadow-md'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-orange-300'
                    )}
                  >
                    All
                  </button>
                  {mainCategories.map(cat => (
                    <button
                      key={cat.id}
                      onClick={() => setSelectedCategory(selectedCategory === cat.id ? null : cat.id)}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-black uppercase tracking-wider whitespace-nowrap shrink-0 border transition-all',
                        selectedCategory === cat.id
                          ? 'bg-orange-500 text-white border-orange-500 shadow-md'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-orange-300'
                      )}
                    >
                      {getCategoryIcon(cat.name)}
                      {cat.name}
                    </button>
                  ))}
                </div>
                {/* Desktop — existing hover nav dropdowns */}
                <div className={`hidden sm:flex relative bg-white border border-slate-100 rounded-3xl p-4 mb-6 shadow-sm items-center gap-x-6 gap-y-4 overflow-visible no-scrollbar ${customizationOpen || detailProductId ? 'z-0' : 'z-[100]'}`}>
                  <div className="flex items-center gap-x-6 lg:gap-x-8 flex-wrap">
                    {mainCategories.map(cat => (
                      <NavDropdown
                        key={cat.id}
                        category={cat}
                        allCats={allCategories}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Info notice + (AFAC only) brand picker */}
            <div className="flex items-center gap-3 bg-blue-50 border border-blue-100 rounded-xl px-4 py-2.5 mb-5 text-blue-700 text-xs font-medium">
              <Info className="w-4 h-4 shrink-0" />
              <span className="flex-1">
                {!isUserFranchise
                  ? "View product catalogue and variations. As a distributor, you can view the items but cannot place orders."
                  : "Set a quantity with + and it goes straight into your cart. Review the cart and request the order when you're done."
                }
              </span>
              {showBrandPicker && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] font-black uppercase tracking-wider text-blue-400">Brand</span>
                  <div className="flex items-center bg-white border border-blue-200 rounded-lg p-0.5">
                    {(['AF', 'AC'] as const).map(b => (
                      <button
                        key={b}
                        onClick={() => { setSelectedBrand(b); setSelectedCategory(null); }}
                        className={cn(
                          'px-3 py-1 rounded-md text-[11px] font-black transition-colors',
                          selectedBrand === b
                            ? b === 'AF' ? 'bg-orange-500 text-white' : 'bg-blue-600 text-white'
                            : 'text-slate-500 hover:text-slate-700'
                        )}
                      >
                        {b}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {loadingStock ? (
              <div className="flex items-center justify-center py-20">
                <RefreshCw className="w-8 h-8 animate-spin text-orange-400" />
              </div>
            ) : !focusedDistId && distributorStock.length > 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <Building2 className="w-16 h-16 mb-4 opacity-30" />
                <p className="font-bold text-lg text-slate-600">Select a distributor to start ordering</p>
                <p className="text-sm mt-1 text-center max-w-xs">
                  Choose a distributor from the selector above to see the products you can order from them.
                </p>
              </div>
            ) : Object.keys(grouped).length === 0 && selectedCategory && !searchQuery && !categoryHasVisibleProduct(selectedCategory, allCategories) ? (
              // A category IS selected but the distributor stocks nothing in it — this
              // is the "Coming Soon" case the franchise sees on clicking such a category.
              <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <Clock className="w-16 h-16 mb-4 opacity-30" />
                <p className="font-bold text-lg text-slate-600">Coming Soon</p>
                <p className="text-sm mt-1 text-center max-w-xs">
                  Your distributor doesn't stock products in this category yet. Check back soon or explore other categories.
                </p>
              </div>
            ) : Object.keys(grouped).length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <Package className="w-16 h-16 mb-4 opacity-30" />
                <p className="font-bold text-lg text-slate-600">No products available</p>
                <p className="text-sm mt-1 text-center max-w-xs">
                  {distributorStock.length === 0
                    ? 'Your distributor has no products listed yet, or no categories have been assigned. Ask your admin to set up the catalogue.'
                    : 'No products match your current search or category filter.'}
                </p>
                {distributorStock.length === 0 && (
                  <button onClick={refreshStock} className="mt-4 flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-600 text-xs font-bold hover:bg-slate-50 transition-all">
                    <RefreshCw className="w-3.5 h-3.5" /> Retry
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4 sm:gap-5">
                {groupedEntries.map(([productId, product]: [string, any]) => {
                  const images = productImages[productId] || [];
                  const mainImage = images[0];
                  const categoryName = product.category_id ? categoryMap[product.category_id] : null;
                  const variations: any[] = product.variations;
                  const inCart = variations.reduce((n: number, v: any) => n + cartQtyOf(v.product_id, v.variation_id), 0);
                  const totalStock = variations.reduce((n: number, v: any) => n + Math.max(0, Number(v.stock_quantity) || 0), 0);
                  /* One option with no real name ("Default") shows as just the product. */
                  const single = variations.length === 1 && (!hasMeaningfulOrderText(variations[0]?.variation_name) || String(variations[0]?.variation_name).trim().toLowerCase() === 'default');
                  /* Long option lists (a few products have up to 12) show three; the rest are in the details. */
                  const shown = variations.length > 4 ? variations.slice(0, 3) : variations;
                  const openDetails = () => {
                    setDetailProductId(productId);
                    setDetailImageIndex(0);
                    setDetailVariationId(variations[0]?.variation_id || null);
                  };

                  return (
                    <div
                      key={productId}
                      className={cn(
                        'group bg-white rounded-3xl overflow-hidden flex flex-col border transition-all duration-300',
                        inCart > 0
                          ? 'border-orange-300 shadow-[0_8px_30px_rgba(249,115,22,0.12)]'
                          : 'border-slate-100 shadow-sm hover:shadow-lg hover:-translate-y-0.5'
                      )}
                    >
                      {/* Picture: tap for photos and details */}
                      <button
                        type="button"
                        onClick={openDetails}
                        className="relative aspect-[4/3] bg-gradient-to-b from-slate-50 to-white flex items-center justify-center p-5 overflow-hidden"
                        aria-label={`See ${product.product_name}`}
                      >
                        {mainImage ? (
                          <img
                            src={mainImage}
                            alt={product.product_name}
                            loading="lazy"
                            className="max-h-full max-w-full object-contain transition-transform duration-500 group-hover:scale-105"
                          />
                        ) : (
                          <Package className="w-12 h-12 text-slate-200" />
                        )}
                        {categoryName && (
                          <span className="absolute top-3 left-3 max-w-[60%] truncate rounded-full bg-white/90 backdrop-blur px-2.5 py-1 text-[10px] font-bold text-slate-600 border border-slate-100">
                            {categoryName}
                          </span>
                        )}
                        {isUserFranchise && (
                          inCart > 0 ? (
                            <span className="absolute top-3 right-3 flex items-center gap-1 rounded-full bg-orange-500 px-2.5 py-1 text-[10px] font-black text-white shadow">
                              <ShoppingCart className="w-3 h-3" /> {inCart} in cart
                            </span>
                          ) : totalStock <= 0 ? (
                            <span className="absolute top-3 right-3 rounded-full bg-slate-900/75 px-2.5 py-1 text-[10px] font-bold text-white">
                              Out of stock
                            </span>
                          ) : null
                        )}
                        {images.length > 1 && (
                          <span className="absolute bottom-2.5 right-3 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-slate-500 border border-slate-100">
                            {images.length} photos
                          </span>
                        )}
                      </button>

                      <div className="flex-1 flex flex-col px-4 pt-3.5 pb-4 gap-3">
                        <button type="button" onClick={openDetails} className="text-left">
                          <h3 className="font-bold text-[15px] text-slate-900 leading-snug line-clamp-2 group-hover:text-orange-700 transition-colors">
                            {product.product_name}
                          </h3>
                          {product.product_description && (
                            <p className="text-xs text-slate-500 line-clamp-1 mt-0.5">{product.product_description}</p>
                          )}
                        </button>

                        {/* One line per option: name, stock, and Add → − n + */}
                        <div className="mt-auto space-y-1.5">
                          {shown.map((v: any) => {
                            const key = replenishKey(v.product_id, v.variation_id);
                            const qty = cartQtyOf(v.product_id, v.variation_id);
                            const stock = Number(v.stock_quantity) || 0;
                            return (
                              <div
                                key={key}
                                className={cn(
                                  'flex items-center justify-between gap-2 rounded-2xl pl-3 pr-1.5 py-1.5 transition-colors',
                                  qty > 0 ? 'bg-orange-50' : 'bg-slate-50'
                                )}
                              >
                                <div className="min-w-0">
                                  <p className="text-xs font-bold text-slate-800 truncate">
                                    {single ? 'Quantity' : (v.variation_name || 'Default')}
                                  </p>
                                  {isUserFranchise && (
                                    <p className={cn('text-[10px] font-semibold', stock > 0 ? 'text-emerald-600' : 'text-slate-400')}>
                                      {stock > 0 ? `${stock} in stock` : 'Out of stock'}
                                    </p>
                                  )}
                                </div>
                                {!isUserFranchise ? (
                                  <span className="shrink-0 text-[11px] font-semibold text-slate-400 px-2">View only</span>
                                ) : qty > 0 ? (
                                  <QuantityStepper value={qty} max={Math.max(stock, qty)} onChange={val => setCartQty(v, Math.min(val, Math.max(stock, qty)))} />
                                ) : stock > 0 ? (
                                  <button
                                    type="button"
                                    onClick={() => setCartQty(v, 1)}
                                    className="shrink-0 h-8 px-4 rounded-xl border border-orange-300 bg-white text-xs font-black text-orange-600 hover:bg-orange-500 hover:text-white hover:border-orange-500 transition-colors flex items-center gap-1"
                                  >
                                    <Plus className="w-3.5 h-3.5" /> Add
                                  </button>
                                ) : (
                                  <span className="shrink-0 text-[11px] font-semibold text-slate-400 px-2">Unavailable</span>
                                )}
                              </div>
                            );
                          })}
                          {shown.length < variations.length && (
                            <button
                              type="button"
                              onClick={openDetails}
                              className="w-full text-center text-xs font-bold text-orange-600 hover:text-orange-700 py-1.5"
                            >
                              +{variations.length - shown.length} more options
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* What is in the cart, always in reach while browsing. */}
            {isUserFranchise && cartItems.length > 0 && (
              <div className="sticky bottom-3 z-30 mt-6">
                <button
                  type="button"
                  onClick={() => setActiveTab('cart')}
                  className="w-full flex items-center justify-between gap-3 rounded-2xl bg-slate-900 text-white px-5 py-3.5 shadow-xl hover:bg-slate-800 transition-colors"
                >
                  <span className="flex items-center gap-2.5 text-sm font-bold">
                    <ShoppingCart className="w-4 h-4 text-orange-400" />
                    {cartItems.length} item{cartItems.length === 1 ? '' : 's'} · {cartQty} unit{cartQty === 1 ? '' : 's'}
                  </span>
                  <span className="flex items-center gap-1.5 text-sm font-black text-orange-300">
                    Review &amp; request order <ChevronRight className="w-4 h-4" />
                  </span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
        {/* TAB 2: CART / CHECKOUT                                    */}
        {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
        {activeTab === 'cart' && (
          <div>
            {cartItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-slate-400">
                <ShoppingCart className="w-20 h-20 mb-5 opacity-20" />
                <p className="font-black text-xl text-slate-600">Your cart is empty</p>
                <p className="text-sm mt-2 max-w-xs text-center">
                  Open Products and tap + on what you need — it comes straight here.
                </p>
                <Button
                  onClick={() => setActiveTab('replenish')}
                  className="mt-6 bg-orange-500 hover:bg-orange-600 text-white rounded-xl px-6"
                >
                  <Package className="w-4 h-4 mr-2" />
                  Browse products
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Cart Items */}
                <div className="lg:col-span-2 space-y-3">
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="font-black text-slate-800 text-base">{cartItems.length} Item{cartItems.length > 1 ? 's' : ''} in Cart</h2>
                    <button
                      onClick={handleClearCart}
                      className="text-xs text-rose-500 font-bold hover:text-rose-700 flex items-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Clear All
                    </button>
                  </div>

                  {cartItems.map((item) => {
                    const itemImage = productImages[item.productId]?.[0];
                    const stock = liveStockOf(item);
                    const overStock = stock !== undefined && item.quantity > stock;

                    return (
                      <div key={`${item.productId}-${item.variationId}`} className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm hover:shadow-md transition-all duration-300">
                        <div className="flex gap-4">
                          {/* Product Image */}
                          <div className="w-16 h-16 bg-slate-50 border border-slate-100 rounded-xl overflow-hidden shrink-0 flex items-center justify-center">
                            {itemImage ? (
                              <img
                                src={itemImage}
                                alt={item.productName}
                                className="object-contain w-full h-full p-2"
                              />
                            ) : (
                              <Package className="w-6 h-6 text-slate-300" />
                            )}
                          </div>

                          {/* Info details */}
                          <div className="flex-1 min-w-0 flex flex-col justify-between">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-black text-sm text-slate-800 leading-snug line-clamp-2">{item.productName}</p>
                                {item.distributorName && <p className="text-[11px] text-orange-600 font-bold mt-0.5">{item.distributorName}</p>}
                                <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                                  {item.variationName && (
                                    <span className="text-[10px] text-slate-500 font-bold bg-slate-100 px-1.5 py-0.5 rounded">
                                      {item.variationName}
                                    </span>
                                  )}
                                  {item.sku && (
                                    <span className="text-[10px] text-slate-400 font-mono">SKU: {item.sku}</span>
                                  )}
                                  {item.needsCustomization && (
                                    <span className="text-[10px] text-blue-600 font-bold bg-blue-50 px-1.5 py-0.5 rounded">
                                      Customization
                                    </span>
                                  )}
                                  {item.needsCustomization && (
                                    <button
                                      type="button"
                                      onClick={() => openCartCustomizationEditor(item)}
                                      className="inline-flex items-center gap-1 text-[10px] text-orange-600 font-bold bg-orange-50 hover:bg-orange-100 px-1.5 py-0.5 rounded transition-colors"
                                    >
                                      <Pencil className="w-3 h-3" />
                                      Edit
                                    </button>
                                  )}
                                </div>
                                {item.customizationRemarks && (
                                  <p className="text-[10px] text-slate-500 italic mt-1.5 bg-blue-50 p-1.5 rounded border border-blue-100 whitespace-pre-line">
                                    <span className="font-bold text-blue-700">Customization Details:</span> {item.customizationRemarks}
                                  </p>
                                )}
                              </div>
                              <button
                                onClick={() => removeFromCart(item.productId, item.variationId)}
                                className="text-slate-300 hover:text-rose-500 transition-colors shrink-0"
                              >
                                <XCircle className="w-5 h-5" />
                              </button>
                            </div>

                            <div className="flex items-center justify-between gap-3 mt-3.5 pt-2 border-t border-slate-50">
                              <span className={cn('text-[11px] font-bold', overStock ? 'text-rose-600' : 'text-slate-400')}>
                                {stock === undefined ? '' : overStock ? `Only ${stock} in stock — lower the quantity` : `${stock} in stock`}
                              </span>
                              <QuantityStepper
                                value={item.quantity}
                                max={stock !== undefined ? Math.max(stock, item.quantity) : undefined}
                                onChange={(v) => updateQuantity(item.productId, item.variationId, stock !== undefined && v > item.quantity ? Math.min(v, stock) : v, true)}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Order Summary */}
                <div className="space-y-4">
                  <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
                    <h3 className="font-black text-slate-800 mb-4">Order Summary</h3>

                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between text-slate-600">
                        <span>Total SKUs</span>
                        <span className="font-bold">{cartItems.length}</span>
                      </div>
                      <div className="flex justify-between text-slate-600">
                        <span>Total Qty</span>
                        <span className="font-bold">{cartQty} units</span>
                      </div>
                    </div>

                    <Button
                      onClick={() => setCheckoutOpen(true)}
                      className="w-full mt-5 bg-orange-500 hover:bg-orange-600 text-white rounded-xl h-12 font-black text-sm"
                    >
                      <FileText className="w-4 h-4 mr-2" />
                      Request Order
                    </Button>
                  </div>

                  <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 text-xs text-blue-700">
                    <p className="font-bold mb-1">What happens next?</p>
                    <ol className="space-y-1 list-decimal list-inside opacity-80">
                      <li>Stock is allocated immediately from live distributor inventory</li>
                      <li>Your distributor receives a PDF + email notification</li>
                      <li>Track status and any distributor notes in the Orders tab</li>
                    </ol>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
        {/* TAB 3: ORDERS — SPLIT SCREEN (List + Chat)                 */}
        {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
        {/* ── Export Dialog ─────────────────────────────────────────── */}
        {exportDialogOpen && (() => {
          const isOrders = exportDialogFor === 'orders';
          const base = isOrders ? baseFilteredOrders : baseFilteredIncoming;
          const counts = {
            all: base.length,
            active: base.filter((o: any) => o.status === 'processing' || o.status === 'shipped').length,
            onhold: base.filter((o: any) => o.status === 'pending').length,
            completed: base.filter((o: any) => o.status === 'delivered' || o.status === 'received').length,
            declined: base.filter((o: any) => o.status === 'cancelled').length,
          };
          const options: { key: 'all' | 'active' | 'onhold' | 'completed' | 'declined'; label: string; color: string; dot: string }[] = [
            { key: 'all',       label: 'All Orders',       color: 'bg-orange-50 border-orange-200 hover:border-orange-400 text-orange-700', dot: 'bg-orange-400' },
            { key: 'active',    label: 'Active',           color: 'bg-blue-50 border-blue-200 hover:border-blue-400 text-blue-700',         dot: 'bg-blue-500' },
            { key: 'onhold',    label: 'On Hold',          color: 'bg-amber-50 border-amber-200 hover:border-amber-400 text-amber-700',     dot: 'bg-amber-400' },
            { key: 'completed', label: 'Completed',        color: 'bg-emerald-50 border-emerald-200 hover:border-emerald-400 text-emerald-700', dot: 'bg-emerald-500' },
            { key: 'declined',  label: 'Declined',         color: 'bg-rose-50 border-rose-200 hover:border-rose-400 text-rose-700',         dot: 'bg-rose-500' },
          ];
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) setExportDialogOpen(false); }}>
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
                <div className="bg-gradient-to-br from-slate-800 to-slate-900 px-6 py-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center shrink-0">
                        <Download className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <h3 className="text-white font-black text-base">Export as CSV</h3>
                        <p className="text-slate-400 text-xs mt-0.5">{isOrders ? 'Your outgoing orders' : 'Incoming franchise orders'} · {base.length} total</p>
                      </div>
                    </div>
                    <button onClick={() => setExportDialogOpen(false)} className="text-slate-400 hover:text-white text-xl leading-none ml-4">×</button>
                  </div>
                </div>
                <div className="px-6 py-5">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-3">Select what to export</p>
                  <div className="space-y-2">
                    {options.map(opt => (
                      <button
                        key={opt.key}
                        onClick={() => handleExportOrders(exportDialogFor, opt.key)}
                        disabled={counts[opt.key] === 0}
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 transition-all font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed ${opt.color}`}
                      >
                        <div className="flex items-center gap-2.5">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${opt.dot}`} />
                          {opt.label}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs opacity-70">{counts[opt.key]} orders</span>
                          <Download className="w-3.5 h-3.5 opacity-60" />
                        </div>
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-4 leading-relaxed">Includes order ID, docket number, status, items, quantities, prices, shipping address, notes, decline reason and more.</p>
                </div>
              </div>
            </div>
          );
        })()}

        {activeTab === 'orders' && (() => {
          const _isOutgoing = true;
          const orderList = filteredOrders;
          const currentOrder = orders.find(o => o.id === selectedOrderId);

          return (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-black text-slate-800 text-base">All Orders ({baseFilteredOrders.length})</h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setExportDialogFor('orders'); setExportDialogOpen(true); }}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 text-xs font-bold hover:bg-slate-50 hover:border-slate-300 transition-all"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Export
                  </button>
                  <button
                    onClick={fetchOrders}
                    disabled={loadingOrders}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 text-xs font-bold hover:bg-slate-50 transition-all"
                  >
                    <RefreshCw className={cn('w-4 h-4', loadingOrders && 'animate-spin')} />
                    Refresh
                  </button>
                </div>
              </div>

              {/* Filter sub-tabs */}
              <FilterDropdown
                value={orderFilter}
                onChange={v => setOrderFilter(v as any)}
                options={ORDER_FILTER_OPTIONS}
                counts={{
                  all: baseFilteredOrders.length,
                  active: baseFilteredOrders.filter(o => o.status === 'processing' || o.status === 'shipped').length,
                  onhold: baseFilteredOrders.filter(o => o.status === 'pending').length,
                  completed: baseFilteredOrders.filter(o => o.status === 'delivered' || o.status === 'received').length,
                  declined: baseFilteredOrders.filter(o => o.status === 'cancelled').length,
                }}
                open={orderFilterDropdownOpen}
                setOpen={setOrderFilterDropdownOpen}
                dropdownRef={orderFilterDropdownRef}
              />
              {/* Desktop pill strip */}
              <div className="hidden sm:flex items-center gap-1.5 mb-3 bg-slate-50 rounded-2xl p-1 border border-slate-100 overflow-x-auto no-scrollbar">
                <button onClick={() => setOrderFilter('all')} className={cn('px-3 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-200 whitespace-nowrap shrink-0', orderFilter === 'all' ? 'bg-orange-500 text-white shadow-md' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/50')}>All ({baseFilteredOrders.length})</button>
                <button onClick={() => setOrderFilter('active')} className={cn('px-3 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-200 whitespace-nowrap shrink-0', orderFilter === 'active' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/50')}>Active ({baseFilteredOrders.filter(o => o.status === 'processing' || o.status === 'shipped').length})</button>
                <button onClick={() => setOrderFilter('onhold')} className={cn('px-3 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-200 whitespace-nowrap shrink-0', orderFilter === 'onhold' ? 'bg-amber-500 text-white shadow-md' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/50')}>On Hold ({baseFilteredOrders.filter(o => o.status === 'pending').length})</button>
                <button onClick={() => setOrderFilter('completed')} className={cn('px-3 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-200 whitespace-nowrap shrink-0', orderFilter === 'completed' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/50')}>Completed ({baseFilteredOrders.filter(o => o.status === 'delivered' || o.status === 'received').length})</button>
                <button onClick={() => setOrderFilter('declined')} className={cn('px-3 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-200 whitespace-nowrap shrink-0', orderFilter === 'declined' ? 'bg-rose-600 text-white shadow-md' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/50')}>Declined ({baseFilteredOrders.filter(o => o.status === 'cancelled').length})</button>
              </div>

              {/* Search + Date row — stacks on mobile */}
              <div className="flex flex-col sm:flex-row gap-2 mb-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <input
                    value={orderSearch}
                    onChange={e => setOrderSearch(e.target.value)}
                    placeholder="Search order ID or distributor..."
                    className="w-full pl-9 pr-3 h-9 rounded-xl border border-slate-200 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-orange-300"
                  />
                  {orderSearch && (
                    <button onClick={() => setOrderSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                      <XCircle className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <div className="flex gap-2 flex-wrap sm:flex-nowrap">
                  <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl px-3 h-9 flex-1 sm:flex-none">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider whitespace-nowrap">From</span>
                    <input type="date" value={orderDateFrom} max={orderDateTo || undefined} onChange={e => setOrderDateFrom(e.target.value)} className="text-xs text-slate-600 bg-transparent border-none outline-none min-w-0 flex-1 sm:w-[120px]" />
                  </div>
                  <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl px-3 h-9 flex-1 sm:flex-none">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider whitespace-nowrap">To</span>
                    <input type="date" value={orderDateTo} min={orderDateFrom || undefined} onChange={e => setOrderDateTo(e.target.value)} className="text-xs text-slate-600 bg-transparent border-none outline-none min-w-0 flex-1 sm:w-[120px]" />
                  </div>
                  {(orderDateFrom || orderDateTo) && (
                    <button onClick={() => { setOrderDateFrom(''); setOrderDateTo(''); }} className="text-[10px] font-bold text-orange-600 hover:text-orange-700 whitespace-nowrap self-center px-1">Clear</button>
                  )}
                </div>
                {myDistributors.length > 0 && (
                  <div ref={distFilterDropdownRef} className="relative w-full sm:w-auto">
                    <button
                      type="button"
                      onClick={() => setDistFilterDropdownOpen(v => !v)}
                      className={cn(
                        'w-full h-9 flex items-center justify-between gap-2 px-3 rounded-xl border bg-white text-xs font-bold transition-colors',
                        orderDistributorId ? 'border-orange-400 text-orange-600' : 'border-slate-200 text-slate-600',
                        distFilterDropdownOpen && 'border-orange-400 text-orange-600'
                      )}
                    >
                      <span className="truncate">
                        {orderDistributorId
                          ? (myDistributors.find((d: any) => d.id === orderDistributorId)?.name || 'Distributor')
                          : 'All Distributors'}
                      </span>
                      <ChevronDown className={cn('w-3.5 h-3.5 shrink-0 text-slate-400 transition-transform', distFilterDropdownOpen && 'rotate-180 text-orange-500')} />
                    </button>
                    {distFilterDropdownOpen && (
                      <div className="absolute right-0 top-full mt-1.5 z-50 min-w-[180px] w-full bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
                        <button
                          type="button"
                          onClick={() => { setOrderDistributorId(''); setDistFilterDropdownOpen(false); }}
                          className={cn('w-full flex items-center gap-2 px-4 py-2.5 text-xs font-bold text-left transition-colors border-b border-slate-100', !orderDistributorId ? 'bg-orange-50 text-orange-600' : 'text-slate-700 hover:bg-slate-50')}
                        >
                          All Distributors
                        </button>
                        {myDistributors.map((d: any) => (
                          <button
                            key={d.id}
                            type="button"
                            onClick={() => { setOrderDistributorId(d.id); setDistFilterDropdownOpen(false); }}
                            className={cn('w-full flex items-center justify-between gap-2 px-4 py-2.5 text-xs font-bold text-left transition-colors border-t border-slate-100', orderDistributorId === d.id ? 'bg-orange-50 text-orange-600' : 'text-slate-700 hover:bg-slate-50')}
                          >
                            <span className="truncate">{d.name}</span>
                            {d.allowed_brands && (
                              <span className="text-[10px] font-black bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full shrink-0">{d.allowed_brands}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {loadingOrders ? (
                <div className="flex items-center justify-center py-20">
                  <RefreshCw className="w-8 h-8 animate-spin text-orange-400" />
                </div>
              ) : orderList.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-400 bg-white border border-slate-100 rounded-2xl shadow-sm">
                  <ClipboardList className="w-16 h-16 mb-4 opacity-30" />
                  <p className="font-bold text-lg text-slate-600">{orderFilter === 'active' ? 'No active orders' : orderFilter === 'onhold' ? 'No orders on hold' : orderFilter === 'completed' ? 'No completed orders' : orderFilter === 'declined' ? 'No declined orders' : 'No orders yet'}</p>
                  <p className="text-sm mt-1">{orderFilter === 'all' && 'Place your first order from the Products tab.'}</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4" style={{ minHeight: 'calc(100vh - 320px)' }}>
                  {/* â"€â"€â"€ Left Panel: Order List â"€â"€â"€ */}
                  <div className={cn('md:col-span-2 space-y-2 overflow-y-auto pr-1 no-scrollbar', selectedOrderId ? 'hidden md:block' : 'block')} style={{ maxHeight: 'calc(60vh)' }}>
                    {(() => {
                      const renderOrderCard = (order: any) => {
                        const totalQty = order.items?.reduce((s: number, i: any) => s + i.quantity, 0) || 0;
                        const isSelected = selectedOrderId === order.id;
                        return (
                          <div
                            key={order.id}
                            onClick={() => setSelectedOrderId(order.id)}
                            className={cn(
                              'bg-white border rounded-2xl p-4 cursor-pointer transition-all duration-200 hover:shadow-md',
                              isSelected
                                ? 'border-orange-400 ring-2 ring-orange-200 shadow-md'
                                : 'border-slate-100 hover:border-orange-200'
                            )}
                          >
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-black text-slate-800 font-mono text-xs">#{formatOrderId(order.id)}</span>
                              <StatusBadge status={order.status} docket={(order as any).docket_id} isIncoming />
                              {order.status === 'delivered' && <ReceivedBadge />}
                            </div>
                            <div className="flex items-center gap-2 mt-1.5 text-[11px] text-slate-500">
                              <span>{new Date(order.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                              <span>-</span>
                              <span>{totalQty} units - {order.items?.length || 0} SKUs</span>
                            </div>
                            {order.items?.length > 0 && (
                              <p className="text-[11px] text-slate-700 font-semibold mt-1 line-clamp-1">
                                {order.items.slice(0, 2).map((i: any) => i.product_name).join(', ')}
                                {order.items.length > 2 ? ` +${order.items.length - 2} more` : ''}
                              </p>
                            )}
                            {order.status === 'cancelled' && (
                              <p className="text-[10px] font-bold text-rose-600 mt-1">
                                {getDeclineSourceLabel(order.declined_by_role)}
                              </p>
                            )}
                            {order.distributor_name && (
                              <p className="text-[11px] text-orange-600 font-bold mt-1">{order.distributor_name}</p>
                            )}
                            {/* Without this, the sub-orders of one checkout look like
                                unrelated orders sitting next to each other. */}
                            {Number((order as any).group_size) > 1 && (
                              <p className="text-[10px] text-slate-500 font-semibold mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-100">
                                <Package className="w-3 h-3" />
                                1 of {(order as any).group_size} - split by distributor
                              </p>
                            )}
                            {(order as any).docket_id && (
                              <p className="text-[10px] text-emerald-600 font-bold mt-1 flex items-center gap-1">
                                <Truck className="w-3 h-3" /> Docket: {(order as any).docket_id}
                              </p>
                            )}
                          </div>
                        );
                      };

                      return buildOrderListEntries(orderList).map(entry => {
                        if (entry.type === 'single') {
                          return renderOrderCard(entry.order);
                        }
                        const isCollapsed = !!collapsedOrderGroups[entry.groupId];
                        const totalUnits = entry.orders.reduce((sum, o) => sum + (o.items?.reduce((s: number, i: any) => s + i.quantity, 0) || 0), 0);
                        const placedOn = entry.orders[0]?.created_at;
                        return (
                          <div key={entry.groupId} className="rounded-2xl border border-slate-100 bg-slate-50/60 p-2">
                            <button
                              type="button"
                              onClick={() => toggleOrderGroupCollapsed(entry.groupId)}
                              className="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-left"
                            >
                              <div className="min-w-0">
                                <p className="text-xs font-black text-slate-800 truncate">
                                  Request - placed on {placedOn ? new Date(placedOn).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '-'}
                                </p>
                                <p className="text-[11px] text-orange-600 font-bold mt-0.5">
                                  {entry.orders.length} distributors - {totalUnits} total units
                                </p>
                              </div>
                              {isCollapsed ? (
                                <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />
                              ) : (
                                <ChevronUp className="w-4 h-4 text-slate-400 flex-shrink-0" />
                              )}
                            </button>
                            {!isCollapsed && (
                              <div className="mt-2 space-y-2 pl-2 border-l-2 border-orange-100">
                                {entry.orders.map(order => renderOrderCard(order))}
                              </div>
                            )}
                          </div>
                        );
                      });
                    })()}
                  </div>

                  {/* â"€â"€â"€ Right Panel: Order Details â"€â"€â"€ */}
                  <div className={cn('md:col-span-3 bg-white border border-slate-100 rounded-2xl shadow-sm flex flex-col overflow-hidden', selectedOrderId ? 'flex' : 'hidden md:flex')} style={{ maxHeight: 'calc(60vh)' }}>
                    {!selectedOrderId || !currentOrder ? (
                      <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8">
                        <ClipboardList className="w-12 h-12 mb-3 opacity-30" />
                        <p className="font-bold text-sm">Select an order to view details</p>
                      </div>
                    ) : (
                      <>
                        {/* Header */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-orange-50/30 shrink-0">
                          <div className="flex items-center gap-3 min-w-0">
                            <button onClick={() => setSelectedOrderId(null)} className="md:hidden h-8 w-8 flex items-center justify-center rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-orange-600 transition-all shrink-0">
                              <ArrowLeft className="w-4 h-4" />
                            </button>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-black text-slate-800 font-mono text-xs">#{formatOrderId(currentOrder.id)}</span>
                                <StatusBadge status={currentOrder.status} docket={currentOrder.docket_id} isIncoming />
                                {currentOrder.status === 'delivered' && <ReceivedBadge />}
                              </div>
                              <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                                {currentOrder.distributor_name || 'Distributor'} - {new Date(currentOrder.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                              </p>
                              {Number(currentOrder.group_size) > 1 && (
                                <p className="text-[11px] text-orange-600 font-semibold mt-0.5">
                                  Part of one order placed with {currentOrder.group_size} distributors
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  onClick={() => handleDownloadPDF(currentOrder.id, currentOrder.distributor_name)}
                                  className="h-8 w-8 flex items-center justify-center rounded-xl bg-white border border-slate-200 text-slate-500 hover:bg-orange-50 hover:text-orange-600 hover:border-orange-200 transition-all"
                                >
                                  <Download className="w-4 h-4" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {Number(currentOrder.group_size) > 1
                                  ? `Invoice from ${currentOrder.distributor_name || 'this distributor'} only`
                                  : 'Download invoice'}
                              </TooltipContent>
                            </Tooltip>
                            {/* Split order — one invoice per distributor, so offer them all at once */}
                            {Number(currentOrder.group_size) > 1 && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    onClick={() => handleDownloadGroup(currentOrder.id)}
                                    disabled={downloadingGroup === currentOrder.id}
                                    className="h-8 px-2.5 flex items-center gap-1.5 rounded-xl bg-orange-50 border border-orange-200 text-orange-600 hover:bg-orange-100 transition-all text-[11px] font-bold disabled:opacity-60"
                                  >
                                    {downloadingGroup === currentOrder.id
                                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                      : <Download className="w-3.5 h-3.5" />}
                                    All {currentOrder.group_size}
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>Download all {currentOrder.group_size} invoices</TooltipContent>
                              </Tooltip>
                            )}
                            {(currentOrder.status === 'shipped' || (currentOrder.status === 'processing' && Boolean(currentOrder.docket_id))) && (
                              <Button
                                size="sm"
                                onClick={() => handleMarkReceived(currentOrder.id)}
                                disabled={receivingOrderId === currentOrder.id}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs h-8 px-3"
                              >
                                {receivingOrderId === currentOrder.id ? <RefreshCw className="w-3 h-3 animate-spin mr-1" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
                                Mark Received
                              </Button>
                            )}
                          </div>
                        </div>

                        {/* Scrollable Details */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar bg-slate-50/20">
                          {currentOrder.status === 'cancelled' && (
                            <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 flex items-start gap-3">
                              <div className="h-10 w-10 bg-rose-100 rounded-xl flex items-center justify-center text-rose-600 shrink-0">
                                <Ban className="w-5 h-5" />
                              </div>
                              <div className="min-w-0">
                                <p className="text-[10px] font-black text-rose-700 uppercase tracking-wider">
                                  {getDeclineSourceLabel(currentOrder.declined_by_role)}
                                </p>
                                <p className="text-xs text-rose-700 font-bold mt-0.5">
                                  {currentOrder.decline_reason || 'No decline reason provided.'}
                                </p>
                              </div>
                            </div>
                          )}

                          {currentOrder.distributor_confirmation_note && (
                            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex items-start gap-3">
                              <div className="h-10 w-10 bg-blue-100 rounded-xl flex items-center justify-center text-blue-700 shrink-0">
                                <Info className="w-5 h-5" />
                              </div>
                              <div className="min-w-0">
                                <p className="text-[10px] font-black text-blue-700 uppercase tracking-wider">
                                  Distributor Update
                                </p>
                                <p className="text-xs text-blue-900 font-bold mt-0.5 whitespace-pre-line">
                                  {currentOrder.distributor_confirmation_note}
                                </p>
                              </div>
                            </div>
                          )}

                          {/* Shipping Docket Status Alert Box */}
                          {currentOrder.docket_id ? (
                            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-center justify-between gap-4">
                              <div className="flex items-center gap-3">
                                <div className="h-10 w-10 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-700 shrink-0">
                                  <Truck className="w-5 h-5" />
                                </div>
                                <div>
                                  <p className="text-[10px] font-black text-emerald-700 uppercase tracking-wider">Shipping Docket ID</p>
                                  <p className="text-base font-black text-slate-800 font-mono tracking-wide">{currentOrder.docket_id}</p>
                                </div>
                              </div>
                              {isUserDistributor && (
                                <Button
                                  onClick={() => {
                                    setDocketIdInput(currentOrder.docket_id || '');
                                    setDocketDialogOpen(true);
                                  }}
                                  className="h-8 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-xs font-black shadow-sm"
                                >
                                  Edit ID
                                </Button>
                              )}
                            </div>
                          ) : (
                            isUserDistributor ? (
                              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                                <div className="flex items-center gap-3">
                                  <div className="h-10 w-10 bg-amber-100 rounded-xl flex items-center justify-center text-amber-700 shrink-0">
                                    <Truck className="w-5 h-5 animate-pulse" />
                                  </div>
                                  <div>
                                    <p className="text-[10px] font-black text-amber-700 uppercase tracking-wider">Awaiting Shipment</p>
                                    <p className="text-xs text-slate-600 font-bold">No docket / tracking ID shared yet.</p>
                                  </div>
                                </div>
                                <Button
                                  onClick={() => {
                                    setDocketIdInput('');
                                    setDocketDialogOpen(true);
                                  }}
                                  className="bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-xs font-black self-start md:self-auto"
                                >
                                  Add Docket ID
                                </Button>
                              </div>
                            ) : (
                              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex items-center gap-3">
                                <div className="h-10 w-10 bg-slate-100 rounded-xl flex items-center justify-center text-slate-400 shrink-0">
                                  <Truck className="w-5 h-5" />
                                </div>
                                <div>
                                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Shipping Info</p>
                                  <p className="text-xs text-slate-600 font-bold">Awaiting shipment from your distributor.</p>
                                  {/* No docket shared, but the goods may still have come. */}
                                  {currentOrder.status === 'processing' && (
                                    <button
                                      type="button"
                                      onClick={() => handleMarkReceived(currentOrder.id)}
                                      disabled={receivingOrderId === currentOrder.id}
                                      className="mt-1 text-[11px] font-bold text-emerald-700 hover:underline disabled:opacity-50"
                                    >
                                      Already got it? Mark received
                                    </button>
                                  )}
                                </div>
                              </div>
                            )
                          )}

                          {/* Order Items */}
                          <div className="space-y-2.5">
                            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-wider pl-1">Ordered Items</h3>
                            <div className="divide-y divide-slate-100 border border-slate-100 rounded-2xl overflow-hidden bg-white shadow-sm">
                              {currentOrder.items?.map((item: any) => {
                                const img = item.product_id ? productImages[item.product_id]?.[0] : null;
                                return (
                                  <div key={item.id} className="flex items-center gap-3 p-3 hover:bg-slate-50/50 transition-colors">
                                    <div className="w-12 h-12 bg-slate-50 border border-slate-100 rounded-lg overflow-hidden shrink-0 flex items-center justify-center">
                                      {img ? (
                                        <img src={img} alt={item.product_name} className="object-contain w-full h-full p-1" />
                                      ) : (
                                        <Package className="w-6 h-6 text-slate-300" />
                                      )}
                                    </div>
                                    
                                    <div className="flex-1 min-w-0">
                                      <p className="text-xs font-black text-slate-800 uppercase tracking-wide truncate">{item.product_name}</p>
                                      {hasMeaningfulOrderText(item.variation_name)
                                       && (
                                        <p className="text-[10px] text-slate-400 font-bold mt-0.5">{item.variation_name}</p>
                                      )}
                                      {Number(item.needs_customization) === 1 && (
  <p className="text-[10px] text-blue-600 font-bold mt-1">
    Need Customization
  </p>
)}
                                      {/* {item.needs_customization && null} */}
                                      {hasMeaningfulOrderText(item.customization_remarks) && (
                                        <p className="text-[10px] text-slate-500 italic mt-1 bg-slate-50 p-1.5 rounded border border-slate-100 leading-normal whitespace-pre-line">
                                          Customization Details: {item.customization_remarks}
                                        </p>
                                      )}
                                    </div>
                                    <div className="text-right shrink-0">
                                      <span className="text-xs font-black text-slate-800 bg-slate-100 px-2 py-1 rounded-md">x {item.quantity}</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          {/* Shipping Destination */}
                          <div className="space-y-2.5">
                            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-wider pl-1">Delivery Destination</h3>
                            <div className="bg-white border border-slate-100 rounded-2xl p-4 text-xs text-slate-700 shadow-sm space-y-1">
                              <p className="font-bold text-slate-900">{currentOrder.shipping_address}</p>
                              <p>{currentOrder.shipping_city}, {currentOrder.shipping_state}</p>
                              <p className="font-mono font-bold text-slate-500 mt-1">PIN: {currentOrder.shipping_pincode}</p>
                            </div>
                          </div>

                          {/* Assigned Distributor Details */}
                          <div className="space-y-2.5">
                            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-wider pl-1">Assigned Distributor</h3>
                            <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
                              <p className="text-xs font-black text-slate-800 uppercase tracking-wide">{currentOrder.distributor_name || 'Distributor Partner'}</p>
                              <div className="flex flex-col gap-1.5 text-xs text-slate-500 mt-2">
                                {currentOrder.distributor_phone && <span className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5 text-slate-400" /> {currentOrder.distributor_phone}</span>}
                                {currentOrder.distributor_email && <span className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5 text-slate-400" /> {currentOrder.distributor_email}</span>}
                              </div>
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
        {/* TAB 4: INCOMING ORDERS — SPLIT SCREEN (List + Chat)        */}
        {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
        {activeTab === 'incoming' && isUserDistributor && (() => {
          const filteredIncoming = filteredIncomingOrders;
          const currentIncoming = incomingOrders.find((o: any) => o.id === selectedOrderId);

          return (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-black text-slate-800 text-sm sm:text-base">Incoming Orders ({baseFilteredIncoming.length})</h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setExportDialogFor('incoming'); setExportDialogOpen(true); }}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 text-xs font-bold hover:bg-slate-50 hover:border-slate-300 transition-all"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Export
                  </button>
                  <button
                    onClick={fetchIncomingOrders}
                    disabled={loadingIncomingOrders}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 text-xs font-bold hover:bg-slate-50 transition-all"
                  >
                    <RefreshCw className={cn('w-4 h-4', loadingIncomingOrders && 'animate-spin')} />
                    Refresh
                  </button>
                </div>
              </div>

              {/* Filter sub-tabs */}
              <FilterDropdown
                value={incomingFilter}
                onChange={v => setIncomingFilter(v as any)}
                options={ORDER_FILTER_OPTIONS}
                counts={{
                  all: baseFilteredIncoming.length,
                  active: baseFilteredIncoming.filter((o: any) => o.status === 'processing' || o.status === 'shipped').length,
                  onhold: baseFilteredIncoming.filter((o: any) => o.status === 'pending').length,
                  completed: baseFilteredIncoming.filter((o: any) => o.status === 'delivered' || o.status === 'received').length,
                  declined: baseFilteredIncoming.filter((o: any) => o.status === 'cancelled').length,
                }}
                open={incomingFilterDropdownOpen}
                setOpen={setIncomingFilterDropdownOpen}
                dropdownRef={incomingFilterDropdownRef}
              />
              {/* Desktop pill strip */}
              <div className="hidden sm:flex items-center gap-1.5 mb-3 bg-slate-50 rounded-2xl p-1 border border-slate-100 overflow-x-auto no-scrollbar">
                <button onClick={() => setIncomingFilter('all')} className={cn('px-3 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-200 whitespace-nowrap shrink-0', incomingFilter === 'all' ? 'bg-orange-500 text-white shadow-md' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/50')}>All ({baseFilteredIncoming.length})</button>
                <button onClick={() => setIncomingFilter('active')} className={cn('px-3 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-200 whitespace-nowrap shrink-0', incomingFilter === 'active' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/50')}>Active ({baseFilteredIncoming.filter((o: any) => o.status === 'processing' || o.status === 'shipped').length})</button>
                <button onClick={() => setIncomingFilter('onhold')} className={cn('px-3 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-200 whitespace-nowrap shrink-0', incomingFilter === 'onhold' ? 'bg-amber-500 text-white shadow-md' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/50')}>On Hold ({baseFilteredIncoming.filter((o: any) => o.status === 'pending').length})</button>
                <button onClick={() => setIncomingFilter('completed')} className={cn('px-3 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-200 whitespace-nowrap shrink-0', incomingFilter === 'completed' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/50')}>Completed ({baseFilteredIncoming.filter((o: any) => o.status === 'delivered' || o.status === 'received').length})</button>
                <button onClick={() => setIncomingFilter('declined')} className={cn('px-3 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-200 whitespace-nowrap shrink-0', incomingFilter === 'declined' ? 'bg-rose-600 text-white shadow-md' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/50')}>Declined ({baseFilteredIncoming.filter((o: any) => o.status === 'cancelled').length})</button>
              </div>

              {/* Search + Date row — stacks on mobile */}
              <div className="flex flex-col sm:flex-row gap-2 mb-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <input
                    value={incomingSearch}
                    onChange={e => setIncomingSearch(e.target.value)}
                    placeholder="Search order ID or franchise store..."
                    className="w-full pl-9 pr-3 h-9 rounded-xl border border-slate-200 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-orange-300"
                  />
                  {incomingSearch && (
                    <button onClick={() => setIncomingSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                      <XCircle className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <div className="flex gap-2 flex-wrap sm:flex-nowrap">
                  <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl px-3 h-9 flex-1 sm:flex-none">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider whitespace-nowrap">From</span>
                    <input type="date" value={incomingDateFrom} max={incomingDateTo || undefined} onChange={e => setIncomingDateFrom(e.target.value)} className="text-xs text-slate-600 bg-transparent border-none outline-none min-w-0 flex-1 sm:w-[120px]" />
                  </div>
                  <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl px-3 h-9 flex-1 sm:flex-none">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider whitespace-nowrap">To</span>
                    <input type="date" value={incomingDateTo} min={incomingDateFrom || undefined} onChange={e => setIncomingDateTo(e.target.value)} className="text-xs text-slate-600 bg-transparent border-none outline-none min-w-0 flex-1 sm:w-[120px]" />
                  </div>
                  {(incomingDateFrom || incomingDateTo) && (
                    <button onClick={() => { setIncomingDateFrom(''); setIncomingDateTo(''); }} className="text-[10px] font-bold text-orange-600 hover:text-orange-700 whitespace-nowrap self-center px-1">Clear</button>
                  )}
                  <div ref={brandFilterDropdownRef} className="relative w-full sm:w-auto">
                    {(() => {
                      // Only offer brand filters this distributor actually carries.
                      // AFAC distributors see all; AF/AC-only distributors see just
                      // "All Brands" + their own brand.
                      const myBrand = franchiseProfile?.allowed_brands || 'AFAC';
                      const allBrandOpts = [
                        { value: '', label: 'All Brands' },
                        { value: 'AF', label: 'Autoform', tag: 'AF' },
                        { value: 'AC', label: 'Autocruze', tag: 'AC' },
                        { value: 'AFAC', label: 'AFAC Franchises', tag: 'AFAC' },
                      ];
                      const brandOpts = myBrand === 'AFAC'
                        ? allBrandOpts
                        : allBrandOpts.filter(b => b.value === '' || b.value === myBrand);
                      const current = brandOpts.find(b => b.value === incomingBrand) || brandOpts[0];
                      return (
                        <>
                          <button
                            type="button"
                            onClick={() => setBrandFilterDropdownOpen(v => !v)}
                            className={cn(
                              'w-full h-9 flex items-center justify-between gap-2 px-3 rounded-xl border bg-white text-xs font-bold transition-colors',
                              incomingBrand ? 'border-orange-400 text-orange-600' : 'border-slate-200 text-slate-600',
                              brandFilterDropdownOpen && 'border-orange-400 text-orange-600'
                            )}
                          >
                            <span className="flex items-center gap-1.5">
                              {current.tag && <span className="text-[10px] font-black bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full">{current.tag}</span>}
                              {current.label}
                            </span>
                            <ChevronDown className={cn('w-3.5 h-3.5 shrink-0 text-slate-400 transition-transform', brandFilterDropdownOpen && 'rotate-180 text-orange-500')} />
                          </button>
                          {brandFilterDropdownOpen && (
                            <div className="absolute right-0 top-full mt-1.5 z-50 min-w-[160px] w-full bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
                              {brandOpts.map((opt, i) => (
                                <button
                                  key={opt.value}
                                  type="button"
                                  onClick={() => { setIncomingBrand(opt.value); setBrandFilterDropdownOpen(false); }}
                                  className={cn(
                                    'w-full flex items-center justify-between gap-2 px-4 py-2.5 text-xs font-bold text-left transition-colors',
                                    i > 0 && 'border-t border-slate-100',
                                    incomingBrand === opt.value ? 'bg-orange-50 text-orange-600' : 'text-slate-700 hover:bg-slate-50'
                                  )}
                                >
                                  <span>{opt.label}</span>
                                  {opt.tag && (
                                    <span className={cn('text-[10px] font-black px-1.5 py-0.5 rounded-full', incomingBrand === opt.value ? 'bg-white/70 text-orange-500' : 'bg-slate-100 text-slate-500')}>{opt.tag}</span>
                                  )}
                                </button>
                              ))}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>

              <div ref={franchiseDropdownRef} className="mb-4 max-w-2xl">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">Mapped Franchise Store</p>
                  {selectedFranchiseVendorId && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedFranchiseVendorId(null);
                        setFranchiseSearchQuery('');
                        setFranchiseDropdownOpen(false);
                      }}
                      className="text-[11px] font-bold text-orange-600 hover:text-orange-700"
                    >
                      Clear filter
                    </button>
                  )}
                </div>

                <p className="mb-2 text-[11px] text-slate-500">
                  {selectedFranchise
                    ? <>Filtering orders for <span className="font-bold text-orange-600">{selectedFranchise.store_name}</span></>
                    : `Showing all ${mappedFranchises.length || 0} mapped franchise stores`}
                </p>

                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    value={franchiseSearchQuery}
                    onChange={(e) => {
                      setFranchiseSearchQuery(e.target.value);
                      setFranchiseDropdownOpen(true);
                      if (!e.target.value.trim()) {
                        setSelectedFranchiseVendorId(null);
                      }
                    }}
                    onFocus={() => setFranchiseDropdownOpen(true)}
                    placeholder="Search mapped franchise stores..."
                    className="pl-10 pr-12 h-12 rounded-2xl border-slate-200 bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => setFranchiseDropdownOpen(prev => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <ChevronDown className={cn('w-4 h-4 transition-transform', franchiseDropdownOpen && 'rotate-180')} />
                  </button>
                </div>

                {franchiseDropdownOpen && (
                  <div className="mt-2 rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedFranchiseVendorId(null);
                        setFranchiseSearchQuery('');
                        setFranchiseDropdownOpen(false);
                      }}
                      className={cn(
                        'w-full px-4 py-3 text-left text-sm font-bold border-b border-slate-100 hover:bg-orange-50 transition-colors',
                        !selectedFranchiseVendorId ? 'text-orange-600 bg-orange-50/60' : 'text-slate-700'
                      )}
                    >
                      All mapped franchises
                    </button>

                    {loadingMappedFranchises ? (
                      <div className="px-4 py-6 text-sm text-slate-500 flex items-center gap-2">
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Loading franchises...
                      </div>
                    ) : filteredMappedFranchises.length > 0 ? (
                      <div className="max-h-72 overflow-y-auto">
                        {filteredMappedFranchises.map((franchise: any) => {
                          const isActive = String(franchise.vendor_id) === String(selectedFranchiseVendorId);
                          return (
                            <button
                              type="button"
                              key={franchise.vendor_id}
                              onClick={() => {
                                setSelectedFranchiseVendorId(String(franchise.vendor_id));
                                setFranchiseSearchQuery(franchise.store_name || '');
                                setFranchiseDropdownOpen(false);
                              }}
                              className={cn(
                                'w-full px-4 py-3 text-left border-b border-slate-100 last:border-b-0 hover:bg-slate-50 transition-colors',
                                isActive && 'bg-orange-50'
                              )}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="font-bold text-slate-800 truncate">{franchise.store_name || 'Franchise Store'}</p>
                                  <p className="text-[11px] text-slate-500 truncate">
                                    {[franchise.city, franchise.state].filter(Boolean).join(', ') || franchise.store_email || 'Mapped franchise'}
                                  </p>
                                </div>
                                {isActive && <span className="text-[10px] font-black uppercase tracking-wider text-orange-600">Selected</span>}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="px-4 py-6 text-sm text-slate-500">No mapped franchises found.</div>
                    )}
                  </div>
                )}
              </div>

              {loadingIncomingOrders ? (
                <div className="flex items-center justify-center py-20">
                  <RefreshCw className="w-8 h-8 animate-spin text-orange-400" />
                </div>
              ) : filteredIncoming.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-400 bg-white border border-slate-100 rounded-2xl shadow-sm px-6">
                  <ClipboardList className="w-16 h-16 mb-4 opacity-30" />
                  <p className="font-bold text-lg text-slate-600 text-center">{incomingFilter === 'active' ? 'No active orders' : incomingFilter === 'onhold' ? 'No orders on hold' : incomingFilter === 'completed' ? 'No completed orders' : incomingFilter === 'declined' ? 'No declined orders' : 'No incoming orders yet'}</p>
                  <p className="text-sm mt-1 text-center max-w-[220px]">Orders submitted by franchise stores will appear here.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4" style={{ minHeight: 'calc(100vh - 320px)' }}>
                  {/* Left Panel: Order List */}
                  <div className={cn('md:col-span-2 space-y-2 overflow-y-auto pr-1 no-scrollbar', selectedOrderId ? 'hidden md:block' : 'block')} style={{ maxHeight: 'calc(60vh)' }}>
                    {(() => {
                      const renderIncomingCard = (order: any) => {
                        const totalQty = order.items?.reduce((s: number, i: any) => s + i.quantity, 0) || 0;
                        const isSelected = selectedOrderId === order.id;
                        return (
                          <div
                            key={order.id}
                            onClick={() => setSelectedOrderId(order.id)}
                            className={cn(
                              'bg-white border rounded-2xl p-4 cursor-pointer transition-all duration-200 hover:shadow-md',
                              isSelected
                                ? 'border-orange-400 ring-2 ring-orange-200 shadow-md'
                                : 'border-slate-100 hover:border-orange-200'
                            )}
                          >
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-black text-slate-800 font-mono text-xs">#{formatOrderId(order.id)}</span>
                              <StatusBadge status={order.status} docket={(order as any).docket_id} isIncoming />
                              {order.status === 'delivered' && <DeliveredBadge />}
                            </div>
                            <p className="text-[11px] text-orange-600 font-bold mt-1">{order.client_store_name || order.vendor_name || 'Unknown Store'}</p>
                            <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500">
                              <span>{new Date(order.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                              <span>-</span>
                              <span>{totalQty} units - {order.items?.length || 0} SKUs</span>
                            </div>
                            {order.items?.length > 0 && (
                              <p className="text-[11px] text-slate-700 font-semibold mt-1 line-clamp-1">
                                {order.items.slice(0, 2).map((i: any) => i.product_name).join(', ')}
                                {order.items.length > 2 ? ` +${order.items.length - 2} more` : ''}
                              </p>
                            )}
                            {order.status === 'cancelled' && (
                              <p className="text-[10px] font-bold text-rose-600 mt-1">
                                {getDeclineSourceLabel(order.declined_by_role)}
                              </p>
                            )}
                            {order.docket_id && (
                              <p className="text-[10px] text-emerald-600 font-bold mt-1 flex items-center gap-1">
                                <Truck className="w-3 h-3" /> Docket: {order.docket_id}
                              </p>
                            )}
                          </div>
                        );
                      };

                      return buildOrderListEntries(filteredIncoming).map(entry => {
                        if (entry.type === 'single') {
                          return renderIncomingCard(entry.order);
                        }
                        const isCollapsed = !!collapsedOrderGroups[entry.groupId];
                        const totalUnits = entry.orders.reduce((sum, o) => sum + (o.items?.reduce((s: number, i: any) => s + i.quantity, 0) || 0), 0);
                        const placedOn = entry.orders[0]?.created_at;
                        return (
                          <div key={entry.groupId} className="rounded-2xl border border-slate-100 bg-slate-50/60 p-2">
                            <button
                              type="button"
                              onClick={() => toggleOrderGroupCollapsed(entry.groupId)}
                              className="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-left"
                            >
                              <div className="min-w-0">
                                <p className="text-xs font-black text-slate-800 truncate">
                                  Request - placed on {placedOn ? new Date(placedOn).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '-'}
                                </p>
                                <p className="text-[11px] text-orange-600 font-bold mt-0.5">
                                  {entry.orders.length} distributors - {totalUnits} total units
                                </p>
                              </div>
                              {isCollapsed ? (
                                <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />
                              ) : (
                                <ChevronUp className="w-4 h-4 text-slate-400 flex-shrink-0" />
                              )}
                            </button>
                            {!isCollapsed && (
                              <div className="mt-2 space-y-2 pl-2 border-l-2 border-orange-100">
                                {entry.orders.map(order => renderIncomingCard(order))}
                              </div>
                            )}
                          </div>
                        );
                      });
                    })()}
                  </div>

                  {/* â"€â"€â"€ Right Panel: Order Details â"€â"€â"€ */}
                  <div className={cn('md:col-span-3 bg-white border border-slate-100 rounded-2xl shadow-sm flex flex-col overflow-hidden', selectedOrderId ? 'flex' : 'hidden md:flex')} style={{ maxHeight: 'calc(60vh)' }}>
                    {!selectedOrderId || !currentIncoming ? (
                      <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8">
                        <ClipboardList className="w-12 h-12 mb-3 opacity-30" />
                        <p className="font-bold text-sm">Select an order to view details</p>
                      </div>
                    ) : (
                      <>
                        {/* Header */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-orange-50/30 shrink-0">
                          <div className="flex items-center gap-3 min-w-0">
                            <button onClick={() => setSelectedOrderId(null)} className="md:hidden h-8 w-8 flex items-center justify-center rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-orange-600 transition-all shrink-0">
                              <ArrowLeft className="w-4 h-4" />
                            </button>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                
                                <span className="font-black text-slate-800 font-mono text-xs">#{formatOrderId(currentIncoming.id)}</span>
                                <StatusBadge status={currentIncoming.status} docket={(currentIncoming as any).docket_id} isIncoming />
                                {currentIncoming.status === 'delivered' && <DeliveredBadge />}
                              </div>
                              <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                                {currentIncoming.client_store_name || currentIncoming.vendor_name || 'Client Store'} - {new Date(currentIncoming.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  onClick={() => handleDownloadPDF(currentIncoming.id)}
                                  className="h-8 w-8 flex items-center justify-center rounded-xl bg-white border border-slate-200 text-slate-500 hover:bg-orange-50 hover:text-orange-600 hover:border-orange-200 transition-all"
                                >
                                  <Download className="w-4 h-4" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>Download PDF</TooltipContent>
                            </Tooltip>
                            {/* Add Note — available on active + on-hold orders */}
                            {(currentIncoming.status === 'processing' || currentIncoming.status === 'pending' || currentIncoming.status === 'shipped') && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    onClick={() => handleOpenAddNote(currentIncoming.id)}
                                    className="h-8 w-8 flex items-center justify-center rounded-xl bg-white border border-slate-200 text-slate-500 hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-200 transition-all"
                                  >
                                    <MessageSquare className="w-4 h-4" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>Add Note for Franchise</TooltipContent>
                              </Tooltip>
                            )}
                            {/* Flag / Put on Hold — only for active orders */}
                            {currentIncoming.status === 'processing' && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    onClick={() => handleOpenHold(currentIncoming.id)}
                                    disabled={holdingIncomingId === currentIncoming.id}
                                    className="h-8 w-8 flex items-center justify-center rounded-xl bg-white border border-slate-200 text-slate-500 hover:bg-amber-50 hover:text-amber-600 hover:border-amber-200 transition-all disabled:opacity-40"
                                  >
                                    {holdingIncomingId === currentIncoming.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />}
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>Put on Hold</TooltipContent>
                              </Tooltip>
                            )}
                            {/* Resume → Active — only for on-hold (pending) orders */}
                            {currentIncoming.status === 'pending' && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    onClick={() => handleResumeOrder(currentIncoming.id)}
                                    disabled={resumingIncomingId === currentIncoming.id}
                                    className="h-8 w-8 flex items-center justify-center rounded-xl bg-white border border-slate-200 text-slate-500 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-all disabled:opacity-40"
                                  >
                                    {resumingIncomingId === currentIncoming.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>Resume — Move to Active</TooltipContent>
                              </Tooltip>
                            )}
                            {/* Decline — only from On Hold, not directly from Active */}
                            {currentIncoming.status === 'pending' && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    onClick={() => handleCancelIncoming(currentIncoming.id)}
                                    disabled={cancellingIncomingId === currentIncoming.id}
                                    className="h-8 w-8 flex items-center justify-center rounded-xl bg-white border border-slate-200 text-slate-500 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 transition-all disabled:opacity-40"
                                  >
                                    {cancellingIncomingId === currentIncoming.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>Decline Order</TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </div>

                        {/* Scrollable Details */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar bg-slate-50/20">
                          {currentIncoming.status === 'pending' && (
                            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
                              <div className="h-10 w-10 bg-amber-100 rounded-xl flex items-center justify-center text-amber-600 shrink-0">
                                <Clock className="w-5 h-5" />
                              </div>
                              <div className="min-w-0">
                                <p className="text-[10px] font-black text-amber-700 uppercase tracking-wider">Order On Hold</p>
                                <p className="text-xs text-amber-800 font-medium mt-0.5">This order has been flagged for review. Use the resume button to move it back to active.</p>
                              </div>
                            </div>
                          )}
                          {currentIncoming.status === 'cancelled' && (
                            <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 flex items-start gap-3">
                              <div className="h-10 w-10 bg-rose-100 rounded-xl flex items-center justify-center text-rose-600 shrink-0">
                                <Ban className="w-5 h-5" />
                              </div>
                              <div className="min-w-0">
                                <p className="text-[10px] font-black text-rose-700 uppercase tracking-wider">
                                  {getDeclineSourceLabel(currentIncoming.declined_by_role)}
                                </p>
                                <p className="text-xs text-rose-700 font-bold mt-0.5">
                                  {currentIncoming.decline_reason || 'No decline reason provided.'}
                                </p>
                              </div>
                            </div>
                          )}

                          {currentIncoming.distributor_confirmation_note && (
                            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex items-start gap-3">
                              <div className="h-10 w-10 bg-blue-100 rounded-xl flex items-center justify-center text-blue-700 shrink-0">
                                <Info className="w-5 h-5" />
                              </div>
                              <div className="min-w-0">
                                <p className="text-[10px] font-black text-blue-700 uppercase tracking-wider">
                                  Confirmation Shared With Franchise
                                </p>
                                <p className="text-xs text-blue-900 font-bold mt-0.5 whitespace-pre-line">
                                  {currentIncoming.distributor_confirmation_note}
                                </p>
                              </div>
                            </div>
                          )}

                          {/* Shipping Docket Status Alert Box */}
                          {currentIncoming.docket_id ? (
                            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-center justify-between gap-4">
                              <div className="flex items-center gap-3">
                                <div className="h-10 w-10 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-700 shrink-0">
                                  <Truck className="w-5 h-5" />
                                </div>
                                <div>
                                  <p className="text-[10px] font-black text-emerald-700 uppercase tracking-wider">Shipping Docket ID</p>
                                  <p className="text-base font-black text-slate-800 font-mono tracking-wide">{currentIncoming.docket_id}</p>
                                </div>
                              </div>
                              <Button
                                onClick={() => {
                                  setDocketIdInput(currentIncoming.docket_id || '');
                                  setDocketDialogOpen(true);
                                }}
                                className="h-8 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-xs font-black shadow-sm"
                              >
                                Edit ID
                              </Button>
                            </div>
                          ) : (
                            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                              <div className="flex items-center gap-3">
                                <div className="h-10 w-10 bg-amber-100 rounded-xl flex items-center justify-center text-amber-700 shrink-0">
                                  <Truck className="w-5 h-5 animate-pulse" />
                                </div>
                                <div>
                                  <p className="text-[10px] font-black text-amber-700 uppercase tracking-wider">Awaiting Shipment</p>
                                  <p className="text-xs text-slate-600 font-bold">No docket / tracking ID shared yet.</p>
                                </div>
                              </div>
                              <Button
                                onClick={() => {
                                  setDocketIdInput('');
                                  setDocketDialogOpen(true);
                                }}
                                className="bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-xs font-black self-start md:self-auto"
                               >
                                Add Docket ID
                              </Button>
                            </div>
                          )}

                          {/* Order Items */}
                          <div className="space-y-2.5">
                            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-wider pl-1">Ordered Items</h3>
                            <div className="divide-y divide-slate-100 border border-slate-100 rounded-2xl overflow-hidden bg-white shadow-sm">
                              {currentIncoming.items?.map((item: any) => {
                                const img = item.product_id ? productImages[item.product_id]?.[0] : null;
                                return (
                                  <div key={item.id} className="flex items-center gap-3 p-3 hover:bg-slate-50/50 transition-colors">
                                    <div className="w-12 h-12 bg-slate-50 border border-slate-100 rounded-lg overflow-hidden shrink-0 flex items-center justify-center">
                                      {img ? (
                                        <img src={img} alt={item.product_name} className="object-contain w-full h-full p-1" />
                                      ) : (
                                        <Package className="w-6 h-6 text-slate-300" />
                                      )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-xs font-black text-slate-800 uppercase tracking-wide truncate">{item.product_name}</p>
                                      {hasMeaningfulOrderText(item.variation_name) && (
                                        <p className="text-[10px] text-slate-400 font-bold mt-0.5">{item.variation_name}</p>
                                      )}
                                      {Number(item.needs_customization) === 1 && (
  <p className="text-[10px] text-blue-600 font-bold mt-1">
    Need Customization
  </p>
)}
                                      {/* {item.needs_customization && null} */}
                                      {hasMeaningfulOrderText(item.customization_remarks) && (
                                        <p className="text-[10px] text-slate-500 italic mt-1 bg-slate-50 p-1.5 rounded border border-slate-100 leading-normal whitespace-pre-line">
                                          Customization Details: {item.customization_remarks}
                                        </p>
                                      )}
                             </div>
                                    <div className="text-right shrink-0">
                                      <span className="text-xs font-black text-slate-800 bg-slate-100 px-2 py-1 rounded-md">x {item.quantity}</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          {/* Shipping Destination */}
                          <div className="space-y-2.5">
                            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-wider pl-1">Delivery Destination</h3>
                            <div className="bg-white border border-slate-100 rounded-2xl p-4 text-xs text-slate-700 shadow-sm space-y-1">
                              <p className="font-bold text-slate-900">{currentIncoming.shipping_address}</p>
                              <p>{currentIncoming.shipping_city}, {currentIncoming.shipping_state}</p>
                              <p className="font-mono font-bold text-slate-500 mt-1">PIN: {currentIncoming.shipping_pincode}</p>
                            </div>
                          </div>

                          {/* Franchise Partner Details */}
                          <div className="space-y-2.5">
                            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-wider pl-1">Franchise Partner</h3>
                            <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
                              <p className="text-xs font-black text-slate-800 uppercase tracking-wide">{currentIncoming.client_store_name || currentIncoming.vendor_name || 'Franchise Partner'}</p>
                              <div className="flex flex-col gap-1.5 text-xs text-slate-500 mt-2">
                                {currentIncoming.vendor_phone && <span className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5 text-slate-400" /> {currentIncoming.vendor_phone}</span>}
                                {currentIncoming.client_store_email && <span className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5 text-slate-400" /> {currentIncoming.client_store_email}</span>}
                              </div>
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
      {/* CHECKOUT DIALOG                                            */}
      {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
      <Dialog open={checkoutOpen} onOpenChange={setCheckoutOpen}>
        <DialogContent className="max-w-2xl rounded-3xl max-h-[90vh] overflow-y-auto z-[9999]">
          <DialogHeader>
            <DialogTitle className="font-black text-slate-900">Order Summary & Confirmation</DialogTitle>
            <DialogDescription className="text-slate-500">
              Review items and confirm delivery address
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Items Summary - Invoice Style */}
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
                <p className="font-black text-slate-700 text-sm">ORDER ITEMS</p>
              </div>
              <div className="divide-y divide-slate-100">
                {cartItems.map((item, idx) => {
                  return (
                    <div key={idx} className="px-4 py-3">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <p className="font-bold text-slate-800 text-sm">{item.productName}</p>
                          {item.variationName && (
                            <p className="text-xs text-slate-500 mt-0.5">{item.variationName}</p>
                          )}
                        </div>
                        <p className="text-xs text-slate-600 font-bold">Qty: {item.quantity}</p>
                      </div>
                      {item.needsCustomization && (
                        <div className="mt-2 space-y-1">
                          <p className="text-[11px] font-bold text-blue-700">Customization Details</p>
                          {item.customizationRemarks && (
                            <p className="text-[11px] text-slate-600 italic whitespace-pre-line">
                              {item.customizationRemarks}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              
              {/* Summary */}
              <div className="bg-orange-50 px-4 py-3 border-t-2 border-orange-200">
                <div className="flex justify-between text-xs text-slate-700 font-bold">
                  <span>{cartItems.length} SKU{cartItems.length > 1 ? 's' : ''}</span>
                  <span>{cartQty} unit{cartQty > 1 ? 's' : ''}</span>
                </div>
              </div>
            </div>

            <div className="space-y-3 pt-1">
              <p className="font-bold text-slate-700 text-sm">ADDITIONAL INFO / REMARKS</p>
              <div>
                <Label className="text-xs font-black text-slate-600 uppercase tracking-wider">Order Note</Label>
                <Textarea
                  className="mt-1.5 min-h-[88px] resize-none rounded-xl border-slate-200 focus-visible:ring-orange-500 text-sm"
                  placeholder="Add any overall notes for this order"
                  value={additionalRemarks}
                  onChange={(e) => setAdditionalRemarks(e.target.value)}
                />
              </div>
            </div>

            {/* Delivery Address — read-only, pulled from profile */}
            <div className="pt-2">
              <p className="font-bold text-slate-700 text-sm mb-3">DELIVERY ADDRESS</p>
              <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 space-y-2">
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-0.5">Full Address</p>
                  <p className="text-sm font-medium text-slate-700">{shipping.shippingAddress || '—'}</p>
                </div>
                <div className="grid grid-cols-3 gap-3 pt-1 border-t border-slate-200">
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-0.5">City</p>
                    <p className="text-sm font-medium text-slate-700">{shipping.shippingCity || '—'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-0.5">State</p>
                    <p className="text-sm font-medium text-slate-700">{shipping.shippingState || '—'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-0.5">Pincode</p>
                    <p className="text-sm font-medium text-slate-700">{shipping.shippingPincode || '—'}</p>
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-slate-400 mt-1.5 flex items-center gap-1">
                <MapPin className="w-3 h-3 shrink-0" /> Address from your registered profile
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2 flex-wrap">
            <Button
              variant="outline"
              onClick={() => setCheckoutOpen(false)}
              className="rounded-xl"
              disabled={checkingOut}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCheckout}
              disabled={checkingOut}
              className="bg-orange-500 hover:bg-orange-600 text-white rounded-xl px-6 font-black flex-1"
            >
              {checkingOut ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <FileText className="w-4 h-4 mr-2" />}
              {checkingOut ? 'Requesting...' : 'Request Order'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <style dangerouslySetInnerHTML={{
        __html: `
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        .mask-linear {
            mask-image: linear-gradient(to right, black 90%, transparent 100%);
        }
      `}} />

      {/* Cart Customization Editor */}
      <Dialog open={cartCustomizationOpen} onOpenChange={(open) => open ? setCartCustomizationOpen(true) : closeCartCustomizationEditor()}>
        <DialogContent className="max-w-md rounded-2xl z-[9999]">
          <DialogHeader>
            <DialogTitle className="font-black text-slate-900">Edit Customization</DialogTitle>
            <DialogDescription className="text-slate-500">
              Update the customization details for this cart item.
            </DialogDescription>
          </DialogHeader>

          {editingCartItem && (
            <div className="space-y-4 py-2">
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <p className="text-sm font-black text-slate-900">{editingCartItem.productName}</p>
                {editingCartItem.variationName && (
                  <p className="text-xs font-bold text-slate-500 mt-0.5">{editingCartItem.variationName}</p>
                )}
              </div>

              <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white p-3">
                <Checkbox
                  id="cart-customization-enabled"
                  checked={cartCustomizationEnabled}
                  onCheckedChange={(checked) => {
                    const enabled = checked === true;
                    setCartCustomizationEnabled(enabled);
                    if (!enabled) {
                      setCartCustomizationDraft('');
                    }
                  }}
                  className="h-5 w-5"
                />
                <Label htmlFor="cart-customization-enabled" className="text-sm font-bold text-slate-700 cursor-pointer">
                  Needs customization
                </Label>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-black text-slate-600 uppercase tracking-wider">
                  Customization Details
                </Label>
                <Textarea
                  value={cartCustomizationDraft}
                  onChange={(e) => setCartCustomizationDraft(e.target.value)}
                  disabled={!cartCustomizationEnabled}
                  placeholder="Describe the seat cover customization details"
                  className="min-h-[110px] resize-none rounded-xl border-slate-200 focus-visible:ring-orange-500 text-sm disabled:bg-slate-50"
                />
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeCartCustomizationEditor} className="rounded-xl">
              Cancel
            </Button>
            <Button onClick={saveCartCustomization} className="bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-bold">
              Save Details
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Product Detail Dialog: photos, every option with its own Add / − n +,
          and what this product adds to the cart. */}
      <Dialog open={!!detailProductId} onOpenChange={(open) => { if (!open) setDetailProductId(null); }}>
        <DialogContent
          className="max-w-5xl w-[96vw] max-h-[92vh] p-0 sm:p-0 gap-0 rounded-[28px] overflow-hidden border-none shadow-2xl z-[9999]"
          style={{ zIndex: 9999 }}
        >
          <style>{`[role="dialog"] { z-index: 9999 !important; }`}</style>
          {(() => {
            const product = detailProductId ? grouped[detailProductId] : null;
            if (!product) return null;

            const images: string[] = productImages[product.product_id] || [];
            const imageAt = images.length ? ((detailImageIndex % images.length) + images.length) % images.length : 0;
            const activeImage = images[imageAt];
            const categoryName = product.category_id ? categoryMap[product.category_id] : null;
            const variations: any[] = product.variations;
            const single = variations.length === 1 && (!hasMeaningfulOrderText(variations[0]?.variation_name) || String(variations[0]?.variation_name).trim().toLowerCase() === 'default');
            const inCartUnits = variations.reduce((n: number, v: any) => n + cartQtyOf(v.product_id, v.variation_id), 0);
            const totalStock = variations.reduce((n: number, v: any) => n + Math.max(0, Number(v.stock_quantity) || 0), 0);
            const skus = variations.map((v: any) => v.sku).filter(Boolean);
            /* The option the bottom bar adds: the one tapped, else the first. */
            const picked = variations.find((v: any) => v.variation_id === detailVariationId) || variations[0];
            const pickedQty = picked ? cartQtyOf(picked.product_id, picked.variation_id) : 0;
            const pickedStock = picked ? Number(picked.stock_quantity) || 0 : 0;

            return (
              <div className="flex flex-col md:flex-row max-h-[92vh] overflow-y-auto md:overflow-hidden">
                {/* Photos */}
                <div className="md:w-[48%] shrink-0 bg-gradient-to-b from-slate-50 to-white p-4 sm:p-6 md:p-8 flex flex-col gap-4">
                  <div className="relative w-full aspect-square max-h-[320px] md:max-h-none rounded-3xl bg-white border border-slate-100 flex items-center justify-center p-6 overflow-hidden">
                    {activeImage ? (
                      <img key={activeImage} src={activeImage} alt={product.product_name} className="max-h-full max-w-full object-contain animate-in fade-in duration-300" />
                    ) : (
                      <Package className="w-20 h-20 text-slate-200" />
                    )}
                    {images.length > 1 && (
                      <>
                        <button type="button" onClick={() => setDetailImageIndex(imageAt - 1)} aria-label="Previous photo"
                          className="absolute left-3 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-white/95 border border-slate-200 shadow flex items-center justify-center text-slate-600 hover:text-orange-600">
                          <ChevronDown className="w-5 h-5 rotate-90" />
                        </button>
                        <button type="button" onClick={() => setDetailImageIndex(imageAt + 1)} aria-label="Next photo"
                          className="absolute right-3 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-white/95 border border-slate-200 shadow flex items-center justify-center text-slate-600 hover:text-orange-600">
                          <ChevronRight className="w-5 h-5" />
                        </button>
                        <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-slate-900/70 px-2.5 py-0.5 text-[11px] font-semibold text-white tabular-nums">
                          {imageAt + 1} / {images.length}
                        </span>
                      </>
                    )}
                  </div>
                  {images.length > 1 && (
                    <div className="flex gap-2 overflow-x-auto no-scrollbar">
                      {images.map((img: string, idx: number) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setDetailImageIndex(idx)}
                          className={cn(
                            'w-16 h-16 shrink-0 rounded-2xl border-2 overflow-hidden bg-white flex items-center justify-center transition-all',
                            idx === imageAt ? 'border-orange-500' : 'border-slate-100 opacity-60 hover:opacity-100'
                          )}
                        >
                          <img src={img} alt="" className="object-contain w-full h-full p-1.5" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Details, options and the cart */}
                <div className="flex-1 flex flex-col min-w-0 md:max-h-[92vh] md:min-h-0">
                  <div className="flex-1 md:min-h-0 md:overflow-y-auto px-5 sm:px-8 pt-6 md:pt-8 pb-6 space-y-6">
                    <DialogHeader className="space-y-2 text-left pr-8">
                      <div className="flex flex-wrap items-center gap-2">
                        {categoryName && (
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">{categoryName}</span>
                        )}
                        {isUserFranchise && (
                          <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-bold',
                            totalStock > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
                            {totalStock > 0 ? 'In stock with your distributor' : 'Out of stock'}
                          </span>
                        )}
                      </div>
                      <DialogTitle className="text-2xl font-black text-slate-900 tracking-tight leading-tight">
                        {product.product_name}
                      </DialogTitle>
                      {skus.length === 1 && <p className="text-[11px] text-slate-400 font-mono">SKU: {skus[0]}</p>}
                    </DialogHeader>

                    {/* Options: tap one to choose it; the bar below adds it. */}
                    {!single && (
                      <section>
                        <h4 className="text-xs font-black text-slate-500 uppercase tracking-wider mb-2.5">
                          Choose option ({variations.length})
                        </h4>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {variations.map((v: any) => {
                            const qty = cartQtyOf(v.product_id, v.variation_id);
                            const stock = Number(v.stock_quantity) || 0;
                            const isPicked = picked && v.variation_id === picked.variation_id;
                            return (
                              <button
                                type="button"
                                key={replenishKey(v.product_id, v.variation_id)}
                                onClick={() => setDetailVariationId(v.variation_id)}
                                className={cn('relative text-left rounded-2xl border-2 px-3.5 py-2.5 transition-colors',
                                  isPicked ? 'border-orange-500 bg-orange-50' : 'border-slate-100 bg-white hover:border-orange-200',
                                  stock <= 0 && !isPicked && 'opacity-60')}
                              >
                                <p className="text-sm font-bold text-slate-900 truncate pr-6">{v.variation_name || 'Default'}</p>
                                {isUserFranchise && (
                                  <p className={cn('text-[11px] font-semibold mt-0.5', stock > 0 ? 'text-emerald-600' : 'text-slate-400')}>
                                    {stock > 0 ? `${stock} in stock` : 'Out of stock'}
                                  </p>
                                )}
                                {qty > 0 && (
                                  <span className="absolute top-2 right-2 min-w-[20px] h-5 px-1 rounded-full bg-orange-500 text-white text-[10px] font-black flex items-center justify-center">
                                    {qty}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </section>
                    )}

                    {product.product_description && (
                      <section>
                        <h4 className="text-xs font-black text-slate-500 uppercase tracking-wider mb-2">About this product</h4>
                        <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">{product.product_description}</p>
                      </section>
                    )}

                    {Array.isArray(product.additional_info) && product.additional_info.length > 0 && (
                      <section>
                        <h4 className="text-xs font-black text-slate-500 uppercase tracking-wider mb-2">Highlights</h4>
                        <ul className="space-y-2">
                          {product.additional_info.map((info: string, idx: number) => (
                            <li key={idx} className="text-sm text-slate-600 leading-relaxed flex items-start gap-2.5">
                              <CheckCircle2 className="w-4 h-4 text-orange-500 mt-0.5 shrink-0" />
                              {info}
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}
                  </div>

                  {/* The chosen option: its stock, Add → − n +, and the cart */}
                  {isUserFranchise && picked && (
                    <div className="sticky bottom-0 border-t border-slate-100 bg-white/95 backdrop-blur px-5 sm:px-8 py-4 flex items-center justify-between gap-3 shrink-0">
                      <div className="min-w-0">
                        <p className={cn('text-sm font-black flex items-center gap-1.5', pickedStock > 0 ? 'text-emerald-600' : 'text-rose-500')}>
                          <span className={cn('w-2 h-2 rounded-full', pickedStock > 0 ? 'bg-emerald-500' : 'bg-rose-500')} />
                          {pickedStock > 0 ? `${pickedStock} in stock` : 'Out of stock'}
                        </p>
                        <p className="text-[11px] text-slate-500 truncate mt-0.5">
                          {!single && <span className="font-semibold text-slate-700">{picked.variation_name || 'Default'}</span>}
                          {!single && inCartUnits > 0 && ' · '}
                          {inCartUnits > 0 && `${inCartUnits} unit${inCartUnits === 1 ? '' : 's'} of this product in cart`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {pickedQty > 0 ? (
                          <QuantityStepper value={pickedQty} max={Math.max(pickedStock, pickedQty)}
                            onChange={val => setCartQty(picked, Math.min(val, Math.max(pickedStock, pickedQty)))} />
                        ) : (
                          <Button
                            onClick={() => setCartQty(picked, 1)}
                            disabled={pickedStock <= 0}
                            className="bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-black text-xs px-6 h-10"
                          >
                            <Plus className="w-4 h-4 mr-1" /> Add
                          </Button>
                        )}
                        {cartItems.length > 0 && (
                          <Button
                            onClick={() => { setDetailProductId(null); setActiveTab('cart'); }}
                            className="bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-black text-xs px-4 h-10"
                          >
                            <ShoppingCart className="w-3.5 h-3.5 sm:mr-1.5" /> <span className="hidden sm:inline">Go to cart</span>
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Customization Modal */}
      <Dialog open={customizationOpen} onOpenChange={handleCustomizationDialogOpenChange}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto z-[9999]" style={{ zIndex: 9999 }}>
          <style>{`
            [role="dialog"] { z-index: 9999 !important; }
          `}</style>
          <DialogHeader>
            <DialogTitle className="text-2xl font-black text-slate-900">
              Customization Details
            </DialogTitle>
            <DialogDescription>
              Select which seat cover items need customization and add the item-level details here.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {pendingItems.map((item, idx) => (
              <div key={idx} className="border border-slate-100 rounded-xl p-4 bg-slate-50 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <p className="font-black text-sm text-slate-900">{item.productName}</p>
                    {item.variationName && (
                      <p className="text-xs text-slate-500">{item.variationName}</p>
                    )}
                    <p className="text-xs text-slate-400 mt-1">Qty: <span className="font-bold">{item.quantity}</span></p>
                  </div>
                </div>

                {item.canCustomize ? (
                  <>
                    <div className="flex items-center gap-3 bg-white p-3 rounded-lg">
                      <Checkbox
                        id={`customize-${idx}`}
                        checked={item.needsCustomization}
                        onCheckedChange={(checked) => {
                          const updated = [...pendingItems];
                          updated[idx].needsCustomization = checked as boolean;
                          if (!updated[idx].needsCustomization) {
                            updated[idx].customizationRemarks = '';
                          }
                          setPendingItems(updated);
                        }}
                        className="h-5 w-5"
                      />
                      <Label htmlFor={`customize-${idx}`} className="text-sm font-bold text-slate-700 cursor-pointer">
                        Need Customization
                      </Label>
                    </div>

                    {item.needsCustomization && (
                      <div className="bg-white p-3 rounded-lg space-y-2">
                        <Label className="text-xs font-bold text-slate-600">
                          Additional Details / Special Requirements
                        </Label>
                        <Textarea
                          placeholder="Describe the details needed (e.g., color, size, material, etc.)"
                          value={item.customizationRemarks}
                          onChange={(e) => {
                            const updated = [...pendingItems];
                            updated[idx].customizationRemarks = e.target.value;
                            setPendingItems(updated);
                          }}
                          className="text-sm resize-none h-20"
                        />
                      </div>
                    )}
                  </>
                ) : null}
              </div>
            ))}

          </div>

          <DialogFooter className="gap-2 flex-wrap">
            <Button
              variant="outline"
              onClick={() => handleCustomizationDialogOpenChange(false)}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={() => confirmCustomization()}
              className="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl"
            >
              <ShoppingCart className="w-4 h-4 mr-2" />
              Add to Cart
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Docket ID Dialog */}
      <Dialog open={docketDialogOpen} onOpenChange={setDocketDialogOpen}>
        <DialogContent className="max-w-sm rounded-2xl z-[9999]">
          <DialogHeader>
            <DialogTitle className="font-black text-slate-900 flex items-center gap-2">
              <Truck className="w-5 h-5 text-emerald-600" /> Share Docket ID
            </DialogTitle>
            <DialogDescription className="text-slate-500">
              Enter the shipping docket / tracking ID to share with the client.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label className="text-xs font-black text-slate-600 uppercase tracking-wider">Docket / Tracking ID</Label>
            <Input
              className="mt-1.5 rounded-xl border-slate-200 focus-visible:ring-emerald-500"
              placeholder="e.g. AUTO-98765"
              value={docketIdInput}
              onChange={e => setDocketIdInput(e.target.value)}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDocketDialogOpen(false)} className="rounded-xl" disabled={sharingDocket}>Cancel</Button>
            <Button
              onClick={handleShareDocket}
              disabled={sharingDocket || !docketIdInput.trim()}
              className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl px-5 font-black"
            >
              {sharingDocket ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Truck className="w-4 h-4 mr-2" />}
              {sharingDocket ? 'Sharing...' : 'Share Docket'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmDialogOpen}
        onOpenChange={(open) => {
          setConfirmDialogOpen(open);
          if (!open) {
            setPendingConfirmIncomingId(null);
            setConfirmNoteInput('');
          }
        }}
      >
        <DialogContent className="max-w-lg rounded-2xl z-[9999]">
          <DialogHeader>
            <DialogTitle className="font-black text-slate-900 flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-emerald-600" /> Add Note for Franchise
            </DialogTitle>
            <DialogDescription className="text-slate-500">
              Share what is being supplied now, any pending balance, or any other update. The franchise will see this immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-2">
            <Label className="text-xs font-black text-slate-600 uppercase tracking-wider">Distributor Update</Label>
            <Textarea
              value={confirmNoteInput}
              onChange={(e) => setConfirmNoteInput(e.target.value)}
              placeholder="Example: We can dispatch 3 units now. The remaining 2 units will be sent once fresh stock arrives."
              className="min-h-[120px] resize-none rounded-xl border-slate-200 focus-visible:ring-emerald-500"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirmDialogOpen(false)}
              className="rounded-xl"
              disabled={confirmingIncomingId === pendingConfirmIncomingId}
            >
              Cancel
            </Button>
            <Button
              onClick={submitAddNote}
              disabled={confirmingIncomingId === pendingConfirmIncomingId || !confirmNoteInput.trim()}
              className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold"
            >
              {confirmingIncomingId === pendingConfirmIncomingId ? (
                <RefreshCw className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <MessageSquare className="w-4 h-4 mr-2" />
              )}
              Send Note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={declineDialogOpen}
        onOpenChange={(open) => {
          setDeclineDialogOpen(open);
          if (!open) {
            setPendingDeclineIncomingId(null);
            setDeclineReasonInput('');
          }
        }}
      >
        <DialogContent className="max-w-md rounded-2xl z-[9999]">
          <DialogHeader>
            <DialogTitle className="font-black text-slate-900 flex items-center gap-2">
              <Ban className="w-5 h-5 text-rose-600" /> Decline Order
            </DialogTitle>
            <DialogDescription className="text-slate-500">
              Add a short reason so the franchise knows why this order was declined.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs font-black text-slate-600 uppercase tracking-wider">
              Decline Reason
            </Label>
            <Textarea
              value={declineReasonInput}
              onChange={(e) => setDeclineReasonInput(e.target.value)}
              placeholder="Example: Item unavailable, incorrect specification, or duplicate request"
              className="min-h-24 rounded-xl border-slate-200 focus-visible:ring-rose-500"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDeclineDialogOpen(false)}
              className="rounded-xl"
              disabled={cancellingIncomingId === pendingDeclineIncomingId}
            >
              Cancel
            </Button>
            <Button
              onClick={submitIncomingDecline}
              disabled={cancellingIncomingId === pendingDeclineIncomingId}
              className="bg-rose-600 hover:bg-rose-700 text-white rounded-xl px-5 font-black"
            >
              {cancellingIncomingId === pendingDeclineIncomingId ? (
                <RefreshCw className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Ban className="w-4 h-4 mr-2" />
              )}
              Decline
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hold Dialog */}
      <Dialog
        open={holdDialogOpen}
        onOpenChange={(open) => {
          setHoldDialogOpen(open);
          if (!open) {
            setPendingHoldIncomingId(null);
            setHoldReasonInput('');
          }
        }}
      >
        <DialogContent className="max-w-md rounded-2xl z-[9999]">
          <DialogHeader>
            <DialogTitle className="font-black text-slate-900 flex items-center gap-2">
              <Clock className="w-5 h-5 text-amber-500" /> Put Order on Hold
            </DialogTitle>
            <DialogDescription className="text-slate-500">
              Flag this order for review. You can resume it to Active any time. Stock remains allocated.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs font-black text-slate-600 uppercase tracking-wider">
              Hold Reason <span className="text-slate-400 font-medium normal-case">(optional)</span>
            </Label>
            <Textarea
              value={holdReasonInput}
              onChange={(e) => setHoldReasonInput(e.target.value)}
              placeholder="Example: Awaiting stock replenishment, address verification needed..."
              className="min-h-24 rounded-xl border-slate-200 focus-visible:ring-amber-400"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setHoldDialogOpen(false)}
              className="rounded-xl"
              disabled={holdingIncomingId === pendingHoldIncomingId}
            >
              Cancel
            </Button>
            <Button
              onClick={submitHold}
              disabled={holdingIncomingId === pendingHoldIncomingId}
              className="bg-amber-500 hover:bg-amber-600 text-white rounded-xl px-5 font-black"
            >
              {holdingIncomingId === pendingHoldIncomingId ? (
                <RefreshCw className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Clock className="w-4 h-4 mr-2" />
              )}
              Put on Hold
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <B2BOrderSpecSheet
        isOpen={!!selectedOrderForSheet}
        onClose={() => setSelectedOrderForSheet(null)}
        order={selectedOrderForSheet}
        onConfirm={selectedOrderForSheet?._isOutgoing ? undefined : handleConfirmIncoming}
        onCancel={selectedOrderForSheet?._isOutgoing ? undefined : handleCancelIncoming}
        onDownloadPDF={handleDownloadPDF}
        confirmingId={confirmingIncomingId}
        cancellingId={cancellingIncomingId}
        productImages={productImages}
        isIncoming={!selectedOrderForSheet?._isOutgoing}
      />
    </div>
  );
};

export default B2BOrderManagement;

