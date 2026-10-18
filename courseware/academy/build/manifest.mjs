// Source identification for one frozen delivery: SHA-256 of every build input (courseware is not in
// git), the external app files the build reads, the capture release, the build commands, generation
// times and hashes of the deliverables, and the QA results on record. Writes only into
// verification/releases/<version>/; it does not build or change anything else.
//   node courseware/academy/build/manifest.mjs [version]      (default: the edition in content/course.mjs)
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { academy, out, project } from "./render.mjs";
import * as course from "../content/course.mjs";

const version = process.argv[2] ?? course.edition.version;
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex").toUpperCase();
const utc = (file) => statSync(file).mtime.toISOString().replace(/\.\d+Z$/, "Z");
const posix = (path) => path.split(sep).join("/");
const read = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}

// Build inputs inside courseware/academy (everything the build, capture and tests read or run).
const inputDirs = ["content", "build", "capture", "design", "assets/shots"];
const inputFiles = ["README.md", "CHANGELOG.md", ".gitignore"];
const sources = [...inputDirs.flatMap((dir) => walk(join(academy, dir))), ...inputFiles.map((file) => join(academy, file))]
  .filter((file) => existsSync(file))
  .map((file) => ({ path: posix(relative(academy, file)), bytes: statSync(file).size, sha256: sha(file) }));
const treeHash = createHash("sha256").update(sources.map((item) => `${item.sha256}  ${item.path}`).join("\n")).digest("hex").toUpperCase();

