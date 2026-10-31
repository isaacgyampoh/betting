// NEXT_PUBLIC_* values must be referenced literally so Next.js can inline them in client bundles.
export const publicEnv = {
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
};
