import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MobileSelect } from "@/components/ui/mobile-select";
import { Combobox } from "@/components/ui/combobox";
import { EVFormData } from "../EVProductsForm";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import api from "@/lib/api";
import { useReportSelectedStore } from "@/components/ratings/SelectedStoreContext";

interface InstallerDetailsProps {
  formData: EVFormData;
  updateFormData: (updates: Partial<EVFormData>) => void;
  onNext: () => void;
  isPublic?: boolean;
  isEditing?: boolean;
  installers?: any[];
  storeDetails?: {
    owner_name?: string;
    [key: string]: any;
  };
}

const InstallerDetails = ({ formData, updateFormData, onNext, isPublic, isEditing, installers, storeDetails }: InstallerDetailsProps) => {
  /** The QR flow already determined the store; only the installer is asked. */
  const storeKnown = Boolean(isPublic && storeDetails);
  const { user } = useAuth();
  const { toast } = useToast();
  const [stores, setStores] = useState<any[]>([]);
  const [manpowerList, setManpowerList] = useState<any[]>(installers || []);

  // Fetch stores on mount (only if not public or no store data)
  useEffect(() => {
    if (isPublic && installers) {
      const list = [...installers];
      const ownerName = storeDetails?.owner_name || storeDetails?.store_name || "Store Owner";
      if (!list.some(mp => mp.name === ownerName)) {
        list.unshift({
          id: 'owner',
          name: ownerName,
          manpower_id: 'OWNER',
          applicator_type: 'Store Owner'
        });
      }
      setManpowerList(list);
      return;
    }

    const fetchStores = async () => {
      try {
        const response = await api.get('/public/stores');
        if (response.data.success) {
          setStores(response.data.stores);
        } else {
          toast({ title: "Failed to Load Stores", description: "Could not fetch store list. Please refresh.", variant: "destructive" });
        }
      } catch (error) {
        console.error("Failed to fetch stores", error);
        toast({ title: "Network Error", description: "Could not connect to server. Please check your internet.", variant: "destructive" });
      }
    };
    fetchStores();
  }, []);

  // The picked store's rating shows in the page's top corner.
  useReportSelectedStore(stores.find(s => s.store_email === formData.storeEmail)?.vendor_details_id);

  // Fetch manpower when store changes
  useEffect(() => {
    const fetchManpower = async () => {
      // By email, never by name: franchises share names, and a name lookup
      // took the first match and swapped in that store's email.
      const selectedStore = stores.find(s => s.store_email === formData.storeEmail);
      if (selectedStore) {
        // Auto-fill all store details
        updateFormData({
          storeEmail: selectedStore.store_email || '',
          dealerMobile: selectedStore.phone || '',
          dealerAddr1: selectedStore.address || '',
          dealerAddr2: '', // Not stored in database
          dealerCity: selectedStore.city || '',
          dealerState: selectedStore.state || '',
          dealerPostalCode: selectedStore.pincode || ''
        });

        try {
          const manpowerResponse = await api.get(`/public/stores/${selectedStore.vendor_details_id}/manpower?active=true`);
          if (manpowerResponse.data.success) {
            const rawList = manpowerResponse.data.manpower || [];
            
            // Filter only Seat Cover and PPF specialists
            const list = rawList.filter((mp: any) => ['seat_cover', 'ppf_spf'].includes(mp.applicator_type));

            // Ensure the Store Owner is always an option fallback
            const ownerName = selectedStore.owner_name || selectedStore.store_name || "Store Owner";
            if (!list.some((mp: any) => mp.name === ownerName)) {
              list.unshift({
                id: 'owner',
                name: ownerName,
                manpower_id: 'OWNER',
                applicator_type: 'Store Owner'
              });
            }
            setManpowerList(list);
            
            // Auto-select owner if it's the only one and no selection yet
            if (list.length === 1 && list[0].id === 'owner' && !formData.manpowerId) {
              updateFormData({
                installerName: list[0].name,
                installerCode: 'OWNER',
                manpowerId: 'owner'
              });
            }
          }
        } catch (error) {
          console.error("Failed to fetch manpower", error);
          setManpowerList([]);
          toast({ title: "Failed to Load Installers", description: "Could not fetch installer list for this store.", variant: "destructive" });
        }
      } else {
        setManpowerList([]);
      }
    };

    if (isPublic && installers) {
      const list = installers.filter((mp: any) => ['seat_cover', 'ppf_spf'].includes(mp.applicator_type));
      const ownerName = storeDetails?.owner_name || storeDetails?.store_name || "Store Owner";
      if (!list.some(mp => mp.name === ownerName)) {
        list.unshift({
          id: 'owner',
          name: ownerName,
          manpower_id: 'OWNER',
          applicator_type: 'Store Owner'
        });
      }
      setManpowerList(list);
      return;
    }

    if (formData.storeEmail) {
      // If we are initializing and already have a manpowerId, don't let fetchManpower 
      // overwrite other details if it doesn't have to, but we still need the list.
      fetchManpower();
    }
  }, [formData.storeEmail, stores, isPublic, installers]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Custom validation for required fields
    if (!formData.storeName) {
      toast({ title: "Store Name Required", description: "Please select a store", variant: "destructive" });
      return;
    }
    if (!formData.installerName) {
      toast({ title: "Installer Name Required", description: "Please select an installer", variant: "destructive" });
      return;
    }

    onNext();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* On the QR flow the customer scanned this store's code, so the store
          fields are prefilled and unanswerable — only the installer is theirs
          to choose. Showing them invites confusion and a wrong edit. */}
      <div>
        <h3 className="text-2xl font-semibold mb-2">
          {storeKnown ? "Installer" : "Installer Information"}
        </h3>
        <p className="text-muted-foreground mb-6">
          {storeKnown ? "Who fitted the product" : "Please provide the store/installer details"}
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {!storeKnown && (
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="storeName">
            Store Name <span className="text-destructive">*</span>
          </Label>
          {user?.role === 'vendor' || isPublic ? (
            <Input
              id="storeName"
              value={formData.storeName}
              readOnly
              className="bg-muted"
              placeholder={isPublic ? "Store Name" : "Loading store name..."}
            />
          ) : (
            <Combobox
              options={stores.map(store => ({ value: store.store_email, label: `${store.store_name} - ${store.city}` }))}
              value={formData.storeEmail}
              onChange={(value) => {
                const selectedStore = stores.find(s => s.store_email === value);
                if (selectedStore) {
                  updateFormData({ 
                    storeName: selectedStore.store_name,
                    storeEmail: selectedStore.store_email 
                  });
                }
              }}
              placeholder="Select Store"
              searchPlaceholder="Search store name or city..."
              emptyMessage="No store found."
            />
          )}
        </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="installerName">
            Installer Name <span className="text-destructive">*</span>
          </Label>
          {isEditing ? (
            <Input
              id="installerName"
              value={formData.installerName}
              readOnly
              className="bg-muted"
            />
          ) : (
            <MobileSelect
              value={formData.manpowerId?.toString()}
              onValueChange={(value) => {
                const selectedManpower = manpowerList.find(mp => mp.id.toString() === value);
                updateFormData({
                  installerName: selectedManpower?.name || "",
                  installerCode: selectedManpower?.manpower_id || "",
                  manpowerId: selectedManpower?.id
                });
              }}
              disabled={!formData.storeName || manpowerList.length === 0}
              placeholder={!formData.storeName ? "Select Store First" : manpowerList.length === 0 ? "No Manpower Found" : "Select Installer"}
              options={manpowerList.map((mp) => ({
                value: mp.id.toString(),
                label: `${mp.name} (${mp.applicator_type === 'seat_cover' ? 'Seat cover applicator' : mp.applicator_type === 'ppf_spf' ? 'PPF Applicator' : mp.applicator_type || 'Staff'})`
              }))}
              title="Select Installer"
            />
          )}
        </div>

        {/* Store email, phone and address all come from the scanned
            store, so they are prefilled and not the customer's to edit. */}
        {!storeKnown && (<>
        <div className="space-y-2">
          <Label htmlFor="storeEmail">
            Store Email <span className="text-destructive">*</span>
          </Label>
          <Input
            id="storeEmail"
            type="email"
            placeholder="store@example.com"
            value={formData.storeEmail}
            onChange={(e) => updateFormData({ storeEmail: e.target.value })}
            required
            readOnly
            className="bg-muted"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="dealerMobile">
            Mobile Number <span className="text-destructive">*</span>
          </Label>
          <Input
            id="dealerMobile"
            type="tel"
            placeholder="9876543210"
            value={formData.dealerMobile}
            onChange={(e) => updateFormData({ dealerMobile: e.target.value })}
            required
            readOnly
            className="bg-muted"
          />
        </div>

        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="dealerAddr1">
            Address Line 1 <span className="text-destructive">*</span>
          </Label>
          <Input
            id="dealerAddr1"
            type="text"
            placeholder="Street address, P.O. box"
            value={formData.dealerAddr1}
            onChange={(e) => updateFormData({ dealerAddr1: e.target.value })}
            required
            readOnly
            className="bg-muted"
          />
        </div>

        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="dealerAddr2">Address Line 2</Label>
          <Input
            id="dealerAddr2"
            type="text"
            placeholder="Apartment, suite, unit, building, floor, etc."
            value={formData.dealerAddr2}
            onChange={(e) => updateFormData({ dealerAddr2: e.target.value })}
            readOnly
            className="bg-muted"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="dealerState">
            State <span className="text-destructive">*</span>
          </Label>
          <Input
            id="dealerState"
            type="text"
            placeholder="State"
            value={formData.dealerState}
            onChange={(e) => updateFormData({ dealerState: e.target.value })}
            required
            readOnly
            className="bg-muted"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="dealerCity">
            City <span className="text-destructive">*</span>
          </Label>
          <Input
            id="dealerCity"
            type="text"
            placeholder="City"
            value={formData.dealerCity}
            onChange={(e) => updateFormData({ dealerCity: e.target.value })}
            required
            readOnly
            className="bg-muted"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="dealerPostalCode">
            Postal Code <span className="text-destructive">*</span>
          </Label>
          <Input
            id="dealerPostalCode"
            type="text"
            placeholder="Enter PIN code"
            value={formData.dealerPostalCode}
            onChange={(e) => updateFormData({ dealerPostalCode: e.target.value })}
            required
            readOnly
            className="bg-muted"
          />
        </div>
        </>)}
      </div>

      <div className="flex justify-end pt-2">
        <Button type="submit" className="w-full sm:w-auto h-10 rounded-lg px-5 text-sm font-medium bg-slate-900 text-white transition-colors hover:bg-slate-800">
          Next Step
        </Button>
      </div>
    </form>
  );
};

export default InstallerDetails;