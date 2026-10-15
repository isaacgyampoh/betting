import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The Android shell for gameclaw.
 *
 * The web app is the product and stays the single codebase: this loads it from the live origin
 * rather than bundling a copy, so a web deploy is an app update and the two can never drift.
 * `www/` is not the app - it is the screen shown when the device has no network at all, which is
 * the one thing a remote-loaded shell cannot ask the server for.
 *
 * What this adds over a browser tab, and the reason it exists: the hardware back button, the
 * system share sheet, push notifications, deep links into a match or a shared slip, and a launch
 * screen instead of a white flash.
 */
const config: CapacitorConfig = {
  appId: "win.gameclaw.app",
  appName: "GameClaw",
  webDir: "www",
  android: {
    // Chrome's own engine, so the app renders exactly what was tested in the browser.
    webContentsDebuggingEnabled: true,
  },
  server: {
    // The app, not the front page. Someone who has installed this has already been sold it;
    // opening them on "Open app / See plans" is a browser's job, not an app's.
    url: "https://gameclaw.win/chat",
    // Only our own origin is the app; anything else opens outside it (see MainActivity).
    allowNavigation: ["gameclaw.win", "www.gameclaw.win"],
    androidScheme: "https",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      launchAutoHide: true,
      backgroundColor: "#111113",
      androidSplashResourceName: "splash",
      showSpinner: false,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
