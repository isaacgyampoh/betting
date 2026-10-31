import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@/": fileURLToPath(new URL("./", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
      // worker.ts imports the OpenNext bundle, which only exists after `pnpm cf:build`. Aliasing it
      // keeps tests/worker runnable on a clean checkout - see tests/stubs/open-next-worker.ts.
      "./.open-next/worker.js": fileURLToPath(
        new URL("./tests/stubs/open-next-worker.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/integration/**", "node_modules/**"],
  },
});
