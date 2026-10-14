import net from 'node:net';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const vitePort = Number(process.env.OPENPLC_TEST_VITE_PORT ?? 5217);
const openPlcPort = Number(process.env.OPENPLC_TEST_MODBUS_PORT ?? 15020);
const cobotPath = resolve('3d imported models', 'celda_robotica', 'cobot-6dof.glb');
const values = [1.25, -0.5, 0.75, -1.1, 0.2, 2.4];
const writes = [];
const int16Word = (value) => (Math.round(value * 10000) & 0xffff);
let legacyJointWords = values.map(int16Word);
let scanElapsedMs = 0;
let freezePhysicalScanImage = false;
let rejectedReadCount = 0;

const floatWords = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeFloatBE(value, 0);
  return [buffer.readUInt16BE(0), buffer.readUInt16BE(2)];
};
const signed16 = (word) => (word & 0x8000 ? word - 0x10000 : word);
const smoothstep = (value) => value * value * (3 - (2 * value));
const sampleClip = (clip, time) => {
  const keys = clip.keyframes;
  const nextIndex = keys.findIndex((keyframe) => keyframe.time >= time);
  if (nextIndex <= 0) return keys[0].values;
  const { time: startTime, values: start } = keys[nextIndex - 1];
  const { time: endTime, values: end } = keys[nextIndex];
  const progress = smoothstep((time - startTime) / (endTime - startTime));
  return start.map((value, index) => value + ((end[index] - value) * progress));
};

const modbusServer = net.createServer((socket) => {
  socket.on('error', () => {});
  socket.on('data', (request) => {
    if (request.length < 8) return;
    const transactionId = request.readUInt16BE(0);
    const unitId = request[6];
    const functionCode = request[7];
    if (functionCode === 3) {
      if (rejectedReadCount > 0) {
        rejectedReadCount -= 1;
        socket.destroy();
        return;
      }
      if (!freezePhysicalScanImage) scanElapsedMs = (scanElapsedMs + 250) % 12000;
      const address = request.readUInt16BE(8);
      const quantity = request.readUInt16BE(10);
      // The legacy cobot POU is identified by %QW97=2101. A zero here is
      // intentionally reserved for a mismatch test, not for this fixture.
      const profile = [1, 1, 3, scanElapsedMs, 0, 0, 1000, 2101, 0, 0, ...values.map(int16Word)];
      const physicalProfile = [1, 1, 2, scanElapsedMs, 0, 0, 1000, ...values.map(int16Word), 2500, 5000, 500, 100, 1, 4, 17, 1];
      const words = (address === 0 ? physicalProfile : address === 7 ? values.map(int16Word) : address === 90 ? profile : address === 100 ? legacyJointWords : quantity === 6 ? values.map(int16Word) : values.flatMap(floatWords)).slice(0, quantity);
      while (words.length < quantity) words.push(0);
      const pdu = Buffer.from([3, words.length * 2, ...words.flatMap((word) => [word >> 8, word & 0xff])]);
      socket.write(Buffer.concat([Buffer.from([transactionId >> 8, transactionId & 0xff, 0, 0, 0, pdu.length + 1, unitId]), pdu]));
      return;
    }
    if (functionCode === 6 || functionCode === 16) {
      const address = request.readUInt16BE(8);
      const quantity = functionCode === 6 ? 1 : request.readUInt16BE(10);
      const words = functionCode === 6 ? [request.readUInt16BE(10)] : Array.from({ length: quantity }, (_, index) => request.readUInt16BE(13 + index * 2));
      writes.push({ functionCode, address, words });
      if (address === 100) legacyJointWords = [...words];
      const pdu = Buffer.from([functionCode, address >> 8, address & 0xff, quantity >> 8, quantity & 0xff]);
      socket.write(Buffer.concat([Buffer.from([transactionId >> 8, transactionId & 0xff, 0, 0, 0, pdu.length + 1, unitId]), pdu]));
    }
  });
});

await new Promise((resolveListen, rejectListen) => {
  modbusServer.once('error', rejectListen);
  modbusServer.listen(openPlcPort, '127.0.0.1', resolveListen);
});

