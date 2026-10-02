import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Executing Vite's JS entry avoids Windows .cmd shell quoting and spawn errors.
const cli = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, VITE_AUTH_ENABLED: "true" },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code, signal) => { process.exitCode = signal ? 1 : (code ?? 1); });
