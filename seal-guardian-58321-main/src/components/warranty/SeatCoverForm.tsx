import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import api, { getErrorMessage } from "@/lib/api";
import {
  validateEmail,
  getPhoneError,
  getVehicleRegError,
  formatVehicleRegLive
} from "@/lib/validation";
import { getISTTodayISO, formatToISTDateISO } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { DatePicker } from "@/components/ui/date-picker";
import { MobileSelect } from "@/components/ui/mobile-select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Upload, Loader2, HelpCircle, CheckCircle2, FileText, Building2, User, Car, Smartphone, Mail, Package, XCircle, AlertCircle, Armchair, ImageIcon, QrCode, Camera } from "lucide-react";
import CameraCapture from "@/components/ui/CameraCapture";
import { submitWarranty, updateWarranty } from "@/lib/warrantyApi";
import { TermsModal } from "./TermsModal";
import { WarrantyReviewDialog } from "./WarrantyReviewDialog";
import { compressImage, isCompressibleImage } from "@/lib/imageCompression";
import exifr from 'exifr';
import fpPromise from '@fingerprintjs/fingerprintjs';
import jsQR from "jsqr";
import { usePurchaseDateWindow } from "@/hooks/usePurchaseDateWindow";

const UID_REFERENCE_STEPS = [
  {
    title: "Taffeta Label",
    description: "Check the small stitched Taffeta label attached to the seat cover and scan the QR code to find the UID.",
    image: "/images/warranty/uid-ref-03.jpeg",
  },
  {
    title: "MRP Sticker",
    description: "Look for the UID mentioned below the product and stitch details. You can also scan the code to find the UID.",
    image: "/images/warranty/uid-ref-01.jpeg",
  },
  {
    title: "Weight Sticker",
    description: "Look for the UID Mentioned beside the barcode on the weight label.",
    image: "/images/warranty/uid-ref-02.jpeg",
  },
];

const extractUidFromQrValue = (value: string) => {
  let decodedValue = value || "";
  try {
    decodedValue = decodeURIComponent(decodedValue);
  } catch {
    // Some QR values are not URI encoded. Keep the raw value.
  }
  const uidParam = decodedValue.match(/[?&](?:uid|productUid|product_uid)=([A-Za-z0-9-]{13,30})/i);
  if (uidParam?.[1]) return uidParam[1].replace(/[^A-Za-z0-9]/g, "").slice(0, 16);

  const labelledUid = decodedValue.match(/(?:uid|product uid|product_uid)\D{0,12}([A-Za-z0-9-]{13,30})/i);
  if (labelledUid?.[1]) return labelledUid[1].replace(/[^A-Za-z0-9]/g, "").slice(0, 16);

  const numericUid = decodedValue.match(/\d{13,16}/);
  return numericUid?.[0] || "";
};

interface SeatCoverFormProps {
  initialData?: any;
  warrantyId?: string;
  onSuccess?: (result?: any) => void;
  isEditing?: boolean;
  isPublic?: boolean;
  vendorDirect?: boolean;
  products?: any[];
  storeDetails?: {
    id: number;
    store_name: string;
    store_email: string;
    contact_number: string;
    address_line1?: string;
    city?: string;
    state?: string;
    store_code?: string;
    owner_name?: string;
    vendor_details_id?: number;
  };
  installers?: any[];
}

