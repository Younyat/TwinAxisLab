import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

async function filesUnder(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(path));
    else result.push(path);
  }
  return result;
}
const simulation = 'openplc/cobot-6dof-smart-demo/FB_FT511938_openplc.st';
const physical = 'plc/siemens-s7-1200/cobot-6dof-smart-demo/cobot_6dof_iot_condition_monitoring_s7_1200_compatible.scl';
assert((await stat(simulation)).isFile(), 'OpenPLC active source missing');
assert((await stat(physical)).isFile(), 'Siemens active source missing');
for (const path of await filesUnder('openplc')) {
  assert(!/\.scl(?:$|\.)/i.test(path), `Siemens source under OpenPLC: ${path}`);
}
for (const path of await filesUnder('scripts')) {
  if (!path.endsWith('.mjs') || path.endsWith('validate-plc-source-layout.mjs')) continue;
  const text = await readFile(path, 'utf8');
  assert(!/openplc[/\\]cobot-6dof-smart-demo[/\\][^'"\r\n]*\.scl/.test(text), `Obsolete physical source path: ${path}`);
}
const [st, scl] = await Promise.all([readFile(simulation, 'utf8'), readFile(physical, 'utf8')]);
assert(st.includes('%QW0'), 'OpenPLC source is not the expected located-register POU');
assert(scl.includes('FUNCTION_BLOCK "RobotArmControl"'), 'Physical source is not the expected TIA block');
console.log('PLC source separation passed: OpenPLC ST and Siemens SCL have independent directories.');
