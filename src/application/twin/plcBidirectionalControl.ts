import type { KinematicGraph, KinematicJoint } from '../../domain/kinematics';

/**
 * The platform has four different PLC images in active use. They are not
 * interchangeable, even though they all travel through Modbus TCP. This
 * module keeps the differences in one place so a 3D edit produces the same
 * engineering command regardless of which supported image is selected.
 */
export type BidirectionalEndpointProfile =
  | 'openplc'
  | 's7-1200-robot-holding'
  | 'cylindrical4-integrated-iot'
  | 'openplc-ft511938' | 'ft511938-unified';

export type BidirectionalWriteEncoding = 'uint16' | 'int16-rad-x10000' | 'float32-be';

export type BidirectionalWrite = {
  address: number;
  values: number[];
  semantic: string;
  encoding: BidirectionalWriteEncoding;
  verifyAddress?: number;
  verifyQuantity?: number;
};

export type BidirectionalPose = {
  profile: BidirectionalEndpointProfile;
  values: Record<string, number>;
  engineeringTargets: number[];
  writes: BidirectionalWrite[];
  warnings: string[];
  errors: string[];
};

export type BidirectionalPermissionInput = {
  enabled: boolean;
  online: boolean;
  platformManualActive: boolean;
  runtimeRunning?: boolean;
  startupReady?: boolean;
  host: string;
  homedMask?: number;
  simulationMode?: number;
  safetyOk?: boolean;
  drivesReady?: boolean;
  wiringVerified?: boolean;
  physicalOutputEnable?: boolean;
};

export type BidirectionalVerification = {
  ok: boolean;
  expected: number[];
  actual: number[];
  differences: number[];
  detail: string;
};

const FOUR_AXIS_DEFAULTS: [number, number, number, number] = [0, 300, 60, 50];
const FOUR_AXIS_LIMITS: Array<[number, number]> = [[-171, 171], [130, 360], [0, 180], [12, 70]];
const LEGACY_OPENPLC_JOINT_START = 100;
const LEGACY_OPENPLC_COMMAND = 90;
const S7_JOINT_START = 7;
const S7_COMMAND = 0;
const FOUR_AXIS_TARGET_START = 6;
const FOUR_AXIS_COMMAND = 0;

const numeric = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value: number, lower: number, upper: number) => Math.max(lower, Math.min(upper, value));
const finite = (value: number) => Number.isFinite(value);

export const isLocalPlcHost = (host: string) => /^(localhost|127\.0\.0\.1|::1)$/i.test(host.trim());

export const signedWordToRegister = (value: number) => {
  const rounded = Math.round(clamp(numeric(value), -32768, 32767));
  return rounded < 0 ? rounded + 65536 : rounded;
};

export const engineeringRadiansToRegister = (value: number) => signedWordToRegister(numeric(value) * 10000);

export const float32ToBigEndianWords = (value: number) => {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setFloat32(0, numeric(value), false);
  return [view.getUint16(0, false), view.getUint16(2, false)];
};

export const bigEndianWordsToFloat32 = (words: number[], offset = 0) => {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setUint16(0, Number(words[offset] ?? 0) & 0xffff, false);
  view.setUint16(2, Number(words[offset + 1] ?? 0) & 0xffff, false);
  return view.getFloat32(0, false);
};

export const fourAxisTargetIsValid = (targets: number[]) => targets.length >= 4
  && targets.slice(0, 4).every((value, index) => finite(value) && value >= FOUR_AXIS_LIMITS[index][0] && value <= FOUR_AXIS_LIMITS[index][1]);

export const fourAxisValidationErrors = (targets: number[]) => {
  const errors: string[] = [];
  const names = ['J1 degrees', 'J2 millimetres', 'J3 millimetres', 'J4 gripper millimetres'];
  for (let index = 0; index < 4; index += 1) {
    const value = targets[index];
    const [lower, upper] = FOUR_AXIS_LIMITS[index];
    if (!finite(value)) errors.push(`${names[index]} is not finite`);
    else if (value < lower || value > upper) errors.push(`${names[index]}=${value.toFixed(3)} outside ${lower}..${upper}`);
  }
  return errors;
};

export const orderedMovableJoints = (graph: KinematicGraph) => graph.joints
  .filter((joint) => joint.type !== 'fixed' && joint.status !== 'rejected')
  .slice()
  .sort((left, right) => jointOrder(left) - jointOrder(right) || left.name.localeCompare(right.name));

