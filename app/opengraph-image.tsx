import { ImageResponse } from "next/og";
import { BRAND_DARK, BrandIcon } from "@/lib/brand-icon";

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
        <p style={{ fontSize: 52, fontWeight: 700, marginTop: 48, lineHeight: 1.15 }}>Paste a code. Convert it. Check the numbers.</p>
        <p style={{ fontSize: 30, color: "#a1a1aa", marginTop: 8 }}>SportyBet and Betway slips, form, head-to-head. Built in Ghana.</p>
        <p style={{ fontSize: 24, color: "#a1a1aa", marginTop: 40 }}>18+. Bet responsibly.</p>
      </div>
    ),
    size,
  );
}