// App files outside courseware that the build reads (answer key, minute table, cover chart, fees).
const external = [
  "src/lib/morning-quote.ts",
  "src/lib/morning-book.ts",
  "src/lib/morning-alerts.ts",
  "src/lib/market/ticks.ts",
  "server/data/morning-2026-10-05.json",
  "server/data/morning-2026-10-06.json",
].map((file) => ({ path: file, sha256: sha(join(project, file)) }));
let commit = "";
try {
  commit = execFileSync("git", ["-C", project, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
} catch {
  commit = "(unknown)";
}

const capture = read(join(academy, "assets", "shots", "capture-summary.json"));
const checks = read(join(academy, "assets", "shots", "capture-checks.json")) ?? [];
const facts = read(join(academy, "assets", "shots", "capture-facts.json")) ?? {};
const pdfStudent = read(join(out, "qa", "student", "pdf-qa.json"));
const pdfTeacher = read(join(out, "qa", "teacher", "pdf-qa.json"));
const leak = read(join(out, "qa", "leak-check.json"));
const web = read(join(out, "qa", "web", "web-qa.json"));
const beforeAfter = read(join(academy, "verification", "revision-2", "evidence", "before-after.json"));
const marks = read(join(out, "qa", "marks", "marks.json"));
const pack = read(join(out, "qa", "package.json"));

const suffix = `-${version}`;
const upload = join(out, "drive-upload");
const deliverables = existsSync(upload)
  ? readdirSync(upload)
      .filter((name) => name.includes(suffix) && statSync(join(upload, name)).isFile())
      .sort()
      .map((name) => ({ file: `output/drive-upload/${name}`, bytes: statSync(join(upload, name)).size, sha256: sha(join(upload, name)), modifiedUtc: utc(join(upload, name)) }))
  : [];
const built = [
  ["學員版 PDF", join(out, "當沖大富翁-學員實戰闖關手冊.pdf")],
  ["講師版 PDF", join(out, "當沖大富翁-講師版教學手冊.pdf")],
  ["數位版 index.html", join(out, "web", "index.html")],
  ["數位版 web.js", join(out, "web", "assets", "web.js")],
].filter(([, file]) => existsSync(file)).map(([name, file]) => ({ name, file: posix(relative(academy, file)), sha256: sha(file), modifiedUtc: utc(file) }));
const webFiles = walk(join(out, "web"));
const webTree = createHash("sha256").update(webFiles.map((file) => `${sha(file)}  ${posix(relative(join(out, "web"), file))}`).join("\n")).digest("hex").toUpperCase();

let tools = {};
try {
  tools.node = process.version;
} catch {}
tools.chrome = facts.browser ?? web?.browser ?? "(unknown)";

const manifest = {
  version,
  generatedAt: new Date().toISOString(),
  sourceTree: { root: "courseware/academy", files: sources.length, treeSha256: treeHash },
  appRepository: { worktree: posix(relative(join(project, ".."), project)), commit, files: external },
  capture: capture ? { release: capture.release, appEntry: capture.appEntry, startedAt: capture.startedAt, finishedAt: capture.finishedAt, checks: capture.checks, passed: capture.passed, failed: capture.failed.length, shots: capture.shots, stalls: capture.stalls.length } : null,
  buildCommands: [
    "node courseware/academy/capture/run.mjs",
    "python courseware/academy/build/shots.py --raw courseware/academy/.cache/capture/raw --manifest courseware/academy/.cache/capture/shots.json --out courseware/academy/assets/shots",
    "node courseware/academy/build/build.mjs --python <python with fontTools, brotli>",
    "python courseware/academy/build/qa_pdf.py <student pdf> --out courseware/academy/output/qa/student …",
    "python courseware/academy/build/qa_pdf.py <teacher pdf> --out courseware/academy/output/qa/teacher …",
    "python courseware/academy/build/qa_leak.py <student pdf> <teacher pdf> --out courseware/academy/output/qa",
    "node courseware/academy/build/qa_web.mjs courseware/academy/output/web/index.html courseware/academy/output/qa/web",
    "node courseware/academy/build/qa_before_after.mjs courseware/academy/.cache/review-baseline/web/index.html courseware/academy/output/web/index.html courseware/academy/verification/revision-2/evidence",
    "node courseware/academy/build/report.mjs",
    "node courseware/academy/build/qa_marks.mjs --python <python with Pillow>",
    `python courseware/academy/build/package.py ${version}`,
    `node courseware/academy/build/manifest.mjs ${version}`,
  ],
  tools,
  built,
  webOutput: { files: webFiles.length, treeSha256: webTree },
  deliverables,
  qa: {
    capture: capture ? `${capture.passed}/${capture.checks}` : null,
    pdfStudent: pdfStudent ? { pages: pdfStudent.pages, problems: pdfStudent.problems.length, minImageDpi: pdfStudent.images.min_dpi } : null,
    pdfTeacher: pdfTeacher ? { pages: pdfTeacher.pages, problems: pdfTeacher.problems.length } : null,
    leak: leak ? { ok: leak.ok, phrases: leak.items.length } : null,
    web: web ? { ok: web.ok, checks: web.scenarios.reduce((sum, item) => sum + item.checks.length, 0), failed: web.problems.length, at: web.finishedAt } : null,
    beforeAfter: beforeAfter ? { rows: beforeAfter.rows.length, fixed: beforeAfter.rows.filter((row) => row.verdict === "已修正").length, at: beforeAfter.at } : null,
    package: pack ? { version: pack.version, zip: pack.zip, members: pack.members, backslash: pack.backslashMembers, absolute: pack.absoluteMembers, dotDot: pack.dotDotMembers, ok: pack.ok } : null,
    marks: marks ? { checked: marks.print + marks.web390, print: marks.print, web390: marks.web390, overviewSkipped: marks.web390OverviewSkipped, overText: marks.flagged.length, cutOff: marks.cutOff.length, overlapping: marks.overlapping.length, allowed: marks.allowed.map((item) => ({ key: item.key, hits: item.hits.length, reason: item.reason })) } : null,
  },
  completionCardChecks: checks.filter((item) => /完成卡|練習分|04-3：/.test(item.label)).map((item) => ({ scope: item.scope, label: item.label, ok: item.ok })),
};

const dir = join(academy, "verification", "releases", version);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "SOURCE_MANIFEST.json"), JSON.stringify({ ...manifest, sources }, null, 2));

const md = `# 來源識別與交付紀錄 · ${version}

> 由 \`build/manifest.mjs\` 產生（${manifest.generatedAt}）。courseware 沒有進 git，以每個來源檔的 SHA-256 識別版本；完整清單在 \`SOURCE_MANIFEST.json\`。

## 成品（驗收請只用這幾個檔）

| 檔案 | 大小 | 修改時間（UTC） | SHA-256 |
|---|---|---|---|
${deliverables.map((item) => `| \`${item.file}\` | ${(item.bytes / 1048576).toFixed(1)} MB | ${item.modifiedUtc} | \`${item.sha256}\` |`).join("\n") || "| （找不到這個版本的交付檔） | | | |"}

建置產物（交付檔由這些檔複製或壓縮而成）：

