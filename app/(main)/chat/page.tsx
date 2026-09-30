import type { Metadata } from "next";
import { MessageCircle } from "lucide-react";
import { ComingSoon } from "@/components/coming-soon";
import { requireAdultPage } from "@/lib/auth-pages";

export const metadata: Metadata = { title: "AI assistant" };

export default async function ChatPage() {
  await requireAdultPage("/chat");
  return <ComingSoon icon={MessageCircle} title="AI assistant" description="Arrives in milestone 6." />;
}
