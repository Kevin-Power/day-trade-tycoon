#!/usr/bin/env node
// Compares two build outputs (for example a clean GitHub build and the production release) and keeps the raw
// differences, file by file. Read only.
//
// Normalisation rule, applied only for the second pass: a content-hashed asset name `<name>-<8 characters of
// [A-Za-z0-9_-]>.<js|css|mjs>` is rewritten to `<name>-[hash].<ext>`, in file paths and inside text files. Line
// endings are compared separately (CRLF → LF). Nothing else is changed.
//
//   node qa/acceptance/compare_builds.mjs <dir A> <dir B> <out.txt> [--label-a clean] [--label-b release]
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, extname } from "node:path";

const [dirA, dirB, out] = process.argv.slice(2);
const option = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : fallback;
};
const labelA = option("label-a", "A");
const labelB = option("label-b", "B");
const HASHED = /([\w.~-]+?)-[A-Za-z0-9_-]{8}\.(js|css|mjs)\b/g;
const TEXT = new Set([".js", ".mjs", ".cjs", ".css", ".html", ".json", ".map", ".txt", ".svg", ".webmanifest"]);
const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");

function walk(root) {
  const files = new Map();
  const visit = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) visit(path);
      else files.set(relative(root, path).replace(/\\/g, "/"), readFileSync(path));
    }
  };
  visit(root);
  return files;
}
const a = walk(dirA);
const b = walk(dirB);
const lines = [];
const say = (text = "") => lines.push(text);

say(`compare_builds  ${new Date().toISOString()}`);
say(`${labelA}: ${dirA} (${a.size} files)`);
say(`${labelB}: ${dirB} (${b.size} files)`);
say(`normalisation: ${HASHED} → $1-[hash].$2 in paths and text contents; line endings compared after CRLF→LF`);
say();

// Pass 1: raw, by path.
const identical = [];
const differing = [];
for (const [path, buffer] of a) if (b.has(path)) (sha(buffer) === sha(b.get(path)) ? identical : differing).push(path);
const onlyA = [...a.keys()].filter((path) => !b.has(path)).sort();
const onlyB = [...b.keys()].filter((path) => !a.has(path)).sort();
say(`== Pass 1 (raw, same path)`);
say(`byte-identical: ${identical.length}`);
say(`same path, different bytes: ${differing.length}`);
for (const path of differing.sort()) say(`  DIFF ${path}  ${labelA} ${sha(a.get(path)).slice(0, 12)}  ${labelB} ${sha(b.get(path)).slice(0, 12)}`);
say(`only in ${labelA}: ${onlyA.length}`);
for (const path of onlyA) say(`  ONLY-${labelA} ${path}  ${sha(a.get(path)).slice(0, 12)}`);
say(`only in ${labelB}: ${onlyB.length}`);
for (const path of onlyB) say(`  ONLY-${labelB} ${path}  ${sha(b.get(path)).slice(0, 12)}`);
say();

// Pass 2: hashed names normalised. Several chunks can share a base name (login-AAAA.mjs and login-BBBB.mjs), so
// files are grouped by normalised path and paired by identical normalised content first; leftovers pair 1:1 only.
const normalise = (files) => {
  const groups = new Map();
  for (const [path, buffer] of files) {
    const key = path.replace(HASHED, "$1-[hash].$2");
    const content = TEXT.has(extname(path)) ? Buffer.from(buffer.toString("utf8").replace(HASHED, "$1-[hash].$2")) : buffer;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ path, content, hash: sha(content) });
  }
  return groups;
};
const na = normalise(a);
const nb = normalise(b);
const sameAfter = [];
const pairsLeft = [];
const unpaired = [];
for (const key of new Set([...na.keys(), ...nb.keys()])) {
  const left = [...(na.get(key) ?? [])];
  const right = [...(nb.get(key) ?? [])];
  for (let i = left.length - 1; i >= 0; i--) {
    const match = right.findIndex((item) => item.hash === left[i].hash);
    if (match >= 0) {
      sameAfter.push([left[i], right[match]]);
      left.splice(i, 1);
      right.splice(match, 1);
    }
  }
  if (left.length === 1 && right.length === 1) pairsLeft.push([left[0], right[0]]);
  else {
    for (const item of left) unpaired.push(`${labelA} ${item.path}`);
    for (const item of right) unpaired.push(`${labelB} ${item.path}`);
  }
}
const eolOnly = [];
const stillDifferent = [];
for (const pair of pairsLeft) {
  const [left, right] = pair.map((item) => item.content.toString("utf8").replace(/\r\n/g, "\n"));
  (left === right ? eolOnly : stillDifferent).push(pair);
}
const renamedOnly = sameAfter.filter(([left, right]) => left.path !== right.path || sha(a.get(left.path)) !== sha(b.get(right.path)));
say(`== Pass 2 (hashed names normalised)`);
say(`identical after normalisation: ${sameAfter.length}, of which differed before only by hashed names: ${renamedOnly.length}`);
for (const [left, right] of renamedOnly.sort((x, y) => x[0].path.localeCompare(y[0].path))) say(`  RENAMED-ONLY ${left.path}  ↔  ${right.path}`);
say(`differ only in line endings: ${eolOnly.length}`);
for (const [left, right] of eolOnly) say(`  EOL-ONLY ${left.path}  ↔  ${right.path}`);
say(`still different: ${stillDifferent.length}`);
for (const [left, right] of stillDifferent) say(`  STILL-DIFF ${left.path}  ↔  ${right.path}`);
say(`unpaired: ${unpaired.length}`);
for (const item of unpaired) say(`  UNPAIRED ${item}`);
say();

