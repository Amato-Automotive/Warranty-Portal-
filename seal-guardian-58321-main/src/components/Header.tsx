import { Link, useNavigate, useLocation } from "react-router-dom";
import { Button } from "./ui/button";
import { useAuth } from "@/contexts/AuthContext";
import ProfilePopover from "./ProfilePopover";
import { Users, ClipboardList, Package, Menu, MessageSquareWarning, Home, LayoutDashboard, Shield, FileText, LogOut } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useState } from "react";

import { cn } from "@/lib/utils";

const Header = ({ className }: { className?: string }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const [isOpen, setIsOpen] = useState(false);

  const isActive = (path: string) => location.pathname === path;


  return (
    <header className={cn("sticky top-0 z-50 w-full border-b border-border bg-card/80 backdrop-blur-lg transition-all duration-300", className)}>
      <nav className="container mx-auto flex h-16 items-center px-4 md:px-8 gap-4 relative">
        {/* Mobile Menu Trigger - Left */}
        <div className="md:hidden z-20">
          <Sheet open={isOpen} onOpenChange={setIsOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="bg-orange-50/50 hover:bg-orange-100/50 text-orange-600 border border-orange-100 shadow-sm rounded-xl h-10 w-10 transition-all hover:scale-105"
              >
                <Menu className="h-6 w-6" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[300px] sm:w-[320px] p-0 border-r border-orange-100 bg-white rounded-r-3xl text-sm">
              <div className="flex flex-col h-full">
                {/* Sheet Header */}
                <div className="h-24 flex items-center justify-center border-b border-orange-50/50 bg-gradient-to-b from-orange-50/30 to-transparent">
                  <img src="/autoform-logo.png" alt="Autoform" className="h-10 w-auto" />
                </div>

                {/* Navigation Links */}
                <div className="overflow-y-auto py-6 px-4 space-y-2">


                  {user && (
                    <>
                      {user.role === 'admin' && (
                        <Link to="/warranty" onClick={() => setIsOpen(false)}>
                          <div className={cn(
                            "flex items-center gap-4 px-4 py-3.5 rounded-2xl transition-all duration-300",
                            isActive("/warranty") ? "bg-orange-50 text-orange-600 border border-orange-100 shadow-sm" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                          )}>
                            <Shield className={cn("h-5 w-5", isActive("/warranty") ? "text-orange-500" : "text-slate-400")} />
                            <span className="font-bold text-sm">Warranty</span>
                          </div>
                        </Link>
                      )}

                      {user.role === 'customer' && (
                        <>
                          <Link to="/dashboard/customer" onClick={() => setIsOpen(false)}>
                            <div className={cn(
                              "flex items-center gap-4 px-4 py-3.5 rounded-2xl transition-all duration-300",
                              isActive("/dashboard/customer") ? "bg-orange-50 text-orange-600 border border-orange-100 shadow-sm" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                            )}>
                              <LayoutDashboard className={cn("h-5 w-5", isActive("/dashboard/customer") ? "text-orange-500" : "text-slate-400")} />
                              <span className="font-bold text-sm">Dashboard</span>
                            </div>
                          </Link>

                        </>
                      )}

                      {/* Admin Management Links */}
                      {user.role === 'admin' && (
                        <>
                          <div className="px-4 py-2 mt-4 text-xs font-bold text-orange-400 uppercase tracking-wider">Admin Controls</div>
                          <Link to="/admin/manage" onClick={() => setIsOpen(false)}>
                            <div className={cn(
                              "flex items-center gap-4 px-4 py-3 rounded-xl transition-all duration-300",
                              isActive("/admin/manage") ? "bg-orange-50 text-orange-600" : "text-slate-600 hover:bg-slate-50"
                            )}>
                              <Users className={cn("h-5 w-5", isActive("/admin/manage") ? "text-orange-500" : "text-slate-400")} />
                              <span className="font-medium text-sm">Management</span>
                            </div>
                          </Link>
                          <Link to="/admin/products" onClick={() => setIsOpen(false)}>
                            <div className={cn(
                              "flex items-center gap-4 px-4 py-3 rounded-xl transition-all duration-300",
                              isActive("/admin/products") ? "bg-orange-50 text-orange-600" : "text-slate-600 hover:bg-slate-50"
                            )}>
                              <Package className={cn("h-5 w-5", isActive("/admin/products") ? "text-orange-500" : "text-slate-400")} />
                              <span className="font-medium text-sm">Products</span>
                            </div>
                          </Link>
                          <Link to="/admin/activity-logs" onClick={() => setIsOpen(false)}>
                            <div className={cn(
                              "flex items-center gap-4 px-4 py-3 rounded-xl transition-all duration-300",
                              isActive("/admin/activity-logs") ? "bg-orange-50 text-orange-600" : "text-slate-600 hover:bg-slate-50"
                            )}>
                              <ClipboardList className={cn("h-5 w-5", isActive("/admin/activity-logs") ? "text-orange-500" : "text-slate-400")} />
                              <span className="font-medium text-sm">Logs</span>
                            </div>
                          </Link>
                          <Link to="/admin/grievances" onClick={() => setIsOpen(false)}>
                            <div className={cn(
                              "flex items-center gap-4 px-4 py-3 rounded-xl transition-all duration-300",
                              isActive("/admin/grievances") ? "bg-orange-50 text-orange-600" : "text-slate-600 hover:bg-slate-50"
                            )}>
                              <MessageSquareWarning className={cn("h-5 w-5", isActive("/admin/grievances") ? "text-orange-500" : "text-slate-400")} />
                              <span className="font-medium text-sm">Complaints</span>
                            </div>
                          </Link>
                        </>
                      )}
                    </>
                  )}

                  <Link to="/terms" onClick={() => setIsOpen(false)}>
                    <div className={cn(
                      "flex items-center gap-4 px-4 py-3.5 rounded-2xl transition-all duration-300",
                      isActive("/terms") ? "bg-orange-50 text-orange-600 border border-orange-100 shadow-sm" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    )}>
                      <FileText className={cn("h-5 w-5", isActive("/terms") ? "text-orange-500" : "text-slate-400")} />
                      <span className="font-bold text-sm">Terms & Conditions</span>
                    </div>
                  </Link>
                </div>
                {user && (
                  <div className="p-4 border-t border-orange-50/50">
                    <Button
                      variant="ghost"
                      className="w-full justify-start text-red-600 hover:bg-red-50 hover:text-red-700"
                      onClick={async () => {
                        await logout();
                        setIsOpen(false);
                        navigate("/");
                      }}
                    >
                      <LogOut className="h-5 w-5 mr-3" />
                      <span className="font-bold text-sm">Logout</span>
                    </Button>
                  </div>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>

        {/* Logo - Centered on Mobile */}
        <Link to="/" className="flex items-center gap-2 absolute left-1/2 -translate-x-1/2 md:static md:translate-x-0 md:mr-auto">
          <img
            src="/autoform-logo.png"
            alt="Autoform"
            className="h-10 md:h-12 w-auto object-contain"
          />
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden md:flex flex-1 justify-end items-center gap-4">
          <Link to="/">
            <Button
              variant={isActive("/") ? "secondary" : "ghost"}
              size="sm"
              className={isActive("/") ? "bg-secondary/50 font-semibold" : ""}
            >
              Home Page
            </Button>
          </Link>

          {user ? (
            <>
              {user.role === 'admin' && (
                <Link to="/warranty">
                  <Button variant={isActive("/warranty") ? "secondary" : "ghost"} size="sm">
                    Warranty
                  </Button>
                </Link>
              )}
              {/* Customer Link handled in dashboard */}

              <Link to="/terms">
                <Button variant={isActive("/terms") ? "secondary" : "ghost"} size="sm">
                  Terms & Conditions
                </Button>
              </Link>



              {user.role === 'admin' && (
                <>
                  <Link to="/admin/manage">
                    <Button
                      variant={isActive("/admin/manage") ? "secondary" : "ghost"}
                      size="sm"
                      className="flex items-center gap-1"
                    >
                      <Users className="h-4 w-4" />
                      Admin Management
                    </Button>
                  </Link>
                  <Link to="/admin/products">
                    <Button
                      variant={isActive("/admin/products") ? "secondary" : "ghost"}
                      size="sm"
                      className="flex items-center gap-1"
                    >
                      <Package className="h-4 w-4" />
                      Products
                    </Button>
                  </Link>
                  <Link to="/admin/activity-logs">
                    <Button
                      variant={isActive("/admin/activity-logs") ? "secondary" : "ghost"}
                      size="sm"
                      className="flex items-center gap-1"
                    >
                      <ClipboardList className="h-4 w-4" />
                      Activity Logs
                    </Button>
                  </Link>
                  <Link to="/admin/grievances">
                    <Button
                      variant={isActive("/admin/grievances") ? "secondary" : "ghost"}
                      size="sm"
                      className="flex items-center gap-1"
                    >
                      <MessageSquareWarning className="h-4 w-4" />
                      Complaints
                    </Button>
                  </Link>
                </>
              )}

              <ProfilePopover />
            </>
          ) : (
            <Link to="/terms">
              <Button variant={isActive("/terms") ? "secondary" : "ghost"} size="sm">
                Terms & Conditions
              </Button>
            </Link>
          )}
        </div>

        {/* Mobile Profile - Right */}
        <div className="md:hidden flex items-center ml-auto z-20">
          {user && <ProfilePopover />}
        </div>
      </nav>
    </header>
  );
};

export default Header;
