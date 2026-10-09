import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const port = Number(process.env.OBSERVABILITY_TEST_PORT ?? 5228);
const viteBin = resolve('node_modules', 'vite', 'bin', 'vite.js');
const vite = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: resolve('.'), stdio: 'inherit', shell: false });
const waitForServer = async () => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    try { if ((await fetch(`http://127.0.0.1:${port}`)).ok) return; } catch { /* Vite is starting. */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 180));
  }
  throw new Error('Timed out waiting for Vite observability test server.');
};

const sessionId = `regression-observability-${Date.now()}`;
try {
  await waitForServer();
  const event = { schemaVersion: 1, id: 'regression-1', sessionId, sequence: 1, timestampUtc: new Date().toISOString(), stage: 'plc-rx', status: 'ok', source: 'OpenPLC', destination: 'TwinAxis', operation: 'FC03 holding-register read', protocol: 'Modbus TCP', registerRange: '%QW100..105', registers: [1, 2, 3, 4, 5, 6], joints: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6] };
  const response = await fetch(`http://127.0.0.1:${port}/__observability/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, events: [event] }) });
  const payload = await response.json();
  if (!response.ok || !payload.ok || payload.count !== 1) throw new Error(`Observability endpoint rejected event: ${JSON.stringify(payload)}`);
  const stored = await readFile(resolve(payload.path), 'utf8');
  if (!stored.includes('FC03 holding-register read') || !stored.includes('QW100..105')) throw new Error('Stored NDJSON does not contain the event fields.');
  console.log(`Observability regression passed: ${payload.path}`);
} finally {
  if (!vite.killed) vite.kill('SIGTERM');
}
