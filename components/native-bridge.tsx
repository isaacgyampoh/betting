"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * The part of the Android app that a web page cannot be.
 *
 * The app loads this same site from gameclaw.win, so there is one codebase and a web deploy is an
 * app update. What that leaves missing is everything the system expects of an app rather than a
 * tab, and this supplies it: the hardware back button, a status bar that matches the theme, and
 * links to a bookmaker opening outside the app instead of trapping the user in a webview with no
 * address bar and no way back.
 *
 * Nothing here runs in a browser. `Capacitor.isNativePlatform()` is false there and every effect
 * returns immediately, so the web app is untouched and no Capacitor code is bundled for it - the
 * native bridge is injected by the shell at runtime and reached through `window.Capacitor`.
 */

type Plugin = Record<string, (...args: never[]) => Promise<unknown>>;
type CapacitorBridge = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: Record<string, Plugin | undefined>;
};

function bridge(): CapacitorBridge | null {
  if (typeof window === "undefined") return null;
  const cap = (window as unknown as { Capacitor?: CapacitorBridge }).Capacitor;
  return cap?.isNativePlatform?.() ? cap : null;
}

/** True inside the Android shell, false in any browser. */
export function isNativeApp(): boolean {
  return bridge() !== null;
}

/**
 * The system share sheet when there is one, so a slip goes to WhatsApp the way everything else on
 * the phone does. Returns false when there is no native sheet, and the caller falls back to the
 * Web Share API it already has.
 */
export async function shareNatively(data: { title?: string; text?: string; url?: string }): Promise<boolean> {
  const share = bridge()?.Plugins?.Share;
  if (!share?.share) return false;
  try {
    await (share.share as (o: unknown) => Promise<unknown>)({ ...data, dialogTitle: data.title });
    return true;
  } catch {
    // A cancelled share is not a failure, and neither is a missing sheet: either way the caller
    // has already shown the user something, so do not fall through to a second dialog.
    return true;
  }
}

export function NativeBridge() {
  const router = useRouter();
  const pathname = usePathname();

  // The status bar should belong to the app, not sit over it in whatever colour it had last.
  useEffect(() => {
    const statusBar = bridge()?.Plugins?.StatusBar;
    if (!statusBar) return;
    const dark = document.documentElement.classList.contains("dark");
    void (statusBar.setStyle as (o: unknown) => Promise<unknown>)?.({ style: dark ? "DARK" : "LIGHT" }).catch(() => {});
    void (statusBar.setOverlaysWebView as (o: unknown) => Promise<unknown>)?.({ overlay: false }).catch(() => {});
  }, [pathname]);

  // Hardware back: go back through the app's own history, and only leave the app from a root tab.
  // Without this Android closes the app on the first press, wherever the user is.
  useEffect(() => {
    const app = bridge()?.Plugins?.App;
    if (!app?.addListener) return;
    const ROOTS = new Set(["/chat", "/slip", "/picks", "/matches", "/account"]);
    let handle: { remove?: () => void } | undefined;

    void (app.addListener as (e: string, cb: (d: { canGoBack: boolean }) => void) => Promise<{ remove?: () => void }>)(
      "backButton",
      ({ canGoBack }) => {
        if (canGoBack && !ROOTS.has(window.location.pathname)) {
          router.back();
          return;
        }
        if (window.location.pathname !== "/chat") {
          router.push("/chat");
          return;
        }
        void (app.exitApp as () => Promise<unknown>)?.().catch(() => {});
      },
    ).then((h) => {
      handle = h;
    });

    return () => handle?.remove?.();
  }, [router]);

  // A link off our own origin - a bookmaker, a support page - opens in the system browser. Inside
  // the shell there is no address bar and no back affordance, so following one in place strands
  // the user on someone else's site.
  useEffect(() => {
    const browser = bridge()?.Plugins?.Browser;
    if (!browser?.open) return;

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a");
      const href = anchor?.getAttribute("href");
      if (!href) return;
      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin === window.location.origin) return;
      if (url.protocol !== "http:" && url.protocol !== "https:") return;
      event.preventDefault();
      void (browser.open as (o: unknown) => Promise<unknown>)({ url: url.href }).catch(() => {
        window.open(url.href, "_blank", "noopener");
      });
    };

    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  return null;
}
