import {
  ArrowDownUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  Baby,
  Bell,
  CakeSlice,
  CalendarDays,
  Camera,
  Check,
  Copy,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clock,
  Eye,
  EyeOff,
  ReceiptText,
  Gift,
  Globe,
  Heart,
  Home,
  House,
  Images,
  Info,
  LayoutGrid,
  List,
  ListFilter,
  Lock,
  Mail,
  LogIn,
  LogOut,
  Handshake,
  Map as MapIcon,
  LocateFixed,
  MapPin,
  MessageCircle,
  Minus,
  Navigation,
  Moon,
  Palette,
  Pencil,
  PackageCheck,
  BadgePercent,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  Shirt,
  Smartphone,
  Sofa,
  Sparkles,
  ShoppingBag,
  Star,
  Sun,
  Store,
  Trash2,
  CircleAlert,
  Truck,
  CloudUpload,
  User,
  Users,
  Wallet,
  X
} from "lucide-react-native";
import { View, type StyleProp, type ViewStyle } from "react-native";

import { useAppTheme } from "@/lib/theme";
import { useLanguage } from "@/lib/i18n";

const iconRegistry = {
  "arrow-down": ArrowDown,
  "arrow-down-up": ArrowDownUp,
  "arrow-left": ArrowLeft,
  "arrow-right": ArrowRight,
  "arrow-up": ArrowUp,
  "arrow-up-down": ArrowUpDown,
  baby: Baby,
  bell: Bell,
  "cake-slice": CakeSlice,
  calendar: CalendarDays,
  camera: Camera,
  check: Check,
  "chevron-down": ChevronDown,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  "circle-check": CircleCheck,
  clock: Clock,
  "credit-card": Wallet,
  eye: Eye,
  "eye-off": EyeOff,
  "file-text": ReceiptText,
  gift: Gift,
  globe: Globe,
  heart: Heart,
  copy: Copy,
  home: Home,
  house: House,
  image: Images,
  info: Info,
  "layout-grid": LayoutGrid,
  list: List,
  "list-filter": ListFilter,
  lock: Lock,
  mail: Mail,
  "log-in": LogIn,
  "log-out": LogOut,
  handshake: Handshake,
  map: MapIcon,
  "locate-fixed": LocateFixed,
  "map-pin": MapPin,
  "message-circle": MessageCircle,
  minus: Minus,
  navigation: Navigation,
  moon: Moon,
  palette: Palette,
  pencil: Pencil,
  package: PackageCheck,
  percent: BadgePercent,
  phone: Phone,
  plus: Plus,
  "refresh-cw": RefreshCw,
  search: Search,
  send: Send,
  settings: Settings,
  shirt: Shirt,
  smartphone: Smartphone,
  sofa: Sofa,
  sparkles: Sparkles,
  "shopping-bag": ShoppingBag,
  star: Star,
  sun: Sun,
  store: Store,
  "trash-2": Trash2,
  "triangle-alert": CircleAlert,
  truck: Truck,
  "cloud-upload": CloudUpload,
  user: User,
  users: Users,
  wallet: Wallet,
  x: X
} as const;

export type IconName = keyof typeof iconRegistry;

export function Icon({
  name,
  size,
  color,
  fill = "none",
  strokeWidth = 1.8,
  accessibilityLabel,
  accessibilityHidden = false,
  style
}: {
  name: IconName;
  size?: number;
  color?: string;
  fill?: string;
  strokeWidth?: number;
  accessibilityLabel?: string;
  accessibilityHidden?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { language } = useLanguage();
  const theme = useAppTheme();
  const mirroredNames: Partial<Record<IconName, IconName>> = {
    "arrow-left": "arrow-right",
    "arrow-right": "arrow-left",
    "chevron-left": "chevron-right",
    "chevron-right": "chevron-left"
  };
  const resolvedName = language === "en" ? mirroredNames[name] ?? name : name;
  const IconComponent = iconRegistry[resolvedName];
  const resolvedSize = size ?? theme.dimensions.iconSize.md;

  return (
    <View
      accessible={!accessibilityHidden}
      accessibilityLabel={accessibilityLabel}
      accessibilityElementsHidden={accessibilityHidden}
      style={[{ width: resolvedSize, height: resolvedSize, alignItems: "center", justifyContent: "center" }, style]}
    >
      <IconComponent size={resolvedSize} color={color ?? theme.colors.foreground} fill={fill} strokeWidth={strokeWidth} />
    </View>
  );
}
