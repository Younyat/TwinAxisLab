import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { appendFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const warehouseRoot = resolve(process.cwd(), process.env.ASSET_FORGE_WAREHOUSE_DIR ?? 'project-warehouse');
const modbusControllerScript = resolve(process.cwd(), 'scripts', 'modbus_visual_controller.mjs');
const observabilityRoot = resolve(process.cwd(), 'project-telemetry');

const waitForModbusController = async (url: string, timeoutMs = 8000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(700) });
      const payload = await response.json() as { service?: string };
      if (response.ok && payload.service === 'visual-modbus-robot-controller') return true;
    } catch {
      // The local controller may still be starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 180));
  }
  return false;
};

const modbusControllerPlugin = () => {
  let controllerProcess: ChildProcess | undefined;
  return {
    name: 'local-modbus-controller-launcher',
    configureServer(server) {
      server.middlewares.use('/__modbus-controller/start', async (request, response) => {
        response.setHeader('Content-Type', 'application/json');
        if (request.method !== 'POST') {
          response.statusCode = 405;
          response.end(JSON.stringify({ error: 'POST required' }));
          return;
        }

        const url = 'http://127.0.0.1:8765';
        try {
          if (!(await waitForModbusController(url, 900))) {
            controllerProcess = spawn(process.execPath, [modbusControllerScript, '--host=127.0.0.1', '--port=8765'], {
              cwd: process.cwd(),
              stdio: 'ignore',
              windowsHide: true,
              shell: false,
            });
            controllerProcess.unref();
          }
          if (!(await waitForModbusController(url))) throw new Error('The Modbus Controller did not become available on port 8765.');
          response.end(JSON.stringify({ ok: true, url, reused: !controllerProcess || controllerProcess.exitCode === null }));
        } catch (error) {
          response.statusCode = 500;
          response.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Controller start failed' }));
        }
      });
    },
  };
};

const validOpenPlcHost = (value: string) => /^[a-zA-Z0-9.-]+$/.test(value) && value.length <= 253;

type ModbusRequest = {
  host: string;
  port: number;
  unitId: number;
  functionCode: number;
  address: number;
  quantity?: number;
  values?: number[];
  priority?: 'control' | 'telemetry';
  timeoutMs?: number;
  deviceLabel?: string;
};

type QueuedModbusRequest = ModbusRequest & {
  resolve: (frame: Buffer) => void;
  reject: (error: Error) => void;
};

const modbusSessions = new Map<string, PersistentModbusSession>();

class PersistentModbusSession {
  private socket?: net.Socket;
  private buffer = Buffer.alloc(0);
  private queue: QueuedModbusRequest[] = [];
  private active?: QueuedModbusRequest;
  private transactionId = 0;
  private connecting?: Promise<void>;

  constructor(private readonly host: string, private readonly port: number) {}

  request(options: ModbusRequest) {
    return new Promise<Buffer>((resolveRequest, rejectRequest) => {
      const item = { ...options, resolve: resolveRequest, reject: rejectRequest };
      // Keep process-image reads fresh, but never let continuous FC03 polling
      // starve a control write. A queued FC06/FC16 is a PLC command and must
      // be sent before another stale read is accepted.
      if (options.functionCode === 3) {
        const controlWritePending = this.queue.some((queued) => queued.functionCode !== 3);
        if (controlWritePending) this.queue.push(item);
        else this.queue.unshift(item);
      } else {
        const controlWrite = options.priority === 'control';
        // Telemetry is replaceable; a control command is not. Otherwise a
        // 200 ms IoT forwarder can supersede Cmd=0/Cmd=4 before it is sent.
        const staleWrites = this.queue.filter((queued) => queued.functionCode !== 3 && queued.priority !== 'control');
        this.queue = this.queue.filter((queued) => queued.functionCode === 3 || queued.priority === 'control');
        staleWrites.forEach((stale) => stale.reject(new Error('Superseded by a newer Modbus request.')));
        if (controlWrite || !this.queue.some((queued) => queued.functionCode !== 3)) this.queue.unshift(item);
        else this.queue.push(item);
      }
      void this.drain();
    });
  }

  private async drain() {
    if (this.active || !this.queue.length) return;
    this.active = this.queue.shift();
    if (!this.active) return;
    const request = this.active;
    try {
      const response = await this.exchange(request);
      request.resolve(response);
    } catch (error) {
      request.reject(error instanceof Error ? error : new Error('Modbus exchange failed'));
    } finally {
      this.active = undefined;
      void this.drain();
    }
  }

