import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SpecialSlip } from "@/components/picks/special-slip";
import { shareSize } from "./image/route";
import { specialSlipByReference } from "@/lib/services/special-picks";

export const dynamic = "force-dynamic";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://gameclaw.win";

/**
 * A published slip on its own page, for anyone with the link.
 *
 * Public and signed out: a slip that has been shared has already left, and asking the person it was
 * shared with to sign in to see what they were sent is how a share link stops being shared. It
 * shows the same published slip and its current status, never a newer one.
 */
export async function generateMetadata({ params }: PageProps<"/special/[reference]">): Promise<Metadata> {
  const slip = await specialSlipByReference((await params).reference).catch(() => null);
  if (!slip) return { title: "Slip not found" };

  const title = `Daily Special Slip ${slip.reference} — ${slip.combinedOdds.toFixed(2)}`;
  const description = slip.summary;
  const url = `${SITE}/special/${slip.reference}`;

  return {
    title,
    description,
    alternates: { canonical: `/special/${slip.reference}` },
    // The real dimensions, because a preview card that is told the wrong ones letterboxes.
    openGraph: { title, description, url, images: [{ url: `${url}/image`, ...shareSize(slip.legs.length) }] },
    twitter: { card: "summary_large_image", title, description, images: [`${url}/image`] },
  };
}

export default async function SpecialSlipPage({ params }: PageProps<"/special/[reference]">) {
  const slip = await specialSlipByReference((await params).reference).catch(() => null);
  if (!slip) notFound();

  return (
    <div className="space-y-5">
      <SpecialSlip slip={slip} shareUrl={`${SITE}/special/${slip.reference}`} />

      <p className="text-sm text-muted-foreground">
        One researched accumulator a day, in statistical markets only — corners, shots and shots on target, never
        match results.{" "}
        <Link href="/track-record#special" className="text-primary hover:underline">
          Every slip we have published
        </Link>
        , with its result.
      </p>
    </div>
  );
}
