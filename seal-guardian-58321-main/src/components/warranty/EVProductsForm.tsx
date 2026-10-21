import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import api, { getErrorMessage } from "@/lib/api";
import { submitWarranty, updateWarranty } from "@/lib/warrantyApi";
import InstallerDetails from "./steps/InstallerDetails";
import CustomerDetails from "./steps/CustomerDetails";
import CarDetails from "./steps/CarDetails";
import ProductInfo from "./steps/ProductInfo";
import { WarrantyReviewDialog } from "./WarrantyReviewDialog";
import { Check, ShieldCheck } from "lucide-react";
import { getISTTodayISO, formatToISTDateISO } from "@/lib/utils";
import { getRollsError, toRollPayload } from "@/lib/ppfRolls";
import fpPromise from '@fingerprintjs/fingerprintjs';

/** One PPF roll drawn on by an installation. */
export interface PPFRoll {
  serial: string;
  /** Kept as text so a half-typed value is not coerced to 0 while editing. */
  sqft: string;
  /**
   * The part of the car this roll's film went on.
   *
   * Belongs to the roll rather than the vehicle: film from two rolls goes on
   * two different parts, and a single area for the whole job cannot say which
   * roll covered what.
   */
  installArea: string;
}

export interface EVFormData {
  // Installer Details
  storeName: string;
  storeEmail: string;
  dealerMobile: string;
  dealerAddr1: string;
  dealerAddr2: string;
  dealerState: string;
  dealerCity: string;
  dealerPostalCode: string;
  installerName: string;
  installerCode: string;
  manpowerId?: number | string;

  // Customer Details
  customerFname: string;
  customerLname: string;
  customerMobile: string;
  customerEmail: string;



  // Car Details
  installationDate: string;
  carModel: string;
  carReg: string;
  carMake: string;
  carYear: string;
  carColour: string;

  // Product Info
  product: string;
  warrantyType: string;
  /**
   * The roll(s) this installation drew on, and how much of each it used.
   *
   * PPF is sold as a roll of a fixed area and is rarely used up on one car, so
   * a single roll is registered across several vehicles and one vehicle may
   * take film from more than one roll. Each entry is a serial and the area
   * taken from it.
   */
  rolls: PPFRoll[];
  lhsPhoto: File | null;
  rhsPhoto: File | null;
  frontRegPhoto: File | null;
  backRegPhoto: File | null;
  warrantyPhoto: File | null;
  termsAccepted: boolean;
  allExifData?: Record<string, any>;
}

interface EVProductsFormProps {
  initialData?: any;
  warrantyId?: string;
  onSuccess?: (result?: any) => void;
  isUniversal?: boolean;
  isEditing?: boolean;
  isPublic?: boolean;
  vendorDirect?: boolean;
  /**
   * Rendered inside a dialog that already has its own padding, title and
   * surface. The form then drops its page header and its card, which would
   * otherwise be a second card inside the first — on a phone that nesting
   * costs about 48px of width before a single field is drawn.
   */
  embedded?: boolean;
  storeDetails?: {
    id: number;
    store_name: string;
    store_email: string;
    contact_number: string;
    address_line1?: string;
    city?: string;
    state?: string;
    pincode?: string;
    store_code?: string;
    owner_name?: string;
    vendor_details_id?: number;
  };
  installers?: any[];
}

