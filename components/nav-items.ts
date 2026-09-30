import { ArrowLeftRight, BarChart3, CalendarCheck, MessageCircle, ReceiptText, UserRound } from "lucide-react";

export const NAV_ITEMS = [
  { href: "/chat", label: "Chat", icon: MessageCircle },
  { href: "/slip", label: "Slip", icon: ReceiptText },
  { href: "/picks", label: "Picks", icon: CalendarCheck },
  { href: "/matches", label: "Matches", icon: BarChart3 },
  { href: "/account", label: "Account", icon: UserRound },
] as const;

/** Shown in the desktop header only (the mobile bar keeps five items). */
export const DESKTOP_ONLY_ITEMS = [{ href: "/convert", label: "Convert", icon: ArrowLeftRight }] as const;
