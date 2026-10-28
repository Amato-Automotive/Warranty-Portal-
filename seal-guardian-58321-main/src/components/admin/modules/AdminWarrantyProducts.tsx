import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import api, { getErrorMessage } from "@/lib/api";
import { cn, formatToIST } from "@/lib/utils";
import { Trash2, Plus, Package, Pencil, Search } from "lucide-react";

type ProductBrand = 'AF' | 'AC' | 'AFAC';

interface Product {
    id: string;
    name: string;
    type: 'seat_cover' | 'ev_product';
    warranty_years: string;
    /** Which stores' warranty forms list it: Autoform, Autocruze, or both. */
    brand?: ProductBrand;
    updated_at?: string;
}

const BRAND: Record<ProductBrand, { label: string; tone: string }> = {
    AF: { label: 'Autoform', tone: 'bg-orange-100 text-orange-800' },
    AC: { label: 'Autocruze', tone: 'bg-slate-900 text-white' },
    AFAC: { label: 'Both', tone: 'bg-violet-100 text-violet-800' },
};
const TABS: { key: 'all' | ProductBrand; label: string }[] = [
    { key: 'all', label: 'All' }, { key: 'AF', label: 'Autoform' }, { key: 'AC', label: 'Autocruze' }, { key: 'AFAC', label: 'Both' },
];

