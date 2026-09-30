import { ArrowLeftRight, BarChart3, MessageCircle, ReceiptText, UserRound } from "lucide-react";

export const NAV_ITEMS = [
  { href: "/slip", label: "Slip", icon: ReceiptText },
  { href: "/convert", label: "Convert", icon: ArrowLeftRight },
  { href: "/matches", label: "Matches", icon: BarChart3 },
  { href: "/chat", label: "Chat", icon: MessageCircle },
  { href: "/account", label: "Account", icon: UserRound },
] as const;
