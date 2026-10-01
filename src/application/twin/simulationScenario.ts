import type { DataQuality, TwinEvent, TwinProject, TwinSignalValue } from '../../domain/twin';
import { makeSample, setDesiredValue } from './twinFoundation';
import { applyDataBusSamples } from './dataBus';

export type SimulationScenarioAction =
  | { atMs: number; kind: 'reported'; signalId: string; value: TwinSignalValue; quality?: DataQuality }
  | { atMs: number; kind: 'desired'; signalId: string; value: TwinSignalValue }
  | { atMs: number; kind: 'event'; event: Omit<TwinEvent, 'timestampUtc'> }
  | { atMs: number; kind: 'mode'; mode: TwinProject['mode'] };

export type SimulationScenario = { id: string; name: string; durationMs: number; loop: boolean; actions: SimulationScenarioAction[]; metadata: Record<string, unknown> };
export type SimulationScenarioFrame = { project: TwinProject; elapsedMs: number; appliedActionIndexes: number[]; complete: boolean };

export const validateSimulationScenario = (scenario: SimulationScenario) => {
  const issues: string[] = [];
  if (!scenario.id.trim() || !scenario.name.trim()) issues.push('Scenario identity is required.');
  if (!Number.isFinite(scenario.durationMs) || scenario.durationMs <= 0) issues.push('Scenario duration must be positive.');
  scenario.actions.forEach((action, index) => { if (action.atMs < 0 || action.atMs > scenario.durationMs) issues.push(`Action ${index} is outside scenario duration.`); });
  return issues;
};

export const runSimulationScenario = (base: TwinProject, scenario: SimulationScenario, elapsedMs: number, startedAtUtc: string): SimulationScenarioFrame => {
  const issues = validateSimulationScenario(scenario); if (issues.length) throw new Error(`Invalid simulation scenario: ${issues.join(' ')}`);
  const effectiveMs = scenario.loop ? elapsedMs % scenario.durationMs : Math.min(elapsedMs, scenario.durationMs);
  let project: TwinProject = { ...base, mode: 'simulation' };
  const appliedActionIndexes: number[] = [];
  scenario.actions.forEach((action, index) => {
    if (action.atMs > effectiveMs) return;
    const atUtc = new Date(Date.parse(startedAtUtc) + action.atMs).toISOString(); appliedActionIndexes.push(index);
    if (action.kind === 'reported') project = applyDataBusSamples(project, [makeSample(action.signalId, action.value, action.quality ?? 'SIMULATED', index + 1, atUtc, atUtc)], { sequence: index + 1, emittedAtUtc: atUtc }).project;
    else if (action.kind === 'desired') project = setDesiredValue(project, action.signalId, action.value, atUtc);
    else if (action.kind === 'event') project = { ...project, events: [...project.events, { ...action.event, timestampUtc: atUtc }], metadata: { ...project.metadata, updatedAtUtc: atUtc } };
    else project = { ...project, mode: action.mode, metadata: { ...project.metadata, updatedAtUtc: atUtc } };
  });
  return { project, elapsedMs: effectiveMs, appliedActionIndexes, complete: !scenario.loop && elapsedMs >= scenario.durationMs };
};
