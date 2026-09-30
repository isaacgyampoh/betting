import { ImageResponse } from "next/og";
import { BrandIcon } from "@/lib/brand-icon";

// PWA icons referenced by app/manifest.ts, rendered once at build time.
const ICONS = {
  "icon-192.png": { size: 192, inset: 0 },
  "icon-512.png": { size: 512, inset: 0 },
  "maskable-512.png": { size: 512, inset: 0.12 },
} as const;

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(ICONS).map((name) => ({ name }));
}

export async function GET(_req: Request, { params }: RouteContext<"/icons/[name]">) {
  const icon = ICONS[(await params).name as keyof typeof ICONS];
  return new ImageResponse(<BrandIcon size={icon.size} inset={icon.inset} rounded={icon.inset === 0} />, {
    width: icon.size,
    height: icon.size,
  });
}
