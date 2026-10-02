import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";

// A standalone Node service. The dedicated tunnel exposes only the production
// loopback listener; Vite is reserved for local development.
export default defineConfig(({ command, isPreview }) => ({
  server: { host: "127.0.0.1", port: 18790, strictPort: true },
  preview: { host: "127.0.0.1", port: 18791, strictPort: true },
  resolve: { tsconfigPaths: true },
  plugins: [
    tailwindcss(),
    tanstackStart(),
    ...(command === "build" || isPreview
      ? [nitro({ preset: "node-server", serverDir: "./server" })]
      : []),
    viteReact(),
  ],
}));
