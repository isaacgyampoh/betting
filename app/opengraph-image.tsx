import { ImageResponse } from "next/og";
import { BRAND_DARK, BRAND_GREEN, BrandIcon } from "@/lib/brand-icon";

export const alt = "gameclaw: convert, split and check betting slips";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 80, background: BRAND_DARK, color: "#fff" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <BrandIcon size={96} />
          <span style={{ fontSize: 64, fontWeight: 700 }}>gameclaw</span>
        </div>
        <p style={{ fontSize: 52, fontWeight: 700, marginTop: 48, lineHeight: 1.15 }}>Your betting slips, sorted.</p>
        <p style={{ fontSize: 30, color: "#b8c4bd", marginTop: 8 }}>Convert SportyBet ↔ Betway · trim odds · check the stats</p>
        <p style={{ fontSize: 24, color: BRAND_GREEN, marginTop: 40 }}>18+ · Bet responsibly</p>
      </div>
    ),
    size,
  );
}
