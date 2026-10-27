import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { FEED_PREFIX, FubonQuoteStore, type FeedResponse, type FeedState } from "./fubon-feed.ts";

type Lease = { symbols: string[]; until: number };
export type FeedConfig = { enabled: boolean; python: string; worker: string; credentials: string; verification?: boolean };
export function feedConfig(): FeedConfig {
  return {
    enabled: process.env.FUBON_READONLY_ENABLED === "true",
    python: process.env.FUBON_READONLY_PYTHON || join(homedir(), "YilutekServices/DayTradeTycoon/fetcher/.venv/Scripts/python.exe"),
    worker: process.env.FUBON_READONLY_WORKER || resolve(".output/server/fubon-live/worker.py"),
    credentials: process.env.FUBON_READONLY_CREDENTIALS || join(homedir(), ".fubon/credentials.local.py"),
  };
}

/** Exactly one child per application process; owner authorization is mandatory
 * before calling touch(). Child stdio is private, never an HTTP service. */
export class FubonFeed {
  private config: FeedConfig;
  private leases = new Map<string, Lease>();
  private store = new FubonQuoteStore();
  private child: ChildProcessWithoutNullStreams | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private state: FeedState = "disabled";
  private reason: string | null = null;
  private generation = 0;
  private attempts = 0;
  private retryAt: number | null = null;
  private pulse = 0;
  private brokerAt = 0;
  private started = 0;
  private stable = 0;
  private sent = "";
  constructor(config: FeedConfig) { this.config = config; }

