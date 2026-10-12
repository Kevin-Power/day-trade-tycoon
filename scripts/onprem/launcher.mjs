import { fork, execFileSync } from 'node:child_process';
import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const wait = ms => new Promise(done => setTimeout(done, ms));

export async function filesIn(root, directory = root) {
  const files = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, item.name);
    const stat = await lstat(file);
    if (stat.isSymbolicLink()) throw new Error('不接受符號連結或重新導向的檔案。');
    if (stat.isDirectory()) files.push(...await filesIn(root, file));
    else if (stat.isFile()) files.push(relative(root, file).split(sep).join('/'));
    else throw new Error('資料夾含不支援的特殊檔案。');
  }
  return files.sort();
}

export async function verifyPackage(root) {
  const manifest = JSON.parse(await readFile(join(root, 'package-manifest.json'), 'utf8'));
  if (manifest.format !== 1 || !Array.isArray(manifest.files) || manifest.files.length < 1)
    throw new Error('部署包清單格式錯誤。');
  const listed = new Set();
  for (const entry of manifest.files) {
    if (typeof entry.path !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('部署包檔案清單損壞。');
    const full = resolve(root, entry.path);
    const rel = relative(root, full);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || listed.has(entry.path) || /^(data|backups)(\/|$)/.test(entry.path))
      throw new Error('部署包包含不合法路徑。');
    listed.add(entry.path);
    if (!(await lstat(full)).isFile() || sha256(await readFile(full)) !== entry.sha256)
      throw new Error(`部署包檔案核對失敗：${entry.path}`);
  }
  const actual = [];
  for (const item of await readdir(root, { withFileTypes: true })) {
    if (['data', 'backups', 'package-manifest.json'].includes(item.name)) continue;
    const full = join(root, item.name);
    if ((await lstat(full)).isSymbolicLink()) throw new Error('部署包包含符號連結。');
    actual.push(...item.isDirectory() ? await filesIn(root, full) : [item.name]);
  }
  if (actual.length !== listed.size || actual.some(path => !listed.has(path))) throw new Error('部署包有未列入清單的程式檔案。');
  for (const required of ['server/index.mjs', 'server/_libs/pglite.wasm', 'app-runner.mjs', 'launcher.mjs'])
    if (!listed.has(required)) throw new Error(`部署包缺少 ${required}`);
  return manifest;
}

export function validateConfig(config) {
  if (config?.format !== 1 || !Number.isInteger(config.port) || config.port < 1024 || config.port > 65535 || config.port === 8790 ||
    typeof config.ownerEmail !== 'string' || config.ownerEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.ownerEmail) ||
    typeof config.classCode !== 'string' || !/^[A-Za-z0-9_-]{2,32}$/.test(config.classCode) ||
    !/^[a-f0-9]{64}$/.test(config.authSecret) || !/^[a-f0-9]{64}$/.test(config.setupToken) ||
    !/^[a-f0-9]{24}$/.test(config.gateCode) || !/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(config.gateHash))
    throw new Error('地端設定格式錯誤；保留 data 資料夾並修復設定，不會自動重設帳號或秘密。');
  return config;
}

