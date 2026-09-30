import type { Metadata } from "next";
import { z } from "zod";
import { ConvertWorkspace } from "@/components/slips/convert-workspace";
import { requireAdultPage } from "@/lib/auth-pages";
import { AppError } from "@/lib/errors";
import { listEnabledBookmakers } from "@/lib/services/bookmakers";
import { getSlip } from "@/lib/services/slips";

export const metadata: Metadata = { title: "Convert a slip" };

export default async function ConvertPage({ searchParams }: PageProps<"/convert">) {
  const { user } = await requireAdultPage("/convert");
  const from = z.uuid().safeParse((await searchParams).from);

  const [bookmakers, source] = await Promise.all([
    listEnabledBookmakers(),
    from.success
      ? getSlip(user, from.data).catch((err) => {
          if (err instanceof AppError && err.code === "NOT_FOUND") return null;
          throw err;
        })
      : null,
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Convert a slip</h1>
        <p className="text-sm text-muted-foreground">
          Move a booking code to another bookmaker. Games we can&apos;t match are listed, never silently dropped.
        </p>
      </div>
      <ConvertWorkspace bookmakers={bookmakers} source={source} />
    </div>
  );
}
