// Builds src/lib/icons/index.ts: one React component per icon the app uses, named after the lucide icon it
// replaced. Glyphs come from Teenyicons 0.4.1 outline (MIT, scripts/icons/teenyicons/) or, where Teenyicons
// has no fitting glyph, from scripts/icons/*.svg drawn on the same 15-unit grid with 1-unit strokes. Also
// writes public/third-party-notices.txt, which carries the Teenyicons licence to the site and offline package.
// Usage: node scripts/build-icons.mjs [--check]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const sources = fileURLToPath(new URL("./icons/", import.meta.url));
const target = fileURLToPath(new URL("../src/lib/icons/index.ts", import.meta.url));
const noticeTarget = fileURLToPath(new URL("../public/third-party-notices.txt", import.meta.url));

// Component name → Teenyicons outline glyph, or "custom/<file>" for scripts/icons/<file>.svg.
const ICONS = {
  AlertCircle: "exclamation-circle",
  ArrowDown: "arrow-down",
  ArrowDownLeft: "bottom-left",
  ArrowDownUp: "custom/arrow-down-up",
  ArrowLeft: "arrow-left",
  ArrowRight: "arrow-right",
  ArrowUpRight: "top-right",
  // A medal, not a star: the star is 自選, often on the same phone screen.
  Award: "custom/award",
  BookOpen: "book",
  CalendarClock: "appointments",
  CandlestickChart: "candle-chart",
  ChartCandlestick: "candle-chart",
  ChartNoAxesCombined: "area-chart",
  Check: "tick",
  CheckCircle2: "tick-circle",
  // Chevrons (4x8) and plus/minus (9px) are drawn to lucide's size: Teenyicons' full ones span the whole
  // box, and its small ones (3x6, 7px) are too faint on buttons that show nothing else.
  ChevronDown: "custom/chevron-down",
  ChevronLeft: "custom/chevron-left",
  ChevronRight: "custom/chevron-right",
  ChevronUp: "custom/chevron-up",
  Circle: "circle",
  CircleCheck: "tick-circle",
  CirclePause: "pause-circle",
  ClipboardList: "custom/clipboard-list",
  Clock3: "clock",
  Download: "download",
  Eye: "eye",
  EyeOff: "eye-closed",
  FileText: "text-document",
  Flag: "flag",
  Flame: "custom/flame",
  Footprints: "custom/footprints",
  GraduationCap: "custom/graduation-cap",
  HardDrive: "archive",
  Inbox: "inbox",
  KeyRound: "key",
  Layers3: "history",
  ListChecks: "clipboard-tick",
  ListFilter: "filter",
  ListOrdered: "list-ordered",
  LoaderCircle: "loader",
  Lock: "lock",
  LockKeyhole: "lock",
  LogOut: "logout",
  MessageSquare: "message",
  Minus: "custom/minus",
  Monitor: "screen",
  Moon: "moon",
  Package: "box",
  PanelTop: "custom/panel-top",
  Pause: "pause",
  Play: "play",
  Plus: "custom/plus",
  Printer: "print",
  ReceiptText: "receipt",
  RefreshCw: "refresh",
  RotateCcw: "anti-clockwise",
  ScanLine: "scan",
  ScrollText: "text-document-alt",
  Search: "search",
  Send: "send",
  ShieldCheck: "shield-tick",
  Smartphone: "mobile",
  Sparkles: "custom/sparkles",
  Square: "stop",
  Star: "star",
  Sun: "sun",
  Tablet: "tablet",
  Target: "target",
  TextCursorInput: "text",
  Timer: "stopwatch",
  TriangleAlert: "custom/triangle-alert",
  Trophy: "trophy",
  UserPlus: "user-plus",
  UserRound: "user",
  Users: "users",
  Volume2: "sound-on",
  VolumeX: "sound-off",
  Wallet: "wallet",
  Zap: "custom/zap",
};

// SVG attribute → React prop; anything else in a source file is an error.
const ATTRIBUTES = {
  d: "d",
  fill: "fill",
  stroke: "stroke",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
  "stroke-miterlimit": "strokeMiterlimit",
  "fill-rule": "fillRule",
  "clip-rule": "clipRule",
};
const OPEN = '<svg viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">';

