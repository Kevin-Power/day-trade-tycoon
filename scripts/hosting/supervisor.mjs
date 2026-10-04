import { spawn, fork } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, appendFileSync, statSync, readdirSync, copyFileSync, lstatSync } from 'node:fs';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { createServer, createConnection } from 'node:net';
import { resolveHostingRuntime } from './runtime-path.mjs';
import { trackOwnedProcess, createOwnedShutdown } from './owned-process.mjs';
import { probeHealth } from './health-check.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(here, '../..');
const command = process.argv[2] ?? 'status';
const runtime = resolveHostingRuntime('DayTradeTycoon');
const stateFile = join(runtime, 'state.json');
const lockFile = join(runtime, 'service.lock');
const requestFile = join(runtime, 'stop-request.json');
const pipeName = `\\\\.\\pipe\\daytrade-tycoon-${createHash('sha256').update(runtime.toLowerCase()).digest('hex').slice(0, 24)}`;
const leases = new Map();
let runLog = null;
let runStage = 'initialization';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (path, fallback = null) => { try { return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')); } catch { return fallback; } };
function atomicJson(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2));
  renameSync(temp, path);
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function activeLock() {
  return new Promise((done, reject) => {
    const socket = createConnection(pipeName); let data = '';
    socket.setTimeout(1500, () => { socket.destroy(); reject(new Error('Runtime ownership probe timed out; refusing to assume it is stopped.')); });
    socket.on('data', (chunk) => { data += chunk; if (data.length > 2048) socket.destroy(new Error('Invalid runtime ownership response.')); });
    socket.once('end', () => { try { done(JSON.parse(data)); } catch { reject(new Error('Invalid runtime ownership response.')); } });
    socket.once('error', (error) => { if (error.code === 'ENOENT' || error.code === 'ECONNREFUSED') done(null); else reject(error); });
  });
}
async function acquireLock(kind) {
  mkdirSync(runtime, { recursive: true });
  const token = randomUUID();
  const owner = { pid: process.pid, token, kind, startedAt: new Date().toISOString() };
  // The OS owns this named-pipe lease; a crash releases it without unsafe PID-file deletion.
  const server = createServer((socket) => socket.end(JSON.stringify(owner)));
  await new Promise((done, reject) => {
    server.once('error', () => reject(new Error('A live service or maintenance operation owns this runtime.')));
    server.listen(pipeName, done);
  });
  leases.set(token, server);
  try { atomicJson(lockFile, owner); } catch (error) { server.close(); leases.delete(token); throw error; }
  return token;
}
function releaseLock(token, { retainOnCleanupFailure = true } = {}) {
  // If record cleanup fails (for example a Windows sharing violation), retain
  // the pipe lease. A shutdown retry must not overwrite a newer owner's state.
  let cleanupError;
  try { if (readJson(lockFile)?.token === token) unlinkSync(lockFile); }
  catch (error) {
    if (retainOnCleanupFailure) throw error;
    cleanupError = error;
  }
  leases.get(token)?.close();
  leases.delete(token);
  if (cleanupError) throw cleanupError;
}
function inside(root, path) { const rel = relative(root, path); return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)); }
function loadConfig() {
  const config = readJson(join(runtime, 'hosting.json'));
  if (!config) throw new Error('Missing hosting.json. Run host.ps1 init and configure the dedicated tunnel.');
  const entry = resolve(config.appEntry ?? join(workspace, '.output/server/index.mjs'));
  if (!inside(workspace, entry) && !inside(join(runtime, 'releases'), entry)) throw new Error('App entry must be inside this workspace or the runtime releases directory.');
  const port = Number(config.port ?? 8790);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port.');
  return { ...config, entry, port, host: '127.0.0.1', healthUrl: `http://127.0.0.1:${port}/api/health` };
}
function appEnvironment(config) {
  const envFile = join(runtime, 'secrets', 'app.env');
  if (!existsSync(envFile)) throw new Error('Missing runtime secrets/app.env.');
  const saved = parseEnv(readFileSync(envFile, 'utf8').replace(/^\uFEFF/, ''));
  if (saved.DATABASE_URL?.trim()) throw new Error('This hosting and backup profile requires local PGlite, not DATABASE_URL.');
  if (saved.BETTER_AUTH_SECRET?.length < 32 || !saved.BETTER_AUTH_SECRET) throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters.');
  if (!saved.BETTER_AUTH_URL?.startsWith('https://')) throw new Error('BETTER_AUTH_URL must be HTTPS.');
  if (!saved.CLASSROOM_GATE_PASSWORD_HASH || saved.CLASSROOM_AUTH_ENABLED !== 'true') throw new Error('Classroom authentication configuration is incomplete.');
  // Only OS essentials are inherited. Repository .env and parent app credentials are ignored.
  const inherited = {};
  for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'Path', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'COMSPEC', 'PATHEXT']) {
    if (process.env[key]) inherited[key] = process.env[key];
  }
  return { ...inherited, ...saved, NODE_ENV: 'production', HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1', PORT: String(config.port), NITRO_PORT: String(config.port), PGLITE_DATA_DIR: join(runtime, 'data', 'pglite'), CLASSROOM_DOWNLOADS_DIR: resolve(dirname(config.entry), '../downloads') };
}
async function health(config) {
  return (await probeHealth(config.healthUrl)).ok;
}
async function portFree(port) {
  return new Promise((done) => {
    const server = createServer();
    server.once('error', () => done(false));
    server.listen(port, '127.0.0.1', () => server.close(() => done(true)));
  });
}
function logger(secrets = []) {
  const logDir = join(runtime, 'logs'); mkdirSync(logDir, { recursive: true });
  return (name, message) => {
    const path = join(logDir, `${name}.log`);
    if (existsSync(path) && statSync(path).size >= 10 * 1024 * 1024) {
      for (let index = 4; index >= 1; index--) {
        const from = `${path}.${index}`; const to = `${path}.${index + 1}`;
        if (existsSync(from)) { if (existsSync(to)) unlinkSync(to); renameSync(from, to); }
      }
      if (existsSync(`${path}.1`)) unlinkSync(`${path}.1`);
      renameSync(path, `${path}.1`);
    }
    let text = String(message);
    for (const secret of secrets) if (secret && secret.length >= 8) text = text.replaceAll(secret, '[redacted]');
    text = text.replace(/(authorization|cookie|set-cookie)\s*[:=][^\r\n]*/gi, '$1: [redacted]');
    appendFileSync(path, `${new Date().toISOString()} ${text.endsWith('\n') ? text : text + '\n'}`);
  };
}
async function run() {
  runLog = logger();
  runLog('supervisor', `Starting supervisor pid=${process.pid}.`);
  runStage = 'loading hosting configuration';
  const config = loadConfig();
  runStage = 'loading protected application environment';
  const env = appEnvironment(config);
  runLog = logger(Object.entries(env).filter(([key]) => /SECRET|PASSWORD|TOKEN|KEY/.test(key)).map(([, value]) => value));
  runStage = 'validating application and tunnel paths';
  if (!existsSync(config.entry)) throw new Error('Production build is missing.');
  if (!config.cloudflaredPath || !existsSync(config.cloudflaredPath) || !config.tunnelConfig || !existsSync(config.tunnelConfig)) throw new Error('Dedicated cloudflared executable/config is not configured.');
  runStage = 'acquiring runtime ownership';
  const lockToken = await acquireLock('service');
  // Logging failure must not abort an exit handler and abandon owned children.
  const log = (name, message) => { try { runLog(name, message); } catch { /* State remains the other diagnostic channel. */ } };
  runStage = 'supervising application and tunnel';
  let app, tunnel, stopping = false, stopped = false, fatal = false, lastCleanShutdown = false;
  let restartCount = 0, healthFailures = 0, lastHealthyAt = null, lastHealthCheck = null;
  const instanceId = randomUUID();
  const recentRestarts = [];
  function state(status, extra = {}) {
    atomicJson(stateFile, { status, instanceId, supervisorPid: process.pid, appPid: app?.pid ?? null, tunnelPid: tunnel?.pid ?? null, port: config.port, updatedAt: new Date().toISOString(), lastHealthyAt, lastHealthCheck, healthFailures, restartCount, lastCleanShutdown, ...extra });
  }
  function watch(child, name) {
    child.stdout?.on('data', (value) => log(name, value));
    child.stderr?.on('data', (value) => log(name, value));
    child.on('error', (error) => log('supervisor', `${name} process error: ${error.code ?? error.name}`));
    child.on('exit', (code, signal) => log('supervisor', `${name} exited (${code ?? signal}).`));
    return trackOwnedProcess(child);
  }
  const running = (child) => child?.running() ?? false;
  async function endTunnel() {
    const owned = tunnel;
    if (!owned) return;
    const result = await owned.stop();
    if (!result.exited) throw new Error('Owned tunnel did not stop.');
    if (tunnel === owned) tunnel = null;
  }
  async function endApp() {
    const owned = app;
    if (!owned) return lastCleanShutdown;
    const result = await owned.stop(true);
    if (!result.exited) throw new Error('Owned application did not stop.');
    if (app === owned) { app = null; lastCleanShutdown = result.clean; }
    return result.clean;
  }
  const stopOwned = createOwnedShutdown({
    endTunnel, endApp,
    childrenRunning: () => running(tunnel) || running(app),
    onStopping(reason) { state('stopping', { reason }); log('supervisor', `Stopping: ${reason}`); },
    onRetry(error, reason, attempt) {
      log('supervisor', `${error.message} Retaining runtime ownership; stop attempt=${attempt}; retrying.`);
      state('stop-failed', { reason, stopAttempt: attempt });
    },
    onStopped(clean, reason) {
      lastCleanShutdown = clean;
      state(lastCleanShutdown ? 'stopped' : 'stopped-unclean', { reason });
      log('supervisor', `Stopped. Database close acknowledged: ${lastCleanShutdown}`);
    },
    releaseOwnership() { releaseLock(lockToken); stopped = true; },
  });
  function stop(reason) {
    stopping = true;
    return stopOwned(reason);
  }
  function startApp() {
    lastCleanShutdown = false;
    app = watch(fork(join(here, 'app-runner.mjs'), [config.entry], { cwd: workspace, env, execPath: process.execPath, execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true }), 'app');
    state('starting');
  }
  function startTunnel() {
    tunnel = watch(spawn(config.cloudflaredPath, ['tunnel', '--config', config.tunnelConfig, '--no-autoupdate', 'run'], { cwd: runtime, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }), 'tunnel');
  }
  process.on('SIGINT', () => { void stop('SIGINT'); });
  process.on('SIGTERM', () => { void stop('SIGTERM'); });
  try {
    if (!(await portFree(config.port))) throw new Error('Local port is occupied; refusing to stop or replace its owner.');
    if (!stopping) startApp();
    let readyDeadline = Date.now() + 90000;
    let nextHealth = 0;
    while (!stopping) {
      const request = readJson(requestFile);
      if (request?.instanceId === instanceId) { await stop('operator'); break; }
      if (!running(app)) {
        await endTunnel();
        if (stopping) break;
        recentRestarts.push(Date.now());
        while (recentRestarts[0] < Date.now() - 300000) recentRestarts.shift();
        if (recentRestarts.length > 5) throw new Error('Application restart budget exhausted (5 per 5 minutes).');
        restartCount++; state('recovering'); await sleep(Math.min(1000 * 2 ** recentRestarts.length, 15000));
        if (stopping) break;
        if (!(await portFree(config.port))) throw new Error('Port occupied after application exit; failing closed.');
        if (stopping) break;
        startApp(); readyDeadline = Date.now() + 90000; healthFailures = 0;
      }
      if (Date.now() >= nextHealth) {
        nextHealth = Date.now() + 10000;
        const checked = await probeHealth(config.healthUrl);
        if (stopping) break;
        lastHealthCheck = { ...checked, checkedAt: new Date().toISOString() };
        if (checked.ok) {
          if (healthFailures) log('supervisor', `Health recovered: durationMs=${checked.durationMs}; previousFailures=${healthFailures}.`);
          healthFailures = 0; lastHealthyAt = new Date().toISOString();
          if (!running(tunnel)) {
            const now = Date.now();
            recentRestarts.push(now);
            while (recentRestarts[0] < now - 300000) recentRestarts.shift();
            if (recentRestarts.length > 5) throw new Error('Tunnel restart budget exhausted.');
            startTunnel();
          }
          state('running');
        } else {
          healthFailures++;
          log('supervisor', `Health failed: kind=${checked.kind}; durationMs=${checked.durationMs}; consecutiveFailures=${healthFailures}${checked.status == null ? '' : `; status=${checked.status}`}.`);
          state('unhealthy');
          if (tunnel) await endTunnel();
          if (stopping) break;
          if (Date.now() > readyDeadline && healthFailures >= 3) {
            log('supervisor', 'Health check failed; flushing and restarting owned application.');
            await endApp();
          }
        }
      }
      await sleep(500);
    }
  } catch (error) {
    fatal = true; log('supervisor', error.message);
    await stop('supervisor-failure');
  } finally {
    if (!stopping) await stop('supervisor-exit');
    while (!stopped) await sleep(100);
  }
  process.exitCode = fatal ? 1 : 0;
}
async function stopCommand() {
  const lock = await activeLock(); const state = readJson(stateFile);
  if (!lock) { console.log('No live supervisor. No process was killed.'); return; }
  if (lock.kind !== 'service' || state?.supervisorPid !== lock.pid) throw new Error('Runtime is owned by maintenance or does not have a matching service state.');
  atomicJson(requestFile, { instanceId: state.instanceId, requestedAt: new Date().toISOString() });
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline && await activeLock()) await sleep(500);
  if (await activeLock()) throw new Error('Graceful stop timed out; supervisor retains ownership and continues stopping. Inspect logs. No unrelated process was killed.');
  console.log(JSON.stringify(readJson(stateFile), null, 2));
}
async function startCommand() {
  const config = loadConfig();
  const lock = await activeLock();
  if (lock) {
    if (lock.kind !== 'service') throw new Error('Runtime maintenance is active.');
    console.log(JSON.stringify({ alreadyRunning: true, healthy: await health(config), state: readJson(stateFile) }, null, 2)); return;
  }
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'run', '--runtime', runtime], { cwd: workspace, detached: true, windowsHide: true, stdio: 'ignore' });
  child.unref();
  const deadline = Date.now() + 95000;
  while (Date.now() < deadline) {
    const state = readJson(stateFile);
    if (state?.supervisorPid === child.pid && state.status === 'running' && await health(config)) { console.log(JSON.stringify(state, null, 2)); return; }
    if (!alive(child.pid)) throw new Error('Supervisor exited. Inspect runtime configuration and logs/supervisor.log.');
    await sleep(500);
  }
  throw new Error('Startup readiness timed out. Inspect runtime logs and status.');
}
async function hashFile(path) { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex'); }
async function copyTree(source, target, manifest, base) {
  const info = lstatSync(source);
  if (info.isSymbolicLink()) throw new Error('Backup refuses reparse points and symbolic links.');
  if (info.isDirectory()) { mkdirSync(target, { recursive: true }); for (const child of readdirSync(source)) await copyTree(join(source, child), join(target, child), manifest, base); return; }
  if (!info.isFile()) throw new Error('Backup encountered a non-regular file.');
  mkdirSync(dirname(target), { recursive: true }); copyFileSync(source, target);
  const sha256 = await hashFile(source);
  if (sha256 !== await hashFile(target) || statSync(source).size !== statSync(target).size) throw new Error('Backup verification failed.');
  manifest.push({ path: relative(base, target).replaceAll('\\', '/'), size: statSync(target).size, sha256 });
}
async function backupCommand() {
  const config = loadConfig(); const token = await acquireLock('backup');
  try {
    if (!(await portFree(config.port))) throw new Error('Application port is still listening. Stop the service before backup.');
    const previous = readJson(stateFile);
    if (previous?.lastCleanShutdown !== true || previous.status !== 'stopped') throw new Error('Backup requires an acknowledged clean database shutdown. Start and stop successfully after a crash before backup.');
    if (!existsSync(join(runtime, 'data', 'pglite'))) throw new Error('Persistent database directory is missing.');
    if (existsSync(join(runtime, 'data', 'pglite.lock'))) throw new Error('Database ownership lock still exists. Refusing to copy potentially active data.');
    const name = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
    const staging = join(runtime, 'backups', `.staging-${name}`); const destination = join(runtime, 'backups', name);
    mkdirSync(staging, { recursive: true }); const files = [];
    for (const part of ['data', 'secrets', 'hosting.json']) {
      const source = join(runtime, part);
      if (existsSync(source)) await copyTree(source, join(staging, part), files, staging);
    }
    atomicJson(join(staging, 'manifest.json'), { format: 1, createdAt: new Date().toISOString(), consistency: 'application-stopped-database-close-acknowledged', sourceRuntime: runtime, files });
    renameSync(staging, destination);
    console.log(JSON.stringify({ backup: destination, files: files.length, verified: true }, null, 2));
  } finally {
    // Maintenance has no owned children or further service-state writes. It can
    // release its lease and report cleanup failure instead of staying alive.
    releaseLock(token, { retainOnCleanupFailure: false });
  }
}
try {
  if (command === 'run') await run();
  else if (command === 'start') await startCommand();
  else if (command === 'stop') await stopCommand();
  else if (command === 'status') {
    const config = loadConfig(); const owner = await activeLock();
    console.log(JSON.stringify({ supervisorRunning: owner?.kind === 'service', runtimeOwner: owner ? { kind: owner.kind, pid: owner.pid } : null, healthy: await health(config), state: readJson(stateFile), runtime }, null, 2));
  }
  else if (command === 'backup') await backupCommand();
  else throw new Error(`Unsupported command: ${command}`);
} catch (error) {
  // Startup failures can precede the normal run loop and its redacted logger.
  // Persist the stage and error type without copying possibly sensitive input.
  if (command === 'run') {
    try { runLog?.('supervisor', `Fatal during ${runStage}: ${error.code ?? error.name ?? 'Error'}.`); } catch { /* Preserve the original failure. */ }
  }
  console.error(`[hosting] ${error.message}`); process.exitCode = 1;
}
