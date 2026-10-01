import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const port = Number(process.env.ADVANCED_RIG_TEST_PORT ?? 5214);
const root = resolve('.');
const viteBin = resolve('node_modules', 'vite', 'bin', 'vite.js');
const screenshotDirectory = resolve('docs', 'readme-assets');
const screenshotPath = resolve(screenshotDirectory, 'advanced-rig-workspace.png');

const waitForServer = async (url, timeoutMs = 30000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The temporary Vite process may still be starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 180));
  }
  throw new Error(`Timed out waiting for ${url}`);
};

const canvasSignal = async (page) =>
  page.locator('canvas').first().evaluate((canvas) => {
    const context = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!context) return { width: canvas.width, height: canvas.height, sample: 0 };
    const pixels = new Uint8Array(4 * 25);
    const x = Math.max(0, Math.floor(canvas.width / 2) - 2);
    const y = Math.max(0, Math.floor(canvas.height / 2) - 2);
    context.readPixels(x, y, 5, 5, context.RGBA, context.UNSIGNED_BYTE, pixels);
    return { width: canvas.width, height: canvas.height, sample: pixels.reduce((sum, value) => sum + value, 0) };
  });

const vite = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: root,
  stdio: 'inherit',
  shell: false,
});

let browser;
try {
  await waitForServer(`http://127.0.0.1:${port}`);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Industrial Cell/ }).click();
  await page.getByRole('button', { name: /Industrial Gantry Robot/ }).click();
  await page.locator('canvas').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);

  const before = await canvasSignal(page);
  if (before.width < 300 || before.height < 250 || before.sample === 0) throw new Error(`Robot viewport did not render: ${JSON.stringify(before)}`);

  const launcher = page.getByRole('button', { name: /Advanced Rig Mechanical setup and guided help/ });
  await launcher.waitFor();
  await launcher.click();
  const mechanicalPanel = page.locator('.kinematic-graph-panel').first();
  const workspace = page.getByLabel('Advanced mechanical rig workspace');
  await workspace.waitFor({ timeout: 30000 });
  await workspace.getByText('Mechanical hierarchy').waitFor();
  const tutorial = page.getByRole('dialog', { name: 'Advanced Rig tutorial' });
  await tutorial.waitFor();
  if ((await tutorial.locator('.advanced-tutorial-steps li').count()) !== 8) throw new Error('Advanced tutorial is incomplete.');
  await tutorial.getByRole('button', { name: 'Constraints', exact: true }).click();
  await workspace.getByText('Local joint space').waitFor();
  await workspace.getByRole('button', { name: 'Rig', exact: true }).click();
  if ((await workspace.locator('.rig-tree-row').count()) < 2) throw new Error('Advanced rig hierarchy is empty.');
  const controlCount = await workspace.locator('.rig-control-row').count();
  if (controlCount < 1) throw new Error('Advanced viewport controls were not generated.');

  await workspace.getByRole('button', { name: 'Pose', exact: true }).click();
  const poseRows = workspace.locator('.advanced-pose-row');
  if ((await poseRows.count()) < 1) throw new Error('Advanced pose channels are empty.');
  const rotationalJoint = await page.evaluate(() => {
    const node = window.__assetForgeDocument?.nodes.find((item) => item.id === window.__assetForgeDocument?.selectedNodeId);
    const joint = node?.geometry?.kinematicGraph?.joints?.find((item) => item.type === 'revolute' || item.type === 'continuous');
    return joint ? { id: joint.id, name: joint.name, origin: [...joint.origin.position] } : undefined;
  });
  if (!rotationalJoint) throw new Error('Advanced rig fixture has no rotational joint for ring calibration.');
  await workspace.locator('.advanced-pose-row').filter({ hasText: rotationalJoint.name }).getByRole('button').first().click();
  const firstPoseSlider = poseRows.first().locator('input[type="range"]');
  if (await firstPoseSlider.isEnabled()) {
    const maximum = Number(await firstPoseSlider.getAttribute('max'));
    const minimum = Number(await firstPoseSlider.getAttribute('min'));
    const step = Number(await firstPoseSlider.getAttribute('step')) || 0.01;
    const target = minimum + Math.round(((maximum - minimum) * 0.35) / step) * step;
    await firstPoseSlider.evaluate((input, value) => {
      input.value = String(value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, target);
  }

  await workspace.getByRole('button', { name: 'Constraints', exact: true }).click();
  await workspace.getByText('Local joint space').waitFor();
  const ringCalibration = workspace.getByLabel('Rotation ring frame calibration');
  await ringCalibration.waitFor();
  await ringCalibration.getByRole('button', { name: /XZ around Y/ }).click();
  await ringCalibration.getByRole('button', { name: 'Increase ring reference X' }).click();
  await ringCalibration.getByRole('button', { name: 'Adopt as Joint Movement' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('Joint frame adopted and saved'), undefined, { timeout: 30000 });
  const calibrated = await page.evaluate((jointId) => {
    const node = window.__assetForgeDocument?.nodes.find((item) => item.id === window.__assetForgeDocument?.selectedNodeId);
    const joint = node?.geometry?.kinematicGraph?.joints?.find((item) => item.id === jointId);
    const control = node?.geometry?.kinematicGraph?.rigControls?.find((item) => item.jointId === jointId);
    const storedText = localStorage.getItem('twinaxis.current-project');
    const stored = storedText ? JSON.parse(storedText) : undefined;
    const storedNode = stored?.nodes?.find((item) => item.id === stored.selectedNodeId);
    const storedJoint = storedNode?.geometry?.kinematicGraph?.joints?.find((item) => item.id === jointId);
    return joint ? { axis: joint.axis, plane: joint.motionPlane, origin: joint.origin.position, shape: control?.shape, visible: control?.visible, status: joint.status, storedJoint } : undefined;
  }, rotationalJoint.id);
  if (!calibrated || JSON.stringify(calibrated.axis) !== JSON.stringify([0, 1, 0]) || calibrated.plane !== 'xz' || calibrated.origin[0] <= rotationalJoint.origin[0] || calibrated.shape !== 'ring' || !calibrated.visible || calibrated.status !== 'validated' || calibrated.storedJoint?.motionPlane !== 'xz' || calibrated.storedJoint?.axis?.[1] !== 1) {
    throw new Error(`Ring frame calibration was not applied to the joint: ${JSON.stringify(calibrated)}`);
  }
  await workspace.getByRole('button', { name: 'Show', exact: true }).click();

  await workspace.getByRole('button', { name: 'Animation', exact: true }).click();
  const actionSelect = workspace.locator('.animation-settings-row select').first();
  if (!(await actionSelect.inputValue())) {
    await workspace.getByRole('button', { name: /Create Action/ }).click();
  }
  await workspace.getByRole('button', { name: 'Key Pose', exact: true }).click();
  await page.waitForTimeout(250);
  if ((await workspace.locator('.keyframe-row').count()) < 1) throw new Error('Advanced timeline did not store a key pose.');

  await workspace.getByRole('button', { name: /Save Rig/ }).click();
  await page.waitForTimeout(250);
  const persisted = await page.evaluate((jointId) => {
    const documentText = localStorage.getItem('twinaxis.current-project') ?? localStorage.getItem('3d-asset-forge.current-project');
    const project = documentText ? JSON.parse(documentText) : undefined;
    const node = project?.nodes?.find((item) => item.id === project.selectedNodeId);
    return {
      controls: node?.geometry?.kinematicGraph?.rigControls?.length ?? 0,
      keys: node?.geometry?.kinematicGraph?.motionClips?.reduce((total, item) => total + (item.keyframes?.length ?? 0), 0) ?? 0,
      fps: node?.geometry?.kinematicGraph?.animationSettings?.fps,
      calibratedJoint: node?.geometry?.kinematicGraph?.joints?.find((item) => item.id === jointId),
    };
  }, rotationalJoint.id);
  if (persisted.controls !== controlCount || persisted.keys < 1 || persisted.fps !== 24 || persisted.calibratedJoint?.motionPlane !== 'xz' || persisted.calibratedJoint?.axis?.[1] !== 1) {
    throw new Error(`Advanced rig was not persisted correctly: ${JSON.stringify(persisted)}`);
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  const reloadedMechanicalPanel = page.locator('.kinematic-graph-panel').first();
  await reloadedMechanicalPanel.getByRole('button', { name: 'Advanced', exact: true }).click();
  const reloadedWorkspace = page.getByLabel('Advanced mechanical rig workspace');
  await reloadedWorkspace.waitFor({ timeout: 30000 });
  const reloadedFrame = await page.evaluate((jointId) => {
    const node = window.__assetForgeDocument?.nodes.find((item) => item.id === window.__assetForgeDocument?.selectedNodeId);
    const joint = node?.geometry?.kinematicGraph?.joints?.find((item) => item.id === jointId);
    return joint ? { axis: joint.axis, plane: joint.motionPlane, origin: joint.origin.position, status: joint.status } : undefined;
  }, rotationalJoint.id);
  if (!reloadedFrame || reloadedFrame.plane !== 'xz' || reloadedFrame.axis[1] !== 1 || reloadedFrame.origin[0] <= rotationalJoint.origin[0] || reloadedFrame.status !== 'validated') {
    throw new Error(`Adopted ring frame disappeared after reload: ${JSON.stringify(reloadedFrame)}`);
  }
  await reloadedWorkspace.getByRole('button', { name: 'Animation', exact: true }).click();
  if ((await reloadedWorkspace.locator('.keyframe-row').count()) < 1) throw new Error('Saved keyframes disappeared after reload.');
  mkdirSync(screenshotDirectory, { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const after = await canvasSignal(page);
  if (after.sample === 0) throw new Error('Robot viewport became blank while using Advanced rig tools.');
  if (errors.length) throw new Error(`Browser errors: ${errors.join(' | ')}`);

  console.log(`Advanced rig E2E passed: ${controlCount} controls and ${persisted.keys} persisted keys survived reload.`);
  console.log(`Screenshot: ${screenshotPath}`);
} finally {
  await browser?.close();
  if (!vite.killed) vite.kill('SIGTERM');
}
