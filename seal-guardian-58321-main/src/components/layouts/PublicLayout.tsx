import { useState } from "react";
import { Outlet, Link, useOutletContext } from "react-router-dom";
import { brandLook } from "@/lib/brand";

/** The brand of the store whose QR was scanned, for the header; kept for the thank-you page. */
const KEY = "qr_store_brand";
const remembered = () => { try { return sessionStorage.getItem(KEY); } catch { return null; } };
export interface PublicBrand { setBrand: (b: string | null) => void }
export const usePublicBrand = () => useOutletContext<PublicBrand | undefined>();

/**
 * PublicLayout - A minimal layout for public/unauthenticated pages
 * Used for QR-based warranty registration flow
 * Features: Header with logo only, no sidebar, clean focused design
 */
const PublicLayout = () => {
    // Unknown until the store is looked up: no logo rather than the wrong one.
    const [brand, setBrandState] = useState<string | null>(remembered);
    const setBrand = (b: string | null) => { setBrandState(b); try { if (b) sessionStorage.setItem(KEY, b); } catch { /* private mode */ } };
    const look = brand ? brandLook(brand) : null;
    return (
        <div className="min-h-screen bg-gradient-to-b from-orange-50/30 to-white">
            {/* Minimal Header - Logo Only */}
            <header className="sticky top-0 z-50 w-full border-b border-orange-100 bg-white/80 backdrop-blur-lg">
                <nav className="container mx-auto flex h-16 items-center justify-center px-4">
                    <Link to="/" className="flex h-12 items-center">
                        {look && (
                            <img
                                src={look.logo}
                                alt={look.name}
                                className="h-10 md:h-12 w-auto object-contain"
                            />
                        )}
                    </Link>
                </nav>
            </header>

            {/* Main Content - Full Width, Centered */}
            <main className="container mx-auto px-4 py-8">
                <Outlet context={{ setBrand } satisfies PublicBrand} />
            </main>

            {/* Simple Footer */}
            <footer className="border-t border-orange-100 bg-white py-6 mt-8">
                <div className="container mx-auto px-4 text-center">
                    <p className="text-xs text-slate-400">
                        © {new Date().getFullYear()} Autoform India. All rights reserved.
                    </p>
                </div>
            </footer>
        </div>
    );
};

export default PublicLayout;