export const jointOrder = (joint: KinematicJoint) => {
  const metadataOrder = joint.evidence.find((entry) => typeof entry.metadata?.order === 'string')?.metadata?.order;
  const metadataNumber = typeof metadataOrder === 'string' ? metadataOrder.match(/^J(\d+)$/i)?.[1] : undefined;
  const nameNumber = joint.name.match(/\bJ(\d+)\b/i)?.[1];
  return Number(metadataNumber ?? nameNumber ?? Number.MAX_SAFE_INTEGER);
};

const jointDescriptor = (joint: KinematicJoint) => `${joint.name} ${joint.evidence.map((item) => item.metadata?.order ?? '').join(' ')}`.toLowerCase();

const jointForAxis = (joints: KinematicJoint[], axis: number) => joints.find((joint) => {
  const descriptor = jointDescriptor(joint);
  if (axis === 0) return /\bj1\b|base.*rot|rot.*base|giro|azimut/.test(descriptor);
  if (axis === 1) return /\bj2\b|vertical|altura|lift|carro/.test(descriptor);
  if (axis === 2) return /\bj3\b|avance|viga|extension|linear/.test(descriptor);
  return /finger|gripper|pinza|clamp|dedo/.test(descriptor);
});

const gripperFractionForJoint = (joint: KinematicJoint, value: number) => {
  const lower = joint.limits?.lower ?? -0.65;
  const upper = joint.limits?.upper ?? 0.65;
  const span = Math.max(Math.abs(lower), Math.abs(upper), 0.001);
  return clamp(Math.abs(value) / span, 0, 1);
};

/**
 * Converts graph values (radians for revolute, metres for prismatic) into the
 * native four-axis adapter vector. The result is deliberately independent of
 * React state and can be tested with a fake Modbus image.
 */
export const graphValuesToFourAxisTargets = (
  graph: KinematicGraph,
  base: number[] = FOUR_AXIS_DEFAULTS,
  values: Record<string, number> = {},
) => {
  const targets: [number, number, number, number] = [
    numeric(base[0], FOUR_AXIS_DEFAULTS[0]),
    numeric(base[1], FOUR_AXIS_DEFAULTS[1]),
    numeric(base[2], FOUR_AXIS_DEFAULTS[2]),
    numeric(base[3], FOUR_AXIS_DEFAULTS[3]),
  ];
  const movable = orderedMovableJoints(graph);
  let mapped = false;
  const gripperFractions: number[] = [];
  for (const joint of movable) {
    const value = values[joint.id];
    if (!finite(value)) continue;
    const descriptor = jointDescriptor(joint);
    if (/finger|gripper|pinza|clamp|dedo/.test(descriptor)) {
      gripperFractions.push(gripperFractionForJoint(joint, value));
      mapped = true;
    } else if (/\bj1\b|base.*rot|rot.*base|giro|azimut/.test(descriptor)) {
      targets[0] = value * 180 / Math.PI;
      mapped = true;
    } else if (/\bj2\b|vertical|altura|lift|carro/.test(descriptor)) {
      targets[1] = value * 1000;
      mapped = true;
    } else if (/\bj3\b|avance|viga|extension|linear/.test(descriptor)) {
      targets[2] = value * 1000;
      mapped = true;
    }
  }
  if (gripperFractions.length) targets[3] = 12 + Math.max(...gripperFractions) * 58;
  const bounded: [number, number, number, number] = [
    clamp(targets[0], -171, 171),
    clamp(targets[1], 130, 360),
    clamp(targets[2], 0, 180),
    clamp(targets[3], 12, 70),
  ];
  return mapped ? bounded : undefined;
};

export const graphValuesToOrderedJointVector = (
  graph: KinematicGraph,
  baseValues: Record<string, number>,
  requestedValues: Record<string, number>,
) => orderedMovableJoints(graph).map((joint) => numeric(requestedValues[joint.id], numeric(baseValues[joint.id], 0)));

export const mergeGraphJointValues = (
  graph: KinematicGraph,
  baseValues: Record<string, number> | undefined,
  requestedValues: Record<string, number>,
) => {
  const merged: Record<string, number> = { ...(baseValues ?? {}) };
  for (const joint of orderedMovableJoints(graph)) {
    if (finite(Number(requestedValues[joint.id]))) merged[joint.id] = Number(requestedValues[joint.id]);
  }
  return merged;
};

