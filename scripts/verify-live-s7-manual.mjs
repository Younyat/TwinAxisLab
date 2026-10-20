import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const base = 'http://127.0.0.1:5187';
const endpoint = { host: '192.168.0.20', port: 502, unitId: 1 };
const output = resolve('artifacts/live-s7-manual');
mkdirSync(output, { recursive: true });
async function read() {
  const response = await fetch(`${base}/__openplc/read?${new URLSearchParams({ ...endpoint, address: 0, quantity: 61, profile: 'ft511938-unified' })}`);
  const result = await response.json();
  if (!result.ok) throw Error(JSON.stringify(result));
  return result.registers;
}
function real(words, offset) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt16BE(words[offset], 0);
  buffer.writeUInt16BE(words[offset + 1], 2);
  return buffer.readFloatBE(0);
}
const initial = await read();
if (initial[58] !== 1 || initial[29] !== 0 || initial[0] !== 0 || initial[55] !== 0) throw Error('Expected isolated idle S7 simulation');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
const evidence = [];
page.on('dialog', dialog => dialog.accept());
try {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.locator('input[accept*=".glb"]').setInputFiles(resolve('../3D Asset Platform/3d imported models/celda_robotica/brazo-cilindrico-new/modelo/brazo_cilindrico_4_nodos.glb'));
  await page.waitForFunction(() => window.__assetForgeDocument?.nodes.some(node => node.geometry?.kinematicGraph), undefined, { timeout: 120000 });
  await page.getByRole('button', { name: /Digital Twin Scenario/ }).click();
  const dashboard = page.locator('.plc-dashboard');
  const connector = dashboard.locator('.openplc-connector');
  await connector.locator('label').filter({ hasText: 'PLC profile' }).locator('select').selectOption('ft511938-unified');
  await dashboard.getByRole('checkbox', { name: /Banco virtual en S7/ }).check();
  await connector.getByRole('button', { name: 'Connect FT511938 PLC', exact: true }).click();
  await connector.getByText('FT511938 CONNECTED', { exact: true }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  await dashboard.getByRole('button', { name: 'Manual PLC', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('button.active.manual'), undefined, { timeout: 15000 });
  const controls = dashboard.locator('.plc-robot-screen').nth(1).locator('.plc-register-control input');
  if (await controls.nth(0).isDisabled()) throw Error('Manual control remains disabled');
  const before = await read();
  await controls.nth(0).evaluate(input => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '-0.35');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const deadline = Date.now() + 25000;
  let reached = false;
  while (Date.now() < deadline) {
    await page.waitForTimeout(600);
    const words = await read();
    if (words[58] !== 1 || words[29] !== 0 || words[49] !== 0) throw Error('Bench identity or alarm invalid');
    const sample = { time: new Date().toISOString(), command: words[0], mode: words[47], target: real(words, 6), position: real(words, 30), run: words[55], virtualQ: words[54], echo: words[57] };
    evidence.push(sample);
    if (Math.abs(sample.target + 20.05) < 1 && Math.abs(sample.position - sample.target) <= 1) { reached = true; break; }
  }
  if (!reached || Math.abs(real(before, 30) - evidence.at(-1).position) < 1) throw Error('Manual movement not confirmed');
  await dashboard.locator('.plc-twin-split').scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(output, 'manual-s7-browser.png'), fullPage: true });
  console.log(JSON.stringify({ result: 'PASS', realS7: true, browserManualControl: true, before: real(before, 30), final: evidence.at(-1), screenshots: output }));
} catch (error) {
  await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true });
  console.error((await page.locator('.openplc-connector').innerText().catch(() => '')));
  throw error;
} finally {
  await fetch(`${base}/__openplc/write`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...endpoint, address: 0, values: [0, 0, 0, 0, 0], priority: 'control' }) });
  const stopped = await read();
  writeFileSync(resolve(output, 'evidence.json'), JSON.stringify({ evidence, stopped: { command: stopped[0], enable: stopped[1], run: stopped[55], virtualQ: stopped[54] } }, null, 2));
  console.log(JSON.stringify({ finalSTOP: stopped[0] === 0 && stopped[1] === 0 && stopped[55] === 0 && stopped[54] === 0 }));
  await browser.close();
}
