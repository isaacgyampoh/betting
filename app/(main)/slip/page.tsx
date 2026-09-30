import type { Metadata } from "next";
import { ReceiptText } from "lucide-react";
import { ComingSoon } from "@/components/coming-soon";

export const metadata: Metadata = { title: "Load a slip" };

export default function SlipPage() {
  return <ComingSoon icon={ReceiptText} title="Load a booking code" description="Arrives in milestone 2." />;
}
