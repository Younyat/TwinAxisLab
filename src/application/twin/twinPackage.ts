import type { FunctionalAssembly, FunctionalComponent } from '../../domain/mechanics';
import type { AssetDocument } from '../../domain/model';
import type { ConnectionProfile, TwinProject } from '../../domain/twin';
import { migrateLegacyTwinProject, validateTwinProject } from './twinFoundation';
import type { AlarmInstance, AlarmRule } from './alarmEngine';
import type { HistorianRecord } from './historianReplay';
import type { SimulationScenario } from './simulationScenario';

export const TWIN_PACKAGE_SCHEMA = 'twinaxis-package/1.0' as const;

export type TwinPackageManifest = {
  schemaVersion: typeof TWIN_PACKAGE_SCHEMA;
  platform: 'TwinAxis';
  name: string;
  version: string;
  createdAtUtc: string;
  updatedAtUtc: string;
  definitionId: string;
  components: string[];
  assemblies: string[];
  protocols: string[];
  propertyCount: number;
  bindingCount: number;
  assetCount: number;
};

export type TwinPackage = {
  manifest: TwinPackageManifest;
  definition: TwinProject;
  sourceDocument?: AssetDocument;
  functionalComponents: FunctionalComponent[];
  functionalAssemblies: FunctionalAssembly[];
  runtime?: {
    exportedAtUtc: string;
    state: TwinProject['state'];
    connections: TwinProject['connectionHealth'];
    events: TwinProject['events'];
    commands: TwinProject['commands'];
    alarmRules: AlarmRule[];
    alarmInstances: AlarmInstance[];
    historian: HistorianRecord[];
    scenarios: SimulationScenario[];
  };
  configuration?: {
    connectionProfiles: ConnectionProfile[];
    signalMappings: Record<string, unknown>[];
  };
};

export type TwinPackageIssue = { severity: 'error' | 'warning'; code: string; message: string };

const unique = <T>(values: T[]) => [...new Set(values)];

export const createTwinPackage = (input: {
  project: TwinProject;
  sourceDocument?: AssetDocument;
  components?: FunctionalComponent[];
  assemblies?: FunctionalAssembly[];
  version?: string;
  includeRuntime?: boolean;
  timestampUtc?: string;
  alarmRules?: AlarmRule[];
  alarmInstances?: AlarmInstance[];
  historian?: HistorianRecord[];
  scenarios?: SimulationScenario[];
  connectionProfiles?: ConnectionProfile[];
  signalMappings?: Record<string, unknown>[];
}): TwinPackage => {
  const now = input.timestampUtc ?? new Date().toISOString();
  const project = migrateLegacyTwinProject(input.project);
  const components = input.components ?? input.sourceDocument?.partWarehouse?.flatMap((item) => item.itemType === 'part' && item.functionalComponent ? [item.functionalComponent] : []) ?? [];
  const assemblies = input.assemblies ?? input.sourceDocument?.partWarehouse?.flatMap((item) => item.itemType === 'assembly' && item.functionalAssembly ? [item.functionalAssembly] : []) ?? [];
  return {
    manifest: {
      schemaVersion: TWIN_PACKAGE_SCHEMA,
      platform: 'TwinAxis',
      name: project.name,
      version: input.version ?? '1.0.0',
      createdAtUtc: project.metadata.createdAtUtc,
      updatedAtUtc: now,
      definitionId: project.id,
      components: unique([...project.components.map((item) => item.id), ...components.map((item) => item.id)]),
      assemblies: assemblies.map((item) => item.id),
      protocols: unique(project.signalBindings.filter((item) => item.enabled).map((item) => item.protocol)),
      propertyCount: project.properties.length,
      bindingCount: project.signalBindings.length,
      assetCount: project.assets.length,
    },
    definition: project,
    sourceDocument: input.sourceDocument,
    functionalComponents: components,
    functionalAssemblies: assemblies,
    runtime: input.includeRuntime ? { exportedAtUtc: now, state: project.state, connections: project.connectionHealth, events: project.events, commands: project.commands, alarmRules: input.alarmRules ?? [], alarmInstances: input.alarmInstances ?? [], historian: input.historian ?? [], scenarios: input.scenarios ?? [] } : undefined,
    configuration: { connectionProfiles: structuredClone(input.connectionProfiles ?? []), signalMappings: structuredClone(input.signalMappings ?? []) },
  };
};

