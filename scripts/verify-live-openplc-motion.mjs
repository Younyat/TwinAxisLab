import { chromium } from '@playwright/test';

const appUrl = process.env.TWINAXIS_URL ?? 'http://127.0.0.1:5187';

const canvasSample = (locator) => locator.evaluate((canvas) => {
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true }) || canvas.getContext('webgl', { preserveDrawingBuffer: true });
  if (!gl) return [];
  const pixels = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const sample = [];
  for (let y = 0; y < canvas.height; y += 12) {
    for (let x = 0; x < canvas.width; x += 12) {
      const offset = (y * canvas.width + x) * 4;
      sample.push(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
    }
  }
  return sample;
});

const changedPixels = (before, after) => {
  let changed = 0;
  for (let index = 0; index < Math.min(before.length, after.length); index += 3) {
    const difference = Math.abs(before[index] - after[index])
      + Math.abs(before[index + 1] - after[index + 1])
      + Math.abs(before[index + 2] - after[index + 2]);
    if (difference > 24) changed += 1;
  }
  return changed;
};

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1480, height: 980 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Industrial Cell/ }).click();
  await page.getByRole('button', { name: /Industrial Gantry Robot/ }).click();
  await page.locator('.workbench > .viewport canvas').waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: /Digital Twin Scenario/ }).click();

  const dashboard = page.locator('.plc-dashboard');
  await dashboard.waitFor({ timeout: 30000 });
  await dashboard.getByRole('button', { name: /Connect OpenPLC/ }).click();
  await page.waitForFunction(
    () => document.querySelector('.openplc-connector')?.textContent?.includes('ONLINE · SCAN ACTIVE'),
    undefined,
    { timeout: 30000 },
  );
  await dashboard.getByRole('button', { name: /^Auto$/ }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.plc-register-control').length >= 12,
    undefined,
    { timeout: 30000 },
  );

  const physicalCanvas = page.getByLabel(/Entidad Fisica Simulada robot mirror/).locator('canvas');
  const twinCanvas = page.getByLabel(/Gemelo Digital 3D robot mirror/).locator('canvas');
  await physicalCanvas.waitFor({ timeout: 30000 });
  await twinCanvas.waitFor({ timeout: 30000 });
  await page.waitForTimeout(500);

  const controls = dashboard.locator('.plc-register-control input');
  const valuesBefore = await controls.evaluateAll((inputs) => inputs.map((input) => Number(input.value)));
  const physicalBefore = await canvasSample(physicalCanvas);
  const twinBefore = await canvasSample(twinCanvas);
  await page.waitForTimeout(2200);
  const valuesAfter = await controls.evaluateAll((inputs) => inputs.map((input) => Number(input.value)));
  const physicalAfter = await canvasSample(physicalCanvas);
  const twinAfter = await canvasSample(twinCanvas);

  const physicalValuesChanged = valuesAfter.slice(0, 6).some((value, index) => Math.abs(value - valuesBefore[index]) > 0.005);
  const twinValuesChanged = valuesAfter.slice(6, 12).some((value, index) => Math.abs(value - valuesBefore[index + 6]) > 0.005);
  const mirrorsMatch = valuesAfter.slice(0, 6).every((value, index) => Math.abs(value - valuesAfter[index + 6]) < 0.001);
  const physicalPixelsChanged = changedPixels(physicalBefore, physicalAfter);
  const twinPixelsChanged = changedPixels(twinBefore, twinAfter);

  if (!physicalValuesChanged || !twinValuesChanged || !mirrorsMatch || physicalPixelsChanged < 5 || twinPixelsChanged < 5) {
    throw new Error(JSON.stringify({
      physicalValuesChanged,
      twinValuesChanged,
      mirrorsMatch,
      physicalPixelsChanged,
      twinPixelsChanged,
      valuesBefore,
      valuesAfter,
    }));
  }
  if (errors.length) throw new Error(`Browser errors: ${errors.join(' | ')}`);

  console.log(JSON.stringify({
    result: 'PASS',
    endpoint: '127.0.0.1:502',
    physicalPixelsChanged,
    twinPixelsChanged,
    valuesBefore: valuesBefore.slice(0, 6),
    valuesAfter: valuesAfter.slice(0, 6),
  }, null, 2));
} finally {
  await browser.close();
}
