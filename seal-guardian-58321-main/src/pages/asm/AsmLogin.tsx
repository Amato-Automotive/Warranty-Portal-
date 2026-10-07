import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Loader2, BriefcaseBusiness } from "lucide-react";
import { validateIndianMobile } from "@/lib/validation";
import OTPInput from "@/components/ui/OTPInput";
import api, { getErrorMessage } from "@/lib/api";

/**
 * The ASM login, at /asm/login.
 *
 * Deliberately unlinked: nothing in the main login or anywhere else points
 * here, and the URL is handed to ASMs directly. Same OTP-on-WhatsApp flow as
 * franchises; only numbers an admin has added under ASM Management get in.
 */
const AsmLogin = () => {
    const [step, setStep] = useState<"phone" | "otp">("phone");
    const [phone, setPhone] = useState("");
    const [phoneError, setPhoneError] = useState("");
    const [otp, setOtp] = useState<string[]>(Array(6).fill(""));
    const [userId, setUserId] = useState("");
    const [otpMessage, setOtpMessage] = useState("");
    const [loading, setLoading] = useState(false);
    const [countdown, setCountdown] = useState(0);
    const [resendLoading, setResendLoading] = useState(false);

    const navigate = useNavigate();
    const { login, verifyOTP, user, loading: authLoading } = useAuth();
    const { toast } = useToast();

    // Already signed in as an ASM — straight through.
    useEffect(() => {
        if (!authLoading && user?.role === "asm") navigate("/asm", { replace: true });
    }, [user, authLoading, navigate]);

    useEffect(() => {
        if (countdown <= 0) return;
        const t = setTimeout(() => setCountdown(c => c - 1), 1000);
        return () => clearTimeout(t);
    }, [countdown]);

    const sendCode = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!validateIndianMobile(phone)) {
            setPhoneError("Enter your 10-digit mobile number");
            return;
        }
        setPhoneError("");
        setLoading(true);
        try {
            const result = await login(phone, "asm");
            setUserId(result.userId);
            setOtpMessage(result.message);
            setOtp(Array(6).fill(""));
            setCountdown(30);
            setStep("otp");
        } catch (error) {
            toast({ title: "Could not send code", description: getErrorMessage(error, "Please try again"), variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    const verify = async (e: React.FormEvent) => {
        e.preventDefault();
        if (otp.some(d => !d)) return;
        setLoading(true);
        try {
            const result = await verifyOTP(userId, otp.join(""));
            if (result.user?.role !== "asm") throw new Error("Invalid server response");
            navigate("/asm", { replace: true });
        } catch (error) {
            toast({ title: "Verification failed", description: getErrorMessage(error, "Invalid OTP"), variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    const resend = async () => {
        if (countdown > 0 || resendLoading) return;
        setResendLoading(true);
        try {
            const res = await api.post("/auth/resend-otp", { userId });
            setOtp(Array(6).fill(""));
            setCountdown(30);
            setOtpMessage(res.data?.message || "A new code has been sent.");
        } catch (error) {
            toast({ title: "Resend failed", description: getErrorMessage(error, "Please try again"), variant: "destructive" });
        } finally {
            setResendLoading(false);
        }
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

            {/* Glassmorphism Card — same as the main login */}
            <div className="relative z-10 w-full max-w-[480px] bg-white/10 backdrop-blur-xl border border-white/20 shadow-2xl rounded-3xl p-6 sm:p-10 animate-in fade-in zoom-in duration-500">

                <div className="flex flex-col items-center mb-8 text-center mx-auto">
                    <img src="/autoform-logo.png" alt="AutoForm" className="h-24 w-auto object-contain brightness-0 invert drop-shadow-lg" />
                    <p className="text-white/80 text-xs font-bold tracking-[0.3em] uppercase mt-2 drop-shadow-md">
                        ASM Portal
                    </p>
                </div>

                <div className="mb-8 flex flex-col items-center gap-3">
                    <p className="text-xs font-bold uppercase tracking-widest text-white/60">Signing in as</p>
                    <div className="flex items-center gap-3 px-6 py-3 rounded-2xl bg-blue-600/30 border border-blue-400/40 backdrop-blur-sm">
                        <BriefcaseBusiness className="h-5 w-5 text-blue-300" />
                        <span className="text-white font-bold tracking-widest uppercase text-sm">Area Sales Manager</span>
                    </div>
                </div>

                {step === "phone" ? (
                    <form onSubmit={sendCode} className="space-y-6">
                        <div>
                            <label htmlFor="asm-phone" className="text-xs font-bold uppercase tracking-widest text-white/80 block mb-2">
                                Mobile Number
                            </label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none">
                                    <span className="text-white/60 text-lg font-medium">+91</span>
                                </div>
                                <Input
                                    id="asm-phone"
                                    type="tel"
                                    inputMode="numeric"
                                    autoComplete="tel"
                                    placeholder="Enter 10-digit number"
                                    value={phone}
                                    onChange={e => { setPhone(e.target.value.replace(/\D/g, "").slice(0, 10)); setPhoneError(""); }}
                                    required
                                    disabled={loading || authLoading}
                                    className={`h-14 pl-14 rounded-xl border-2 bg-white/10 border-white/10 text-white placeholder:text-white/40 focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 text-lg transition-all ${phoneError ? "border-red-400" : ""}`}
                                />
                            </div>
                            {phoneError && (
                                <p className="text-sm text-red-300 mt-1 font-medium bg-red-500/10 p-1 rounded px-2 inline-block">{phoneError}</p>
                            )}
                        </div>

                        <Button
                            type="submit"
                            disabled={loading || authLoading}
                            className="w-full h-14 rounded-xl font-bold text-lg bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30 transition-all uppercase tracking-wide border border-blue-400/20"
                        >
                            {loading ? (<><Loader2 className="mr-2 h-5 w-5 animate-spin" />Requesting...</>) : "Request OTP"}
                        </Button>
                    </form>
                ) : (
                    <form onSubmit={verify} className="space-y-7">
                        <div>
                            <label className="text-xs font-bold uppercase tracking-widest text-white/80 block mb-2">
                                Verification Code
                            </label>
                            <p className="text-sm text-white/60 mt-1 mb-4">
                                {otpMessage || "Code sent to your WhatsApp."}
                            </p>
                            <div className="[&_input]:bg-white/10 [&_input]:border-white/20 [&_input]:text-white">
                                <OTPInput value={otp} onChange={setOtp} />
                            </div>
                        </div>

                        <Button
                            type="submit"
                            disabled={loading || otp.some(d => !d)}
                            className="w-full h-14 rounded-xl font-semibold text-base bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30 transition-all disabled:opacity-70 disabled:shadow-none border border-blue-400/20"
                        >
                            {loading ? (<><Loader2 className="mr-2 h-5 w-5 animate-spin" />Verifying...</>) : "Verify & Continue"}
                        </Button>

                        <div className="flex items-center justify-between text-sm">
                            <button type="button" onClick={() => { setStep("phone"); setCountdown(0); }} className="text-white/60 hover:text-white hover:underline transition-colors">
                                Change number
                            </button>
                            <button
                                type="button"
                                onClick={resend}
                                disabled={countdown > 0 || resendLoading}
                                className={countdown > 0 || resendLoading ? "text-white/40 cursor-not-allowed" : "text-blue-300 hover:text-blue-200 hover:underline"}
                            >
                                {resendLoading ? "Sending..." : countdown > 0 ? `Resend OTP (${countdown}s)` : "Resend OTP"}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
};

export default AsmLogin;
