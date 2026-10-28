export interface User {
  id: string;
  email: string;
  name: string;
  role: 'customer' | 'vendor' | 'admin';
  phoneNumber: string;
  isValidated?: boolean;
}

export interface ManpowerData {
  name: string;
  phoneNumber: string;
  manpowerId: string;
  applicatorType: string;
}

export interface RegisterData {
  name: string;
  email: string;
  phoneNumber: string;
  role: 'customer' | 'vendor' | 'admin';
  password?: string;
  // Vendor specific fields
  storeName?: string;
  address?: string;
  state?: string;
  city?: string;
  pincode?: string;
  gstNumber?: string;
  manpower?: ManpowerData[];
  /** The franchise's brand: Autoform, Autocruze or both. */
  brand?: 'AF' | 'AC' | 'AFAC';
}

export interface LoginData {
  email: string;
  password: string;
}

export interface WarrantyData {
  productType: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerAddress: string;
  carMake?: string;
  carModel?: string;
  carYear: string;
  /** Free text: car colours are endless, and a fixed list forces wrong answers. */
  carColour?: string | null;
  registrationNumber: string;
  purchaseDate: string;
  warrantyType: string;
  installerName?: string;
  installerContact?: string;
  productDetails: any;
}