const validationForLegacyVector = (vector: number[], expected: number) => {
  const errors: string[] = [];
  if (vector.length === 0) errors.push('The kinematic graph has no movable joints');
  if (vector.length > expected) errors.push(`The PLC image accepts ${expected} joints, graph exposes ${vector.length}`);
  vector.forEach((value, index) => { if (!finite(value)) errors.push(`J${index + 1} is not finite`); });
  return errors;
};

export const buildLegacyManualHoldPlan = (
  profile: 'openplc' | 's7-1200-robot-holding',
  graph: KinematicGraph,
  baseValues: Record<string, number> = {},
  requestedValues: Record<string, number> = {},
): BidirectionalPose => {
  const joints = orderedMovableJoints(graph).slice(0, 6);
  const vector = graphValuesToOrderedJointVector(graph, baseValues, requestedValues).slice(0, 6);
  const expected = profile === 'openplc' ? 6 : 6;
  const errors = validationForLegacyVector(vector, expected);
  const commandAddress = profile === 'openplc' ? LEGACY_OPENPLC_COMMAND : S7_COMMAND;
  const jointAddress = profile === 'openplc' ? LEGACY_OPENPLC_JOINT_START : S7_JOINT_START;
  const values = vector.map((value) => engineeringRadiansToRegister(value));
  const writes: BidirectionalWrite[] = errors.length ? [] : [
    {
      address: commandAddress,
      values: [0],
      semantic: profile === 'openplc' ? 'OpenPLC legacy Cmd=0 manual hold' : 'S7-1200 RobotHolding HR0=0 manual hold',
      encoding: 'uint16',
    },
    {
      address: jointAddress,
      values,
      semantic: profile === 'openplc' ? 'OpenPLC legacy J1..J6 target vector' : 'S7-1200 RobotHolding HR7..HR12 target vector',
      encoding: 'int16-rad-x10000',
      verifyAddress: jointAddress,
      verifyQuantity: values.length,
    },
  ];
  return {
    profile,
    values: Object.fromEntries(joints.map((joint, index) => [joint.id, vector[index] ?? 0])),
    engineeringTargets: vector,
    writes,
    warnings: joints.length < expected ? [`Only ${joints.length} movable joints are mapped; the unused PLC axes remain unchanged.`] : [],
    errors,
  };
};

const buildFourAxisWrites = (
  profile: 'cylindrical4-integrated-iot' | 'openplc-ft511938' | 'ft511938-unified',
  targets: number[],
  heartbeat: number,
) => {
  const baseAddress = (profile === 'ft511938-unified' || profile === 'openplc-ft511938') ? 0 : 0;
  const words = targets.slice(0, 4).flatMap(float32ToBigEndianWords);
  const prefix = (profile === 'ft511938-unified' || profile === 'openplc-ft511938') ? 'FT511938' : 'Cylindrical4 Integrated IoT';
  const feedbackTargetAddress = (profile === 'ft511938-unified' || profile === 'openplc-ft511938') ? 38 : 40;
  return [
    {
      address: baseAddress + FOUR_AXIS_COMMAND,
      values: [0],
      semantic: `${prefix} manual hold before target`,
      encoding: 'uint16' as const,
    },
    {
      address: baseAddress + FOUR_AXIS_TARGET_START,
      values: words,
      semantic: `${prefix} ManualTarget[1..4] REAL32`,
      encoding: 'float32-be' as const,
      verifyAddress: baseAddress + feedbackTargetAddress,
      verifyQuantity: 8,
    },
    {
      address: baseAddress + FOUR_AXIS_COMMAND,
      values: [4, 1, 0, 0, 0, signedWordToRegister(heartbeat)],
      semantic: `${prefix} GOTO edge and heartbeat`,
      encoding: 'uint16' as const,
    },
  ];
};

