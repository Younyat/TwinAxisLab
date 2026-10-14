import type { KinematicGraph } from '../../domain/kinematics';

/**
 * FT511938 HR0..60 process image shared by the OpenPLC commissioning adapter
 * and FB_FT511938_Real on S7-1200. The real electrical outputs remain disabled
 * until PLC-owned safety, wiring and output permits are commissioned.
 */
export const FT511938_ENDPOINT_PROFILE = 'ft511938-unified' as const;
export const FT511938_HR_COUNT = 61;

export const FT511938_REGISTER_MAP = [
  { offset: 0, name: 'Cmd', semantic: '0 stop, 1 demo edge, 2 reset, 3 jog, 4 goto edge', access: 'platform-to-plc' },
  { offset: 1, name: 'Enable', semantic: 'FB enable permit', access: 'platform-to-plc' },
  { offset: 2, name: 'JogAxis', semantic: 'JOG axis 1..4', access: 'platform-to-plc' },
  { offset: 3, name: 'JogDirection', semantic: 'JOG direction -1/+1', access: 'platform-to-plc' },
  { offset: 4, name: 'JogEnable', semantic: 'Maintained JOG lease', access: 'platform-to-plc' },
  { offset: 5, name: 'HeartbeatSequence', semantic: 'Communication freshness sequence', access: 'platform-to-plc' },
  { offset: 6, name: 'ManualTarget[1]', semantic: 'M1 target degrees REAL32', access: 'platform-to-plc' },
  { offset: 8, name: 'ManualTarget[2]', semantic: 'M2 target millimetres REAL32', access: 'platform-to-plc' },
  { offset: 10, name: 'ManualTarget[3]', semantic: 'M3 target millimetres REAL32', access: 'platform-to-plc' },
  { offset: 12, name: 'ManualTarget[4]', semantic: 'M4 target millimetres REAL32', access: 'platform-to-plc' },
  { offset: 14, name: 'SensorPolicy', semantic: 'IoT policy 0/1', access: 'platform-to-plc' },
  { offset: 15, name: 'SensorValid', semantic: 'IoT validity', access: 'platform-to-plc' },
  { offset: 16, name: 'SensorQualityBits', semantic: 'IoT quality mask', access: 'platform-to-plc' },
  { offset: 17, name: 'SensorAgeMs', semantic: 'IoT sample age', access: 'platform-to-plc' },
  { offset: 18, name: 'TemperatureCx100', semantic: 'Temperature degrees C x100', access: 'platform-to-plc' },
  { offset: 19, name: 'HumidityRHx100', semantic: 'Humidity percent x100', access: 'platform-to-plc' },
  { offset: 20, name: 'GyroDpsx100', semantic: 'Gyro magnitude degrees/s x100', access: 'platform-to-plc' },
  { offset: 21, name: 'SafetyOK', semantic: 'External safety permission', access: 'plc-to-platform' },
  { offset: 22, name: 'DrivesReady', semantic: 'Drive permission', access: 'plc-to-platform' },
  { offset: 23, name: 'CommFresh', semantic: 'PLC watchdog state', access: 'plc-to-platform' },
  { offset: 24, name: 'SensorOK', semantic: 'Measured position plausibility', access: 'plc-to-platform' },
  { offset: 25, name: 'HomedMask', semantic: 'Homed bits M1..M4', access: 'plc-to-platform' },
  { offset: 26, name: 'MinLimitMask', semantic: 'Negative limits M1..M4', access: 'plc-to-platform' },
  { offset: 27, name: 'MaxLimitMask', semantic: 'Positive limits M1..M4', access: 'plc-to-platform' },
  { offset: 28, name: 'WiringVerified', semantic: 'Formal electrical commissioning permit', access: 'plc-to-platform' },
  { offset: 29, name: 'PhysicalOutputEnable', semantic: 'Formal physical output permit', access: 'plc-to-platform' },
  { offset: 30, name: 'Pos[1]', semantic: 'M1 measured degrees REAL32', access: 'plc-to-platform' },
  { offset: 32, name: 'Pos[2]', semantic: 'M2 measured millimetres REAL32', access: 'plc-to-platform' },
  { offset: 34, name: 'Pos[3]', semantic: 'M3 measured millimetres REAL32', access: 'plc-to-platform' },
  { offset: 36, name: 'Pos[4]', semantic: 'M4 measured millimetres REAL32', access: 'plc-to-platform' },
  { offset: 38, name: 'Target[1]', semantic: 'M1 target degrees REAL32', access: 'plc-to-platform' },
  { offset: 40, name: 'Target[2]', semantic: 'M2 target millimetres REAL32', access: 'plc-to-platform' },
  { offset: 42, name: 'Target[3]', semantic: 'M3 target millimetres REAL32', access: 'plc-to-platform' },
  { offset: 44, name: 'Target[4]', semantic: 'M4 target millimetres REAL32', access: 'plc-to-platform' },
  { offset: 46, name: 'Status', semantic: '0 stopped, 1 moving, 2 done, 3 fault', access: 'plc-to-platform' },
  { offset: 47, name: 'ActiveMode', semantic: '0 stopped, 1 demo, 3 jog, 4 goto', access: 'plc-to-platform' },
  { offset: 48, name: 'ActiveStep', semantic: 'Demo step 1..16 or manual planner phase', access: 'plc-to-platform' },
  { offset: 49, name: 'AlarmCode', semantic: 'Movement fault', access: 'plc-to-platform' },
  { offset: 50, name: 'Done', semantic: 'Completed cycle pulse/state', access: 'plc-to-platform' },
  { offset: 51, name: 'IoTAlarmCode', semantic: 'IoT alarm separate from movement fault', access: 'plc-to-platform' },
  { offset: 52, name: 'ConditionState', semantic: '0 normal, 1 degraded, 2 critical, 3 invalid', access: 'plc-to-platform' },
  { offset: 53, name: 'SpeedPermille', semantic: 'Diagnostic 1000/550/0, not relay PWM', access: 'plc-to-platform' },
  { offset: 54, name: 'CmdQ1toQ8Mask', semantic: 'Eight logical FT output commands', access: 'plc-to-platform' },
  { offset: 55, name: 'RunMask', semantic: 'Run bits M1..M4', access: 'plc-to-platform' },
  { offset: 56, name: 'DirectionMask', semantic: 'Positive direction bits M1..M4', access: 'plc-to-platform' },
  { offset: 57, name: 'HeartbeatEcho', semantic: 'PLC watchdog echo', access: 'plc-to-platform' },
  { offset: 58, name: 'SimulationMode', semantic: 'OpenPLC-only internal pose simulation permit', access: 'plc-to-platform' },
  { offset: 59, name: 'StartupReady', semantic: 'PLC control block has executed at least one scan', access: 'plc-to-platform' },
  { offset: 60, name: 'DoneCounter', semantic: 'Optional completed-cycle counter', access: 'plc-to-platform' },
] as const;