  private async connect() {
    if (this.socket && !this.socket.destroyed) return;
    if (this.connecting) return this.connecting;
    this.connecting = new Promise<void>((resolveConnect, rejectConnect) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      const onError = (error: Error) => {
        socket.removeAllListeners();
        socket.destroy();
        rejectConnect(error);
      };
      socket.once('connect', () => {
        socket.removeListener('error', onError);
        this.socket = socket;
        resolveConnect();
      });
      socket.once('error', onError);
    }).finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  private async exchange(request: QueuedModbusRequest) {
    await this.connect();
    const socket = this.socket;
    if (!socket || socket.destroyed) throw new Error(`${request.deviceLabel ?? 'Modbus endpoint'} is not connected`);
    const transactionId = (this.transactionId = (this.transactionId + 1) & 0xffff);
    const values = request.values ?? [];
    const pdu = request.functionCode === 3
      ? Buffer.from([3, request.address >> 8, request.address & 0xff, (request.quantity ?? 1) >> 8, (request.quantity ?? 1) & 0xff])
      : request.functionCode === 6
        ? Buffer.from([6, request.address >> 8, request.address & 0xff, values[0] >> 8, values[0] & 0xff])
        : Buffer.from([16, request.address >> 8, request.address & 0xff, values.length >> 8, values.length & 0xff, values.length * 2, ...values.flatMap((word) => [word >> 8, word & 0xff])]);
    const mbap = Buffer.from([transactionId >> 8, transactionId & 0xff, 0, 0, (pdu.length + 1) >> 8, (pdu.length + 1) & 0xff, request.unitId]);
    const requestFrame = Buffer.concat([mbap, pdu]);
    const timeoutMs = request.timeoutMs ?? 1200;
    return new Promise<Buffer>((resolveResponse, rejectResponse) => {
      let settled = false;
      let responseBuffer = Buffer.alloc(0);
      const timer = setTimeout(() => finish(new Error(`${request.deviceLabel ?? 'Modbus endpoint'} did not answer within ${timeoutMs} ms`)), timeoutMs);
      const finish = (error?: Error, response?: Buffer) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.removeListener('data', onData);
        socket.removeListener('error', onError);
        socket.removeListener('close', onClose);
        socket.removeListener('end', onEnd);
        if (error) {
          this.socket = undefined;
          socket.destroy();
          rejectResponse(error);
        } else resolveResponse(response ?? Buffer.alloc(0));
      };
      const onError = (error: Error) => finish(error);
      const onClose = () => finish(new Error(`${request.deviceLabel ?? 'Modbus endpoint'} closed the connection`));
      const onEnd = () => finish(new Error(`${request.deviceLabel ?? 'Modbus endpoint'} ended the connection`));
      const onData = (chunk: Buffer) => {
        responseBuffer = Buffer.concat([responseBuffer, chunk]);
        if (responseBuffer.length < 7) return;
        const expectedLength = 6 + responseBuffer.readUInt16BE(4);
        if (responseBuffer.length < expectedLength) return;
        if (responseBuffer.readUInt16BE(0) !== transactionId) return finish(new Error(`${request.deviceLabel ?? 'Modbus endpoint'} transaction ID mismatch`));
        if (responseBuffer[6] !== request.unitId) return finish(new Error(`${request.deviceLabel ?? 'Modbus endpoint'} Unit ID mismatch`));
        if ((responseBuffer[7] & 0x80) !== 0) return finish(new Error(`${request.deviceLabel ?? 'Modbus endpoint'} Modbus exception ${responseBuffer[8] ?? 0}`));
        finish(undefined, responseBuffer.subarray(0, expectedLength));
      };
      socket.on('data', onData);
      socket.once('error', onError);
      socket.once('close', onClose);
      socket.once('end', onEnd);
      socket.write(requestFrame, (error) => { if (error) finish(error); });
    });
  }
}

const openPlcRequest = (options: ModbusRequest) => {
  const key = `${options.host}:${options.port}`;
  let session = modbusSessions.get(key);
  if (!session) {
    session = new PersistentModbusSession(options.host, options.port);
    modbusSessions.set(key, session);
  }
  return session.request(options);
};