/** The brand of a product, as a choice of three. */
const BrandChoice = ({ value, onChange }: { value: ProductBrand; onChange: (b: ProductBrand) => void }) => (
    <div className="grid gap-2">
        <Label>Brand</Label>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Brand">
            {(Object.keys(BRAND) as ProductBrand[]).map(b => (
                <button key={b} type="button" role="radio" aria-checked={value === b} onClick={() => onChange(b)}
                    className={cn("h-11 rounded-lg border text-sm font-bold", value === b ? "border-orange-600 bg-orange-50 text-orange-800" : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50")}>
                    {BRAND[b].label}
                </button>
            ))}
        </div>
    </div>
);

export function AdminWarrantyProducts() {
    const { toast } = useToast();
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState<Product | null>(null);
    const [tab, setTab] = useState<'all' | ProductBrand>('all');
    const [find, setFind] = useState('');
    const blank = (): { name: string; type: string; warranty_years: string; brand: ProductBrand } =>
        ({ name: "", type: "seat_cover", warranty_years: "", brand: tab === 'all' ? 'AF' : tab });
    const [newProduct, setNewProduct] = useState(blank);

    const fetchProducts = async () => {
        try {
            const response = await api.get('/public/products');
            if (response.data.success) {
                setProducts(response.data.products);
            }
        } catch (error) {
            console.error("Failed to fetch products", error);
            toast({
                title: "Error",
                description: "Failed to load products",
                variant: "destructive",
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchProducts();
    }, []);

    const handleAddProduct = async () => {
        if (!newProduct.name || !newProduct.warranty_years) {
            toast({
                title: "Error",
                description: "Please fill in all fields",
                variant: "destructive",
            });
            return;
        }

        try {
            const response = await api.post('/admin/products', newProduct);
            if (response.data.success) {
                toast({
                    title: "Success",
                    description: "Product added successfully",
                });
                setIsAddDialogOpen(false);
                setNewProduct(blank());
                fetchProducts();
            }
        } catch (error: any) {
            console.error("Failed to add product", error);
            toast({
                title: "Couldn't Add Product",
                description: getErrorMessage(error, "Something went wrong. Please try again."),
                variant: "destructive",
            });
        }
    };

    const handleUpdateProduct = async () => {
        if (!editingProduct || !editingProduct.name || !editingProduct.warranty_years) {
            toast({
                title: "Error",
                description: "Please fill in all fields",
                variant: "destructive",
            });
            return;
        }

        try {
            const response = await api.put(`/admin/products/${editingProduct.id}`, editingProduct);
            if (response.data.success) {
                toast({
                    title: "Success",
                    description: "Product updated successfully",
                });
                setIsEditDialogOpen(false);
                setEditingProduct(null);
                fetchProducts();
            }
        } catch (error: any) {
            console.error("Failed to update product", error);
            toast({
                title: "Couldn't Update Product",
                description: getErrorMessage(error, "Something went wrong. Please try again."),
                variant: "destructive",
            });
        }
    };

    const handleDeleteProduct = async (id: string) => {
        if (!window.confirm("Are you sure you want to delete this product?")) return;

        try {
            const response = await api.delete(`/admin/products/${id}`);
            if (response.data.success) {
                toast({
                    title: "Success",
                    description: "Product deleted successfully",
                });
                fetchProducts();
            }
        } catch (error: any) {
            console.error("Failed to delete product", error);
            toast({
                title: "Couldn't Delete Product",
                description: getErrorMessage(error, "Something went wrong. Please try again."),
                variant: "destructive",
            });
        }
    };

    const openEditDialog = (product: Product) => {
        setEditingProduct({ ...product, brand: product.brand ?? 'AF' });
        setIsEditDialogOpen(true);
    };

    const brandOf = (p: Product): ProductBrand => p.brand ?? 'AF';
    const needle = find.trim().toLowerCase();
    // Autoform and Autocruze list the products marked so; Both lists every product.
    const seenBy = (k: 'all' | ProductBrand, p: Product) => k === 'all' || k === 'AFAC' || brandOf(p) === k;
    const shown = products.filter(p => seenBy(tab, p) && (!needle || p.name.toLowerCase().includes(needle)));
    const count = (k: 'all' | ProductBrand) => products.filter(p => seenBy(k, p)).length;

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                {/* By brand: which stores' warranty forms list each product. */}
                <div className="flex flex-wrap gap-2" role="tablist" aria-label="Brand">
                    {TABS.map(t => (
                        <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
                            className={cn("flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-bold",
                                tab === t.key ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-900")}>
                            {t.label}<span className={cn("rounded-full px-2 py-0.5 text-xs", tab === t.key ? "bg-white/20" : "bg-gray-100")}>{count(t.key)}</span>
                        </button>
                    ))}
                </div>
                <Dialog open={isAddDialogOpen} onOpenChange={o => { setIsAddDialogOpen(o); if (o) setNewProduct(blank()); }}>
                    <DialogTrigger asChild>
                        <Button>
                            <Plus className="mr-2 h-4 w-4" /> Add Product
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Add New Product</DialogTitle>
                            <DialogDescription>
                                Add a new product to the catalog.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="grid gap-2">
                                <Label htmlFor="name">Product Name</Label>
                                <Input
                                    id="name"
                                    value={newProduct.name}
                                    onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })}
                                    placeholder="e.g., Premium Leather Seat Cover"
                                />
                            </div>
                            <BrandChoice value={newProduct.brand} onChange={b => setNewProduct({ ...newProduct, brand: b })} />
                            <div className="grid gap-2">
                                <Label htmlFor="type">Product Type</Label>
                                <Select
                                    value={newProduct.type}
                                    onValueChange={(value) => setNewProduct({ ...newProduct, type: value as any })}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select type" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="seat_cover">Seat Cover</SelectItem>
                                        <SelectItem value="ev_product">EV Product</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="warranty">Warranty Period</Label>
                                <Input
                                    id="warranty"
                                    value={newProduct.warranty_years}
                                    onChange={(e) => setNewProduct({ ...newProduct, warranty_years: e.target.value })}
                                    placeholder="e.g., 1 Year, 1+1 Years"
                                />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                                Cancel
                            </Button>
                            <Button onClick={handleAddProduct}>Add Product</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Edit Product</DialogTitle>
                            <DialogDescription>
                                Update product details.
                            </DialogDescription>
                        </DialogHeader>
                        {editingProduct && (
                            <div className="grid gap-4 py-4">
                                <div className="grid gap-2">
                                    <Label htmlFor="edit-name">Product Name</Label>
                                    <Input
                                        id="edit-name"
                                        value={editingProduct.name}
                                        onChange={(e) => setEditingProduct({ ...editingProduct, name: e.target.value })}
                                        placeholder="e.g., Premium Leather Seat Cover"
                                    />
                                </div>
                                <BrandChoice value={editingProduct.brand ?? 'AF'} onChange={b => setEditingProduct({ ...editingProduct, brand: b })} />
                                <div className="grid gap-2">
                                    <Label htmlFor="edit-type">Product Type</Label>
                                    <Select
                                        value={editingProduct.type}
                                        onValueChange={(value) => setEditingProduct({ ...editingProduct, type: value as any })}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select type" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="seat_cover">Seat Cover</SelectItem>
                                            <SelectItem value="ev_product">EV Product</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="edit-warranty">Warranty Period</Label>
                                    <Input
                                        id="edit-warranty"
                                        value={editingProduct.warranty_years}
                                        onChange={(e) => setEditingProduct({ ...editingProduct, warranty_years: e.target.value })}
                                        placeholder="e.g., 1 Year, 1+1 Years"
                                    />
                                </div>
                            </div>
                        )}
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                                Cancel
                            </Button>
                            <Button onClick={handleUpdateProduct}>Update Product</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            <div className="relative max-w-md">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input value={find} onChange={e => setFind(e.target.value)} placeholder="Search product name" aria-label="Search products" className="h-11 pl-9" />
            </div>

            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[80px]">S.No</TableHead>
                            <TableHead>Product Name</TableHead>
                            <TableHead>Brand</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Warranty Period</TableHead>
                            <TableHead>Last Updated</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow>
                                <TableCell colSpan={7} className="text-center py-8">
                                    Loading products...
                                </TableCell>
                            </TableRow>
                        ) : shown.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                                    {products.length ? 'No products match.' : 'No products found. Add one to get started.'}
                                </TableCell>
                            </TableRow>
                        ) : (
                            shown.map((product, index) => (
                                <TableRow key={product.id}>
                                    <TableCell className="font-medium">{index + 1}</TableCell>
                                    <TableCell>
                                        <div className="flex items-center">
                                            <Package className="mr-2 h-4 w-4 text-muted-foreground" />
                                            {product.name}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <span className={cn("rounded-full px-2.5 py-1 text-xs font-bold", BRAND[brandOf(product)].tone)}>{BRAND[brandOf(product)].label}</span>
                                    </TableCell>
                                    <TableCell>
                                        {product.type === 'seat_cover' ? 'Seat Cover' : 'EV Product'}
                                    </TableCell>
                                    <TableCell>{product.warranty_years}</TableCell>
                                    <TableCell>
                                        {product.updated_at ? formatToIST(product.updated_at) : '-'}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-2">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => openEditDialog(product)}
                                            >
                                                <Pencil className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="text-destructive hover:text-destructive/90"
                                                onClick={() => handleDeleteProduct(product.id)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