export const buildFourAxisManualGotoPlan = (
  profile: 'cylindrical4-integrated-iot' | 'openplc-ft511938' | 'ft511938-unified',
  targets: number[],
  heartbeat = 0,
): BidirectionalPose => {
  const normalized = targets.slice(0, 4).map((value, index) => clamp(numeric(value), FOUR_AXIS_LIMITS[index][0], FOUR_AXIS_LIMITS[index][1]));
  const errors = fourAxisValidationErrors(targets);
  return {
    profile,
    values: {},
    engineeringTargets: normalized,
    writes: errors.length ? [] : buildFourAxisWrites(profile, normalized, heartbeat),
    warnings: [],
    errors,
  };
};

export const buildManualPoseWritePlan = (
  profile: BidirectionalEndpointProfile,
  graph: KinematicGraph,
  baseValues: Record<string, number> = {},
  requestedValues: Record<string, number> = {},
  options: { heartbeat?: number; fourAxisBase?: number[] } = {},
) => {
  if (profile === 'openplc' || profile === 's7-1200-robot-holding') {
    return buildLegacyManualHoldPlan(profile, graph, baseValues, requestedValues);
  }
  const targets = graphValuesToFourAxisTargets(graph, options.fourAxisBase ?? FOUR_AXIS_DEFAULTS, { ...baseValues, ...requestedValues });
  if (!targets) {
    return {
      profile,
      values: { ...baseValues, ...requestedValues },
      engineeringTargets: [],
      writes: [],
      warnings: [],
      errors: ['The graph has no recognised J1/J2/J3/gripper semantic mapping'],
    } satisfies BidirectionalPose;
  }
  return buildFourAxisManualGotoPlan(profile, targets, options.heartbeat ?? 0);
};

export const bidirectionalPermissionReasons = (input: BidirectionalPermissionInput) => {
  const reasons: string[] = [];
  if (!input.enabled) reasons.push('endpoint disabled');
  if (!input.online) reasons.push('Modbus process image is offline');
  if (!input.platformManualActive) reasons.push('platform manual authority is not active');
  if (input.runtimeRunning === false) reasons.push(input.startupReady === false ? 'PLC POU scan stopped' : 'PLC runtime is not running');
  if ((input.homedMask ?? 0) !== 15 && input.simulationMode !== undefined) reasons.push(`HomedMask=${input.homedMask ?? '--'}`);
  const localSimulation = input.simulationMode === 1 && isLocalPlcHost(input.host);
  const physicalPermit = input.safetyOk === true && input.drivesReady === true && input.wiringVerified === true && input.physicalOutputEnable === true;
  if (input.simulationMode !== undefined && !localSimulation && !physicalPermit) {
    reasons.push(`physical output permit missing (SafetyOK=${input.safetyOk ? 1 : 0}, DrivesReady=${input.drivesReady ? 1 : 0}, WiringVerified=${input.wiringVerified ? 1 : 0}, PhysicalOutputEnable=${input.physicalOutputEnable ? 1 : 0})`);
  }
  return reasons;
};

export const decodeLegacyInt16Vector = (words: number[]) => words.map((value) => {
  const signed = (Number(value) & 0x8000) ? (Number(value) & 0xffff) - 65536 : Number(value) & 0xffff;
  return signed / 10000;
});

export const decodeFloatVector = (words: number[]) => {
  const values: number[] = [];
  for (let index = 0; index + 1 < words.length; index += 2) values.push(bigEndianWordsToFloat32(words, index));
  return values;
};

export const verifyEngineeringVector = (
  expected: number[],
  actual: number[],
  tolerance = 0.0002,
): BidirectionalVerification => {
  const differences = expected.map((value, index) => Math.abs(value - numeric(actual[index], Number.NaN)));
  const ok = expected.length === actual.length && differences.every((difference) => finite(difference) && difference <= tolerance);
  return {
    ok,
    expected,
    actual,
    differences,
    detail: ok
      ? `readback verified ${expected.length} values within ${tolerance}`
      : `readback mismatch expected [${expected.join(', ')}], actual [${actual.join(', ')}]`,
  };
};

export const verifyFourAxisTargetReadback = (expected: number[], words: number[]) =>
  verifyEngineeringVector(expected.slice(0, 4), decodeFloatVector(words).slice(0, 4), 0.01);

export const verifyLegacyTargetReadback = (expected: number[], words: number[]) =>
  verifyEngineeringVector(expected, decodeLegacyInt16Vector(words), 0.0002);