  touch(client: string, symbols: string[], now = Date.now()): FeedResponse {
    this.expire(now);
    if (!this.leases.has(client) && this.leases.size >= 8) throw new Error("CLIENT_CAPACITY");
    const union = new Set([...this.leases].filter(([key]) => key !== client).flatMap(([, v]) => v.symbols).concat(symbols));
    if (union.size > 30) throw new Error("SYMBOL_CAPACITY");
    this.leases.set(client, { symbols: [...new Set(symbols)], until: now + 45_000 });
    if (!this.timer) this.timer = setInterval(() => this.tick(), 1000).unref();
    this.tick();
    this.send();
    const connected = this.state === "connected" && performance.now() - this.brokerAt < 70_000;
    return { ok: true, readOnly: true, liveOrders: false, state: this.state, reason: this.reason,
      serverTime: now, retryAt: this.retryAt, generation: this.generation, rows: this.store.view(symbols, now, connected) };
  }
  private expire(now: number) { for (const [key, lease] of this.leases) if (lease.until < now) this.leases.delete(key); }
  private symbols() { return [...new Set([...this.leases.values()].flatMap(v => v.symbols))].sort(); }
  private send() {
    const symbols = this.symbols();
    this.store.retain(symbols);
    const command = JSON.stringify({ symbols });
    if (this.child && command !== this.sent) { this.sent = command; this.child.stdin.write(command + "\n"); }
  }
  private tick() {
    this.expire(Date.now());
    if (!this.leases.size) { this.close(); return; }
    if (!this.config.enabled) { this.state = "disabled"; this.reason = "NOT_CONFIGURED"; return; }
    if (this.state === "stopped") return;
    if (this.child) {
      const now = performance.now();
      if (now - this.pulse > 30_000 || (this.state === "connecting" && now - this.started > 30_000)) this.fail("WORKER_TIMEOUT");
      else if (this.state === "connected" && now - this.brokerAt > 70_000) this.fail("HEARTBEAT_TIMEOUT");
      else if (this.state === "connected" && now - this.stable > 120_000) this.attempts = 0;
      this.send();
    } else if (this.retryAt === null || Date.now() >= this.retryAt) this.start();
  }
  private start() {
    if (![this.config.python, this.config.worker, this.config.credentials].every(existsSync)) {
      this.state = "stopped"; this.reason = "LOCAL_SETUP_REQUIRED"; return;
    }
    this.state = "connecting"; this.reason = null; this.retryAt = null;
    this.generation++; this.store.reset(this.generation); this.sent = "";
    this.pulse = this.started = performance.now(); this.stable = 0; this.brokerAt = 0;
    const epoch = this.generation;
    // The native SDK creates a log/ directory relative to cwd. Keep it inside
    // the existing private service runtime, never the repository/public assets.
    const workdir = join(homedir(), "YilutekServices/DayTradeTycoon/fubon-readonly/work");
    try { mkdirSync(workdir, { recursive: true, mode: 0o700 }); }
    catch { this.fail("LOCAL_SETUP_REQUIRED", true); return; }
    // Inherit OS essentials only, never the web server's auth or database secrets.
    // The worker imports packaged helpers from the immutable release. Python
    // must not create __pycache__ there and change the verified release tree.
    const env: NodeJS.ProcessEnv = { PYTHONUTF8: "1", PYTHONUNBUFFERED: "1", PYTHONDONTWRITEBYTECODE: "1" };
    for (const key of ["SystemRoot", "WINDIR", "PATH", "Path", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA"])
      if (process.env[key]) env[key] = process.env[key];
    const child = spawn(this.config.python, ["-X", "utf8", this.config.worker, "--credentials", this.config.credentials, ...(this.config.verification ? ["--verification"] : [])],
      { windowsHide: true, env, cwd: workdir, stdio: "pipe" });
    this.child = child;
    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (this.child !== child) return;
      buffer += chunk;
      if (buffer.length > 262144) { this.fail("WORKER_PROTOCOL"); return; }
      let at: number;
      while ((at = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
        if (!line.startsWith(FEED_PREFIX)) continue; // never forward SDK output
        try { this.message(epoch, JSON.parse(line.slice(FEED_PREFIX.length))); }
        catch { this.fail("WORKER_PROTOCOL"); return; }
        if (this.child !== child) return;
      }
    });
    child.stderr.resume();
    child.stdin.on("error", () => { if (this.child === child) this.fail("WORKER_PIPE"); });
    child.on("error", () => { if (this.child === child) this.fail("WORKER_START"); });
    child.on("exit", () => { if (this.child === child) this.fail("WORKER_EXIT"); });
    this.send();
  }
  private message(epoch: number, input: unknown) {
    if (epoch !== this.generation || !input || typeof input !== "object") return;
    const m = input as Record<string, unknown>;
    this.pulse = performance.now();
    if (m.kind === "fatal") { this.fail(["SDK_VERSION", "CREDENTIALS", "LOGIN_FAILED"].includes(String(m.code)) ? String(m.code) : "LOGIN_FAILED", true); return; }
    if (m.kind === "fault") { this.fail("CONNECTION_LOST"); return; }
    if (m.kind === "heartbeat" || m.kind === "quote" || m.kind === "ack") {
      this.brokerAt = performance.now();
      if (this.state !== "connected") { this.state = "connected"; this.stable = this.brokerAt; }
    }
    if (m.kind === "state" && m.state === "syncing" && this.state !== "connected") this.state = "syncing";
    if ((m.kind === "ack" || m.kind === "unack") && typeof m.channel === "string" && typeof m.symbol === "string")
      this.store.ack(epoch, m.channel, m.symbol, m.kind === "unack");
    if (m.kind === "quote" && typeof m.channel === "string") this.store.receive(epoch, m.channel, m.data, Date.now());
    if (m.kind === "bounds") this.store.setBounds(m.data);
    if (m.kind === "symbol_error" && typeof m.symbol === "string" && this.symbols().includes(m.symbol))
      this.store.symbolError(m.symbol, m.code === "SNAPSHOT_RATE_LIMIT" ? "SNAPSHOT_RATE_LIMIT" : "SNAPSHOT_FAILED");
  }
  private fail(code: string, fatal = false) {
    this.stopChild(); this.store.reset(++this.generation);
    this.reason = code;
    this.attempts++;
    if (fatal || this.attempts > 8) { this.state = "stopped"; this.retryAt = null; return; }
    this.state = "reconnecting";
    this.retryAt = Date.now() + Math.min(60_000, 5000 * 2 ** Math.min(4, this.attempts - 1)) + Math.floor(Math.random() * 3000);
  }
  private stopChild() {
    const child = this.child; this.child = null;
    if (child) { child.stdin.end(); setTimeout(() => { if (child.exitCode === null) child.kill(); }, 1500).unref(); }
  }
  close() {
    this.stopChild(); this.store.reset(++this.generation);
    if (this.timer) clearInterval(this.timer);
    this.timer = null; this.leases.clear();
    // Idle/shutdown does not reset an authentication lock or retry budget.
    if (this.state !== "stopped") this.state = "disabled";
  }
}
const runtime = globalThis as typeof globalThis & { __fubonFeed?: FubonFeed };
export function readFubonFeed(client: string, symbols: string[]) {
  if (!runtime.__fubonFeed) {
    runtime.__fubonFeed = new FubonFeed(feedConfig());
    process.once("exit", () => runtime.__fubonFeed?.close());
    process.on("message", message => { if (message && typeof message === "object" && "type" in message && message.type === "shutdown") runtime.__fubonFeed?.close(); });
  }
  return runtime.__fubonFeed.touch(client, symbols);
}
