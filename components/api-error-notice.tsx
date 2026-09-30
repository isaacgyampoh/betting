import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/** Server-rendered error notice for AppErrors caught in pages. */
export function ApiErrorNotice({ code, message }: { code: string; message: string }) {
  return (
    <Alert variant={code === "NOT_FOUND" ? "default" : "destructive"}>
      <AlertCircle />
      <AlertTitle>{code === "NOT_FOUND" ? "Not found" : "Unavailable"}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
