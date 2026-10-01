import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve('.');
const port = Number(process.env.RESPONSIVE_TEST_PORT ?? 5222);
const baseUrl = `http://127.0.0.1:${port}`;
const outputDir = resolve('artifacts', 'responsive');
const vite = spawn(process.execPath, [resolve('node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: root,
  stdio: 'inherit',
  shell: false,
});

const waitForServer = async () => {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(baseUrl)).ok) return;
    } catch {
      // Vite can still be starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error(`Timed out waiting for ${baseUrl}`);
};

const assertViewportLayout = async (page, label) => {
  const metrics = await page.evaluate(() => {
    const viewport = document.querySelector('.workbench > .viewport');
    const topbar = document.querySelector('.topbar');
    const rect = viewport?.getBoundingClientRect();
    return {
      bodyWidth: document.body.scrollWidth,
      rootWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      sceneWidth: rect?.width ?? 0,
      sceneHeight: rect?.height ?? 0,
      sceneLeft: rect?.left ?? -1,
      sceneRight: rect?.right ?? -1,
      topbarHeight: topbar?.getBoundingClientRect().height ?? 0,
      topbarScrollable: topbar ? topbar.scrollWidth >= topbar.clientWidth : false,
    };
  });
  if (metrics.bodyWidth > metrics.viewportWidth + 1 || metrics.rootWidth > metrics.viewportWidth + 1) {
    throw new Error(`${label}: document overflows horizontally: ${JSON.stringify(metrics)}`);
  }
  if (metrics.sceneWidth < 300 || metrics.sceneHeight < 300 || metrics.sceneLeft < -1 || metrics.sceneRight > metrics.viewportWidth + 1) {
    throw new Error(`${label}: 3D viewport is clipped or too small: ${JSON.stringify(metrics)}`);
  }
  if (metrics.topbarHeight < 44 || !metrics.topbarScrollable) throw new Error(`${label}: top toolbar is not usable: ${JSON.stringify(metrics)}`);
};

const assertOverlayFits = async (locator, page, label) => {
  await locator.waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(320);
  const [bounds, viewport] = await Promise.all([locator.boundingBox(), page.evaluate(() => ({ width: innerWidth, height: innerHeight }))]);
  if (!bounds || bounds.x < -1 || bounds.y < -1 || bounds.x + bounds.width > viewport.width + 1 || bounds.y + bounds.height > viewport.height + 1) {
    throw new Error(`${label} exceeds viewport: ${JSON.stringify({ bounds, viewport })}`);
  }
};

mkdirSync(outputDir, { recursive: true });
let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const cases = [
    { label: 'desktop', width: 1440, height: 900 },
    { label: 'tablet', width: 820, height: 1180 },
    { label: 'mobile', width: 390, height: 844 },
  ];

  for (const item of cases) {
    const context = await browser.newContext({ viewport: { width: item.width, height: item.height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const browserErrors = [];
    page.on('pageerror', (error) => browserErrors.push(error.message));
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.locator('.workbench > .viewport canvas').waitFor({ timeout: 30000 });
    await page.waitForTimeout(500);
    await assertViewportLayout(page, item.label);
    await page.screenshot({ path: resolve(outputDir, `${item.label}-workspace.png`), fullPage: true });

    if (item.label === 'mobile') {
      await page.getByRole('button', { name: 'Warehouse dashboard' }).click();
      await assertOverlayFits(page.locator('.warehouse-dashboard'), page, 'mobile Warehouse');
      await page.screenshot({ path: resolve(outputDir, 'mobile-warehouse.png'), fullPage: true });
      await page.getByRole('button', { name: 'Workspace', exact: true }).click();

      await page.getByRole('button', { name: /Digital Twin Scenario/ }).click();
      await assertOverlayFits(page.locator('.plc-dashboard'), page, 'mobile Digital Twin Scenario');
      await page.screenshot({ path: resolve(outputDir, 'mobile-digital-twin.png') });
      await page.getByRole('button', { name: 'Close PLC test dashboard' }).click();

      await page.locator('.internal-settings-toggle').click();
      await assertOverlayFits(page.locator('.internal-settings-center'), page, 'mobile internal settings');
      await page.screenshot({ path: resolve(outputDir, 'mobile-settings.png') });
      await page.locator('.internal-settings-center > header button').click();

      await page.locator('.modbus-controller-edge-toggle').click();
      await assertOverlayFits(page.locator('.modbus-controller-drawer'), page, 'mobile IoT drawer');
      await page.locator('.modbus-controller-drawer-head button').click();
      await page.locator('.trace-audit-edge-toggle').click();
      await assertOverlayFits(page.locator('.trace-audit-drawer'), page, 'mobile audit drawer');
      await page.screenshot({ path: resolve(outputDir, 'mobile-audit.png') });
    }

    if (browserErrors.length) throw new Error(`${item.label}: browser errors: ${browserErrors.join(' | ')}`);
    await context.close();
  }
  console.log('Responsive layout regression passed: desktop, tablet, mobile, Warehouse, PLC, settings, IoT and audit fit without document overflow.');
  console.log(`Screenshots: ${outputDir}`);
} finally {
  await browser?.close();
  if (!vite.killed) vite.kill('SIGTERM');
}