const viteBin = resolve('node_modules', 'vite', 'bin', 'vite.js');
const vite = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: resolve('.'), stdio: 'inherit', shell: false });
const waitForServer = async (url) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    try { if ((await fetch(url)).ok) return; } catch { /* Vite is starting. */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 180));
  }
  throw new Error(`Timed out waiting for ${url}`);
};

let browser;
try {
  await waitForServer(`http://127.0.0.1:${vitePort}`);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(`http://127.0.0.1:${vitePort}`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[accept*=".glb"]').setInputFiles(cobotPath);
  await page.waitForFunction(() => window.__assetForgeDocument?.nodes.some((node) => node.geometry?.assetName === 'cobot-6dof.glb' && node.geometry?.kinematicGraph), undefined, { timeout: 120000 });
  await page.getByRole('button', { name: /Digital Twin Scenario/ }).click();
  const dashboard = page.locator('.plc-dashboard');
  await dashboard.waitFor();
  const disconnect = dashboard.getByRole('button', { name: /Disconnect Client/ });
  if (await disconnect.isEnabled()) await disconnect.click();

  const connector = dashboard.locator('.openplc-connector');
  await connector.locator('label').filter({ hasText: 'IP / host' }).locator('input').fill('127.0.0.1');
  await connector.locator('label').filter({ hasText: 'Port' }).locator('input').fill(String(openPlcPort));
  await connector.locator('label').filter({ hasText: 'Port' }).locator('input').fill(String(openPlcPort));
  await connector.locator('label').filter({ hasText: 'Unit ID' }).locator('input').fill('1');
  await connector.locator('label').filter({ hasText: 'HR start' }).locator('input').fill('100');
  await connector.locator('label').filter({ hasText: 'Data' }).locator('select').selectOption('float32-be');
  await dashboard.getByRole('button', { name: 'Connect OpenPLC' }).click();
  await connector.getByText(/ONLINE · SCAN ACTIVE/).waitFor({ timeout: 15000 });
  await page.waitForFunction(() => /RX [1-9]\d*/.test(document.querySelector('.openplc-connector code')?.textContent ?? ''), undefined, { timeout: 15000 });

  const controls = dashboard.locator('.plc-register-control input');
  const physicalJ1 = Number(await controls.nth(0).inputValue());
  const twinJ1 = Number(await controls.nth(6).inputValue());
  if (Math.abs(physicalJ1 - values[0]) > 0.001 || Math.abs(twinJ1 - values[0]) > 0.001) throw new Error(`OpenPLC FC03 value mismatch: physical=${physicalJ1}, twin=${twinJ1}`);

  if (await controls.nth(0).isEnabled()) throw new Error('OpenPLC-owned joint control must be read-only.');
  page.once('dialog', (dialog) => void dialog.accept());
  await dashboard.getByRole('button', { name: /Manual PLC|Local Manual/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('.plc-register-control input:not([disabled])').length >= 6, undefined, { timeout: 10000 });
  const twinJoint = await page.evaluate(() => {
    const documentState = window.__assetForgeDocument;
    const node = documentState?.nodes?.find((candidate) => candidate.geometry?.kinematicGraph?.joints?.some((joint) => joint.type !== 'fixed'));
    const joint = node?.geometry?.kinematicGraph?.joints?.find((candidate) => candidate.type !== 'fixed');
    return node && joint ? { nodeId: node.id, jointId: joint.id, value: (node.geometry.kinematicState?.jointValues?.[joint.id] ?? 0) + 0.1 } : undefined;
  });
  if (!twinJoint) throw new Error('No graph joint was available for the OpenPLC twin-to-PLC test.');
  await page.evaluate(({ nodeId, jointId, value }) => {
    window.__assetForgeSetKinematicJointValues?.(nodeId, { [jointId]: value });
  }, twinJoint);
  const bidirectionalDeadline = Date.now() + 5000;
  while (Date.now() < bidirectionalDeadline && !writes.some((write) => write.address === 100 && write.words.length >= 2)) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 80));
  }
  if (!writes.some((write) => write.address === 90 && write.words[0] === 0)) throw new Error('OpenPLC twin-to-PLC manual HOLD write was not observed.');
  if (!writes.some((write) => write.address === 100 && write.words.length >= 2)) throw new Error('OpenPLC twin-to-PLC joint vector write was not observed.');
  await controls.nth(0).fill('2.1');
  if (Math.abs(Number(await controls.nth(0).inputValue()) - 2.1) > 0.011) throw new Error('Local Manual did not accept the J1 command.');

  await dashboard.getByRole('button', { name: 'Disconnect OpenPLC' }).click();
  await connector.getByRole('button', { name: 'Auto Detect Map' }).click();
  await connector.getByText(/Detected %QW90\.\.105/).waitFor({ timeout: 10000 });
  await dashboard.getByRole('button', { name: 'Connect OpenPLC' }).click();
  await page.waitForFunction(
    (expected) => {
      const inputs = document.querySelectorAll('.plc-dashboard .plc-register-control input');
      return /6 HR/.test(document.querySelector('.openplc-connector code')?.textContent ?? '') && inputs.length > 1 && Math.abs(Number(inputs[1].value) - expected) < 0.00011;
    },
    values[1],
    { timeout: 15000 },
  );
  const int16J2 = Number(await controls.nth(1).inputValue());
  if (Math.abs(int16J2 - values[1]) > 0.00011) throw new Error(`OpenPLC INT16 decode mismatch: ${int16J2}`);
  if (await controls.nth(1).isEnabled()) throw new Error('INT16 OpenPLC joint control must remain read-only.');

  await dashboard.getByRole('button', { name: 'Disconnect OpenPLC' }).click();
  await connector.locator('label').filter({ hasText: 'PLC profile' }).locator('select').selectOption('s7-1200-robot-holding');
  await connector.locator('label').filter({ hasText: 'IP / host' }).locator('input').fill('127.0.0.1');
  await connector.locator('label').filter({ hasText: 'Port' }).locator('input').fill(String(openPlcPort));
  if (await connector.locator('label').filter({ hasText: 'HR start' }).locator('input').inputValue() !== '0') throw new Error('Physical PLC profile did not select process image HR0..20.');
  page.once('dialog', (dialog) => dialog.accept());
  await connector.getByRole('button', { name: 'Auto Detect Map' }).click();
  await connector.getByText('ONLINE · SCAN ACTIVE', { exact: true }).waitFor({ timeout: 15000 });
  await page.waitForFunction(
    (expected) => Math.abs(Number(document.querySelectorAll('.plc-register-control input')[0]?.value) - expected) < 0.00011,
    values[0],
    { timeout: 15000 },
  );
  freezePhysicalScanImage = true;
  scanElapsedMs = 11900;
  await page.waitForTimeout(2600);
  if (!await connector.getByText('ONLINE · SCAN ACTIVE', { exact: true }).isVisible()) throw new Error('A static physical RobotHolding image was incorrectly diagnosed as a stopped PLC scan.');
  if ((await connector.innerText()).includes('scan is not advancing')) throw new Error('Physical PLC displayed the OpenPLC elapsed-time watchdog warning.');
  rejectedReadCount = 100;
  await connector.getByText('CONNECTING', { exact: true }).waitFor({ timeout: 10000 });
  if (!await connector.getByText('PLC DISCONNECTED', { exact: true }).isVisible()) throw new Error(`Unavailable physical PLC still displayed a connected indicator. Connector: ${await connector.innerText()}`);
  if (!(await connector.innerText()).includes('STALE RAW')) throw new Error('Last physical process image was not identified as stale during reconnect.');
  rejectedReadCount = 0;
  await connector.getByText(/ONLINE.*SCAN ACTIVE/).waitFor({ timeout: 10000 });
  await dashboard.getByRole('button', { name: /^Auto$/ }).click();
  await dashboard.getByRole('button', { name: /IoT en movimiento/ }).click();
  await page.waitForFunction(() => document.querySelector('.openplc-command-control')?.textContent?.includes('HR0'));
  if (!writes.some((write) => write.address === 0 && write.words[0] === 1)) throw new Error('Physical PLC AUTO did not write Command=1 to HR0.');
  if (!writes.some((write) => write.address === 20 && write.words[0] === 1)) throw new Error('Physical PLC motion policy did not write SensorPolicy=1 to HR20.');
  const clipReference = await page.evaluate(() => {
    const node = window.__assetForgeDocument?.nodes.find((candidate) => candidate.geometry?.assetName === 'cobot-6dof.glb');
    const graph = node?.geometry?.kinematicGraph;
    const clip = graph?.motionClips?.find((candidate) => /pick|place|ciclo/i.test(candidate.name)) ?? graph?.motionClips?.[0];
    const orderOf = (joint) => {
      const order = joint.evidence?.find((entry) => typeof entry.metadata?.order === 'string')?.metadata?.order;
      const match = String(order ?? joint.name).match(/J([1-6])/i);
      return match ? Number(match[1]) : 999;
    };
    const joints = [...(graph?.joints ?? [])].filter((joint) => joint.type !== 'fixed').sort((left, right) => orderOf(left) - orderOf(right)).slice(0, 6);
    if (!clip || joints.length !== 6) return null;
    return {
      name: clip.name,
      keyframes: [...clip.keyframes].sort((left, right) => left.time - right.time).map((keyframe) => ({
        time: keyframe.time,
        values: joints.map((joint) => keyframe.jointValues[joint.id] ?? 0),
      })),
    };
  });
  if (!clipReference?.keyframes.length) throw new Error('Could not read the cobot Start Smart Demo clip from KinematicGraph.');
  const writesBeforeDemo = writes.length;
  let physicalDemoConfirmed = false;
  page.once('dialog', (dialog) => {
    physicalDemoConfirmed = true;
    void dialog.accept();
  });
  await connector.getByRole('button', { name: 'Run Start Demo' }).click();
  if (!physicalDemoConfirmed) throw new Error('Physical Start Demo did not request the required safety confirmation.');
  await page.waitForTimeout(1800);
  const stopPhysicalDemo = connector.getByRole('button', { name: 'Stop PLC Demo' });
  if (await stopPhysicalDemo.isVisible()) await stopPhysicalDemo.click();
  const demoWrites = writes.slice(writesBeforeDemo).filter((write) => write.address === 7 && write.words.length === 6);
  if (demoWrites.length < 3) throw new Error(`Physical Start Demo produced only ${demoWrites.length} HR7..HR12 frames. Dashboard: ${await dashboard.innerText()}`);
  if (new Set(demoWrites.map((write) => write.words.join(','))).size < 2) throw new Error('Physical Start Demo did not stream changing kinematic frames.');
  const initialPose = demoWrites[0].words.map((word) => signed16(word) / 10000);
  const leadInTarget = sampleClip(clipReference, 0);
  demoWrites.forEach((write, frameIndex) => {
    const trajectoryElapsed = frameIndex * 0.05;
    const leadInProgress = Math.min(1, trajectoryElapsed / 1.2);
    const blend = smoothstep(leadInProgress);
    const clipPose = sampleClip(clipReference, Math.max(0, trajectoryElapsed - 1.2));
    const expected = trajectoryElapsed < 1.2
      ? initialPose.map((value, index) => value + ((leadInTarget[index] - value) * blend))
      : clipPose;
    const actual = write.words.map((word) => signed16(word) / 10000);
    actual.forEach((value, jointIndex) => {
      if (Math.abs(value - expected[jointIndex]) > 0.00011) {
        throw new Error(`Physical Start Demo frame ${frameIndex} J${jointIndex + 1} mismatch: ${value} != ${expected[jointIndex]}`);
      }
    });
  });
  if (!writes.slice(writesBeforeDemo).some((write) => write.address === 0 && write.words[0] === 0)) throw new Error('Physical Start Demo did not select HR0=0 manual trajectory authority.');
  const savedEndpoint = await page.evaluate(() => JSON.parse(localStorage.getItem('twinaxis.plcEndpoint.v1') ?? '{}'));
  if (savedEndpoint.endpointProfile !== 's7-1200-robot-holding' || savedEndpoint.host !== '127.0.0.1' || !savedEndpoint.autoReconnect || !savedEndpoint.connectionAuthorized) {
    throw new Error(`Physical PLC endpoint was not persisted for automatic reconnect: ${JSON.stringify(savedEndpoint)}`);
  }

  console.log('PLC bridge regression passed: OpenPLC and physical S7-1200 RobotHolding profiles reached the twin with safe authority transfer.');
} finally {
  await browser?.close();
  if (!vite.killed) vite.kill('SIGTERM');
  await new Promise((resolveClose) => modbusServer.close(resolveClose));
}