// Pass 3, only for what still differs: build metadata. Hash tokens taken from the hashed file names of both trees are
// replaced also where the bundler turned them into identifiers (- → _); CRLF inside string literals, absolute build
// roots and file mtimes are replaced. What remains is a real content difference, printed with its first excerpt.
const tokens = new Set();
for (const path of [...a.keys(), ...b.keys()]) for (const match of path.matchAll(/-([A-Za-z0-9_-]{8})\.(?:js|css|mjs)\b/g)) tokens.add(match[1]);
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const tokenPattern = new RegExp([...tokens].flatMap((token) => [escape(token), escape(token.replace(/-/g, "_"))]).join("|"), "g");
const loose = (text) =>
  text
    .replace(/\r\n/g, "\n")
    .replace(/\\r\\n/g, "\\n") // CRLF inside bundled string literals (e.g. SQL files checked out with CRLF)
    .replace(tokenPattern, "[hash]")
    .replace(/[A-Z]:\/[^"'\n]*?\/src\//g, "[root]/src/")
    .replace(/\b_lazy_[A-Za-z0-9]{6}\b/g, "_lazy_[id]") // Nitro's generated names for lazy route handlers
    .replace(/"mtime": "[^"]*"/g, '"mtime": "[mtime]"');
say(`== Pass 3 (build metadata normalised, only files still different): ${stillDifferent.length}`);
for (const [left, right] of stillDifferent) {
  let x = loose(left.content.toString("utf8"));
  let y = loose(right.content.toString("utf8"));
  if (left.path.endsWith("index.mjs")) {
    // Nitro's public asset table is keyed in directory-walk order: compare it as a set of entries and list the
    // entries that differ (an entry differs when the file it describes differs: size and etag).
    const table = /var public_assets_data_default = \{[\s\S]*?\n\};/;
    const entries = (text) => new Set([...text.match(table)[0].matchAll(/\t"(\/[^"]+)": \{[^}]*\}/g)].map((match) => match[0].replace(/\s+/g, " ")));
    if (table.test(x) && table.test(y)) {
      const left = entries(x);
      const right = entries(y);
      const onlyLeft = [...left].filter((item) => !right.has(item));
      const onlyRight = [...right].filter((item) => !left.has(item));
      x = x.replace(table, "[public asset table]");
      y = y.replace(table, "[public asset table]");
      if (x === y) {
        say(`  ASSET-TABLE-ONLY ${left.size === right.size ? "" : "(entry count differs) "}index.mjs: order differs; ${onlyLeft.length} entries differ`);
        for (const item of onlyLeft) say(`    ${labelA}: ${item.slice(0, 220)}`);
        for (const item of onlyRight) say(`    ${labelB}: ${item.slice(0, 220)}`);
        continue;
      }
    }
  }
  if (x === y) {
    say(`  METADATA-ONLY ${left.path}  ↔  ${right.path}`);
    continue;
  }
  let start = 0;
  while (start < x.length && x[start] === y[start]) start++;
  let tail = 0;
  while (tail < Math.min(x.length, y.length) - start && x[x.length - 1 - tail] === y[y.length - 1 - tail]) tail++;
  say(`  CONTENT-DIFF ${left.path}  ↔  ${right.path}  (${x.length} vs ${y.length} chars after normalising)`);
  say(`    ${labelA}: ${JSON.stringify(x.slice(Math.max(0, start - 60), x.length - tail + 20).slice(0, 600))}`);
  say(`    ${labelB}: ${JSON.stringify(y.slice(Math.max(0, start - 60), y.length - tail + 20).slice(0, 600))}`);
}
say();

// CSS that still differs: compare the selector sets (selector text before each `{`, at-rules excluded).
const selectors = (css) => {
  const found = new Set();
  for (const match of css.matchAll(/(?:^|[{};])\s*([^{}@;][^{};]*?)\s*\{/g)) found.add(match[1].replace(/\s+/g, " "));
  return found;
};
for (const [leftFile, rightFile] of stillDifferent.filter(([item]) => item.path.endsWith(".css"))) {
  const key = leftFile.path;
  const left = selectors(leftFile.content.toString("utf8"));
  const right = selectors(rightFile.content.toString("utf8"));
  const onlyLeft = [...left].filter((item) => !right.has(item));
  const onlyRight = [...right].filter((item) => !left.has(item));
  say(`== CSS ${key}: selectors ${labelA} ${left.size}, ${labelB} ${right.size}; only in ${labelA} ${onlyLeft.length}; only in ${labelB} ${onlyRight.length}`);
  for (const item of onlyLeft) say(`  CSS-ONLY-${labelA} ${item}`);
  for (const item of onlyRight) say(`  CSS-ONLY-${labelB} ${item}`);
  const blocks = (file) => (file.content.toString("utf8").match(/\{/g) ?? []).length;
  say(`  bytes ${labelA} ${leftFile.content.length}, ${labelB} ${rightFile.content.length}; blocks ("{") ${labelA} ${blocks(leftFile)}, ${labelB} ${blocks(rightFile)}`);
}
writeFileSync(out, `${lines.join("\n")}\n`);
console.log(lines.filter((line) => !line.startsWith("  ")).join("\n"));
