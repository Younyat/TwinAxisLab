import net from 'node:net';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const root = resolve('.');
const vitePort = Number(process.env.FT511938_TEST_VITE_PORT ?? 5227);
const modbusPort = Number(process.env.FT511938_TEST_MODBUS_PORT ?? 15027);
const fixtureDirectory = resolve(tmpdir(), 'twinaxis-ft511938-regression');
const sourceAsset = resolve('3d imported models', 'celda_robotica', 'cobot-6dof.glb');
const fixtureAsset = resolve(fixtureDirectory, 'brazo_cilindrico_4_nodos.glb');
const words = new Array(61).fill(0);
const writes = [];
let reads = 0;
let motionTarget;
let position = [0, 300, 60, 50];

const floatWords = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeFloatBE(value, 0);
  return [buffer.readUInt16BE(0), buffer.readUInt16BE(2)];
};

const readFloat = (offset) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt16BE(words[offset] & 0xffff, 0);
  buffer.writeUInt16BE(words[offset + 1] & 0xffff, 2);
  return buffer.readFloatBE(0);
};

const writeFloat = (offset, value) => {
  const encoded = floatWords(value);
  words[offset] = encoded[0];
  words[offset + 1] = encoded[1];
};

const writeWord = (offset, value) => {
  words[offset] = Math.round(value) & 0xffff;
};

const copyVector = (source, offset) => source.forEach((value, index) => writeFloat(offset + index * 2, value));

const refreshProcessImage = () => {
  if (motionTarget) {
    position = position.map((value, index) => {
      const delta = motionTarget[index] - value;
      return Math.abs(delta) < 0.05 ? motionTarget[index] : value + delta * 0.4;
    });
    copyVector(position, 30);
    copyVector(motionTarget, 38);
    if (position.every((value, index) => Math.abs(value - motionTarget[index]) < 0.05)) {
      position = [...motionTarget];
      copyVector(position, 30);
      writeWord(46, 2);
      writeWord(47, 4);
      writeWord(50, 1);
      writeWord(60, (words[60] + 1) & 0xffff);
      motionTarget = undefined;
    } else {
      writeWord(46, 1);
      writeWord(47, 4);
    }
  }
  writeWord(57, words[5]);
};

const initializeProcessImage = () => {
  writeWord(0, 0);
  writeWord(1, 1);
  writeWord(2, 0);
  writeWord(3, 0);
  writeWord(4, 0);
  writeWord(5, 0);
  copyVector([0, 300, 60, 50], 6);
  writeWord(14, 0);
  writeWord(15, 1);
  writeWord(16, 17);
  writeWord(17, 0);
  writeWord(18, 2200);
  writeWord(19, 5000);
  writeWord(20, 0);
  writeWord(21, 0);
  writeWord(22, 0);
  writeWord(23, 1);
  writeWord(24, 1);
  writeWord(25, 15);
  writeWord(26, 0);
  writeWord(27, 0);
  writeWord(28, 0);
  writeWord(29, 0);
  copyVector(position, 30);
  copyVector(position, 38);
  writeWord(46, 0);
  writeWord(47, 0);
  writeWord(48, 0);
  writeWord(49, 0);
  writeWord(50, 0);
  writeWord(51, 0);
  writeWord(52, 0);
  writeWord(53, 1000);
  writeWord(54, 0);
  writeWord(55, 0);
  writeWord(56, 0);
  writeWord(57, 0);
  writeWord(58, 1);
  writeWord(59, 0);
  writeWord(60, 0);
};

