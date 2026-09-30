import { FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function SampleDataNotice() {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
      <Badge variant="outline" className="shrink-0 gap-1">
        <FlaskConical className="size-3" /> Sample data
      </Badge>
      Live stats aren&apos;t connected yet (no API-Football key). These numbers are made-up examples for testing, not real results.
    </p>
  );
}
