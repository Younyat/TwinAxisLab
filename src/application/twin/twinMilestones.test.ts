import type { ConnectionHealth, ConnectionProfile } from '../../domain/twin';
import type { ProtocolAdapter, ProtocolReadResult, ProtocolSubscription } from './protocolAdapter';
import { ProtocolAdapterRegistry } from './protocolAdapter';
import { TwinAxisConnectionManager } from './connectionManager';
import { convertEngineeringUnit } from './units';
import { createTwinPackage, parseTwinPackage, serializeTwinPackage, validateTwinPackage } from './twinPackage';
import { createTwinProjectFromAssetDocument } from './twinFoundation';
import { MqttAdapter } from '../../infrastructure/protocols/mqtt/MqttAdapter';
import { OpcUaGatewayAdapter } from '../../infrastructure/protocols/opcua/OpcUaGatewayAdapter';
import { runSimulationScenario, validateSimulationScenario, type SimulationScenario } from './simulationScenario';

const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };

class TestAdapter implements ProtocolAdapter {
  readonly protocol = 'modbus' as const;
  readonly connectionId = 'plc-main';
  private current: ConnectionHealth = { connectionId: this.connectionId, protocol: this.protocol, state: 'DISCONNECTED', quality: 'COMM_LOST', updatedAtUtc: new Date(0).toISOString() };
  async connect() { this.current = { ...this.current, state: 'ONLINE', quality: 'GOOD', updatedAtUtc: '2026-09-26T10:00:00.000Z', metrics: { roundTripMs: 2, reconnectCount: 0 } }; return this.current; }
  async disconnect() { this.current = { ...this.current, state: 'DISCONNECTED', quality: 'COMM_LOST', updatedAtUtc: '2026-09-26T10:01:00.000Z' }; return this.current; }
  async read(): Promise<ProtocolReadResult> { throw new Error('not required'); }
  async write(): Promise<ProtocolReadResult> { throw new Error('not required'); }
  async subscribe(): Promise<ProtocolSubscription> { return { unsubscribe: () => undefined }; }
  health() { return this.current; }
  metadata() { return { endpoint: '127.0.0.1:502' }; }
}

export const runTwinMilestoneTests = async () => {
  const registry = new ProtocolAdapterRegistry();
  const manager = new TwinAxisConnectionManager(registry);
  const profile: ConnectionProfile = { id: 'plc-main', name: 'OpenPLC', protocol: 'modbus', endpoint: '127.0.0.1:502', enabled: true, autoReconnect: true, reconnectDelayMs: 1000, metadata: { unitId: 1 } };
  manager.add(profile, new TestAdapter());
  assert((await manager.connect(profile.id)).health.state === 'ONLINE', 'Connection Manager did not connect its adapter.');
  assert(manager.list()[0].lastSeenUtc === '2026-09-26T10:00:00.000Z', 'Connection Manager did not retain lastSeen.');
  await manager.disconnect(profile.id);
  manager.update(profile.id, { endpoint: '127.0.0.1:5020' });
  assert(manager.get(profile.id)?.profile.endpoint.endsWith('5020'), 'Disconnected connection profile was not editable.');
  assert(Math.abs(convertEngineeringUnit(180, 'deg', 'rad') - Math.PI) < 1e-10, 'Angle unit conversion failed.');
  assert(convertEngineeringUnit(1, 'bar', 'pascal') === 100000, 'Pressure unit conversion failed.');
  const mqttAdapter = new MqttAdapter({ connectionId: 'mqtt-main', endpoint: 'ws://127.0.0.1:9001/mqtt' });
  assert(mqttAdapter.protocol === 'mqtt' && mqttAdapter.metadata().endpoint.includes('9001'), 'MQTT adapter metadata is invalid.');
  const opcuaAdapter = new OpcUaGatewayAdapter({ connectionId: 'opcua-main', gatewayUrl: 'http://127.0.0.1:8767/opcua', endpointUrl: 'opc.tcp://127.0.0.1:4840' });
  assert(opcuaAdapter.protocol === 'opcua' && opcuaAdapter.metadata().endpointUrl.includes('4840'), 'OPC UA adapter metadata is invalid.');

  const document = { schemaVersion: 1 as const, metadata: { id: 'package-source', name: 'Robot Cell', author: 'test', createdAt: '2026-09-26T09:00:00.000Z', updatedAt: '2026-09-26T09:00:00.000Z' }, nodes: [] };
  const project = createTwinProjectFromAssetDocument(document, { timestampUtc: '2026-09-26T09:00:00.000Z' });
  const scenario: SimulationScenario = { id: 'startup', name: 'Startup sequence', durationMs: 2000, loop: false, metadata: {}, actions: [
    { atMs: 500, kind: 'mode', mode: 'simulation' },
    { atMs: 1000, kind: 'event', event: { id: 'evt-start', type: 'mode-change', severity: 'info', message: 'Machine started', metadata: { scenario: 'startup' } } },
  ] };
  assert(validateSimulationScenario(scenario).length === 0, 'Valid simulation scenario was rejected.');
  const scenarioFrame = runSimulationScenario(project, scenario, 1500, '2026-09-26T09:00:00.000Z');
  assert(scenarioFrame.project.mode === 'simulation' && scenarioFrame.project.events.some((event) => event.id === 'evt-start'), 'Simulation scenario did not apply deterministic actions.');
  const pkg = createTwinPackage({ project: scenarioFrame.project, sourceDocument: document, includeRuntime: true, scenarios: [scenario], connectionProfiles: [profile], signalMappings: [{ id: 'joint-j1', protocol: 'modbus', wire: 100 }], timestampUtc: '2026-09-26T10:00:00.000Z' });
  assert(validateTwinPackage(pkg).filter((issue) => issue.severity === 'error').length === 0, 'Generated Twin Package is invalid.');
  const recovered = parseTwinPackage(serializeTwinPackage(pkg));
  assert(recovered.manifest.platform === 'TwinAxis' && recovered.definition.id === project.id, 'Twin Package round trip lost identity.');
  assert(recovered.runtime?.exportedAtUtc === '2026-09-26T10:00:00.000Z', 'Twin Package round trip lost runtime state.');
  assert(recovered.runtime?.scenarios[0]?.id === 'startup' && recovered.runtime.events.some((event) => event.id === 'evt-start'), 'Twin Package round trip lost scenario operations.');
  assert(recovered.configuration?.connectionProfiles[0]?.id === 'plc-main', 'Twin Package round trip lost connection profiles.');
  assert(recovered.configuration?.signalMappings[0]?.wire === 100, 'Twin Package round trip lost signal mappings.');
  console.log('TwinAxis milestone tests passed: connections, units and Twin Package persistence.');
};
