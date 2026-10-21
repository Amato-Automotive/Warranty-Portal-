import React, { createContext, useContext, useState, useEffect } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from './AuthContext';
import { useToast } from '@/hooks/use-toast';

export interface CartItem {
  productId: string;
  variationId: string | null;
  productName: string;
  variationName: string | null;
  quantity: number;
  price: number;
  stockQuantity: number;
  sku?: string;
  needsCustomization?: boolean;
  customizationRemarks?: string;
  // Which distributor this line was picked from. The same product can be
  // stocked by several of a franchise's distributors, so without this the
  // server has to guess and may route to one that has no stock.
  distributorId?: string;
  distributorName?: string;
}

interface B2BCartContextType {
  cartItems: CartItem[];
  /* silent: no toast — for the order page's steppers, which change the cart on every tap. */
  addToCart: (item: Omit<CartItem, 'quantity'>, quantity?: number, silent?: boolean) => void;
  removeFromCart: (productId: string, variationId: string | null, silent?: boolean) => void;
  updateQuantity: (productId: string, variationId: string | null, quantity: number, silent?: boolean) => void;
  updateCustomization: (productId: string, variationId: string | null, needsCustomization: boolean, customizationRemarks: string) => void;
  clearCart: () => void;
  distributorStock: any[];
  distributorName: string;
  loadingStock: boolean;
  refreshStock: () => Promise<void>;
  productImages: Record<string, string[]>;
  categoryMap: Record<string, string>;
  isDistributor: boolean;
  isFranchise: boolean;
  loadingProfile: boolean;
  vendorProfile: any;
  checkout: (shippingDetails: {
    shippingAddress: string;
    shippingCity: string;
    shippingState: string;
    shippingPincode: string;
  }, orderRemarks?: string) => Promise<boolean>;
}

const B2BCartContext = createContext<B2BCartContextType | undefined>(undefined);