export const describeBidirectionalProfile = (profile: BidirectionalEndpointProfile) => {
  switch (profile) {
    case 'openplc': return 'OpenPLC %QW90 command + %QW100..105 int16-rad-x10000 feedback/targets';
    case 's7-1200-robot-holding': return 'S7-1200 HR0 command + HR7..12 int16-rad-x10000 process image';
    case 'cylindrical4-integrated-iot': return 'Cylindrical4 Integrated HR0 command + HR6..13 REAL32 targets';
    case 'openplc-ft511938':
    case 'ft511938-unified': return 'FT511938 HR0 command + HR6..13 REAL32 targets';
  }
};

export const diagnosticForPlan = (plan: BidirectionalPose) => {
  if (plan.errors.length) return `PLC write blocked: ${plan.errors.join('; ')}`;
  const ranges = plan.writes.map((write) => `HR${write.address}..${write.address + write.values.length - 1}`).join(', ');
  return `${describeBidirectionalProfile(plan.profile)}; ${plan.writes.length} write blocks ${ranges}`;
};

export const clonePoseValues = (values: Record<string, number>) => Object.fromEntries(
  Object.entries(values).filter(([, value]) => finite(Number(value))).map(([key, value]) => [key, Number(value)]),
);

export const fourAxisTargetsFromSnapshot = (snapshot: { positions?: number[]; targets?: number[] }) => {
  const source = snapshot.targets?.length === 4 ? snapshot.targets : snapshot.positions ?? FOUR_AXIS_DEFAULTS;
  return source.slice(0, 4).map((value, index) => clamp(numeric(value, FOUR_AXIS_DEFAULTS[index]), FOUR_AXIS_LIMITS[index][0], FOUR_AXIS_LIMITS[index][1]));
};

export const isSupportedBidirectionalProfile = (value: string): value is BidirectionalEndpointProfile =>
  value === 'openplc' || value === 's7-1200-robot-holding' || value === 'cylindrical4-integrated-iot' || value === 'ft511938-unified' || value === 'openplc-ft511938';

export const fourAxisLimitSummary = () => 'J1 -171..171 degrees; J2 130..360 mm; J3 0..180 mm; J4 12..70 mm';

export const legacyLimitSummary = () => 'Legacy six-axis words are signed INT16 engineering radians x10000; the PLC program remains the authority on physical limits.';

export const isPoseInsideFourAxisEnvelope = (targets: number[]) => fourAxisValidationErrors(targets).length === 0;

export const safeFourAxisDefaults = (): [number, number, number, number] => [...FOUR_AXIS_DEFAULTS] as [number, number, number, number];

export const fourAxisLimits = (): Array<[number, number]> => FOUR_AXIS_LIMITS.map(([lower, upper]) => [lower, upper]);

export const legacyAddressesForProfile = (profile: 'openplc' | 's7-1200-robot-holding') => ({
  command: profile === 'openplc' ? LEGACY_OPENPLC_COMMAND : S7_COMMAND,
  joints: profile === 'openplc' ? LEGACY_OPENPLC_JOINT_START : S7_JOINT_START,
});

export const fourAxisAddresses = () => ({ command: FOUR_AXIS_COMMAND, targets: FOUR_AXIS_TARGET_START });

export const targetVectorChanged = (left: number[], right: number[], tolerance = 0.0001) =>
  left.length !== right.length || left.some((value, index) => Math.abs(value - numeric(right[index], Number.NaN)) > tolerance);

export const summarizeVerification = (verification: BidirectionalVerification) =>
  verification.ok ? `ACK ${verification.detail}` : `NACK ${verification.detail}`;

export const explainStoppedRuntime = (startupReady: boolean | undefined, runtimeRunning: boolean | undefined) => {
  if (startupReady === false) return 'Modbus answered, but the selected POU has not executed a scan. Compile/download the POU and set the runtime/CPU to RUN.';
  if (runtimeRunning === false) return 'The endpoint answered but the PLC scan is stopped. No position can be treated as measured feedback.';
  return 'PLC runtime state has not been established yet.';
};

export const buildNoopHoldPlan = (profile: BidirectionalEndpointProfile, reason: string): BidirectionalPose => ({
  profile,
  values: {},
  engineeringTargets: [],
  writes: [],
  warnings: [reason],
  errors: [],
});

export const planHasWrites = (plan: BidirectionalPose) => plan.errors.length === 0 && plan.writes.length > 0;

