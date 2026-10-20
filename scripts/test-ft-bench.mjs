import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile('src/application/twin/ftBenchPlant.ts', 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { BENCH_HOME, advanceBenchPlant, benchFrame } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
assert.deepEqual(advanceBenchPlant(BENCH_HOME, 0, 0, 200, false, [50, 350, 180, 60]), BENCH_HOME);
assert.deepEqual(advanceBenchPlant(BENCH_HOME, 15, 15, 200, true, [50, 350, 180, 60]), BENCH_HOME);
const moving = advanceBenchPlant(BENCH_HOME, 5, 1, 200, false, [50, 300, 0, 50]);
assert(moving[0] > 0 && moving[2] < 60);
assert.equal(moving[1], 300);
assert.equal(moving[3], 50);
assert.equal(advanceBenchPlant(BENCH_HOME, 1, 1, 5000, false, [100, 300, 60, 50])[0], 6.25);
assert.equal(advanceBenchPlant(BENCH_HOME, 1, 1, 250, false, [0.1, 300, 60, 50])[0], 0.1);
const frame = benchFrame(BENCH_HOME, 65536, 1, 8, true, true);
assert.equal(frame.length, 14);
assert.deepEqual(frame.slice(0, 6), [5, 1, 1, 8, 3, 0]);
for (let i = 0; i < 4; i++) {
  const b = Buffer.alloc(4);
  b.writeUInt16BE(frame[6 + i * 2], 0);
  b.writeUInt16BE(frame[7 + i * 2], 2);
  assert.equal(b.readFloatBE(0), BENCH_HOME[i]);
}
// Follow all poses using PLC-like run/direction masks; no target teleportation.
const scl = await readFile('plc/siemens-s7-1200/cobot-6dof-smart-demo/cobot_6dof_iot_condition_monitoring_s7_1200_compatible.scl', 'utf8');
const cases = [...scl.matchAll(/CASE #Step OF([\s\S]*?)END_CASE;/g)].map(m => m[1]);
assert.equal(cases.length, 2);
assert.equal(cases[0], cases[1], 'Bench must use the same 16 targets as existing AUTO');
const targets = [...cases[0].matchAll(/\d+:\s*#Target\[1\] := (-?[\d.]+);\s*#Target\[2\] := (-?[\d.]+);\s*#Target\[3\] := (-?[\d.]+);\s*#Target\[4\] := (-?[\d.]+);/g)].map(m => m.slice(1).map(Number));
assert.equal(targets.length, 16);
let pose = [...BENCH_HOME];
for (const target of targets) {
  for (let tick = 0; tick < 200; tick++) {
    let run = 0, direction = 0;
    target.forEach((v, i) => { if (Math.abs(v - pose[i]) > 0.001) run |= 1 << i; if (v > pose[i]) direction |= 1 << i; });
    pose = advanceBenchPlant(pose, run, direction, 200, false, target);
  }
  assert(pose.every((v, i) => Math.abs(v - target[i]) < 0.001));
}
console.log('Bench tests passed: frame layout, fault controls, bounded integration, identical AUTO poses and full simulated trajectory. Not a TIA compilation.');