export type Ft511938Snapshot = {
  command: number;
  enable: boolean;
  jogAxis: number;
  jogDirection: number;
  jogEnable: boolean;
  heartbeatSequence: number;
  manualTargets: [number, number, number, number];
  sensorPolicy: number;
  sensorValid: number;
  sensorQualityBits: number;
  sensorAgeMs: number;
  temperatureCx100: number;
  humidityRhx100: number;
  gyroDpsx100: number;
  safetyOk: boolean;
  drivesReady: boolean;
  commFresh: boolean;
  sensorOk: boolean;
  wiringVerified: boolean;
  physicalOutputEnable: boolean;
  simulationMode: number;
  startupReady: boolean;
  positions: [number, number, number, number];
  targets: [number, number, number, number];
  status: number;
  activeMode: number;
  activeStep: number;
  alarmCode: number;
  done: boolean;
  ioTAlarmCode: number;
  conditionState: number;
  speedPermille: number;
  cmdQMask: number;
  homedMask: number;
  runMask: number;
  directionMask: number;
  minLimitMask: number;
  maxLimitMask: number;
  doneCounter: number;
  valid: boolean;
  validation: string[];
};

const word = (words: number[], offset: number) => Number(words[offset] ?? 0) & 0xffff;
const signedWord = (value: number) => (value & 0x8000 ? value - 0x10000 : value);
const signed = (words: number[], offset: number) => signedWord(word(words, offset));
const flag = (words: number[], offset: number) => word(words, offset) !== 0;
const real32 = (words: number[], offset: number) => {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setUint16(0, word(words, offset), false);
  view.setUint16(2, word(words, offset + 1), false);
  return view.getFloat32(0, false);
};
const finiteRange = (value: number, lower: number, upper: number) => Number.isFinite(value) && value >= lower && value <= upper;

