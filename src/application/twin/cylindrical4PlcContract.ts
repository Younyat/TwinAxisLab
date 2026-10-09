import type { KinematicGraph } from '../../domain/kinematics';

/**
 * Explicit process image for FB_Cylindrical4_PickPlace.
 *
 * The FB supplied with the project has no AT/%QW declarations, so these
 * offsets are the adapter contract used by TwinAxis. The PLC program must
 * copy the FB inputs/outputs to this image (or expose an equivalent DB via
 * the S7 Modbus server). Offsets are zero-based Modbus holding registers.
 */
export const CYLINDRICAL4_ENDPOINT_PROFILE = 'cylindrical4-fb' as const;
export const CYLINDRICAL4_FB_HR_COUNT = 23;

export const CYLINDRICAL4_FB_REGISTER_MAP = [
  { offset: 0, name: 'Cmd', semantic: 'FB command: 0 stop, 1 demo edge, 2 reset', access: 'read-write' },
  { offset: 1, name: 'Enable', semantic: 'FB enable permit', access: 'platform-to-plc' },
  { offset: 2, name: 'SafetyOK', semantic: 'Validated safety chain', access: 'plc-to-platform' },
  { offset: 3, name: 'DrivesReady', semantic: 'Drive ready feedback', access: 'plc-to-platform' },
  { offset: 4, name: 'CommFresh', semantic: 'Communication watchdog fresh', access: 'plc-to-platform' },
  { offset: 5, name: 'SensorOK', semantic: 'Sensor and measurement valid', access: 'plc-to-platform' },
  { offset: 6, name: 'HomedMask', semantic: 'Homed bits 0..3 for M1..M4', access: 'plc-to-platform' },
  { offset: 7, name: 'MinLimitMask', semantic: 'Negative limit bits 0..3', access: 'plc-to-platform' },
  { offset: 8, name: 'MaxLimitMask', semantic: 'Positive limit bits 0..3', access: 'plc-to-platform' },
  { offset: 9, name: 'Status', semantic: 'FB status: 0 stopped, 1 run, 2 done, 3 fault', access: 'plc-to-platform' },
  { offset: 10, name: 'ActiveStep', semantic: 'Pick/place step 0..8', access: 'plc-to-platform' },
  { offset: 11, name: 'AlarmCode', semantic: 'FB alarm code 1..6', access: 'plc-to-platform' },
  { offset: 12, name: 'Done', semantic: 'Completed pulse/state', access: 'plc-to-platform' },
  { offset: 13, name: 'RunMask', semantic: 'Run outputs M1..M4', access: 'plc-to-platform' },
  { offset: 14, name: 'DirectionMask', semantic: 'Positive direction outputs M1..M4', access: 'plc-to-platform' },
  { offset: 15, name: 'PosJ1', semantic: 'M1 measured degrees x100', access: 'plc-to-platform' },
  { offset: 16, name: 'PosJ2', semantic: 'M2 measured millimetres x10', access: 'plc-to-platform' },
  { offset: 17, name: 'PosJ3', semantic: 'M3 measured millimetres x10', access: 'plc-to-platform' },
  { offset: 18, name: 'PosJ4', semantic: 'M4 measured opening millimetres x10', access: 'plc-to-platform' },
  { offset: 19, name: 'TargetJ1', semantic: 'M1 target degrees x100', access: 'plc-to-platform' },
  { offset: 20, name: 'TargetJ2', semantic: 'M2 target millimetres x10', access: 'plc-to-platform' },
  { offset: 21, name: 'TargetJ3', semantic: 'M3 target millimetres x10', access: 'plc-to-platform' },
  { offset: 22, name: 'TargetJ4', semantic: 'M4 target opening millimetres x10', access: 'plc-to-platform' },
] as const;

export type Cylindrical4FbSnapshot = {
  command: number;
  enable: boolean;
  safetyOk: boolean;
  drivesReady: boolean;
  commFresh: boolean;
  sensorOk: boolean;
  homedMask: number;
  minLimitMask: number;
  maxLimitMask: number;
  status: number;
  activeStep: number;
  alarmCode: number;
  done: boolean;
  runMask: number;
  directionMask: number;
  positions: [number, number, number, number];
  targets: [number, number, number, number];
  valid: boolean;
  validation: string[];
};

const word = (words: number[], offset: number) => Number(words[offset] ?? 0) & 0xffff;
const signedWord = (value: number) => (value & 0x8000 ? value - 0x10000 : value);
const flag = (value: number) => value !== 0;
const finiteRange = (value: number, lower: number, upper: number) => Number.isFinite(value) && value >= lower && value <= upper;

