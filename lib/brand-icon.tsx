// Brand mark rendered with next/og (Satori), used for favicon, Apple touch icon and PWA icons.
export const BRAND_ACCENT = "#2346b5";
export const BRAND_DARK = "#111113";

/** `inset` shrinks the mark inside the canvas; maskable icons need a ~20% safe zone. */
export function BrandIcon({ size, inset = 0, rounded = true }: { size: number; inset?: number; rounded?: boolean }) {
  const inner = size * (1 - inset * 2);
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: inset > 0 ? BRAND_ACCENT : "transparent",
      }}
    >
      <svg width={inner} height={inner} viewBox="0 0 32 32">
        <rect width="32" height="32" rx={rounded ? 8 : 0} fill={BRAND_ACCENT} />
        <g stroke="#ffffff" strokeWidth="3" strokeLinecap="round">
          <path d="M10 23 L14 9" />
          <path d="M15.5 24 L19.5 10" />
          <path d="M21 23 L24 13" />
        </g>
      </svg>
    </div>
  );
}
