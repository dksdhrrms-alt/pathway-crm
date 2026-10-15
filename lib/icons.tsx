/**
 * Icon registry — single source of truth so every page uses the same
 * glyph for the same concept. Backed by lucide-react (tree-shakeable,
 * ~16 KB total when a few are used) which Linear, Vercel, and shadcn/ui
 * all standardize on.
 *
 * Why not emoji? Emoji platform-render differently (Apple vs Windows vs
 * Android), don't inherit text color, and break at smaller sizes. Lucide
 * icons are plain SVG — `currentColor` picks up the parent's text color,
 * they scale cleanly, and dark mode "just works".
 *
 * How to use:
 *   import { ActivityIcon } from '@/lib/icons';
 *   <ActivityIcon kind="Call" className="w-4 h-4 text-brand" />
 *
 * Add new icons by re-exporting from lucide-react below. For CRM-domain
 * mappings (Activity type → icon), extend ACTIVITY_ICONS.
 */

import {
  // Navigation / layout
  Home, LayoutDashboard, Users, UserRound, Target, CheckSquare,
  BarChart3, Lightbulb, TrendingUp, Beaker, FlaskConical,
  Package, Megaphone, Shield, Settings, Archive,
  // Activity types
  Phone, Mail, Users as MeetingUsers, StickyNote, MessageSquare,
  // Common actions
  Plus, Search, Filter, Download, Upload, Trash2, Edit3, Copy, Save,
  X, Check, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, ArrowRight, ArrowLeft,
  // Status / signals
  AlertTriangle, AlertCircle, Info, CheckCircle2, XCircle, Clock, Flag,
  Star, Heart, Zap, Flame, Sparkles,
  // Finance / sales
  DollarSign, Receipt, TrendingDown, LineChart, PieChart,
  // Communication
  Send, Reply, AtSign, Bell, BellOff,
  // Data
  Table2, List, Grid3x3, Calendar, CalendarDays, Clock3,
  // Misc
  Link as LinkIcon, Paperclip, Pin, Lock, Unlock, Eye, EyeOff,
  MoreHorizontal, MoreVertical, Menu, PanelLeftClose, PanelLeftOpen,
  // Role-in-deal glyphs for Org Map
  Crown, Target as ChampionIcon, StarIcon, UserCircle2, OctagonAlert, HelpCircle,
} from 'lucide-react';

// Re-export everything we actually use so consumers import from one path.
export {
  Home, LayoutDashboard, Users, UserRound, Target, CheckSquare,
  BarChart3, Lightbulb, TrendingUp, Beaker, FlaskConical,
  Package, Megaphone, Shield, Settings, Archive,
  Phone, Mail, StickyNote, MessageSquare,
  Plus, Search, Filter, Download, Upload, Trash2, Edit3, Copy, Save,
  X, Check, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, ArrowRight, ArrowLeft,
  AlertTriangle, AlertCircle, Info, CheckCircle2, XCircle, Clock, Flag,
  Star, Heart, Zap, Flame, Sparkles,
  DollarSign, Receipt, TrendingDown, LineChart, PieChart,
  Send, Reply, AtSign, Bell, BellOff,
  Table2, List, Grid3x3, Calendar, CalendarDays, Clock3,
  LinkIcon, Paperclip, Pin, Lock, Unlock, Eye, EyeOff,
  MoreHorizontal, MoreVertical, Menu, PanelLeftClose, PanelLeftOpen,
  Crown, UserCircle2, OctagonAlert, HelpCircle,
};
export const Meeting = MeetingUsers;  // Activity "Meeting"

// ── CRM-domain mappings ────────────────────────────────────

import type { LucideIcon } from 'lucide-react';
import type { ActivityType } from './data';

export const ACTIVITY_ICONS: Record<ActivityType, LucideIcon> = {
  Call: Phone,
  Meeting: MeetingUsers,
  Email: Mail,
  Note: StickyNote,
};

export function ActivityIcon({
  kind, className = 'w-4 h-4',
}: { kind: ActivityType; className?: string }) {
  const Icon = ACTIVITY_ICONS[kind] || StickyNote;
  return <Icon className={className} />;
}

// Org Map role icons (replaces the emoji in OrgMap.tsx — same shape,
// typed properly, picks up current text color).
export const ROLE_ICONS = {
  decision_maker: Crown,
  champion: ChampionIcon,
  influencer: StarIcon,
  user: UserCircle2,
  blocker: OctagonAlert,
  unknown: HelpCircle,
};