export const B2BCartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [distributorStock, setDistributorStock] = useState<any[]>([]);
  const [distributorName, setDistributorName] = useState<string>('');
  const [loadingStock, setLoadingStock] = useState<boolean>(false);
  const [productImages, setProductImages] = useState<Record<string, string[]>>({});
  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({});
  const [isDistributor, setIsDistributor] = useState<boolean>(false);
  const [isFranchise, setIsFranchise] = useState<boolean>(true);
  const [loadingProfile, setLoadingProfile] = useState<boolean>(true);
  const [vendorProfile, setVendorProfile] = useState<any>(null);

  // Load cart from localStorage on mount/user change
  useEffect(() => {
    if (user?.role === 'vendor') {
      setLoadingProfile(true);
      const savedCart = localStorage.getItem(`b2b_cart_${user.id}`);
      if (savedCart) {
        try {
          setCartItems(JSON.parse(savedCart));
        } catch (e) {
          console.error('Failed to parse B2B cart');
        }
      }
      refreshStock();
      // Single source of truth for is_distributor/is_franchise — consumers
      // (FranchiseDashboard sidebar, B2BOrderManagement, etc.) should read
      // isDistributor/isFranchise/vendorProfile from this context rather
      // than fetching /vendor/profile themselves, to avoid two independent
      // fetches disagreeing mid-load.
      api.get('/vendor/profile').then(res => {
        if (res.data.success && res.data.vendorDetails) {
          const profile = res.data.vendorDetails;
          setVendorProfile(profile);
          setIsDistributor(Boolean(profile.is_distributor));
          setIsFranchise(profile.is_franchise === undefined ? true : Boolean(profile.is_franchise));
        }
      }).catch(err => {
        console.error('Failed to fetch profile in B2BCartContext', err);
      }).finally(() => {
        setLoadingProfile(false);
      });
    } else {
      setCartItems([]);
      setDistributorStock([]);
      setDistributorName('');
      setProductImages({});
      setCategoryMap({});
      setIsDistributor(false);
      setIsFranchise(true);
      setVendorProfile(null);
      setLoadingProfile(false);
    }
  }, [user]);

  // Save cart to localStorage whenever it changes
  useEffect(() => {
    if (user?.role === 'vendor') {
      localStorage.setItem(`b2b_cart_${user.id}`, JSON.stringify(cartItems));
    }
  }, [cartItems, user]);

  const refreshStock = async () => {
    if (user?.role !== 'vendor') return;
    setLoadingStock(true);
    try {
      // Franchise catalogue = union of all assigned distributors' allowed categories.
      // Each item carries its own distributor_id/distributor_name since a franchise
      // can be routed to different distributors per category.
      const response = await api.get('/orders/catalogue');
      if (response.data.success) {
        const inventory = response.data.inventory || [];
        setDistributorStock(inventory);

        // Carts persist in localStorage, so items added before the distributor
        // was tracked have no distributorId. Backfill from the catalogue, else
        // checkout falls back to guessing and can route to a distributor that
        // doesn't stock the item.
        setCartItems(prev => {
          if (!prev.some(i => !i.distributorId)) return prev;
          return prev.map(i => {
            if (i.distributorId) return i;
            // Only backfill when exactly one distributor sells this line. If
            // several do, guessing would pin the wrong one — leave it unset and
            // let the server fall back rather than silently choose.
            const matches = inventory.filter((s: any) =>
              s.product_id === i.productId && (s.variation_id ?? null) === (i.variationId ?? null));
            return matches.length === 1
              ? { ...i, distributorId: matches[0].distributor_id, distributorName: matches[0].distributor_name }
              : i;
          });
        });

        const distributorNames = [...new Set((response.data.inventory || []).map((i: any) => i.distributor_name).filter(Boolean))];
        setDistributorName(distributorNames.length === 1 ? String(distributorNames[0]) : '');
        setProductImages(response.data.productImages || {});
        setCategoryMap(response.data.categoryMap || {});
      }
    } catch (error: any) {
      console.error('Failed to fetch catalogue:', error);
    } finally {
      setLoadingStock(false);
    }
  };

  const addToCart = (item: Omit<CartItem, 'quantity'>, quantity = 1, silent = false) => {
    setCartItems((prevItems) => {
      const existingItemIndex = prevItems.findIndex(
        (i) => i.productId === item.productId && i.variationId === item.variationId
      );

      if (existingItemIndex > -1) {
        const existingItem = prevItems[existingItemIndex];
        const newQty = existingItem.quantity + quantity;

        const updated = [...prevItems];
        updated[existingItemIndex] = { ...existingItem, quantity: newQty };
        if (!silent) toast({
          title: 'Cart Updated',
          description: `Increased quantity of ${item.productName} in your order.`,
        });
        return updated;
      } else {
        if (!silent) toast({
          title: 'Added to Order',
          description: `${item.productName} added to your cart.`,
        });
        return [...prevItems, { ...item, quantity, stockQuantity: 999999 }];
      }
    });
  };

  const removeFromCart = (productId: string, variationId: string | null, silent = false) => {
    setCartItems((prev) => prev.filter((i) => !(i.productId === productId && i.variationId === variationId)));
    if (!silent) toast({
      title: 'Item Removed',
      description: 'Item removed from your order cart.',
    });
  };

  const updateQuantity = (productId: string, variationId: string | null, quantity: number, silent = false) => {
    if (quantity <= 0) {
      removeFromCart(productId, variationId, silent);
      return;
    }

    setCartItems((prev) =>
      prev.map((item) => {
        if (item.productId === productId && item.variationId === variationId) {
          return { ...item, quantity };
        }
        return item;
      })
    );
  };

  const updateCustomization = (
    productId: string,
    variationId: string | null,
    needsCustomization: boolean,
    customizationRemarks: string
  ) => {
    setCartItems((prev) =>
      prev.map((item) => {
        if (item.productId === productId && item.variationId === variationId) {
          return {
            ...item,
            needsCustomization,
            customizationRemarks: needsCustomization ? customizationRemarks : '',
          };
        }
        return item;
      })
    );
  };

  const clearCart = () => {
    setCartItems([]);
  };

  const checkout = async (shippingDetails: {
    shippingAddress: string;
    shippingCity: string;
    shippingState: string;
    shippingPincode: string;
  }, orderRemarks: string = '') => {
    if (cartItems.length === 0) {
      toast({
        title: 'Empty Cart',
        description: 'Please add items before placing an order.',
        variant: 'destructive',
      });
      return false;
    }

    try {
      const itemsPayload = cartItems.map((item) => ({
        productId: item.productId,
        variationId: item.variationId,
        quantity: item.quantity,
        needsCustomization: item.needsCustomization || false,
        customizationRemarks: item.customizationRemarks || '',
        // Pin the distributor the item was browsed from so the server doesn't
        // re-derive it and land on a different one.
        distributorId: item.distributorId,
      }));

      const response = await api.post('/orders', {
        items: itemsPayload,
        additionalRemarks: orderRemarks,
        ...shippingDetails,
      });

      if (response.data.success) {
        toast({
          title: 'Order Placed!',
          description: response.data.message || 'Order submitted. Your distributor has been notified via email.',
        });
        clearCart();
        refreshStock(); // refresh live stock
        return true;
      }
      return false;
    } catch (error: any) {
      toast({
        title: 'Checkout Failed',
        description: getErrorMessage(error, 'Failed to submit order.'),
        variant: 'destructive',
      });
      return false;
    }
  };

  return (
    <B2BCartContext.Provider
      value={{
        cartItems,
        addToCart,
        removeFromCart,
        updateQuantity,
        updateCustomization,
        clearCart,
        distributorStock,
        distributorName,
        loadingStock,
        refreshStock,
        productImages,
        categoryMap,
        isDistributor,
        isFranchise,
        loadingProfile,
        vendorProfile,
        checkout,
      }}
    >
      {children}
    </B2BCartContext.Provider>
  );
};

export const useB2BCart = () => {
  const context = useContext(B2BCartContext);
  if (context === undefined) {
    throw new Error('useB2BCart must be used within a B2BCartProvider');
  }
  return context;
};