const applyWrite = (address, values) => {
  values.forEach((value, index) => writeWord(address + index, value));
  if (address === 14 && values.length === 7) {
    // Emulate a healthy local IoT process image. The real FT POU must not
    // move while validity/age/quality are stale, even in SimulationMode.
    writeWord(15, 1);
    writeWord(16, 17);
    writeWord(17, 0);
    writeWord(18, 2200);
    writeWord(19, 5000);
    writeWord(20, 0);
    writeWord(52, 0);
    writeWord(53, 1000);
  }
  if (address <= 5 && address + values.length > 5) writeWord(57, words[5]);
  if (address <= 6 && address + values.length >= 14) {
    const requested = [readFloat(6), readFloat(8), readFloat(10), readFloat(12)];
    requested.forEach((value, index) => writeFloat(38 + index * 2, value));
  }
  if (address <= 0 && address + values.length > 0) {
    const command = words[0] & 0xffff;
    if (command === 4) {
      motionTarget = [readFloat(6), readFloat(8), readFloat(10), readFloat(12)];
      writeWord(46, 1);
      writeWord(47, 4);
      writeWord(50, 0);
    } else if (command === 0) {
      motionTarget = undefined;
      writeWord(46, 0);
      writeWord(47, 0);
      writeWord(50, 0);
      copyVector(position, 38);
    }
  }
};

const responseFrame = (transactionId, unitId, pdu) => {
  const header = Buffer.from([
    transactionId >> 8,
    transactionId & 0xff,
    0,
    0,
    (pdu.length + 1) >> 8,
    (pdu.length + 1) & 0xff,
    unitId,
  ]);
  return Buffer.concat([header, pdu]);
};

const modbusServer = net.createServer((socket) => {
  let pending = Buffer.alloc(0);
  socket.on('error', () => undefined);
  socket.on('data', (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 7) {
      const frameLength = 6 + pending.readUInt16BE(4);
      if (pending.length < frameLength) return;
      const request = pending.subarray(0, frameLength);
      pending = pending.subarray(frameLength);
      const transactionId = request.readUInt16BE(0);
      const unitId = request[6];
      const functionCode = request[7];
      if (functionCode === 3) {
        reads += 1;
        refreshProcessImage();
        const address = request.readUInt16BE(8);
        const quantity = request.readUInt16BE(10);
        const selected = words.slice(address, address + quantity);
        while (selected.length < quantity) selected.push(0);
        socket.write(responseFrame(transactionId, unitId, Buffer.from([3, selected.length * 2, ...selected.flatMap((value) => [value >> 8, value & 0xff])] )));
      } else if (functionCode === 6) {
        const address = request.readUInt16BE(8);
        const values = [request.readUInt16BE(10)];
        writes.push({ functionCode, address, values: [...values] });
        applyWrite(address, values);
        socket.write(responseFrame(transactionId, unitId, request.subarray(7, 12)));
      } else if (functionCode === 16) {
        const address = request.readUInt16BE(8);
        const quantity = request.readUInt16BE(10);
        const values = Array.from({ length: quantity }, (_, index) => request.readUInt16BE(13 + index * 2));
        writes.push({ functionCode, address, values: [...values] });
        applyWrite(address, values);
        socket.write(responseFrame(transactionId, unitId, Buffer.from([16, request[8], request[9], request[10], request[11]])));
      }
    }
  });
});

const waitForServer = async (url, timeoutMs = 30000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 150));
    }
  }
  throw new Error(`Timed out waiting for ${url}`);
};

const canvasSample = async (page) => page.locator('canvas').first().evaluate((canvas) => {
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true }) || canvas.getContext('webgl', { preserveDrawingBuffer: true });
  if (!gl) return [];
  const pixels = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const sample = [];
  for (let y = 0; y < canvas.height; y += 18) {
    for (let x = 0; x < canvas.width; x += 18) {
      const index = (y * canvas.width + x) * 4;
      sample.push(pixels[index], pixels[index + 1], pixels[index + 2]);
    }
  }
  return sample;
});

const sampleDiff = (before, after) => {
  let changed = 0;
  for (let index = 0; index < Math.min(before.length, after.length); index += 3) {
    const difference = Math.abs(before[index] - after[index]) + Math.abs(before[index + 1] - after[index + 1]) + Math.abs(before[index + 2] - after[index + 2]);
    if (difference > 24) changed += 1;
  }
  return changed;
};

initializeProcessImage();
mkdirSync(fixtureDirectory, { recursive: true });
copyFileSync(sourceAsset, fixtureAsset);
await new Promise((resolveListen, rejectListen) => {
  modbusServer.once('error', rejectListen);
  modbusServer.listen(modbusPort, '127.0.0.1', resolveListen);
});

