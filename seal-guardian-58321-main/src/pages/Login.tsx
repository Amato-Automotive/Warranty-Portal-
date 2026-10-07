import { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth, UserRole } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { User, Building, Loader2 } from "lucide-react";
import { getEmailError, validateIndianMobile } from "@/lib/validation";
import RoleCard from "@/components/ui/RoleCard";
import OTPInput from "@/components/ui/OTPInput";
import api from "@/lib/api";

const Login = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialRole = searchParams.get("role") as UserRole;
  const mode = searchParams.get("mode"); // "warranty" | "franchise" | null

  // Derive locked role and title from mode
  const isWarrantyMode  = mode === "warranty";
  const isFranchiseMode = mode === "franchise";
  const isLockedMode    = isWarrantyMode || isFranchiseMode;

  const portalTitle = isFranchiseMode
    ? "Franchise Management Portal"
    : "Warranty Portal";

  // State
  const getInitialRole = (): 'customer' | 'vendor' | 'admin' => {
    if (isWarrantyMode)  return 'customer';
    if (isFranchiseMode) return 'vendor';
    if (initialRole === 'vendor' || initialRole === 'admin') return initialRole;
    return 'customer';
  };

  const [selectedRole, setSelectedRole] = useState<'customer' | 'vendor' | 'admin'>(getInitialRole());
  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [identifier, setIdentifier] = useState("");
  const [identifierError, setIdentifierError] = useState("");
  const [otp, setOtp] = useState<string[]>(Array(6).fill(''));
  const [userId, setUserId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [resendLoading, setResendLoading] = useState(false);
  const [otpMessage, setOtpMessage] = useState("");

  const navigate = useNavigate();
  const { login, verifyOTP, user, loading: authLoading } = useAuth();
  const { toast } = useToast();

  const getApiErrorMessage = (error: any, fallback: string) => {
    const apiError = error?.response?.data?.error;
    if (typeof apiError === "string") return apiError;
    if (typeof apiError?.message === "string") return apiError.message;
    if (typeof error?.message === "string") return error.message;
    return fallback;
  };

  // Redirect if already logged in
  useEffect(() => {
    if (!authLoading && user) {
      const dashboardRoutes = {
        customer: "/dashboard/customer",
        vendor: "/dashboard/vendor",
        admin: "/dashboard/admin",
        asm: "/asm",
      };
      const redirectPath = dashboardRoutes[user.role] || "/warranty";
      navigate(redirectPath, { replace: true });
    }
  }, [user, authLoading, navigate]);

  // Sync role from URL (only when not in locked mode)
  useEffect(() => {
    if (isLockedMode) return;
    if (initialRole === 'admin' || initialRole === 'vendor' || initialRole === 'customer') {
      setSelectedRole(initialRole);
      setStep('email');
      setOtp(Array(6).fill(''));
      setCountdown(0);
      setIdentifier("");
      setIdentifierError("");
    }
  }, [initialRole, isLockedMode]);

  // Clear identifier when role changes manually
  useEffect(() => {
    setIdentifier("");
    setIdentifierError("");
  }, [selectedRole]);

  // Countdown timer effect
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);


  const handleIdentifierChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value;
    
    if (selectedRole !== 'admin') {
      // Allow only digits and + for mobile number
      value = value.replace(/[^\d+]/g, '');
    }

    setIdentifier(value);

    if (selectedRole === 'admin') {
      setIdentifierError(getEmailError(value));
    } else {
      if (!value) {
        setIdentifierError("Mobile number is required");
      } else if (!validateIndianMobile(value)) {
        setIdentifierError("Please enter a valid 10-digit mobile number");
      } else {
        setIdentifierError("");
      }
    }
  };

  const isOTPComplete = otp.every((digit) => digit !== '');

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault();

    let error = "";
    if (selectedRole === 'admin') {
      error = getEmailError(identifier) || "";
    } else {
      if (!identifier) error = "Mobile number is required";
      else if (!validateIndianMobile(identifier)) error = "Please enter a valid 10-digit mobile number";
    }

    if (error) {
      setIdentifierError(error);
      toast({ title: "Validation Error", description: error, variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const result = await login(identifier, selectedRole);
      if (result.requiresOTP && result.userId) {
        setUserId(result.userId);
        setStep('otp');
        setCountdown(30);
        setOtpMessage(result.message || "OTP Sent");
        toast({ title: "OTP Sent", description: result.message });
      }
    } catch (error: any) {
      const errorMessage = getApiErrorMessage(error, "Login failed");
      if (selectedRole !== 'admin' && (
        errorMessage.toLowerCase().includes("not found") ||
        errorMessage.toLowerCase().includes("register first") ||
        errorMessage.toLowerCase().includes("not registered"))) {
        toast({ title: "Account Not Found", description: "Redirecting to registration...", variant: "destructive", duration: 2000 });
        navigate(`/register?role=${selectedRole}`, { replace: true });
        return;
      }
      toast({ title: "Login Failed", description: errorMessage, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOTPComplete) return;

    setLoading(true);
    try {
      const otpString = otp.join('');
      const result = await verifyOTP(userId, otpString);
      if (result && result.user) {
        toast({ title: "Login Successful", description: `Welcome back, ${result.user.name}!` });
        const dashboardRoutes = {
          customer: "/dashboard/customer",
          vendor: "/dashboard/vendor",
          admin: "/dashboard/admin",
          asm: "/asm",
        };
        navigate(dashboardRoutes[result.user.role] || "/warranty", { replace: true });
      } else {
        throw new Error("Invalid server response");
      }
    } catch (error: any) {
      toast({ title: "Verification Failed", description: getApiErrorMessage(error, "Invalid OTP"), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleResendOTP = async () => {
    if (countdown > 0 || resendLoading) return;
    setResendLoading(true);
    try {
      const response = await api.post("/auth/resend-otp", { userId });
      const data = response.data;
      if (data.success) {
        setCountdown(30);
        setOtp(Array(6).fill(''));
        setOtpMessage(data.message || "A new code has been sent.");
        toast({ title: "OTP Resent", description: data.message || "A new code has been sent." });
      } else {
        const msg = typeof data?.error === "string" ? data.error : "Failed to resend OTP";
        throw new Error(msg);
      }
    } catch (error: any) {
      toast({ title: "Resend Failed", description: error.message, variant: "destructive" });
    } finally {
      setResendLoading(false);
    }
  };

  const handleBackToEmail = () => {
    setStep('email');
    setOtp(Array(6).fill(''));
    setCountdown(0);
  };

  const getRoleDisplayName = () => {
    if (selectedRole === 'admin') return 'Administrator';
    return selectedRole === 'vendor' ? 'Franchise' : 'Customer';
  };

  return (
    <div className="min-h-screen w-full relative flex items-center justify-center p-4 overflow-hidden">
      {authLoading && (
        <div className="absolute inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center">
          <Loader2 className="h-10 w-10 text-white animate-spin" />
        </div>
      )}

      {/* Background Image */}
      <div className="absolute inset-0 z-0">
        <img src="/images/seat-cover-hero.jpg" alt="Background" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />
      </div>

      {/* Glassmorphism Card */}
      <div className="relative z-10 w-full max-w-[480px] bg-white/10 backdrop-blur-xl border border-white/20 shadow-2xl rounded-3xl p-6 sm:p-10 animate-in fade-in zoom-in duration-500">

        {/* Logo + Portal Title */}
        <div className="flex flex-col items-center mb-8 text-center mx-auto">
          <img src="/autoform-logo.png" alt="AutoForm" className="h-24 w-auto object-contain brightness-0 invert drop-shadow-lg" />
          <p className="text-white/80 text-xs font-bold tracking-[0.3em] uppercase mt-2 drop-shadow-md">
            {portalTitle}
          </p>
        </div>

        {/* Role Selector */}
        {selectedRole !== 'admin' ? (
          <div className="mb-8">
            {/* Locked mode — show centered role pill */}
            {isLockedMode ? (
              <div className="flex flex-col items-center gap-3">
                <p className="text-xs font-bold uppercase tracking-widest text-white/60">
                  Signing in as
                </p>
                <div className="flex items-center gap-3 px-6 py-3 rounded-2xl bg-blue-600/30 border border-blue-400/40 backdrop-blur-sm">
                  {isWarrantyMode
                    ? <User className="h-5 w-5 text-blue-300" />
                    : <Building className="h-5 w-5 text-blue-300" />
                  }
                  <span className="text-white font-bold tracking-widest uppercase text-sm">
                    {isWarrantyMode ? "Customer" : "Franchise"}
                  </span>
                </div>
              </div>
            ) : (
              /* No mode — show both selectable cards */
              <>
                <label className="text-xs font-bold uppercase tracking-widest text-white/80 mb-3 block">
                  Continue as
                </label>
                <div className="grid grid-cols-2 gap-4">
                  <RoleCard
                    icon={User}
                    title="Customer"
                    selected={selectedRole === 'customer'}
                    onClick={() => { setSelectedRole('customer'); setSearchParams({ role: 'customer' }); }}
                  />
                  <RoleCard
                    icon={Building}
                    title="Franchise"
                    selected={selectedRole === 'vendor'}
                    onClick={() => { setSelectedRole('vendor'); setSearchParams({ role: 'vendor' }); }}
                  />
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="mb-8 text-center">
            <h2 className="text-xl font-bold text-white uppercase tracking-widest bg-white/10 py-3 rounded-xl border border-white/20">
              Admin Login
            </h2>
          </div>
        )}

        {/* Email Step */}
        {step === 'email' && (
          <form onSubmit={handleSendOTP} className="space-y-6">
            <div>
              <label htmlFor="identifier" className="text-xs font-bold uppercase tracking-widest text-white/80 block mb-2">
                {selectedRole === 'admin' ? 'Email Address' : 'Mobile Number'}
              </label>
              <div className="relative">
                {selectedRole !== 'admin' && (
                  <div className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none">
                    <span className="text-white/60 text-lg font-medium">+91</span>
                  </div>
                )}
                <Input
                  id="identifier"
                  type={selectedRole === 'admin' ? 'email' : 'tel'}
                  placeholder={selectedRole === 'admin' ? 'Enter your Email' : 'Enter 10-digit number'}
                  value={identifier}
                  onChange={handleIdentifierChange}
                  required
                  disabled={loading || authLoading}
                  className={`h-14 ${selectedRole !== 'admin' ? 'pl-14' : 'px-4'} rounded-xl border-2 bg-white/10 border-white/10 text-white placeholder:text-white/40 focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 text-lg transition-all ${identifierError ? 'border-red-400' : ''}`}
                />
              </div>
              {identifierError && (
                <p className="text-sm text-red-300 mt-1 font-medium bg-red-500/10 p-1 rounded px-2 inline-block">{identifierError}</p>
              )}
            </div>

            <Button
              type="submit"
              disabled={loading || authLoading}
              className="w-full h-14 rounded-xl font-bold text-lg bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30 transition-all uppercase tracking-wide border border-blue-400/20"
            >
              {loading ? (<><Loader2 className="mr-2 h-5 w-5 animate-spin" />Requesting...</>) : "Request OTP"}
            </Button>

            {selectedRole !== 'admin' && (
              <p className="text-center text-sm text-white/60">
                New here?{" "}
                <Link to={`/register?role=${selectedRole}${mode ? `&mode=${mode}` : ''}`} className="font-semibold text-white hover:text-blue-300 hover:underline transition-colors">
                  Register as {getRoleDisplayName()}
                </Link>
              </p>
            )}
          </form>
        )}

        {/* OTP Step */}
        {step === 'otp' && (
          <form onSubmit={handleVerifyOTP} className="space-y-7">
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-white/80 block mb-2">
                Verification Code
              </label>
              <p className="text-sm text-white/60 mt-1 mb-4">
                {otpMessage || "Code sent to your registered contact."}
              </p>
              <div className="[&_input]:bg-white/10 [&_input]:border-white/20 [&_input]:text-white">
                <OTPInput value={otp} onChange={setOtp} />
              </div>
            </div>

            <Button
              type="submit"
              disabled={loading || !isOTPComplete}
              className="w-full h-14 rounded-xl font-semibold text-base bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30 transition-all disabled:opacity-70 disabled:shadow-none border border-blue-400/20"
            >
              {loading ? (<><Loader2 className="mr-2 h-5 w-5 animate-spin" />Verifying...</>) : "Verify & Continue"}
            </Button>

            <div className="flex items-center justify-between text-sm">
              <button type="button" onClick={handleBackToEmail} className="text-white/60 hover:text-white hover:underline transition-colors">
                Change {selectedRole === 'admin' ? 'email' : 'number'}
              </button>
              <button
                type="button"
                onClick={handleResendOTP}
                disabled={countdown > 0 || resendLoading}
                className={`${countdown > 0 || resendLoading ? 'text-white/40 cursor-not-allowed' : 'text-blue-300 hover:text-blue-200 hover:underline'}`}
              >
                {resendLoading ? "Sending..." : countdown > 0 ? `Resend OTP (${countdown}s)` : "Resend OTP"}
              </button>
            </div>
          </form>
        )}

        {/* Footer — Admin link hidden in locked modes */}
        {!isLockedMode && (
          <div className="mt-8 pt-6 border-t border-white/10 text-center">
            {selectedRole === 'admin' ? (
              <Link
                to="/login?role=customer"
                className="text-xs font-medium text-white/40 hover:text-white transition-colors uppercase tracking-widest"
                onClick={() => { setSelectedRole('customer'); setSearchParams({ role: 'customer' }); }}
              >
                Back to User Login
              </Link>
            ) : (
              <Link
                to="/login?role=admin"
                className="text-xs font-medium text-white/40 hover:text-white transition-colors uppercase tracking-widest"
                onClick={() => { setSelectedRole('admin'); setSearchParams({ role: 'admin' }); }}
              >
                Admin Access
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Login;