| 產物 | 修改時間（UTC） | SHA-256 |
|---|---|---|
${built.map((item) => `| ${item.name}（\`${item.file}\`） | ${item.modifiedUtc} | \`${item.sha256}\` |`).join("\n")}
| 數位版整個資料夾（${webFiles.length} 個檔，\`output/web/\`） | — | 樹雜湊 \`${webTree}\` |

## 來源

- 教材原始檔：\`courseware/academy/\` 的 ${sources.length} 個檔（content、build、capture、design、assets/shots 含 shots.json 與 capture-*.json、README、CHANGELOG、.gitignore）。樹雜湊（「SHA-256␣␣路徑」逐行串接後再取 SHA-256）：\`${treeHash}\`。
- 建置時讀取的系統檔（教學五檔、報價摘要、快訊、費用函式與教材行情）：工作區 commit \`${commit}\`
${external.map((item) => `  - \`${item.path}\` \`${item.sha256}\``).join("\n")}
- 截圖擷取：release \`${capture?.release ?? "—"}\`，${capture?.startedAt ?? ""} → ${capture?.finishedAt ?? ""}；${capture ? `${capture.passed}/${capture.checks} 項檢查通過、${capture.shots} 張畫面、停滯 ${capture.stalls.length} 次` : ""}。
- 工具：Node ${tools.node}、Google Chrome ${tools.chrome}（Playwright 驅動）。

## 建置指令

\`\`\`
${manifest.buildCommands.join("\n")}
\`\`\`

## 本版的檢查結果

- 擷取：${manifest.qa.capture ?? "—"}
- 學員版 PDF：${manifest.qa.pdfStudent ? `${manifest.qa.pdfStudent.pages} 頁、${manifest.qa.pdfStudent.problems} 個問題、截圖最低 ${manifest.qa.pdfStudent.minImageDpi} dpi` : "—"}
- 講師版 PDF：${manifest.qa.pdfTeacher ? `${manifest.qa.pdfTeacher.pages} 頁、${manifest.qa.pdfTeacher.problems} 個問題` : "—"}
- 期末答案外洩檢查：${manifest.qa.leak ? (manifest.qa.leak.ok ? `通過（${manifest.qa.leak.phrases} 個字句）` : "未通過") : "—"}
- 數位版回歸測試：${manifest.qa.web ? `${manifest.qa.web.checks - manifest.qa.web.failed}/${manifest.qa.web.checks}（${manifest.qa.web.at}）` : "—"}
- 修正前後對照：${manifest.qa.beforeAfter ? `${manifest.qa.beforeAfter.fixed}/${manifest.qa.beforeAfter.rows} 已修正（${manifest.qa.beforeAfter.at}）` : "—"}
- 數位版 ZIP 成員名稱（\`build/package.py\`）：${manifest.qa.package ? `${manifest.qa.package.zip}：${manifest.qa.package.members} 個成員；反斜線 ${manifest.qa.package.backslash}、絕對路徑 ${manifest.qa.package.absolute}、「..」${manifest.qa.package.dotDot}（${manifest.qa.package.ok ? "通過" : "未通過"}）` : "—"}
- 截圖標號：${manifest.qa.marks ? `${manifest.qa.marks.checked} 個（紙本 ${manifest.qa.marks.print}、手機 390 寬 ${manifest.qa.marks.web390}；手機總覽圖 ${manifest.qa.marks.overviewSkipped} 個不計壓字）；壓字 ${manifest.qa.marks.overText}、裁掉 ${manifest.qa.marks.cutOff}、重疊 ${manifest.qa.marks.overlapping}；例外 ${manifest.qa.marks.allowed.map((item) => `${item.key}（${item.hits} 次）`).join("、") || "無"}` : "—"}

## 核對完成卡文字與 04-3 賣出張數的擷取檢查

${manifest.completionCardChecks.map((item) => `- ${item.ok ? "✓" : "✗"} [${item.scope}] ${item.label}`).join("\n")}

## 注意

- \`build/manifest.mjs\` 只產生這份紀錄，不參與輸出；若它在成品建置之後才加入，雜湊清單仍會列出它。
- 這份紀錄只描述本機產生的檔案與本機執行的檢查；沒有實體手機、Safari、實體列印或真人試教的結果。
`;
writeFileSync(join(dir, "SOURCE_MANIFEST.md"), md);
console.log(`verification/releases/${version}/SOURCE_MANIFEST.{json,md} written · ${sources.length} source files · tree ${treeHash.slice(0, 12)}… · ${deliverables.length} deliverables`);
