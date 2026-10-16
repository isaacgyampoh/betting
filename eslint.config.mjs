import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The Android shell: Gradle build output and Capacitor's own generated bridge, neither of
    // which is ours to lint. The shell's own sources are checked by the Android toolchain.
    "mobile/android/**",
    "mobile/node_modules/**",
    // The Flutter app's build output. "build/**" above only matches at the root, and Flutter
    // vendors third-party JavaScript (a plugin's service worker) into its asset bundles - not
    // ours to lint, and not even shipped on Android. The Dart sources are checked by
    // `flutter analyze`.
    "gameclaw_app/build/**",
    // Generated: Cloudflare runtime types and OpenNext / Wrangler build output.
    "cloudflare-env.d.ts",
    ".open-next/**",
    ".wrangler/**",
  ]),
]);

export default eslintConfig;
