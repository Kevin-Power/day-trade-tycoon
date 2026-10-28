// The stylesheets' fallbacks for browsers without the dynamic viewport unit (dvh, Safari before 15.4 and the like).
// A declaration with var() is only checked when it is used, so a browser without dvh takes a later
// `max-height: max(50dvh, var(...))` as valid, drops it when it is used, and ends with `max-height: none` instead of
// the vh declaration before it. Such a declaration must sit inside `@supports (height: 1dvh)`.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const src = join(dirname(fileURLToPath(import.meta.url)), "..");

type Declaration = { property: string; value: string; blocks: string[] };

/** Every declaration of a stylesheet with the preludes of the blocks around it, outermost first. */
function declarations(css: string): Declaration[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const found: Declaration[] = [];
  const blocks: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "{") {
      blocks.push(text.slice(start, index).trim());
      start = index + 1;
    } else if (char === ";" || char === "}") {
      const piece = text.slice(start, index).trim();
      const colon = piece.indexOf(":");
      if (colon > 0 && blocks.length) found.push({ property: piece.slice(0, colon).trim(), value: piece.slice(colon + 1).trim(), blocks: [...blocks] });
      if (char === "}") blocks.pop();
      start = index + 1;
    }
  }
  return found;
}

const sheets = readdirSync(src)
  .filter((name) => name.endsWith(".css"))
  .map((name) => ({ name, rules: declarations(readFileSync(join(src, name), "utf8")) }));
const inDvhSupports = (rule: Declaration) => rule.blocks.some((block) => /^@supports\s*\(\s*height\s*:\s*1dvh\s*\)$/.test(block));

test("a declaration using both var() and dvh is inside @supports (height: 1dvh)", () => {
  const unguarded = sheets.flatMap(({ name, rules }) =>
    rules
      .filter((rule) => /\bvar\(/.test(rule.value) && /\d(?:\.\d+)?[sld]?dvh\b/.test(rule.value) && !inDvhSupports(rule))
      .map((rule) => `${name}: ${rule.blocks.join(" › ")} { ${rule.property}: ${rule.value} }`),
  );
  assert.deepEqual(unguarded, []);
});

test("the touch layouts' 自選 table has a plain vh height, and the dvh one only where dvh exists", () => {
  const desk = sheets.find(({ name }) => name === "trading-desk.css")!.rules;
  const heights = desk.filter((rule) => rule.property === "max-height" && rule.blocks.at(-1)!.endsWith(".td-watch-table") && /\[data-layout="phone"\]/.test(rule.blocks.at(-1)!));
  const plain = heights.filter((rule) => !inDvhSupports(rule));
  const dynamic = heights.filter(inDvhSupports);
  assert.deepEqual(plain.map((rule) => rule.value), ["max(50vh, calc(var(--td-watch-fixed, 0px) + 5 * var(--td-watch-row) + 1px))"]);
  assert.deepEqual(dynamic.map((rule) => rule.value), ["max(50dvh, calc(var(--td-watch-fixed, 0px) + 5 * var(--td-watch-row) + 1px))"]);
});
