import net from 'node:net';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const vitePort = Number(process.env.FT511938_S7_TEST_VITE_PORT ?? 5239);
const modbusPort = Number(process.env.FT511938_S7_TEST_MODBUS_PORT ?? 15039);
const words = Array(61).fill(0);
const floatWords = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeFloatBE(value, 0);
  return [buffer.readUInt16BE(0), buffer.readUInt16BE(2)];
};
const putFloat = (offset, value) => words.splice(offset, 2, ...floatWords(value));

words[1] = 1;
putFloat(6, 0); putFloat(8, 300); putFloat(10, 60); putFloat(12, 50);
words[14] = 0; words[15] = 1; words[16] = 17; words[17] = 0;
words[18] = 2200; words[19] = 5000; words[20] = 0;
words[21] = 1; words[22] = 1; words[23] = 1; words[24] = 1; words[25] = 15;
words[28] = 1; words[29] = 1;
putFloat(30, 0); putFloat(32, 300); putFloat(34, 60); putFloat(36, 50);
putFloat(38, 0); putFloat(40, 300); putFloat(42, 60); putFloat(44, 50);
words[46] = 0; words[47] = 0; words[48] = 0; words[49] = 0;
words[52] = 0; words[53] = 1000; words[58] = 0; words[59] = 1;

const server = net.createServer((socket) => {
  socket.on('error', () => {});
  socket.on('data', (request) => {
    if (request.length < 12) return;
    const transactionId = request.readUInt16BE(0);
    const unitId = request[6];
    const functionCode = request[7];
    const address = request.readUInt16BE(8);
    let pdu;
    if (functionCode === 3) {
      const quantity = request.readUInt16BE(10);
      const selected = words.slice(address, address + quantity);
      while (selected.length < quantity) selected.push(0);
      pdu = Buffer.from([3, selected.length * 2, ...selected.flatMap((word) => [word >> 8, word & 0xff])]);
    } else if (functionCode === 6) {
      const value = request.readUInt16BE(10);
      words[address] = value;
      pdu = Buffer.from([6, address >> 8, address & 0xff, value >> 8, value & 0xff]);
    } else if (functionCode === 16) {
      const quantity = request.readUInt16BE(10);
      for (let index = 0; index < quantity; index += 1) words[address + index] = request.readUInt16BE(13 + index * 2);
      pdu = Buffer.from([16, address >> 8, address & 0xff, quantity >> 8, quantity & 0xff]);
    } else {
      pdu = Buffer.from([functionCode | 0x80, 1]);
    }
    const mbap = Buffer.from([transactionId >> 8, transactionId & 0xff, 0, 0, (pdu.length + 1) >> 8, (pdu.length + 1) & 0xff, unitId]);
    socket.write(Buffer.concat([mbap, pdu]));
  });
});

await new Promise((resolveListen, rejectListen) => {
  server.once('error', rejectListen);
  server.listen(modbusPort, '127.0.0.1', resolveListen);
});

const viteBin = resolve('node_modules', 'vite', 'bin', 'vite.js');
const vite = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], {
  cwd: resolve('.'), stdio: 'ignore', shell: false, windowsHide: true,
});
const baseUrl = `http://127.0.0.1:${vitePort}`;
const waitForServer = async () => {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try { if ((await fetch(baseUrl)).ok) return; } catch { /* Vite is starting. */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error('Vite did not start for the FT511938 physical backend regression.');
};

try {
  await waitForServer();
  const query = new URLSearchParams({ host: '127.0.0.1', port: String(modbusPort), unitId: '1', profile: 'ft511938-unified' });
  const probeResponse = await fetch(`${baseUrl}/__openplc/probe?${query}`);
  const probe = await probeResponse.json();
  if (!probeResponse.ok || !probe.ok || probe.quantity !== 61 || probe.dataFormat !== 'ft511938-unified') {
    throw new Error(`Physical FT511938 probe failed: ${JSON.stringify(probe)}`);
  }
  if (probe.registers?.[58] !== 0 || probe.registers?.[59] !== 1) {
    throw new Error('Probe did not preserve real PLC SimulationMode=0 and StartupReady=1.');
  }

  const write = async (address, values, unitId = 1) => {
    const response = await fetch(`${baseUrl}/__openplc/write`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: '127.0.0.1', port: modbusPort, unitId, address, values, priority: 'control' }),
    });
    return { response, payload: await response.json() };
  };
  const heartbeat = await write(5, [42]);
  if (!heartbeat.response.ok || !heartbeat.payload.ok || words[5] !== 42) throw new Error('FC06 heartbeat write failed.');
  const targets = [10, 310, 80, 40].flatMap(floatWords);
  const targetWrite = await write(6, targets);
  if (!targetWrite.response.ok || !targetWrite.payload.ok || !targets.every((word, index) => words[6 + index] === word)) {
    throw new Error('FC16 ManualTarget[1..4] write failed.');
  }

  const readQuery = new URLSearchParams({ host: '127.0.0.1', port: String(modbusPort), unitId: '1', profile: 'ft511938-unified', address: '0', quantity: '61' });
  const readResponse = await fetch(`${baseUrl}/__openplc/read?${readQuery}`);
  const read = await readResponse.json();
  if (!readResponse.ok || read.registers?.length !== 61 || read.registers[5] !== 42) throw new Error('FC03 process-image read failed after writes.');

  readQuery.set('profile', 'openplc-ft511938');
  const simulationResponse = await fetch(`${baseUrl}/__openplc/read?${readQuery}`);
  const simulationRead = await simulationResponse.json();
  if (!simulationResponse.ok || simulationRead.registers?.length !== 61) {
    throw new Error('Explicit OpenPLC FT profile read failed.');
  }
  const invalid = await write(0, [0], 999);
  if (invalid.response.ok || !String(invalid.payload.error).includes('Invalid Modbus write request')) {
    throw new Error(`Invalid Unit ID was not rejected: ${JSON.stringify(invalid.payload)}`);
  }

  console.log('FT511938 physical backend regression passed: probe, FC03, FC06, FC16 and Unit ID validation.');
} finally {
  if (!vite.killed) vite.kill('SIGTERM');
  await new Promise((resolveClose) => server.close(resolveClose));
}
