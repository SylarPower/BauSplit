import {
  ArrowLeftRight,
  Baby,
  BookOpen,
  Briefcase,
  Car,
  Coffee,
  Dumbbell,
  Film,
  FolderSync,
  Gift,
  HeartPulse,
  Home,
  Music,
  PawPrint,
  Plane,
  Repeat,
  Shirt,
  ShoppingBag,
  ShoppingBasket,
  Sparkles,
  Tag,
  Utensils,
  Wifi,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';

const ICON_MAP: Record<string, LucideIcon> = {
  'shopping-basket': ShoppingBasket,
  utensils: Utensils,
  home: Home,
  zap: Zap,
  car: Car,
  plane: Plane,
  sparkles: Sparkles,
  'shopping-bag': ShoppingBag,
  'heart-pulse': HeartPulse,
  repeat: Repeat,
  gift: Gift,
  tag: Tag,
  'paw-print': PawPrint,
  coffee: Coffee,
  dumbbell: Dumbbell,
  'book-open': BookOpen,
  wifi: Wifi,
  music: Music,
  baby: Baby,
  wrench: Wrench,
  briefcase: Briefcase,
  shirt: Shirt,
  film: Film,
  settlement: ArrowLeftRight,
  transfer: FolderSync,
};

export function CategoryIcon({
  icon,
  color,
  size = 18,
  boxed = false,
}: {
  icon: string;
  color: string;
  size?: number;
  boxed?: boolean;
}) {
  const Comp = ICON_MAP[icon] ?? Tag;
  if (!boxed) {
    return <Comp size={size} style={{ color }} strokeWidth={1.9} />;
  }
  return (
    <span
      className="cat-icon-box"
      style={{
        backgroundColor: `${color}14`,
        color,
      }}
      aria-hidden="true"
    >
      <Comp size={size} strokeWidth={1.9} />
    </span>
  );
}

const AVATAR_PALETTE: { bg: string; fg: string }[] = [
  { bg: '#CCFBF1', fg: '#115E59' },
  { bg: '#E0F2FE', fg: '#075985' },
  { bg: '#FEF3C7', fg: '#92400E' },
  { bg: '#FCE7F3', fg: '#9D174D' },
  { bg: '#EDE9FE', fg: '#5B21B6' },
  { bg: '#DCFCE7', fg: '#166534' },
  { bg: '#FFEDD5', fg: '#9A3412' },
];

function hashString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function Avatar({
  name,
  seed,
  size = 30,
}: {
  name: string;
  seed?: string;
  size?: number;
}) {
  const palette = AVATAR_PALETTE[hashString(seed || name) % AVATAR_PALETTE.length];
  return (
    <span
      className="avatar"
      title={name}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(11, Math.round(size * 0.39)),
        backgroundColor: palette.bg,
        color: palette.fg,
      }}
    >
      {getInitials(name)}
    </span>
  );
}

export function AppLogo({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 192 192"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <rect width="192" height="192" rx="46" fill="#0F766E" />
      <circle cx="78" cy="96" r="38" fill="#FFFFFF" fillOpacity="0.96" />
      <circle cx="114" cy="96" r="38" fill="#99F6E4" fillOpacity="0.72" />
      <circle cx="114" cy="96" r="38" stroke="#FFFFFF" strokeWidth="6" />
    </svg>
  );
}
