import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve('.');
const helperPath = resolve(root, 'src/application/twin/plcBidirectionalControl.ts');
const contractPath = resolve(root, 'src/application/twin/ft511938PlcContract.ts');
const appPath = resolve(root, 'src/presentation/App.tsx');
const rigPath = resolve(root, 'src/application/kinematics/professionalRobotRig.ts');
const pouPath = resolve(root, 'openplc/cobot-6dof-smart-demo/FB_FT511938_openplc.st');

const helper = readFileSync(helperPath, 'utf8');
const contract = readFileSync(contractPath, 'utf8');
const app = readFileSync(appPath, 'utf8');
const rig = readFileSync(rigPath, 'utf8');
const pou = readFileSync(pouPath, 'utf8');
const failures = [];

const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

const expectText = (source, text, message) => expect(source.includes(text), `${message}: missing ${JSON.stringify(text)}`);
const expectCount = (source, text, minimum, message) => {
  const count = source.split(text).length - 1;
  expect(count >= minimum, `${message}: expected at least ${minimum}, got ${count}`);
};

// OpenPLC's variable-table importer rejects standalone // comments, even
// though the ST compiler accepts them. Keep the two-pane source importable.
const declarations = pou.match(/^[ \t]*VAR[ \t]*\r?\n([\s\S]*?)^[ \t]*END_VAR[ \t]*\r?$/m);
expect(Boolean(declarations), 'FT POU has a separate VAR block for the editor');
expect(!/^\s*\/\//m.test(declarations?.[1] ?? ''), 'FT declarations contain no standalone line comments');

// The adapter must publish an observable scan state, not just a TCP socket.
expectText(pou, 'StartupReady AT %QW59', 'FT POU startup diagnostic');
expectText(pou, 'StartupReady := 1;', 'FT POU writes startup diagnostic during scan');
expectText(contract, "offset: 59, name: 'StartupReady'", 'FT contract maps HR59');
expectText(contract, 'startupReady: boolean', 'FT snapshot exposes startupReady');
expectText(contract, 'flag(words, 59)', 'FT decoder reads HR59');
expectText(app, 'POU scan stopped (HR59 StartupReady=0)', 'dashboard exposes stopped POU reason');
expectText(app, 'ft511938Snapshot.startupReady', 'poller gates FT runtime on startup state');

// The local simulation bootstrap is allowed only in the simulator adapter.
expectText(pou, 'SimulationMode := 1;', 'OpenPLC simulator bootstrap');
expectText(pou, 'Pos2 < 128.0', 'bootstrap detects an uninitialized J2 feedback image');
expectText(pou, 'Pos4 < 10.0', 'bootstrap detects an uninitialized J4 feedback image');
expectText(pou, 'SimulationMode <> 0', 'bootstrap is restricted to the local simulator');
for (const name of ['ManualTarget1', 'ManualTarget2', 'ManualTarget3', 'ManualTarget4']) {
  expectText(pou, `${name} : REAL`, `decoded manual target declaration ${name}`);
}
expectText(pou, 'TO_DWORD(ManualTarget1High)', 'REAL32 command word conversion');
expectText(pou, 'TO_UINT(SHR(RealBits^, 16))', 'REAL32 feedback high-word conversion');
expect(!pou.includes('UINT_TO_DWORD'), 'unsupported UINT_TO_DWORD conversion is absent');
expect(!pou.includes('DWORD_TO_UINT'), 'unsupported DWORD_TO_UINT conversion is absent');
expect(!/SafetyOK\s*:=\s*1/.test(pou), 'FT simulator must not bootstrap SafetyOK');
expect(!/DrivesReady\s*:=\s*1/.test(pou), 'FT simulator must not bootstrap DrivesReady');
expect(!/WiringVerified\s*:=\s*1/.test(pou), 'FT simulator must not bootstrap WiringVerified');
expect(!/PhysicalOutputEnable\s*:=\s*1/.test(pou), 'FT simulator must not bootstrap PhysicalOutputEnable');

// All supported profiles need a complete manual transaction, not a visual
// update without a PLC write.
for (const name of [
  'buildLegacyManualHoldPlan',
  'buildFourAxisManualGotoPlan',
  'buildManualPoseWritePlan',
  'mergeGraphJointValues',
  'verifyEngineeringVector',
  'bidirectionalPermissionReasons',
]) expectText(helper, `export const ${name}`, `bidirectional helper ${name}`);
expectText(helper, "LEGACY_OPENPLC_COMMAND = 90", 'OpenPLC command address');
expectText(helper, "LEGACY_OPENPLC_JOINT_START = 100", 'OpenPLC joint address');
expectText(helper, "S7_JOINT_START = 7", 'S7 joint address');
expectText(helper, 'FOUR_AXIS_TARGET_START = 6', 'four-axis target address');
expectText(helper, 'Cmd=0 manual hold', 'manual HOLD transaction');
expectText(helper, 'REAL32', 'four-axis REAL32 transaction');
expectText(helper, 'readback mismatch', 'readback NACK diagnosis');

// Check the platform actually connects graph editing to the common writer.
expectText(app, 'scheduleBidirectionalManualPose', 'graph edit scheduling');
expectText(app, 'buildManualPoseWritePlan', 'graph edit plan construction');
expectText(app, 'TwinAxis digital twin manual control', 'transaction telemetry source');
expectText(app, 'direction: \'twin-to-plc\'', 'directional communication metadata');
expectText(app, 'Waiting for PLC feedback', 'feedback is the source of truth');
expectText(app, 'priority: \'control\'', 'motion writes use control priority');
expectText(app, 'Manual PLC blocked: Modbus answers', 'manual authority runtime guard');
expectText(app, 'ftFeedbackIsUninitialized', 'dashboard identifies zero FT feedback separately from a stopped scan');
expectText(app, 'HR30..45 sin posiciones validas', 'dashboard explains stale FT feedback mapping');
expectText(app, 'ft511938Snapshot.startupReady === true', 'dashboard separates HR59 scan state from feedback validity');
expectText(app, 'feedback contract invalid', 'dashboard blocks motion for invalid FT feedback without mislabelling the scan');
expectText(pou, 'ManualPermitted := PhysicalPermitted;', 'FT manual permission is independent of IoT');
expectText(pou, 'AutoPermitted := PhysicalPermitted', 'FT automatic permission starts from physical permission');
expectText(pou, 'AutoSegmentTimerA', 'FT AUTO uses the first alternating 1.1 second timer');
expectText(pou, 'AutoSegmentTimerB', 'FT AUTO uses the second alternating 1.1 second timer');
expectText(pou, 'PT := T#1100ms', 'FT AUTO matches the 1.1 second Smart Demo key spacing');
expectText(pou, 'P := P * P * (3.0 - (2.0 * P));', 'FT AUTO matches Smart Demo smoothstep interpolation');
expectText(pou, 'Current1 := AutoSegmentStart1 + ((DemoTarget1 - AutoSegmentStart1) * P);', 'FT AUTO interpolates J1');
expectText(pou, 'Current2 := AutoSegmentStart2 + ((DemoTarget2 - AutoSegmentStart2) * P);', 'FT AUTO interpolates J2 simultaneously');
expectText(pou, 'Current3 := AutoSegmentStart3 + ((DemoTarget3 - AutoSegmentStart3) * P);', 'FT AUTO interpolates J3 simultaneously');
expectText(pou, 'Current4 := AutoSegmentStart4 + ((DemoTarget4 - AutoSegmentStart4) * P);', 'FT AUTO interpolates J4 simultaneously');
expectText(pou, 'IF Step < 16 THEN', 'FT AUTO contains all 16 Smart Demo segments');
expectText(pou, 'Step := 1;', 'FT AUTO loops after returning Home');
expectText(pou, 'DemoTarget1 := -68.754936; DemoTarget2 := 300.0; DemoTarget3 := 180.0; DemoTarget4 := 60.0;', 'FT AUTO first destination matches the cylindrical Smart Demo');
expectText(pou, 'DemoTarget1 := 0.0; DemoTarget2 := 300.0; DemoTarget3 := 60.0; DemoTarget4 := 50.0;', 'FT AUTO returns to the Smart Demo Home pose');
expect(!pou.includes('ELSIF (ModeState = 1) OR (ModeState = 2) THEN'), 'FT AUTO bypasses the old one-axis-at-a-time planner');
expect(!pou.includes('Step < 9'), 'obsolete nine-step AUTO sequence is absent');
expectText(contract, 'activeStep > 16', 'FT decoder accepts all Smart Demo AUTO steps');
expectText(app, 'inRange(signed(48), 0, 16)', 'FT adapter detection accepts all Smart Demo AUTO steps');

const cylindricalClips = rig.indexOf('const CYLINDRICAL_NEW_CLIPS');
const smartDemoStart = rig.indexOf("name: 'Demo_Pick_Place'", cylindricalClips);
const smartDemoEnd = rig.indexOf('    ],', smartDemoStart);
const smartDemoText = smartDemoStart >= 0 && smartDemoEnd > smartDemoStart ? rig.slice(smartDemoStart, smartDemoEnd) : '';
const smartDemoKeys = smartDemoText.split(/\r?\n/)
  .filter((line) => line.includes('{ t:'))
  .map((line) => ['t', 'J1', 'J2', 'J3', 'J4'].map((name) => Number(line.match(new RegExp(`${name}:\\s*([-.\\d]+)`))?.[1])));
const autoTargetsStart = pou.indexOf('IF ModeState = 1 THEN', pou.indexOf('IF ModeState = 1 THEN') + 1);
const autoTargetsEnd = pou.indexOf('ELSIF ModeState = 2 THEN', autoTargetsStart);
const autoTargetsText = autoTargetsStart >= 0 && autoTargetsEnd > autoTargetsStart ? pou.slice(autoTargetsStart, autoTargetsEnd) : '';
const autoTargets = [...autoTargetsText.matchAll(/DemoTarget1 := ([-\d.]+); DemoTarget2 := ([-\d.]+); DemoTarget3 := ([-\d.]+); DemoTarget4 := ([-\d.]+);/g)]
  .map((match) => match.slice(1).map(Number));
expect(smartDemoKeys.length === 17, `cylindrical Smart Demo exposes 17 keyframes, got ${smartDemoKeys.length}`);
expect(autoTargets.length === 16, `FT AUTO exposes 16 destination segments, got ${autoTargets.length}`);
for (let index = 0; index < Math.min(autoTargets.length, Math.max(0, smartDemoKeys.length - 1)); index += 1) {
  const [previousTime] = smartDemoKeys[index];
  const [time, j1, j2, j3, j4] = smartDemoKeys[index + 1];
  const expected = [j1 * 180 / Math.PI, j2 * 1000, j3 * 1000, j4 * 1000];
  expect(Math.abs(time - previousTime - 1.1) < 0.000001, `Smart Demo segment ${index + 1} must last 1.1 seconds`);
  expected.forEach((value, axis) => expect(
    Math.abs((autoTargets[index]?.[axis] ?? Number.NaN) - value) < 0.0001,
    `FT AUTO segment ${index + 1} axis ${axis + 1} does not match Smart Demo`,
  ));
}
expectText(app, 'ft511938ManualAuthorityPermissionReasons', 'FT manual HOLD has a separate authority check');
expectText(app, 'IoT gating remains PLC-owned for AUTO', 'FT AUTO command documents PLC-owned IoT gating');
expectText(app, "current.openPlc.endpointProfile === 'openplc-ft511938'", 'health words belong to explicit OpenPLC profile');
expectText(app, 'current.openPlc.simulationMode === 1', 'health writes require simulation identity');
expectText(app, "iotValues.set('simulation-comm-fresh', current.openPlc.online ? 1 : 0)", 'OpenPLC bridge supplies CommFresh');
expectText(app, "iotValues.set('simulation-sensor-ok', telemetry.valid && telemetry.hasGyroscope && telemetry.ageMs <= 2500 ? 1 : 0)", 'OpenPLC bridge supplies sensor health');
expectText(app, "{ id: 'simulation-comm-fresh', wire: 23 }", 'OpenPLC health maps to HR23');
expectText(app, "{ id: 'simulation-sensor-ok', wire: 24 }", 'OpenPLC health maps to HR24');
expectText(app, 'disabled={!state.openPlc.enabled}', 'FT Auto/Home remain available when the profile is selected');
const manualAuthoritySection = app.split('const ft511938ManualAuthorityPermissionReasons')[1]?.split('const isFt511938ManualAuthorityPermitted')[0] ?? '';
expect(!manualAuthoritySection.includes('HomedMask'), 'FT Manual/HOLD entry must not require homing');
expect(!manualAuthoritySection.includes('IoT'), 'FT Manual/HOLD entry must not inspect IoT state');

// A small independent Modbus encoding check protects the byte order used by
// the TypeScript helper. This mirrors the REAL32 high-word-first convention.
const floatWords = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeFloatBE(value, 0);
  return [buffer.readUInt16BE(0), buffer.readUInt16BE(2)];
};
const readFloat = (words) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt16BE(words[0] & 0xffff, 0);
  buffer.writeUInt16BE(words[1] & 0xffff, 2);
  return buffer.readFloatBE(0);
};
const floatVectors = [
  [0, 300, 60, 50],
  [-171, 130, 0, 12],
  [171, 360, 180, 70],
  [35.25, 325.5, 110.75, 40.125],
];
for (const vector of floatVectors) {
  const words = vector.flatMap(floatWords);
  const roundTrip = Array.from({ length: 4 }, (_, index) => readFloat(words.slice(index * 2, index * 2 + 2)));
  roundTrip.forEach((value, index) => expect(Math.abs(value - vector[index]) < 0.00001, `REAL32 roundtrip failed at ${index}`));
}

