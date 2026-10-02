#!/usr/bin/env node
/** Build the learner PDF from local docs/pdf-source.json; no browser, web server or login. */
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function parsePdfArgs(argv, env = process.env) {
  const allowed = new Set(["--python", "--output"]);
  const parsed = {
    python: env.MANUAL_PDF_PYTHON || "",
    output: join(root, "public", "daytrade-tycoon-manual.pdf"),
  };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (!allowed.has(flag) || !argv[i + 1] || argv[i + 1].startsWith("--"))
      return {
        error:
          "Usage: npm run build:manual-pdf -- [--python path] [--output path]. No --start or --url is needed.",
      };
    parsed[flag.slice(2)] = argv[i + 1];
  }
  return parsed;
}

export function pythonCandidates(explicit = "") {
  if (explicit) return [explicit];
  const bundled = join(
    homedir(),
    ".cache",
    "codex-runtimes",
    "codex-primary-runtime",
    "dependencies",
    "python",
    process.platform === "win32" ? "python.exe" : "bin/python3",
  );
  return [...(existsSync(bundled) ? [bundled] : []), "python", "python3"];
}

function main(argv) {
  const args = parsePdfArgs(argv);
  if (args.error) throw new Error(args.error);
  const python = pythonCandidates(args.python).find(
    (candidate) =>
      spawnSync(candidate, ["-c", "import reportlab, pypdf"], {
        windowsHide: true,
        stdio: "ignore",
      }).status === 0,
  );
  if (!python)
    throw new Error(
      "Python with reportlab and pypdf is required. Set MANUAL_PDF_PYTHON or pass --python. No network install is performed.",
    );
  const output = resolve(root, args.output);
  const result = spawnSync(
    python,
    [
      join(root, "scripts", "build-manual-pdf.py"),
      "--source",
      join(root, "docs", "pdf-source.json"),
      "--output",
      output,
    ],
    { cwd: root, windowsHide: true, stdio: "inherit", env: process.env },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Manual PDF builder exited ${result.status}`);
  if (!existsSync(output) || statSync(output).size < 20000)
    throw new Error("Generated PDF is missing or unexpectedly small.");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2));
