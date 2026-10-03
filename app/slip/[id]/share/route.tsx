import { ImageResponse } from "next/og";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { BRAND_ACCENT, BrandIcon } from "@/lib/brand-icon";
import { formatKickoff, formatOdds } from "@/lib/format";
import { getSlip } from "@/lib/services/slips";

export const size = { width: 1080, height: 1350 };

/** A slip as a clean image to share. Only the owner can render their own slip. */
export async function GET(req: Request, { params }: RouteContext<"/slip/[id]/share">) {
  const user = await requireUser(req.headers.get("authorization")).catch(() => null);
  if (!user) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Sign in to share a slip." } }, { status: 401 });

  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Slip not found." } }, { status: 404 });

  const slip = await getSlip(user, id.data).catch(() => null);
  if (!slip) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Slip not found." } }, { status: 404 });

  // Fewer games when we have reasons to show: a wall of text at this size reads as nothing.
  const playable = slip.selections.filter((s) => s.status === "OK");
  const explained = playable.some((s) => s.reason);
  const games = playable.slice(0, explained ? 6 : 10);
  const row = { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24, padding: "18px 32px", borderBottom: "1px solid #27272a" } as const;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#111113", color: "#fafafa", fontSize: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "36px 32px 24px" }}>
          <BrandIcon size={48} />
          <span style={{ fontSize: 36, fontWeight: 600 }}>gameclaw</span>
          <span style={{ marginLeft: "auto", color: "#a1a1aa", fontSize: 26 }}>{slip.bookmaker.name}</span>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", padding: "0 32px 28px" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ color: "#a1a1aa", fontSize: 24 }}>Booking code</span>
            <span style={{ fontSize: 54, fontWeight: 700, letterSpacing: 2 }}>{slip.code ?? "—"}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <span style={{ color: "#a1a1aa", fontSize: 24 }}>{games.length} games · total odds</span>
            <span style={{ fontSize: 54, fontWeight: 700, color: BRAND_ACCENT === "#2346b5" ? "#7aa2ff" : BRAND_ACCENT }}>{formatOdds(slip.totalOdds)}</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", borderTop: "1px solid #27272a" }}>
          {games.map((g) => (
            <div key={g.position} style={row}>
              <div style={{ display: "flex", flexDirection: "column", maxWidth: 760 }}>
                <span style={{ fontSize: 30 }}>
                  {g.home} v {g.away}
                </span>
                <span style={{ color: "#a1a1aa", fontSize: 22 }}>
                  {g.pickLabel} · {formatKickoff(g.kickoffAt)}
                </span>
                {g.reason && (
                  <span style={{ color: "#8b8b93", fontSize: 19, marginTop: 6, maxWidth: 740 }}>
                    {g.reason.length > 115 ? `${g.reason.slice(0, 112)}…` : g.reason}
                  </span>
                )}
              </div>
              <span style={{ fontSize: 32, fontWeight: 600 }}>{formatOdds(g.odds)}</span>
            </div>
          ))}
        </div>

        <div style={{ marginTop: "auto", display: "flex", justifyContent: "space-between", padding: "28px 32px", color: "#a1a1aa", fontSize: 22 }}>
          <span>gameclaw.win{playable.length > games.length ? ` · +${playable.length - games.length} more` : ""}</span>
          <span>18+. Odds change. Not a guarantee.</span>
        </div>
      </div>
    ),
    size,
  );
}
