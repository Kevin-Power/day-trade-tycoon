// Disposable QA server for trading-desk checks: temporary PGlite data, loopback ports only.
// Never touches the production service or its data. Stop it with scripts/qa/desk-stop.mjs.
import { fork } from "node:child_process";
import { createServer, request as forward } from "node:http";
import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { writeMarketFixture } from "./make-market-fixture.mjs";

const project = fileURLToPath(new URL("../..", import.meta.url));
const { initialize, applicationEnvironment } = await import(
  pathToFileURL(join(project, "scripts/onprem/launcher.mjs")).href
);
const appPort = Number(process.env.PORT_APP ?? 18810);
const proxyPort = Number(process.env.PORT_PROXY ?? 18811);
const appEntry = process.env.APP_ENTRY ?? join(project, ".output/server/index.mjs");
const downloads = process.env.DOWNLOADS ?? join(project, ".output/downloads");

const root = await mkdtemp(join(tmpdir(), "daytrade-desk-qa-"));
await cp(join(project, "scripts/onprem/protect-data.ps1"), join(root, "protect-data.ps1"));
const config = await initialize(root, {
  ownerEmail: "ui-fixture@example.invalid",
  classCode: "UIQA",
  port: appPort,
});
const base = `http://127.0.0.1:${appPort}`;
// Daily question: a disposable market-data fixture unless MARKET_DATA_DIR points at real data
// (read only), and a pinned clock so the question is the same on any day of the week.
const marketData = process.env.MARKET_DATA_DIR ?? join(root, "market-data");
if (!process.env.MARKET_DATA_DIR) await writeMarketFixture(marketData);
const app = fork(join(project, "scripts/hosting/app-runner.mjs"), [appEntry], {
  cwd: root,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe", "ipc"],
  env: {
    ...applicationEnvironment(root, config),
    CLASSROOM_DOWNLOADS_DIR: downloads,
    MARKET_DATA_DIR: marketData,
    DAILY_NOW_ISO: process.env.DAILY_NOW_ISO ?? "2026-10-19T07:00:00+08:00",
  },
});
let logs = "";
app.stdout.on("data", (chunk) => (logs += chunk));
app.stderr.on("data", (chunk) => (logs += chunk));
let ready = false;
for (let i = 0; i < 160 && !ready; i++) {
  try {
    ready = (await fetch(base + "/api/health")).ok;
  } catch {
    // The server is still starting.
  }
  if (app.exitCode !== null) throw new Error("QA server exited:\n" + logs);
  if (!ready) await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!ready) throw new Error("QA server not ready:\n" + logs);

const jar = new Map();
const cookie = () => [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
async function post(path, data) {
  const response = await fetch(base + path, {
    method: "POST",
    headers: { origin: base, "content-type": "application/json", cookie: cookie() },
    body: JSON.stringify(data),
  });
  for (const value of response.headers.getSetCookie()) {
    const pair = value.split(";")[0];
    const index = pair.indexOf("=");
    jar.set(pair.slice(0, index), pair.slice(index + 1));
  }
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
}
const password = randomBytes(22).toString("base64url");
await post("/api/gate", { password: config.gateCode });
await post("/api/admin/setup", {
  name: "畫面驗收測試",
  email: config.ownerEmail,
  password,
  token: config.setupToken,
  acceptTos: true,
});
await post("/api/auth/sign-in/email", { email: config.ownerEmail, password });

const proxy = createServer((req, res) => {
  const headers = { ...req.headers, host: `127.0.0.1:${appPort}`, origin: base, cookie: cookie() };
  const outgoing = forward(base + req.url, { method: req.method, headers }, (response) => {
    const safe = { ...response.headers };
    delete safe["set-cookie"];
    res.writeHead(response.statusCode, safe);
    response.pipe(res);
  });
  outgoing.on("error", () => {
    res.writeHead(502);
    res.end("QA upstream unavailable");
  });
  req.pipe(outgoing);
});
await new Promise((done, fail) => {
  proxy.once("error", fail);
  proxy.listen(proxyPort, "127.0.0.1", done);
});
const stateDir = join(project, "artifacts/trading-desk-qa");
await mkdir(stateDir, { recursive: true });
// The entry code of this throwaway runtime lets desk-guest.mjs walk the real gate as a new visitor.
await writeFile(
  join(stateDir, `server-${proxyPort}.json`),
  JSON.stringify({ runtime: root, appBase: base, gateCode: config.gateCode }),
);
console.log(`QA ready: http://127.0.0.1:${proxyPort} (runtime ${root})`);

let stopping = false;
const stopFile = join(root, "stop-request");
const poll = setInterval(() => {
  if (!stopping && existsSync(stopFile)) void stop();
}, 500);
async function stop() {
  stopping = true;
  clearInterval(poll);
  proxy.closeAllConnections();
  proxy.close();
  const acknowledged = new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error("Shutdown acknowledgement missing")), 25000);
    app.on("message", (message) => {
      if (message?.type === "shutdown-complete") {
        clearTimeout(timer);
        done();
      }
    });
  });
  app.send({ type: "shutdown" });
  await acknowledged;
  app.kill();
  console.log("QA database closed cleanly");
  process.exit(0);
}
process.on("SIGINT", () => void stop());
