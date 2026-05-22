import React from "react";
import {
  Star, Pencil, Trash2, FileUp, File, Bot, Search,
  FileText, Globe, Video, Image, Copy, StickyNote,
  MessageSquare, Clock, Brain, Wifi, User, ChevronDown,
  ChevronRight, ChevronUp, PanelLeftClose, CheckCircle,
  Circle, BookCheck, FileEdit, ArrowUp, BookOpen,
  Lightbulb, Link, Bookmark, Wrench,
  X, Plus, ArrowLeft, HelpCircle, Sparkles,
  Map, Code, Presentation, GraduationCap, Library,
  Settings, Key, BookMarked, ClipboardList, Compass,
  AlertCircle, AlertTriangle, Info, Loader, LogIn,
  BarChart3, Shield, Check, Users, Terminal,
  FolderOpen, FolderPlus,
  type LucideProps,
} from "lucide-react";

// ===== Re-exports =====
export {
  Star, Pencil, Trash2, FileUp, File, Bot, Search,
  FileText, Globe, Video, Image, Copy, StickyNote,
  MessageSquare, Clock, Brain, Wifi, User, ChevronDown,
  ChevronRight, ChevronUp, PanelLeftClose, CheckCircle,
  Circle, BookCheck, FileEdit, ArrowUp, BookOpen,
  Lightbulb, Link, Bookmark, Wrench,
  X, Plus, ArrowLeft, HelpCircle, Sparkles,
  Map, Code, Presentation, GraduationCap, Library,
  Settings, Key, BookMarked, ClipboardList, Compass,
  AlertCircle, AlertTriangle, Info, Loader, LogIn,
  BarChart3, Shield, Check, Users, Terminal,
  FolderOpen, FolderPlus,
};

// ===== Types =====
export type IconSize = 10 | 12 | 14 | 16 | 18 | 20;

// ===== Tag-to-icon mapping =====
export const TAG_TO_ICON: Record<string, React.ComponentType<LucideProps>> = {
  fav: Star,
  E: Pencil,
  D: Trash2,
  FILE: FileUp,
  AI: Bot,
  PDF: FileText,
  WEB: Globe,
  VIDEO: Video,
  TXT: File,
  IMG: Image,
  DOC: File,
  C: Copy,
  H: Clock,
  Thinking: Brain,
  Online: Wifi,
  P: User,
  "-": ChevronDown,
  "+": ChevronRight,
  "=": PanelLeftClose,
  "^": ArrowUp,
  X: X,
  M: Map,
  Q: HelpCircle,
  V: Video,
  R: BookMarked,
  "<": ArrowLeft,
  A: Sparkles,
  L: Library,
  "?": HelpCircle,
  Tool: Wrench,
};

// ===== Helper component =====
export const TagIcon = ({
  tag,
  size = 14,
  className,
}: {
  tag: string;
  size?: IconSize;
  className?: string;
}) => {
  const IconComp = TAG_TO_ICON[tag];
  if (!IconComp) {
    return <>{`[${tag}]`}</>;
  }
  return <IconComp size={size} className={className} />;
};
