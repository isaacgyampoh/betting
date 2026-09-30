import { ArrowLeftRight, BarChart3, MessageCircle, ReceiptText, UserRound } from "lucide-react";

export const NAV_ITEMS = [
  { href: "/slip", label: "Slip", icon: ReceiptText },
  { href: "/convert", label: "Convert", icon: ArrowLeftRight },
  { href: "/matches", label: "Stats", icon: BarChart3 },
  { href: "/chat", label: "AI Chat", icon: MessageCircle },
  { href: "/account", label: "Account", icon: UserRound },
] as const;
