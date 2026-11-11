export interface ProductSpec {
  0: string; // Name (e.g. Height)
  1: string; // Value (e.g. 20 inch)
}

export interface StoreProduct {
  id: string;
  name: string;
  price: number;
  compare: number;
  stock: boolean;
  rating: number;
  category?: string;
  images: string[];
  desc: string;
  specs: [string, string][];
  isNew?: boolean;
  videoUrl?: string;
}

export interface StoreGalleryItem {
  img: string;
  t: string;
}

export interface StoreReview {
  n: string; // Reviewer name
  r: number; // Rating 1-5
  t: string; // Review text
  city?: string;
  date?: string;
}

export interface StoreOrderItem {
  name: string;
  q: number;
  price: number;
}

export interface StoreOrder {
  id: string;
  date: string;
  name: string;
  phone: string;
  email?: string;
  address: string;
  pay: string;
  status: 'New' | 'Confirmed' | 'Shipped' | 'Delivered' | 'Cancelled';
  items: StoreOrderItem[];
  total: number;
}

export type PaymentMethod = 'COD' | 'Bank Transfer' | 'Easypaisa' | 'JazzCash';

export interface CustomerUser {
  id: string;
  phone: string;
  name: string;
  email?: string;
  address?: string;
  city?: string;
  createdAt?: string;
}

export interface UserAccount {
  id: string;
  name: string;
  email: string;
  phone: string;
  password?: string;
  role: 'customer' | 'admin';
  address?: string;
  city?: string;
  createdAt?: string;
}

export interface ActionVideo {
  id: string;
  title: string;
  videoUrl: string;
  desc?: string;
}

export interface StoreTrustFeat {
  i: string; // 'truck' | 'award' | 'shield' | 'refresh'
  t: string;
  d: string;
}

export interface HeroSlide {
  img: string;
  t: string;
  d: string;
  btn?: string;
  tag?: string;
  position?: 'bottom-left' | 'bottom-right' | 'bottom-center' | 'top-left';
}

export interface StoreSettingsData {
  name: string;
  logoImg?: string;
  bar: string;
  hero: string;
  sub: string;
  heroBtn: string;
  heroImg: string;
  heroSlides?: HeroSlide[];
  actionVideos?: ActionVideo[];
  imgbbApiKey?: string;
  cur: string;
  wa: string;
  ship: number;
  email: string;
  phone: string;
  address: string;
  about: string;
  bank: string;
  easypaisa?: string;
  jazzcash?: string;
  adminPin?: string;
  autoWhatsAppNotification?: boolean;
  fb: string;
  ig: string;
  yt: string;
  feats: StoreTrustFeat[];
}

export interface StoreData {
  settings: StoreSettingsData;
  products: StoreProduct[];
  gallery: StoreGalleryItem[];
  reviews: StoreReview[];
  orders: StoreOrder[];
}

export interface CartItem {
  id: string;
  q: number;
}