// Legacy signed INT16 radians x10000 checks. The source helper is TypeScript,
// so the test keeps the wire invariant explicit without depending on a
// browser or a running Modbus service.
const int16Word = (value) => {
  const rounded = Math.max(-32768, Math.min(32767, Math.round(value * 10000)));
  return rounded < 0 ? rounded + 65536 : rounded;
};
const signedEngineering = (word) => ((word & 0x8000) ? (word - 65536) : word) / 10000;
for (const value of [-3.1415, -1.2, 0, 0.75, 3.1415]) {
  const roundTrip = signedEngineering(int16Word(value));
  expect(Math.abs(roundTrip - value) < 0.0002, `INT16 radian roundtrip failed for ${value}`);
}

// Guard the old profile mismatch behavior. It must remain visible and must
// make the runtime non-operational until the correct POU/profile is selected.
expectCount(app, 'legacyProfileMismatch', 2, 'legacy mismatch is used for diagnosis and runtime state');
expectText(app, 'config.endpointProfile === \'openplc\' && legacyProfileMismatch', 'legacy mismatch stops runtime');
expectText(app, 'expected 2101', 'legacy signature error remains actionable');

// The old visual controls remain present; this feature adds a path instead of
// replacing the PLC dashboard.
expectText(app, 'OpenPLC %QW', 'legacy profile remains selectable');
expectText(app, 'Physical S7-1200', 'S7 profile remains selectable');
expectText(app, 'Physical FT511938 Unified', 'FT profile remains selectable');
expectText(app, 'Manual PLC', 'existing manual button remains visible');
expectText(app, 'Start Demo', 'existing Start Demo action remains visible');

if (failures.length) {
  console.error('PLC bidirectional contract validation FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('PLC bidirectional contract validation PASS');
  console.log(`checked ${floatVectors.length} REAL32 vectors, 5 INT16 values, and ${helper.split(/\r?\n/).length} helper lines`);
}