export const decodeFt511938Registers = (words: number[]): Ft511938Snapshot => {
  const manualTargets: [number, number, number, number] = [real32(words, 6), real32(words, 8), real32(words, 10), real32(words, 12)];
  const positions: [number, number, number, number] = [real32(words, 30), real32(words, 32), real32(words, 34), real32(words, 36)];
  const targets: [number, number, number, number] = [real32(words, 38), real32(words, 40), real32(words, 42), real32(words, 44)];
  const validation: string[] = [];
  if (words.length < FT511938_HR_COUNT) validation.push(`Expected ${FT511938_HR_COUNT} holding registers, received ${words.length}.`);
  const command = signed(words, 0);
  const status = signed(words, 46);
  const activeMode = signed(words, 47);
  const activeStep = signed(words, 48);
  const alarmCode = signed(words, 49);
  const conditionState = word(words, 52);
  const speedPermille = word(words, 53);
  const startupReady = flag(words, 59);
  if (![0, 1, 2, 3, 4].includes(command)) validation.push(`Cmd=${command} is outside 0..4.`);
  if (![0, 1, 2, 3].includes(status)) validation.push(`Status=${status} is outside 0..3.`);
  if (![0, 1, 3, 4].includes(activeMode)) validation.push(`ActiveMode=${activeMode} is outside 0,1,3,4.`);
  if (activeStep < 0 || activeStep > 16) validation.push(`ActiveStep=${activeStep} is outside 0..16.`);
  if (alarmCode < 0 || alarmCode > 10) validation.push(`AlarmCode=${alarmCode} is outside 0..10.`);
  if (conditionState > 3) validation.push(`ConditionState=${conditionState} is outside 0..3.`);
  if (![0, 550, 1000].includes(speedPermille)) validation.push(`SpeedPermille=${speedPermille} is outside 0,550,1000.`);
  const ranges: Array<[number, number, number, string]> = [
    [positions[0], -173, 173, 'Pos[1] degrees'],
    [positions[1], 128, 362, 'Pos[2] mm'],
    [positions[2], -2, 182, 'Pos[3] mm'],
    [positions[3], 10, 72, 'Pos[4] mm'],
    [targets[0], -173, 173, 'Target[1] degrees'],
    [targets[1], 128, 362, 'Target[2] mm'],
    [targets[2], -2, 182, 'Target[3] mm'],
    [targets[3], 10, 72, 'Target[4] mm'],
  ];
  for (const [value, lower, upper, label] of ranges) if (!finiteRange(value, lower, upper)) validation.push(`${label}=${Number(value).toFixed(2)} is outside ${lower}..${upper}.`);
  return {
    command,
    enable: flag(words, 1),
    jogAxis: signed(words, 2),
    jogDirection: signed(words, 3),
    jogEnable: flag(words, 4),
    heartbeatSequence: word(words, 5),
    manualTargets,
    sensorPolicy: word(words, 14),
    sensorValid: word(words, 15),
    sensorQualityBits: word(words, 16),
    sensorAgeMs: word(words, 17),
    temperatureCx100: signed(words, 18),
    humidityRhx100: word(words, 19),
    gyroDpsx100: word(words, 20),
    safetyOk: flag(words, 21),
    drivesReady: flag(words, 22),
    commFresh: flag(words, 23),
    sensorOk: flag(words, 24),
    homedMask: word(words, 25),
    minLimitMask: word(words, 26),
    maxLimitMask: word(words, 27),
    wiringVerified: flag(words, 28),
    physicalOutputEnable: flag(words, 29),
    simulationMode: word(words, 58),
    startupReady,
    positions,
    targets,
    status,
    activeMode,
    activeStep,
    alarmCode,
    done: flag(words, 50),
    ioTAlarmCode: word(words, 51),
    conditionState,
    speedPermille,
    cmdQMask: word(words, 54),
    runMask: word(words, 55),
    directionMask: word(words, 56),
    doneCounter: word(words, 60),
    valid: validation.length === 0,
    validation,
  };
};

