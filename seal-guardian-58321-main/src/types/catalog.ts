
export interface ProductPrice {
  twoRow?: number;
  threeRow?: number;
  default?: number;
}

export interface Product {
  id: string;
  name: string;
  price: number | ProductPrice;
  description: string | string[];
  images: string[];
  categoryId: string;
  additionalInfo?: string | string[];
  inStock?: boolean;
  rating?: number;
  reviews?: Review[];
  isFeatured?: boolean;
  isNewArrival?: boolean;
}

export interface Review {
  id: string;
  userName: string;
  date: string;
  rating: number;
  comment: string;
}

export interface Category {
  id: string;
  name: string;
  description?: string;
  image?: string;
  parentId?: string;
}

export interface CartItem {
  productId: string;
  quantity: number;
}
