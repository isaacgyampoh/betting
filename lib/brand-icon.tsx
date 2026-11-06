// Brand mark rendered with next/og (Satori), used for favicon, Apple touch icon and PWA icons.

/**
 * The mark's own colour: a blue tile carrying white strokes. This is the icon identity - favicon,
 * Apple touch icon, PWA icons - and it is not the interface's accent.
 */
export const BRAND_ACCENT = "#2346b5";
export const BRAND_DARK = "#111113";

/**
 * The accent everything the user actually looks at is drawn in.
 *
 * `--primary` in globals.css and `GcColors.accent` in the Flutter app are both this lime; it is the
 * one accent either surface spends. Repeated as a literal because Satori renders outside the
 * document and cannot read a CSS variable.
 *
 * A share image is a picture of a card the user is looking at, so it has to be this and not the
 * icon's blue. It was the blue: every slip anyone shared went out in a colour that appears nowhere
 * in the product, which is the one place a brand is most visible and least able to explain itself.
 *
 * Lime only works on ink - #CCFF2E on white is about 1.4:1 - so it belongs on the dark card and
 * never behind dark text.
 */
export const BRAND_UI_ACCENT = "#CCFF2E";

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
