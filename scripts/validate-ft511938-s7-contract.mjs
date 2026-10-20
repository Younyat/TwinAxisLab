import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const sourcePath = resolve('plc', 'siemens-s7-1200', 'cobot-6dof-smart-demo', 'cobot_6dof_iot_condition_monitoring_s7_1200_compatible.scl');
const original = await readFile(sourcePath, 'utf8');
const source = original.replaceAll('"RobotHolding".Struct.', '#HR.');
const fail = (message) => { throw new Error(message); };

const expectedFields = [
  ['Cmd', 1, 0], ['Enable', 1, 1], ['JogAxis', 1, 2], ['JogDirection', 1, 3],
  ['JogEnable', 1, 4], ['HeartbeatSequence', 1, 5], ['ManualTarget1', 2, 6],
  ['ManualTarget2', 2, 8], ['ManualTarget3', 2, 10], ['ManualTarget4', 2, 12],
  ['SensorPolicy', 1, 14], ['SensorValid', 1, 15], ['SensorQualityBits', 1, 16],
  ['SensorAgeMs', 1, 17], ['TemperatureCx100', 1, 18], ['HumidityRHx100', 1, 19],
  ['GyroDpsx100', 1, 20], ['SafetyOK', 1, 21], ['DrivesReady', 1, 22],
  ['CommFresh', 1, 23], ['SensorOK', 1, 24], ['HomedMask', 1, 25],
  ['MinLimitMask', 1, 26], ['MaxLimitMask', 1, 27], ['WiringVerified', 1, 28],
  ['PhysicalOutputEnable', 1, 29], ['Pos1', 2, 30], ['Pos2', 2, 32],
  ['Pos3', 2, 34], ['Pos4', 2, 36], ['Target1', 2, 38], ['Target2', 2, 40],
  ['Target3', 2, 42], ['Target4', 2, 44], ['Status', 1, 46], ['ActiveMode', 1, 47],
  ['ActiveStep', 1, 48], ['AlarmCode', 1, 49], ['Done', 1, 50], ['IoTAlarmCode', 1, 51],
  ['ConditionState', 1, 52], ['SpeedPermille', 1, 53], ['CmdQ1toQ8Mask', 1, 54],
  ['RunMask', 1, 55], ['DirectionMask', 1, 56], ['HeartbeatEcho', 1, 57],
  ['SimulationMode', 1, 58], ['StartupReady', 1, 59], ['DoneCounter', 1, 60],
];

const typeBody = source.match(/TYPE\s+"UDT_FT511938_HR0_60"[\s\S]*?STRUCT([\s\S]*?)END_STRUCT;/i)?.[1];
if (!typeBody) fail('UDT_FT511938_HR0_60 was not found.');
const actualFields = [...typeBody.matchAll(/^\s*(\w+)\s*:\s*(Int|UInt|Real)\s*;/gim)]
  .map((match) => [match[1], match[2].toLowerCase() === 'real' ? 2 : 1]);
if (actualFields.length !== expectedFields.length) fail(`Expected ${expectedFields.length} UDT fields, found ${actualFields.length}.`);
let offset = 0;
for (let index = 0; index < expectedFields.length; index += 1) {
  const [expectedName, expectedWords, expectedOffset] = expectedFields[index];
  const [actualName, actualWords] = actualFields[index];
  if (actualName !== expectedName || actualWords !== expectedWords || offset !== expectedOffset) {
    fail(`HR layout mismatch at ${expectedName}: actual ${actualName} at HR${offset}, expected HR${expectedOffset}.`);
  }
  offset += actualWords;
}
if (offset !== 61) fail(`UDT occupies ${offset} words instead of 61.`);

