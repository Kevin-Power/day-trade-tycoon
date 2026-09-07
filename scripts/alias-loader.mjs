import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = new URL("../src/", import.meta.url);
const EXTS = ["", ".ts", ".tsx", ".json", "/index.ts", "/index.tsx"];

/**
 * Vite resolves `@/x` to `src/x` and fills in the extension. Node does neither,
 * which is why no test could import anything under src/lib/market or
 * src/lib/game. This hook does the same two jobs for `node --test`.
 */
export async function resolve(specifier, context, next) {
  if (!specifier.startsWith("@/")) return next(specifier, context);
  const rest = specifier.slice(2);
  for (const ext of EXTS) {
    const candidate = new URL(rest + ext, SRC);
    if (existsSync(fileURLToPath(candidate))) {
      return next(candidate.href, context);
    }
  }
  return next(new URL(rest, SRC).href, context);
}

/** JSON reached through the alias arrives without an import attribute. */
export async function load(url, context, next) {
  if (url.endsWith(".json") && !context.importAttributes?.type) {
    return next(url, { ...context, importAttributes: { type: "json" } });
  }
  return next(url, context);
}
