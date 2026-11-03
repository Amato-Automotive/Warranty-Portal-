import { useState } from "react";
import { Navigate } from "react-router-dom";
import Header from "@/components/Header";
import { useAuth } from "@/contexts/AuthContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import SeatCoverForm from "@/components/warranty/SeatCoverForm";
import EVProductsForm from "@/components/warranty/EVProductsForm";
import { NoBillNoWarrantyDialog } from "@/components/warranty/NoBillNoWarrantyDialog";

const Warranty = () => {
  const { user, loading } = useAuth();
  const [activeTab, setActiveTab] = useState("seat-cover");
  const [billNoticeOpen, setBillNoticeOpen] = useState(true);

  if (loading) {
    return <div>Loading...</div>;
  }

  if (!user) {
    // Redirect to login with role parameter if available
    const loginUrl = user?.role ? `/login?role=${user.role}` : '/login';
    return <Navigate to={loginUrl} replace />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <Header />
      <NoBillNoWarrantyDialog open={user.role === "customer" && billNoticeOpen} onClose={() => setBillNoticeOpen(false)} />

      <main className="container mx-auto px-4 py-8">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2">Product Warranty Registration</h1>
          <p className="text-muted-foreground">Select your product type to begin registration</p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="max-w-5xl mx-auto">
          <TabsList className="grid w-full grid-cols-2 mb-8">
            <TabsTrigger value="seat-cover" className="text-lg py-3">
              Seat Cover
            </TabsTrigger>
            <TabsTrigger value="ev-products" className="text-lg py-3">
              Paint Protection Film (PPF)
            </TabsTrigger>
          </TabsList>

          <TabsContent value="seat-cover">
            <SeatCoverForm />
          </TabsContent>

          <TabsContent value="ev-products">
            <EVProductsForm />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Warranty;