function glyph(name, source) {
  const file = source.startsWith("custom/") ? `${sources}${source.slice(7)}.svg` : `${sources}teenyicons/${source}.svg`;
  const svg = readFileSync(file, "utf8").trim();
  if (!svg.startsWith(OPEN) || !svg.endsWith("</svg>")) throw new Error(`${name}: ${file} is not a 15x15 outline glyph`);
  const paths = [];
  const rest = svg.slice(OPEN.length, -"</svg>".length).replace(/<path\s+([^>]*?)\s*\/>/g, (_, attributes) => {
    const path = {};
    const left = attributes.replace(/([a-z-]+)="([^"]*)"\s*/g, (__, key, value) => {
      if (!ATTRIBUTES[key]) throw new Error(`${name}: unsupported attribute ${key}`);
      if ((key === "fill" || key === "stroke") && value !== "currentColor") throw new Error(`${name}: ${key}="${value}"`);
      path[ATTRIBUTES[key]] = key === "stroke-miterlimit" ? Number(value) : value;
      return "";
    });
    if (left.trim() || !path.d) throw new Error(`${name}: unreadable path attributes "${attributes}"`);
    if (!path.fill && !path.stroke) throw new Error(`${name}: a path with neither fill nor stroke draws nothing`);
    paths.push(path);
    return "";
  });
  if (rest.trim()) throw new Error(`${name}: only <path> elements are supported, found "${rest.trim().slice(0, 40)}"`);
  if (!paths.length) throw new Error(`${name}: no paths in ${file}`);
  return paths;
}

const license = readFileSync(`${sources}teenyicons/LICENSE`, "utf8").replace(/\r\n/g, "\n").trim();
const literal = (path) => `{ ${Object.entries(path).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join(", ")} }`;
const array = (name, source) => `[${glyph(name, source).map(literal).join(", ")}]`;
// Aliases (two lucide names for one concept) share one glyph array instead of repeating its data.
const uses = new Map();
for (const source of Object.values(ICONS)) uses.set(source, (uses.get(source) ?? 0) + 1);
const shared = [...uses].filter(([, count]) => count > 1).map(([source]) => source);
const constant = (source) => `${source.replace(/^custom\//, "").replace(/-(\w)/g, (_, letter) => letter.toUpperCase())}Glyph`;
const output = [
  "// Generated by scripts/build-icons.mjs from scripts/icons/. Edit the sources there and rerun the script.",
  "/*!",
  " * Glyphs from Teenyicons 0.4.1, outline set (https://teenyicons.com).",
  ...license.split("\n").map((line) => ` *${line ? ` ${line}` : ""}`),
  " */",
  'import { createIcon, type GlyphPath } from "./icon.ts";',
  "",
  ...shared.map((source) => `const ${constant(source)}: readonly GlyphPath[] = ${array(source, source)};`),
  ...Object.entries(ICONS).map(
    ([name, source]) =>
      `export const ${name} = /* @__PURE__ */ createIcon(${JSON.stringify(name)}, ${shared.includes(source) ? constant(source) : array(name, source)});`,
  ),
  "",
].join("\n");
const notice = [
  "Third-party notices / 第三方授權聲明",
  "",
  "The icons in this app are drawn from Teenyicons 0.4.1, outline set (https://teenyicons.com),",
  "or drawn on the same grid to match it. Teenyicons is distributed under the MIT License:",
  "",
  license,
  "",
].join("\n");

const outputs = [
  [target, output, "src/lib/icons/index.ts"],
  [noticeTarget, notice, "public/third-party-notices.txt"],
];
if (process.argv.includes("--check")) {
  const read = (file) => (existsSync(file) ? readFileSync(file, "utf8").replace(/\r\n/g, "\n") : "");
  const stale = outputs.filter(([file, text]) => read(file) !== text);
  for (const [, , label] of stale) console.error(`${label} is out of date: run node scripts/build-icons.mjs`);
  if (stale.length) process.exitCode = 1;
  else console.log(`Icons up to date (${Object.keys(ICONS).length} icons) with their licence notice.`);
} else {
  for (const [file, text] of outputs) writeFileSync(file, text);
  console.log(`Wrote ${Object.keys(ICONS).length} icons to src/lib/icons/index.ts and public/third-party-notices.txt`);
}