type FtAxisIndex = 0 | 1 | 2 | 3;

const FT511938_SMART_DEMO_ENGINEERING: Array<[number, number, number, number]> = [
  [0, 300, 60, 50],
  [-68.754936, 300, 180, 60],
  [-68.754936, 150, 180, 60],
  [-68.754936, 150, 180, 25],
  [-68.754936, 320, 180, 25],
  [80.214088, 320, 0, 25],
  [80.214088, 180, 0, 25],
  [80.214088, 180, 0, 60],
  [80.214088, 300, 0, 60],
  [80.214088, 180, 0, 60],
  [80.214088, 180, 0, 25],
  [80.214088, 320, 0, 25],
  [-68.754936, 320, 180, 25],
  [-68.754936, 150, 180, 25],
  [-68.754936, 150, 180, 60],
  [-68.754936, 300, 180, 60],
  [0, 300, 60, 50],
];

const ftAxisForJoint = (joint: KinematicGraph['joints'][number]): FtAxisIndex | undefined => {
  const order = joint.evidence.find((item) => typeof item.metadata?.order === 'string')?.metadata?.order;
  const descriptor = `${joint.name} ${typeof order === 'string' ? order : ''}`.toLowerCase();
  if (/finger|gripper|pinza|\bg1\b/.test(descriptor)) return 3;
  if (/\bj1\b|base.*rot|rot.*base|giro/.test(descriptor)) return 0;
  if (/\bj2\b|vertical|altura|lift/.test(descriptor)) return 1;
  if (/\bj3\b|avance|viga|extension|linear/.test(descriptor)) return 2;
  return undefined;
};

