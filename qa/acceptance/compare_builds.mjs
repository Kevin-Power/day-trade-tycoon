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

// Pass 2: hashed names normalised.
const normalise = (files) => {
  const result = new Map();
  for (const [path, buffer] of files) {
    const key = path.replace(HASHED, "$1-[hash].$2");
    const content = TEXT.has(extname(path)) ? Buffer.from(buffer.toString("utf8").replace(HASHED, "$1-[hash].$2")) : buffer;
    result.set(key, { path, content });
  }
  return result;
};
const na = normalise(a);
const nb = normalise(b);
const pairs = [...na.keys()].filter((key) => nb.has(key));
const sameAfter = pairs.filter((key) => sha(na.get(key).content) === sha(nb.get(key).content));
const eolOnly = [];
const stillDifferent = [];
for (const key of pairs.filter((item) => !sameAfter.includes(item))) {
  const left = na.get(key).content.toString("utf8").replace(/\r\n/g, "\n");
  const right = nb.get(key).content.toString("utf8").replace(/\r\n/g, "\n");
  (left === right ? eolOnly : stillDifferent).push(key);
}
const renamedOnly = sameAfter.filter((key) => na.get(key).path !== nb.get(key).path || sha(a.get(na.get(key).path)) !== sha(b.get(nb.get(key).path)));
say(`== Pass 2 (hashed names normalised)`);
say(`paired files: ${pairs.length} (unpaired ${labelA} ${na.size - pairs.length}, unpaired ${labelB} ${nb.size - pairs.length})`);
say(`identical after normalisation: ${sameAfter.length}, of which differed before only by hashed names: ${renamedOnly.length}`);
for (const key of renamedOnly.sort()) say(`  RENAMED-ONLY ${na.get(key).path}  ↔  ${nb.get(key).path}`);
say(`differ only in line endings: ${eolOnly.length}`);
for (const key of eolOnly) say(`  EOL-ONLY ${key}`);
say(`still different: ${stillDifferent.length}`);
for (const key of stillDifferent) say(`  STILL-DIFF ${na.get(key).path}  ↔  ${nb.get(key).path}`);
for (const key of [...na.keys()].filter((item) => !nb.has(item))) say(`  UNPAIRED-${labelA} ${na.get(key).path}`);
for (const key of [...nb.keys()].filter((item) => !na.has(item))) say(`  UNPAIRED-${labelB} ${nb.get(key).path}`);
say();

// CSS that still differs: compare the selector sets (selector text before each `{`, at-rules excluded).
const selectors = (css) => {
  const found = new Set();
  for (const match of css.matchAll(/(?:^|[{};])\s*([^{}@;][^{};]*?)\s*\{/g)) found.add(match[1].replace(/\s+/g, " "));
  return found;
};
for (const key of stillDifferent.filter((item) => item.endsWith(".css"))) {
  const left = selectors(na.get(key).content.toString("utf8"));
  const right = selectors(nb.get(key).content.toString("utf8"));
  const onlyLeft = [...left].filter((item) => !right.has(item));
  const onlyRight = [...right].filter((item) => !left.has(item));
  say(`== CSS ${key}: selectors ${labelA} ${left.size}, ${labelB} ${right.size}; only in ${labelA} ${onlyLeft.length}; only in ${labelB} ${onlyRight.length}`);
  for (const item of onlyLeft) say(`  CSS-ONLY-${labelA} ${item}`);
  for (const item of onlyRight) say(`  CSS-ONLY-${labelB} ${item}`);
  say(`  bytes ${labelA} ${na.get(key).content.length}, ${labelB} ${nb.get(key).content.length}`);
}
writeFileSync(out, `${lines.join("\n")}\n`);
console.log(lines.filter((line) => !line.startsWith("  ")).join("\n"));