export async function initialize(root, { ownerEmail, classCode = 'LOCAL', port = 18787 }) {
  const gateCode = randomBytes(12).toString('hex');
  const salt = randomBytes(16).toString('hex');
  const config = validateConfig({ format: 1, port, ownerEmail: ownerEmail.trim().toLowerCase(), classCode,
    authSecret: randomBytes(32).toString('hex'), setupToken: randomBytes(32).toString('hex'), gateCode,
    gateHash: ['scrypt', salt, scryptSync(gateCode, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex')].join('$') });
  const data = join(root, 'data');
  await mkdir(data, { mode: 0o700 });
  if (process.platform === 'win32') {
    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'protect-data.ps1'), '-DataPath', data],
      { windowsHide: true, stdio: 'pipe' });
  }
  await writeFile(join(data, 'config.json'), JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await writeAccessGuide(root, config);
  return config;
}

async function writeAccessGuide(root, config) {
  const origin = `http://127.0.0.1:${config.port}`;
  const text = `此檔案含這份地端教室的入場資訊，請勿轉寄。\n\n教室：${origin}\n入場碼：${config.gateCode}\n班級代碼：${config.classCode}\n管理講師 Email：${config.ownerEmail}\n\n首次設定：${origin}/setup#token=${config.setupToken}\n先輸入入場碼，再由講師設定自己的姓名與密碼。初始化只可完成一次。\n後續登入：${origin}/login\n\n停止：在啟動視窗按 Enter，等待「資料庫已正常關閉」。\n備份：停止後執行 BACKUP.bat，或 node launcher.mjs backup。\n`;
  await writeFile(join(root, 'data', '首次使用.txt'), '\uFEFF' + text, { mode: 0o600 });
}

export function applicationEnvironment(root, config, inherited = process.env) {
  validateConfig(config);
  const system = Object.fromEntries(Object.entries(inherited).filter(([key]) =>
    /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|HOME|APPDATA|LOCALAPPDATA|COMSPEC|PATHEXT|LANG|LC_ALL|TZ)$/i.test(key)));
  return { ...system, NODE_ENV: 'production', HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1',
    PORT: String(config.port), NITRO_PORT: String(config.port), BETTER_AUTH_URL: `http://127.0.0.1:${config.port}`,
    BETTER_AUTH_SECRET: config.authSecret, DATABASE_URL: '', PGLITE_DATA_DIR: join(root, 'data', 'pglite'),
    CLASSROOM_LOCAL_ONLY: 'true', CLASSROOM_AUTH_ENABLED: 'true', VITE_AUTH_ENABLED: 'true', CLASSROOM_TRUST_PROXY: 'false',
    CLASSROOM_GATE_PASSWORD_HASH: config.gateHash, CLASSROOM_CODE: config.classCode, TEACHER_EMAILS: config.ownerEmail,
    ADMIN_SETUP_EMAIL: config.ownerEmail, ADMIN_SETUP_TOKEN: config.setupToken, CLASSROOM_DOWNLOADS_DIR: join(root, 'downloads') };
}

export async function acquireLock(root) {
  // An OS-owned listening socket prevents two launchers or a live backup from sharing this data.
  const key = sha256(process.platform === 'win32' ? root.toLowerCase() : root).slice(0, 28);
  const address = process.platform === 'win32' ? `\\\\.\\pipe\\daytrade-onprem-${key}` : join(root, '.onprem-lock.sock');
  const server = createServer(socket => socket.end());
  try { await new Promise((done, fail) => { server.once('error', fail); server.listen(address, done); }); }
  catch { throw new Error('這份教室正在執行或備份，或鎖無法取得；請先正常停止。'); }
  return () => new Promise((done, fail) => server.close(error => error ? fail(error) : done()));
}

async function assertDataRoot(root) {
  if ((await lstat(join(root, 'data'))).isSymbolicLink()) throw new Error('data 必須是這份部署包內的實體資料夾。');
  if ((await lstat(join(root, 'data', 'config.json'))).isSymbolicLink()) throw new Error('設定檔不可是連結。');
}

export async function startServer(root, config) {
  await assertDataRoot(root);
  const env = applicationEnvironment(root, config);
  const vacant = createServer();
  try { await new Promise((done, fail) => { vacant.once('error', fail); vacant.listen(config.port, '127.0.0.1', done); }); }
  catch { throw new Error(`連接埠 ${config.port} 已被使用；不會停止其他服務。`); }
  await new Promise(done => vacant.close(done));
  const child = fork(join(root, 'app-runner.mjs'), [join(root, 'server', 'index.mjs')], {
    cwd: root, env, windowsHide: true, detached: true, stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  let stopping;
  const exited = new Promise(done => child.once('exit', (code, signal) => done({ code, signal })));
  const stop = () => stopping ??= (async () => {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('服務已非預期結束，尚未確認資料庫正常關閉。');
    let timer;
    try {
      await new Promise((done, fail) => {
        timer = setTimeout(() => fail(new Error('資料庫關閉確認逾時；請保留資料與日誌，勿直接備份。')), 25000);
        child.on('message', message => {
          if (message?.type === 'shutdown-complete') done();
          if (message?.type === 'shutdown-error') fail(new Error('資料庫正常關閉失敗。'));
        });
        child.send({ type: 'shutdown' }, error => { if (error) fail(new Error('無法送出正常關閉請求。')); });
      });
      console.log('資料庫已正常關閉。');
      process.send?.({ type: 'shutdown-complete' });
    } finally { clearTimeout(timer); child.kill(); await exited; }
  })();
  try {
    const deadline = Date.now() + 35000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('地端服務啟動失敗，請查看上方錯誤。');
      try {
        const response = await fetch(env.BETTER_AUTH_URL + '/api/health', { signal: AbortSignal.timeout(1500) });
        if (response.ok && (await response.json()).ok) return { origin: env.BETTER_AUTH_URL, stop, exited };
      } catch { /* wait for first database migration */ }
      await wait(150);
    }
    throw new Error('地端服務未能在期限內通過健康檢查。');
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) await stop().catch(() => undefined);
    throw error;
  }
}

export async function backup(root) {
  await assertDataRoot(root);
  // The shared launcher lock must be held by the caller. A leftover DB lock is never ignored.
  try { await lstat(join(root, 'data', 'pglite.lock')); throw new Error('尚有資料庫鎖；先啟動並正常停止，確認關閉後再備份。'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const names = await filesIn(join(root, 'data'));
  const id = new Date().toISOString().replace(/[-:.]/g, '');
  const target = join(root, 'backups', id);
  await mkdir(join(root, 'backups'), { recursive: true, mode: 0o700 });
  if ((await lstat(join(root, 'backups'))).isSymbolicLink()) throw new Error('backups 不可是連結。');
  await mkdir(target, { mode: 0o700 });
  if (process.platform === 'win32') execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'protect-data.ps1'), '-DataPath', target], { windowsHide: true, stdio: 'pipe' });
  const files = [];
  for (const path of names) {
    const source = join(root, 'data', path), destination = join(target, 'data', path);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await cp(source, destination, { errorOnExist: true, force: false });
    const digest = sha256(await readFile(source));
    if (sha256(await readFile(destination)) !== digest) throw new Error('備份內容核對失敗；沒有完成標記的資料夾不能作為備份。');
    files.push({ path: 'data/' + path, sha256: digest });
  }
  await writeFile(join(target, 'backup-manifest.json'), JSON.stringify({ complete: true, createdAt: new Date().toISOString(), files }, null, 2), { flag: 'wx', mode: 0o600 });
  return { target, files: files.length };
}

