import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { homedir, tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { FubonFeed } from "./fubon-feed.server.ts";

const python = join(homedir(), "YilutekServices/DayTradeTycoon/fetcher/.venv/Scripts/python.exe");

test("FubonFeed's real Python child imports helpers without writing into its release tree", {
  timeout: 10000,
  skip: existsSync(python) ? false : "Local verification Python is unavailable; no broker login is required.",
}, async () => {
  const fixture = mkdtempSync(join(tmpdir(), "fubon-bytecode-test-"));
  const worker = join(fixture, "worker.py"), credentials = join(fixture, "fake-credentials.txt");
  const marker = join(fixture, "import-proof.json");
  writeFileSync(credentials, "offline fixture only", { flag: "wx" });
  writeFileSync(join(fixture, "fixture_helper.py"), "IMPORTED = True\n", { flag: "wx" });
  writeFileSync(worker, [
    "import json, os, sys",
    "from pathlib import Path",
    "import fixture_helper",
    "Path(__file__).with_name('import-proof.json').write_text(json.dumps({",
    "    'helperImported': fixture_helper.IMPORTED,",
    "    'dontWriteBytecode': sys.dont_write_bytecode,",
    "    'environment': os.environ.get('PYTHONDONTWRITEBYTECODE')",
    "}), encoding='utf-8')",
    "print('FUBON_FEED ' + json.dumps({'kind': 'pulse'}), flush=True)",
    "for command in sys.stdin:",
    "    pass",
    "",
  ].join("\n"), { flag: "wx" });
  // Only this temporary worker and fake credentials are passed to FubonFeed;
  // no SDK import, network connection, real credential read or order call.
  const feed = new FubonFeed({ enabled: true, python, worker, credentials });
  let child: ChildProcessWithoutNullStreams | null = null;
  try {
    feed.touch("00000000-0000-4000-8000-000000000001", ["2330"]);
    child = (feed as unknown as { child: ChildProcessWithoutNullStreams | null }).child;
    assert.ok(child, "the actual FubonFeed child must start");
    const deadline = Date.now() + 5000;
    while (!existsSync(marker) && Date.now() < deadline && child.exitCode === null) await delay(25);
    assert.ok(existsSync(marker), "Python must actually import the temporary helper");
    assert.deepEqual(JSON.parse(readFileSync(marker, "utf8")), {
      helperImported: true, dontWriteBytecode: true, environment: "1",
    });
    assert.equal(existsSync(join(fixture, "__pycache__")), false);
    assert.equal(existsSync(join(fixture, "fixture_helper.pyc")), false);
  } finally {
    feed.close();
    const deadline = Date.now() + 3000;
    while (child && child.exitCode === null && child.signalCode === null && Date.now() < deadline) await delay(25);
    assert.ok(!child || child.exitCode !== null || child.signalCode !== null, "the owned fixture child must stop before cleanup");
    const cleanup = resolve(fixture);
    assert.equal(dirname(cleanup), resolve(tmpdir()));
    assert.ok(basename(cleanup).startsWith("fubon-bytecode-test-"));
    rmSync(cleanup, { recursive: true, force: true });
  }
});
