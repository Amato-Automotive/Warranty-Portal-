import { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth, UserRole } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { User, Mail, Phone, AlertCircle, KeyRound, Store, Plus, Trash2, Users, Loader2, FileText } from "lucide-react";
import { BRAND_CHOICES, type Brand } from "@/lib/brand";
import {
  validateIndianMobile,
  cleanPhoneNumber,
  getPhoneError,
  getEmailError,
  getPincodeError,
  getGstError,
  getCityError,
  cleanPlaceName,
  INDIAN_STATE_NAMES
} from "@/lib/validation";

interface Manpower {
  id: string;
  name: string;
  phoneNumber: string;
  manpowerId: string;
  applicatorType: string;
}

interface FormErrors {
  brand?: string;
  name?: string;
  email?: string;
  phoneNumber?: string;
  storeName?: string;
  storeEmail?: string;
  address?: string;
  state?: string;
  city?: string;
  pincode?: string;
  gstNumber?: string;
}

const Register = () => {
  const [searchParams] = useSearchParams();
  const role = (searchParams.get("role") as UserRole) || "customer";
  const mode = searchParams.get("mode"); // "warranty" | "franchise" | null

  // Build the back-to-login URL preserving mode if present
  const loginUrl = mode
    ? `/login?mode=${mode}`
    : `/login?role=${role}`;

  // Common state
  const [otp, setOtp] = useState("");
  const [userId, setUserId] = useState<string>("");
  const [showOTP, setShowOTP] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [termsAccepted, setTermsAccepted] = useState(false);

  // Customer Form Data
  const [customerData, setCustomerData] = useState({
    name: "",
    email: "",
    phoneNumber: ""
  });

  // Vendor Form Data
  const [vendorData, setVendorData] = useState({
    contactName: "",
    storeName: "",
    storeEmail: "",
    phoneNumber: "",
    address: "",
    state: "",
    city: "",
    pincode: "",
    gstNumber: "",
    brand: "" as "" | Brand,
  });

  // Handle Customer Input Change with validation
  const handleCustomerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;

    // Clean phone number input
    if (name === 'phoneNumber') {
      const cleaned = cleanPhoneNumber(value);
      setCustomerData(prev => ({ ...prev, [name]: cleaned }));
      setErrors(prev => ({ ...prev, phoneNumber: getPhoneError(cleaned) }));
    } else if (name === 'email') {
      const sanitized = value.trim().toLowerCase();
      setCustomerData(prev => ({ ...prev, [name]: sanitized }));
      setErrors(prev => ({ ...prev, email: getEmailError(sanitized) }));
    } else if (name === 'name') {
      // Allow only letters and spaces for name
      const textOnly = value.replace(/[^A-Za-z\s]/g, '');
      setCustomerData(prev => ({ ...prev, [name]: textOnly }));
    } else {
      setCustomerData(prev => ({ ...prev, [name]: value }));
    }
  };

  // Handle Vendor Input Change with validation
  const handleVendorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;

    if (name === 'phoneNumber') {
      const cleaned = cleanPhoneNumber(value);
      setVendorData(prev => ({ ...prev, [name]: cleaned }));
      setErrors(prev => ({ ...prev, phoneNumber: getPhoneError(cleaned) }));
    } else if (name === 'storeEmail') {
      const sanitized = value.trim().toLowerCase();
      setVendorData(prev => ({ ...prev, [name]: sanitized }));
      setErrors(prev => ({ ...prev, storeEmail: getEmailError(sanitized) }));
    } else if (name === 'gstNumber') {
      // GST is always uppercase; validate live so a bad one is caught at entry
      // rather than sitting in the database (one stored value has a leading space).
      const cleaned = value.toUpperCase().replace(/\s/g, '').slice(0, 15);
      setVendorData(prev => ({ ...prev, gstNumber: cleaned }));
      setErrors(prev => ({ ...prev, gstNumber: getGstError(cleaned) }));
      return;
    } else if (name === 'pincode') {
      const cleaned = value.replace(/\D/g, '').slice(0, 6);
      setVendorData(prev => ({ ...prev, [name]: cleaned }));
      setErrors(prev => ({ ...prev, pincode: getPincodeError(cleaned) }));
    } else if (name === 'city') {
      // Letters and spaces only, as before, but the run of spaces is collapsed
      // so "Nasik  " and "Nasik" cannot become two cities. Final Title Casing
      // happens on submit rather than here, which would fight the cursor.
      const textOnly = value.replace(/[^A-Za-z\s]/g, '').replace(/\s{2,}/g, ' ');
      setVendorData(prev => ({ ...prev, city: textOnly }));
      setErrors(prev => ({ ...prev, city: textOnly.trim() ? '' : prev.city }));
    } else if (['contactName', 'storeName'].includes(name)) {
      // Allow only letters and spaces for name and location fields
      const textOnly = value.replace(/[^A-Za-z\s]/g, '');
      setVendorData(prev => ({ ...prev, [name]: textOnly }));
    } else {
      setVendorData(prev => ({ ...prev, [name]: value }));
    }
  };


  // Manpower Data
  const [manpowerList, setManpowerList] = useState<Manpower[]>([
    { id: "1", name: "", phoneNumber: "", manpowerId: "", applicatorType: "" },
    { id: "2", name: "", phoneNumber: "", manpowerId: "", applicatorType: "" },
    { id: "3", name: "", phoneNumber: "", manpowerId: "", applicatorType: "" }
  ]);

  const navigate = useNavigate();
  const { register, verifyOTP } = useAuth();
  const { toast } = useToast();

  // Handle Manpower Change with phone validation
  const handleManpowerChange = (id: string, field: keyof Manpower, value: string) => {
    setManpowerList(prev => prev.map(item => {
      if (item.id === id) {
        let processedValue = value;

        // Clean phone number for manpower
        if (field === 'phoneNumber') {
          processedValue = cleanPhoneNumber(value);
        } else if (field === 'name') {
          // Allow only letters and spaces for name
          processedValue = value.replace(/[^A-Za-z\s]/g, '');
        }

        const updatedItem = { ...item, [field]: processedValue };

        // Auto-generate Manpower ID if name or phone changes
        if (field === "name" || field === "phoneNumber") {
          const namePart = updatedItem.name.slice(0, 3).toUpperCase();
          const phonePart = updatedItem.phoneNumber.slice(-4);
          updatedItem.manpowerId = (namePart && phonePart) ? `${namePart}${phonePart}` : "";
        }

        return updatedItem;
      }
      return item;
    }));
  };

  // Add Manpower Row
  const addManpowerRow = () => {
    const newId = (manpowerList.length + 1).toString();
    setManpowerList(prev => [
      ...prev,
      { id: newId, name: "", phoneNumber: "", manpowerId: "", applicatorType: "" }
    ]);
  };

  // Remove Manpower Row
  const removeManpowerRow = (id: string) => {
    if (manpowerList.length > 1) {
      setManpowerList(prev => prev.filter(item => item.id !== id));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!termsAccepted) {
      toast({
        title: "Terms Required",
        description: "Please accept the terms and conditions to proceed.",
        variant: "destructive",
      });
      return;
    }

    // Validate before submission
    if (role === "customer") {
      const emailError = getEmailError(customerData.email);
      const phoneError = getPhoneError(customerData.phoneNumber);

      if (emailError || phoneError) {
        setErrors({ email: emailError, phoneNumber: phoneError });
        toast({
          title: "Validation Error",
          description: emailError || phoneError,
          variant: "destructive",
        });
        return;
      }
    } else {
      // Vendor validation
      const emailError = getEmailError(vendorData.storeEmail);
      const phoneError = getPhoneError(vendorData.phoneNumber);
      const pincodeError = getPincodeError(vendorData.pincode);
      // Required for new registrations. Stores already on file may have no GST,
      // which is why the shared validator still treats empty as valid by default.
      const gstError = getGstError(vendorData.gstNumber, true);
      const cityError = getCityError(vendorData.city);
      const stateError = vendorData.state ? '' : 'Please select your state';
      const brandError = vendorData.brand ? '' : 'Choose your brand';

      if (emailError || phoneError || pincodeError || gstError || cityError || stateError || brandError) {
        setErrors({
          storeEmail: emailError, phoneNumber: phoneError, pincode: pincodeError,
          gstNumber: gstError, city: cityError, state: stateError, brand: brandError,
        });
        toast({
          title: "Validation Error",
          description: emailError || phoneError || pincodeError || gstError || cityError || stateError,
          variant: "destructive",
        });
        return;
      }

      // Validate manpower phone numbers
      const invalidManpower = manpowerList.filter(m => m.phoneNumber && !validateIndianMobile(m.phoneNumber));
      if (invalidManpower.length > 0) {
        toast({
          title: "Validation Error",
          description: "Please enter valid 10-digit Indian mobile numbers for all manpower entries",
          variant: "destructive",
        });
        return;
      }
    }

    setLoading(true);

    try {
      // Prepare data based on role
      const registrationData = role === "customer"
        ? { ...customerData, role }
        : {
          ...vendorData,
          // Tidied here as well as on the server, so what the franchise sees
          // confirmed is exactly what gets stored.
          city: cleanPlaceName(vendorData.city),
          gstNumber: vendorData.gstNumber.trim().toUpperCase(),
          name: vendorData.contactName, // Map contactName to name for backend compatibility
          email: vendorData.storeEmail, // Map storeEmail to email
          manpower: manpowerList.filter(m => m.name && m.phoneNumber), // Filter empty rows
          role
        };

      const result = await register(registrationData);
      setUserId(result.userId);
      setShowOTP(true);

      toast({
        title: "OTP Sent",
        description: result.message || "An OTP has been sent. Enter it below to complete registration.",
      });
    } catch (error: any) {
      console.error("Registration error:", error);
      let errorMessage = "Registration failed.";
      if (typeof error.response?.data?.error === 'string') {
        errorMessage = error.response.data.error;
      } else if (error.response?.data?.error?.message) {
        errorMessage = error.response.data.error.message;
      } else if (error.message) {
        errorMessage = error.message;
      }

      toast({
        title: "Registration Failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const result = await verifyOTP(userId, otp);

      if (role === "customer") {
        if (result.user) {
          toast({
            title: "Registration Successful",
            description: "Registration complete! Welcome aboard!"
          });
          navigate("/", { replace: true });
        }
      } else {
        toast({
          title: "Registration Submitted",
          description: "Your franchise registration request has been submitted for approval. You'll be notified once reviewed.",
          duration: 5000
        });
        setTimeout(() => {
          navigate(loginUrl, { replace: true });
        }, 2000);
      }
    } catch (error: any) {
      let errorMessage = "Invalid OTP.";
      if (typeof error.response?.data?.error === 'string') {
        errorMessage = error.response.data.error;
      } else if (error.response?.data?.error?.message) {
        errorMessage = error.response.data.error.message;
      } else if (error.message) {
        errorMessage = error.message;
      }

      toast({
        title: "Verification Failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full relative flex items-start justify-center p-4 overflow-y-auto">
      {/* Background Image */}
      <div className="fixed inset-0 z-0">
        <img
          src="/images/seat-cover-hero.jpg"
          alt="Background"
          className="w-full h-full object-cover"
        />
        {/* Lighter Gradient for Glass Contrast */}
        <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />
      </div>

      {/* Glassmorphism Card */}
      <div className={`relative z-10 w-full ${role === "vendor" ? "max-w-4xl" : "max-w-lg"} bg-white/10 backdrop-blur-xl border border-white/20 shadow-2xl rounded-3xl p-6 sm:p-10 my-8 animate-in fade-in zoom-in duration-500`}>
        {/* Logo */}
        <div className="flex flex-col items-center mb-8 text-center mx-auto">
          <Link to="/" className="flex flex-col items-center">
            <img
              src="/autoform-logo.png"
              alt="AutoForm"
              className="h-24 w-auto object-contain brightness-0 invert drop-shadow-lg"
            />
            <p className="text-white/80 text-xs font-bold tracking-[0.3em] uppercase mt-2 drop-shadow-md">
              Warranty Portal
            </p>
          </Link>
        </div>

        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold mb-2 text-white">
            {role === "customer" ? "Customer Registration" : "Franchise Registration"}
          </h1>
          {showOTP && (
            <p className="text-white/70">
              Enter the verification code to proceed
            </p>
          )}
          {!showOTP && role === "vendor" && (
            <p className="text-white/70">Register your store details and manpower</p>
          )}
        </div>

        {!showOTP ? (
          <form onSubmit={handleSubmit} className="space-y-8">
            {role === "customer" ? (
              // Customer Form
              <div className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-white">Full Name *</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-white/60" />
                    <Input
                      id="name"
                      name="name"
                      placeholder="John Doe"
                      value={customerData.name}
                      onChange={handleCustomerChange}
                      required
                      disabled={loading}
                      className="pl-11 h-12 bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:bg-white/20 border-2"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-white">Email Address *</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-white/60" />
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      placeholder="your.email@example.com"
                      value={customerData.email}
                      onChange={handleCustomerChange}
                      required
                      disabled={loading}
                      className={`pl-11 h-12 bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:bg-white/20 border-2 ${errors.email ? 'border-red-400' : ''}`}
                    />
                  </div>
                  {errors.email && (
                    <p className="text-sm text-red-300 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" /> {errors.email}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phoneNumber" className="text-white">Phone Number * <span className="text-xs text-white/60">(10-digit Indian mobile)</span></Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-white/60" />
                    <Input
                      id="phoneNumber"
                      name="phoneNumber"
                      type="tel"
                      placeholder="9876543210"
                      value={customerData.phoneNumber}
                      onChange={handleCustomerChange}
                      required
                      maxLength={10}
                      disabled={loading}
                      className={`pl-11 h-12 bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:bg-white/20 border-2 ${errors.phoneNumber ? 'border-red-400' : ''}`}
                    />
                  </div>
                  {errors.phoneNumber && (
                    <p className="text-sm text-red-300 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" /> {errors.phoneNumber}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              // Vendor Form
              <div className="space-y-8">
                {/* Contact Information Section */}
                <div className="space-y-6">
                  <h2 className="text-xl font-semibold flex items-center gap-2 border-b border-white/20 pb-2 text-white">
                    <Store className="h-5 w-5 text-blue-300" />
                    Contact Information
                  </h2>

                  {/* The brand the store carries: its logo and wording in the portal follow it. */}
                  <fieldset className="space-y-2">
                    <legend className="text-sm font-medium text-white">Your brand *</legend>
                    <div className="grid grid-cols-3 gap-2">
                      {BRAND_CHOICES.map(b => (
                        <label key={b.value} className={`flex min-h-[52px] cursor-pointer flex-col items-center justify-center rounded-xl border px-2 py-2 text-center ${vendorData.brand === b.value ? "border-orange-400 bg-white/25" : "border-white/20 bg-white/10 hover:bg-white/15"}`}>
                          <input type="radio" name="brand" value={b.value} checked={vendorData.brand === b.value} disabled={loading}
                            onChange={() => { setVendorData(v => ({ ...v, brand: b.value })); setErrors(e => ({ ...e, brand: '' })); }} className="sr-only" />
                          <span className="text-sm font-bold text-white">{b.label}</span>
                          <span className="text-[11px] font-semibold text-white/60">{b.note}</span>
                        </label>
                      ))}
                    </div>
                    {errors.brand && <p className="text-xs text-red-300">{errors.brand}</p>}
                  </fieldset>

                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label htmlFor="contactName" className="text-white">Contact Name *</Label>
                      <Input
                        id="contactName"
                        name="contactName"
                        placeholder="Store Owner Name"
                        value={vendorData.contactName}
                        onChange={handleVendorChange}
                        required
                        disabled={loading}
                        className="h-11 bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:bg-white/20 border"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="storeName" className="text-white">Store Name *</Label>
                      <Input
                        id="storeName"
                        name="storeName"
                        placeholder="Tech Store India"
                        value={vendorData.storeName}
                        onChange={handleVendorChange}
                        required
                        disabled={loading}
                        className="h-11 bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:bg-white/20 border"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="storeEmail" className="text-white">Store Email *</Label>
                      <Input
                        id="storeEmail"
                        name="storeEmail"
                        type="email"
                        placeholder="store@example.com"
                        value={vendorData.storeEmail}
                        onChange={handleVendorChange}
                        required
                        disabled={loading}
                        className={`h-11 bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:bg-white/20 border ${errors.storeEmail ? 'border-red-400' : ''}`}
                      />
                      {errors.storeEmail && (
                        <p className="text-sm text-red-300 flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" /> {errors.storeEmail}
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="phoneNumber" className="text-white">Phone Number * <span className="text-xs text-white/60">(10-digit)</span></Label>
                      <Input
                        id="phoneNumber"
                        name="phoneNumber"
                        type="tel"
                        placeholder="9876543210"
                        value={vendorData.phoneNumber}
                        onChange={handleVendorChange}
                        required
                        maxLength={10}
                        disabled={loading}
                        className={`h-11 bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:bg-white/20 border ${errors.phoneNumber ? 'border-red-400' : ''}`}
                      />
                      {errors.phoneNumber && (
                        <p className="text-sm text-red-300 flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" /> {errors.phoneNumber}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="address" className="text-white">Address *</Label>
                    <Input
                      id="address"
                      name="address"
                      placeholder="Shop No, Street, Area"
                      value={vendorData.address}
                      onChange={handleVendorChange}
                      required
                      disabled={loading}
                      className="h-11 bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:bg-white/20 border"
                    />
                  </div>

                  <div className="grid md:grid-cols-3 gap-6">
                    <div className="space-y-2">
                      <Label htmlFor="state" className="text-white">State *</Label>
                      {/* A list rather than a text box: typed states arrived as
                          "Maharastra", "Madhay pradesh " and three spellings of
                          Jammu & Kashmir, each splitting the store into its own
                          row in every filter and report. */}
                      <Select
                        value={vendorData.state}
                        onValueChange={(value) =>
                          setVendorData(prev => ({ ...prev, state: value }))
                        }
                        disabled={loading}
                      >
                        <SelectTrigger
                          id="state"
                          className="h-11 bg-white/10 border-white/20 text-white focus:bg-white/20 border data-[placeholder]:text-white/40"
                        >
                          <SelectValue placeholder="Select state" />
                        </SelectTrigger>
                        <SelectContent className="max-h-72">
                          {INDIAN_STATE_NAMES.map((name) => (
                            <SelectItem key={name} value={name}>{name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="city" className="text-white">City *</Label>
                      <Input
                        id="city"
                        name="city"
                        placeholder="City"
                        value={vendorData.city}
                        onChange={handleVendorChange}
                        onBlur={(e) =>
                          setVendorData(prev => ({ ...prev, city: cleanPlaceName(e.target.value) }))
                        }
                        required
                        disabled={loading}
                        className={`h-11 bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:bg-white/20 border ${errors.city ? 'border-red-400' : ''}`}
                      />
                      {errors.city && (
                        <p className="text-sm text-red-300 flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" /> {errors.city}
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="pincode" className="text-white">Pincode * <span className="text-xs text-white/60">(6-digit)</span></Label>
                      <Input
                        id="pincode"
                        name="pincode"
                        placeholder="110001"
                        value={vendorData.pincode}
                        onChange={handleVendorChange}
                        required
                        maxLength={6}
                        disabled={loading}
                        className={`h-11 bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:bg-white/20 border ${errors.pincode ? 'border-red-400' : ''}`}
                      />
                      {errors.pincode && (
                        <p className="text-sm text-red-300 flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" /> {errors.pincode}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Required for new registrations. Franchises already on file
                      may have none, so the shared validator keeps empty valid by
                      default and only this form demands it. */}
                  <div className="space-y-2">
                    <Label htmlFor="gstNumber" className="text-white">
                      GST Number * <span className="text-xs text-white/60">(15 characters)</span>
                    </Label>
                    <div className="relative">
                      <FileText className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
                      <Input
                        id="gstNumber"
                        name="gstNumber"
                        placeholder="22AAAAA0000A1Z5"
                        value={vendorData.gstNumber}
                        onChange={handleVendorChange}
                        maxLength={15}
                        required
                        disabled={loading}
                        className={`h-11 pl-9 font-mono tracking-wide bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:bg-white/20 border ${errors.gstNumber ? 'border-red-400' : ''}`}
                      />
                    </div>
                    {errors.gstNumber && (
                      <p className="text-sm text-red-300 flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" /> {errors.gstNumber}
                      </p>
                    )}
                  </div>
                </div>

                {/* Manpower Section */}
                <div className="space-y-6">
                  <div className="flex items-center justify-between border-b border-white/20 pb-2">
                    <h2 className="text-xl font-semibold flex items-center gap-2 text-white">
                      <Users className="h-5 w-5 text-blue-300" />
                      Manpower Details
                    </h2>
                    <Button type="button" variant="outline" size="sm" onClick={addManpowerRow} className="bg-white/10 border-white/20 text-white hover:bg-white/20 hover:text-white">
                      <Plus className="h-4 w-4 mr-2" />
                      Add Manpower
                    </Button>
                  </div>

                  <div className="space-y-4">
                    {manpowerList.map((manpower, index) => (
                      <div key={manpower.id} className="grid md:grid-cols-12 gap-4 items-end bg-black/20 p-4 rounded-lg border border-white/10">
                        <div className="md:col-span-3 space-y-2">
                          <Label className="text-white">Name</Label>
                          <Input
                            placeholder="Staff Name"
                            value={manpower.name}
                            onChange={(e) => handleManpowerChange(manpower.id, "name", e.target.value)}
                            className="h-10 bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:bg-white/20 border"
                            disabled={loading}
                          />
                        </div>
                        <div className="md:col-span-3 space-y-2">
                          <Label className="text-white">Phone Number</Label>
                          <Input
                            placeholder="Phone"
                            value={manpower.phoneNumber}
                            onChange={(e) => handleManpowerChange(manpower.id, "phoneNumber", e.target.value)}
                            className="h-10 bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:bg-white/20 border"
                            disabled={loading}
                          />
                        </div>
                        <div className="md:col-span-2 space-y-2">
                          <Label className="text-white">Manpower ID</Label>
                          <Input
                            value={manpower.manpowerId}
                            readOnly
                            className="h-10 bg-white/5 border-white/10 text-white/70 font-mono text-sm"
                            placeholder="Auto-gen"
                          />
                        </div>
                        <div className="md:col-span-3 space-y-2">
                          <Label className="text-white">Applicator Type</Label>
                          <div className="[&_button]:bg-white/10 [&_button]:border-white/20 [&_button]:text-white">
                            <Select
                              value={manpower.applicatorType}
                              onValueChange={(value) => handleManpowerChange(manpower.id, "applicatorType", value)}
                              disabled={loading}
                            >
                              <SelectTrigger className="h-10">
                                <SelectValue placeholder="Select Type" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="seat_cover">Seat cover applicator</SelectItem>
                                <SelectItem value="ppf_spf">PPF Applicator</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="md:col-span-1 flex justify-end pb-1">
                          {manpowerList.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                              onClick={() => removeManpowerRow(manpower.id)}
                            >
                              <Trash2 className="h-5 w-5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {role === "vendor" && (
              <div className="bg-blue-500/20 border border-blue-400/30 p-4 rounded-lg flex gap-3 text-blue-100">
                <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
                <p className="text-sm">
                  Submitting this form will send a registration request to our admin team.
                  You will receive an OTP to verify your contact details first.
                </p>
              </div>
            )}

            <div className="flex items-start space-x-2 pt-2">
              <Checkbox
                id="terms"
                checked={termsAccepted}
                onCheckedChange={(checked) => setTermsAccepted(checked as boolean)}
                className="border-white/50 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
              />
              <div className="grid gap-1.5 leading-none">
                <label
                  htmlFor="terms"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-white"
                >
                  I accept the terms and conditions
                </label>
                <p className="text-sm text-white/70">
                  By checking this box, I confirm that the information provided is accurate and I agree to the <a href="/terms" className="text-blue-300 hover:text-blue-200 hover:underline" target="_blank">Terms of Service</a>.
                </p>
              </div>
            </div>

            <Button type="submit" className="w-full h-12 text-lg font-semibold bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30 border border-blue-400/20" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending OTP...
                </>
              ) : role === "vendor" ? "Request Franchise Registration" : "Send OTP"}
            </Button>

            <p className="text-center text-sm text-white/60">
              Already have an account?{" "}
              <Link to={loginUrl} className="text-white font-medium hover:text-blue-300 hover:underline">
                Login here
              </Link>
            </p>
          </form>
        ) : (
          <form onSubmit={handleVerifyOTP} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="otp" className="text-white">One-Time Password (OTP)</Label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-white/60" />
                <Input
                  id="otp"
                  type="text"
                  placeholder="Enter 6-digit OTP"
                  value={otp}
                  onChange={(e) =>
                    setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  required
                  maxLength={6}
                  disabled={loading}
                  className="pl-11 h-12 text-center text-2xl tracking-widest bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:bg-white/20 border-2"
                />
              </div>
              <p className="text-xs text-white/70 text-center">
                Check your messages for the verification code
              </p>
            </div>

            <Button
              type="submit"
              className="w-full h-12 bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30 border border-blue-400/20"
              disabled={loading || otp.length !== 6}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Verifying...
                </>
              ) : "Verify & Submit Request"}
            </Button>

            <Button
              type="button"
              variant="outline"
              className="w-full h-12 bg-transparent border-white/20 text-white hover:bg-white/10 hover:text-white"
              onClick={() => {
                setShowOTP(false);
                setOtp("");
              }}
            >
              Back
            </Button>
          </form>
        )}
      </div>
    </div>
  );
};

export default Register;
