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
    alias: { "@": srcDir },
  },
  build: {
    outDir,
    emptyOutDir: true,
    assetsDir: "assets",
    cssCodeSplit: false,
    sourcemap: false,
  },
});
