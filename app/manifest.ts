import type { MetadataRoute } from "next";
import { BRAND_DARK } from "@/lib/brand-icon";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "gameclaw",
    short_name: "gameclaw",
    description: "Load, convert and edit betting slips, check match stats and ask the AI assistant.",
    start_url: "/slip",
    scope: "/",
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
      { name: "Load a code", url: "/slip" },
      { name: "Convert a code", url: "/convert" },
    ],
  };
}