const openPlcPlugin = () => ({
  name: 'openplc-modbus-tcp-gateway',
  configureServer(server) {
    server.middlewares.use('/__openplc/read', async (request, response) => {
      response.setHeader('Content-Type', 'application/json');
      try {
        const url = new URL(request.url ?? '', 'http://127.0.0.1');
        const host = url.searchParams.get('host') ?? '127.0.0.1';
        const port = Number(url.searchParams.get('port') ?? 502);
        const unitId = Number(url.searchParams.get('unitId') ?? 1);
        const address = Number(url.searchParams.get('address') ?? 100);
        const quantity = Number(url.searchParams.get('quantity') ?? 12);
        const profile = url.searchParams.get('profile') ?? 'openplc';
        const physical = profile === 's7-1200-robot-holding';
        const cylindrical4 = profile === 'cylindrical4-fb';
        const cylindrical4Integrated = profile === 'cylindrical4-integrated-iot';
        const ft511938 = (profile === 'ft511938-unified' || profile === 'openplc-ft511938');
        if (!validOpenPlcHost(host) || !Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(unitId) || unitId < 0 || unitId > 255 || !Number.isInteger(address) || address < 0 || address > 65535 || !Number.isInteger(quantity) || quantity < 1 || quantity > 125) throw new Error('Invalid OpenPLC endpoint or register range');
        const frame = await openPlcRequest({ host, port, unitId, functionCode: 3, address, quantity, timeoutMs: physical || cylindrical4 || cylindrical4Integrated || ft511938 ? 2500 : 1200, deviceLabel: ft511938 ? `FT511938 PLC ${host}:${port}` : cylindrical4Integrated ? `Cylindrical4 Integrated IoT PLC ${host}:${port}` : cylindrical4 ? `Cylindrical4 FB PLC ${host}:${port}` : physical ? `Physical S7-1200 ${host}:${port}` : `OpenPLC ${host}:${port}` });
        const byteCount = frame[8];
        const registers = Array.from({ length: Math.floor(byteCount / 2) }, (_, index) => frame.readUInt16BE(9 + index * 2));
        response.end(JSON.stringify({ ok: true, host, port, unitId, address, quantity, registers, transactionId: frame.readUInt16BE(0), functionCode: frame[7], receivedAt: new Date().toISOString() }));
      } catch (error) {
        response.statusCode = 502;
        response.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'OpenPLC read failed' }));
      }
    });

    server.middlewares.use('/__openplc/probe', async (request, response) => {
      response.setHeader('Content-Type', 'application/json');
      const url = new URL(request.url ?? '', 'http://127.0.0.1');
      const host = url.searchParams.get('host') ?? '127.0.0.1';
      const requestedPort = Number(url.searchParams.get('port') ?? 502);
      const requestedUnit = Number(url.searchParams.get('unitId') ?? 1);
      const profile = url.searchParams.get('profile') ?? 'openplc';
      if (!validOpenPlcHost(host)) return void (response.statusCode = 400, response.end(JSON.stringify({ ok: false, error: 'Invalid OpenPLC host' })));
      const ports = [...new Set([requestedPort, 502, 5020])].filter((port) => Number.isInteger(port) && port > 0 && port <= 65535);
      const unitIds = [...new Set([requestedUnit, 1, 0])].filter((unitId) => Number.isInteger(unitId) && unitId >= 0 && unitId <= 255);
      const attempts: Array<{ port: number; unitId: number; result: string }> = [];
      for (const port of ports) {
        for (const unitId of unitIds) {
          try {
            if (profile === 'cylindrical4-integrated-iot') {
              const frame = await openPlcRequest({ host, port, unitId, functionCode: 3, address: 0, quantity: 61, timeoutMs: 2500, deviceLabel: `Cylindrical4 Integrated IoT PLC ${host}:${port}` });
              const byteCount = frame[8];
              const registers = Array.from({ length: Math.floor(byteCount / 2) }, (_, index) => frame.readUInt16BE(9 + index * 2));
              const signed = (value: number) => (value & 0x8000 ? value - 0x10000 : value);
              const real32 = (offset: number) => {
                const buffer = Buffer.alloc(4);
                buffer.writeUInt16BE(registers[offset] ?? 0, 0);
                buffer.writeUInt16BE(registers[offset + 1] ?? 0, 2);
                return buffer.readFloatBE(0);
              };
              const positions = [real32(32), real32(34), real32(36), real32(38)];
              const positionRanges = [[-173, 173], [128, 362], [-2, 182], [10, 72]];
              const signature = registers.length === 61
                && signed(registers[0] ?? 99) >= 0 && signed(registers[0] ?? 99) <= 4
                && signed(registers[48] ?? 99) >= 0 && signed(registers[48] ?? 99) <= 3
                && [0, 1, 3, 4].includes(signed(registers[49] ?? 99))
                && registers[53] <= 3
                && [0, 550, 1000].includes(registers[54] ?? 65535)
                && positions.every((value, index) => Number.isFinite(value) && value >= positionRanges[index][0] && value <= positionRanges[index][1]);
              attempts.push({ port, unitId, result: signature ? 'cylindrical4-integrated-iot-candidate' : 'holding-registers-readable' });
              if (signature) {
                response.end(JSON.stringify({ ok: true, detected: true, profile, host, port, unitId, address: 0, quantity: 61, dataFormat: 'cylindrical4-integrated', commandAddress: 0, rawAddress: 0, registers, attempts, receivedAt: new Date().toISOString(), detection: 'integrated-iot-process-image; confirm DB mapping and physical safety inputs on the PLC' }));
                return;
              }
              continue;
            }
            if ((profile === 'ft511938-unified' || profile === 'openplc-ft511938')) {
              const frame = await openPlcRequest({ host, port, unitId, functionCode: 3, address: 0, quantity: 61, timeoutMs: 2500, deviceLabel: `FT511938 PLC ${host}:${port}` });
              const byteCount = frame[8];
              const registers = Array.from({ length: Math.floor(byteCount / 2) }, (_, index) => frame.readUInt16BE(9 + index * 2));
              const signed = (value: number) => (value & 0x8000 ? value - 0x10000 : value);
              const command = signed(registers[0] ?? 99);
              const status = signed(registers[46] ?? 99);
              const activeMode = signed(registers[47] ?? 99);
              const conditionState = registers[52] ?? 99;
              const speed = registers[53] ?? 65535;
              const signature = registers.length === 61
                && command >= 0 && command <= 4
                && [0, 1, 2, 3].includes(status)
                && [0, 1, 3, 4].includes(activeMode)
                && conditionState <= 3
                && [0, 550, 1000].includes(speed)
                && (registers[28] ?? 2) <= 1
                && (registers[29] ?? 2) <= 1;
              attempts.push({ port, unitId, result: signature ? 'ft511938-unified-hr0-60' : 'holding-registers-readable' });
              if (signature) {
                response.end(JSON.stringify({ ok: true, detected: true, profile, host, port, unitId, address: 0, quantity: 61, dataFormat: 'ft511938-unified', commandAddress: 0, rawAddress: 0, registers, attempts, receivedAt: new Date().toISOString(), detection: 'FT511938 HR0..60 process image; electrical permissions remain PLC-owned' }));
                return;
              }
              continue;
            }
            if (profile === 'cylindrical4-fb') {
              const frame = await openPlcRequest({ host, port, unitId, functionCode: 3, address: 0, quantity: 23, timeoutMs: 2500, deviceLabel: `Cylindrical4 FB PLC ${host}:${port}` });
              const byteCount = frame[8];
              const registers = Array.from({ length: Math.floor(byteCount / 2) }, (_, index) => frame.readUInt16BE(9 + index * 2));
              const signed = (value: number) => (value & 0x8000 ? value - 0x10000 : value);
              const positionRanges = [
                [signed(registers[15] ?? 0) / 100, -173, 173],
                [signed(registers[16] ?? 0) / 10, 128, 362],
                [signed(registers[17] ?? 0) / 10, -2, 182],
                [signed(registers[18] ?? 0) / 10, 10, 72],
              ];
              const signature = registers.length === 23
                && (registers[0] ?? 99) <= 2
                && (registers[9] ?? 99) <= 3
                && (registers[10] ?? 99) <= 8
                && (registers[11] ?? 99) <= 6
                && positionRanges.every(([value, lower, upper]) => value >= lower && value <= upper);
              attempts.push({ port, unitId, result: signature ? 'cylindrical4-fb-candidate' : 'holding-registers-readable' });
              if (signature) {
                response.end(JSON.stringify({ ok: true, detected: true, profile, host, port, unitId, address: 0, quantity: 23, dataFormat: 'cylindrical4-rpp', commandAddress: 0, rawAddress: 0, registers, attempts, receivedAt: new Date().toISOString(), detection: 'contract-candidate; confirm the adapter DB and safety wiring on the PLC' }));
                return;
              }
              continue;
            }
            if (profile === 's7-1200-robot-holding') {
              const frame = await openPlcRequest({ host, port, unitId, functionCode: 3, address: 0, quantity: 21, timeoutMs: 2500, deviceLabel: `Physical S7-1200 ${host}:${port}` });
              const byteCount = frame[8];
              const registers = Array.from({ length: Math.floor(byteCount / 2) }, (_, index) => frame.readUInt16BE(9 + index * 2));
              const signature = registers.length === 21
                && registers[0] <= 2
                && registers[1] <= 3
                && registers[2] <= 6
                && registers[5] <= 3
                && registers[6] <= 1000
                && registers[17] <= 1
                && registers[20] <= 1;
              attempts.push({ port, unitId, result: signature ? 's7-1200-robot-holding' : 'holding-registers-readable' });
              if (signature) {
                response.end(JSON.stringify({ ok: true, detected: true, profile, host, port, unitId, address: 7, quantity: 6, dataFormat: 'int16-rad-x10000', commandAddress: 0, rawAddress: 0, registers, attempts, receivedAt: new Date().toISOString() }));
                return;
              }
              continue;
            }
            const frame = await openPlcRequest({ host, port, unitId, functionCode: 3, address: 90, quantity: 16, timeoutMs: 650 });
            const byteCount = frame[8];
            const registers = Array.from({ length: Math.floor(byteCount / 2) }, (_, index) => frame.readUInt16BE(9 + index * 2));
            const signed = registers.map((word) => (word & 0x8000 ? word - 0x10000 : word));
            const signature = registers.length >= 16 && registers[0] <= 2 && registers[1] <= 2 && registers[2] <= 6;
            attempts.push({ port, unitId, result: signature ? 'cobot-profile' : 'holding-registers-readable' });
            if (signature) {
              response.end(JSON.stringify({ ok: true, detected: true, host, port, unitId, address: 100, quantity: 6, dataFormat: 'int16-rad-x10000', commandAddress: 90, rawAddress: 90, registers, signed, attempts, receivedAt: new Date().toISOString() }));
              return;
            }
          } catch (error) {
            attempts.push({ port, unitId, result: error instanceof Error ? error.message : 'probe failed' });
          }
        }
      }
      response.statusCode = 502;
      response.end(JSON.stringify({ ok: false, detected: false, error: profile === 's7-1200-robot-holding' ? 'S7-1200 RobotHolding signature not found at HR0..HR20' : profile === 'cylindrical4-fb' ? 'Cylindrical4 FB adapter contract not found at HR0..HR22' : profile === 'cylindrical4-integrated-iot' ? 'Cylindrical4 Integrated IoT process image not found at HR0..HR60' : (profile === 'ft511938-unified' || profile === 'openplc-ft511938') ? 'FT511938 HR0..HR60 process image not found' : 'Cobot OpenPLC register signature not found at %QW90..%QW105', attempts }));
    });

    server.middlewares.use('/__openplc/write', async (request, response) => {
      response.setHeader('Content-Type', 'application/json');
      if (request.method !== 'POST') return void (response.statusCode = 405, response.end(JSON.stringify({ error: 'POST required' })));
      let body = '';
      request.on('data', (chunk) => { body += String(chunk); });
      request.on('end', async () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const host = String(parsed.host ?? '127.0.0.1');
          const port = Number(parsed.port ?? 502);
          const unitId = Number(parsed.unitId ?? 1);
          const address = Number(parsed.address ?? 100);
          const values = Array.isArray(parsed.values) ? parsed.values.map(Number) : [];
          const priority = parsed.priority === 'control' ? 'control' : 'telemetry';
          if (!validOpenPlcHost(host) || !Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(unitId) || unitId < 0 || unitId > 255 || !Number.isInteger(address) || address < 0 || address > 65535 || !values.length || values.length > 123 || values.some((word) => !Number.isInteger(word) || word < 0 || word > 65535)) throw new Error('Invalid Modbus write request');
          const functionCode = values.length === 1 ? 6 : 16;
          const frame = await openPlcRequest({ host, port, unitId, functionCode, address, values, priority });
          response.end(JSON.stringify({ ok: true, functionCode, transactionId: frame.readUInt16BE(0), receivedAt: new Date().toISOString() }));
        } catch (error) {
          response.statusCode = 502;
          response.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'OpenPLC write failed' }));
        }
      });
    });
  },
});

