import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { GateProvider } from "@/lib/gate/context";
import { DisplayPreferencesEffect } from "@/components/display-controls";
import { PwaEffect } from "@/components/pwa-effect";
import appCss from "../styles.css?url";
// The same files styles.css loads, so a preload is used instead of fetched twice.
import plexMono400 from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2?url";
import plexMono500 from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2?url";
import plexMono600 from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2?url";

const APP_NAME = "當沖大富翁";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      { name: "theme-color", content: "#f5f7fb" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: APP_NAME },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      {
        name: "description",
        content: "模擬台股當沖教室：證交所 5 秒加權指數、五檔撮合、漲跌停與收盤強制平倉，讓學員練習判斷與風控。",
      },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" },
      // Prices use IBM Plex Mono; preloading keeps the big quote from swapping fonts after it shows.
      ...[plexMono400, plexMono500, plexMono600].map((href) => ({
        rel: "preload",
        href,
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous" as const,
      })),
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;600;700&display=swap",
      },
      { rel: "manifest", href: "/manifest.webmanifest" },
    ],
  }),
  component: () => (
    <html lang="zh-Hant" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="antialiased">
        <DisplayPreferencesEffect />
        <PwaEffect />
        <AuthProvider>
          <GateProvider>
            <Outlet />
          </GateProvider>
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  ),
});
