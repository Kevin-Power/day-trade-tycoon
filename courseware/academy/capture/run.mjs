#!/usr/bin/env node
// Starts a brand-new disposable classroom (scripts/qa/desk-server.mjs: temporary PGlite data, loopback
// ports only), walks every workbook level as a new student, then closes the classroom cleanly.
//
//   node courseware/academy/capture/run.mjs [--app-entry <server/index.mjs>] [--market-data <dir>]
//        [--port-app 18870] [--port-proxy 18871] [--out courseware/academy/.cache/capture]
//
// --app-entry defaults to the release the classroom host currently serves (hosting.json, read only),
// so the screenshots match what students see; without a host it uses this checkout's .output build.
// --market-data defaults to a read-only copy of the host's published market data (lobby「今天的一題」).
import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { capture } from "./capture.mjs";
import { stalls } from "./lib.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const academy = resolve(here, "..");
const project = resolve(academy, "../..");
const host = join(homedir(), "YilutekServices", "DayTradeTycoon");

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function defaultAppEntry() {
  try {
    const hosting = JSON.parse(readFileSync(join(host, "hosting.json"), "utf8").replace(/^﻿/, ""));
    if (hosting.appEntry && existsSync(hosting.appEntry)) return hosting.appEntry;
  } catch {
    // No classroom host on this machine.
  }
  return join(project, ".output", "server", "index.mjs");
}

async function defaultMarketData() {
  const source = join(host, "market-data");
  if (!existsSync(join(source, "index.json"))) return undefined;
  const copy = await mkdtemp(join(tmpdir(), "academy-market-data-"));
  await cp(join(source, "index.json"), join(copy, "index.json"));
  await cp(join(source, "days"), join(copy, "days"), { recursive: true });
  return copy;
}

const appEntry = resolve(option("app-entry", defaultAppEntry()));
const marketData = option("market-data", await defaultMarketData());
const portApp = option("port-app", "18870");
const portProxy = option("port-proxy", "18871");
const out = resolve(option("out", join(academy, ".cache", "capture")));
if (!existsSync(appEntry)) throw new Error(`App entry not found: ${appEntry} (run npm run build, or pass --app-entry)`);
await mkdir(out, { recursive: true });

const release = appEntry.match(/releases[\\/]([^\\/]+)[\\/]server/)?.[1] ?? "local .output build";
console.log(`Capture against ${release}\n  app entry ${appEntry}\n  market data ${marketData ?? "(desk-server fixture)"}`);

const server = spawn(process.execPath, [join(project, "scripts", "qa", "desk-server.mjs")], {
  cwd: project,
  env: {
    ...process.env,
    APP_ENTRY: appEntry,
    PORT_APP: portApp,
    PORT_PROXY: portProxy,
    ...(marketData ? { MARKET_DATA_DIR: marketData } : {}),
    DOWNLOADS: join(appEntry, "..", "..", "downloads"),
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let serverLog = "";
const ready = new Promise((done, fail) => {
  const timer = setTimeout(() => fail(new Error("QA classroom did not start:\n" + serverLog)), 90000);
  server.stdout.on("data", (chunk) => {
    serverLog += chunk;
    if (serverLog.includes("QA ready")) {
      clearTimeout(timer);
      done();
    }
  });
  server.stderr.on("data", (chunk) => (serverLog += chunk));
  server.on("exit", (code) => fail(new Error(`QA classroom exited (${code}):\n${serverLog}`)));
});
await ready;
const stateFile = join(project, "artifacts", "trading-desk-qa", `server-${portProxy}.json`);
const state = JSON.parse(await readFile(stateFile, "utf8"));
const startedAt = new Date().toISOString();
let recorder;
try {
  recorder = await capture({ appBase: state.appBase, gateCode: state.gateCode, out });
} finally {
  await writeFile(join(state.runtime, "stop-request"), "");
  await new Promise((done) => {
    const timer = setTimeout(done, 30000);
    server.on("exit", () => {
      clearTimeout(timer);
      done();
    });
  });
}
const commit = await new Promise((done) => {
  const git = spawn("git", ["rev-parse", "HEAD"], { cwd: project, windowsHide: true });
  let text = "";
  git.stdout.on("data", (chunk) => (text += chunk));
  git.on("exit", () => done(text.trim()));
});
const failed = recorder.checks.filter((item) => !item.ok);
const summary = {
  release,
  appEntry,
  commit,
  startedAt,
  finishedAt: new Date().toISOString(),
  marketData: marketData ? "read-only copy of the host's published market data" : "desk-server fixture",
  shots: Object.keys(recorder.shots).length,
  checks: recorder.checks.length,
  passed: recorder.checks.length - failed.length,
  failed: failed.map((item) => `[${item.scope}] ${item.label} ${item.detail}`),
  serverClosedCleanly: serverLog.includes("QA database closed cleanly"),
  stalls,
};
await writeFile(join(out, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ...summary, failed: summary.failed.length }, null, 2));
if (failed.length) {
  console.log("FAILED CHECKS:\n" + summary.failed.join("\n"));
  process.exitCode = 1;
}
