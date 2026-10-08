// Starts the API against a brand-new embedded database for each e2e run.
import { rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const serverDir = resolve(import.meta.dirname, '../../server');
rmSync(resolve(serverDir, '.pgdata-e2e'), { recursive: true, force: true });
const child = spawn('npx', ['tsx', 'src/main.ts'], { cwd: serverDir, stdio: 'inherit', shell: true, env: process.env });
const stop = () => child.kill();
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
child.on('exit', (code) => process.exit(code ?? 0));
