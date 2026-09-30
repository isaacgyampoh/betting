import { ImageResponse } from "next/og";
import { BrandIcon } from "@/lib/brand-icon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// iOS applies its own rounded mask, so render a full-bleed square.
export default function AppleIcon() {
  return new ImageResponse(<BrandIcon size={180} rounded={false} />, size);
}