const safeName = (value: string) => value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'item';

const observabilityPlugin = () => ({
  name: 'local-communication-observability',
  configureServer(server) {
    server.middlewares.use('/__observability/events', async (request, response) => {
      response.setHeader('Content-Type', 'application/json');
      if (request.method !== 'POST') {
        response.statusCode = 405;
        response.end(JSON.stringify({ error: 'POST required' }));
        return;
      }
      let body = '';
      request.on('data', (chunk) => {
        body += String(chunk);
        if (body.length > 2_000_000) request.destroy();
      });
      request.on('end', async () => {
        try {
          const parsed = JSON.parse(body || '{}') as { sessionId?: string; events?: unknown[] };
          const session = safeName(String(parsed.sessionId ?? 'default-session'));
          const events = Array.isArray(parsed.events) ? parsed.events.filter((event) => event && typeof event === 'object') : [];
          if (events.length > 100 || !events.length) throw new Error('Invalid observability batch');
          const sessionDir = join(observabilityRoot, session);
          const eventPath = join(sessionDir, 'events.ndjson');
          await mkdir(sessionDir, { recursive: true });
          try {
            const current = await stat(eventPath);
            if (current.size > 20 * 1024 * 1024) await rename(eventPath, join(sessionDir, `events-${Date.now()}.ndjson`));
          } catch {
            // First batch for this session.
          }
          await appendFile(eventPath, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`, 'utf8');
          await writeFile(join(sessionDir, 'manifest.json'), JSON.stringify({ sessionId: session, updatedAt: new Date().toISOString(), eventCount: events.length, path: `project-telemetry/${session}/events.ndjson` }, null, 2), 'utf8');
          response.end(JSON.stringify({ ok: true, path: `project-telemetry/${session}/events.ndjson`, count: events.length }));
        } catch (error) {
          response.statusCode = 400;
          response.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Observability write failed' }));
        }
      });
    });
  },
});

const warehousePlugin = () => ({
  name: 'local-warehouse-api',
  configureServer(server) {
    server.middlewares.use('/__warehouse/save', async (request, response) => {
      if (request.method !== 'POST') {
        response.statusCode = 405;
        response.end();
        return;
      }

      let body = '';
      request.on('data', (chunk) => {
        body += String(chunk);
      });
      request.on('end', async () => {
        try {
          const parsed = JSON.parse(body);
          const projectId = safeName(String(parsed.projectId ?? 'default-project'));
          const items = Array.isArray(parsed.items) ? parsed.items : [];
          const projectDir = join(warehouseRoot, projectId);
          await mkdir(projectDir, { recursive: true });

          const manifestPath = join(projectDir, 'manifest.json');
          let manifest = { projectId, items: [] };
          try {
            manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
          } catch {
            manifest = { projectId, items: [] };
          }

          const existing = new Set(manifest.items.map((item) => item.key));
          let saved = 0;
          let skipped = 0;
          for (const entry of items) {
            const key = safeName(String(entry.key ?? entry.item?.id ?? randomUUID()));
            const fileName = `${key}.assetpart.json`;
            if (existing.has(key)) {
              skipped += 1;
              continue;
            }
            const payload = JSON.stringify(entry.item, null, 2);
            await writeFile(join(projectDir, fileName), payload, 'utf8');
            manifest.items.push({
              key,
              fileName,
              name: entry.item?.name ?? key,
              itemType: entry.item?.itemType ?? 'part',
              category: entry.item?.category ?? 'General',
              className: entry.item?.className ?? 'Component',
              savedAt: new Date().toISOString(),
              sizeBytes: Buffer.byteLength(payload),
            });
            existing.add(key);
            saved += 1;
          }

          await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ saved, skipped, manifest }));
        } catch (error) {
          response.statusCode = 500;
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Warehouse save failed' }));
        }
      });
    });

    server.middlewares.use('/__warehouse/save-glb', async (request, response) => {
      if (request.method !== 'POST') {
        response.statusCode = 405;
        response.end();
        return;
      }

      const chunks: Buffer[] = [];
      request.on('data', (chunk) => {
        chunks.push(Buffer.from(chunk));
      });
      request.on('end', async () => {
        try {
          const url = new URL(request.url ?? '', 'http://127.0.0.1');
          const projectId = safeName(String(url.searchParams.get('projectId') ?? 'default-project'));
          const key = safeName(String(url.searchParams.get('key') ?? randomUUID()));
          const overwrite = url.searchParams.get('overwrite') === '1';
          const projectDir = join(warehouseRoot, projectId);
          await mkdir(projectDir, { recursive: true });

          const manifestPath = join(projectDir, 'manifest.json');
          let manifest = { projectId, items: [] };
          try {
            manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
          } catch {
            manifest = { projectId, items: [] };
          }

          const existingIndex = manifest.items.findIndex((item) => item.key === key);
          if (existingIndex >= 0 && !overwrite) {
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify({ saved: 0, skipped: 1, manifest }));
            return;
          }

          const previousFileName = existingIndex >= 0 ? manifest.items[existingIndex]?.fileName : undefined;
          const fileName = previousFileName && String(previousFileName).toLowerCase().endsWith('.glb') ? previousFileName : `${key}.glb`;
          const payload = Buffer.concat(chunks);
          await writeFile(join(projectDir, fileName), payload);
          const nextEntry = {
            key,
            fileName,
            name: key,
            itemType: 'part',
            category: 'General',
            className: 'Component',
            savedAt: new Date().toISOString(),
            sizeBytes: payload.byteLength,
          };
          if (existingIndex >= 0) manifest.items[existingIndex] = { ...manifest.items[existingIndex], ...nextEntry };
          else manifest.items.push(nextEntry);

          await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ saved: 1, skipped: 0, replaced: existingIndex >= 0 ? 1 : 0, manifest }));
        } catch (error) {
          response.statusCode = 500;
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Warehouse GLB save failed' }));
        }
      });
    });

    server.middlewares.use('/__warehouse/metadata', async (request, response) => {
      if (request.method !== 'POST') {
        response.statusCode = 405;
        response.end();
        return;
      }

      let body = '';
      request.on('data', (chunk) => {
        body += String(chunk);
      });
      request.on('end', async () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const projectId = safeName(String(parsed.projectId ?? 'default-project'));
          const key = safeName(String(parsed.key ?? ''));
          const metadata = parsed.metadata ?? {};
          const projectDir = join(warehouseRoot, projectId);
          const manifestPath = join(projectDir, 'manifest.json');
          const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
          const index = Array.isArray(manifest.items) ? manifest.items.findIndex((item) => item.key === key) : -1;
          if (index < 0) {
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify({ updated: 0 }));
            return;
          }

          manifest.items[index] = {
            ...manifest.items[index],
            name: metadata.name ?? manifest.items[index].name,
            itemType: metadata.itemType ?? manifest.items[index].itemType,
            category: metadata.category ?? manifest.items[index].category,
            className: metadata.className ?? manifest.items[index].className,
            code: metadata.code,
            objectName: metadata.objectName,
            sourceAssetName: metadata.sourceAssetName,
            material: metadata.material,
            thumbnailDataUrl: metadata.thumbnailDataUrl,
            functionalComponent: metadata.functionalComponent,
            functionalAssembly: metadata.functionalAssembly,
            savedAt: new Date().toISOString(),
          };
          await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ updated: 1, manifest }));
        } catch (error) {
          response.statusCode = 500;
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Warehouse metadata save failed' }));
        }
      });
    });

    server.middlewares.use('/__warehouse/load', async (request, response) => {
      try {
        const url = new URL(request.url ?? '', 'http://127.0.0.1');
        const projectId = safeName(String(url.searchParams.get('projectId') ?? 'default-project'));
        const projectDir = join(warehouseRoot, projectId);
        const manifestPath = join(projectDir, 'manifest.json');
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
        const items = [];
        for (const entry of manifest.items ?? []) {
          if (String(entry.fileName).toLowerCase().endsWith('.glb')) {
            const buffer = await readFile(join(projectDir, entry.fileName));
            const geometry = {
              kind: 'imported-model',
              assetName: entry.fileName,
              assetDataUrl: `data:model/gltf-binary;base64,${buffer.toString('base64')}`,
              sourceFormat: 'glb',
              importScale: 1,
              importOffset: [0, 0, 0],
              originalBounds: [1, 1, 1],
              normalizedBounds: [1, 1, 1],
              bones: [],
              animations: [],
              joints: [],
              validatedMotions: [],
              freePartTransforms: [],
              partMaterials: [],
              isolatedObjectNames: [],
              partObjectNames: [],
            };
            const material = entry.material ?? { name: 'Stored GLB', color: '#8b949e', roughness: 0.52, metalness: 0.08 };
            const storageMetadata = {
              sourceFormat: 'glb',
              originalBounds: [1, 1, 1],
              storedAt: entry.savedAt,
              updatedAt: entry.savedAt,
              storageKey: entry.key,
              storageProjectId: projectId,
              storageFileName: entry.fileName,
            };

            if (entry.itemType === 'assembly') {
              items.push({
                id: `assembly_${entry.key}`,
                itemType: 'assembly',
                thumbnailDataUrl: entry.thumbnailDataUrl,
                code: entry.code ?? entry.key,
                name: entry.name,
                category: 'Assemblies',
                className: entry.className ?? 'Composite',
                sourceAssetName: entry.sourceAssetName ?? entry.fileName,
                assemblyNodes: [
                  {
                    id: `node_${entry.key}`,
                    name: entry.name,
                    geometry,
                    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
                    material,
                    visible: true,
                    locked: false,
                    createdAt: entry.savedAt,
                  },
                ],
                functionalAssembly: entry.functionalAssembly,
                metadata: {
                  ...storageMetadata,
                  sourceFormat: 'assembly',
                },
              });
              continue;
            }

            items.push({
              id: `part_${entry.key}`,
              itemType: 'part',
              thumbnailDataUrl: entry.thumbnailDataUrl,
              code: entry.code ?? entry.key,
              name: entry.name,
              category: entry.category ?? 'General',
              className: entry.className ?? 'Component',
              sourceNodeId: `file_${entry.key}`,
              sourceAssetName: entry.sourceAssetName ?? entry.fileName,
              objectName: entry.objectName ?? entry.name,
              geometry,
              material,
              functionalComponent: entry.functionalComponent,
              metadata: {
                ...storageMetadata,
                sourceFormat: 'glb',
              },
            });
          } else {
            items.push(JSON.parse(await readFile(join(projectDir, entry.fileName), 'utf8')));
          }
        }
        const files = await readdir(projectDir).catch(() => []);
        const usageBytes = (
          await Promise.all(
            files.map(async (fileName) => {
              const info = await stat(join(projectDir, fileName));
              return info.size;
            }),
          )
        ).reduce((total, size) => total + size, 0);
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ manifest, items, usageBytes }));
      } catch {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ manifest: { items: [] }, items: [], usageBytes: 0 }));
      }
    });

    server.middlewares.use('/__warehouse/projects', async (request, response) => {
      if (request.method !== 'GET') {
        response.statusCode = 405;
        response.end();
        return;
      }

      try {
        const projectNames = await readdir(warehouseRoot).catch(() => []);
        const projects = [];
        for (const projectId of projectNames) {
          const projectDir = join(warehouseRoot, projectId);
          const info = await stat(projectDir).catch(() => undefined);
          if (!info?.isDirectory()) continue;

          const manifestPath = join(projectDir, 'manifest.json');
          const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
          const files = await readdir(projectDir).catch(() => []);
          const usageBytes = (
            await Promise.all(
              files.map(async (fileName) => {
                const fileInfo = await stat(join(projectDir, fileName));
                return fileInfo.size;
              }),
            )
          ).reduce((total, size) => total + size, 0);
          const items = Array.isArray(manifest.items) ? manifest.items : [];
          const latestSavedAt = items
            .map((item) => String(item.savedAt ?? ''))
            .filter(Boolean)
            .sort()
            .at(-1);

          projects.push({
            projectId,
            items: items.length,
            usageBytes,
            latestSavedAt: latestSavedAt ?? info.mtime.toISOString(),
          });
        }

        projects.sort((a, b) => b.latestSavedAt.localeCompare(a.latestSavedAt));
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ projects }));
      } catch (error) {
        response.statusCode = 500;
        response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Warehouse projects load failed' }));
      }
    });

    server.middlewares.use('/__warehouse/delete', async (request, response) => {
      if (request.method !== 'POST') {
        response.statusCode = 405;
        response.end();
        return;
      }

      let body = '';
      request.on('data', (chunk) => {
        body += String(chunk);
      });
      request.on('end', async () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const projectId = safeName(String(parsed.projectId ?? 'default-project'));
          const key = safeName(String(parsed.key ?? ''));
          const projectDir = join(warehouseRoot, projectId);
          const manifestPath = join(projectDir, 'manifest.json');
          const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
          const index = Array.isArray(manifest.items) ? manifest.items.findIndex((item) => item.key === key) : -1;
          if (index < 0) {
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify({ deleted: 0 }));
            return;
          }

          const [entry] = manifest.items.splice(index, 1);
          if (entry?.fileName) {
            await unlink(join(projectDir, entry.fileName)).catch(() => undefined);
          }
          await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ deleted: 1, manifest }));
        } catch (error) {
          response.statusCode = 500;
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Warehouse delete failed' }));
        }
      });
    });

    server.middlewares.use('/__warehouse/thumbnail', async (request, response) => {
      if (request.method !== 'POST') {
        response.statusCode = 405;
        response.end();
        return;
      }

      let body = '';
      request.on('data', (chunk) => {
        body += String(chunk);
      });
      request.on('end', async () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const projectId = safeName(String(parsed.projectId ?? 'default-project'));
          const key = safeName(String(parsed.key ?? ''));
          const thumbnailDataUrl = String(parsed.thumbnailDataUrl ?? '');
          const projectDir = join(warehouseRoot, projectId);
          const manifestPath = join(projectDir, 'manifest.json');
          const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
          const index = Array.isArray(manifest.items) ? manifest.items.findIndex((item) => item.key === key) : -1;
          if (index < 0 || !thumbnailDataUrl.startsWith('data:image/')) {
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify({ updated: 0 }));
            return;
          }

          manifest.items[index] = { ...manifest.items[index], thumbnailDataUrl };
          await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ updated: 1 }));
        } catch (error) {
          response.statusCode = 500;
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Warehouse thumbnail save failed' }));
        }
      });
    });
  },
});

export default defineConfig({
  plugins: [react(), warehousePlugin(), modbusControllerPlugin(), openPlcPlugin(), observabilityPlugin()],
  server: {
    port: 5173,
  },
});
