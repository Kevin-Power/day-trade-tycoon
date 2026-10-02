import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.argv[2];
try {
  const config = JSON.parse(readFileSync(join(root, 'hosting.json'), 'utf8').replace(/^\uFEFF/, ''));
  console.log(JSON.stringify({ root, configKeys: Object.keys(config) }));
} catch (error) {
  console.log(JSON.stringify({ root, error: error.code ?? error.name, message: error.message }));
  process.exitCode = 1;
}
