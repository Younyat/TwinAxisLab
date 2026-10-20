import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const folder = new URL('../plc/siemens-s7-1200/cobot-6dof-smart-demo/', import.meta.url);
const source = readFileSync(new URL('RobotArmVirtualCommissioning.scl', folder), 'utf8');
const body = readFileSync(new URL('RobotArmControl_VIRTUAL_PEGAR_EN_FB.txt', folder), 'utf8');
for (const text of [source, body]) {
  for (const field of ['SensorPolicy', 'SensorValid', 'SensorQualityBits', 'SensorAgeMs', 'TemperatureCx100', 'HumidityRHx100', 'GyroDpsx100']) {
    assert.ok(!text.includes('"RobotHolding".Struct.' + field + ' :='), field + ' must remain platform-owned');
  }
}
// Evaluate the actual SCL integration guard, not a separate policy model.
const guard = source.slice(source.indexOf('((#ModeState <> 1) OR'), source.indexOf(' THEN\n    FOR #i'));
assert.ok(guard.length > 100);
const expression = guard
  .replace(/\("RobotHolding"\.Struct.SensorQualityBits AND UINT#17\)/g, '(r.SensorQualityBits & 17)')
  .replace(/"RobotHolding"\.Struct\./g, 'r.')
  .replace(/#ModeState/g, 'mode')
  .replace(/#MotionIdleTimer\.Q/g, 'settled')
  .replace(/UINT#/g, '')
  .replace(/<>/g, '!==')
  .replace(/(?<![<>!=])=(?!=)/g, '===')
  .replace(/\bAND\b/g, '&&')
  .replace(/\bOR\b/g, '||');
const allowed = new Function('r', 'mode', 'settled', 'return ' + expression);
const healthy = { SensorPolicy: 0, SensorValid: 1, SensorQualityBits: 17, SensorAgeMs: 0, TemperatureCx100: 2200, HumidityRHx100: 4500, GyroDpsx100: 0 };
let cases = 0;
function check(changes, mode, settled, expected) {
  assert.equal(allowed({ ...healthy, ...changes }, mode, settled), expected, JSON.stringify(changes));
  cases++;
}
check({}, 1, true, true);
check({}, 1, false, false);
check({ GyroDpsx100: 299 }, 1, true, true);
check({ GyroDpsx100: 300 }, 1, true, false);
check({ SensorPolicy: 1 }, 1, true, false);
check({ SensorPolicy: 1, GyroDpsx100: 300 }, 1, false, true);
check({ SensorPolicy: 1, GyroDpsx100: 299 }, 1, true, false);
for (const invalid of [{ SensorValid: 0 }, { SensorQualityBits: 1 }, { SensorAgeMs: 2501 }, { SensorPolicy: 2 }, { TemperatureCx100: 4500 }, { HumidityRHx100: 7500 }, { GyroDpsx100: 12000 }]) {
  check(invalid, 1, true, false);
}
check({ SensorValid: 0, SensorPolicy: 1 }, 4, false, true);
check({ SensorValid: 0 }, 3, false, true);
assert.ok(source.includes('"RobotHolding".Struct.SimulationMode := UINT#1;'));
assert.ok(source.includes('"RobotHolding".Struct.PhysicalOutputEnable := UINT#0;'));
console.log(cases + ' AUTO integration guard cases passed; platform-owned telemetry and manual independence checked. This does not execute a Siemens CPU.');
