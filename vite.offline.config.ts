import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));
const offlineRoot = fileURLToPath(new URL("./src/offline", import.meta.url));
const outDir = fileURLToPath(new URL("./dist-offline", import.meta.url));

/** Standalone classroom build — not used by the live preview. */
export default defineConfig({
  root: offlineRoot,
  base: "./",
  publicDir: false,
  plugins: [tailwindcss(), viteReact()],
  resolve: {
    // Never bundle server functions or an online session client into the static classroom.
    alias: [
      { find: "@/lib/classroom-db", replacement: `${offlineRoot}/classroom-db.ts` },
      { find: "@/lib/auth/use-current-user", replacement: `${offlineRoot}/current-user.ts` },
      { find: "@/lib/auth/client", replacement: `${offlineRoot}/auth-client.ts` },
      { find: "@/components/classroom-account", replacement: `${offlineRoot}/online-panels.tsx` },
      { find: "@/components/leaderboard", replacement: `${offlineRoot}/online-panels.tsx` },
      { find: "@", replacement: srcDir },
    ],
  },
  build: {
    outDir,
    emptyOutDir: true,
    assetsDir: "assets",
    cssCodeSplit: false,
    sourcemap: false,
  },
});
