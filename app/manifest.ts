import type { MetadataRoute } from "next";
import { BRAND_DARK } from "@/lib/brand-icon";
import { publicEnv } from "@/lib/public-env";

export default function manifest(): MetadataRoute.Manifest {
  const site = publicEnv.siteUrl; // https://gameclaw.win in production
  return {
    id: `${site}/`,
    name: "gameclaw",
    short_name: "gameclaw",
    description: "Load, convert and edit betting slips, check match stats and ask the AI assistant.",
    start_url: `${site}/slip`,
    scope: `${site}/`,
    display: "standalone",
    orientation: "portrait",
    background_color: BRAND_DARK,
    theme_color: BRAND_DARK,
    categories: ["sports", "utilities"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Load a code", url: `${site}/slip` },
      { name: "Convert a code", url: `${site}/convert` },
    ],
  };
}