async function main() {
  const root = dirname(fileURLToPath(import.meta.url));
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('請安裝 Node.js 24 或相容的更新版本。');
  const action = process.argv[2] || 'start';
  if (!['start', 'check', 'backup'].includes(action) || process.argv.length > 3) throw new Error('用法：node launcher.mjs start|check|backup');
  const manifest = await verifyPackage(root);
  if (action === 'check') { console.log(`部署包核對通過：${manifest.files.length} 個檔案。`); return; }
  const releaseLock = await acquireLock(root);
  let input;
  try {
    if (action === 'backup') { const result = await backup(root); console.log(`備份完成：${result.target}（${result.files} 個檔案核對通過；含私人資料，請妥善保管）`); return; }
    let config;
    try { config = validateConfig(JSON.parse(await readFile(join(root, 'data', 'config.json'), 'utf8'))); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!process.stdin.isTTY) throw new Error('首次啟動請雙擊 START.bat，依提示輸入管理講師 Email。');
      input = createInterface({ input: process.stdin, output: process.stdout });
      const ownerEmail = await input.question('首次設定，請輸入管理講師 Email：');
      config = await initialize(root, { ownerEmail });
      input.close(); input = undefined;
    }
    await assertDataRoot(root);
    await writeAccessGuide(root, config);
    const app = await startServer(root, config);
    console.log(`當沖大富翁已就緒：${app.origin}\n入場碼與首次講師設定入口：${join(root, 'data', '首次使用.txt')}\n停止時請在此視窗按 Enter，等待資料庫正常關閉後再關視窗。`);
    process.send?.({ type: 'ready', origin: app.origin });
    let requested = false;
    let stopError;
    const stop = () => { requested = true; void app.stop().catch(error => { stopError = error; }); };
    const onMessage = message => { if (message?.type === 'shutdown') stop(); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop); process.on('message', onMessage); process.on('disconnect', stop);
    if (process.stdin.isTTY) {
      input = createInterface({ input: process.stdin, output: process.stdout });
      input.on('line', stop);
    }
    try {
      await app.exited;
      if (!requested) throw new Error('服務非預期停止；尚未確認資料庫正常關閉。');
      await app.stop();
      if (stopError) throw stopError;
    } finally {
      process.off('SIGINT', stop); process.off('SIGTERM', stop); process.off('message', onMessage); process.off('disconnect', stop);
    }
  } finally { input?.close(); await releaseLock(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().then(() => { process.disconnect?.(); }).catch(error => { console.error(error.message); process.exitCode = 1; process.disconnect?.(); });
