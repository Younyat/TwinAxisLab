import type { KinematicGraph } from '../../domain/kinematics';

/**
 * Proposed adapter image for FB_FT511938_Unificado.
 *
 * The FT datasheet and the supplied SCL do not define a Modbus map. These
 * offsets are therefore an explicit TwinAxis adapter proposal, not a claim
 * about the physical PLC. The S7/OpenPLC adapter must publish this image and
 * the real electrical outputs must remain disabled until commissioned.
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
  { offset: 48, name: 'ActiveStep', semantic: 'Demo step 1..9', access: 'plc-to-platform' },
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
  { offset: 59, name: 'Reserved', semantic: 'Reserved', access: 'plc-to-platform' },
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
  if (![0, 1, 2, 3, 4].includes(command)) validation.push(`Cmd=${command} is outside 0..4.`);
  if (![0, 1, 2, 3].includes(status)) validation.push(`Status=${status} is outside 0..3.`);
  if (![0, 1, 3, 4].includes(activeMode)) validation.push(`ActiveMode=${activeMode} is outside 0,1,3,4.`);
  if (activeStep < 0 || activeStep > 9) validation.push(`ActiveStep=${activeStep} is outside 0..9.`);
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

export const ft511938PoseForGraph = (graph: KinematicGraph, snapshot: Ft511938Snapshot) => {
  const movable = graph.joints.filter((joint) => joint.type !== 'fixed');
  const byOrder = (order: string) => movable.find((joint) => joint.evidence.some((item) => item.metadata?.order === order));
  const j1 = byOrder('J1') ?? movable.find((joint) => /j1.*base|base.*rotate|giro/i.test(joint.name));
  const j2 = byOrder('J2') ?? movable.find((joint) => /j2.*vertical|vertical|altura/i.test(joint.name));
  const j3 = byOrder('J3') ?? movable.find((joint) => /j3.*avance|avance|viga|extension/i.test(joint.name));
  const left = movable.find((joint) => /finger[_ -]?l|left|izquier|gripper[_ -]?l/i.test(joint.name));
  const right = movable.find((joint) => /finger[_ -]?r|right|derech|gripper[_ -]?r/i.test(joint.name));
  const result: Record<string, number> = {};
  if (j1) result[j1.id] = snapshot.positions[0] * Math.PI / 180;
  if (j2) result[j2.id] = snapshot.positions[1] / 1000;
  if (j3) result[j3.id] = snapshot.positions[2] / 1000;
  const gripperFraction = Math.max(0, Math.min(1, (snapshot.positions[3] - 12) / (70 - 12)));
  if (left) result[left.id] = (left.limits?.upper ?? 0.65) * gripperFraction;
  if (right) result[right.id] = (right.limits?.lower ?? -0.65) * gripperFraction;
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
  `fault ${snapshot.alarmCode} - IoT ${snapshot.ioTAlarmCode} - safety ${snapshot.safetyOk ? 'OK' : 'OFF'} - wiring ${snapshot.wiringVerified ? 'VERIFIED' : 'UNVERIFIED'}`;
