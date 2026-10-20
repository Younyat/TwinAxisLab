export type BenchPose = [number, number, number, number];
export const BENCH_HOME: BenchPose = [0, 300, 60, 50];
const limits = [[-171, 171], [130, 360], [0, 180], [12, 70]];
const rates = [25, 40, 35, 15];

export function advanceBenchPlant(pose: BenchPose, run: number, direction: number, elapsedMs: number, frozen: boolean, target: BenchPose = pose): BenchPose {
  if (frozen) return [...pose];
  // Do not catch up a delayed network sample by teleporting the plant.
  const seconds = Math.max(0, Math.min(250, elapsedMs)) / 1000;
  return pose.map((value, i) => {
    const sign = direction & (1 << i) ? 1 : -1;
    const delta = run & (1 << i) ? Math.min(rates[i] * seconds, Math.abs(target[i] - value)) * sign : 0;
    return Math.max(limits[i][0], Math.min(limits[i][1], value + delta));
  }) as BenchPose;
}

export function benchFrame(pose: BenchPose, heartbeat: number, minMask: number, maxMask: number, valid: boolean, homed: boolean): number[] {
  const floats = pose.flatMap(value => {
    const view = new DataView(new ArrayBuffer(4));
    view.setFloat32(0, value, false);
    return [view.getUint16(0, false), view.getUint16(2, false)];
  });
  return [5, 1, minMask & 15, maxMask & 15, (valid ? 1 : 0) | (homed ? 2 : 0), heartbeat & 65535, ...floats];
}
