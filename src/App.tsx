import React, { useState, useEffect } from 'react';
import { StoreData, StoreProduct, StoreOrder, CartItem, HeroSlide, CustomerUser, UserAccount, ActionVideo } from './types/store';
import { DEFAULT_STORE_DATA } from './data/initialData';
import { Icon } from './components/common/Icons';
import { 
  loadStoreFromFirebase, 
  syncStoreToFirebase, 
  subscribeToStore,
  saveOrderToFirebase, 
  saveUserToFirebase,
  registerWithFirebaseAuth,
  loginWithFirebaseAuth,
  logoutFirebaseAuth
} from './services/firebase';

const KEY = 'store_v2';
const DEFAULT_PRODUCT_IMAGE = '/assets/aistudio/1792838643998_32bdd4b3.jpg';

const isRealOrder = (o: StoreOrder): boolean => {
  if (!o || !o.id) return false;
  const name = (o.name || '').toLowerCase();
  const id = (o.id || '').toLowerCase();
  if ((id === '#1001' && name.includes('zafar')) || (id === '#1002' && name.includes('rasheed'))) {
    return false;
  }
  return true;
};

export const sanitizeProduct = (p: any): StoreProduct => {
  const rawImages = Array.isArray(p?.images) ? p.images : (typeof p?.images === 'string' && p.images ? [p.images] : []);
  const validImages = rawImages.filter((img: any) => typeof img === 'string' && img.trim() !== '');
  const images = validImages.length > 0 ? validImages : [DEFAULT_PRODUCT_IMAGE];

  const rawSpecs = Array.isArray(p?.specs) ? p.specs : [];
  const validSpecs: [string, string][] = rawSpecs
    .filter((s: any) => Array.isArray(s) && s.length >= 2 && s[0] != null)
    .map((s: any) => [String(s[0]), String(s[1] ?? '')]);

  return {
    id: String(p?.id || 'p_' + Math.random().toString(36).substring(2, 9)),
    name: String(p?.name || 'Woodflame Rocket Stove').replace(/woodflare/gi, 'Woodflame'),
    price: Number(p?.price) || 0,
    compare: Number(p?.compare) || 0,
    stock: p?.stock !== false,
    rating: Number(p?.rating) || 5,
    category: String(p?.category || 'Domestic Stoves'),
    images,
    desc: String(p?.desc || '').replace(/woodflare/gi, 'Woodflame'),
    specs: validSpecs,
  };
};

export const sanitizeSettings = (s: any) => {
  if (!s || typeof s !== 'object') return DEFAULT_STORE_DATA.settings;
  const cleanStr = (val: any, fallback: string) => {
    if (!val || typeof val !== 'string') return fallback;
    return val.replace(/woodflare/gi, 'Woodflame').replace(/WOODFLARE/g, 'WOODFLAME');
  };

  const slides = Array.isArray(s.heroSlides) ? s.heroSlides : DEFAULT_STORE_DATA.settings.heroSlides;
  const cleanSlides = (slides || []).map((slide: any) => ({
    img: slide?.img || DEFAULT_PRODUCT_IMAGE,
    tag: cleanStr(slide?.tag, ''),
    t: cleanStr(slide?.t, 'Woodflame Rocket Stoves'),
    d: cleanStr(slide?.d, ''),
    btn: cleanStr(slide?.btn, 'Shop Now'),
    position: slide?.position || 'bottom-left',
  }));

  return {
    ...DEFAULT_STORE_DATA.settings,
    ...s,
    name: cleanStr(s.name, 'Woodflame').trim() || 'Woodflame',
    bank: cleanStr(s.bank, DEFAULT_STORE_DATA.settings.bank || ''),
    easypaisa: cleanStr(s.easypaisa, DEFAULT_STORE_DATA.settings.easypaisa || ''),
    jazzcash: cleanStr(s.jazzcash, DEFAULT_STORE_DATA.settings.jazzcash || ''),
    about: cleanStr(s.about, DEFAULT_STORE_DATA.settings.about || ''),
    hero: cleanStr(s.hero, DEFAULT_STORE_DATA.settings.hero || ''),
    sub: cleanStr(s.sub, DEFAULT_STORE_DATA.settings.sub || ''),
    heroSlides: cleanSlides.length > 0 ? cleanSlides : DEFAULT_STORE_DATA.settings.heroSlides,
    logoImg: s.logoImg || '/assets/aistudio/logo_f5e61050.png',
  };
};

