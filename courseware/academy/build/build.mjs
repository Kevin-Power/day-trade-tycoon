#!/usr/bin/env node
// Builds the workbook deliverables from content + captured screens.
//
//   node courseware/academy/build/build.mjs [--only student|teacher|web] [--python <python with fontTools>]
//
// 1. render HTML   2. subset Noto Sans TC to exactly the characters used (static weights → CID fonts in PDF)
// 3. print A4 PDFs with an overflow guard   4. write a build report.
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { academy, project, out, renderStudent, corpus } from "./render.mjs";
import { printPdf } from "./pdf.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const only = option("only", "all");
const python = option("python", process.env.ACADEMY_PYTHON || "python");

mkdirSync(join(out, "print"), { recursive: true });
mkdirSync(join(out, "fonts"), { recursive: true });

const outputs = [];
if (only === "all" || only === "student") {
  const student = await renderStudent();
  writeFileSync(join(out, "print", "student.html"), student.html);
  outputs.push({ name: "student", html: join(out, "print", "student.html"), pdf: join(out, "當沖大富翁-學員實戰闖關手冊.pdf"), title: "學員實戰闖關手冊", text: corpus(student.html) });
}
if (only === "all" || only === "teacher") {
  const teacherModule = join(academy, "build", "teacher.mjs");
  if (existsSync(teacherModule)) {
    const { renderTeacher } = await import(new URL("./teacher.mjs", import.meta.url));
    const teacher = await renderTeacher();
    writeFileSync(join(out, "print", "teacher.html"), teacher.html);
    outputs.push({ name: "teacher", html: join(out, "print", "teacher.html"), pdf: join(out, "當沖大富翁-講師版教學手冊.pdf"), title: "講師版教學手冊", text: corpus(teacher.html) });
  }
}
let webText = "";
if (only === "all" || only === "web") {
  const webModule = join(academy, "build", "web.mjs");
  if (existsSync(webModule)) {
    const { renderWeb } = await import(new URL("./web.mjs", import.meta.url));
    webText = (await renderWeb()).text;
  }
}

// Fonts: one shared subset for every edition; rebuilt only when new characters appear.
const text = outputs.map((item) => item.text).join("\n") + webText;
const charsFile = join(out, "fonts", "chars.txt");
const wanted = new Set([...text].filter((ch) => !/\s/.test(ch) || ch === "　"));
const have = existsSync(charsFile) ? new Set([...readFileSync(charsFile, "utf8")]) : new Set();
const missing = [...wanted].filter((ch) => !have.has(ch));
if (missing.length || !existsSync(join(out, "fonts", "noto-sans-tc-400.woff2"))) {
  const all = [...new Set([...have, ...wanted])].join("");
  writeFileSync(join(out, "corpus.txt"), all);
  console.log(`Subsetting fonts: ${missing.length} new characters (${all.length} total)…`);
  const result = spawnSync(
    python,
    [join(academy, "build", "fonts.py"), "--text", join(out, "corpus.txt"), "--out", join(out, "fonts"), "--plex", join(project, "node_modules", "@fontsource", "ibm-plex-mono", "files")],
    { stdio: "inherit", windowsHide: true },
  );
  if (result.status !== 0) throw new Error("fonts.py failed (needs fontTools + brotli; pass --python)");
}

const report = { builtAt: new Date().toISOString(), outputs: [] };
for (const item of outputs) {
  const result = await printPdf(item);
  report.outputs.push({ name: item.name, pdf: item.pdf, ok: result.ok, pages: result.pages, problems: result.problems, free: result.free });
  console.log(`${item.name}: ${result.ok ? "PDF written" : "NOT PRINTED"} · ${result.pages} pages`);
  if (!result.ok) process.exitCode = 1;
}
writeFileSync(join(out, "build-report.json"), JSON.stringify(report, null, 2));
