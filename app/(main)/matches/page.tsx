import type { Metadata } from "next";
import { BarChart3 } from "lucide-react";
import { ComingSoon } from "@/components/coming-soon";

export const metadata: Metadata = { title: "Match stats" };

export default function MatchesPage() {
  return <ComingSoon icon={BarChart3} title="Match stats" description="Arrives in milestone 5." />;
}
