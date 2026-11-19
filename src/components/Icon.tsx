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
import type { CSSProperties } from 'react';

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

/** Colore salvato dal gruppo: solo la resa a schermo dipende dal tema. */
export function categoryStyle(color: string) {
  return { '--category-color': color } as CSSProperties;
}

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
    return <Comp size={size} className="category-paint" style={categoryStyle(color)} strokeWidth={1.9} />;
  }
  return (
    <span
      className="cat-icon-box category-paint"
      style={categoryStyle(color)}
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
        '--avatar-bg': palette.bg,
        '--avatar-ink': palette.fg,
      } as CSSProperties}
    >
      {getInitials(name)}
    </span>
  );
}

export function AppLogo({ size = 28 }: { size?: number }) {
  return <img src="./icon.svg" alt="" width={size} height={size} style={{ flexShrink: 0 }} />;
}