const SeatCoverForm = ({ initialData, warrantyId, onSuccess, isEditing, isPublic, vendorDirect, storeDetails, installers, products: initialProducts }: SeatCoverFormProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [processingCapture, setProcessingCapture] = useState(false);
  const [stores, setStores] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [manpowerList, setManpowerList] = useState<any[]>([]);
  const [termsModalOpen, setTermsModalOpen] = useState(false);
  /* The "check your details" step between passing the checks and sending. */
  const [reviewOpen, setReviewOpen] = useState(false);
  const [uidHelpOpen, setUidHelpOpen] = useState(false);
  const [uidScannerOpen, setUidScannerOpen] = useState(false);
  const [uidScannerError, setUidScannerError] = useState("");
  const [uidScannerActive, setUidScannerActive] = useState(false);
  const [uidScannerChecking, setUidScannerChecking] = useState(false);
  // UID Validation State
  const [uidStatus, setUidStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid' | 'used'>('idle');
  const [uidMessage, setUidMessage] = useState('');
  const uidTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mobileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uidRevalidateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uidScannerVideoRef = useRef<HTMLVideoElement | null>(null);
  const uidScannerCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const uidScannerStreamRef = useRef<MediaStream | null>(null);
  const uidScannerLoopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uidScannerCheckingRef = useRef(false);
  const uidScannerLastValueRef = useRef("");
  const [showExistingInvoice, setShowExistingInvoice] = useState(false);
  const [deviceFingerprint, setDeviceFingerprint] = useState<string | null>(null);
  const [isBrandNew, setIsBrandNew] = useState(initialData?.registration_number === 'APPLIED-FOR');
  const [formData, setFormData] = useState(initialData ? {
    uid: initialData.product_details?.uid || "",
    customerName: initialData.customer_name || "",
    customerEmail: initialData.customer_email || "",
    customerMobile: initialData.customer_phone || "",

    productName: initialData.product_details?.productName || "",
    storeEmail: initialData.installer_contact || "",
    purchaseDate: initialData.purchase_date ? formatToISTDateISO(initialData.purchase_date) : getISTTodayISO(),
    storeName: initialData.installer_name || "",
    manpowerId: initialData.manpower_id || "",
    carReg: initialData.registration_number || "",
    carYear: initialData.car_year || "",
    warrantyType: initialData.warranty_type || "1 Year",
    invoiceFile: null as File | null,
    vehicleFile: null as File | null,
    seatCoverPhoto: null as File | null,
    termsAccepted: true, // Already accepted if editing
    exifData: null as any,
  } : {
    uid: "",
    customerName: "",
    customerEmail: "",
    customerMobile: "",

    productName: "",
    storeEmail: "",
    purchaseDate: getISTTodayISO(),
    storeName: "",
    manpowerId: "",
    carReg: "",
    carYear: "",
    warrantyType: "1 Year",
    invoiceFile: null as File | null,
    vehicleFile: null as File | null,
    seatCoverPhoto: null as File | null,
    termsAccepted: false,
    exifData: null as any,
    allExifData: {} as Record<string, any>,
  });

  /**
   * True when the store is already determined — the QR flow carries it in
   * storeDetails. Then the store fields are noise the customer cannot
   * usefully answer, and a wrong pick would misattribute the warranty.
   */
  const storeKnown = Boolean(isPublic && storeDetails);

  /**
   * How far back a purchase date may be set. Stores and customers register
   * close to the sale, so 7 days; an admin is correcting or back-filling a
   * record and keeps the original 30.
   */
  // Admin-controlled for the public/QR flow; admins keep a fixed 30 days.
  const purchaseDateWindowDays = usePurchaseDateWindow(user?.role === 'admin');

  // Auto-fill customer details for logged-in customers
  useEffect(() => {
    if (user?.role === 'customer') {
      setFormData(prev => ({
        ...prev,
        customerName: user.name || "",
        customerEmail: user.email || "",
        customerMobile: user.phoneNumber || "",
      }));
    }
  }, [user]);

  // Auto-fill vendor/store details for logged-in vendors
  useEffect(() => {
    const fetchVendorDetails = async () => {
      if (user?.role === 'vendor') {
        try {
          // Fetch vendor's own store details
          const response = await api.get('/vendor/profile');
          if (response.data.success && response.data.vendorDetails) {
            const vendorDetails = response.data.vendorDetails;
            setFormData(prev => ({
              ...prev,
              storeName: vendorDetails.store_name || "",
              storeEmail: vendorDetails.store_email || "",
            }));

            // Fetch vendor's manpower list — approved only, since staff awaiting
            // admin approval can't be credited as the installer yet.
            const manpowerResponse = await api.get('/vendor/manpower?active=true&approved=true');
            if (manpowerResponse.data.success) {
              const rawList = manpowerResponse.data.manpower || [];
              const list = rawList.filter((mp: any) => mp.applicator_type === 'seat_cover');

              if (vendorDetails.owner_name && !list.some((mp: any) => mp.name === vendorDetails.owner_name)) {
                list.unshift({
                  id: 'owner',
                  name: vendorDetails.owner_name,
                  manpower_id: 'OWNER',
                  applicator_type: 'Store Owner'
                });
              }
              setManpowerList(list);
            }
          }
        } catch (error) {
          console.error("Failed to fetch vendor details", error);
        }
      }
    };
    fetchVendorDetails();
  }, [user]);

  // Fetch stores on mount
  useEffect(() => {
    const fetchStores = async () => {
      try {
        const response = await api.get('/public/stores');
        if (response.data.success) {
          setStores(response.data.stores);
        }
      } catch (error) {
        console.error("Failed to fetch stores", error);
        toast({
          title: "Failed to Load Stores",
          description: "Could not load store list. Please refresh the page.",
          variant: "destructive",
        });
      }
    };

    const fetchProducts = async () => {
      // Use pre-fetched products if available
      if (initialProducts && initialProducts.length > 0) {
        setProducts(initialProducts);
        return;
      }

      try {
        const response = await api.get('/public/products');
        if (response.data.success) {
          setProducts(response.data.products.filter((p: any) => p.type === 'seat_cover'));
        }
      } catch (error) {
        console.error("Failed to fetch products", error);
        toast({
          title: "Failed to Load Products",
          description: "Could not load product list. Please refresh the page.",
          variant: "destructive",
        });
      }
    };

    if (!isPublic) {
      fetchStores();
    }
    fetchProducts();
  }, [initialProducts, isPublic]);

  // Initialize FingerprintJS
  useEffect(() => {
    const loadFingerprint = async () => {
      try {
        const fp = await fpPromise.load();
        const result = await fp.get();
        setDeviceFingerprint(result.visitorId);
      } catch (err) {
        console.warn("FingerprintJS failed to load:", err);
      }
    };
    loadFingerprint();
  }, []);

  const handleProductAutoPopulate = async (returnedProductName: string) => {
    if (!returnedProductName) return;
    
    // First try to find in existing products list
    let matchedProduct = products.find(
      p => p.name.toLowerCase().trim() === returnedProductName.toLowerCase().trim()
    );

    if (!matchedProduct) {
      // If not found, let's re-fetch products from server
      try {
        const response = await api.get('/public/products');
        if (response.data.success) {
          const freshProducts = response.data.products.filter((p: any) => p.type === 'seat_cover');
          setProducts(freshProducts);
          matchedProduct = freshProducts.find(
            (p: any) => p.name.toLowerCase().trim() === returnedProductName.toLowerCase().trim()
          );
        }
      } catch (err) {
        console.error("Failed to re-fetch products", err);
      }
    }

    if (matchedProduct) {
      setFormData(prev => ({
        ...prev,
        productName: matchedProduct.name,
        warrantyType: matchedProduct.warranty_years
      }));
      toast({
        title: "Product Auto-filled",
        description: `Product "${matchedProduct.name}" and "${matchedProduct.warranty_years}" warranty auto-filled!`,
      });
    } else {
      setFormData(prev => ({
        ...prev,
        productName: returnedProductName
      }));
      toast({
        title: "Product Detected",
        description: `Product "${returnedProductName}" detected. Please select it from the list or refresh the page.`,
      });
    }
  };

  // Auto-fill store details for public QR flow
  useEffect(() => {
    if (isPublic && storeDetails) {
      setFormData(prev => ({
        ...prev,
        storeName: storeDetails.store_name || "",
        storeEmail: storeDetails.store_email || "",
        // The registration field is hidden on this flow, and the column is
        // NOT NULL, so carry the same marker 1,601 existing seat cover
        // warranties already use rather than leaving it blank.
        carReg: prev.carReg || "APPLIED-FOR",
      }));
      if (installers) {
        setManpowerList(installers.filter((mp: any) => ['seat_cover', 'ppf_spf'].includes(mp.applicator_type)));
      }

      // Add owner to manpower list if not already there
      const ownerName = storeDetails.owner_name || storeDetails.store_name || "Store Owner";
      setManpowerList(prev => {
        if (prev.some(mp => mp.name === ownerName)) return prev;
        return [{
          id: 'owner', // Virtual ID
          name: ownerName,
          manpower_id: 'OWNER',
          applicator_type: 'Store Owner'
        }, ...prev];
      });
    }
  }, [isPublic, storeDetails, installers]);

  // Fetch manpower when store changes (only for non-public mode)
  // In public mode, installers are passed as prop and set by the previous effect
  useEffect(() => {
    // Skip in public mode - we already have installers from props
    if (isPublic) return;

    const fetchManpower = async () => {
      // By email, never by name: franchises share names (three stores are
      // "UMIYA CAR ACCESSORIES & SPA"), and a name lookup took the first match,
      // overwrote the chosen store's email and filed the warranty under the
      // wrong store. The dropdown already sets name, email and resets manpower.
      const selectedStore = stores.find(s => s.store_email === formData.storeEmail);
      if (selectedStore) {
        try {
          const manpowerResponse = await api.get(`/public/stores/${selectedStore.vendor_details_id}/manpower?active=true`);
          if (manpowerResponse.data.success) {
            const rawList = manpowerResponse.data.manpower || [];

            // Filter only Seat Cover and PPF specialists
            const list = rawList.filter((mp: any) => ['seat_cover', 'ppf_spf'].includes(mp.applicator_type));

            // Always ensure at least one installer (Owner/Store Name) is available as fallback
            const ownerName = selectedStore.owner_name || selectedStore.store_name || "Store Owner";
            if (!list.some((mp: any) => mp.name === ownerName)) {
              list.unshift({
                id: 'owner-' + selectedStore.vendor_details_id,
                name: ownerName,
                phone_number: selectedStore.phone || "",
                applicator_type: 'Default (Store)',
                is_active: 1
              });
            }
            setManpowerList(list);

            // Auto-select owner if it's the only one and no selection yet
            if (list.length === 1 && list[0].id.toString().startsWith('owner') && !formData.manpowerId) {
              setFormData(prev => ({ ...prev, manpowerId: list[0].id }));
            }
          }
        } catch (error) {
          console.error("Failed to fetch manpower", error);
          setManpowerList([]);
        }
      } else {
        setManpowerList([]);
      }
    };

    if (formData.storeEmail) {
      fetchManpower();
    }
  }, [formData.storeEmail, stores, isPublic]);

  // Auto-select warranty type based on product name
  // Auto-select warranty type based on product name
  useEffect(() => {
    const selectedProduct = products.find(p => p.name === formData.productName);
    if (selectedProduct) {
      setFormData(prev => ({
        ...prev,
        warrantyType: selectedProduct.warranty_years,
      }));
    }
  }, [formData.productName, products]);


  /** Checks the form; then shows the review, and only `confirmed` from there sends it. */
  const handleSubmit = async (e?: React.FormEvent, confirmed = false) => {
    e?.preventDefault();
    setLoading(true);

    try {
      if (!formData.termsAccepted) {
        toast({
          title: "Terms Required",
          description: "Please accept the terms and conditions to proceed.",
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      if (!/^[a-zA-Z0-9]{13,30}$/.test(formData.uid)) {
        toast({
          title: "Invalid UID",
          description: "UID must be a 13-30 character alphanumeric string",
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      // ===== UID Validation against backend =====
      let resolvedUid = formData.uid;
      try {
        setUidStatus('checking');
        const excludeParam = warrantyId ? `&excludeId=${warrantyId}` : '';
        const phoneParam = formData.customerMobile ? `&phone=${encodeURIComponent(formData.customerMobile)}` : '';
        const uidCheckRes = await api.get(`/public/warranty/check-uid?uid=${formData.uid}${excludeParam}${phoneParam}`);
        if (uidCheckRes.data.success && !uidCheckRes.data.valid) {
          setUidStatus('invalid');
          setUidMessage(uidCheckRes.data.reason);
          toast({
            title: "Invalid UID",
            description: uidCheckRes.data.reason || "Invalid UID. Please check the UID on your product packaging. If it is missing or unreadable, contact the store where you purchased the product.",
            variant: "destructive",
          });
          setLoading(false);
          return;
        }
        // Backend may silently advance a repeated mobile+year UID to the next
        // available sequence (e.g. ...01) — keep the form in sync.
        if (uidCheckRes.data.resolvedUid && uidCheckRes.data.resolvedUid !== formData.uid) {
          resolvedUid = uidCheckRes.data.resolvedUid;
          setFormData(prev => ({ ...prev, uid: resolvedUid }));
        }
        setUidStatus('valid');
        setUidMessage('');
      } catch (uidErr: any) {
        console.error('UID check failed:', uidErr);
        // If the check endpoint itself fails, let the backend submission catch it
        // Don't block submission on network errors for the check
      }

      // Validate Customer Name
      if (!formData.customerName || formData.customerName.trim().length < 2) {
        toast({
          title: "Customer Name Required",
          description: "Please enter the customer's full name",
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      // Validate Customer Mobile
      const phoneError = getPhoneError(formData.customerMobile);
      if (phoneError) {
        toast({
          title: "Invalid Mobile Number",
          description: phoneError,
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      // Validate Customer Email (if provided or required)
      // Note: Email is required for non-vendors and for public flow
      // Email is optional (Phone-Number Centric)
      if (formData.customerEmail && !validateEmail(formData.customerEmail)) {
        toast({
          title: "Invalid Email",
          description: "Please enter a valid email address",
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      // Validate Product Name (Seat Cover selection)
      if (!formData.productName) {
        toast({
          title: "Product Required",
          description: "Please select a seat cover product",
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      // Validate Store Name (required for non-public flow; public flow auto-fills it)
      if (!formData.storeName) {
        toast({
          title: "Store Required",
          description: "Please select a store / franchise",
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      // Validate Applicator / Installer
      if (!formData.manpowerId) {
        toast({
          title: "Applicator Required",
          description: "Please select an applicator / installer",
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      // Prevent vendor from using their own email as the customer email
      if (user?.role === 'vendor' && formData.customerEmail && user.email && formData.customerEmail.toLowerCase().trim() === user.email.toLowerCase().trim()) {
        toast({
          title: "Invalid Customer Email",
          description: "You cannot use your franchise email address as the customer's email. Please use the actual customer's email.",
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      // Validate Purchase / Installation Date
      if (!formData.purchaseDate) {
        toast({
          title: "Date Required",
          description: "Please select the installation / purchase date",
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      // New registrations only. Correcting a rejected warranty is deliberately
      // exempt — it was rejected days after it was filed, so its purchase date
      // is almost always outside the window by then (136 of 139 currently), and
      // blocking that would break the correction flow. The server agrees: it
      // checks the window on submit but never on update.
      if (user?.role !== 'admin' && !warrantyId) {
        const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const daysAgo = Math.round(
          (startOfDay(new Date()).getTime() - startOfDay(new Date(formData.purchaseDate)).getTime()) / 86_400_000
        );
        if (daysAgo > purchaseDateWindowDays) {
          toast({
            title: "Purchase Date Too Old",
            description: `Warranty must be registered within ${purchaseDateWindowDays} days of purchase. This one is ${daysAgo} days ago.`,
            variant: "destructive",
          });
          setLoading(false);
          return;
        }
      }

      // Standard vehicle registration number validation (Indian formats)
      const regError = getVehicleRegError(formData.carReg);
      if (regError) {
        toast({
          title: "Invalid Registration Format",
          description: regError,
          variant: "destructive",
        });
        setLoading(false);
        return;
      }


      // Validate mandatory files for new registration
      if (!warrantyId) {
        if (!formData.invoiceFile) {
          toast({
            title: "Invoice Required",
            description: "Please upload proof of purchase (Invoice / MRP Sticker)",
            variant: "destructive",
          });
          setLoading(false);
          return;
        }
        if (!formData.vehicleFile) {
          toast({
            title: "Car Exterior Photo Required",
            description: "Please capture a photo of the car exterior with the number plate visible",
            variant: "destructive",
          });
          setLoading(false);
          return;
        }
        if (!formData.seatCoverPhoto) {
          toast({
            title: "Seat Cover Photo Required",
            description: "Please capture a photo of the fitted seat cover",
            variant: "destructive",
          });
          setLoading(false);
          return;
        }
      }



      // Everything checks out: let them see it all once before it goes. The UID
      // shown is the one the server settled on above.
      if (!confirmed) {
        setReviewOpen(true);
        return;
      }

      // Find selected manpower name
      const selectedManpower = manpowerList.find(mp => mp.id === formData.manpowerId);
      const manpowerName = selectedManpower ? selectedManpower.name : "";

      // Prepare warranty data
      const warrantyData = {
        productType: "seat-cover",
        customerName: formData.customerName,
        customerEmail: formData.customerEmail,
        customerPhone: formData.customerMobile,
        customerAddress: "N/A",
        registrationNumber: formData.carReg,
        carMake: null,
        carModel: null,
        carYear: formData.carYear || new Date().getFullYear().toString(),
        purchaseDate: formData.purchaseDate,
        warrantyType: formData.warrantyType,
        installerName: formData.storeName,
        installerContact: formData.storeEmail,
        manpowerId: formData.manpowerId || null,
        // The QR link's store, so the server files this under that exact store
        // rather than working it out from a name another branch may share.
        ...(isPublic && storeDetails?.store_code
          ? { storeCode: storeDetails.store_code }
          : {}),
        productDetails: {
          uid: resolvedUid,
          productName: formData.productName,
          storeName: formData.storeName,
          storeEmail: formData.storeEmail,
          manpowerId: formData.manpowerId,
          manpowerName: manpowerName,
          exifData: formData.exifData ? { ...formData.exifData, deviceFingerprint } : { deviceFingerprint },
          allExifData: formData.allExifData,
          customerAddress: "N/A",
          invoiceFileName: formData.invoiceFile?.name || null,
          invoiceFile: formData.invoiceFile, // Pass file object for API wrapper
          photos: {
            vehicle: formData.vehicleFile,
            seatCover: formData.seatCoverPhoto,
          }
        },
        vendorDirect: vendorDirect || false,
      };

      // Submit or update warranty registration
      let result;
      if (warrantyId) {
        const response = await updateWarranty(warrantyId, warrantyData);
        result = response;
        toast({
          title: "Success",
          description: result.message || "Warranty registration updated successfully.",
        });
      } else if (isPublic) {
        // Public flow: use public API endpoint
        const formDataPayload = new FormData();

        // Add warranty data fields
        Object.entries(warrantyData).forEach(([key, value]) => {
          if (key === 'productDetails') {
            const pd = value as any;
            // Extract invoice file before stringifying
            const invoiceFile = pd.invoiceFile;
            const pdWithoutFile = { ...pd };
            delete pdWithoutFile.invoiceFile;
            formDataPayload.append('productDetails', JSON.stringify(pdWithoutFile));

            // Append invoice file
            if (invoiceFile instanceof File) formDataPayload.append('invoiceFile', invoiceFile);

            // Append photo files
            if (pd.photos?.vehicle instanceof File) {
              formDataPayload.append('vehiclePhoto', pd.photos.vehicle);
            }
            if (pd.photos?.seatCover instanceof File) {
              formDataPayload.append('seatCoverPhoto', pd.photos.seatCover);
            }
          } else if (value !== null && value !== undefined) {
            formDataPayload.append(key, String(value));
          }
        });

        const response = await api.post('/public/warranty/submit', formDataPayload, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
        result = response.data;
        toast({
          title: "Warranty Submitted!",
          description: result.isNewUser
            ? "Your warranty has been submitted. Check your messages for confirmation!"
            : "Your warranty has been submitted and is awaiting store verification.",
        });
      } else {
        const response = await submitWarranty(warrantyData);
        result = response;
        toast({
          title: "Warranty Registered",
          description: `Warranty registered successfully. UID: ${result.uid || resolvedUid}`,
        });
      }

      setReviewOpen(false);
      // Redirection Details
      const submissionDetails = {
        customerName: formData.customerName,
        productType: "seat-cover",
        registrationId: result?.uid || resolvedUid || "PENDING",
        role: user?.role || 'public',
        isPublic: isPublic
      };

      navigate("/thank-you", {
        state: { submissionDetails }
      });

      // Call onSuccess callback if provided (for data refresh)
      if (onSuccess) {
        onSuccess(result);
      }

    } catch (error: any) {
      console.error("Warranty submission error:", error);

      let errorTitle = "Submission Failed";
      let errorMessage = "Failed to submit warranty registration";

      if (error.code === "ERR_NETWORK" || error.message?.includes("Network Error")) {
        errorTitle = "Network Error";
        errorMessage = "Unable to connect to server. Please check your internet connection and try again.";
      } else if (error.code === "ECONNABORTED" || error.message?.includes("timeout")) {
        errorTitle = "Upload Timeout";
        errorMessage = "The upload took too long. Try using smaller photos or a faster internet connection.";
      } else if (error.response?.status === 413) {
        errorTitle = "Files Too Large";
        errorMessage = "One or more files exceed the 5 MB limit. Please use smaller images.";
      } else if (error.response?.data?.error) {
        errorMessage = getErrorMessage(error, errorMessage);
      } else if (error.message) {
        errorMessage = error.message;
      }

      toast({
        title: errorTitle,
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const validateUidField = (uidVal: string, mobileVal: string) => {
    if (!/^\d{13,16}$/.test(uidVal)) return;

    // Skip real-time UID validation in public QR flow (no auth token)
    // Server validates during submission anyway
    if (isPublic) {
      setUidStatus('idle');
      return;
    }

    setUidStatus('checking');
    const phoneQuery = mobileVal ? `?phone=${encodeURIComponent(mobileVal)}` : '';
    api.get(`/uid/validate/${uidVal}${phoneQuery}`)
      .then(res => {
        const data = res.data;
        // Backend may silently advance a repeated mobile+year UID to the next
        // available sequence (e.g. ...01) — keep the form in sync.
        if (data.resolvedUid && data.resolvedUid !== uidVal) {
          setFormData(prev => ({ ...prev, uid: data.resolvedUid }));
        }
        if (data.valid && data.available) {
          setUidStatus('valid');
          setUidMessage('UID is valid and available');
        } else if (data.valid && !data.available) {
          setUidStatus('used');
          setUidMessage(data.message || 'UID has already been used');
        } else {
          setUidStatus('invalid');
          setUidMessage(data.message || 'UID not found in the system');
        }
      })
      .catch(() => {
        setUidStatus('idle');
        setUidMessage('');
      });
  };

  const handleChange = (name: string, value: string) => {
    let processedValue = value;

    if (name === 'customerMobile') {
      processedValue = value.replace(/\D/g, '').slice(0, 10);
    } else if (name === 'customerName') {
      // Allow only letters and spaces for customer name
      processedValue = value.replace(/[^A-Za-z\s]/g, '');
    } else if (name === 'uid') {
      // UID should be alphanumeric, max 30 chars
      processedValue = value.replace(/[^A-Za-z0-9-]/g, '').slice(0, 30);
      // Reset UID validation status when value changes
      setUidStatus('idle');
      setUidMessage('');
    } else if (name === 'carReg') {
      processedValue = formatVehicleRegLive(value);
    } else if (name === 'customerEmail') {
      processedValue = value.trim().toLowerCase();
    }

    setFormData(prev => ({ ...prev, [name]: processedValue }));

    // Real-time uniqueness check for Mobile number removed per requirements
    // Real-time uniqueness check for Vehicle Registration
    if (name === 'carReg' && processedValue.length >= 6 && processedValue !== 'APPLIED-FOR') {
      // Small delay to let user finish typing
      if (uidTimerRef.current) clearTimeout(uidTimerRef.current);
      uidTimerRef.current = setTimeout(() => {
        api.get(`/public/warranty/check-uniqueness?reg=${processedValue}&type=seat-cover`)
          .then(res => {
            if (!res.data.unique) {
              toast({
                title: "Vehicle Registered",
                description: res.data.message,
                variant: "destructive",
              });
            }
          })
          .catch(err => console.error("Uniqueness check failed", err));
      }, 800);
    }

    if (name === 'customerMobile' && processedValue.length === 10) {
      if (mobileTimerRef.current) clearTimeout(mobileTimerRef.current);
      mobileTimerRef.current = setTimeout(() => {
        api.get(`/public/warranty/check-uniqueness?phone=${processedValue}&type=seat-cover`)
          .then(res => {
            if (!res.data.unique) {
              toast({
                title: "Mobile Number Already Used",
                description: res.data.message,
                variant: "destructive",
              });
            }
          })
          .catch(err => console.error("Mobile uniqueness check failed", err));
      }, 600);
    }

    // Mobile number affects the fallback UID (mobile + year), so re-validate
    // the UID whenever the mobile number changes and a UID is already entered.
    if (name === 'customerMobile' && formData.uid) {
      if (uidRevalidateTimerRef.current) clearTimeout(uidRevalidateTimerRef.current);
      uidRevalidateTimerRef.current = setTimeout(() => {
        validateUidField(formData.uid, processedValue);
      }, 500);
    }
  };

  const stopUidScanner = () => {
    if (uidScannerLoopRef.current) {
      clearTimeout(uidScannerLoopRef.current);
      uidScannerLoopRef.current = null;
    }

    if (uidScannerStreamRef.current) {
      uidScannerStreamRef.current.getTracks().forEach(track => track.stop());
      uidScannerStreamRef.current = null;
    }

    if (uidScannerVideoRef.current) {
      uidScannerVideoRef.current.srcObject = null;
    }

    setUidScannerActive(false);
    setUidScannerChecking(false);
    uidScannerCheckingRef.current = false;
  };

  const validateScannedUid = async (uid: string) => {
    if (!/^\d{13,16}$/.test(uid)) {
      return {
        valid: false,
        message: "Scanned QR does not contain a valid 13-16 digit product UID.",
      };
    }

    try {
      if (isPublic) {
        const excludeParam = warrantyId ? `&excludeId=${encodeURIComponent(warrantyId)}` : "";
        const res = await api.get(`/public/warranty/check-uid?uid=${encodeURIComponent(uid)}${excludeParam}`);
        return {
          valid: Boolean(res.data?.success && res.data?.valid),
          message: res.data?.reason || "Scanned UID is not valid or has already been used.",
          resolvedUid: res.data?.resolvedUid,
        };
      }

      const res = await api.get(`/uid/validate/${encodeURIComponent(uid)}`);
      return {
        valid: Boolean(res.data?.valid && res.data?.available),
        message: res.data?.message || "Scanned UID is not valid or has already been used.",
        resolvedUid: res.data?.resolvedUid,
      };
    } catch (error) {
      console.error("Scanned UID validation failed:", error);
      return {
        valid: false,
        message: "Could not verify this UID right now. Please try scanning again.",
      };
    }
  };

  useEffect(() => {
    if (!uidScannerOpen) {
      stopUidScanner();
      return;
    }

    let cancelled = false;

    const startScanner = async () => {
      setUidScannerError("");
      setUidScannerChecking(false);
      uidScannerCheckingRef.current = false;
      uidScannerLastValueRef.current = "";

      if (!navigator.mediaDevices?.getUserMedia) {
        setUidScannerError("Camera access is not available in this browser.");
        return;
      }

      try {
        const BarcodeDetectorApi = (window as any).BarcodeDetector;
        let detector: any = null;

        if (BarcodeDetectorApi?.getSupportedFormats) {
          const supportedFormats = await BarcodeDetectorApi.getSupportedFormats();
          if (supportedFormats.includes("qr_code")) {
            detector = new BarcodeDetectorApi({ formats: ["qr_code"] });
          }
        } else if (BarcodeDetectorApi) {
          detector = new BarcodeDetectorApi({ formats: ["qr_code"] });
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }

        uidScannerStreamRef.current = stream;

        const video = uidScannerVideoRef.current;
        if (!video) return;

        video.srcObject = stream;
        await video.play();
        setUidScannerActive(true);

        const scanFrame = async () => {
          if (cancelled || !uidScannerVideoRef.current) return;

          try {
            let rawValue = "";

            if (detector) {
              const barcodes = await detector.detect(uidScannerVideoRef.current);
              const qr = barcodes.find((barcode: any) => barcode.format === "qr_code") || barcodes[0];
              rawValue = qr?.rawValue || "";
            } else {
              const video = uidScannerVideoRef.current;
              const canvas = uidScannerCanvasRef.current;

              if (canvas && video.videoWidth && video.videoHeight) {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                const context = canvas.getContext("2d", { willReadFrequently: true });

                if (context) {
                  context.drawImage(video, 0, 0, canvas.width, canvas.height);
                  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
                  rawValue = jsQR(imageData.data, imageData.width, imageData.height)?.data || "";
                }
              }
            }

            if (rawValue && rawValue !== uidScannerLastValueRef.current && !uidScannerCheckingRef.current) {
              uidScannerLastValueRef.current = rawValue;
              const scannedUid = extractUidFromQrValue(rawValue);

              if (!scannedUid || !/^\d{13,16}$/.test(scannedUid)) {
                setUidScannerError("This QR is not a valid product UID QR. Please scan the UID QR from the product label.");
              } else {
                uidScannerCheckingRef.current = true;
                setUidScannerChecking(true);
                setUidScannerError("");

                const validation = await validateScannedUid(scannedUid);
                uidScannerCheckingRef.current = false;
                setUidScannerChecking(false);

                if (cancelled) return;

                if (!validation.valid) {
                  setUidScannerError(validation.message);
                } else {
                  const acceptedUid = validation.resolvedUid || scannedUid;
                  handleChange("uid", acceptedUid);
                  setUidStatus('valid');
                  setUidMessage('UID is valid and available');
                  toast({
                    title: "UID Scanned",
                    description: "Valid product UID has been filled automatically.",
                  });
                  setUidScannerOpen(false);
                  return;
                }
              }
            }
          } catch (scanError) {
            console.error("QR scan failed:", scanError);
          }

          uidScannerLoopRef.current = setTimeout(scanFrame, 250);
        };

        scanFrame();
      } catch (error: any) {
        console.error("Camera scanner failed:", error);
        setUidScannerError(error?.name === "NotAllowedError"
          ? "Camera permission was blocked. Allow camera access to scan the QR."
          : "Unable to start the camera. Please enter the UID manually."
        );
        setUidScannerActive(false);
      }
    };

    startScanner();

    return () => {
      cancelled = true;
      stopUidScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uidScannerOpen, formData.customerMobile]);

  const ALLOWED_FILE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/heic', 'image/heif', 'application/pdf'];
  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, field: 'invoiceFile' | 'vehicleFile' | 'seatCoverPhoto') => {
    const file = e.target.files?.[0];
    if (file) {
      // Check file type
      if (!ALLOWED_FILE_TYPES.includes(file.type)) {
        toast({
          title: "Invalid File Format",
          description: "Only JPG, PNG, HEIC, and PDF files are allowed",
          variant: "destructive",
        });
        e.target.value = ''; // Reset input
        return;
      }

      // --- FRAUD DETECTION: Extract EXIF BEFORE compression ---
      if (['vehicleFile', 'seatCoverPhoto'].includes(field)) {
        try {
          // Parse EXIF, GPS, and TIFF data (for make/model)
          const exif = await exifr.parse(file, {
            tiff: true, xmp: true, icc: true, gps: true, exif: true
          });
          if (exif) {
            console.log(`[FraudDetection] Extracted EXIF for ${field}:`, {
              lat: exif.latitude, lng: exif.longitude, time: exif.DateTimeOriginal
            });
            // Keep the first valid EXIF data we find for the legacy 'exifData' field
            setFormData(prev => {
              const currentExif = prev.exifData || {};
              const fieldExif = {
                lat: exif.latitude,
                lng: exif.longitude,
                timestamp: exif.DateTimeOriginal,
                deviceMake: exif.Make,
                deviceModel: exif.Model
              };

              // If we already have GPS and this one doesn't, keep the old one for the summary field
              const updatedExif = (currentExif.lat && !exif.latitude) ? currentExif : {
                lat: exif.latitude || currentExif.lat,
                lng: exif.longitude || currentExif.lng,
                timestamp: exif.DateTimeOriginal || currentExif.timestamp,
                deviceMake: exif.Make || currentExif.deviceMake,
                deviceModel: exif.Model || currentExif.deviceModel
              };

              return {
                ...prev,
                exifData: updatedExif,
                allExifData: {
                  ...prev.allExifData,
                  [field]: fieldExif
                }
              };
            });
          }
        } catch (err) {
          console.warn(`[FraudDetection] EXIF extraction failed for ${field}:`, err);
        }
      }

      let processedFile = file;

      // Compress image if it's a compressible type (not PDF)
      if (isCompressibleImage(file)) {
        try {
          setLoading(true);
          processedFile = await compressImage(file, { maxSizeKB: 1024, quality: 0.8 });
          // Silent compression - no need to inform customer
        } catch (err) {
          // Continue with original file if compression fails
          console.warn("Image compression failed, using original:", err);
        } finally {
          setLoading(false);
        }
      }

      // Check file size after compression
      if (processedFile.size > MAX_FILE_SIZE) {
        toast({
          title: "File Too Large",
          description: "Maximum file size is 5 MB",
          variant: "destructive",
        });
        e.target.value = ''; // Reset input
        return;
      }

      setFormData(prev => ({ ...prev, [field]: processedFile || null }));
    }
  };

  // Handle camera captures: geolocation and EXIF are fire-and-forget fraud metadata
  // (they update state whenever they complete). Only compression is awaited — it's
  // the only thing that affects upload size and must finish before submission.
  const handleCameraCapture = async (file: File | null, field: 'vehicleFile' | 'seatCoverPhoto') => {
    if (!file) {
      setFormData(prev => ({ ...prev, [field]: null }));
      return;
    }

    // Set file immediately so UI updates and validation sees a file selected.
    // Will be replaced with the compressed version once compression finishes.
    setFormData(prev => ({ ...prev, [field]: file }));
    setProcessingCapture(true);

    console.log(`[FraudDetection] Camera file received for ${field}:`, {
      name: file.name, type: file.type, size: file.size
    });

    // 1. Geolocation — fire-and-forget using the native callback API.
    //    IMPORTANT: never wrap in a Promise and await it. The Geolocation API's
    //    `timeout` option only starts AFTER the user grants permission. If the user
    //    ignores the permission prompt, a wrapped Promise hangs forever, keeping
    //    processingCapture=true and the submit button stuck permanently.
    navigator.geolocation.getCurrentPosition(
      (position) => {
        console.log(`[FraudDetection] Geolocation GPS:`, position.coords.latitude, position.coords.longitude);
        setFormData(prev => {
          if (prev[field] !== file) return prev;
          return {
            ...prev,
            exifData: {
              ...(prev.exifData || {}),
              lat: position.coords.latitude,
              lng: position.coords.longitude,
            }
          };
        });
      },
      (err) => console.warn(`[FraudDetection] Geolocation failed (user denied or unavailable):`, err),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );

    // 2. EXIF extraction — fire-and-forget async IIFE.
    //    CRITICAL: Only read the first 128KB of the file — reading a full 5-10MB photo
    //    into an ArrayBuffer causes iOS Safari to crash (OOM) and forcibly refresh the page.
    (async () => {
      try {
        const exifChunk = file.slice(0, 128 * 1024);
        const arrayBuffer = await exifChunk.arrayBuffer();
        const exif = await exifr.parse(arrayBuffer, {
          gps: true, exif: true, tiff: true, mergeOutput: true,
        });
        console.log(`[FraudDetection] EXIF for ${field}:`, exif ? {
          Make: exif.Make, Model: exif.Model, DateTimeOriginal: exif.DateTimeOriginal
        } : 'NULL');

        if (exif) {
          setFormData(prev => {
            if (prev[field] !== file) return prev;
            const currentExif = prev.exifData || {};
            const fieldExif = {
              lat: currentExif.lat || exif.latitude || null,
              lng: currentExif.lng || exif.longitude || null,
              timestamp: exif.DateTimeOriginal || exif.CreateDate || currentExif.timestamp || null,
              deviceMake: exif.Make || currentExif.deviceMake || null,
              deviceModel: exif.Model || currentExif.deviceModel || null
            };
            return {
              ...prev,
              exifData: { ...fieldExif },
              allExifData: { ...prev.allExifData, [field]: fieldExif }
            };
          });
        }
      } catch (err) {
        console.warn(`[FraudDetection] EXIF extraction failed for ${field}:`, err);
      }
    })();

    // 3. Compression — the only awaited operation.
    //    processingCapture stays true until this completes (or fails), then the
    //    submit button unlocks. Geolocation/EXIF continue in the background.
    try {
      if (isCompressibleImage(file)) {
        const processedFile = await compressImage(file, { maxSizeKB: 800, quality: 0.7 });
        console.log(`[FraudDetection] Compressed ${field}: ${file.size} -> ${processedFile.size}`);
        setFormData(prev => {
          if (prev[field] === file) return { ...prev, [field]: processedFile };
          return prev;
        });
      }
    } catch (err) {
      console.warn('Camera image compression failed, using original:', err);
    } finally {
      setProcessingCapture(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 sm:space-y-8 px-3 py-2 sm:p-4">
      {/* Header Section — hidden on the QR flow, where the page above already
          names the store and states what the form is for. Repeating it pushes
          the actual fields below the fold on a phone. */}
      <div className={`text-center space-y-2 mb-6 sm:mb-8 ${storeKnown ? "hidden" : ""}`}>
        <div className="inline-flex items-center justify-center p-2.5 sm:p-3 bg-orange-100 rounded-full mb-3 sm:mb-4 ring-4 sm:ring-8 ring-orange-50">
          <Car className="h-6 w-6 sm:h-8 sm:w-8 text-orange-600" />
        </div>
        <h1 className="text-xl sm:text-3xl font-bold tracking-tight bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent px-2">
          {warrantyId ? "Edit Seat Cover Warranty" : "Seat Cover Warranty Registration"}
        </h1>
        <p className="text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto px-2">
          {warrantyId
            ? "Update the warranty details below and resubmit for approval."
            : "Complete the form below to register your premium seat cover warranty. Please ensure all details are accurate."}
        </p>
      </div>

      {/* Existing Invoice Dialog */}
      <Dialog open={showExistingInvoice} onOpenChange={setShowExistingInvoice}>
          <DialogContent className="max-w-sm p-0 overflow-hidden">
              <DialogHeader className="px-4 pt-4 pb-2">
                  <DialogTitle className="text-sm font-semibold">Existing Invoice</DialogTitle>
                  <DialogDescription className="text-xs">Previously uploaded proof of purchase</DialogDescription>
              </DialogHeader>
              {initialData?.product_details?.invoiceFileName && (
                  initialData.product_details.invoiceFileName.toLowerCase().endsWith('.pdf') ? (
                      <div className="flex flex-col items-center justify-center p-8 bg-slate-50">
                          <FileText className="h-16 w-16 text-slate-400 mb-2" />
                          <p className="text-sm font-medium text-slate-600">PDF Document</p>
                          <a 
                              href={initialData.product_details.invoiceFileName.startsWith('http') ? initialData.product_details.invoiceFileName : `${window.location.origin}/uploads/${initialData.product_details.invoiceFileName}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-4 text-xs text-blue-600 underline"
                          >
                              Open in new tab
                          </a>
                      </div>
                  ) : (
                      <img
                          src={initialData.product_details.invoiceFileName.startsWith('http') ? initialData.product_details.invoiceFileName : `${window.location.origin}/uploads/${initialData.product_details.invoiceFileName}`}
                          alt="Existing Invoice"
                          className="w-full object-contain"
                      />
                  )
              )}
          </DialogContent>
      </Dialog>

      <Dialog open={uidHelpOpen} onOpenChange={setUidHelpOpen}>
        <DialogContent className="w-[calc(100vw-24px)] max-w-4xl overflow-hidden p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg font-semibold text-slate-900">Where to find your Product UID</DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              Match the sticker on your product packaging, then enter only the printed digits in the UID field.
            </DialogDescription>
          </DialogHeader>
          {/* Mobile: horizontal scroll strip; Desktop: 3-col grid */}
          <div className="sm:hidden flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x snap-mandatory">
            {UID_REFERENCE_STEPS.map((step, index) => (
              <div key={step.title} className="overflow-hidden rounded-xl border border-slate-200 bg-white shrink-0 w-[72vw] max-w-[260px] snap-start">
                <img
                  src={step.image}
                  alt={step.title}
                  className="aspect-square w-full bg-slate-50 object-contain"
                />
                <div className="space-y-1 p-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange-100 text-[11px] font-bold text-orange-700">
                      {index + 1}
                    </span>
                    <p className="text-sm font-semibold text-slate-800">{step.title}</p>
                  </div>
                  <p className="text-xs leading-relaxed text-slate-500">{step.description}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="sm:hidden text-center text-[10px] text-slate-400 mt-1">Swipe to see more</p>
          <div className="hidden sm:grid gap-4 sm:grid-cols-3">
            {UID_REFERENCE_STEPS.map((step, index) => (
              <div key={step.title} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <img
                  src={step.image}
                  alt={step.title}
                  className="aspect-square w-full bg-slate-50 object-contain"
                />
                <div className="space-y-1 p-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange-100 text-[11px] font-bold text-orange-700">
                      {index + 1}
                    </span>
                    <p className="text-sm font-semibold text-slate-800">{step.title}</p>
                  </div>
                  <p className="text-xs leading-relaxed text-slate-500">{step.description}</p>
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={uidScannerOpen} onOpenChange={setUidScannerOpen}>
        <DialogContent className="max-w-lg overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-semibold text-slate-900">
              <QrCode className="h-5 w-5 text-orange-600" />
              Scan Product UID QR
            </DialogTitle>
            <DialogDescription>
              Place the QR code inside the camera frame. The UID will fill automatically after scanning.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative overflow-hidden rounded-2xl border border-orange-100 bg-gradient-to-br from-orange-50 via-white to-slate-50 p-2 shadow-inner">
              <div className="relative overflow-hidden rounded-xl bg-white">
                <video
                  ref={uidScannerVideoRef}
                  className="aspect-square w-full object-cover"
                  playsInline
                  muted
                />
                <canvas ref={uidScannerCanvasRef} className="hidden" />
                {!uidScannerActive && !uidScannerError && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/85 text-slate-700 backdrop-blur-sm">
                    <Loader2 className="h-6 w-6 animate-spin text-orange-400" />
                    <span className="text-sm font-medium">Starting camera...</span>
                  </div>
                )}
                <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.18),rgba(255,255,255,0.04))]" />
                <div className="pointer-events-none absolute inset-7 rounded-3xl border border-white/80 shadow-[0_0_0_999px_rgba(255,255,255,0.28)]">
                  <div className="absolute -left-0.5 -top-0.5 h-12 w-12 rounded-tl-3xl border-l-[3px] border-t-[3px] border-orange-500" />
                  <div className="absolute -right-0.5 -top-0.5 h-12 w-12 rounded-tr-3xl border-r-[3px] border-t-[3px] border-orange-500" />
                  <div className="absolute -bottom-0.5 -left-0.5 h-12 w-12 rounded-bl-3xl border-b-[3px] border-l-[3px] border-orange-500" />
                  <div className="absolute -bottom-0.5 -right-0.5 h-12 w-12 rounded-br-3xl border-b-[3px] border-r-[3px] border-orange-500" />
                  <div className="absolute inset-0 rounded-3xl border border-orange-200/70" />
                  <div className="absolute left-4 right-4 top-4 h-px animate-[qr-scan_2.6s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-transparent via-orange-500 to-transparent shadow-[0_0_12px_rgba(249,115,22,0.55)]" />
                </div>
                <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-white/90 px-3 py-1 text-[11px] font-semibold text-slate-600 shadow-sm ring-1 ring-slate-200">
                  Align QR inside frame
                </div>
              </div>
            </div>
            {uidScannerError ? (
              <div className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
                {uidScannerError}
              </div>
            ) : uidScannerChecking ? (
              <div className="flex items-center gap-2 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-700">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                Verifying scanned UID...
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-md bg-orange-50 px-3 py-2 text-sm text-orange-700">
                <Camera className="h-4 w-4 shrink-0" />
                Hold the QR steady for a moment.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Section 1: Store & Installer Details */}
        <Card className="border-0 shadow-lg bg-white/80 backdrop-blur-sm ring-1 ring-slate-100">
          <div className="bg-gradient-to-r from-orange-50 to-amber-50/30 px-4 sm:px-6 py-3 sm:py-4 border-b border-orange-100 flex items-center gap-3 rounded-t-xl">
            <div className="p-2 bg-white rounded-lg shadow-sm">
              <Building2 className="h-5 w-5 text-orange-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">{storeKnown ? "Installer" : "Store Details"}</h3>
              <p className="text-xs text-muted-foreground">
                {storeKnown ? "Who fitted the seat cover" : "Store and manpower information"}
              </p>
            </div>
          </div>
          <CardContent className="p-4 sm:p-6 md:p-8">
            <div className="grid md:grid-cols-2 gap-4 sm:gap-6 md:gap-8">
              {/* On the QR flow the store is already known — the customer
                  scanned that store's code. Asking them to pick it again
                  invites the wrong store and breaks warranty attribution,
                  so only ask when it is genuinely unknown. */}
              {!storeKnown && (<>
              {/* Store Selection */}
              <div className="space-y-3">
                <Label htmlFor="storeName" className="text-sm font-medium text-slate-700">
                  Store Name <span className="text-destructive">*</span>
                </Label>
                {user?.role === 'vendor' || isPublic || isEditing ? (
                  <Input
                    id="storeName"
                    value={formData.storeName}
                    readOnly
                    className="bg-slate-50 border-slate-200"
                    placeholder={isPublic ? "Store Name" : "Loading store name..."}
                  />
                ) : (
                  <Combobox
                    options={stores.map(store => ({ value: store.store_email, label: `${store.store_name} - ${store.city}` }))}
                    value={formData.storeEmail}
                    onChange={(value) => {
                      const selectedStore = stores.find(s => s.store_email === value);
                      if (selectedStore) {
                        setFormData(prev => ({ 
                          ...prev, 
                          storeName: selectedStore.store_name,
                          storeEmail: selectedStore.store_email,
                          manpowerId: ""
                        }));
                      }
                    }}
                    placeholder="Select Store"
                    searchPlaceholder="Search store name or city..."
                    emptyMessage="No store found."
                    disabled={loading}
                    className="w-full"
                  />
                )}
              </div>

              <div className="space-y-3">
                <Label htmlFor="storeEmail" className="text-sm font-medium text-slate-700">
                  Store Email <span className="text-destructive">*</span>
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <Input
                    id="storeEmail"
                    type="email"
                    placeholder="store@example.com"
                    value={formData.storeEmail}
                    onChange={(e) => handleChange("storeEmail", e.target.value)}
                    required
                    readOnly
                    disabled={loading}
                    className="pl-9 bg-slate-50 border-slate-200"
                  />
                </div>
              </div>
              </>)}

              {/* Manpower Selection */}
              <div className="space-y-3">
                <Label htmlFor="manpowerId" className="text-sm font-medium text-slate-700">
                  Manpower (Installer) <span className="text-destructive">*</span>
                </Label>
                <MobileSelect
                  options={manpowerList.map((mp) => ({
                    value: mp.id.toString(),
                    label: `${mp.name} (${mp.applicator_type === 'seat_cover' ? 'Seat cover applicator' : mp.applicator_type === 'ppf_spf' ? 'PPF Applicator' : mp.applicator_type || 'Staff'})`
                  }))}
                  value={formData.manpowerId}
                  onValueChange={(value) => handleChange("manpowerId", value)}
                  placeholder={!formData.storeName && !storeKnown ? "Select Store First" : manpowerList.length === 0 ? "No Manpower Found" : "Select Installer"}
                  title="Select Installer"
                  disabled={(!formData.storeName || manpowerList.length === 0) || loading}
                />
              </div>

              <div className="space-y-3">
                <Label htmlFor="purchaseDate" className="text-sm font-medium text-slate-700">
                  Purchase Date <span className="text-destructive">*</span>
                </Label>
                <DatePicker
                  value={formData.purchaseDate}
                  onChange={(value) => handleChange("purchaseDate", value)}
                  minDate={new Date(new Date().setDate(new Date().getDate() - purchaseDateWindowDays))}
                  maxDate={new Date()}
                  placeholder="Select purchase date"
                  disabled={loading}
                />
                {/* The calendar greys out anything older than the window, which
                    on its own reads as a broken date picker. Admins have no
                    limit, so they are not told about one. */}
                {user?.role !== 'admin' && !warrantyId && (
                  <p className="text-xs text-muted-foreground">
                    Warranty must be registered within {purchaseDateWindowDays} days of purchase.
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Section 2: Customer Information */}
        <Card className="border-0 shadow-lg bg-white/80 backdrop-blur-sm ring-1 ring-slate-100">
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50/30 px-4 sm:px-6 py-3 sm:py-4 border-b border-blue-100 flex items-center gap-3 rounded-t-xl">
            <div className="p-2 bg-white rounded-lg shadow-sm">
              <User className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Customer Information</h3>
              <p className="text-xs text-muted-foreground">Personal and contact details</p>
            </div>
          </div>
          <CardContent className="p-4 sm:p-6 md:p-8">
            <div className="grid md:grid-cols-2 gap-4 sm:gap-6 md:gap-8">
              <div className="space-y-3">
                <Label htmlFor="customerName" className="text-sm font-medium text-slate-700">
                  Name <span className="text-destructive">*</span>
                </Label>
                <div className="relative">
                  <User className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <Input
                    id="customerName"
                    type="text"
                    placeholder="Enter customer name"
                    value={formData.customerName}
                    onChange={(e) => handleChange("customerName", e.target.value)}
                    required
                    readOnly={user?.role === 'customer'}
                    disabled={loading}
                    className={`pl-9 border-slate-200 ${user?.role === 'customer' ? 'bg-slate-50 cursor-not-allowed' : 'bg-white'}`}
                  />
                </div>
                {user?.role === 'customer' && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-green-500" /> Auto-filled
                  </p>
                )}
              </div>

              <div className="space-y-3">
                <Label htmlFor="customerEmail" className="text-sm font-medium text-slate-700">
                  Email
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <Input
                    id="customerEmail"
                    type="email"
                    placeholder="customer@example.com"
                    value={formData.customerEmail}
                    onChange={(e) => handleChange("customerEmail", e.target.value)}
                    readOnly={user?.role === 'customer'}
                    disabled={loading}
                    className={`pl-9 border-slate-200 ${user?.role === 'customer' ? 'bg-slate-50 cursor-not-allowed' : 'bg-white'}`}
                  />
                </div>
                <p className="text-xs text-muted-foreground">Optional for notification</p>
              </div>

              <div className="space-y-3 md:col-span-2">
                <Label htmlFor="customerMobile" className="text-sm font-medium text-slate-700">
                  Mobile Number <span className="text-destructive">*</span>
                </Label>
                <div className="relative">
                  <Smartphone className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <Input
                    id="customerMobile"
                    type="tel"
                    placeholder="9876543210"
                    value={formData.customerMobile}
                    onChange={(e) => handleChange("customerMobile", e.target.value)}
                    required
                    readOnly={user?.role === 'customer'}
                    disabled={loading}
                    className={`pl-9 border-slate-200 ${user?.role === 'customer' ? 'bg-slate-50 cursor-not-allowed' : 'bg-white'}`}
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Hidden on the QR flow: a customer scanning in-store does not have
            the registration to hand, and the card holds nothing else. The
            value is set to APPLIED-FOR below — the column is NOT NULL and
            1,601 existing seat cover warranties already use that. */}
        {!storeKnown && (<>
        {/* Section 3: Vehicle Details */}
        <Card className="border-0 shadow-lg bg-white/80 backdrop-blur-sm ring-1 ring-slate-100">
          <div className="bg-gradient-to-r from-emerald-50 to-teal-50/30 px-4 sm:px-6 py-3 sm:py-4 border-b border-emerald-100 flex items-center gap-3 rounded-t-xl">
            <div className="p-2 bg-white rounded-lg shadow-sm">
              <Car className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Vehicle Details</h3>
              <p className="text-xs text-muted-foreground">Vehicle registration information</p>
            </div>
          </div>
          <CardContent className="p-4 sm:p-6 md:p-8">
            <div className="grid gap-4 sm:gap-6">
              <div className="space-y-3">
                <Label htmlFor="carReg" className="text-sm font-medium text-slate-700">
                  Vehicle Registration Number <span className="text-destructive">*</span>
                </Label>
                
                <div className="flex items-center space-x-2 pb-2">
                  <input
                    type="checkbox"
                    id="isBrandNew"
                    checked={isBrandNew}
                    onChange={(e) => {
                      setIsBrandNew(e.target.checked);
                      if (e.target.checked) {
                        setFormData(prev => ({ ...prev, carReg: 'APPLIED-FOR' }));
                      } else {
                        setFormData(prev => ({ ...prev, carReg: '' }));
                      }
                    }}
                    className="w-4 h-4 text-emerald-600 border-gray-300 rounded focus:ring-emerald-500"
                  />
                  <Label htmlFor="isBrandNew" className="text-sm font-normal text-slate-600 cursor-pointer">
                    Brand new car (No registration number yet)
                  </Label>
                </div>

                {!isBrandNew && (
                  <Input
                    id="carReg"
                    type="text"
                    placeholder="Format: DL-01-AB-1234 / 26-BH-6045-F"
                    value={formData.carReg}
                    onChange={(e) => handleChange("carReg", e.target.value)}
                    disabled={loading}
                    required
                    className={`bg-white ${formData.carReg
                      ? getVehicleRegError(formData.carReg)
                        ? 'border-red-400 focus-visible:ring-red-300'
                        : 'border-green-400 focus-visible:ring-green-300'
                      : 'border-slate-200'
                      }`}
                  />
                )}
                {!isBrandNew && formData.carReg && (
                  <p className={`text-xs flex items-center gap-1 ${getVehicleRegError(formData.carReg) ? 'text-red-500' : 'text-green-600'
                    }`}>
                    {getVehicleRegError(formData.carReg)
                      ? `⚠ ${getVehicleRegError(formData.carReg)}`
                      : '✓ Valid registration format'
                    }
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
        </>)}

        {/* Section 4: Product & Warranty */}
        <Card className="border-0 shadow-lg bg-white/80 backdrop-blur-sm ring-1 ring-slate-100">
          <div className="bg-gradient-to-r from-purple-50 to-pink-50/30 px-4 sm:px-6 py-3 sm:py-4 border-b border-purple-100 flex items-center gap-3 rounded-t-xl">
            <div className="p-2 bg-white rounded-lg shadow-sm">
              <Package className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Product & Warranty Information</h3>
              <p className="text-xs text-muted-foreground">Product UID and warranty details</p>
            </div>
          </div>
          <CardContent className="p-4 sm:p-6 md:p-8">
            <div className="grid md:grid-cols-2 gap-4 sm:gap-6 md:gap-8">
              <div className="space-y-3 md:col-span-2">
                <Label htmlFor="uid" className="text-sm font-medium text-slate-700">
                  Product UID (from MRP Sticker) <span className="text-destructive">*</span>
                </Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="relative min-w-0 flex-1">
                    <div className="absolute left-3 top-2.5 bg-slate-100 rounded px-1.5 py-0.5 text-[10px] font-bold text-slate-500 tracking-wider">UID</div>
                    <Input
                      id="uid"
                      type="text"
                      placeholder="Enter 13-16 digit number"
                      value={formData.uid}
                      onChange={(e) => handleChange("uid", e.target.value)}
                      onBlur={() => {
                        const uidVal = formData.uid;
                        if (/^\d{13,16}$/.test(uidVal)) {
                          setUidStatus('checking');
                          // Pass the customer mobile so a "mobile + year" fallback UID can be
                          // recognized/resolved by the backend. Without it, a valid customer-added
                          // UID is reported as "Invalid UID".
                          const phoneQuery = formData.customerMobile ? `phone=${encodeURIComponent(formData.customerMobile)}` : '';
                          if (isPublic) {
                            const q = phoneQuery ? `&${phoneQuery}` : '';
                            api.get(`/public/warranty/check-uid?uid=${uidVal}${q}`)
                              .then(res => {
                                const data = res.data;
                                if (data.resolvedUid && data.resolvedUid !== uidVal) {
                                  setFormData(prev => ({ ...prev, uid: data.resolvedUid }));
                                }
                                if (data.valid) {
                                  setUidStatus('valid');
                                  setUidMessage('UID is valid and available');
                                  if (data.productName) handleProductAutoPopulate(data.productName);
                                } else {
                                  setUidStatus('invalid');
                                  setUidMessage(data.reason || 'UID not valid');
                                }
                              })
                              .catch(() => { setUidStatus('idle'); setUidMessage(''); });
                          } else {
                            const q = phoneQuery ? `?${phoneQuery}` : '';
                            api.get(`/uid/validate/${uidVal}${q}`)
                              .then(res => {
                                const data = res.data;
                                if (data.resolvedUid && data.resolvedUid !== uidVal) {
                                  setFormData(prev => ({ ...prev, uid: data.resolvedUid }));
                                }
                                if (data.valid && data.available) {
                                  setUidStatus('valid');
                                  setUidMessage('UID is valid and available');
                                  if (data.productName) handleProductAutoPopulate(data.productName);
                                } else if (data.valid && !data.available) {
                                  setUidStatus('used');
                                  setUidMessage(data.message || 'UID has already been used');
                                } else {
                                  setUidStatus('invalid');
                                  setUidMessage(data.message || 'UID not found in the system');
                                }
                              })
                              .catch(() => { setUidStatus('idle'); setUidMessage(''); });
                          }
                        }
                      }}
                      required
                      maxLength={16}
                      disabled={loading}
                      pattern="[0-9]{13,16}"
                      className={`pl-12 pr-10 font-mono tracking-wide bg-white ${uidStatus === 'valid'
                        ? 'border-emerald-400 ring-1 ring-emerald-200 focus-visible:ring-emerald-300'
                        : uidStatus === 'invalid' || uidStatus === 'used'
                          ? 'border-red-400 ring-1 ring-red-200 focus-visible:ring-red-300'
                          : 'border-slate-200'
                        }`}
                    />
                    {/* Validation Status Icon */}
                    <div className="absolute right-3 top-2.5">
                      {uidStatus === 'checking' && <Loader2 className="h-4 w-4 animate-spin text-orange-500" />}
                      {uidStatus === 'valid' && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                      {uidStatus === 'invalid' && <XCircle className="h-4 w-4 text-red-500" />}
                      {uidStatus === 'used' && <AlertCircle className="h-4 w-4 text-red-500" />}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setUidScannerOpen(true)}
                    disabled={loading}
                    className="h-10 shrink-0 border-orange-200 bg-orange-50 px-4 font-semibold text-orange-700 hover:bg-orange-100 hover:text-orange-800 sm:w-auto"
                  >
                    <QrCode className="mr-2 h-4 w-4" />
                    Scan QR
                  </Button>
                </div>
                <div className="flex justify-between text-xs px-1 mt-1">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">{formData.uid.length}/16 digits</span>
                    {uidStatus === 'valid' && (
                      <span className="text-emerald-600 font-medium flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Available
                      </span>
                    )}
                    {uidStatus === 'invalid' && (
                      <span className="text-red-500 font-medium flex items-center gap-1">
                        <XCircle className="h-3 w-3" /> {uidMessage}
                      </span>
                    )}
                    {uidStatus === 'used' && (
                      <span className="text-red-500 font-medium flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" /> {uidMessage}
                      </span>
                    )}
                    {uidStatus === 'checking' && (
                      <span className="text-orange-500 font-medium">Checking...</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setUidHelpOpen(true)}
                    className="flex items-center gap-1 text-orange-600 font-medium hover:text-orange-700 transition-colors"
                  >
                    <HelpCircle className="h-3 w-3" /> Where to find?
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <Label htmlFor="productName" className="text-sm font-medium text-slate-700">
                  Product Name <span className="text-destructive">*</span>
                </Label>
                <Combobox
                  options={products.map(product => ({ value: product.name, label: product.name }))}
                  value={formData.productName}
                  onChange={(value) => handleChange("productName", value)}
                  placeholder="Select Product"
                  searchPlaceholder="Search product..."
                  emptyMessage="No product found."
                  disabled={loading}
                  className="w-full"
                />
              </div>

              <div className="space-y-3">
                <Label htmlFor="warrantyType" className="text-sm font-medium text-slate-700">
                  Warranty Type
                </Label>
                <div className="relative">
                  <CheckCircle2 className="absolute left-3 top-2.5 h-4 w-4 text-green-500" />
                  <Input
                    id="warrantyType"
                    type="text"
                    value={formData.warrantyType}
                    readOnly
                    className="pl-9 bg-green-50/50 border-green-100 text-green-700 font-medium"
                  />
                </div>
              </div>

              {/* Number Plate Photo (Now Exterior with Plate) */}
              <CameraCapture
                id="vehicleFile"
                label="Car Exterior image with number plate"
                description="Take a photo or upload from gallery"
                required={!warrantyId}
                disabled={loading}
                cameraOnly={false}
                value={formData.vehicleFile}
                onChange={(file) => handleCameraCapture(file, 'vehicleFile')}
                selectedIcon={<Car className="h-6 w-6" />}
                sampleImageUrl="https://res.cloudinary.com/dmwt4rg4m/image/upload/v1776228125/Car_Exterior_Image_New_vvjoqa.jpg"
                existingImageUrl={isEditing && initialData?.product_details?.photos?.vehicle ? initialData.product_details.photos.vehicle : null}
              />

              {/* Fitted Seat Cover Photo */}
              <CameraCapture
                id="seatCoverPhoto"
                label="Fitted Seat Cover Image"
                description="Take a photo or upload from gallery"
                required={!warrantyId}
                disabled={loading}
                cameraOnly={false}
                value={formData.seatCoverPhoto}
                onChange={(file) => handleCameraCapture(file, 'seatCoverPhoto')}
                selectedIcon={<Armchair className="h-6 w-6" />}
                sampleImageUrl="https://res.cloudinary.com/dmwt4rg4m/image/upload/v1775217073/Seat_Cover_Fitted_jfgizq.jpg"
                existingImageUrl={isEditing && initialData?.product_details?.photos?.seatCover ? initialData.product_details.photos.seatCover : null}
              />


            </div>
            <div className="space-y-3 mt-5 md:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor="invoiceFile" className="text-sm font-medium text-slate-700 shrink-0">
                  Proof of Purchase (GST Invoice / MRP Sticker) <span className="text-destructive">*</span>
                </Label>
                {isEditing && initialData?.product_details?.invoiceFileName && (
                  <button
                    type="button"
                    onClick={() => setShowExistingInvoice(true)}
                    className="flex items-center gap-1 text-xs text-emerald-600 font-medium hover:text-emerald-800 transition-colors"
                  >
                    <ImageIcon className="h-3 w-3" />
                    View Existing
                  </button>
                )}
              </div>
              <div className={`mt-2 border-2 border-dashed rounded-xl p-4 sm:p-6 transition-all duration-200 text-center relative ${formData.invoiceFile ? 'border-orange-300 bg-orange-50/30' : 'border-slate-200 hover:border-orange-300 hover:bg-slate-50'}`}>
                <div className="flex flex-col items-center gap-2">
                  <div className={`p-3 rounded-full ${formData.invoiceFile ? 'bg-orange-100 text-orange-600' : 'bg-slate-100 text-slate-500'}`}>
                    {formData.invoiceFile ? <FileText className="h-6 w-6" /> : <Upload className="h-6 w-6" />}
                  </div>
                  <div>
                    {formData.invoiceFile ? (
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-orange-700 break-all">{formData.invoiceFile.name}</p>
                        <p className="text-xs text-orange-600/70">{(formData.invoiceFile.size / 1024 / 1024).toFixed(2)} MB</p>
                        <label htmlFor="invoiceFile" className="text-xs text-orange-600 underline cursor-pointer hover:text-orange-800">Change File</label>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-slate-700">Click to upload or drag and drop</p>
                        <p className="text-xs text-muted-foreground">(Max 2MB)</p>
                        {isEditing && initialData?.product_details?.invoiceFileName && (
                           <p className="text-[10px] text-emerald-600 font-medium mt-1">
                              ✓ Proof of purchase is already uploaded
                           </p>
                        )}
                      </div>
                    )}
                  </div>
                  <Input
                    id="invoiceFile"
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleFileChange(e, 'invoiceFile')}
                    required={!warrantyId}
                    disabled={loading}
                    className="hidden"
                  />
                  {!formData.invoiceFile && (
                    <label htmlFor="invoiceFile" className="absolute inset-0 cursor-pointer"></label>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Terms & Submit */}
        <Card className="border-0 shadow-lg bg-white/80 backdrop-blur-sm ring-1 ring-slate-100">
          <CardContent className="p-4 sm:p-6 md:p-8">
            <div className="flex flex-col gap-4 sm:gap-6">
              {/* Simple Checkbox T&C */}
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id="termsCheckbox"
                  checked={formData.termsAccepted}
                  onChange={(e) => setFormData(prev => ({ ...prev, termsAccepted: e.target.checked }))}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary cursor-pointer"
                />
                <label htmlFor="termsCheckbox" className="text-sm text-slate-700 cursor-pointer">
                  I have read and agree to the{" "}
                  <button
                    type="button"
                    onClick={() => setTermsModalOpen(true)}
                    className="text-primary font-medium underline hover:text-primary/80"
                  >
                    Terms and Conditions
                  </button>
                </label>
              </div>

              <Button
                type="submit"
                size="lg"
                className="w-full text-lg h-12 shadow-orange-200 shadow-lg hover:shadow-xl transition-all"
                disabled={loading || processingCapture || !formData.termsAccepted || (!warrantyId && (!formData.invoiceFile || !formData.vehicleFile || !formData.seatCoverPhoto))}
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Processing Registration...
                  </>
                ) : processingCapture ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Compressing photos...
                  </>
                ) : (
                  "Complete Registration"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Terms Modal */}
        <TermsModal
          isOpen={termsModalOpen}
          onClose={() => setTermsModalOpen(false)}
          onAccept={() => setFormData(prev => ({ ...prev, termsAccepted: true }))}
        />
      </form>

      {/* Modify closes this and leaves the form exactly as it was. */}
      <WarrantyReviewDialog
        open={reviewOpen}
        loading={loading}
        onModify={() => setReviewOpen(false)}
        onConfirm={() => handleSubmit(undefined, true)}
        sections={[
          {
            title: "Customer",
            rows: [
              ["Name", formData.customerName],
              ["Mobile", formData.customerMobile],
              ["Email", formData.customerEmail],
            ],
          },
          {
            title: "Product",
            rows: [
              ["UID", formData.uid],
              ["Seat cover", formData.productName],
              ["Warranty", formData.warrantyType],
            ],
          },
          {
            title: "Store",
            rows: [
              ["Store", formData.storeName],
              ["Applicator", manpowerList.find(mp => mp.id === formData.manpowerId)?.name ?? ""],
            ],
          },
          {
            /* Only what the form asked: the QR page hides the registration
               (it is filed as APPLIED-FOR), and the year is never asked. */
            title: storeKnown ? "Purchase" : "Vehicle",
            rows: [
              ...(!storeKnown ? [["Registration no.", isBrandNew || formData.carReg === "APPLIED-FOR" ? "Applied for (new car)" : formData.carReg] as [string, string]] : []),
              ["Purchase date", formData.purchaseDate
                ? new Date(`${formData.purchaseDate}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
                : ""],
            ],
          },
        ]}
        photos={[
          {
            label: "Invoice / MRP sticker",
            file: formData.invoiceFile,
            url: (() => {
              const f = initialData?.product_details?.invoiceFileName;
              return f ? (String(f).startsWith("http") ? f : `${window.location.origin}/uploads/${f}`) : null;
            })(),
          },
          { label: "Car exterior", file: formData.vehicleFile, url: initialData?.product_details?.photos?.vehicle },
          { label: "Seat cover fitted", file: formData.seatCoverPhoto, url: initialData?.product_details?.photos?.seatCover },
        ]}
      />
    </div>
  );
};

export default SeatCoverForm;
