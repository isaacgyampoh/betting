import type { NextConfig } from "next";

// The commit being built, so /api/v1/health can say which one is serving. GitHub Actions sets
// GITHUB_SHA and Render sets RENDER_GIT_COMMIT; locally there is no commit worth naming.
//
// Render was missing, so every deploy there reported "dev" and the endpoint whose whole purpose
// is answering "did my change go out?" answered identically before and after a deploy. That is
// worse than no field: it reads like a real answer.
const commit = (process.env.GITHUB_SHA ?? process.env.RENDER_GIT_COMMIT ?? "dev").slice(0, 7);

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_COMMIT_SHA: commit },
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