const expectedTargets = [
  [-68.754936, 300, 180, 60], [-68.754936, 150, 180, 60],
  [-68.754936, 150, 180, 25], [-68.754936, 320, 180, 25],
  [80.214088, 320, 0, 25], [80.214088, 180, 0, 25],
  [80.214088, 180, 0, 60], [80.214088, 300, 0, 60],
  [80.214088, 180, 0, 60], [80.214088, 180, 0, 25],
  [80.214088, 320, 0, 25], [-68.754936, 320, 180, 25],
  [-68.754936, 150, 180, 25], [-68.754936, 150, 180, 60],
  [-68.754936, 300, 180, 60], [0, 300, 60, 50],
];
for (let step = 1; step <= expectedTargets.length; step += 1) {
  const line = source.match(new RegExp(`\\n\\s*${step}:\\s*([\\s\\S]*?)(?=\\n\\s*(?:\\d+:|ELSE|END_CASE))`))?.[1];
  if (!line) fail(`AUTO step ${step} was not found.`);
  const values = [...line.matchAll(/#Target\[(\d)\]\s*:=\s*(-?\d+(?:\.\d+)?)/g)]
    .sort((left, right) => Number(left[1]) - Number(right[1]))
    .map((match) => Number(match[2]));
  if (values.length !== 4 || values.some((value, index) => Math.abs(value - expectedTargets[step - 1][index]) > 1e-6)) {
    fail(`AUTO step ${step} differs from Smart Demo: [${values.join(', ')}].`);
  }
}

for (const required of [
  '{ S7_Optimized_Access := \'FALSE\' }',
  '#HR.SimulationMode := UINT#0',
  '#HR.StartupReady := UINT#1',
  '#HeartbeatWatchdog(',
  '#ManualPermitted := #PhysicalPermitted',
  '#AutoPermitted := #ManualPermitted',
  '#OutputGate := #Permitted',
  'MB_SERVER',
]) if (!source.includes(required)) fail(`Required S7 contract fragment missing: ${required}`);

if (source.includes('%QW') || source.includes('Current1 :=')) {
  fail('The physical S7 source contains an OpenPLC mapping or simulated feedback assignment.');
}
const benchStart = source.indexOf('IF #HR.Cmd = 5 THEN');
const benchEnd = source.indexOf('RETURN;', benchStart);
if (benchStart < 0 || benchEnd < benchStart) fail('Missing isolated Cmd=5 branch.');
const bench = source.slice(benchStart, benchEnd);
if (!bench.includes('#HR.SimulationMode := UINT#1') || !bench.includes('#HR.PhysicalOutputEnable := UINT#0')) fail('Bench identity/output inhibition missing.');
if (/#(?:Run|CmdQ1toQ8|DirectionPositive)\[[^\]]+\]\s*:=/.test(bench)) fail('Bench assigns a physical FB output.');
if (source.slice(0, benchStart).includes('#HR.SimulationMode := UINT#1') || source.slice(benchEnd).includes('#HR.SimulationMode := UINT#1')) fail('Simulation identity escapes bench branch.');

const code = source.replace(/\/\/[^\n]*/g, '');
const tokenCount = (pattern) => (code.match(pattern) ?? []).length;
if (!/FUNCTION_BLOCK "RobotArmControl"/.test(original)) fail('Expected existing RobotArmControl FB name.');
if (!/DATA_BLOCK "RobotHolding"/.test(original)) fail('Expected existing RobotHolding DB name.');
if (/VAR_IN_OUT/.test(original)) fail('Direct RobotHolding source must not retain unused HR interface.');
if (!/END_VAR\s+BEGIN\s+"RobotHolding"/.test(original)) fail('Missing FB BEGIN before executable body.');
if (!/END_FUNCTION_BLOCK/.test(original)) fail('Missing END_FUNCTION_BLOCK.');
if (!/ELSIF #ManualPhase = 4 THEN\s+#Target\[2\] := #CapturedTarget\[2\]/.test(source)) fail('GOTO descent does not command the captured height.');
if (!/IF ABS\(#Target\[2\] - #PosMeasured\[2\]\) > #Tol\[2\] THEN\s+#ActiveAxis := 2/.test(source)) fail('HOME does not establish height first.');
if (tokenCount(/\bIF\b/g) !== tokenCount(/\bEND_IF\b/g)) fail('Unbalanced IF/END_IF tokens.');
if (tokenCount(/\bFOR\b/g) !== tokenCount(/\bEND_FOR\b/g)) fail('Unbalanced FOR/END_FOR tokens.');
if (tokenCount(/\bCASE\b/g) !== tokenCount(/\bEND_CASE\b/g)) fail('Unbalanced CASE/END_CASE tokens.');

console.log('FT511938 S7 contract valid: HR0..60 = 61 words, 16 Smart Demo transitions, measured feedback and physical safety gates present.');
