import type { Metadata } from "next";
import { ArrowLeftRight } from "lucide-react";
import { ComingSoon } from "@/components/coming-soon";

export const metadata: Metadata = { title: "Convert a slip" };

export default function ConvertPage() {
  return <ComingSoon icon={ArrowLeftRight} title="Convert between bookmakers" description="Arrives in milestone 3." />;
}