const viteBin = resolve('node_modules', 'vite', 'bin', 'vite.js');
const vite = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
let browser;

try {
  await waitForServer(`http://127.0.0.1:${vitePort}`);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const pageErrors = [];
  const consoleMessages = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => consoleMessages.push(message.text()));
  page.on('dialog', (dialog) => {
    consoleMessages.push(`[dialog:${dialog.type()}] ${dialog.message()}`);
    void dialog.accept();
  });
  await page.goto(`http://127.0.0.1:${vitePort}`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('input[accept*=".glb"]').setInputFiles(fixtureAsset);
  await page.waitForFunction(() => window.__assetForgeDocument?.nodes.some((node) => node.geometry?.assetName === 'brazo_cilindrico_4_nodos.glb' && node.geometry?.kinematicGraph), undefined, { timeout: 120000 });
  await page.getByRole('button', { name: /Digital Twin Scenario/ }).click();
  const dashboard = page.locator('.plc-dashboard');
  await dashboard.waitFor();

  const connector = dashboard.locator('.openplc-connector');
  await connector.locator('label').filter({ hasText: 'PLC profile' }).locator('select').selectOption('ft511938-unified');
  await connector.getByText(/FT511938 unified adapter selected/).waitFor({ timeout: 10000 });
  await connector.locator('label').filter({ hasText: 'IP / host' }).locator('input').fill('127.0.0.1');
  await connector.locator('label').filter({ hasText: 'Port' }).locator('input').fill(String(modbusPort));
  await connector.locator('label').filter({ hasText: 'Unit ID' }).locator('input').fill('1');
  const connectButton = connector.getByRole('button', { name: 'Connect FT511938 PLC', exact: true });
  if (await connectButton.isDisabled()) throw new Error(`FT connect button is disabled. Connector: ${await connector.innerText()}`);
  await connectButton.click();
  try {
    await connector.getByText(/ONLINE.*SCAN ACTIVE/).waitFor({ timeout: 30000 });
  } catch {
    throw new Error(`FT connector did not become online. Connector: ${await connector.innerText()}`);
  }
  await connector.getByText('FT511938 CONNECTED', { exact: true }).waitFor({ timeout: 30000 });
  await connector.getByText(/61 HR FT511938/).waitFor({ timeout: 30000 });
  if (reads < 2) throw new Error(`FT process image was not polled in real time: ${reads} reads.`);
  await page.waitForTimeout(1000);

  const idlePolicyButton = dashboard.getByRole('button', { name: 'Auto · IoT sin movimiento', exact: true });
  const motionPolicyButton = dashboard.getByRole('button', { name: 'Auto · IoT en movimiento', exact: true });
  if (!(await idlePolicyButton.isVisible()) || !(await motionPolicyButton.isVisible())) throw new Error(`The two AUTO IoT policies are not visible in the dashboard. Dashboard: ${await dashboard.innerText()}`);

  // Deliberately make the IoT sample invalid. Manual PLC must remain
  // available because this gate belongs to AUTO only.
  writeWord(15, 0);
  writeWord(16, 0);
  writeWord(17, 65535);
  writeWord(20, 0);
  writeWord(24, 0);
  writeWord(52, 3);
  writeWord(53, 0);
  await page.waitForTimeout(350);

  const before = await canvasSample(page);
  const manualButton = dashboard.getByRole('button', { name: 'Manual PLC', exact: true });
  if (await manualButton.isDisabled()) throw new Error(`FT manual command button is disabled after connection. Dashboard: ${await dashboard.innerText()}`);
  await manualButton.click();
  await page.waitForTimeout(50);
  try {
    await page.waitForFunction(() => document.querySelector('button.active.manual')?.textContent?.includes('Manual PLC') ?? false, undefined, { timeout: 15000 });
  } catch {
    throw new Error(`FT manual authority was not enabled. Console: ${JSON.stringify(consoleMessages.slice(-6))}. Immediate dashboard: ${await dashboard.innerText()}. Control writes: ${JSON.stringify(writes.filter((write) => write.address < 14))}. Recent writes: ${JSON.stringify(writes.slice(-12))}. Dashboard: ${await dashboard.innerText()}`);
  }
  if (!writes.some((write) => write.address === 0 && write.values[0] === 0)) throw new Error('Manual authority did not write Cmd=0 HOLD.');

  const ftPanel = dashboard.locator('.ft511938-test-panel');
  const gotoInputs = ftPanel.locator('.cylindrical4-integrated-goto input');
  const target = [35, 325, 110, 40];
  for (let index = 0; index < target.length; index += 1) await gotoInputs.nth(index).fill(String(target[index]));
  await ftPanel.getByRole('button', { name: 'Send GOTO' }).click();
  try {
    await page.waitForFunction((expected) => {
      const text = document.querySelector('.ft511938-test-panel')?.textContent ?? '';
      return expected.every((value) => text.includes(value.toFixed(2)));
    }, target, { timeout: 30000 });
  } catch {
    throw new Error(`FT GOTO feedback did not show target. Console: ${JSON.stringify(consoleMessages.slice(-8))}. Control writes: ${JSON.stringify(writes.filter((write) => write.address < 14).slice(-20))}. Panel: ${await ftPanel.innerText()}`);
  }
  await page.waitForFunction(() => document.querySelector('.ft511938-test-panel')?.textContent?.includes('mode 4') ?? false, undefined, { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('.ft511938-test-panel')?.textContent?.includes('status 2') ?? false, undefined, { timeout: 30000 });
  const after = await canvasSample(page);
  const changedPixels = sampleDiff(before, after);
  if (changedPixels < 3) throw new Error(`The digital twin did not visibly change after PLC feedback. Changed samples: ${changedPixels}.`);

  const gotoWrite = writes.find((write) => write.address === 6 && write.values.length === 8);
  if (!gotoWrite) throw new Error('TwinAxis did not write the FT511938 ManualTarget REAL32 block HR6..13.');
  if (!writes.some((write) => write.address === 0 && write.values[0] === 4)) throw new Error('TwinAxis did not write Cmd=4 GOTO after updating targets.');
  const decodedTarget = [readFloat(6), readFloat(8), readFloat(10), readFloat(12)];
  if (decodedTarget.some((value, index) => Math.abs(value - target[index]) > 0.01)) throw new Error(`FT target image mismatch: ${decodedTarget.join(', ')}.`);

  const positionBeforeRelease = [...position];
  await manualButton.click();
  await page.waitForTimeout(1200);
  const positionAfterRelease = [...position];
  const lastCommandWrite = writes.filter((write) => write.address === 0).at(-1);
  if (lastCommandWrite?.values[0] !== 0) throw new Error(`Releasing manual authority did not return the PLC to Cmd=0 HOLD: ${JSON.stringify(lastCommandWrite)}.`);
  if (positionAfterRelease.some((value, index) => Math.abs(value - positionBeforeRelease[index]) > 0.001)) throw new Error(`PLC did not hold the released pose: ${positionBeforeRelease} -> ${positionAfterRelease}.`);
  if (!await connector.getByText(/ONLINE.*SCAN ACTIVE/).isVisible()) throw new Error('FT511938 polling disconnected after manual release.');
  if (pageErrors.length) throw new Error(`Browser errors during FT manual exchange: ${pageErrors.join(' | ')}`);

  console.log(JSON.stringify({
    result: 'PASS',
    reads,
    writes: writes.length,
    target,
    decodedTarget,
    heldPosition: positionAfterRelease,
    changedPixels,
    manualHold: true,
    manualIgnoresInvalidIoT: true,
    feedbackMode: 4,
    processImage: 'HR0..HR60',
  }, null, 2));
} finally {
  await browser?.close();
  if (!vite.killed) vite.kill('SIGTERM');
  await new Promise((resolveClose) => modbusServer.close(resolveClose));
  rmSync(fixtureDirectory, { recursive: true, force: true });
}