export const validateTwinPackage = (pkg: TwinPackage): TwinPackageIssue[] => {
  const issues: TwinPackageIssue[] = [];
  if (pkg.manifest.schemaVersion !== TWIN_PACKAGE_SCHEMA) issues.push({ severity: 'error', code: 'PACKAGE_SCHEMA', message: `Unsupported package schema ${pkg.manifest.schemaVersion}.` });
  if (pkg.manifest.platform !== 'TwinAxis') issues.push({ severity: 'error', code: 'PACKAGE_PLATFORM', message: 'Package platform must be TwinAxis.' });
  if (pkg.manifest.definitionId !== pkg.definition.id) issues.push({ severity: 'error', code: 'DEFINITION_ID', message: 'Manifest definition does not match the packaged TwinProject.' });
  if (pkg.manifest.propertyCount !== pkg.definition.properties.length) issues.push({ severity: 'error', code: 'PROPERTY_COUNT', message: 'Manifest property count is inconsistent.' });
  if (pkg.manifest.bindingCount !== pkg.definition.signalBindings.length) issues.push({ severity: 'error', code: 'BINDING_COUNT', message: 'Manifest binding count is inconsistent.' });
  const connectionIds = pkg.configuration?.connectionProfiles.map((profile) => profile.id) ?? [];
  if (new Set(connectionIds).size !== connectionIds.length) issues.push({ severity: 'error', code: 'CONNECTION_PROFILE_ID', message: 'Connection profile IDs must be unique.' });
  pkg.configuration?.connectionProfiles.forEach((profile) => {
    if (!profile.id || !profile.endpoint) issues.push({ severity: 'error', code: 'CONNECTION_PROFILE_REQUIRED', message: 'Connection profiles require an ID and endpoint.' });
  });
  validateTwinProject(pkg.definition).forEach((issue) => issues.push({ severity: issue.severity === 'error' ? 'error' : 'warning', code: `TWIN_${issue.code}`, message: issue.message }));
  return issues;
};

export const serializeTwinPackage = (pkg: TwinPackage) => {
  const errors = validateTwinPackage(pkg).filter((issue) => issue.severity === 'error');
  if (errors.length) throw new Error(`Invalid Twin Package: ${errors.map((issue) => issue.code).join(', ')}.`);
  return JSON.stringify(pkg, null, 2);
};

export const parseTwinPackage = (json: string): TwinPackage => {
  const parsed = JSON.parse(json) as TwinPackage;
  if (!parsed?.manifest || !parsed?.definition) throw new Error('File is not a TwinAxis Twin Package.');
  parsed.definition = migrateLegacyTwinProject(parsed.definition);
  parsed.functionalComponents ??= [];
  parsed.functionalAssemblies ??= [];
  parsed.configuration ??= { connectionProfiles: [], signalMappings: [] };
  parsed.configuration.connectionProfiles ??= [];
  parsed.configuration.signalMappings ??= [];
  if (parsed.runtime) { parsed.runtime.alarmRules ??= []; parsed.runtime.alarmInstances ??= []; parsed.runtime.historian ??= []; parsed.runtime.scenarios ??= []; }
  const errors = validateTwinPackage(parsed).filter((issue) => issue.severity === 'error');
  if (errors.length) throw new Error(`Invalid Twin Package: ${errors.map((issue) => issue.code).join(', ')}.`);
  return parsed;
};