const EVProductsForm = ({ initialData, warrantyId, onSuccess, isUniversal, isEditing, isPublic, vendorDirect, embedded, storeDetails, installers }: EVProductsFormProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [deviceFingerprint, setDeviceFingerprint] = useState<string | null>(null);
  const [vendorOwnerName, setVendorOwnerName] = useState<string>("");
  /* The "check your details" step between passing the checks and sending. */
  const [reviewOpen, setReviewOpen] = useState(false);

  const [formData, setFormData] = useState<EVFormData>({
    storeName: "",
    storeEmail: "",
    dealerMobile: "",
    dealerAddr1: "",
    dealerAddr2: "",
    dealerState: "",
    dealerCity: "",
    dealerPostalCode: "",
    customerFname: "",
    customerLname: "",
    customerMobile: "",
    customerEmail: "",
    installerName: "",
    installerCode: "",


    installationDate: getISTTodayISO(),
    carModel: "",
    carReg: "",
    product: "",
    warrantyType: "",
    rolls: [{ serial: "", sqft: "", installArea: "" }],
    carMake: "",
    carYear: "",
    carColour: "",
    lhsPhoto: null,
    rhsPhoto: null,
    frontRegPhoto: null,
    backRegPhoto: null,
    warrantyPhoto: null,
    termsAccepted: false,
    allExifData: {},
  });

  // Auto-fill customer details for logged-in customers
  // Auto-fill customer details for logged-in customers
  useEffect(() => {
    if (initialData) {
      // Pre-fill form with initial data for editing
      const pd = initialData.product_details || {};
      console.log('[EVProductsForm] Initializing with initialData:', { initialData, pd });
      const customerNameParts = initialData.customer_name?.split(' ') || [];
      const dealerAddressParts = pd.dealerAddress?.split(',') || [];
      const custAddressParts = initialData.customer_address?.split(',') || [];

      setFormData({
        storeName: initialData.installer_name || "",
        storeEmail: initialData.installer_contact?.split('|')[0]?.trim() || "",
        dealerMobile: initialData.installer_contact?.split('|')[1]?.trim() || "",
        dealerAddr1: dealerAddressParts[0]?.trim() || "",
        dealerAddr2: dealerAddressParts[1]?.trim() || "",
        dealerCity: dealerAddressParts[2]?.trim() || "",
        dealerState: dealerAddressParts[3]?.split('-')[0]?.trim() || "",
        dealerPostalCode: dealerAddressParts[3]?.split('-')[1]?.trim() || "",

        customerFname: customerNameParts[0] || "",
        customerLname: customerNameParts.slice(1).join(' ') || "",
        customerEmail: initialData.customer_email || "",
        customerMobile: initialData.customer_phone || "",



        installerName: pd.manpowerName || "",
        installerCode: pd.installerCode || "",
        manpowerId: initialData.manpower_id || "",

        installationDate: initialData.purchase_date ? formatToISTDateISO(initialData.purchase_date) : "",
        carModel: initialData.car_model || "",
        carReg: initialData.registration_number || "",
        carMake: initialData.car_make || "",
        carYear: initialData.car_year || "",
        carColour: initialData.car_colour || "",

        product: pd.product || "",
        warrantyType: initialData.warranty_type || "1 Year",
        /*
         * Warranties filed before rolls were tracked carry a single serial and
         * one area for the whole job. That area is carried onto the single roll
         * row, which is what it described; the sq.ft was never asked for, so it
         * is left blank for the installer to supply.
         */
        rolls: Array.isArray(pd.rolls) && pd.rolls.length > 0
          ? pd.rolls.map((r: any) => ({
            serial: r.serial || "",
            sqft: r.sqft != null ? String(r.sqft) : "",
            installArea: r.installArea || "",
          }))
          : [{ serial: pd.serialNumber || "", sqft: "", installArea: pd.installArea || "" }],

        // Photos are URLs in edit mode, need to handle this in ProductInfo or just show them
        // For now, we keep them null as we can't convert URL to File easily here without fetching
        // User will need to re-upload if they want to change, or we handle "existing photo" logic
        lhsPhoto: null,
        rhsPhoto: null,
        frontRegPhoto: null,
        backRegPhoto: null,
        warrantyPhoto: null,

        termsAccepted: true, // Assume accepted if editing
      });
    } else if (user?.role === 'customer') {
      const nameParts = user.name?.split(' ') || [];
      const firstName = nameParts[0] || "";
      const lastName = nameParts.slice(1).join(' ') || "";

      setFormData(prev => ({
        ...prev,
        customerFname: firstName,
        customerLname: lastName,
        customerEmail: user.email || "",
        customerMobile: user.phoneNumber || "",
      }));
    } else if (user?.role === 'vendor') {
      // Auto-fill vendor/store details for logged-in vendors
      const fetchVendorDetails = async () => {
        try {
          const response = await api.get('/vendor/profile');
          if (response.data.success && response.data.vendorDetails) {
            const vendorDetails = response.data.vendorDetails;
            setFormData(prev => ({
              ...prev,
              storeName: vendorDetails.store_name || "",
              storeEmail: vendorDetails.store_email || "",
              dealerMobile: vendorDetails.contact_number || "",
              dealerAddr1: vendorDetails.address_line1 || "",
              dealerAddr2: vendorDetails.address_line2 || "",
              dealerCity: vendorDetails.city || "",
              dealerState: vendorDetails.state || "",
              dealerPostalCode: vendorDetails.postal_code || "",
            }));
            if (vendorDetails.owner_name) {
              setVendorOwnerName(vendorDetails.owner_name);
            }
          }
        } catch (error) {
          console.error("Failed to fetch vendor details", error);
        }
      };
      fetchVendorDetails();
    }
  }, [user, initialData]);

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

  // Auto-fill store details for public QR flow
  useEffect(() => {
    if (isPublic && storeDetails) {
      setFormData(prev => ({
        ...prev,
        storeName: storeDetails.store_name || "",
        storeEmail: storeDetails.store_email || "",
        dealerMobile: storeDetails.contact_number || "",
        dealerAddr1: storeDetails.address_line1 || "",
        dealerCity: storeDetails.city || "",
        dealerState: storeDetails.state || "",
        // The store's own postcode — never the customer's to type.
        dealerPostalCode: storeDetails.pincode || "",
      }));
    }
  }, [isPublic, storeDetails]);

  const steps = [
    { number: 1, label: "Installer Details" },
    { number: 2, label: "Customer Details" },
    { number: 3, label: "Car Details" },
    { number: 4, label: "Product Info" },
  ];

  const handleNext = () => {
    if (currentStep < 4) {
      setCurrentStep(currentStep + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handlePrev = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  /** Checks the form; then shows the review, and only `confirmed` from there sends it. */
  const handleSubmit = async (confirmed = false) => {
    // === Step 1: Installer Details Validation (skip for public mode) ===
    if (!isPublic) {
      if (!formData.storeName) {
        toast({ title: "Store Name Required", description: "Please select a store", variant: "destructive" });
        return;
      }
      if (!formData.installerName) {
        toast({ title: "Installer Name Required", description: "Please select an installer", variant: "destructive" });
        return;
      }
    }

    // Email is optional (Phone-Number Centric)

    // === Step 2: Customer Details Validation ===
    // Prevent vendor from using their own email as the customer email
    if (user?.role === 'vendor' && formData.customerEmail && user.email && formData.customerEmail.toLowerCase().trim() === user.email.toLowerCase().trim()) {
      toast({
        title: "Invalid Customer Email",
        description: "You cannot use your franchise email address as the customer's email. Please use the actual customer's email.",
        variant: "destructive",
      });
      return;
    }

    if (!formData.customerFname) {
      toast({ title: "Customer Name Required", description: "Please enter customer's first name", variant: "destructive" });
      return;
    }
    if (!formData.customerMobile) {
      toast({ title: "Customer Mobile Required", description: "Please enter customer's mobile number", variant: "destructive" });
      return;
    }

    // === Step 3: Car Details Validation ===
    if (!formData.installationDate) {
      toast({ title: "Installation Date Required", description: "Please select installation date", variant: "destructive" });
      return;
    }

    if (!formData.carMake) {
      toast({ title: "Vehicle Make Required", description: "Please select vehicle make", variant: "destructive" });
      return;
    }

    if (!formData.carModel) {
      toast({ title: "Vehicle Model Required", description: "Please enter vehicle model", variant: "destructive" });
      return;
    }

    if (!formData.carReg) {
      toast({ title: "Registration Number Required", description: "Please enter car registration number", variant: "destructive" });
      return;
    }

    // === Step 4: Product Info Validation ===
    if (!formData.product) {
      toast({ title: "Product Required", description: "Please select a product", variant: "destructive" });
      return;
    }

    const rollError = getRollsError(formData.rolls);
    if (rollError) {
      toast({ title: "Roll Details", description: rollError, variant: "destructive" });
      return;
    }

    // === Photo Validation ===
    if (!formData.lhsPhoto) {
      toast({ title: "LHS Photo Required", description: "Please upload left hand side photo", variant: "destructive" });
      return;
    }
    if (!formData.rhsPhoto) {
      toast({ title: "RHS Photo Required", description: "Please upload right hand side photo", variant: "destructive" });
      return;
    }
    if (!formData.frontRegPhoto) {
      toast({ title: "Front Photo Required", description: "Please upload front photo with registration number", variant: "destructive" });
      return;
    }
    if (!formData.backRegPhoto) {
      toast({ title: "Back Photo Required", description: "Please upload back photo with registration number", variant: "destructive" });
      return;
    }
    if (!formData.warrantyPhoto) {
      toast({ title: "Invoice Required", description: "Please upload the invoice photo with the dealer stamp", variant: "destructive" });
      return;
    }

    // === Terms Validation ===
    if (!formData.termsAccepted) {
      toast({ title: "Terms Required", description: "Please accept the terms and conditions", variant: "destructive" });
      return;
    }

    // Everything checks out: let them see it all once before it goes.
    if (!confirmed) {
      setReviewOpen(true);
      return;
    }

    setLoading(true);

    try {
      // Use direct values from formData
      const carMake = formData.carMake;
      const carModelName = formData.carModel;

      // Prepare warranty data
      const warrantyData = {
        productType: "ev-products",
        customerName: `${formData.customerFname} ${formData.customerLname}`,
        customerEmail: formData.customerEmail,
        customerPhone: formData.customerMobile,
        customerAddress: "N/A",
        registrationNumber: formData.carReg,
        carMake: carMake || null,
        carModel: carModelName || null,
        /*
         * The year is asked for and validated on the vehicle step, so this
         * fallback should never fire. It stays because carYear is a required
         * field on the server: were some path ever to reach here without one,
         * a wrong year is a smaller failure than a rejected submission the
         * installer cannot interpret.
         */
        carYear: formData.carYear || new Date().getFullYear().toString(),
        carColour: formData.carColour || null,
        purchaseDate: formData.installationDate,
        warrantyType: formData.warrantyType || "1 Year", // Use selected warranty type from product
        installerName: formData.storeName,
        installerContact: formData.storeEmail,
        manpowerId: formData.manpowerId || null,
        /*
         * Which store this was filled in at, taken from the QR link rather than
         * anything typed. The server uses it to refuse a serial issued to a
         * different store; store names are retyped and repeat across branches,
         * so the code is what identifies a store exactly.
         */
        ...(isPublic && storeDetails?.store_code
          ? { storeCode: storeDetails.store_code }
          : {}),
        /*
         * Which registration a correction is replacing. A PPF serial names the
         * roll rather than one registration now that a roll covers several
         * vehicles, so the server matches a resubmission on this instead.
         */
        ...(warrantyId ? { warrantyId } : {}),
        productDetails: {
          product: formData.product,
          rolls: toRollPayload(formData.rolls),
          manpowerId: formData.manpowerId,
          manpowerName: formData.installerName,
          storeName: formData.storeName,
          storeEmail: formData.storeEmail,
          dealerMobile: formData.dealerMobile,
          customerAddress: "N/A", // Added to ensure it's saved in JSON
          carRegistration: formData.carReg,
          dealerAddress: `${formData.dealerAddr1}, ${formData.dealerAddr2 ? formData.dealerAddr2 + ', ' : ''}${formData.dealerCity}, ${formData.dealerState} - ${formData.dealerPostalCode}`,
          photos: {
            lhs: formData.lhsPhoto, // Pass File object
            rhs: formData.rhsPhoto,
            frontReg: formData.frontRegPhoto,
            backReg: formData.backRegPhoto,
            warranty: formData.warrantyPhoto,
          },
          termsAccepted: formData.termsAccepted,
          installationDate: formData.installationDate,
          deviceFingerprint,
          allExifData: formData.allExifData,
        },
        vendorDirect: vendorDirect || false,
      };

      // Submit or Update warranty registration
      let result;
      if (warrantyId) {
        result = await updateWarranty(warrantyId, warrantyData);
        console.log('[DEBUG] Update result:', result);
        toast({
          title: "Warranty Updated",
          description: "Warranty updated successfully.",
        });
      } else if (isPublic) {
        // Public flow: use public API endpoint
        const formDataPayload = new FormData();

        // Add warranty data fields
        Object.entries(warrantyData).forEach(([key, value]) => {
          if (key === 'productDetails') {
            const pd = value as any;
            // Extract photos before stringifying
            const photos = pd.photos || {};
            const pdWithoutPhotos = { ...pd };
            delete pdWithoutPhotos.photos;
            formDataPayload.append('productDetails', JSON.stringify(pdWithoutPhotos));

            // Append photo files
            if (photos.lhs instanceof File) formDataPayload.append('lhsPhoto', photos.lhs);
            if (photos.rhs instanceof File) formDataPayload.append('rhsPhoto', photos.rhs);
            if (photos.frontReg instanceof File) formDataPayload.append('frontRegPhoto', photos.frontReg);
            if (photos.backReg instanceof File) formDataPayload.append('backRegPhoto', photos.backReg);
            if (photos.warranty instanceof File) formDataPayload.append('warrantyPhoto', photos.warranty);
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
          description: `Success! Serial No: ${formData.rolls.map(r => r.serial).join(', ')}, Vehicle Reg: ${formData.carReg}`,
        });
      }

      setReviewOpen(false);
      // Redirect or callback
      if (onSuccess) {
        // Embedded in admin panel — just call the callback, no navigation
        onSuccess(result);
      } else {
        // Standalone form (public QR, vendor, customer) — go to thank you page
        navigate("/thank-you", {
          state: {
            submissionDetails: {
              customerName: `${formData.customerFname} ${formData.customerLname}`,
              productType: "ev-ppf",
              registrationId: result?.warrantyId || result?.uid || "PENDING",
              role: user?.role || 'public',
              isPublic: isPublic
            }
          }
        });
      }
    } catch (error: any) {
      // Determine specific error message based on error type
      let errorTitle = "Submission Failed";
      let errorMessage = "Failed to submit EV product warranty registration";

      if (error.code === "ERR_NETWORK" || error.message?.includes("Network Error")) {
        errorTitle = "Network Error";
        errorMessage = "Unable to connect to server. Please check your internet connection and try again. If uploading photos, try using smaller images.";
      } else if (error.code === "ECONNABORTED" || error.message?.includes("timeout")) {
        errorTitle = "Upload Timeout";
        errorMessage = "The upload took too long. Try using smaller photos (under 2MB each) or a faster internet connection.";
      } else if (error.response?.status === 413) {
        errorTitle = "Files Too Large";
        errorMessage = "The total upload size is too large. Please use smaller images (under 2MB each).";
      } else if (error.response?.status === 400) {
        errorMessage = getErrorMessage(error, "Invalid form data. Please check all fields and try again.");
      } else if (error.response?.status === 401 || error.response?.status === 403) {
        errorTitle = "Session Expired";
        errorMessage = "Your session has expired. Please log in again.";
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

  const updateFormData = (updates: Partial<EVFormData>) => {
    setFormData(prev => ({ ...prev, ...updates }));
  };

  const progress = (currentStep / 4) * 100;

  return (
    <div className={embedded ? "space-y-4" : "max-w-5xl mx-auto space-y-8"}>
      {/* Header Section — hidden on the QR flow, where the page above already
          names the store and states what the form is for. Repeating it pushes
          the actual fields below the fold on a phone. */}
      <div className={`text-center space-y-2 mb-8 ${(isPublic && storeDetails) || embedded ? "hidden" : ""}`}>
        <div className="inline-flex items-center justify-center p-3 bg-blue-100 rounded-full mb-4 ring-8 ring-blue-50">
          <ShieldCheck className="h-8 w-8 text-blue-600" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
          {warrantyId ? 'Edit Warranty Application' : 'Paint Protection Film (PPF) Registration'}
        </h1>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          {warrantyId ? 'Update the details below to resubmit your application' : 'Please fill in all required fields to register your Paint Protection Film (PPF) warranty'}
        </p>
      </div>

      <Card className={embedded
        ? "border-0 shadow-none bg-transparent ring-0"
        : "border-0 shadow-xl bg-white/90 backdrop-blur-sm ring-1 ring-slate-100"}>
        <div className={embedded ? "border-b border-slate-100 pb-4" : "border-b border-slate-100 px-5 py-5 sm:px-8 sm:py-6"}>
          {/*
           * Where you are in the form, in one line.
           *
           * The previous version gave every step a 40px ring-haloed circle in
           * three colours and a full label underneath, which on a phone left
           * four captions competing for the width and wrapping into each
           * other. Done steps no longer need their name — they are done — so
           * only the current one is named, and the rest become marks on a rule.
           */}
          <div className="flex items-center gap-2 sm:gap-3">
            {steps.map((step, i) => {
              const isActive = step.number === currentStep;
              const isCompleted = step.number < currentStep;

              return (
                <div key={step.number} className="flex items-center gap-2 sm:gap-3 min-w-0">
                  <div
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition-colors ${
                      isActive
                        ? 'bg-slate-900 text-white'
                        : isCompleted
                          ? 'bg-slate-900/10 text-slate-500'
                          : 'bg-slate-100 text-slate-400'
                    }`}
                  >
                    {isCompleted ? <Check className="h-3.5 w-3.5" /> : step.number}
                  </div>

                  {/* Only the step you are on is named. The others are numbered
                      already, and four labels do not fit a phone. */}
                  {isActive && (
                    <span className="text-sm font-semibold text-slate-900 truncate">
                      {step.label}
                    </span>
                  )}

                  {i < steps.length - 1 && (
                    <span
                      aria-hidden
                      className={`h-px w-4 sm:w-8 shrink-0 rounded-full transition-colors ${
                        isCompleted ? 'bg-slate-300' : 'bg-slate-200'
                      }`}
                    />
                  )}
                </div>
              );
            })}

            <span className="ml-auto shrink-0 text-xs font-medium text-slate-400 tabular-nums">
              {currentStep}/{steps.length}
            </span>
          </div>
        </div>

        <CardContent className={embedded ? "p-0 pt-5 min-h-0" : "p-6 md:p-10 min-h-[400px]"}>
          {/* Step Content with Transitions */}
          <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            {currentStep === 1 && (
              <div className="space-y-6">
                <InstallerDetails
                  formData={formData}
                  updateFormData={updateFormData}
                  onNext={handleNext}
                  isPublic={isPublic}
                  isEditing={isEditing}
                  installers={installers}
                  storeDetails={isPublic ? storeDetails : { owner_name: vendorOwnerName }}
                />
              </div>
            )}

            {currentStep === 2 && (
              <div className="space-y-6">
                <CustomerDetails
                  formData={formData}
                  updateFormData={updateFormData}
                  onNext={handleNext}
                  onPrev={handlePrev}
                  isCustomer={!isPublic && user?.role === 'customer'}
                  isVendor={!isPublic && user?.role === 'vendor'}
                />
              </div>
            )}

            {currentStep === 3 && (
              <div className="space-y-6">
                <CarDetails
                  formData={formData}
                  updateFormData={updateFormData}
                  onNext={handleNext}
                  onPrev={handlePrev}
                  isEditing={isEditing}
                />
              </div>
            )}

            {currentStep === 4 && (
              <div className="space-y-6">
                <ProductInfo
                  formData={formData}
                  updateFormData={updateFormData}
                  onPrev={handlePrev}
                  onSubmit={() => handleSubmit()}
                  loading={loading}
                  existingPhotos={isEditing && initialData?.product_details?.photos ? initialData.product_details.photos : undefined}
                />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Modify closes this and leaves the form as it was; Edit jumps to that step. */}
      <WarrantyReviewDialog
        open={reviewOpen}
        loading={loading}
        onModify={() => setReviewOpen(false)}
        onConfirm={() => handleSubmit(true)}
        sections={[
          ...(!isPublic ? [{
            title: "Store & installer",
            onEdit: () => { setReviewOpen(false); setCurrentStep(1); },
            rows: [
              ["Store", formData.storeName],
              ["Installer", formData.installerName],
            ] as [string, string][],
          }] : []),
          {
            title: "Customer",
            onEdit: () => { setReviewOpen(false); setCurrentStep(2); },
            rows: [
              ["Name", `${formData.customerFname} ${formData.customerLname}`.trim()],
              ["Mobile", formData.customerMobile],
              ["Email", formData.customerEmail],
            ],
          },
          {
            title: "Vehicle",
            onEdit: () => { setReviewOpen(false); setCurrentStep(3); },
            rows: [
              ["Installation date", formData.installationDate
                ? new Date(`${formData.installationDate}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
                : ""],
              ["Make & model", [formData.carMake, formData.carModel].filter(Boolean).join(" ")],
              ["Registration no.", formData.carReg],
              ["Year", formData.carYear],
              ["Colour", formData.carColour],
            ],
          },
          {
            title: "Product",
            onEdit: () => { setReviewOpen(false); setCurrentStep(4); },
            rows: [
              ["Product", formData.product],
              ["Warranty", formData.warrantyType],
              ...formData.rolls.map((r, i) => [
                formData.rolls.length > 1 ? `Roll ${i + 1}` : "Roll",
                [r.serial, r.sqft ? `${r.sqft} sq.ft` : "", r.installArea].filter(Boolean).join(" · "),
              ] as [string, string]),
            ],
          },
        ]}
        photos={[
          { label: "Left side", file: formData.lhsPhoto, url: initialData?.product_details?.photos?.lhs },
          { label: "Right side", file: formData.rhsPhoto, url: initialData?.product_details?.photos?.rhs },
          { label: "Front with number plate", file: formData.frontRegPhoto, url: initialData?.product_details?.photos?.frontReg },
          { label: "Back with number plate", file: formData.backRegPhoto, url: initialData?.product_details?.photos?.backReg },
          { label: "Invoice", file: formData.warrantyPhoto, url: initialData?.product_details?.photos?.warranty },
        ]}
      />
    </div>
  );
};

export default EVProductsForm;