const ftJointRestValue = (joint: KinematicGraph['joints'][number]) => {
  for (const evidence of joint.evidence) {
    const value = evidence.metadata?.restValue;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return 0;
};

const ftSmartDemoClip = (graph: KinematicGraph) =>
  graph.motionClips?.find((clip) => /pick|place|ciclo/i.test(clip.name)) ?? graph.motionClips?.[0];

const interpolatePairs = (pairs: Array<[number, number]>, input: number) => {
  if (!pairs.length) return undefined;
  if (pairs.length === 1) return pairs[0][1];
  const sorted = [...pairs].sort((left, right) => left[0] - right[0]);
  let lower = sorted[0];
  let upper = sorted[1];
  if (input >= sorted[sorted.length - 1][0]) {
    lower = sorted[sorted.length - 2];
    upper = sorted[sorted.length - 1];
  } else if (input > sorted[0][0]) {
    const upperIndex = sorted.findIndex(([value]) => value >= input);
    lower = sorted[Math.max(0, upperIndex - 1)];
    upper = sorted[upperIndex];
  }
  const span = upper[0] - lower[0];
  if (Math.abs(span) < 0.0000001) return lower[1];
  return lower[1] + ((input - lower[0]) / span) * (upper[1] - lower[1]);
};

const ftCalibrationPairs = (
  graph: KinematicGraph,
  joint: KinematicGraph['joints'][number],
  axis: FtAxisIndex,
) => {
  const clip = ftSmartDemoClip(graph);
  if (!clip || clip.keyframes.length < 9) return [];
  const unique = new Map<number, number>();
  for (let index = 0; index < 9; index += 1) {
    const engineering = FT511938_SMART_DEMO_ENGINEERING[index][axis];
    const graphValue = clip.keyframes[index]?.jointValues[joint.id];
    if (Number.isFinite(graphValue) && !unique.has(engineering)) unique.set(engineering, graphValue);
  }
  return [...unique.entries()] as Array<[number, number]>;
};

const ftGraphValueFromEngineering = (
  graph: KinematicGraph,
  joint: KinematicGraph['joints'][number],
  axis: FtAxisIndex,
  engineering: number,
) => {
  const calibrated = interpolatePairs(ftCalibrationPairs(graph, joint, axis), engineering);
  if (calibrated !== undefined) return calibrated;
  const rest = ftJointRestValue(joint);
  if (axis === 0) return engineering * Math.PI / 180 - rest;
  if (axis === 1 || axis === 2) return engineering / 1000 - rest;
  const fraction = Math.max(0, Math.min(1, (engineering - 12) / 58));
  const descriptor = joint.name.toLowerCase();
  const limit = /right|derech|gripper[_ -]?r|finger[_ -]?r/.test(descriptor)
    ? joint.limits?.lower ?? -0.65
    : joint.limits?.upper ?? 0.65;
  return limit * fraction;
};

const ftEngineeringFromGraphValue = (
  graph: KinematicGraph,
  joint: KinematicGraph['joints'][number],
  axis: FtAxisIndex,
  graphValue: number,
) => {
  const reversePairs = ftCalibrationPairs(graph, joint, axis).map(([engineering, calibrated]) => [calibrated, engineering] as [number, number]);
  const calibrated = interpolatePairs(reversePairs, graphValue);
  if (calibrated !== undefined) return calibrated;
  const absolute = graphValue + ftJointRestValue(joint);
  if (axis === 0) return absolute * 180 / Math.PI;
  if (axis === 1 || axis === 2) return absolute * 1000;
  const span = Math.max(Math.abs(joint.limits?.lower ?? 0), Math.abs(joint.limits?.upper ?? 0), 0.001);
  return 12 + (Math.abs(graphValue) / span) * 58;
};

const ftAutoClipPoseForGraph = (graph: KinematicGraph, snapshot: Ft511938Snapshot) => {
  const clip = ftSmartDemoClip(graph);
  const step = snapshot.activeStep;
  if (!clip || step < 1 || step > 16 || clip.keyframes.length < 9) return undefined;
  const sourceEngineering = FT511938_SMART_DEMO_ENGINEERING[step - 1];
  const targetEngineering = FT511938_SMART_DEMO_ENGINEERING[step];
  const ranges = [342, 230, 180, 58];
  let progressAxis: FtAxisIndex = 0;
  let largestMotion = 0;
  for (let axis = 0 as FtAxisIndex; axis < 4; axis = (axis + 1) as FtAxisIndex) {
    const normalizedMotion = Math.abs(targetEngineering[axis] - sourceEngineering[axis]) / ranges[axis];
    if (normalizedMotion > largestMotion) {
      largestMotion = normalizedMotion;
      progressAxis = axis;
    }
  }
  const span = targetEngineering[progressAxis] - sourceEngineering[progressAxis];
  const progress = Math.abs(span) < 0.000001
    ? 1
    : Math.max(0, Math.min(1, (snapshot.positions[progressAxis] - sourceEngineering[progressAxis]) / span));
  const segment = clip.keyframes.length >= 17 ? step - 1 : (step - 1) % 8;
  const source = clip.keyframes[segment];
  const target = clip.keyframes[segment + 1];
  if (!source || !target) return undefined;
  const jointIds = new Set([...Object.keys(source.jointValues), ...Object.keys(target.jointValues)]);
  return Object.fromEntries([...jointIds].map((jointId) => {
    const start = source.jointValues[jointId] ?? target.jointValues[jointId] ?? 0;
    const end = target.jointValues[jointId] ?? start;
    return [jointId, start + (end - start) * progress];
  }));
};

export const ft511938TargetsFromGraphPose = (
  graph: KinematicGraph,
  base: [number, number, number, number],
  values: Record<string, number>,
) => {
  const targets = [...base] as [number, number, number, number];
  let mapped = false;
  for (const joint of graph.joints.filter((candidate) => candidate.type !== 'fixed')) {
    const value = values[joint.id];
    const axis = ftAxisForJoint(joint);
    if (!Number.isFinite(value) || axis === undefined) continue;
    const engineering = ftEngineeringFromGraphValue(graph, joint, axis, value);
    const limits: Array<[number, number]> = [[-171, 171], [130, 360], [0, 180], [12, 70]];
    targets[axis] = Math.max(limits[axis][0], Math.min(limits[axis][1], engineering));
    mapped = true;
  }
  return mapped ? targets : undefined;
};

export const ft511938GraphPoseFromTargets = (
  graph: KinematicGraph,
  targets: [number, number, number, number],
) => Object.fromEntries(graph.joints.flatMap((joint) => {
  const axis = ftAxisForJoint(joint);
  return axis === undefined ? [] : [[joint.id, ftGraphValueFromEngineering(graph, joint, axis, targets[axis])]];
}));

export const ft511938PoseForGraph = (graph: KinematicGraph, snapshot: Ft511938Snapshot) => {
  const autoPose = snapshot.activeMode === 1 ? ftAutoClipPoseForGraph(graph, snapshot) : undefined;
  if (autoPose) return autoPose;
  const movable = graph.joints.filter((joint) => joint.type !== 'fixed');
  const byOrder = (order: string) => movable.find((joint) => joint.evidence.some((item) => item.metadata?.order === order));
  const j1 = byOrder('J1') ?? movable.find((joint) => /j1.*base|base.*rotate|giro/i.test(joint.name));
  const j2 = byOrder('J2') ?? movable.find((joint) => /j2.*vertical|vertical|altura/i.test(joint.name));
  const j3 = byOrder('J3') ?? movable.find((joint) => /j3.*avance|avance|viga|extension/i.test(joint.name));
  const left = movable.find((joint) => /finger[_ -]?l|left|izquier|gripper[_ -]?l/i.test(joint.name));
  const right = movable.find((joint) => /finger[_ -]?r|right|derech|gripper[_ -]?r/i.test(joint.name));
  const result: Record<string, number> = {};
  if (j1) result[j1.id] = ftGraphValueFromEngineering(graph, j1, 0, snapshot.positions[0]);
  if (j2) result[j2.id] = ftGraphValueFromEngineering(graph, j2, 1, snapshot.positions[1]);
  if (j3) result[j3.id] = ftGraphValueFromEngineering(graph, j3, 2, snapshot.positions[2]);
  if (left) result[left.id] = ftGraphValueFromEngineering(graph, left, 3, snapshot.positions[3]);
  if (right) result[right.id] = ftGraphValueFromEngineering(graph, right, 3, snapshot.positions[3]);
  return result;
};

const clampWord = (value: number) => Math.max(-32768, Math.min(32767, Math.round(value))) & 0xffff;
const float32Words = (value: number) => {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setFloat32(0, value, false);
  return [view.getUint16(0, false), view.getUint16(2, false)];
};

export const encodeFt511938Word = (value: number) => clampWord(value);
export const encodeFt511938Float32 = (value: number) => float32Words(value);
export const encodeFt511938Command = (command: 0 | 1 | 2 | 3 | 4) => [clampWord(command)];
export const ft511938SnapshotSummary = (snapshot: Ft511938Snapshot) =>
  `FT511938 ${snapshot.valid ? 'VALID' : 'INVALID'} - mode ${snapshot.activeMode} - status ${snapshot.status} - step ${snapshot.activeStep} - ` +
  `fault ${snapshot.alarmCode} - IoT ${snapshot.ioTAlarmCode} - scan ${snapshot.startupReady ? 'RUNNING' : 'STOPPED'} - ` +
  `safety ${snapshot.safetyOk ? 'OK' : 'OFF'} - wiring ${snapshot.wiringVerified ? 'VERIFIED' : 'UNVERIFIED'}`;
