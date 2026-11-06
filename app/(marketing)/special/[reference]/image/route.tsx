import { ImageResponse } from "next/og";
import { NextResponse } from "next/server";
import { BRAND_ACCENT, BrandIcon } from "@/lib/brand-icon";
import { formatOdds } from "@/lib/format";
import { specialSlipByReference } from "@/lib/services/special-picks";

export const dynamic = "force-dynamic";

/**
 * The canvas grows with the slip rather than the slip stretching to fill the canvas.
 *
 * A fixed height sized for three legs left a two-leg slip airy, with each row floating in a third
 * of the picture. Both of these are portrait and neither is cropped by WhatsApp, Instagram or
 * Telegram, which is what the shape has to survive.
 */
export const shareSize = (legs: number) => ({ width: 1080, height: 700 + legs * 170 });

const DATE = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const KICKOFF = new Intl.DateTimeFormat("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

const MARKET_SHORT: Record<string, string> = { CORNERS: "corners", SHOTS: "shots", SHOTS_ON_TARGET: "shots on target" };

/**
 * The slip as one image, composed here rather than screenshotted.
 *
 * A screenshot carries whatever the sender's phone looked like - their theme, their notch, their
 * font size - and is unreadable when a chat app recompresses it. This is drawn at a fixed
 * 1080x1350, the portrait shape that survives WhatsApp, Instagram and Telegram without being
 * cropped, and reads the same whoever sent it.
 *
 * Public, like the page: an image behind a sign-in is not a shareable image. Nothing user-specific
 * appears on it, only what was published.
 *
 * Two or three legs is the whole range, so unlike the user-slip image this needs no fitting pass -
 * the layout is sized for three and three is the maximum.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  const slip = await specialSlipByReference(reference).catch(() => null);
  if (!slip) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Slip not found." } }, { status: 404 });

  const accent = BRAND_ACCENT === "#2346b5" ? "#7aa2ff" : BRAND_ACCENT;
  const tone = { WON: "#5ee08a", LOST: "#ff5a5f", VOID: "#a1a1aa", PENDING: "#a1a1aa" }[slip.status] ?? "#a1a1aa";
  const label = { WON: "WON", LOST: "LOST", VOID: "VOID", PENDING: "RUNNING" }[slip.status] ?? "RUNNING";

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#111113", color: "#fafafa" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "40px 44px 0" }}>
          <BrandIcon size={44} />
          <span style={{ fontSize: 34, fontWeight: 600 }}>gameclaw</span>
          <span style={{ marginLeft: "auto", color: tone, fontSize: 24, letterSpacing: 2 }}>{label}</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", padding: "24px 44px 0" }}>
          <span style={{ fontSize: 44, fontWeight: 700, letterSpacing: -0.5 }}>Daily Special Slip</span>
          <span style={{ color: "#a1a1aa", fontSize: 24, marginTop: 6 }}>
            {DATE.format(new Date(slip.date))} · {slip.legs.length} matches · {slip.reference}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", gap: 20, padding: "28px 44px 0" }}>
          <span style={{ fontSize: 128, fontWeight: 700, lineHeight: 1, color: accent }}>{formatOdds(slip.combinedOdds)}</span>
          <span style={{ color: "#a1a1aa", fontSize: 26, paddingBottom: 16 }}>combined odds</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", marginTop: 32, borderTop: "1px solid #27272a" }}>
          {slip.legs.map((leg) => (
            <div
              key={leg.position}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 24, padding: "28px 44px", borderBottom: "1px solid #27272a" }}
            >
              <div style={{ display: "flex", flexDirection: "column", maxWidth: 760 }}>
                <span style={{ fontSize: 30, fontWeight: 600 }}>
                  {leg.match.home} v {leg.match.away}
                </span>
                <span style={{ color: "#a1a1aa", fontSize: 21, marginTop: 4 }}>
                  {leg.match.competition ?? "Football"} · {KICKOFF.format(new Date(leg.match.kickoffAt))}
                </span>
                <span style={{ fontSize: 26, marginTop: 10 }}>
                  {leg.market.outcome === "OVER" ? "Over" : "Under"} {leg.market.line}{" "}
                  {MARKET_SHORT[leg.market.kind] ?? leg.market.label.toLowerCase()}
                </span>
              </div>
              <span style={{ fontSize: 34, fontWeight: 600 }}>{formatOdds(leg.price.odds)}</span>
            </div>
          ))}
        </div>

        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", padding: "28px 44px 36px", gap: 10 }}>
          <span style={{ color: "#8b8b93", fontSize: 21, maxWidth: 980 }}>{slip.summary}</span>
          <div style={{ display: "flex", justifyContent: "space-between", color: "#a1a1aa", fontSize: 21 }}>
            <span>gameclaw.win/special/{slip.reference}</span>
            <span>18+. Odds change. Not a guarantee.</span>
          </div>
        </div>
      </div>
    ),
    shareSize(slip.legs.length),
  );
}
