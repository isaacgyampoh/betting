import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Team and league logos from API-Football. Served as-is: they're tiny, and optimising on
    // Cloudflare would need the paid Images binding.
    unoptimized: true,
    remotePatterns: [{ protocol: "https", hostname: "media.api-sports.io" }],
  },
  // pg loads pg-cloudflare conditionally, so Next's file tracing only keeps its Node stub.
  // Workers need the whole package (dist/index.js + esm/).
  outputFileTracingIncludes: { "/**": ["./node_modules/.pnpm/pg-cloudflare@*/node_modules/pg-cloudflare/**"] },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      {
        // Always fetch the latest service worker.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
