import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { ServiceWorkerRegister } from "@/components/sw-register";
import { ReferralCapture } from "@/components/referral-capture";
import { Toaster } from "@/components/ui/sonner";
import { publicEnv } from "@/lib/public-env";
import "./globals.css";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(publicEnv.siteUrl),
  title: { default: "gameclaw", template: "%s · gameclaw" },
  description:
    "Load, convert and trim betting slips across Ghana's bookmakers, and check head-to-head before you bet. Built in Ghana. 18+.",
  applicationName: "gameclaw",
  appleWebApp: { capable: true, title: "gameclaw", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
  openGraph: { type: "website", siteName: "gameclaw", locale: "en_GH" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf9" },
    { media: "(prefers-color-scheme: dark)", color: "#111113" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // The on-screen keyboard shrinks the viewport instead of sliding the page under it, so the chat
  // input stays put above the keyboard rather than being pushed off-screen.
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
          <Toaster position="top-center" />
        </ThemeProvider>
        {/* SessionKeeper lives in the app shell, not here: it pulls in the Supabase auth client
            (about 250 KB), and a signed-out visitor reading the marketing pages never needs it. */}
        <ServiceWorkerRegister />
        <ReferralCapture />
      </body>
    </html>
  );
}
