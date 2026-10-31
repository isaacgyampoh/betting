/**
 * Stands in for `.open-next/worker.js` when testing worker.ts.
 *
 * That file is the OpenNext build output: a megabyte of bundled Next.js that imports
 * `cloudflare:*` modules and only exists after `pnpm cf:build`. Loading it under Vitest is neither
 * possible nor the point - what the tests need to know is whether a request reached the Next
 * handler or was answered before it, which a marker response says precisely.
 *
 * Aliased in vitest.config.mts, so the real bundle is never resolved and the suite runs on a clean
 * checkout with no build output present.
 */
const handler = {
  fetch: () => new Response("reached the next handler", { status: 200 }),
};

export default handler;
