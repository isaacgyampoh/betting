import type { Metadata } from "next";
import { z } from "zod";
import { SlipWorkspace } from "@/components/slips/slip-workspace";
import { requireAdultPage } from "@/lib/auth-pages";
import { AppError } from "@/lib/errors";
import { listEnabledBookmakers } from "@/lib/services/bookmakers";
import { getSlip, listRecentSlips } from "@/lib/services/slips";

export const metadata: Metadata = { title: "Load a slip" };

export default async function SlipPage({ searchParams }: PageProps<"/slip">) {
  const { user } = await requireAdultPage("/slip");
  const id = z.uuid().safeParse((await searchParams).id);

  const [bookmakers, recent, initialSlip] = await Promise.all([
    listEnabledBookmakers(),
    listRecentSlips(user, 8),
    id.success
      ? getSlip(user, id.data).catch((err) => {
          if (err instanceof AppError && err.code === "NOT_FOUND") return null;
          throw err;
        })
      : null,
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Load a booking code</h1>
        <p className="text-sm text-muted-foreground">Every game, market and price on the slip. Free.</p>
      </div>
      <SlipWorkspace bookmakers={bookmakers} initialRecent={recent} initialSlip={initialSlip} />
    </div>
  );
}
