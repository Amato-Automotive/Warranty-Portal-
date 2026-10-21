import { useLocation, Link, Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, LayoutDashboard, ExternalLink, ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";

/**
 * ThankYouPage - A premium success page shown after warranty registration
 * Displays different messages based on whether the user is a vendor or customer
 */
const ThankYouPage = () => {
  const location = useLocation();
  const { submissionDetails } = location.state || {};

  // If someone tries to access this page directly without a submission, redirect home
  if (!submissionDetails) {
    return <Navigate to="/" replace />;
  }

  const { customerName, productType, registrationId, role } = submissionDetails;
  const isVendor = role === 'vendor' || role === 'admin';

  return (
    <div className="flex min-h-[70vh] items-center justify-center p-4 bg-transparent">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-2xl"
      >
        <Card className="border-none shadow-2xl bg-white/90 backdrop-blur-md overflow-hidden rounded-2xl border border-orange-100/50">
          <div className="h-2 bg-gradient-to-r from-orange-500 via-orange-400 to-amber-500" />

          <CardHeader className="text-center pb-2 pt-8">
            <div className="flex justify-center mb-6">
              <motion.div
                initial={{ scale: 0, rotate: -45 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ delay: 0.2, type: "spring", stiffness: 200, damping: 15 }}
                className="bg-green-100 p-4 rounded-full shadow-inner"
              >
                <CheckCircle2 className="h-14 w-14 text-green-600" />
              </motion.div>
            </div>
            <CardTitle className="text-4xl font-extrabold text-slate-900 tracking-tight">
              Registration Successful!
            </CardTitle>
            <p className="text-slate-500 mt-2 font-medium">Your warranty has been recorded in our system.</p>
          </CardHeader>

          <CardContent className="space-y-8 text-center pt-6 px-6 md:px-10">
            {isVendor ? (
              <div className="space-y-6">
                <div className="space-y-2">
                  <p className="text-xl text-slate-700 leading-relaxed font-medium">
                    Excellent work! You've successfully registered the warranty for <span className="text-orange-600 font-bold">{customerName}</span>.
                  </p>
                  <p className="text-slate-500 max-w-md mx-auto">
                    The registration request for the <span className="font-semibold text-slate-800">{productType === 'seat-cover' ? 'Seat Cover' : 'EV-PPF'}</span> has been forwarded to the head office for final approval.
                  </p>
                </div>

                <div className="flex flex-col items-center gap-2">
                  <div className="bg-slate-900 px-6 py-3 rounded-xl shadow-lg transform hover:scale-105 transition-transform duration-300">
                    <p className="text-xs uppercase tracking-widest text-slate-400 font-bold mb-1">Product UID</p>
                    <p className="text-lg font-mono text-white font-bold">{registrationId || 'PENDING'}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-8">
                <div className="space-y-3">
                  <p className="text-xl text-slate-700 leading-relaxed font-medium">
                    Congratulations <span className="text-orange-600 font-bold">{customerName}</span>! Your <span className="font-bold text-slate-800 tracking-tight">{productType === 'seat-cover' ? 'Seat Cover' : 'EV-PPF'}</span> warranty is now Registered and will be approved soon.
                  </p>
                  <div className="bg-slate-900 px-6 py-3 rounded-xl shadow-lg inline-block">
                    <p className="text-xs uppercase tracking-widest text-slate-400 font-bold mb-1">Product UID</p>
                    <p className="text-lg font-mono text-white font-bold">{registrationId || 'GEN-001'}</p>
                  </div>
                </div>

                <div className="text-left space-y-5 bg-gradient-to-br from-slate-50 to-orange-50/50 p-6 md:p-8 rounded-2xl border border-orange-100 shadow-sm relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                    <ShieldCheck className="h-20 w-20 text-orange-500" />
                  </div>

                  <h4 className="font-bold text-slate-900 text-lg flex items-center gap-3">
                    <div className="bg-orange-500 p-1.5 rounded-lg text-white shadow-md">
                      <LayoutDashboard className="h-5 w-5" />
                    </div>
                    What's Next for You?
                  </h4>

                  <ul className="space-y-4 text-slate-600 relative z-10">
                    <li className="flex gap-4">
                      <span className="flex-shrink-0 h-6 w-6 bg-white rounded-full flex items-center justify-center text-orange-500 font-bold shadow-sm text-xs">1</span>
                      <p className="text-sm">
                      <span className="font-bold text-slate-800 block mb-1 underline decoration-orange-300 decoration-2 underline-offset-4">Access Your Warranty</span>
                        Login at <span className="font-bold text-orange-600">https://warranty2.autoformindia.co.in/</span> with your registered mobile number. Check your messages for the login OTP.
                      </p>
                    </li>
                    <li className="flex gap-4">
                      <span className="flex-shrink-0 h-6 w-6 bg-white rounded-full flex items-center justify-center text-orange-500 font-bold shadow-sm text-xs">2</span>
                      <p className="text-sm">
                        <span className="font-bold text-slate-800 block mb-1 underline decoration-orange-300 decoration-2 underline-offset-4">Manage & Download</span>
                        Easily view, manage, and download your digital warranty certificates anytime to keep them safe.
                      </p>
                    </li>
                    <li className="flex gap-4">
                      <span className="flex-shrink-0 h-6 w-6 bg-white rounded-full flex items-center justify-center text-orange-500 font-bold shadow-sm text-xs">3</span>
                      <p className="text-sm">
                        <span className="font-bold text-slate-800 block mb-1 underline decoration-orange-300 decoration-2 underline-offset-4">Support & Complaints</span>
                        Encountered a product issue? File a complaint directly through the portal for priority resolution by our team.
                      </p>
                    </li>
                  </ul>
                </div>
              </div>
            )}
          </CardContent>

          <CardFooter className="flex flex-col sm:flex-row gap-4 justify-center pb-12 pt-4 px-6">
            <Button asChild className="bg-slate-900 hover:bg-slate-800 text-white min-w-[200px] h-12 rounded-xl shadow-lg hover:shadow-xl transition-all group">
              <Link to={isVendor ? "/dashboard/vendor" : "/login?mode=warranty"}>
                <LayoutDashboard className="mr-2 h-5 w-5 group-hover:rotate-12 transition-transform" />
                {isVendor ? "Vendor Dashboard" : "Customer Portal"}
              </Link>
            </Button>
            <Button variant="outline" asChild className="border-slate-200 h-12 min-w-[200px] rounded-xl hover:bg-slate-50 transition-colors">
              <Link to="/catalogue" className="flex items-center gap-2">
                Explore More Products
                <ExternalLink className="h-4 w-4" />
              </Link>
            </Button>
          </CardFooter>
        </Card>
      </motion.div>

      {/* Background embellishments */}
      <div className="fixed top-20 left-10 w-64 h-64 bg-orange-200/20 rounded-full blur-3xl -z-10 animate-pulse" />
      <div className="fixed bottom-20 right-10 w-80 h-80 bg-amber-100/30 rounded-full blur-3xl -z-10 animate-pulse" style={{ animationDelay: '1s' }} />
    </div>
  );
};

export default ThankYouPage;
