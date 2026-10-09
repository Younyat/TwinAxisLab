import net from 'node:net';

const args = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const [key, value] = argument.replace(/^--/, '').split('=');
  return [key, value ?? true];
}));
const host = String(args.host ?? '127.0.0.1');
const port = Number(args.port ?? 502);
const unitId = Number(args.unit ?? 1);
const durationMs = Math.max(1000, Number(args.duration ?? 12000));
const intervalMs = Math.max(50, Number(args.interval ?? 100));
const toleranceRad = Math.max(0.0001, Number(args.tolerance ?? 0.003));
const homeDeg = [0, -35, 75, 50, 0, 0];
const keys = [
  [0, [0, -35, 75, 50, 0, 0]],
  [1400, [-55, -10, 85, 25, 0, 0]],
  [2400, [-55, 15, 80, -5, 0, 0]],
  [3200, [-55, 15, 80, -5, 0, 90]],
  [5600, [50, -10, 85, 25, 0, 90]],
  [7600, [50, 15, 80, -5, 30, -90]],
  [10000, [0, -35, 75, 50, 0, 0]],
];
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const signed16 = (word) => (word & 0x8000 ? word - 0x10000 : word);
const smoothstep = (value) => value * value * (3 - (2 * value));

const expectedAt = (elapsedMs) => {
  const cycleMs = ((elapsedMs % 10000) + 10000) % 10000;
  const nextIndex = keys.findIndex(([time]) => time >= cycleMs);
  if (nextIndex <= 0) return Array(6).fill(0);
  const [startTime, start] = keys[nextIndex - 1];
  const [endTime, end] = keys[nextIndex];
  const progress = smoothstep((cycleMs - startTime) / (endTime - startTime));
  return start.map((degrees, index) => ((degrees + ((end[index] - degrees) * progress)) - homeDeg[index]) * Math.PI / 180);
};

const readFrame = () => new Promise((resolve, reject) => {
  const transactionId = Math.floor(Math.random() * 0xffff);
  const quantity = 16;
  const pdu = Buffer.from([3, 0, 90, 0, quantity]);
  const request = Buffer.concat([Buffer.from([transactionId >> 8, transactionId & 0xff, 0, 0, 0, pdu.length + 1, unitId]), pdu]);
  const socket = net.createConnection({ host, port });
  const chunks = [];
  let settled = false;
  const finish = (error, value) => {
    if (settled) return;
    settled = true;
    socket.removeAllListeners();
    socket.destroy();
    if (error) reject(error); else resolve(value);
  };
  socket.setTimeout(1500);
  socket.on('connect', () => socket.write(request));
  socket.on('timeout', () => finish(new Error('Modbus timeout')));
  socket.on('error', (error) => finish(error));
  socket.on('data', (chunk) => {
    chunks.push(chunk);
    const response = Buffer.concat(chunks);
    if (response.length < 9) return;
    const expectedLength = 6 + response.readUInt16BE(4);
    if (response.length < expectedLength) return;
    if (response.readUInt16BE(0) !== transactionId || response[7] !== 3) return finish(new Error('Invalid Modbus FC03 response'));
    const registers = Array.from({ length: response[8] / 2 }, (_, index) => response.readUInt16BE(9 + (index * 2)));
    finish(undefined, registers);
  });
});

const samples = [];
const endAt = Date.now() + durationMs;
while (Date.now() < endAt) {
  const startedAt = Date.now();
  const registers = await readFrame();
  const actual = registers.slice(10, 16).map((word) => signed16(word) / 10000);
  const expected = expectedAt(registers[3]);
  samples.push({
    command: registers[0],
    status: registers[1],
    step: registers[2],
    elapsedMs: registers[3],
    alarm: registers[4],
    condition: registers[5],
    speedPermille: registers[6],
    programSignature: registers[7],
    actual,
    expected,
    errors: actual.map((value, index) => value - expected[index]),
  });
  await sleep(Math.max(0, intervalMs - (Date.now() - startedAt)));
}

const active = samples.filter((sample) => sample.command === 1 && sample.status === 1 && sample.speedPermille > 0);
const elapsedChanged = new Set(samples.map((sample) => sample.elapsedMs)).size > 1;
const perJoint = Array.from({ length: 6 }, (_, index) => {
  const errors = active.map((sample) => sample.errors[index]);
  return {
    joint: `J${index + 1}`,
    rmsRad: errors.length ? Math.sqrt(errors.reduce((sum, value) => sum + (value * value), 0) / errors.length) : null,
    maxRad: errors.length ? Math.max(...errors.map(Math.abs)) : null,
  };
});
const maxErrorRad = Math.max(0, ...perJoint.map((joint) => joint.maxRad ?? 0));
const last = samples.at(-1);
const signatureValid = samples.length > 0 && samples.every((sample) => sample.programSignature === 2101);
const result = signatureValid && active.length >= 5 && elapsedChanged && maxErrorRad <= toleranceRad ? 'PASS' : 'FAIL';

console.log(JSON.stringify({
  result,
  endpoint: `${host}:${port}`,
  samples: samples.length,
  activeSamples: active.length,
  elapsedChanged,
  signatureValid,
  toleranceRad,
  maxErrorRad,
  lastState: last ? { command: last.command, status: last.status, step: last.step, elapsedMs: last.elapsedMs, alarm: last.alarm, condition: last.condition, speedPermille: last.speedPermille, programSignature: last.programSignature } : null,
  perJoint,
}, null, 2));

if (result !== 'PASS') {
  if (!signatureValid) console.error(`OpenPLC program mismatch: %QW97=${last?.programSignature ?? '--'}, expected 2101.`);
  if (!active.length && last) console.error(`PLC trajectory is not active: status=${last.status}, alarm=${last.alarm}, condition=${last.condition}, speed=${last.speedPermille}.`);
  if (!elapsedChanged) console.error('OpenPLC ElapsedMs did not advance during the comparison window.');
  if (maxErrorRad > toleranceRad) console.error(`Trajectory differs from Start Smart Demo by up to ${maxErrorRad.toFixed(6)} rad.`);
  process.exitCode = 1;
}