export default function App() {
  // Store Data from localStorage or defaults
  const [store, setStore] = useState<StoreData>(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          return {
            ...DEFAULT_STORE_DATA,
            ...parsed,
            settings: sanitizeSettings({
              ...DEFAULT_STORE_DATA.settings,
              ...(parsed.settings || {}),
              adminPin: (!parsed.settings?.adminPin || parsed.settings.adminPin === '1234') ? '1730' : parsed.settings.adminPin,
              imgbbApiKey: (!parsed.settings?.imgbbApiKey) ? 'fc7a66753695be4c6425eee9bae569c2' : parsed.settings.imgbbApiKey,
            }),
            products: Array.isArray(parsed.products) && parsed.products.length > 0
              ? parsed.products.map(sanitizeProduct)
              : DEFAULT_STORE_DATA.products.map(sanitizeProduct),
            gallery: Array.isArray(parsed.gallery) && parsed.gallery.length > 0 ? parsed.gallery : DEFAULT_STORE_DATA.gallery,
            reviews: Array.isArray(parsed.reviews) && parsed.reviews.length > 0 ? parsed.reviews : DEFAULT_STORE_DATA.reviews,
            orders: Array.isArray(parsed.orders) ? parsed.orders.filter(isRealOrder) : [],
          };
        }
      }
    } catch (e) {
      console.warn('localStorage store read error', e);
    }
    return {
      ...DEFAULT_STORE_DATA,
      products: DEFAULT_STORE_DATA.products.map(sanitizeProduct),
      settings: sanitizeSettings(DEFAULT_STORE_DATA.settings),
    };
  });

  // Cart from localStorage
  const [cart, setCart] = useState<CartItem[]>(() => {
    try {
      const saved = localStorage.getItem(KEY + 'c');
      return saved ? JSON.parse(saved) : [];
    } catch {}
    return [];
  });

  // UI Navigation State
  const [page, setPage] = useState<'home' | 'shop' | 'product' | 'checkout' | 'thanks' | 'admin' | 'account' | 'tracking'>('home');
  const [pid, setPid] = useState<string | null>(null);
  const [imgIndex, setImgIndex] = useState(0);
  const [qty, setQty] = useState(1);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [adminTab, setAdminTab] = useState<'dash' | 'orders' | 'products' | 'sliders' | 'gallery' | 'reviews' | 'settings'>('orders');
  const [editingProduct, setEditingProduct] = useState<StoreProduct | null>(null);
  const [lastOrder, setLastOrder] = useState<StoreOrder | null>(null);

  // User Authentication & Accounts State
  const [authUser, setAuthUser] = useState<UserAccount | null>(() => {
    try {
      const saved = localStorage.getItem('auth_user');
      return saved ? JSON.parse(saved) : null;
    } catch {}
    return null;
  });

  const [registeredUsers, setRegisteredUsers] = useState<UserAccount[]>(() => {
    try {
      const saved = localStorage.getItem('registered_users');
      if (saved) return JSON.parse(saved);
    } catch {}
    return [
      {
        id: 'u_admin1',
        name: 'Woodflame Admin',
        email: 'woodflare91@gmail.com',
        phone: '03046042333',
        password: '',
        role: 'admin',
      },
    ];
  });

  // Auth UI Form States
  const [authTab, setAuthTab] = useState<'login' | 'signup'>('login');
  const [loginEmailInput, setLoginEmailInput] = useState('');
  const [loginPasswordInput, setLoginPasswordInput] = useState('');
  const [signupName, setSignupName] = useState('');
  const [signupPhone, setSignupPhone] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirmPassword, setSignupConfirmPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [profileMsg, setProfileMsg] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [showSignupConfirmPassword, setShowSignupConfirmPassword] = useState(false);
  const [firebaseSyncNotice, setFirebaseSyncNotice] = useState('');
  const [isSavingCloud, setIsSavingCloud] = useState(false);
  const [isDbLoaded, setIsDbLoaded] = useState(false);

  // Order Tracking State
  const [trackQuery, setTrackQuery] = useState('');
  const [trackResult, setTrackResult] = useState<StoreOrder[] | null>(null);
  const [trackSearched, setTrackSearched] = useState(false);

  // Admin Check Helper - Restricted strictly to woodflare91@gmail.com
  const checkIsAdmin = (u: UserAccount | CustomerUser | null): boolean => {
    if (!u) return false;
    const email = ('email' in u ? u.email || '' : '').toLowerCase().trim();
    return email === 'woodflare91@gmail.com' || email === 'woodflame91@gmail.com';
  };

  // Sync auth state to LocalStorage and strictly align profile input fields
  useEffect(() => {
    try {
      if (authUser) {
        localStorage.setItem('auth_user', JSON.stringify(authUser));
        setPhone(authUser.phone || '');
        setCustomerEmail(authUser.email || '');
        setFirstName(authUser.name ? authUser.name.split(' ')[0] : '');
        setLastName(authUser.name ? authUser.name.split(' ').slice(1).join(' ') : '');
        setAddress(authUser.address || '');
        setCity(authUser.city || '');
      } else {
        localStorage.removeItem('auth_user');
        setPhone('');
        setCustomerEmail('');
        setFirstName('');
        setLastName('');
        setAddress('');
        setCity('');
        setPostalCode('');
      }
    } catch {}
  }, [authUser]);

  useEffect(() => {
    try {
      localStorage.setItem('registered_users', JSON.stringify(registeredUsers));
    } catch {}
  }, [registeredUsers]);

  // Shop page filters
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortBy, setSortBy] = useState<'featured' | 'price-asc' | 'price-desc' | 'rating'>('featured');

  // Hero Slider state
  const [activeSlide, setActiveSlide] = useState(0);
  const [isSliderHovered, setIsSliderHovered] = useState(false);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [touchEndX, setTouchEndX] = useState<number | null>(null);

  // ImgBB Uploading state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');

  // Post-purchase Review Modal State
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewHover, setReviewHover] = useState(0);
  const [reviewName, setReviewName] = useState('');
  const [reviewCity, setReviewCity] = useState('');
  const [reviewText, setReviewText] = useState('');
  const [reviewSubmitted, setReviewSubmitted] = useState(false);

  // Checkout Form State
  const [phone, setPhone] = useState(authUser?.phone || '');
  const [customerEmail, setCustomerEmail] = useState(authUser?.email || '');
  const [firstName, setFirstName] = useState(authUser?.name?.split(' ')[0] || '');
  const [lastName, setLastName] = useState(authUser?.name?.split(' ').slice(1).join(' ') || '');
  const [address, setAddress] = useState(authUser?.address || '');
  const [city, setCity] = useState(authUser?.city || '');
  const [postalCode, setPostalCode] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'COD' | 'Bank Transfer' | 'Easypaisa' | 'JazzCash'>('COD');
  const [isFirebaseConnected, setIsFirebaseConnected] = useState(false);

  // Secret Multi-click Admin Panel Trigger (7 rapid taps/clicks)
  const [adminClickCount, setAdminClickCount] = useState(0);

  const handleSecretAdminTrigger = (e: React.MouseEvent) => {
    e.preventDefault();
    if (checkIsAdmin(authUser)) {
      const nextCount = adminClickCount + 1;
      if (nextCount >= 7) {
        setAdminClickCount(0);
        setPage('admin');
        setAdminTab('dash');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        setAdminClickCount(nextCount);
        setTimeout(() => {
          setAdminClickCount(0);
        }, 4000);
      }
    } else {
      go('home');
    }
  };

  // Listen for /admin, /adminpanel, #admin in URL
  useEffect(() => {
    const handleAdminRoute = () => {
      const hash = (window.location.hash || '').toLowerCase();
      const path = (window.location.pathname || '').toLowerCase();
      if (
        hash === '#admin' ||
        hash === '#adminpanel' ||
        path === '/admin' ||
        path === '/adminpanel'
      ) {
        if (checkIsAdmin(authUser)) {
          setPage('admin');
        } else {
          setPage('account' as any);
        }
      }
    };
    handleAdminRoute();
    window.addEventListener('hashchange', handleAdminRoute);
    window.addEventListener('popstate', handleAdminRoute);
    return () => {
      window.removeEventListener('hashchange', handleAdminRoute);
      window.removeEventListener('popstate', handleAdminRoute);
    };
  }, [authUser]);

  // Keyboard shortcut Ctrl+Shift+A
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
        e.preventDefault();
        if (checkIsAdmin(authUser)) {
          setPage('admin');
        } else {
          setPage('account' as any);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [authUser]);

  // Sync to LocalStorage
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(store));
    } catch {}
  }, [store]);

  // Live Subscription from Firebase Realtime Database
  useEffect(() => {
    setIsFirebaseConnected(true);
    const fallbackTimer = setTimeout(() => {
      setIsDbLoaded(true);
    }, 1000);

    const unsubscribe = subscribeToStore((remoteData) => {
      setIsDbLoaded(true);
      if (remoteData) {
        if (remoteData.registeredUsers && Array.isArray(remoteData.registeredUsers) && remoteData.registeredUsers.length > 0) {
          setRegisteredUsers((prev) => {
            const map = new Map<string, UserAccount>();
            (prev || []).forEach((u) => u?.email && map.set(u.email.toLowerCase(), u));
            remoteData.registeredUsers?.forEach((u) => u?.email && map.set(u.email.toLowerCase(), u));
            return Array.from(map.values());
          });
        }
        setStore((prev) => {
          const rawProducts = Array.isArray(remoteData.products) && remoteData.products.length > 0
            ? remoteData.products
            : prev.products;
          const cleanProducts = (rawProducts || []).map(sanitizeProduct);
          const cleanSettings = sanitizeSettings({
            ...DEFAULT_STORE_DATA.settings,
            ...prev.settings,
            ...(remoteData.settings || {}),
          });

          return {
            ...DEFAULT_STORE_DATA,
            ...prev,
            ...remoteData,
            settings: cleanSettings,
            products: cleanProducts,
            gallery: (remoteData.gallery && Array.isArray(remoteData.gallery) && remoteData.gallery.length > 0) ? remoteData.gallery : prev.gallery,
            reviews: (remoteData.reviews && Array.isArray(remoteData.reviews) && remoteData.reviews.length > 0) ? remoteData.reviews : prev.reviews,
            orders: Array.isArray(remoteData.orders)
              ? remoteData.orders.filter(isRealOrder)
              : (Array.isArray(prev.orders) ? prev.orders.filter(isRealOrder) : []),
          };
        });
      }
    });

    return () => {
      clearTimeout(fallbackTimer);
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  // Helper to update store state and sync to Firebase Realtime Database & Firestore
  const saveStoreAndSync = async (updatedStore: StoreData, updatedUsers?: UserAccount[]) => {
    setStore(updatedStore);
    if (updatedUsers) setRegisteredUsers(updatedUsers);
    setIsSavingCloud(true);
    try {
      const usersToSync = updatedUsers || registeredUsers;
      const success = await syncStoreToFirebase({ ...updatedStore, registeredUsers: usersToSync });
      if (success) {
        setFirebaseSyncNotice('Changes saved and live-synced across all devices!');
        setTimeout(() => setFirebaseSyncNotice(''), 4000);
      }
    } catch (err) {
      console.error('Cloud sync error:', err);
    } finally {
      setIsSavingCloud(false);
    }
  };


  useEffect(() => {
    try {
      localStorage.setItem(KEY + 'c', JSON.stringify(cart));
    } catch {}
  }, [cart]);

  // Authoritative dynamic page title with Woodflame branding
  useEffect(() => {
    const brandName = (store.settings.name || 'Woodflame').trim().replace(/woodflare/gi, 'Woodflame');
    if (page === 'home') {
      document.title = `${brandName} – High-Efficiency Biomass Rocket Stoves`;
    } else if (page === 'shop') {
      document.title = `Shop Rocket Stoves & Fuel | ${brandName}`;
    } else if (page === 'product' && pid) {
      const p = getProduct(pid);
      document.title = p ? `${p.name} | ${brandName}` : `${brandName} Store`;
    } else if (page === 'tracking') {
      document.title = `Track Your Order | ${brandName}`;
    } else if (page === 'admin') {
      document.title = `Admin Panel | ${brandName}`;
    } else if (page === 'account') {
      document.title = `My Account | ${brandName}`;
    } else if (page === 'checkout') {
      document.title = `Checkout | ${brandName}`;
    } else {
      document.title = `${brandName} – High-Efficiency Biomass Rocket Stoves`;
    }
  }, [store.settings.name, page, pid]);

  // Helpers
  const fmt = (n: number) =>
    (store.settings.cur || 'Rs.') + ' ' + Number(n || 0).toLocaleString('en-US');

  const getProduct = (id: string | null) => {
    const p = store.products.find((prod) => prod.id === id);
    return p ? sanitizeProduct(p) : undefined;
  };

  const cartSubtotal = cart.reduce((acc, c) => {
    const p = getProduct(c.id);
    return acc + (p ? p.price * c.q : 0);
  }, 0);

  const totalCartCount = cart.reduce((acc, c) => acc + c.q, 0);

  const go = (p: 'home' | 'shop' | 'product' | 'checkout' | 'thanks' | 'admin', id?: string) => {
    setPage(p);
    setIsMenuOpen(false);
    setIsCartOpen(false);
    if (id) {
      setPid(id);
      setImgIndex(0);
      setQty(1);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goSec = (sectionId: string) => {
    setIsMenuOpen(false);
    if (page !== 'home') {
      setPage('home');
    }
    setTimeout(() => {
      const el = document.getElementById(sectionId);
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    }, 50);
  };

  // Cart operations
  const addToCart = (id: string, q: number, checkoutNow = false) => {
    setCart((prev) => {
      const existing = prev.find((x) => x.id === id);
      if (existing) {
        return prev.map((x) => (x.id === id ? { ...x, q: x.q + q } : x));
      }
      return [...prev, { id, q }];
    });

    if (checkoutNow) {
      go('checkout');
    } else {
      setIsCartOpen(true);
    }
  };

  const updateCartQ = (id: string, delta: number) => {
    setCart((prev) => {
      const found = prev.find((x) => x.id === id);
      if (!found) return prev;
      const newQ = found.q + delta;
      if (newQ < 1) {
        return prev.filter((x) => x.id !== id);
      }
      return prev.map((x) => (x.id === id ? { ...x, q: newQ } : x));
    });
  };

  // Star rating renderer
  const renderStars = (n: number, size = 14) => (
    <span className="st">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={i <= n ? '' : 'e'}>
          <Icon name="star" size={size} />
        </span>
      ))}
    </span>
  );

  // File to base64 data helper
  const fileToData = (file: File, max = 900): Promise<string> =>
    new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = img.width * scale;
          canvas.height = img.height * scale;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', 0.8));
          } else {
            resolve(reader.result as string);
          }
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    });

  // ImgBB Cloud Image Uploader with local canvas fallback
  const uploadToImgBB = async (file: File): Promise<string> => {
    const apiKey = store.settings.imgbbApiKey || 'fc7a66753695be4c6425eee9bae569c2';
    try {
      setUploadStatus(`Uploading ${file.name} to ImgBB...`);
      const form = new FormData();
      form.append('image', file);
      const res = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey}`, {
        method: 'POST',
        body: form,
      });
      const data = await res.json();
      if (data && data.success && data.data?.url) {
        return data.data.url;
      }
      throw new Error(data?.error?.message || 'ImgBB upload failed');
    } catch (err) {
      console.warn('ImgBB upload failed, falling back to local storage:', err);
      return fileToData(file, 900);
    } finally {
      setUploadStatus('');
    }
  };

  // Hero slides list
  const heroSlides: HeroSlide[] =
    store.settings.heroSlides && store.settings.heroSlides.length > 0
      ? store.settings.heroSlides
      : (DEFAULT_STORE_DATA.settings.heroSlides || []);

  // Auto-advance hero slides every 3.5 seconds
  useEffect(() => {
    if (heroSlides.length <= 1 || isSliderHovered) return;
    const timer = setInterval(() => {
      setActiveSlide((prev) => (prev + 1) % heroSlides.length);
    }, 3500);
    return () => clearInterval(timer);
  }, [heroSlides.length, isSliderHovered]);

  // Touch swipe gesture handlers for mobile & touchscreens
  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchEndX(null);
    setTouchStartX(e.targetTouches[0].clientX);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    setTouchEndX(e.targetTouches[0].clientX);
  };

  const handleTouchEnd = () => {
    if (touchStartX === null || touchEndX === null) return;
    const distance = touchStartX - touchEndX;
    const minSwipeDist = 45;
    if (distance > minSwipeDist) {
      // Swiped Left -> Next Slide
      setActiveSlide((prev) => (prev + 1) % heroSlides.length);
    } else if (distance < -minSwipeDist) {
      // Swiped Right -> Previous Slide
      setActiveSlide((prev) => (prev === 0 ? heroSlides.length - 1 : prev - 1));
    }
    setTouchStartX(null);
    setTouchEndX(null);
  };


  // Generate email mailto link for direct order notifications
  const getOrderEmailUrl = (order: StoreOrder, statusOverride?: string) => {
    const curStatus = statusOverride || order.status;
    const subject = `Woodflame Order Update: ${order.id} - ${curStatus}`;
    const itemsList = order.items
      .map((it) => `• ${it.name} (Qty: ${it.q}) - Rs. ${(it.price * it.q).toLocaleString()}`)
      .join('\n');
    const body = `Dear ${order.name},

Your order at Woodflame has been updated to: ${curStatus.toUpperCase()}.

Order Summary:
• Order ID: ${order.id}
• Status: ${curStatus}
• Date: ${order.date}
• Payment Method: ${order.pay}
• Delivery Address: ${order.address}

Ordered Items:
${itemsList}

Total Amount: Rs. ${Number(order.total).toLocaleString()}

For any inquiries, feel free to reply to this email or chat with us on WhatsApp at 0304-6042333.

Thank you for shopping with Woodflame Fabrications!`;

    const recipient = order.email ? encodeURIComponent(order.email) : '';
    return `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  // Order Placement
  const handlePlaceOrder = () => {
    if (!phone.trim() || !firstName.trim() || !address.trim() || !city.trim()) {
      alert('Please fill in phone, first name, address and city.');
      return;
    }

    const shipFee = Number(store.settings.ship) || 0;
    const newOrder: StoreOrder = {
      id: '#' + (1001 + store.orders.length),
      date: new Date().toLocaleString(),
      name: `${firstName.trim()} ${lastName.trim()}`,
      phone: phone.trim(),
      email: customerEmail.trim() || undefined,
      address: `${address.trim()}, ${city.trim()} ${postalCode.trim()}`,
      pay: paymentMethod,
      status: 'New',
      items: cart
        .map((c) => {
          const p = getProduct(c.id);
          return p ? { name: p.name, q: c.q, price: p.price } : null;
        })
        .filter(Boolean) as any,
      total: cartSubtotal + shipFee,
    };

    const updatedStore = {
      ...store,
      orders: [newOrder, ...store.orders],
    };
    saveStoreAndSync(updatedStore);
    // Save to Firebase orders collection
    saveOrderToFirebase(newOrder);

    // Asynchronous FormSubmit Email Notification POST
    const recipientEmail = store.settings.email || 'woodflare91@gmail.com';
    fetch(`https://formsubmit.co/ajax/${encodeURIComponent(recipientEmail)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        _subject: `🔥 New Woodflame Order ${newOrder.id} - ${newOrder.name}`,
        _template: 'table',
        _captcha: 'false',
        Order_ID: newOrder.id,
        Customer_Name: newOrder.name,
        Customer_Phone: newOrder.phone,
        Customer_Email: newOrder.email || 'Not Provided',
        Delivery_Address: newOrder.address,
        Payment_Method: newOrder.pay,
        Total_Amount: `Rs. ${newOrder.total.toLocaleString()}`,
        Items_Ordered: newOrder.items.map((i) => `${i.name} (Qty: ${i.q}) - Rs. ${(i.price * i.q).toLocaleString()}`).join('\n'),
        Order_Date: newOrder.date,
      }),
    }).catch(() => {});

    setLastOrder(newOrder);
    setCart([]);
    setReviewName(`${firstName.trim()} ${lastName.trim()}`);
    setReviewCity(city.trim());
    setReviewRating(5);
    setReviewText('');
    setReviewSubmitted(false);
    setShowReviewModal(true);
    go('thanks');
  };

  // Nav links
  const NAV_LINKS = [
    { label: 'Home', action: () => go('home') },
    { label: 'All Products', action: () => go('shop') },
    { label: 'Order Tracking', action: () => { setPage('tracking' as any); window.scrollTo({ top: 0, behavior: 'smooth' }); } },
    { label: 'In Action', action: () => goSec('action') },
    { label: 'Reviews', action: () => goSec('rev') },
    { label: 'Contact', action: () => goSec('contact') },
  ];

  /* ----------------- RENDER SECTIONS ----------------- */

  // Brand Logo with official logo image
  const renderBrandLogo = () => {
    const logoSrc = store.settings.logoImg || '/assets/aistudio/logo_f5e61050.png';
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', userSelect: 'none' }}>
        <img
          src={logoSrc}
          alt={store.settings.name || 'Woodflame'}
          style={{ maxHeight: '44px', maxWidth: '200px', objectFit: 'contain' }}
        />
      </div>
    );
  };

  // 1. Header
  const renderHeader = () => (
    <>
      {store.settings.bar && <div className="bar">{store.settings.bar}</div>}
      <header>
        <div className="w">
          <div className="logo" onClick={handleSecretAdminTrigger} title={store.settings.name || 'Woodflame'}>
            {renderBrandLogo()}
          </div>

          <nav>
            {NAV_LINKS.map((link) => (
              <a key={link.label} onClick={link.action}>
                {link.label}
              </a>
            ))}
          </nav>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {authUser ? (
              <button
                type="button"
                className="btn sm ol"
                onClick={() => go('account' as any)}
                style={{
                  fontSize: '12.5px',
                  padding: '6px 12px',
                  borderRadius: '20px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <Icon name="cog" size={15} /> {authUser?.name ? authUser.name.split(' ')[0] : 'My Account'}
              </button>
            ) : (
              <button
                type="button"
                className="btn sm ol"
                onClick={() => go('account' as any)}
                style={{
                  fontSize: '12.5px',
                  padding: '6px 12px',
                  borderRadius: '20px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                Sign In / Register
              </button>
            )}

            <button
              className="ib"
              onClick={() => setIsCartOpen(true)}
              aria-label="Cart"
            >
              <Icon name="cart" size={22} />
              {totalCartCount > 0 && <span className="cnt">{totalCartCount}</span>}
            </button>
            <button
              className="ib mbtn"
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              aria-label="Menu"
            >
              <Icon name={isMenuOpen ? 'x' : 'menu'} size={22} />
            </button>
          </div>
        </div>

        <div className={`mn ${isMenuOpen ? 'on' : ''}`}>
          {NAV_LINKS.map((link) => (
            <a key={link.label} onClick={link.action}>
              {link.label}
            </a>
          ))}
        </div>
      </header>
    </>
  );

  // 2. Footer
  const renderFooter = () => (
    <footer id="contact">
      <div className="w">
        <div className="cols">
          <div>
            <div
              className="logo"
              style={{ color: '#fff', marginBottom: '12px', userSelect: 'none', cursor: 'pointer' }}
              onClick={handleSecretAdminTrigger}
              title={store.settings.name || 'Woodflame'}
            >
              {renderBrandLogo()}
            </div>
            <p style={{ margin: 0, maxWidth: '340px' }}>{store.settings.about}</p>
            <div className="so">
              {store.settings.fb && (
                <a href={store.settings.fb} target="_blank" rel="noopener" aria-label="Facebook">
                  <Icon name="fb" size={18} />
                </a>
              )}
              {store.settings.ig && (
                <a href={store.settings.ig} target="_blank" rel="noopener" aria-label="Instagram">
                  <Icon name="ig" size={18} />
                </a>
              )}
              {store.settings.yt && (
                <a href={store.settings.yt} target="_blank" rel="noopener" aria-label="YouTube">
                  <Icon name="yt" size={18} />
                </a>
              )}
              <a
                href={`https://wa.me/${store.settings.wa}`}
                target="_blank"
                rel="noopener"
                aria-label="WhatsApp"
              >
                <Icon name="wa" size={18} />
              </a>
            </div>
          </div>

          <div>
            <h4>Quick links</h4>
            <ul>
              <li>
                <a onClick={() => go('home')}>Home</a>
              </li>
              <li>
                <a onClick={() => go('shop')}>All products</a>
              </li>
              <li>
                <a onClick={() => goSec('action')}>In Action</a>
              </li>
              <li>
                <a onClick={() => goSec('rev')}>Customer reviews</a>
              </li>
              <li>
                <a onClick={() => setIsCartOpen(true)}>My cart</a>
              </li>
            </ul>
          </div>

          <div>
            <h4>Contact us</h4>
            <ul>
              <li>
                <Icon name="phone" size={17} />
                <a href={`tel:${store.settings.phone}`}>{store.settings.phone}</a>
              </li>
              <li>
                <Icon name="mail" size={17} />
                <a href={`mailto:${store.settings.email}`}>{store.settings.email}</a>
              </li>
              <li>
                <Icon name="pin" size={17} />
                <span>{store.settings.address}</span>
              </li>
              <li>
                <Icon name="wa" size={17} />
                <a href={`https://wa.me/${store.settings.wa}`} target="_blank" rel="noopener">
                  Chat on WhatsApp
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h4>Why shop with us</h4>
            <ul>
              <li>
                <Icon name="truck" size={17} />
                Nationwide delivery
              </li>
              <li>
                <Icon name="shield" size={17} />
                Damage protection
              </li>
              <li>
                <Icon name="refresh" size={17} />
                Easy replacements
              </li>
            </ul>
          </div>
        </div>

        <div className="fb">
          <span>
            © {new Date().getFullYear()} {store.settings.name}. All rights reserved.
          </span>
        </div>
      </div>
    </footer>
  );

  // 3. Home View
  const renderHome = () => {
    const s = store.settings;
    const avg = store.reviews.length
      ? (
          store.reviews.reduce((acc, r) => acc + r.r, 0) / store.reviews.length
        ).toFixed(2)
      : '5.00';

    return (
      <>
        {/* Full Visibility Hero Slider with Side/Lower Text Overlay */}
        <div
          className="hero-slider-wrap"
          onMouseEnter={() => setIsSliderHovered(true)}
          onMouseLeave={() => setIsSliderHovered(false)}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="hero-slider-inner">
            {heroSlides[activeSlide] && (
              <div className="clean-slide-box">
                <div className="clean-slide-img-box">
                  <img
                    src={heroSlides[activeSlide].img}
                    alt={heroSlides[activeSlide].t || s.hero}
                    className="clean-slide-img"
                  />
                  <div className="clean-slide-scrim" />
                </div>

                <div className="clean-slide-caption-overlay">
                  {heroSlides[activeSlide].tag && (
                    <span className="hero-tag">{heroSlides[activeSlide].tag}</span>
                  )}
                  <h1>{heroSlides[activeSlide].t || s.hero}</h1>
                  <p>{heroSlides[activeSlide].d || s.sub}</p>
                </div>

                {heroSlides.length > 1 && (
                  <div className="clean-slider-dots-overlay">
                    {heroSlides.map((_, idx) => (
                      <button
                        key={idx}
                        type="button"
                        className={`dot-pill ${idx === activeSlide ? 'active' : ''}`}
                        onClick={() => setActiveSlide(idx)}
                        aria-label={`Slide ${idx + 1}`}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="w">
          <div className="feat">
            {s.feats.map((f, i) => (
              <div key={i}>
                <span className="fi">
                  <Icon name={f.i} size={24} />
                </span>
                <p style={{ margin: 0 }}>
                  <b>{f.t}</b>
                  <span>{f.d}</span>
                </p>
              </div>
            ))}
          </div>

          <div style={{ marginTop: '28px', marginBottom: '12px' }}>
            <h2 className="sec" id="all" style={{ margin: 0, textAlign: 'left' }}>
              Featured Stoves &amp; Fuel
            </h2>
            <p className="sub" style={{ margin: '4px 0 0', textAlign: 'left' }}>
              High-efficiency biomass technology made for Pakistani kitchens
            </p>
          </div>

          {/* Clean 'All' pill on Home with 'View All Products ->' button leading to full category shop */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '18px' }}>
            <button
              type="button"
              className="cat-pill active"
              onClick={() => setSelectedCategory('All')}
              style={{ cursor: 'pointer' }}
            >
              All
            </button>
            <button
              type="button"
              className="btn sm ol"
              onClick={() => go('shop')}
              style={{
                flexShrink: 0,
                whiteSpace: 'nowrap',
                borderRadius: '24px',
                padding: '7px 16px',
                fontSize: '13px',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
              }}
            >
              View All Products <Icon name="arrow" size={14} />
            </button>
          </div>

          {store.products.length ? (
            <div className="grid">
              {store.products
                .filter(p => selectedCategory === 'All' || p.category === selectedCategory)
                .map((p) => {
                  const sale = p.compare > p.price;
                  return (
                    <div key={p.id} className="card" onClick={() => go('product', p.id)}>
                      {!p.stock ? (
                        <span className="badge oos">SOLD OUT</span>
                      ) : sale ? (
                        <span className="badge">SALE</span>
                      ) : null}
                      <img
                        src={(p.images && p.images[0]) || DEFAULT_PRODUCT_IMAGE}
                        alt={p.name}
                        loading="lazy"
                      />
                      <div className="in">
                        {p.category && (
                          <div style={{ fontSize: '10.5px', textTransform: 'uppercase', color: 'var(--ac)', fontWeight: 700, letterSpacing: '0.5px', marginBottom: '3px' }}>
                            {p.category}
                          </div>
                        )}
                        <div className="n">{p.name}</div>
                        {renderStars(p.rating)}
                        <div className="pr">
                          {fmt(p.price)}
                          {sale && <s>{fmt(p.compare)}</s>}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          ) : (
            <p className="tc">No products yet. Add some from the admin panel.</p>
          )}

          {store.gallery.length > 0 && (
            <>
              <h2 className="sec" id="action">In Action</h2>
              <p className="sub">See our products in real use</p>
              <div className="car">
                {store.gallery.map((g, i) => (
                  <div key={i}>
                    <img src={g.img} alt={g.t} loading="lazy" />
                    <em>{g.t}</em>
                  </div>
                ))}
              </div>
            </>
          )}

          {store.reviews.length > 0 && (
            <>
              <h2 className="sec" id="rev">
                Customer Reviews
              </h2>
              <div className="rt">
                {renderStars(Math.round(Number(avg)), 18)}
                <b style={{ color: 'var(--tx)' }}>{avg}</b> out of 5
              </div>
              <div className="rv">
                {store.reviews.map((r, i) => (
                  <div key={i}>
                    {renderStars(r.r)}
                    <p>{r.t}</p>
                    <small>— {r.n}</small>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </>
    );
  };

  // 4. Product View
  const renderProduct = () => {
    const p = getProduct(pid);
    if (!p) {
      return (
        <div className="tc">
          <p>Product not found.</p>
          <button className="btn" onClick={() => go('home')}>
            Back to store
          </button>
        </div>
      );
    }

    const sale = p.compare > p.price;
    const im = Array.isArray(p.images) && p.images.length > 0 ? p.images : [DEFAULT_PRODUCT_IMAGE];
    const sim = store.products.filter((x) => x.id !== p.id).slice(0, 4);

    return (
      <div className="w">
        <p style={{ margin: '14px 0 0' }}>
          <a
            onClick={() => go('home')}
            style={{
              color: 'var(--mu)',
              cursor: 'pointer',
              display: 'inline-flex',
              gap: '6px',
              alignItems: 'center',
            }}
          >
            <Icon name="back" size={16} /> Back to store
          </a>
        </p>

        <div className="pg">
          <div>
            <img className="main" src={im[imgIndex] || im[0] || DEFAULT_PRODUCT_IMAGE} alt={p.name} />
            <div className="th">
              {im.map((x, i) => (
                <img
                  key={i}
                  src={x}
                  className={i === imgIndex ? 'on' : ''}
                  onClick={() => setImgIndex(i)}
                  alt=""
                />
              ))}
            </div>
          </div>

          <div>
            <h1 style={{ fontSize: '26px', margin: '0 0 6px', letterSpacing: '-.5px' }}>
              {p.name}
            </h1>
            {renderStars(p.rating, 16)}
            <div className="pr" style={{ fontSize: '22px', margin: '8px 0' }}>
              {fmt(p.price)}
              {sale && <s>{fmt(p.compare)}</s>}
            </div>

            <p style={{ margin: '6px 0 14px' }}>
              <span className={`dot ${p.stock ? '' : 'r'}`} />
              {p.stock ? 'In stock' : 'Out of stock'}
            </p>

            <div className="desc">{p.desc}</div>

            <div className="row">
              <div className="q">
                <button
                  onClick={() => setQty(Math.max(1, qty - 1))}
                  aria-label="Less"
                >
                  <Icon name="minus" size={16} />
                </button>
                <span>{qty}</span>
                <button
                  onClick={() => setQty(qty + 1)}
                  aria-label="More"
                >
                  <Icon name="plus" size={16} />
                </button>
              </div>
              <button
                className="btn"
                disabled={!p.stock}
                onClick={() => addToCart(p.id, qty, false)}
              >
                <Icon name="cart" size={18} /> Add to cart
              </button>
            </div>

            <button
              className="btn dk full"
              disabled={!p.stock}
              onClick={() => addToCart(p.id, qty, true)}
            >
              Buy it now
            </button>

            <div className="cm">
              <h4>OUR COMMITMENT</h4>
              <div>
                <span>
                  <Icon name="truck" size={26} />
                  Delivery Nationwide
                </span>
                <span>
                  <Icon name="shield" size={26} />
                  Damage Protection
                </span>
                <span>
                  <Icon name="refresh" size={26} />
                  Easy Replacements
                </span>
              </div>
            </div>

            {p.specs && p.specs.length > 0 && (
              <details open>
                <summary>
                  <Icon name="cog" size={18} /> Technical Specifications
                </summary>
                <table>
                  <tbody>
                    {(Array.isArray(p.specs) ? p.specs : [])
                      .filter((r) => Array.isArray(r) && r.length >= 2 && r[0] != null)
                      .map((r, i) => (
                      <tr key={i}>
                        <td>
                          <b>{r[0]}</b>
                        </td>
                        <td>{r[1]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}
          </div>
        </div>

        {sim.length > 0 && (
          <>
            <h2 className="sec">Similar Products</h2>
            <div className="grid" style={{ marginTop: '20px' }}>
              {sim.map((sp) => {
                const sSale = sp.compare > sp.price;
                return (
                  <div key={sp.id} className="card" onClick={() => go('product', sp.id)}>
                    {!sp.stock ? (
                      <span className="badge oos">SOLD OUT</span>
                    ) : sSale ? (
                      <span className="badge">SALE</span>
                    ) : null}
                    <img src={(sp.images && sp.images[0]) || DEFAULT_PRODUCT_IMAGE} alt={sp.name} />
                    <div className="in">
                      <div className="n">{sp.name}</div>
                      {renderStars(sp.rating)}
                      <div className="pr">
                        {fmt(sp.price)}
                        {sSale && <s>{fmt(sp.compare)}</s>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  };

  // 5. Cart Drawer
  const renderCartDrawer = () => {
    if (!isCartOpen) return null;

    return (
      <>
        <div className="ov" onClick={() => setIsCartOpen(false)} />
        <div className="dr">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>Your cart</h3>
            <button
              className="ib"
              onClick={() => setIsCartOpen(false)}
              aria-label="Close"
            >
              <Icon name="x" size={22} />
            </button>
          </div>

          <div className="ls">
            {cart.length ? (
              cart.map((c) => {
                const p = getProduct(c.id);
                if (!p) return null;
                return (
                  <div key={c.id} className="ci">
                    <img src={(p.images && p.images[0]) || DEFAULT_PRODUCT_IMAGE} alt={p.name} />
                    <div>
                      {p.name}
                      <br />
                      <b>{fmt(p.price)}</b>
                    </div>
                    <div className="q">
                      <button onClick={() => updateCartQ(c.id, -1)}>
                        <Icon name="minus" size={14} />
                      </button>
                      <span>{c.q}</span>
                      <button onClick={() => updateCartQ(c.id, 1)}>
                        <Icon name="plus" size={14} />
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="tc">
                <Icon name="cart" size={40} />
                <br />
                Your cart is empty.
              </p>
            )}
          </div>

          {cart.length > 0 && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', margin: '10px 0' }}>
                <b>Subtotal</b>
                <b>{fmt(cartSubtotal)}</b>
              </div>
              <button className="btn full" onClick={() => go('checkout')}>
                Checkout <Icon name="arrow" size={18} />
              </button>
            </>
          )}
        </div>
      </>
    );
  };

  // 6. Checkout View
  const renderCheckout = () => {
    if (!cart.length) {
      return (
        <div className="tc" style={{ padding: '60px 16px' }}>
          <h2 style={{ color: 'var(--tx)' }}>Your cart is empty</h2>
          <button className="btn" onClick={() => go('home')}>
            Continue shopping
          </button>
        </div>
      );
    }

    const sh = Number(store.settings.ship) || 0;

    return (
      <div className="w">
        <p style={{ margin: '14px 0 0' }}>
          <a
            onClick={() => go('home')}
            style={{
              color: 'var(--mu)',
              cursor: 'pointer',
              display: 'inline-flex',
              gap: '6px',
              alignItems: 'center',
            }}
          >
            <Icon name="back" size={16} /> Continue shopping
          </a>
        </p>

        <div className="co">
          <div>
            <h3 className="h">
              <Icon name="phone" size={20} /> Contact &amp; Updates
            </h3>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Mobile phone number *"
            />
            <input
              type="email"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              placeholder="Email address (for order updates)"
              style={{ marginTop: '8px' }}
            />

            <h3 className="h">
              <Icon name="pin" size={20} /> Delivery
            </h3>
            <div className="two">
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First name"
              />
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Last name"
              />
            </div>

            <label>Address</label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Street address, House/Shop #"
            />

            <div className="two">
              <div>
                <label>City</label>
                <input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="e.g. Lahore / Rawalpindi"
                />
              </div>
              <div>
                <label>Postal code (optional)</label>
                <input
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                  placeholder="e.g. 46000"
                />
              </div>
            </div>

            <h3 className="h">
              <Icon name="truck" size={20} /> Shipping method
            </h3>
            <div
              className="box sel"
              style={{ display: 'flex', justifyContent: 'space-between' }}
            >
              <span>Standard (5–7 working days)</span>
              <b>{fmt(sh)}</b>
            </div>

            <h3 className="h">
              <Icon name="card" size={20} /> Payment
            </h3>
            <label
              className={`box ${paymentMethod === 'COD' ? 'sel' : ''}`}
              style={{ color: 'var(--tx)', fontSize: '15px', fontWeight: 500, cursor: 'pointer' }}
            >
              <input
                type="radio"
                name="pm"
                value="COD"
                checked={paymentMethod === 'COD'}
                onChange={() => setPaymentMethod('COD')}
              />{' '}
              COD (Delivery charges advance)
              <br />
              <small style={{ color: 'var(--mu)', display: 'block', marginTop: '4px' }}>
                Pay the delivery charges in advance. The remaining amount is paid in cash on delivery.
              </small>
            </label>

            <label
              className={`box ${paymentMethod === 'Bank Transfer' ? 'sel' : ''}`}
              style={{ color: 'var(--tx)', fontSize: '15px', fontWeight: 500, cursor: 'pointer' }}
            >
              <input
                type="radio"
                name="pm"
                value="Bank Transfer"
                checked={paymentMethod === 'Bank Transfer'}
                onChange={() => setPaymentMethod('Bank Transfer')}
              />{' '}
              Bank Transfer
              {paymentMethod === 'Bank Transfer' && (
                <div
                  style={{
                    whiteSpace: 'pre-line',
                    color: 'var(--mu)',
                    fontWeight: 400,
                    marginTop: '8px',
                    fontSize: '13px',
                    background: 'var(--bg2)',
                    padding: '10px 12px',
                    borderRadius: '8px',
                  }}
                >
                  {store.settings.bank}
                </div>
              )}
            </label>

            <label
              className={`box ${paymentMethod === 'Easypaisa' ? 'sel' : ''}`}
              style={{ color: 'var(--tx)', fontSize: '15px', fontWeight: 500, cursor: 'pointer' }}
            >
              <input
                type="radio"
                name="pm"
                value="Easypaisa"
                checked={paymentMethod === 'Easypaisa'}
                onChange={() => setPaymentMethod('Easypaisa')}
              />{' '}
              Easypaisa Mobile Wallet
              {paymentMethod === 'Easypaisa' && (
                <div
                  style={{
                    whiteSpace: 'pre-line',
                    color: 'var(--mu)',
                    fontWeight: 400,
                    marginTop: '8px',
                    fontSize: '13px',
                    background: 'var(--bg2)',
                    padding: '10px 12px',
                    borderRadius: '8px',
                  }}
                >
                  {store.settings.easypaisa || 'Easypaisa Account: 0304-6042333\nAccount Title: Ali (Woodflame)'}
                </div>
              )}
            </label>

            <label
              className={`box ${paymentMethod === 'JazzCash' ? 'sel' : ''}`}
              style={{ color: 'var(--tx)', fontSize: '15px', fontWeight: 500, cursor: 'pointer' }}
            >
              <input
                type="radio"
                name="pm"
                value="JazzCash"
                checked={paymentMethod === 'JazzCash'}
                onChange={() => setPaymentMethod('JazzCash')}
              />{' '}
              JazzCash Mobile Wallet
              {paymentMethod === 'JazzCash' && (
                <div
                  style={{
                    whiteSpace: 'pre-line',
                    color: 'var(--mu)',
                    fontWeight: 400,
                    marginTop: '8px',
                    fontSize: '13px',
                    background: 'var(--bg2)',
                    padding: '10px 12px',
                    borderRadius: '8px',
                  }}
                >
                  {store.settings.jazzcash || 'JazzCash Account: 0304-6042333\nAccount Title: Ali (Woodflame)'}
                </div>
              )}
            </label>
          </div>

          <div>
            <div className="box">
              <h3 style={{ marginTop: 0 }}>Order summary</h3>
              {cart.map((c) => {
                const p = getProduct(c.id);
                if (!p) return null;
                return (
                  <div key={c.id} className="ci">
                    <img src={(p.images && p.images[0]) || DEFAULT_PRODUCT_IMAGE} alt="" />
                    <div>
                      {p.name} × {c.q}
                    </div>
                    <b>{fmt(p.price * c.q)}</b>
                  </div>
                );
              })}
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Subtotal</span>
                <span>{fmt(cartSubtotal)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Shipping</span>
                <span>{fmt(sh)}</span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '19px',
                  marginTop: '8px',
                }}
              >
                <b>Total</b>
                <b>{fmt(cartSubtotal + sh)}</b>
              </div>
            </div>

            <button className="btn dk full" onClick={handlePlaceOrder}>
              <Icon name="check" size={18} /> Complete order
            </button>
          </div>
        </div>
      </div>
    );
  };

  // 7. Thank You View
  const renderThanks = () => {
    const waMsg = encodeURIComponent(
      `Hello Woodflame! I just placed order ${lastOrder ? lastOrder.id : ''} for ${lastOrder ? fmt(lastOrder.total) : ''}. Please confirm my delivery.`
    );

    return (
      <div className="tc" style={{ padding: '50px 16px', maxWidth: '600px', margin: '0 auto' }}>
        <div
          className="ok"
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            background: 'rgba(46, 158, 91, 0.12)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--ok)',
            margin: '0 auto 16px',
          }}
        >
          <Icon name="check" size={36} />
        </div>
        <h2 style={{ color: 'var(--tx)', margin: '0 0 8px', fontSize: '28px' }}>
          Thank You for Your Order!
        </h2>
        <p style={{ color: 'var(--mu)', fontSize: '15px', margin: '0 0 20px', lineHeight: 1.6 }}>
          Your order <b>{lastOrder ? lastOrder.id : ''}</b> has been received successfully. Our sales team will call or WhatsApp you shortly to confirm dispatch.
        </p>

        {lastOrder && (
          <div className="box" style={{ textAlign: 'left', margin: '0 0 24px', padding: '18px 20px' }}>
            <h4 style={{ margin: '0 0 12px', color: 'var(--tx)', fontSize: '15px' }}>Order Details</h4>
            <div style={{ display: 'grid', gap: '8px', fontSize: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--mu)' }}>Customer:</span>
                <b>{lastOrder.name}</b>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--mu)' }}>Phone:</span>
                <b>{lastOrder.phone}</b>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--mu)' }}>Payment Method:</span>
                <span style={{ color: 'var(--ac)', fontWeight: 600 }}>{lastOrder.pay}</span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  borderTop: '1px solid var(--bd)',
                  paddingTop: '8px',
                  marginTop: '4px',
                  fontSize: '16px',
                }}
              >
                <b>Total Amount:</b>
                <b style={{ color: 'var(--tx)' }}>{fmt(lastOrder.total)}</b>
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: '360px', margin: '0 auto' }}>
          <a
            className="btn full"
            style={{ background: '#25d366', color: '#fff' }}
            href={`https://wa.me/${store.settings.wa}?text=${waMsg}`}
            target="_blank"
            rel="noopener"
          >
            <Icon name="wa" size={20} /> Confirm Order via WhatsApp
          </a>

          <button
            className="btn ol full"
            onClick={() => {
              setReviewSubmitted(false);
              setShowReviewModal(true);
            }}
          >
            <Icon name="star" size={17} /> Leave a Quick Review
          </button>

          <button
            className="btn full"
            style={{ background: 'var(--bg2)', color: 'var(--tx)', border: '1px solid var(--bd)' }}
            onClick={() => go('shop')}
          >
            Browse More Products
          </button>
        </div>
      </div>
    );
  };

  // 8. Dedicated Shop / All Products Page
  const renderShop = () => {
    const categories = [
      'All',
      ...((Array.from(new Set(store.products.map((p) => p.category).filter(Boolean)))) as string[]),
    ];

    let filtered = store.products.filter((p) => {
      const matchCat = selectedCategory === 'All' || p.category === selectedCategory;
      const matchSearch =
        !searchQuery.trim() ||
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.desc.toLowerCase().includes(searchQuery.toLowerCase());
      return matchCat && matchSearch;
    });

    if (sortBy === 'price-asc') {
      filtered = [...filtered].sort((a, b) => a.price - b.price);
    } else if (sortBy === 'price-desc') {
      filtered = [...filtered].sort((a, b) => b.price - a.price);
    } else if (sortBy === 'rating') {
      filtered = [...filtered].sort((a, b) => b.rating - a.rating);
    }

    return (
      <div className="w" style={{ padding: '24px 16px 60px' }}>
        {/* Breadcrumb */}
        <div
          style={{
            fontSize: '13px',
            color: 'var(--mu)',
            marginBottom: '14px',
            display: 'flex',
            gap: '8px',
            alignItems: 'center',
          }}
        >
          <a onClick={() => go('home')} style={{ cursor: 'pointer', color: 'var(--mu)' }}>
            Home
          </a>
          <span>/</span>
          <span style={{ color: 'var(--tx)', fontWeight: 600 }}>All Products</span>
          {selectedCategory !== 'All' && (
            <>
              <span>/</span>
              <span style={{ color: 'var(--ac)', fontWeight: 600 }}>{selectedCategory}</span>
            </>
          )}
        </div>

        <h1 style={{ fontSize: 'clamp(26px, 5vw, 36px)', margin: '0 0 6px', letterSpacing: '-0.5px' }}>
          {selectedCategory === 'All' ? 'Woodflame Product Catalog' : selectedCategory}
        </h1>
        <p style={{ color: 'var(--mu)', margin: '0 0 20px', maxWidth: '640px', fontSize: '14.5px' }}>
          Explore our complete range of solid iron domestic rocket stoves, high-temperature commercial blast burners, and clean hardwood biomass pellets.
        </p>

        {/* Category Filter Tabs */}
        <div className="cat-tabs">
          {categories.map((cat) => {
            const count =
              cat === 'All'
                ? store.products.length
                : store.products.filter((p) => p.category === cat).length;
            return (
              <button
                key={cat}
                className={`cat-pill ${selectedCategory === cat ? 'active' : ''}`}
                onClick={() => setSelectedCategory(cat)}
              >
                {cat} <span style={{ opacity: 0.75, fontSize: '12px' }}>({count})</span>
              </button>
            );
          })}
        </div>

        {/* Search & Sort Controls */}
        <div
          style={{
            display: 'flex',
            gap: '12px',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '22px',
          }}
        >
          <div style={{ position: 'relative', flex: '1', minWidth: '220px', maxWidth: '380px' }}>
            <span
              style={{
                position: 'absolute',
                left: '12px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--mu)',
                display: 'flex',
              }}
            >
              <Icon name="search" size={17} />
            </span>
            <input
              type="text"
              placeholder="Search stoves, pellets, accessories..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: '100%', paddingLeft: '38px', margin: 0, paddingRight: searchQuery ? '34px' : '12px' }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{
                  position: 'absolute',
                  right: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 0,
                  color: 'var(--mu)',
                  cursor: 'pointer',
                }}
              >
                <Icon name="x" size={16} />
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ fontSize: '13.5px', color: 'var(--mu)', whiteSpace: 'nowrap' }}>Sort by:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              style={{
                padding: '9px 12px',
                borderRadius: '8px',
                border: '1px solid var(--bd)',
                background: 'var(--bg)',
                color: 'var(--tx)',
                fontSize: '13.5px',
                margin: 0,
              }}
            >
              <option value="featured">Featured / Default</option>
              <option value="price-asc">Price: Low to High</option>
              <option value="price-desc">Price: High to Low</option>
              <option value="rating">Highest Rated</option>
            </select>
          </div>
        </div>

        {/* Products Grid */}
        {filtered.length ? (
          <div className="grid">
            {filtered.map((p) => {
              const sale = p.compare > p.price;
              return (
                <div key={p.id} className="card" onClick={() => go('product', p.id)}>
                  {!p.stock ? (
                    <span className="badge oos">SOLD OUT</span>
                  ) : sale ? (
                    <span className="badge">SALE</span>
                  ) : null}
                  <img src={(p.images && p.images[0]) || DEFAULT_PRODUCT_IMAGE} alt={p.name} loading="lazy" />
                  <div className="in">
                    {p.category && (
                      <div
                        style={{
                          fontSize: '10.5px',
                          textTransform: 'uppercase',
                          color: 'var(--ac)',
                          fontWeight: 700,
                          letterSpacing: '0.5px',
                          marginBottom: '3px',
                        }}
                      >
                        {p.category}
                      </div>
                    )}
                    <div className="n">{p.name}</div>
                    {renderStars(p.rating)}
                    <div className="pr">
                      {fmt(p.price)}
                      {sale && <s>{fmt(p.compare)}</s>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div
            className="tc"
            style={{
              padding: '60px 16px',
              background: 'var(--bg2)',
              borderRadius: '16px',
              border: '1px solid var(--bd)',
              marginTop: '16px',
            }}
          >
            <Icon name="pkg" size={44} />
            <h3 style={{ margin: '14px 0 6px', color: 'var(--tx)' }}>No products found</h3>
            <p style={{ color: 'var(--mu)', margin: '0 0 16px', fontSize: '14px' }}>
              No items matched "{searchQuery || selectedCategory}".
            </p>
            <button
              className="btn"
              onClick={() => {
                setSelectedCategory('All');
                setSearchQuery('');
              }}
            >
              Reset Filters
            </button>
          </div>
        )}
      </div>
    );
  };

  // 9. Interactive Post-Purchase Review Modal
  const handleReviewSubmit = () => {
    if (!reviewText.trim()) {
      alert('Please write a brief comment or review.');
      return;
    }
    const newRev = {
      n: reviewName.trim() || 'Verified Buyer',
      r: reviewRating,
      t: reviewText.trim(),
      city: reviewCity.trim() || undefined,
      date: 'Just now',
    };
    const updatedStore = {
      ...store,
      reviews: [newRev, ...store.reviews],
    };
    saveStoreAndSync(updatedStore);
    setReviewSubmitted(true);
    setTimeout(() => {
      setShowReviewModal(false);
      setReviewSubmitted(false);
    }, 1400);
  };

  const renderReviewModal = () => {
    if (!showReviewModal) return null;

    return (
      <>
        <div className="ov" onClick={() => setShowReviewModal(false)} />
        <div className="center-modal">
          {reviewSubmitted ? (
            <div className="tc" style={{ padding: '24px 0' }}>
              <div
                className="ok"
                style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '50%',
                  background: 'rgba(46, 158, 91, 0.12)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--ok)',
                  margin: '0 auto 12px',
                }}
              >
                <Icon name="check" size={32} />
              </div>
              <h3 style={{ margin: '0 0 6px', color: 'var(--tx)' }}>Thank You for Your Review!</h3>
              <p style={{ color: 'var(--mu)', margin: 0, fontSize: '14px' }}>
                Your feedback has been published to our customer reviews section.
              </p>
            </div>
          ) : (
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  marginBottom: '14px',
                }}
              >
                <div>
                  <h3 style={{ margin: 0, fontSize: '18px', color: 'var(--tx)' }}>
                    Share Your Feedback
                  </h3>
                  <p style={{ margin: '3px 0 0', fontSize: '13px', color: 'var(--mu)' }}>
                    Rate your ordering experience with Woodflame.
                  </p>
                </div>
                <button
                  onClick={() => setShowReviewModal(false)}
                  style={{
                    background: 'none',
                    border: 0,
                    color: 'var(--mu)',
                    cursor: 'pointer',
                    padding: 4,
                  }}
                  aria-label="Close"
                >
                  <Icon name="x" size={20} />
                </button>
              </div>

              {/* Interactive Star Rating */}
              <div style={{ margin: '14px 0 18px', textAlign: 'center' }}>
                <div style={{ display: 'inline-flex', gap: '8px' }}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setReviewRating(star)}
                      onMouseEnter={() => setReviewHover(star)}
                      onMouseLeave={() => setReviewHover(0)}
                      style={{
                        background: 'none',
                        border: 0,
                        padding: 3,
                        cursor: 'pointer',
                        color: star <= (reviewHover || reviewRating) ? '#f5a800' : 'var(--bd)',
                        transition: 'transform 0.1s ease',
                        transform: star <= (reviewHover || reviewRating) ? 'scale(1.15)' : 'scale(1)',
                      }}
                      title={`${star} Star${star > 1 ? 's' : ''}`}
                    >
                      <Icon name="star" size={28} />
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: '13px', color: 'var(--mu)', marginTop: '4px', fontWeight: 600 }}>
                  {reviewRating === 5 && '⭐⭐⭐⭐⭐ Highly Recommended'}
                  {reviewRating === 4 && '⭐⭐⭐⭐ Very Good'}
                  {reviewRating === 3 && '⭐⭐⭐ Average'}
                  {reviewRating === 2 && '⭐⭐ Fair'}
                  {reviewRating === 1 && '⭐ Poor'}
                </div>
              </div>

              <div className="two" style={{ marginBottom: '10px' }}>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--mu)' }}>Your Name</label>
                  <input
                    value={reviewName}
                    onChange={(e) => setReviewName(e.target.value)}
                    placeholder="e.g. Tariq Mahmood"
                  />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--mu)' }}>City</label>
                  <input
                    value={reviewCity}
                    onChange={(e) => setReviewCity(e.target.value)}
                    placeholder="e.g. Rawalpindi / Lahore"
                  />
                </div>
              </div>

              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--mu)' }}>
                Your Review / Thoughts
              </label>
              <textarea
                rows={3}
                value={reviewText}
                onChange={(e) => setReviewText(e.target.value)}
                placeholder="What made you choose Woodflame? How is your cooking or ordering experience so far?"
                style={{ width: '100%', marginBottom: '16px' }}
              />

              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn ol"
                  onClick={() => setShowReviewModal(false)}
                >
                  Skip for Now
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={handleReviewSubmit}
                >
                  <Icon name="check" size={16} /> Submit Review
                </button>
              </div>
            </div>
          )}
        </div>
      </>
    );
  };



  /* ----------------- ADMIN PANEL ----------------- */

  // Admin Dashboard tab
  const renderAdminDash = () => {
    const rev = store.orders
      .filter((o) => o.status !== 'Cancelled')
      .reduce((a, o) => a + o.total, 0);

    const st = [
      { i: 'pkg', val: store.products.length, label: 'Products' },
      { i: 'card', val: store.orders.length, label: 'Total orders' },
      { i: 'chart', val: fmt(rev), label: 'Revenue' },
      {
        i: 'refresh',
        val: store.orders.filter((o) => o.status === 'New').length,
        label: 'New orders',
      },
    ];

    return (
      <>
        <div className="stats">
          {st.map((s, idx) => (
            <div key={idx}>
              <Icon name={s.i} size={22} />
              <b>{s.val}</b>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
        <p className="hint" style={{ marginTop: '18px' }}>
          Manage everything from the tabs above: products, orders, the “In Action” gallery, customer reviews, and all store settings (hero, trust blocks, footer, contact, payment). Changes save automatically and show on the store immediately.
        </p>
      </>
    );
  };

  // Admin Products list & Edit form
  const renderAdminProducts = () => {
    if (editingProduct) {
      const e = editingProduct;

      const specsList: [string, string][] = Array.isArray(e.specs)
        ? (e.specs.filter((s: any) => Array.isArray(s) && s.length >= 2 && s[0] != null) as [string, string][])
        : [];

      const getSpec = (key: string) => {
        const found = specsList.find(
          ([k]) => typeof k === 'string' && k.trim().toLowerCase() === key.trim().toLowerCase()
        );
        return found ? found[1] : '';
      };

      const updateSpec = (key: string, val: string) => {
        const exists = specsList.some(
          ([k]) => typeof k === 'string' && k.trim().toLowerCase() === key.trim().toLowerCase()
        );
        let updated: [string, string][];
        if (exists) {
          if (!val.trim()) {
            updated = specsList.filter(
              ([k]) => typeof k === 'string' && k.trim().toLowerCase() !== key.trim().toLowerCase()
            );
          } else {
            updated = specsList.map(([k, v]) =>
              typeof k === 'string' && k.trim().toLowerCase() === key.trim().toLowerCase() ? [k, val] : [k, v]
            );
          }
        } else {
          if (val.trim()) {
            updated = [...specsList, [key, val]];
          } else {
            updated = specsList;
          }
        }
        setEditingProduct({ ...e, specs: updated });
      };

      const standardKeys = [
        'height',
        'pot support width',
        'burner size',
        'fuel inlet size',
        'material',
        'blower fan',
        'fuel compatibility',
        'weight',
      ];
      const customSpecs = e.specs.filter(
        ([k]) => !standardKeys.includes(k.trim().toLowerCase())
      );

      const addCustomSpec = () => {
        setEditingProduct({
          ...e,
          specs: [...e.specs, ['Extra Feature', '']],
        });
      };

      const updateCustomSpec = (customIdx: number, newKey: string, newVal: string) => {
        const target = customSpecs[customIdx];
        if (!target) return;
        const specIndex = e.specs.indexOf(target);
        if (specIndex !== -1) {
          const newSpecs = [...e.specs];
          newSpecs[specIndex] = [newKey, newVal];
          setEditingProduct({ ...e, specs: newSpecs });
        }
      };

      const removeCustomSpec = (customIdx: number) => {
        const target = customSpecs[customIdx];
        if (!target) return;
        const newSpecs = e.specs.filter((s) => s !== target);
        setEditingProduct({ ...e, specs: newSpecs });
      };

      return (
        <div className="box">
          <h3 style={{ marginTop: 0 }}>{e.isNew ? 'Add New' : 'Edit'} Product</h3>

          <label>Product Name</label>
          <input
            value={e.name}
            placeholder="e.g. Rocket Stove Standard"
            onChange={(ev) => setEditingProduct({ ...e, name: ev.target.value })}
          />

          <div className="two">
            <div>
              <label>Category</label>
              <select
                value={e.category || 'Domestic Stoves'}
                onChange={(ev) => setEditingProduct({ ...e, category: ev.target.value })}
              >
                <option value="Domestic Stoves">Domestic Stoves</option>
                <option value="Commercial Stoves">Commercial Stoves</option>
                <option value="Biomass Fuel & Pellets">Biomass Fuel & Pellets</option>
                <option value="Accessories">Accessories</option>
              </select>
            </div>
            <div>
              <label>Category Tag / Custom Name</label>
              <input
                value={e.category || 'Domestic Stoves'}
                onChange={(ev) => setEditingProduct({ ...e, category: ev.target.value })}
                placeholder="e.g. Domestic Stoves"
              />
            </div>
          </div>

          <div className="two">
            <div>
              <label>Selling Price (Rs.)</label>
              <input
                type="number"
                value={e.price}
                onChange={(ev) =>
                  setEditingProduct({ ...e, price: Number(ev.target.value) })
                }
              />
            </div>
            <div>
              <label>Original / Old Price (for Sale Badge)</label>
              <input
                type="number"
                value={e.compare}
                onChange={(ev) =>
                  setEditingProduct({ ...e, compare: Number(ev.target.value) })
                }
              />
            </div>
          </div>

          <div className="two">
            <div>
              <label>Customer Rating (1–5 Stars)</label>
              <input
                type="number"
                min="1"
                max="5"
                value={e.rating}
                onChange={(ev) =>
                  setEditingProduct({
                    ...e,
                    rating: Math.min(5, Math.max(1, Number(ev.target.value) || 5)),
                  })
                }
              />
            </div>
            <div>
              <label>Inventory Availability</label>
              <select
                value={e.stock ? '1' : '0'}
                onChange={(ev) =>
                  setEditingProduct({ ...e, stock: ev.target.value === '1' })
                }
              >
                <option value="1">In Stock (Available)</option>
                <option value="0">Out of Stock (Sold Out)</option>
              </select>
            </div>
          </div>

          <label>Product Description & Key Highlights</label>
          <textarea
            rows={5}
            value={e.desc}
            placeholder="Write product overview, highlights, bullet points..."
            onChange={(ev) => setEditingProduct({ ...e, desc: ev.target.value })}
          />

          {/* Easy Dimensions & Specifications Box */}
          <div className="spec-box">
            <div style={{ marginBottom: '14px' }}>
              <b style={{ color: 'var(--tx)', fontSize: '15px' }}>
                Product Dimensions &amp; Technical Specifications
              </b>
              <p style={{ margin: '3px 0 0', fontSize: '12.5px', color: 'var(--mu)' }}>
                Labels are pre-filled — simply type the size, height, and numbers below:
              </p>
            </div>

            <div className="spec-grid">
              <div className="spec-item">
                <label>Stove Height</label>
                <input
                  placeholder="e.g. 20 inch / 24 inch"
                  value={getSpec('Height')}
                  onChange={(ev) => updateSpec('Height', ev.target.value)}
                />
              </div>

              <div className="spec-item">
                <label>Pot Support Width</label>
                <input
                  placeholder="e.g. 10 inch / 14 inch"
                  value={getSpec('Pot Support Width')}
                  onChange={(ev) => updateSpec('Pot Support Width', ev.target.value)}
                />
              </div>

              <div className="spec-item">
                <label>Burner Size</label>
                <input
                  placeholder="e.g. 4 inch / 5.5 inch"
                  value={getSpec('Burner Size')}
                  onChange={(ev) => updateSpec('Burner Size', ev.target.value)}
                />
              </div>

              <div className="spec-item">
                <label>Fuel Inlet Size</label>
                <input
                  placeholder="e.g. 4 inch / 5.5 inch"
                  value={getSpec('Fuel Inlet Size')}
                  onChange={(ev) => updateSpec('Fuel Inlet Size', ev.target.value)}
                />
              </div>

              <div className="spec-item">
                <label>Material / Fabrication</label>
                <input
                  placeholder="e.g. Heavy-Grade Solid Iron"
                  value={getSpec('Material')}
                  onChange={(ev) => updateSpec('Material', ev.target.value)}
                />
              </div>

              <div className="spec-item">
                <label>Blower Fan & Electricity</label>
                <input
                  placeholder="e.g. 12V DC Variable Speed Fan"
                  value={getSpec('Blower Fan')}
                  onChange={(ev) => updateSpec('Blower Fan', ev.target.value)}
                />
              </div>

              <div className="spec-item">
                <label>Fuel Compatibility</label>
                <input
                  placeholder="e.g. Wood Pellets, Sawdust, Wood Sticks"
                  value={getSpec('Fuel Compatibility')}
                  onChange={(ev) => updateSpec('Fuel Compatibility', ev.target.value)}
                />
              </div>

              <div className="spec-item">
                <label>Weight / Capacity</label>
                <input
                  placeholder="e.g. 14 kg / 15 kg Bag"
                  value={getSpec('Weight')}
                  onChange={(ev) => updateSpec('Weight', ev.target.value)}
                />
              </div>
            </div>

            {/* Custom Extra Specs */}
            <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--bd)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--tx)' }}>
                  Extra Custom Specifications (Optional)
                </span>
                <button
                  type="button"
                  className="btn sm ol"
                  style={{ padding: '4px 10px', fontSize: '12px' }}
                  onClick={addCustomSpec}
                >
                  <Icon name="plus" size={14} /> Add Spec
                </button>
              </div>

              {customSpecs.map(([k, v], idx) => (
                <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center' }}>
                  <input
                    placeholder="Spec Name (e.g. Lifespan)"
                    value={k}
                    onChange={(ev) => updateCustomSpec(idx, ev.target.value, v)}
                    style={{ flex: 1, margin: 0 }}
                  />
                  <input
                    placeholder="Value (e.g. 10+ Years)"
                    value={v}
                    onChange={(ev) => updateCustomSpec(idx, k, ev.target.value)}
                    style={{ flex: 1.5, margin: 0 }}
                  />
                  <button
                    type="button"
                    onClick={() => removeCustomSpec(idx)}
                    style={{ background: 'none', border: 0, color: 'var(--bad)', cursor: 'pointer', padding: '6px' }}
                    title="Delete specification"
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <label>Product Images (first image is the main display cover)</label>
          {isUploading && (
            <div className="upload-badge">
              <span className="spinner" /> {uploadStatus || 'Uploading product images...'}
            </div>
          )}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '8px 0' }}>
            {Array.isArray(e.images) && e.images.length ? (
              e.images.map((x, i) => (
                <span key={i} className="ti">
                  <img src={x} alt="" />
                  <button
                    onClick={() => {
                      const updated = (e.images || []).filter((_, idx) => idx !== i);
                      setEditingProduct({ ...e, images: updated });
                    }}
                    aria-label="Remove"
                  >
                    <Icon name="x" size={13} />
                  </button>
                </span>
              ))
            ) : (
              <span className="hint">No images selected yet.</span>
            )}
          </div>

          <input
            type="file"
            accept="image/*"
            multiple
            disabled={isUploading}
            onChange={async (ev) => {
              if (ev.target.files && ev.target.files.length > 0) {
                setIsUploading(true);
                const newImgs = [...(Array.isArray(e.images) ? e.images : [])];
                for (const f of Array.from(ev.target.files)) {
                  const url = await uploadToImgBB(f);
                  newImgs.push(url);
                }
                setEditingProduct({ ...e, images: newImgs });
                setIsUploading(false);
              }
            }}
            style={{ marginTop: '8px' }}
          />

          <div className="row" style={{ marginTop: '18px' }}>
            <button
              className="btn"
              onClick={() => {
                if (!e.name.trim()) {
                  alert('Enter a product name.');
                  return;
                }
                const isNew = e.isNew;
                const clean = sanitizeProduct(e);
                delete (clean as any).isNew;

                const updatedProducts = isNew
                  ? [clean, ...store.products]
                  : store.products.map((p) => (p.id === clean.id ? clean : p));
                saveStoreAndSync({
                  ...store,
                  products: updatedProducts.map(sanitizeProduct),
                });
                setEditingProduct(null);
              }}
            >
              <Icon name="check" size={18} /> Save Product
            </button>
            <button className="btn ol" onClick={() => setEditingProduct(null)}>
              Cancel
            </button>
          </div>
        </div>
      );
    }

    return (
      <>
        <button
          className="btn"
          onClick={() =>
            setEditingProduct({
              id: 'p' + Date.now(),
              name: '',
              price: 8000,
              compare: 9500,
              stock: true,
              rating: 5,
              category: 'Domestic Stoves',
              images: [DEFAULT_PRODUCT_IMAGE],
              desc: '',
              specs: [
                ['Height', '20 inch'],
                ['Pot Support Width', '10 inch'],
                ['Burner Size', '4 inch'],
                ['Fuel Inlet Size', '4 inch'],
                ['Material', 'Heavy-Grade Iron Fabrication'],
                ['Blower Fan', '12V DC Variable Speed Fan (< 1 kWh for 6 days)'],
                ['Fuel Compatibility', 'Wood Pellets, Sawdust, Small Wood Scraps'],
              ],
              isNew: true,
            })
          }
        >
          <Icon name="plus" size={18} /> Add product
        </button>

        {store.products.map((p) => (
          <div key={p.id} className="li">
            <img src={(p.images && p.images[0]) || DEFAULT_PRODUCT_IMAGE} alt="" />
            <div>
              <b>{p.name}</b>
              <br />
              <span className="hint">
                {fmt(p.price)} · {p.stock ? 'In stock' : 'Out of stock'}
              </span>
            </div>
            <div className="ac">
              <button
                className="btn sm ol"
                onClick={() => setEditingProduct(sanitizeProduct(p))}
                aria-label="Edit"
              >
                <Icon name="edit" size={16} />
              </button>
              <button
                className="btn sm dg"
                onClick={() => {
                  if (confirm('Delete this product?')) {
                    saveStoreAndSync({
                      ...store,
                      products: store.products.filter((x) => x.id !== p.id),
                    });
                    setCart((prev) => prev.filter((x) => x.id !== p.id));
                  }
                }}
                aria-label="Delete"
              >
                <Icon name="trash" size={16} />
              </button>
            </div>
          </div>
        ))}
      </>
    );
  };

  // Admin Orders
  const renderAdminOrders = () => {
    if (!store.orders.length) {
      return <p className="tc">No orders yet.</p>;
    }

    return store.orders.map((o, idx) => (
      <div key={o.id} className="box">
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <b>{o.id}</b>
          <small className="hint">{o.date}</small>
        </div>
        <p style={{ margin: '8px 0', lineHeight: 1.6 }}>
          <b>{o.name}</b> ·{' '}
          <a href={`tel:${o.phone}`} style={{ textDecoration: 'underline' }}>
            {o.phone}
          </a>
          {o.email && (
            <>
              {' · '}
              <a href={`mailto:${o.email}`} style={{ textDecoration: 'underline' }}>
                {o.email}
              </a>
            </>
          )}
          <br />
          {o.address}
          <br />
          Payment: <b>{o.pay}</b> · Status: <span style={{ color: o.status === 'Cancelled' ? 'var(--bad)' : o.status === 'Delivered' ? 'var(--ok)' : 'var(--ac)', fontWeight: 700 }}>{o.status}</span>
        </p>
        {o.items.map((x, i) => (
          <div key={i} style={{ fontSize: '13.5px', color: 'var(--tx)' }}>
            • {x.name} × {x.q}
          </div>
        ))}
        <p style={{ margin: '8px 0 12px' }}>
          <b>Total: {fmt(o.total)}</b>
        </p>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            value={o.status}
            style={{ flex: 1, minWidth: '140px' }}
            onChange={(e) => {
              const updatedStatus = e.target.value as any;
              const updatedOrder: StoreOrder = { ...o, status: updatedStatus };
              saveStoreAndSync({
                ...store,
                orders: store.orders.map((ord, i) => (i === idx ? updatedOrder : ord)),
              });

              // WhatsApp Redirect on Status Change
              const cleanPhone = o.phone.replace(/[^0-9]/g, '');
              const msg = `Salam ${o.name}! Your Woodflame stove order ${o.id} status is updated to: *${updatedStatus}*. Total: Rs. ${Number(o.total).toLocaleString()}. Delivery Address: ${o.address}`;
              window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`, '_blank');
            }}
          >
            {['New', 'Confirmed', 'Shipped', 'Delivered', 'Cancelled'].map((s) => (
              <option key={s} value={s}>
                Status: {s}
              </option>
            ))}
          </select>

          <a
            href={`https://wa.me/${o.phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(`Assalam o Alaikum ${o.name}, your Woodflame stove order ${o.id} status is now: *${o.status}*. Total: Rs. ${Number(o.total).toLocaleString()}. Address: ${o.address}`)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: '#25D366', color: '#fff', border: 'none' }}
            title="Send WhatsApp update"
          >
            <Icon name="wa" size={15} /> WhatsApp
          </a>

          {o.email && (
            <a
              href={`mailto:${o.email}?subject=${encodeURIComponent(`Woodflame Order Status Updated #${o.id}`)}&body=${encodeURIComponent(`Salam ${o.name},\n\nYour order #${o.id} status is updated to: ${o.status}.\n\nTotal: Rs. ${o.total.toLocaleString()}\nDelivery Address: ${o.address}\n\nThank you for choosing Woodflame!`)}`}
              className="btn sm ol"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap' }}
              title="Open Email client"
            >
              <Icon name="mail" size={15} /> Send Email
            </a>
          )}

          <button
            className="btn sm dg"
            style={{ flex: 'none' }}
            onClick={() => {
              if (confirm('Delete order?')) {
                saveStoreAndSync({
                  ...store,
                  orders: store.orders.filter((_, i) => i !== idx),
                });
              }
            }}
            aria-label="Delete Order"
          >
            <Icon name="trash" size={16} />
          </button>
        </div>
      </div>
    ));
  };

  // Admin Gallery
  const renderAdminGallery = () => (
    <>
      <label>Add images to the “In Action” gallery</label>
      {isUploading && (
        <div className="upload-badge">
          <span className="spinner" /> {uploadStatus || 'Uploading gallery photos to ImgBB...'}
        </div>
      )}
      <input
        type="file"
        accept="image/*"
        multiple
        disabled={isUploading}
        onChange={async (e) => {
          if (e.target.files && e.target.files.length > 0) {
            setIsUploading(true);
            const newItems = [...store.gallery];
            for (const f of Array.from(e.target.files)) {
              const url = await uploadToImgBB(f);
              newItems.push({
                img: url,
                t: '',
              });
            }
            saveStoreAndSync({ ...store, gallery: newItems });
            setIsUploading(false);
          }
        }}
      />

      {store.gallery.length ? (
        store.gallery.map((g, i) => (
          <div key={i} className="li">
            <img src={g.img} alt="" />
            <div>
              <input
                value={g.t}
                placeholder="Caption"
                onChange={(e) => {
                  const val = e.target.value;
                  saveStoreAndSync({
                    ...store,
                    gallery: store.gallery.map((item, idx) =>
                      idx === i ? { ...item, t: val } : item
                    ),
                  });
                }}
              />
            </div>
            <button
              className="btn sm dg"
              onClick={() => {
                saveStoreAndSync({
                  ...store,
                  gallery: store.gallery.filter((_, idx) => idx !== i),
                });
              }}
            >
              <Icon name="trash" size={16} />
            </button>
          </div>
        ))
      ) : (
        <p className="tc">Gallery is empty (the section is hidden on the store).</p>
      )}
    </>
  );

  // Admin Reviews
  const renderAdminReviews = () => (
    <>
      <button
        className="btn"
        onClick={() => {
          saveStoreAndSync({
            ...store,
            reviews: [
              { n: 'Customer', r: 5, t: 'Great product and build quality!' },
              ...store.reviews,
            ],
          });
        }}
      >
        <Icon name="plus" size={18} /> Add review
      </button>

      {store.reviews.map((r, i) => (
        <div key={i} className="box">
          <div className="two">
            <input
              value={r.n}
              placeholder="Name"
              onChange={(e) => {
                const val = e.target.value;
                saveStoreAndSync({
                  ...store,
                  reviews: store.reviews.map((item, idx) =>
                    idx === i ? { ...item, n: val } : item
                  ),
                });
              }}
            />
            <select
              value={r.r}
              onChange={(e) => {
                const val = Number(e.target.value);
                saveStoreAndSync({
                  ...store,
                  reviews: store.reviews.map((item, idx) =>
                    idx === i ? { ...item, r: val } : item
                  ),
                });
              }}
            >
              {[5, 4, 3, 2, 1].map((num) => (
                <option key={num} value={num}>
                  {num} stars
                </option>
              ))}
            </select>
          </div>
          <textarea
            rows={3}
            style={{ marginTop: '8px' }}
            value={r.t}
            onChange={(e) => {
              const val = e.target.value;
              saveStoreAndSync({
                ...store,
                reviews: store.reviews.map((item, idx) =>
                  idx === i ? { ...item, t: val } : item
                ),
              });
            }}
          />
          <button
            className="btn sm dg"
            style={{ marginTop: '8px' }}
            onClick={() => {
              saveStoreAndSync({
                ...store,
                reviews: store.reviews.filter((_, idx) => idx !== i),
              });
            }}
          >
            <Icon name="trash" size={16} /> Delete
          </button>
        </div>
      ))}
    </>
  );

  // Dedicated Admin Sliders Tab
  const renderAdminSliders = () => {
    const s = store.settings;
    const currentSlides: HeroSlide[] =
      s.heroSlides && s.heroSlides.length > 0
        ? s.heroSlides
        : (DEFAULT_STORE_DATA.settings.heroSlides || []);

    const updateSlide = (index: number, updated: Partial<HeroSlide>) => {
      const copy = [...currentSlides];
      copy[index] = { ...copy[index], ...updated };
      saveStoreAndSync({
        ...store,
        settings: { ...store.settings, heroSlides: copy },
      });
    };

    const addSlide = () => {
      const newSlide: HeroSlide = {
        img: '/assets/aistudio/1792838643998_32bdd4b3.jpg',
        tag: 'Woodflame Innovation',
        t: 'Woodflame Rocket Stoves',
        d: 'Save 80% on fuel bills with heavy iron biomass stoves.',
        btn: 'Shop Now',
        position: 'bottom-left',
      };
      saveStoreAndSync({
        ...store,
        settings: { ...store.settings, heroSlides: [...currentSlides, newSlide] },
      });
    };

    const removeSlide = (index: number) => {
      if (currentSlides.length <= 1) {
        alert('At least one hero slide is required.');
        return;
      }
      saveStoreAndSync({
        ...store,
        settings: { ...store.settings, heroSlides: currentSlides.filter((_, i) => i !== index) },
      });
    };

    return (
      <div className="box">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <h3 className="h" style={{ margin: 0 }}>
              <Icon name="home" size={20} /> Manage Homepage Hero Sliders ({currentSlides.length})
            </h3>
            <p className="hint" style={{ margin: '4px 0 0' }}>
              Upload full-visibility banner photos. Text appears cleanly as an overlay on the lower side.
            </p>
          </div>
          <button type="button" className="btn sm" onClick={addSlide}>
            <Icon name="plus" size={15} /> Add New Slide
          </button>
        </div>

        {isUploading && (
          <div className="upload-badge">
            <span className="spinner" /> {uploadStatus || 'Uploading slide image to ImgBB...'}
          </div>
        )}

        {currentSlides.map((slide, idx) => (
          <div
            key={idx}
            style={{
              background: 'var(--bg2)',
              border: '1px solid var(--bd)',
              borderRadius: '12px',
              padding: '16px',
              marginBottom: '16px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <b style={{ fontSize: '15px', color: 'var(--tx)' }}>Slide #{idx + 1}</b>
              <button
                type="button"
                className="btn sm dg"
                onClick={() => removeSlide(idx)}
                style={{ padding: '4px 10px' }}
              >
                <Icon name="trash" size={15} /> Delete Slide
              </button>
            </div>

            <div className="two">
              <div>
                <label style={{ fontSize: '12px' }}>Badge / Tag</label>
                <input
                  value={slide.tag || ''}
                  placeholder="e.g. Pakistani Innovation"
                  onChange={(e) => updateSlide(idx, { tag: e.target.value })}
                />
              </div>
              <div>
                <label style={{ fontSize: '12px' }}>Button Label (optional)</label>
                <input
                  value={slide.btn || ''}
                  placeholder="e.g. Shop Now"
                  onChange={(e) => updateSlide(idx, { btn: e.target.value })}
                />
              </div>
            </div>

            <label style={{ fontSize: '12px' }}>Slide Title / Heading</label>
            <input
              value={slide.t || ''}
              placeholder="e.g. High-Efficiency Biomass Stoves"
              onChange={(e) => updateSlide(idx, { t: e.target.value })}
            />

            <label style={{ fontSize: '12px' }}>Short Subtitle / Description</label>
            <textarea
              rows={2}
              value={slide.d || ''}
              placeholder="e.g. Heavy-grade iron rocket stoves engineered to cut gas bills..."
              onChange={(e) => updateSlide(idx, { d: e.target.value })}
            />

            <label style={{ fontSize: '12px', marginTop: '8px' }}>Slide Background Photo</label>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '6px', flexWrap: 'wrap' }}>
              {slide.img && (
                <img
                  src={slide.img}
                  alt=""
                  style={{ width: '90px', height: '60px', objectFit: 'cover', borderRadius: '8px', border: '1px solid var(--bd)' }}
                />
              )}
              <div style={{ flex: 1, minWidth: '220px' }}>
                <input
                  type="file"
                  accept="image/*"
                  disabled={isUploading}
                  onChange={async (e) => {
                    if (e.target.files && e.target.files[0]) {
                      setIsUploading(true);
                      const url = await uploadToImgBB(e.target.files[0]);
                      updateSlide(idx, { img: url });
                      setIsUploading(false);
                    }
                  }}
                  style={{ margin: 0 }}
                />
                <input
                  value={slide.img || ''}
                  placeholder="Or paste direct image URL..."
                  onChange={(e) => updateSlide(idx, { img: e.target.value })}
                  style={{ marginTop: '6px' }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Clean & Simplified Admin Settings
  const renderAdminSettings = () => {
    const s = store.settings;
    const updateField = (key: keyof typeof s, value: any) => {
      const updated = {
        ...store,
        settings: { ...store.settings, [key]: value },
      };
      saveStoreAndSync(updated);
    };

    return (
      <>
        {/* Save Settings Top Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', background: 'var(--bg2)', padding: '12px 16px', borderRadius: '12px', border: '1px solid var(--bd)' }}>
          <div>
            <b style={{ fontSize: '16px' }}>Store Settings</b>
            <p className="hint" style={{ margin: 0 }}>All changes sync automatically to Firebase Realtime Database.</p>
          </div>
          <button
            type="button"
            className="btn sm"
            style={{ background: '#25d366', color: '#fff', border: 0, fontWeight: 700 }}
            disabled={isSavingCloud}
            onClick={() => saveStoreAndSync(store)}
          >
            <Icon name="check" size={16} /> {isSavingCloud ? 'Saving...' : 'Save Settings to Database'}
          </button>
        </div>

        {/* Website Custom Logo Management */}
        <div className="box">
          <h3 className="h" style={{ marginTop: 0 }}>
            <Icon name="img" size={20} /> Website Logo
          </h3>
          <p className="hint" style={{ marginTop: 0 }}>
            Upload your brand logo. It will appear cleanly in the header and footer.
          </p>

          {s.logoImg ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '12px', background: 'var(--bg2)', padding: '12px 14px', borderRadius: '10px' }}>
              <img
                src={s.logoImg}
                alt="Website Logo Preview"
                style={{ maxHeight: '44px', maxWidth: '160px', objectFit: 'contain' }}
              />
              <button
                type="button"
                className="btn sm dg"
                onClick={() => updateField('logoImg', '')}
              >
                <Icon name="trash" size={15} /> Remove Logo
              </button>
            </div>
          ) : (
            <p className="hint" style={{ fontStyle: 'italic', marginBottom: '8px' }}>
              No custom logo uploaded yet. Default Woodflame brand mark is currently displayed.
            </p>
          )}

          <label style={{ fontSize: '12px' }}>Upload Logo Image</label>
          <input
            type="file"
            accept="image/*"
            disabled={isUploading}
            onChange={async (e) => {
              if (e.target.files && e.target.files[0]) {
                setIsUploading(true);
                const url = await uploadToImgBB(e.target.files[0]);
                updateField('logoImg', url);
                setIsUploading(false);
              }
            }}
          />

          <label style={{ fontSize: '12px', marginTop: '8px' }}>Or Paste Direct Logo Image URL</label>
          <input
            value={s.logoImg || ''}
            placeholder="https://i.ibb.co/... or image URL"
            onChange={(e) => updateField('logoImg', e.target.value)}
          />
        </div>

        {/* Essential Store Details */}
        <div className="box">
          <h3 className="h" style={{ marginTop: 0 }}>
            <Icon name="home" size={20} /> Basic Store Details
          </h3>

          <label>Store Name</label>
          <input
            value={s.name}
            onChange={(e) => updateField('name', e.target.value)}
          />

          <label>Announcement Bar Text (top header)</label>
          <input
            value={s.bar}
            onChange={(e) => updateField('bar', e.target.value)}
          />

          <label>Store Support Phone Number</label>
          <input
            value={s.phone}
            onChange={(e) => updateField('phone', e.target.value)}
          />

          <label>WhatsApp Number (Country code digits)</label>
          <input
            value={s.wa}
            onChange={(e) => updateField('wa', e.target.value)}
          />
        </div>

        {/* Payment Account Details (Bank, Easypaisa, JazzCash) */}
        <div className="box">
          <h3 className="h" style={{ marginTop: 0 }}>
            <Icon name="card" size={20} /> Payment Accounts (Checkout Options)
          </h3>

          <label>Bank Transfer Details (Meezan Bank)</label>
          <textarea
            rows={3}
            value={s.bank}
            onChange={(e) => updateField('bank', e.target.value)}
          />

          <label>Easypaisa Account Details</label>
          <textarea
            rows={2}
            value={s.easypaisa || 'Easypaisa Account: 0304-6042333\nAccount Title: Ali (Woodflame)'}
            onChange={(e) => updateField('easypaisa', e.target.value)}
          />

          <label>JazzCash Account Details</label>
          <textarea
            rows={2}
            value={s.jazzcash || 'JazzCash Account: 0304-6042333\nAccount Title: Ali (Woodflame)'}
            onChange={(e) => updateField('jazzcash', e.target.value)}
          />
        </div>

        {/* Order Notification Email Address */}
        <div className="box">
          <h3 className="h" style={{ marginTop: 0 }}>
            <Icon name="mail" size={20} /> Order Notification Email Address
          </h3>
          <p className="hint" style={{ marginTop: 0 }}>
            When a customer places an order, full order notifications will be sent to this email address:
          </p>
          <label>Admin Email Address</label>
          <input
            type="email"
            value={s.email || 'woodflare91@gmail.com'}
            onChange={(e) => updateField('email', e.target.value)}
          />
        </div>

        {/* Action Videos Demonstration Management */}
        <div className="box">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 className="h" style={{ margin: 0 }}>
              <Icon name="yt" size={20} /> Action Videos (Stove Demonstrations)
            </h3>
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                const currentVids = s.actionVideos || DEFAULT_STORE_DATA.settings.actionVideos || [];
                const newVid: ActionVideo = {
                  id: 'v_' + Date.now(),
                  title: 'New High Efficiency Stove Demonstration',
                  videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
                  desc: 'High-power forced air combustion demonstration.'
                };
                updateField('actionVideos', [...currentVids, newVid]);
              }}
            >
              <Icon name="plus" size={15} /> Add Action Video
            </button>
          </div>

          {(s.actionVideos || DEFAULT_STORE_DATA.settings.actionVideos || []).map((vid, vIdx) => (
            <div
              key={vid.id || vIdx}
              style={{
                background: 'var(--bg2)',
                border: '1px solid var(--bd)',
                borderRadius: '10px',
                padding: '14px',
                marginBottom: '12px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <b>Video #{vIdx + 1}</b>
                <button
                  type="button"
                  className="btn sm dg"
                  onClick={() => {
                    const currentVids = s.actionVideos || DEFAULT_STORE_DATA.settings.actionVideos || [];
                    updateField('actionVideos', currentVids.filter((_, i) => i !== vIdx));
                  }}
                >
                  <Icon name="trash" size={14} /> Remove
                </button>
              </div>

              <label style={{ fontSize: '12px' }}>Video Title</label>
              <input
                value={vid.title}
                onChange={(e) => {
                  const currentVids = [...(s.actionVideos || DEFAULT_STORE_DATA.settings.actionVideos || [])];
                  currentVids[vIdx] = { ...currentVids[vIdx], title: e.target.value };
                  updateField('actionVideos', currentVids);
                }}
              />

              <label style={{ fontSize: '12px', marginTop: '6px' }}>YouTube Embed URL</label>
              <input
                value={vid.videoUrl}
                placeholder="https://www.youtube.com/embed/..."
                onChange={(e) => {
                  const currentVids = [...(s.actionVideos || DEFAULT_STORE_DATA.settings.actionVideos || [])];
                  currentVids[vIdx] = { ...currentVids[vIdx], videoUrl: e.target.value };
                  updateField('actionVideos', currentVids);
                }}
              />

              <label style={{ fontSize: '12px', marginTop: '6px' }}>Description</label>
              <input
                value={vid.desc || ''}
                onChange={(e) => {
                  const currentVids = [...(s.actionVideos || DEFAULT_STORE_DATA.settings.actionVideos || [])];
                  currentVids[vIdx] = { ...currentVids[vIdx], desc: e.target.value };
                  updateField('actionVideos', currentVids);
                }}
              />
            </div>
          ))}
        </div>

        {/* Bottom Save Action Button */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
          <button
            type="button"
            className="btn"
            style={{ background: '#25d366', color: '#fff', padding: '12px 28px', fontSize: '15px' }}
            disabled={isSavingCloud}
            onClick={() => saveStoreAndSync(store)}
          >
            <Icon name="check" size={18} /> {isSavingCloud ? 'Saving to Database...' : 'Save All Settings to Cloud Database'}
          </button>
        </div>
      </>
    );
  };

  // Customer Account, Sign In, Sign Up & Profile View
  const renderAccount = () => {
    // Handle Sign In Submission with Firebase Authentication
    const handleSignIn = async (e: React.FormEvent) => {
      e.preventDefault();
      setAuthError('');
      const email = loginEmailInput.trim().toLowerCase();
      const pass = loginPasswordInput.trim();

      if (!email) {
        setAuthError('Please enter your Email address.');
        return;
      }
      if (!pass) {
        setAuthError('Please enter your Password.');
        return;
      }

      try {
        const { firebaseUser } = await loginWithFirebaseAuth(email, pass);
        let found = registeredUsers.find((u) => u.email.toLowerCase() === email);
        const isAdminRole = email === 'woodflare91@gmail.com' || email === 'woodflame91@gmail.com';

        if (!found) {
          found = {
            id: firebaseUser.uid,
            name: firebaseUser.displayName || email.split('@')[0],
            email: email,
            phone: '03046042333',
            password: pass,
            role: isAdminRole ? 'admin' : 'customer',
          };
          setRegisteredUsers((prev) => [...prev, found!]);
          saveUserToFirebase(found!);
        } else {
          found = { ...found, password: pass };
          setRegisteredUsers((prev) =>
            prev.map((u) => (u.email.toLowerCase() === email ? found! : u))
          );
        }

        setAuthUser(found);

        if (checkIsAdmin(found)) {
          setPage('admin');
          setAdminTab('dash');
        }
      } catch (err: any) {
        console.warn('Firebase login attempt:', err);
        let found = registeredUsers.find((u) => u.email.toLowerCase() === email);
        if (found && found.password && found.password === pass) {
          setAuthUser(found);
          if (checkIsAdmin(found)) {
            setPage('admin');
            setAdminTab('dash');
          }
          return;
        }

        const msg =
          err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-email'
            ? 'Incorrect password. Please enter your valid registered account password.'
            : err.code === 'auth/user-not-found'
            ? 'No account found with this email. Please switch to "Create Account" tab.'
            : 'Sign in failed: Please enter your correct email and password.';
        setAuthError(msg);
      }
    };

    // Handle Sign Up Submission with Firebase Authentication
    const handleSignUp = async (e: React.FormEvent) => {
      e.preventDefault();
      setAuthError('');

      if (!signupName.trim()) {
        setAuthError('Please enter your full name.');
        return;
      }
      if (!signupPhone.trim()) {
        setAuthError('Please enter your mobile phone number.');
        return;
      }
      if (!signupEmail.trim()) {
        setAuthError('Please enter your email address.');
        return;
      }
      if (!signupPassword.trim()) {
        setAuthError('Please enter a password.');
        return;
      }
      if (signupPassword.length < 6) {
        setAuthError('Password must be at least 6 characters long.');
        return;
      }
      if (signupPassword !== signupConfirmPassword) {
        setAuthError('Passwords do not match. Please re-enter your password.');
        return;
      }

      const cleanEmail = signupEmail.trim().toLowerCase();
      const storeEmail = (store.settings.email || '').toLowerCase().trim();
      const isAdminRole =
        cleanEmail === 'woodflame91@gmail.com' ||
        cleanEmail === 'woodflare91@gmail.com' ||
        (storeEmail !== '' && cleanEmail === storeEmail);

      try {
        const { userAccount } = await registerWithFirebaseAuth(
          cleanEmail,
          signupPassword.trim(),
          signupName.trim(),
          signupPhone.trim(),
          isAdminRole ? 'admin' : 'customer'
        );

        setRegisteredUsers((prev) => {
          const filtered = prev.filter((u) => u.email.toLowerCase() !== cleanEmail);
          return [...filtered, userAccount];
        });
        setAuthUser(userAccount);

        setPhone(userAccount.phone || '');
        setFirstName(userAccount.name ? userAccount.name.split(' ')[0] : '');
        setLastName(userAccount.name ? userAccount.name.split(' ').slice(1).join(' ') : '');
        setCustomerEmail(userAccount.email || '');

        if (isAdminRole) {
          setPage('admin');
          setAdminTab('dash');
        }
      } catch (err: any) {
        console.warn('Firebase signup attempt:', err);
        if (err.code === 'auth/email-already-in-use') {
          // If already in Firebase Auth, try logging in
          try {
            const { firebaseUser } = await loginWithFirebaseAuth(cleanEmail, signupPassword.trim());
            const userAccount: UserAccount = {
              id: firebaseUser.uid,
              name: signupName.trim(),
              email: cleanEmail,
              phone: signupPhone.trim(),
              password: signupPassword.trim(),
              role: isAdminRole ? 'admin' : 'customer',
              createdAt: new Date().toISOString(),
            };
            setRegisteredUsers((prev) => [...prev, userAccount]);
            setAuthUser(userAccount);
            saveUserToFirebase(userAccount);
            if (isAdminRole) {
              setPage('admin');
              setAdminTab('dash');
            }
            return;
          } catch {
            setAuthError('An account with this email already exists in Firebase Authentication. Please switch to the "Sign In" tab.');
            setAuthTab('login');
            setLoginEmailInput(cleanEmail);
            return;
          }
        }
        setAuthError('Registration failed: ' + (err.message || 'Please check your details.'));
      }
    };

    const handleLogout = () => {
      logoutFirebaseAuth();
      setAuthUser(null);
      setPhone('');
      setCustomerEmail('');
      setFirstName('');
      setLastName('');
      setAddress('');
      setCity('');
      setPostalCode('');
      localStorage.removeItem('auth_user');
    };

    const myOrders = authUser
      ? store.orders.filter(
          (o) =>
            o.phone.replaceAll(/[^0-9]/g, '') === authUser.phone.replaceAll(/[^0-9]/g, '') ||
            (authUser.email && o.email && o.email.toLowerCase() === authUser.email.toLowerCase())
        )
      : [];

    return (
      <div className="w" style={{ padding: '28px 16px 60px', maxWidth: '800px', margin: '0 auto' }}>
        <h1 style={{ fontSize: 'clamp(24px, 4vw, 32px)', margin: '0 0 6px', letterSpacing: '-0.5px' }}>
          {authUser ? `Welcome, ${authUser.name}` : 'Customer Account Login & Registration'}
        </h1>
        <p style={{ color: 'var(--mu)', margin: '0 0 24px', fontSize: '14.5px' }}>
          {authUser ? 'Manage your account details and view your order history.' : 'Sign in to your account or create a new account.'}
        </p>

        {authUser ? (
          <div>
            {/* User Profile Header Card */}
            <div className="box" style={{ background: 'var(--bg2)', borderRadius: '16px', border: '1px solid var(--bd)', marginBottom: '20px', padding: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <div
                    style={{
                      width: '56px',
                      height: '56px',
                      borderRadius: '50%',
                      background: 'var(--ac)',
                      color: '#000',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '22px',
                      fontWeight: 800,
                      boxShadow: '0 4px 12px rgba(245, 168, 0, 0.3)',
                    }}
                  >
                    {authUser?.name ? authUser.name.split(' ').filter(Boolean).map((n) => n[0]).join('').slice(0, 2).toUpperCase() : 'WF'}
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <h2 style={{ margin: 0, fontSize: '20px', color: 'var(--tx)' }}>{authUser.name}</h2>
                      {checkIsAdmin(authUser) ? (
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            padding: '3px 10px',
                            borderRadius: '12px',
                            background: 'rgba(245, 168, 0, 0.2)',
                            color: 'var(--ac)',
                            border: '1px solid rgba(245, 168, 0, 0.4)',
                          }}
                        >
                          ● Store Admin
                        </span>
                      ) : (
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            padding: '3px 10px',
                            borderRadius: '12px',
                            background: 'rgba(46, 158, 91, 0.15)',
                            color: 'var(--ok)',
                            border: '1px solid rgba(46, 158, 91, 0.3)',
                          }}
                        >
                          ● Verified Account
                        </span>
                      )}
                    </div>
                    <p style={{ margin: '4px 0 0', fontSize: '13.5px', color: 'var(--mu)' }}>
                      Firebase Authenticated · <b>{authUser.email}</b>
                    </p>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  {checkIsAdmin(authUser) && (
                    <button type="button" className="btn sm" onClick={() => go('admin')}>
                      <Icon name="cog" size={15} /> Open Admin Panel
                    </button>
                  )}
                  <button type="button" className="btn sm dg" onClick={handleLogout}>
                    Sign Out
                  </button>
                </div>
              </div>

              {/* Account Quick Stats Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: '12px',
                  marginTop: '18px',
                  paddingTop: '16px',
                  borderTop: '1px solid var(--bd)',
                }}
              >
                <div style={{ background: 'var(--bg)', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--bd)' }}>
                  <div style={{ fontSize: '11.5px', color: 'var(--mu)', textTransform: 'uppercase', fontWeight: 600 }}>Total Orders</div>
                  <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--tx)', marginTop: '2px' }}>{myOrders.length} Placed</div>
                </div>
                <div style={{ background: 'var(--bg)', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--bd)' }}>
                  <div style={{ fontSize: '11.5px', color: 'var(--mu)', textTransform: 'uppercase', fontWeight: 600 }}>Mobile Number</div>
                  <div style={{ fontSize: '14.5px', fontWeight: 700, color: 'var(--tx)', marginTop: '2px' }}>{authUser.phone || 'Not set'}</div>
                </div>
                <div style={{ background: 'var(--bg)', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--bd)' }}>
                  <div style={{ fontSize: '11.5px', color: 'var(--mu)', textTransform: 'uppercase', fontWeight: 600 }}>Saved Address</div>
                  <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--tx)', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {authUser.address ? `${authUser.address}${authUser.city ? ', ' + authUser.city : ''}` : 'No address saved yet'}
                  </div>
                </div>
              </div>
            </div>

            {/* Profile Navigation Tabs */}
            <div className="box">
              <h3 style={{ margin: '0 0 16px', color: 'var(--tx)', fontSize: '18px' }}>
                My Order History &amp; Status
              </h3>

              {myOrders.length > 0 ? (
                myOrders.map((ord) => (
                  <div
                    key={ord.id}
                    style={{
                      background: 'var(--bg2)',
                      border: '1px solid var(--bd)',
                      borderRadius: '12px',
                      padding: '16px',
                      marginBottom: '14px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
                      <div>
                        <b style={{ fontSize: '16px', color: 'var(--tx)' }}>Order {ord.id}</b>
                        <span style={{ fontSize: '12.5px', color: 'var(--mu)', marginLeft: '10px' }}>{ord.date}</span>
                      </div>
                      <span
                        style={{
                          padding: '4px 12px',
                          borderRadius: '999px',
                          fontSize: '12px',
                          fontWeight: 700,
                          background:
                            ord.status === 'Delivered'
                              ? 'rgba(46, 158, 91, 0.15)'
                              : ord.status === 'Cancelled'
                              ? 'rgba(211, 47, 47, 0.15)'
                              : 'rgba(245, 168, 0, 0.18)',
                          color:
                            ord.status === 'Delivered'
                              ? 'var(--ok)'
                              : ord.status === 'Cancelled'
                              ? 'var(--bad)'
                              : 'var(--ac)',
                        }}
                      >
                        ● {ord.status.toUpperCase()}
                      </span>
                    </div>

                    <p style={{ fontSize: '13.5px', color: 'var(--mu)', margin: '0 0 12px', lineHeight: 1.5 }}>
                      Payment Method: <b>{ord.pay}</b> · Address: <b>{ord.address}</b>
                    </p>

                    <div style={{ borderTop: '1px solid var(--bd)', paddingTop: '10px', marginTop: '12px' }}>
                      <b>Items:</b>
                      {ord.items.map((it, i) => (
                        <div key={i} style={{ fontSize: '13.5px', color: 'var(--tx)', marginTop: '3px' }}>
                          • {it.name} × {it.q} — {fmt(it.price * it.q)}
                        </div>
                      ))}
                      <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <b style={{ fontSize: '16px' }}>Total Amount: {fmt(ord.total)}</b>
                        <a
                          href={`https://wa.me/923046042333?text=${encodeURIComponent(`Salam Woodflame support, I want to query about my order ${ord.id}`)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn sm"
                          style={{ background: '#25D366', color: '#fff', border: 0 }}
                        >
                          <Icon name="wa" size={14} /> WhatsApp Support
                        </a>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ textAlign: 'center', padding: '30px 16px', background: 'var(--bg2)', borderRadius: '12px', border: '1px solid var(--bd)' }}>
                  <Icon name="pkg" size={40} />
                  <p className="hint" style={{ marginTop: '10px' }}>
                    You have not placed any orders yet. Browse our stove catalog and place your first order!
                  </p>
                  <button className="btn sm" style={{ marginTop: '8px' }} onClick={() => go('shop')}>
                    Explore Stoves &amp; Accessories
                  </button>
                </div>
              )}

              {/* Profile & Address Information Form */}
              <div style={{ marginTop: '30px', paddingTop: '20px', borderTop: '2px solid var(--bd)' }}>
                <h3 style={{ margin: '0 0 6px', color: 'var(--tx)', fontSize: '18px' }}>
                  Update Profile &amp; Shipping Address
                </h3>
                <p style={{ margin: '0 0 16px', fontSize: '13.5px', color: 'var(--mu)' }}>
                  Keep your details updated for faster checkout and order notifications.
                </p>

                {profileMsg && (
                  <div
                    style={{
                      background: 'rgba(46, 158, 91, 0.15)',
                      border: '1px solid var(--ok)',
                      color: 'var(--ok)',
                      borderRadius: '8px',
                      padding: '10px 14px',
                      fontSize: '13.5px',
                      fontWeight: 600,
                      marginBottom: '16px',
                    }}
                  >
                    ✓ {profileMsg}
                  </div>
                )}

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!authUser) return;
                    const updated: UserAccount = {
                      ...authUser,
                      name: phone ? firstName + ' ' + lastName : authUser.name,
                      phone: phone || authUser.phone,
                      email: customerEmail || authUser.email,
                      address: address || authUser.address,
                      city: city || authUser.city,
                    };
                    setAuthUser(updated);
                    setRegisteredUsers((prev) =>
                      prev.map((u) => (u.id === updated.id || u.email.toLowerCase() === updated.email.toLowerCase() ? updated : u))
                    );
                    saveUserToFirebase(updated);
                    setProfileMsg('Profile updated successfully in Firebase Database!');
                    setTimeout(() => setProfileMsg(''), 4000);
                  }}
                  style={{ display: 'grid', gap: '14px' }}
                >
                  <div className="two">
                    <div>
                      <label>First Name</label>
                      <input
                        value={firstName}
                        placeholder="e.g. Ali"
                        onChange={(e) => setFirstName(e.target.value)}
                      />
                    </div>
                    <div>
                      <label>Last Name</label>
                      <input
                        value={lastName}
                        placeholder="e.g. Ahmed"
                        onChange={(e) => setLastName(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="two">
                    <div>
                      <label>Mobile Phone / WhatsApp Number</label>
                      <input
                        value={phone}
                        placeholder="e.g. 03046042333"
                        onChange={(e) => setPhone(e.target.value)}
                      />
                    </div>
                    <div>
                      <label>Email Address</label>
                      <input
                        type="email"
                        value={customerEmail}
                        placeholder="e.g. name@example.com"
                        onChange={(e) => setCustomerEmail(e.target.value)}
                      />
                    </div>
                  </div>

                  <div>
                    <label>Default Shipping / Delivery Street Address</label>
                    <textarea
                      rows={2}
                      value={address}
                      placeholder="e.g. House #123, Street 4, Sector G-8/1, Islamabad"
                      onChange={(e) => setAddress(e.target.value)}
                    />
                  </div>

                  <div>
                    <label>City</label>
                    <input
                      value={city}
                      placeholder="e.g. Islamabad / Lahore / Karachi"
                      onChange={(e) => setCity(e.target.value)}
                    />
                  </div>

                  <button type="submit" className="btn" style={{ marginTop: '8px', width: 'fit-content' }}>
                    <Icon name="check" size={17} /> Save Profile Changes
                  </button>
                </form>
              </div>
            </div>
          </div>
        ) : (
          <div className="box">
            {/* Clean Tab switcher: Sign In vs Create Account */}
            <div
              style={{
                display: 'flex',
                borderBottom: '2px solid var(--bd)',
                marginBottom: '20px',
                gap: '20px',
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setAuthTab('login');
                  setAuthError('');
                }}
                style={{
                  padding: '10px 16px',
                  background: 'none',
                  border: 'none',
                  fontWeight: 700,
                  fontSize: '16px',
                  color: authTab === 'login' ? 'var(--ac)' : 'var(--mu)',
                  borderBottom: authTab === 'login' ? '3px solid var(--ac)' : 'none',
                  marginBottom: '-2px',
                  cursor: 'pointer',
                }}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthTab('signup');
                  setAuthError('');
                }}
                style={{
                  padding: '10px 16px',
                  background: 'none',
                  border: 'none',
                  fontWeight: 700,
                  fontSize: '16px',
                  color: authTab === 'signup' ? 'var(--ac)' : 'var(--mu)',
                  borderBottom: authTab === 'signup' ? '3px solid var(--ac)' : 'none',
                  marginBottom: '-2px',
                  cursor: 'pointer',
                }}
              >
                Create Account
              </button>
            </div>

            {authError && (
              <div
                style={{
                  background: 'rgba(211, 47, 47, 0.12)',
                  border: '1px solid var(--bad)',
                  color: 'var(--bad)',
                  borderRadius: '8px',
                  padding: '12px 14px',
                  fontSize: '13.5px',
                  fontWeight: 600,
                  marginBottom: '16px',
                  lineHeight: 1.4,
                }}
              >
                ⚠ {authError}
              </div>
            )}

            {authTab === 'login' ? (
              <form onSubmit={handleSignIn} style={{ display: 'grid', gap: '14px' }}>
                <div>
                  <label>Email Address *</label>
                  <input
                    type="email"
                    placeholder="e.g. name@example.com"
                    value={loginEmailInput}
                    onChange={(e) => {
                      setLoginEmailInput(e.target.value);
                      setAuthError('');
                    }}
                    required
                  />
                </div>

                <div>
                  <label>Password *</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showLoginPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      value={loginPasswordInput}
                      onChange={(e) => {
                        setLoginPasswordInput(e.target.value);
                        setAuthError('');
                      }}
                      style={{ paddingRight: '42px' }}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowLoginPassword(!showLoginPassword)}
                      aria-label={showLoginPassword ? "Hide password" : "Show password"}
                      style={{
                        position: 'absolute',
                        right: '12px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'none',
                        border: 'none',
                        color: 'var(--mu)',
                        cursor: 'pointer',
                        padding: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Icon name={showLoginPassword ? 'eyeOff' : 'eye'} size={18} />
                    </button>
                  </div>
                </div>

                <button type="submit" className="btn full" style={{ marginTop: '6px' }}>
                  Sign In
                </button>
              </form>
            ) : (
              <form onSubmit={handleSignUp} style={{ display: 'grid', gap: '14px' }}>
                <div>
                  <label>Full Name *</label>
                  <input
                    placeholder="e.g. Ali Ahmed"
                    value={signupName}
                    onChange={(e) => setSignupName(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <label>Mobile / WhatsApp Number *</label>
                  <input
                    type="tel"
                    placeholder="e.g. 03046042333"
                    value={signupPhone}
                    onChange={(e) => setSignupPhone(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <label>Email Address *</label>
                  <input
                    type="email"
                    placeholder="e.g. name@example.com"
                    value={signupEmail}
                    onChange={(e) => setSignupEmail(e.target.value)}
                    required
                  />
                </div>

                <div className="two">
                  <div>
                    <label>Password *</label>
                    <div style={{ position: 'relative' }}>
                      <input
                        type={showSignupPassword ? 'text' : 'password'}
                        placeholder="At least 6 characters"
                        value={signupPassword}
                        onChange={(e) => setSignupPassword(e.target.value)}
                        style={{ paddingRight: '42px' }}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowSignupPassword(!showSignupPassword)}
                        aria-label={showSignupPassword ? "Hide password" : "Show password"}
                        style={{
                          position: 'absolute',
                          right: '12px',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'none',
                          border: 'none',
                          color: 'var(--mu)',
                          cursor: 'pointer',
                          padding: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Icon name={showSignupPassword ? 'eyeOff' : 'eye'} size={18} />
                      </button>
                    </div>
                  </div>
                  <div>
                    <label>Confirm Password *</label>
                    <div style={{ position: 'relative' }}>
                      <input
                        type={showSignupConfirmPassword ? 'text' : 'password'}
                        placeholder="Repeat password"
                        value={signupConfirmPassword}
                        onChange={(e) => setSignupConfirmPassword(e.target.value)}
                        style={{ paddingRight: '42px' }}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowSignupConfirmPassword(!showSignupConfirmPassword)}
                        aria-label={showSignupConfirmPassword ? "Hide password" : "Show password"}
                        style={{
                          position: 'absolute',
                          right: '12px',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'none',
                          border: 'none',
                          color: 'var(--mu)',
                          cursor: 'pointer',
                          padding: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Icon name={showSignupConfirmPassword ? 'eyeOff' : 'eye'} size={18} />
                      </button>
                    </div>
                  </div>
                </div>

                <button type="submit" className="btn full" style={{ marginTop: '6px' }}>
                  Create Account
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    );
  };

  // Dedicated Live Order Tracking View
  const renderTracking = () => {
    const handleSearchTrack = (e: React.FormEvent) => {
      e.preventDefault();
      if (!trackQuery.trim()) return;
      const q = trackQuery.trim().toLowerCase();
      const matched = store.orders.filter(
        (o) =>
          o.id.toLowerCase().includes(q) ||
          o.phone.replaceAll(/[^0-9]/g, '').includes(q.replaceAll(/[^0-9]/g, '')) ||
          (o.email && o.email.toLowerCase().includes(q))
      );
      setTrackResult(matched);
      setTrackSearched(true);
    };

    let displayedOrders: StoreOrder[] = [];
    if (trackSearched && trackResult) {
      displayedOrders = trackResult;
    } else if (authUser) {
      const uEmail = (authUser.email || '').toLowerCase().trim();
      const uPhone = (authUser.phone || '').replaceAll(/[^0-9]/g, '');
      displayedOrders = store.orders.filter((o) => {
        const oPhone = (o.phone || '').replaceAll(/[^0-9]/g, '');
        const oEmail = (o.email || '').toLowerCase().trim();
        return (
          (uPhone && oPhone && (oPhone.includes(uPhone) || uPhone.includes(oPhone))) ||
          (uEmail && oEmail && oEmail === uEmail)
        );
      });
    } else if (lastOrder) {
      displayedOrders = [lastOrder];
    }

    return (
      <div className="w" style={{ padding: '36px 16px 60px', maxWidth: '800px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <h1 style={{ fontSize: 'clamp(26px, 4vw, 34px)', margin: '0 0 8px', letterSpacing: '-0.5px' }}>
            <Icon name="truck" size={32} /> Track Your Order Status Live
          </h1>
          <p style={{ color: 'var(--mu)', margin: 0, fontSize: '15px' }}>
            Enter your Order ID (e.g. #1003) or registered mobile phone number below to view live order progress.
          </p>
        </div>

        {/* Live Order Tracking Box */}
        <div className="box" style={{ background: 'var(--bg2)', padding: '24px', borderRadius: '16px' }}>
          <form onSubmit={handleSearchTrack} style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '20px' }}>
            <input
              type="text"
              value={trackQuery}
              onChange={(e) => {
                setTrackQuery(e.target.value);
                if (!e.target.value.trim()) {
                  setTrackSearched(false);
                  setTrackResult(null);
                }
              }}
              placeholder="Search by Order ID (#1001) or Phone Number (0304...)"
              style={{ flex: 1, minWidth: '220px', margin: 0, padding: '12px 14px', fontSize: '15px' }}
            />
            <button type="submit" className="btn" style={{ flexShrink: 0, padding: '12px 24px', fontSize: '15px' }}>
              <Icon name="search" size={18} /> Search
            </button>
            {trackSearched && (
              <button
                type="button"
                className="btn ol"
                onClick={() => {
                  setTrackQuery('');
                  setTrackSearched(false);
                  setTrackResult(null);
                }}
                style={{ padding: '12px 16px' }}
              >
                Reset
              </button>
            )}
          </form>

          <div style={{ marginTop: '10px' }}>
            {displayedOrders && displayedOrders.length > 0 ? (
              displayedOrders.map((ord) => (
                <div
                  key={ord.id}
                  style={{
                    background: 'var(--bg)',
                    border: '1px solid var(--bd)',
                    borderRadius: '12px',
                    padding: '18px',
                    marginBottom: '16px',
                  }}
                >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
                      <div>
                        <b style={{ fontSize: '18px', color: 'var(--tx)' }}>Order {ord.id}</b>
                        <span style={{ fontSize: '13px', color: 'var(--mu)', marginLeft: '10px' }}>Placed on: {ord.date}</span>
                      </div>
                      <span
                        style={{
                          padding: '4px 12px',
                          borderRadius: '999px',
                          fontSize: '12.5px',
                          fontWeight: 700,
                          background:
                            ord.status === 'Delivered'
                              ? 'rgba(46, 158, 91, 0.15)'
                              : ord.status === 'Cancelled'
                              ? 'rgba(211, 47, 47, 0.15)'
                              : 'rgba(245, 168, 0, 0.18)',
                          color:
                            ord.status === 'Delivered'
                              ? 'var(--ok)'
                              : ord.status === 'Cancelled'
                              ? 'var(--bad)'
                              : 'var(--ac)',
                        }}
                      >
                        ● Status: {ord.status.toUpperCase()}
                      </span>
                    </div>

                    <p style={{ fontSize: '14px', color: 'var(--mu)', margin: '0 0 14px', lineHeight: 1.6 }}>
                      Customer Name: <b>{ord.name}</b> · Mobile: <b>{ord.phone}</b>
                      <br />
                      Payment Method: <b>{ord.pay}</b> · Address: <b>{ord.address}</b>
                    </p>

                    {/* Timeline steps */}
                    <div style={{ background: 'var(--bg2)', padding: '16px', borderRadius: '10px', border: '1px solid var(--bd)', margin: '14px 0' }}>
                      <div style={{ fontSize: '12.5px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--tx)', marginBottom: '12px' }}>
                        Live Progress &amp; Fulfillment Stage:
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', position: 'relative' }}>
                        {['New', 'Confirmed', 'Shipped', 'Delivered'].map((step, idx) => {
                          const steps = ['New', 'Confirmed', 'Shipped', 'Delivered'];
                          const currentIdx = steps.indexOf(ord.status);
                          const isDone = currentIdx >= idx && ord.status !== 'Cancelled';
                          return (
                            <div key={step} style={{ textAlign: 'center', flex: 1 }}>
                              <div
                                style={{
                                  width: '24px',
                                  height: '24px',
                                  borderRadius: '50%',
                                  background: isDone ? 'var(--ok)' : 'var(--bd)',
                                  color: isDone ? '#fff' : 'var(--mu)',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: '12px',
                                  fontWeight: 700,
                                  margin: '0 auto',
                                }}
                              >
                                {isDone ? '✓' : idx + 1}
                              </div>
                              <div style={{ fontSize: '12px', fontWeight: isDone ? 700 : 400, marginTop: '6px', color: isDone ? 'var(--tx)' : 'var(--mu)' }}>
                                {step}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div style={{ borderTop: '1px solid var(--bd)', paddingTop: '12px', marginTop: '12px' }}>
                      <b>Ordered Items ({ord.items.length}):</b>
                      {ord.items.map((it, i) => (
                        <div key={i} style={{ fontSize: '13.5px', color: 'var(--tx)', marginTop: '4px' }}>
                          • {it.name} (Qty: {it.q}) — {fmt(it.price * it.q)}
                        </div>
                      ))}
                      <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                        <b style={{ fontSize: '17px' }}>Total Amount: {fmt(ord.total)}</b>
                        <a
                          href={`https://wa.me/923046042333?text=${encodeURIComponent(`Salam Woodflame support, I want to query about my order ${ord.id} (${ord.name})`)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn sm"
                          style={{ background: '#25D366', color: '#fff', border: 0, padding: '8px 16px' }}
                        >
                          <Icon name="wa" size={16} /> WhatsApp Inquiry
                        </a>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--mu)' }}>
                  {trackSearched ? (
                    <>
                      No active orders found matching "<b>{trackQuery}</b>". Please check your Order ID (e.g. #1003) or mobile phone number and try again.
                    </>
                  ) : (
                    <>
                      <Icon name="truck" size={32} />
                      <p style={{ margin: '10px 0 0', fontSize: '14.5px' }}>
                        Please enter your Order ID (e.g. <b>#1003</b>) or registered mobile phone number above to track your order.
                      </p>
                    </>
                  )}
                </div>
              )}
          </div>
        </div>
      </div>
    );
  };

  // Admin View
  const renderAdmin = () => {
    const tabs: [typeof adminTab, string, string][] = [
      ['dash', 'chart', 'Dashboard'],
      ['orders', 'card', `Orders (${store.orders.length})`],
      ['products', 'pkg', 'Products'],
      ['sliders', 'home', `Sliders (${heroSlides.length})`],
      ['gallery', 'img', 'Gallery'],
      ['reviews', 'chat', 'Reviews'],
      ['settings', 'cog', 'Settings'],
    ];

    return (
      <div className="w ad">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2 style={{ margin: 0 }}>Admin panel</h2>
            <span style={{ fontSize: '12px', background: 'var(--bg2)', padding: '3px 8px', borderRadius: '6px', color: 'var(--ok)', fontWeight: 600 }}>
              ● Authorized
            </span>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn sm"
              style={{ background: '#25d366', color: '#fff', border: 0, fontWeight: 700 }}
              disabled={isSavingCloud}
              onClick={() => saveStoreAndSync(store)}
            >
              <Icon name="check" size={15} /> {isSavingCloud ? 'Saving...' : 'Save to Cloud Database'}
            </button>
            <button className="btn sm ol" onClick={() => go('home')}>
              <Icon name="home" size={15} /> View store
            </button>
            <button
              className="btn sm"
              style={{ background: 'var(--bg2)', color: 'var(--bad)', border: '1px solid var(--bd)' }}
              onClick={() => {
                setAuthUser(null);
                go('home');
              }}
              title="Sign Out of Admin"
            >
              <Icon name="lock" size={14} /> Sign Out &amp; Exit
            </button>
          </div>
        </div>

        {firebaseSyncNotice && (
          <div
            style={{
              background: 'rgba(46, 158, 91, 0.15)',
              border: '1px solid var(--ok)',
              color: 'var(--ok)',
              borderRadius: '8px',
              padding: '10px 14px',
              fontSize: '13.5px',
              fontWeight: 600,
              marginTop: '12px',
            }}
          >
            ✓ {firebaseSyncNotice}
          </div>
        )}

        <div className="tabs">
          {tabs.map((t) => (
            <button
              key={t[0]}
              className={adminTab === t[0] ? 'on' : ''}
              onClick={() => {
                setAdminTab(t[0]);
                setEditingProduct(null);
              }}
            >
              <Icon name={t[1]} size={16} /> {t[2]}
            </button>
          ))}
        </div>

        {adminTab === 'dash' && renderAdminDash()}
        {adminTab === 'sliders' && renderAdminSliders()}
        {adminTab === 'products' && renderAdminProducts()}
        {adminTab === 'orders' && renderAdminOrders()}
        {adminTab === 'gallery' && renderAdminGallery()}
        {adminTab === 'reviews' && renderAdminReviews()}
        {adminTab === 'settings' && renderAdminSettings()}
      </div>
    );
  };

  /* ----------------- MAIN APP RENDER ----------------- */

  return (
    <div id="app">
      {page === 'admin' ? (
        renderAdmin()
      ) : (
        <>
          {renderHeader()}
          {page === 'home' && renderHome()}
          {page === 'shop' && renderShop()}
          {page === 'product' && renderProduct()}
          {page === 'checkout' && renderCheckout()}
          {page === 'thanks' && renderThanks()}
          {page === ('account' as any) && renderAccount()}
          {page === ('tracking' as any) && renderTracking()}
          {renderFooter()}
          {renderCartDrawer()}
        </>
      )}

      {/* Popups & Modals */}
      {renderReviewModal()}
    </div>
  );
}
