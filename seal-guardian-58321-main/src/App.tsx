import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { NotificationProvider } from "./contexts/NotificationContext";
import { B2BCartProvider } from "./contexts/B2BCartContext";
import { LanguageProvider } from "./contexts/LanguageContext";
import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";

// Eager-loaded (critical path - login/auth)
import Login from "./pages/Login";
import Register from "./pages/Register";
import NotFound from "./pages/NotFound";

// Lazy-loaded (code splitting - loaded on demand)
const Warranty = lazy(() => import("./pages/Warranty"));
const CustomerDashboard = lazy(() => import("./pages/CustomerDashboard"));
const FranchiseDashboard = lazy(() => import("./pages/FranchiseDashboard"));
const AdminLayout = lazy(() => import("@/components/admin/layout/AdminLayout").then(m => ({ default: m.AdminLayout })));
const AdminManagement = lazy(() => import("./pages/AdminManagement"));
const AdminProducts = lazy(() => import("./pages/AdminProducts"));
const ActivityLogs = lazy(() => import("./pages/ActivityLogs"));
const AdminGrievancesPage = lazy(() => import("./pages/AdminGrievancesPage"));

const CustomerLayout = lazy(() => import("./components/layouts/CustomerLayout"));
const Terms = lazy(() => import("./pages/Terms"));
const CataloguePage = lazy(() => import("./pages/CataloguePage"));
const CategoryPage = lazy(() => import("./pages/eshop/CategoryPage"));
const ProductPage = lazy(() => import("./pages/eshop/ProductPage"));
const Profile = lazy(() => import("./pages/Profile"));
const AssignmentUpdatePanel = lazy(() => import("./pages/AssignmentUpdatePanel"));
const PublicLayout = lazy(() => import("./components/layouts/PublicLayout"));
const ConnectStorePage = lazy(() => import("./pages/public/ConnectStorePage"));
const ThankYouPage = lazy(() => import("./pages/ThankYouPage"));
const AsmLogin = lazy(() => import("./pages/asm/AsmLogin"));
const AsmHome = lazy(() => import("./pages/asm/AsmHome"));
const TrainingPage = lazy(() => import("./pages/training/TrainingPage"));

const queryClient = new QueryClient();

// Loading fallback component
const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-orange-50">
    <div className="flex flex-col items-center gap-4">
      <Loader2 className="h-10 w-10 animate-spin text-orange-500" />
      <p className="text-sm font-bold text-slate-500 uppercase tracking-widest">Loading...</p>
    </div>
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <B2BCartProvider>
        <NotificationProvider>
        <LanguageProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/" element={<Login />} />
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                <Route path="/warranty" element={<Warranty />} />
                {/* Customer Routes Layout */}
                <Route element={<CustomerLayout />}>
                  <Route path="/dashboard/customer" element={<CustomerDashboard />} />
                  <Route path="/profile" element={<Profile />} />

                  <Route path="/terms" element={<Terms />} />
                </Route>

                <Route path="/dashboard/vendor" element={<FranchiseDashboard />} />

                <Route path="/dashboard/admin" element={<AdminLayout />} />
                <Route path="/admin/manage" element={<AdminManagement />} />
                <Route path="/admin/products" element={<AdminProducts />} />
                <Route path="/admin/activity-logs" element={<ActivityLogs />} />
                <Route path="/admin/grievances" element={<AdminGrievancesPage />} />
                <Route path="/catalogue" element={<CataloguePage />} />
                <Route path="/category/:categoryId" element={<CategoryPage />} />
                <Route path="/product/:productId" element={<ProductPage />} />

                {/* ASM portal — the login URL is handed out, never linked */}
                <Route path="/asm/login" element={<AsmLogin />} />
                <Route path="/asm" element={<AsmHome />} />
                {/* The franchise dashboard on a made-up store; see training/flag.ts */}
                <Route path="/training" element={<TrainingPage />} />
                <Route path="/assignment/update/:token" element={<AssignmentUpdatePanel />} />
                {/* Public QR Registration Route */}
                <Route element={<PublicLayout />}>
                  <Route path="/connect/:storeCode" element={<ConnectStorePage />} />
                  <Route path="/thank-you" element={<ThankYouPage />} />
                </Route>
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </TooltipProvider>
        </LanguageProvider>
      </NotificationProvider>
      </B2BCartProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;