/** Decode the adapter image. Position values are returned in FB engineering units. */
export const decodeCylindrical4FbRegisters = (words: number[]): Cylindrical4FbSnapshot => {
  const positions: [number, number, number, number] = [
    signedWord(word(words, 15)) / 100,
    signedWord(word(words, 16)) / 10,
    signedWord(word(words, 17)) / 10,
    signedWord(word(words, 18)) / 10,
  ];
  const targets: [number, number, number, number] = [
    signedWord(word(words, 19)) / 100,
    signedWord(word(words, 20)) / 10,
    signedWord(word(words, 21)) / 10,
    signedWord(word(words, 22)) / 10,
  ];
  const validation: string[] = [];
  if (words.length < CYLINDRICAL4_FB_HR_COUNT) validation.push(`Expected ${CYLINDRICAL4_FB_HR_COUNT} holding registers, received ${words.length}.`);
  const command = word(words, 0);
  const status = word(words, 9);
  const activeStep = word(words, 10);
  const alarmCode = word(words, 11);
  const done = word(words, 12);
  if (command > 2) validation.push(`Cmd=${command} is outside 0..2.`);
  if (status > 3) validation.push(`Status=${status} is outside 0..3.`);
  if (activeStep > 8) validation.push(`ActiveStep=${activeStep} is outside 0..8.`);
  if (alarmCode > 6) validation.push(`AlarmCode=${alarmCode} is outside 0..6.`);
  if (done > 1) validation.push(`Done=${done} is not boolean.`);
  if (!finiteRange(positions[0], -173, 173)) validation.push(`PosJ1=${positions[0].toFixed(2)} deg is outside the FB range.`);
  if (!finiteRange(positions[1], 128, 362)) validation.push(`PosJ2=${positions[1].toFixed(1)} mm is outside the FB range.`);
  if (!finiteRange(positions[2], -2, 182)) validation.push(`PosJ3=${positions[2].toFixed(1)} mm is outside the FB range.`);
  if (!finiteRange(positions[3], 10, 72)) validation.push(`PosJ4=${positions[3].toFixed(1)} mm is outside the FB range.`);
  if (!finiteRange(targets[0], -173, 173)) validation.push(`TargetJ1=${targets[0].toFixed(2)} deg is outside the FB range.`);
  if (!finiteRange(targets[1], 128, 362)) validation.push(`TargetJ2=${targets[1].toFixed(1)} mm is outside the FB range.`);
  if (!finiteRange(targets[2], -2, 182)) validation.push(`TargetJ3=${targets[2].toFixed(1)} mm is outside the FB range.`);
  if (!finiteRange(targets[3], 10, 72)) validation.push(`TargetJ4=${targets[3].toFixed(1)} mm is outside the FB range.`);
  return {
    command,
    enable: flag(word(words, 1)),
    safetyOk: flag(word(words, 2)),
    drivesReady: flag(word(words, 3)),
    commFresh: flag(word(words, 4)),
    sensorOk: flag(word(words, 5)),
    homedMask: word(words, 6),
    minLimitMask: word(words, 7),
    maxLimitMask: word(words, 8),
    status,
    activeStep,
    alarmCode,
    done: flag(done),
    runMask: word(words, 13),
    directionMask: word(words, 14),
    positions,
    targets,
    valid: validation.length === 0,
    validation,
  };
};

/** Convert the FB's 4-axis position image to the native cylindrical graph units. */
export const cylindrical4PoseForGraph = (graph: KinematicGraph, snapshot: Cylindrical4FbSnapshot) => {
  const movable = graph.joints.filter((joint) => joint.type !== 'fixed');
  const byOrder = (order: string) => movable.find((joint) => joint.evidence.some((item) => item.metadata?.order === order));
  const j1 = byOrder('J1') ?? movable.find((joint) => /j1.*base|base.*rotate/i.test(joint.name));
  const j2 = byOrder('J2') ?? movable.find((joint) => /j2.*vertical|vertical/i.test(joint.name));
  const j3 = byOrder('J3') ?? movable.find((joint) => /j3.*avance|avance|viga/i.test(joint.name));
  const left = movable.find((joint) => /finger[_ -]?l|left|izquier/i.test(joint.name));
  const right = movable.find((joint) => /finger[_ -]?r|right|derech/i.test(joint.name));
  const result: Record<string, number> = {};
  if (j1) result[j1.id] = snapshot.positions[0] * Math.PI / 180;
  if (j2) result[j2.id] = snapshot.positions[1] / 1000;
  if (j3) result[j3.id] = snapshot.positions[2] / 1000;
  const gripperFraction = Math.max(0, Math.min(1, (snapshot.positions[3] - 12) / (70 - 12)));
  if (left) result[left.id] = (left.limits?.upper ?? 0.65) * gripperFraction;
  if (right) result[right.id] = (right.limits?.lower ?? -0.65) * gripperFraction;
  return result;
};

export const encodeCylindrical4Command = (command: 0 | 1 | 2) => [command];
export const encodeCylindrical4Enable = (enabled: boolean) => [enabled ? 1 : 0];

export const cylindrical4SnapshotSummary = (snapshot: Cylindrical4FbSnapshot) =>
  `FB ${snapshot.valid ? 'VALID' : 'INVALID'} · status ${snapshot.status} · step ${snapshot.activeStep} · alarm ${snapshot.alarmCode} · ` +
  `pos [${snapshot.positions.map((value) => value.toFixed(2)).join(', ')}] · targets [${snapshot.targets.map((value) => value.toFixed(2)).join(', ')}]`;
